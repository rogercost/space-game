---
name: verify
description: Build, launch, and drive Starvoid headlessly to verify changes at the real surface (browser + CDP)
---

# Verifying Starvoid changes

## Build / launch

```bash
npm run build          # tsc --noEmit + vite build (typecheck gate)
npm run dev            # dev server on http://localhost:5173
google-chrome --headless=new --remote-debugging-port=9222 \
  --user-data-dir=<scratch>/chrome-profile --no-first-run \
  --window-size=1280,800 about:blank
```

## Drive over CDP (no deps)

Node 22's global `WebSocket` talks CDP directly — no puppeteer. Get the page
target from `http://localhost:9222/json`, connect to its
`webSocketDebuggerUrl`, then use `Runtime.evaluate` (returnByValue),
`Input.dispatchMouseEvent` / `dispatchKeyEvent`, and `Page.captureScreenshot`.
See a past session's driver for the full pattern (sends `{id, method, params}`,
matches responses by id).

Key points:

- **Use `Input.dispatch*` for anything gesture-gated** (AudioContext creation,
  `musicEl.play()`): CDP input is trusted; synthetic `el.click()` is not.
- Find buttons by text: `[...document.querySelectorAll('button')]
  .find(b => b.textContent.trim() === 'LAUNCH' && b.checkVisibility())`
  (`offsetParent` lies for fixed-position elements — use `checkVisibility()`).
- Space pauses/resumes; the app state machine lives in `main.ts` (`screen`).
- Live-tuning handles on `window`: `flight`, `field`, `game`, `audio`, `ui`, …
  TS-private fields are readable at runtime: `audio['graph']`, `audio['musicEl']`.

## Useful flows

- **Force quick deaths** (real collision path, not `game.hit()`): shrink the
  field around the ship via `field.cfg` — e.g. `minScale=120; maxScale=180;
  spawnNear=60; spawnFar=140; despawnFar=250` recycles every rock into point-
  blank range next frame. Restore defaults after (`20/60/500/1100/1200`);
  to purge giant rocks fast, temporarily set `despawnFar=100` for a frame.
- **Audio assertions**: sample `audio['graph']` node params
  (`engineBand.frequency.value`, `engineNoiseGain.gain.value`,
  `musicGain.gain.value`, `ctx.state`) plus `audio['musicEl'].paused` /
  `.currentTime`. Engine cruise targets derive from level `l = speed/78`:
  band `60+840l²`, noise gain `0.5·l^1.4`, osc `24+130l`.
  Count impact SFX by wrapping: `const o = audio.impact.bind(audio);
  audio.impact = () => { window.__impacts++; o() }`.

## Tilt steering (virtual sensors)

`tilt.ts` can be driven headlessly with CDP virtual sensors — run
`scripts/tilt-verify.mjs` (dev server + headless Chrome up first); its design
math has an offline check in `scripts/tilt-math-check.mjs` (pure simulation,
needs nothing running). The traps, in order hit:

- The support gate needs `(hover: none) and (pointer: coarse)`: patch
  `window.matchMedia` via `Page.addScriptToEvaluateOnNewDocument` before load.
- `Browser.grantPermissions {permissions: ['sensors']}` first, or every
  sensor `start()` fails with `NotReadableError: Could not connect to a sensor`.
- `Emulation.setSensorOverrideEnabled {type: 'gravity' | 'relative-orientation'}`
  **before** the page constructs sensors, then `setSensorOverrideReadings`
  (`{xyz:{x,y,z}}` / `{quaternion:{x,y,z,w}}`). Overrides are **CDP-session-
  scoped**: they vanish when your WebSocket closes (live sensors then error and
  tilt falls back), so one connection must own the whole run.
- Virtual sensors emit `reading` only when the reading *changes*. A held pose
  delivers one event and the stability-gated calibration never advances — keep
  re-sending the pose with sub-deadzone jitter (~±0.002 m/s²) every ~40 ms.
- Model poses as device→world quaternions with world Z up; the gravity reading
  is the "up" vector in device coords, `q⁻¹·(0,0,9.8)` (flat face-up ⇒ z=+9.8).
  Upright portrait facing the user is `Rx(90°)`; a 40°-reclined grip `Rx(50°)`.
- Fallback tiers are testable: disable the `relative-orientation` override →
  gravity-tangent pitch; disable `gravity` too → the page's GravitySensor
  errors into the devicemotion path, which accepts *synthetic*
  `new DeviceMotionEvent('devicemotion', {accelerationIncludingGravity})`
  dispatched on an interval (the handler only reads data fields).
- `steering.tiltDebug` (also the `tilt` line on the M stats panel) exposes
  source + calibration state + unit gravity + outputs for assertions.

## Gotchas

- Headless Chrome renders via SwiftShader (software GL). Heavy scenes (many
  huge rocks) drop to ~1–2 fps; the `dt ≤ 0.05` clamp then stretches *game*
  time far beyond wall time — poll for state (`game.dead`) with generous
  budgets instead of assuming wall-clock durations, and expect
  `Runtime.evaluate` itself to lag while the main thread is saturated.
- Boot leaves `audio['graph'] === null` by design (autoplay policy); it exists
  only after the first trusted gesture.
