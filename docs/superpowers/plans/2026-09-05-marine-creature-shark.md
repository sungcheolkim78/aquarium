# Marine Creature Geometry and Shark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single fish body-plan assumption with a discriminated creature geometry model and add one swimming low-poly shark while preserving the existing fish behavior, instancing, settings, and performance budgets.

**Architecture:** Creature definitions will use a geometry-keyed union so each body plan owns only its valid shape fields. Geometry builders will be split into focused modules behind one dispatcher, while the existing school/instancing path remains shared. The first vertical slice is a shark using the existing `swim` locomotion; turtle geometry and seahorse `hover` behavior remain documented follow-up work.

**Tech Stack:** TypeScript, Three.js `BufferGeometry`/`InstancedMesh`, Vitest, Vite.

**Spec:** `docs/SPEC.md`, especially §6.1, §6.2, §6.5.6, N1, N4.

## Global Constraints

- Preserve `+X` as the creature's forward direction.
- Keep one `InstancedMesh` draw call per registry species.
- Keep seeded scene generation deterministic; do not introduce `Math.random()`.
- Keep default fish geometry behavior and medium-detail output unchanged.
- Keep total draw calls below 30 and triangles below 300,000 for tested settings.
- The settings panel must continue to derive its species list from the registry.
- Run tests before implementation changes can be considered complete.

---

### Task 1: Lock the instance-capacity regression before the geometry migration

**Files:**
- Modify: `web/src/fish.test.ts`
- Modify: `web/src/fish.ts`

**Interfaces:**
- Existing `FishSchool.rebuildInstances(countScale)` remains the public operation.
- `aPhase` must have one element per allocated instance after capacity grows.

- [ ] **Step 1: Write the failing regression test**

Extend the existing instance rebuild test to assert `school.mesh.geometry.getAttribute("aPhase").count` equals the grown capacity after `rebuildInstances(1.5)`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm --prefix web run test -- src/fish.test.ts`

Expected: the new assertion fails because `rebuildInstances()` currently creates a larger mesh without rewriting the shared phase attribute.

- [ ] **Step 3: Implement the minimal fix**

Call `this.writePhaseAttribute()` after assigning the new mesh and before matrix updates, using the newly assigned `this.capacity` and current boids.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm --prefix web run test -- src/fish.test.ts`

Expected: all fish tests pass, including the new capacity assertion.

- [ ] **Step 5: Commit the isolated fix**

```bash
git add web/src/fish.ts web/src/fish.test.ts
git commit -m "fix: resize fish phase attributes with instance capacity"
```

### Task 2: Introduce geometry-keyed creature types and shark registry data

**Files:**
- Modify: `web/src/config.ts`
- Modify: `web/src/config.test.ts`
- Modify: `web/src/fish.test.ts`

**Interfaces:**
- Add `CreatureGeometryId = "lowpoly-fish" | "lowpoly-shark"` for this slice.
- Add `SharkShape` with `length`, `height`, `width`, `tailSpan`, and `dorsalFinHeight`.
- Add `CreatureVariant = { geometry: "lowpoly-fish"; shape: FishShape } | { geometry: "lowpoly-shark"; shape: SharkShape }`.
- `FishSpecies` gains a `variant`-compatible geometry/shape relationship without invalid casts.

- [ ] **Step 1: Write failing registry/type tests**

Add tests that locate `great-white-shark`, assert its geometry is `lowpoly-shark`, assert its shape has positive shark-specific dimensions, and assert all registry entries have a valid geometry-specific shape.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `npm --prefix web run test -- src/config.test.ts src/fish.test.ts`

Expected: the shark lookup fails because no shark registry entry exists.

- [ ] **Step 3: Implement the minimum type and registry changes**

Extend the geometry union, define `SharkShape`, add one registry entry with a conservative count (4), and use `locomotion: "swim"` in the behavior contract. Keep the existing six fish entries unchanged.

- [ ] **Step 4: Run focused tests and verify they pass**

Run: `npm --prefix web run test -- src/config.test.ts src/fish.test.ts`

Expected: the registry/type tests pass; geometry construction tests may still fail until Task 3 dispatches the shark builder.

- [ ] **Step 5: Commit the type/data slice**

```bash
git add web/src/config.ts web/src/config.test.ts web/src/fish.test.ts
git commit -m "feat: define shark creature variant"
```

### Task 3: Split geometry builders and dispatch shark construction

**Files:**
- Create: `web/src/creatures/geometry/fish.ts`
- Create: `web/src/creatures/geometry/shark.ts`
- Create: `web/src/creatures/geometry/index.ts`
- Modify: `web/src/fish.ts`
- Modify: `web/src/fish.test.ts`
- Modify: `web/src/settings.ts`

**Interfaces:**
- `buildFishGeometry(shape, palette, detail): BufferGeometry` moves to the fish geometry module and remains re-exported from `fish.ts` for compatibility.
- `buildSharkGeometry(shape, palette, detail): BufferGeometry` builds a shark along `+X`.
- `buildCreatureGeometry(species, detail): BufferGeometry` dispatches on `species.geometry`.
- `FishSchool` constructs geometry through `buildCreatureGeometry` and no longer assumes every shape has fish-only fields.

- [ ] **Step 1: Write failing shark geometry tests**

Add tests for finite non-indexed shark vertices, positive triangle count, high detail producing more triangles than medium, a dorsal fin extending above the body, and deterministic output for identical inputs.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm --prefix web run test -- src/fish.test.ts`

Expected: the shark builder/dispatcher test fails because `lowpoly-shark` has no geometry implementation.

- [ ] **Step 3: Move the existing fish builder without behavior changes**

Move fish-only helpers and `buildFishGeometry` into `creatures/geometry/fish.ts`; export it through the old `fish.ts` path so existing tests and callers remain stable.

- [ ] **Step 4: Implement the minimal shark builder**

Create a faceted body using shark detail profiles, a tapered snout, a caudal fin with distinct upper/lower lobes, and a dorsal fin. Use the existing palette colors and double-sided fin triangles. Do not add a second material or mesh.

- [ ] **Step 5: Add the geometry dispatcher and wire `FishSchool`**

Dispatch fish and shark variants by geometry key. Keep existing shader sway only for the fish body path; shark may use the same gentle sway initially with its own length value.

- [ ] **Step 6: Run focused tests and verify they pass**

Run: `npm --prefix web run test -- src/fish.test.ts src/settings.test.ts`

Expected: existing fish geometry tests and new shark geometry tests pass.

- [ ] **Step 7: Commit the geometry slice**

```bash
git add web/src/creatures web/src/fish.ts web/src/fish.test.ts web/src/settings.ts
git commit -m "feat: dispatch procedural geometry for sharks"
```

### Task 4: Verify integration, budget, and documentation

**Files:**
- Modify: `docs/SPEC.md`
- Modify: `README.md`

**Interfaces:**
- The registry remains the only source for species creation and settings-panel species entries.
- `createSchools()` returns one school/mesh for every registered species.

- [ ] **Step 1: Add integration assertions**

Extend school tests to assert registry length equals created school count, the shark school uses an `InstancedMesh`, and the full registry remains within the N1 triangle/draw-call budget.

- [ ] **Step 2: Run the complete automated verification**

Run: `npm --prefix web run test && npm --prefix web run build`

Expected: all tests pass and Vite produces a production build.

- [ ] **Step 3: Update project documentation**

Document the new shark entry, the geometry-keyed dispatch boundary, and the fact that turtle/seahorse geometry and `hover` locomotion are follow-up stages rather than part of this slice.

- [ ] **Step 4: Run a final diff and whitespace check**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only the plan, shark implementation, related tests, and required documentation are changed.

- [ ] **Step 5: Commit the completed shark slice**

```bash
git add docs/SPEC.md README.md web/src
git commit -m "feat: add shark creature vertical slice"
```

## Follow-up Plan: Turtle, Seahorse, and Hover Locomotion

After the shark slice is stable, add `lowpoly-turtle` and `lowpoly-seahorse` variants with independent shape/detail profiles. Generalize the registry type to `CreatureSpecies`, move school logic to `CreatureSchool`, and add `behavior.locomotion: "swim" | "hover"`. Implement seahorse hover using a deterministic anchor plus slow vertical oscillation; keep cohesion/separation/containment separate from locomotion so it does not inherit fish-like abrupt turns.
