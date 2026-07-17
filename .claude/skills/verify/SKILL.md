---
name: verify
description: Build, launch, and drive Starship 3D headlessly to verify changes at the real surface (browser + CDP)
---

# Verifying Starship 3D changes

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

## Gotchas

- Headless Chrome renders via SwiftShader (software GL). Heavy scenes (many
  huge rocks) drop to ~1–2 fps; the `dt ≤ 0.05` clamp then stretches *game*
  time far beyond wall time — poll for state (`game.dead`) with generous
  budgets instead of assuming wall-clock durations, and expect
  `Runtime.evaluate` itself to lag while the main thread is saturated.
- Boot leaves `audio['graph'] === null` by design (autoplay policy); it exists
  only after the first trusted gesture.
