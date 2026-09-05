import { describe, expect, it } from "vitest";

import { FISH_REGISTRY } from "./config";
import {
  countObserved,
  loadObservedSpecies,
  OBSERVATIONS_STORAGE_KEY,
  saveObservedSpecies,
  sanitizeObservedSpecies,
  withObserved,
} from "./observations";

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

describe("sanitizeObservedSpecies", () => {
  it("defaults every species to not-yet-observed when given nothing", () => {
    const result = sanitizeObservedSpecies(undefined, FISH_REGISTRY);
    for (const species of FISH_REGISTRY) expect(result[species.id]).toBe(false);
  });

  it("keeps only ids present in the registry and preserves true values", () => {
    const firstId = FISH_REGISTRY[0]!.id;
    const raw = { [firstId]: true, "made-up-species": true };
    const result = sanitizeObservedSpecies(raw, FISH_REGISTRY);
    expect(result[firstId]).toBe(true);
    expect(result).not.toHaveProperty("made-up-species");
  });

  it("survives garbage input", () => {
    expect(() => sanitizeObservedSpecies("not an object", FISH_REGISTRY)).not.toThrow();
    expect(() => sanitizeObservedSpecies(null, FISH_REGISTRY)).not.toThrow();
    expect(() => sanitizeObservedSpecies(42, FISH_REGISTRY)).not.toThrow();
  });
});

describe("loadObservedSpecies / saveObservedSpecies", () => {
  it("round-trips through save/load", () => {
    const storage = createMemoryStorage();
    const firstId = FISH_REGISTRY[0]!.id;
    const observed = withObserved(sanitizeObservedSpecies(undefined, FISH_REGISTRY), firstId);
    saveObservedSpecies(observed, storage);
    const loaded = loadObservedSpecies(storage, FISH_REGISTRY);
    expect(loaded[firstId]).toBe(true);
  });

  it("uses the dedicated storage key, separate from aquarium:settings", () => {
    expect(OBSERVATIONS_STORAGE_KEY).toBe("aquarium:observed-species");
  });

  it("defaults to nothing observed when storage is undefined", () => {
    const loaded = loadObservedSpecies(undefined, FISH_REGISTRY);
    for (const species of FISH_REGISTRY) expect(loaded[species.id]).toBe(false);
  });

  it("defaults to nothing observed when storage.getItem throws", () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    const loaded = loadObservedSpecies(storage, FISH_REGISTRY);
    for (const species of FISH_REGISTRY) expect(loaded[species.id]).toBe(false);
  });

  it("silently no-ops when storage.setItem throws", () => {
    const storage = {
      setItem: () => {
        throw new Error("quota");
      },
    } as unknown as Storage;
    expect(() =>
      saveObservedSpecies(sanitizeObservedSpecies(undefined, FISH_REGISTRY), storage),
    ).not.toThrow();
  });
});

describe("withObserved", () => {
  it("marks one species observed without touching others", () => {
    const before = sanitizeObservedSpecies(undefined, FISH_REGISTRY);
    const after = withObserved(before, FISH_REGISTRY[1]!.id);
    expect(after[FISH_REGISTRY[1]!.id]).toBe(true);
    expect(after[FISH_REGISTRY[0]!.id]).toBe(false);
  });

  it("is idempotent", () => {
    const once = withObserved(sanitizeObservedSpecies(undefined, FISH_REGISTRY), FISH_REGISTRY[0]!.id);
    const twice = withObserved(once, FISH_REGISTRY[0]!.id);
    expect(twice).toEqual(once);
  });
});

describe("countObserved", () => {
  it("counts how many registry species are marked observed", () => {
    let observed = sanitizeObservedSpecies(undefined, FISH_REGISTRY);
    expect(countObserved(observed, FISH_REGISTRY)).toBe(0);
    observed = withObserved(observed, FISH_REGISTRY[0]!.id);
    observed = withObserved(observed, FISH_REGISTRY[1]!.id);
    expect(countObserved(observed, FISH_REGISTRY)).toBe(2);
  });
});
