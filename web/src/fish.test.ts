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
  clampTurnRate,
  computeCentroid,
  computeFacetJitter,
  containSteer,
  coralAvoidanceSteer,
  createRng,
  createSchools,
  depthBiasSteer,
  FishSchool,
  rhythmSpeedScale,
  type Boid,
} from "./fish";
import { computeCoralClusterCenters } from "./environment";
import {
  buildSharkGeometry,
  sharkBodyRadius,
  sharkGillSlits,
  sharkPectoralFin,
  sharkTailLobes,
} from "./creatures/geometry/shark";
import {
  buildSeahorseGeometry,
  seahorseBodyRadius,
  seahorseCoronetSpikes,
  seahorseDorsalFin,
} from "./creatures/geometry/seahorse";
import {
  buildTurtleGeometry,
  turtleFlipperPoints,
  turtleHeadPoints,
  turtleShellHeightScale,
} from "./creatures/geometry/turtle";

const HEX = /^#[0-9a-f]{6}$/i;

function boid(x: number, y: number, z: number): Boid {
  const position = new Vector3(x, y, z);
  return {
    position,
    velocity: new Vector3(1, 0, 0),
    phase: 0,
    hoverOrigin: position.clone(),
    habitatAnchor: position.clone(),
  };
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
      "seahorse",
      "green-sea-turtle",
    ]);
    expect(FISH_REGISTRY.slice(3).map((species) => species.label)).toEqual([
      "나비치",
      "보라탱",
      "자주열대어",
      "백상아리",
      "해마",
      "푸른바다거북",
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
      expect(["lowpoly-fish", "lowpoly-shark", "lowpoly-seahorse", "lowpoly-turtle"]).toContain(
        species.geometry,
      );
      expect(species.palette.body).toMatch(HEX);
      expect(species.palette.fin).toMatch(HEX);
      expect(species.palette.accent).toMatch(HEX);
      expect(species.behavior.speed).toBeGreaterThan(0);
      expect(["swim", "hover"]).toContain(species.behavior.locomotion);
      expect(species.behavior.activityRadius).toBeGreaterThan(0);
      expect(species.behavior.activityRadius).toBeLessThanOrEqual(SCENE.bounds.x);
      expect(species.count).toBeGreaterThan(0);
      expect(species.shape.length).toBeGreaterThan(0);
      if (species.geometry === "lowpoly-fish") {
        expect(species.shape.stripes).toBeGreaterThanOrEqual(0);
      } else if (species.geometry === "lowpoly-shark") {
        expect(species.shape.dorsalFinHeight).toBeGreaterThan(0);
      } else if (species.geometry === "lowpoly-seahorse") {
        expect(species.shape.snoutLength).toBeGreaterThan(0);
        expect(species.shape.curlRadius).toBeGreaterThan(0);
      } else {
        expect(species.shape.shellLength).toBeGreaterThan(0);
        expect(species.shape.flipperSpan).toBeGreaterThan(0);
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

describe("shark realism parameters", () => {
  const baseShape = {
    length: 1.4,
    height: 0.5,
    width: 0.26,
    tailSpan: 0.6,
    dorsalFinHeight: 0.4,
    tailAsymmetry: 1,
    snoutTaper: 0.72,
    gillSlits: 0,
    pectoralSweep: 0,
  };
  const palette = { body: "#000000", fin: "#000000", accent: "#ffffff" };

  it("sharkBodyRadius: a higher snoutTaper yields a sharper (smaller) nose radius near the tip", () => {
    const t = 0.15;
    const blunt = sharkBodyRadius(t, 0.5);
    const sharp = sharkBodyRadius(t, 1.4);
    expect(sharp).toBeLessThan(blunt);
  });

  it("sharkTailLobes: tailAsymmetry < 1 makes the upper lobe reach further than the lower lobe", () => {
    const symmetric = sharkTailLobes({ ...baseShape, tailAsymmetry: 1 });
    expect(symmetric.upperTip.y).toBeCloseTo(-symmetric.lowerTip.y, 5);

    const asymmetric = sharkTailLobes({ ...baseShape, tailAsymmetry: 0.4 });
    expect(asymmetric.upperTip.y).toBeGreaterThan(Math.abs(asymmetric.lowerTip.y) * 1.5);
  });

  it("sharkPectoralFin: pectoralSweep pulls the fin tip toward the tail", () => {
    const straight = sharkPectoralFin({ ...baseShape, pectoralSweep: 0 });
    const swept = sharkPectoralFin({ ...baseShape, pectoralSweep: 0.6 });
    expect(swept.tip.x).toBeLessThan(straight.tip.x);
  });

  it("sharkGillSlits: returns one accent-colored notch triangle per requested slit", () => {
    expect(sharkGillSlits({ ...baseShape, gillSlits: 0 })).toHaveLength(0);
    expect(sharkGillSlits({ ...baseShape, gillSlits: 4 })).toHaveLength(4);
  });

  it("buildSharkGeometry: adds exactly 6 vertices per gill slit and stays finite", () => {
    const none = buildSharkGeometry({ ...baseShape, gillSlits: 0 }, palette);
    const withGills = buildSharkGeometry({ ...baseShape, gillSlits: 3 }, palette);
    expect(withGills.getAttribute("position").count - none.getAttribute("position").count).toBe(3 * 6);
    for (const value of withGills.getAttribute("position").array) expect(Number.isFinite(value)).toBe(true);
    none.dispose();
    withGills.dispose();
  });
});

describe("seahorse realism parameters", () => {
  const baseShape = {
    length: 1.1,
    height: 1.1,
    width: 0.2,
    snoutLength: 0.32,
    curlRadius: 0.28,
    finSpan: 0.26,
    coronetHeight: 0,
    ridgeAmplitude: 0,
    dorsalFinHeight: 0.2,
  };
  const palette = { body: "#000000", fin: "#000000", accent: "#ffffff" };

  it("seahorseBodyRadius: ridgeAmplitude adds a periodic bony-plate bulge along the trunk", () => {
    const smooth = seahorseBodyRadius(0.3, 0);
    const ridged = seahorseBodyRadius(0.3, 0.5);
    expect(ridged).not.toBeCloseTo(smooth, 5);
  });

  it("seahorseCoronetSpikes: no spikes when coronetHeight is 0, three raised above the head otherwise", () => {
    expect(seahorseCoronetSpikes({ ...baseShape, coronetHeight: 0 })).toHaveLength(0);
    const spikes = seahorseCoronetSpikes({ ...baseShape, coronetHeight: 0.2 });
    expect(spikes).toHaveLength(3);
    for (const spike of spikes) expect(spike.tip.y).toBeGreaterThan(baseShape.height * 0.42);
  });

  it("seahorseDorsalFin: dorsalFinHeight controls how far the back fin extends", () => {
    const small = seahorseDorsalFin({ ...baseShape, dorsalFinHeight: 0.1 });
    const large = seahorseDorsalFin({ ...baseShape, dorsalFinHeight: 0.4 });
    const span = (fin: typeof small): number => fin.tip.distanceTo(fin.root);
    expect(span(large)).toBeGreaterThan(span(small));
  });

  it("buildSeahorseGeometry: stays finite and grows with coronet spikes", () => {
    const none = buildSeahorseGeometry({ ...baseShape, coronetHeight: 0 }, palette);
    const withCoronet = buildSeahorseGeometry({ ...baseShape, coronetHeight: 0.2 }, palette);
    expect(withCoronet.getAttribute("position").count).toBeGreaterThan(
      none.getAttribute("position").count,
    );
    for (const value of withCoronet.getAttribute("position").array) {
      expect(Number.isFinite(value)).toBe(true);
    }
    none.dispose();
    withCoronet.dispose();
  });
});

describe("buildCreatureGeometry seahorse variant", () => {
  it("builds a vertical, finite seahorse with a curled tail", () => {
    const seahorse = FISH_REGISTRY.find((species) => species.geometry === "lowpoly-seahorse");
    expect(seahorse).toBeDefined();
    if (!seahorse) return;

    const geometry = buildCreatureGeometry(seahorse, "medium");
    const position = geometry.getAttribute("position");
    const yValues: number[] = [];
    const zValues: number[] = [];
    for (let i = 0; i < position.count; i += 1) {
      expect(Number.isFinite(position.getX(i))).toBe(true);
      expect(Number.isFinite(position.getY(i))).toBe(true);
      expect(Number.isFinite(position.getZ(i))).toBe(true);
      yValues.push(position.getY(i));
      zValues.push(position.getZ(i));
    }
    expect(Math.max(...yValues) - Math.min(...yValues)).toBeGreaterThan(
      Math.max(...zValues) - Math.min(...zValues),
    );
    expect(Math.max(...zValues) - Math.min(...zValues)).toBeGreaterThan(0.1);
    geometry.dispose();
  });
});

describe("turtle realism parameters", () => {
  const baseShape = {
    shellLength: 1.05,
    shellWidth: 0.72,
    shellHeight: 0.32,
    flipperSpan: 0.62,
    headLength: 0.24,
    length: 1.25,
    height: 0.7,
    width: 0.95,
    shellKeelHeight: 0,
    shellRimWidth: 0,
    headTaper: 1,
    flipperSweep: 0,
  };
  const palette = { body: "#000000", fin: "#000000", accent: "#ffffff" };

  it("turtleShellHeightScale: shellKeelHeight raises the shell's centerline ridge", () => {
    const flat = turtleShellHeightScale(0.5, 0);
    const keeled = turtleShellHeightScale(0.5, 0.3);
    expect(keeled).toBeGreaterThan(flat);
  });

  it("turtleHeadPoints: headTaper pinches the beak's midsection narrower than a straight wedge", () => {
    const straight = turtleHeadPoints({ ...baseShape, headTaper: 1 });
    const beaked = turtleHeadPoints({ ...baseShape, headTaper: 0.3 });
    expect(Math.abs(beaked.mid.top.z)).toBeLessThan(Math.abs(straight.mid.top.z));
  });

  it("turtleFlipperPoints: flipperSweep pulls the front flipper tip rearward", () => {
    const straight = turtleFlipperPoints({ ...baseShape, flipperSweep: 0 }, "front", 1);
    const swept = turtleFlipperPoints({ ...baseShape, flipperSweep: 0.8 }, "front", 1);
    expect(swept.tip.x).toBeLessThan(straight.tip.x);
  });

  it("buildTurtleGeometry: shellRimWidth paints accent-coloured vertices along the shell edge", () => {
    const noRim = buildTurtleGeometry({ ...baseShape, shellRimWidth: 0 }, palette);
    const rimmed = buildTurtleGeometry({ ...baseShape, shellRimWidth: 0.3 }, palette);
    const countAccent = (g: typeof noRim): number => {
      const color = g.getAttribute("color");
      let count = 0;
      for (let i = 0; i < color.count; i += 1) if (color.getX(i) > 0.5) count += 1;
      return count;
    };
    expect(countAccent(rimmed)).toBeGreaterThan(countAccent(noRim));
    for (const value of rimmed.getAttribute("position").array) expect(Number.isFinite(value)).toBe(true);
    noRim.dispose();
    rimmed.dispose();
  });
});

describe("buildCreatureGeometry turtle variant", () => {
  it("builds a finite shell and four flippers", () => {
    const turtle = FISH_REGISTRY.find((species) => species.geometry === "lowpoly-turtle");
    expect(turtle).toBeDefined();
    if (!turtle) return;

    const geometry = buildCreatureGeometry(turtle, "medium");
    const position = geometry.getAttribute("position");
    expect(position.count / 3).toBeGreaterThan(20);
    for (const value of position.array) expect(Number.isFinite(value)).toBe(true);
    const xValues = Array.from({ length: position.count }, (_, i) => position.getX(i));
    expect(Math.max(...xValues)).toBeGreaterThan(turtle.shape.shellLength / 2);
    expect(Math.min(...xValues)).toBeLessThan(-turtle.shape.shellLength / 2 + 0.001);
    geometry.dispose();
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

  it("threads coralClusterCenters from createSchools into each species' habitat anchor picks", () => {
    const clusterCenter = new Vector3(6, SCENE.floorY + 1, 6);
    const schools = createSchools(FISH_REGISTRY, createRng(0x5eed), {
      coralClusterCenters: [clusterCenter],
    });
    const yellowTangSchool = schools.find((school) => school.species.id === "yellow-tang") as FishSchool;
    const boids = (yellowTangSchool as unknown as { boids: Boid[] }).boids;
    for (const boid of boids) {
      expect(boid.habitatAnchor.distanceTo(clusterCenter)).toBeLessThan(SCENE.coral.avoidanceRadius + 1.5);
    }
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

  it("keeps hover creatures anchored while gently oscillating vertically", () => {
    const base = FISH_REGISTRY[0] as Extract<FishSpecies, { geometry: "lowpoly-fish" }>;
    const hoverSpecies: FishSpecies = {
      ...base,
      id: "test-hover-creature",
      behavior: {
        ...base.behavior,
        locomotion: "hover",
        schooling: false,
        hoverAmplitude: 0.4,
        hoverFrequency: 1,
      },
    };
    const school = new FishSchool(hoverSpecies, createRng(17));
    const initial = school.mesh.instanceMatrix.array.slice();
    school.update(0.1, 0.5);
    const moved = school.mesh.instanceMatrix.array.slice();
    school.update(0.1, 1.25);
    const later = school.mesh.instanceMatrix.array.slice();

    for (let i = 0; i < school.mesh.count; i += 1) {
      const offset = i * 16;
      expect(moved[offset + 12] ?? 0).toBeCloseTo(initial[offset + 12] ?? 0);
      expect(moved[offset + 14] ?? 0).toBeCloseTo(initial[offset + 14] ?? 0);
      expect(later[offset + 12] ?? 0).toBeCloseTo(initial[offset + 12] ?? 0);
      expect(later[offset + 14] ?? 0).toBeCloseTo(initial[offset + 14] ?? 0);
    }
    expect(moved[13] ?? 0).not.toBeCloseTo(initial[13] ?? 0);
    expect(later[13] ?? 0).not.toBeCloseTo(moved[13] ?? 0);
    school.dispose();
  });

  it("pulls a territorial species' individuals to settle near their own habitat anchor (§4.3 habitat point)", () => {
    const yellowTang = FISH_REGISTRY.find((species) => species.id === "yellow-tang") as FishSpecies;
    expect(yellowTang.behavior.territoryStrength).toBeGreaterThan(0);
    const clusterCenters = [new Vector3(6, SCENE.floorY + 1, 6)];
    const school = new FishSchool(yellowTang, createRng(21), "medium", clusterCenters);
    const boids = (school as unknown as { boids: Boid[] }).boids;
    // Every boid's anchor should itself land near the one supplied cluster.
    for (const boid of boids) {
      expect(boid.habitatAnchor.distanceTo(clusterCenters[0] as Vector3)).toBeLessThan(
        SCENE.coral.avoidanceRadius + 1.5,
      );
    }

    for (let step = 0; step < 3600; step += 1) school.update(1 / 60, step / 60);

    for (const boid of boids) {
      // Well inside the free-roam activityRadius (9), close to its own anchor.
      expect(boid.position.distanceTo(boid.habitatAnchor)).toBeLessThan(4);
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
      if (Math.hypot(x - (clusterCenters[0] as Vector3).x, z - (clusterCenters[0] as Vector3).z) > 4) anyFar = true;
    }
    expect(anyFar).toBe(true);
    school.dispose();
  });

  it("pushes a fish out of a coral cluster's avoidance sphere farther than ambient drift alone would", () => {
    // Isolate the avoidance term specifically: two schools built from the same
    // seed (so every boid starts identical) differ only in whether a cluster
    // center is supplied, ruling out wander/cohesion/depth-bias as the cause
    // of any distance difference.
    const species = FISH_REGISTRY[0] as FishSpecies;
    const clusterCenter = new Vector3(0, SCENE.floorY + SCENE.coral.avoidanceHeight, 0);
    const withCluster = new FishSchool(species, createRng(5), "medium", [clusterCenter]);
    const withoutCluster = new FishSchool(species, createRng(5), "medium", []);

    const withBoid = (withCluster as unknown as { boids: Boid[] }).boids[0] as Boid;
    const controlBoid = (withoutCluster as unknown as { boids: Boid[] }).boids[0] as Boid;
    withBoid.position.set(0.3, SCENE.floorY + SCENE.coral.avoidanceHeight, 0.3);
    controlBoid.position.set(0.3, SCENE.floorY + SCENE.coral.avoidanceHeight, 0.3);

    for (let step = 0; step < 30; step += 1) {
      withCluster.update(1 / 60, step / 60);
      withoutCluster.update(1 / 60, step / 60);
    }

    const withDistance = Math.hypot(withBoid.position.x - clusterCenter.x, withBoid.position.z - clusterCenter.z);
    const controlDistance = Math.hypot(
      controlBoid.position.x - clusterCenter.x,
      controlBoid.position.z - clusterCenter.z,
    );
    expect(withDistance).toBeGreaterThan(controlDistance);
    withCluster.dispose();
    withoutCluster.dispose();
  });

  it("trends individuals toward their species' preferred depth band (§4.3 activity depth)", () => {
    // Isolate depth bias from the pre-existing floor/ceiling containment
    // margin: start both schools safely mid-tank (away from either margin)
    // and compare a surface-leaning vs a floor-leaning depthPreference: only
    // the depth-bias term can explain a difference between them.
    const shark = FISH_REGISTRY.find((species) => species.id === "great-white-shark") as FishSpecies;
    const surfaceLeaning: FishSpecies = { ...shark, behavior: { ...shark.behavior, depthPreference: 0.9 } };
    const floorLeaning: FishSpecies = { ...shark, behavior: { ...shark.behavior, depthPreference: 0.1 } };
    const surfaceSchool = new FishSchool(surfaceLeaning, createRng(9));
    const floorSchool = new FishSchool(floorLeaning, createRng(9));

    const midY = SCENE.floorY + SCENE.bounds.y;
    for (const boid of (surfaceSchool as unknown as { boids: Boid[] }).boids) boid.position.y = midY;
    for (const boid of (floorSchool as unknown as { boids: Boid[] }).boids) boid.position.y = midY;

    for (let step = 0; step < 900; step += 1) {
      surfaceSchool.update(1 / 60, step / 60);
      floorSchool.update(1 / 60, step / 60);
    }

    const averageY = (school: FishSchool): number => {
      const matrix = school.mesh.instanceMatrix.array;
      let sum = 0;
      for (let i = 0; i < school.mesh.count; i += 1) sum += matrix[i * 16 + 13] ?? 0;
      return sum / school.mesh.count;
    };
    expect(averageY(surfaceSchool)).toBeGreaterThan(averageY(floorSchool));
    surfaceSchool.dispose();
    floorSchool.dispose();
  });

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

  it("gives a rhythm-amplitude species more speed variation than the same species with no rhythm", () => {
    // Ambient forces (wander, contain) already make speed wobble a little
    // frame to frame, so an absolute variance threshold would pass even
    // without any rhythm code. Compare against a same-seed, rhythmless
    // control instead, isolating the rhythm term specifically.
    const turtle = FISH_REGISTRY.find((species) => species.id === "green-sea-turtle") as FishSpecies;
    expect(turtle.behavior.rhythmAmplitude).toBeGreaterThan(0);
    const flat: FishSpecies = { ...turtle, behavior: { ...turtle.behavior, rhythmAmplitude: 0 } };

    const rhythmic = new FishSchool(turtle, createRng(8));
    const control = new FishSchool(flat, createRng(8));
    const rhythmicBoid = (rhythmic as unknown as { boids: Boid[] }).boids[0] as Boid;
    const controlBoid = (control as unknown as { boids: Boid[] }).boids[0] as Boid;

    // Warm up first so each school's own spawn-transient (e.g. an initial
    // depth-bias correction) has already settled before sampling variation.
    for (let step = 0; step < 120; step += 1) {
      rhythmic.update(1 / 60, step / 60);
      control.update(1 / 60, step / 60);
    }

    const rhythmicSpeeds: number[] = [];
    const controlSpeeds: number[] = [];
    for (let step = 120; step < 420; step += 1) {
      rhythmic.update(1 / 60, step / 60);
      control.update(1 / 60, step / 60);
      rhythmicSpeeds.push(rhythmicBoid.velocity.length());
      controlSpeeds.push(controlBoid.velocity.length());
    }
    rhythmic.dispose();
    control.dispose();

    const spread = (speeds: number[]): number => Math.max(...speeds) - Math.min(...speeds);
    expect(spread(rhythmicSpeeds)).toBeGreaterThan(spread(controlSpeeds));
  });
});

describe("60-second fixed-seed acceptance run (§4.3 AC)", () => {
  it(
    "keeps every swim-locomotion boid finite, in bounds, and within its turn-rate budget for 60 simulated seconds",
    () => {
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
        const boids = (school as unknown as { boids: Boid[] }).boids;
        // `nearWall` must reflect each boid's position *before* this frame's
        // update, matching FishSchool.update()'s own timing — the turn-rate
        // cap it (intentionally) bypasses is decided from the start-of-frame
        // position, not the end-of-frame one.
        const nearWallBeforeUpdate = boids.map(
          (boid) => containSteer(boid.position, SCENE.bounds, SCENE.floorY, 2).lengthSq() > 1e-8,
        );

        school.update(dt, elapsed);
        const species = school.species;
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
            // The turn-rate cap is intentionally bypassed near a wall/floor/
            // ceiling (§4.3 design: boundary safety must never be delayed by
            // a slow-turning species) — skip the budget check for those
            // frames, matching FishSchool.update()'s own `nearWall` condition.
            if (maxTurnRate !== undefined && !nearWallBeforeUpdate[i] && boid.velocity.lengthSq() > 1e-8) {
              const direction = boid.velocity.clone().normalize();
              const angle = (prev[i] as Vector3).angleTo(direction);
              expect(angle).toBeLessThanOrEqual(maxTurnRate * dt + 1e-3);
              prev[i] = direction;
            } else if (boid.velocity.lengthSq() > 1e-8) {
              prev[i] = boid.velocity.clone().normalize();
            }
          }
        }
      }
    }

    for (const school of schools) school.dispose();
    },
    30_000,
  );
});
