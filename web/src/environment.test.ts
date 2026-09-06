/**
 * Background geometry detail/object-count tests (SPEC §6.2, §6.5.4, AC-3).
 * Pure geometry construction only — no WebGL context is required.
 */

import { describe, expect, it } from "vitest";
import { Color, Scene } from "three";

import { BACKGROUND_DETAIL_PROFILES, SCENE, SEAWEED_COUNT, type EnvironmentPreset } from "./config";
import { createRng } from "./fish";
import {
  computeCoralClusterCenters,
  computeObjectCounts,
  createCoral,
  createEnvironment,
  createFloor,
  createSeaweed,
  mergeBaked,
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
};

describe("environment preset color consumption", () => {
  it("createCoral bakes every vertex from the single supplied coral color", () => {
    const time = { value: 0 };
    const { mesh } = createCoral(
      createRng(1),
      time,
      BACKGROUND_DETAIL_PROFILES.medium.coral,
      3,
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

  it("Environment.setPreset updates fog/background colors without replacing floor/coral/seaweed mesh instances", () => {
    const scene = new Scene();
    const env = createEnvironment(scene, createRng(3));
    const floorBefore = env.group.getObjectByName("floor");
    const coralBefore = env.group.getObjectByName("coral");
    const seaweedBefore = env.group.getObjectByName("seaweed");

    env.setPreset(TEST_PRESET);

    expect(env.group.getObjectByName("floor")).toBe(floorBefore);
    expect(env.group.getObjectByName("coral")).toBe(coralBefore);
    expect(env.group.getObjectByName("seaweed")).toBe(seaweedBefore);
    const fog = scene.fog as unknown as { density: number };
    expect(fog.density).toBe(TEST_PRESET.water.fogDensity);
    env.dispose();
  });

  it("Environment.rebuild with a changed preset replaces floor/coral/seaweed/godRays with new mesh instances", () => {
    const scene = new Scene();
    const env = createEnvironment(scene, createRng(3));
    const before = {
      floor: env.group.getObjectByName("floor"),
      coral: env.group.getObjectByName("coral"),
      seaweed: env.group.getObjectByName("seaweed"),
      godRays: env.group.getObjectByName("godRays"),
    };

    env.rebuild("medium", 1, TEST_PRESET);

    expect(env.group.getObjectByName("floor")).not.toBe(before.floor);
    expect(env.group.getObjectByName("coral")).not.toBe(before.coral);
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

  it("scales the whole background (floor+coral+seaweed) to ~2.25x (+125%) at high, within 2.0~2.5x (AC-3)", () => {
    const time = { value: 0 };

    const mediumTotal =
      triangleCount(createFloor(time, BACKGROUND_DETAIL_PROFILES.medium.floorSegments).geometry) +
      triangleCount(
        createCoral(createRng(1), time, BACKGROUND_DETAIL_PROFILES.medium.coral, SCENE.coral.clusters)
          .mesh.geometry,
      ) +
      triangleCount(
        createSeaweed(
          createRng(2),
          time,
          BACKGROUND_DETAIL_PROFILES.medium.seaweedHeightSegments,
          SEAWEED_COUNT,
        ).geometry,
      );

    const highTotal =
      triangleCount(createFloor(time, BACKGROUND_DETAIL_PROFILES.high.floorSegments).geometry) +
      triangleCount(
        createCoral(createRng(1), time, BACKGROUND_DETAIL_PROFILES.high.coral, SCENE.coral.clusters)
          .mesh.geometry,
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
