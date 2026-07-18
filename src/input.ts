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

type OrientationPermission = 'granted' | 'denied'
type OrientationConstructor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<OrientationPermission>
}

/** Degrees from calibrated center needed for full steering deflection. */
const TILT_RANGE = 25
const TILT_DEADZONE = 2

export function createSteeringInput(): SteeringInput {
  return new BrowserSteeringInput()
}

class BrowserSteeringInput implements SteeringInput {
  private readonly pointer: Pointer = { x: 0, y: 0 }
  private readonly tilt: Pointer = { x: 0, y: 0 }
  private readonly currentTilt: Pointer = { x: 0, y: 0 }
  private activeTouchId: number | null = null
  private _tiltActive = false
  private tiltPending = false
  private centerX: number | null = null
  private centerY: number | null = null
  private centerAngle = 0

  readonly tiltSupported =
    window.isSecureContext &&
    typeof DeviceOrientationEvent !== 'undefined' &&
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
      const Orientation = DeviceOrientationEvent as OrientationConstructor
      if (typeof Orientation.requestPermission === 'function') {
        const permission = await Orientation.requestPermission()
        if (permission !== 'granted') return false
      }

      this.resetTiltCenter()
      this._tiltActive = true
      window.addEventListener('deviceorientation', this.updateTilt)
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

  private readonly updateTilt = (e: DeviceOrientationEvent): void => {
    if (e.beta === null || e.gamma === null) return

    const angle = screenAngle()
    orientTilt(this.currentTilt, e.beta, e.gamma, angle)
    if (this.centerX === null || this.centerY === null || angle !== this.centerAngle) {
      this.centerX = this.currentTilt.x
      this.centerY = this.currentTilt.y
      this.centerAngle = angle
      this.tilt.x = 0
      this.tilt.y = 0
      return
    }

    this.tilt.x = normalizeTilt(this.currentTilt.x - this.centerX)
    this.tilt.y = -normalizeTilt(this.currentTilt.y - this.centerY)
  }

  private disableTilt(): void {
    this._tiltActive = false
    window.removeEventListener('deviceorientation', this.updateTilt)
    this.resetTiltCenter()
  }

  private resetTiltCenter(): void {
    this.centerX = null
    this.centerY = null
    this.tilt.x = 0
    this.tilt.y = 0
  }
}

function screenAngle(): number {
  const angle = screen.orientation?.angle ?? 0
  return ((Math.round(angle / 90) * 90) % 360 + 360) % 360
}

/** Rotate device-fixed beta/gamma into the current screen orientation. */
function orientTilt(out: Pointer, beta: number, gamma: number, angle: number): void {
  if (angle === 90) {
    out.x = beta
    out.y = -gamma
  } else if (angle === 180) {
    out.x = -gamma
    out.y = -beta
  } else if (angle === 270) {
    out.x = -beta
    out.y = gamma
  } else {
    out.x = gamma
    out.y = beta
  }
}

function normalizeTilt(degrees: number): number {
  const magnitude = Math.abs(degrees)
  if (magnitude <= TILT_DEADZONE) return 0
  const scaled = (magnitude - TILT_DEADZONE) / (TILT_RANGE - TILT_DEADZONE)
  return Math.sign(degrees) * Math.min(1, scaled)
}
