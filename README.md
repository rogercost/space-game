# Starship 3D

An endless 3D asteroid-dodging game built with [three.js](https://threejs.org/) and
TypeScript — a full-3D reimagining of the Scratch game
[**Starship**](https://scratch.mit.edu/projects/818748698) by *-PinPoint-*.

You pilot a ship that always thrusts forward through an ever-denser asteroid field.
Steer with the mouse, dodge the rocks, survive as long as you can. Your survival
time is the score.

---

## Quick start

Requires Node.js (18+) and npm.

```bash
npm install      # install dependencies (three, vite, typescript)
npm run dev      # start the dev server (hot reload) -> http://localhost:5173
npm run build    # typecheck (tsc) + production bundle into dist/
npm run preview  # serve the production build locally
```

### Controls

| Input | Action |
| --- | --- |
| **Mouse** | Steer — offset from screen center sets pitch/yaw. Dead-center = fly straight. |
| **Space** | Pause / resume (freezes the world, keeps rendering — handy for screenshots). |
| **C** | Toggle debug collider spheres (green = asteroids, cyan = ship). |
| **M** | Toggle the debug stats panel (time, speed, density, distance, fps). |
| **R** | Restart the run. |

---

## New-developer guide

### Architecture at a glance

The app is a single-page three.js scene driven by a delta-time `requestAnimationFrame`
loop. There's no framework and no global state container — just small modules, each owning
one concern, wired together in `main.ts`.

| File | Responsibility |
| --- | --- |
| `src/main.ts` | Orchestrator: renderer, scene, camera, lights, the game loop, HUD/overlays, input wiring, collision handling, the difficulty ramp, and restart. |
| `src/flight.ts` | `Flight` — the mouse-steered forward-flight physics (turn rates with inertia, drift, banking). Owns the ship's transform. |
| `src/input.ts` | `createPointer()` — normalizes mouse position to `[-1, 1]` from screen center. |
| `src/ship.ts` | `createShip()` — builds the placeholder low-poly ship from primitives. |
| `src/asteroids.ts` | Procedural asteroid generation **and** the `AsteroidField` (pool, spawn/recycle, density, two-phase collision, debug spheres). |
| `src/starfield.ts` | `createStarfield()` / `updateStarfield()` — the infinite wrapping starfield with a GPU near-fade. |
| `src/game.ts` | `Game` (health, invulnerability, death, score) and `Shake` (trauma-based camera shake). |

`plan.md` documents the phased build history and the asteroid/collision design in depth —
read it for the *why* behind the geometry code.

### Key design decisions

- **Mouse-steered forward flyer.** The ship always thrusts along its nose; the mouse sets
  target yaw/pitch *rates* (so you can turn continuously, even loop). Velocity lags the
  heading for a drifty, inertial feel. See `Flight` in `flight.ts`.
- **Heading vs. bank are separate.** `Flight.heading` is a quaternion carrying yaw + pitch
  only (no roll). It drives both flight direction and the chase camera. Banking is applied
  as a *visual-only* roll on top, so the horizon never rolls and the camera never gimbal-flips.
- **Spheres are the source of truth for asteroids.** Each rock is defined by 1–3 spheres;
  the visible mesh is the iso-surface of their smooth union, extracted by **marching
  tetrahedra** (`asteroids.ts`). Because the mesh is *derived from* the spheres, the
  colliders always match what you see.
- **Two-phase collision.** Broadphase against each asteroid's bounding sphere, then
  narrowphase against its 1–3 collider sub-spheres (inset slightly so grazes favor the
  player). The knockback pushes the ship away from the exact lump it struck.
- **Infinite starfield.** Stars live in a cube that wraps around the ship (so you never run
  out), with a GPU per-vertex alpha fade so close stars dissolve instead of becoming big
  bright squares.
- **Difficulty ramps ∝ √score**, mirroring the original Scratch game's density curve.

### Coding conventions

- **TypeScript, strict mode, ES modules.** No semicolons, single quotes, 2-space indent
  (Prettier-style). `npm run build` runs `tsc --noEmit` and will fail on type errors.
- **Naming:** `camelCase` for functions/variables, `PascalCase` for classes and types,
  `UPPER_SNAKE_CASE` for module-level tuning constants, and a leading underscore
  (`_tmp`, `_rel`) for reused scratch objects and private class fields.
- **Factories vs. classes:** stateless builders are `createX()` factory functions
  (`createShip`, `createStarfield`, `createPointer`); stateful systems are classes
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

- Mouse-steered inertial flight with banking and a smoothed trailing chase camera.
- Procedural, sphere-derived asteroids (round rocks, peanuts, clovers, and rare giants)
  with per-rock tumble and drift, streamed in a forward-biased field that recycles as you fly.
- Watertight marching-tetrahedra meshing with directional surface noise (no artifacts).
- Two-phase sphere collision with player-favored colliders and directional knockback.
- 3 health, brief post-hit invulnerability (with ship flicker), camera shake on impact.
- Survival-time score (mm:ss) with a persistent best (`localStorage`), a death screen, and
  an `M`-key debug stats panel (speed, density, fps, …).
- Difficulty ramp: field density and ship speed rise with distance.
- Depth fog, a parallax infinite starfield with near-fade, pause, and collider debug view.

---

## Roadmap / next steps

Near-term polish and features, roughly in priority order:

### Presentation & UX
- **Black-and-white visual identity.** Move the UI to a clean, white font on a monochrome
  palette; tighten the HUD and overlays to match.
- **Start screen.** A title screen with **Play**, **Options**, and (later) high-scores;
  the game should boot here rather than straight into flight.
- **Launch sequence.** Once **Play** is pressed, play a short "launch" animation
  (hold on the pad, ignition, acceleration into the field) before control is handed over.

### Ship & effects
- **Fighter-jet ship.** Replace the placeholder with a gray, futuristic fighter-jet look —
  source a low-poly glTF asset or model it procedurally in `ship.ts`.
- **Thrust trail.** A glowing exhaust trail behind the ship (ribbon/particles), reacting to
  speed and steering.
- **Impact particles & FOV kick** on collisions for extra game-feel.

### Audio
- **Chiptune soundtrack, synthesized in-browser** via the Web Audio API using native
  oscillator/synth waveforms (no audio files) — an arrangement inspired by
  *Apogee Software's* **Raptor: Call of the Shadows** (1994). Add SFX (thrust, impact,
  death) through the same synth path.

### Content & meta (from the original)
- **Ship select** and the original's **7 ships**, each tuned by its four stats
  (`mouse_speed` / `turning` / `speed` / `drift`) — the `Flight` config already models these.
- **Online leaderboard** to replace the Scratch cloud-variable scoreboard (needs a small
  backend).

> The four ship stats and the density curve in the original are 2-D per-frame constants;
> treat them as starting ratios and tune by feel in 3-D.
