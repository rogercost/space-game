import * as THREE from 'three'

// A camera-facing ribbon built from emitted exhaust samples. Each sample inherits
// the ship's velocity, gets an additional push along the nozzle's aft direction,
// and then coasts in world space. Unlike a breadcrumb trail of ship positions, this
// guarantees that the plume leaves the engine backwards even when the ship is
// drifting sideways. Changes in heading naturally bend the older samples into a
// curve. The fixed pool and dynamic buffers keep the per-frame path allocation-free.

const MAX = 30 // centerline points, including the live nozzle anchor
const EMIT_INTERVAL = 1 / 24 // seconds between samples; ~1.2 s of history makes turns legible
const EXHAUST_SPEED = 4 // lower speed preserves that history without lengthening the plume
const DEFAULT_HEAD_WIDTH = 0.12 // ribbon half-width at the nozzle
const TAIL_WIDTH = 0 // taper all the way to a point
const BRIGHTNESS = 0.55 // peak additive intensity before the age/camera fades
const EXHAUST_GRAY = 0.65 // neutral linear-RGB target after the initial orange heat
const COLOR_TRANSITION_SAMPLES = 10
// Fade the trail out as it nears the camera. The chase cam sits behind the ship, so
// the oldest samples sweep close to the lens and would otherwise blow up into a bright
// slab under perspective; fading by camera distance kills that regardless of length.
const CAM_FADE_NEAR = 2.2 // fully invisible within this distance of the camera
const CAM_FADE_FAR = 4.2 // full brightness beyond this

export class Trail {
  readonly mesh: THREE.Mesh

  private readonly pts: THREE.Vector3[]
  private readonly velocities: THREE.Vector3[]
  private particleCount = 0
  private emitRemainder = 0
  private initialized = false
  private readonly headWidth: number
  private readonly pos: Float32Array
  private readonly col: Float32Array
  private readonly geom: THREE.BufferGeometry
  private readonly positionAttr: THREE.BufferAttribute
  private readonly colorAttr: THREE.BufferAttribute

  private readonly _previousHead = new THREE.Vector3()
  private readonly _previousAft = new THREE.Vector3(0, 0, 1)
  private readonly _previousVelocity = new THREE.Vector3()
  private readonly _emitPos = new THREE.Vector3()
  private readonly _emitDir = new THREE.Vector3()
  private readonly _emitVelocity = new THREE.Vector3()

  private readonly _seg = new THREE.Vector3()
  private readonly _view = new THREE.Vector3()
  private readonly _side = new THREE.Vector3()

  constructor(headWidth = DEFAULT_HEAD_WIDTH) {
    this.headWidth = headWidth
    this.pts = Array.from({ length: MAX }, () => new THREE.Vector3())
    this.velocities = Array.from({ length: MAX }, () => new THREE.Vector3())
    this.pos = new Float32Array(MAX * 2 * 3)
    this.col = new Float32Array(MAX * 2 * 3)

    this.geom = new THREE.BufferGeometry()
    this.positionAttr = new THREE.BufferAttribute(this.pos, 3)
    this.positionAttr.setUsage(THREE.DynamicDrawUsage)
    this.colorAttr = new THREE.BufferAttribute(this.col, 3)
    this.colorAttr.setUsage(THREE.DynamicDrawUsage)
    this.geom.setAttribute('position', this.positionAttr)
    this.geom.setAttribute('color', this.colorAttr)
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

  /** Clear all emitted samples and seed the source state for a fresh launch. */
  reset(
    head: THREE.Vector3,
    aft: THREE.Vector3,
    sourceVelocity: THREE.Vector3,
  ): void {
    for (const p of this.pts) p.copy(head)
    for (const v of this.velocities) v.copy(sourceVelocity)
    this._previousHead.copy(head)
    this._previousAft.copy(aft).normalize()
    this._previousVelocity.copy(sourceVelocity)
    this.particleCount = 0
    this.emitRemainder = 0
    this.initialized = true
    this.geom.setDrawRange(0, 0)
  }

  /**
   * Advance existing exhaust and emit new samples between the previous and current
   * nozzle transforms. `aft` is the nozzle's world-space +Z direction.
   */
  update(
    dt: number,
    head: THREE.Vector3,
    aft: THREE.Vector3,
    sourceVelocity: THREE.Vector3,
    camPos: THREE.Vector3,
  ): void {
    if (!this.initialized) this.reset(head, aft, sourceVelocity)

    // Already-emitted exhaust is ballistic: its velocity no longer follows the ship.
    for (let i = 1; i <= this.particleCount; i++) {
      this.pts[i].addScaledVector(this.velocities[i], dt)
    }

    if (dt > 0) {
      // Emit at a fixed cadence. Interpolating the source state within this frame
      // avoids clumping at low frame rates, and advancing each new sample for the
      // rest of the frame puts every point at the same simulation time.
      for (
        let emitAt = EMIT_INTERVAL - this.emitRemainder;
        emitAt <= dt + 1e-8;
        emitAt += EMIT_INTERVAL
      ) {
        this.emit(head, aft, sourceVelocity, emitAt / dt, dt - emitAt)
      }
      this.emitRemainder = (this.emitRemainder + dt) % EMIT_INTERVAL
    }

    this.pts[0].copy(head)
    this._previousHead.copy(head)
    this._previousAft.copy(aft).normalize()
    this._previousVelocity.copy(sourceVelocity)
    this.rebuild(camPos)
  }

  /** Insert one ballistic exhaust sample, dropping the oldest when the pool is full. */
  private emit(
    head: THREE.Vector3,
    aft: THREE.Vector3,
    sourceVelocity: THREE.Vector3,
    alpha: number,
    remainingDt: number,
  ): void {
    const nextCount = Math.min(this.particleCount + 1, MAX - 1)
    for (let i = nextCount; i >= 2; i--) {
      this.pts[i].copy(this.pts[i - 1])
      this.velocities[i].copy(this.velocities[i - 1])
    }

    this._emitPos.lerpVectors(this._previousHead, head, alpha)
    this._emitDir.lerpVectors(this._previousAft, aft, alpha)
    if (this._emitDir.lengthSq() > 1e-8) this._emitDir.normalize()
    else this._emitDir.copy(aft).normalize()
    this._emitVelocity
      .lerpVectors(this._previousVelocity, sourceVelocity, alpha)
      .addScaledVector(this._emitDir, EXHAUST_SPEED)

    this.pts[1].copy(this._emitPos).addScaledVector(this._emitVelocity, remainingDt)
    this.velocities[1].copy(this._emitVelocity)
    this.particleCount = nextCount
  }

  /** Recompute the ribbon rim vertices + fade, billboarded toward the camera. */
  private rebuild(camPos: THREE.Vector3): void {
    const n = this.particleCount + 1
    if (n < 2) {
      this.geom.setDrawRange(0, 0)
      return
    }
    const headCamDist = Math.max(this.pts[0].distanceTo(camPos), 1e-5)
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

      const f = i / (n - 1) // 0 at head, 1 at tail
      // Compensate for the tail moving toward the chase camera: projected width is
      // roughly world width / camera distance. Scaling by the distance ratio makes
      // this taper describe the silhouette the player sees, not just world geometry.
      const taper = Math.pow(1 - f, 1.3)
      const perspectiveScale = camDist / headCamDist
      const w = (TAIL_WIDTH + (this.headWidth - TAIL_WIDTH) * taper) * perspectiveScale
      const camFade = Math.min(
        1,
        Math.max(0, (camDist - CAM_FADE_NEAR) / (CAM_FADE_FAR - CAM_FADE_NEAR)),
      )
      // Ease brightness in across the first two samples so the additive ribbon does
      // not paint over the orange engine interior, then fade it out by age. The
      // near plume cools gradually from engine orange to a subdued neutral gray.
      const ignition = Math.min(1, i / 2)
      const c = ignition * Math.pow(1 - f, 1.2) * BRIGHTNESS * camFade
      const cool = Math.min(1, i / COLOR_TRANSITION_SAMPLES)
      const red = 1 + (EXHAUST_GRAY - 1) * cool
      const green = 0.32 + (EXHAUST_GRAY - 0.32) * cool
      const blue = 0.06 + (EXHAUST_GRAY - 0.06) * cool
      const o = i * 6
      this.pos[o] = p.x + this._side.x * w
      this.pos[o + 1] = p.y + this._side.y * w
      this.pos[o + 2] = p.z + this._side.z * w
      this.pos[o + 3] = p.x - this._side.x * w
      this.pos[o + 4] = p.y - this._side.y * w
      this.pos[o + 5] = p.z - this._side.z * w
      this.col[o] = this.col[o + 3] = c * red
      this.col[o + 1] = this.col[o + 4] = c * green
      this.col[o + 2] = this.col[o + 5] = c * blue
    }
    this.positionAttr.needsUpdate = true
    this.colorAttr.needsUpdate = true
    this.geom.setDrawRange(0, (n - 1) * 6)
  }
}
