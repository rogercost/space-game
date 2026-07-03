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
  /** "Normal" asteroid scale range (the common, smaller rocks). */
  minScale: number
  maxScale: number
  /** Chance an asteroid is an oversized "giant" instead of a normal rock. */
  giantChance: number
  /** Giant asteroid scale range. */
  giantMinScale: number
  giantMaxScale: number
  /** Max tumble spin rate (rad/sec); each rock gets a random rate up to this. */
  maxSpin: number
  /** Max lateral drift speed (units/sec); each rock gets a random speed up to this. */
  maxDrift: number
}

export const DEFAULT_FIELD: AsteroidFieldConfig = {
  count: 160,
  spawnNear: 500,
  spawnFar: 1100,
  despawnFar: 1200,
  forwardBias: 1.4,
  minScale: 3.5,
  maxScale: 15,
  giantChance: 0.06,
  giantMinScale: 20,
  giantMaxScale: 40,
  maxSpin: 1.6,
  maxDrift: 6,
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

/** Blend radius for the smooth union (in unit-scale space). */
const BLEND = 0.3

/** Polynomial smooth-min (iq): blends two distances with a rounded seam. */
function smin(a: number, b: number, k: number): number {
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k))
  return b * (1 - h) + a * h - k * h * (1 - h)
}

/** Smooth-union signed distance from point (px,py,pz) to the sphere set. */
function unionSdf(px: number, py: number, pz: number, spheres: SphereDef[], k: number): number {
  let d = 0
  for (let i = 0; i < spheres.length; i++) {
    const c = spheres[i].center
    const dx = px - c.x
    const dy = py - c.y
    const dz = pz - c.z
    const di = Math.sqrt(dx * dx + dy * dy + dz * dz) - spheres[i].radius
    d = i === 0 ? di : smin(d, di, k)
  }
  return d
}

// --- surface meshing (marching tetrahedra over the smooth-union field) -----
//
// A single-origin radial reconstruction can't represent an offset lobe: from the
// center that lobe only subtends a narrow cone, so it collapses into a
// "mushroom" (a cap on a near-cylindrical stem). Instead we extract the
// isosurface of the smooth-union SDF directly. Marching tetrahedra needs no
// 256-entry table; each cube is split into 5 tets, alternating the split per
// cube (by (x+y+z) parity) so neighbouring cubes share face diagonals and the
// mesh stays watertight.

// Cube corner c has offsets (c&1, (c>>1)&1, (c>>2)&1).
const CORNER_DX = [0, 1, 0, 1, 0, 1, 0, 1]
const CORNER_DY = [0, 0, 1, 1, 0, 0, 1, 1]
const CORNER_DZ = [0, 0, 0, 0, 1, 1, 1, 1]

// Two complementary 5-tetrahedra splits of a cube (each tet = 4 corner ids).
const TETS_A: number[][] = [
  [0, 3, 5, 6],
  [1, 0, 3, 5],
  [2, 0, 3, 6],
  [4, 0, 5, 6],
  [7, 3, 5, 6],
]
const TETS_B: number[][] = [
  [1, 2, 4, 7],
  [0, 1, 2, 4],
  [3, 1, 2, 7],
  [5, 1, 4, 7],
  [6, 2, 4, 7],
]

// Scratch buffers reused across every cube (meshing runs at startup only).
const _px = new Float32Array(8)
const _py = new Float32Array(8)
const _pz = new Float32Array(8)
const _val = new Float32Array(8)
const _ins = [0, 0, 0, 0]
const _outs = [0, 0, 0, 0]

/**
 * Build an isotropic value-noise function for one shape: a sum of sine waves
 * along RANDOM 3-D directions (not the coordinate axes). Axis-aligned sines
 * paint visible latitude/longitude "rings" on round rocks; random directions
 * overlap into organic bumpiness instead. Returns values in ~[-1, 1].
 */
function makeNoise(octaves = 5): (x: number, y: number, z: number) => number {
  const dx: number[] = []
  const dy: number[] = []
  const dz: number[] = []
  const freq: number[] = []
  const phase: number[] = []
  const amp: number[] = []
  let ampSum = 0
  const dir = new THREE.Vector3()
  for (let k = 0; k < octaves; k++) {
    randomUnit(dir)
    const f = rand(2.5, 6)
    dx.push(dir.x)
    dy.push(dir.y)
    dz.push(dir.z)
    freq.push(f)
    phase.push(rand(0, 6.283))
    const a = 1 / f // taper high frequencies for a natural, fractal-ish surface
    amp.push(a)
    ampSum += a
  }
  return (x, y, z) => {
    let s = 0
    for (let k = 0; k < octaves; k++) {
      s += amp[k] * Math.sin((dx[k] * x + dy[k] * y + dz[k] * z) * freq[k] + phase[k])
    }
    return s / ampSum
  }
}

/** Iso=0 crossing point between corners a and b, as [x, y, z]. */
function crossing(a: number, b: number): [number, number, number] {
  const t = _val[a] / (_val[a] - _val[b])
  return [
    _px[a] + t * (_px[b] - _px[a]),
    _py[a] + t * (_py[b] - _py[a]),
    _pz[a] + t * (_pz[b] - _pz[a]),
  ]
}

function pushTri(
  out: number[],
  p: [number, number, number],
  q: [number, number, number],
  r: [number, number, number],
): void {
  out.push(p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2])
}

/** Emit the isosurface triangle(s) for one tetrahedron (winding fixed later). */
function emitTet(tet: number[], out: number[]): void {
  let ni = 0
  let no = 0
  for (let j = 0; j < 4; j++) {
    const c = tet[j]
    if (_val[c] < 0) _ins[ni++] = c
    else _outs[no++] = c
  }
  if (ni === 0 || ni === 4) return
  if (ni === 1) {
    pushTri(out, crossing(_ins[0], _outs[0]), crossing(_ins[0], _outs[1]), crossing(_ins[0], _outs[2]))
  } else if (ni === 3) {
    pushTri(out, crossing(_outs[0], _ins[0]), crossing(_outs[0], _ins[1]), crossing(_outs[0], _ins[2]))
  } else {
    const a = _ins[0]
    const b = _ins[1]
    const c = _outs[0]
    const d = _outs[1]
    const pac = crossing(a, c)
    const pad = crossing(a, d)
    const pbd = crossing(b, d)
    const pbc = crossing(b, c)
    pushTri(out, pac, pad, pbd)
    pushTri(out, pac, pbd, pbc)
  }
}

/** Extract the iso=0 surface of a sampled (res+1)^3 field into `out` positions. */
function marchingTets(
  grid: Float32Array,
  res: number,
  minCoord: number,
  cell: number,
  out: number[],
): void {
  const N = res + 1
  for (let z = 0; z < res; z++) {
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        for (let c = 0; c < 8; c++) {
          const gx = x + CORNER_DX[c]
          const gy = y + CORNER_DY[c]
          const gz = z + CORNER_DZ[c]
          _px[c] = minCoord + gx * cell
          _py[c] = minCoord + gy * cell
          _pz[c] = minCoord + gz * cell
          _val[c] = grid[gx + N * (gy + N * gz)]
        }
        const tets = ((x + y + z) & 1) === 0 ? TETS_A : TETS_B
        for (let t = 0; t < 5; t++) emitTet(tets[t], out)
      }
    }
  }
}

/** Flip triangle winding so every face normal points outward (along +gradient). */
function orientOutward(
  positions: Float32Array,
  fieldFn: (x: number, y: number, z: number) => number,
  eps: number,
): void {
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i], ay = positions[i + 1], az = positions[i + 2]
    const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5]
    const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8]
    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay)
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    const mx = (ax + bx + cx) / 3
    const my = (ay + by + cy) / 3
    const mz = (az + bz + cz) / 3
    const g0 = fieldFn(mx + eps, my, mz) - fieldFn(mx - eps, my, mz)
    const g1 = fieldFn(mx, my + eps, mz) - fieldFn(mx, my - eps, mz)
    const g2 = fieldFn(mx, my, mz + eps) - fieldFn(mx, my, mz - eps)
    if (nx * g0 + ny * g1 + nz * g2 < 0) {
      positions[i + 3] = cx; positions[i + 4] = cy; positions[i + 5] = cz
      positions[i + 6] = bx; positions[i + 7] = by; positions[i + 8] = bz
    }
  }
}

function pickSphereCount(): number {
  const r = Math.random()
  return r < 0.4 ? 1 : r < 0.8 ? 2 : 3 // round / peanut / clover
}

/**
 * Generate one asteroid shape at unit base scale. The 1–3 spheres are the source
 * of truth; the mesh is the iso-0 surface of their smooth union (plus noise),
 * extracted by marching tetrahedra so offset lobes stay fully rounded.
 */
export function generateShape(res = 22): AsteroidShape {
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

  const amp = rand(0.06, 0.12)
  const noiseAt = makeNoise()

  // Field whose iso-0 surface is the rock: smooth-union SDF minus surface noise.
  const field = (px: number, py: number, pz: number): number =>
    unionSdf(px, py, pz, spheres, BLEND) - amp * noiseAt(px, py, pz)

  // A box that comfortably encloses the surface so the mesh stays closed.
  let extent = 0
  for (const s of spheres) extent = Math.max(extent, s.center.length() + s.radius)
  const B = (extent + BLEND + amp) * 1.15
  const cell = (2 * B) / res
  const N = res + 1

  // Sample the field on the grid.
  const grid = new Float32Array(N * N * N)
  let gi = 0
  for (let z = 0; z < N; z++) {
    const pz = -B + z * cell
    for (let y = 0; y < N; y++) {
      const py = -B + y * cell
      for (let x = 0; x < N; x++) grid[gi++] = field(-B + x * cell, py, pz)
    }
  }

  // Extract the surface, orient faces outward, and build the geometry.
  const tris: number[] = []
  marchingTets(grid, res, -B, cell, tris)
  const positions = new Float32Array(tris)
  orientOutward(positions, field, cell * 0.25)

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.computeVertexNormals()

  let boundingRadius = 0
  for (let v = 0; v < positions.length; v += 3) {
    const r = Math.hypot(positions[v], positions[v + 1], positions[v + 2])
    if (r > boundingRadius) boundingRadius = r
  }
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

/** Colliders sit slightly inside the visual surface so grazes favor the player. */
const COLLIDER_INSET = 0.9

/** A collision between the ship sphere and an asteroid collider sub-sphere. */
export interface CollisionHit {
  /** Unit push-out direction, from the asteroid lump toward the ship. */
  normal: THREE.Vector3
  /** Overlap depth in world units. */
  penetration: number
}

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
  private readonly _sub = new THREE.Vector3()
  private readonly _hit: CollisionHit = { normal: new THREE.Vector3(), penetration: 0 }

  constructor(cfg: AsteroidFieldConfig = DEFAULT_FIELD, librarySize = 24, maxPool = 400) {
    this.cfg = { ...cfg }
    this.group.name = 'asteroid-field'
    this.library = Array.from({ length: librarySize }, () => generateShape())
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
        ds.scale.setScalar(s.radius * COLLIDER_INSET)
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
    a.scale =
      Math.random() < c.giantChance
        ? rand(c.giantMinScale, c.giantMaxScale)
        : rand(c.minScale, c.maxScale)
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
    a.spinRate = rand(-c.maxSpin, c.maxSpin)
    randomUnit(a.drift).multiplyScalar(rand(0, c.maxDrift))

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

  /**
   * Two-phase collision: broadphase against each asteroid's bounding sphere,
   * then narrowphase against its 1–3 collider sub-spheres. Returns the deepest
   * penetrating hit, or null. The returned object is reused between calls.
   */
  collide(shipPos: THREE.Vector3, shipRadius: number): CollisionHit | null {
    let bestPen = 0
    let found = false
    for (let i = 0; i < this.cfg.count; i++) {
      const a = this.pool[i]
      // Broadphase: ship sphere vs asteroid bounding sphere.
      this._rel.copy(a.mesh.position).sub(shipPos)
      const reach = a.shape.boundingRadius * a.scale + shipRadius
      if (this._rel.lengthSq() > reach * reach) continue
      // Narrowphase: ship sphere vs each collider sub-sphere.
      for (const s of a.shape.spheres) {
        this._sub
          .copy(s.center)
          .multiplyScalar(a.scale)
          .applyQuaternion(a.mesh.quaternion)
          .add(a.mesh.position)
        const subR = s.radius * a.scale * COLLIDER_INSET
        const dx = shipPos.x - this._sub.x
        const dy = shipPos.y - this._sub.y
        const dz = shipPos.z - this._sub.z
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        const pen = subR + shipRadius - dist
        if (pen > 0 && pen > bestPen) {
          bestPen = pen
          found = true
          if (dist > 1e-4) this._hit.normal.set(dx / dist, dy / dist, dz / dist)
          else this._hit.normal.set(0, 1, 0)
        }
      }
    }
    if (!found) return null
    this._hit.penetration = bestPen
    return this._hit
  }
}
