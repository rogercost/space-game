# Starship 3D

An endless 3D asteroid-dodging game built with [three.js](https://threejs.org/) and
TypeScript — a full-3D reimagining of the Scratch game
[**Starship**](https://scratch.mit.edu/projects/818748698) by *-PinPoint-*.

[**Play Starvoid online.**](https://starvoid.stevensapps.workers.dev)

You pilot a ship that always thrusts forward through an ever-denser asteroid field.
Steer with the mouse or by dragging on a touchscreen, dodge the rocks, and survive as
long as you can. Your survival time is the score.

---

## Quick start

Requires Node.js (18+) and npm.

```bash
npm install      # install dependencies (three, vite, typescript, wrangler)
npm run dev      # start the dev server (hot reload) -> http://localhost:5173
npm run build    # typecheck (tsc, client + worker) + production bundle into dist/
npm run preview  # serve the production build locally
npm run dev:worker  # build + run the full stack (worker + local D1) -> http://localhost:8787
npm run deploy   # build + deploy the Worker (assets + API) to Cloudflare
```

Plain `npm run dev` has no `/api` routes, so the leaderboard silently runs on its
in-memory seed data — persistence is exercised via `npm run dev:worker` or in prod.

### Controls

| Input | Action |
| --- | --- |
| **Mouse** | Steer — offset from screen center sets pitch/yaw. Dead-center = fly straight. |
| **Touchscreen** | Steer while dragging. Lift your finger to fly straight. |
| **Space** or **⏸** | Pause / resume. The on-screen ⏸ button (top center) lets you pause with only a mouse or a touchscreen. |
| **T** or **↔** | Toggle calibrated tilt steering when device-orientation sensors are supported. |
| **F** or **⛶** | Toggle browser fullscreen when the Fullscreen API is supported. |
| **C** | Toggle debug collider spheres (green = asteroids, cyan = ship). |
| **M** | Toggle the debug stats panel (time, speed, density, collisions, fps). |

The game boots to a **main menu** (Launch / Settings / Leaderboard). Restart lives on the
**pause menu** (Space → Restart) and the death screen — there is no restart key.
**Settings** holds the music and SFX volume sliders (persisted to `localStorage`; releasing
the SFX slider plays a sample impact at the new volume).

---

## New-developer guide

### Architecture at a glance

The app is a single-page three.js scene driven by a delta-time `requestAnimationFrame`
loop. There's no framework and no global state container — just small modules, each owning
one concern, wired together in `main.ts`.

| File | Responsibility |
| --- | --- |
| `src/main.ts` | Orchestrator: renderer, scene, camera, lights, the game loop, the app state machine (`menu`/`launching`/`playing`/`paused`/`dead`), input wiring, collision handling, the difficulty ramp, and run flow (launch/pause/restart/death). |
| `src/flight.ts` | `Flight` — the pointer-steered forward-flight physics (turn rates with inertia, drift, banking). Owns the ship's transform. |
| `src/input.ts` | `createSteeringInput()` — combines normalized mouse/touch steering with optional, calibrated device-orientation tilt input. Touch temporarily overrides tilt while held. |
| `src/ship.ts` | `createShip()` — builds the low-poly fighter jet from primitives (pointed nose, tapered fuselage, delta wings, tail fin, canopy, gray engine cowling, and recessed orange interior). Returns an explicit nozzle anchor for the exhaust plus the materials flashed white on hit. |
| `src/trail.ts` | `Trail` — the ship's exhaust: emitted ballistic samples joined into a tapered, camera-facing ribbon. It leaves along the engine's aft axis even while the ship drifts, curves as the heading changes, and fades by age and camera distance. Additive blending keeps it bright without post-processing bloom. |
| `src/asteroids.ts` | Procedural asteroid generation **and** the `AsteroidField` (pool, spawn/recycle, density, ship↔rock collision, rock↔rock rigid-body physics, debug spheres). |
| `src/starfield.ts` | `createStarfield()` / `updateStarfield()` — the infinite wrapping starfield with a GPU near-fade. |
| `src/game.ts` | `Game` (health, invulnerability, death, score) and `Shake` (trauma-based camera shake). |
| `src/ui.ts` | `UI` — the whole DOM layer: the in-flight HUD (health, score, reticle, pause button, stats) and every full-screen overlay (main menu with Settings / Leaderboard sub-views, pause menu, and the death / name-entry screen). Holds no game state; `main.ts` drives it via `showX()` calls and per-frame setters, and buttons report back through callbacks. |
| `src/leaderboard.ts` | `Leaderboard` — top-10 high-score table with a synchronous in-memory cache (seeded) and optional persistence: `refresh()` pulls `/api/scores` into the cache when the API exists (deployed / `wrangler dev`), `add()` ranks locally right away and POSTs in the background. Under plain `vite dev` every fetch fails silently and the board is purely in-memory. |
| `worker/index.ts` | The deployed backend (Cloudflare Worker): serves `dist/` as static assets and implements `GET`/`POST /api/scores` against the D1 `scores` table (schema + seeds in `migrations/`). Config lives in `wrangler.jsonc`. |
| `src/audio.ts` | `GameAudio` — the Web Audio layer: two looping tracks (*The Quiet Arc* on the menu, *Sunlight at Apogee* in flight, bundled from `src/assets/`), a synthesized jet-engine voice (detuned saw drone + a whine that sweeps up with RPM + breath noise, all following one 0–1 level driven per-frame from ship state), impact thumps that briefly duck the rest of the mix, and the music/SFX buses behind the Settings sliders. The `AudioContext` is created lazily on the first user gesture to satisfy autoplay policies. |

`plan.md` documents the phased build history and the asteroid/collision design in depth —
read it for the *why* behind the geometry code.

### Key design decisions

- **Pointer-steered forward flyer.** The ship always thrusts along its nose; the mouse or
  active touch sets target yaw/pitch *rates* (so you can turn continuously, even loop).
  Velocity lags the heading for a drifty, inertial feel. See `Flight` in `flight.ts`.
- **Heading vs. bank are separate.** `Flight.heading` is a quaternion carrying yaw + pitch
  only (no roll). It drives both flight direction and the chase camera. Banking is applied
  as a *visual-only* roll on top, so the horizon never rolls and the camera never gimbal-flips.
- **Spheres are the source of truth for asteroids.** Each rock is defined by 1–3 spheres;
  the visible mesh is the iso-surface of their smooth union, extracted by **marching
  tetrahedra** (`asteroids.ts`). Because the mesh is *derived from* the spheres, the
  colliders always match what you see.
- **Ship–asteroid collision is two-phase.** Broadphase against each asteroid's bounding
  sphere, then narrowphase against its 1–3 collider sub-spheres (inset slightly so grazes
  favor the player). The knockback pushes the ship away from the exact lump it struck.
- **Asteroids also collide with each other,** as rigid bodies within a bubble around the
  ship: a restitution impulse (the bounce) plus a tangential-friction impulse that transfers
  spin, with mass ∝ radius³ so big rocks shrug off small ones. Resolving only near the ship
  keeps it a cheap per-frame O(k²) pass with no spatial index (a uniform grid is the escape
  hatch if the collision radius or density ever grows enough to matter).
- **Infinite starfield.** Stars live in a cube that wraps around the ship (so you never run
  out), with a GPU per-vertex alpha fade so close stars dissolve instead of becoming big
  bright squares.
- **Crisp additive exhaust.** The trail uses additive vertex colors rather than post-processing
  bloom. That keeps the plume bright while the orange engine interior, stars, rocks, and hull
  stay crisp, and avoids rendering the scene through a second composer. Tune it via the constants
  atop `trail.ts`.
- **Two music assets, synthesized SFX.** The menu ambience and the run soundtrack are bundled
  MP3s on per-track gains under one music bus; everything else (the engine, impacts) is
  synthesized on a small Web Audio graph in `audio.ts`. The engine is tonal — a detuned
  sawtooth drone plus a sine "intake whine" that sweeps up with RPM over light breath noise —
  driven by a single 0–1 level set per-frame from ship state: it spools up through the launch
  intro, creeps upward with the difficulty speed ramp, and winds down with the post-death
  coast. No SFX files, no timeline code. Impacts bypass and briefly dip a duck bus sitting
  under music + engine, so hits stay audible at any volume mix.
- **Difficulty ramps ∝ √(distance travelled)**, mirroring the original Scratch game's
  density curve.

### Coding conventions

- **TypeScript, strict mode, ES modules.** No semicolons, single quotes, 2-space indent
  (Prettier-style). `npm run build` runs `tsc --noEmit` and will fail on type errors.
- **Naming:** `camelCase` for functions/variables, `PascalCase` for classes and types,
  `UPPER_SNAKE_CASE` for module-level tuning constants, and a leading underscore
  (`_tmp`, `_rel`) for reused scratch objects and private class fields.
- **Factories vs. classes:** builders are exposed as `createX()` factory functions
  (`createShip`, `createStarfield`, `createSteeringInput`); stateful systems are classes
  (`Flight`, `AsteroidField`, `Game`, `Shake`).
- **No per-frame allocations in hot paths.** Reuse module- or instance-level scratch
  `Vector3`/`Quaternion` objects inside loops; only allocate at setup or on rare events.
- **Framerate independence.** Smoothing uses an exponential approach,
  `x += (target - x) * (1 - exp(-lambda * dt))`, not a fixed lerp factor. `dt` is clamped
  (≤ 0.05s) so a stutter can't teleport anything.
- **Live tuning.** Key objects are exposed on `window` in dev
  (`flight`, `field`, `scene`, `game`, `shake`, `starfield`, `ambient`, `keyLight`,
  `rimLight`). Example: `flight.cfg.driftResponse = 1.5`, `field.setCount(300)`,
  `scene.fog.density = 0.0014`. Most tunables also have named constants near the top of
  their module.

---

## Current features

- Mouse-, touch-, or optional phone-tilt-steered inertial flight with banking and a
  smoothed trailing chase camera, plus an in-game fullscreen toggle where supported.
- A low-poly **fighter jet** (delta wings, gray engine cowling, recessed orange interior)
  trailing a tapered, glowing exhaust plume that emits aft and curves through turns — with a
  short **launch intro** that raises the ship from below the viewport into flying position
  before control is handed over.
- Procedural, sphere-derived asteroids (round rocks, peanuts, and clovers)
  with per-rock tumble and drift, streamed in a forward-biased field that recycles as you fly.
- Watertight marching-tetrahedra meshing with directional surface noise (no artifacts).
- Two-phase ship↔asteroid collision with player-favored colliders and directional knockback.
- Asteroid↔asteroid rigid-body collisions — bounce plus friction-driven spin transfer, mass
  scaling with size — resolved in a ship-centered bubble, so the field jostles and scatters
  instead of drifting on rails.
- 3 health, post-hit invulnerability that flashes the ship white (never invisible), camera shake on impact.
- A **main menu** (Launch / Settings / Leaderboard) shown on boot over a drifting attract-mode
  field, an in-game **pause menu** (Continue / Restart / Main Menu), and an on-screen ⏸ button
  so the game is fully playable with just a mouse or a touchscreen.
- A **persistent leaderboard**: on death you enter a name and see the rank your run earned.
  Deployed, scores live in Cloudflare D1 behind `/api/scores`; locally (or offline) the same
  code falls back to an in-memory seeded board.
- **Audio**: *The Quiet Arc* plays over the main menu (starting on the first click/keypress,
  per autoplay rules) and *Sunlight at Apogee* loops during runs (restarts each launch, freezes
  with pause, fades out on death); a tonal jet-engine drone/whine rises from silence at launch
  and winds back down to nothing as the ship coasts after death; asteroid hits land with a
  synthesized thump that ducks the music/engine for a beat and stalls the engine to zero,
  which re-spools with the launch ease — with music/SFX volume sliders in Settings (persisted).
- Survival-time score (mm:ss) with a persistent best (`localStorage`), a death screen, and
  an `M`-key debug stats panel (speed, density, fps, …).
- Difficulty ramp: field density and ship speed rise with distance.
- Depth fog, a parallax infinite starfield with near-fade, a bright additive exhaust trail,
  pause, and collider debug view.

---

## Deployment (Cloudflare Workers + D1)

The game deploys as a single Cloudflare Worker (`wrangler.jsonc`): the `dist/` bundle is
served as static assets (free and unlimited on the free plan) and `worker/index.ts` handles
`/api/scores` against a D1 database. One-time setup:

```bash
npx wrangler login                                        # opens browser OAuth
npx wrangler d1 create starvoid-leaderboard               # prints a database_id
# -> paste the database_id into wrangler.jsonc
npx wrangler d1 migrations apply starvoid-leaderboard --remote   # create + seed the table
npm run deploy                                            # build + deploy; prints the URL
```

The first deploy may prompt to register your free `*.workers.dev` subdomain; after that the
game lives at `starvoid.<your-subdomain>.workers.dev`. Subsequent releases are just
`npm run deploy`. To test the full stack locally (worker + a local SQLite D1):

```bash
npx wrangler d1 migrations apply starvoid-leaderboard --local    # once
npm run dev:worker                                        # http://localhost:8787
```

---

## Roadmap / next steps

Near-term polish and features, roughly in priority order:

### Presentation & UX
- ~~**Black-and-white visual identity.**~~ *Settled* — staying with the current palette and
  HUD as they are; no dedicated monochrome restyle is planned.
- ~~**Start screen.**~~ *Done* — the game boots to a main menu with **Launch**, **Settings**
  (music/SFX volume sliders), and **Leaderboard**.
- ~~**Launch sequence.**~~ *Done (basic)* — pressing **Launch** raises the ship from below the
  viewport into flying position before handing over control. A richer sequence (pad hold, ignition,
  acceleration) could still be layered on.

### Ship & effects
- ~~**Fighter-jet ship.**~~ *Done* — a gray low-poly jet (pointed nose, tapered fuselage, delta
  wings, tail fin, canopy, gray engine cowling, recessed orange interior), modelled
  procedurally in `ship.ts`.
- ~~**Thrust trail.**~~ *Done* — a tapered additive exhaust ribbon built from emitted samples,
  curving through turns and fading by age and camera distance.
- ~~**Impact particles & FOV kick** on collisions~~ *Settled* — the current hit feedback
  (knockback, camera shake, white flash, impact sound) is enough; not planned.

### Audio
- ~~**Soundtrack & SFX.**~~ *Done* — the game bundles two tracks: **"The Quiet Arc"** loops
  over the main menu (and its Settings/Leaderboard sub-views), **"Sunlight at Apogee"** loops
  while a run is live (restarting at each launch, pausing with the pause menu, fading out on
  death; the pause menu itself is silent). SFX are synthesized in-browser via the Web Audio
  API: a jet-intake engine drone/whine that rises from zero through the launch, tracks the
  difficulty speed ramp, and falls back to zero as the ship coasts after death, plus a
  thump + crunch on asteroid impacts that briefly ducks everything else. Music and SFX volume
  sliders live in **Settings**, persisted to `localStorage`.

### Content & meta (from the original)
- **Ship select** and the original's **7 ships**, each tuned by its four stats
  (`mouse_speed` / `turning` / `speed` / `drift`) — the `Flight` config already models these.
- ~~**Persistent leaderboard.**~~ *Done* — scores persist in **Cloudflare D1** behind a tiny
  Worker API (`worker/index.ts`, `GET`/`POST /api/scores`), replacing the Scratch
  cloud-variable scoreboard. The client keeps a synchronous in-memory cache (optimistic local
  rank, background POST) and falls back to seeded in-memory scores when no API is reachable.

> The four ship stats and the density curve in the original are 2-D per-frame constants;
> treat them as starting ratios and tune by feel in 3-D.
