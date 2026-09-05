/**
 * Background geometry detail/object-count tests (SPEC §6.2, §6.5.4, AC-3).
 * Pure geometry construction only — no WebGL context is required.
 */

import { describe, expect, it } from "vitest";

import { BACKGROUND_DETAIL_PROFILES, SCENE, SEAWEED_COUNT } from "./config";
import { createRng } from "./fish";
import {
  computeObjectCounts,
  createCoral,
  createFloor,
  createSeaweed,
  mergeBaked,
} from "./environment";

function triangleCount(geometry: { getAttribute(name: string): { count: number } }): number {
  return geometry.getAttribute("position").count / 3;
}

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
          .geometry,
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
          .geometry,
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
