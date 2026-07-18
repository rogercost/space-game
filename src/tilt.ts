import * as THREE from 'three'
import type { Pointer } from './input'

// EXPERIMENTAL — tilt steering, attempt 3.
//
// Roll comes from the gravity vector, measured in a tangent frame anchored at
// the *calibrated* gravity direction, so it responds to both wheel-style
// rolling (about the screen normal) and tray-style rolling (about the screen's
// vertical axis). Pitch is the true rotation of the device about the screen's
// x-axis since calibration, read from RelativeOrientationSensor (gyro-fused):
// a pure roll has no such component, which kills the roll→pitch crosstalk that
// sank attempts 1 (deviceorientation beta/gamma) and 2 (gravity-only angles).
// Without that sensor, pitch falls back to the same gravity tangent frame.
//
// Gravity itself prefers the Generic Sensor API's GravitySensor (linear
// acceleration already removed by fusion) over low-passed devicemotion
// accelerationIncludingGravity. Calibration is stability-gated: the center is
// captured only once the gravity estimate settles, because the tap on the tilt
// button itself shakes the phone.
//
// REMOVAL: if tilt steering is abandoned, delete this file, the tilt members
// of SteeringInput in input.ts, the T-key / ↔-button wiring in main.ts and
// ui.ts, and the `tilt` line of the debug stats panel.

const DEG_TO_RAD = Math.PI / 180
/** Radians of tilt from the calibrated center for full steering deflection. */
const TILT_RANGE = 25 * DEG_TO_RAD
const TILT_DEADZONE = 2 * DEG_TO_RAD
const SENSOR_FREQUENCY = 60
/** Low-pass response for devicemotion (hand jitter + steering acceleration). */
const MOTION_FILTER_RESPONSE = 12
/** Lighter touch for GravitySensor — fusion already removed linear acceleration. */
const GRAVITY_FILTER_RESPONSE = 30
/**
 * Calibration gate: capture the center only once gravity has moved slower than
 * this rate for CALIBRATION_STABLE_TIME — the button tap itself shakes the
 * phone — but never wait longer than CALIBRATION_TIMEOUT.
 */
const CALIBRATION_MAX_RATE = 8 * DEG_TO_RAD // rad/sec
const CALIBRATION_STABLE_TIME = 0.25 // seconds
const CALIBRATION_TIMEOUT = 1.5 // seconds
/** Readings weaker than this (m/s²) are freefall or garbage — unusable. */
const MIN_GRAVITY = 1
/**
 * |screen-x component| of unit gravity above which the phone is edge-on and
 * the tangent frame degenerates; calibration waits for a normal grip instead.
 */
const MAX_EDGE_ALIGNMENT = 0.98

type MotionPermission = 'granted' | 'denied'
type MotionConstructor = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<MotionPermission>
}

/** Minimal Generic Sensor API surface (not yet in TypeScript's DOM lib). */
interface GenericSensor extends EventTarget {
  start(): void
  stop(): void
}
interface GravitySensorLike extends GenericSensor {
  x?: number | null
  y?: number | null
  z?: number | null
  timestamp?: number | null
}
interface OrientationSensorLike extends GenericSensor {
  quaternion?: [number, number, number, number] | null
}
interface SensorWindow {
  GravitySensor?: new (options?: { frequency?: number }) => GravitySensorLike
  RelativeOrientationSensor?: new (options?: { frequency?: number }) => OrientationSensorLike
}

/**
 * Self-contained tilt-steering source. `value` mirrors the Pointer contract of
 * mouse/touch steering (-1..1 per axis) and stays {0,0} until calibrated.
 */
export class TiltSteering {
  readonly value: Pointer = { x: 0, y: 0 }
  readonly supported: boolean

  private _active = false
  private pending = false

  // Sensor plumbing. Gravity comes from exactly one of GravitySensor /
  // devicemotion; the orientation sensor is an optional pitch upgrade.
  private gravitySensor: GravitySensorLike | null = null
  private orientationSensor: OrientationSensorLike | null = null
  private motionActive = false
  private hasQuat = false
  private readonly latestQuat = new THREE.Quaternion()

  // Filtered gravity estimate, device coordinates (m/s²).
  private gx = 0
  private gy = 0
  private gz = 0
  private filterReady = false
  private lastSampleTime: number | null = null

  // Calibration gate + the captured frame (screen coordinates, unit vectors).
  private calibrated = false
  private calQuatValid = false
  private stableTime = 0
  private waitTime = 0
  private centerAngle = 0
  private readonly g0 = new THREE.Vector3()
  private readonly rollTangent = new THREE.Vector3()
  private readonly pitchTangent = new THREE.Vector3()
  private readonly calQuatInv = new THREE.Quaternion()

  /** Latest unit gravity in screen coordinates (for steering + the debug line). */
  private readonly _g = new THREE.Vector3()
  private readonly _q = new THREE.Quaternion()
  private readonly _rv = new THREE.Vector3()

  constructor() {
    const w = window as unknown as SensorWindow
    this.supported =
      window.isSecureContext &&
      window.matchMedia('(hover: none) and (pointer: coarse)').matches &&
      (typeof w.GravitySensor === 'function' || typeof DeviceMotionEvent !== 'undefined')
  }

  get active(): boolean {
    return this._active
  }

  /** One-line sensor/calibration state for the debug stats panel. */
  get debug(): string {
    if (!this._active) return 'off'
    const src = (this.gravitySensor ? 'grv' : 'mot') + (this.orientationSensor ? '+rot' : '')
    if (!this.calibrated) return `${src} calibrating ${this.waitTime.toFixed(1)}s`
    return (
      `${src} g ${fmt(this._g.x)} ${fmt(this._g.y)} ${fmt(this._g.z)}` +
      ` out ${fmt(this.value.x)} ${fmt(this.value.y)}`
    )
  }

  async toggle(): Promise<boolean> {
    if (!this.supported || this.pending) return this._active
    if (this._active) {
      this.disable()
      return false
    }
    this.pending = true
    try {
      this.resetCalibration()
      if (!this.startGravitySensor() && !(await this.startDeviceMotion())) return false
      this.startOrientationSensor()
      this._active = true
      return true
    } finally {
      this.pending = false
    }
  }

  private disable(): void {
    this._active = false
    this.stopSensors()
    this.resetCalibration()
  }

  private stopSensors(): void {
    if (this.gravitySensor) {
      this.gravitySensor.stop()
      this.gravitySensor = null
    }
    if (this.orientationSensor) {
      this.orientationSensor.stop()
      this.orientationSensor = null
    }
    this.hasQuat = false
    if (this.motionActive) {
      window.removeEventListener('devicemotion', this.onMotion)
      this.motionActive = false
    }
  }

  private resetCalibration(): void {
    this.calibrated = false
    this.calQuatValid = false
    this.filterReady = false
    this.lastSampleTime = null
    this.stableTime = 0
    this.waitTime = 0
    this.centerAngle = screenAngle()
    this.value.x = 0
    this.value.y = 0
  }

  // --- sensor startup ------------------------------------------------------

  private startGravitySensor(): boolean {
    const w = window as unknown as SensorWindow
    if (typeof w.GravitySensor !== 'function') return false
    try {
      const sensor = new w.GravitySensor({ frequency: SENSOR_FREQUENCY })
      sensor.addEventListener('reading', this.onGravityReading)
      sensor.addEventListener('error', this.onGravityError)
      sensor.start()
      this.gravitySensor = sensor
      return true
    } catch (error) {
      console.warn('GravitySensor unavailable:', error)
      return false
    }
  }

  private async startDeviceMotion(): Promise<boolean> {
    if (typeof DeviceMotionEvent === 'undefined') return false
    try {
      const Motion = DeviceMotionEvent as MotionConstructor
      if (typeof Motion.requestPermission === 'function') {
        if ((await Motion.requestPermission()) !== 'granted') return false
      }
      window.addEventListener('devicemotion', this.onMotion)
      this.motionActive = true
      return true
    } catch (error) {
      console.warn('tilt steering unavailable:', error)
      return false
    }
  }

  private startOrientationSensor(): void {
    const w = window as unknown as SensorWindow
    if (typeof w.RelativeOrientationSensor !== 'function') return
    try {
      const sensor = new w.RelativeOrientationSensor({ frequency: SENSOR_FREQUENCY })
      sensor.addEventListener('reading', this.onOrientationReading)
      sensor.addEventListener('error', this.onOrientationError)
      sensor.start()
      this.orientationSensor = sensor
    } catch (error) {
      console.warn('RelativeOrientationSensor unavailable (gravity-only pitch):', error)
    }
  }

  /** GravitySensor died after starting (e.g. permissions policy): fall back. */
  private readonly onGravityError = (event: Event): void => {
    console.warn('GravitySensor failed, falling back to devicemotion:', event)
    if (this.gravitySensor) {
      this.gravitySensor.stop()
      this.gravitySensor = null
    }
    if (!this._active) return
    this.resetCalibration()
    void this.startDeviceMotion().then((ok) => {
      if (!ok) this.disable() // no gravity source at all — steering stays at 0
    })
  }

  private readonly onOrientationError = (event: Event): void => {
    console.warn('RelativeOrientationSensor failed (gravity-only pitch):', event)
    if (this.orientationSensor) {
      this.orientationSensor.stop()
      this.orientationSensor = null
    }
    this.hasQuat = false
  }

  // --- readings ------------------------------------------------------------

  private readonly onGravityReading = (): void => {
    const s = this.gravitySensor
    if (!s || s.x == null || s.y == null || s.z == null) return
    this.ingestGravity(s.x, s.y, s.z, s.timestamp ?? performance.now(), GRAVITY_FILTER_RESPONSE)
  }

  private readonly onMotion = (e: DeviceMotionEvent): void => {
    const a = e.accelerationIncludingGravity
    if (!a || a.x === null || a.y === null || a.z === null) return
    this.ingestGravity(a.x, a.y, a.z, e.timeStamp, MOTION_FILTER_RESPONSE)
  }

  private ingestGravity(x: number, y: number, z: number, timeMs: number, response: number): void {
    // A screen rotation reorients every axis: recalibrate from scratch.
    if (screenAngle() !== this.centerAngle) this.resetCalibration()

    if (!this.filterReady) {
      this.gx = x
      this.gy = y
      this.gz = z
      this.filterReady = true
      this.lastSampleTime = timeMs
      return
    }
    const elapsed = this.lastSampleTime === null ? 1 / 60 : (timeMs - this.lastSampleTime) / 1000
    const dt = Math.min(0.1, Math.max(1 / 240, elapsed))
    this.lastSampleTime = timeMs

    const ox = this.gx
    const oy = this.gy
    const oz = this.gz
    const amount = 1 - Math.exp(-response * dt)
    this.gx += (x - this.gx) * amount
    this.gy += (y - this.gy) * amount
    this.gz += (z - this.gz) * amount

    const mag = Math.hypot(this.gx, this.gy, this.gz)
    if (mag < MIN_GRAVITY) return
    this.remapToScreen(this.gx / mag, this.gy / mag, this.gz / mag, this._g)

    if (!this.calibrated) {
      this.updateCalibration(dt, ox, oy, oz)
      return
    }

    const dot0 = this._g.dot(this.g0)
    this.value.x = normalizeTilt(Math.atan2(this._g.dot(this.rollTangent), dot0))
    // Pitch normally comes from the orientation sensor; without one, fall back
    // to the tangent-frame read on gravity (subject to roll crosstalk).
    if (!this.usingOrientationPitch()) {
      this.value.y = normalizeTilt(Math.atan2(this._g.dot(this.pitchTangent), dot0))
    }
  }

  private readonly onOrientationReading = (): void => {
    const q = this.orientationSensor?.quaternion
    if (!q) return
    if (screenAngle() !== this.centerAngle) this.resetCalibration()
    this.latestQuat.set(q[0], q[1], q[2], q[3])
    this.hasQuat = true
    if (!this.calibrated || !this.calQuatValid) return
    // Relative rotation since calibration -> rotation vector in device coords.
    this._q.copy(this.calQuatInv).multiply(this.latestQuat)
    if (this._q.w < 0) this._q.set(-this._q.x, -this._q.y, -this._q.z, -this._q.w)
    const sinHalf = Math.hypot(this._q.x, this._q.y, this._q.z)
    if (sinHalf < 1e-6) {
      this.value.y = 0
      return
    }
    const scale = (2 * Math.atan2(sinHalf, this._q.w)) / sinHalf
    this.remapToScreen(this._q.x * scale, this._q.y * scale, this._q.z * scale, this._rv)
    // The rotation vector's screen-x component is the pitch: rotation about
    // the screen's x-axis, positive = top edge toward the player = nose up.
    // Pure rolls (about the screen normal or vertical) have no x component.
    this.value.y = normalizeTilt(this._rv.x)
  }

  private usingOrientationPitch(): boolean {
    return this.calQuatValid && this.hasQuat && this.orientationSensor !== null
  }

  /**
   * Stability gate, then capture: g0 plus its tangent frame — rollTangent =
   * the screen x-axis made perpendicular to g0, pitchTangent = g0 x rollTangent
   * (the direction gravity moves when the top edge tips toward the player) —
   * and the orientation reference for the gyro pitch.
   */
  private updateCalibration(dt: number, ox: number, oy: number, oz: number): void {
    this.waitTime += dt
    const rate = angleBetween(ox, oy, oz, this.gx, this.gy, this.gz) / dt
    if (rate < CALIBRATION_MAX_RATE) this.stableTime += dt
    else this.stableTime = 0
    const settled = this.stableTime >= CALIBRATION_STABLE_TIME || this.waitTime >= CALIBRATION_TIMEOUT
    if (!settled) return
    // Hold (briefly) for the orientation sensor's first reading so the pitch
    // reference is captured at the same pose as the gravity center.
    if (this.orientationSensor && !this.hasQuat && this.waitTime < CALIBRATION_TIMEOUT) return
    if (Math.abs(this._g.x) > MAX_EDGE_ALIGNMENT) return // edge-on: no usable frame
    this.g0.copy(this._g)
    this.rollTangent.set(1, 0, 0).addScaledVector(this.g0, -this.g0.x).normalize()
    this.pitchTangent.crossVectors(this.g0, this.rollTangent)
    this.calQuatValid = this.hasQuat
    if (this.calQuatValid) this.calQuatInv.copy(this.latestQuat).invert()
    this.calibrated = true
  }

  /** Rotate device-frame components into the current screen orientation. */
  private remapToScreen(x: number, y: number, z: number, out: THREE.Vector3): void {
    const angle = this.centerAngle
    if (angle === 90) out.set(y, -x, z)
    else if (angle === 180) out.set(-x, -y, z)
    else if (angle === 270) out.set(-y, x, z)
    else out.set(x, y, z)
  }
}

function screenAngle(): number {
  const angle = screen.orientation?.angle ?? 0
  return ((Math.round(angle / 90) * 90) % 360 + 360) % 360
}

/** Angle (radians) between two vectors given by components. */
function angleBetween(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const cx = ay * bz - az * by
  const cy = az * bx - ax * bz
  const cz = ax * by - ay * bx
  return Math.atan2(Math.hypot(cx, cy, cz), ax * bx + ay * by + az * bz)
}

function normalizeTilt(radians: number): number {
  const magnitude = Math.abs(radians)
  if (magnitude <= TILT_DEADZONE) return 0
  const scaled = (magnitude - TILT_DEADZONE) / (TILT_RANGE - TILT_DEADZONE)
  return Math.sign(radians) * Math.min(1, scaled)
}

function fmt(v: number): string {
  return (v < 0 ? '' : '+') + v.toFixed(2)
}
