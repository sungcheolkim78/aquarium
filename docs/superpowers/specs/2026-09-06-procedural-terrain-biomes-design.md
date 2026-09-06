# Procedural Terrain & Biome Scatter Design

**Source:** `docs/terrain_geometry_generator.md`'s final pipeline diagram (World Seed → Macro Terrain Gen → Height Map/Biome Map → Terrain Analysis → Biome Classification → Primary/Secondary Scatter → Decoration → LOD → Rendering), adapted from its Blender/Geometry-Nodes framing to this repo's TypeScript/three.js stack.

**Goal:** Replace the sea floor's fixed 3-term sine "dune" formula and the coral system's pure-random cluster placement with the doc's height/slope/curvature-driven biome pipeline — so the floor and its scatter objects (coral, rock, cliff) read as a real, varied terrain instead of a flat plane with randomly-scattered decoration. Every stage is a per-preset-tunable parameter (`EnvironmentPreset.terrain`), keeping the just-shipped `great_barrier_reef` color system and this terrain system on the same YAML file.

**Non-goals:**
- Fish behavior changes. `coralClusterCenters` (consumed by `fish.ts` for territory/avoidance) keeps its exact current meaning — only reef-biome scatter points, mirroring today. Rock/cliff objects are decorative-only; fish do not specifically avoid or anchor to them beyond the existing floor/bounds containment.
- Distance-based LOD. The camera orbits a fixed radius (`SCENE.camera.radius`) around a small (26×26) tank and never approaches or recedes from the reef — the pipeline's "LOD" stage is already satisfied by the existing user-selectable low/medium/high detail levels (`BACKGROUND_DETAIL_PROFILES`), which this feature does not change.
- "Shell" decoration mentioned alongside seaweed in the doc's "Decoration" stage — seaweed placement is untouched and independent of biome, as today; shells are a possible future addition, not built here.
- Any change to `web/species/fish/*.yaml` or fish geometry.

## 1. Pipeline mapping

| Doc stage | This implementation |
|---|---|
| World Seed | The existing fixed `createRng(0x5eed_a17c)` in `main.ts` — unchanged. |
| Macro Terrain Gen → Height Map | `terrainHeight(x, z, terrain)`: a macro-scale sine term (new) plus the existing 3-term "detail" sine formula, each independently scaled by preset params. |
| Macro Terrain Gen → Biome Map | `macroBiomeField(x, z)`: a second, independently-phased low-frequency sine field — a "regional reef tendency" signal deliberately decorrelated from the height contours. |
| Terrain Analysis (Height/Slope/Curvature) | `terrainHeight`, `terrainSlope` (finite-difference gradient magnitude), `terrainCurvature` (finite-difference discrete Laplacian) — all pure functions of `(x, z, terrain)`. |
| Biome Classification (Sand/Reef/Cliff) | `classifyBiome(x, z, terrain)`: combines slope + curvature + the Biome Map signal into one of `"sand" \| "reef" \| "cliff"`. |
| Primary Scatter (Rock/Large Coral) | At each `reef` point: either a coral cluster (existing `createCoral`, now reef-gated) or a rock formation (new `createRocks`), chosen per-point. At each `cliff` point: a tall, steep rock formation only (no coral). |
| Secondary Scatter (Small Coral/Pebbles) | Unchanged — already how `createCoral`/`createRocks` build each cluster: 2–4 pieces of varying size per point (today's existing multi-piece-per-cluster code, extended to rocks). No new structural work. |
| Decoration (Seaweed/Shells) | Unchanged — `createSeaweed` stays biome-independent, exactly as today. |
| LOD | Already satisfied by `BACKGROUND_DETAIL_PROFILES` (see Non-goals). |
| Rendering | Unchanged render loop. |

## 2. `EnvironmentPreset.terrain` (new YAML block)

```yaml
terrain:
  relief: 0.6          # macro height field amplitude
  roughness: 0.4        # fine detail height amplitude (today's 3-term dune formula)
  reefBias: 0.55         # shifts classification thresholds toward "reef"
  cliffBias: 0.2         # shifts classification thresholds toward "cliff"
  rockColor: "#7c8a8f"
```

Added to `web/scenes/great_barrier_reef.yaml`. `EnvironmentPreset` (config.ts) gains:
```ts
readonly terrain: {
  readonly relief: number;
  readonly roughness: number;
  readonly reefBias: number;
  readonly cliffBias: number;
  readonly rockColor: string;
};
```
`scenePresets.ts` validates all five fields (`relief`/`roughness`/`reefBias`/`cliffBias` as numbers in `[0, 1]`; `rockColor` as a hex color, reusing the existing `requireHexColor`).

## 3. Terrain Analysis functions (`environment.ts`)

```ts
function macroHeightField(x: number, z: number): number {
  return Math.sin(x * 0.045) * 0.6 + Math.cos(z * 0.05) * 0.5;
}

// Deliberately different frequency/phase from macroHeightField: biome regions
// don't just trace the height contours, matching the doc's "independent Biome Map".
function macroBiomeField(x: number, z: number): number {
  return Math.sin(x * 0.031 + 1.7) * 0.5 + Math.cos(z * 0.027 - 0.9) * 0.5; // range [-1, 1]
}

type HeightTerrain = Pick<EnvironmentPreset["terrain"], "relief" | "roughness">;

/** Height Map: macro field (new) + today's 3-term detail dune formula, each independently scaled. */
export function terrainHeight(x: number, z: number, terrain: HeightTerrain): number {
  const detail = Math.sin(x * 0.16) * 0.55 + Math.cos(z * 0.21) * 0.45 + Math.sin((x + z) * 0.09) * 0.7;
  return terrain.relief * macroHeightField(x, z) + terrain.roughness * detail;
}

const ANALYSIS_EPSILON = 0.5;

/** Gradient magnitude via finite difference. */
export function terrainSlope(x: number, z: number, terrain: HeightTerrain): number {
  const h0 = terrainHeight(x, z, terrain);
  const hx = terrainHeight(x + ANALYSIS_EPSILON, z, terrain);
  const hz = terrainHeight(x, z + ANALYSIS_EPSILON, terrain);
  return Math.hypot(hx - h0, hz - h0) / ANALYSIS_EPSILON;
}

/** Discrete Laplacian: negative = convex (ridge/bump), positive = concave (valley) — standard sign convention. */
export function terrainCurvature(x: number, z: number, terrain: HeightTerrain): number {
  const h0 = terrainHeight(x, z, terrain);
  const sum =
    terrainHeight(x + ANALYSIS_EPSILON, z, terrain) +
    terrainHeight(x - ANALYSIS_EPSILON, z, terrain) +
    terrainHeight(x, z + ANALYSIS_EPSILON, terrain) +
    terrainHeight(x, z - ANALYSIS_EPSILON, terrain);
  return (sum - 4 * h0) / (ANALYSIS_EPSILON * ANALYSIS_EPSILON);
}
```

## 4. Biome Classification

```ts
export type Biome = "sand" | "reef" | "cliff";

export function classifyBiome(x: number, z: number, terrain: EnvironmentPreset["terrain"]): Biome {
  const slope = terrainSlope(x, z, terrain);
  const curvature = terrainCurvature(x, z, terrain);
  const biomeTendency = macroBiomeField(x, z);

  const cliffThreshold = 0.55 - terrain.cliffBias * 0.3;
  if (slope > cliffThreshold) return "cliff";

  const convexBonus = curvature < 0 ? 0.08 : 0; // convex bumps read as reef-like, per the source doc
  const reefThreshold = 0.15 - terrain.reefBias * 0.12;
  if (slope + convexBonus > reefThreshold && biomeTendency > -terrain.reefBias) return "reef";

  return "sand";
}
```

The exact constants (`0.045`, `0.55`, `0.3`, `0.15`, `0.12`, `0.08`, epsilon `0.5`) are starting points tuned against `terrainHeight`'s actual output range for this scene's scale (a 72×72 floor plane, height range roughly ±2) — refined empirically during implementation via `npm run preview`, not treated as final here. What's fixed by this design: higher `reefBias`/`cliffBias` must monotonically increase that biome's share of classified points, and a convex point must never be less likely to classify as reef than an equally-sloped concave point.

## 5. Scatter points (replaces `computeCoralClusterCenters`)

```ts
export interface ScatterPoint {
  readonly position: Vector3;
  readonly biome: Biome;
}

/** Same polar placement as today's coral clusters (radius 4.5–13, keeping the open center), now height- and biome-aware. */
export function computeScatterPoints(
  rng: () => number,
  count: number,
  terrain: EnvironmentPreset["terrain"],
): ScatterPoint[] {
  const points: ScatterPoint[] = [];
  for (let c = 0; c < count; c += 1) {
    const angle = (c / count) * Math.PI * 2 + rng() * 0.35;
    const radius = 4.5 + rng() * 8.5;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = SCENE.floorY + terrainHeight(x, z, terrain);
    points.push({ position: new Vector3(x, y, z), biome: classifyBiome(x, z, terrain) });
  }
  return points;
}
```

This directly fixes an existing inconsistency: today's coral clusters sit at a flat `SCENE.floorY + height*0.5` regardless of the floor's own dune displacement at that `(x, z)` — they now sit at the terrain's actual local height.

## 6. Consumers

- **`createCoral`**: now takes `ScatterPoint[]` (pre-filtered by the caller to `biome === "reef"`) instead of an internally-generated cluster-center list. Each point may still get 2–4 pieces (today's existing per-cluster piece-count logic, unchanged) using `point.position` as the cluster's base instead of a freshly-sampled flat-`floorY` position. Returns `clusterCenters` = the same reef positions, unchanged shape, so `fish.ts`'s territory/avoidance consumers need no changes.
- **`createRocks`** (new, mirrors `createCoral`'s bake/merge structure): takes `ScatterPoint[]` pre-filtered to `biome === "reef" \| "cliff"`. At a `reef` point, places boulder-like pieces (`IcosahedronGeometry`/`ConeGeometry`, similar scale to coral pieces — reef points get either a coral cluster or a rock formation, decided per-point by the caller, see §7). At a `cliff` point, places one tall, steep formation: an elongated `BoxGeometry` (or `CylinderGeometry`) scaled tall and thin, tilted 60–80° from vertical, giving a distinct wall-like silhouette instead of a rounded boulder. Colored from `preset.terrain.rockColor` (flat, no per-piece hue variation — rock doesn't need coral's palette variety). One merged `Mesh`, one draw call, following the exact `bake`/`mergeBaked` pattern already used by `createCoral`/`createGodRays`.
- **`createFloor`**: after building the dune-displaced, height-tinted floor (unchanged core logic, now driven by `terrainHeight` instead of the old inline formula), does one extra pass: for each vertex, find the nearest scatter point (linear scan — at most a few dozen points, checked once at construction time, negligible cost) and if that nearest point's biome is `cliff`, blend the vertex color toward `preset.terrain.rockColor` (weighted by inverse distance, capped at some radius so the tint doesn't bleed across the whole floor). `reef`/`sand` points don't tint the floor (coral/sand already read clearly from the scatter objects themselves).
- **`createEnvironment`/`Environment.rebuild`**: build `computeScatterPoints` once per (re)build, partition into reef/cliff-or-not, pass to `createCoral`/`createRocks`/`createFloor`. `rocks` becomes a fifth managed mesh (alongside floor/coral/seaweed/godRays) in the returned `Environment`'s internal state, rebuilt and disposed exactly like the other three geometry-holding meshes today.

## 7. Reef point → coral vs. rock

At each `reef`-classified point, the caller (inside `createEnvironment`/`rebuild`) rolls once (`rng() < 0.7`, say — tuned during implementation) to decide coral vs. rock for that point, then routes it to `createCoral` or `createRocks` accordingly — so a `reef` biome visually reads as "mostly coral, occasionally a bare rock outcrop," matching the doc's "Primary Scatter: Rock / Large Coral" being two siblings under the same Reef branch. `cliff` points always go to `createRocks` (steep-formation variant); there is no cliff→coral path.

## 8. Draw calls & budget

One new draw call (`rocks`), bringing the environment's own total to 5 (floor, coral, rocks, seaweed, godRays) — matching the earlier-agreed decision to keep rocks separate from coral rather than merging into coral's existing draw call. Total scene draw calls move from ~14–15 to ~15–16, still far under the 30-call SPEC N1 ceiling. Triangle budget: `createRocks` reuses the same detail-scaled primitive segment counts (`BACKGROUND_DETAIL_PROFILES.*.coral`, shared with coral — no new detail-profile fields needed) and only fires for a fraction of `computeScatterPoints`' output (reef/cliff, not sand), so its triangle contribution is bounded by the existing coral triangle budget, not additive on top of it in the worst case. SPEC's AC-3 (background high/medium ratio 2.0–2.5×) test is updated to include `createRocks`' triangle count in the "background total," matching how floor/coral/seaweed are already summed there.

## 9. Testing plan

- `terrainHeight`/`terrainSlope`/`terrainCurvature`: determinism (same input → same output); a flat-parameter case (`relief`/`roughness` both 0) returns exactly 0 height/slope everywhere; slope is 0 at a local extremum of a simple test terrain; curvature sign matches a hand-constructed convex vs. concave test point.
- `classifyBiome`: raising `reefBias` (all else equal) never decreases the reef share across a fixed grid of sample points; raising `cliffBias` never decreases the cliff share; a point with high slope always classifies as `cliff` regardless of `biomeTendency`.
- `computeScatterPoints`: deterministic for a fixed seed; every point's `position.y` equals `SCENE.floorY + terrainHeight(x, z, terrain)` at that point's `(x, z)`; every point's `biome` matches `classifyBiome` at that same `(x, z)`.
- `createRocks`: mirrors `createCoral`'s existing test style — a single-rock-color preset bakes every vertex to that exact color; a cliff-only point set produces measurably taller/narrower geometry (bounding-box height/width ratio) than a reef-only point set; finite/non-indexed mesh sanity (matching every other geometry builder's existing tests).
- `createFloor`: a scatter-point list with one `cliff` point produces floor vertices near that point's `(x, z)` tinted measurably closer to `rockColor` than vertices far from any scatter point.
- `environment.test.ts`'s existing AC-3 ratio test updated to include `createRocks` in the medium/high sums (see §8) — still asserted within the existing 2.0–2.5× bound; if `createRocks`'s addition pushes it outside that bound, its own detail scaling (not the bound) is what gets adjusted.
- `config.test.ts`/`scenePresets.test.ts`: `EnvironmentPreset.terrain` round-trips through YAML parsing; each of the 5 new fields is validated (missing field, out-of-range `relief`/`roughness`/`reefBias`/`cliffBias`, invalid `rockColor` hex each throw naming the file).
- Manual (`npm run preview`): confirm the floor now shows visible large-scale undulation (not just the old fine dune ripple), coral clusters sit at the terrain's actual local height instead of floating at a flat plane, gray rock outcrops are visible and distinct from coral, and at least one taller/steeper "cliff" formation is visible somewhere in the scene; confirm `window.__aq` draw-calls/triangles stay within budget.

## 10. Files touched

- `web/scenes/great_barrier_reef.yaml` — add `terrain:` block.
- `web/src/config.ts` — `EnvironmentPreset.terrain` field.
- `web/src/scenePresets.ts` — parse/validate the new block.
- `web/src/scenePresets.test.ts` — validation tests for the new block.
- `web/src/environment.ts` — `terrainHeight`/`terrainSlope`/`terrainCurvature`/`classifyBiome`/`computeScatterPoints`/`createRocks`; `createCoral`/`createFloor`/`createEnvironment`/`Environment.rebuild` updated to consume them.
- `web/src/environment.test.ts` — new tests per §9; AC-3 ratio test updated to include rocks.
- `web/src/config.test.ts` — `EnvironmentPreset.terrain` presence/shape checks.
