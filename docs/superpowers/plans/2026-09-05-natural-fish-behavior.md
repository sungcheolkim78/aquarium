# Natural Fish Behavior Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each swim-locomotion species distinct movement — depth preference, a turn-rate cap, a burst-glide speed rhythm, per-species territoriality around real coral clusters, and simple obstacle avoidance — without changing per-species instancing, seeded reproducibility, or the performance budget.

**Architecture:** Four new pure steering functions in `fish.ts` (`depthBiasSteer`, `clampTurnRate`, `rhythmSpeedScale`, `coralAvoidanceSteer`) are layered one at a time into `FishSchool.update()`'s existing per-boid steering loop. `environment.ts` gains a small extracted function, `computeCoralClusterCenters`, whose output is threaded through `main.ts` into `createSchools` so fish can react to real coral positions. All new species data lives in `config.ts` as optional `behavior` fields, mirroring the existing `hoverAmplitude?`/`hoverFrequency?` pattern.

**Tech Stack:** TypeScript, Three.js `Vector3`/`InstancedMesh`, Vitest, Vite.

**Spec:** `docs/superpowers/specs/2026-09-05-natural-fish-behavior-design.md`, implementing `docs/DEVELOPMENT_PROPOSAL.md` §4.3.

## Global Constraints

- Keep `+X` as forward and one `InstancedMesh` draw call per registry species (unchanged by this plan).
- Keep seeded scene generation deterministic; never introduce `Math.random()`.
- New `behavior` fields are optional and default to today's exact behavior when absent (`depthPreference ?? 0.5` is neutral only in the sense of "not pulled anywhere new"; `maxTurnRate` absent = uncapped; `rhythmAmplitude ?? 0` = no rhythm; `territoryStrength ?? 0`/undefined = no territory pull) — hover locomotion (seahorse) must not need any of them set.
- `territoryStrength` is set only for `yellow-tang`, `butterflyfish`, `purple-tang` — not for every `schooling: false` species (shark and turtle stay roaming).
- The existing boundary-safety behavior (`containSteer` fully corrects a fish near the wall) must never be delayed by the new turn-rate cap.
- Run `npm --prefix web run test` after every step that touches test files; run `npm --prefix web run build` at the end of the plan.

---

### Task 1: Add new behavior fields and per-species values to the registry

**Files:**
- Modify: `web/src/config.ts`
- Modify: `web/src/config.test.ts`

**Interfaces:**
- Produces: `CreatureDefinition["behavior"]` gains `depthPreference?`, `maxTurnRate?`, `rhythmAmplitude?`, `rhythmFrequency?`, `territoryStrength?` (all `number`, all optional).
- Produces: `SCENE.coral.avoidanceRadius: number`, `SCENE.coral.avoidanceHeight: number`.

- [ ] **Step 1: Write the failing registry tests**

Add to `web/src/config.test.ts`, inside the existing `describe("creature registry", ...)` block (after the turtle test, before its closing `});`):

```ts
  it("scopes territoryStrength to the three solitary reef fish, not schooling fish or roaming shark/turtle", () => {
    const byId = new Map(FISH_REGISTRY.map((species) => [species.id, species]));
    for (const id of ["yellow-tang", "butterflyfish", "purple-tang"]) {
      const species = byId.get(id);
      expect(species?.behavior.territoryStrength).toBeGreaterThan(0);
    }
    for (const id of ["clownfish", "blue-sea-bream", "pink-cardinalfish", "great-white-shark", "green-sea-turtle"]) {
      const species = byId.get(id);
      expect(species?.behavior.territoryStrength ?? 0).toBe(0);
    }
  });

  it("gives every swim-locomotion species a depth preference and a turn-rate cap", () => {
    for (const species of FISH_REGISTRY) {
      if (species.behavior.locomotion !== "swim") continue;
      expect(species.behavior.depthPreference).toBeGreaterThanOrEqual(0);
      expect(species.behavior.depthPreference).toBeLessThanOrEqual(1);
      expect(species.behavior.maxTurnRate).toBeGreaterThan(0);
    }
  });
```

Add a new `describe` block at the end of the file:

```ts
describe("SCENE.coral avoidance", () => {
  it("defines a positive avoidance radius and height", () => {
    expect(SCENE.coral.avoidanceRadius).toBeGreaterThan(0);
    expect(SCENE.coral.avoidanceHeight).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm --prefix web run test -- src/config.test.ts`

Expected: `TypeError`/`toBeGreaterThan` failures — `territoryStrength`, `depthPreference`, `maxTurnRate` don't exist yet on `behavior`, and `SCENE.coral.avoidanceRadius` is `undefined`.

- [ ] **Step 3: Add the new optional behavior fields**

In `web/src/config.ts`, in the `behavior` block of `CreatureDefinition` (right after `readonly activityRadius: number;` and before the closing `};`):

```ts
    /** 0 = hugs the floor, 1 = hugs the surface. Swim locomotion only; unused (no pull) if absent. */
    readonly depthPreference?: number;
    /** Max heading change per second, in radians. Swim locomotion only; uncapped if absent. */
    readonly maxTurnRate?: number;
    /** 0..1: how deep the periodic speed dip goes. Swim locomotion only; no rhythm (flat speed) if absent. */
    readonly rhythmAmplitude?: number;
    /** Speed-dip cycles per second. Swim locomotion only; irrelevant if `rhythmAmplitude` is absent. */
    readonly rhythmFrequency?: number;
    /** 0..1: pull strength toward this individual's habitat anchor. Swim locomotion only; no pull if absent. */
    readonly territoryStrength?: number;
```

- [ ] **Step 4: Add the avoidance constants to `SCENE.coral`**

Change:

```ts
  coral: { clusters: 22 },
```

to:

```ts
  coral: { clusters: 22, avoidanceRadius: 2.0, avoidanceHeight: 1.2 },
```

- [ ] **Step 5: Fill in values for all nine registry species**

Change each `behavior: {...}` block in `FISH_REGISTRY` exactly as follows (only the `behavior` field changes; leave `shape`/`palette`/`count` untouched):

`clownfish`:
```ts
    behavior: {
      speed: 1.15,
      locomotion: "swim",
      schooling: true,
      activityRadius: 7.5,
      depthPreference: 0.3,
      maxTurnRate: 4.5,
      rhythmAmplitude: 0.15,
      rhythmFrequency: 0.5,
    },
```

`blue-sea-bream`:
```ts
    behavior: {
      speed: 0.95,
      locomotion: "swim",
      schooling: true,
      activityRadius: 10.5,
      depthPreference: 0.55,
      maxTurnRate: 3.2,
      rhythmAmplitude: 0.15,
      rhythmFrequency: 0.5,
    },
```

`yellow-tang`:
```ts
    behavior: {
      speed: 0.7,
      locomotion: "swim",
      schooling: false,
      activityRadius: 9,
      depthPreference: 0.5,
      maxTurnRate: 3.2,
      rhythmAmplitude: 0.25,
      rhythmFrequency: 0.35,
      territoryStrength: 0.35,
    },
```

`butterflyfish`:
```ts
    behavior: {
      speed: 0.85,
      locomotion: "swim",
      schooling: false,
      activityRadius: 7,
      depthPreference: 0.45,
      maxTurnRate: 3.2,
      rhythmAmplitude: 0.25,
      rhythmFrequency: 0.35,
      territoryStrength: 0.4,
    },
```

`purple-tang`:
```ts
    behavior: {
      speed: 0.8,
      locomotion: "swim",
      schooling: false,
      activityRadius: 8.5,
      depthPreference: 0.5,
      maxTurnRate: 3.2,
      rhythmAmplitude: 0.25,
      rhythmFrequency: 0.35,
      territoryStrength: 0.3,
    },
```

`pink-cardinalfish`:
```ts
    behavior: {
      speed: 1.3,
      locomotion: "swim",
      schooling: true,
      activityRadius: 6,
      depthPreference: 0.4,
      maxTurnRate: 4.5,
      rhythmAmplitude: 0.15,
      rhythmFrequency: 0.5,
    },
```

`great-white-shark`:
```ts
    behavior: {
      speed: 0.9,
      locomotion: "swim",
      schooling: false,
      activityRadius: 10.5,
      depthPreference: 0.6,
      maxTurnRate: 1.4,
      rhythmAmplitude: 0.1,
      rhythmFrequency: 0.2,
    },
```

`green-sea-turtle`:
```ts
    behavior: {
      speed: 0.48,
      locomotion: "swim",
      schooling: false,
      activityRadius: 8.5,
      depthPreference: 0.65,
      maxTurnRate: 1.1,
      rhythmAmplitude: 0.3,
      rhythmFrequency: 0.25,
    },
```

`seahorse` (`locomotion: "hover"`) is left completely unchanged — no new fields.

- [ ] **Step 6: Run the focused test and verify it passes**

Run: `npm --prefix web run test -- src/config.test.ts`

Expected: all pass, including the two new tests.

- [ ] **Step 7: Run the full test suite and typecheck**

Run: `npm --prefix web run test && npx --prefix web tsc --noEmit`

Expected: no failures (nothing yet reads these new fields at runtime, so no other test's behavior changes).

- [ ] **Step 8: Commit**

```bash
git add web/src/config.ts web/src/config.test.ts
git commit -m "feat: add depth/turn-rate/rhythm/territory behavior fields to the registry"
```

### Task 2: Add the four pure steering functions

**Files:**
- Modify: `web/src/fish.ts`
- Modify: `web/src/fish.test.ts`

**Interfaces:**
- Produces: `depthBiasSteer(positionY, depthPreference, bounds, floorY, out?): Vector3`
- Produces: `clampTurnRate(current, desired, maxRadians, out?): Vector3`
- Produces: `rhythmSpeedScale(elapsed, phase, amplitude, frequency): number`
- Produces: `coralAvoidanceSteer(position, clusterCenters, avoidanceCenterY, avoidanceRadius, out?): Vector3`

- [ ] **Step 1: Write the failing tests**

Add to `web/src/fish.test.ts`, right after the existing `describe("containSteer", ...)` block:

```ts
describe("depthBiasSteer", () => {
  const bounds = SCENE.bounds;
  const floorY = SCENE.floorY;

  it("pulls up when below the preferred depth and down when above it", () => {
    const target = floorY + 0.5 * bounds.y * 2;
    expect(depthBiasSteer(floorY, 0.5, bounds, floorY).y).toBeGreaterThan(0);
    expect(depthBiasSteer(target + 5, 0.5, bounds, floorY).y).toBeLessThan(0);
  });

  it("is exactly zero at the preferred depth", () => {
    const target = floorY + 0.5 * bounds.y * 2;
    expect(depthBiasSteer(target, 0.5, bounds, floorY).y).toBeCloseTo(0, 5);
  });
});

describe("clampTurnRate", () => {
  it("returns the desired direction unchanged when within the turn budget", () => {
    const current = new Vector3(1, 0, 0);
    const desired = new Vector3(1, 0, 0.05).normalize();
    const result = clampTurnRate(current, desired, 0.5);
    expect(result.x).toBeCloseTo(desired.x, 3);
    expect(result.z).toBeCloseTo(desired.z, 3);
  });

  it("rotates only partway toward a desired direction outside the turn budget", () => {
    const current = new Vector3(1, 0, 0);
    const desired = new Vector3(-1, 0, 0);
    const maxRadians = 0.2;
    const result = clampTurnRate(current, desired, maxRadians);
    const angleFromCurrent = current.angleTo(result);
    expect(angleFromCurrent).toBeCloseTo(maxRadians, 2);
    expect(result.length()).toBeCloseTo(1, 5);
  });
});

describe("rhythmSpeedScale", () => {
  it("returns exactly 1 when amplitude is 0", () => {
    for (let t = 0; t < 3; t += 0.37) expect(rhythmSpeedScale(t, 0, 0, 0.5)).toBe(1);
  });

  it("stays within [1-amplitude, 1] and actually varies over time", () => {
    const values = Array.from({ length: 20 }, (_, i) => rhythmSpeedScale(i * 0.1, 0, 0.3, 0.5));
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0.7 - 1e-9);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.1);
  });
});

describe("coralAvoidanceSteer", () => {
  it("is zero far from every cluster", () => {
    const steer = coralAvoidanceSteer(new Vector3(50, 0, 50), [new Vector3(0, 0, 0)], 0, 2);
    expect(steer.lengthSq()).toBe(0);
  });

  it("points away from the nearest cluster when inside its radius", () => {
    const center = new Vector3(0, 0, 0);
    const steer = coralAvoidanceSteer(new Vector3(1, 0, 0), [center], 0, 2);
    expect(steer.x).toBeGreaterThan(0);
    expect(steer.z).toBeCloseTo(0, 5);
  });
});
```

Add `depthBiasSteer`, `clampTurnRate`, `rhythmSpeedScale`, `coralAvoidanceSteer` to the existing `import { ... } from "./fish";` list in `fish.test.ts`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm --prefix web run test -- src/fish.test.ts`

Expected: import/`TypeError: ... is not a function` failures — none of the four functions exist yet.

- [ ] **Step 3: Implement the four functions**

In `web/src/fish.ts`, add right after `containSteer`'s closing `}` (before `const COHESION = 0.5;`):

```ts
/** Weak vertical pull toward a preferred depth band (0=floor..1=surface); zero exactly at the target. */
export function depthBiasSteer(
  positionY: number,
  depthPreference: number,
  bounds: { readonly y: number },
  floorY: number,
  out = new Vector3(),
): Vector3 {
  out.set(0, 0, 0);
  const targetY = floorY + depthPreference * bounds.y * 2;
  out.y = targetY - positionY;
  return out;
}

/** Rotates `current` (unit vector) toward `desired` (unit vector) by at most `maxRadians`. */
export function clampTurnRate(
  current: Vector3,
  desired: Vector3,
  maxRadians: number,
  out = new Vector3(),
): Vector3 {
  const dot = Math.min(1, Math.max(-1, current.dot(desired)));
  const angle = Math.acos(dot);
  if (angle <= maxRadians || angle < 1e-6) return out.copy(desired);
  const t = maxRadians / angle;
  return out.copy(current).lerp(desired, t).normalize();
}

/** Multiplier on target speed: dips to `1 - amplitude` and back once per `1 / frequency` seconds. */
export function rhythmSpeedScale(
  elapsed: number,
  phase: number,
  amplitude: number,
  frequency: number,
): number {
  return 1 - amplitude * (0.5 + 0.5 * Math.sin(elapsed * frequency * Math.PI * 2 + phase));
}

/** Sum of per-cluster push-away; zero outside every cluster's avoidance sphere. */
export function coralAvoidanceSteer(
  position: Vector3,
  clusterCenters: readonly Vector3[],
  avoidanceCenterY: number,
  avoidanceRadius: number,
  out = new Vector3(),
): Vector3 {
  out.set(0, 0, 0);
  for (const center of clusterCenters) {
    const dx = position.x - center.x;
    const dy = position.y - avoidanceCenterY;
    const dz = position.z - center.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > 1e-4 && dist < avoidanceRadius) {
      const push = (avoidanceRadius - dist) / avoidanceRadius / dist;
      out.x += dx * push;
      out.y += dy * push;
      out.z += dz * push;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm --prefix web run test -- src/fish.test.ts`

Expected: all pass, including the new `describe` blocks.

- [ ] **Step 5: Commit**

```bash
git add web/src/fish.ts web/src/fish.test.ts
git commit -m "feat: add depth/turn-rate/rhythm/avoidance pure steering functions"
```

### Task 3: Territory — habitat anchors and the territory-pull steering term

**Files:**
- Modify: `web/src/fish.ts`
- Modify: `web/src/fish.test.ts`

**Interfaces:**
- Consumes: `FISH_REGISTRY`, `createRng` (existing).
- Produces: `Boid.habitatAnchor: Vector3`.
- Produces: `FishSchool` constructor signature becomes `(species, rng, detail = "medium", coralClusterCenters: readonly Vector3[] = [])`.

- [ ] **Step 1: Write the failing convergence test**

Add to `web/src/fish.test.ts`, inside the existing `describe("FishSchool", ...)` block (after the last existing `it(...)`, before the block's closing `});`):

```ts
  it("pulls a territorial species' individuals to settle near their assigned coral cluster (§4.3 habitat point)", () => {
    const yellowTang = FISH_REGISTRY.find((species) => species.id === "yellow-tang") as FishSpecies;
    expect(yellowTang.behavior.territoryStrength).toBeGreaterThan(0);
    const clusterCenters = [new Vector3(6, SCENE.floorY + 1, 6)];
    const school = new FishSchool(yellowTang, createRng(21), "medium", clusterCenters);
    for (let step = 0; step < 3600; step += 1) school.update(1 / 60, step / 60);

    const matrix = school.mesh.instanceMatrix.array;
    for (let i = 0; i < school.mesh.count; i += 1) {
      const offset = i * 16;
      const x = matrix[offset + 12] ?? 0;
      const z = matrix[offset + 14] ?? 0;
      const distanceFromCluster = Math.hypot(x - clusterCenters[0]!.x, z - clusterCenters[0]!.z);
      // Well inside the free-roam activityRadius (9), close to the one supplied cluster.
      expect(distanceFromCluster).toBeLessThan(4);
    }
    school.dispose();
  });

  it("leaves a non-territorial species free to roam past a nearby cluster (control)", () => {
    const clownfish = FISH_REGISTRY[0] as FishSpecies;
    expect(clownfish.behavior.territoryStrength ?? 0).toBe(0);
    const clusterCenters = [new Vector3(6, SCENE.floorY + 1, 6)];
    const school = new FishSchool(clownfish, createRng(21), "medium", clusterCenters);
    for (let step = 0; step < 600; step += 1) school.update(1 / 60, step / 60);

    const matrix = school.mesh.instanceMatrix.array;
    let anyFar = false;
    for (let i = 0; i < school.mesh.count; i += 1) {
      const offset = i * 16;
      const x = matrix[offset + 12] ?? 0;
      const z = matrix[offset + 14] ?? 0;
      if (Math.hypot(x - clusterCenters[0]!.x, z - clusterCenters[0]!.z) > 4) anyFar = true;
    }
    expect(anyFar).toBe(true);
    school.dispose();
  });
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm --prefix web run test -- src/fish.test.ts`

Expected: `TS2554` (wrong number of constructor arguments) or the first assertion fails, since `FishSchool` doesn't accept a fourth argument and no territory pull exists yet.

- [ ] **Step 3: Add `habitatAnchor` to `Boid` and the constructor parameter**

In `web/src/fish.ts`, change the `Boid` interface:

```ts
export interface Boid {
  readonly position: Vector3;
  readonly velocity: Vector3;
  /** Per-instance phase offset for the tail-sway shader. */
  readonly phase: number;
  /** Stable position used as the anchor for non-swimming creatures. */
  readonly hoverOrigin: Vector3;
  /** Point this individual weakly returns to when its species has a `territoryStrength` (§4.3). */
  readonly habitatAnchor: Vector3;
}
```

Change the `FishSchool` constructor signature and store the new parameter (add a new private field and change the signature line):

```ts
  private readonly coralClusterCenters: readonly Vector3[];
```

(add this line next to the other `private readonly` fields, e.g. right after `private capacity: number;`)

```ts
  constructor(
    species: FishSpecies,
    rng: () => number,
    detail: DetailLevel = "medium",
    coralClusterCenters: readonly Vector3[] = [],
  ) {
    this.species = species;
    this.rng = rng;
    this.coralClusterCenters = coralClusterCenters;
    this.capacity = species.count;
```

(replace the existing `this.species = species; this.rng = rng; this.capacity = species.count;` three lines with the four lines above)

- [ ] **Step 4: Assign `habitatAnchor` in `spawnBoid`**

Change `spawnBoid`'s return statement. Current code:

```ts
    return {
      position,
      velocity: new Vector3(rng() - 0.5, (rng() - 0.5) * 0.25, rng() - 0.5)
        .normalize()
        .multiplyScalar(this.species.behavior.speed),
      phase,
      hoverOrigin: position.clone(),
    };
```

New code:

```ts
    const territoryStrength = this.species.behavior.territoryStrength ?? 0;
    let habitatAnchor = position.clone();
    if (territoryStrength > 0 && this.coralClusterCenters.length > 0) {
      const center = this.coralClusterCenters[
        Math.floor(rng() * this.coralClusterCenters.length)
      ] as Vector3;
      const offsetAngle = rng() * Math.PI * 2;
      const offsetDistance = SCENE.coral.avoidanceRadius + 0.6 + rng() * 0.8;
      habitatAnchor = new Vector3(
        center.x + Math.cos(offsetAngle) * offsetDistance,
        center.y,
        center.z + Math.sin(offsetAngle) * offsetDistance,
      );
    }
    return {
      position,
      velocity: new Vector3(rng() - 0.5, (rng() - 0.5) * 0.25, rng() - 0.5)
        .normalize()
        .multiplyScalar(this.species.behavior.speed),
      phase,
      hoverOrigin: position.clone(),
      habitatAnchor,
    };
```

- [ ] **Step 5: Apply the territory-pull steering term in `update()`**

Change the destructuring line:

```ts
    const { speed, schooling } = this.species.behavior;
```

to:

```ts
    const { speed, schooling, territoryStrength } = this.species.behavior;
```

Right after the existing `this.steer.add(containSteer(...).multiplyScalar(CONTAIN));` block and before `boid.velocity.addScaledVector(this.steer, dt);`, add:

```ts
      if (territoryStrength) {
        this.scratch.copy(boid.habitatAnchor).sub(boid.position).multiplyScalar(territoryStrength);
        this.steer.add(this.scratch);
      }
```

- [ ] **Step 6: Run the focused test and verify it passes**

Run: `npm --prefix web run test -- src/fish.test.ts`

Expected: both new tests pass; all previously-passing tests still pass (the territory term is 0 for every species except yellow-tang/butterflyfish/purple-tang).

- [ ] **Step 7: Run the full suite**

Run: `npm --prefix web run test`

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add web/src/fish.ts web/src/fish.test.ts
git commit -m "feat: give territorial species a habitat anchor and a pull toward it"
```

### Task 4: Coral avoidance steering

**Files:**
- Modify: `web/src/fish.ts`
- Modify: `web/src/fish.test.ts`

**Interfaces:**
- Consumes: `coralAvoidanceSteer` (Task 2), `this.coralClusterCenters` (Task 3).

- [ ] **Step 1: Write the failing push-away test**

Add to `web/src/fish.test.ts`'s `describe("FishSchool", ...)` block:

```ts
  it("pushes a fish out of a coral cluster's avoidance sphere over time", () => {
    const species = FISH_REGISTRY[0] as FishSpecies;
    const clusterCenters = [new Vector3(0, SCENE.floorY + SCENE.coral.avoidanceHeight, 0)];
    const school = new FishSchool(species, createRng(5), "medium", clusterCenters);
    // Force the first boid to spawn deep inside the avoidance sphere.
    const insideBoid = (school as unknown as { boids: Boid[] }).boids[0] as Boid;
    insideBoid.position.set(0.3, SCENE.floorY + SCENE.coral.avoidanceHeight, 0.3);
    const startDistance = Math.hypot(insideBoid.position.x, insideBoid.position.z);

    for (let step = 0; step < 60; step += 1) school.update(1 / 60, step / 60);

    const endDistance = Math.hypot(insideBoid.position.x, insideBoid.position.z);
    expect(endDistance).toBeGreaterThan(startDistance);
    school.dispose();
  });
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm --prefix web run test -- src/fish.test.ts`

Expected: fails — the boid does not move away any faster than ordinary wander/contain would happen to move it (no avoidance force yet applied), so `endDistance` is not reliably greater; run once to confirm the failure, since this is a real behavioral assertion, not a missing-export error.

- [ ] **Step 3: Apply coral avoidance in `update()`**

Right after the territory-pull block added in Task 3 (still before `boid.velocity.addScaledVector(this.steer, dt);`), add:

```ts
      this.steer.add(
        coralAvoidanceSteer(
          boid.position,
          this.coralClusterCenters,
          SCENE.floorY + SCENE.coral.avoidanceHeight,
          SCENE.coral.avoidanceRadius,
          this.scratch,
        ).multiplyScalar(CONTAIN),
      );
```

(`CONTAIN` is the existing module constant already used for wall containment — reused here since both are "hard, get-away-from-here" forces of comparable urgency.)

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm --prefix web run test -- src/fish.test.ts`

Expected: passes; full suite still green.

- [ ] **Step 5: Run the full suite**

Run: `npm --prefix web run test`

- [ ] **Step 6: Commit**

```bash
git add web/src/fish.ts web/src/fish.test.ts
git commit -m "feat: steer fish away from coral cluster avoidance spheres"
```

### Task 5: Depth-preference steering

**Files:**
- Modify: `web/src/fish.ts`
- Modify: `web/src/fish.test.ts`

**Interfaces:**
- Consumes: `depthBiasSteer` (Task 2).

- [ ] **Step 1: Write the failing depth-trend test**

Add to `web/src/fish.test.ts`'s `describe("FishSchool", ...)` block:

```ts
  it("trends individuals toward their species' preferred depth band (§4.3 activity depth)", () => {
    const shark = FISH_REGISTRY.find((species) => species.id === "great-white-shark") as FishSpecies;
    expect(shark.behavior.depthPreference).toBeGreaterThan(0.5); // surface-leaning
    const school = new FishSchool(shark, createRng(9));
    // Force every boid to start pinned to the floor.
    for (const boid of (school as unknown as { boids: Boid[] }).boids) boid.position.y = SCENE.floorY + 0.1;

    for (let step = 0; step < 900; step += 1) school.update(1 / 60, step / 60);

    const matrix = school.mesh.instanceMatrix.array;
    let averageY = 0;
    for (let i = 0; i < school.mesh.count; i += 1) averageY += matrix[i * 16 + 13] ?? 0;
    averageY /= school.mesh.count;
    expect(averageY).toBeGreaterThan(SCENE.floorY + 2);
    school.dispose();
  });
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm --prefix web run test -- src/fish.test.ts`

Expected: fails — nothing pulls the shark up from the floor yet beyond incidental wander.

- [ ] **Step 3: Apply the depth bias in `update()`**

Change the destructuring line again:

```ts
    const { speed, schooling, territoryStrength } = this.species.behavior;
```

to:

```ts
    const { speed, schooling, territoryStrength, depthPreference } = this.species.behavior;
```

Right after the coral-avoidance block added in Task 4, add:

```ts
      this.steer.add(
        depthBiasSteer(boid.position.y, depthPreference ?? 0.5, SCENE.bounds, SCENE.floorY, this.scratch)
          .multiplyScalar(DEPTH_BIAS),
      );
```

Add the new module constant next to the existing ones:

```ts
const DEPTH_BIAS = 0.12;
```

(insert `const DEPTH_BIAS = 0.12;` on its own line right after the existing `const WANDER = 0.55;`)

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm --prefix web run test -- src/fish.test.ts`

Expected: passes. If it doesn't converge enough in 900 steps, that's a signal `DEPTH_BIAS` is too weak — raise it (try `0.18`) rather than weakening the test's threshold, then re-run.

- [ ] **Step 5: Run the full suite**

Run: `npm --prefix web run test`

Expected: all pass — `depthPreference` is now set for every swim species per Task 1, so every school gets a (weak) depth pull; existing bounds/finite tests are unaffected since the pull is small and always within `SCENE.bounds`.

- [ ] **Step 6: Commit**

```bash
git add web/src/fish.ts web/src/fish.test.ts
git commit -m "feat: steer fish toward their species' preferred depth band"
```

### Task 6: Turn-rate cap (with a boundary-safety bypass)

**Files:**
- Modify: `web/src/fish.ts`
- Modify: `web/src/fish.test.ts`

**Interfaces:**
- Consumes: `clampTurnRate` (Task 2).
- Produces: the integration tail of `update()` now separates "current heading" from "desired heading" and clamps the rotation between them.

- [ ] **Step 1: Write the failing turn-rate tests**

Add to `web/src/fish.test.ts`'s `describe("FishSchool", ...)` block:

```ts
  it("never turns a fish faster than its maxTurnRate per frame, even under a strong pull", () => {
    // A weak ambient force (e.g. plain wander) would never demand a turn sharp
    // enough to prove the cap does anything — this plants a deliberately
    // strong, sustained pull the opposite way so the *desired* direction
    // swings hard every frame, and asserts the *actual* direction never
    // follows faster than maxTurnRate allows.
    const yellowTang = FISH_REGISTRY.find((species) => species.id === "yellow-tang") as FishSpecies;
    const maxTurnRate = yellowTang.behavior.maxTurnRate as number;
    const school = new FishSchool(yellowTang, createRng(4));
    const boids = (school as unknown as { boids: Boid[] }).boids;
    for (const boid of boids) {
      boid.position.set(0, SCENE.floorY + SCENE.bounds.y, 0);
      boid.velocity.set(1, 0, 0).multiplyScalar(yellowTang.behavior.speed);
      boid.habitatAnchor.set(-20, SCENE.floorY + SCENE.bounds.y, 0);
    }

    const dt = 1 / 60;
    let previousDirections = boids.map((b) => b.velocity.clone().normalize());
    for (let step = 0; step < 120; step += 1) {
      school.update(dt, step * dt);
      const nextDirections = boids.map((b) => b.velocity.clone().normalize());
      for (let i = 0; i < boids.length; i += 1) {
        const angle = (previousDirections[i] as Vector3).angleTo(nextDirections[i] as Vector3);
        expect(angle).toBeLessThanOrEqual(maxTurnRate * dt + 1e-6);
      }
      previousDirections = nextDirections;
    }
    school.dispose();
  });

  it("still fully corrects a fish heading straight out of bounds, even with a tiny maxTurnRate", () => {
    const turtle = FISH_REGISTRY.find((species) => species.id === "green-sea-turtle") as FishSpecies;
    const school = new FishSchool(turtle, createRng(6));
    const boid = (school as unknown as { boids: Boid[] }).boids[0] as Boid;
    boid.position.set(SCENE.bounds.x - 0.05, SCENE.floorY + SCENE.bounds.y, 0);
    boid.velocity.set(1, 0, 0).multiplyScalar(turtle.behavior.speed);

    for (let step = 0; step < 180; step += 1) school.update(1 / 60, step / 60);

    expect(Math.abs(boid.position.x)).toBeLessThanOrEqual(SCENE.bounds.x);
    school.dispose();
  });
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm --prefix web run test -- src/fish.test.ts`

Expected: the first test fails (today's code can flip direction instantly, so `angle` exceeds `maxTurnRate * dt` almost immediately). The second test likely already passes (existing `containSteer` already keeps fish in bounds) — that's fine, it becomes a regression guard once the cap is added.

- [ ] **Step 3: Add two scratch fields**

Add next to the other `private readonly` scratch fields (after `private readonly heading = new Vector3();`):

```ts
  private readonly desiredDirection = new Vector3();
  private readonly turnedDirection = new Vector3();
```

- [ ] **Step 4: Rework the integration tail to compute and clamp direction separately from speed**

Change the destructuring line once more:

```ts
    const { speed, schooling, territoryStrength, depthPreference } = this.species.behavior;
```

to:

```ts
    const { speed, schooling, territoryStrength, depthPreference, maxTurnRate } = this.species.behavior;
```

Replace this existing block (containment steer through position integration):

```ts
      this.steer.add(
        containSteer(boid.position, SCENE.bounds, SCENE.floorY, 2, this.scratch).multiplyScalar(
          CONTAIN,
        ),
      );

      if (territoryStrength) {
        this.scratch.copy(boid.habitatAnchor).sub(boid.position).multiplyScalar(territoryStrength);
        this.steer.add(this.scratch);
      }

      this.steer.add(
        coralAvoidanceSteer(
          boid.position,
          this.coralClusterCenters,
          SCENE.floorY + SCENE.coral.avoidanceHeight,
          SCENE.coral.avoidanceRadius,
          this.scratch,
        ).multiplyScalar(CONTAIN),
      );

      this.steer.add(
        depthBiasSteer(boid.position.y, depthPreference ?? 0.5, SCENE.bounds, SCENE.floorY, this.scratch)
          .multiplyScalar(DEPTH_BIAS),
      );

      boid.velocity.addScaledVector(this.steer, dt);
      const currentSpeed = boid.velocity.length();
      if (currentSpeed < 1e-4) {
        boid.velocity.copy(FORWARD).multiplyScalar(speed);
      } else {
        boid.velocity.multiplyScalar(1 + (speed / currentSpeed - 1) * Math.min(1, dt * 1.8));
      }
      boid.position.addScaledVector(boid.velocity, dt);
```

with:

```ts
      const containPush = containSteer(boid.position, SCENE.bounds, SCENE.floorY, 2, this.scratch);
      const nearWall = containPush.lengthSq() > 1e-8;
      this.steer.add(this.scratch.multiplyScalar(CONTAIN));

      if (territoryStrength) {
        this.scratch.copy(boid.habitatAnchor).sub(boid.position).multiplyScalar(territoryStrength);
        this.steer.add(this.scratch);
      }

      this.steer.add(
        coralAvoidanceSteer(
          boid.position,
          this.coralClusterCenters,
          SCENE.floorY + SCENE.coral.avoidanceHeight,
          SCENE.coral.avoidanceRadius,
          this.scratch,
        ).multiplyScalar(CONTAIN),
      );

      this.steer.add(
        depthBiasSteer(boid.position.y, depthPreference ?? 0.5, SCENE.bounds, SCENE.floorY, this.scratch)
          .multiplyScalar(DEPTH_BIAS),
      );

      this.heading.copy(boid.velocity);
      if (this.heading.lengthSq() < 1e-8) this.heading.copy(FORWARD);
      else this.heading.normalize();

      this.desiredDirection.copy(boid.velocity).addScaledVector(this.steer, dt);
      const desiredSpeed = this.desiredDirection.length();
      if (desiredSpeed < 1e-4) this.desiredDirection.copy(this.heading);
      else this.desiredDirection.normalize();

      if (maxTurnRate !== undefined && !nearWall) {
        clampTurnRate(this.heading, this.desiredDirection, maxTurnRate * dt, this.turnedDirection);
      } else {
        this.turnedDirection.copy(this.desiredDirection);
      }

      boid.velocity.copy(this.turnedDirection).multiplyScalar(Math.max(desiredSpeed, 1e-4));
      const currentSpeed = boid.velocity.length();
      boid.velocity.multiplyScalar(1 + (speed / currentSpeed - 1) * Math.min(1, dt * 1.8));
      boid.position.addScaledVector(boid.velocity, dt);
```

(`nearWall` bypasses the turn-rate cap only while `containSteer` is actively pushing — i.e. the fish is within the boundary margin — so the existing bounds guarantee is never weakened by a slow-turning species.)

- [ ] **Step 5: Run the focused test and verify it passes**

Run: `npm --prefix web run test -- src/fish.test.ts`

Expected: both new tests pass.

- [ ] **Step 6: Run the full suite**

Run: `npm --prefix web run test`

Expected: all pass — species without `maxTurnRate` (none, after Task 1, but the `undefined` branch is still exercised by any future species that omits it) behave exactly as before.

- [ ] **Step 7: Commit**

```bash
git add web/src/fish.ts web/src/fish.test.ts
git commit -m "feat: cap per-frame turn rate, bypassing the cap for boundary safety"
```

### Task 7: Burst-glide speed rhythm

**Files:**
- Modify: `web/src/fish.ts`
- Modify: `web/src/fish.test.ts`

**Interfaces:**
- Consumes: `rhythmSpeedScale` (Task 2).

- [ ] **Step 1: Write the failing oscillation test**

Add to `web/src/fish.test.ts`'s `describe("FishSchool", ...)` block:

```ts
  it("gives a rhythm-amplitude species a speed that dips and recovers instead of staying flat", () => {
    const turtle = FISH_REGISTRY.find((species) => species.id === "green-sea-turtle") as FishSpecies;
    expect(turtle.behavior.rhythmAmplitude).toBeGreaterThan(0);
    const school = new FishSchool(turtle, createRng(8));
    const boid = (school as unknown as { boids: Boid[] }).boids[0] as Boid;

    const speeds: number[] = [];
    for (let step = 0; step < 300; step += 1) {
      school.update(1 / 60, step / 60);
      speeds.push(boid.velocity.length());
    }
    school.dispose();

    expect(Math.max(...speeds) - Math.min(...speeds)).toBeGreaterThan(turtle.behavior.speed * 0.1);
  });
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm --prefix web run test -- src/fish.test.ts`

Expected: fails — speed still converges to a flat `speed`, no rhythm applied yet.

- [ ] **Step 3: Apply the rhythm to the speed-matching target**

Change the destructuring line one final time:

```ts
    const { speed, schooling, territoryStrength, depthPreference, maxTurnRate } = this.species.behavior;
```

to:

```ts
    const { speed, schooling, territoryStrength, depthPreference, maxTurnRate, rhythmAmplitude, rhythmFrequency } =
      this.species.behavior;
```

Change:

```ts
      boid.velocity.copy(this.turnedDirection).multiplyScalar(Math.max(desiredSpeed, 1e-4));
      const currentSpeed = boid.velocity.length();
      boid.velocity.multiplyScalar(1 + (speed / currentSpeed - 1) * Math.min(1, dt * 1.8));
      boid.position.addScaledVector(boid.velocity, dt);
```

to:

```ts
      boid.velocity.copy(this.turnedDirection).multiplyScalar(Math.max(desiredSpeed, 1e-4));
      const currentSpeed = boid.velocity.length();
      const targetSpeed =
        speed * rhythmSpeedScale(elapsed, boid.phase, rhythmAmplitude ?? 0, rhythmFrequency ?? 0);
      boid.velocity.multiplyScalar(1 + (targetSpeed / currentSpeed - 1) * Math.min(1, dt * 1.8));
      boid.position.addScaledVector(boid.velocity, dt);
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm --prefix web run test -- src/fish.test.ts`

Expected: passes.

- [ ] **Step 5: Run the full suite**

Run: `npm --prefix web run test`

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/fish.ts web/src/fish.test.ts
git commit -m "feat: give swim locomotion a burst-glide speed rhythm"
```

### Task 8: Share real coral cluster centers from `environment.ts`

**Files:**
- Modify: `web/src/environment.ts`
- Modify: `web/src/environment.test.ts`

**Interfaces:**
- Produces: `computeCoralClusterCenters(rng: () => number, clusterCount: number): Vector3[]`.
- Produces: `Environment.coralClusterCenters: readonly Vector3[]`.

- [ ] **Step 1: Write the failing tests**

In `web/src/environment.test.ts`, add a new import line right after the existing `import { describe, expect, it } from "vitest";`:

```ts
import { Scene } from "three";
```

and change the existing `./environment` import line from:

```ts
import {
  computeObjectCounts,
  createCoral,
  createFloor,
  createSeaweed,
  mergeBaked,
} from "./environment";
```

to:

```ts
import {
  computeCoralClusterCenters,
  computeObjectCounts,
  createCoral,
  createEnvironment,
  createFloor,
  createSeaweed,
  mergeBaked,
} from "./environment";
```

Then add the new tests:

```ts
describe("computeCoralClusterCenters", () => {
  it("returns one finite center per cluster, deterministic for the same seed", () => {
    const a = computeCoralClusterCenters(createRng(3), 22);
    const b = computeCoralClusterCenters(createRng(3), 22);
    expect(a).toHaveLength(22);
    for (const center of a) {
      expect(Number.isFinite(center.x)).toBe(true);
      expect(Number.isFinite(center.z)).toBe(true);
    }
    expect(a.map((c) => [c.x, c.z])).toEqual(b.map((c) => [c.x, c.z]));
  });
});

describe("createEnvironment", () => {
  it("exposes one coral cluster center per configured cluster", () => {
    const scene = new Scene();
    const env = createEnvironment(scene, createRng(3));
    expect(env.coralClusterCenters).toHaveLength(SCENE.coral.clusters);
    env.dispose();
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm --prefix web run test -- src/environment.test.ts`

Expected: `computeCoralClusterCenters` doesn't exist; `env.coralClusterCenters` is `undefined`.

- [ ] **Step 3: Extract the pure center-computation function**

In `web/src/environment.ts`, add right before `export function createCoral(`:

```ts
/** Deterministic cluster center placement, shared between coral rendering and fish territory/avoidance. */
export function computeCoralClusterCenters(rng: () => number, clusterCount: number): Vector3[] {
  const centers: Vector3[] = [];
  for (let c = 0; c < clusterCount; c += 1) {
    const angle = (c / clusterCount) * Math.PI * 2 + rng() * 0.35;
    const radius = 4.5 + rng() * 8.5;
    centers.push(new Vector3(Math.cos(angle) * radius, SCENE.floorY, Math.sin(angle) * radius));
  }
  return centers;
}
```

- [ ] **Step 4: Reuse it inside `createCoral`**

Change:

```ts
  for (let c = 0; c < clusterCount; c += 1) {
    const angle = (c / clusterCount) * Math.PI * 2 + rng() * 0.35;
    const radius = 4.5 + rng() * 8.5;
    const baseX = Math.cos(angle) * radius;
    const baseZ = Math.sin(angle) * radius;
    const hue = CORAL_COLORS[Math.floor(rng() * CORAL_COLORS.length)] ?? CORAL_COLORS[0];
```

to:

```ts
  const clusterCenters = computeCoralClusterCenters(rng, clusterCount);
  for (let c = 0; c < clusterCount; c += 1) {
    const center = clusterCenters[c] as Vector3;
    const baseX = center.x;
    const baseZ = center.z;
    const hue = CORAL_COLORS[Math.floor(rng() * CORAL_COLORS.length)] ?? CORAL_COLORS[0];
```

This calls `rng()` for the angle/radius exactly once per cluster, in the same order as before (now inside `computeCoralClusterCenters`), so every subsequent `rng()` draw in `createCoral`'s per-piece loop is unaffected — coral rendering output is unchanged.

- [ ] **Step 5: Expose it on `Environment`**

Add `coralClusterCenters` to the `Environment` interface:

```ts
export interface Environment {
  readonly group: Group;
  readonly coralClusterCenters: readonly Vector3[];
  update(elapsed: number): void;
```

`createCoral` already calls `computeCoralClusterCenters(rng, clusterCount)` internally (Step 4) — precomputing the centers a second time before calling `createCoral` would draw from `rng` twice and desynchronize every subsequent draw. Instead, have `createCoral` return the centers it already computed, alongside its mesh.

Change `createCoral`'s return type and final lines from:

```ts
  const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  applyCaustics(material, time, causticsEnabled);

  const mesh = new Mesh(mergeBaked(parts), material);
  mesh.name = "coral";
  return mesh;
}
```

to:

```ts
  const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  applyCaustics(material, time, causticsEnabled);

  const mesh = new Mesh(mergeBaked(parts), material);
  mesh.name = "coral";
  return { mesh, clusterCenters };
}
```

and its signature line from:

```ts
export function createCoral(
  rng: () => number,
  time: TimeUniform,
  profile: CoralDetailProfile = BACKGROUND_DETAIL_PROFILES.medium.coral,
  clusterCount: number = SCENE.coral.clusters,
  causticsEnabled: ToggleUniform = { value: 1 },
): Mesh {
```

to:

```ts
export function createCoral(
  rng: () => number,
  time: TimeUniform,
  profile: CoralDetailProfile = BACKGROUND_DETAIL_PROFILES.medium.coral,
  clusterCount: number = SCENE.coral.clusters,
  causticsEnabled: ToggleUniform = { value: 1 },
): { mesh: Mesh; clusterCenters: readonly Vector3[] } {
```

Now update every caller. In `createEnvironment`:

```ts
  let floor = createFloor(time, profile.floorSegments, causticsEnabled);
  let coral = createCoral(rng, time, profile.coral, coralClusters, causticsEnabled);
  let seaweed = createSeaweed(rng, time, profile.seaweedHeightSegments, seaweedCount);
  const godRays = createGodRays(rng);

  group.add(floor, coral, seaweed);
```

becomes:

```ts
  let floor = createFloor(time, profile.floorSegments, causticsEnabled);
  let { mesh: coral, clusterCenters } = createCoral(rng, time, profile.coral, coralClusters, causticsEnabled);
  let seaweed = createSeaweed(rng, time, profile.seaweedHeightSegments, seaweedCount);
  const godRays = createGodRays(rng);

  group.add(floor, coral, seaweed);
```

and the returned object gains the field:

```ts
  return {
    group,
    coralClusterCenters: clusterCenters,
    update(elapsed: number): void {
```

and inside `rebuild()`:

```ts
      const nextFloor = createFloor(time, nextProfile.floorSegments, causticsEnabled);
      const nextCoral = createCoral(rng, time, nextProfile.coral, counts.coralClusters, causticsEnabled);
      const nextSeaweed = createSeaweed(rng, time, nextProfile.seaweedHeightSegments, counts.seaweedCount);

      group.add(nextFloor, nextCoral, nextSeaweed);
      disposeMesh(floor);
      disposeMesh(coral);
      disposeMesh(seaweed);

      floor = nextFloor;
      coral = nextCoral;
      seaweed = nextSeaweed;
```

becomes:

```ts
      const nextFloor = createFloor(time, nextProfile.floorSegments, causticsEnabled);
      const nextCoralResult = createCoral(rng, time, nextProfile.coral, counts.coralClusters, causticsEnabled);
      const nextSeaweed = createSeaweed(rng, time, nextProfile.seaweedHeightSegments, counts.seaweedCount);

      group.add(nextFloor, nextCoralResult.mesh, nextSeaweed);
      disposeMesh(floor);
      disposeMesh(coral);
      disposeMesh(seaweed);

      floor = nextFloor;
      coral = nextCoralResult.mesh;
      clusterCenters = nextCoralResult.clusterCenters;
      seaweed = nextSeaweed;
```

(`rebuild()`'s exposed `coralClusterCenters` on the already-returned `Environment` object is a `readonly` property captured at construction — per the spec, a background-rebuild's fresh cluster centers are **not** propagated back to already-spawned fish; this local `clusterCenters` variable inside `rebuild()`'s closure is unused outside logging/future work. Leave it assigned for clarity but do not attempt to update the returned object's field.)

Update `web/src/environment.test.ts`'s existing calls to `createCoral(...).geometry` (both occurrences, in the `"scales the whole background..."` test) to `createCoral(...).mesh.geometry`.

- [ ] **Step 6: Run the focused test and verify it passes**

Run: `npm --prefix web run test -- src/environment.test.ts`

Expected: all pass, including the two new tests and the updated `.mesh.geometry` calls.

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npm --prefix web run test && npx --prefix web tsc --noEmit`

Expected: no failures.

- [ ] **Step 8: Commit**

```bash
git add web/src/environment.ts web/src/environment.test.ts
git commit -m "feat: expose real coral cluster centers from the environment"
```

### Task 9: Wire it end-to-end and add the 60-second acceptance test

**Files:**
- Modify: `web/src/main.ts`
- Modify: `web/src/fish.ts` (only `createSchools`'s options type and body)
- Modify: `web/src/fish.test.ts`

**Interfaces:**
- Consumes: `Environment.coralClusterCenters` (Task 8).
- Produces: `CreateSchoolsOptions.coralClusterCenters?: readonly Vector3[]`.

- [ ] **Step 1: Write the failing 60-second acceptance test**

Add to `web/src/fish.test.ts`, as a new top-level `describe` block after `describe("FishSchool", ...)`:

```ts
describe("60-second fixed-seed acceptance run (§4.3 AC)", () => {
  it("keeps every swim-locomotion boid finite, in bounds, and within its turn-rate budget for 60 simulated seconds", () => {
    const clusterCenters = computeCoralClusterCenters(createRng(0x5eed), SCENE.coral.clusters);
    const schools = createSchools(FISH_REGISTRY, createRng(0x5eed), { coralClusterCenters: clusterCenters });
    const dt = 1 / 60;
    const ceilingY = SCENE.floorY + SCENE.bounds.y * 2;

    const previousDirections = new Map<FishSchool, Vector3[]>();
    for (const school of schools) {
      const boids = (school as unknown as { boids: Boid[] }).boids;
      previousDirections.set(
        school,
        boids.map((b) => (b.velocity.lengthSq() > 1e-8 ? b.velocity.clone().normalize() : new Vector3(1, 0, 0))),
      );
    }

    for (let step = 0; step < 3600; step += 1) {
      const elapsed = step * dt;
      for (const school of schools) {
        school.update(dt, elapsed);
        const species = school.species;
        const boids = (school as unknown as { boids: Boid[] }).boids;
        const prev = previousDirections.get(school) as Vector3[];

        for (let i = 0; i < boids.length; i += 1) {
          const boid = boids[i] as Boid;
          expect(Number.isFinite(boid.position.x)).toBe(true);
          expect(Number.isFinite(boid.position.y)).toBe(true);
          expect(Number.isFinite(boid.position.z)).toBe(true);

          if (species.behavior.locomotion === "swim") {
            expect(Math.abs(boid.position.x)).toBeLessThanOrEqual(SCENE.bounds.x + 0.5);
            expect(Math.abs(boid.position.z)).toBeLessThanOrEqual(SCENE.bounds.z + 0.5);
            expect(boid.position.y).toBeGreaterThanOrEqual(SCENE.floorY - 0.5);
            expect(boid.position.y).toBeLessThanOrEqual(ceilingY + 0.5);

            const maxTurnRate = species.behavior.maxTurnRate;
            if (maxTurnRate !== undefined && boid.velocity.lengthSq() > 1e-8) {
              const direction = boid.velocity.clone().normalize();
              const angle = (prev[i] as Vector3).angleTo(direction);
              expect(angle).toBeLessThanOrEqual(maxTurnRate * dt + 1e-3);
              prev[i] = direction;
            }
          }
        }
      }
    }

    for (const school of schools) school.dispose();
  });
});
```

Add `computeCoralClusterCenters` to the `import ... from "./environment"` — this test file does not currently import from `environment.ts`, so add a new import line: `import { computeCoralClusterCenters } from "./environment";`. Add `type Boid` (already imported) and confirm `FishSchool` (already imported) are present.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm --prefix web run test -- src/fish.test.ts`

Expected: `createSchools` rejects (or ignores) the `coralClusterCenters` option — `TS2353` (unknown property) since `CreateSchoolsOptions` doesn't have that field yet.

- [ ] **Step 3: Thread `coralClusterCenters` through `createSchools`**

In `web/src/fish.ts`, change `CreateSchoolsOptions`:

```ts
export interface CreateSchoolsOptions {
  readonly detail?: DetailLevel;
  readonly countScale?: number;
  readonly enabledSpecies?: Readonly<Record<string, boolean>>;
}
```

to:

```ts
export interface CreateSchoolsOptions {
  readonly detail?: DetailLevel;
  readonly countScale?: number;
  readonly enabledSpecies?: Readonly<Record<string, boolean>>;
  readonly coralClusterCenters?: readonly Vector3[];
}
```

Change `createSchools`'s body:

```ts
  return registry.map((species) => {
    const school = new FishSchool(species, rng, options.detail ?? "medium");
```

to:

```ts
  return registry.map((species) => {
    const school = new FishSchool(species, rng, options.detail ?? "medium", options.coralClusterCenters ?? []);
```

- [ ] **Step 4: Wire it in `main.ts`**

Change:

```ts
  const schools = createSchools(undefined, rng, {
    detail: settings.fish.detail,
    countScale: settings.fish.countScale,
    enabledSpecies: settings.fish.enabledSpecies,
  });
```

to:

```ts
  const schools = createSchools(undefined, rng, {
    detail: settings.fish.detail,
    countScale: settings.fish.countScale,
    enabledSpecies: settings.fish.enabledSpecies,
    coralClusterCenters: environment.coralClusterCenters,
  });
```

- [ ] **Step 5: Run the focused test and verify it passes**

Run: `npm --prefix web run test -- src/fish.test.ts`

Expected: the 60-second acceptance test passes. This is the slowest test in the suite (3600 steps × 9 schools) — if it takes more than a few seconds, that's fine; it should still complete well within Vitest's default timeout.

- [ ] **Step 6: Run the complete verification**

Run: `npm --prefix web run test && npm --prefix web run build`

Expected: all tests pass; the production build succeeds.

- [ ] **Step 7: Manual visual check**

Run: `npm --prefix web run preview`, open the app, and eyeball for at least 30 seconds:
- Reef fish (yellow-tang, butterflyfish, purple-tang) should visibly loiter near one area of coral instead of roaming the whole tank.
- The shark and turtle should turn in slow, wide arcs rather than snapping direction.
- Swimming should show a subtle speed-up/slow-down cadence rather than perfectly constant motion.
- Check `window.__aq` in the console still reports `calls < 30` and `triangles < 300000`.

This manual pass is the acceptance criterion "개선 전후 영상을 보고 사용자가 움직임 차이를 구별하는지 확인" from §4.3 — it isn't automatable; report what you observed.

- [ ] **Step 8: Commit**

```bash
git add web/src/main.ts web/src/fish.ts web/src/fish.test.ts
git commit -m "feat: wire real coral cluster centers into fish schools; add §4.3 acceptance test"
```
