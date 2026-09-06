# Environment Color Presets Design

**Source:** `resources/scene/great_barrier_reef{1..4}.png` (reference art) + conversation request to tune the aquarium's water/light/floor/coral/bubble colors toward those photos and make the whole "look" YAML-driven and swappable.

**Goal:** Pull every background/environment color currently hardcoded across `config.ts`/`environment.ts`/`particles.ts` into a per-location YAML file ("environment preset"), ship a first preset (`great_barrier_reef`) tuned from the reference photos, make it the app's new default look, and expose it as a settings-panel choice — all structured so a second preset (e.g. `hawaii`) is just one more YAML file, no code changes.

**Non-goals:**
- Creature/fish `palette` (body/fin/accent/eye) — untouched. Species YAML (`web/species/fish/*.yaml`) already owns per-species color and is orthogonal to this feature.
- `SCENE.bounds`/`camera`/`quality`/`coral.clusters`/`coral.avoidanceRadius`/`coral.avoidanceHeight` and all other non-color scene mechanics — untouched.
- The existing "mood" system (`MOOD_PRESETS`/`PresetId`, §6.6) — untouched and orthogonal: mood dials intensity/fish-count/bubble-density; this feature dials *hue*, on a completely independent settings field.
- Matching the reference photos' saturation 1:1 — the app's calming "quiet aquarium" intent still governs; colors move meaningfully brighter/clearer but stay short of the photos' cartoon-vivid saturation.

## 1. Architecture

Mirrors the `web/species/fish/*.yaml` → `creatures/species/fish.ts` → `config.ts` pattern from the fish-grammar work, but flat (there is only one "kind" of preset, not several creature kinds needing namespacing):

```
web/scenes/great_barrier_reef.yaml   -- one file per location preset, no ordering significance
        |
        v  import.meta.glob('/scenes/*.yaml', { query: '?raw', import: 'default', eager: true })
web/src/scenePresets.ts              -- parses (yaml pkg) + validates -> EnvironmentPreset[]
        |
        v
web/src/config.ts                    -- ENVIRONMENT_PRESETS (by id), DEFAULT_ENVIRONMENT_PRESET_ID/_PRESET
```

- New directory `web/scenes/`, one YAML file per preset, named by id (`great_barrier_reef.yaml`) — no numeric prefix, since presets are looked up by id, never iterated in a meaningful order.
- New module `web/src/scenePresets.ts`, self-contained (own small `requireObject`/`requireString`/`requireNumber`/`requireHexColor` validators, deliberately **not** shared with `creatures/species/fish.ts` — three duplicated ~5-line helpers is simpler and lower-risk than extracting a shared validation module for a single reuse site):
  ```ts
  export function parseEnvironmentPresetYaml(raw: string, filename: string): EnvironmentPreset; // throws Error("<filename>: <reason>") on any missing/invalid field
  export function loadEnvironmentPresetsFromYaml(): readonly EnvironmentPreset[]; // eager-loaded, sorted by path
  ```
- `config.ts` composes:
  ```ts
  const LOADED_ENVIRONMENT_PRESETS = loadEnvironmentPresetsFromYaml();
  export const ENVIRONMENT_PRESETS: Record<string, EnvironmentPreset> = Object.fromEntries(
    LOADED_ENVIRONMENT_PRESETS.map((preset) => [preset.id, preset]),
  );
  export const DEFAULT_ENVIRONMENT_PRESET_ID = "great_barrier_reef";
  const defaultPreset = ENVIRONMENT_PRESETS[DEFAULT_ENVIRONMENT_PRESET_ID];
  if (!defaultPreset) throw new Error(`config: default environment preset "${DEFAULT_ENVIRONMENT_PRESET_ID}" not found`);
  export const DEFAULT_ENVIRONMENT_PRESET: EnvironmentPreset = defaultPreset;
  /** Falls back to the default preset for an unknown id — the one place that fallback lives. */
  export function resolveEnvironmentPreset(id: string): EnvironmentPreset {
    return ENVIRONMENT_PRESETS[id] ?? DEFAULT_ENVIRONMENT_PRESET;
  }
  ```
  A malformed preset file throws at module-init time (build-time boundary check), same as the species loader.

## 2. `EnvironmentPreset` schema + the `great_barrier_reef` values

```ts
export interface EnvironmentPreset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly water: { readonly fogColor: string; readonly fogDensity: number; readonly backgroundColor: string };
  readonly lighting: {
    readonly hemisphereSky: string;
    readonly hemisphereGround: string;
    readonly sun: string;
    readonly rim: string;
  };
  readonly caustics: { readonly tint: string };
  readonly godRays: { readonly tint: string; readonly opacity: number };
  readonly floor: { readonly deep: string; readonly sand: string };
  readonly coral: { readonly colors: readonly string[] }; // non-empty
  readonly seaweed: { readonly root: string; readonly tip: string };
  readonly bubbles: { readonly tint: string };
}
```

`web/scenes/great_barrier_reef.yaml`, values chosen by eye against the 4 reference photos (bright saturated turquoise water, strong near-white sunbeams, warm pale sand, vivid orange/pink/purple/teal coral) but pulled back from the photos' full saturation for the app's calming intent:

```yaml
id: great_barrier_reef
label: 그레이트 배리어 리프
description: "밝고 맑은 청록빛 산호초 바다. 강한 햇살과 따뜻한 산호색이 특징이에요."
water:    { fogColor: "#1c6f95", fogDensity: 0.032, backgroundColor: "#0d4a68" }
lighting: { hemisphereSky: "#d9f4ff", hemisphereGround: "#123f52", sun: "#eaf8ff", rim: "#2f8fd8" }
caustics: { tint: "#3a7d82" }
godRays:  { tint: "#eaf7ff", opacity: 0.1 }
floor:    { deep: "#2f6b7a", sand: "#e3d9b8" }
coral:    { colors: ["#ff7a5c", "#e0609e", "#ffb347", "#4fd0b8", "#a07ee0"] }
seaweed:  { root: "#1f6e4f", tip: "#7be8a8" }
bubbles:  { tint: "#cceeff" }
```

Versus today's hardcoded values: `fogColor` #0a3550→#1c6f95 (brighter, more cyan), `fogDensity` 0.052→0.032 (clearer water, matching how far the photos let you see), `backgroundColor` #061e30→#0d4a68 (far-away color, still much brighter), `godRays.opacity` 0.06→0.1 (more prominent shafts), floor `deep`/`sand` both lightened and warmed, coral palette brightened, everything else (seaweed, bubbles, caustics, light hues) shifted toward the same brighter/cooler-water register. Exact hex values are tuned further by eye during implementation (`npm run preview`), not treated as final here.

## 3. Consuming code changes

### `config.ts`
- Add `EnvironmentPreset` and sub-interfaces (§2), `ENVIRONMENT_PRESETS`/`DEFAULT_ENVIRONMENT_PRESET_ID`/`DEFAULT_ENVIRONMENT_PRESET`/`resolveEnvironmentPreset` (§1).
- Remove `SCENE.fog` and `SCENE.background` (fully replaced by `preset.water.*`). Remove `SCENE.godRays.opacity` (replaced by `preset.godRays.opacity`); **keep** `SCENE.godRays.count` (a shaft-count constant, not a color).
- `AquariumSettings.background` gains `readonly presetId: string`.
- `DEFAULT_SETTINGS.background` gains `presetId: DEFAULT_ENVIRONMENT_PRESET_ID`.

### `environment.ts`
Every builder gains a `preset: EnvironmentPreset = DEFAULT_ENVIRONMENT_PRESET` parameter (defaulted, so every existing call site/test that doesn't pass one keeps working unchanged — same pattern as `detail: DetailLevel = "medium"` today):

- `applyCaustics(material, time, enabled, tint: Color = new Color(DEFAULT_ENVIRONMENT_PRESET.caustics.tint))` — the shader's hardcoded `vec3(0.16, 0.33, 0.36)` becomes `vec3(${tint.r.toFixed(3)}, ${tint.g.toFixed(3)}, ${tint.b.toFixed(3)})`.
- `createFloor(time, segments, causticsEnabled, preset)` — `deep`/`sand` colors and the `applyCaustics` tint come from `preset.floor.*`/`preset.caustics.tint`.
- `createCoral(rng, time, profile, clusterCount, causticsEnabled, preset)` — the module-level `CORAL_COLORS` const is deleted; colors are picked from `preset.coral.colors`.
- `createSeaweed(rng, time, heightSegments, count, preset)` — `root`/`tip` from `preset.seaweed.*`.
- `createGodRays(rng, preset)` — tint from `preset.godRays.tint`, opacity from `preset.godRays.opacity` (not `SCENE.godRays.opacity` anymore).
- `createEnvironment(scene, rng, options)`: `options` gains `readonly preset?: EnvironmentPreset`. Resolves `const preset = options.preset ?? DEFAULT_ENVIRONMENT_PRESET;`. Sets `scene.fog = new FogExp2(preset.water.fogColor, preset.water.fogDensity)` (keeping the `FogExp2` instance in a local `fog` variable, not just `scene.fog`, so it can be mutated in place later) and **newly** `scene.background = new Color(preset.water.backgroundColor)` (moved here from `main.ts` — this module now owns every water/light color). Light constructors read `preset.lighting.*` instead of hardcoded hex.
- `Environment` interface: `rebuild(detail, objectCountScale, preset: EnvironmentPreset)` — third parameter added (no default; callers always have a concrete active preset). `rebuild()` now also recreates `godRays` (previously untouched by rebuild) using the new preset, alongside floor/coral/seaweed.
- `Environment` interface gains `setPreset(preset: EnvironmentPreset): void` — an **immediate** (non-debounced) update path for the parts that don't need a geometry rebuild: `fog.color.set(preset.water.fogColor); fog.density = preset.water.fogDensity; scene.background = new Color(preset.water.backgroundColor); hemisphere.color.set(preset.lighting.hemisphereSky); hemisphere.groundColor.set(preset.lighting.hemisphereGround); sun.color.set(preset.lighting.sun); rim.color.set(preset.lighting.rim);`. Called every time the preset changes; `rebuild()` (debounced, heavier) is called for the same change to refresh the baked-vertex-color meshes.

### `particles.ts`
- `createBubbles(rng, count = SCENE.bubbles.count, tint: Color = new Color(DEFAULT_ENVIRONMENT_PRESET.bubbles.tint))` — the per-particle color is `tint` scaled by that particle's own random brightness factor (`0.45 + rng() * 0.55`, unchanged), instead of a hardcoded `setRGB(0.72, 0.9, 1)`. Each particle's brightness factor is now stored in a `Float32Array` (previously computed and discarded) so it can be reapplied against a *different* tint later.
- `BubbleField` gains `setTint(tint: Color): void` — recomputes every particle's color from its stored brightness factor against the new tint and flags the color attribute dirty. No geometry/points rebuild.

### `settings.ts`
- `sanitizeSettings`: `presetId: isEnvironmentPresetId(background.presetId) ? background.presetId : DEFAULT_SETTINGS.background.presetId` where `isEnvironmentPresetId(value): value is string => typeof value === "string" && value in ENVIRONMENT_PRESETS` (a stale/removed preset id from old `localStorage` falls back safely, same shape as `isDetailLevel`).
- New reducer: `withBackgroundPreset(settings, presetId: string): AquariumSettings` — sets `background.presetId`, leaves `detail`/`objectCountScale` untouched. Not re-validated here (the settings panel only ever offers known ids; `sanitizeSettings` is the actual trust boundary, same division of responsibility as every other reducer in this file).
- `MAX_SETTINGS.background` gains `presetId: DEFAULT_ENVIRONMENT_PRESET_ID` (arbitrary — doesn't affect `estimateTriangleBudget`, which stays untouched: a preset changes color, never triangle count).

### `settingsPanel.ts`
New "배경 테마" section, placed just above the existing "배경 설정" (detail) section (a theme choice is the higher-level decision; quality/count sliders follow it). Built with the *existing* generic `radioGroup` helper — no new UI primitive, no `<select>`:
```ts
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
A future `web/scenes/hawaii.yaml` automatically appears as a second radio option — no `settingsPanel.ts` change needed.

### `main.ts`
- Remove the standalone `scene.background = new Color(SCENE.background);` line (now owned by `environment.ts`).
- `createEnvironment(scene, rng, { ..., preset: resolveEnvironmentPreset(settings.background.presetId) })`.
- `createBubbles(rng, SCENE.bubbles.count, new Color(resolveEnvironmentPreset(settings.background.presetId).bubbles.tint))`.
- `rebuildBackground` debounced signature gains the preset parameter: `debounce((detail, objectCountScale, preset: EnvironmentPreset) => environment.rebuild(detail, objectCountScale, preset), 150)`.
- In the settings `onChange` handler: the existing "rebuild background" condition also fires on `prev.background.presetId !== next.background.presetId`, passing `resolveEnvironmentPreset(next.background.presetId)`. A **separate**, unconditional-on-debounce block reacts to a presetId change specifically by calling `environment.setPreset(nextPreset)` and `bubbles.setTint(new Color(nextPreset.bubbles.tint))` immediately (so fog/background/light-color/bubble-tint feel instant, while the heavier floor/coral/seaweed/godRays regeneration still debounces).

## 4. Testing plan

- `scenePresets.test.ts` (new): valid YAML round-trips into the expected `EnvironmentPreset`; missing field / invalid `#rrggbb` color / empty `coral.colors` array / filename-id mismatch each throw naming the file; `loadEnvironmentPresetsFromYaml()` loads the real `great_barrier_reef.yaml` with `id === "great_barrier_reef"`.
- `config.test.ts` additions: `ENVIRONMENT_PRESETS[DEFAULT_ENVIRONMENT_PRESET_ID]` is defined; `DEFAULT_SETTINGS.background.presetId === DEFAULT_ENVIRONMENT_PRESET_ID`; `resolveEnvironmentPreset("nonexistent-id")` returns `DEFAULT_ENVIRONMENT_PRESET`.
- `settings.test.ts` additions: `sanitizeSettings` defaults a missing/unknown `background.presetId` to `DEFAULT_ENVIRONMENT_PRESET_ID`; `withBackgroundPreset` sets only that field; `MAX_SETTINGS.background.presetId` is a valid `ENVIRONMENT_PRESETS` key.
- `environment.test.ts` additions (existing tests stay unmodified, since every new parameter defaults): construct a custom `EnvironmentPreset` with distinctive colors and assert `createFloor`/`createCoral`/`createSeaweed`/`createGodRays` bake vertex colors consistent with it (e.g. a single-color `coral.colors` array ⇒ every coral vertex matches that color exactly); `createEnvironment` with a custom preset sets `scene.background` and `scene.fog`'s color/density to match; `Environment.setPreset` updates `scene.fog`/`scene.background`/light colors without replacing the `floor`/`coral`/`seaweed` mesh objects (identity-check before/after); `Environment.rebuild` with a changed preset (same detail/objectCountScale) still produces new floor/coral/seaweed/godRays mesh instances reflecting the new colors.
- `particles.test.ts` (new — `particles.ts` currently has no tests; `setTint` is real logic worth covering per this repo's own testing convention): `setTint` recolors every particle from its stored per-particle brightness so that two particles with different original brightness stay proportionally different after a retint; default `tint` sources from `DEFAULT_ENVIRONMENT_PRESET.bubbles.tint` when omitted.
- Manual (`npm run preview`): confirm the whole scene reads as a bright, clear "Great Barrier Reef" look (not the old dark navy); switch the new "배경 테마" radio in the settings panel (even with only one option for now) and confirm no console errors on rebuild; verify `window.__aq` draw-calls/triangles are unchanged from before this feature (a preset changes color, not geometry counts).

## 5. Files touched

- `web/scenes/great_barrier_reef.yaml` (new).
- `web/src/scenePresets.ts` (new) + `web/src/scenePresets.test.ts` (new).
- `web/src/config.ts` — `EnvironmentPreset` family, `ENVIRONMENT_PRESETS`/`DEFAULT_ENVIRONMENT_PRESET_ID`/`DEFAULT_ENVIRONMENT_PRESET`/`resolveEnvironmentPreset`; `SCENE.fog`/`SCENE.background`/`SCENE.godRays.opacity` removed; `AquariumSettings.background.presetId` added; `DEFAULT_SETTINGS` updated.
- `web/src/environment.ts` — every builder gains a defaulted `preset` parameter (§3); `Environment.rebuild` gains a `preset` parameter and now also rebuilds `godRays`; new `Environment.setPreset`; `scene.background` ownership moves here.
- `web/src/particles.ts` — `createBubbles` gains a defaulted `tint` parameter + stored per-particle brightness; new `BubbleField.setTint`.
- `web/src/settings.ts` — `sanitizeSettings`/`isEnvironmentPresetId`, `withBackgroundPreset`, `MAX_SETTINGS.background.presetId`.
- `web/src/settingsPanel.ts` — new "배경 테마" `radioGroup` section.
- `web/src/main.ts` — wiring per §3.
- `web/src/environment.test.ts` — additions only, no existing test modified.
- `web/src/config.test.ts`, `web/src/settings.test.ts` — additions.
- `web/src/particles.test.ts` (new).
