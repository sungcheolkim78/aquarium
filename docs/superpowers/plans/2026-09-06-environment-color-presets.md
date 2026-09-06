# Environment Color Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every hardcoded background/water/light/floor/coral/seaweed/bubble color out of `config.ts`/`environment.ts`/`particles.ts` into a YAML-defined "environment preset," ship a `great_barrier_reef` preset tuned from the reference photos as the new default look, and expose it as a settings-panel choice — structured so a future preset (e.g. `hawaii`) is just one more YAML file.

**Architecture:** Task 1 builds the whole rendering-side pipeline — the `EnvironmentPreset` type, the YAML loader, the `great_barrier_reef.yaml` file, and every consumer in `environment.ts`/`particles.ts` — with every new parameter defaulted to `DEFAULT_ENVIRONMENT_PRESET`, so the app already renders the new preset by default the moment Task 1 lands, with zero changes to `settings.ts`/`settingsPanel.ts`/`main.ts`. Task 2 wires the preset into persisted settings, the settings-panel UI, and `main.ts`'s live-update path (including deleting the one now-redundant hardcoded line in `main.ts` and removing the two now-dead `SCENE` fields).

**Tech Stack:** TypeScript (strict), Three.js (`Color`, `FogExp2`, `HemisphereLight`, `DirectionalLight`), the `yaml` npm package (already a dependency), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-06-environment-color-presets-design.md`

## Global Constraints

- All commands run from the repo root using `npm --prefix web run <script>`.
- `npm --prefix web run build` (`tsc --noEmit && vite build`) must pass with zero errors. Optional fields still use conditional spreads under `exactOptionalPropertyTypes`; array/index access TypeScript can't prove is in range needs an explicit `as T` cast (this codebase's existing idiom).
- `npm --prefix web run test` (`vitest run`) must pass.
- A preset changes **color only** — never triangle counts or draw calls. `estimateTriangleBudget` (`settings.ts`) stays untouched; SPEC N1 (draw calls < 30, triangles < 300,000) is unaffected by this feature by construction.
- Creature/fish `palette` (`web/species/fish/*.yaml`) is untouched — out of scope, confirmed with the user.
- The existing "mood" system (`MOOD_PRESETS`/`PresetId`, §6.6) is untouched and orthogonal — do not conflate it with the new environment-preset concept.
- Every new function parameter added to `environment.ts`/`particles.ts` in Task 1 must default to `DEFAULT_ENVIRONMENT_PRESET`'s corresponding value, so every pre-existing call site (including every existing test) keeps compiling and passing unmodified.
- Before either task's final commit, run the full test suite and `tsc --noEmit`. Before considering the whole plan done, additionally run `npm --prefix web run build && npm --prefix web run preview` and visually confirm the aquarium now reads as a bright, clear "Great Barrier Reef" scene (not the old dark navy), with `window.__aq` draw-calls/triangles unchanged from before this feature.

---

### Task 1: Build the `EnvironmentPreset` pipeline and switch every color consumer to it

**Files:**
- Create: `web/scenes/great_barrier_reef.yaml`
- Create: `web/src/scenePresets.ts`
- Create: `web/src/scenePresets.test.ts`
- Create: `web/src/particles.test.ts`
- Modify: `web/src/config.ts`
- Modify: `web/src/environment.ts`
- Modify: `web/src/environment.test.ts`
- Modify: `web/src/particles.ts`

**Interfaces:**
- Produces (consumed by Task 2): `config.ts`'s `EnvironmentPreset` type, `ENVIRONMENT_PRESETS: Record<string, EnvironmentPreset>`, `DEFAULT_ENVIRONMENT_PRESET_ID: string`, `DEFAULT_ENVIRONMENT_PRESET: EnvironmentPreset`, `resolveEnvironmentPreset(id: string): EnvironmentPreset`. `environment.ts`'s `Environment.rebuild(detail, objectCountScale, preset?)` and new `Environment.setPreset(preset)`. `particles.ts`'s new `BubbleField.setTint(tint: Color)`.
- Consumes: nothing new from elsewhere — this task is self-contained on top of existing three.js/`yaml` APIs.

#### Step 1: Write the `great_barrier_reef.yaml` preset file

Create `web/scenes/great_barrier_reef.yaml`:
```yaml
id: great_barrier_reef
label: 그레이트 배리어 리프
description: "밝고 맑은 청록빛 산호초 바다. 강한 햇살과 따뜻한 산호색이 특징이에요."
water:
  fogColor: "#1c6f95"
  fogDensity: 0.032
  backgroundColor: "#0d4a68"
lighting:
  hemisphereSky: "#d9f4ff"
  hemisphereGround: "#123f52"
  sun: "#eaf8ff"
  rim: "#2f8fd8"
caustics:
  tint: "#3a7d82"
godRays:
  tint: "#eaf7ff"
  opacity: 0.1
floor:
  deep: "#2f6b7a"
  sand: "#e3d9b8"
coral:
  colors: ["#ff7a5c", "#e0609e", "#ffb347", "#4fd0b8", "#a07ee0"]
seaweed:
  root: "#1f6e4f"
  tip: "#7be8a8"
bubbles:
  tint: "#cceeff"
```

#### Step 2: Write failing tests for the preset YAML parser/loader

Create `web/src/scenePresets.test.ts`:
```ts
import { describe, expect, it } from "vitest";

import { loadEnvironmentPresetsFromYaml, parseEnvironmentPresetYaml } from "./scenePresets";

const VALID_YAML = `
id: test-preset
label: 테스트 프리셋
description: "테스트용 프리셋이에요."
water: { fogColor: "#112233", fogDensity: 0.04, backgroundColor: "#223344" }
lighting: { hemisphereSky: "#aabbcc", hemisphereGround: "#001122", sun: "#ffffff", rim: "#334455" }
caustics: { tint: "#556677" }
godRays: { tint: "#eeeeee", opacity: 0.08 }
floor: { deep: "#112244", sand: "#ccddaa" }
coral: { colors: ["#ff0000", "#00ff00"] }
seaweed: { root: "#113322", tip: "#66cc88" }
bubbles: { tint: "#ccffff" }
`;

describe("parseEnvironmentPresetYaml", () => {
  it("parses a well-formed file into an EnvironmentPreset with all fields", () => {
    const preset = parseEnvironmentPresetYaml(VALID_YAML, "test-preset.yaml");
    expect(preset.id).toBe("test-preset");
    expect(preset.label).toBe("테스트 프리셋");
    expect(preset.water.fogColor).toBe("#112233");
    expect(preset.water.fogDensity).toBe(0.04);
    expect(preset.coral.colors).toEqual(["#ff0000", "#00ff00"]);
    expect(preset.godRays.opacity).toBe(0.08);
  });

  it("throws naming the file when a required field is missing", () => {
    const broken = VALID_YAML.replace('fogColor: "#112233", ', "");
    expect(() => parseEnvironmentPresetYaml(broken, "test-preset.yaml")).toThrow(/test-preset\.yaml/);
  });

  it("throws when a color is not a valid #rrggbb hex string", () => {
    const broken = VALID_YAML.replace('"#112233"', '"blue"');
    expect(() => parseEnvironmentPresetYaml(broken, "test-preset.yaml")).toThrow(/hex color/);
  });

  it("throws when coral.colors is an empty array", () => {
    const broken = VALID_YAML.replace('colors: ["#ff0000", "#00ff00"]', "colors: []");
    expect(() => parseEnvironmentPresetYaml(broken, "test-preset.yaml")).toThrow(/coral\.colors/);
  });

  it("throws when id does not match the filename slug", () => {
    expect(() => parseEnvironmentPresetYaml(VALID_YAML, "different-name.yaml")).toThrow(/does not match/);
  });
});

describe("loadEnvironmentPresetsFromYaml", () => {
  it("loads the real great_barrier_reef.yaml", () => {
    const presets = loadEnvironmentPresetsFromYaml();
    expect(presets.map((p) => p.id)).toContain("great_barrier_reef");
  });
});
```

Run: `npm --prefix web run test -- src/scenePresets.test.ts`
Expected: FAIL — `./scenePresets` does not exist yet.

#### Step 3: Implement `web/src/scenePresets.ts`

```ts
import { parse } from "yaml";

import type { EnvironmentPreset } from "./config";

function requireObject(value: unknown, field: string, filename: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${filename}: "${field}" must be an object, got ${JSON.stringify(value)}`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string, filename: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${filename}: "${field}" must be a non-empty string, got ${JSON.stringify(value)}`);
  }
  return value;
}

function requireNumber(value: unknown, field: string, filename: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${filename}: "${field}" must be a finite number, got ${JSON.stringify(value)}`);
  }
  return value;
}

function requirePositiveNumber(value: unknown, field: string, filename: string): number {
  const n = requireNumber(value, field, filename);
  if (n <= 0) throw new Error(`${filename}: "${field}" must be > 0, got ${n}`);
  return n;
}

function requireHexColor(value: unknown, field: string, filename: string): string {
  const s = requireString(value, field, filename);
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) {
    throw new Error(`${filename}: "${field}" must be a "#rrggbb" hex color, got ${JSON.stringify(s)}`);
  }
  return s;
}

function requireHexColorArray(value: unknown, field: string, filename: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${filename}: "${field}" must be a non-empty array of hex colors, got ${JSON.stringify(value)}`);
  }
  return value.map((entry, i) => requireHexColor(entry, `${field}[${i}]`, filename));
}

function slugFromFilename(filename: string): string {
  const base = filename.split("/").pop() ?? filename;
  return base.replace(/\.ya?ml$/i, "");
}

/** Parses and validates one environment preset YAML file's raw text. Throws `Error` naming `filename` on any missing/invalid field. */
export function parseEnvironmentPresetYaml(raw: string, filename: string): EnvironmentPreset {
  const doc: unknown = parse(raw);
  const root = requireObject(doc, "<root>", filename);

  const id = requireString(root.id, "id", filename);
  const expectedSlug = slugFromFilename(filename);
  if (id !== expectedSlug) {
    throw new Error(`${filename}: "id" ("${id}") does not match the filename slug ("${expectedSlug}")`);
  }

  const label = requireString(root.label, "label", filename);
  const description = requireString(root.description, "description", filename);

  const waterRaw = requireObject(root.water, "water", filename);
  const water = {
    fogColor: requireHexColor(waterRaw.fogColor, "water.fogColor", filename),
    fogDensity: requirePositiveNumber(waterRaw.fogDensity, "water.fogDensity", filename),
    backgroundColor: requireHexColor(waterRaw.backgroundColor, "water.backgroundColor", filename),
  };

  const lightingRaw = requireObject(root.lighting, "lighting", filename);
  const lighting = {
    hemisphereSky: requireHexColor(lightingRaw.hemisphereSky, "lighting.hemisphereSky", filename),
    hemisphereGround: requireHexColor(lightingRaw.hemisphereGround, "lighting.hemisphereGround", filename),
    sun: requireHexColor(lightingRaw.sun, "lighting.sun", filename),
    rim: requireHexColor(lightingRaw.rim, "lighting.rim", filename),
  };

  const causticsRaw = requireObject(root.caustics, "caustics", filename);
  const caustics = { tint: requireHexColor(causticsRaw.tint, "caustics.tint", filename) };

  const godRaysRaw = requireObject(root.godRays, "godRays", filename);
  const godRays = {
    tint: requireHexColor(godRaysRaw.tint, "godRays.tint", filename),
    opacity: requirePositiveNumber(godRaysRaw.opacity, "godRays.opacity", filename),
  };

  const floorRaw = requireObject(root.floor, "floor", filename);
  const floor = {
    deep: requireHexColor(floorRaw.deep, "floor.deep", filename),
    sand: requireHexColor(floorRaw.sand, "floor.sand", filename),
  };

  const coralRaw = requireObject(root.coral, "coral", filename);
  const coral = { colors: requireHexColorArray(coralRaw.colors, "coral.colors", filename) };

  const seaweedRaw = requireObject(root.seaweed, "seaweed", filename);
  const seaweed = {
    root: requireHexColor(seaweedRaw.root, "seaweed.root", filename),
    tip: requireHexColor(seaweedRaw.tip, "seaweed.tip", filename),
  };

  const bubblesRaw = requireObject(root.bubbles, "bubbles", filename);
  const bubbles = { tint: requireHexColor(bubblesRaw.tint, "bubbles.tint", filename) };

  return { id, label, description, water, lighting, caustics, godRays, floor, coral, seaweed, bubbles };
}

const rawFiles = import.meta.glob("/scenes/*.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Eager-loads every `web/scenes/*.yaml` file, sorted by path. */
export function loadEnvironmentPresetsFromYaml(): readonly EnvironmentPreset[] {
  return Object.keys(rawFiles)
    .sort()
    .map((path) => {
      const filename = path.split("/").pop() ?? path;
      return parseEnvironmentPresetYaml(rawFiles[path] as string, filename);
    });
}
```

Run: `npm --prefix web run test -- src/scenePresets.test.ts`
Expected: still FAIL (or error) — `EnvironmentPreset` isn't exported from `config.ts` yet. Continue to the next step before re-running.

#### Step 4: Add `EnvironmentPreset` and the registry to `config.ts`

Read `web/src/config.ts`. Add this import right after the existing one:
```ts
import { loadFishSpeciesFromYaml } from "./creatures/species/fish";
import { loadEnvironmentPresetsFromYaml } from "./scenePresets";
```

Insert the following immediately before the `/** Scene-wide tuning tokens (palette mirrored in \`style.css\`). */` comment that precedes `export const SCENE = {`:
```ts
/** One named "location" color scheme — water/light/floor/coral/seaweed/bubble hues (docs/superpowers/specs/2026-09-06-environment-color-presets-design.md). */
export interface EnvironmentPreset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly water: {
    readonly fogColor: string;
    readonly fogDensity: number;
    readonly backgroundColor: string;
  };
  readonly lighting: {
    readonly hemisphereSky: string;
    readonly hemisphereGround: string;
    readonly sun: string;
    readonly rim: string;
  };
  readonly caustics: { readonly tint: string };
  readonly godRays: { readonly tint: string; readonly opacity: number };
  readonly floor: { readonly deep: string; readonly sand: string };
  readonly coral: { readonly colors: readonly string[] };
  readonly seaweed: { readonly root: string; readonly tip: string };
  readonly bubbles: { readonly tint: string };
}

const LOADED_ENVIRONMENT_PRESETS = loadEnvironmentPresetsFromYaml();

/** Every environment preset, keyed by id. */
export const ENVIRONMENT_PRESETS: Record<string, EnvironmentPreset> = Object.fromEntries(
  LOADED_ENVIRONMENT_PRESETS.map((preset) => [preset.id, preset]),
);

export const DEFAULT_ENVIRONMENT_PRESET_ID = "great_barrier_reef";

const defaultEnvironmentPreset = ENVIRONMENT_PRESETS[DEFAULT_ENVIRONMENT_PRESET_ID];
if (!defaultEnvironmentPreset) {
  throw new Error(
    `config: default environment preset "${DEFAULT_ENVIRONMENT_PRESET_ID}" not found among loaded presets`,
  );
}
export const DEFAULT_ENVIRONMENT_PRESET: EnvironmentPreset = defaultEnvironmentPreset;

/** Falls back to the default preset for an unknown id — the one place that fallback lives. */
export function resolveEnvironmentPreset(id: string): EnvironmentPreset {
  return ENVIRONMENT_PRESETS[id] ?? DEFAULT_ENVIRONMENT_PRESET;
}

```

Then, in the `SCENE` object, change:
```ts
  godRays: { count: 7, opacity: 0.06 },
```
to:
```ts
  godRays: { count: 7 },
```
(`SCENE.godRays.opacity` is fully replaced by `preset.godRays.opacity`; nothing outside `environment.ts` reads it, and `environment.ts` is updated in Step 6. Leave `SCENE.fog` and `SCENE.background` untouched for now — `main.ts` still reads `SCENE.background` until Task 2 removes that line; removing the field here would break `tsc` before Task 2 lands.)

Run: `npm --prefix web run test -- src/scenePresets.test.ts`
Expected: PASS.

Run: `npm --prefix web run build`
Expected: FAIL — `environment.ts` still reads `SCENE.godRays.opacity`, which no longer exists. Fixed in Step 6.

#### Step 5: Write failing tests for preset color consumption in `environment.ts`

Read `web/src/environment.test.ts`. Update its imports:
```ts
import { describe, expect, it } from "vitest";
import { Color, Scene } from "three";

import { BACKGROUND_DETAIL_PROFILES, SCENE, SEAWEED_COUNT, type EnvironmentPreset } from "./config";
import { createRng } from "./fish";
import {
  computeCoralClusterCenters,
  computeObjectCounts,
  createCoral,
  createEnvironment,
  createFloor,
  createSeaweed,
  mergeBaked,
} from "./environment";
```
(only `Color` and `type EnvironmentPreset` are new; everything else is unchanged from today's imports.)

Add this fixture and new `describe` block anywhere after the existing imports (e.g. right after the `triangleCount` helper):
```ts
const TEST_PRESET: EnvironmentPreset = {
  id: "test",
  label: "Test",
  description: "test preset",
  water: { fogColor: "#111111", fogDensity: 0.02, backgroundColor: "#222222" },
  lighting: { hemisphereSky: "#333333", hemisphereGround: "#444444", sun: "#555555", rim: "#666666" },
  caustics: { tint: "#777777" },
  godRays: { tint: "#888888", opacity: 0.05 },
  floor: { deep: "#101010", sand: "#f0f0f0" },
  coral: { colors: ["#ff00ff"] },
  seaweed: { root: "#0a0a0a", tip: "#eaeaea" },
  bubbles: { tint: "#abcdef" },
};

describe("environment preset color consumption", () => {
  it("createCoral bakes every vertex from the single supplied coral color", () => {
    const time = { value: 0 };
    const { mesh } = createCoral(
      createRng(1),
      time,
      BACKGROUND_DETAIL_PROFILES.medium.coral,
      3,
      undefined,
      TEST_PRESET,
    );
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

  it("createFloor bakes vertex colors between the preset's deep and sand colors", () => {
    const time = { value: 0 };
    const floor = createFloor(time, 4, undefined, TEST_PRESET);
    const color = floor.geometry.getAttribute("color");
    const deep = new Color(TEST_PRESET.floor.deep);
    const sand = new Color(TEST_PRESET.floor.sand);
    for (let i = 0; i < color.count; i += 1) {
      const r = color.getX(i);
      expect(r).toBeGreaterThanOrEqual(Math.min(deep.r, sand.r) - 1e-6);
      expect(r).toBeLessThanOrEqual(Math.max(deep.r, sand.r) + 1e-6);
    }
    floor.geometry.dispose();
    (floor.material as { dispose(): void }).dispose();
  });

  it("createSeaweed bakes vertex colors between the preset's root and tip colors", () => {
    const mesh = createSeaweed(createRng(5), { value: 0 }, 4, 2, TEST_PRESET);
    const color = mesh.geometry.getAttribute("color");
    const root = new Color(TEST_PRESET.seaweed.root);
    const tip = new Color(TEST_PRESET.seaweed.tip);
    for (let i = 0; i < color.count; i += 1) {
      const r = color.getX(i);
      expect(r).toBeGreaterThanOrEqual(Math.min(root.r, tip.r) - 1e-6);
      expect(r).toBeLessThanOrEqual(Math.max(root.r, tip.r) + 1e-6);
    }
    mesh.geometry.dispose();
    (mesh.material as { dispose(): void }).dispose();
  });

  it("createEnvironment applies the preset's fog/background colors and bakes godRays with the preset opacity", () => {
    const scene = new Scene();
    const env = createEnvironment(scene, createRng(3), { preset: TEST_PRESET });
    const fog = scene.fog as unknown as { density: number; color: { getHexString(): string } };
    expect(fog.density).toBe(TEST_PRESET.water.fogDensity);
    expect(fog.color.getHexString()).toBe(new Color(TEST_PRESET.water.fogColor).getHexString());
    const background = scene.background as unknown as { getHexString(): string };
    expect(background.getHexString()).toBe(new Color(TEST_PRESET.water.backgroundColor).getHexString());
    const godRays = env.group.getObjectByName("godRays") as unknown as { material: { opacity: number } };
    expect(godRays.material.opacity).toBeCloseTo(TEST_PRESET.godRays.opacity, 6);
    env.dispose();
  });

  it("Environment.setPreset updates fog/background colors without replacing floor/coral/seaweed mesh instances", () => {
    const scene = new Scene();
    const env = createEnvironment(scene, createRng(3));
    const floorBefore = env.group.getObjectByName("floor");
    const coralBefore = env.group.getObjectByName("coral");
    const seaweedBefore = env.group.getObjectByName("seaweed");

    env.setPreset(TEST_PRESET);

    expect(env.group.getObjectByName("floor")).toBe(floorBefore);
    expect(env.group.getObjectByName("coral")).toBe(coralBefore);
    expect(env.group.getObjectByName("seaweed")).toBe(seaweedBefore);
    const fog = scene.fog as unknown as { density: number };
    expect(fog.density).toBe(TEST_PRESET.water.fogDensity);
    env.dispose();
  });

  it("Environment.rebuild with a changed preset replaces floor/coral/seaweed/godRays with new mesh instances", () => {
    const scene = new Scene();
    const env = createEnvironment(scene, createRng(3));
    const before = {
      floor: env.group.getObjectByName("floor"),
      coral: env.group.getObjectByName("coral"),
      seaweed: env.group.getObjectByName("seaweed"),
      godRays: env.group.getObjectByName("godRays"),
    };

    env.rebuild("medium", 1, TEST_PRESET);

    expect(env.group.getObjectByName("floor")).not.toBe(before.floor);
    expect(env.group.getObjectByName("coral")).not.toBe(before.coral);
    expect(env.group.getObjectByName("seaweed")).not.toBe(before.seaweed);
    expect(env.group.getObjectByName("godRays")).not.toBe(before.godRays);
    env.dispose();
  });
});
```

Run: `npm --prefix web run test -- src/environment.test.ts`
Expected: FAIL — `createCoral`/`createFloor`/`createSeaweed`/`createEnvironment` don't accept a `preset` argument yet, and `Environment` has no `setPreset`; `rebuild` doesn't accept a third argument.

#### Step 6: Thread `EnvironmentPreset` through every color-producing function in `environment.ts`

Read `web/src/environment.ts` in full, then apply these changes in place (do not otherwise restructure the file):

1. Update the `config` import:
   ```ts
   import {
     BACKGROUND_DETAIL_PROFILES,
     DEFAULT_ENVIRONMENT_PRESET,
     SCENE,
     SEAWEED_COUNT,
     type CoralDetailProfile,
     type DetailLevel,
     type EnvironmentPreset,
   } from "./config";
   ```

2. `applyCaustics` gains a defaulted `tint` parameter and uses it in the shader instead of the hardcoded `vec3`:
   ```ts
   export function applyCaustics(
     material: MeshLambertMaterial,
     time: TimeUniform,
     enabled: ToggleUniform,
     tint: Color = new Color(DEFAULT_ENVIRONMENT_PRESET.caustics.tint),
   ): void {
   ```
   and change:
   ```ts
   diffuseColor.rgb += vec3( 0.16, 0.33, 0.36 ) * caustic * mix( 1.0, 0.35, depthFade ) * uCausticsEnabled;`,
   ```
   to:
   ```ts
   diffuseColor.rgb += vec3( ${tint.r.toFixed(3)}, ${tint.g.toFixed(3)}, ${tint.b.toFixed(3)} ) * caustic * mix( 1.0, 0.35, depthFade ) * uCausticsEnabled;`,
   ```

3. `createFloor` gains a defaulted `preset` parameter; `deep`/`sand` and the `applyCaustics` call use it:
   ```ts
   export function createFloor(
     time: TimeUniform,
     segments: number = BACKGROUND_DETAIL_PROFILES.medium.floorSegments,
     causticsEnabled: ToggleUniform = { value: 1 },
     preset: EnvironmentPreset = DEFAULT_ENVIRONMENT_PRESET,
   ): Mesh {
     const geometry = new PlaneGeometry(72, 72, segments, segments);
     geometry.rotateX(-Math.PI / 2);
     geometry.deleteAttribute("uv");

     const position = geometry.getAttribute("position");
     const colors = new Float32Array(position.count * 3);
     const deep = new Color(preset.floor.deep);
     const sand = new Color(preset.floor.sand);
     const tint = new Color();
     ...
     const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
     applyCaustics(material, time, causticsEnabled, new Color(preset.caustics.tint));
     ...
   ```
   (the `...` sections are the existing dune-height loop and `mesh`/`return` — unchanged, keep them exactly as they are today.)

4. Delete the module-level `const CORAL_COLORS = [...]` line entirely. `createCoral` gains a defaulted `preset` parameter, picks its hue from `preset.coral.colors`, and passes the caustics tint through:
   ```ts
   export function createCoral(
     rng: () => number,
     time: TimeUniform,
     profile: CoralDetailProfile = BACKGROUND_DETAIL_PROFILES.medium.coral,
     clusterCount: number = SCENE.coral.clusters,
     causticsEnabled: ToggleUniform = { value: 1 },
     preset: EnvironmentPreset = DEFAULT_ENVIRONMENT_PRESET,
   ): { mesh: Mesh; clusterCenters: readonly Vector3[] } {
   ```
   inside the cluster loop, change:
   ```ts
   const hue = CORAL_COLORS[Math.floor(rng() * CORAL_COLORS.length)] ?? CORAL_COLORS[0];
   ```
   to:
   ```ts
   const hue = (preset.coral.colors[Math.floor(rng() * preset.coral.colors.length)] ??
     preset.coral.colors[0]) as string;
   ```
   and change:
   ```ts
   const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
   applyCaustics(material, time, causticsEnabled);
   ```
   to:
   ```ts
   const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
   applyCaustics(material, time, causticsEnabled, new Color(preset.caustics.tint));
   ```

5. `createSeaweed` gains a defaulted `preset` parameter; `root`/`tip` use it:
   ```ts
   export function createSeaweed(
     rng: () => number,
     time: TimeUniform,
     heightSegments: number = BACKGROUND_DETAIL_PROFILES.medium.seaweedHeightSegments,
     count: number = SEAWEED_COUNT,
     preset: EnvironmentPreset = DEFAULT_ENVIRONMENT_PRESET,
   ): InstancedMesh {
     ...
     const root = new Color(preset.seaweed.root);
     const tip = new Color(preset.seaweed.tip);
     ...
   ```

6. `createGodRays` (not exported) gains a defaulted `preset` parameter; tint and opacity use it:
   ```ts
   function createGodRays(rng: () => number, preset: EnvironmentPreset = DEFAULT_ENVIRONMENT_PRESET): Mesh {
     ...
     const tint = new Color(preset.godRays.tint);
     ...
     const material = new MeshBasicMaterial({
       vertexColors: true,
       transparent: true,
       opacity: preset.godRays.opacity,
       blending: AdditiveBlending,
       depthWrite: false,
       side: DoubleSide,
       fog: true,
     });
     ...
   ```

7. `CreateEnvironmentOptions` gains an optional `preset`:
   ```ts
   export interface CreateEnvironmentOptions {
     readonly detail?: DetailLevel;
     readonly objectCountScale?: number;
     readonly lightingIntensityScale?: number;
     readonly caustics?: boolean;
     readonly preset?: EnvironmentPreset;
   }
   ```

8. `Environment` interface gains a `preset` parameter on `rebuild` (optional, since the concrete implementation defaults it — see step 9) and a new `setPreset` method:
   ```ts
   export interface Environment {
     readonly group: Group;
     readonly coralClusterCenters: readonly Vector3[];
     update(elapsed: number): void;
     rebuild(detail: DetailLevel, objectCountScale: number, preset?: EnvironmentPreset): void;
     setLighting(intensityScale: number, caustics: boolean): void;
     /** Immediately updates fog/background/light colors from a new preset — no geometry rebuild. */
     setPreset(preset: EnvironmentPreset): void;
     dispose(): void;
   }
   ```

9. Rewrite `createEnvironment`'s body:
   ```ts
   export function createEnvironment(
     scene: Scene,
     rng: () => number,
     options: CreateEnvironmentOptions = {},
   ): Environment {
     const preset = options.preset ?? DEFAULT_ENVIRONMENT_PRESET;
     const fog = new FogExp2(preset.water.fogColor, preset.water.fogDensity);
     scene.fog = fog;
     scene.background = new Color(preset.water.backgroundColor);

     const time: TimeUniform = { value: 0 };
     const causticsEnabled: ToggleUniform = { value: options.caustics === false ? 0 : 1 };
     const group = new Group();
     group.name = "environment";

     const intensityScale = options.lightingIntensityScale ?? 1;
     const hemisphere = new HemisphereLight(
       preset.lighting.hemisphereSky,
       preset.lighting.hemisphereGround,
       BASE_HEMISPHERE_INTENSITY * intensityScale,
     );
     const sun = new DirectionalLight(preset.lighting.sun, BASE_SUN_INTENSITY * intensityScale);
     sun.position.set(4, 18, 6);
     const rim = new DirectionalLight(preset.lighting.rim, BASE_RIM_INTENSITY * intensityScale);
     rim.position.set(-8, 4, -10);

     const detail = options.detail ?? "medium";
     const objectCountScale = options.objectCountScale ?? 1;
     const profile = BACKGROUND_DETAIL_PROFILES[detail];
     const { coralClusters, seaweedCount } = computeObjectCounts(objectCountScale);

     let floor = createFloor(time, profile.floorSegments, causticsEnabled, preset);
     let { mesh: coral, clusterCenters } = createCoral(
       rng,
       time,
       profile.coral,
       coralClusters,
       causticsEnabled,
       preset,
     );
     let seaweed = createSeaweed(rng, time, profile.seaweedHeightSegments, seaweedCount, preset);
     let godRays = createGodRays(rng, preset);

     group.add(floor, coral, seaweed);
     group.add(hemisphere, sun, rim, godRays);
     scene.add(group);

     return {
       group,
       coralClusterCenters: clusterCenters,
       update(elapsed: number): void {
         time.value = elapsed;
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

         const nextFloor = createFloor(time, nextProfile.floorSegments, causticsEnabled, nextPreset);
         const nextCoralResult = createCoral(
           rng,
           time,
           nextProfile.coral,
           counts.coralClusters,
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

         group.add(nextFloor, nextCoralResult.mesh, nextSeaweed, nextGodRays);
         disposeMesh(floor);
         disposeMesh(coral);
         disposeMesh(seaweed);
         disposeMesh(godRays);

         floor = nextFloor;
         coral = nextCoralResult.mesh;
         clusterCenters = nextCoralResult.clusterCenters;
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
         for (const mesh of [floor, coral, seaweed, godRays]) disposeMesh(mesh);
         group.removeFromParent();
       },
     };
   }
   ```
   Note `floor`/`coral`/`seaweed` were already `let`-bound in the existing code; `godRays` changes from `const` to `let` here since `rebuild` now reassigns it too.

Run: `npm --prefix web run test -- src/environment.test.ts`
Expected: PASS (all of today's existing tests plus the new ones from Step 5).

Run: `npm --prefix web run build`
Expected: still FAIL — `particles.ts` hasn't been touched yet, but that failure is unrelated (`environment.ts`/`config.ts` themselves should now be clean). If `tsc` reports an error inside `environment.ts` or `config.ts`, fix it before moving on; do not proceed with a broken `environment.ts`.

#### Step 7: Write failing tests for `particles.ts`'s tint

Create `web/src/particles.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { Color } from "three";

import { createRng } from "./fish";
import { createBubbles } from "./particles";

describe("createBubbles tint", () => {
  it("bakes each particle's color from the supplied tint scaled by its own random brightness", () => {
    // Pure magenta (G=0): every particle's green channel must stay exactly 0 regardless
    // of its per-particle brightness multiplier; red/blue must stay > 0.
    const tint = new Color(1, 0, 1);
    const field = createBubbles(createRng(1), 20, tint);
    const color = field.points.geometry.getAttribute("color");
    for (let i = 0; i < color.count; i += 1) {
      expect(color.getY(i)).toBe(0);
      expect(color.getX(i)).toBeGreaterThan(0);
      expect(color.getZ(i)).toBeGreaterThan(0);
    }
    field.dispose();
  });

  it("setTint recolors every particle while preserving relative brightness ordering", () => {
    const field = createBubbles(createRng(2), 20, new Color(1, 1, 1));
    const color = field.points.geometry.getAttribute("color");
    const before = Array.from({ length: color.count }, (_, i) => color.getX(i));

    field.setTint(new Color(0.5, 0.5, 0.5));
    const after = Array.from({ length: color.count }, (_, i) => color.getX(i));

    for (let i = 0; i < color.count; i += 1) expect(after[i]).toBeLessThan(before[i] as number);
    const brightestBefore = before.indexOf(Math.max(...before));
    const brightestAfter = after.indexOf(Math.max(...after));
    expect(brightestAfter).toBe(brightestBefore);
    field.dispose();
  });
});
```

Run: `npm --prefix web run test -- src/particles.test.ts`
Expected: FAIL — `createBubbles` doesn't accept a `tint` argument yet, and `BubbleField` has no `setTint`.

#### Step 8: Implement the tint parameter and `setTint` in `particles.ts`

Read `web/src/particles.ts`. Update the `config` import:
```ts
import { DEFAULT_ENVIRONMENT_PRESET, SCENE } from "./config";
```

Add `setTint` to the `BubbleField` interface:
```ts
export interface BubbleField {
  readonly points: Points;
  update(dt: number, elapsed: number): void;
  setDensityScale(scale: number): void;
  setEnabled(enabled: boolean): void;
  /** Recolors every particle from its stored per-particle brightness against a new base tint. No rebuild. */
  setTint(tint: Color): void;
  dispose(): void;
}
```

Replace `createBubbles`'s body with:
```ts
export function createBubbles(
  rng: () => number,
  count: number = SCENE.bubbles.count,
  tint: Color = new Color(DEFAULT_ENVIRONMENT_PRESET.bubbles.tint),
): BubbleField {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const brightness = new Float32Array(count);
  const columnX = new Float32Array(count);
  const columnZ = new Float32Array(count);
  const speeds = new Float32Array(count);
  const phases = new Float32Array(count);
  const wobbles = new Float32Array(count);

  const bottom = SCENE.floorY + 0.15;
  const span = SCENE.bounds.y * 2 + 2.5;
  const working = new Color();

  for (let i = 0; i < count; i += 1) {
    const angle = rng() * Math.PI * 2;
    const radius = rng() * (SCENE.bounds.x * 0.92);
    columnX[i] = Math.cos(angle) * radius;
    columnZ[i] = Math.sin(angle) * radius;
    speeds[i] = SCENE.bubbles.riseSpeed * (0.45 + rng() * 1.35);
    phases[i] = rng() * Math.PI * 2;
    wobbles[i] = 0.12 + rng() * 0.34;

    positions[i * 3] = columnX[i] ?? 0;
    positions[i * 3 + 1] = bottom + rng() * span;
    positions[i * 3 + 2] = columnZ[i] ?? 0;

    const b = 0.45 + rng() * 0.55;
    brightness[i] = b;
    working.copy(tint).multiplyScalar(b);
    colors[i * 3] = working.r;
    colors[i * 3 + 1] = working.g;
    colors[i * 3 + 2] = working.b;
  }

  const geometry = new BufferGeometry();
  const positionAttribute = new BufferAttribute(positions, 3);
  positionAttribute.setUsage(DynamicDrawUsage);
  geometry.setAttribute("position", positionAttribute);
  const colorAttribute = new BufferAttribute(colors, 3);
  geometry.setAttribute("color", colorAttribute);
  geometry.setDrawRange(0, count);
  geometry.boundingSphere = null;

  const sprite = createBubbleSprite();
  const material = new PointsMaterial({
    size: SCENE.bubbles.size,
    map: sprite,
    vertexColors: true,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    blending: AdditiveBlending,
    sizeAttenuation: true,
    fog: true,
  });

  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.name = "bubbles";

  let drawCount = count;

  return {
    points,
    update(dt: number, elapsed: number): void {
      const top = bottom + span;
      for (let i = 0; i < drawCount; i += 1) {
        const base = i * 3;
        let y = (positions[base + 1] ?? bottom) + (speeds[i] ?? 0) * dt;
        if (y > top) y = bottom;
        positions[base + 1] = y;

        const phase = phases[i] ?? 0;
        const wobble = wobbles[i] ?? 0;
        positions[base] = (columnX[i] ?? 0) + Math.sin(elapsed * 0.9 + phase) * wobble;
        positions[base + 2] = (columnZ[i] ?? 0) + Math.cos(elapsed * 0.75 + phase * 1.4) * wobble;
      }
      positionAttribute.needsUpdate = true;
    },
    setDensityScale(scale: number): void {
      drawCount = Math.max(1, Math.min(count, Math.round(count * scale)));
      geometry.setDrawRange(0, drawCount);
    },
    setEnabled(enabled: boolean): void {
      points.visible = enabled;
    },
    setTint(nextTint: Color): void {
      const nextWorking = new Color();
      for (let i = 0; i < count; i += 1) {
        nextWorking.copy(nextTint).multiplyScalar(brightness[i] ?? 1);
        colors[i * 3] = nextWorking.r;
        colors[i * 3 + 1] = nextWorking.g;
        colors[i * 3 + 2] = nextWorking.b;
      }
      colorAttribute.needsUpdate = true;
    },
    dispose(): void {
      points.removeFromParent();
      geometry.dispose();
      material.dispose();
      sprite.dispose();
    },
  };
}
```

(This is the whole function — the `createBubbleSprite` helper above it and everything else in the file is unchanged.)

Run: `npm --prefix web run test -- src/particles.test.ts`
Expected: PASS.

#### Step 9: Run the full test suite and type check, then commit

Run: `npm --prefix web run test`
Expected: PASS (every suite, including the untouched `fish.test.ts`, `config.test.ts`, `settings.test.ts`, `observations.test.ts`, `creatures/species/fish.test.ts`).

Run: `npm --prefix web run build`
Expected: PASS with zero `tsc` errors.

Run: `npm --prefix web run build && npm --prefix web run preview`, open the printed URL, and confirm the aquarium already looks brighter/clearer (the new default preset), since `main.ts` hasn't changed yet but every builder now defaults to `DEFAULT_ENVIRONMENT_PRESET`. Check the browser console for errors and evaluate `window.__aq` to confirm draw-calls/triangles are unchanged from before this feature.

```bash
git add web/scenes web/src/scenePresets.ts web/src/scenePresets.test.ts web/src/particles.test.ts web/src/config.ts web/src/environment.ts web/src/environment.test.ts web/src/particles.ts
git commit -m "feat: add YAML-driven environment color presets, default to great_barrier_reef

Every water/light/floor/coral/seaweed/bubble color in environment.ts and
particles.ts now comes from an EnvironmentPreset (web/scenes/*.yaml),
defaulting to a new great_barrier_reef preset tuned from reference photos.
Every new parameter defaults to that preset, so the app already renders
it without any settings/UI wiring, which is the next task."
```

---

### Task 2: Wire the preset into settings, the settings panel, and `main.ts`

**Files:**
- Modify: `web/src/config.ts`
- Modify: `web/src/config.test.ts`
- Modify: `web/src/settings.ts`
- Modify: `web/src/settings.test.ts`
- Modify: `web/src/settingsPanel.ts`
- Modify: `web/src/main.ts`

**Interfaces:**
- Consumes: `EnvironmentPreset`, `ENVIRONMENT_PRESETS`, `DEFAULT_ENVIRONMENT_PRESET_ID`, `resolveEnvironmentPreset` (Task 1, `config.ts`); `Environment.rebuild(detail, objectCountScale, preset)`, `Environment.setPreset(preset)`, `BubbleField.setTint(tint)` (Task 1, `environment.ts`/`particles.ts`).
- Produces: `AquariumSettings.background.presetId: string`; `settings.ts`'s `withBackgroundPreset(settings, presetId): AquariumSettings`.

#### Step 1: Add `presetId` to `AquariumSettings` and `DEFAULT_SETTINGS`

In `web/src/config.ts`, change:
```ts
  readonly background: {
    readonly detail: DetailLevel;
    /** Multiplies coral cluster count and seaweed instance count. */
    readonly objectCountScale: number;
  };
```
to:
```ts
  readonly background: {
    readonly detail: DetailLevel;
    /** Multiplies coral cluster count and seaweed instance count. */
    readonly objectCountScale: number;
    /** Which `ENVIRONMENT_PRESETS` entry controls water/light/floor/coral/bubble color. */
    readonly presetId: string;
  };
```
and change:
```ts
  background: { detail: "medium", objectCountScale: 1 },
```
to:
```ts
  background: { detail: "medium", objectCountScale: 1, presetId: DEFAULT_ENVIRONMENT_PRESET_ID },
```
in `DEFAULT_SETTINGS`.

Also now remove `SCENE.fog`/`SCENE.background` (no longer read anywhere once Step 5 below deletes `main.ts`'s line): change
```ts
export const SCENE = {
  /** Exponential-squared fog: the sense of depth (SPEC §6.3). */
  fog: { color: 0x0a3550, density: 0.052 },
  background: 0x061e30,
  /** Half-extents of the swimmable box, centred on the reef. */
```
to:
```ts
export const SCENE = {
  /** Half-extents of the swimmable box, centred on the reef. */
```

Run: `npm --prefix web run build`
Expected: FAIL — `main.ts` still references `SCENE.background` (fixed in Step 5) and `settings.ts`'s `sanitizeSettings`/`MAX_SETTINGS` are missing the new required `presetId` field (fixed in Step 2).

#### Step 2: `settings.ts` — sanitize, reducer, `MAX_SETTINGS`

Read `web/src/settings.ts`. Update the `config` import:
```ts
import {
  BACKGROUND_DETAIL_PROFILES,
  DEFAULT_ENVIRONMENT_PRESET_ID,
  DEFAULT_SETTINGS,
  ENVIRONMENT_PRESETS,
  FISH_REGISTRY,
  MOOD_PRESETS,
  SETTINGS_LIMITS,
  type AquariumSettings,
  type DetailLevel,
  type FishSpecies,
  type PresetId,
} from "./config";
```

Add a validator next to `isDetailLevel`:
```ts
function isEnvironmentPresetId(value: unknown): value is string {
  return typeof value === "string" && value in ENVIRONMENT_PRESETS;
}
```

In `sanitizeSettings`, change:
```ts
    background: {
      detail: isDetailLevel(background.detail) ? background.detail : DEFAULT_SETTINGS.background.detail,
      objectCountScale: clampNumber(
        background.objectCountScale,
        SETTINGS_LIMITS.background.objectCountScale.min,
        SETTINGS_LIMITS.background.objectCountScale.max,
        DEFAULT_SETTINGS.background.objectCountScale,
      ),
    },
```
to:
```ts
    background: {
      detail: isDetailLevel(background.detail) ? background.detail : DEFAULT_SETTINGS.background.detail,
      objectCountScale: clampNumber(
        background.objectCountScale,
        SETTINGS_LIMITS.background.objectCountScale.min,
        SETTINGS_LIMITS.background.objectCountScale.max,
        DEFAULT_SETTINGS.background.objectCountScale,
      ),
      presetId: isEnvironmentPresetId(background.presetId)
        ? background.presetId
        : DEFAULT_SETTINGS.background.presetId,
    },
```

Add a reducer right after `withBackgroundObjectCountScale`:
```ts
export function withBackgroundPreset(settings: AquariumSettings, presetId: string): AquariumSettings {
  return { ...settings, background: { ...settings.background, presetId } };
}
```

In `MAX_SETTINGS`, change:
```ts
  background: { detail: "high", objectCountScale: SETTINGS_LIMITS.background.objectCountScale.max },
```
to:
```ts
  background: {
    detail: "high",
    objectCountScale: SETTINGS_LIMITS.background.objectCountScale.max,
    presetId: DEFAULT_ENVIRONMENT_PRESET_ID,
  },
```

Run: `npm --prefix web run build`
Expected: still FAIL — `main.ts` (Step 5) not yet fixed; `settings.ts`/`config.ts` should now be internally consistent.

#### Step 3: Write failing tests for the new settings behavior

In `web/src/config.test.ts`, update the import:
```ts
import {
  DEFAULT_ENVIRONMENT_PRESET_ID,
  DEFAULT_SETTINGS,
  ENVIRONMENT_PRESETS,
  FISH_REGISTRY,
  SCENE,
  computeQualityScales,
  effectiveMinFps,
  resolveEnvironmentPreset,
  type CreatureSpecies,
} from "./config";
```
and add a new `describe` block:
```ts
describe("environment presets", () => {
  it("has the default preset registered", () => {
    expect(ENVIRONMENT_PRESETS[DEFAULT_ENVIRONMENT_PRESET_ID]).toBeDefined();
  });

  it("DEFAULT_SETTINGS points at a real preset id", () => {
    expect(DEFAULT_SETTINGS.background.presetId).toBe(DEFAULT_ENVIRONMENT_PRESET_ID);
    expect(ENVIRONMENT_PRESETS[DEFAULT_SETTINGS.background.presetId]).toBeDefined();
  });

  it("resolveEnvironmentPreset falls back to the default for an unknown id", () => {
    expect(resolveEnvironmentPreset("does-not-exist").id).toBe(DEFAULT_ENVIRONMENT_PRESET_ID);
  });
});
```

In `web/src/settings.test.ts`, update the imports:
```ts
import {
  DEFAULT_ENVIRONMENT_PRESET_ID,
  DEFAULT_SETTINGS,
  ENVIRONMENT_PRESETS,
  FISH_REGISTRY,
  MOOD_PRESETS,
  SETTINGS_LIMITS,
  type AquariumSettings,
  type PresetId,
} from "./config";
import {
  MAX_SETTINGS,
  debounce,
  estimateTriangleBudget,
  getLocalStorage,
  loadSettings,
  matchingPresetId,
  saveSettings,
  sanitizeSettings,
  withBackgroundObjectCountScale,
  withBackgroundPreset,
  withBubblesDensityScale,
  withCameraMode,
  withCaustics,
  withFishCountScale,
  withFishDetail,
  withLightingIntensityScale,
  withPowerSave,
  withPreset,
  withSpeciesEnabled,
  withVolume,
} from "./settings";
```
(only `DEFAULT_ENVIRONMENT_PRESET_ID`, `ENVIRONMENT_PRESETS`, and `withBackgroundPreset` are new.)

Add these `describe` blocks (e.g. right after the existing `describe("sanitizeSettings", ...)` block):
```ts
describe("sanitizeSettings for background.presetId", () => {
  it("falls back to the default preset id when missing or unknown", () => {
    const missing = sanitizeSettings({
      schemaVersion: 1,
      fish: { enabledSpecies: {}, detail: "medium", countScale: 1 },
      background: { detail: "medium", objectCountScale: 1 },
      lighting: { intensityScale: 1, caustics: true },
      bubbles: { enabled: true, densityScale: 1 },
    });
    expect(missing?.background.presetId).toBe(DEFAULT_ENVIRONMENT_PRESET_ID);

    const unknown = sanitizeSettings({
      schemaVersion: 1,
      fish: { enabledSpecies: {}, detail: "medium", countScale: 1 },
      background: { detail: "medium", objectCountScale: 1, presetId: "not-a-real-preset" },
      lighting: { intensityScale: 1, caustics: true },
      bubbles: { enabled: true, densityScale: 1 },
    });
    expect(unknown?.background.presetId).toBe(DEFAULT_ENVIRONMENT_PRESET_ID);
  });

  it("round-trips a known preset id", () => {
    const otherId = Object.keys(ENVIRONMENT_PRESETS)[0] as string;
    const sanitized = sanitizeSettings({
      schemaVersion: 1,
      fish: { enabledSpecies: {}, detail: "medium", countScale: 1 },
      background: { detail: "medium", objectCountScale: 1, presetId: otherId },
      lighting: { intensityScale: 1, caustics: true },
      bubbles: { enabled: true, densityScale: 1 },
    });
    expect(sanitized?.background.presetId).toBe(otherId);
  });
});

describe("withBackgroundPreset", () => {
  it("sets only background.presetId", () => {
    const otherId = Object.keys(ENVIRONMENT_PRESETS)[0] as string;
    const next = withBackgroundPreset(DEFAULT_SETTINGS, otherId);
    expect(next.background.presetId).toBe(otherId);
    expect(next.background.detail).toBe(DEFAULT_SETTINGS.background.detail);
    expect(next.background.objectCountScale).toBe(DEFAULT_SETTINGS.background.objectCountScale);
  });
});

describe("MAX_SETTINGS", () => {
  it("references a valid environment preset id", () => {
    expect(ENVIRONMENT_PRESETS[MAX_SETTINGS.background.presetId]).toBeDefined();
  });
});
```

Run: `npm --prefix web run test -- src/config.test.ts src/settings.test.ts`
Expected: PASS (the code from Step 2 already makes these pass — this step is verifying, not implementing).

#### Step 4: Add the "배경 테마" settings-panel section

Read `web/src/settingsPanel.ts`. Update imports:
```ts
import type { AquariumSettings, DetailLevel, FishSpecies } from "./config";
import { DEFAULT_SETTINGS, ENVIRONMENT_PRESETS, MOOD_PRESETS, type PresetId } from "./config";
import {
  matchingPresetId,
  withBackgroundDetail,
  withBackgroundObjectCountScale,
  withBackgroundPreset,
  withBubblesDensityScale,
  withBubblesEnabled,
  withCameraMode,
  withCaustics,
  withFishCountScale,
  withFishDetail,
  withLightingIntensityScale,
  withPowerSave,
  withPreset,
  withSpeciesEnabled,
  withVolume,
} from "./settings";
```

In `createSettingsPanel`, immediately **before** the existing `// 배경 설정 (디테일)` section, insert:
```ts
  // 배경 테마 -----------------------------------------------------------------
  const backgroundTheme = section("배경 테마");
  backgroundTheme.body.append(
    radioGroup(
      "background-preset",
      Object.values(ENVIRONMENT_PRESETS).map((preset) => ({ value: preset.id, label: preset.label })),
      current.background.presetId,
      (presetId) => emit(withBackgroundPreset(current, presetId)),
      cleanups,
    ),
  );

```
(`radioGroup` is the existing generic helper already defined earlier in this file — no new UI primitive.)

Run: `npm --prefix web run build`
Expected: still FAIL — `main.ts` (Step 5) is the only remaining broken file.

#### Step 5: Wire `main.ts`

Read `web/src/main.ts`. Update the `config` import:
```ts
import {
  FISH_REGISTRY,
  SCENE,
  computeQualityScales,
  effectiveMinFps,
  resolveEnvironmentPreset,
  type AquariumSettings,
  type EnvironmentPreset,
} from "./config";
```

Delete the now-redundant line (environment.ts's `createEnvironment` sets `scene.background` itself):
```ts
  const scene = new Scene();
  scene.background = new Color(SCENE.background);
```
becomes:
```ts
  const scene = new Scene();
```

In the `createEnvironment(...)` call, add the `preset` option:
```ts
  const environment = createEnvironment(scene, rng, {
    detail: settings.background.detail,
    objectCountScale: settings.background.objectCountScale,
    lightingIntensityScale: settings.lighting.intensityScale,
    caustics: settings.lighting.caustics,
    preset: resolveEnvironmentPreset(settings.background.presetId),
  });
```

Change the `createBubbles` call to pass an explicit tint:
```ts
  const bubbles = createBubbles(
    rng,
    SCENE.bubbles.count,
    new Color(resolveEnvironmentPreset(settings.background.presetId).bubbles.tint),
  );
```

Change the `rebuildBackground` debounce wrapper to also take a preset:
```ts
  const rebuildBackground = debounce(
    (
      detail: AquariumSettings["background"]["detail"],
      objectCountScale: number,
      preset: EnvironmentPreset,
    ): void => {
      environment.rebuild(detail, objectCountScale, preset);
    },
    150,
  );
```

In the settings `onChange` handler, change:
```ts
      if (
        prev.background.detail !== next.background.detail ||
        prev.background.objectCountScale !== next.background.objectCountScale
      ) {
        rebuildBackground(next.background.detail, next.background.objectCountScale);
      }
```
to:
```ts
      if (
        prev.background.detail !== next.background.detail ||
        prev.background.objectCountScale !== next.background.objectCountScale ||
        prev.background.presetId !== next.background.presetId
      ) {
        rebuildBackground(
          next.background.detail,
          next.background.objectCountScale,
          resolveEnvironmentPreset(next.background.presetId),
        );
      }

      if (prev.background.presetId !== next.background.presetId) {
        const nextPreset = resolveEnvironmentPreset(next.background.presetId);
        environment.setPreset(nextPreset);
        bubbles.setTint(new Color(nextPreset.bubbles.tint));
      }
```

`Color` is still imported from `"three"` at the top of the file (it now backs the two `new Color(...)` calls above instead of the deleted line) — no import changes needed there.

Run: `npm --prefix web run build`
Expected: PASS with zero `tsc` errors.

#### Step 6: Run the full test suite, then manually verify

Run: `npm --prefix web run test`
Expected: PASS — every suite.

Run: `npm --prefix web run build && npm --prefix web run preview`, open the printed URL:
- Confirm the scene still renders the bright `great_barrier_reef` look (unchanged from Task 1's manual check).
- Open the settings panel, find the new "배경 테마" section — it should show one radio option ("그레이트 배리어 리프"), already selected.
- Click it (even though it's the only option) and confirm no console errors and the scene doesn't visibly glitch (the debounced rebuild + immediate `setPreset`/`setTint` should both fire harmlessly with the same preset).
- Evaluate `window.__aq` — draw-calls/triangles should be unchanged from before this whole feature (still well under 30 / 300,000).
- Reload the page — the settings-panel selection should still show the same preset (persisted via `localStorage`).

If anything looks wrong, fix the specific code — do not loosen a test to paper over a visual or functional bug.

#### Step 7: Commit

```bash
git add web/src/config.ts web/src/config.test.ts web/src/settings.ts web/src/settings.test.ts web/src/settingsPanel.ts web/src/main.ts
git commit -m "feat: expose the environment preset as a persisted, selectable setting

background.presetId is now part of AquariumSettings (sanitized, with a
withBackgroundPreset reducer), shown as a settings-panel radio group that
lists every ENVIRONMENT_PRESETS entry, and wired into main.ts so a preset
change updates fog/background/light colors immediately and rebuilds
floor/coral/seaweed/godRays on the existing debounce path."
```

---

## Self-Review Notes

- **Spec coverage:** §1 (architecture) → Task 1 Steps 3–4. §2 (schema + `great_barrier_reef` values) → Task 1 Steps 1, 4. §3 `config.ts`/`environment.ts`/`particles.ts` → Task 1 Steps 4, 6, 8. §3 `settings.ts`/`settingsPanel.ts`/`main.ts` → Task 2 Steps 1–2, 4–5. §4 (testing plan) → Task 1 Steps 2, 5, 7; Task 2 Step 3. §5 (files touched) → matches this plan's Files lists.
- **Type consistency:** `EnvironmentPreset`, `ENVIRONMENT_PRESETS`, `DEFAULT_ENVIRONMENT_PRESET_ID`, `DEFAULT_ENVIRONMENT_PRESET`, `resolveEnvironmentPreset` are named and shaped identically between Task 1's `config.ts` step and every later consumer (Task 1's `environment.ts`/`particles.ts`, Task 2's `settings.ts`/`settingsPanel.ts`/`main.ts`). `Environment.rebuild`'s third parameter is optional in the interface (Task 1 Step 6.8) and defaulted in the implementation (Step 6.9) so Task 1's `main.ts`-untouched state still compiles; Task 2 always calls it with an explicit third argument.
- **Task-boundary buildability:** confirmed by hand that Task 1 alone leaves the repo green (every new parameter is defaulted; `SCENE.godRays.opacity` is removed only because nothing outside `environment.ts` reads it; `SCENE.fog`/`SCENE.background` are deliberately left in place through Task 1 because `main.ts` still reads `SCENE.background` until Task 2 Step 5 deletes that line in the same task that removes the fields in Step 1) and Task 2 alone starts from Task 1's green state and ends green again.
- **No placeholders:** every step has literal code or an exact command; nothing says "wire it up" or "similar to Task 1" without showing the actual diff.
