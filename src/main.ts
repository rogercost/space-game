import * as THREE from 'three'
import { createStarfield, updateStarfield } from './starfield'
import { createShip } from './ship'
import { createPointer } from './input'
import { Flight } from './flight'
import { AsteroidField } from './asteroids'
import { Game, Shake } from './game'

const SPACE_COLOR = 0x05060a

// --- Renderer -------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
document.body.appendChild(renderer.domElement)

// --- Scene & camera -------------------------------------------------------
const scene = new THREE.Scene()
scene.background = new THREE.Color(SPACE_COLOR)
scene.fog = new THREE.FogExp2(SPACE_COLOR, 0.0018)

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  4000,
)
camera.position.set(0, 1.6, 7)

// --- Lights ---------------------------------------------------------------
const ambient = new THREE.AmbientLight(0x404a66, 1.6)
scene.add(ambient)
const keyLight = new THREE.DirectionalLight(0xffffff, 2.0)
keyLight.position.set(4, 6, 3)
scene.add(keyLight)
// Fill/rim light on the side facing away from the key, so shadow sides read.
const rimLight = new THREE.DirectionalLight(0x4a6890, 1.6)
rimLight.position.set(-5, -2, -4)
scene.add(rimLight)

// --- Content --------------------------------------------------------------
const starfield = createStarfield()
scene.add(starfield)

const ship = createShip()
scene.add(ship)

const pointer = createPointer()
const flight = new Flight(ship)

const field = new AsteroidField()
scene.add(field.group)
field.init(ship.position, flight.forward)

const game = new Game()
const shake = new Shake()

// Ship collider: a single sphere a bit smaller than the hull (player-favored).
const SHIP_RADIUS = 0.8
const KNOCKBACK = 45
const shipCollider = new THREE.Mesh(
  new THREE.IcosahedronGeometry(SHIP_RADIUS, 2),
  new THREE.MeshBasicMaterial({
    color: 0x44ddff,
    wireframe: true,
    transparent: true,
    opacity: 0.6,
    depthTest: false,
  }),
)
shipCollider.visible = false
ship.add(shipCollider)

// --- Difficulty ramp & score ----------------------------------------------
const BASE_SPEED = 50
const MAX_SPEED = 78
const BASE_COUNT = 360
const MAX_COUNT = 9000
const SPEED_RAMP = 0.28
const COUNT_RAMP = 6.3
const BEST_KEY = 'starship3d.bestTime' // best survival time, in seconds
let best = loadBest()

// Density and speed rise with distance travelled (∝ √distance), like the original's curve.
function updateDifficulty(distance: number): void {
  const s = Math.sqrt(distance)
  flight.cfg.speed = Math.min(MAX_SPEED, BASE_SPEED + s * SPEED_RAMP)
  const count = Math.min(MAX_COUNT, Math.round(BASE_COUNT + s * COUNT_RAMP))
  if (count !== field.cfg.count) field.setCount(count)
}

// Expose for live tuning in the DevTools console, e.g. `flight.cfg.driftResponse = 1.5`,
// `field.setCount(200)`, or `scene.fog.density = 0.0008`.
Object.assign(window, { flight, field, scene, game, shake, starfield, ambient, keyLight, rimLight })

addReticle()
const pauseOverlay = addPauseOverlay()
const healthHud = addHealthHud()
const { scoreEl, bestEl } = addScoreHud()
bestEl.textContent = `best ${formatTime(best)}`
const statsOverlay = addStatsOverlay()
const deathOverlay = addDeathOverlay()
let paused = false
let statsVisible = false
let fps = 60

// Space: pause/resume. C: collider debug. M: stats panel. R: restart.
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault()
    paused = !paused
    pauseOverlay.style.display = paused ? 'flex' : 'none'
  } else if (e.key.toLowerCase() === 'c') {
    const on = field.toggleDebug()
    shipCollider.visible = on
    console.log('collider debug:', on ? 'on' : 'off')
  } else if (e.key.toLowerCase() === 'm') {
    statsVisible = !statsVisible
    statsOverlay.style.display = statsVisible ? 'block' : 'none'
  } else if (e.key.toLowerCase() === 'b') {
    const on = field.toggleCollisions()
    console.log('asteroid collisions:', on ? 'on' : 'off')
  } else if (e.key.toLowerCase() === 'r') {
    restart()
  }
})

// --- Chase camera ---------------------------------------------------------
const CAM_OFFSET = new THREE.Vector3(0, 1.6, 7) // local: behind (+Z) and above
const WORLD_UP = new THREE.Vector3(0, 1, 0)
const desiredCamPos = new THREE.Vector3()
const lookTarget = new THREE.Vector3()
const smoothLook = new THREE.Vector3(0, 0, -12)
const camUp = new THREE.Vector3()
const camBase = new THREE.Vector3(0, 1.6, 7) // smoothed follow position (pre-shake)

function updateCamera(dt: number): void {
  // Sit behind the ship using heading (not bank, so the horizon doesn't roll).
  desiredCamPos.copy(CAM_OFFSET).applyQuaternion(flight.heading).add(ship.position)
  camBase.lerp(desiredCamPos, 1 - Math.exp(-10 * dt))

  // Apply camera shake on top of the smoothed base (doesn't feed back into it).
  camera.position.copy(camBase)
  const s = shake.amount
  if (s > 0) {
    camera.position.x += (Math.random() * 2 - 1) * s
    camera.position.y += (Math.random() * 2 - 1) * s
    camera.position.z += (Math.random() * 2 - 1) * s
  }

  // Aim a bit ahead of the ship, smoothed for a trailing feel.
  lookTarget.copy(flight.forward).multiplyScalar(12).add(ship.position)
  smoothLook.lerp(lookTarget, 1 - Math.exp(-12 * dt))

  // Follow the ship's up through pitch/loops without gimbal flips.
  camUp.copy(WORLD_UP).applyQuaternion(flight.heading)
  camera.up.copy(camUp)
  camera.lookAt(smoothLook)
}

// --- Resize ---------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

// --- Render loop ----------------------------------------------------------
const clock = new THREE.Clock()
function animate(): void {
  // Always advance the clock (keeps dt per-frame and clamped) but skip world
  // updates while paused, so we can freeze the frame and still render it.
  const dt = Math.min(clock.getDelta(), 0.05)

  if (!paused) {
    game.update(dt)
    shake.update(dt)

    if (game.dead) {
      flight.coast(dt)
    } else {
      flight.update(dt, pointer.value.x, pointer.value.y)
      if (!game.invulnerable) handleCollision()
      game.addProgress(dt, flight.velocity.length())
      updateDifficulty(game.distance)
    }

    field.update(dt, ship.position, flight.forward)
    updateCamera(dt)
    updateStarfield(starfield, ship.position)

    // Flicker the ship while invulnerable; otherwise keep it visible.
    ship.visible = game.invulnerable ? Math.floor(clock.elapsedTime * 20) % 2 === 0 : true
    healthHud.textContent = healthText()
    scoreEl.textContent = formatTime(game.time)

    if (dt > 0) fps += (1 / dt - fps) * 0.1
    if (statsVisible) updateStats()
  }

  renderer.render(scene, camera)
  requestAnimationFrame(animate)
}
animate()

// --- Collision & run flow -------------------------------------------------
function handleCollision(): void {
  const hit = field.collide(ship.position, SHIP_RADIUS)
  if (!hit) return
  // Push out of the overlap and kick the ship away from the lump it struck.
  ship.position.addScaledVector(hit.normal, hit.penetration)
  flight.velocity.multiplyScalar(0.55)
  flight.velocity.addScaledVector(hit.normal, KNOCKBACK)
  shake.add(0.85)
  if (game.hit()) onDeath()
}

function onDeath(): void {
  const finalTime = game.time
  if (finalTime > best) {
    best = finalTime
    saveBest(best)
    bestEl.textContent = `best ${formatTime(best)}`
  }
  deathOverlay.innerHTML =
    '<div>YOU DIED</div>' +
    `<div style="font:600 26px/1 system-ui,sans-serif;letter-spacing:0.08em;margin-top:18px;color:#dfe8ff">${formatTime(finalTime)}</div>` +
    `<div style="font:400 16px/1 system-ui,sans-serif;letter-spacing:0.12em;margin-top:6px;opacity:0.7;color:#dfe8ff">best ${formatTime(best)}</div>` +
    '<div style="font:400 18px/1 system-ui,sans-serif;letter-spacing:0.2em;margin-top:24px;opacity:0.85">press R to restart</div>'
  deathOverlay.style.display = 'flex'
}

function formatTime(seconds: number): string {
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function updateStats(): void {
  statsOverlay.innerHTML =
    `time     ${formatTime(game.time)}<br>` +
    `best     ${formatTime(best)}<br>` +
    `health   ${game.health}/${game.maxHealth}<br>` +
    `speed    ${flight.cfg.speed.toFixed(1)}<br>` +
    `density  ${field.cfg.count}<br>` +
    `collide  ${field.activeCount}<br>` +
    `distance ${Math.floor(game.distance)}<br>` +
    `fps      ${fps.toFixed(0)}`
}

function restart(): void {
  game.reset()
  flight.reset()
  flight.cfg.speed = BASE_SPEED
  field.cfg.count = BASE_COUNT
  field.init(ship.position, flight.forward)
  shake.reset()
  ship.visible = true
  deathOverlay.style.display = 'none'
  // Snap the camera behind the freshly launched ship.
  camBase.set(0, 1.6, 7)
  smoothLook.set(0, 0, -12)
}

function healthText(): string {
  return '♥'.repeat(game.health) + '♡'.repeat(game.maxHealth - game.health)
}

function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0
  } catch {
    return 0
  }
}

function saveBest(value: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(value))
  } catch {
    // storage unavailable (e.g. private mode) — ignore
  }
}

// --- Center reticle (neutral-steering reference) --------------------------
function addReticle(): void {
  const dot = document.createElement('div')
  dot.style.cssText = [
    'position:fixed',
    'left:50%',
    'top:50%',
    'width:16px',
    'height:16px',
    'margin:-8px 0 0 -8px',
    'border:2px solid rgba(255,255,255,0.25)',
    'border-radius:50%',
    'box-shadow:0 0 0 1px rgba(0,0,0,0.4) inset',
    'pointer-events:none',
    'z-index:10',
  ].join(';')
  document.body.appendChild(dot)
}

// --- Health HUD -----------------------------------------------------------
function addHealthHud(): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cssText = [
    'position:fixed',
    'left:18px',
    'top:14px',
    'font:600 28px/1 system-ui,sans-serif',
    'color:#ff5566',
    'letter-spacing:6px',
    'text-shadow:0 2px 8px rgba(0,0,0,0.6)',
    'pointer-events:none',
    'z-index:15',
  ].join(';')
  document.body.appendChild(el)
  return el
}

// --- Score HUD ------------------------------------------------------------
function addScoreHud(): { scoreEl: HTMLDivElement; bestEl: HTMLDivElement } {
  const wrap = document.createElement('div')
  wrap.style.cssText =
    'position:fixed;right:18px;top:12px;text-align:right;pointer-events:none;z-index:15;' +
    'font-family:system-ui,sans-serif;color:#dfe8ff;text-shadow:0 2px 8px rgba(0,0,0,0.6)'
  const scoreEl = document.createElement('div')
  scoreEl.style.cssText = 'font-weight:700;font-size:30px;letter-spacing:1px'
  scoreEl.textContent = '0:00'
  const bestEl = document.createElement('div')
  bestEl.style.cssText = 'font-weight:500;font-size:15px;opacity:0.7;margin-top:2px'
  wrap.append(scoreEl, bestEl)
  document.body.appendChild(wrap)
  return { scoreEl, bestEl }
}

// --- Stats overlay (toggled with M) ---------------------------------------
function addStatsOverlay(): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cssText = [
    'position:fixed',
    'left:18px',
    'top:56px',
    'font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace',
    'white-space:pre',
    'color:rgba(223,232,255,0.85)',
    'text-shadow:0 1px 4px rgba(0,0,0,0.7)',
    'display:none',
    'pointer-events:none',
    'z-index:15',
  ].join(';')
  document.body.appendChild(el)
  return el
}

// --- Death overlay --------------------------------------------------------
function addDeathOverlay(): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cssText = [
    'position:fixed',
    'inset:0',
    'display:none',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'font:700 56px/1 system-ui,sans-serif',
    'letter-spacing:0.15em',
    'color:#ff4455',
    'text-shadow:0 3px 16px rgba(0,0,0,0.7)',
    'background:rgba(10,4,6,0.45)',
    'pointer-events:none',
    'z-index:25',
  ].join(';')
  document.body.appendChild(el)
  return el
}

// --- Pause overlay --------------------------------------------------------
function addPauseOverlay(): HTMLDivElement {
  const el = document.createElement('div')
  el.textContent = 'PAUSED'
  el.style.cssText = [
    'position:fixed',
    'inset:0',
    'display:none',
    'align-items:center',
    'justify-content:center',
    'font:600 42px/1 system-ui,sans-serif',
    'letter-spacing:0.3em',
    'color:rgba(255,255,255,0.85)',
    'text-shadow:0 2px 12px rgba(0,0,0,0.6)',
    'background:rgba(5,6,10,0.35)',
    'pointer-events:none',
    'z-index:20',
  ].join(';')
  document.body.appendChild(el)
  return el
}
