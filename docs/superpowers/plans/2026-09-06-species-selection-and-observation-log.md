# Species Selection and Observation Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking/tapping a fish (or picking one from a catalog) opens a small card with its name and description, and marks that species as observed in a log persisted across visits — without locking or changing the existing show/hide-any-species freedom.

**Architecture:** A new `observations.ts` module (mirroring `settings.ts`'s exact load/save/sanitize shape, but a separate storage key since it's a growing history, not a replaceable snapshot) backs a new `speciesInfo.ts` DOM module (card + catalog, mirroring `settingsPanel.ts`'s pure-glue style — no storage access of its own). `main.ts` adds one `Raycaster` + one canvas `click` listener: a hit opens/updates the card via `speciesInfo.showSpecies`, a miss closes it — satisfying "click the background to close" with no separate backdrop element, since `#overlay` is already `pointer-events: none` at its root. Hidden species and population-scale-reduced instances are excluded from picking automatically by three.js's own `InstancedMesh.raycast()`/`Raycaster.intersectObjects` semantics — no new exclusion logic is needed, only a test that pins this down.

**Tech Stack:** TypeScript, Three.js `Raycaster`/`InstancedMesh`, Vitest, Vite, `localStorage`.

**Spec:** `docs/superpowers/specs/2026-09-06-species-selection-and-observation-log-design.md`, implementing `docs/DEVELOPMENT_PROPOSAL.md` §4.4.

## Global Constraints

- Never touch camera state (position/target/mode) anywhere in this feature.
- The catalog always lists all nine registry species, regardless of the user's show/hide settings — it must never become the only way to see a hidden species, nor should hiding a species remove it from the catalog.
- Species descriptions are design-flavor (silhouette/color/behavior of the procedural model) — never phrase them as validated biological/taxonomic fact.
- `speciesInfo.ts` and `ui.ts` own no `localStorage` access — `main.ts` is the only place that calls `loadObservedSpecies`/`saveObservedSpecies`, exactly mirroring how it's the only place that calls `loadSettings`/`saveSettings`.
- `ui.ts`/`settingsPanel.ts`/`speciesInfo.ts` are pure DOM glue with no automated tests, per this repo's existing convention (see their own header comments) — verified visually via `npm run preview` instead.
- Run `npm --prefix web run test` after every step that touches a test file; run `npm --prefix web run build` at the end of the plan.

---

### Task 1: Add `description` to the registry

**Files:**
- Modify: `web/src/config.ts`
- Modify: `web/src/config.test.ts`

**Interfaces:**
- Produces: `CreatureDefinition.description: string` (required, alongside the existing `label`).

- [ ] **Step 1: Write the failing test**

Add to `web/src/config.test.ts`, inside the existing `describe("creature registry", ...)` block (after the turtle test, before its closing `});`):

```ts
  it("gives every species a non-empty description for the species-info card (§4.4)", () => {
    for (const species of FISH_REGISTRY) {
      expect(species.description.trim().length).toBeGreaterThan(0);
    }
  });
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm --prefix web run test -- src/config.test.ts`

Expected: `TS2339`/`Property 'description' does not exist` — `description` isn't defined on `CreatureDefinition` yet.

- [ ] **Step 3: Add the field**

In `web/src/config.ts`, in `CreatureDefinition` (right after `readonly label: string;`):

```ts
  /** One or two sentences describing the model's look/behavior for the species-info card (§4.4) — design-flavor only, never a validated biological claim. */
  readonly description: string;
```

- [ ] **Step 4: Fill in all nine registry entries**

Add one `description` line right after each entry's `label` line in `web/src/config.ts`:

```ts
    id: "clownfish",
    label: "클라운피시",
    description: "주황빛 몸에 하얀 줄무늬가 있는 작은 물고기예요. 무리를 지어 산호 밭 주변을 얌전히 맴돌아요.",
```

```ts
    id: "blue-sea-bream",
    label: "파랑참돔",
    description: "푸른빛이 도는 매끈한 몸을 가진 물고기예요. 무리를 지어 넓은 수역을 여유롭게 오가요.",
```

```ts
    id: "yellow-tang",
    label: "노란열대어",
    description: "샛노란 몸빛이 눈에 띄는 납작한 물고기예요. 한 산호 근처를 정해두고 그 주변을 잘 벗어나지 않아요.",
```

```ts
    id: "butterflyfish",
    label: "나비치",
    description: "원반 모양 몸에 눈 주위로 짙은 띠무늬가 있는 물고기예요. 혼자 산호 곁을 서성이며 지내요.",
```

```ts
    id: "purple-tang",
    label: "보라탱",
    description: "보라색 몸에 샛노란 지느러미가 대비되는 물고기예요. 자기 구역의 산호를 좀처럼 벗어나지 않아요.",
```

```ts
    id: "pink-cardinalfish",
    label: "자주열대어",
    description: "자줏빛이 도는 아주 작은 물고기예요. 촘촘한 무리를 이루어 빠르게 움직여요.",
```

```ts
    id: "great-white-shark",
    label: "백상아리",
    description: "몸집이 큰 회청색 헤엄손님이에요. 방향을 크고 느리게 틀며 넓은 구역을 순찰하듯 돌아요.",
```

```ts
    id: "seahorse",
    label: "해마",
    description: "몸을 세운 채 헤엄치는 분홍빛 생물이에요. 꼬리를 산호에 말아 붙잡고 한자리에 머물러요.",
```

```ts
    id: "green-sea-turtle",
    label: "푸른바다거북",
    description: "둥근 등딱지를 지닌 큰 생물이에요. 네 다리로 천천히 헤엄치며 수면 가까이를 오가요.",
```

- [ ] **Step 5: Run the focused test and verify it passes**

Run: `npm --prefix web run test -- src/config.test.ts`

Expected: passes.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm --prefix web run test && npx --prefix web tsc --noEmit`

Expected: no failures (every other reader of `CreatureDefinition` only reads existing fields; adding a required field to object literals that already exist is safe as long as every literal is updated, which Step 4 did for all nine).

- [ ] **Step 7: Commit**

```bash
git add web/src/config.ts web/src/config.test.ts
git commit -m "feat: add design-flavor descriptions to the creature registry"
```

### Task 2: Add the observation-log module

**Files:**
- Create: `web/src/observations.ts`
- Create: `web/src/observations.test.ts`

**Interfaces:**
- Produces: `OBSERVATIONS_STORAGE_KEY`, `ObservedSpecies`, `sanitizeObservedSpecies`, `loadObservedSpecies`, `saveObservedSpecies`, `withObserved`, `countObserved`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/observations.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm --prefix web run test -- src/observations.test.ts`

Expected: fails to even resolve the `./observations` import — the module doesn't exist yet.

- [ ] **Step 3: Implement `observations.ts`**

Create `web/src/observations.ts`:

```ts
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
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm --prefix web run test -- src/observations.test.ts`

Expected: all pass.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm --prefix web run test && npx --prefix web tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add web/src/observations.ts web/src/observations.test.ts
git commit -m "feat: add the observation-log persistence module"
```

### Task 3: Pin down automatic hidden/inactive-instance exclusion

**Files:**
- Modify: `web/src/fish.test.ts`

**Interfaces:**
- Consumes: `FishSchool`, `createRng` (existing), `Raycaster` (three.js — new import in this test file only).

This task adds **no new production code** — it's a characterization test proving a claim the design relies on: three.js's own `InstancedMesh.raycast()` only tests instances `0..mesh.count`, and `Raycaster.intersectObjects`/`intersectObject` skip `visible === false` objects. Both tests are expected to **pass immediately** once written; there is nothing to implement. If either fails when first run, that's a real finding — stop and re-read `docs/superpowers/specs/2026-09-06-species-selection-and-observation-log-design.md` §1 before changing anything, since the whole "no new exclusion logic needed" design decision rests on this.

- [ ] **Step 1: Write the test**

Add to `web/src/fish.test.ts`, as a new top-level `describe` block (anywhere after the existing imports; e.g. right after the `describe("FishSchool", ...)` block's closing `});`):

```ts
describe("InstancedMesh picking excludes hidden/inactive instances (§4.4 AC)", () => {
  function raycastAt(target: Vector3): Raycaster {
    const raycaster = new Raycaster();
    raycaster.ray.origin.copy(target).addScaledVector(new Vector3(0, 0, 1), -5);
    raycaster.ray.direction.set(0, 0, 1);
    raycaster.near = 0;
    raycaster.far = 20;
    return raycaster;
  }

  it("stops hitting a species' instances once it's hidden", () => {
    const species = FISH_REGISTRY[0] as FishSpecies;
    const school = new FishSchool(species, createRng(1));
    const boids = (school as unknown as { boids: Boid[] }).boids;
    const raycaster = raycastAt((boids[0] as Boid).position);

    expect(raycaster.intersectObject(school.mesh, false).length).toBeGreaterThan(0);
    school.setVisible(false);
    expect(raycaster.intersectObject(school.mesh, false).length).toBe(0);
    school.dispose();
  });

  it("stops hitting an instance once it falls outside the population-scaled active count", () => {
    const species = FISH_REGISTRY[0] as FishSpecies;
    const school = new FishSchool(species, createRng(1));
    const boids = (school as unknown as { boids: Boid[] }).boids;
    const lastIndex = species.count - 1;
    const raycaster = raycastAt((boids[lastIndex] as Boid).position);

    expect(raycaster.intersectObject(school.mesh, false).length).toBeGreaterThan(0);
    school.setPopulationScale(0.01); // shrinks mesh.count to 1, excluding lastIndex
    expect(raycaster.intersectObject(school.mesh, false).length).toBe(0);
    school.dispose();
  });
});
```

Add `Raycaster` to the existing `import { Vector3 } from "three";` line in `fish.test.ts` (becomes `import { Raycaster, Vector3 } from "three";`).

- [ ] **Step 2: Run the test and verify it passes**

Run: `npm --prefix web run test -- src/fish.test.ts`

Expected: both pass on the first run. If a test fails, do not "fix" it by changing the assertion — investigate why three.js's raycast semantics don't match the design's assumption (e.g. adjust the ray geometry in `raycastAt`, since a miss could mean the ray isn't actually crossing the body's surface, not that exclusion is broken) before touching anything else in this plan.

- [ ] **Step 3: Run the full suite**

Run: `npm --prefix web run test`

- [ ] **Step 4: Commit**

```bash
git add web/src/fish.test.ts
git commit -m "test: pin down automatic hidden/inactive-instance raycast exclusion"
```

### Task 4: Build the species-info card and catalog DOM

**Files:**
- Create: `web/src/speciesInfo.ts`

**Interfaces:**
- Consumes: `FishSpecies` (config.ts), `ObservedSpecies`/`withObserved`/`countObserved` (observations.ts).
- Produces: `createSpeciesInfo(registry, initialObserved, callbacks): { cardElement, catalogElement, showSpecies(id), closeCard(), dispose() }`.

No automated test for this task (pure DOM glue, matching `settingsPanel.ts`'s own documented convention) — verify with `npx --prefix web tsc --noEmit` and a full visual pass in Task 8.

- [ ] **Step 1: Implement `speciesInfo.ts`**

Create `web/src/speciesInfo.ts`:

```ts
/**
 * Species info card + catalog ("도감") DOM (SPEC §4.4 proposal). Pure UI
 * glue, like `settingsPanel.ts` — no storage access; `main.ts` persists
 * observations via `onObserve`. Left out of the automated test suite and
 * verified visually instead, matching `ui.ts`/`settingsPanel.ts`.
 */
import type { FishSpecies } from "./config";
import { countObserved, withObserved, type ObservedSpecies } from "./observations";

export interface SpeciesInfoCallbacks {
  onObserve(speciesId: string): void;
}

export interface SpeciesInfo {
  readonly cardElement: HTMLElement;
  readonly catalogElement: HTMLElement;
  /** Opens the card for this species (replacing its content if already open) and marks it observed. */
  showSpecies(speciesId: string): void;
  /** Closes the card if open; no-op otherwise. */
  closeCard(): void;
  dispose(): void;
}

/** Build the species-info card and catalog list. `registry` drives the catalog (always all species, regardless of visibility settings). */
export function createSpeciesInfo(
  registry: readonly FishSpecies[],
  initialObserved: ObservedSpecies,
  callbacks: SpeciesInfoCallbacks,
): SpeciesInfo {
  let observed = initialObserved;
  const byId = new Map(registry.map((species) => [species.id, species]));
  const cleanups: (() => void)[] = [];

  // Card --------------------------------------------------------------------
  const card = document.createElement("div");
  card.className = "species-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "물고기 정보");

  const cardHeader = document.createElement("div");
  cardHeader.className = "species-card__header";
  const cardName = document.createElement("h2");
  cardName.className = "species-card__name";
  const cardBadge = document.createElement("span");
  cardBadge.className = "species-card__badge";
  cardBadge.textContent = "관찰함";
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "species-card__close";
  closeButton.setAttribute("aria-label", "닫기");
  closeButton.textContent = "×";
  const onCloseClick = (): void => closeCardImpl();
  closeButton.addEventListener("click", onCloseClick);
  cleanups.push(() => closeButton.removeEventListener("click", onCloseClick));
  cardHeader.append(cardName, cardBadge, closeButton);

  const cardDescription = document.createElement("p");
  cardDescription.className = "species-card__description";
  card.append(cardHeader, cardDescription);

  // Catalog -------------------------------------------------------------------
  const catalog = document.createElement("div");
  catalog.className = "species-catalog";
  catalog.setAttribute("role", "dialog");
  catalog.setAttribute("aria-label", "도감");

  const catalogHeading = document.createElement("h3");
  catalogHeading.className = "species-catalog__heading";
  const catalogList = document.createElement("ul");
  catalogList.className = "species-catalog__list";
  catalog.append(catalogHeading, catalogList);

  const marks = new Map<string, HTMLSpanElement>();
  for (const species of registry) {
    const row = document.createElement("li");
    row.className = "species-catalog__row";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "species-catalog__item";
    const label = document.createElement("span");
    label.textContent = species.label;
    const mark = document.createElement("span");
    mark.className = "species-catalog__mark";
    button.append(label, mark);
    const onClick = (): void => showSpeciesImpl(species.id);
    button.addEventListener("click", onClick);
    cleanups.push(() => button.removeEventListener("click", onClick));
    row.append(button);
    catalogList.append(row);
    marks.set(species.id, mark);
  }

  const refreshCatalog = (): void => {
    catalogHeading.textContent = `도감 (${countObserved(observed, registry)}/${registry.length})`;
    for (const [id, mark] of marks) mark.textContent = observed[id] === true ? "관찰함" : "미관찰";
  };
  refreshCatalog();

  function closeCardImpl(): void {
    card.classList.remove("is-open");
  }

  function showSpeciesImpl(speciesId: string): void {
    const species = byId.get(speciesId);
    if (!species) return;
    cardName.textContent = species.label;
    cardDescription.textContent = species.description;
    observed = withObserved(observed, speciesId);
    callbacks.onObserve(speciesId);
    refreshCatalog();
    card.classList.add("is-open");
  }

  return {
    cardElement: card,
    catalogElement: catalog,
    showSpecies: showSpeciesImpl,
    closeCard: closeCardImpl,
    dispose(): void {
      for (const cleanup of cleanups) cleanup();
      card.remove();
      catalog.remove();
    },
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx --prefix web tsc --noEmit`

Expected: no errors. (`main.ts` doesn't import this module yet, so nothing else changes.)

- [ ] **Step 3: Commit**

```bash
git add web/src/speciesInfo.ts
git commit -m "feat: build the species info card and catalog DOM"
```

### Task 5: Wire a catalog toggle button into `ui.ts`

**Files:**
- Modify: `web/src/ui.ts`

**Interfaces:**
- Produces: `CreateUiOptions.speciesCard?: HTMLElement`, `CreateUiOptions.speciesCatalog?: HTMLElement`.

No automated test (same convention as Task 4). Verify with typecheck; full visual pass in Task 8.

- [ ] **Step 1: Add a catalog icon next to the existing icon constants**

In `web/src/ui.ts`, right after the `GEAR_ICON` constant:

```ts
const CATALOG_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path d="M4 5.5c2.2-1 4.8-1 7 0v13c-2.2-1-4.8-1-7 0z" />
  <path d="M20 5.5c-2.2-1-4.8-1-7 0v13c2.2-1 4.8-1 7 0z" />
</svg>`;
```

- [ ] **Step 2: Extend `CreateUiOptions`**

Change:

```ts
export interface CreateUiOptions {
  /** The settings panel's root element (SPEC F6, §6.5.1); the gear button toggles its visibility. */
  readonly settingsPanel?: HTMLElement;
  /** Initial ambient-sound target volume, 0~1 (SPEC §6.7.3). Defaults to `AmbientAudio`'s own 0.16 if omitted. */
  readonly initialVolume?: number;
}
```

to:

```ts
export interface CreateUiOptions {
  /** The settings panel's root element (SPEC F6, §6.5.1); the gear button toggles its visibility. */
  readonly settingsPanel?: HTMLElement;
  /** Initial ambient-sound target volume, 0~1 (SPEC §6.7.3). Defaults to `AmbientAudio`'s own 0.16 if omitted. */
  readonly initialVolume?: number;
  /** The species-info card's root element (§4.4 proposal); just mounted, no toggle button — it opens via fish picking or the catalog. */
  readonly speciesCard?: HTMLElement;
  /** The species catalog ("도감") root element (§4.4 proposal); a new button toggles its visibility. */
  readonly speciesCatalog?: HTMLElement;
}
```

- [ ] **Step 3: Add the catalog button, mirroring the settings-button block**

Right before the existing `if (settingsPanel !== null) { ... }` block, add:

```ts
  const speciesCatalog = options.speciesCatalog ?? null;
  let catalogButton: HTMLButtonElement | null = null;
  let onCatalogToggle: (() => void) | null = null;

  if (speciesCatalog !== null) {
    catalogButton = document.createElement("button");
    catalogButton.type = "button";
    catalogButton.className = "catalog-toggle";
    catalogButton.innerHTML = CATALOG_ICON;
    catalogButton.setAttribute("aria-label", "도감 열기");
    catalogButton.setAttribute("aria-expanded", "false");
    catalogButton.title = "도감";

    onCatalogToggle = (): void => {
      const open = speciesCatalog.classList.toggle("is-open");
      catalogButton?.setAttribute("aria-expanded", open ? "true" : "false");
      catalogButton?.setAttribute("aria-label", open ? "도감 닫기" : "도감 열기");
      onActivity();
    };
    catalogButton.addEventListener("click", onCatalogToggle);
    controls.append(catalogButton);
    root.append(speciesCatalog);
  }
```

- [ ] **Step 4: Mount the card and finish appending**

Change:

```ts
  root.append(loader, title, controls);
```

to:

```ts
  if (options.speciesCard) root.append(options.speciesCard);
  root.append(loader, title, controls);
```

- [ ] **Step 5: Clean up the new listener in `dispose()`**

Change the `dispose()` body's settings-button cleanup block:

```ts
      if (settingsButton !== null && onSettingsToggle !== null) {
        settingsButton.removeEventListener("click", onSettingsToggle);
      }
```

to (add right after it):

```ts
      if (settingsButton !== null && onSettingsToggle !== null) {
        settingsButton.removeEventListener("click", onSettingsToggle);
      }
      if (catalogButton !== null && onCatalogToggle !== null) {
        catalogButton.removeEventListener("click", onCatalogToggle);
      }
```

- [ ] **Step 6: Typecheck**

Run: `npx --prefix web tsc --noEmit`

- [ ] **Step 7: Commit**

```bash
git add web/src/ui.ts
git commit -m "feat: add a catalog toggle button and species-card mount point to the overlay UI"
```

### Task 6: Style the card, catalog, and new button

**Files:**
- Modify: `web/src/style.css`

No automated test — verify visually in Task 8.

- [ ] **Step 1: Add the catalog button to the existing icon-button rules**

Change every occurrence of the shared `.sound-toggle, .settings-toggle` selector group to include `.catalog-toggle`. There are three such groups; change each:

```css
.sound-toggle,
.settings-toggle {
```
→
```css
.sound-toggle,
.settings-toggle,
.catalog-toggle {
```

```css
.overlay.is-ready .sound-toggle,
.overlay.is-ready .settings-toggle {
```
→
```css
.overlay.is-ready .sound-toggle,
.overlay.is-ready .settings-toggle,
.overlay.is-ready .catalog-toggle {
```

```css
.sound-toggle svg,
.settings-toggle svg {
```
→
```css
.sound-toggle svg,
.settings-toggle svg,
.catalog-toggle svg {
```

Also add a hover/focus rule (there's no exact prior analog to extend cleanly, since the existing one mixes `:hover`/`:focus-visible` with the settings-specific `[aria-expanded="true"]` — add a new declaration right after that existing block):

```css
.catalog-toggle:hover,
.catalog-toggle:focus-visible,
.catalog-toggle[aria-expanded="true"] {
  border-color: rgba(191, 234, 255, 0.5);
  background: rgba(10, 53, 80, 0.5);
  color: var(--aq-mist);
  outline: none;
}
```

- [ ] **Step 2: Add the catalog panel styles**

Append after the `.settings-panel__readout` rule (end of the settings-panel block, before "Fallback notice"):

```css
/* Species catalog ("도감", §4.4 proposal) -------------------------------- */

.species-catalog {
  pointer-events: auto;
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: min(20rem, 86vw);
  overflow-y: auto;
  padding: clamp(4.5rem, 12vh, 6rem) 1.5rem 2rem;
  background: rgba(4, 18, 31, 0.78);
  backdrop-filter: blur(14px);
  border-right: 1px solid rgba(191, 234, 255, 0.16);
  transform: translateX(-100%);
  transition: transform 0.4s var(--aq-ease);
  font-size: 0.85rem;
  color: var(--aq-foam);
}

.species-catalog.is-open {
  transform: translateX(0);
}

.species-catalog__heading {
  margin: 0 0 1rem;
  font-size: 0.78rem;
  font-weight: 500;
  letter-spacing: 0.14em;
  color: var(--aq-mist);
}

.species-catalog__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.species-catalog__item {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  font: inherit;
  color: inherit;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 0.5rem;
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  text-align: left;
}

.species-catalog__item:hover,
.species-catalog__item:focus-visible {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.24);
  outline: none;
}

.species-catalog__mark {
  font-size: 0.72rem;
  opacity: 0.75;
}

/* Species info card (§4.4 proposal) --------------------------------------- */

.species-card {
  pointer-events: auto;
  position: fixed;
  left: 50%;
  bottom: clamp(1rem, 4vh, 2rem);
  transform: translate(-50%, 12px);
  width: min(22rem, 90vw);
  padding: 1rem 1.25rem;
  background: rgba(4, 18, 31, 0.82);
  backdrop-filter: blur(14px);
  border: 1px solid rgba(191, 234, 255, 0.18);
  border-radius: 0.9rem;
  color: var(--aq-foam);
  opacity: 0;
  visibility: hidden;
  transition:
    opacity 0.3s var(--aq-ease),
    transform 0.3s var(--aq-ease),
    visibility 0.3s;
}

.species-card.is-open {
  opacity: 1;
  visibility: visible;
  transform: translate(-50%, 0);
}

.species-card__header {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.species-card__name {
  margin: 0;
  font-size: 1rem;
  font-weight: 500;
  color: var(--aq-mist);
  flex: 1;
}

.species-card__badge {
  font-size: 0.7rem;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  background: rgba(191, 234, 255, 0.16);
  color: var(--aq-mist);
  white-space: nowrap;
}

.species-card__close {
  background: none;
  border: none;
  color: inherit;
  font-size: 1.3rem;
  line-height: 1;
  cursor: pointer;
  padding: 0 0.25rem;
}

.species-card__description {
  margin: 0.6rem 0 0;
  font-size: 0.85rem;
  line-height: 1.6;
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/style.css
git commit -m "style: add species card, catalog, and catalog-button styles"
```

### Task 7: Wire picking, the card/catalog, and persistence into `main.ts`

**Files:**
- Modify: `web/src/main.ts`

**Interfaces:**
- Consumes: `createSpeciesInfo` (speciesInfo.ts), `loadObservedSpecies`/`saveObservedSpecies`/`withObserved` (observations.ts).

No automated test (composition-root wiring, matching `main.ts`'s existing convention — it has no test file). Verify with typecheck, build, and the full manual pass in Task 8.

- [ ] **Step 1: Add new imports**

Change:

```ts
import { Clock, Color, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";

import { FISH_REGISTRY, SCENE, computeQualityScales, effectiveMinFps, type AquariumSettings } from "./config";
import { createEnvironment } from "./environment";
import { createRng, createSchools, type FishSchool } from "./fish";
import { createBubbles } from "./particles";
import { debounce, getLocalStorage, loadSettings, saveSettings } from "./settings";
import { createSettingsPanel } from "./settingsPanel";
import { createUi } from "./ui";
```

to:

```ts
import { Clock, Color, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3, WebGLRenderer } from "three";

import { FISH_REGISTRY, SCENE, computeQualityScales, effectiveMinFps, type AquariumSettings } from "./config";
import { createEnvironment } from "./environment";
import { createRng, createSchools, type FishSchool } from "./fish";
import { loadObservedSpecies, saveObservedSpecies, withObserved } from "./observations";
import { createBubbles } from "./particles";
import { debounce, getLocalStorage, loadSettings, saveSettings } from "./settings";
import { createSettingsPanel } from "./settingsPanel";
import { createSpeciesInfo } from "./speciesInfo";
import { createUi } from "./ui";
```

- [ ] **Step 2: Load the observation log and build `speciesInfo`**

Right after the existing `const schoolsById = new Map<string, FishSchool>(...)` line and its following `for (const school of schools) school.addTo(scene);` line, add:

```ts
  let observedSpecies = loadObservedSpecies(getLocalStorage(), FISH_REGISTRY);
  const speciesInfo = createSpeciesInfo(FISH_REGISTRY, observedSpecies, {
    onObserve(speciesId: string): void {
      observedSpecies = withObserved(observedSpecies, speciesId);
      saveObservedSpecies(observedSpecies, getLocalStorage());
    },
  });
```

- [ ] **Step 3: Pass the card/catalog elements into `createUi`**

Change:

```ts
  const ui = createUi(overlay, { settingsPanel: settingsPanel.element, initialVolume: settings.audio.volume });
```

to:

```ts
  const ui = createUi(overlay, {
    settingsPanel: settingsPanel.element,
    initialVolume: settings.audio.volume,
    speciesCard: speciesInfo.cardElement,
    speciesCatalog: speciesInfo.catalogElement,
  });
```

- [ ] **Step 4: Add the click-to-pick and Esc-to-close handlers**

Right after the existing `window.addEventListener("resize", onResize);` line, add:

```ts
  const raycaster = new Raycaster();
  const pointerNdc = new Vector2();

  const onCanvasClick = (event: MouseEvent): void => {
    const rect = canvas.getBoundingClientRect();
    pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    const hit = raycaster.intersectObjects(schools.map((school) => school.mesh))[0];
    if (!hit) {
      speciesInfo.closeCard();
      return;
    }
    const school = schools.find((candidate) => candidate.mesh === hit.object);
    if (school) speciesInfo.showSpecies(school.species.id);
  };
  canvas.addEventListener("click", onCanvasClick);

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") speciesInfo.closeCard();
  };
  window.addEventListener("keydown", onKeydown);
```

(Looking up the school by scanning `schools` — at most 9 entries — instead of a `mesh → school` map built once: `rebuildInstances` replaces `school.mesh` with a brand-new `InstancedMesh` whenever the user changes the fish-count setting, which would silently desync a map built only at boot. Re-reading `schools[].mesh` fresh on every click has no such staleness risk and costs nothing at this scale.)

- [ ] **Step 5: Clean up on `pagehide`**

Change:

```ts
    disposed = true;
    window.removeEventListener("resize", onResize);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    for (const school of schools) school.dispose();
    bubbles.dispose();
    environment.dispose();
    ui.dispose();
    settingsPanel.dispose();
    renderer.dispose();
```

to:

```ts
    disposed = true;
    window.removeEventListener("resize", onResize);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    canvas.removeEventListener("click", onCanvasClick);
    window.removeEventListener("keydown", onKeydown);
    for (const school of schools) school.dispose();
    bubbles.dispose();
    environment.dispose();
    ui.dispose();
    settingsPanel.dispose();
    speciesInfo.dispose();
    renderer.dispose();
```

- [ ] **Step 6: Run the full suite, typecheck, and build**

Run: `npm --prefix web run test && npm --prefix web run build`

Expected: all pass; production build succeeds.

- [ ] **Step 7: Commit**

```bash
git add web/src/main.ts
git commit -m "feat: wire click-to-pick species info and the observation log into the boot sequence"
```

### Task 8: Full verification and manual visual pass

**Files:** none (verification only).

- [ ] **Step 1: Run the complete automated verification**

Run: `npm --prefix web run test && npm --prefix web run build`

Expected: all tests pass (Tasks 1–3's new tests plus every prior test in the suite); the production build succeeds.

- [ ] **Step 2: Manual visual pass**

Run: `npm --prefix web run preview`, open the app, and walk through every AC in `docs/DEVELOPMENT_PROPOSAL.md` §4.4:
- Click a swimming fish → the card opens at the bottom edge with the correct name and description, and shows "관찰함".
- Click empty water/floor (no fish under the cursor) → the card closes.
- Open the card, press Esc → it closes.
- Open the catalog (new button next to the gear icon) → all 9 species are listed with a 관찰/미관찰 mark and a "N/9" header, regardless of which species are currently hidden in the settings panel.
- Hide a species in the settings panel, then try clicking where it used to swim → nothing opens (already covered by Task 3's regression test, but confirm visually too); pick that same hidden species from the catalog instead → the card opens and the catalog's observed count increases.
- Reload the page → previously observed species are still marked "관찰함" in the catalog.
- Confirm the camera's position/angle never changes as a result of any click.
- Check `window.__aq` in the console still reports `calls < 30` and `triangles < 300000` (this feature adds no new draw calls, so it shouldn't move).

Report what you observed; fix anything that doesn't match before considering the task done.

- [ ] **Step 3: Final diff and whitespace check**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only files from this plan changed.
