import * as THREE from 'three'
import { createStarfield, updateStarfield } from './starfield'
import { createShip } from './ship'
import { createPointer } from './input'
import { Flight } from './flight'
import { AsteroidField } from './asteroids'

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
scene.add(new THREE.AmbientLight(0x404a66, 1.1))
const keyLight = new THREE.DirectionalLight(0xffffff, 2.0)
keyLight.position.set(4, 6, 3)
scene.add(keyLight)
const rimLight = new THREE.DirectionalLight(0x335577, 1.0)
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

// Expose for live tuning in the DevTools console, e.g. `flight.cfg.driftResponse = 1.5`,
// `field.setCount(200)`, or `scene.fog.density = 0.0008`.
Object.assign(window, { flight, field, scene })

// Press C to toggle the debug collider spheres.
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'c') {
    console.log('asteroid collider spheres:', field.toggleDebug() ? 'on' : 'off')
  }
})

addReticle()

// --- Chase camera ---------------------------------------------------------
const CAM_OFFSET = new THREE.Vector3(0, 1.6, 7) // local: behind (+Z) and above
const WORLD_UP = new THREE.Vector3(0, 1, 0)
const desiredCamPos = new THREE.Vector3()
const lookTarget = new THREE.Vector3()
const smoothLook = new THREE.Vector3(0, 0, -12)
const camUp = new THREE.Vector3()

function updateCamera(dt: number): void {
  // Sit behind the ship using heading (not bank, so the horizon doesn't roll).
  desiredCamPos.copy(CAM_OFFSET).applyQuaternion(flight.heading).add(ship.position)
  camera.position.lerp(desiredCamPos, 1 - Math.exp(-10 * dt))

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
  const dt = Math.min(clock.getDelta(), 0.05)

  flight.update(dt, pointer.value.x, pointer.value.y)
  field.update(dt, ship.position, flight.forward)
  updateCamera(dt)
  updateStarfield(starfield, ship.position)

  renderer.render(scene, camera)
  requestAnimationFrame(animate)
}
animate()

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
