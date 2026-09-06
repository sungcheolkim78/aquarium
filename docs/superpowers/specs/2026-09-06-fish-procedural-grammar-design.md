# Fish Procedural Grammar Design

**Source:** `docs/create_geometry_generator.md` (Blender/Python-flavored brainstorm on procedural reef-fish geometry)

**Goal:** Replace the single hardcoded body-shape formula in `buildFishGeometry` (`web/src/creatures/geometry/fish.ts`) with a much richer, fully parametrized "Fish Procedural Grammar" so that adding a visually distinct reef-fish species is a matter of writing one YAML file, not touching geometry code. Explicitly trade more triangles for more expressiveness — this redesign is allowed to double-or-more the current per-fish triangle count and to look different from the current 6 species' renders.

**Non-goals:**
- The automated 5-camera-view / 도감 rendering pipeline described at the end of `create_geometry_generator.md` — out of scope for this change.
- `lowpoly-shark` / `lowpoly-seahorse` / `lowpoly-turtle` geometry and their `SharkShape`/`SeahorseShape`/`TurtleShape` types — untouched. This grammar is for the `lowpoly-fish` geometry id only.
- Runtime YAML fetching — species files are read at build/dev time only (static, backend-free site).
- Byte-for-byte visual parity with the current 6 species. Migrated species should look *recognizably similar* (same palette, same rough silhouette family) but exact vertex positions are expected to change.

## 1. Architecture

```
web/species/*.yaml            -- one file per lowpoly-fish species
        |
        v  import.meta.glob('/species/*.yaml', { query: '?raw', import: 'default', eager: true })
web/src/species-loader.ts     -- parses (yaml pkg) + validates -> FishSpecies[], filename order
        |
        v
web/src/config.ts             -- FISH_REGISTRY = [...FISH_SPECIES_FROM_YAML, sharkSpecies, seahorseSpecies, turtleSpecies]
```

- New directory `web/species/`, one YAML file per species, numbered so glob order (which Vite returns sorted by path) matches the existing registry order: `01-clownfish.yaml`, `02-blue-sea-bream.yaml`, `03-yellow-tang.yaml`, `04-butterflyfish.yaml`, `05-purple-tang.yaml`, `06-pink-cardinalfish.yaml`.
- New module `web/src/species-loader.ts`:
  ```ts
  export function parseSpeciesYaml(raw: string, filename: string): FishSpecies; // throws Error("<filename>: <reason>") on any missing/invalid field
  export const FISH_SPECIES_FROM_YAML: readonly FishSpecies[]; // eager-loaded at module init, filename order
  ```
  A malformed file throws at module-init time, which fails `npm run dev`/`npm run build` immediately (a build-time boundary check — no runtime fallback for a state that can't reach production).
- `config.ts`'s `FISH_REGISTRY` becomes the loader's output concatenated with the existing hardcoded `great-white-shark`, `seahorse`, `green-sea-turtle` entries, in that order — preserving today's exact registry order (and thus most `fish.test.ts` ordering assertions untouched).
- New runtime dependency: `yaml` (added to `web/package.json` under `dependencies`, since `species-loader.ts` ships in the production bundle).

## 2. Species YAML schema

```yaml
id: clownfish
label: 클라운피시
description: "주황빛 몸에 하얀 줄무늬가 있는 작은 물고기예요. 무리를 지어 산호 밭 주변을 얌전히 맴돌아요."
palette:
  body: "#f2761b"
  fin: "#c84a09"
  accent: "#fff3e0"
  eye: "#141414"        # optional, defaults to a fixed dark constant shared by every species
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
  snout:       { length: 0.16, taper: 0.7, tipRadius: 0.08 }        # tipRadius optional
  body:        { length: 0.62, maxHeight: 0.34, maxWidth: 0.16, peak: 0.45, taper: 1.1, shoulderRadius: 0.82 }
  peduncle:    { length: 0.14, taper: 1.6, width: 0.12 }             # taper/width optional
  tailFin:     { height: 0.27, length: 0.3, notch: 0.35 }
  dorsalFin:   { start: 0.32, end: 0.78, height: 0.18 }
  pelvicFin:   { length: 0.12, angle: 40, at: 0.55 }                 # at optional
  pectoralFin: { length: 0.16, angle: 30, at: 0.28 }                 # at optional
  thread:      { length: 0.32, curvature: 0.3 }                      # entire group optional — omit for no thread
  eye:         { radius: 0.05 }                                      # optional; omit -> default radius; radius 0 -> no eye geometry
  pattern:     { stripes: 3 }
```

`behavior`, `palette` (minus the new optional `eye`), `count`, `id`, `label`, `description` are unchanged from today's `CreatureDefinition`/`FishSpecies` fields — only `shape` is redesigned. `species-loader.ts` validates: all required numeric fields present and finite, `snout.length + peduncle.length < 1`, `count`/`length`/etc. `> 0`, `id` non-empty and matches the filename's species slug (sanity check against typos).

**Segment/tessellation counts are *not* authored per species.** Detail (low/medium/high) stays a global, user-controlled axis independent of species identity — see §4.

## 3. Geometry construction (`creatures/geometry/fish.ts`)

Following the existing `shark.ts`/`seahorse.ts` convention, each anatomical piece is a small named pure function, unit-tested independently, then assembled by `buildFishGeometry`.

### 3.1 Body: snout + main body + peduncle (몸통/주둥이/꼬리자루)

One continuous, C0-continuous radius profile `fishBodyRadius(t, shape)` for `t ∈ [0,1]` (0 = nose tip, 1 = tail-fin root — same axis convention as today), built from three zones so each can be shaped independently instead of one fixed curve for the whole body:

- **Snout zone** `t ∈ [0, s]` where `s = shape.snout.length`: rises from `snout.tipRadius` (default 0.08) up to the main zone's own start radius (`shoulderRadius`, default 0.82), via exponent `snout.taper` — a sharp beak (butterflyfish) vs. a blunt round nose is just a different exponent.
- **Main body zone** `t ∈ [s, 1-p]` where `p = shape.peduncle.length`: an elliptical bump from `shoulderRadius` up to `1.0` at the zone-relative position `body.peak` and back down to `shoulderRadius`, exponent `body.taper`. `peak` need not be centered — it can sit anywhere in the zone, so the widest point of the body can be forward (near the head) or aft (near the tail).
- **Peduncle zone** `t ∈ [1-p, 1]`: falls from `shoulderRadius` down to `peduncle.width` (default 0.12) via exponent `peduncle.taper` (default 1.6, steeper than the body's own taper by default — a "narrowing spline" that pinches faster than the main body's curve).

All three zones agree exactly at `shoulderRadius` at their shared boundaries, so the profile is continuous with no formula stitching artifacts. `radius(t)` is then scaled into world space exactly as today: `height = radius(t) * body.maxHeight/2`, `width = radius(t) * body.maxWidth/2`, fed into the same elliptical `ringVertex` construction. Splitting the loft into three zones (rather than one continuous sweep) means each zone gets its own ring allocation — see §4 — which is most of where the triangle-count increase comes from.

### 3.2 Tail fin — symmetric parametric fan (꼬리지느러미)

`fishTailFin(shape, finSegments)` returns `{ root, upperFan: Vector3[], notch, lowerFan: Vector3[] }`:
- `root` = point at the peduncle end (`x = half - body.length`, radius = `peduncle.width`).
- `notch` = a point pulled toward `root` by `tailFin.notch` (0..1) fraction of `tailFin.length`, sitting on the body's centerline — this is what forks/concaves the trailing edge instead of a flat wedge.
- `upperFan`/`lowerFan` = `finSegments` points each, fanning out from `root` between `notch` and the lobe tip (`x = root.x - tailFin.length`, `y = ±tailFin.height`), so each lobe triangulates into `finSegments` wedges against `root` (a curved-looking fin edge) instead of today's single flat triangle per lobe.

### 3.3 Dorsal fin — spline ridge (등지느러미)

`fishDorsalFin(shape, finSegments)` walks `finSegments` steps of `t` from `dorsalFin.start` to `dorsalFin.end`, and at each step emits a `{base, top}` pair: `base` sits on the body surface (`y = height(t)/2`), `top` is elevated by `dorsalFin.height * bump(u)` where `bump` is the same 0-at-ends/1-at-middle curve used for the body peak (so the ridge naturally tapers down at both the start and end of its span, matching a real dorsal-fin silhouette). Consecutive `{base, top}` pairs triangulate into a strip — `2 * (finSegments-1)` triangles, versus today's fixed 2.

### 3.4 Pelvic fin — thin extruded polygon, new (배지느러미)

`fishPelvicFin(shape)`: one thin quad (2 triangles) per side, hanging from the belly at `t = pelvicFin.at` (default 0.55), swept back by `pelvicFin.angle` degrees from vertical, `pelvicFin.length` long. This is a genuinely new fin pair — today's code only has one hanging fin pair, which this design reassigns to be the pectoral fin (moved forward, see below) while adding this one as the true ventral pair.

### 3.5 Pectoral fin — fan-shaped, near the head (가슴지느러미)

`fishPectoralFin(shape, finSegments)`: per side, a `finSegments`-triangle fan (same fan construction as the tail lobes) rooted at `t = pectoralFin.at` (default 0.28, i.e. just behind the head) sweeping outward/back by `pectoralFin.angle` degrees, `pectoralFin.length` long.

### 3.6 Thread — optional bezier ribbon (실 모양 등지느러미)

Only emitted if `shape.thread` is present. `fishThread(shape, finSegments)`: a quadratic bezier from the dorsal fin's peak point, control point offset by `thread.curvature`, endpoint `thread.length` further back, subdivided into `finSegments` ribbon segments that taper linearly in width from a small base down to ~0 at the tip. `2 * finSegments` triangles when present, 0 otherwise.

### 3.7 Eye — low-poly sphere pair, new (눈)

`fishEyePoints(shape)`: returns `null` if `shape.eye?.radius === 0`, otherwise a left/right pair positioned near the front of the snout (`t ≈ shape.snout.length * 0.6`), offset to `z = ±width(t) * 0.9`, `y = +height(t) * 0.3`. Each eye is a low-poly octahedron approximation (6 vertices / 8 triangles) rather than a true UV sphere, keeping the "faceted low-poly" look consistent with the rest of the model. Default radius (when `shape.eye` is omitted entirely) is `0.16 * body.maxHeight`. Color comes from `palette.eye` (default `#141414`, deliberately independent of `accent` since `accent` is already spoken for by stripe patterns).

### 3.8 Pattern — unchanged (무늬)

`pattern.stripes` keeps today's exact mechanism: evenly-spaced body ring segments (within the main-body zone) recolored to `accent` instead of `body`. Still vertex-color, not geometry — per the source doc's own recommendation that patterns are a shader/material concern, not a mesh concern.

## 4. Detail levels & triangle budget

`FishDetailProfile` (`config.ts`) gains one field, `finSegments`, shared by the tail/dorsal/pectoral/thread constructions above; `bodySegments` is reinterpreted as the **main-body zone's** segment count, with the snout and peduncle zones deriving their own segment counts as a fixed fraction of it (`max(2, round(bodySegments * 0.4))` each) rather than adding more species-facing or profile-facing fields:

| detail | bodySegments (main) | snout/peduncle segments (each) | ringSides | finSegments | facetJitter |
|---|---|---|---|---|---|
| low | 3 | 2 | 4 | 2 | 0 |
| medium | 5 | 2 | 5 | 3 | 0 |
| high | 10 | 4 | 6 | 5 | 0.16 |

Illustrative medium-detail triangle count for a species with a `thread` (upper bound) vs. without:

| piece | today | new (medium, no thread) |
|---|---|---|
| body loft (snout+main+peduncle segments) | ~40 (5×4×2) | ~90 (9 segments [5+2+2] × 5 sides × 2) |
| tail fin | 4 | 6 (3-seg fan × 2 lobes) |
| dorsal fin | 2 | 8 (4-seg ridge strip) |
| pelvic fin (new) | 0 | 4 |
| pectoral fin | 4 | 6 (3-seg fan × 2) |
| eye (new) | 0 | 16 (8 tri × 2) |
| thread (optional) | 0 | 0 / +6 (3-seg ribbon × 2 tri) |
| **total** | **~50** | **~130 (~136 with thread)** |

~2.6–3x today's baseline, matching the "2배 이상" target. Scene-wide, this is still trivial against the SPEC N1 budget: 54 lowpoly-fish instances × ~150 tri ≈ 8,100 triangles, vs. the 300k ceiling (draw-call count is unaffected — still one `InstancedMesh` per species).

`fish.test.ts`'s current `expect(position.count / 3).toBeLessThan(100)` regression bound is raised to reflect the new target (e.g. `< 220`, comfortably covering the high-detail + thread case); the exact number is tuned during implementation against real output, not pre-committed here.

## 5. Migration of the existing 6 species

Each of `clownfish`, `blue-sea-bream`, `yellow-tang`, `butterflyfish`, `purple-tang`, `pink-cardinalfish` becomes one `web/species/NN-<id>.yaml`. Field mapping from the current `FishShape`:

| old field | new field(s) |
|---|---|
| `length` | `body.length` (unchanged meaning: nose to tail-fin root) |
| `height` | `body.maxHeight` |
| `width` | `body.maxWidth` |
| `tailSpan` | `tailFin.height` / `tailFin.length` (split into two, both derived from the old single value) |
| `stripes` | `pattern.stripes` (unchanged) |
| *(none — new)* | `snout.*`, `peduncle.*`, `body.peak`/`body.taper`, `dorsalFin.*`, `pelvicFin.*`, `pectoralFin.*`, `eye?` |

New fields get reasonable species-appropriate defaults during implementation (e.g. `butterflyfish`'s disc shape → `body.peak` near the middle, larger `dorsalFin.height`; `pink-cardinalfish`'s small torpedo shape → forward `body.peak`, minimal fins), checked visually via `npm run preview` rather than against a numeric target — exact parity with the current renders is explicitly not required (per the approved design).

## 6. Testing plan

- `species-loader.test.ts` (new): valid YAML round-trips into the expected `FishSpecies` shape; each documented failure mode (missing required field, `snout.length + peduncle.length >= 1`, non-finite number, `id` not matching filename slug) throws with a message naming the offending file.
- `fish.test.ts` updates:
  - Remove the "vertex-for-vertex regression of v1" test (§AC-9's old byte-identical guarantee no longer holds by design) — replace with a determinism test: same species + same detail → identical output across two calls (already how the shark/seahorse suites test their own builders).
  - Raise the low-poly triangle ceiling to the new target (tuned during implementation).
  - Keep the existing low ≤ medium ≤ high ordering test and the "high ≈ 2.3–2.7× medium" ratio test — same invariant, new numbers.
  - Add one unit-test block per new pure function (`fishBodyRadius`, `fishTailFin`, `fishDorsalFin`, `fishPelvicFin`, `fishPectoralFin`, `fishThread`, `fishEyePoints`), mirroring the parameter-sensitivity style already used for `sharkBodyRadius`/`sharkTailLobes`/etc. — e.g. "a higher `body.peak` shifts the max-radius ring forward," "`thread` absent → `fishThread` returns null and adds zero vertices," "`eye.radius: 0` produces no eye vertices."
  - Registry-order and registry-shape tests (`"defines a complete, well-formed entry per species"`, etc.) updated for the new nested `shape` fields; ordering assertions are unaffected since YAML filename order mirrors the current array order.
- Manual (`npm run preview`): visually confirm all 6 migrated species still read as their intended silhouette/color family (per §5), and that a test species with `thread` present renders a visible trailing filament.

## 7. Files touched

- `web/species/01-clownfish.yaml` … `06-pink-cardinalfish.yaml` (new).
- `web/src/species-loader.ts` (new) + `web/src/species-loader.test.ts` (new).
- `web/src/creatures/geometry/fish.ts` — full rewrite of the body/fin/eye construction; new exported pure functions per §3.
- `web/src/config.ts` — `FishShape` replaced by the new nested `shape` interface (snout/body/peduncle/tailFin/dorsalFin/pelvicFin/pectoralFin/thread?/eye?/pattern); `FishDetailProfile` gains `finSegments`; `FISH_REGISTRY` built from `FISH_SPECIES_FROM_YAML` + the 3 hardcoded non-fish species; the 6 migrated species' inline object literals removed.
- `web/src/fish.test.ts` — updates per §6.
- `web/package.json` — `yaml` added to `dependencies`.
- `docs/create_geometry_generator.md` — updated with the finalized TypeScript/three.js grammar (see that file's own new closing section).
