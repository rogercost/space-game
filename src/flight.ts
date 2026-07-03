import * as THREE from 'three'

export interface FlightConfig {
  /** Forward cruise speed (units/sec). */
  speed: number
  /** Max yaw/pitch turn rate at full mouse deflection (rad/sec). */
  maxTurnRate: number
  /** How quickly the turn rate chases the mouse. Higher = snappier steering. */
  turnResponse: number
  /** How quickly velocity realigns to the nose. Lower = floatier / more drift. */
  driftResponse: number
  /** Max visual bank/roll into a turn (rad). */
  maxBank: number
  /** How quickly the bank eases in/out. */
  bankResponse: number
}

export const DEFAULT_FLIGHT: FlightConfig = {
  speed: 50,
  maxTurnRate: 1.8,
  turnResponse: 7.5,
  driftResponse: 2,
  maxBank: 0.6,
  bankResponse: 4,
}

const FORWARD = new THREE.Vector3(0, 0, -1)
const LOCAL_UP = new THREE.Vector3(0, 1, 0)
const LOCAL_RIGHT = new THREE.Vector3(1, 0, 0)
const DEADZONE = 0.04

/** Framerate-independent exponential approach of `current` toward `target`. */
function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt))
}

/**
 * Mouse-steered forward flyer. The ship always thrusts along its nose; the
 * mouse offset from screen center sets target yaw/pitch *rates* (so you can
 * turn continuously, even loop), and velocity lags behind the heading to give
 * the drifty, inertial feel of the original. Banking is a purely visual roll
 * about the nose and does not affect the flight direction.
 */
export class Flight {
  readonly object: THREE.Object3D
  /** Heading = yaw + pitch only (no roll), so it cleanly drives the camera. */
  readonly heading = new THREE.Quaternion()
  readonly velocity = new THREE.Vector3()
  readonly forward = new THREE.Vector3(0, 0, -1)
  cfg: FlightConfig

  private yawRate = 0
  private pitchRate = 0
  private bank = 0
  private readonly _q = new THREE.Quaternion()
  private readonly _roll = new THREE.Quaternion()

  constructor(object: THREE.Object3D, cfg: FlightConfig = DEFAULT_FLIGHT) {
    this.object = object
    this.cfg = cfg
    this.heading.copy(object.quaternion)
  }

  /** Reset to a fresh launch at the origin, facing -Z, at rest. */
  reset(): void {
    this.object.position.set(0, 0, 0)
    this.object.quaternion.identity()
    this.heading.identity()
    this.velocity.set(0, 0, 0)
    this.forward.set(0, 0, -1)
    this.yawRate = 0
    this.pitchRate = 0
    this.bank = 0
  }

  /** Post-death drift: no thrust or steering; velocity slowly bleeds off. */
  coast(dt: number): void {
    this.velocity.multiplyScalar(Math.max(0, 1 - 0.4 * dt))
    this.object.position.addScaledVector(this.velocity, dt)
  }

  update(dt: number, aimX: number, aimY: number): void {
    const c = this.cfg

    const ax = Math.abs(aimX) < DEADZONE ? 0 : aimX
    const ay = Math.abs(aimY) < DEADZONE ? 0 : aimY

    // Mouse offset -> target turn rates (mouse right => nose right, up => nose up).
    const targetYaw = -ax * c.maxTurnRate
    const targetPitch = ay * c.maxTurnRate
    this.yawRate = damp(this.yawRate, targetYaw, c.turnResponse, dt)
    this.pitchRate = damp(this.pitchRate, targetPitch, c.turnResponse, dt)

    // Integrate heading in local space (yaw about up, pitch about right).
    this._q.setFromAxisAngle(LOCAL_UP, this.yawRate * dt)
    this.heading.multiply(this._q)
    this._q.setFromAxisAngle(LOCAL_RIGHT, this.pitchRate * dt)
    this.heading.multiply(this._q)
    this.heading.normalize()

    // Thrust along the nose; velocity eases toward it (drift).
    this.forward.copy(FORWARD).applyQuaternion(this.heading)
    this.velocity.x = damp(this.velocity.x, this.forward.x * c.speed, c.driftResponse, dt)
    this.velocity.y = damp(this.velocity.y, this.forward.y * c.speed, c.driftResponse, dt)
    this.velocity.z = damp(this.velocity.z, this.forward.z * c.speed, c.driftResponse, dt)
    this.object.position.addScaledVector(this.velocity, dt)

    // Bank into the turn (visual only): roll about the nose, proportional to yaw.
    const targetBank = THREE.MathUtils.clamp(-this.yawRate / c.maxTurnRate, -1, 1) * c.maxBank
    this.bank = damp(this.bank, targetBank, c.bankResponse, dt)
    this._roll.setFromAxisAngle(FORWARD, this.bank)
    this.object.quaternion.copy(this.heading).multiply(this._roll)
  }
}
