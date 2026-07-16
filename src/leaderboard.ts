/** One high-score entry: a player name and the survival time (seconds) they reached. */
export interface ScoreEntry {
  name: string
  time: number
}

/** Max entries kept on the board. */
const CAPACITY = 10

/**
 * A few starter scores so the board reads as a real "hall of fame" on first view
 * rather than an empty list. Modest times, so an early run can still place.
 */
const DEFAULT_SCORES: ScoreEntry[] = [
  { name: 'PINPOINT', time: 240 },
  { name: 'NOVA', time: 185 },
  { name: 'ORION', time: 140 },
  { name: 'VESPER', time: 95 },
  { name: 'ROOKIE', time: 45 },
]

/**
 * In-memory high-score table, sorted by survival time (descending) and capped at
 * CAPACITY. Persistence is a future step: keep `add()` / `entries` the only surface
 * so a storage backend (localStorage, a small API) can slot in behind them without
 * changing any caller.
 */
export class Leaderboard {
  private scores: ScoreEntry[]

  constructor(seed: ScoreEntry[] = DEFAULT_SCORES) {
    this.scores = [...seed].sort(byTime).slice(0, CAPACITY)
  }

  /**
   * Record a score. Returns its 0-based rank on the board, or -1 if the time
   * didn't make the cut.
   */
  add(name: string, time: number): number {
    const entry: ScoreEntry = { name, time }
    this.scores.push(entry)
    this.scores.sort(byTime)
    this.scores = this.scores.slice(0, CAPACITY)
    return this.scores.indexOf(entry)
  }

  /** Would this time earn a spot on the board? */
  qualifies(time: number): boolean {
    return this.scores.length < CAPACITY || time > this.scores[this.scores.length - 1].time
  }

  /** Current entries, best first. */
  get entries(): readonly ScoreEntry[] {
    return this.scores
  }
}

function byTime(a: ScoreEntry, b: ScoreEntry): number {
  return b.time - a.time
}
