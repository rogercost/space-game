// Validation harness for src/tilt.ts math: simulates a phone in 3D and checks
// the new tangent-frame roll + rotation-vector pitch against the old (v2)
// formulas, which are the field-proven sign anchor (roll worked on-device).
//
// Model:
//  - World frame: Z up, user faces +Y ("north"), user's right = +X.
//  - q = device->world quaternion (what RelativeOrientationSensor reports,
//    up to an arbitrary world yaw).
//  - Gravity-sensor reading direction (the "up" vector in device coords):
//    g_dev = q^-1 * (0,0,1).
import * as THREE from '/home/roger/git/personal/space-game/node_modules/three/build/three.module.js'

const V = (x, y, z) => new THREE.Vector3(x, y, z)
const deg = (r) => (r * 180) / Math.PI
const rad = (d) => (d * Math.PI) / 180

// Device->world for the upright portrait grip facing the user:
// device x (screen right) -> world X, device y (screen top) -> world Z (up),
// device z (out of screen, at the user) -> world -Y.
const qUpright = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(V(1, 0, 0), V(0, 0, 1), V(0, -1, 0)),
)

const rotX = (a) => new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), a)
const rotY = (a) => new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), a)
const rotZ = (a) => new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), a)

// Body-frame gesture: q' = q * r (rotate about the device's own axis).
const body = (q, r) => q.clone().multiply(r)
// World-frame gesture: q' = r * q (rotate about a fixed world axis).
const world = (q, r) => r.clone().premultiply ? q.clone().premultiply(r) : null

function gravityDev(q) {
  return V(0, 0, 1).applyQuaternion(q.clone().invert())
}

// --- the tilt.ts math, transcribed -----------------------------------------
function remapToScreen(v, angle) {
  const { x, y, z } = v
  if (angle === 90) return V(y, -x, z)
  if (angle === 180) return V(-x, -y, z)
  if (angle === 270) return V(-y, x, z)
  return V(x, y, z)
}

function makeFrame(qCal, angle) {
  const g0 = remapToScreen(gravityDev(qCal), angle).normalize()
  const rollTangent = V(1, 0, 0).addScaledVector(g0, -g0.x).normalize()
  const pitchTangent = g0.clone().cross(rollTangent)
  return { g0, rollTangent, pitchTangent, calQuatInv: qCal.clone().invert(), angle }
}

function newTilt(frame, qNow) {
  const g = remapToScreen(gravityDev(qNow), frame.angle).normalize()
  const dot0 = g.dot(frame.g0)
  const roll = Math.atan2(g.dot(frame.rollTangent), dot0)
  const gravityPitch = Math.atan2(g.dot(frame.pitchTangent), dot0)
  // Rotation-vector pitch (RelativeOrientationSensor path).
  const q = frame.calQuatInv.clone().multiply(qNow)
  if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w)
  const sinHalf = Math.hypot(q.x, q.y, q.z)
  let rosPitch = 0
  if (sinHalf > 1e-9) {
    const scale = (2 * Math.atan2(sinHalf, q.w)) / sinHalf
    rosPitch = remapToScreen(V(q.x * scale, q.y * scale, q.z * scale), frame.angle).x
  }
  return { roll, gravityPitch, rosPitch }
}

// --- the old v2 formulas (sign anchor) -------------------------------------
function oldAngles(q, angle) {
  const s = remapToScreen(gravityDev(q), angle)
  return {
    roll: Math.atan2(s.x, Math.hypot(s.y, s.z)),
    pitch: Math.atan2(s.z, -s.y),
  }
}
const shortest = (a) => Math.atan2(Math.sin(a), Math.cos(a))

// --- checks ----------------------------------------------------------------
let failures = 0
function check(label, cond, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  [${detail}]` : ''}`)
  if (!cond) failures++
}
const approx = (a, b, tol = rad(0.5)) => Math.abs(a - b) < tol

console.log('=== Portrait (angle 0), grip reclined 40 deg from vertical ===')
const grip = body(qUpright, rotX(-rad(40)))
{
  const g = gravityDev(grip)
  check('grip gravity = (0, cos40, sin40)', approx(g.x, 0) && approx(g.y, Math.cos(rad(40)), 1e-6) && approx(g.z, Math.sin(rad(40)), 1e-6), `g=(${g.x.toFixed(3)}, ${g.y.toFixed(3)}, ${g.z.toFixed(3)})`)
}
const frame = makeFrame(grip, 0)
const cal0 = newTilt(frame, grip)
check('calibration pose reads zero', approx(cal0.roll, 0) && approx(cal0.gravityPitch, 0) && approx(cal0.rosPitch, 0))

// Pitch gesture: top edge toward the player by 10 deg (about device +x).
{
  const q = body(grip, rotX(rad(10)))
  const t = newTilt(frame, q)
  const dOld = shortest(oldAngles(q, 0).pitch - oldAngles(grip, 0).pitch)
  check('pitch-toward-face: rosPitch = +10 deg', approx(t.rosPitch, rad(10)), `${deg(t.rosPitch).toFixed(2)} deg`)
  check('pitch-toward-face: gravityPitch = +10 deg', approx(t.gravityPitch, rad(10)), `${deg(t.gravityPitch).toFixed(2)} deg`)
  check('pitch sign matches old v2 formula', Math.sign(t.gravityPitch) === Math.sign(dOld) && Math.sign(t.rosPitch) === Math.sign(dOld), `old delta ${deg(dOld).toFixed(2)} deg`)
  check('pitch gesture leaks no roll', approx(t.roll, 0), `${deg(t.roll).toFixed(2)} deg`)
}

// Wheel roll: rotate about the screen normal (device z). Determine the sign
// that means "right edge down" by checking gravity gains +x screen component
// in the OLD formula (which steered correctly on-device).
{
  let qRight = body(grip, rotZ(-rad(45)))
  let dOldRoll = shortest(oldAngles(qRight, 0).roll - oldAngles(grip, 0).roll)
  const wheelSign = Math.sign(dOldRoll) // whatever old-roll calls positive
  const t = newTilt(frame, qRight)
  check('wheel-roll 45: new roll sign matches old v2 roll sign', Math.sign(t.roll) === Math.sign(dOldRoll), `new ${deg(t.roll).toFixed(1)} old ${deg(dOldRoll).toFixed(1)}`)
  check('wheel-roll 45: rosPitch stays 0 (the crosstalk fix)', approx(t.rosPitch, 0), `${deg(t.rosPitch).toFixed(2)} deg`)
  const dOldPitch = shortest(oldAngles(qRight, 0).pitch - oldAngles(grip, 0).pitch)
  console.log(`  info: phantom pitch under 45deg wheel-roll — old v2: ${deg(dOldPitch).toFixed(1)} deg, gravity-tangent: ${deg(t.gravityPitch).toFixed(1)} deg, ROS: ${deg(t.rosPitch).toFixed(2)} deg`)

  // Tray roll, same physical direction: rotation about the world axis pointing
  // away from the user (+Y). Pick the sign that agrees with wheel-roll.
  for (const s of [1, -1]) {
    const qTray = grip.clone().premultiply(rotY(s * rad(15)))
    const tt = newTilt(frame, qTray)
    if (Math.sign(tt.roll) === Math.sign(t.roll)) {
      check('tray-roll agrees in sign with wheel-roll', true, `tray ${deg(tt.roll).toFixed(1)} deg (world-Y sign ${s})`)
      check('tray-roll 15: rosPitch stays ~0', approx(tt.rosPitch, 0, rad(1)), `${deg(tt.rosPitch).toFixed(2)} deg`)
      break
    }
    if (s === -1) check('tray-roll agrees in sign with wheel-roll', false, 'neither world-Y sign matched')
  }

  // Combined: wheel-roll 30 then pitch toward face 10 — pitch must survive.
  const qCombo = body(body(grip, rotZ(-rad(30))), rotX(rad(10)))
  const tc = newTilt(frame, qCombo)
  check('roll30+pitch10: rosPitch = +10 deg (+-2)', approx(tc.rosPitch, rad(10), rad(2)), `${deg(tc.rosPitch).toFixed(2)} deg`)
  check('roll30+pitch10: roll keeps wheel sign', Math.sign(tc.roll) === wheelSign, `${deg(tc.roll).toFixed(1)} deg`)
  const dOldPitchCombo = shortest(oldAngles(qCombo, 0).pitch - oldAngles(grip, 0).pitch)
  console.log(`  info: combo pitch readback — old v2: ${deg(dOldPitchCombo).toFixed(1)} deg, gravity-tangent: ${deg(tc.gravityPitch).toFixed(1)} deg, ROS: ${deg(tc.rosPitch).toFixed(2)} deg`)
}

console.log('=== Flatter grip (60 deg from vertical): worst case for attempt 2 ===')
{
  const flat = body(qUpright, rotX(-rad(60)))
  const f = makeFrame(flat, 0)
  const qTurn = body(flat, rotZ(-rad(45)))
  const t = newTilt(f, qTurn)
  const dOldPitch = shortest(oldAngles(qTurn, 0).pitch - oldAngles(flat, 0).pitch)
  console.log(`  info: 45deg wheel-roll at flat grip — old v2 phantom pitch: ${deg(dOldPitch).toFixed(1)} deg, gravity-tangent: ${deg(t.gravityPitch).toFixed(1)} deg, ROS: ${deg(t.rosPitch).toFixed(2)} deg`)
  check('flat grip wheel-roll: rosPitch stays 0', approx(t.rosPitch, 0))
  const qPitch = body(flat, rotX(rad(10)))
  const tp = newTilt(f, qPitch)
  check('flat grip pitch: rosPitch = +10 deg', approx(tp.rosPitch, rad(10)), `${deg(tp.rosPitch).toFixed(2)} deg`)
}

console.log('=== Landscape (angle 90): screen x = device y ===')
{
  // Build a landscape grip whose REMAPPED gravity equals the portrait one:
  // remap90(g) = (g.y, -g.x, g.z) = (0, cos40, sin40)  =>  g_dev = (-cos40, 0, sin40).
  // That pose: device x points groundward-ish, i.e. phone turned on its side.
  const target = V(-Math.cos(rad(40)), 0, Math.sin(rad(40)))
  // Rotate the reclined portrait grip about the screen normal by -90 deg
  // (body frame) to lay it on its side.
  const gripL = body(grip, rotZ(-rad(90)))
  const g = gravityDev(gripL)
  check('landscape grip gravity as expected', g.distanceTo(target) < 1e-6, `g=(${g.x.toFixed(3)}, ${g.y.toFixed(3)}, ${g.z.toFixed(3)})`)
  const fL = makeFrame(gripL, 90)
  const calL = newTilt(fL, gripL)
  check('landscape calibration reads zero', approx(calL.roll, 0) && approx(calL.gravityPitch, 0) && approx(calL.rosPitch, 0))
  // Physical pitch: rotation about SCREEN x = device y (per the remap).
  const qP = body(gripL, rotY(rad(10)))
  const tP = newTilt(fL, qP)
  check('landscape pitch gesture: rosPitch = +10 deg', approx(tP.rosPitch, rad(10)), `${deg(tP.rosPitch).toFixed(2)} deg`)
  check('landscape pitch gesture: gravityPitch = +10 deg', approx(tP.gravityPitch, rad(10)), `${deg(tP.gravityPitch).toFixed(2)} deg`)
  check('landscape pitch gesture leaks no roll', approx(tP.roll, 0), `${deg(tP.roll).toFixed(2)} deg`)
  // Wheel roll still about the screen normal (device z).
  const qR = body(gripL, rotZ(-rad(30)))
  const tR = newTilt(fL, qR)
  const dOldRoll = shortest(oldAngles(qR, 90).roll - oldAngles(gripL, 90).roll)
  check('landscape wheel-roll: sign matches old v2', Math.sign(tR.roll) === Math.sign(dOldRoll), `new ${deg(tR.roll).toFixed(1)} old ${deg(dOldRoll).toFixed(1)}`)
  check('landscape wheel-roll: rosPitch stays 0', approx(tR.rosPitch, 0), `${deg(tR.rosPitch).toFixed(2)} deg`)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
