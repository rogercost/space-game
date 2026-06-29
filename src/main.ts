import * as THREE from 'three'

// --- Renderer -------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
document.body.appendChild(renderer.domElement)

// --- Scene & camera -------------------------------------------------------
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x05060a)

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  2000,
)
camera.position.set(0, 0, 5)

// --- Lights ---------------------------------------------------------------
scene.add(new THREE.AmbientLight(0x404060, 1.2))
const keyLight = new THREE.DirectionalLight(0xffffff, 1.6)
keyLight.position.set(3, 4, 5)
scene.add(keyLight)

// --- Reference object -----------------------------------------------------
// A lit, faceted icosphere. Doubles as a render-pipeline smoke test and a
// preview of the shading style we'll use for asteroids in Phase 4.
const rock = new THREE.Mesh(
  new THREE.IcosahedronGeometry(1.4, 3),
  new THREE.MeshStandardMaterial({
    color: 0x8a8f9a,
    flatShading: true,
    roughness: 0.9,
    metalness: 0.0,
  }),
)
scene.add(rock)

// --- Resize ---------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

// --- Render loop ----------------------------------------------------------
const clock = new THREE.Clock()
function animate() {
  const dt = clock.getDelta()
  rock.rotation.x += dt * 0.4
  rock.rotation.y += dt * 0.6
  renderer.render(scene, camera)
  requestAnimationFrame(animate)
}
animate()
