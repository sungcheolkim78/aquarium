/**
 * Background geometry detail/object-count tests (SPEC §6.2, §6.5.4, AC-3).
 * Pure geometry construction only — no WebGL context is required.
 */

import { describe, expect, it } from "vitest";
import { Color, Scene, Vector3 } from "three";

import { BACKGROUND_DETAIL_PROFILES, DEFAULT_ENVIRONMENT_PRESET, SCENE, SEAWEED_COUNT, type EnvironmentPreset } from "./config";
import { createRng } from "./fish";
import {
  classifyBiome,
  computeObjectCounts,
  computeScatterPoints,
  createCoral,
  createEnvironment,
  createFloor,
  createRocks,
  createSeaweed,
  mergeBaked,
  terrainCurvature,
  terrainHeight,
  terrainSlope,
  type Biome,
  type ScatterPoint,
} from "./environment";

function triangleCount(geometry: { getAttribute(name: string): { count: number } }): number {
  return geometry.getAttribute("position").count / 3;
}

const TEST_PRESET: EnvironmentPreset = {
  id: "test",
  label: "Test",
  description: "test preset",
  water: { fogColor: "#111111", fogDensity: 0.02, backgroundColor: "#222222" },
  lighting: { hemisphereSky: "#333333", hemisphereGround: "#444444", sun: "#555555", rim: "#666666" },
  caustics: { tint: "#777777" },
  godRays: { tint: "#888888", opacity: 0.05 },
  floor: { deep: "#101010", sand: "#f0f0f0" },
  coral: { colors: ["#ff00ff"] },
  seaweed: { root: "#0a0a0a", tip: "#eaeaea" },
  bubbles: { tint: "#abcdef" },
  terrain: { relief: 0.6, roughness: 0.4, reefBias: 0.55, cliffBias: 0.2, rockColor: "#7c8a8f" },
};

describe("terrainHeight/terrainSlope/terrainCurvature", () => {
  const flat = { relief: 0, roughness: 0 };
  const normal = { relief: 0.6, roughness: 0.4 };

  it("is deterministic", () => {
    expect(terrainHeight(3, 5, normal)).toBe(terrainHeight(3, 5, normal));
  });

  it("returns exactly 0 everywhere when relief and roughness are both 0", () => {
    for (const [x, z] of [
      [0, 0],
      [5, -3],
      [-12, 8],
    ] as const) {
      expect(terrainHeight(x, z, flat)).toBe(0);
      expect(terrainSlope(x, z, flat)).toBe(0);
      expect(terrainCurvature(x, z, flat)).toBe(0);
    }
  });

  it("curvature is negative at a scanned local height maximum and positive at a scanned local minimum", () => {
    // Full 2D scan (not just along one axis) — terrainCurvature's discrete
    // Laplacian looks at neighbors in *both* x and z, so the found point must
    // be a genuine 2D extremum, not merely a max/min along a single line.
    const roughnessOnly = { relief: 0, roughness: 1 };
    let maxX = 0;
    let maxZ = 0;
    let maxH = -Infinity;
    let minX = 0;
    let minZ = 0;
    let minH = Infinity;
    for (let x = -15; x <= 15; x += 0.25) {
      for (let z = -15; z <= 15; z += 0.25) {
        const h = terrainHeight(x, z, roughnessOnly);
        if (h > maxH) {
          maxH = h;
          maxX = x;
          maxZ = z;
        }
        if (h < minH) {
          minH = h;
          minX = x;
          minZ = z;
        }
      }
    }
    expect(terrainCurvature(maxX, maxZ, roughnessOnly)).toBeLessThan(0);
    expect(terrainCurvature(minX, minZ, roughnessOnly)).toBeGreaterThan(0);
  });
});

describe("classifyBiome", () => {
  const baseTerrain = { relief: 0.6, roughness: 0.4, reefBias: 0.5, cliffBias: 0.2, rockColor: "#888888" };

  function countBiomes(terrain: typeof baseTerrain): Record<Biome, number> {
    const counts: Record<Biome, number> = { sand: 0, reef: 0, cliff: 0 };
    for (let x = -10; x <= 10; x += 1) {
      for (let z = -10; z <= 10; z += 1) {
        counts[classifyBiome(x, z, terrain)] += 1;
      }
    }
    return counts;
  }

  it("is deterministic", () => {
    expect(classifyBiome(4, -6, baseTerrain)).toBe(classifyBiome(4, -6, baseTerrain));
  });

  it("raising reefBias never decreases the reef share across a fixed grid", () => {
    const low = countBiomes({ ...baseTerrain, reefBias: 0.1 });
    const high = countBiomes({ ...baseTerrain, reefBias: 0.9 });
    expect(high.reef).toBeGreaterThanOrEqual(low.reef);
  });

  it("raising cliffBias never decreases the cliff share across a fixed grid", () => {
    const low = countBiomes({ ...baseTerrain, cliffBias: 0.0 });
    const high = countBiomes({ ...baseTerrain, cliffBias: 0.9 });
    expect(high.cliff).toBeGreaterThanOrEqual(low.cliff);
  });
});

describe("computeScatterPoints", () => {
  it("returns one point per requested count, deterministic for the same seed, each finite with a valid biome", () => {
    const terrain = DEFAULT_ENVIRONMENT_PRESET.terrain;
    const a = computeScatterPoints(createRng(3), 22, terrain);
    const b = computeScatterPoints(createRng(3), 22, terrain);
    expect(a).toHaveLength(22);
    for (const point of a) {
      expect(Number.isFinite(point.position.x)).toBe(true);
      expect(Number.isFinite(point.position.y)).toBe(true);
      expect(Number.isFinite(point.position.z)).toBe(true);
      expect(["sand", "reef", "cliff"]).toContain(point.biome);
    }
    expect(a.map((p) => [p.position.x, p.position.y, p.position.z, p.biome])).toEqual(
      b.map((p) => [p.position.x, p.position.y, p.position.z, p.biome]),
    );
  });

  it("the default preset's scatter points include a mix of biomes, not just one", () => {
    const points = computeScatterPoints(createRng(0x5eed_a17c), 60, DEFAULT_ENVIRONMENT_PRESET.terrain);
    const biomes = new Set(points.map((p) => p.biome));
    expect(biomes.size).toBeGreaterThan(1);
  });
});

describe("createRocks", () => {
  it("bakes every vertex to the preset's flat rock color", () => {
    const time = { value: 0 };
    const preset = { ...TEST_PRESET, terrain: { ...TEST_PRESET.terrain, rockColor: "#ff00ff" } };
    const points: ScatterPoint[] = [
      { position: new Vector3(0, 0, 0), biome: "reef" },
      { position: new Vector3(3, 0, 3), biome: "cliff" },
    ];
    const mesh = createRocks(createRng(1), time, BACKGROUND_DETAIL_PROFILES.medium.coral, points, undefined, preset);
    const color = mesh.geometry.getAttribute("color");
    for (let i = 0; i < color.count; i += 1) {
      expect(color.getY(i)).toBe(0);
      expect(color.getX(i)).toBeGreaterThan(0);
      expect(color.getZ(i)).toBeGreaterThan(0);
    }
    mesh.geometry.dispose();
    (mesh.material as { dispose(): void }).dispose();
  });

  it("gives cliff points a taller silhouette than reef points", () => {
    const time = { value: 0 };
    const reefOnly = createRocks(createRng(2), time, BACKGROUND_DETAIL_PROFILES.medium.coral, [
      { position: new Vector3(0, 0, 0), biome: "reef" },
    ]);
    const cliffOnly = createRocks(createRng(2), time, BACKGROUND_DETAIL_PROFILES.medium.coral, [
      { position: new Vector3(0, 0, 0), biome: "cliff" },
    ]);
    reefOnly.geometry.computeBoundingBox();
    cliffOnly.geometry.computeBoundingBox();
    const reefBox = reefOnly.geometry.boundingBox as { min: { y: number }; max: { y: number } };
    const cliffBox = cliffOnly.geometry.boundingBox as { min: { y: number }; max: { y: number } };
    expect(cliffBox.max.y - cliffBox.min.y).toBeGreaterThan(reefBox.max.y - reefBox.min.y);
    reefOnly.geometry.dispose();
    cliffOnly.geometry.dispose();
    (reefOnly.material as { dispose(): void }).dispose();
    (cliffOnly.material as { dispose(): void }).dispose();
  });

  it("produces a finite, non-indexed mesh", () => {
    const time = { value: 0 };
    const points: ScatterPoint[] = [{ position: new Vector3(1, 0, 1), biome: "cliff" }];
    const mesh = createRocks(createRng(4), time, BACKGROUND_DETAIL_PROFILES.medium.coral, points);
    expect(mesh.geometry.index).toBeNull();
    for (const value of mesh.geometry.getAttribute("position").array) {
      expect(Number.isFinite(value)).toBe(true);
    }
    mesh.geometry.dispose();
    (mesh.material as { dispose(): void }).dispose();
  });
});

describe("createFloor cliff tinting", () => {
  it("tints vertices near a cliff scatter point measurably toward the preset's rockColor", () => {
    const time = { value: 0 };
    const preset = { ...TEST_PRESET, terrain: { ...TEST_PRESET.terrain, rockColor: "#00ff00" } };
    const cliffPoint: ScatterPoint = { position: new Vector3(0, 0, 0), biome: "cliff" };
    const withCliff = createFloor(time, 8, undefined, preset, [cliffPoint]);
    const withoutCliff = createFloor(time, 8, undefined, preset, []);
    const colorWith = withCliff.geometry.getAttribute("color");
    const colorWithout = withoutCliff.geometry.getAttribute("color");
    const position = withCliff.geometry.getAttribute("position");

    let nearestIndex = 0;
    let nearestDistSq = Infinity;
    for (let i = 0; i < position.count; i += 1) {
      const dx = position.getX(i) - cliffPoint.position.x;
      const dz = position.getZ(i) - cliffPoint.position.z;
      const distSq = dx * dx + dz * dz;
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearestIndex = i;
      }
    }
    expect(colorWith.getY(nearestIndex)).toBeGreaterThan(colorWithout.getY(nearestIndex));

    withCliff.geometry.dispose();
    withoutCliff.geometry.dispose();
    (withCliff.material as { dispose(): void }).dispose();
    (withoutCliff.material as { dispose(): void }).dispose();
  });
});

describe("environment preset color consumption", () => {
  it("createCoral bakes every vertex from the single supplied coral color", () => {
    const time = { value: 0 };
    const points: ScatterPoint[] = [
      { position: new Vector3(0, 0, 0), biome: "reef" },
      { position: new Vector3(2, 0, 2), biome: "reef" },
      { position: new Vector3(-2, 0, -2), biome: "reef" },
    ];
    const mesh = createCoral(
      createRng(1),
      time,
      BACKGROUND_DETAIL_PROFILES.medium.coral,
      points,
      undefined,
      TEST_PRESET,
    );
    const color = mesh.geometry.getAttribute("color");
    // TEST_PRESET's only coral color is pure magenta (#ff00ff): green is always exactly 0,
    // red/blue are always > 0, regardless of the per-cluster brightness multiplier.
    for (let i = 0; i < color.count; i += 1) {
      expect(color.getY(i)).toBe(0);
      expect(color.getX(i)).toBeGreaterThan(0);
      expect(color.getZ(i)).toBeGreaterThan(0);
    }
    mesh.geometry.dispose();
    (mesh.material as { dispose(): void }).dispose();
  });

  it("createFloor bakes vertex colors between the preset's deep and sand colors", () => {
    const time = { value: 0 };
    const floor = createFloor(time, 4, undefined, TEST_PRESET);
    const color = floor.geometry.getAttribute("color");
    const deep = new Color(TEST_PRESET.floor.deep);
    const sand = new Color(TEST_PRESET.floor.sand);
    for (let i = 0; i < color.count; i += 1) {
      const r = color.getX(i);
      expect(r).toBeGreaterThanOrEqual(Math.min(deep.r, sand.r) - 1e-6);
      expect(r).toBeLessThanOrEqual(Math.max(deep.r, sand.r) + 1e-6);
    }
    floor.geometry.dispose();
    (floor.material as { dispose(): void }).dispose();
  });

  it("createSeaweed bakes vertex colors between the preset's root and tip colors", () => {
    const mesh = createSeaweed(createRng(5), { value: 0 }, 4, 2, TEST_PRESET);
    const color = mesh.geometry.getAttribute("color");
    const root = new Color(TEST_PRESET.seaweed.root);
    const tip = new Color(TEST_PRESET.seaweed.tip);
    for (let i = 0; i < color.count; i += 1) {
      const r = color.getX(i);
      expect(r).toBeGreaterThanOrEqual(Math.min(root.r, tip.r) - 1e-6);
      expect(r).toBeLessThanOrEqual(Math.max(root.r, tip.r) + 1e-6);
    }
    mesh.geometry.dispose();
    (mesh.material as { dispose(): void }).dispose();
  });

  it("createEnvironment applies the preset's fog/background colors and bakes godRays with the preset opacity", () => {
    const scene = new Scene();
    const env = createEnvironment(scene, createRng(3), { preset: TEST_PRESET });
    const fog = scene.fog as unknown as { density: number; color: { getHexString(): string } };
    expect(fog.density).toBe(TEST_PRESET.water.fogDensity);
    expect(fog.color.getHexString()).toBe(new Color(TEST_PRESET.water.fogColor).getHexString());
    const background = scene.background as unknown as { getHexString(): string };
    expect(background.getHexString()).toBe(new Color(TEST_PRESET.water.backgroundColor).getHexString());
    const godRays = env.group.getObjectByName("godRays") as unknown as { material: { opacity: number } };
    expect(godRays.material.opacity).toBeCloseTo(TEST_PRESET.godRays.opacity, 6);
    env.dispose();
  });

  it("Environment.setPreset updates fog/background colors without replacing floor/coral/rocks/seaweed mesh instances", () => {
    const scene = new Scene();
    const env = createEnvironment(scene, createRng(3));
    const floorBefore = env.group.getObjectByName("floor");
    const coralBefore = env.group.getObjectByName("coral");
    const rocksBefore = env.group.getObjectByName("rocks");
    const seaweedBefore = env.group.getObjectByName("seaweed");

    env.setPreset(TEST_PRESET);

    expect(env.group.getObjectByName("floor")).toBe(floorBefore);
    expect(env.group.getObjectByName("coral")).toBe(coralBefore);
    expect(env.group.getObjectByName("rocks")).toBe(rocksBefore);
    expect(env.group.getObjectByName("seaweed")).toBe(seaweedBefore);
    const fog = scene.fog as unknown as { density: number };
    expect(fog.density).toBe(TEST_PRESET.water.fogDensity);
    env.dispose();
  });

  it("Environment.rebuild with a changed preset replaces floor/coral/rocks/seaweed/godRays with new mesh instances", () => {
    const scene = new Scene();
    const env = createEnvironment(scene, createRng(3));
    const before = {
      floor: env.group.getObjectByName("floor"),
      coral: env.group.getObjectByName("coral"),
      rocks: env.group.getObjectByName("rocks"),
      seaweed: env.group.getObjectByName("seaweed"),
      godRays: env.group.getObjectByName("godRays"),
    };

    env.rebuild("medium", 1, TEST_PRESET);

    expect(env.group.getObjectByName("floor")).not.toBe(before.floor);
    expect(env.group.getObjectByName("coral")).not.toBe(before.coral);
    expect(env.group.getObjectByName("rocks")).not.toBe(before.rocks);
    expect(env.group.getObjectByName("seaweed")).not.toBe(before.seaweed);
    expect(env.group.getObjectByName("godRays")).not.toBe(before.godRays);
    env.dispose();
  });
});

describe("background detail profiles", () => {
  it("medium reproduces the exact v1 baseline segment counts", () => {
    expect(BACKGROUND_DETAIL_PROFILES.medium.floorSegments).toBe(26);
    expect(BACKGROUND_DETAIL_PROFILES.medium.seaweedHeightSegments).toBe(4);
  });

  it("scales the whole background (floor+coral+rocks+seaweed) to ~2.25x (+125%) at high, within 2.0~2.5x (AC-3)", () => {
    const time = { value: 0 };
    const terrain = DEFAULT_ENVIRONMENT_PRESET.terrain;

    const mediumPoints = computeScatterPoints(createRng(1), SCENE.coral.clusters, terrain);
    const mediumNonSand = mediumPoints.filter((p) => p.biome !== "sand");
    const mediumTotal =
      triangleCount(
        createFloor(time, BACKGROUND_DETAIL_PROFILES.medium.floorSegments, undefined, undefined, mediumPoints)
          .geometry,
      ) +
      triangleCount(
        createCoral(createRng(1), time, BACKGROUND_DETAIL_PROFILES.medium.coral, mediumNonSand).geometry,
      ) +
      triangleCount(
        createRocks(createRng(1), time, BACKGROUND_DETAIL_PROFILES.medium.coral, mediumNonSand).geometry,
      ) +
      triangleCount(
        createSeaweed(
          createRng(2),
          time,
          BACKGROUND_DETAIL_PROFILES.medium.seaweedHeightSegments,
          SEAWEED_COUNT,
        ).geometry,
      );

    const highPoints = computeScatterPoints(createRng(1), SCENE.coral.clusters, terrain);
    const highNonSand = highPoints.filter((p) => p.biome !== "sand");
    const highTotal =
      triangleCount(
        createFloor(time, BACKGROUND_DETAIL_PROFILES.high.floorSegments, undefined, undefined, highPoints)
          .geometry,
      ) +
      triangleCount(
        createCoral(createRng(1), time, BACKGROUND_DETAIL_PROFILES.high.coral, highNonSand).geometry,
      ) +
      triangleCount(
        createRocks(createRng(1), time, BACKGROUND_DETAIL_PROFILES.high.coral, highNonSand).geometry,
      ) +
      triangleCount(
        createSeaweed(
          createRng(2),
          time,
          BACKGROUND_DETAIL_PROFILES.high.seaweedHeightSegments,
          SEAWEED_COUNT,
        ).geometry,
      );

    const ratio = highTotal / mediumTotal;
    expect(ratio).toBeGreaterThanOrEqual(2.0);
    expect(ratio).toBeLessThanOrEqual(2.5);
  });

  it("low is never more detailed than medium", () => {
    const time = { value: 0 };
    const low = triangleCount(createFloor(time, BACKGROUND_DETAIL_PROFILES.low.floorSegments).geometry);
    const medium = triangleCount(
      createFloor(time, BACKGROUND_DETAIL_PROFILES.medium.floorSegments).geometry,
    );
    expect(low).toBeLessThanOrEqual(medium);
  });
});

describe("computeObjectCounts (SPEC §6.5.4)", () => {
  it("returns the base counts unscaled at objectCountScale 1", () => {
    expect(computeObjectCounts(1)).toEqual({
      coralClusters: SCENE.coral.clusters,
      seaweedCount: SEAWEED_COUNT,
    });
  });

  it("scales both counts and never drops below 1", () => {
    expect(computeObjectCounts(2)).toEqual({
      coralClusters: SCENE.coral.clusters * 2,
      seaweedCount: SEAWEED_COUNT * 2,
    });
    expect(computeObjectCounts(0.001).coralClusters).toBeGreaterThanOrEqual(1);
    expect(computeObjectCounts(0.001).seaweedCount).toBeGreaterThanOrEqual(1);
  });
});

describe("createEnvironment", () => {
  it("exposes coral cluster centers as a subset (reef-classified, coral-assigned) of the configured cluster count", () => {
    const scene = new Scene();
    const env = createEnvironment(scene, createRng(3));
    expect(env.coralClusterCenters.length).toBeLessThanOrEqual(SCENE.coral.clusters);
    for (const center of env.coralClusterCenters) {
      expect(Number.isFinite(center.x)).toBe(true);
      expect(Number.isFinite(center.y)).toBe(true);
      expect(Number.isFinite(center.z)).toBe(true);
    }
    env.dispose();
  });
});

describe("createSeaweed", () => {
  it("spawns exactly `count` instances", () => {
    const mesh = createSeaweed(createRng(5), { value: 0 }, 4, 40);
    expect(mesh.count).toBe(40);
  });
});

describe("mergeBaked", () => {
  it("sums vertex counts across parts", () => {
    const time = { value: 0 };
    const a = createFloor(time, 4).geometry;
    const merged = mergeBaked([a.clone(), a.clone()]);
    expect(merged.getAttribute("position").count).toBe(a.getAttribute("position").count * 2);
  });
});
