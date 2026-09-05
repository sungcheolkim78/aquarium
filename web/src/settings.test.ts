/**
 * Settings persistence, clamping, debounce and triangle-budget tests
 * (SPEC §6.5.2, N5, AC-5, AC-6, AC-7). Pure logic only.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS, FISH_REGISTRY, SETTINGS_LIMITS, type AquariumSettings } from "./config";
import {
  MAX_SETTINGS,
  debounce,
  estimateTriangleBudget,
  loadSettings,
  saveSettings,
  sanitizeSettings,
  withBackgroundObjectCountScale,
  withBubblesDensityScale,
  withCaustics,
  withFishCountScale,
  withFishDetail,
  withSpeciesEnabled,
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
