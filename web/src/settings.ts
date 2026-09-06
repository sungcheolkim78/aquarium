/**
 * Settings state: sanitization, `localStorage` persistence, a debounce helper
 * for rebuild-triggering fields, and the triangle-budget estimator that backs
 * N1/AC-7. (SPEC §6.5.2, §6.5.6, N5, N6.)
 */

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
import type { Material } from "three";

import { buildCreatureGeometry, createRng } from "./fish";
import {
  computeObjectCounts,
  computeScatterPoints,
  createCoral,
  createFloor,
  createRocks,
  createSeaweed,
} from "./environment";

function disposeMaterial(material: Material | Material[]): void {
  if (Array.isArray(material)) {
    for (const m of material) m.dispose();
  } else {
    material.dispose();
  }
}

const STORAGE_KEY = "aquarium:settings";

/**
 * Safely access `window.localStorage`. In some environments (private
 * browsing in older Safari, sandboxed iframes, non-browser test runners)
 * the `localStorage` property getter itself throws, before any call
 * reaches `loadSettings`/`saveSettings`'s own try/catch.
 */
export function getLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

function isDetailLevel(value: unknown): value is DetailLevel {
  return value === "low" || value === "medium" || value === "high";
}

function isCameraMode(value: unknown): value is "drift" | "fixed" {
  return value === "drift" || value === "fixed";
}

function isEnvironmentPresetId(value: unknown): value is string {
  return typeof value === "string" && value in ENVIRONMENT_PRESETS;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** Keep only ids present in the current registry; default missing ones to shown. */
function sanitizeEnabledSpecies(
  raw: unknown,
  registry: readonly FishSpecies[],
): Record<string, boolean> {
  const source = asRecord(raw);
  const result: Record<string, boolean> = {};
  for (const species of registry) {
    const value = source[species.id];
    result[species.id] = typeof value === "boolean" ? value : true;
  }
  return result;
}

/**
 * Validate and clamp an arbitrary value into an `AquariumSettings`. Returns
 * `null` if the value isn't a plausible settings object at all (wrong
 * schema version, not an object) — the caller falls back to
 * `DEFAULT_SETTINGS` (AC-6).
 */
export function sanitizeSettings(
  raw: unknown,
  registry: readonly FishSpecies[] = FISH_REGISTRY,
): AquariumSettings | null {
  const value = asRecord(raw);
  if (Object.keys(value).length === 0 && (typeof raw !== "object" || raw === null)) return null;
  if (value.schemaVersion !== 1) return null;

  const fish = asRecord(value.fish);
  const background = asRecord(value.background);
  const lighting = asRecord(value.lighting);
  const bubbles = asRecord(value.bubbles);
  const camera = asRecord(value.camera);
  const performance = asRecord(value.performance);
  const audio = asRecord(value.audio);

  return {
    schemaVersion: 1,
    fish: {
      enabledSpecies: sanitizeEnabledSpecies(fish.enabledSpecies, registry),
      detail: isDetailLevel(fish.detail) ? fish.detail : DEFAULT_SETTINGS.fish.detail,
      countScale: clampNumber(
        fish.countScale,
        SETTINGS_LIMITS.fish.countScale.min,
        SETTINGS_LIMITS.fish.countScale.max,
        DEFAULT_SETTINGS.fish.countScale,
      ),
    },
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
    lighting: {
      intensityScale: clampNumber(
        lighting.intensityScale,
        SETTINGS_LIMITS.lighting.intensityScale.min,
        SETTINGS_LIMITS.lighting.intensityScale.max,
        DEFAULT_SETTINGS.lighting.intensityScale,
      ),
      caustics: typeof lighting.caustics === "boolean" ? lighting.caustics : DEFAULT_SETTINGS.lighting.caustics,
    },
    bubbles: {
      enabled: typeof bubbles.enabled === "boolean" ? bubbles.enabled : DEFAULT_SETTINGS.bubbles.enabled,
      densityScale: clampNumber(
        bubbles.densityScale,
        SETTINGS_LIMITS.bubbles.densityScale.min,
        SETTINGS_LIMITS.bubbles.densityScale.max,
        DEFAULT_SETTINGS.bubbles.densityScale,
      ),
    },
    camera: {
      mode: isCameraMode(camera.mode) ? camera.mode : DEFAULT_SETTINGS.camera.mode,
    },
    performance: {
      powerSave:
        typeof performance.powerSave === "boolean"
          ? performance.powerSave
          : DEFAULT_SETTINGS.performance.powerSave,
    },
    audio: {
      volume: clampNumber(
        audio.volume,
        SETTINGS_LIMITS.audio.volume.min,
        SETTINGS_LIMITS.audio.volume.max,
        DEFAULT_SETTINGS.audio.volume,
      ),
    },
  };
}

/** Read persisted settings, falling back to `DEFAULT_SETTINGS` on any problem (N5, AC-6). */
export function loadSettings(storage: Pick<Storage, "getItem"> | undefined): AquariumSettings {
  if (storage === undefined) return DEFAULT_SETTINGS;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_SETTINGS;
    return sanitizeSettings(JSON.parse(raw)) ?? DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Persist settings (N5). Silently no-ops if storage is unavailable (quota/private mode). */
export function saveSettings(settings: AquariumSettings, storage: Pick<Storage, "setItem"> | undefined): void {
  if (storage === undefined) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable — the setting simply won't survive a reload.
  }
}

/**
 * Delay-and-collapse repeated calls into one, firing `waitMs` after the last
 * call (SPEC N6, AC-5). Used for settings fields that require a geometry
 * rebuild, so dragging a slider doesn't rebuild on every `input` event.
 */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  waitMs: number,
): ((...args: Args) => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = (...args: Args): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, waitMs);
  };
  debounced.cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return debounced;
}

/** Pure state transitions for each settings-panel control (SPEC §9 "설정 상태 리듀서"). */

export function withSpeciesEnabled(
  settings: AquariumSettings,
  speciesId: string,
  enabled: boolean,
): AquariumSettings {
  return {
    ...settings,
    fish: {
      ...settings.fish,
      enabledSpecies: { ...settings.fish.enabledSpecies, [speciesId]: enabled },
    },
  };
}

export function withFishDetail(settings: AquariumSettings, detail: DetailLevel): AquariumSettings {
  return { ...settings, fish: { ...settings.fish, detail } };
}

export function withFishCountScale(settings: AquariumSettings, countScale: number): AquariumSettings {
  return {
    ...settings,
    fish: {
      ...settings.fish,
      countScale: clampNumber(
        countScale,
        SETTINGS_LIMITS.fish.countScale.min,
        SETTINGS_LIMITS.fish.countScale.max,
        settings.fish.countScale,
      ),
    },
  };
}

export function withBackgroundDetail(
  settings: AquariumSettings,
  detail: DetailLevel,
): AquariumSettings {
  return { ...settings, background: { ...settings.background, detail } };
}

export function withBackgroundObjectCountScale(
  settings: AquariumSettings,
  objectCountScale: number,
): AquariumSettings {
  return {
    ...settings,
    background: {
      ...settings.background,
      objectCountScale: clampNumber(
        objectCountScale,
        SETTINGS_LIMITS.background.objectCountScale.min,
        SETTINGS_LIMITS.background.objectCountScale.max,
        settings.background.objectCountScale,
      ),
    },
  };
}

export function withBackgroundPreset(settings: AquariumSettings, presetId: string): AquariumSettings {
  return { ...settings, background: { ...settings.background, presetId } };
}

export function withLightingIntensityScale(
  settings: AquariumSettings,
  intensityScale: number,
): AquariumSettings {
  return {
    ...settings,
    lighting: {
      ...settings.lighting,
      intensityScale: clampNumber(
        intensityScale,
        SETTINGS_LIMITS.lighting.intensityScale.min,
        SETTINGS_LIMITS.lighting.intensityScale.max,
        settings.lighting.intensityScale,
      ),
    },
  };
}

export function withCaustics(settings: AquariumSettings, caustics: boolean): AquariumSettings {
  return { ...settings, lighting: { ...settings.lighting, caustics } };
}

export function withBubblesEnabled(settings: AquariumSettings, enabled: boolean): AquariumSettings {
  return { ...settings, bubbles: { ...settings.bubbles, enabled } };
}

export function withBubblesDensityScale(
  settings: AquariumSettings,
  densityScale: number,
): AquariumSettings {
  return {
    ...settings,
    bubbles: {
      ...settings.bubbles,
      densityScale: clampNumber(
        densityScale,
        SETTINGS_LIMITS.bubbles.densityScale.min,
        SETTINGS_LIMITS.bubbles.densityScale.max,
        settings.bubbles.densityScale,
      ),
    },
  };
}

export function withCameraMode(
  settings: AquariumSettings,
  mode: AquariumSettings["camera"]["mode"],
): AquariumSettings {
  return { ...settings, camera: { ...settings.camera, mode } };
}

export function withPowerSave(settings: AquariumSettings, powerSave: boolean): AquariumSettings {
  return { ...settings, performance: { ...settings.performance, powerSave } };
}

export function withVolume(settings: AquariumSettings, volume: number): AquariumSettings {
  return {
    ...settings,
    audio: {
      ...settings.audio,
      volume: clampNumber(volume, SETTINGS_LIMITS.audio.volume.min, SETTINGS_LIMITS.audio.volume.max, settings.audio.volume),
    },
  };
}

export function withPreset(settings: AquariumSettings, presetId: PresetId): AquariumSettings {
  const preset = MOOD_PRESETS[presetId];
  return {
    ...settings,
    lighting: { ...settings.lighting, intensityScale: preset.lightingIntensityScale },
    fish: { ...settings.fish, countScale: preset.fishCountScale },
    bubbles: {
      ...settings.bubbles,
      enabled: preset.bubblesEnabled,
      densityScale: preset.bubblesDensityScale,
    },
  };
}

/** Which mood preset (if any) the current settings exactly match — a derived UI hint, never persisted (SPEC §6.6). */
export function matchingPresetId(settings: AquariumSettings): PresetId | null {
  for (const id of Object.keys(MOOD_PRESETS) as PresetId[]) {
    const preset = MOOD_PRESETS[id];
    if (
      settings.lighting.intensityScale === preset.lightingIntensityScale &&
      settings.fish.countScale === preset.fishCountScale &&
      settings.bubbles.enabled === preset.bubblesEnabled &&
      settings.bubbles.densityScale === preset.bubblesDensityScale
    ) {
      return id;
    }
  }
  return null;
}

/** The most demanding combination reachable from the settings panel (SPEC §6.5.6, AC-7). */
export const MAX_SETTINGS: AquariumSettings = {
  schemaVersion: 1,
  fish: {
    enabledSpecies: Object.fromEntries(FISH_REGISTRY.map((species) => [species.id, true])),
    detail: "high",
    countScale: SETTINGS_LIMITS.fish.countScale.max,
  },
  background: {
    detail: "high",
    objectCountScale: SETTINGS_LIMITS.background.objectCountScale.max,
    presetId: DEFAULT_ENVIRONMENT_PRESET_ID,
  },
  lighting: { intensityScale: SETTINGS_LIMITS.lighting.intensityScale.max, caustics: true },
  bubbles: { enabled: true, densityScale: SETTINGS_LIMITS.bubbles.densityScale.max },
  camera: { mode: "drift" },
  performance: { powerSave: false },
  audio: { volume: SETTINGS_LIMITS.audio.volume.max },
};

/**
 * Estimate total rendered triangles for a settings combination (SPEC §6.5.6).
 * Deterministic: coral/seaweed layout uses a fixed seed, since only the
 * *count* of triangles is being budgeted, not the actual scene layout.
 */
export function estimateTriangleBudget(
  settings: AquariumSettings,
  registry: readonly FishSpecies[] = FISH_REGISTRY,
): number {
  let total = 0;

  for (const species of registry) {
    if (settings.fish.enabledSpecies[species.id] === false) continue;
    const geometry = buildCreatureGeometry(species, settings.fish.detail);
    const trianglesPerFish = geometry.getAttribute("position").count / 3;
    geometry.dispose();
    const count = Math.max(1, Math.round(species.count * settings.fish.countScale));
    total += trianglesPerFish * count;
  }

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
