# Fish Procedural Grammar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single hardcoded `lowpoly-fish` body formula with a fully parametrized, per-species-YAML-driven "Fish Procedural Grammar" (snout/body/peduncle/tail fin/dorsal fin/pelvic fin/pectoral fin/thread/eye/pattern), raising the per-fish triangle budget several times over today's baseline, and namespacing species-YAML loading by creature kind so shark/seahorse/turtle can adopt the same pattern later.

**Architecture:** Task 1 rewrites `web/src/creatures/geometry/fish.ts` (new pure geometry functions + assembly) and `web/src/config.ts` (new nested `FishShape` type family, new `FishDetailProfile`, no facet jitter), migrating the 6 existing `lowpoly-fish` species to the new shape as inline TypeScript literals so the whole rewrite is testable end-to-end without also introducing YAML in the same task. Task 2 introduces `web/src/creatures/species/fish.ts` (YAML parse + validate) and `web/species/fish/*.yaml`, deletes the inline literals, and wires `FISH_REGISTRY` to load from YAML — a pure data-location refactor on top of Task 1's already-working geometry.

**Tech Stack:** TypeScript (strict), Three.js `BufferGeometry`, the `yaml` npm package, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-06-fish-procedural-grammar-design.md`

## Global Constraints

- All commands run from the repo root using `npm --prefix web run <script>` (matches this repo's existing plan convention), or `cd web && npm run <script>`.
- `npm --prefix web run build` (`tsc --noEmit && vite build`) must pass with zero errors. `tsconfig.json` has `strict`, `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `verbatimModuleSyntax` all on — optional object fields must be added via conditional spreads (never `field: undefined`), type-only imports must use `import type`, and array/index access that TypeScript can't prove is in range needs an explicit `as T` cast (matching the existing `(boids[i] as Boid)` idiom already used throughout this codebase).
- `npm --prefix web run test` (`vitest run`) must pass.
- Keep one `InstancedMesh` draw call per registry species (SPEC N1) — this plan changes triangle counts, never draw-call counts.
- Keep total draw calls < 30 and triangles < 300,000 for the default registry (SPEC N1) — verified by the existing `"stays inside the performance budget of N1"` test in `fish.test.ts`, which must keep passing unchanged.
- No facet jitter at any detail tier — `computeFacetJitter` and the `facetJitter` field are removed entirely, not zeroed.
- `+X` stays each creature's forward direction (nose-first); this plan does not touch that convention.
- `lowpoly-shark` / `lowpoly-seahorse` / `lowpoly-turtle` geometry, their shape types, and their geometry files are untouched by this plan.
- Species YAML lives under `web/species/<kind>/*.yaml`; the loader for one kind lives at `web/src/creatures/species/<kind>.ts`, mirroring the existing `web/src/creatures/geometry/<kind>.ts` pattern. This plan wires up `fish` only.
- Before either task's final commit, run the full test suite and `tsc --noEmit`. Before considering the whole plan done, additionally run `npm --prefix web run build && npm --prefix web run preview` and visually check the aquarium in a browser (this repo's own stated rule for `web/` changes — type checks and tests verify correctness, not the visual/perf feel).

---

### Task 1: Rewrite the fish geometry grammar and config types (species still inline TS)

**Files:**
- Modify: `web/src/config.ts`
- Modify: `web/src/creatures/geometry/fish.ts`
- Modify: `web/src/creatures/geometry/index.ts`
- Modify: `web/src/fish.ts`
- Modify: `web/src/fish.test.ts`

**Interfaces:**
- Produces (consumed by Task 2 and by `web/src/fish.ts`'s `FishSchool`):
  - `config.ts`: `FishSnoutShape`, `FishBodyShape`, `FishPeduncleShape`, `FishTailFinShape`, `FishDorsalFinShape`, `FishPelvicFinShape`, `FishPectoralFinShape`, `FishThreadShape`, `FishEyeShape`, `FishPatternShape`, `FishShape` (the aggregate — has a top-level `length: number` that always mirrors `body.length`, plus `snout`/`body`/`peduncle`/`tailFin`/`dorsalFin`/`pelvicFin`/`pectoralFin`/`pattern` required, `thread?`/`eye?` optional).
  - `config.ts`: `CreatureDefinition["palette"]` gains optional `eye?: string`.
  - `config.ts`: `FishDetailProfile = { bodySegments: number; ringSides: number; finSegments: number }` (no `facetJitter`).
  - `creatures/geometry/fish.ts`: `fishBodyRadius(t, shape): number`, `fishTailFin(shape, finSegments)`, `fishDorsalFin(shape, finSegments)`, `fishPelvicFin(shape, side)`, `fishPectoralFin(shape, finSegments, side)`, `fishThread(shape, finSegments)`, `fishEyePoints(shape)`, `buildFishGeometry(shape, palette, detail?)` (signature unchanged from today).
- Consumes: nothing new from elsewhere — this task is self-contained on top of the existing three.js/`BufferGeometry` APIs already used by `shark.ts`/`seahorse.ts`.

#### Step 1: Add the new `FishShape` type family to `config.ts`

Read `web/src/config.ts` first (it's a large file — locate the existing `FishShape` interface and the `FISH_DETAIL_PROFILES`/`FishDetailProfile` block near the top). Replace the existing `FishShape` interface and `FishDetailProfile`/`FISH_DETAIL_PROFILES` with:

```ts
/** Body cross-section/length subdivision counts for fish geometry (docs/superpowers/specs/2026-09-06-fish-procedural-grammar-design.md §4). */
export interface FishDetailProfile {
  /** Segment count for the main-body zone; snout/peduncle zones derive their own count as `max(2, round(bodySegments * 0.4))`. */
  readonly bodySegments: number;
  /** Vertices around each ring's cross-section. */
  readonly ringSides: number;
  /** Shared wedge/strip count for the tail fin, dorsal fin, pectoral fin, and (if present) the thread. */
  readonly finSegments: number;
}

/** `high` deliberately targets ~11x today's baseline triangle count — the scene-wide triangle budget (SPEC N1) has large headroom. No facet jitter at any tier: real segment counts now carry high-detail richness. */
export const FISH_DETAIL_PROFILES: Record<DetailLevel, FishDetailProfile> = {
  low: { bodySegments: 4, ringSides: 5, finSegments: 3 },
  medium: { bodySegments: 8, ringSides: 7, finSegments: 4 },
  high: { bodySegments: 16, ringSides: 10, finSegments: 7 },
};

export interface FishSnoutShape {
  /** Fraction (0..1) of `body.length` occupied by the snout zone. */
  readonly length: number;
  /** Exponent controlling how fast the snout widens from its tip toward the main body. */
  readonly taper: number;
  /** Radius fraction at the very tip of the nose. Defaults to 0.08. */
  readonly tipRadius?: number;
}

export interface FishBodyShape {
  /** Nose-to-tail-fin-root length in world units. */
  readonly length: number;
  readonly maxHeight: number;
  readonly maxWidth: number;
  /** Fraction (0..1, exclusive), position of the widest point within the main-body zone. */
  readonly peak: number;
  /** Exponent controlling how sharply the main-body zone bulges toward `peak`. */
  readonly taper: number;
  /** Radius fraction at the main-body zone's own start/end (where it meets the snout/peduncle zones). Defaults to 0.82. */
  readonly shoulderRadius?: number;
}

export interface FishPeduncleShape {
  /** Fraction (0..1) of `body.length` occupied by the peduncle zone. */
  readonly length: number;
  /** Exponent controlling how fast the peduncle narrows toward the tail fin. */
  readonly taper: number;
  /** Radius fraction at the tail-fin root. Defaults to 0.12. */
  readonly width?: number;
}

export interface FishTailFinShape {
  readonly height: number;
  readonly length: number;
  /** 0..1 (exclusive): how far the trailing-edge notch is pulled toward the root. */
  readonly notch: number;
}

export interface FishDorsalFinShape {
  /** t-fraction (0..1) along body.length where the fin base starts. */
  readonly start: number;
  /** t-fraction (0..1) along body.length where the fin base ends; must be greater than `start`. */
  readonly end: number;
  readonly height: number;
}

export interface FishPelvicFinShape {
  readonly length: number;
  /** Degrees swept back from vertical. */
  readonly angle: number;
  /** t-fraction along body.length where the fin root sits. Defaults to 0.55. */
  readonly at?: number;
}

export interface FishPectoralFinShape {
  readonly length: number;
  /** Degrees swept back from horizontal. */
  readonly angle: number;
  /** t-fraction along body.length where the fin root sits. Defaults to 0.28. */
  readonly at?: number;
}

export interface FishThreadShape {
  readonly length: number;
  readonly curvature: number;
}

export interface FishEyeShape {
  /** World-scale radius. 0 omits the eye entirely. Defaults to `0.16 * body.maxHeight` when the whole `eye` group is absent. */
  readonly radius?: number;
}

export interface FishPatternShape {
  readonly stripes: number;
}

/** Per-species silhouette parameters for the `lowpoly-fish` grammar (docs/superpowers/specs/2026-09-06-fish-procedural-grammar-design.md). */
export interface FishShape {
  /** Always equal to `body.length` — required because `fish.ts`'s sway shader reads `species.shape.length` generically across every creature kind. Never authored separately. */
  readonly length: number;
  readonly snout: FishSnoutShape;
  readonly body: FishBodyShape;
  readonly peduncle: FishPeduncleShape;
  readonly tailFin: FishTailFinShape;
  readonly dorsalFin: FishDorsalFinShape;
  readonly pelvicFin: FishPelvicFinShape;
  readonly pectoralFin: FishPectoralFinShape;
  readonly pattern: FishPatternShape;
  readonly thread?: FishThreadShape;
  readonly eye?: FishEyeShape;
}
```

Then find `CreatureDefinition`'s `palette` field and add the optional `eye`:

```ts
readonly palette: {
  readonly body: string;
  readonly fin: string;
  readonly accent: string;
  /** Eye color; defaults to a fixed dark constant (see `creatures/geometry/fish.ts`) when omitted. */
  readonly eye?: string;
};
```

Run `npm --prefix web run build` now — expect **failures** in `config.ts` itself (the 6 inline `lowpoly-fish` entries in `FISH_REGISTRY` still use the old flat `shape: { length, height, width, tailSpan, stripes }`) and in `creatures/geometry/fish.ts` (still reads the old fields). This is expected; both get fixed by the end of this task (Steps 3-5 rewrite the geometry file and its re-exports).

#### Step 2: Migrate the 6 inline `FISH_REGISTRY` species to the new shape

Still in `config.ts`, replace each of the 6 `lowpoly-fish` entries' `shape` field (the `clownfish`, `blue-sea-bream`, `yellow-tang`, `butterflyfish`, `purple-tang`, `pink-cardinalfish` entries — leave `id`/`label`/`description`/`palette`/`behavior`/`count`/`geometry` untouched) with the following. None use `thread` (reserved for a future species).

`clownfish`:
```ts
shape: {
  length: 0.62,
  snout: { length: 0.16, taper: 0.8, tipRadius: 0.09 },
  body: { length: 0.62, maxHeight: 0.34, maxWidth: 0.16, peak: 0.42, taper: 1.1, shoulderRadius: 0.82 },
  peduncle: { length: 0.16, taper: 1.6, width: 0.13 },
  tailFin: { height: 0.27, length: 0.27, notch: 0.3 },
  dorsalFin: { start: 0.28, end: 0.74, height: 0.14 },
  pelvicFin: { length: 0.1, angle: 45, at: 0.56 },
  pectoralFin: { length: 0.13, angle: 30, at: 0.26 },
  eye: { radius: 0.06 },
  pattern: { stripes: 3 },
},
```

`blue-sea-bream`:
```ts
shape: {
  length: 0.86,
  snout: { length: 0.14, taper: 0.9, tipRadius: 0.08 },
  body: { length: 0.86, maxHeight: 0.46, maxWidth: 0.2, peak: 0.4, taper: 1.0, shoulderRadius: 0.85 },
  peduncle: { length: 0.15, taper: 1.7, width: 0.12 },
  tailFin: { height: 0.36, length: 0.36, notch: 0.4 },
  dorsalFin: { start: 0.3, end: 0.8, height: 0.16 },
  pelvicFin: { length: 0.13, angle: 42, at: 0.55 },
  pectoralFin: { length: 0.16, angle: 28, at: 0.25 },
  eye: { radius: 0.055 },
  pattern: { stripes: 0 },
},
```

`yellow-tang`:
```ts
shape: {
  length: 0.5,
  snout: { length: 0.13, taper: 0.75, tipRadius: 0.07 },
  body: { length: 0.5, maxHeight: 0.44, maxWidth: 0.13, peak: 0.46, taper: 1.3, shoulderRadius: 0.8 },
  peduncle: { length: 0.15, taper: 1.8, width: 0.11 },
  tailFin: { height: 0.23, length: 0.24, notch: 0.25 },
  dorsalFin: { start: 0.24, end: 0.82, height: 0.2 },
  pelvicFin: { length: 0.1, angle: 48, at: 0.58 },
  pectoralFin: { length: 0.12, angle: 32, at: 0.26 },
  eye: { radius: 0.06 },
  pattern: { stripes: 0 },
},
```

`butterflyfish`:
```ts
shape: {
  length: 0.46,
  snout: { length: 0.12, taper: 0.6, tipRadius: 0.06 },
  body: { length: 0.46, maxHeight: 0.6, maxWidth: 0.12, peak: 0.48, taper: 1.4, shoulderRadius: 0.78 },
  peduncle: { length: 0.14, taper: 1.9, width: 0.1 },
  tailFin: { height: 0.22, length: 0.2, notch: 0.2 },
  dorsalFin: { start: 0.22, end: 0.86, height: 0.24 },
  pelvicFin: { length: 0.09, angle: 50, at: 0.6 },
  pectoralFin: { length: 0.11, angle: 34, at: 0.24 },
  eye: { radius: 0.055 },
  pattern: { stripes: 1 },
},
```

`purple-tang`:
```ts
shape: {
  length: 0.7,
  snout: { length: 0.14, taper: 0.85, tipRadius: 0.08 },
  body: { length: 0.7, maxHeight: 0.52, maxWidth: 0.18, peak: 0.44, taper: 1.15, shoulderRadius: 0.82 },
  peduncle: { length: 0.15, taper: 1.7, width: 0.12 },
  tailFin: { height: 0.3, length: 0.3, notch: 0.32 },
  dorsalFin: { start: 0.28, end: 0.8, height: 0.19 },
  pelvicFin: { length: 0.12, angle: 44, at: 0.56 },
  pectoralFin: { length: 0.15, angle: 30, at: 0.26 },
  eye: { radius: 0.058 },
  pattern: { stripes: 0 },
},
```

`pink-cardinalfish`:
```ts
shape: {
  length: 0.34,
  snout: { length: 0.18, taper: 0.7, tipRadius: 0.06 },
  body: { length: 0.34, maxHeight: 0.2, maxWidth: 0.11, peak: 0.4, taper: 1.0, shoulderRadius: 0.84 },
  peduncle: { length: 0.17, taper: 1.5, width: 0.09 },
  tailFin: { height: 0.16, length: 0.16, notch: 0.3 },
  dorsalFin: { start: 0.3, end: 0.7, height: 0.1 },
  pelvicFin: { length: 0.07, angle: 40, at: 0.55 },
  pectoralFin: { length: 0.09, angle: 28, at: 0.26 },
  eye: { radius: 0.04 },
  pattern: { stripes: 0 },
},
```

(These exact values carry over verbatim into the YAML files in Task 2 — this is a pure data-location refactor, not a second round of visual tuning.)

`npm --prefix web run build` still fails at this point — only `config.ts`'s own consistency is fixed; `creatures/geometry/fish.ts` still references the old flat fields. That's expected; fixed in the remaining steps.

#### Step 3: Write failing tests for `fishBodyRadius`

Open `web/src/fish.test.ts`. Find the `describe("computeFacetJitter"...)` block and the `describe("buildFishGeometry high detail facet jitter"...)` block — **delete both entirely** (the feature they test no longer exists). Remove `computeFacetJitter` from the `fish.ts` import list at the top of the file.

Add a new `describe` block (place it right before the existing `describe("buildFishGeometry", ...)` block), importing the not-yet-written function:

```ts
import { fishBodyRadius } from "./creatures/geometry/fish";
```

```ts
describe("fishBodyRadius", () => {
  const baseShape = {
    length: 1,
    snout: { length: 0.15, taper: 0.8 },
    body: { length: 1, maxHeight: 0.4, maxWidth: 0.2, peak: 0.4, taper: 1.1 },
    peduncle: { length: 0.15, taper: 1.6 },
    tailFin: { height: 0.2, length: 0.2, notch: 0.3 },
    dorsalFin: { start: 0.2, end: 0.7, height: 0.15 },
    pelvicFin: { length: 0.1, angle: 40 },
    pectoralFin: { length: 0.12, angle: 30 },
    pattern: { stripes: 0 },
  };

  it("returns the default snout tip radius at t=0 and default peduncle width at t=1", () => {
    expect(fishBodyRadius(0, baseShape)).toBeCloseTo(0.08, 5);
    expect(fishBodyRadius(1, baseShape)).toBeCloseTo(0.12, 5);
  });

  it("returns the default shoulder radius exactly at the snout/main-body and main-body/peduncle boundaries", () => {
    const s = baseShape.snout.length;
    const p = baseShape.peduncle.length;
    expect(fishBodyRadius(s, baseShape)).toBeCloseTo(0.82, 5);
    expect(fishBodyRadius(1 - p, baseShape)).toBeCloseTo(0.82, 5);
  });

  it("reaches radius 1 exactly at body.peak (mapped into the main-body zone)", () => {
    const s = baseShape.snout.length;
    const p = baseShape.peduncle.length;
    const tAtPeak = s + baseShape.body.peak * (1 - s - p);
    expect(fishBodyRadius(tAtPeak, baseShape)).toBeCloseTo(1, 5);
  });

  it("is continuous: values just inside and just outside each zone boundary are nearly equal", () => {
    const s = baseShape.snout.length;
    const p = baseShape.peduncle.length;
    expect(fishBodyRadius(s - 1e-6, baseShape)).toBeCloseTo(fishBodyRadius(s + 1e-6, baseShape), 4);
    expect(fishBodyRadius(1 - p - 1e-6, baseShape)).toBeCloseTo(fishBodyRadius(1 - p + 1e-6, baseShape), 4);
  });

  it("a higher body.peak shifts the max-radius point later along the body", () => {
    const forward = { ...baseShape, body: { ...baseShape.body, peak: 0.25 } };
    const aft = { ...baseShape, body: { ...baseShape.body, peak: 0.75 } };
    const argmax = (shape: typeof baseShape): number => {
      let bestT = 0;
      let bestR = -Infinity;
      for (let i = 0; i <= 200; i += 1) {
        const t = i / 200;
        const r = fishBodyRadius(t, shape);
        if (r > bestR) {
          bestR = r;
          bestT = t;
        }
      }
      return bestT;
    };
    expect(argmax(aft)).toBeGreaterThan(argmax(forward));
  });

  it("respects explicit tipRadius/shoulderRadius/width overrides", () => {
    const custom = {
      ...baseShape,
      snout: { ...baseShape.snout, tipRadius: 0.2 },
      body: { ...baseShape.body, shoulderRadius: 0.9 },
      peduncle: { ...baseShape.peduncle, width: 0.3 },
    };
    expect(fishBodyRadius(0, custom)).toBeCloseTo(0.2, 5);
    expect(fishBodyRadius(1, custom)).toBeCloseTo(0.3, 5);
    expect(fishBodyRadius(custom.snout.length, custom)).toBeCloseTo(0.9, 5);
  });
});
```

Run: `npm --prefix web run test -- src/fish.test.ts`
Expected: FAIL — `fishBodyRadius` is not exported from `./creatures/geometry/fish` yet.

#### Step 4: Implement `fishBodyRadius` and rewrite the body loft in `creatures/geometry/fish.ts`

Read `web/src/creatures/geometry/fish.ts` in full, then replace its entire contents with:

```ts
import { BufferAttribute, BufferGeometry, Color, Vector3 } from "three";

import { FISH_DETAIL_PROFILES, type DetailLevel, type FishShape, type FishSpecies } from "../../config";

interface MeshBuffers {
  readonly positions: number[];
  readonly colors: number[];
}

const DEFAULT_SNOUT_TIP_RADIUS = 0.08;
const DEFAULT_SHOULDER_RADIUS = 0.82;
const DEFAULT_PEDUNCLE_WIDTH = 0.12;
const DEFAULT_EYE_COLOR = "#141414";
const DEFAULT_PELVIC_FIN_AT = 0.55;
const DEFAULT_PECTORAL_FIN_AT = 0.28;

function pushVertex(buffers: MeshBuffers, vertex: Vector3, color: Color): void {
  buffers.positions.push(vertex.x, vertex.y, vertex.z);
  buffers.colors.push(color.r, color.g, color.b);
}

function pushTriangle(buffers: MeshBuffers, a: Vector3, b: Vector3, c: Vector3, color: Color): void {
  pushVertex(buffers, a, color);
  pushVertex(buffers, b, color);
  pushVertex(buffers, c, color);
}

/** Double-sided single triangle — every fin in this file is a single-layer surface with no back geometry. */
function pushFin(buffers: MeshBuffers, a: Vector3, b: Vector3, c: Vector3, color: Color): void {
  pushTriangle(buffers, a, b, c, color);
  pushTriangle(buffers, a, c, b, color);
}

/** 0 at u=0, 1 at u=peak, 0 at u=1. Used only for the main-body zone's bulge. */
function bump(u: number, peak: number, taper: number): number {
  if (u <= peak) return Math.pow(u / peak, taper);
  return Math.pow((1 - u) / (1 - peak), taper);
}

/**
 * Nose-to-tail-fin-root cross-section radius fraction, `t ∈ [0,1]`. Three
 * zones — snout, main body, peduncle — each with their own taper exponent,
 * agreeing exactly at `shoulderRadius` where they meet so the profile is
 * continuous with no stitching seam (docs/superpowers/specs/2026-09-06-fish-procedural-grammar-design.md §3.1).
 */
export function fishBodyRadius(t: number, shape: FishShape): number {
  const s = shape.snout.length;
  const p = shape.peduncle.length;
  const shoulder = shape.body.shoulderRadius ?? DEFAULT_SHOULDER_RADIUS;

  if (t <= s) {
    const tipRadius = shape.snout.tipRadius ?? DEFAULT_SNOUT_TIP_RADIUS;
    const v = s > 0 ? t / s : 1;
    return tipRadius + (shoulder - tipRadius) * Math.pow(v, shape.snout.taper);
  }
  if (t >= 1 - p) {
    const peduncleWidth = shape.peduncle.width ?? DEFAULT_PEDUNCLE_WIDTH;
    const w = p > 0 ? (t - (1 - p)) / p : 0;
    return shoulder - (shoulder - peduncleWidth) * Math.pow(w, shape.peduncle.taper);
  }
  const u = (t - s) / (1 - s - p);
  return shoulder + (1 - shoulder) * bump(u, shape.body.peak, shape.body.taper);
}

function ringVertex(x: number, radius: number, shape: FishShape, index: number, sides: number): Vector3 {
  const angle = (index / sides) * Math.PI * 2;
  return new Vector3(
    x,
    Math.cos(angle) * (shape.body.maxHeight / 2) * radius,
    Math.sin(angle) * (shape.body.maxWidth / 2) * radius,
  );
}

/** Symmetric parametric fan per lobe; `notch` forks the trailing edge instead of a flat wedge. */
export function fishTailFin(
  shape: FishShape,
  finSegments: number,
): { root: Vector3; upperFan: Vector3[]; lowerFan: Vector3[] } {
  const half = shape.body.length / 2;
  const root = new Vector3(-half, 0, 0);
  const segments = Math.max(2, finSegments);
  const upperFan: Vector3[] = [];
  const lowerFan: Vector3[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const u = i / segments;
    const x = -half - shape.tailFin.length * (shape.tailFin.notch + u * (1 - shape.tailFin.notch));
    const y = shape.tailFin.height * u;
    upperFan.push(new Vector3(x, y, 0));
    lowerFan.push(new Vector3(x, -y, 0));
  }
  return { root, upperFan, lowerFan };
}

/** `finSegments` points along the body surface between `dorsalFin.start` and `dorsalFin.end`; elevation tapers to 0 at both ends. */
export function fishDorsalFin(
  shape: FishShape,
  finSegments: number,
): Array<{ base: Vector3; top: Vector3 }> {
  const half = shape.body.length / 2;
  const pointCount = Math.max(2, finSegments);
  const points: Array<{ base: Vector3; top: Vector3 }> = [];
  for (let i = 0; i < pointCount; i += 1) {
    const u = i / (pointCount - 1);
    const t = shape.dorsalFin.start + u * (shape.dorsalFin.end - shape.dorsalFin.start);
    const x = half - shape.body.length * t;
    const radius = fishBodyRadius(t, shape);
    const baseY = (radius * shape.body.maxHeight) / 2;
    const rise = shape.dorsalFin.height * Math.sin(Math.PI * u);
    points.push({ base: new Vector3(x, baseY, 0), top: new Vector3(x, baseY + rise, 0) });
  }
  return points;
}

/** A single thin triangular flap per side, hanging from the belly. */
export function fishPelvicFin(shape: FishShape, side: 1 | -1): { a: Vector3; b: Vector3; c: Vector3 } {
  const at = shape.pelvicFin.at ?? DEFAULT_PELVIC_FIN_AT;
  const half = shape.body.length / 2;
  const x0 = half - shape.body.length * at;
  const radius = fishBodyRadius(at, shape);
  const width = (radius * shape.body.maxWidth) / 2;
  const height = (radius * shape.body.maxHeight) / 2;
  const angleRad = (shape.pelvicFin.angle * Math.PI) / 180;
  const a = new Vector3(x0 + shape.body.length * 0.05, 0, side * width);
  const b = new Vector3(x0 - shape.body.length * 0.05, 0, side * width);
  const c = new Vector3(
    x0 - Math.sin(angleRad) * shape.pelvicFin.length,
    -height * 0.5 - Math.cos(angleRad) * shape.pelvicFin.length * 0.3,
    side * width * 1.3,
  );
  return { a, b, c };
}

/** A `finSegments`-wedge fan per side, rooted near the head. */
export function fishPectoralFin(
  shape: FishShape,
  finSegments: number,
  side: 1 | -1,
): { root: Vector3; fan: Vector3[] } {
  const at = shape.pectoralFin.at ?? DEFAULT_PECTORAL_FIN_AT;
  const half = shape.body.length / 2;
  const x0 = half - shape.body.length * at;
  const radius = fishBodyRadius(at, shape);
  const width = (radius * shape.body.maxWidth) / 2;
  const height = (radius * shape.body.maxHeight) / 2;
  const root = new Vector3(x0, -height * 0.3, side * width);
  const angleRad = (shape.pectoralFin.angle * Math.PI) / 180;
  const segments = Math.max(2, finSegments);
  const fan: Vector3[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const u = i / segments;
    const reach = shape.pectoralFin.length * (0.15 + 0.85 * u);
    fan.push(
      new Vector3(
        x0 - Math.sin(angleRad) * reach,
        -height * 0.3 - Math.cos(angleRad) * reach * 0.5,
        side * (width + reach * 1.4),
      ),
    );
  }
  return { root, fan };
}

/** Quadratic-bezier ribbon trailing from the dorsal fin's peak point; `null` when `shape.thread` is absent. */
export function fishThread(
  shape: FishShape,
  finSegments: number,
): Array<{ top: Vector3; bottom: Vector3 }> | null {
  if (!shape.thread) return null;
  const dorsal = fishDorsalFin(shape, finSegments);
  const peak = dorsal[Math.floor((dorsal.length - 1) / 2)];
  if (!peak) return null;
  const start = peak.top;
  const control = new Vector3(
    start.x - shape.thread.length * 0.4,
    start.y + shape.thread.curvature * shape.thread.length,
    0,
  );
  const end = new Vector3(start.x - shape.thread.length, start.y, 0);
  const segments = Math.max(2, finSegments);
  const points: Array<{ top: Vector3; bottom: Vector3 }> = [];
  for (let i = 0; i <= segments; i += 1) {
    const u = i / segments;
    const oneMinusU = 1 - u;
    const x = oneMinusU * oneMinusU * start.x + 2 * oneMinusU * u * control.x + u * u * end.x;
    const y = oneMinusU * oneMinusU * start.y + 2 * oneMinusU * u * control.y + u * u * end.y;
    const halfWidth = 0.01 * (1 - u);
    points.push({ top: new Vector3(x, y + halfWidth, 0), bottom: new Vector3(x, y - halfWidth, 0) });
  }
  return points;
}

/** Low-poly octahedron approximation of a UV sphere: 6 vertices, 8 faces. */
function octahedronFaces(center: Vector3, radius: number): ReadonlyArray<readonly [Vector3, Vector3, Vector3]> {
  const px = new Vector3(center.x + radius, center.y, center.z);
  const nx = new Vector3(center.x - radius, center.y, center.z);
  const py = new Vector3(center.x, center.y + radius, center.z);
  const ny = new Vector3(center.x, center.y - radius, center.z);
  const pz = new Vector3(center.x, center.y, center.z + radius);
  const nz = new Vector3(center.x, center.y, center.z - radius);
  return [
    [px, py, pz], [py, nx, pz], [nx, ny, pz], [ny, px, pz],
    [py, px, nz], [nx, py, nz], [ny, nx, nz], [px, ny, nz],
  ];
}

/** `null` when the eye radius resolves to 0 — either explicitly, or (never, since the default is always positive) by omission. */
export function fishEyePoints(shape: FishShape): { left: Vector3; right: Vector3; radius: number } | null {
  const radius = shape.eye?.radius ?? 0.16 * shape.body.maxHeight;
  if (radius <= 0) return null;
  const t = shape.snout.length * 0.6;
  const half = shape.body.length / 2;
  const x = half - shape.body.length * t;
  const radiusFraction = fishBodyRadius(t, shape);
  const z = (radiusFraction * shape.body.maxWidth * 0.9) / 2;
  const y = (radiusFraction * shape.body.maxHeight * 0.3) / 2;
  return { left: new Vector3(x, y, -z), right: new Vector3(x, y, z), radius };
}

/** Build the faceted fish body: snout + main body + peduncle loft, tail/dorsal/pelvic/pectoral fins, optional thread, optional eyes. */
export function buildFishGeometry(
  shape: FishShape,
  palette: FishSpecies["palette"],
  detail: DetailLevel = "medium",
): BufferGeometry {
  const bodyColor = new Color(palette.body);
  const finColor = new Color(palette.fin);
  const accentColor = new Color(palette.accent);
  const eyeColor = new Color(palette.eye ?? DEFAULT_EYE_COLOR);
  const profile = FISH_DETAIL_PROFILES[detail];
  const buffers: MeshBuffers = { positions: [], colors: [] };
  const half = shape.body.length / 2;

  const s = shape.snout.length;
  const p = shape.peduncle.length;
  const snoutSegments = Math.max(2, Math.round(profile.bodySegments * 0.4));
  const peduncleSegments = Math.max(2, Math.round(profile.bodySegments * 0.4));

  const tValues: number[] = [0];
  for (let i = 1; i <= snoutSegments; i += 1) tValues.push((i / snoutSegments) * s);
  for (let i = 1; i <= profile.bodySegments; i += 1) tValues.push(s + (i / profile.bodySegments) * (1 - s - p));
  for (let i = 1; i <= peduncleSegments; i += 1) tValues.push(1 - p + (i / peduncleSegments) * p);

  const totalSegments = snoutSegments + profile.bodySegments + peduncleSegments;
  const stripeSegments = new Set<number>();
  if (shape.pattern.stripes > 0) {
    const stride = profile.bodySegments / (shape.pattern.stripes + 1);
    for (let i = 1; i <= shape.pattern.stripes; i += 1) {
      const localIndex = Math.min(profile.bodySegments - 1, Math.round(i * stride) - 1);
      stripeSegments.add(snoutSegments + localIndex);
    }
  }

  for (let seg = 0; seg < totalSegments; seg += 1) {
    const t0 = tValues[seg] as number;
    const t1 = tValues[seg + 1] as number;
    const x0 = half - shape.body.length * t0;
    const x1 = half - shape.body.length * t1;
    const r0 = fishBodyRadius(t0, shape);
    const r1 = fishBodyRadius(t1, shape);
    const color = stripeSegments.has(seg) ? accentColor : bodyColor;
    for (let side = 0; side < profile.ringSides; side += 1) {
      const a = ringVertex(x0, r0, shape, side, profile.ringSides);
      const b = ringVertex(x0, r0, shape, side + 1, profile.ringSides);
      const c = ringVertex(x1, r1, shape, side + 1, profile.ringSides);
      const d = ringVertex(x1, r1, shape, side, profile.ringSides);
      pushTriangle(buffers, a, c, b, color);
      pushTriangle(buffers, a, d, c, color);
    }
  }

  const tail = fishTailFin(shape, profile.finSegments);
  for (let i = 0; i < tail.upperFan.length - 1; i += 1) {
    pushFin(buffers, tail.root, tail.upperFan[i] as Vector3, tail.upperFan[i + 1] as Vector3, finColor);
  }
  for (let i = 0; i < tail.lowerFan.length - 1; i += 1) {
    pushFin(buffers, tail.root, tail.lowerFan[i] as Vector3, tail.lowerFan[i + 1] as Vector3, finColor);
  }

  const dorsal = fishDorsalFin(shape, profile.finSegments);
  for (let i = 0; i < dorsal.length - 1; i += 1) {
    const p0 = dorsal[i] as { base: Vector3; top: Vector3 };
    const p1 = dorsal[i + 1] as { base: Vector3; top: Vector3 };
    pushFin(buffers, p0.base, p1.base, p1.top, finColor);
    pushFin(buffers, p0.base, p1.top, p0.top, finColor);
  }

  for (const side of [1, -1] as const) {
    const pelvic = fishPelvicFin(shape, side);
    pushFin(buffers, pelvic.a, pelvic.b, pelvic.c, finColor);

    const pectoral = fishPectoralFin(shape, profile.finSegments, side);
    for (let i = 0; i < pectoral.fan.length - 1; i += 1) {
      pushFin(buffers, pectoral.root, pectoral.fan[i] as Vector3, pectoral.fan[i + 1] as Vector3, finColor);
    }
  }

  const thread = fishThread(shape, profile.finSegments);
  if (thread) {
    for (let i = 0; i < thread.length - 1; i += 1) {
      const p0 = thread[i] as { top: Vector3; bottom: Vector3 };
      const p1 = thread[i + 1] as { top: Vector3; bottom: Vector3 };
      pushFin(buffers, p0.top, p1.top, p1.bottom, finColor);
      pushFin(buffers, p0.top, p1.bottom, p0.bottom, finColor);
    }
  }

  const eyes = fishEyePoints(shape);
  if (eyes) {
    for (const center of [eyes.left, eyes.right]) {
      for (const [a, b, c] of octahedronFaces(center, eyes.radius)) {
        pushTriangle(buffers, a, b, c, eyeColor);
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(buffers.positions), 3));
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(buffers.colors), 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
```

Run: `npm --prefix web run test -- src/fish.test.ts`
Expected: the new `fishBodyRadius` tests PASS. Other tests in this file still FAIL (they haven't been updated yet — next steps).

#### Step 5: Update `creatures/geometry/index.ts` and `fish.ts`'s re-export

In `web/src/creatures/geometry/index.ts`, change:
```ts
export { buildFishGeometry, computeFacetJitter } from "./fish";
```
to:
```ts
export { buildFishGeometry } from "./fish";
```

In `web/src/fish.ts` (the top-level file with `FishSchool`), change:
```ts
export { buildFishGeometry, computeFacetJitter } from "./creatures/geometry/fish";
```
to:
```ts
export { buildFishGeometry } from "./creatures/geometry/fish";
```

#### Step 6: Update the remaining `fish.test.ts` assertions for the new shape and budget

In `web/src/fish.test.ts`:

1. In `describe("fish registry", ...)`, in the `"defines a complete, well-formed entry per species"` test, replace the `if (species.geometry === "lowpoly-fish")` branch:
```ts
if (species.geometry === "lowpoly-fish") {
  expect(species.shape.pattern.stripes).toBeGreaterThanOrEqual(0);
  expect(species.shape.body.length).toBeGreaterThan(0);
  expect(species.shape.snout.length + species.shape.peduncle.length).toBeLessThan(1);
}
```

2. In `describe("buildFishGeometry", ...)`:
   - Rename `"defaults to medium detail, matching the exact v1 baseline (AC-1)"` to `"defaults to medium detail"` — logic unchanged (compares `buildFishGeometry(shape, palette)` against an explicit `"medium"` call).
   - Replace `"stays a vertex-for-vertex regression of v1 at medium detail (no facet jitter, AC-9)"` with:
     ```ts
     it("is deterministic: same species and detail produce identical output", () => {
       for (const species of FISH_REGISTRY) {
         if (species.geometry !== "lowpoly-fish") continue;
         const a = buildFishGeometry(species.shape, species.palette, "medium");
         const b = buildFishGeometry(species.shape, species.palette, "medium");
         expect(Array.from(a.getAttribute("position").array)).toEqual(
           Array.from(b.getAttribute("position").array),
         );
         a.dispose();
         b.dispose();
       }
     });
     ```
   - Raise the low-poly ceiling: change `expect(position.count / 3).toBeLessThan(100);` to `expect(position.count / 3).toBeLessThan(750);` (comfortably above the ~660-triangle `high`-detail, no-thread real output computed for this profile table — see the spec's §4 for the target, tuned here against the concrete numbers this task's profile produces).
   - In `"paints accent stripes only for striped species"`, change `expect(clownfish.shape.stripes).toBeGreaterThan(0);` to `expect(clownfish.shape.pattern.stripes).toBeGreaterThan(0);`.
3. Delete the entire `describe("computeFacetJitter"...)` block and the entire `describe("buildFishGeometry high detail facet jitter"...)` block (already started in Step 3 — confirm both are gone).

Run: `npm --prefix web run test -- src/fish.test.ts`
Expected: PASS. If the low/medium/high ordering test or the "high ≈2.3-2.7x medium" ratio test fail, do not change their bounds — re-check the `FISH_DETAIL_PROFILES` numbers from Step 1 against the shape values from Step 2 (a transcription slip is more likely than the design being wrong; the design's own arithmetic, redone against this exact code, gives medium ≈ 260 triangles and high ≈ 660 for a species without `stripes`/`thread`, a ratio of ≈2.54 — inside 2.3–2.7).

#### Step 7: Run the full test suite and type check, then commit

Run: `npm --prefix web run test`
Expected: PASS (all suites, including `environment.test.ts` and any others untouched by this task).

Run: `npm --prefix web run build`
Expected: PASS with zero `tsc` errors and a successful `vite build`.

```bash
git add web/src/config.ts web/src/creatures/geometry/fish.ts web/src/creatures/geometry/index.ts web/src/fish.ts web/src/fish.test.ts
git commit -m "feat: rewrite lowpoly-fish geometry as a parametrized grammar

Replaces the single hardcoded body-shape formula with snout/body/peduncle
zones, a fan tail/pectoral, a ridge dorsal fin, a new pelvic fin, an
optional bezier thread, and low-poly eyes. Drops facet jitter entirely.
Species are still inline TS literals; YAML loading is the next task."
```

---

### Task 2: Move species definitions to YAML, namespaced by creature kind

**Files:**
- Create: `web/species/fish/01-clownfish.yaml`
- Create: `web/species/fish/02-blue-sea-bream.yaml`
- Create: `web/species/fish/03-yellow-tang.yaml`
- Create: `web/species/fish/04-butterflyfish.yaml`
- Create: `web/species/fish/05-purple-tang.yaml`
- Create: `web/species/fish/06-pink-cardinalfish.yaml`
- Create: `web/src/creatures/species/fish.ts`
- Create: `web/src/creatures/species/fish.test.ts`
- Create: `web/src/creatures/species/index.ts`
- Modify: `web/src/config.ts`
- Modify: `web/package.json` (via `npm install`, not a manual edit)

**Interfaces:**
- Consumes: `FishShape` and its sub-interfaces, `FishSpecies`, `DetailLevel` from `config.ts` (Task 1) — type-only imports.
- Produces: `parseFishSpeciesYaml(raw: string, filename: string): FishSpecies` and `loadFishSpeciesFromYaml(): readonly FishSpecies[]`, re-exported from `web/src/creatures/species/index.ts`. `config.ts`'s `FISH_REGISTRY` consumes `loadFishSpeciesFromYaml()`.

#### Step 1: Add the `yaml` dependency

Run: `cd web && npm install yaml && cd ..`
Expected: `web/package.json`'s `dependencies` gains a `"yaml"` entry (a runtime dependency — `creatures/species/fish.ts` ships in the production bundle), and `web/package-lock.json` updates.

#### Step 2: Write the 6 species YAML files

Create `web/species/fish/01-clownfish.yaml`:
```yaml
id: clownfish
label: 클라운피시
description: "주황빛 몸에 하얀 줄무늬가 있는 작은 물고기예요. 무리를 지어 산호 밭 주변을 얌전히 맴돌아요."
palette:
  body: "#f2761b"
  fin: "#c84a09"
  accent: "#fff3e0"
behavior:
  speed: 1.15
  locomotion: swim
  schooling: true
  activityRadius: 7.5
  depthPreference: 0.3
  maxTurnRate: 4.5
  rhythmAmplitude: 0.15
  rhythmFrequency: 0.5
count: 20
shape:
  snout: { length: 0.16, taper: 0.8, tipRadius: 0.09 }
  body: { length: 0.62, maxHeight: 0.34, maxWidth: 0.16, peak: 0.42, taper: 1.1, shoulderRadius: 0.82 }
  peduncle: { length: 0.16, taper: 1.6, width: 0.13 }
  tailFin: { height: 0.27, length: 0.27, notch: 0.3 }
  dorsalFin: { start: 0.28, end: 0.74, height: 0.14 }
  pelvicFin: { length: 0.1, angle: 45, at: 0.56 }
  pectoralFin: { length: 0.13, angle: 30, at: 0.26 }
  eye: { radius: 0.06 }
  pattern: { stripes: 3 }
```

Create `web/species/fish/02-blue-sea-bream.yaml`:
```yaml
id: blue-sea-bream
label: 파랑참돔
description: "푸른빛이 도는 매끈한 몸을 가진 물고기예요. 무리를 지어 넓은 수역을 여유롭게 오가요."
palette:
  body: "#2f7fd1"
  fin: "#1b4f87"
  accent: "#bfe3ff"
behavior:
  speed: 0.95
  locomotion: swim
  schooling: true
  activityRadius: 10.5
  depthPreference: 0.55
  maxTurnRate: 3.2
  rhythmAmplitude: 0.15
  rhythmFrequency: 0.5
count: 12
shape:
  snout: { length: 0.14, taper: 0.9, tipRadius: 0.08 }
  body: { length: 0.86, maxHeight: 0.46, maxWidth: 0.2, peak: 0.4, taper: 1.0, shoulderRadius: 0.85 }
  peduncle: { length: 0.15, taper: 1.7, width: 0.12 }
  tailFin: { height: 0.36, length: 0.36, notch: 0.4 }
  dorsalFin: { start: 0.3, end: 0.8, height: 0.16 }
  pelvicFin: { length: 0.13, angle: 42, at: 0.55 }
  pectoralFin: { length: 0.16, angle: 28, at: 0.25 }
  eye: { radius: 0.055 }
  pattern: { stripes: 0 }
```

Create `web/species/fish/03-yellow-tang.yaml`:
```yaml
id: yellow-tang
label: 노란열대어
description: "샛노란 몸빛이 눈에 띄는 납작한 물고기예요. 한 산호 근처를 정해두고 그 주변을 잘 벗어나지 않아요."
palette:
  body: "#f5c11d"
  fin: "#d19206"
  accent: "#fff8d0"
behavior:
  speed: 0.7
  locomotion: swim
  schooling: false
  activityRadius: 9
  depthPreference: 0.5
  maxTurnRate: 3.2
  rhythmAmplitude: 0.25
  rhythmFrequency: 0.35
  territoryStrength: 0.35
count: 8
shape:
  snout: { length: 0.13, taper: 0.75, tipRadius: 0.07 }
  body: { length: 0.5, maxHeight: 0.44, maxWidth: 0.13, peak: 0.46, taper: 1.3, shoulderRadius: 0.8 }
  peduncle: { length: 0.15, taper: 1.8, width: 0.11 }
  tailFin: { height: 0.23, length: 0.24, notch: 0.25 }
  dorsalFin: { start: 0.24, end: 0.82, height: 0.2 }
  pelvicFin: { length: 0.1, angle: 48, at: 0.58 }
  pectoralFin: { length: 0.12, angle: 32, at: 0.26 }
  eye: { radius: 0.06 }
  pattern: { stripes: 0 }
```

Create `web/species/fish/04-butterflyfish.yaml`:
```yaml
id: butterflyfish
label: 나비치
description: "원반 모양 몸에 눈 주위로 짙은 띠무늬가 있는 물고기예요. 혼자 산호 곁을 서성이며 지내요."
palette:
  body: "#f2d531"
  fin: "#4a5560"
  accent: "#20272c"
behavior:
  speed: 0.85
  locomotion: swim
  schooling: false
  activityRadius: 7
  depthPreference: 0.45
  maxTurnRate: 3.2
  rhythmAmplitude: 0.25
  rhythmFrequency: 0.35
  territoryStrength: 0.4
count: 6
shape:
  snout: { length: 0.12, taper: 0.6, tipRadius: 0.06 }
  body: { length: 0.46, maxHeight: 0.6, maxWidth: 0.12, peak: 0.48, taper: 1.4, shoulderRadius: 0.78 }
  peduncle: { length: 0.14, taper: 1.9, width: 0.1 }
  tailFin: { height: 0.22, length: 0.2, notch: 0.2 }
  dorsalFin: { start: 0.22, end: 0.86, height: 0.24 }
  pelvicFin: { length: 0.09, angle: 50, at: 0.6 }
  pectoralFin: { length: 0.11, angle: 34, at: 0.24 }
  eye: { radius: 0.055 }
  pattern: { stripes: 1 }
```

Create `web/species/fish/05-purple-tang.yaml`:
```yaml
id: purple-tang
label: 보라탱
description: "보라색 몸에 샛노란 지느러미가 대비되는 물고기예요. 자기 구역의 산호를 좀처럼 벗어나지 않아요."
palette:
  body: "#5b4fd6"
  fin: "#f5c11d"
  accent: "#cfe6ff"
behavior:
  speed: 0.8
  locomotion: swim
  schooling: false
  activityRadius: 8.5
  depthPreference: 0.5
  maxTurnRate: 3.2
  rhythmAmplitude: 0.25
  rhythmFrequency: 0.35
  territoryStrength: 0.3
count: 3
shape:
  snout: { length: 0.14, taper: 0.85, tipRadius: 0.08 }
  body: { length: 0.7, maxHeight: 0.52, maxWidth: 0.18, peak: 0.44, taper: 1.15, shoulderRadius: 0.82 }
  peduncle: { length: 0.15, taper: 1.7, width: 0.12 }
  tailFin: { height: 0.3, length: 0.3, notch: 0.32 }
  dorsalFin: { start: 0.28, end: 0.8, height: 0.19 }
  pelvicFin: { length: 0.12, angle: 44, at: 0.56 }
  pectoralFin: { length: 0.15, angle: 30, at: 0.26 }
  eye: { radius: 0.058 }
  pattern: { stripes: 0 }
```

Create `web/species/fish/06-pink-cardinalfish.yaml`:
```yaml
id: pink-cardinalfish
label: 자주열대어
description: "자줏빛이 도는 아주 작은 물고기예요. 촘촘한 무리를 이루어 빠르게 움직여요."
palette:
  body: "#e8557f"
  fin: "#b23a5e"
  accent: "#ffd3e0"
behavior:
  speed: 1.3
  locomotion: swim
  schooling: true
  activityRadius: 6
  depthPreference: 0.4
  maxTurnRate: 4.5
  rhythmAmplitude: 0.15
  rhythmFrequency: 0.5
count: 5
shape:
  snout: { length: 0.18, taper: 0.7, tipRadius: 0.06 }
  body: { length: 0.34, maxHeight: 0.2, maxWidth: 0.11, peak: 0.4, taper: 1.0, shoulderRadius: 0.84 }
  peduncle: { length: 0.17, taper: 1.5, width: 0.09 }
  tailFin: { height: 0.16, length: 0.16, notch: 0.3 }
  dorsalFin: { start: 0.3, end: 0.7, height: 0.1 }
  pelvicFin: { length: 0.07, angle: 40, at: 0.55 }
  pectoralFin: { length: 0.09, angle: 28, at: 0.26 }
  eye: { radius: 0.04 }
  pattern: { stripes: 0 }
```

#### Step 3: Write failing tests for the YAML parser/loader

Create `web/src/creatures/species/fish.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { loadFishSpeciesFromYaml, parseFishSpeciesYaml } from "./fish";

const VALID_YAML = `
id: test-fish
label: 테스트 물고기
description: "테스트용 물고기예요."
palette:
  body: "#112233"
  fin: "#445566"
  accent: "#778899"
behavior:
  speed: 1
  locomotion: swim
  schooling: true
  activityRadius: 5
count: 4
shape:
  snout: { length: 0.15, taper: 0.8 }
  body: { length: 0.5, maxHeight: 0.3, maxWidth: 0.15, peak: 0.4, taper: 1.1 }
  peduncle: { length: 0.15, taper: 1.6 }
  tailFin: { height: 0.2, length: 0.2, notch: 0.3 }
  dorsalFin: { start: 0.2, end: 0.7, height: 0.15 }
  pelvicFin: { length: 0.1, angle: 40 }
  pectoralFin: { length: 0.12, angle: 30 }
  pattern: { stripes: 0 }
`;

describe("parseFishSpeciesYaml", () => {
  it("parses a well-formed file into a FishSpecies with all required fields", () => {
    const species = parseFishSpeciesYaml(VALID_YAML, "01-test-fish.yaml");
    expect(species.id).toBe("test-fish");
    expect(species.label).toBe("테스트 물고기");
    expect(species.geometry).toBe("lowpoly-fish");
    expect(species.count).toBe(4);
    expect(species.shape.body.length).toBe(0.5);
    expect(species.shape.length).toBe(0.5);
    expect(species.shape.thread).toBeUndefined();
    expect(species.shape.eye).toBeUndefined();
  });

  it("derives the top-level shape.length from shape.body.length", () => {
    const species = parseFishSpeciesYaml(VALID_YAML, "01-test-fish.yaml");
    expect(species.shape.length).toBe(species.shape.body.length);
  });

  it("carries optional palette.eye through when present", () => {
    const withEye = VALID_YAML.replace('accent: "#778899"', 'accent: "#778899"\n  eye: "#000000"');
    const species = parseFishSpeciesYaml(withEye, "01-test-fish.yaml");
    expect(species.palette.eye).toBe("#000000");
  });

  it("carries the optional thread group through when present", () => {
    const withThread = `${VALID_YAML}\n  thread: { length: 0.3, curvature: 0.2 }\n`;
    const species = parseFishSpeciesYaml(withThread, "01-test-fish.yaml");
    expect(species.shape.thread).toEqual({ length: 0.3, curvature: 0.2 });
  });

  it("throws naming the file when a required field is missing", () => {
    const broken = VALID_YAML.replace("count: 4", "");
    expect(() => parseFishSpeciesYaml(broken, "01-test-fish.yaml")).toThrow(/01-test-fish\.yaml/);
  });

  it("throws when snout.length + peduncle.length is >= 1", () => {
    const broken = VALID_YAML.replace("length: 0.15, taper: 0.8", "length: 0.6, taper: 0.8").replace(
      "peduncle: { length: 0.15",
      "peduncle: { length: 0.5",
    );
    expect(() => parseFishSpeciesYaml(broken, "01-test-fish.yaml")).toThrow(/snout\.length.*peduncle\.length/);
  });

  it("throws when id does not match the filename slug", () => {
    expect(() => parseFishSpeciesYaml(VALID_YAML, "02-different-name.yaml")).toThrow(/does not match/);
  });

  it("throws when a numeric field is non-finite", () => {
    const broken = VALID_YAML.replace("speed: 1", "speed: .nan");
    expect(() => parseFishSpeciesYaml(broken, "01-test-fish.yaml")).toThrow(/01-test-fish\.yaml/);
  });
});

describe("loadFishSpeciesFromYaml", () => {
  it("loads all 6 real species files from web/species/fish in filename order", () => {
    const species = loadFishSpeciesFromYaml();
    expect(species.map((s) => s.id)).toEqual([
      "clownfish",
      "blue-sea-bream",
      "yellow-tang",
      "butterflyfish",
      "purple-tang",
      "pink-cardinalfish",
    ]);
  });
});
```

Run: `npm --prefix web run test -- src/creatures/species/fish.test.ts`
Expected: FAIL — `./fish` (i.e. `web/src/creatures/species/fish.ts`) does not exist yet.

#### Step 4: Implement `creatures/species/fish.ts`

Create `web/src/creatures/species/fish.ts`:

```ts
import { parse } from "yaml";

import type {
  DetailLevel,
  FishBodyShape,
  FishDorsalFinShape,
  FishPeduncleShape,
  FishPectoralFinShape,
  FishPelvicFinShape,
  FishShape,
  FishSnoutShape,
  FishSpecies,
  FishTailFinShape,
} from "../../config";

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

function requireBoolean(value: unknown, field: string, filename: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${filename}: "${field}" must be a boolean, got ${JSON.stringify(value)}`);
  return value;
}

function requireLocomotion(value: unknown, field: string, filename: string): "swim" | "hover" {
  if (value !== "swim" && value !== "hover") {
    throw new Error(`${filename}: "${field}" must be "swim" or "hover", got ${JSON.stringify(value)}`);
  }
  return value;
}

function withOptionalNumber<K extends string>(
  raw: Record<string, unknown>,
  key: K,
  filename: string,
  label: string,
): Partial<Record<K, number>> {
  if (raw[key] === undefined) return {};
  return { [key]: requireNumber(raw[key], label, filename) } as Partial<Record<K, number>>;
}

function slugFromFilename(filename: string): string {
  const base = filename.split("/").pop() ?? filename;
  const withoutExt = base.replace(/\.ya?ml$/i, "");
  return withoutExt.replace(/^\d+-/, "");
}

function parseBehavior(raw: Record<string, unknown>, filename: string): FishSpecies["behavior"] {
  const speed = requirePositiveNumber(raw.speed, "behavior.speed", filename);
  const locomotion = requireLocomotion(raw.locomotion, "behavior.locomotion", filename);
  const schooling = requireBoolean(raw.schooling, "behavior.schooling", filename);
  const activityRadius = requirePositiveNumber(raw.activityRadius, "behavior.activityRadius", filename);
  return {
    speed,
    locomotion,
    schooling,
    activityRadius,
    ...withOptionalNumber(raw, "hoverAmplitude", filename, "behavior.hoverAmplitude"),
    ...withOptionalNumber(raw, "hoverFrequency", filename, "behavior.hoverFrequency"),
    ...withOptionalNumber(raw, "depthPreference", filename, "behavior.depthPreference"),
    ...withOptionalNumber(raw, "maxTurnRate", filename, "behavior.maxTurnRate"),
    ...withOptionalNumber(raw, "rhythmAmplitude", filename, "behavior.rhythmAmplitude"),
    ...withOptionalNumber(raw, "rhythmFrequency", filename, "behavior.rhythmFrequency"),
    ...withOptionalNumber(raw, "territoryStrength", filename, "behavior.territoryStrength"),
  };
}

function parseSnout(raw: Record<string, unknown>, filename: string): FishSnoutShape {
  return {
    length: requirePositiveNumber(raw.length, "shape.snout.length", filename),
    taper: requirePositiveNumber(raw.taper, "shape.snout.taper", filename),
    ...withOptionalNumber(raw, "tipRadius", filename, "shape.snout.tipRadius"),
  };
}

function parseBody(raw: Record<string, unknown>, filename: string): FishBodyShape {
  const peak = requirePositiveNumber(raw.peak, "shape.body.peak", filename);
  if (peak >= 1) throw new Error(`${filename}: "shape.body.peak" must be < 1, got ${peak}`);
  return {
    length: requirePositiveNumber(raw.length, "shape.body.length", filename),
    maxHeight: requirePositiveNumber(raw.maxHeight, "shape.body.maxHeight", filename),
    maxWidth: requirePositiveNumber(raw.maxWidth, "shape.body.maxWidth", filename),
    peak,
    taper: requirePositiveNumber(raw.taper, "shape.body.taper", filename),
    ...withOptionalNumber(raw, "shoulderRadius", filename, "shape.body.shoulderRadius"),
  };
}

function parsePeduncle(raw: Record<string, unknown>, filename: string): FishPeduncleShape {
  return {
    length: requirePositiveNumber(raw.length, "shape.peduncle.length", filename),
    taper: requirePositiveNumber(raw.taper, "shape.peduncle.taper", filename),
    ...withOptionalNumber(raw, "width", filename, "shape.peduncle.width"),
  };
}

function parseTailFin(raw: Record<string, unknown>, filename: string): FishTailFinShape {
  const notch = requirePositiveNumber(raw.notch, "shape.tailFin.notch", filename);
  if (notch >= 1) throw new Error(`${filename}: "shape.tailFin.notch" must be < 1, got ${notch}`);
  return {
    height: requirePositiveNumber(raw.height, "shape.tailFin.height", filename),
    length: requirePositiveNumber(raw.length, "shape.tailFin.length", filename),
    notch,
  };
}

function parseDorsalFin(raw: Record<string, unknown>, filename: string): FishDorsalFinShape {
  const start = requireNumber(raw.start, "shape.dorsalFin.start", filename);
  const end = requireNumber(raw.end, "shape.dorsalFin.end", filename);
  if (start < 0 || end > 1 || end <= start) {
    throw new Error(
      `${filename}: "shape.dorsalFin.start"/"end" must satisfy 0 <= start < end <= 1, got start=${start}, end=${end}`,
    );
  }
  return { start, end, height: requirePositiveNumber(raw.height, "shape.dorsalFin.height", filename) };
}

function parsePelvicFin(raw: Record<string, unknown>, filename: string): FishPelvicFinShape {
  return {
    length: requirePositiveNumber(raw.length, "shape.pelvicFin.length", filename),
    angle: requireNumber(raw.angle, "shape.pelvicFin.angle", filename),
    ...withOptionalNumber(raw, "at", filename, "shape.pelvicFin.at"),
  };
}

function parsePectoralFin(raw: Record<string, unknown>, filename: string): FishPectoralFinShape {
  return {
    length: requirePositiveNumber(raw.length, "shape.pectoralFin.length", filename),
    angle: requireNumber(raw.angle, "shape.pectoralFin.angle", filename),
    ...withOptionalNumber(raw, "at", filename, "shape.pectoralFin.at"),
  };
}

function parseShape(raw: Record<string, unknown>, filename: string): FishShape {
  const snout = parseSnout(requireObject(raw.snout, "shape.snout", filename), filename);
  const body = parseBody(requireObject(raw.body, "shape.body", filename), filename);
  const peduncle = parsePeduncle(requireObject(raw.peduncle, "shape.peduncle", filename), filename);

  if (snout.length + peduncle.length >= 1) {
    throw new Error(
      `${filename}: "shape.snout.length" + "shape.peduncle.length" must be < 1, got ${snout.length + peduncle.length}`,
    );
  }

  const tailFin = parseTailFin(requireObject(raw.tailFin, "shape.tailFin", filename), filename);
  const dorsalFin = parseDorsalFin(requireObject(raw.dorsalFin, "shape.dorsalFin", filename), filename);
  const pelvicFin = parsePelvicFin(requireObject(raw.pelvicFin, "shape.pelvicFin", filename), filename);
  const pectoralFin = parsePectoralFin(requireObject(raw.pectoralFin, "shape.pectoralFin", filename), filename);

  const patternRaw = requireObject(raw.pattern, "shape.pattern", filename);
  const stripes = requireNumber(patternRaw.stripes, "shape.pattern.stripes", filename);
  if (stripes < 0) throw new Error(`${filename}: "shape.pattern.stripes" must be >= 0, got ${stripes}`);

  const thread =
    raw.thread === undefined
      ? undefined
      : (() => {
          const threadRaw = requireObject(raw.thread, "shape.thread", filename);
          return {
            length: requirePositiveNumber(threadRaw.length, "shape.thread.length", filename),
            curvature: requireNumber(threadRaw.curvature, "shape.thread.curvature", filename),
          };
        })();

  const eye =
    raw.eye === undefined
      ? undefined
      : (() => {
          const eyeRaw = requireObject(raw.eye, "shape.eye", filename);
          return { ...withOptionalNumber(eyeRaw, "radius", filename, "shape.eye.radius") };
        })();

  return {
    length: body.length,
    snout,
    body,
    peduncle,
    tailFin,
    dorsalFin,
    pelvicFin,
    pectoralFin,
    pattern: { stripes },
    ...(thread === undefined ? {} : { thread }),
    ...(eye === undefined ? {} : { eye }),
  };
}

/** Parses and validates one species YAML file's raw text. Throws `Error` naming `filename` on any missing/invalid field. */
export function parseFishSpeciesYaml(raw: string, filename: string): FishSpecies {
  const doc: unknown = parse(raw);
  const root = requireObject(doc, "<root>", filename);

  const id = requireString(root.id, "id", filename);
  const expectedSlug = slugFromFilename(filename);
  if (id !== expectedSlug) {
    throw new Error(`${filename}: "id" ("${id}") does not match the filename slug ("${expectedSlug}")`);
  }

  const label = requireString(root.label, "label", filename);
  const description = requireString(root.description, "description", filename);
  const count = requirePositiveNumber(root.count, "count", filename);

  const paletteRaw = requireObject(root.palette, "palette", filename);
  const palette = {
    body: requireString(paletteRaw.body, "palette.body", filename),
    fin: requireString(paletteRaw.fin, "palette.fin", filename),
    accent: requireString(paletteRaw.accent, "palette.accent", filename),
    ...(paletteRaw.eye === undefined ? {} : { eye: requireString(paletteRaw.eye, "palette.eye", filename) }),
  };

  const behavior = parseBehavior(requireObject(root.behavior, "behavior", filename), filename);
  const shape = parseShape(requireObject(root.shape, "shape", filename), filename);

  return { id, label, description, geometry: "lowpoly-fish", palette, behavior, count, shape };
}

const rawFiles = import.meta.glob("/species/fish/*.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Eager-loads every `web/species/fish/*.yaml` file, sorted by path so numbered filenames control registry order. */
export function loadFishSpeciesFromYaml(): readonly FishSpecies[] {
  return Object.keys(rawFiles)
    .sort()
    .map((path) => {
      const filename = path.split("/").pop() ?? path;
      return parseFishSpeciesYaml(rawFiles[path] as string, filename);
    });
}
```

A quick self-check while writing this: `DetailLevel` is imported but unused directly in this file — remove it from the `import type` list (this project's `tsconfig.json` has `noUnusedLocals: true`, which fails the build on an unused import).

Run: `npm --prefix web run test -- src/creatures/species/fish.test.ts`
Expected: PASS.

#### Step 5: Add the `creatures/species` barrel

Create `web/src/creatures/species/index.ts`:
```ts
export { loadFishSpeciesFromYaml, parseFishSpeciesYaml } from "./fish";
```

#### Step 6: Wire `FISH_REGISTRY` to load from YAML

In `web/src/config.ts`:
1. Add near the top (after the other imports): `import { loadFishSpeciesFromYaml } from "./creatures/species/fish";`
2. Delete the 6 `lowpoly-fish` object literals from `FISH_REGISTRY` (`clownfish` through `pink-cardinalfish`), keeping `great-white-shark`, `seahorse`, `green-sea-turtle` as-is.
3. Change the `FISH_REGISTRY` declaration to:
   ```ts
   export const FISH_REGISTRY: readonly FishSpecies[] = [
     ...loadFishSpeciesFromYaml(),
     GREAT_WHITE_SHARK,
     SEAHORSE,
     GREEN_SEA_TURTLE,
   ];
   ```
   This requires first extracting the existing `great-white-shark`/`seahorse`/`green-sea-turtle` object literals out of the `FISH_REGISTRY` array literal into their own named `const` declarations (`GREAT_WHITE_SHARK`, `SEAHORSE`, `GREEN_SEA_TURTLE`, each typed `: FishSpecies`) placed just above `FISH_REGISTRY`, since they're referenced by name in the array now instead of being written inline.

Run: `npm --prefix web run test`
Expected: PASS — in particular, re-verify (without editing) the two pre-existing `fish.test.ts` tests `"starts with the three initial species from SPEC F3"` and `"extends the registry with the reference-art species"` still pass unchanged, since the YAML filenames (`01-clownfish.yaml` … `06-pink-cardinalfish.yaml`) preserve the exact old id/label order.

Run: `npm --prefix web run build`
Expected: PASS with zero `tsc` errors.

#### Step 7: Manual visual verification

Run: `npm --prefix web run build && npm --prefix web run preview`, open the printed local URL in a browser.

Check:
- All 9 species are present and swimming/hovering as before (no missing species, no console errors).
- Each of the 6 migrated fish species reads as its intended silhouette/color family: clownfish (orange, 3 white stripes), blue-sea-bream (blue, streamlined), yellow-tang (yellow, flat oval), butterflyfish (disc-shaped, dark band), purple-tang (violet body, yellow fins), pink-cardinalfish (small, pink, fast schooling).
- Fish now visibly have eyes and a richer fin silhouette (fan tail, ridged dorsal fin, a pelvic fin pair) compared to before.
- No fish geometry appears inverted, degenerate, or wildly stretched (a sign of a shape-parameter mistake, e.g. a `peak`/`start`/`end` inversion).
- Open the browser devtools console and evaluate `window.__aq` — confirm `calls` stays under 30 and `triangles` stays comfortably under 300,000.

If anything looks wrong, fix the specific YAML values (Step 2) or the geometry formula (Task 1, Step 4) — do not loosen a test bound to paper over a visual bug.

#### Step 8: Commit

```bash
git add web/species web/src/creatures/species web/src/config.ts web/package.json web/package-lock.json
git commit -m "feat: load lowpoly-fish species from YAML, namespaced by creature kind

Species now live at web/species/fish/*.yaml, parsed and validated by
web/src/creatures/species/fish.ts — mirroring the existing
creatures/geometry/<kind>.ts pattern so shark/seahorse/turtle can adopt
the same shape later. FISH_REGISTRY's 6 lowpoly-fish entries are no
longer inline TypeScript literals."
```

---

## Self-Review Notes

- **Spec coverage:** §1 (architecture/namespacing) → Task 2 Steps 4–6. §2 (YAML schema) → Task 2 Step 2. §3 (all 10 anatomical pieces incl. eye/pattern) → Task 1 Step 4. §4 (detail levels, no jitter, triangle budget) → Task 1 Steps 1 & 6. §5 (migration mapping) → Task 1 Step 2 / Task 2 Step 2 (same values, two locations). §6 (testing plan) → Task 1 Steps 3 & 6, Task 2 Steps 3 & 6. §7 (files touched) → matches this plan's Files lists.
- **Type consistency:** `fishBodyRadius(t, shape)`, `fishTailFin(shape, finSegments)`, `fishDorsalFin(shape, finSegments)`, `fishPelvicFin(shape, side)`, `fishPectoralFin(shape, finSegments, side)`, `fishThread(shape, finSegments)`, `fishEyePoints(shape)`, `buildFishGeometry(shape, palette, detail?)` are named and typed identically between Task 1's implementation step and its own test step, and referenced with the same names in Task 2's YAML-loader tests (`parseFishSpeciesYaml`, `loadFishSpeciesFromYaml`) with no drift.
- **No placeholders:** every step above has literal code or an exact command; nothing says "add validation" or "similar to above" without showing the actual code.
