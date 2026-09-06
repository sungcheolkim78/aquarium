# Procedural Terrain & Biome Scatter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sea floor's fixed sine "dune" formula and coral's pure-random cluster placement with a height/slope/curvature-driven biome pipeline (sand/reef/cliff), add a new rock/cliff scatter mesh, and make every terrain parameter part of the `EnvironmentPreset` YAML — so `great_barrier_reef.yaml` (and any future preset) defines both color and terrain shape.

**Architecture:** Task 1 adds the whole terrain-analysis/biome-classification pure-function layer plus the new `EnvironmentPreset.terrain` YAML field as a **purely additive** change — `createFloor`/`createCoral`/`createEnvironment` keep their exact current behavior and signatures throughout Task 1, so the app stays fully working and every existing test keeps passing unmodified except for one mechanical fixture update. Task 2 rewires `createFloor`/`createCoral` to consume the new pipeline, adds `createRocks`, removes `computeCoralClusterCenters` in favor of `computeScatterPoints`, and updates every ripple site (`createEnvironment`, `settings.ts`'s triangle-budget estimator, and the handful of existing tests that touch these signatures).

**Tech Stack:** TypeScript (strict), Three.js (`ConeGeometry`/`IcosahedronGeometry`/`CylinderGeometry`, existing `bake`/`mergeBaked` pattern), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-06-procedural-terrain-biomes-design.md`

## Global Constraints

- All commands run from the repo root using `npm --prefix web run <script>`.
- `npm --prefix web run build` (`tsc --noEmit && vite build`) must pass with zero errors after every step described as ending in a build check.
- `npm --prefix web run test` (`vitest run`) must pass.
- No fish-behavior changes: `Environment.coralClusterCenters` keeps its exact current *meaning* (positions fish territory/avoidance code treats as coral) — only its *value* narrows to the reef-classified, coral-assigned subset of scatter points instead of every requested cluster.
- No distance-based LOD — the existing low/medium/high `BACKGROUND_DETAIL_PROFILES` already fill that role (see spec §Non-goals); this plan does not touch them.
- Rocks are a fifth environment draw call, separate from coral (already agreed) — total environment draw calls go from 4 to 5, total scene draw calls from ~14–15 to ~15–16, still far under the 30-call SPEC N1 ceiling.
- Every new/changed function parameter defaults such that omitting it reproduces today's behavior wherever that's still meaningful (e.g. `createFloor`'s new `scatterPoints` parameter defaults to `[]`, meaning "no biome tinting" — today's exact behavior).
- Before either task's final commit, run the full test suite and `tsc --noEmit`. Before considering the whole plan done, additionally run `npm --prefix web run build && npm --prefix web run preview` and visually confirm: visible large-scale floor undulation (not just fine ripple), coral sitting at the terrain's actual local height, distinct gray rock outcrops, at least one taller/steeper cliff formation, and `window.__aq` draw-calls/triangles still within budget.

---

### Task 1: Terrain analysis + biome classification (purely additive)

**Files:**
- Modify: `web/scenes/great_barrier_reef.yaml`
- Modify: `web/src/config.ts`
- Modify: `web/src/scenePresets.ts`
- Modify: `web/src/scenePresets.test.ts`
- Modify: `web/src/config.test.ts`
- Modify: `web/src/environment.ts`
- Modify: `web/src/environment.test.ts`

**Interfaces:**
- Produces (consumed by Task 2): `environment.ts`'s `Biome` type, `ScatterPoint` interface, `terrainHeight(x, z, terrain)`, `terrainSlope(x, z, terrain)`, `terrainCurvature(x, z, terrain)`, `classifyBiome(x, z, terrain)`, `computeScatterPoints(rng, count, terrain)`. `config.ts`'s `EnvironmentPreset.terrain: { relief, roughness, reefBias, cliffBias, rockColor }`.
- Consumes: nothing new from elsewhere.

#### Step 1: Add the `terrain` block to `great_barrier_reef.yaml`

Read `web/scenes/great_barrier_reef.yaml`. Add at the end:
```yaml
terrain:
  relief: 0.6
  roughness: 0.4
  reefBias: 0.55
  cliffBias: 0.2
  rockColor: "#7c8a8f"
```

#### Step 2: Write failing tests for `EnvironmentPreset.terrain` validation

Read `web/src/scenePresets.test.ts`. Update `VALID_YAML` — add this line at the end of the template (still inside the backticks, after the `bubbles: ...` line):
```
terrain: { relief: 0.6, roughness: 0.4, reefBias: 0.55, cliffBias: 0.2, rockColor: "#7c8a8f" }
```

Add these tests inside `describe("parseEnvironmentPresetYaml", ...)`:
```ts
it("parses the terrain block", () => {
  const preset = parseEnvironmentPresetYaml(VALID_YAML, "test-preset.yaml");
  expect(preset.terrain).toEqual({
    relief: 0.6,
    roughness: 0.4,
    reefBias: 0.55,
    cliffBias: 0.2,
    rockColor: "#7c8a8f",
  });
});

it("throws when terrain.reefBias is outside 0..1", () => {
  const broken = VALID_YAML.replace("reefBias: 0.55", "reefBias: 1.5");
  expect(() => parseEnvironmentPresetYaml(broken, "test-preset.yaml")).toThrow(/terrain\.reefBias/);
});

it("throws when terrain.rockColor is not a valid hex color", () => {
  const broken = VALID_YAML.replace('rockColor: "#7c8a8f"', 'rockColor: "gray"');
  expect(() => parseEnvironmentPresetYaml(broken, "test-preset.yaml")).toThrow(/hex color/);
});
```

Run: `npm --prefix web run test -- src/scenePresets.test.ts`
Expected: FAIL — `EnvironmentPreset` has no `terrain` field yet, and the parser doesn't read one.

#### Step 3: Add `EnvironmentPreset.terrain` to `config.ts`

Read `web/src/config.ts`. In the `EnvironmentPreset` interface, add after `bubbles`:
```ts
  readonly bubbles: { readonly tint: string };
  readonly terrain: {
    readonly relief: number;
    readonly roughness: number;
    readonly reefBias: number;
    readonly cliffBias: number;
    readonly rockColor: string;
  };
}
```
(replacing the old closing `}` that followed `bubbles`).

#### Step 4: Validate the new block in `scenePresets.ts`

Read `web/src/scenePresets.ts`. Add two validators next to `requirePositiveNumber`:
```ts
function requireNonNegativeNumber(value: unknown, field: string, filename: string): number {
  const n = requireNumber(value, field, filename);
  if (n < 0) throw new Error(`${filename}: "${field}" must be >= 0, got ${n}`);
  return n;
}

function requireUnitNumber(value: unknown, field: string, filename: string): number {
  const n = requireNumber(value, field, filename);
  if (n < 0 || n > 1) throw new Error(`${filename}: "${field}" must be between 0 and 1, got ${n}`);
  return n;
}
```

In `parseEnvironmentPresetYaml`, add after the `bubbles` block:
```ts
  const terrainRaw = requireObject(root.terrain, "terrain", filename);
  const terrain = {
    relief: requireNonNegativeNumber(terrainRaw.relief, "terrain.relief", filename),
    roughness: requireNonNegativeNumber(terrainRaw.roughness, "terrain.roughness", filename),
    reefBias: requireUnitNumber(terrainRaw.reefBias, "terrain.reefBias", filename),
    cliffBias: requireUnitNumber(terrainRaw.cliffBias, "terrain.cliffBias", filename),
    rockColor: requireHexColor(terrainRaw.rockColor, "terrain.rockColor", filename),
  };

  return { id, label, description, water, lighting, caustics, godRays, floor, coral, seaweed, bubbles, terrain };
```
(replacing the old `return { id, label, description, water, lighting, caustics, godRays, floor, coral, seaweed, bubbles };` line.)

Run: `npm --prefix web run test -- src/scenePresets.test.ts`
Expected: PASS.

Run: `npm --prefix web run build`
Expected: FAIL — `environment.test.ts`'s `TEST_PRESET` fixture is missing the now-required `terrain` field. Fixed next.

#### Step 5: Add `terrain` to `environment.test.ts`'s `TEST_PRESET` fixture

Read `web/src/environment.test.ts`. In the `TEST_PRESET` object, add after `bubbles`:
```ts
  bubbles: { tint: "#abcdef" },
  terrain: { relief: 0.6, roughness: 0.4, reefBias: 0.55, cliffBias: 0.2, rockColor: "#7c8a8f" },
};
```
(replacing the old `bubbles: { tint: "#abcdef" },\n};`.)

Run: `npm --prefix web run build`
Expected: PASS with zero `tsc` errors (Task 1's type/validation surface is now internally consistent; the pure terrain functions themselves don't exist yet, but nothing references them yet either).

Run: `npm --prefix web run test`
Expected: PASS — every existing suite, unmodified except the fixture edit above.

#### Step 6: Write failing tests for the terrain-analysis pure functions

In `web/src/environment.test.ts`, update the `./environment` import to add the not-yet-written functions:
```ts
import {
  computeCoralClusterCenters,
  computeObjectCounts,
  createCoral,
  createEnvironment,
  createFloor,
  createSeaweed,
  mergeBaked,
  classifyBiome,
  computeScatterPoints,
  terrainCurvature,
  terrainHeight,
  terrainSlope,
} from "./environment";
```
(`computeCoralClusterCenters`/`createCoral`/`createEnvironment`/`createFloor`/`createSeaweed` stay — Task 1 doesn't remove or change them.)

Add near the top of the file, after the `TEST_PRESET` fixture:
```ts
describe("terrainHeight/terrainSlope/terrainCurvature", () => {
  const flat = { relief: 0, roughness: 0 };
  const normal = { relief: 0.6, roughness: 0.4 };

  it("is deterministic", () => {
    expect(terrainHeight(3, 5, normal)).toBe(terrainHeight(3, 5, normal));
  });

  it("returns exactly 0 everywhere when relief and roughness are both 0", () => {
    for (const [x, z] of [
      [0, 0],
      [5, -3],
      [-12, 8],
    ] as const) {
      expect(terrainHeight(x, z, flat)).toBe(0);
      expect(terrainSlope(x, z, flat)).toBe(0);
      expect(terrainCurvature(x, z, flat)).toBe(0);
    }
  });

  it("curvature is negative at a scanned local height maximum and positive at a scanned local minimum", () => {
    // Full 2D scan (not just along one axis) — terrainCurvature's discrete
    // Laplacian looks at neighbors in *both* x and z, so the found point must
    // be a genuine 2D extremum, not merely a max/min along a single line.
    const roughnessOnly = { relief: 0, roughness: 1 };
    let maxX = 0;
    let maxZ = 0;
    let maxH = -Infinity;
    let minX = 0;
    let minZ = 0;
    let minH = Infinity;
    for (let x = -15; x <= 15; x += 0.25) {
      for (let z = -15; z <= 15; z += 0.25) {
        const h = terrainHeight(x, z, roughnessOnly);
        if (h > maxH) {
          maxH = h;
          maxX = x;
          maxZ = z;
        }
        if (h < minH) {
          minH = h;
          minX = x;
          minZ = z;
        }
      }
    }
    expect(terrainCurvature(maxX, maxZ, roughnessOnly)).toBeLessThan(0);
    expect(terrainCurvature(minX, minZ, roughnessOnly)).toBeGreaterThan(0);
  });
});

describe("classifyBiome", () => {
  const baseTerrain = { relief: 0.6, roughness: 0.4, reefBias: 0.5, cliffBias: 0.2, rockColor: "#888888" };

  function countBiomes(terrain: typeof baseTerrain): Record<string, number> {
    const counts: Record<string, number> = { sand: 0, reef: 0, cliff: 0 };
    for (let x = -10; x <= 10; x += 1) {
      for (let z = -10; z <= 10; z += 1) {
        counts[classifyBiome(x, z, terrain)] += 1;
      }
    }
    return counts;
  }

  it("is deterministic", () => {
    expect(classifyBiome(4, -6, baseTerrain)).toBe(classifyBiome(4, -6, baseTerrain));
  });

  it("raising reefBias never decreases the reef share across a fixed grid", () => {
    const low = countBiomes({ ...baseTerrain, reefBias: 0.1 });
    const high = countBiomes({ ...baseTerrain, reefBias: 0.9 });
    expect(high.reef).toBeGreaterThanOrEqual(low.reef);
  });

  it("raising cliffBias never decreases the cliff share across a fixed grid", () => {
    const low = countBiomes({ ...baseTerrain, cliffBias: 0.0 });
    const high = countBiomes({ ...baseTerrain, cliffBias: 0.9 });
    expect(high.cliff).toBeGreaterThanOrEqual(low.cliff);
  });
});

describe("computeScatterPoints", () => {
  it("returns one point per requested count, deterministic for the same seed, each finite with a valid biome", () => {
    const terrain = DEFAULT_ENVIRONMENT_PRESET.terrain;
    const a = computeScatterPoints(createRng(3), 22, terrain);
    const b = computeScatterPoints(createRng(3), 22, terrain);
    expect(a).toHaveLength(22);
    for (const point of a) {
      expect(Number.isFinite(point.position.x)).toBe(true);
      expect(Number.isFinite(point.position.y)).toBe(true);
      expect(Number.isFinite(point.position.z)).toBe(true);
      expect(["sand", "reef", "cliff"]).toContain(point.biome);
    }
    expect(a.map((p) => [p.position.x, p.position.y, p.position.z, p.biome])).toEqual(
      b.map((p) => [p.position.x, p.position.y, p.position.z, p.biome]),
    );
  });

  it("the default preset's scatter points include a mix of biomes, not just one", () => {
    const points = computeScatterPoints(createRng(0x5eed_a17c), 60, DEFAULT_ENVIRONMENT_PRESET.terrain);
    const biomes = new Set(points.map((p) => p.biome));
    expect(biomes.size).toBeGreaterThan(1);
  });
});
```
This requires `DEFAULT_ENVIRONMENT_PRESET` in the `./config` import — add it to the existing `import { BACKGROUND_DETAIL_PROFILES, SCENE, SEAWEED_COUNT, type EnvironmentPreset } from "./config";` line.

Run: `npm --prefix web run test -- src/environment.test.ts`
Expected: FAIL — none of `classifyBiome`/`computeScatterPoints`/`terrainCurvature`/`terrainHeight`/`terrainSlope` are exported from `./environment` yet.

#### Step 7: Implement the terrain-analysis pure functions in `environment.ts`

Read `web/src/environment.ts`. Add, right after the `computeObjectCounts` function (before `bake`):
```ts
function macroHeightField(x: number, z: number): number {
  return Math.sin(x * 0.045) * 0.6 + Math.cos(z * 0.05) * 0.5;
}

// Deliberately different frequency/phase from macroHeightField: biome regions
// don't just trace the height contours.
function macroBiomeField(x: number, z: number): number {
  return Math.sin(x * 0.031 + 1.7) * 0.5 + Math.cos(z * 0.027 - 0.9) * 0.5; // range [-1, 1]
}

type HeightTerrain = Pick<EnvironmentPreset["terrain"], "relief" | "roughness">;

/** Height Map: macro field + the original 3-term detail dune formula, each independently scaled. */
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

/** Discrete Laplacian: negative = convex (ridge/bump), positive = concave (valley). */
export function terrainCurvature(x: number, z: number, terrain: HeightTerrain): number {
  const h0 = terrainHeight(x, z, terrain);
  const sum =
    terrainHeight(x + ANALYSIS_EPSILON, z, terrain) +
    terrainHeight(x - ANALYSIS_EPSILON, z, terrain) +
    terrainHeight(x, z + ANALYSIS_EPSILON, terrain) +
    terrainHeight(x, z - ANALYSIS_EPSILON, terrain);
  return (sum - 4 * h0) / (ANALYSIS_EPSILON * ANALYSIS_EPSILON);
}

export type Biome = "sand" | "reef" | "cliff";

export function classifyBiome(x: number, z: number, terrain: EnvironmentPreset["terrain"]): Biome {
  const slope = terrainSlope(x, z, terrain);
  const curvature = terrainCurvature(x, z, terrain);
  const biomeTendency = macroBiomeField(x, z);

  const cliffThreshold = 0.55 - terrain.cliffBias * 0.3;
  if (slope > cliffThreshold) return "cliff";

  const convexBonus = curvature < 0 ? 0.08 : 0;
  const reefThreshold = 0.15 - terrain.reefBias * 0.12;
  if (slope + convexBonus > reefThreshold && biomeTendency > -terrain.reefBias) return "reef";

  return "sand";
}

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

Run: `npm --prefix web run test -- src/environment.test.ts`
Expected: PASS — all new tests, plus every pre-existing test in this file (still using the old `createFloor`/`createCoral`/`createEnvironment`/`computeCoralClusterCenters`, untouched).

If `"the default preset's scatter points include a mix of biomes, not just one"` fails: the `great_barrier_reef.yaml` values from Step 1, or the threshold constants in `classifyBiome` above, need adjusting — tune the constants (not the test) until the default preset produces a real mix. Re-run until green before moving on.

#### Step 8: Run the full suite, type check, then commit

Run: `npm --prefix web run test`
Expected: PASS — every suite (`fish.test.ts`, `settings.test.ts`, `config.test.ts`, etc. are all untouched and still exercise the old `createFloor`/`createCoral`/`computeCoralClusterCenters` signatures, which still exist unchanged).

Run: `npm --prefix web run build`
Expected: PASS with zero `tsc` errors.

```bash
git add web/scenes/great_barrier_reef.yaml web/src/config.ts web/src/scenePresets.ts web/src/scenePresets.test.ts web/src/environment.ts web/src/environment.test.ts
git commit -m "feat: add terrain analysis and biome classification (additive)

Adds EnvironmentPreset.terrain (relief/roughness/reefBias/cliffBias/
rockColor) and environment.ts's terrainHeight/terrainSlope/terrainCurvature/
classifyBiome/computeScatterPoints, following docs/terrain_geometry_generator.md's
Macro Terrain Gen -> Height/Biome Map -> Terrain Analysis -> Biome
Classification pipeline. Purely additive: createFloor/createCoral/
createEnvironment/computeCoralClusterCenters are untouched and every
existing test still passes unmodified — wiring the pipeline into actual
rendering is the next task."
```

---

### Task 2: Wire the pipeline into rendering, add `createRocks`, remove `computeCoralClusterCenters`

**Files:**
- Modify: `web/src/environment.ts`
- Modify: `web/src/environment.test.ts`
- Modify: `web/src/settings.ts`
- Modify: `web/src/fish.test.ts`

**Interfaces:**
- Consumes: everything from Task 1.
- Produces: `createRocks(rng, time, profile, points, causticsEnabled?, preset?): Mesh` (new). `createCoral`'s signature changes from `(rng, time, profile, clusterCount, causticsEnabled?, preset?): { mesh, clusterCenters }` to `(rng, time, profile, points, causticsEnabled?, preset?): Mesh`. `createFloor` gains a 5th parameter, `scatterPoints`. `computeCoralClusterCenters` is removed.

#### Step 1: Update `createCoral`'s existing test to the new signature (write it failing first)

Read `web/src/environment.test.ts`. In `describe("environment preset color consumption", ...)`, change the `"createCoral bakes every vertex from the single supplied coral color"` test:
```ts
it("createCoral bakes every vertex from the single supplied coral color", () => {
  const time = { value: 0 };
  const points: ScatterPoint[] = [
    { position: new Vector3(0, 0, 0), biome: "reef" },
    { position: new Vector3(2, 0, 2), biome: "reef" },
    { position: new Vector3(-2, 0, -2), biome: "reef" },
  ];
  const mesh = createCoral(createRng(1), time, BACKGROUND_DETAIL_PROFILES.medium.coral, points, undefined, TEST_PRESET);
  const color = mesh.geometry.getAttribute("color");
  // TEST_PRESET's only coral color is pure magenta (#ff00ff): green is always exactly 0,
  // red/blue are always > 0, regardless of the per-cluster brightness multiplier.
  for (let i = 0; i < color.count; i += 1) {
    expect(color.getY(i)).toBe(0);
    expect(color.getX(i)).toBeGreaterThan(0);
    expect(color.getZ(i)).toBeGreaterThan(0);
  }
  mesh.geometry.dispose();
  (mesh.material as { dispose(): void }).dispose();
});
```
(This replaces the old body — the old version passed `3` as a bare cluster count and destructured `{ mesh }` from the result; both no longer match the new signature/return type.) This requires `Vector3` and `type ScatterPoint` available — add `type ScatterPoint` to the `./environment` import list (`Vector3` already comes from `"three"`, already imported in this file).

Run: `npm --prefix web run test -- src/environment.test.ts`
Expected: FAIL (type error surfaces at `npm run build`, but the test runner itself may still execute — regardless, treat this as a red step; the real green comes after Step 3's implementation below).

#### Step 2: Update the remaining `environment.test.ts` tests that call `createCoral`/`createEnvironment`/`computeCoralClusterCenters`

Still in `web/src/environment.test.ts`:

1. In `"Environment.rebuild with a changed preset replaces floor/coral/seaweed/godRays with new mesh instances"`, rename it and add `rocks`:
```ts
it("Environment.rebuild with a changed preset replaces floor/coral/rocks/seaweed/godRays with new mesh instances", () => {
  const scene = new Scene();
  const env = createEnvironment(scene, createRng(3));
  const before = {
    floor: env.group.getObjectByName("floor"),
    coral: env.group.getObjectByName("coral"),
    rocks: env.group.getObjectByName("rocks"),
    seaweed: env.group.getObjectByName("seaweed"),
    godRays: env.group.getObjectByName("godRays"),
  };

  env.rebuild("medium", 1, TEST_PRESET);

  expect(env.group.getObjectByName("floor")).not.toBe(before.floor);
  expect(env.group.getObjectByName("coral")).not.toBe(before.coral);
  expect(env.group.getObjectByName("rocks")).not.toBe(before.rocks);
  expect(env.group.getObjectByName("seaweed")).not.toBe(before.seaweed);
  expect(env.group.getObjectByName("godRays")).not.toBe(before.godRays);
  env.dispose();
});
```

2. In `"Environment.setPreset updates fog/background colors without replacing floor/coral/seaweed mesh instances"`, add a `rocks` identity check alongside the existing floor/coral/seaweed ones:
```ts
it("Environment.setPreset updates fog/background colors without replacing floor/coral/rocks/seaweed mesh instances", () => {
  const scene = new Scene();
  const env = createEnvironment(scene, createRng(3));
  const floorBefore = env.group.getObjectByName("floor");
  const coralBefore = env.group.getObjectByName("coral");
  const rocksBefore = env.group.getObjectByName("rocks");
  const seaweedBefore = env.group.getObjectByName("seaweed");

  env.setPreset(TEST_PRESET);

  expect(env.group.getObjectByName("floor")).toBe(floorBefore);
  expect(env.group.getObjectByName("coral")).toBe(coralBefore);
  expect(env.group.getObjectByName("rocks")).toBe(rocksBefore);
  expect(env.group.getObjectByName("seaweed")).toBe(seaweedBefore);
  const fog = scene.fog as unknown as { density: number };
  expect(fog.density).toBe(TEST_PRESET.water.fogDensity);
  env.dispose();
});
```

3. Replace the AC-3 ratio test entirely:
```ts
it("scales the whole background (floor+coral+rocks+seaweed) to ~2.25x (+125%) at high, within 2.0~2.5x (AC-3)", () => {
  const time = { value: 0 };
  const terrain = DEFAULT_ENVIRONMENT_PRESET.terrain;

  const mediumPoints = computeScatterPoints(createRng(1), SCENE.coral.clusters, terrain);
  const mediumNonSand = mediumPoints.filter((p) => p.biome !== "sand");
  const mediumTotal =
    triangleCount(
      createFloor(time, BACKGROUND_DETAIL_PROFILES.medium.floorSegments, undefined, undefined, mediumPoints),
    ) +
    triangleCount(createCoral(createRng(1), time, BACKGROUND_DETAIL_PROFILES.medium.coral, mediumNonSand)) +
    triangleCount(createRocks(createRng(1), time, BACKGROUND_DETAIL_PROFILES.medium.coral, mediumNonSand)) +
    triangleCount(
      createSeaweed(createRng(2), time, BACKGROUND_DETAIL_PROFILES.medium.seaweedHeightSegments, SEAWEED_COUNT),
    );

  const highPoints = computeScatterPoints(createRng(1), SCENE.coral.clusters, terrain);
  const highNonSand = highPoints.filter((p) => p.biome !== "sand");
  const highTotal =
    triangleCount(
      createFloor(time, BACKGROUND_DETAIL_PROFILES.high.floorSegments, undefined, undefined, highPoints),
    ) +
    triangleCount(createCoral(createRng(1), time, BACKGROUND_DETAIL_PROFILES.high.coral, highNonSand)) +
    triangleCount(createRocks(createRng(1), time, BACKGROUND_DETAIL_PROFILES.high.coral, highNonSand)) +
    triangleCount(
      createSeaweed(createRng(2), time, BACKGROUND_DETAIL_PROFILES.high.seaweedHeightSegments, SEAWEED_COUNT),
    );

  const ratio = highTotal / mediumTotal;
  expect(ratio).toBeGreaterThanOrEqual(2.0);
  expect(ratio).toBeLessThanOrEqual(2.5);
});
```
(Note `triangleCount(createCoral(...))`/`triangleCount(createRocks(...))` now pass the `Mesh` directly, not `.mesh.geometry` — both now return a bare `Mesh`.)

4. Replace `describe("computeCoralClusterCenters", ...)` entirely (the function it tests no longer exists):
```ts
describe("createEnvironment", () => {
  it("exposes coral cluster centers as a subset (reef-classified, coral-assigned) of the configured cluster count", () => {
    const scene = new Scene();
    const env = createEnvironment(scene, createRng(3));
    expect(env.coralClusterCenters.length).toBeLessThanOrEqual(SCENE.coral.clusters);
    for (const center of env.coralClusterCenters) {
      expect(Number.isFinite(center.x)).toBe(true);
      expect(Number.isFinite(center.y)).toBe(true);
      expect(Number.isFinite(center.z)).toBe(true);
    }
    env.dispose();
  });
});
```
(This replaces both the old `describe("computeCoralClusterCenters", ...)` block **and** the old `describe("createEnvironment", ...)` block below it, which tested the same thing with the old exact-count assumption — delete the old `describe("createEnvironment", ...)` block so there is exactly one `describe("createEnvironment", ...)` left, containing only this test.)

5. Add two new `describe` blocks (anywhere after the `classifyBiome`/`computeScatterPoints` blocks from Task 1) for `createRocks` and the floor's cliff tinting:
```ts
describe("createRocks", () => {
  it("bakes every vertex to the preset's flat rock color", () => {
    const time = { value: 0 };
    const preset = { ...TEST_PRESET, terrain: { ...TEST_PRESET.terrain, rockColor: "#ff00ff" } };
    const points: ScatterPoint[] = [
      { position: new Vector3(0, 0, 0), biome: "reef" },
      { position: new Vector3(3, 0, 3), biome: "cliff" },
    ];
    const mesh = createRocks(createRng(1), time, BACKGROUND_DETAIL_PROFILES.medium.coral, points, undefined, preset);
    const color = mesh.geometry.getAttribute("color");
    for (let i = 0; i < color.count; i += 1) {
      expect(color.getY(i)).toBe(0);
      expect(color.getX(i)).toBeGreaterThan(0);
      expect(color.getZ(i)).toBeGreaterThan(0);
    }
    mesh.geometry.dispose();
    (mesh.material as { dispose(): void }).dispose();
  });

  it("gives cliff points a taller silhouette than reef points", () => {
    const time = { value: 0 };
    const reefOnly = createRocks(createRng(2), time, BACKGROUND_DETAIL_PROFILES.medium.coral, [
      { position: new Vector3(0, 0, 0), biome: "reef" },
    ]);
    const cliffOnly = createRocks(createRng(2), time, BACKGROUND_DETAIL_PROFILES.medium.coral, [
      { position: new Vector3(0, 0, 0), biome: "cliff" },
    ]);
    reefOnly.geometry.computeBoundingBox();
    cliffOnly.geometry.computeBoundingBox();
    const reefBox = reefOnly.geometry.boundingBox as { min: { y: number }; max: { y: number } };
    const cliffBox = cliffOnly.geometry.boundingBox as { min: { y: number }; max: { y: number } };
    expect(cliffBox.max.y - cliffBox.min.y).toBeGreaterThan(reefBox.max.y - reefBox.min.y);
    reefOnly.geometry.dispose();
    cliffOnly.geometry.dispose();
    (reefOnly.material as { dispose(): void }).dispose();
    (cliffOnly.material as { dispose(): void }).dispose();
  });

  it("produces a finite, non-indexed mesh", () => {
    const time = { value: 0 };
    const points: ScatterPoint[] = [{ position: new Vector3(1, 0, 1), biome: "cliff" }];
    const mesh = createRocks(createRng(4), time, BACKGROUND_DETAIL_PROFILES.medium.coral, points);
    expect(mesh.geometry.index).toBeNull();
    for (const value of mesh.geometry.getAttribute("position").array) {
      expect(Number.isFinite(value)).toBe(true);
    }
    mesh.geometry.dispose();
    (mesh.material as { dispose(): void }).dispose();
  });
});

describe("createFloor cliff tinting", () => {
  it("tints vertices near a cliff scatter point measurably toward the preset's rockColor", () => {
    const time = { value: 0 };
    const preset = { ...TEST_PRESET, terrain: { ...TEST_PRESET.terrain, rockColor: "#00ff00" } };
    const cliffPoint: ScatterPoint = { position: new Vector3(0, 0, 0), biome: "cliff" };
    const withCliff = createFloor(time, 8, undefined, preset, [cliffPoint]);
    const withoutCliff = createFloor(time, 8, undefined, preset, []);
    const colorWith = withCliff.geometry.getAttribute("color");
    const colorWithout = withoutCliff.geometry.getAttribute("color");
    const position = withCliff.geometry.getAttribute("position");

    let nearestIndex = 0;
    let nearestDistSq = Infinity;
    for (let i = 0; i < position.count; i += 1) {
      const dx = position.getX(i) - cliffPoint.position.x;
      const dz = position.getZ(i) - cliffPoint.position.z;
      const distSq = dx * dx + dz * dz;
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearestIndex = i;
      }
    }
    expect(colorWith.getY(nearestIndex)).toBeGreaterThan(colorWithout.getY(nearestIndex));

    withCliff.geometry.dispose();
    withoutCliff.geometry.dispose();
    (withCliff.material as { dispose(): void }).dispose();
    (withoutCliff.material as { dispose(): void }).dispose();
  });
});
```

6. Update the `./environment` import at the top of the file: remove `computeCoralClusterCenters`, add `createRocks`.

Run: `npm --prefix web run test -- src/environment.test.ts`
Expected: FAIL — `createRocks` doesn't exist yet, `createCoral`/`createFloor`/`createEnvironment` haven't been rewired yet. This is the red step; implementation follows.

#### Step 3: Rewrite `createFloor`, `createCoral`, and add `createRocks` in `environment.ts`

Read `web/src/environment.ts` in full (it changed in Task 1).

**`createFloor`** — replace the whole function:
```ts
const ROCK_TINT_RADIUS = 2.5;

/** `segments` is the floor's detail-level knob (SPEC §6.2): higher = smoother dunes. */
export function createFloor(
  time: TimeUniform,
  segments: number = BACKGROUND_DETAIL_PROFILES.medium.floorSegments,
  causticsEnabled: ToggleUniform = { value: 1 },
  preset: EnvironmentPreset = DEFAULT_ENVIRONMENT_PRESET,
  scatterPoints: readonly ScatterPoint[] = [],
): Mesh {
  const geometry = new PlaneGeometry(72, 72, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  geometry.deleteAttribute("uv");

  const position = geometry.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  const deep = new Color(preset.floor.deep);
  const sand = new Color(preset.floor.sand);
  const rock = new Color(preset.terrain.rockColor);
  const tint = new Color();

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const dune = terrainHeight(x, z, preset.terrain);
    position.setY(i, dune);
    const t = Math.min(1, Math.max(0, dune * 0.35 + 0.5));
    tint.copy(deep).lerp(sand, t);

    let nearestDistSq = Infinity;
    let nearestBiome: Biome | null = null;
    for (const point of scatterPoints) {
      const dx = x - point.position.x;
      const dz = z - point.position.z;
      const distSq = dx * dx + dz * dz;
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearestBiome = point.biome;
      }
    }
    if (nearestBiome === "cliff") {
      const blend = Math.max(0, 1 - Math.sqrt(nearestDistSq) / ROCK_TINT_RADIUS);
      if (blend > 0) tint.lerp(rock, blend);
    }

    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  applyCaustics(material, time, causticsEnabled, new Color(preset.caustics.tint));

  const mesh = new Mesh(geometry, material);
  mesh.position.y = SCENE.floorY;
  mesh.name = "floor";
  return mesh;
}
```

**Delete** `computeCoralClusterCenters` entirely (its job is now `computeScatterPoints`, from Task 1).

**`createCoral`** — replace the whole function:
```ts
/**
 * `profile` sets each primitive's segment counts (SPEC §6.2); `points` are the
 * reef-classified, coral-assigned scatter points this cluster set should
 * render at (see `computeScatterPoints` / the coral-vs-rock split in
 * `createEnvironment`) — the two are independent.
 */
export function createCoral(
  rng: () => number,
  time: TimeUniform,
  profile: CoralDetailProfile = BACKGROUND_DETAIL_PROFILES.medium.coral,
  points: readonly ScatterPoint[] = [],
  causticsEnabled: ToggleUniform = { value: 1 },
  preset: EnvironmentPreset = DEFAULT_ENVIRONMENT_PRESET,
): Mesh {
  const parts: BufferGeometry[] = [];
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const euler = new Euler();
  const scale = new Vector3();
  const position = new Vector3();

  const place = (source: BufferGeometry, color: Color): void => {
    quaternion.setFromEuler(euler);
    matrix.compose(position, quaternion, scale);
    parts.push(bake(source, matrix, color));
  };

  for (const point of points) {
    const baseX = point.position.x;
    const baseY = point.position.y;
    const baseZ = point.position.z;
    const hue = (preset.coral.colors[Math.floor(rng() * preset.coral.colors.length)] ??
      preset.coral.colors[0]) as string;
    const color = new Color(hue).multiplyScalar(0.55 + rng() * 0.3);
    const pieces = 2 + Math.floor(rng() * 3);

    for (let p = 0; p < pieces; p += 1) {
      const height = 0.7 + rng() * 1.9;
      const spread = 0.5 + rng() * 0.9;
      position.set(baseX + (rng() - 0.5) * 1.6, baseY + height * 0.5, baseZ + (rng() - 0.5) * 1.6);
      euler.set((rng() - 0.5) * 0.3, rng() * Math.PI * 2, (rng() - 0.5) * 0.3);
      scale.set(1, 1, 1);

      const kind = rng();
      if (kind < 0.45) {
        place(new ConeGeometry(spread * 0.55, height, profile.coneRadial, profile.coneHeight), color);
      } else if (kind < 0.75) {
        scale.set(spread * 0.8, height * 0.55, spread * 0.8);
        place(new IcosahedronGeometry(0.75, profile.icosahedronDetail), color);
      } else {
        euler.x += Math.PI / 2;
        place(
          new TorusGeometry(spread * 0.6, spread * 0.18, profile.torusRadial, profile.torusTubular),
          color,
        );
      }

      if (rng() < 0.4) {
        position.y = baseY + 0.18;
        euler.set(0, rng() * Math.PI * 2, 0);
        scale.set(1, 1, 1);
        place(
          new CylinderGeometry(
            spread * 0.7,
            spread * 0.9,
            0.36,
            profile.cylinderRadial,
            profile.cylinderHeight,
          ),
          color,
        );
      }
    }
  }

  const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  applyCaustics(material, time, causticsEnabled, new Color(preset.caustics.tint));

  const mesh = new Mesh(mergeBaked(parts), material);
  mesh.name = "coral";
  return mesh;
}
```
(Every `SCENE.floorY` reference inside the old loop body becomes `baseY` — the point's actual terrain-local height, fixing the floating-cluster inconsistency described in the spec. `clusterCenters` is no longer computed or returned here — the caller already has `points` and derives centers directly from it.)

**`createRocks`** — new function, placed right after `createCoral`:
```ts
const CLIFF_HEIGHT_MIN = 2.4;
const CLIFF_HEIGHT_MAX = 4.2;
const CLIFF_TILT_MAX = (25 * Math.PI) / 180;

/**
 * Rock/cliff scatter — the "Primary Scatter: Rock" sibling to `createCoral`'s
 * "Primary Scatter: Large Coral" (docs/superpowers/specs/2026-09-06-procedural-terrain-biomes-design.md §1).
 * `cliff`-biome points get one tall, steeply-tilted formation; `reef`-biome
 * points (routed here instead of to coral, see `createEnvironment`) get a
 * boulder cluster at coral-like scale.
 */
export function createRocks(
  rng: () => number,
  time: TimeUniform,
  profile: CoralDetailProfile = BACKGROUND_DETAIL_PROFILES.medium.coral,
  points: readonly ScatterPoint[] = [],
  causticsEnabled: ToggleUniform = { value: 1 },
  preset: EnvironmentPreset = DEFAULT_ENVIRONMENT_PRESET,
): Mesh {
  const parts: BufferGeometry[] = [];
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const euler = new Euler();
  const scale = new Vector3();
  const position = new Vector3();
  const baseColor = new Color(preset.terrain.rockColor);

  const place = (source: BufferGeometry, color: Color): void => {
    quaternion.setFromEuler(euler);
    matrix.compose(position, quaternion, scale);
    parts.push(bake(source, matrix, color));
  };

  for (const point of points) {
    const color = baseColor.clone().multiplyScalar(0.75 + rng() * 0.3);

    if (point.biome === "cliff") {
      const height = CLIFF_HEIGHT_MIN + rng() * (CLIFF_HEIGHT_MAX - CLIFF_HEIGHT_MIN);
      const width = 0.5 + rng() * 0.5;
      position.set(point.position.x, point.position.y + height * 0.4, point.position.z);
      euler.set((rng() - 0.5) * CLIFF_TILT_MAX, rng() * Math.PI * 2, (rng() - 0.5) * CLIFF_TILT_MAX);
      scale.set(1, 1, 1);
      place(
        new CylinderGeometry(width * 0.4, width, height, profile.cylinderRadial, profile.cylinderHeight),
        color,
      );
    } else {
      const pieces = 1 + Math.floor(rng() * 2);
      for (let p = 0; p < pieces; p += 1) {
        const spread = 0.5 + rng() * 0.8;
        position.set(
          point.position.x + (rng() - 0.5) * 1.4,
          point.position.y + spread * 0.5,
          point.position.z + (rng() - 0.5) * 1.4,
        );
        euler.set(rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2);
        scale.set(spread, spread * (0.6 + rng() * 0.4), spread);
        place(new IcosahedronGeometry(0.75, profile.icosahedronDetail), color);
      }
    }
  }

  const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  applyCaustics(material, time, causticsEnabled, new Color(preset.caustics.tint));

  const mesh = new Mesh(mergeBaked(parts), material);
  mesh.name = "rocks";
  return mesh;
}
```

Run: `npm --prefix web run test -- src/environment.test.ts`
Expected: still FAIL on `createEnvironment`-touching tests (Step 5 rewires it next); the `createCoral`/`createRocks`/`createFloor`-only tests from Steps 1 and 2 should now PASS.

#### Step 4: Add the coral/rock partition helper and rewire `createEnvironment`/`rebuild`/`dispose`

Still in `web/src/environment.ts`, add this module-level helper right after `createRocks`:
```ts
const REEF_CORAL_SHARE = 0.7;

/** Splits scatter points into coral-bound vs. rock-bound sets: cliff -> rock always; reef -> coral most of the time, rock otherwise; sand -> neither. */
function partitionScatterPoints(
  rng: () => number,
  points: readonly ScatterPoint[],
): { coralPoints: ScatterPoint[]; rockPoints: ScatterPoint[] } {
  const coralPoints: ScatterPoint[] = [];
  const rockPoints: ScatterPoint[] = [];
  for (const point of points) {
    if (point.biome === "cliff") {
      rockPoints.push(point);
    } else if (point.biome === "reef") {
      if (rng() < REEF_CORAL_SHARE) coralPoints.push(point);
      else rockPoints.push(point);
    }
  }
  return { coralPoints, rockPoints };
}
```

Update the `Environment` interface's `rebuild` doc comment (cosmetic, optional but keep consistent):
```ts
  /** Rebuild floor/coral/rocks/seaweed/godRays at a new detail level, object count, and/or preset (SPEC §6.5.3). */
  rebuild(detail: DetailLevel, objectCountScale: number, preset?: EnvironmentPreset): void;
```

Replace `createEnvironment`'s body from the `let floor = ...` line through the end of the function:
```ts
  const scatterPoints = computeScatterPoints(rng, coralClusters, preset.terrain);
  const { coralPoints, rockPoints } = partitionScatterPoints(rng, scatterPoints);

  let floor = createFloor(time, profile.floorSegments, causticsEnabled, preset, scatterPoints);
  let coral = createCoral(rng, time, profile.coral, coralPoints, causticsEnabled, preset);
  let rocks = createRocks(rng, time, profile.coral, rockPoints, causticsEnabled, preset);
  let seaweed = createSeaweed(rng, time, profile.seaweedHeightSegments, seaweedCount, preset);
  let godRays = createGodRays(rng, preset);

  group.add(floor, coral, rocks, seaweed);
  group.add(hemisphere, sun, rim, godRays);
  scene.add(group);

  return {
    group,
    coralClusterCenters: coralPoints.map((point) => point.position),
    update(elapsed: number): void {
      time.value = elapsed;
      // Barely perceptible drift of the light shafts.
      godRays.rotation.y = elapsed * 0.012;
      godRays.position.x = Math.sin(elapsed * 0.05) * 0.6;
    },
    rebuild(
      nextDetail: DetailLevel,
      nextObjectCountScale: number,
      nextPreset: EnvironmentPreset = DEFAULT_ENVIRONMENT_PRESET,
    ): void {
      const nextProfile = BACKGROUND_DETAIL_PROFILES[nextDetail];
      const counts = computeObjectCounts(nextObjectCountScale);
      const nextScatterPoints = computeScatterPoints(rng, counts.coralClusters, nextPreset.terrain);
      const nextPartition = partitionScatterPoints(rng, nextScatterPoints);

      const nextFloor = createFloor(time, nextProfile.floorSegments, causticsEnabled, nextPreset, nextScatterPoints);
      const nextCoral = createCoral(
        rng,
        time,
        nextProfile.coral,
        nextPartition.coralPoints,
        causticsEnabled,
        nextPreset,
      );
      const nextRocks = createRocks(
        rng,
        time,
        nextProfile.coral,
        nextPartition.rockPoints,
        causticsEnabled,
        nextPreset,
      );
      const nextSeaweed = createSeaweed(
        rng,
        time,
        nextProfile.seaweedHeightSegments,
        counts.seaweedCount,
        nextPreset,
      );
      const nextGodRays = createGodRays(rng, nextPreset);

      group.add(nextFloor, nextCoral, nextRocks, nextSeaweed, nextGodRays);
      disposeMesh(floor);
      disposeMesh(coral);
      disposeMesh(rocks);
      disposeMesh(seaweed);
      disposeMesh(godRays);

      floor = nextFloor;
      coral = nextCoral;
      rocks = nextRocks;
      seaweed = nextSeaweed;
      godRays = nextGodRays;
    },
    setLighting(nextIntensityScale: number, caustics: boolean): void {
      hemisphere.intensity = BASE_HEMISPHERE_INTENSITY * nextIntensityScale;
      sun.intensity = BASE_SUN_INTENSITY * nextIntensityScale;
      rim.intensity = BASE_RIM_INTENSITY * nextIntensityScale;
      causticsEnabled.value = caustics ? 1 : 0;
    },
    setPreset(nextPreset: EnvironmentPreset): void {
      fog.color.set(nextPreset.water.fogColor);
      fog.density = nextPreset.water.fogDensity;
      scene.background = new Color(nextPreset.water.backgroundColor);
      hemisphere.color.set(nextPreset.lighting.hemisphereSky);
      hemisphere.groundColor.set(nextPreset.lighting.hemisphereGround);
      sun.color.set(nextPreset.lighting.sun);
      rim.color.set(nextPreset.lighting.rim);
    },
    dispose(): void {
      for (const mesh of [floor, coral, rocks, seaweed, godRays]) disposeMesh(mesh);
      group.removeFromParent();
    },
  };
}
```
(`update`/`setLighting`/`setPreset` bodies are unchanged from before Task 2 — reproduced here only so the whole replacement block is unambiguous; `rocks` is the only new piece of state, threaded everywhere `floor`/`coral`/`seaweed` already were.)

Run: `npm --prefix web run test -- src/environment.test.ts`
Expected: PASS — every test in this file, including the ones updated in Steps 1–2.

Run: `npm --prefix web run build`
Expected: FAIL — `settings.ts` and `fish.test.ts` still call the old `createCoral`/`computeCoralClusterCenters` signatures. Fixed next.

#### Step 5: Update `settings.ts`'s `estimateTriangleBudget`

Read `web/src/settings.ts`. Update the `./config` import to add `resolveEnvironmentPreset`:
```ts
import {
  BACKGROUND_DETAIL_PROFILES,
  DEFAULT_ENVIRONMENT_PRESET_ID,
  DEFAULT_SETTINGS,
  ENVIRONMENT_PRESETS,
  FISH_REGISTRY,
  MOOD_PRESETS,
  SETTINGS_LIMITS,
  resolveEnvironmentPreset,
  type AquariumSettings,
  type DetailLevel,
  type FishSpecies,
  type PresetId,
} from "./config";
```
Update the `./environment` import:
```ts
import { computeObjectCounts, computeScatterPoints, createCoral, createFloor, createRocks, createSeaweed } from "./environment";
```

Replace the background section of `estimateTriangleBudget` (from `const profile = BACKGROUND_DETAIL_PROFILES[...]` to the end of the function):
```ts
  const profile = BACKGROUND_DETAIL_PROFILES[settings.background.detail];
  const { coralClusters, seaweedCount } = computeObjectCounts(settings.background.objectCountScale);
  const preset = resolveEnvironmentPreset(settings.background.presetId);
  const time = { value: 0 };
  const rng = createRng(0x5eed_a17c);

  const scatterPoints = computeScatterPoints(rng, coralClusters, preset.terrain);
  // Conservative worst case: at runtime every non-sand point becomes either a
  // coral cluster or a rock formation, never both — summing both here
  // over-estimates rather than under-estimates the real triangle count.
  const nonSandPoints = scatterPoints.filter((point) => point.biome !== "sand");

  const floor = createFloor(time, profile.floorSegments, undefined, preset, scatterPoints);
  total += floor.geometry.getAttribute("position").count / 3;
  floor.geometry.dispose();
  disposeMaterial(floor.material);

  const coral = createCoral(rng, time, profile.coral, nonSandPoints, undefined, preset);
  total += coral.geometry.getAttribute("position").count / 3;
  coral.geometry.dispose();
  disposeMaterial(coral.material);

  const rocks = createRocks(rng, time, profile.coral, nonSandPoints, undefined, preset);
  total += rocks.geometry.getAttribute("position").count / 3;
  rocks.geometry.dispose();
  disposeMaterial(rocks.material);

  const seaweed = createSeaweed(rng, time, profile.seaweedHeightSegments, seaweedCount, preset);
  total += (seaweed.geometry.getAttribute("position").count / 3) * seaweed.count;
  seaweed.geometry.dispose();
  disposeMaterial(seaweed.material);

  // God rays are a fixed, tiny (~14 triangle), non-adjustable count — omitted as negligible.
  return total;
}
```

Run: `npm --prefix web run test -- src/settings.test.ts`
Expected: PASS (nothing in `settings.test.ts` asserts an exact `estimateTriangleBudget` value — only bounds — so this change is safe; confirm by reading the test file if unsure before proceeding).

#### Step 6: Update `fish.test.ts`'s one call site

Read `web/src/fish.test.ts`. Update its `./config` import to add `DEFAULT_ENVIRONMENT_PRESET`, and its `./environment` import to replace `computeCoralClusterCenters` with `computeScatterPoints`.

In the `"60-second fixed-seed acceptance run (§4.3 AC)"` test, change:
```ts
    const clusterCenters = computeCoralClusterCenters(createRng(0x5eed), SCENE.coral.clusters);
```
to:
```ts
    const clusterCenters = computeScatterPoints(createRng(0x5eed), SCENE.coral.clusters, DEFAULT_ENVIRONMENT_PRESET.terrain)
      .filter((point) => point.biome === "reef")
      .map((point) => point.position);
```

Run: `npm --prefix web run test -- src/fish.test.ts`
Expected: PASS — this test only needs *some* realistic set of coral-like positions to drive fish avoidance/territory behavior over 3600 simulated steps; it doesn't assert anything about how many there are.

#### Step 7: Run the full suite and type check

Run: `npm --prefix web run test`
Expected: PASS — every suite.

Run: `npm --prefix web run build`
Expected: PASS with zero `tsc` errors.

#### Step 8: Manual verification

Run: `npm --prefix web run build && npm --prefix web run preview`, open the printed URL.

Check:
- The floor shows visible large-scale undulation (the new macro height layer), not just the old fine ripple.
- Coral clusters visually sit on the floor's actual local surface, not floating at a flat reference height.
- Gray rock formations are visible, distinct in color from coral.
- At least one taller, steeply-leaning cliff-style rock is visible somewhere in the scene (may require orbiting/waiting for the camera drift, or temporarily bumping `great_barrier_reef.yaml`'s `cliffBias` upward during this check if none appears within a reasonable look — revert after confirming).
- No console errors.
- `window.__aq` in devtools: draw calls and triangles both still comfortably under budget (30 / 300,000).

If anything looks wrong (e.g. all-sand or all-cliff scene, rocks embedded inside the floor, coral floating above/below the terrain), fix the underlying formula/constant — do not loosen a test to paper over a visual bug.

#### Step 9: Commit

```bash
git add web/src/environment.ts web/src/environment.test.ts web/src/settings.ts web/src/fish.test.ts
git commit -m "feat: wire terrain/biome pipeline into rendering, add rock/cliff scatter

createFloor now displaces via terrainHeight and biome-tints near cliff
points; createCoral consumes pre-classified reef scatter points (sitting
at their real local terrain height) instead of a flat-floor random cluster
count; new createRocks renders boulder-style reef rocks and tall, tilted
cliff formations as a fifth environment draw call. computeCoralClusterCenters
is replaced by computeScatterPoints + biome filtering everywhere it was used
(createEnvironment, settings.ts's triangle-budget estimate, fish.test.ts)."
```

---

## Self-Review Notes

- **Spec coverage:** §1 (pipeline mapping) → Task 1 Step 7 (analysis/classification/scatter) + Task 2 Steps 3–4 (scatter → rendering, LOD/decoration explicitly untouched per Non-goals). §2 (`EnvironmentPreset.terrain`) → Task 1 Steps 1, 3, 4. §3 (analysis functions) → Task 1 Step 7. §4 (classification) → Task 1 Step 7. §5 (`computeScatterPoints`) → Task 1 Step 7. §6 (consumers: `createCoral`/`createRocks`/`createFloor`/`createEnvironment`) → Task 2 Steps 3–4. §7 (reef → coral vs. rock roll) → Task 2 Step 4 (`partitionScatterPoints`). §8 (draw calls/budget) → Global Constraints + Task 2 Step 5 (estimator). §9 (testing plan) → Task 1 Steps 2, 6; Task 2 Steps 1–2, 5–6. §10 (files touched) → matches this plan's Files lists.
- **Type consistency:** `Biome`, `ScatterPoint`, `terrainHeight`/`terrainSlope`/`terrainCurvature`/`classifyBiome`/`computeScatterPoints` are named and typed identically from their Task 1 introduction through every Task 2 consumer (`createFloor`, `createCoral`, `createRocks`, `createEnvironment`, `settings.ts`, `fish.test.ts`). `createCoral`'s return type change (`{mesh, clusterCenters}` → `Mesh`) is applied consistently everywhere it's called: `createEnvironment`/`rebuild` (Task 2 Step 4), `settings.ts` (Step 5), and every test call site (Task 2 Steps 1–2).
- **Task-boundary buildability:** verified by hand that Task 1 alone leaves the repo green — `createFloor`/`createCoral`/`createEnvironment`/`computeCoralClusterCenters` are untouched throughout Task 1, so `settings.ts` and `fish.test.ts` (not modified until Task 2) keep compiling against the old signatures the whole time. Task 2 alone starts from Task 1's green state; every ripple site (`environment.test.ts`, `settings.ts`, `fish.test.ts`) is enumerated and updated within Task 2, ending green again.
- **No placeholders:** every step has literal code or an exact command; nothing says "update the rest" or "similar to coral" without showing the actual diff.
