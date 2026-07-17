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
 * (The D1 migration seeds the server board with the same names.)
 */
const DEFAULT_SCORES: ScoreEntry[] = [
  { name: 'PINPOINT', time: 240 },
  { name: 'NOVA', time: 185 },
  { name: 'ORION', time: 140 },
  { name: 'VESPER', time: 95 },
  { name: 'ROOKIE', time: 45 },
]

function isEntry(e: unknown): e is ScoreEntry {
  if (typeof e !== 'object' || e === null) return false
  const r = e as Record<string, unknown>
  return typeof r.name === 'string' && typeof r.time === 'number' && Number.isFinite(r.time)
}

/**
 * High-score table with a synchronous in-memory cache and optional persistence
 * behind the deployed worker's /api/scores:
 *
 * - Reads (`entries`) and ranking (`add()`) are synchronous against the cache,
 *   so the UI never waits on the network; `add()` POSTs in the background.
 * - `refresh()` replaces the cache with the server board when the API is
 *   reachable and is fired at construction and on returning to the menu.
 * - Under plain `vite dev` there are no /api routes: every fetch fails, is
 *   swallowed, and the board is purely in-memory — the pre-persistence behavior.
 *
 * Trade-off: the rank shown on the death screen is computed locally, so two
 * players finishing at nearly the same moment can each be told the same rank;
 * the next refresh converges everyone on the server's ordering.
 */
export class Leaderboard {
  private scores: ScoreEntry[]

  constructor(seed: ScoreEntry[] = DEFAULT_SCORES) {
    this.scores = [...seed].sort(byTime).slice(0, CAPACITY)
    void this.refresh()
  }

  /** Pull the server board into the cache (no-op when the API is unreachable). */
  async refresh(): Promise<void> {
    try {
      const res = await fetch('/api/scores')
      if (!res.ok) return
      const data: unknown = await res.json()
      if (!Array.isArray(data)) return
      this.scores = data.filter(isEntry).sort(byTime).slice(0, CAPACITY)
    } catch {
      // No API here (local dev) or a network hiccup — keep the in-memory board.
    }
  }

  /**
   * Record a score. Returns its 0-based rank on the cached board (-1 if it
   * didn't make the cut) immediately; the server write happens in the background.
   */
  add(name: string, time: number): number {
    const entry: ScoreEntry = { name, time }
    this.scores.push(entry)
    this.scores.sort(byTime)
    this.scores = this.scores.slice(0, CAPACITY)
    void this.submit(name, time)
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

  private async submit(name: string, time: number): Promise<void> {
    try {
      await fetch('/api/scores', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, time }),
      })
      await this.refresh() // converge the cache on the server's view
    } catch {
      // Offline or local dev — the score stays on the in-memory board only.
    }
  }
}

function byTime(a: ScoreEntry, b: ScoreEntry): number {
  return b.time - a.time
}
