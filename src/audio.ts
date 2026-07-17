import runMusicUrl from './assets/sunlight-at-apogee.mp3'
import menuMusicUrl from './assets/the-quiet-arc.mp3'

// The whole audio layer: two looping music tracks plus SFX synthesized on a
// small Web Audio graph (no sound files beyond the music):
//
//   menu <audio> ─▶ menuTrackGain ┐
//   run  <audio> ─▶ runTrackGain  ┴▶ musicGain ┐
//   saw pair ─▶ lowpass ─▶ droneGain ┐         ├▶ duck ─▶ master ─▶ out
//   whine osc ────────▶ whineGain ───┼▶ engineVol
//   noise loop ─▶ bandpass ─▶ gain ──┘
//                     impact bursts ──▶ sfxGain ─▶ master   (not ducked)
//
// Music: "The Quiet Arc" loops on the main menu (and its sub-views), "Sunlight
// at Apogee" loops during a run. The per-track gains do the fades/switches; the
// musicGain / engineVol / sfxGain buses carry the user volumes. Impacts bypass
// the duck node and briefly dip it, so hits punch through the mix.
//
// The engine is tonal — a detuned sawtooth drone plus a sine whine that sweeps
// up with RPM (jet-intake style) over a little breath noise. All of it follows
// one 0..1 level, driven per-frame by main.ts from ship state.
//
// Browsers refuse audio before a user gesture, so the graph is built lazily by
// ensure(); the menu music additionally arms a one-shot pointer/key listener at
// boot, because goMenu() runs before any gesture exists.

export const DEFAULT_MUSIC_VOLUME = 0.6
export const DEFAULT_SFX_VOLUME = 0.8
const MASTER_GAIN = 0.9
/** Time constant (seconds) for smoothing per-frame engine parameter writes. */
const ENGINE_SMOOTH = 0.06
/** Music fade lengths (seconds). */
const FADE_DEATH = 2.2
const FADE_MENU = 0.35
const MENU_TRACK_FADE_IN = 0.5
/** Impact duck: music + engine dip to this, then recover (τ = DUCK_RECOVERY). */
const DUCK_LEVEL = 0.35
const DUCK_RECOVERY = 0.25

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/** Every node we keep a handle on, created together once the first gesture lands. */
interface AudioGraph {
  ctx: AudioContext
  /** Sits under music + engine; impacts dip it and route around it. */
  duck: GainNode
  musicGain: GainNode
  menuTrackGain: GainNode
  runTrackGain: GainNode
  engineVol: GainNode
  sfxGain: GainNode
  sawA: OscillatorNode
  sawB: OscillatorNode
  droneLowpass: BiquadFilterNode
  droneGain: GainNode
  whineOsc: OscillatorNode
  whineGain: GainNode
  engineBand: BiquadFilterNode
  engineNoiseGain: GainNode
  /** 2 s of white noise, looped for engine breath and reused for impact bursts. */
  noiseBuffer: AudioBuffer
}

export class GameAudio {
  private readonly menuEl: HTMLAudioElement
  private readonly runEl: HTMLAudioElement
  private graph: AudioGraph | null = null
  /** Which track should be audible right now. */
  private music: 'off' | 'menu' | 'run' = 'off'
  private menuFadeTimer: number | undefined
  private runFadeTimer: number | undefined
  private gestureArmed = false
  private _musicVolume: number
  private _sfxVolume: number

  constructor(musicVolume = DEFAULT_MUSIC_VOLUME, sfxVolume = DEFAULT_SFX_VOLUME) {
    this._musicVolume = clamp01(musicVolume)
    this._sfxVolume = clamp01(sfxVolume)
    this.menuEl = new Audio(menuMusicUrl)
    this.runEl = new Audio(runMusicUrl)
    for (const el of [this.menuEl, this.runEl]) {
      el.loop = true
      el.preload = 'auto'
    }
  }

  get musicVolume(): number {
    return this._musicVolume
  }

  get sfxVolume(): number {
    return this._sfxVolume
  }

  /** Live volume changes (0..1) from the Settings sliders. */
  setMusicVolume(v: number): void {
    this._musicVolume = clamp01(v)
    if (this.graph) {
      this.graph.musicGain.gain.setTargetAtTime(this._musicVolume, this.graph.ctx.currentTime, 0.05)
    }
  }

  setSfxVolume(v: number): void {
    this._sfxVolume = clamp01(v)
    if (this.graph) {
      const t = this.graph.ctx.currentTime
      this.graph.sfxGain.gain.setTargetAtTime(this._sfxVolume, t, 0.05)
      this.graph.engineVol.gain.setTargetAtTime(this._sfxVolume, t, 0.05)
    }
  }

  /** Start a run: menu track out, soundtrack from the top, engine at zero. */
  begin(): void {
    this.music = 'run'
    const g = this.ensure()
    if (g.ctx.state === 'suspended') void g.ctx.resume()
    this.fadeOutTrack('menu', 0.25)
    window.clearTimeout(this.runFadeTimer) // a pending death-fade would pause the fresh track
    g.runTrackGain.gain.cancelScheduledValues(g.ctx.currentTime)
    g.runTrackGain.gain.setValueAtTime(1, g.ctx.currentTime)
    this.runEl.currentTime = 0
    void this.runEl.play().catch(() => {}) // autoplay veto — stay silent
    this.setEngine(0)
  }

  /** Freeze all sound with the pause menu (tracks hold their position). */
  pause(): void {
    if (this.graph) void this.graph.ctx.suspend()
    this.menuEl.pause()
    this.runEl.pause()
  }

  resume(): void {
    if (this.graph) void this.graph.ctx.resume()
    if (this.music === 'run') void this.runEl.play().catch(() => {})
    else if (this.music === 'menu') void this.menuEl.play().catch(() => {})
  }

  /** Death: ease the soundtrack away; the engine winds down per-frame with the coast. */
  death(): void {
    this.music = 'off'
    this.fadeOutTrack('run', FADE_DEATH)
  }

  /**
   * Main menu (and its sub-views): run music out, menu ambience on. At boot no
   * gesture has happened yet, so arm a one-shot listener and start it then.
   */
  menu(): void {
    this.music = 'menu'
    if (!this.graph) {
      this.armGestureStart()
      return
    }
    if (this.graph.ctx.state === 'suspended') void this.graph.ctx.resume()
    this.fadeOutTrack('run', FADE_MENU)
    this.setEngine(0)
    this.playMenuTrack()
  }

  /**
   * Drive the engine: 0 = off, 1 = full throttle at the game's top speed. The
   * saw-pair drone and the intake whine both climb with the level, so the caller
   * gets the rising launch whine and the post-death wind-down by ramping this.
   */
  setEngine(level: number): void {
    if (!this.graph) return
    const g = this.graph
    const l = clamp01(level)
    const t = g.ctx.currentTime
    const s = ENGINE_SMOOTH
    // Drone: detuned saw pair through a lowpass — the tonal core; the slow
    // beating between the two reads as machinery.
    const base = 40 + 120 * l
    g.sawA.frequency.setTargetAtTime(base, t, s)
    g.sawB.frequency.setTargetAtTime(base * 1.007, t, s)
    g.droneLowpass.frequency.setTargetAtTime(250 + 1100 * l * l, t, s)
    g.droneGain.gain.setTargetAtTime(0.2 * Math.pow(l, 1.2), t, s)
    // Whine: the compressor tone sweeping up with RPM — the jet-intake cue.
    g.whineOsc.frequency.setTargetAtTime(250 + 1950 * l * l, t, s)
    g.whineGain.gain.setTargetAtTime(0.05 * l * l, t, s)
    // Breath: a little filtered noise so the tone isn't sterile.
    g.engineBand.frequency.setTargetAtTime(150 + 900 * l * l, t, s)
    g.engineNoiseGain.gain.setTargetAtTime(0.12 * Math.pow(l, 1.4), t, s)
  }

  /** One asteroid hit: pitch-dropping thump + noise crunch, ducking the mix under it. */
  impact(): void {
    if (!this.graph || this.graph.ctx.state !== 'running') return
    const { ctx, sfxGain, duck, noiseBuffer } = this.graph
    const t = ctx.currentTime

    // Dip music + engine so the transient reads even at equal volume settings.
    duck.gain.cancelScheduledValues(t)
    duck.gain.setValueAtTime(duck.gain.value, t)
    duck.gain.linearRampToValueAtTime(DUCK_LEVEL, t + 0.03)
    duck.gain.setTargetAtTime(1, t + 0.15, DUCK_RECOVERY)

    const thump = ctx.createOscillator()
    thump.type = 'sine'
    thump.frequency.setValueAtTime(150, t)
    thump.frequency.exponentialRampToValueAtTime(35, t + 0.22)
    const thumpGain = ctx.createGain()
    thumpGain.gain.setValueAtTime(1.6, t)
    thumpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.25)
    thump.connect(thumpGain).connect(sfxGain)
    thump.start(t)
    thump.stop(t + 0.3)

    const crunch = ctx.createBufferSource()
    crunch.buffer = noiseBuffer
    const crunchFilter = ctx.createBiquadFilter()
    crunchFilter.type = 'lowpass'
    crunchFilter.frequency.setValueAtTime(1600, t)
    crunchFilter.frequency.exponentialRampToValueAtTime(250, t + 0.18)
    const crunchGain = ctx.createGain()
    crunchGain.gain.setValueAtTime(1.2, t)
    crunchGain.gain.exponentialRampToValueAtTime(0.001, t + 0.2)
    crunch.connect(crunchFilter).connect(crunchGain).connect(sfxGain)
    crunch.start(t, Math.random() * 1.5) // a random slice of the noise loop
    crunch.stop(t + 0.25)
  }

  /** Settings preview: make sure the graph exists, then play a sample impact. */
  previewImpact(): void {
    const g = this.ensure()
    void g.ctx.resume().then(() => this.impact())
  }

  /** Ramp the menu track in and start it (context must exist). */
  private playMenuTrack(): void {
    const g = this.graph
    if (!g) return
    window.clearTimeout(this.menuFadeTimer)
    const gain = g.menuTrackGain.gain
    gain.cancelScheduledValues(g.ctx.currentTime)
    gain.setValueAtTime(gain.value, g.ctx.currentTime)
    gain.linearRampToValueAtTime(1, g.ctx.currentTime + MENU_TRACK_FADE_IN)
    void this.menuEl.play().catch(() => this.armGestureStart())
  }

  /** Fade one track's gain to 0 and pause its element once inaudible. */
  private fadeOutTrack(track: 'menu' | 'run', seconds: number): void {
    if (!this.graph) return
    const g = this.graph
    const node = track === 'menu' ? g.menuTrackGain : g.runTrackGain
    const el = track === 'menu' ? this.menuEl : this.runEl
    node.gain.cancelScheduledValues(g.ctx.currentTime)
    node.gain.setValueAtTime(node.gain.value, g.ctx.currentTime)
    node.gain.linearRampToValueAtTime(0, g.ctx.currentTime + seconds)
    const timer = window.setTimeout(() => el.pause(), seconds * 1000 + 60)
    if (track === 'menu') {
      window.clearTimeout(this.menuFadeTimer)
      this.menuFadeTimer = timer
    } else {
      window.clearTimeout(this.runFadeTimer)
      this.runFadeTimer = timer
    }
  }

  /** Boot path: no gesture yet, so start the menu music on the first one. */
  private readonly onFirstGesture = (): void => {
    this.gestureArmed = false
    window.removeEventListener('pointerdown', this.onFirstGesture)
    window.removeEventListener('keydown', this.onFirstGesture)
    if (this.music === 'menu') {
      const g = this.ensure()
      if (g.ctx.state === 'suspended') void g.ctx.resume()
      this.playMenuTrack()
    }
  }

  private armGestureStart(): void {
    if (this.gestureArmed) return
    this.gestureArmed = true
    window.addEventListener('pointerdown', this.onFirstGesture)
    window.addEventListener('keydown', this.onFirstGesture)
  }

  private ensure(): AudioGraph {
    if (this.graph) return this.graph
    const ctx = new AudioContext()

    const master = ctx.createGain()
    master.gain.value = MASTER_GAIN
    master.connect(ctx.destination)

    const duck = ctx.createGain()
    duck.gain.value = 1
    duck.connect(master)

    const musicGain = ctx.createGain()
    musicGain.gain.value = this._musicVolume
    musicGain.connect(duck)
    const menuTrackGain = ctx.createGain()
    menuTrackGain.gain.value = 0
    menuTrackGain.connect(musicGain)
    ctx.createMediaElementSource(this.menuEl).connect(menuTrackGain)
    const runTrackGain = ctx.createGain()
    runTrackGain.gain.value = 0
    runTrackGain.connect(musicGain)
    ctx.createMediaElementSource(this.runEl).connect(runTrackGain)

    const engineVol = ctx.createGain()
    engineVol.gain.value = this._sfxVolume
    engineVol.connect(duck)
    const sfxGain = ctx.createGain()
    sfxGain.gain.value = this._sfxVolume
    sfxGain.connect(master) // impacts skip the duck — they're what ducks the rest

    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

    // Engine voices run forever; setEngine() only moves gains/frequencies.
    const sawA = ctx.createOscillator()
    sawA.type = 'sawtooth'
    sawA.frequency.value = 40
    const sawB = ctx.createOscillator()
    sawB.type = 'sawtooth'
    sawB.frequency.value = 40
    const droneLowpass = ctx.createBiquadFilter()
    droneLowpass.type = 'lowpass'
    droneLowpass.frequency.value = 250
    const droneGain = ctx.createGain()
    droneGain.gain.value = 0
    sawA.connect(droneLowpass)
    sawB.connect(droneLowpass)
    droneLowpass.connect(droneGain).connect(engineVol)
    sawA.start()
    sawB.start()

    const whineOsc = ctx.createOscillator()
    whineOsc.type = 'sine'
    whineOsc.frequency.value = 250
    const whineGain = ctx.createGain()
    whineGain.gain.value = 0
    whineOsc.connect(whineGain).connect(engineVol)
    whineOsc.start()

    const noise = ctx.createBufferSource()
    noise.buffer = noiseBuffer
    noise.loop = true
    const engineBand = ctx.createBiquadFilter()
    engineBand.type = 'bandpass'
    engineBand.frequency.value = 150
    engineBand.Q.value = 1.4
    const engineNoiseGain = ctx.createGain()
    engineNoiseGain.gain.value = 0
    noise.connect(engineBand).connect(engineNoiseGain).connect(engineVol)
    noise.start()

    this.graph = {
      ctx,
      duck,
      musicGain,
      menuTrackGain,
      runTrackGain,
      engineVol,
      sfxGain,
      sawA,
      sawB,
      droneLowpass,
      droneGain,
      whineOsc,
      whineGain,
      engineBand,
      engineNoiseGain,
      noiseBuffer,
    }
    return this.graph
  }
}
