import { TiltSteering } from './tilt'

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
  // Tilt steering surface (experimental — see tilt.ts for the removal note).
  readonly tiltSupported: boolean
  readonly tiltActive: boolean
  /** One-line sensor/calibration state for the debug stats panel. */
  readonly tiltDebug: string
  toggleTilt(): Promise<boolean>
}

export function createSteeringInput(): SteeringInput {
  return new BrowserSteeringInput()
}

class BrowserSteeringInput implements SteeringInput {
  private readonly pointer: Pointer = { x: 0, y: 0 }
  private readonly tilt = new TiltSteering()
  private activeTouchId: number | null = null

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
    return this.tilt.active ? this.tilt.value : this.pointer
  }

  get tiltSupported(): boolean {
    return this.tilt.supported
  }

  get tiltActive(): boolean {
    return this.tilt.active
  }

  get tiltDebug(): string {
    return this.tilt.debug
  }

  toggleTilt(): Promise<boolean> {
    return this.tilt.toggle()
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
}
