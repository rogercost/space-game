import * as THREE from 'three'

/** A collider sphere in an asteroid's local (unit-scale) space. */
export interface SphereDef {
  center: THREE.Vector3
  radius: number
}

/** A generated asteroid shape: mesh geometry + the spheres that define it. */
export interface AsteroidShape {
  geometry: THREE.BufferGeometry
  spheres: SphereDef[]
  /** Max extent from local origin (unit scale), for broadphase later. */
  boundingRadius: number
}

export interface AsteroidFieldConfig {
  /** Number of active asteroids. */
  count: number
  /** Forward distance (min/max) at which recycled asteroids respawn. */
  spawnNear: number
  spawnFar: number
  /** Distance from the ship beyond which an asteroid is recycled. */
  despawnFar: number
  /** How strongly spawns are biased toward the flight direction (0 = all around). */
  forwardBias: number
  /** Asteroid scale range. */
  minScale: number
  maxScale: number
}

export const DEFAULT_FIELD: AsteroidFieldConfig = {
  count: 90,
  spawnNear: 100,
  spawnFar: 380,
  despawnFar: 440,
  forwardBias: 1.4,
  minScale: 4,
  maxScale: 14,
}

// --- small helpers --------------------------------------------------------
function rand(a: number, b: number): number {
  return a + Math.random() * (b - a)
}

/** Uniformly random unit vector, written into `out`. */
function randomUnit(out: THREE.Vector3): THREE.Vector3 {
  const u = Math.random() * 2 - 1
  const t = Math.random() * Math.PI * 2
  const s = Math.sqrt(1 - u * u)
  return out.set(s * Math.cos(t), s * Math.sin(t), u)
}

/**
 * Radial distance from the local origin to the surface of the UNION of spheres,
 * in direction `d` (unit). For each sphere, the far ray-sphere intersection; the
 * union surface is the furthest of them. This is what makes the mesh follow the
 * spheres (peanut, clover, etc.) exactly.
 */
function unionDistance(d: THREE.Vector3, spheres: SphereDef[]): number {
  let best = 0
  for (const s of spheres) {
    const dc = d.dot(s.center)
    const disc = dc * dc - s.center.lengthSq() + s.radius * s.radius
    if (disc < 0) continue // ray misses this sphere
    const tFar = dc + Math.sqrt(disc)
    if (tFar > best) best = tFar
  }
  return best
}

/** Cheap multi-frequency noise in [-1, 1] for craggy surface detail. */
function craggy(d: THREE.Vector3, ph: THREE.Vector3, fr: THREE.Vector3): number {
  const a =
    Math.sin(d.x * fr.x + ph.x) + Math.sin(d.y * fr.y + ph.y) + Math.sin(d.z * fr.z + ph.z)
  const b = Math.sin((d.x + d.y + d.z) * fr.x * 1.7 + ph.y)
  return (a / 3) * 0.7 + b * 0.3
}

function pickSphereCount(): number {
  const r = Math.random()
  return r < 0.4 ? 1 : r < 0.8 ? 2 : 3 // round / peanut / clover
}

const _d = new THREE.Vector3()

/**
 * Generate one asteroid shape at unit base scale. The 1–3 spheres are the source
 * of truth; the mesh is derived from their union surface plus surface noise.
 */
export function generateShape(detail = 2): AsteroidShape {
  const n = pickSphereCount()
  const spheres: SphereDef[] = []

  const r0 = rand(0.7, 1.0)
  spheres.push({ center: new THREE.Vector3(0, 0, 0), radius: r0 })
  for (let k = 1; k < n; k++) {
    const ri = rand(0.45, 0.9)
    const dir = randomUnit(new THREE.Vector3())
    const dist = rand(0, r0 + ri) // 0 (concentric) .. r0+ri (just touching)
    spheres.push({ center: dir.multiplyScalar(dist), radius: ri })
  }

  const ph = new THREE.Vector3(rand(0, 6.283), rand(0, 6.283), rand(0, 6.283))
  const fr = new THREE.Vector3(rand(3, 6), rand(3, 6), rand(3, 6))
  const amp = rand(0.08, 0.16)

  const geometry = new THREE.IcosahedronGeometry(1, detail)
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute
  let maxR = 0
  for (let i = 0; i < pos.count; i++) {
    _d.fromBufferAttribute(pos, i).normalize()
    let R = unionDistance(_d, spheres)
    R *= 1 + amp * craggy(_d, ph, fr)
    pos.setXYZ(i, _d.x * R, _d.y * R, _d.z * R)
    if (R > maxR) maxR = R
  }
  pos.needsUpdate = true
  geometry.computeVertexNormals()

  let boundingRadius = maxR
  for (const s of spheres) boundingRadius = Math.max(boundingRadius, s.center.length() + s.radius)
  return { geometry, spheres, boundingRadius }
}

// --- field ----------------------------------------------------------------
const ROCK_MATERIALS = [
  new THREE.MeshStandardMaterial({ color: 0x8a8f9a, flatShading: true, roughness: 0.95 }),
  new THREE.MeshStandardMaterial({ color: 0x7a7068, flatShading: true, roughness: 0.95 }),
  new THREE.MeshStandardMaterial({ color: 0x6b7686, flatShading: true, roughness: 0.95 }),
]
const DEBUG_SPHERE_GEO = new THREE.IcosahedronGeometry(1, 1)
const DEBUG_MAT = new THREE.MeshBasicMaterial({
  color: 0x33ff88,
  wireframe: true,
  transparent: true,
  opacity: 0.6,
  depthTest: false,
})
const MAX_DEBUG_SPHERES = 3

interface Asteroid {
  mesh: THREE.Mesh
  debug: THREE.Group
  debugSpheres: THREE.Mesh[]
  shape: AsteroidShape
  scale: number
  spinAxis: THREE.Vector3
  spinRate: number
  drift: THREE.Vector3
}

export class AsteroidField {
  readonly group = new THREE.Group()
  cfg: AsteroidFieldConfig

  private readonly library: AsteroidShape[]
  private readonly pool: Asteroid[] = []
  private debugEnabled = false

  private readonly _q = new THREE.Quaternion()
  private readonly _tmp = new THREE.Vector3()
  private readonly _rel = new THREE.Vector3()
  private readonly _shipPos = new THREE.Vector3()
  private readonly _forward = new THREE.Vector3(0, 0, -1)

  constructor(cfg: AsteroidFieldConfig = DEFAULT_FIELD, librarySize = 24, maxPool = 200) {
    this.cfg = { ...cfg }
    this.group.name = 'asteroid-field'
    this.library = Array.from({ length: librarySize }, () => generateShape(2))
    for (let i = 0; i < maxPool; i++) this.pool.push(this.createAsteroid())
  }

  private createAsteroid(): Asteroid {
    const mesh = new THREE.Mesh(this.library[0].geometry, ROCK_MATERIALS[0])
    mesh.visible = false

    const debug = new THREE.Group()
    debug.visible = false
    const debugSpheres: THREE.Mesh[] = []
    for (let i = 0; i < MAX_DEBUG_SPHERES; i++) {
      const ds = new THREE.Mesh(DEBUG_SPHERE_GEO, DEBUG_MAT)
      ds.visible = false
      debug.add(ds)
      debugSpheres.push(ds)
    }
    mesh.add(debug)
    this.group.add(mesh)

    return {
      mesh,
      debug,
      debugSpheres,
      shape: this.library[0],
      scale: 1,
      spinAxis: new THREE.Vector3(0, 1, 0),
      spinRate: 0,
      drift: new THREE.Vector3(),
    }
  }

  /** Scatter the initial field around the ship (some all-around, some ahead). */
  init(shipPos: THREE.Vector3, forward: THREE.Vector3): void {
    this._shipPos.copy(shipPos)
    this._forward.copy(forward)
    for (let i = 0; i < this.pool.length; i++) {
      if (i < this.cfg.count) this.spawn(this.pool[i], true)
      else this.pool[i].mesh.visible = false
    }
  }

  setDebug(on: boolean): void {
    this.debugEnabled = on
    for (let i = 0; i < this.cfg.count; i++) this.pool[i].debug.visible = on
  }
  toggleDebug(): boolean {
    this.setDebug(!this.debugEnabled)
    return this.debugEnabled
  }

  /** Live density control (uses the last ship pos/forward from update/init). */
  setCount(n: number): void {
    n = Math.max(0, Math.min(n | 0, this.pool.length))
    if (n > this.cfg.count) {
      for (let i = this.cfg.count; i < n; i++) this.spawn(this.pool[i], false)
    } else {
      for (let i = n; i < this.cfg.count; i++) {
        this.pool[i].mesh.visible = false
        this.pool[i].debug.visible = false
      }
    }
    this.cfg.count = n
  }

  private configureDebug(a: Asteroid): void {
    for (let i = 0; i < MAX_DEBUG_SPHERES; i++) {
      const ds = a.debugSpheres[i]
      const s = a.shape.spheres[i]
      if (s) {
        ds.visible = true
        ds.position.copy(s.center)
        ds.scale.setScalar(s.radius)
      } else {
        ds.visible = false
      }
    }
    a.debug.visible = this.debugEnabled
  }

  private spawn(a: Asteroid, initial: boolean): void {
    const c = this.cfg

    const shape = this.library[(Math.random() * this.library.length) | 0]
    a.shape = shape
    a.mesh.geometry = shape.geometry
    a.mesh.material = ROCK_MATERIALS[(Math.random() * ROCK_MATERIALS.length) | 0]
    a.scale = rand(c.minScale, c.maxScale)
    a.mesh.scale.setScalar(a.scale)

    // Spawn direction: forward-biased; the initial fill is partly all-around so
    // there's no empty cone behind you at the start.
    randomUnit(this._tmp)
    if (!(initial && Math.random() < 0.5)) {
      this._tmp.addScaledVector(this._forward, c.forwardBias).normalize()
    }
    const dist = initial ? rand(c.spawnNear, c.despawnFar) : rand(c.spawnNear, c.spawnFar)
    a.mesh.position.copy(this._shipPos).addScaledVector(this._tmp, dist)

    // Random orientation, tumble, and slow drift.
    randomUnit(this._tmp)
    a.mesh.quaternion.setFromAxisAngle(this._tmp, Math.random() * Math.PI * 2)
    randomUnit(a.spinAxis)
    a.spinRate = rand(-0.8, 0.8)
    randomUnit(a.drift).multiplyScalar(rand(0, 3))

    a.mesh.visible = true
    this.configureDebug(a)
  }

  update(dt: number, shipPos: THREE.Vector3, forward: THREE.Vector3): void {
    this._shipPos.copy(shipPos)
    this._forward.copy(forward)
    const despawnSq = this.cfg.despawnFar * this.cfg.despawnFar

    for (let i = 0; i < this.cfg.count; i++) {
      const a = this.pool[i]
      // Tumble.
      this._q.setFromAxisAngle(a.spinAxis, a.spinRate * dt)
      a.mesh.quaternion.multiply(this._q)
      // Drift.
      a.mesh.position.addScaledVector(a.drift, dt)
      // Recycle when it falls outside the bubble around the ship.
      this._rel.copy(a.mesh.position).sub(shipPos)
      if (this._rel.lengthSq() > despawnSq) this.spawn(a, false)
    }
  }
}
