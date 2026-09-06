import { parse } from "yaml";

import type { EnvironmentPreset } from "./config";

function requireObject(value: unknown, field: string, filename: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${filename}: "${field}" must be an object, got ${JSON.stringify(value)}`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string, filename: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${filename}: "${field}" must be a non-empty string, got ${JSON.stringify(value)}`);
  }
  return value;
}

function requireNumber(value: unknown, field: string, filename: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${filename}: "${field}" must be a finite number, got ${JSON.stringify(value)}`);
  }
  return value;
}

function requirePositiveNumber(value: unknown, field: string, filename: string): number {
  const n = requireNumber(value, field, filename);
  if (n <= 0) throw new Error(`${filename}: "${field}" must be > 0, got ${n}`);
  return n;
}

function requireNonNegativeNumber(value: unknown, field: string, filename: string): number {
  const n = requireNumber(value, field, filename);
  if (n < 0) throw new Error(`${filename}: "${field}" must be >= 0, got ${n}`);
  return n;
}

function requireUnitNumber(value: unknown, field: string, filename: string): number {
  const n = requireNumber(value, field, filename);
  if (n < 0 || n > 1) throw new Error(`${filename}: "${field}" must be between 0 and 1, got ${n}`);
  return n;
}

function requireHexColor(value: unknown, field: string, filename: string): string {
  const s = requireString(value, field, filename);
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) {
    throw new Error(`${filename}: "${field}" must be a "#rrggbb" hex color, got ${JSON.stringify(s)}`);
  }
  return s;
}

function requireHexColorArray(value: unknown, field: string, filename: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${filename}: "${field}" must be a non-empty array of hex colors, got ${JSON.stringify(value)}`);
  }
  return value.map((entry, i) => requireHexColor(entry, `${field}[${i}]`, filename));
}

function slugFromFilename(filename: string): string {
  const base = filename.split("/").pop() ?? filename;
  return base.replace(/\.ya?ml$/i, "");
}

/** Parses and validates one environment preset YAML file's raw text. Throws `Error` naming `filename` on any missing/invalid field. */
export function parseEnvironmentPresetYaml(raw: string, filename: string): EnvironmentPreset {
  const doc: unknown = parse(raw);
  const root = requireObject(doc, "<root>", filename);

  const id = requireString(root.id, "id", filename);
  const expectedSlug = slugFromFilename(filename);
  if (id !== expectedSlug) {
    throw new Error(`${filename}: "id" ("${id}") does not match the filename slug ("${expectedSlug}")`);
  }

  const label = requireString(root.label, "label", filename);
  const description = requireString(root.description, "description", filename);

  const waterRaw = requireObject(root.water, "water", filename);
  const water = {
    fogColor: requireHexColor(waterRaw.fogColor, "water.fogColor", filename),
    fogDensity: requirePositiveNumber(waterRaw.fogDensity, "water.fogDensity", filename),
    backgroundColor: requireHexColor(waterRaw.backgroundColor, "water.backgroundColor", filename),
  };

  const lightingRaw = requireObject(root.lighting, "lighting", filename);
  const lighting = {
    hemisphereSky: requireHexColor(lightingRaw.hemisphereSky, "lighting.hemisphereSky", filename),
    hemisphereGround: requireHexColor(lightingRaw.hemisphereGround, "lighting.hemisphereGround", filename),
    sun: requireHexColor(lightingRaw.sun, "lighting.sun", filename),
    rim: requireHexColor(lightingRaw.rim, "lighting.rim", filename),
  };

  const causticsRaw = requireObject(root.caustics, "caustics", filename);
  const caustics = { tint: requireHexColor(causticsRaw.tint, "caustics.tint", filename) };

  const godRaysRaw = requireObject(root.godRays, "godRays", filename);
  const godRays = {
    tint: requireHexColor(godRaysRaw.tint, "godRays.tint", filename),
    opacity: requirePositiveNumber(godRaysRaw.opacity, "godRays.opacity", filename),
  };

  const floorRaw = requireObject(root.floor, "floor", filename);
  const floor = {
    deep: requireHexColor(floorRaw.deep, "floor.deep", filename),
    sand: requireHexColor(floorRaw.sand, "floor.sand", filename),
  };

  const coralRaw = requireObject(root.coral, "coral", filename);
  const coral = { colors: requireHexColorArray(coralRaw.colors, "coral.colors", filename) };

  const seaweedRaw = requireObject(root.seaweed, "seaweed", filename);
  const seaweed = {
    root: requireHexColor(seaweedRaw.root, "seaweed.root", filename),
    tip: requireHexColor(seaweedRaw.tip, "seaweed.tip", filename),
  };

  const bubblesRaw = requireObject(root.bubbles, "bubbles", filename);
  const bubbles = { tint: requireHexColor(bubblesRaw.tint, "bubbles.tint", filename) };

  const terrainRaw = requireObject(root.terrain, "terrain", filename);
  const terrain = {
    relief: requireNonNegativeNumber(terrainRaw.relief, "terrain.relief", filename),
    roughness: requireNonNegativeNumber(terrainRaw.roughness, "terrain.roughness", filename),
    reefBias: requireUnitNumber(terrainRaw.reefBias, "terrain.reefBias", filename),
    cliffBias: requireUnitNumber(terrainRaw.cliffBias, "terrain.cliffBias", filename),
    rockColor: requireHexColor(terrainRaw.rockColor, "terrain.rockColor", filename),
  };

  return { id, label, description, water, lighting, caustics, godRays, floor, coral, seaweed, bubbles, terrain };
}

const rawFiles = import.meta.glob("/scenes/*.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Eager-loads every `web/scenes/*.yaml` file, sorted by path. */
export function loadEnvironmentPresetsFromYaml(): readonly EnvironmentPreset[] {
  return Object.keys(rawFiles)
    .sort()
    .map((path) => {
      const filename = path.split("/").pop() ?? path;
      return parseEnvironmentPresetYaml(rawFiles[path] as string, filename);
    });
}
