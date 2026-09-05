/**
 * Observation log: which species the user has ever selected (SPEC §4.4
 * proposal). A growing history, unlike `AquariumSettings` (a replaceable
 * snapshot) — kept in its own module and storage key rather than folded
 * into `settings.ts`.
 */
import type { FishSpecies } from "./config";

export const OBSERVATIONS_STORAGE_KEY = "aquarium:observed-species";

export type ObservedSpecies = Readonly<Record<string, boolean>>;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** Keep only ids present in the current registry; a missing/invalid id defaults to not-yet-observed. */
export function sanitizeObservedSpecies(
  raw: unknown,
  registry: readonly FishSpecies[],
): ObservedSpecies {
  const source = asRecord(raw);
  const result: Record<string, boolean> = {};
  for (const species of registry) {
    result[species.id] = source[species.id] === true;
  }
  return result;
}

/** Read the persisted log, defaulting to "nothing observed yet" on any problem. */
export function loadObservedSpecies(
  storage: Pick<Storage, "getItem"> | undefined,
  registry: readonly FishSpecies[],
): ObservedSpecies {
  if (storage === undefined) return sanitizeObservedSpecies(undefined, registry);
  try {
    const raw = storage.getItem(OBSERVATIONS_STORAGE_KEY);
    if (raw === null) return sanitizeObservedSpecies(undefined, registry);
    return sanitizeObservedSpecies(JSON.parse(raw), registry);
  } catch {
    return sanitizeObservedSpecies(undefined, registry);
  }
}

/** Persist the log. Silently no-ops if storage is unavailable (quota/private mode). */
export function saveObservedSpecies(
  observed: ObservedSpecies,
  storage: Pick<Storage, "setItem"> | undefined,
): void {
  if (storage === undefined) return;
  try {
    storage.setItem(OBSERVATIONS_STORAGE_KEY, JSON.stringify(observed));
  } catch {
    // Storage unavailable — the log simply won't survive a reload.
  }
}

/** Pure reducer: marks one species observed. Returns the same reference if already true. */
export function withObserved(observed: ObservedSpecies, speciesId: string): ObservedSpecies {
  if (observed[speciesId] === true) return observed;
  return { ...observed, [speciesId]: true };
}

/** How many registry species have been observed at least once — for the catalog header. */
export function countObserved(observed: ObservedSpecies, registry: readonly FishSpecies[]): number {
  return registry.reduce((sum, species) => sum + (observed[species.id] === true ? 1 : 0), 0);
}
