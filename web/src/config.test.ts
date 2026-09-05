/**
 * Adaptive-quality step/power-save pure logic (SPEC §6.7.2, N2, AC-13/AC-14).
 * The FPS sampling and timing that *drives* these functions lives in
 * `main.ts` and is verified visually (SPEC §9) — only the step→scale mapping
 * itself is unit-tested here.
 */
import { describe, expect, it } from "vitest";

import {
  FISH_REGISTRY,
  SCENE,
  computeQualityScales,
  effectiveMinFps,
  type CreatureSpecies,
} from "./config";

describe("creature registry", () => {
  it("includes a shark as a distinct geometry variant", () => {
    const shark = FISH_REGISTRY.find((species) => species.id === "great-white-shark") as
      | CreatureSpecies
      | undefined;
    expect(shark).toBeDefined();
    if (!shark || shark.geometry !== "lowpoly-shark") throw new Error("shark registry entry missing");
    expect(shark.shape.dorsalFinHeight).toBeGreaterThan(0);
  });

  it("includes a vertical seahorse that uses hover locomotion", () => {
    const seahorse = FISH_REGISTRY.find((species) => species.id === "seahorse");
    expect(seahorse).toBeDefined();
    expect(seahorse?.geometry).toBe("lowpoly-seahorse");
    expect(seahorse?.behavior.locomotion).toBe("hover");
  });

  it("includes a turtle with a dedicated body plan and swim locomotion", () => {
    const turtle = FISH_REGISTRY.find((species) => species.id === "green-sea-turtle");
    expect(turtle).toBeDefined();
    expect(turtle?.geometry).toBe("lowpoly-turtle");
    expect(turtle?.behavior.locomotion).toBe("swim");
  });
});

describe("computeQualityScales", () => {
  it("is full quality at step 0 without power save", () => {
    expect(computeQualityScales(0, false)).toEqual({ resolutionScale: 1, populationScale: 1 });
  });

  it("drops only resolution at step 1", () => {
    expect(computeQualityScales(1, false)).toEqual({
      resolutionScale: SCENE.quality.resolutionScale,
      populationScale: 1,
    });
  });

  it("drops resolution and population at step 2", () => {
    expect(computeQualityScales(2, false)).toEqual({
      resolutionScale: SCENE.quality.resolutionScale,
      populationScale: SCENE.quality.populationScale,
    });
  });

  it("clamps resolution to the power-save ceiling even at step 0", () => {
    expect(computeQualityScales(0, true).resolutionScale).toBe(SCENE.quality.powerSave.resolutionScale);
  });

  it("keeps the lower of the two resolution scales when both a downgrade step and power save apply", () => {
    expect(computeQualityScales(1, true).resolutionScale).toBe(
      Math.min(SCENE.quality.resolutionScale, SCENE.quality.powerSave.resolutionScale),
    );
  });
});

describe("effectiveMinFps", () => {
  it("uses the normal threshold outside power save", () => {
    expect(effectiveMinFps(false)).toBe(SCENE.quality.minFps);
  });

  it("uses a lower, dedicated threshold in power save so an intentional low fps isn't mistaken for a fault (AC-13)", () => {
    expect(effectiveMinFps(true)).toBe(SCENE.quality.powerSave.minFps);
    expect(effectiveMinFps(true)).toBeLessThan(SCENE.quality.minFps);
  });
});
