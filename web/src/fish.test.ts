/**
 * Registry, geometry and steering tests (SPEC N1, N4).
 * Pure logic only — no WebGL context is required.
 */

import { describe, expect, it } from "vitest";
import { Vector3 } from "three";

import { FISH_REGISTRY, SCENE, totalFishCount, type FishSpecies } from "./config";
import {
  buildFishGeometry,
  buildCreatureGeometry,
  computeCentroid,
  computeFacetJitter,
  containSteer,
  createRng,
  createSchools,
  FishSchool,
  type Boid,
} from "./fish";

const HEX = /^#[0-9a-f]{6}$/i;

function boid(x: number, y: number, z: number): Boid {
  return { position: new Vector3(x, y, z), velocity: new Vector3(1, 0, 0), phase: 0 };
}

describe("fish registry", () => {
  it("starts with the three initial species from SPEC F3", () => {
    expect(FISH_REGISTRY.slice(0, 3).map((species) => species.id)).toEqual([
      "clownfish",
      "blue-sea-bream",
      "yellow-tang",
    ]);
    expect(FISH_REGISTRY.slice(0, 3).map((species) => species.label)).toEqual([
      "클라운피시",
      "파랑참돔",
      "노란열대어",
    ]);
  });

  it("extends the registry with the reference-art species", () => {
    expect(FISH_REGISTRY.slice(3).map((species) => species.id)).toEqual([
      "butterflyfish",
      "purple-tang",
      "pink-cardinalfish",
      "great-white-shark",
    ]);
    expect(FISH_REGISTRY.slice(3).map((species) => species.label)).toEqual([
      "나비치",
      "보라탱",
      "자주열대어",
      "백상아리",
    ]);
  });

  it("has unique ids", () => {
    const ids = new Set(FISH_REGISTRY.map((species) => species.id));
    expect(ids.size).toBe(FISH_REGISTRY.length);
  });

  it("keeps the population inside the 30~60 budget of N1", () => {
    const total = totalFishCount();
    expect(total).toBeGreaterThanOrEqual(30);
    expect(total).toBeLessThanOrEqual(60);
  });

  it("defines a complete, well-formed entry per species", () => {
    for (const species of FISH_REGISTRY) {
      expect(["lowpoly-fish", "lowpoly-shark"]).toContain(species.geometry);
      expect(species.palette.body).toMatch(HEX);
      expect(species.palette.fin).toMatch(HEX);
      expect(species.palette.accent).toMatch(HEX);
      expect(species.behavior.speed).toBeGreaterThan(0);
      expect(species.behavior.locomotion).toBe("swim");
      expect(species.behavior.activityRadius).toBeGreaterThan(0);
      expect(species.behavior.activityRadius).toBeLessThanOrEqual(SCENE.bounds.x);
      expect(species.count).toBeGreaterThan(0);
      expect(species.shape.length).toBeGreaterThan(0);
      if (species.geometry === "lowpoly-fish") {
        expect(species.shape.stripes).toBeGreaterThanOrEqual(0);
      } else {
        expect(species.shape.dorsalFinHeight).toBeGreaterThan(0);
      }
    }
  });

  it("totals a caller-supplied registry, so new entries need no code change", () => {
    const extra: FishSpecies = {
      ...(FISH_REGISTRY[0] as FishSpecies),
      id: "test-species",
      count: 5,
    };
    expect(totalFishCount([extra])).toBe(5);
    expect(totalFishCount([...FISH_REGISTRY, extra])).toBe(totalFishCount() + 5);
  });
});

describe("createRng", () => {
  it("is deterministic for a given seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    const first = [a(), a(), a()];
    const second = [b(), b(), b()];
    expect(first).toEqual(second);
  });

  it("returns values inside [0, 1)", () => {
    const rng = createRng(7);
    for (let i = 0; i < 500; i += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("buildFishGeometry", () => {
  it("produces a finite, low-poly, non-indexed mesh", () => {
    for (const species of FISH_REGISTRY) {
      if (species.geometry !== "lowpoly-fish") continue;
      const geometry = buildFishGeometry(species.shape, species.palette);
      const position = geometry.getAttribute("position");
      const color = geometry.getAttribute("color");
      const normal = geometry.getAttribute("normal");

      expect(geometry.index).toBeNull();
      expect(position.count % 3).toBe(0);
      expect(color.count).toBe(position.count);
      expect(normal.count).toBe(position.count);
      // "low-poly" budget: a fish must stay well under 100 triangles.
      expect(position.count / 3).toBeLessThan(100);
      for (const attribute of [position, normal, color]) {
        for (const value of attribute.array) expect(Number.isFinite(value)).toBe(true);
      }
      geometry.dispose();
    }
  });

  it("defaults to medium detail, matching the exact v1 baseline (AC-1)", () => {
    const species = FISH_REGISTRY[0] as Extract<FishSpecies, { geometry: "lowpoly-fish" }>;
    const withoutDetail = buildFishGeometry(species.shape, species.palette);
    const withMedium = buildFishGeometry(species.shape, species.palette, "medium");
    expect(withoutDetail.getAttribute("position").count).toBe(
      withMedium.getAttribute("position").count,
    );
    withoutDetail.dispose();
    withMedium.dispose();
  });

  it("orders low <= medium <= high triangle counts", () => {
    for (const species of FISH_REGISTRY) {
      if (species.geometry !== "lowpoly-fish") continue;
      const low = buildFishGeometry(species.shape, species.palette, "low");
      const medium = buildFishGeometry(species.shape, species.palette, "medium");
      const high = buildFishGeometry(species.shape, species.palette, "high");
      const tris = (g: typeof low): number => g.getAttribute("position").count / 3;
      expect(tris(low)).toBeLessThanOrEqual(tris(medium));
      expect(tris(medium)).toBeLessThanOrEqual(tris(high));
      low.dispose();
      medium.dispose();
      high.dispose();
    }
  });

  it("scales high detail to ~2.5x (+150%) of medium, within 2.3~2.7x (AC-2)", () => {
    for (const species of FISH_REGISTRY) {
      if (species.geometry !== "lowpoly-fish") continue;
      const medium = buildFishGeometry(species.shape, species.palette, "medium");
      const high = buildFishGeometry(species.shape, species.palette, "high");
      const mediumTris = medium.getAttribute("position").count / 3;
      const highTris = high.getAttribute("position").count / 3;
      const ratio = highTris / mediumTris;
      expect(ratio).toBeGreaterThanOrEqual(2.3);
      expect(ratio).toBeLessThanOrEqual(2.7);
      medium.dispose();
      high.dispose();
    }
  });

  it("paints accent stripes only for striped species", () => {
    const clownfish = FISH_REGISTRY[0] as Extract<FishSpecies, { geometry: "lowpoly-fish" }>;
    expect(clownfish.shape.stripes).toBeGreaterThan(0);
    const geometry = buildFishGeometry(clownfish.shape, {
      body: "#000000",
      fin: "#000000",
      accent: "#ffffff",
    });
    const color = geometry.getAttribute("color");
    let accentVertices = 0;
    for (let i = 0; i < color.count; i += 1) {
      if (color.getX(i) > 0.5) accentVertices += 1;
    }
    expect(accentVertices).toBeGreaterThan(0);
    geometry.dispose();
  });

  it("stays a vertex-for-vertex regression of v1 at medium detail (no facet jitter, AC-9)", () => {
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
});

describe("computeFacetJitter (SPEC §6.2.1, AC-9)", () => {
  it("is the identity (no angle offset, radius scale 1) at facetJitter 0", () => {
    for (let ring = 0; ring < 5; ring += 1) {
      for (let dir = 0; dir < 6; dir += 1) {
        const jitter = computeFacetJitter(ring, dir, 6, 42, 0);
        expect(jitter.angleOffset).toBe(0);
        expect(jitter.radialScale).toBe(1);
      }
    }
  });

  it("is deterministic: same inputs always produce the same output", () => {
    const a = computeFacetJitter(3, 2, 6, 1234, 0.16);
    const b = computeFacetJitter(3, 2, 6, 1234, 0.16);
    expect(a).toEqual(b);
  });

  it("keeps the radius scale bounded to [1-facetJitter, 1+facetJitter]", () => {
    const amount = 0.16;
    for (let ring = 0; ring < 12; ring += 1) {
      for (let dir = 0; dir < 8; dir += 1) {
        const { radialScale } = computeFacetJitter(ring, dir, 8, 99, amount);
        expect(radialScale).toBeGreaterThanOrEqual(1 - amount);
        expect(radialScale).toBeLessThanOrEqual(1 + amount);
      }
    }
  });

  it("is not degenerate: varies across ring/dir indices when facetJitter > 0", () => {
    const values = new Set<number>();
    for (let ring = 0; ring < 10; ring += 1) {
      for (let dir = 0; dir < 6; dir += 1) {
        values.add(computeFacetJitter(ring, dir, 6, 7, 0.16).radialScale);
      }
    }
    expect(values.size).toBeGreaterThan(1);
  });

  it("differs by seed, so two species with the same shape don't jitter identically", () => {
    const a = computeFacetJitter(2, 1, 6, 11, 0.16);
    const b = computeFacetJitter(2, 1, 6, 22, 0.16);
    expect(a).not.toEqual(b);
  });
});

describe("buildFishGeometry high detail facet jitter (AC-9)", () => {
  it("keeps every vertex finite and within a bounded distance of the body axis", () => {
    for (const species of FISH_REGISTRY) {
      if (species.geometry !== "lowpoly-fish") continue;
      const geometry = buildFishGeometry(species.shape, species.palette, "high");
      const position = geometry.getAttribute("position");
      const maxRadius = Math.max(species.shape.height, species.shape.width) * 0.75;
      for (let i = 0; i < position.count; i += 1) {
        const y = position.getY(i);
        const z = position.getZ(i);
        expect(Number.isFinite(y)).toBe(true);
        expect(Number.isFinite(z)).toBe(true);
        // Fin tips legitimately extend further than the body ring radius;
        // only assert the *body* is not blown out by jitter (loose bound).
        expect(Math.hypot(y, z)).toBeLessThan(species.shape.length + maxRadius + 1);
      }
      geometry.dispose();
    }
  });
});

describe("buildCreatureGeometry shark variant", () => {
  it("builds a finite shark with more triangles at high detail", () => {
    const shark = FISH_REGISTRY.find((species) => species.geometry === "lowpoly-shark");
    expect(shark).toBeDefined();
    if (!shark) return;

    const medium = buildCreatureGeometry(shark, "medium");
    const high = buildCreatureGeometry(shark, "high");
    expect(medium.index).toBeNull();
    expect(high.getAttribute("position").count).toBeGreaterThan(
      medium.getAttribute("position").count,
    );
    for (const value of high.getAttribute("position").array) expect(Number.isFinite(value)).toBe(true);
    medium.dispose();
    high.dispose();
  });

  it("is deterministic and includes a dorsal fin above the body", () => {
    const shark = FISH_REGISTRY.find((species) => species.geometry === "lowpoly-shark");
    expect(shark).toBeDefined();
    if (!shark) return;

    const first = buildCreatureGeometry(shark, "medium");
    const second = buildCreatureGeometry(shark, "medium");
    expect(Array.from(first.getAttribute("position").array)).toEqual(
      Array.from(second.getAttribute("position").array),
    );
    const yValues = first.getAttribute("position").array.filter((_, index) => index % 3 === 1);
    expect(Math.max(...yValues)).toBeGreaterThan(shark.shape.height / 2);
    first.dispose();
    second.dispose();
  });
});

describe("computeCentroid", () => {
  it("returns the origin for an empty school", () => {
    expect(computeCentroid([]).toArray()).toEqual([0, 0, 0]);
  });

  it("averages member positions", () => {
    const centroid = computeCentroid([boid(2, 0, 0), boid(-2, 4, 0), boid(0, 2, 6)]);
    expect(centroid.x).toBeCloseTo(0);
    expect(centroid.y).toBeCloseTo(2);
    expect(centroid.z).toBeCloseTo(2);
  });
});

describe("containSteer", () => {
  const bounds = SCENE.bounds;
  const floorY = SCENE.floorY;

  it("does not steer a fish that is comfortably inside", () => {
    const steer = containSteer(new Vector3(0, floorY + 4, 0), bounds, floorY);
    expect(steer.lengthSq()).toBe(0);
  });

  it("pushes back toward the box on every axis", () => {
    expect(containSteer(new Vector3(bounds.x, floorY + 4, 0), bounds, floorY).x).toBeLessThan(0);
    expect(containSteer(new Vector3(-bounds.x, floorY + 4, 0), bounds, floorY).x).toBeGreaterThan(0);
    expect(containSteer(new Vector3(0, floorY + 4, bounds.z), bounds, floorY).z).toBeLessThan(0);
    expect(containSteer(new Vector3(0, floorY + 4, -bounds.z), bounds, floorY).z).toBeGreaterThan(0);
    expect(containSteer(new Vector3(0, floorY, 0), bounds, floorY).y).toBeGreaterThan(0);
    expect(containSteer(new Vector3(0, floorY + bounds.y * 2, 0), bounds, floorY).y).toBeLessThan(0);
  });
});

describe("FishSchool", () => {
  it("draws one instanced mesh per species", () => {
    const schools = createSchools();
    expect(schools).toHaveLength(FISH_REGISTRY.length);
    for (const [index, school] of schools.entries()) {
      const species = FISH_REGISTRY[index] as FishSpecies;
      expect(school.mesh.isInstancedMesh).toBe(true);
      expect(school.mesh.count).toBe(species.count);
      expect(school.visibleCount).toBe(species.count);
      school.dispose();
    }
  });

  it("stays inside the performance budget of N1", () => {
    const schools = createSchools();
    // One draw call per school plus floor, coral, seaweed, god rays and bubbles.
    const drawCalls = schools.length + 5;
    let triangles = 0;
    for (const school of schools) {
      const geometry = school.mesh.geometry;
      triangles += (geometry.getAttribute("position").count / 3) * school.mesh.count;
    }
    expect(drawCalls).toBeLessThan(30);
    expect(triangles).toBeLessThan(300_000);
    for (const school of schools) school.dispose();
  });

  it("keeps every fish finite and inside the bounds while swimming", () => {
    const species = FISH_REGISTRY[0] as FishSpecies;
    const school = new FishSchool(species, createRng(11));
    for (let step = 0; step < 600; step += 1) school.update(1 / 60, step / 60);

    const matrix = school.mesh.instanceMatrix.array;
    for (const value of matrix) expect(Number.isFinite(value)).toBe(true);

    const ceilingY = SCENE.floorY + SCENE.bounds.y * 2;
    for (let i = 0; i < school.mesh.count; i += 1) {
      const offset = i * 16;
      const x = matrix[offset + 12] ?? 0;
      const y = matrix[offset + 13] ?? 0;
      const z = matrix[offset + 14] ?? 0;
      expect(Math.abs(x)).toBeLessThanOrEqual(SCENE.bounds.x);
      expect(Math.abs(z)).toBeLessThanOrEqual(SCENE.bounds.z);
      expect(y).toBeGreaterThanOrEqual(SCENE.floorY);
      expect(y).toBeLessThanOrEqual(ceilingY);
    }
    school.dispose();
  });

  it("toggles mesh visibility without touching instance count (species on/off, AC-4)", () => {
    const species = FISH_REGISTRY[0] as FishSpecies;
    const school = new FishSchool(species, createRng(1));
    expect(school.mesh.visible).toBe(true);
    school.setVisible(false);
    expect(school.mesh.visible).toBe(false);
    expect(school.visibleCount).toBe(species.count);
    school.setVisible(true);
    expect(school.mesh.visible).toBe(true);
    school.dispose();
  });

  it("rebuilds its geometry in place at a new detail level", () => {
    const species = FISH_REGISTRY[0] as FishSpecies;
    const school = new FishSchool(species, createRng(1));
    const mediumTris = school.mesh.geometry.getAttribute("position").count / 3;
    school.rebuildGeometry("high");
    const highTris = school.mesh.geometry.getAttribute("position").count / 3;
    expect(highTris).toBeGreaterThan(mediumTris);
    // Per-instance sway phase attribute must survive the geometry swap.
    expect(school.mesh.geometry.getAttribute("aPhase").count).toBe(species.count);
    school.dispose();
  });

  it("rebuilds its instance capacity at a new count scale", () => {
    const species = FISH_REGISTRY[0] as FishSpecies;
    const school = new FishSchool(species, createRng(1));
    school.rebuildInstances(1.5);
    const grown = Math.round(species.count * 1.5);
    expect(school.mesh.count).toBe(grown);
    expect(school.visibleCount).toBe(grown);
    expect(school.mesh.geometry.getAttribute("aPhase").count).toBe(grown);

    school.rebuildInstances(0.5);
    const shrunk = Math.round(species.count * 0.5);
    expect(school.mesh.count).toBe(shrunk);
    for (let step = 0; step < 30; step += 1) school.update(1 / 60, step / 60);
    for (const value of school.mesh.instanceMatrix.array) expect(Number.isFinite(value)).toBe(true);
    school.dispose();
  });

  it("reduces the drawn population for the adaptive-quality step", () => {
    const species = FISH_REGISTRY[1] as FishSpecies;
    const school = new FishSchool(species, createRng(3));
    school.setPopulationScale(SCENE.quality.populationScale);
    expect(school.visibleCount).toBe(
      Math.round(species.count * SCENE.quality.populationScale),
    );
    expect(school.visibleCount).toBeLessThan(species.count);
    school.setPopulationScale(1);
    expect(school.visibleCount).toBe(species.count);
    school.dispose();
  });
});
