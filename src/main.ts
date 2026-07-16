import * as THREE from 'three'
import { createStarfield, updateStarfield } from './starfield'
import { createShip } from './ship'
import { createPointer } from './input'
import { Flight, DEFAULT_FLIGHT } from './flight'
import { AsteroidField, DEFAULT_FIELD } from './asteroids'
import { Game, Shake } from './game'
import { Leaderboard } from './leaderboard'
import { UI } from './ui'

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
const leaderboard = new Leaderboard()

// Ship collider: a single sphere a bit smaller than the hull (player-favored).
const SHIP_RADIUS = 0.8
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
const BASE_SPEED = DEFAULT_FLIGHT.speed
const MAX_SPEED = 78
const BASE_COUNT = DEFAULT_FIELD.count
const MAX_COUNT = 9000
const SPEED_RAMP = 0.28
const COUNT_RAMP = 6.3
const BEST_KEY = 'starship3d.bestTime' // best survival time, in seconds
const NAME_KEY = 'starship3d.playerName' // last name entered on the death screen
let best = loadBest()

// Density and speed rise with distance travelled (∝ √distance), like the original's curve.
function updateDifficulty(distance: number): void {
  const s = Math.sqrt(distance)
  flight.cfg.speed = Math.min(MAX_SPEED, BASE_SPEED + s * SPEED_RAMP)
  const count = Math.min(MAX_COUNT, Math.round(BASE_COUNT + s * COUNT_RAMP))
  if (count !== field.cfg.count) field.setCount(count)
}

// --- App state machine ----------------------------------------------------
// menu -> playing <-> paused, and playing -> dead. Boot lands on the menu; the
// 3D scene keeps rendering behind every screen (see the animate() branches).
type Screen = 'menu' | 'playing' | 'paused' | 'dead'
let screen: Screen = 'menu'
let deathTime = 0
let fps = 60

const ui = new UI({
  onLaunch: startRun,
  onContinue: resume,
  onRestart: startRun,
  onMainMenu: goMenu,
  onPause: pause,
  onPlayAgain: startRun,
  onSubmitName: (name) => {
    savePlayerName(name)
    return leaderboard.add(name, deathTime)
  },
  getLeaderboard: () => leaderboard.entries,
})

// Expose for live tuning in the DevTools console, e.g. `flight.cfg.driftResponse = 1.5`,
// `field.setCount(200)`, or `scene.fog.density = 0.0008`.
Object.assign(window, { flight, field, scene, game, shake, starfield, ambient, keyLight, rimLight, ui, leaderboard })

ui.setBest(best)
goMenu()

// Space: pause/resume. C: collider debug. M: stats panel. B: rock collisions.
// (Restart lives on the pause/death menus now — there's no restart key.)
window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return // don't hijack name entry
  const k = e.key.toLowerCase()
  if (e.code === 'Space') {
    e.preventDefault()
    if (screen === 'playing') pause()
    else if (screen === 'paused') resume()
  } else if (k === 'c') {
    const on = field.toggleDebug()
    shipCollider.visible = on
    console.log('collider debug:', on ? 'on' : 'off')
  } else if (k === 'm') {
    console.log('stats:', ui.toggleStats() ? 'on' : 'off')
  } else if (k === 'b') {
    const on = field.toggleCollisions()
    console.log('asteroid collisions:', on ? 'on' : 'off')
  }
})

// --- Chase camera ---------------------------------------------------------
const CAM_OFFSET = new THREE.Vector3(0, 1.6, 7) // local: behind (+Z) and above
const WORLD_UP = new THREE.Vector3(0, 1, 0)
const desiredCamPos = new THREE.Vector3()
const lookTarget = new THREE.Vector3()
const smoothLook = new THREE.Vector3(0, 0, -12)
const camUp = new THREE.Vector3()
const camBase = CAM_OFFSET.clone() // smoothed follow position (pre-shake)

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
  // Always advance the clock (keeps dt per-frame and clamped); what we update
  // depends on the current screen. The scene renders every frame regardless.
  const dt = Math.min(clock.getDelta(), 0.05)

  if (screen === 'playing') {
    game.update(dt)
    shake.update(dt)
    flight.update(dt, pointer.value.x, pointer.value.y)
    if (!game.invulnerable) handleCollision() // may transition us to 'dead'
    if (screen === 'playing') {
      game.addProgress(dt, flight.velocity.length())
      updateDifficulty(game.distance)
    }
    field.update(dt, ship.position, flight.forward)
    updateCamera(dt)
    updateStarfield(starfield, ship.position)

    // Flicker the ship while invulnerable; otherwise keep it visible.
    ship.visible = game.invulnerable ? Math.floor(clock.elapsedTime * 20) % 2 === 0 : true

    ui.setHealth(game.health, game.maxHealth)
    ui.setScore(game.time)
    if (dt > 0) fps += (1 / dt - fps) * 0.1
    ui.setStats({
      time: game.time,
      best,
      health: game.health,
      maxHealth: game.maxHealth,
      speed: flight.cfg.speed,
      count: field.cfg.count,
      active: field.activeCount,
      distance: game.distance,
      fps,
    })
  } else if (screen === 'dead') {
    // Keep the death scene alive: the ship coasts and the field drifts behind the overlay.
    shake.update(dt)
    flight.coast(dt)
    field.update(dt, ship.position, flight.forward)
    updateCamera(dt)
    updateStarfield(starfield, ship.position)
  } else if (screen === 'menu') {
    // Attract-mode backdrop: the field drifts past the idle ship.
    field.update(dt, ship.position, flight.forward)
    updateCamera(dt)
    updateStarfield(starfield, ship.position)
  }
  // 'paused' freezes the world; we just re-render the last frame under the menu.

  renderer.render(scene, camera)
  requestAnimationFrame(animate)
}
animate()

// --- Collision & run flow -------------------------------------------------
function handleCollision(): void {
  const hit = field.collide(ship.position, SHIP_RADIUS)
  if (!hit) return
  flight.applyKnockback(hit.normal, hit.penetration)
  shake.add(0.85)
  if (game.hit()) goDeath()
}

function goMenu(): void {
  screen = 'menu'
  ui.showMenu()
}

function startRun(): void {
  game.reset()
  flight.reset()
  flight.cfg.speed = BASE_SPEED
  field.cfg.count = BASE_COUNT
  field.init(ship.position, flight.forward)
  shake.reset()
  ship.visible = true
  // Snap the camera behind the freshly launched ship.
  camBase.copy(CAM_OFFSET)
  smoothLook.set(0, 0, -12)
  screen = 'playing'
  ui.showPlaying()
}

function pause(): void {
  if (screen !== 'playing') return
  screen = 'paused'
  ui.showPaused()
}

function resume(): void {
  if (screen !== 'paused') return
  screen = 'playing'
  ui.showPlaying()
}

function goDeath(): void {
  deathTime = game.time
  if (deathTime > best) {
    best = deathTime
    saveBest(best)
    ui.setBest(best)
  }
  ship.visible = true // stop any invuln flicker for the death scene
  screen = 'dead'
  ui.showDeath(deathTime, best, loadPlayerName())
}

// --- Persistence ----------------------------------------------------------
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

function loadPlayerName(): string {
  try {
    return localStorage.getItem(NAME_KEY) || ''
  } catch {
    return ''
  }
}

function savePlayerName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name)
  } catch {
    // storage unavailable — ignore
  }
}
