# Species Selection and Observation Log Design

**Source:** `docs/DEVELOPMENT_PROPOSAL.md` §4.4 "선택과 관찰 기록"

**Goal:** Clicking/tapping a fish (or picking one from a catalog) shows a small card with its name and a short description, and records that species as observed — persisted across visits. The existing freedom to show/hide any species stays unlocked; nothing in this feature gates it.

**Non-goals (explicit, per §4.4):**
- No tracking camera (moving the camera toward the selected fish) — noted as later-option only.
- No real biological/taxonomic claims — descriptions stay design-flavor (silhouette/color/behavior of the procedural model), matching how `label` is already documented as a display name, not a validated species.
- No per-individual tracking — the record is per **species**, not per specific fish instance.

## 1. Click/tap picking

One `Raycaster` in `main.ts`, one `click` listener on the `#scene` canvas (not `pointerdown` — there's no competing drag gesture since the camera is drift/fixed-only, so `click` is simplest and works uniformly for mouse and touch).

```
click → NDC from event + canvas rect → raycaster.setFromCamera(ndc, camera)
      → raycaster.intersectObjects(schools.map(s => s.mesh))
      → hit?  → meshToSchool.get(hit[0].object).species.id → speciesInfo.showSpecies(id)
      → miss? → speciesInfo.closeCard() (no-op if already closed)
```

`meshToSchool: Map<InstancedMesh, FishSchool>` is built once right after `createSchools()`, alongside the existing `schoolsById` map.

**Population-scale-reduced instances are excluded automatically; hidden species are not, and need an explicit filter.** three.js's `InstancedMesh.raycast()` only tests instances `0..mesh.count` (the *drawn* count, already lowered by `setPopulationScale`), so that half of the AC is satisfied for free. But a characterization test (written while implementing) found that three.js 0.180's `Raycaster.intersectObject`/`intersectObjects` apply **no `.visible` check at all** — confirmed directly against `node_modules/three/src/core/Raycaster.js`. So the click handler must filter `schools` by `school.mesh.visible` before building the list passed to `intersectObjects`; only then does hiding a species actually exclude it from picking. This satisfies the AC "숨겨진 어종이나 비활성 인스턴스를 잘못 선택하지 않는다" — one half via three.js's own instance-count handling, the other half via one explicit filter.

**Background click closes the card, with no separate backdrop element:** `#overlay` is `pointer-events: none` at its root (style.css:43) with only specific children (`.controls`, the settings panel) opting into `pointer-events: auto`. A click on empty overlay space (or the 3D scene's water/floor) falls straight through to the canvas's own click handler, which naturally treats a raycast miss as "close the card." Clicking the card or catalog panel themselves never reaches the canvas, since both sit above it with `pointer-events: auto`.

Esc closes the card (and the catalog panel, if open) via one `keydown` listener.

Camera state is never touched by any of this.

## 2. Data: descriptions + the observation log

`CreatureDefinition` (config.ts) gains a required `description: string`, filled in for all nine species — silhouette/color/behavior only, no taxonomy:

| id | description |
|---|---|
| clownfish | 주황빛 몸에 하얀 줄무늬가 있는 작은 물고기예요. 무리를 지어 산호 밭 주변을 얌전히 맴돌아요. |
| blue-sea-bream | 푸른빛이 도는 매끈한 몸을 가진 물고기예요. 무리를 지어 넓은 수역을 여유롭게 오가요. |
| yellow-tang | 샛노란 몸빛이 눈에 띄는 납작한 물고기예요. 한 산호 근처를 정해두고 그 주변을 잘 벗어나지 않아요. |
| butterflyfish | 원반 모양 몸에 눈 주위로 짙은 띠무늬가 있는 물고기예요. 혼자 산호 곁을 서성이며 지내요. |
| purple-tang | 보라색 몸에 샛노란 지느러미가 대비되는 물고기예요. 자기 구역의 산호를 좀처럼 벗어나지 않아요. |
| pink-cardinalfish | 자줏빛이 도는 아주 작은 물고기예요. 촘촘한 무리를 이루어 빠르게 움직여요. |
| great-white-shark | 몸집이 큰 회청색 헤엄손님이에요. 방향을 크고 느리게 틀며 넓은 구역을 순찰하듯 돌아요. |
| seahorse | 몸을 세운 채 헤엄치는 분홍빛 생물이에요. 꼬리를 산호에 말아 붙잡고 한자리에 머물러요. |
| green-sea-turtle | 둥근 등딱지를 지닌 큰 생물이에요. 네 다리로 천천히 헤엄치며 수면 가까이를 오가요. |

The observation log is a *growing history*, unlike `AquariumSettings` (a replaceable snapshot) — it gets its own module and storage key rather than joining `AquariumSettings`/`sanitizeSettings`:

```ts
// observations.ts — mirrors settings.ts's exact load/save/sanitize shape
export const OBSERVATIONS_STORAGE_KEY = "aquarium:observed-species";
export type ObservedSpecies = Readonly<Record<string, boolean>>;

export function sanitizeObservedSpecies(raw: unknown, registry: readonly FishSpecies[]): ObservedSpecies;
export function loadObservedSpecies(storage: Pick<Storage, "getItem"> | undefined): ObservedSpecies;
export function saveObservedSpecies(observed: ObservedSpecies, storage: Pick<Storage, "setItem"> | undefined): void;
/** Pure reducer: marks one species observed (no-ops toward the same shape if already true). */
export function withObserved(observed: ObservedSpecies, speciesId: string): ObservedSpecies;
/** Count for the catalog header ("9종 중 N종 관찰"). */
export function countObserved(observed: ObservedSpecies, registry: readonly FishSpecies[]): number;
```

Unlike `sanitizeEnabledSpecies` (missing id defaults to `true` — shown), a missing id here defaults to `false` (not yet observed) — the natural default for a log.

## 3. UI: card + catalog

New module `speciesInfo.ts`, mirroring `settingsPanel.ts`'s shape (pure DOM glue, no storage access — `main.ts` persists via `onObserve`):

```ts
export interface SpeciesInfoCallbacks {
  onObserve(speciesId: string): void;
}
export function createSpeciesInfo(
  registry: readonly FishSpecies[],
  initialObserved: ObservedSpecies,
  callbacks: SpeciesInfoCallbacks,
): {
  readonly cardElement: HTMLElement;
  readonly catalogElement: HTMLElement;
  showSpecies(speciesId: string): void; // opens/switches the card AND calls onObserve
  closeCard(): void;
  dispose(): void;
};
```

- **Card**: name, description, a small "관찰함" checkmark, a close (×) button. Fixed to a screen edge (bottom, matching "화면 가장자리"). Content is replaced in place if a new species is picked while already open (no stacking).
- **Catalog** ("도감"): always lists all nine registry species regardless of the current show/hide settings — the AC "모든 어종을 직접 고를 수 있는 현재 자유도를 잠금으로 바꾸지 않는다" means the catalog must not become the only way to see a hidden species' info, nor should visibility settings affect what's *browsable* here. Each row shows the label + an observed/not-observed mark; a header shows `countObserved`/9. Clicking a row calls the same `showSpecies` (and therefore also marks it observed) — confirmed: opening from the catalog counts the same as tapping the live fish.

`ui.ts` gains two new `CreateUiOptions` fields, `speciesCard?: HTMLElement` and `speciesCatalog?: HTMLElement`, following the exact existing pattern: the card is just appended to `root` (no toggle button — it opens via picking, not a button), while the catalog gets a new icon button in `.controls` (next to the gear), toggling an `is-open` class exactly like the settings button already does.

## 4. Testing plan

**Pure logic (vitest):**
- `observations.ts`: `sanitizeObservedSpecies` (defaults missing ids to `false`, drops unknown ids, survives garbage input), `loadObservedSpecies`/`saveObservedSpecies` (storage-unavailable fallback, round-trip), `withObserved` (sets one id true, leaves others untouched, idempotent), `countObserved`.
- `config.test.ts`: every registry species has a non-empty `description`.
- `fish.test.ts`: a regression test constructing a real `Raycaster`-style scenario — actually simplest as a direct assertion on `InstancedMesh.raycast` semantics: build a school, call `setVisible(false)` or shrink its population, and assert a `Raycaster` intersecting its mesh directly returns no hits for instances beyond `mesh.count` / for an invisible mesh. This pins down the "automatic exclusion" claim in §1 rather than trusting it undocumented.

**Manual (`npm run preview`, matching this repo's convention for `ui.ts`/`settingsPanel.ts`):** click a fish → card appears with correct name/description; click empty water → closes; Esc closes; open catalog → all 9 species listed regardless of hidden ones; pick a hidden-in-tank species from the catalog → card opens, catalog observed-count increments; reload the page → previously observed species still marked in the catalog; confirm camera position/angle is unaffected by any click.

## 5. Files touched

- `web/src/config.ts` — `description` field + 9 values.
- `web/src/config.test.ts` — description-present test.
- `web/src/observations.ts` (new) + `web/src/observations.test.ts` (new).
- `web/src/speciesInfo.ts` (new) — card + catalog DOM.
- `web/src/ui.ts` — two new options, one new catalog toggle button.
- `web/src/main.ts` — `Raycaster`, `meshToSchool` map, click/keydown wiring, `createSpeciesInfo`/`loadObservedSpecies`/`saveObservedSpecies` composition.
- `web/src/style.css` — card/catalog/new button styling, following existing tokens.
- `web/src/fish.test.ts` — raycast-exclusion regression test.
