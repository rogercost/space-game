import * as THREE from 'three'
import { createStarfield } from './starfield'
import { createShip } from './ship'

const SPACE_COLOR = 0x05060a

// --- Renderer -------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
document.body.appendChild(renderer.domElement)

// --- Scene & camera -------------------------------------------------------
const scene = new THREE.Scene()
scene.background = new THREE.Color(SPACE_COLOR)
// Exponential fog gives depth: near things crisp, distant ones fade into space.
scene.fog = new THREE.FogExp2(SPACE_COLOR, 0.0018)

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  4000,
)
// Behind (+Z) and slightly above the ship, looking forward (toward -Z).
camera.position.set(0, 1.4, 6)
camera.lookAt(0, 0, -2)

// --- Lights ---------------------------------------------------------------
scene.add(new THREE.AmbientLight(0x404a66, 1.1))
const keyLight = new THREE.DirectionalLight(0xffffff, 2.0)
keyLight.position.set(4, 6, 3)
scene.add(keyLight)
const rimLight = new THREE.DirectionalLight(0x335577, 1.0)
rimLight.position.set(-5, -2, -4)
scene.add(rimLight)

// --- Content --------------------------------------------------------------
scene.add(createStarfield())

const ship = createShip()
scene.add(ship)

// --- Resize ---------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

// --- Render loop ----------------------------------------------------------
function animate() {
  renderer.render(scene, camera)
  requestAnimationFrame(animate)
}
animate()
