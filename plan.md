# Starvoid — Build Plan

## Overview

A full-3D reimagining of the Scratch game **"Starship"** by -PinPoint-
(https://scratch.mit.edu/projects/818748698), built with **TypeScript + Vite + three.js**.

The original is a top-down 2D endless asteroid-dodger where *altitude = score*, steered with
the mouse using inertial (drifty) movement, with 7 selectable ships and cloud leaderboards.
We reinterpret it as a **3D mouse-steered forward flyer** (Star Fox / tunnel-runner): you
always thrust forward, the mouse aims pitch/yaw, the ship banks into turns, and **survival
time is the score**.

## Locked design decisions

- **Approach:** full 3D reimagining (not a faithful 2.5D port).
- **Controls:** mouse-steered forward flyer. Constant forward thrust along the ship's nose;
  mouse position (offset from screen center) sets a target pitch/yaw; the ship rotates toward
  it with inertia; visual bank/roll into turns. No stopping or reversing.
- **Score:** survival time, displayed as `mm:ss`. (Distance travelled is kept as an
  internal value that drives the difficulty ramp.)
- **Health:** 3. A collision knocks the ship back, shakes the camera, and grants brief
  invulnerability; 0 health = death.
- **Ships (later):** the original's 7 ships are tuned by `mouse_speed` / `turning` / `speed` /
  `drift`. v1 uses one ship. The original's numbers are 2D per-frame constants — we use them as
  starting ratios and tune by feel in 3D.
- **Stack:** TypeScript, Vite, three.js (npm).
- **v1 scope:** core loop only (fly, dodge, score, die, restart). No menu / ship-select /
  online leaderboard yet.

## Asteroid + collision design

Asteroids are generated **from a set of spheres** — the spheres are the source of truth and the
visible mesh is derived from them — so the collider always matches what is drawn (no phantom
hits in empty space).

- Each asteroid = a union of **1–3 spheres**:
  - **heterogeneous radii** (each sphere has its own random size);
  - center-to-center distance ranges from **0** (fully concentric) up to **r1 + r2** (just
    touching) — the spheres are never separated;
  - 1 sphere → round rock, 2 → peanut, 3 → clover / lumpy.
- **Mesh generation:** displace an icosphere's vertices outward to the union surface
  (max-of-spheres / metaball field), plus small surface noise for craggy detail.
- **Tumble + drift:** each asteroid spins and drifts slowly.

**Collision (two-phase):**

- The ship is approximated as a **single sphere**, sized slightly *smaller* than its visual hull
  (grazes resolve in the player's favor).
- **Broadphase:** one bounding sphere per asteroid rejects every asteroid not near the ship.
- **Narrowphase:** for the few that pass, test the ship sphere against the asteroid's 1–3
  collider sub-spheres (set ~5–10% inside the visual surface).
- **Response:** on the first contacting sub-sphere, push the ship back along the contact normal
  (sub-sphere center → ship), shake the camera, decrement health, grant brief invulnerability +
  flicker.
- A **debug toggle** draws the collider spheres to verify mesh/collider correspondence.

Out of scope for v1: hollow asteroids, fly-through gaps, concave obstacles, and exact
mesh / convex-decomposition collision.

## Build phases

Every phase ends with something runnable in the browser via `npm run dev`. Validate it, then
move to the next phase.

### Phase 1 — Scaffold & render loop
Vite + TS + three project. Full-screen canvas, window-resize handling, a delta-time render loop,
and a lit reference object (a rotating shaded icosphere — also previews our asteroid shading).
**Test:** `npm run dev` → a rotating, lit grey rock on a near-black background; resizing the
window keeps it centered and undistorted.

### Phase 2 — Space scene
Perspective camera, ambient + directional lighting, a parallax **starfield** (points), distance
**fog**, a space background, and a **placeholder ship** mesh at the origin (static).
**Test:** a ship sits in space surrounded by a deep starfield that fades into fog. No movement
yet — this is a look/atmosphere checkpoint.

### Phase 3 — Flight + chase camera (the "feel")
Mouse-steered forward flight: constant thrust, mouse → target pitch/yaw, inertial turning,
banking roll, velocity with drift. Chase camera with position/aim smoothing and look-ahead.
**Test:** move the mouse to steer; the ship banks and turns and flies forward through the
starfield; the camera trails smoothly. Key feel checkpoint — expect to tune
responsiveness/inertia here.

### Phase 4 — Procedural asteroids + field streaming
The sphere-derived asteroid generator (1–3 heterogeneous spheres → mesh), tumble + drift, and a
pool of asteroids spawned in a volume ahead of the ship and recycled once behind. Debug toggle to
show the generating spheres.
**Test:** flying forward, a believable asteroid field streams toward and past you; rocks vary
(round / peanut / lumpy) and tumble; you currently pass through them (no collision yet).

### Phase 5 — Collisions, health, death
Two-phase sphere collision (broadphase bounding sphere → narrowphase sub-spheres), knockback,
camera shake, invulnerability flicker, 3 health, death state. Debug toggle to draw collider
spheres.
**Test:** fly into asteroids → knockback + shake + health drops; near-misses past the waist of a
peanut do **not** register (collider matches the shape); 3 hits → death.

### Phase 6 — Score, HUD, restart, difficulty ramp
Survival-time score + health pips (DOM overlay), field density/speed ramp with distance, death screen,
restart (key/click resets state). Completes the v1 core loop.
**Test:** full loop — fly, watch the score climb, dodge an increasingly dense field, die, see the
final score, restart cleanly.

### Phase 7 — Feel polish (optional, post-v1)
Motion trail behind the ship, impact particle bursts, speed-based FOV kick, optional sound.
Layered on only once the core loop feels good.

### Phase 8 — App shell: main menu, pause UI, leaderboard (post-v1)
The game boots to a **main menu** (Launch / Settings / Leaderboard) via an explicit app state
machine (`menu` → `playing` ⇆ `paused`, `playing` → `dead`); the 3D scene renders behind every
screen (the field drifts as an attract-mode backdrop on the menu). A **pause menu** (Continue /
Restart / Main Menu) plus an on-screen ⏸ button make it playable with a mouse or a touchscreen —
Space still pauses, and the restart *key* is gone (restart lives on the pause/death menus). On
death the player enters a name and is recorded on an in-memory `Leaderboard` (top 10, seeded).
All DOM moves into a `UI` class (`ui.ts`) that `main.ts` drives via `showX()` calls + per-frame
setters and wires through a `UIHandlers` callbacks object; `Leaderboard` (`leaderboard.ts`) keeps
`add()` / `entries` as its only surface so durable storage can slot in behind them later.
Settings is a placeholder for now (sound sliders arrive with the audio work).
**Test:** boot → menu; Launch → fly; ⏸ or Space → pause menu → Continue / Restart / Main Menu;
die → name entry → see rank; the Leaderboard view lists the new score.

## Tooling notes

- `npm run dev` — dev server with hot reload.
- `npm run build` — typecheck + production bundle.
- Original art (ship sprites, sky gradients, asteroid textures) is extractable from Scratch's
  asset CDN if we later want models/textures resembling the original.
