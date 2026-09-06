/**
 * Settings persistence, clamping, debounce and triangle-budget tests
 * (SPEC §6.5.2, N5, AC-5, AC-6, AC-7). Pure logic only.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

/** Minimal in-memory stand-in for `Storage` (no DOM/localStorage in the test env). */
function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

describe("loadSettings", () => {
  it("returns DEFAULT_SETTINGS when nothing is stored", () => {
    expect(loadSettings(createMemoryStorage())).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips a valid settings object through save/load (AC-6)", () => {
    const storage = createMemoryStorage();
    const custom: AquariumSettings = {
      ...DEFAULT_SETTINGS,
      fish: { ...DEFAULT_SETTINGS.fish, detail: "high", countScale: 1.25 },
      bubbles: { enabled: false, densityScale: 0.3 },
    };
    saveSettings(custom, storage);
    expect(loadSettings(storage)).toEqual(custom);
  });

  it("falls back to DEFAULT_SETTINGS for unparsable JSON (AC-6)", () => {
    const storage = createMemoryStorage();
    storage.setItem("aquarium:settings", "{not json");
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it("falls back to DEFAULT_SETTINGS for a different schema version (AC-6)", () => {
    const storage = createMemoryStorage();
    storage.setItem("aquarium:settings", JSON.stringify({ schemaVersion: 2 }));
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("sanitizeSettings", () => {
  it("clamps out-of-range numeric fields to SETTINGS_LIMITS", () => {
    const sanitized = sanitizeSettings({
      schemaVersion: 1,
      fish: { enabledSpecies: {}, detail: "medium", countScale: 999 },
      background: { detail: "medium", objectCountScale: -5 },
      lighting: { intensityScale: 999, caustics: true },
      bubbles: { enabled: true, densityScale: -1 },
    });
    expect(sanitized?.fish.countScale).toBe(SETTINGS_LIMITS.fish.countScale.max);
    expect(sanitized?.background.objectCountScale).toBe(SETTINGS_LIMITS.background.objectCountScale.min);
    expect(sanitized?.lighting.intensityScale).toBe(SETTINGS_LIMITS.lighting.intensityScale.max);
    expect(sanitized?.bubbles.densityScale).toBe(SETTINGS_LIMITS.bubbles.densityScale.min);
  });

  it("drops species ids that are no longer in the registry, keeps the rest, and defaults new ones to true", () => {
    const firstId = (FISH_REGISTRY[0] as (typeof FISH_REGISTRY)[number]).id;
    const sanitized = sanitizeSettings({
      schemaVersion: 1,
      fish: { enabledSpecies: { [firstId]: false, "no-longer-exists": true }, detail: "medium", countScale: 1 },
      background: { detail: "medium", objectCountScale: 1 },
      lighting: { intensityScale: 1, caustics: true },
      bubbles: { enabled: true, densityScale: 1 },
    });
    expect(sanitized?.fish.enabledSpecies[firstId]).toBe(false);
    expect(sanitized?.fish.enabledSpecies).not.toHaveProperty("no-longer-exists");
    expect(Object.keys(sanitized?.fish.enabledSpecies ?? {})).toHaveLength(FISH_REGISTRY.length);
  });

  it("returns null for a non-object or missing schemaVersion", () => {
    expect(sanitizeSettings(null)).toBeNull();
    expect(sanitizeSettings("nope")).toBeNull();
    expect(sanitizeSettings({})).toBeNull();
  });
});

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

describe("debounce (AC-5)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("calls the wrapped function once after rapid repeated calls", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 150);
    debounced(1);
    debounced(2);
    debounced(3);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);
  });

  it("cancel() suppresses a pending call", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 150);
    debounced();
    debounced.cancel();
    vi.advanceTimersByTime(150);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("settings reducers (SPEC §9)", () => {
  it("withSpeciesEnabled toggles only the target species, leaving the rest untouched", () => {
    const firstId = (FISH_REGISTRY[0] as (typeof FISH_REGISTRY)[number]).id;
    const next = withSpeciesEnabled(DEFAULT_SETTINGS, firstId, false);
    expect(next.fish.enabledSpecies[firstId]).toBe(false);
    expect(next).not.toBe(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.fish.enabledSpecies[firstId]).toBe(true);
  });

  it("withFishDetail replaces only fish.detail", () => {
    const next = withFishDetail(DEFAULT_SETTINGS, "high");
    expect(next.fish.detail).toBe("high");
    expect(next.background).toEqual(DEFAULT_SETTINGS.background);
  });

  it("clamps countScale/objectCountScale/densityScale via SETTINGS_LIMITS", () => {
    expect(withFishCountScale(DEFAULT_SETTINGS, 999).fish.countScale).toBe(
      SETTINGS_LIMITS.fish.countScale.max,
    );
    expect(withFishCountScale(DEFAULT_SETTINGS, -1).fish.countScale).toBe(
      SETTINGS_LIMITS.fish.countScale.min,
    );
    expect(withBackgroundObjectCountScale(DEFAULT_SETTINGS, 999).background.objectCountScale).toBe(
      SETTINGS_LIMITS.background.objectCountScale.max,
    );
    expect(withBubblesDensityScale(DEFAULT_SETTINGS, -1).bubbles.densityScale).toBe(
      SETTINGS_LIMITS.bubbles.densityScale.min,
    );
  });

  it("withCaustics flips only lighting.caustics", () => {
    const next = withCaustics(DEFAULT_SETTINGS, false);
    expect(next.lighting.caustics).toBe(false);
    expect(next.lighting.intensityScale).toBe(DEFAULT_SETTINGS.lighting.intensityScale);
  });
});

describe("estimateTriangleBudget (AC-7)", () => {
  it("stays under the 300,000-triangle budget at the maximum settings combination", () => {
    expect(estimateTriangleBudget(MAX_SETTINGS)).toBeLessThan(300_000);
  });

  it("grows when detail/count/object-count scale up", () => {
    const low = estimateTriangleBudget(DEFAULT_SETTINGS);
    const high = estimateTriangleBudget(MAX_SETTINGS);
    expect(high).toBeGreaterThan(low);
  });
});

describe("getLocalStorage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns window.localStorage when accessible", () => {
    const fakeStorage = { getItem: () => null } as unknown as Storage;
    vi.stubGlobal("window", { localStorage: fakeStorage });
    expect(getLocalStorage()).toBe(fakeStorage);
  });

  it("returns undefined when there is no window global (non-browser environment)", () => {
    vi.stubGlobal("window", undefined);
    expect(getLocalStorage()).toBeUndefined();
  });

  it("returns undefined when the localStorage getter itself throws", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new DOMException("denied", "SecurityError");
      },
    });
    expect(getLocalStorage()).toBeUndefined();
  });
});

describe("loadSettings/saveSettings with unavailable storage", () => {
  it("loadSettings returns DEFAULT_SETTINGS when storage is undefined", () => {
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("saveSettings no-ops without throwing when storage is undefined", () => {
    expect(() => saveSettings(DEFAULT_SETTINGS, undefined)).not.toThrow();
  });
});

describe("camera/performance/audio reducers (SPEC §6.5.2 v1.2)", () => {
  it("withCameraMode replaces only camera.mode", () => {
    const next = withCameraMode(DEFAULT_SETTINGS, "fixed");
    expect(next.camera.mode).toBe("fixed");
    expect(next.lighting).toEqual(DEFAULT_SETTINGS.lighting);
  });

  it("withPowerSave replaces only performance.powerSave", () => {
    const next = withPowerSave(DEFAULT_SETTINGS, true);
    expect(next.performance.powerSave).toBe(true);
    expect(next.fish).toEqual(DEFAULT_SETTINGS.fish);
  });

  it("withVolume clamps to SETTINGS_LIMITS.audio.volume", () => {
    expect(withVolume(DEFAULT_SETTINGS, 999).audio.volume).toBe(SETTINGS_LIMITS.audio.volume.max);
    expect(withVolume(DEFAULT_SETTINGS, -1).audio.volume).toBe(SETTINGS_LIMITS.audio.volume.min);
  });
});

describe("sanitizeSettings for camera/performance/audio (SPEC §6.5.2 v1.2)", () => {
  it("falls back to defaults for missing/invalid camera.mode, performance.powerSave, audio.volume", () => {
    const sanitized = sanitizeSettings({
      schemaVersion: 1,
      fish: { enabledSpecies: {}, detail: "medium", countScale: 1 },
      background: { detail: "medium", objectCountScale: 1 },
      lighting: { intensityScale: 1, caustics: true },
      bubbles: { enabled: true, densityScale: 1 },
      camera: { mode: "not-a-mode" },
      performance: { powerSave: "yes" },
      audio: { volume: -5 },
    });
    expect(sanitized?.camera.mode).toBe(DEFAULT_SETTINGS.camera.mode);
    expect(sanitized?.performance.powerSave).toBe(DEFAULT_SETTINGS.performance.powerSave);
    expect(sanitized?.audio.volume).toBe(SETTINGS_LIMITS.audio.volume.min);
  });

  it("round-trips valid camera/performance/audio values", () => {
    const sanitized = sanitizeSettings({
      schemaVersion: 1,
      fish: { enabledSpecies: {}, detail: "medium", countScale: 1 },
      background: { detail: "medium", objectCountScale: 1 },
      lighting: { intensityScale: 1, caustics: true },
      bubbles: { enabled: true, densityScale: 1 },
      camera: { mode: "fixed" },
      performance: { powerSave: true },
      audio: { volume: 0.5 },
    });
    expect(sanitized?.camera.mode).toBe("fixed");
    expect(sanitized?.performance.powerSave).toBe(true);
    expect(sanitized?.audio.volume).toBe(0.5);
  });
});

describe("withPreset / matchingPresetId (SPEC §6.6)", () => {
  it("withPreset sets lighting/fish-count/bubbles from the preset and leaves detail/species untouched", () => {
    const next = withPreset(DEFAULT_SETTINGS, "soft-evening");
    const preset = MOOD_PRESETS["soft-evening"];
    expect(next.lighting.intensityScale).toBe(preset.lightingIntensityScale);
    expect(next.fish.countScale).toBe(preset.fishCountScale);
    expect(next.bubbles.enabled).toBe(preset.bubblesEnabled);
    expect(next.bubbles.densityScale).toBe(preset.bubblesDensityScale);
    expect(next.fish.detail).toBe(DEFAULT_SETTINGS.fish.detail);
    expect(next.background).toEqual(DEFAULT_SETTINGS.background);
    expect(next.fish.enabledSpecies).toEqual(DEFAULT_SETTINGS.fish.enabledSpecies);
  });

  it("every preset's numeric values stay inside SETTINGS_LIMITS", () => {
    for (const id of Object.keys(MOOD_PRESETS) as PresetId[]) {
      const preset = MOOD_PRESETS[id];
      expect(preset.lightingIntensityScale).toBeGreaterThanOrEqual(SETTINGS_LIMITS.lighting.intensityScale.min);
      expect(preset.lightingIntensityScale).toBeLessThanOrEqual(SETTINGS_LIMITS.lighting.intensityScale.max);
      expect(preset.fishCountScale).toBeGreaterThanOrEqual(SETTINGS_LIMITS.fish.countScale.min);
      expect(preset.fishCountScale).toBeLessThanOrEqual(SETTINGS_LIMITS.fish.countScale.max);
      expect(preset.bubblesDensityScale).toBeGreaterThanOrEqual(SETTINGS_LIMITS.bubbles.densityScale.min);
      expect(preset.bubblesDensityScale).toBeLessThanOrEqual(SETTINGS_LIMITS.bubbles.densityScale.max);
    }
  });

  it("matchingPresetId finds calm-sea for DEFAULT_SETTINGS (unmodified first visit)", () => {
    expect(matchingPresetId(DEFAULT_SETTINGS)).toBe("calm-sea");
  });

  it("matchingPresetId returns the applied preset right after withPreset", () => {
    expect(matchingPresetId(withPreset(DEFAULT_SETTINGS, "clear-reef"))).toBe("clear-reef");
  });

  it("matchingPresetId returns null after a manual tweak breaks the match", () => {
    const custom = withLightingIntensityScale(withPreset(DEFAULT_SETTINGS, "clear-reef"), 0.5);
    expect(matchingPresetId(custom)).toBeNull();
  });

  it("rapid successive preset picks converge to the last one applied (AC-10-style)", () => {
    const sequence: PresetId[] = ["clear-reef", "soft-evening", "calm-sea"];
    const final = sequence.reduce((acc: AquariumSettings, id) => withPreset(acc, id), DEFAULT_SETTINGS);
    expect(matchingPresetId(final)).toBe("calm-sea");
  });
});
