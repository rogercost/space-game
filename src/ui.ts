import type { ScoreEntry } from './leaderboard'

/** Live values shown in the M-key debug stats panel. */
export interface StatsFields {
  time: number
  best: number
  health: number
  maxHealth: number
  speed: number
  count: number
  active: number
  distance: number
  fps: number
}

/** Callbacks the UI fires when the player interacts with a menu/button. */
export interface UIHandlers {
  onLaunch(): void
  onContinue(): void
  onRestart(): void
  onMainMenu(): void
  onPause(): void
  onPlayAgain(): void
  /** Record a name for the just-ended run; returns its 0-based leaderboard rank (-1 = off the board). */
  onSubmitName(name: string): number
  /** Current leaderboard entries, best first (read fresh each time the board is shown). */
  getLeaderboard(): readonly ScoreEntry[]
}

/** Seconds -> `m:ss`. */
export function formatTime(seconds: number): string {
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Clean a raw name field into a short, upper-case board entry (fallback: PILOT). */
function sanitizeName(raw: string): string {
  const n = raw.trim().replace(/\s+/g, ' ').slice(0, 12)
  return n ? n.toUpperCase() : 'PILOT'
}

const STYLE = `
.s3d-overlay {
  position: fixed; inset: 0; display: none;
  align-items: center; justify-content: center; flex-direction: column;
  font-family: system-ui, sans-serif; color: #dfe8ff;
  background: rgba(5, 6, 10, 0.55); z-index: 30; pointer-events: auto;
}
.s3d-panel {
  display: flex; flex-direction: column; align-items: stretch; gap: 14px;
  min-width: 300px; max-width: 90vw; padding: 30px 34px;
  background: rgba(12, 14, 22, 0.72);
  border: 1px solid rgba(120, 150, 200, 0.25); border-radius: 14px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5);
}
.s3d-title {
  margin: 0 0 6px; text-align: center;
  font-size: 40px; font-weight: 800; letter-spacing: 0.12em;
}
.s3d-title--danger { color: #ff5566; }
.s3d-subtitle {
  margin: -6px 0 8px; text-align: center;
  font-size: 14px; letter-spacing: 0.15em; opacity: 0.65;
}
.s3d-btn {
  font: 600 18px/1 system-ui, sans-serif; letter-spacing: 0.14em; color: #dfe8ff;
  background: rgba(60, 80, 120, 0.18);
  border: 1px solid rgba(120, 150, 200, 0.35); border-radius: 10px;
  padding: 14px 20px; cursor: pointer; text-align: center;
  transition: background 0.12s, border-color 0.12s, transform 0.06s;
}
.s3d-btn:hover { background: rgba(80, 120, 180, 0.34); border-color: rgba(150, 190, 240, 0.6); }
.s3d-btn:active { transform: translateY(1px); }
.s3d-btn--primary { background: rgba(70, 150, 220, 0.34); border-color: rgba(150, 200, 250, 0.7); }
.s3d-btn--primary:hover { background: rgba(90, 175, 240, 0.5); }
.s3d-row { display: flex; gap: 10px; }
.s3d-row > .s3d-btn { flex: 1; }
.s3d-input {
  font: 500 18px/1 system-ui, sans-serif; letter-spacing: 0.08em; color: #fff;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(120, 150, 200, 0.4); border-radius: 10px;
  padding: 12px 14px; text-align: center; outline: none;
}
.s3d-input:focus { border-color: rgba(150, 200, 250, 0.8); }
.s3d-input:disabled { opacity: 0.6; }
.s3d-bigtime { text-align: center; font: 700 34px/1 system-ui, sans-serif; letter-spacing: 0.08em; }
.s3d-small { text-align: center; font-size: 14px; letter-spacing: 0.1em; opacity: 0.7; }
.s3d-status { min-height: 18px; text-align: center; font-size: 14px; letter-spacing: 0.08em; color: #8fe6b0; }
.s3d-list { display: flex; flex-direction: column; gap: 2px; min-width: 320px; font: 500 16px/1.6 ui-monospace, Menlo, monospace; }
.s3d-list-row { display: flex; justify-content: space-between; gap: 24px; padding: 4px 6px; border-radius: 6px; }
.s3d-list-row.is-empty { justify-content: center; opacity: 0.5; }
.s3d-rank { width: 2em; opacity: 0.6; }
.s3d-name { flex: 1; letter-spacing: 0.06em; }
.s3d-time { font-variant-numeric: tabular-nums; }
.s3d-help { font: 13px/1.7 ui-monospace, Menlo, monospace; opacity: 0.75; }
.s3d-help b { opacity: 0.95; }

.s3d-reticle {
  position: fixed; left: 50%; top: 50%; width: 16px; height: 16px; margin: -8px 0 0 -8px;
  border: 2px solid rgba(255, 255, 255, 0.25); border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4) inset; pointer-events: none; z-index: 10;
}
.s3d-health {
  position: fixed; left: 18px; top: 14px;
  font: 600 28px/1 system-ui, sans-serif; color: #ff5566; letter-spacing: 6px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.6); pointer-events: none; z-index: 15;
}
.s3d-score-wrap {
  position: fixed; right: 18px; top: 12px; text-align: right; pointer-events: none; z-index: 15;
  font-family: system-ui, sans-serif; color: #dfe8ff; text-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
}
.s3d-score { font-weight: 700; font-size: 30px; letter-spacing: 1px; }
.s3d-best { font-weight: 500; font-size: 15px; opacity: 0.7; margin-top: 2px; }
.s3d-stats {
  position: fixed; left: 18px; top: 56px; white-space: pre; display: none;
  font: 13px/1.5 ui-monospace, Menlo, monospace; color: rgba(223, 232, 255, 0.85);
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.7); pointer-events: none; z-index: 15;
}
.s3d-pausebtn {
  position: fixed; left: 50%; top: 14px; transform: translateX(-50%);
  width: 44px; height: 44px; display: none; align-items: center; justify-content: center;
  font-size: 20px; color: #dfe8ff; background: rgba(12, 14, 22, 0.5);
  border: 1px solid rgba(120, 150, 200, 0.35); border-radius: 10px;
  cursor: pointer; pointer-events: auto; z-index: 16;
}
.s3d-pausebtn:hover { background: rgba(40, 60, 100, 0.6); border-color: rgba(150, 190, 240, 0.6); }
`

/**
 * Owns the entire DOM UI layer: the in-flight HUD (health, score, reticle, pause
 * button, debug stats) and the full-screen overlays (main menu with settings /
 * leaderboard sub-views, pause menu, and the death / name-entry screen).
 *
 * Holds no game state — `main.ts` drives it: it calls one `showX()` per state
 * transition and pushes per-frame HUD values in via the setters. Buttons report
 * back through the `UIHandlers` callbacks passed to the constructor.
 */
export class UI {
  private readonly handlers: UIHandlers

  // HUD
  private readonly reticleEl: HTMLDivElement
  private readonly healthEl: HTMLDivElement
  private readonly scoreWrap: HTMLDivElement
  private readonly scoreEl: HTMLDivElement
  private readonly bestEl: HTMLDivElement
  private readonly statsEl: HTMLDivElement
  private readonly pauseBtn: HTMLButtonElement

  // Overlays
  private readonly menuEl: HTMLDivElement
  private readonly menuRoot: HTMLDivElement
  private readonly settingsView: HTMLDivElement
  private readonly lbView: HTMLDivElement
  private readonly lbList: HTMLDivElement
  private readonly menuBest: HTMLDivElement
  private readonly pauseEl: HTMLDivElement
  private readonly deathEl: HTMLDivElement

  // Death / name-entry widgets
  private readonly deathTimeEl: HTMLDivElement
  private readonly deathBestEl: HTMLDivElement
  private readonly nameInput: HTMLInputElement
  private readonly submitBtn: HTMLButtonElement
  private readonly statusEl: HTMLDivElement
  private submitted = false

  // HUD change-detection (only touch the DOM when a value actually changes)
  private lastHealth = -1
  private lastSecond = -1
  private statsOn = false
  private isPlaying = false

  constructor(handlers: UIHandlers) {
    this.handlers = handlers

    const style = document.createElement('style')
    style.textContent = STYLE
    document.head.appendChild(style)

    // --- HUD ---------------------------------------------------------------
    this.reticleEl = this.el('div', 's3d-reticle')

    this.healthEl = this.el('div', 's3d-health')

    this.scoreWrap = this.el('div', 's3d-score-wrap')
    this.scoreEl = this.el('div', 's3d-score', '0:00')
    this.bestEl = this.el('div', 's3d-best', 'best 0:00')
    this.scoreWrap.append(this.scoreEl, this.bestEl)

    this.statsEl = this.el('div', 's3d-stats')

    this.pauseBtn = this.el('button', 's3d-pausebtn', '⏸') // ⏸
    this.pauseBtn.type = 'button'
    this.pauseBtn.title = 'Pause (Space)'
    this.pauseBtn.addEventListener('click', () => this.handlers.onPause())

    document.body.append(this.reticleEl, this.healthEl, this.scoreWrap, this.statsEl, this.pauseBtn)

    // --- Main menu ---------------------------------------------------------
    this.menuRoot = this.el('div', 's3d-panel')
    this.menuBest = this.el('div', 's3d-subtitle', 'best 0:00')
    this.menuRoot.append(
      this.el('div', 's3d-title', 'STARSHIP'),
      this.menuBest,
      this.button('LAUNCH', () => this.handlers.onLaunch(), 's3d-btn--primary'),
      this.button('SETTINGS', () => this.showView(this.settingsView)),
      this.button('LEADERBOARD', () => {
        this.renderLeaderboard()
        this.showView(this.lbView)
      }),
    )

    this.settingsView = this.el('div', 's3d-panel')
    const settingsHelp = this.el('div', 's3d-help')
    settingsHelp.innerHTML =
      '<b>Controls</b><br>' +
      'Mouse&nbsp;&nbsp;steer<br>' +
      'Space&nbsp;&nbsp;pause / resume<br>' +
      'C&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;collider debug<br>' +
      'M&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;stats panel<br>' +
      'B&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;asteroid collisions'
    this.settingsView.append(
      this.el('div', 's3d-title', 'SETTINGS'),
      this.el('div', 's3d-subtitle', 'sound coming soon'),
      settingsHelp,
      this.button('BACK', () => this.showView(this.menuRoot)),
    )

    this.lbView = this.el('div', 's3d-panel')
    this.lbList = this.el('div', 's3d-list')
    this.lbView.append(
      this.el('div', 's3d-title', 'LEADERBOARD'),
      this.lbList,
      this.button('BACK', () => this.showView(this.menuRoot)),
    )

    this.menuEl = this.el('div', 's3d-overlay')
    this.menuEl.append(this.menuRoot, this.settingsView, this.lbView)

    // --- Pause menu --------------------------------------------------------
    const pausePanel = this.el('div', 's3d-panel')
    pausePanel.append(
      this.el('div', 's3d-title', 'PAUSED'),
      this.button('CONTINUE', () => this.handlers.onContinue(), 's3d-btn--primary'),
      this.button('RESTART', () => this.handlers.onRestart()),
      this.button('MAIN MENU', () => this.handlers.onMainMenu()),
    )
    this.pauseEl = this.el('div', 's3d-overlay')
    this.pauseEl.append(pausePanel)

    // --- Death / name entry ------------------------------------------------
    this.deathTimeEl = this.el('div', 's3d-bigtime')
    this.deathBestEl = this.el('div', 's3d-small')
    this.nameInput = this.el('input', 's3d-input')
    this.nameInput.type = 'text'
    this.nameInput.maxLength = 12
    this.nameInput.placeholder = 'ENTER NAME'
    this.nameInput.autocomplete = 'off'
    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        this.submitName()
      }
    })
    this.submitBtn = this.button('SAVE', () => this.submitName())
    const nameRow = this.el('div', 's3d-row')
    nameRow.append(this.nameInput, this.submitBtn)
    this.statusEl = this.el('div', 's3d-status')

    const deathPanel = this.el('div', 's3d-panel')
    deathPanel.append(
      this.el('div', 's3d-title s3d-title--danger', 'YOU DIED'),
      this.deathTimeEl,
      this.deathBestEl,
      nameRow,
      this.statusEl,
      this.button('PLAY AGAIN', () => this.handlers.onPlayAgain(), 's3d-btn--primary'),
      this.button('MAIN MENU', () => this.handlers.onMainMenu()),
    )
    this.deathEl = this.el('div', 's3d-overlay')
    this.deathEl.append(deathPanel)

    document.body.append(this.menuEl, this.pauseEl, this.deathEl)
  }

  // --- Screen transitions --------------------------------------------------

  showMenu(): void {
    this.hideOverlays()
    this.showView(this.menuRoot)
    this.menuEl.style.display = 'flex'
    this.isPlaying = false
    this.setHud(false, false, false)
    this.applyStatsVisibility()
  }

  showPlaying(): void {
    this.hideOverlays()
    this.isPlaying = true
    this.lastHealth = -1
    this.lastSecond = -1
    this.setHud(true, true, true)
    this.applyStatsVisibility()
  }

  showPaused(): void {
    this.hideOverlays()
    this.pauseEl.style.display = 'flex'
    this.isPlaying = false
    this.setHud(true, false, false) // keep score/health for context; no reticle / pause button
    this.applyStatsVisibility()
  }

  showDeath(finalTime: number, best: number, defaultName: string): void {
    this.hideOverlays()
    this.deathTimeEl.textContent = formatTime(finalTime)
    this.deathBestEl.textContent = `best ${formatTime(best)}`
    this.nameInput.value = defaultName
    this.nameInput.disabled = false
    this.submitBtn.disabled = false
    this.statusEl.textContent = ''
    this.submitted = false
    this.deathEl.style.display = 'flex'
    this.isPlaying = false
    this.setHud(false, false, false)
    this.applyStatsVisibility()
    this.nameInput.focus()
    this.nameInput.select()
  }

  // --- HUD setters (safe to call every frame; write DOM only on change) ----

  setHealth(health: number, maxHealth: number): void {
    if (health === this.lastHealth) return
    this.lastHealth = health
    this.healthEl.textContent = '♥'.repeat(health) + '♡'.repeat(maxHealth - health)
  }

  setScore(seconds: number): void {
    const s = Math.floor(seconds)
    if (s === this.lastSecond) return
    this.lastSecond = s
    this.scoreEl.textContent = formatTime(seconds)
  }

  setBest(best: number): void {
    const text = `best ${formatTime(best)}`
    this.bestEl.textContent = text
    this.menuBest.textContent = text
  }

  setStats(s: StatsFields): void {
    if (!this.statsOn || !this.isPlaying) return
    this.statsEl.innerHTML =
      `time     ${formatTime(s.time)}<br>` +
      `best     ${formatTime(s.best)}<br>` +
      `health   ${s.health}/${s.maxHealth}<br>` +
      `speed    ${s.speed.toFixed(1)}<br>` +
      `density  ${s.count}<br>` +
      `collide  ${s.active}<br>` +
      `distance ${Math.floor(s.distance)}<br>` +
      `fps      ${s.fps.toFixed(0)}`
  }

  /** Toggle the debug stats panel; returns whether it's now on. */
  toggleStats(): boolean {
    this.statsOn = !this.statsOn
    this.applyStatsVisibility()
    return this.statsOn
  }

  // --- internals -----------------------------------------------------------

  private submitName(): void {
    if (this.submitted) return
    this.submitted = true
    const name = sanitizeName(this.nameInput.value)
    this.nameInput.value = name
    this.nameInput.disabled = true
    this.submitBtn.disabled = true
    const rank = this.handlers.onSubmitName(name)
    this.statusEl.textContent = rank >= 0 ? `ranked #${rank + 1}` : 'added to leaderboard'
  }

  private renderLeaderboard(): void {
    const entries = this.handlers.getLeaderboard()
    this.lbList.replaceChildren()
    if (!entries.length) {
      this.lbList.appendChild(this.el('div', 's3d-list-row is-empty', 'no scores yet'))
      return
    }
    entries.forEach((entry, i) => {
      const row = this.el('div', 's3d-list-row')
      row.append(
        this.el('span', 's3d-rank', String(i + 1)),
        this.el('span', 's3d-name', entry.name),
        this.el('span', 's3d-time', formatTime(entry.time)),
      )
      this.lbList.appendChild(row)
    })
  }

  /** Show exactly one menu sub-view (root / settings / leaderboard). */
  private showView(view: HTMLElement): void {
    for (const v of [this.menuRoot, this.settingsView, this.lbView]) {
      v.style.display = v === view ? 'flex' : 'none'
    }
  }

  private hideOverlays(): void {
    this.menuEl.style.display = 'none'
    this.pauseEl.style.display = 'none'
    this.deathEl.style.display = 'none'
  }

  private setHud(healthScore: boolean, reticle: boolean, pause: boolean): void {
    this.healthEl.style.display = healthScore ? 'block' : 'none'
    this.scoreWrap.style.display = healthScore ? 'block' : 'none'
    this.reticleEl.style.display = reticle ? 'block' : 'none'
    this.pauseBtn.style.display = pause ? 'flex' : 'none'
  }

  private applyStatsVisibility(): void {
    this.statsEl.style.display = this.statsOn && this.isPlaying ? 'block' : 'none'
  }

  private el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    text?: string,
  ): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag)
    e.className = className
    if (text !== undefined) e.textContent = text
    return e
  }

  private button(label: string, onClick: () => void, extra = ''): HTMLButtonElement {
    const b = this.el('button', extra ? `s3d-btn ${extra}` : 's3d-btn', label)
    b.type = 'button'
    b.addEventListener('click', onClick)
    return b
  }
}
