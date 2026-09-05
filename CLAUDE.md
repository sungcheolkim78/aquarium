# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"고요한 아쿠아리움" (Quiet Aquarium) — a static, backend-free, GPU-accelerated 3D aquarium web app (Three.js + WebGL2) meant to be calming to watch. Full requirements/design rationale live in `docs/SPEC.md` (Korean); high-level feature description is in `README.md`. All app code lives under `web/`.

## Commands

All commands run from `web/`:

```bash
npm install
npm run dev       # Vite dev server with HMR
npm run test      # vitest run (single run, not watch mode)
npm run build     # tsc --noEmit (type check) + vite build -> dist/
npm run preview   # serve the production build locally at :4173
```

- Run a single test file: `npx vitest run src/fish.test.ts`
- There is no lint script; type-checking happens via `tsc --noEmit` as part of `build`.
- Before considering a change to `web/` done, run `npm run build && npm run preview` and check the result — `npm run test`/`tsc` alone verify correctness, not the visual/perf feel that is central to this project.

## Architecture

Everything is client-side; there is no `api/` yet (planned for v2 only if server-side state is actually needed — see SPEC §5, roadmap). Six source files in `web/src/`, each with one responsibility:

- **`config.ts`** — the single source of truth for tunable data. `FISH_REGISTRY` is the data-driven species list (SPEC §6.1, N4): adding a fish species means appending one entry here, never touching rendering/behavior code. `SCENE` holds all other magic numbers (fog, bounds, camera drift, bubble/god-ray counts, adaptive-quality thresholds). When changing visual tuning, look here first before touching a renderer file.
- **`fish.ts`** — procedural low-poly fish geometry (`buildFishGeometry`, driven by `FishShape` from config) and the boid-style flocking simulation (`FishSchool`, `computeCentroid`, `containSteer`). Each species is rendered as one `InstancedMesh` (one draw call per species, SPEC N1). `createRng` is a small seeded PRNG used everywhere instead of `Math.random()` so scenes are reproducible; **always thread `rng` through instead of adding a new randomness source.**
- **`environment.ts`** — reef floor, coral, seaweed, god rays, and the caustics shader (`applyCaustics`) driven by a shared `TimeUniform`. Coral/floor geometry is merged (`mergeBaked`) into as few meshes as possible to respect the draw-call budget.
- **`particles.ts`** — CPU-driven rising bubble particle system (`createBubbles`), independent of `fish.ts`.
- **`ui.ts`** — loading overlay and the ambient ocean-wave sound, synthesized at runtime via Web Audio API (`AmbientAudio`) rather than an audio file; sound defaults muted per browser autoplay policy and is user-toggled.
- **`main.ts`** — the only entry point/composition root. Boots the `WebGLRenderer`, camera drift, and the render loop; wires together `environment`, `createSchools`, `bubbles`, and `ui`. Also owns the adaptive-quality state machine (SPEC N2): on sustained low FPS it first drops `resolutionScale`, then (if still low) shrinks fish population via `school.setPopulationScale`. Render loop is fully stopped on `document.hidden` and cleaned up on `pagehide`. Exposes `window.__aq = { calls, triangles }` as a manual QA hook for checking the draw-call/triangle budget (SPEC N1: <30 calls, <300k triangles).

### Performance budget (SPEC N1/N2) — keep in mind for any rendering change

- Draw calls < 30, triangles < 300k, fish population currently sums to 60 (`totalFishCount` in `config.ts`).
- DPR capped at `SCENE.quality.maxPixelRatio` (1.5–2).
- New instanced/merged geometry should follow the existing pattern (one draw call per species/feature) rather than adding per-object meshes.

### Testing

`fish.test.ts` covers procedural geometry generation and the boid simulation math (steering, centroid, containment) — the parts with real logic to break. `environment.ts`/`particles.ts`/`ui.ts` have no tests; they are mostly declarative scene construction.

## Deployment

Render.com static site, root `web/`, build `npm install && npm run build`, publish `dist/`. `render.yaml` at repo root is the Blueprint (IaC) equivalent of the dashboard config, including cache headers and SPA rewrite — keep both in sync if either changes.
