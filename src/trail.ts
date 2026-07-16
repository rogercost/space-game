import * as THREE from 'three'

// A camera-facing ribbon that follows the ship's recent path. Samples are kept
// roughly SEG_LEN apart so the trail is a fixed world-length regardless of frame
// rate; it tapers to a point and fades to nothing at the tail. Rendered additive
// so the white ribbon reads as a glow and its faded tail simply vanishes rather
// than painting dark quads over the field behind it. Allocation-free per frame.

const MAX = 30 // sample points (ribbon has MAX*2 rim vertices)
const SEG_LEN = 0.15 // world distance between successive samples (shorter total = faster fade)
const HEAD_WIDTH = 0.022 // ribbon half-width at the ship (~1/8 the engine-opening diameter)
const TAIL_WIDTH = 0.0 // half-width at the oldest sample
const BRIGHTNESS = 0.25 // head brightness (additive white); fades to 0 at the tail
// Fade the trail out as it nears the camera. The chase cam sits behind the ship, so
// the oldest samples sweep close to the lens and would otherwise blow up into a bright
// slab under perspective; fading by camera distance kills that regardless of length.
const CAM_FADE_NEAR = 2.2 // fully invisible within this distance of the camera
const CAM_FADE_FAR = 4.2 // full brightness beyond this

export class Trail {
  readonly mesh: THREE.Mesh

  private readonly pts: THREE.Vector3[]
  private count = 0
  private readonly pos: Float32Array
  private readonly col: Float32Array
  private readonly geom: THREE.BufferGeometry

  private readonly _seg = new THREE.Vector3()
  private readonly _view = new THREE.Vector3()
  private readonly _side = new THREE.Vector3()

  constructor() {
    this.pts = Array.from({ length: MAX }, () => new THREE.Vector3())
    this.pos = new Float32Array(MAX * 2 * 3)
    this.col = new Float32Array(MAX * 2 * 3)

    this.geom = new THREE.BufferGeometry()
    this.geom.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    this.geom.setAttribute('color', new THREE.BufferAttribute(this.col, 3))
    const index: number[] = []
    for (let i = 0; i < MAX - 1; i++) {
      const a = i * 2
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    this.geom.setIndex(index)
    this.geom.setDrawRange(0, 0)

    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    })
    this.mesh = new THREE.Mesh(this.geom, mat)
    this.mesh.frustumCulled = false
    this.mesh.name = 'trail'
  }

  /** Collapse the whole trail onto a single point (zero length) — call at (re)launch. */
  reset(head: THREE.Vector3): void {
    for (const p of this.pts) p.copy(head)
    this.count = 2
    this.geom.setDrawRange(0, 0)
  }

  /** Advance the trail: the head tracks `head`; a new fixed sample drops every SEG_LEN. */
  update(head: THREE.Vector3, camPos: THREE.Vector3): void {
    if (this.count < 2) this.reset(head)
    this.pts[0].copy(head)
    if (this.pts[0].distanceToSquared(this.pts[1]) >= SEG_LEN * SEG_LEN) {
      for (let i = Math.min(this.count, MAX - 1); i >= 2; i--) this.pts[i].copy(this.pts[i - 1])
      this.pts[1].copy(this.pts[0])
      if (this.count < MAX) this.count++
    }
    this.rebuild(camPos)
  }

  /** Recompute the ribbon rim vertices + fade, billboarded toward the camera. */
  private rebuild(camPos: THREE.Vector3): void {
    const n = this.count
    for (let i = 0; i < n; i++) {
      const p = this.pts[i]
      const ahead = this.pts[Math.max(0, i - 1)]
      const behind = this.pts[Math.min(n - 1, i + 1)]
      // Ribbon offset = (tangent × view), so the strip always faces the camera.
      this._seg.subVectors(ahead, behind)
      this._view.subVectors(p, camPos)
      const camDist = this._view.length()
      this._side.crossVectors(this._seg, this._view)
      const len = this._side.length()
      if (len > 1e-5) this._side.multiplyScalar(1 / len)
      else this._side.set(1, 0, 0)

      const f = n > 1 ? i / (n - 1) : 0 // 0 at head, 1 at tail
      const w = HEAD_WIDTH + (TAIL_WIDTH - HEAD_WIDTH) * f
      const camFade = Math.min(1, Math.max(0, (camDist - CAM_FADE_NEAR) / (CAM_FADE_FAR - CAM_FADE_NEAR)))
      // white at head, fading to black (invisible under additive) at the tail and near the camera
      const c = (1 - f) * BRIGHTNESS * camFade
      const o = i * 6
      this.pos[o] = p.x + this._side.x * w
      this.pos[o + 1] = p.y + this._side.y * w
      this.pos[o + 2] = p.z + this._side.z * w
      this.pos[o + 3] = p.x - this._side.x * w
      this.pos[o + 4] = p.y - this._side.y * w
      this.pos[o + 5] = p.z - this._side.z * w
      this.col[o] = this.col[o + 1] = this.col[o + 2] = c
      this.col[o + 3] = this.col[o + 4] = this.col[o + 5] = c
    }
    ;(this.geom.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    ;(this.geom.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true
    this.geom.setDrawRange(0, (n - 1) * 6)
  }
}
