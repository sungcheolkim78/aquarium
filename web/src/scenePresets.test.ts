import { describe, expect, it } from "vitest";

import { loadEnvironmentPresetsFromYaml, parseEnvironmentPresetYaml } from "./scenePresets";

const VALID_YAML = `
id: test-preset
label: 테스트 프리셋
description: "테스트용 프리셋이에요."
water: { fogColor: "#112233", fogDensity: 0.04, backgroundColor: "#223344" }
lighting: { hemisphereSky: "#aabbcc", hemisphereGround: "#001122", sun: "#ffffff", rim: "#334455" }
caustics: { tint: "#556677" }
godRays: { tint: "#eeeeee", opacity: 0.08 }
floor: { deep: "#112244", sand: "#ccddaa" }
coral: { colors: ["#ff0000", "#00ff00"] }
seaweed: { root: "#113322", tip: "#66cc88" }
bubbles: { tint: "#ccffff" }
terrain: { relief: 0.6, roughness: 0.4, reefBias: 0.55, cliffBias: 0.2, rockColor: "#7c8a8f" }
`;

describe("parseEnvironmentPresetYaml", () => {
  it("parses a well-formed file into an EnvironmentPreset with all fields", () => {
    const preset = parseEnvironmentPresetYaml(VALID_YAML, "test-preset.yaml");
    expect(preset.id).toBe("test-preset");
    expect(preset.label).toBe("테스트 프리셋");
    expect(preset.water.fogColor).toBe("#112233");
    expect(preset.water.fogDensity).toBe(0.04);
    expect(preset.coral.colors).toEqual(["#ff0000", "#00ff00"]);
    expect(preset.godRays.opacity).toBe(0.08);
  });

  it("throws naming the file when a required field is missing", () => {
    const broken = VALID_YAML.replace('fogColor: "#112233", ', "");
    expect(() => parseEnvironmentPresetYaml(broken, "test-preset.yaml")).toThrow(/test-preset\.yaml/);
  });

  it("throws when a color is not a valid #rrggbb hex string", () => {
    const broken = VALID_YAML.replace('"#112233"', '"blue"');
    expect(() => parseEnvironmentPresetYaml(broken, "test-preset.yaml")).toThrow(/hex color/);
  });

  it("throws when coral.colors is an empty array", () => {
    const broken = VALID_YAML.replace('colors: ["#ff0000", "#00ff00"]', "colors: []");
    expect(() => parseEnvironmentPresetYaml(broken, "test-preset.yaml")).toThrow(/coral\.colors/);
  });

  it("throws when id does not match the filename slug", () => {
    expect(() => parseEnvironmentPresetYaml(VALID_YAML, "different-name.yaml")).toThrow(/does not match/);
  });

  it("parses the terrain block", () => {
    const preset = parseEnvironmentPresetYaml(VALID_YAML, "test-preset.yaml");
    expect(preset.terrain).toEqual({
      relief: 0.6,
      roughness: 0.4,
      reefBias: 0.55,
      cliffBias: 0.2,
      rockColor: "#7c8a8f",
    });
  });

  it("throws when terrain.reefBias is outside 0..1", () => {
    const broken = VALID_YAML.replace("reefBias: 0.55", "reefBias: 1.5");
    expect(() => parseEnvironmentPresetYaml(broken, "test-preset.yaml")).toThrow(/terrain\.reefBias/);
  });

  it("throws when terrain.rockColor is not a valid hex color", () => {
    const broken = VALID_YAML.replace('rockColor: "#7c8a8f"', 'rockColor: "gray"');
    expect(() => parseEnvironmentPresetYaml(broken, "test-preset.yaml")).toThrow(/hex color/);
  });
});

describe("loadEnvironmentPresetsFromYaml", () => {
  it("loads the real great_barrier_reef.yaml", () => {
    const presets = loadEnvironmentPresetsFromYaml();
    expect(presets.map((p) => p.id)).toContain("great_barrier_reef");
  });
});
