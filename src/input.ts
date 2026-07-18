/** Normalized steering position relative to screen center. */
export interface Pointer {
  /** -1 (left) .. +1 (right). */
  x: number
  /** -1 (down) .. +1 (up). */
  y: number
}

export interface SteeringInput {
  /** Touch overrides tilt while held; otherwise enabled tilt overrides mouse/pointer input. */
  readonly value: Pointer
  readonly tiltSupported: boolean
  readonly tiltActive: boolean
  toggleTilt(): Promise<boolean>
}

type MotionPermission = 'granted' | 'denied'
type MotionConstructor = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<MotionPermission>
}

const DEG_TO_RAD = Math.PI / 180
/** Radians from calibrated center needed for full steering deflection. */
const TILT_RANGE = 25 * DEG_TO_RAD
const TILT_DEADZONE = 2 * DEG_TO_RAD
/** Low-pass response for removing hand jitter and brief movement acceleration. */
const MOTION_FILTER_RESPONSE = 12
/** Let the gravity estimate settle after the user taps the Tilt button. */
const CALIBRATION_SAMPLES = 8

export function createSteeringInput(): SteeringInput {
  return new BrowserSteeringInput()
}

class BrowserSteeringInput implements SteeringInput {
  private readonly pointer: Pointer = { x: 0, y: 0 }
  private readonly tilt: Pointer = { x: 0, y: 0 }
  private activeTouchId: number | null = null
  private _tiltActive = false
  private tiltPending = false
  private gravityX = 0
  private gravityY = 0
  private gravityZ = 0
  private gravityReady = false
  private lastMotionTime: number | null = null
  private centerRoll = 0
  private centerPitch = 0
  private centerAngle = 0
  private calibrationSamples = 0

  readonly tiltSupported =
    window.isSecureContext &&
    typeof DeviceMotionEvent !== 'undefined' &&
    window.matchMedia('(hover: none) and (pointer: coarse)').matches

  constructor() {
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || this.activeTouchId !== null) return
      this.activeTouchId = e.pointerId
      this.updatePointer(e)
    })

    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch' && e.pointerId !== this.activeTouchId) return
      this.updatePointer(e)
    })

    window.addEventListener('pointerup', this.releaseTouch)
    window.addEventListener('pointercancel', this.releaseTouch)
  }

  get value(): Pointer {
    if (this.activeTouchId !== null) return this.pointer
    return this._tiltActive ? this.tilt : this.pointer
  }

  get tiltActive(): boolean {
    return this._tiltActive
  }

  async toggleTilt(): Promise<boolean> {
    if (!this.tiltSupported || this.tiltPending) return this._tiltActive

    if (this._tiltActive) {
      this.disableTilt()
      return false
    }

    this.tiltPending = true
    try {
      const Motion = DeviceMotionEvent as MotionConstructor
      if (typeof Motion.requestPermission === 'function') {
        const permission = await Motion.requestPermission()
        if (permission !== 'granted') return false
      }

      this.resetTiltCenter()
      this._tiltActive = true
      window.addEventListener('devicemotion', this.updateTilt)
      return true
    } catch (error) {
      console.warn('tilt steering unavailable:', error)
      return false
    } finally {
      this.tiltPending = false
    }
  }

  private updatePointer(e: PointerEvent): void {
    this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1
    this.pointer.y = -((e.clientY / window.innerHeight) * 2 - 1)
  }

  private readonly releaseTouch = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' || e.pointerId !== this.activeTouchId) return
    this.activeTouchId = null
    this.pointer.x = 0
    this.pointer.y = 0
  }

  private readonly updateTilt = (e: DeviceMotionEvent): void => {
    const acceleration = e.accelerationIncludingGravity
    if (
      !acceleration ||
      acceleration.x === null ||
      acceleration.y === null ||
      acceleration.z === null
    ) {
      return
    }

    const angle = screenAngle()
    if (angle !== this.centerAngle) {
      this.gravityReady = false
      this.lastMotionTime = null
      this.centerAngle = angle
      this.calibrationSamples = 0
      this.tilt.x = 0
      this.tilt.y = 0
    }
    this.filterGravity(acceleration.x, acceleration.y, acceleration.z, e.timeStamp)

    let screenX = this.gravityX
    let screenY = this.gravityY
    if (angle === 90) {
      screenX = this.gravityY
      screenY = -this.gravityX
    } else if (angle === 180) {
      screenX = -this.gravityX
      screenY = -this.gravityY
    } else if (angle === 270) {
      screenX = -this.gravityY
      screenY = this.gravityX
    }

    if (Math.hypot(screenX, screenY, this.gravityZ) < 1) return

    // Roll uses gravity across the screen. Pitch uses the signed angle between
    // screen-up and screen-normal, which remains continuous while held upright.
    const roll = Math.atan2(screenX, Math.hypot(screenY, this.gravityZ))
    const pitch = Math.atan2(this.gravityZ, -screenY)

    if (this.calibrationSamples < CALIBRATION_SAMPLES) {
      this.centerRoll = roll
      this.centerPitch = pitch
      this.calibrationSamples += 1
      this.tilt.x = 0
      this.tilt.y = 0
      return
    }

    this.tilt.x = normalizeTilt(shortestAngle(roll - this.centerRoll))
    this.tilt.y = normalizeTilt(shortestAngle(pitch - this.centerPitch))
  }

  private disableTilt(): void {
    this._tiltActive = false
    window.removeEventListener('devicemotion', this.updateTilt)
    this.resetTiltCenter()
  }

  private resetTiltCenter(): void {
    this.gravityReady = false
    this.lastMotionTime = null
    this.centerRoll = 0
    this.centerPitch = 0
    this.centerAngle = screenAngle()
    this.calibrationSamples = 0
    this.tilt.x = 0
    this.tilt.y = 0
  }

  private filterGravity(x: number, y: number, z: number, time: number): void {
    if (!this.gravityReady) {
      this.gravityX = x
      this.gravityY = y
      this.gravityZ = z
      this.gravityReady = true
      this.lastMotionTime = time
      return
    }

    const elapsed = this.lastMotionTime === null ? 1 / 60 : (time - this.lastMotionTime) / 1000
    const dt = Math.min(0.1, Math.max(1 / 240, elapsed))
    const amount = 1 - Math.exp(-MOTION_FILTER_RESPONSE * dt)
    this.gravityX += (x - this.gravityX) * amount
    this.gravityY += (y - this.gravityY) * amount
    this.gravityZ += (z - this.gravityZ) * amount
    this.lastMotionTime = time
  }
}

function screenAngle(): number {
  const angle = screen.orientation?.angle ?? 0
  return ((Math.round(angle / 90) * 90) % 360 + 360) % 360
}

function shortestAngle(radians: number): number {
  return Math.atan2(Math.sin(radians), Math.cos(radians))
}

function normalizeTilt(radians: number): number {
  const magnitude = Math.abs(radians)
  if (magnitude <= TILT_DEADZONE) return 0
  const scaled = (magnitude - TILT_DEADZONE) / (TILT_RANGE - TILT_DEADZONE)
  return Math.sign(radians) * Math.min(1, scaled)
}
