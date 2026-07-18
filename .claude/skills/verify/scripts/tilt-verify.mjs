// End-to-end tilt-steering verification over CDP with Chrome virtual sensors.
// Requires: dev server on :5173, headless Chrome with --remote-debugging-port=9222.

const CDP_HTTP = 'http://localhost:9222/json'
const APP_URL = 'http://localhost:5173'

// --- tiny quaternion lib (x,y,z,w), device->world -----------------------------
const rad = (d) => (d * Math.PI) / 180
function qaxis(x, y, z, a) {
  const s = Math.sin(a / 2)
  return [x * s, y * s, z * s, Math.cos(a / 2)]
}
function qmul(a, b) {
  const [ax, ay, az, aw] = a
  const [bx, by, bz, bw] = b
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]
}
const qinv = ([x, y, z, w]) => [-x, -y, -z, w]
function qrotv(q, v) {
  const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), qinv(q))
  return [p[0], p[1], p[2]]
}
// Gravity-sensor reading ("up" vector in device coords, m/s^2) for a pose.
const gravityOf = (q) => qrotv(qinv(q), [0, 0, 9.8])

// Poses (device->world). Upright portrait facing user = Rx(90deg); the 40deg
// reclined gaming grip = Rx(50deg). Same construction the math-check validated.
const GRIP = qaxis(1, 0, 0, rad(50))
const WHEEL45 = qmul(GRIP, qaxis(0, 0, 1, -rad(45)))
const COMBO = qmul(qmul(GRIP, qaxis(0, 0, 1, -rad(30))), qaxis(1, 0, 0, rad(10)))
const PITCH_DOWN15 = qmul(GRIP, qaxis(1, 0, 0, -rad(15)))
const PITCH_UP10 = qmul(GRIP, qaxis(1, 0, 0, rad(10)))

// --- CDP plumbing -------------------------------------------------------------
const targets = await (await fetch(CDP_HTTP)).json()
const page = targets.find((t) => t.type === 'page')
if (!page) throw new Error('no page target')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

let msgId = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id !== undefined && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id)
    pending.delete(m.id)
    if (m.error) rej(new Error(`${m.error.message} ${m.error.data ?? ''}`))
    else res(m.result)
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'warning') {
    console.log('  [console.warn]', m.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
  }
}
function send(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++msgId
    pending.set(id, { res, rej })
    ws.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text))
  return r.result.value
}
async function poll(expression, timeoutMs = 30000, label = expression) {
  const t0 = Date.now()
  for (;;) {
    if (await evaluate(expression)) return
    if (Date.now() - t0 > timeoutMs) throw new Error('timeout waiting for: ' + label)
    await new Promise((r) => setTimeout(r, 200))
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function pressKey(key, code) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, text: key })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code })
}

let failures = 0
function check(label, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  [${detail}]` : ''}`)
  if (!cond) failures++
}
const near = (a, b, tol) => Math.abs(a - b) <= tol

async function setGravity(q) {
  const [x, y, z] = gravityOf(q)
  await send('Emulation.setSensorOverrideReadings', { type: 'gravity', reading: { xyz: { x, y, z } } })
}
async function setOrientation(q) {
  const [x, y, z, w] = q
  await send('Emulation.setSensorOverrideReadings', { type: 'relative-orientation', reading: { quaternion: { x, y, z, w } } })
}
async function setPose(q) {
  await setGravity(q)
  await setOrientation(q)
}
// Virtual sensors only emit 'reading' when the reading changes, so "holding" a
// pose means re-sending it with sub-noise jitter at sensor-ish cadence.
let jitterTick = 0
async function holdPose(q, ms, { ros = true } = {}) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const j = (++jitterTick % 2 ? 1 : -1) * 0.002
    const [x, y, z] = gravityOf(q)
    await send('Emulation.setSensorOverrideReadings', { type: 'gravity', reading: { xyz: { x, y: y + j, z } } })
    if (ros) {
      const n = Math.hypot(q[0] + j * 1e-3, q[1], q[2], q[3])
      await send('Emulation.setSensorOverrideReadings', { type: 'relative-orientation', reading: { quaternion: { x: (q[0] + j * 1e-3) / n, y: q[1] / n, z: q[2] / n, w: q[3] / n } } })
    }
    await sleep(40)
  }
}
const readState = () =>
  evaluate('({ v: { ...steering.value }, active: steering.tiltActive, debug: steering.tiltDebug })')

// --- setup --------------------------------------------------------------------
await send('Page.enable')
await send('Runtime.enable')
// The tilt gate requires a coarse-pointer, no-hover device: patch matchMedia.
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    const orig = window.matchMedia.bind(window)
    window.matchMedia = (q) => q.includes('hover: none') && q.includes('pointer: coarse')
      ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} }
      : orig(q)
  })()`,
})
await send('Browser.grantPermissions', { permissions: ['sensors'] })
await send('Emulation.setSensorOverrideEnabled', { enabled: true, type: 'gravity' })
await send('Emulation.setSensorOverrideEnabled', { enabled: true, type: 'relative-orientation' })
console.log('virtual sensors enabled (gravity + relative-orientation)')
await setPose(GRIP)

await send('Page.navigate', { url: APP_URL })
await poll('!!window.steering && !!window.flight', 30000, 'app boot')
check('tiltSupported under emulated mobile', await evaluate('steering.tiltSupported'))

// --- pass 1: GravitySensor + RelativeOrientationSensor ------------------------
console.log('=== pass 1: GravitySensor roll + RelativeOrientationSensor pitch ===')
await pressKey('t', 'KeyT')
await poll('steering.tiltActive', 5000, 'tilt active')
await holdPose(GRIP, 1500)
await poll("steering.tiltDebug.includes(' g ')", 5000, 'calibration to complete')
{
  const s = await readState()
  check('sources are grv+rot', s.debug.startsWith('grv+rot'), s.debug)
  check('calibrated at rest: value = (0,0)', near(s.v.x, 0, 0.02) && near(s.v.y, 0, 0.02), JSON.stringify(s.v))
}
await holdPose(WHEEL45, 700)
{
  const s = await readState()
  check('wheel-roll 45: full roll deflection', near(Math.abs(s.v.x), 1, 0.05), `x=${s.v.x.toFixed(3)}`)
  check('wheel-roll 45: ZERO phantom pitch (the fix)', near(s.v.y, 0, 0.02), `y=${s.v.y.toFixed(3)}`)
}
await holdPose(COMBO, 700)
{
  const s = await readState()
  check('roll30+pitch10: pitch = +0.35', near(s.v.y, 0.348, 0.05), `y=${s.v.y.toFixed(3)}`)
  check('roll30+pitch10: roll still deflected', Math.abs(s.v.x) > 0.5, `x=${s.v.x.toFixed(3)}`)
}
await holdPose(PITCH_DOWN15, 700)
{
  const s = await readState()
  check('pure pitch -15: pitch = -0.565', near(s.v.y, -0.565, 0.05), `y=${s.v.y.toFixed(3)}`)
  check('pure pitch -15: no roll leak', near(s.v.x, 0, 0.05), `x=${s.v.x.toFixed(3)}`)
}

// --- gameplay wiring: tilt actually steers the ship ---------------------------
console.log('=== gameplay: tilt drives the flight model ===')
await holdPose(GRIP, 500)
{
  const btn = await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'LAUNCH' && b.checkVisibility())
    const r = b.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })()`)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btn.x, y: btn.y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btn.x, y: btn.y, button: 'left', clickCount: 1 })
}
await evaluate('field.setCount(0)') // no rocks: no collisions, fast software render
await poll('flight.velocity.length() > 1', 60000, 'launch intro to finish')
await holdPose(WHEEL45, 1500)
{
  const s = await readState()
  const fx = await evaluate('flight.forward.x')
  check('in flight: heading yaws in the tilt direction', Math.sign(fx) === Math.sign(s.v.x) && Math.abs(fx) > 0.2, `value.x=${s.v.x.toFixed(2)} forward.x=${fx.toFixed(2)}`)
}
await holdPose(GRIP, 300)
await pressKey(' ', 'Space') // pause so nothing drifts during the next passes
await sleep(300)

// --- pass 2: no orientation sensor -> gravity-tangent pitch fallback ----------
console.log('=== pass 2: RelativeOrientationSensor unavailable ===')
await pressKey('t', 'KeyT') // off
await poll('!steering.tiltActive', 5000, 'tilt off')
await send('Emulation.setSensorOverrideEnabled', { enabled: false, type: 'relative-orientation' })
await pressKey('t', 'KeyT') // on again
await poll('steering.tiltActive', 5000, 'tilt active (pass 2)')
await holdPose(GRIP, 2500, { ros: false })
await poll("steering.tiltDebug.includes(' g ')", 8000, 'calibration (pass 2)')
await holdPose(PITCH_UP10, 700, { ros: false })
{
  const s = await readState()
  check('gravity-only pitch responds (+10 -> +0.35)', near(s.v.y, 0.348, 0.06), `y=${s.v.y.toFixed(3)} debug="${s.debug}"`)
}

// --- pass 3: no gravity sensor either -> devicemotion fallback ----------------
console.log('=== pass 3: GravitySensor unavailable -> devicemotion ===')
await pressKey('t', 'KeyT') // off
await poll('!steering.tiltActive', 5000, 'tilt off')
await send('Emulation.setSensorOverrideEnabled', { enabled: false, type: 'gravity' })
// Feed synthetic devicemotion events (the handler only reads data fields).
const gGrip = gravityOf(GRIP)
await evaluate(`(() => {
  window.__motion = { x: ${gGrip[0]}, y: ${gGrip[1]}, z: ${gGrip[2]} }
  window.__motionTimer = setInterval(() => {
    window.dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: window.__motion }))
  }, 16)
})()`)
await pressKey('t', 'KeyT') // on again
await poll('steering.tiltActive', 5000, 'tilt active (pass 3)')
await poll("steering.tiltDebug.startsWith('mot')", 8000, 'devicemotion fallback engaged')
await poll("steering.tiltDebug.includes(' g ')", 8000, 'calibration (pass 3)')
{
  const s = await readState()
  check('devicemotion source calibrates', s.debug.startsWith('mot'), s.debug)
}
const gPitch = gravityOf(PITCH_DOWN15)
await evaluate(`window.__motion = { x: ${gPitch[0]}, y: ${gPitch[1]}, z: ${gPitch[2]} }`)
await sleep(800)
{
  const s = await readState()
  check('devicemotion pitch responds (-15 -> -0.565)', near(s.v.y, -0.565, 0.06), `y=${s.v.y.toFixed(3)}`)
}
await evaluate('clearInterval(window.__motionTimer)')

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
ws.close()
process.exit(failures === 0 ? 0 : 1)
