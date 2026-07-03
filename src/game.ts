/** Core run state: health, brief post-hit invulnerability, and death. */
export class Game {
  health: number
  readonly maxHealth: number
  dead = false
  /** Distance travelled while alive; the run's score. */
  score = 0
  private invuln = 0

  constructor(maxHealth = 3) {
    this.maxHealth = maxHealth
    this.health = maxHealth
  }

  reset(): void {
    this.health = this.maxHealth
    this.dead = false
    this.score = 0
    this.invuln = 0
  }

  /** Add travelled distance to the score (call only while alive). */
  addDistance(d: number): void {
    this.score += d
  }

  update(dt: number): void {
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt)
  }

  get invulnerable(): boolean {
    return this.invuln > 0
  }

  /** Take a hit: lose 1 health, become briefly invulnerable. Returns true if now dead. */
  hit(invulnTime = 1.2): boolean {
    this.health -= 1
    this.invuln = invulnTime
    if (this.health <= 0) {
      this.health = 0
      this.dead = true
    }
    return this.dead
  }
}

const SHAKE_DECAY = 1.6

/** Trauma-based camera shake: add() on impact, decays over time. */
export class Shake {
  private trauma = 0
  private readonly max: number

  constructor(max = 1.6) {
    this.max = max
  }

  add(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount)
  }

  update(dt: number): void {
    this.trauma = Math.max(0, this.trauma - dt * SHAKE_DECAY)
  }

  /** Current positional shake magnitude (trauma² for a punchy falloff). */
  get amount(): number {
    return this.trauma * this.trauma * this.max
  }

  reset(): void {
    this.trauma = 0
  }
}
