# Natural Fish Behavior Design

**Source:** `docs/DEVELOPMENT_PROPOSAL.md` §4.3 "자연스러운 물고기: 개체수보다 차이"

**Goal:** Make individual swim-locomotion creatures read as distinct, natural animals — not just re-colored copies of one boid — by extending the existing steering model with depth preference, a turn-rate cap, a burst-glide speed rhythm, per-species territoriality around real coral clusters, and simple obstacle avoidance. Population size is explicitly out of scope; this is about behavioral difference at the current 60-creature budget.

**Non-goals (explicit, per §4.3):**
- No population increase and no new large species; those wait until silhouette/behavior differentiation (this task, plus the prior shark/seahorse/turtle geometry pass) is validated.
- No exact per-triangle coral collision; avoidance uses one sphere per coral cluster.
- No CPU profiling deliverable — only a note on where the existing O(n²) separation loop sits, since scaling population further is future work gated on measurement.
- No resync of habitat anchors when `environment.rebuild()` regenerates coral at a new object-count scale (rare settings action); anchors are chosen once at school construction and may point at stale coordinates after a rebuild. Visually harmless — the pull is weak and the fish is still near real coral, just possibly not the closest one anymore.

## 1. Data flow: sharing coral cluster centers

`createCoral` (environment.ts) currently computes each cluster's `(baseX, baseZ)` as a local loop variable and bakes it straight into merged geometry — the positions are discarded. Extract:

```ts
export function computeCoralClusterCenters(rng: () => number, clusterCount: number): Vector3[]
```

`createCoral` calls this once and reuses the returned centers for its existing per-cluster placement loop (no behavior change to coral rendering). `Environment` (its return type) gains a `readonly coralClusterCenters: readonly Vector3[]` field, populated on construction and replaced (not mutated) inside `rebuild()`. `main.ts` reads `environment.coralClusterCenters` and passes it into `createSchools` as a new `CreateSchoolsOptions.coralClusterCenters` — environment is already constructed before schools in `main.ts`, so no reordering is needed.

Each coral cluster becomes one **avoidance sphere**: centered at `(x, SCENE.floorY + SCENE.coral.avoidanceHeight, z)` with a single fixed `SCENE.coral.avoidanceRadius`. ~22 clusters × ≤20 boids/species is trivial per frame (see §5).

## 2. New per-species behavior fields

Added to `CreatureDefinition.behavior` in `config.ts`, all optional (mirrors the existing `hoverAmplitude?`/`hoverFrequency?` pattern) so only swim-locomotion species need meaningful values and hover (seahorse) is untouched:

```ts
/** 0 = hugs the floor, 1 = hugs the surface. Swim locomotion only; default 0.5. */
readonly depthPreference?: number;
/** Max heading change per second, in radians. Swim locomotion only; default = uncapped. */
readonly maxTurnRate?: number;
/** 0..1: how deep the periodic speed dip goes. Swim locomotion only; default 0 (no rhythm, today's behavior). */
readonly rhythmAmplitude?: number;
/** Speed-dip cycles per second. Swim locomotion only; irrelevant if rhythmAmplitude is 0. */
readonly rhythmFrequency?: number;
/** 0..1: pull strength toward this individual's habitat anchor. Swim locomotion only; default 0 (today's free roam). */
readonly territoryStrength?: number;
```

`territoryStrength` is scoped to the three solitary reef fish already modeled as `schooling: false` — **yellow-tang, butterflyfish, purple-tang** — not to every `schooling: false` species; shark and turtle stay roaming (`territoryStrength` left undefined) since a patrolling predator or a sea turtle camped at one coral head would read as wrong, even though both happen to have `schooling: false` too. Schooling species (clownfish, blue-sea-bream, pink-cardinalfish) also keep `territoryStrength` undefined — the school's own cohesion already gives them a shared "place."

Illustrative starting values (tuned further by eye in `npm run preview`, not treated as exact):

| species | depthPreference | maxTurnRate (rad/s) | rhythmAmplitude / Frequency | territoryStrength |
|---|---|---|---|---|
| clownfish | 0.3 | 4.5 | 0.15 / 0.5 | — |
| blue-sea-bream | 0.55 | 3.2 | 0.15 / 0.5 | — |
| yellow-tang | 0.5 | 3.2 | 0.25 / 0.35 | 0.35 |
| butterflyfish | 0.45 | 3.2 | 0.25 / 0.35 | 0.4 |
| purple-tang | 0.5 | 3.2 | 0.25 / 0.35 | 0.3 |
| pink-cardinalfish | 0.4 | 4.5 | 0.15 / 0.5 | — |
| great-white-shark | 0.6 | 1.4 | 0.1 / 0.2 | — |
| green-sea-turtle | 0.65 | 1.1 | 0.3 / 0.25 | — |
| seahorse | — (hover) | — | — | — |

## 3. Steering additions (pure, testable functions in `fish.ts`)

```ts
/** Weak vertical pull toward a preferred depth band; 0 at depthPreference's exact target. */
export function depthBiasSteer(
  positionY: number,
  depthPreference: number,
  bounds: { readonly y: number },
  floorY: number,
  out = new Vector3(),
): Vector3

/** Rotates `current` (unit vector) toward `desired` (unit vector) by at most `maxRadians`. */
export function clampTurnRate(
  current: Vector3,
  desired: Vector3,
  maxRadians: number,
  out = new Vector3(),
): Vector3

/** Multiplier on target speed: dips to `1 - amplitude` and back once per `1/frequency` seconds. */
export function rhythmSpeedScale(
  elapsed: number,
  phase: number,
  amplitude: number,
  frequency: number,
): number

/** Sum of per-cluster horizontal+vertical push-away, zero inside no sphere. */
export function coralAvoidanceSteer(
  position: Vector3,
  clusterCenters: readonly Vector3[],
  avoidanceCenterY: number,
  avoidanceRadius: number,
  out = new Vector3(),
): Vector3
```

`clampTurnRate` uses `lerp` + `normalize` as a cheap approximate slerp (consistent with the rest of the file's simple-trig steering, not physically exact) — good enough at one frame's rotation.

Integration into `FishSchool.update`'s swim path: after summing the existing steer forces (cohesion, separation, wander, contain) plus the three new ones (depth bias, territory pull, coral avoidance), compute the candidate velocity as today, then clamp its **direction** against the previous frame's direction with `clampTurnRate(..., maxTurnRate * dt)` before the existing speed-matching step — which itself now targets `speed * rhythmSpeedScale(elapsed, boid.phase, rhythmAmplitude, rhythmFrequency)` instead of the flat `speed`.

Territory pull is simple enough to stay inline: `(boid.habitatAnchor - boid.position) * territoryStrength`.

## 4. Habitat anchors

`Boid` gains `readonly habitatAnchor: Vector3`, set once in `spawnBoid` alongside the existing `hoverOrigin` pattern:
- If `territoryStrength` is defined and the school was given cluster centers: pick one center via the school's own seeded `rng`, then offset it outward by `avoidanceRadius + margin` in a random `rng`-chosen horizontal direction, so the anchor sits just outside the coral rather than inside it (attraction and avoidance would otherwise fight at the boundary).
- Otherwise: `habitatAnchor = position.clone()` (inert — the pull term is never applied since `territoryStrength` is 0/undefined).

`FishSchool`'s constructor takes `coralClusterCenters: readonly Vector3[] = []` (default empty keeps existing direct-construction tests working unchanged — avoidance/territory both no-op against an empty list).

## 5. Performance

The existing per-species separation loop is O(n²) inside one species' `update()` (n ≤ 20 today). Every new term here is O(n) or O(n × clusterCount) (~22): negligible next to the existing O(n²) term at current population. No profiling is done as part of this task; a future population increase should measure `performance.now()` around `school.update()` before deciding, per §4.3's own caveat.

## 6. Testing plan

**Pure logic (vitest, no WebGL):**
- `depthBiasSteer`: pulls up when below target, down when above, zero at target.
- `clampTurnRate`: returns `desired` unchanged when the angle is within budget; rotates only partway (angle between output and `current` equals `maxRadians`) when it isn't.
- `rhythmSpeedScale`: stays within `[1 - amplitude, 1]`; returns exactly `1` when `amplitude` is 0.
- `coralAvoidanceSteer`: zero far from every cluster; points away from the nearest cluster when inside its radius.

**Integration (60 fixed-seed simulated seconds):** construct schools with `createSchools(FISH_REGISTRY, createRng(seed), { coralClusterCenters })`, call `update(1/60, t)` 3600 times, and after every step assert for every boid: finite `x/y/z`, inside `SCENE.bounds` (+ small margin, matching `containSteer`'s existing margin), and the angle between this frame's and last frame's velocity direction never exceeds `maxTurnRate * dt` (+ floating-point epsilon) for swim species that set one.

**Manual:** `npm run preview`, eyeball before/after — this AC ("영상 보고 체감 차이 확인") isn't automatable and stays a manual check alongside the usual visual QA pass.

## 7. Files touched

- `web/src/environment.ts` — extract `computeCoralClusterCenters`, expose it on `Environment`.
- `web/src/config.ts` — new optional behavior fields; fill in values for the 9 registry species; new `SCENE.coral.avoidanceRadius` / `avoidanceHeight`.
- `web/src/fish.ts` — new pure steering functions; `Boid.habitatAnchor`; `FishSchool` constructor takes cluster centers; swim update path integrates depth/turn-rate/rhythm/territory/avoidance.
- `web/src/main.ts` — thread `environment.coralClusterCenters` into `createSchools`.
- `web/src/fish.test.ts` / `web/src/environment.test.ts` — new tests per §6.
