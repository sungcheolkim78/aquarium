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
  tailFin: { style: fan, height: 0.2, length: 0.2, notch: 0.3 }
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

  it("throws when shape.tailFin.style is missing or invalid", () => {
    const missing = VALID_YAML.replace("style: fan, ", "");
    expect(() => parseFishSpeciesYaml(missing, "01-test-fish.yaml")).toThrow(/shape\.tailFin\.style/);

    const invalid = VALID_YAML.replace("style: fan", "style: round");
    expect(() => parseFishSpeciesYaml(invalid, "01-test-fish.yaml")).toThrow(/shape\.tailFin\.style/);
  });

  it("defaults shape.tailFin.notch to 0 when absent, and still requires it to be < 1 when present", () => {
    const withoutNotch = VALID_YAML.replace(", notch: 0.3", "");
    const species = parseFishSpeciesYaml(withoutNotch, "01-test-fish.yaml");
    expect(species.shape.tailFin.notch).toBeUndefined();

    const tooDeep = VALID_YAML.replace("notch: 0.3", "notch: 1");
    expect(() => parseFishSpeciesYaml(tooDeep, "01-test-fish.yaml")).toThrow(/shape\.tailFin\.notch/);
  });

  it("carries optional tailFin upperColor/lowerColor/tipBandWidth through when present", () => {
    const withExtras = VALID_YAML.replace(
      "tailFin: { style: fan, height: 0.2, length: 0.2, notch: 0.3 }",
      "tailFin: { style: fork, height: 0.2, length: 0.2, notch: 0.3, upperColor: accent, lowerColor: body, tipBandWidth: 0.2 }",
    );
    const species = parseFishSpeciesYaml(withExtras, "01-test-fish.yaml");
    expect(species.shape.tailFin.style).toBe("fork");
    expect(species.shape.tailFin.upperColor).toBe("accent");
    expect(species.shape.tailFin.lowerColor).toBe("body");
    expect(species.shape.tailFin.tipBandWidth).toBe(0.2);
  });

  it("throws when tailFin.upperColor/lowerColor is not body/fin/accent", () => {
    const broken = VALID_YAML.replace(
      "tailFin: { style: fan, height: 0.2, length: 0.2, notch: 0.3 }",
      "tailFin: { style: fan, height: 0.2, length: 0.2, notch: 0.3, upperColor: gold }",
    );
    expect(() => parseFishSpeciesYaml(broken, "01-test-fish.yaml")).toThrow(/shape\.tailFin\.upperColor/);
  });

  it("throws when tailFin.tipBandWidth is outside 0..1", () => {
    const broken = VALID_YAML.replace(
      "tailFin: { style: fan, height: 0.2, length: 0.2, notch: 0.3 }",
      "tailFin: { style: fan, height: 0.2, length: 0.2, notch: 0.3, tipBandWidth: 1.5 }",
    );
    expect(() => parseFishSpeciesYaml(broken, "01-test-fish.yaml")).toThrow(/shape\.tailFin\.tipBandWidth/);
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
