import { parse } from "yaml";

import type {
  FishBodyShape,
  FishDorsalFinShape,
  FishPeduncleShape,
  FishPectoralFinShape,
  FishPelvicFinShape,
  FishShape,
  FishSnoutShape,
  FishSpecies,
  FishTailFinShape,
} from "../../config";

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

function requireBoolean(value: unknown, field: string, filename: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${filename}: "${field}" must be a boolean, got ${JSON.stringify(value)}`);
  return value;
}

function requireLocomotion(value: unknown, field: string, filename: string): "swim" | "hover" {
  if (value !== "swim" && value !== "hover") {
    throw new Error(`${filename}: "${field}" must be "swim" or "hover", got ${JSON.stringify(value)}`);
  }
  return value;
}

function withOptionalNumber<K extends string>(
  raw: Record<string, unknown>,
  key: K,
  filename: string,
  label: string,
): Partial<Record<K, number>> {
  if (raw[key] === undefined) return {};
  return { [key]: requireNumber(raw[key], label, filename) } as Partial<Record<K, number>>;
}

function slugFromFilename(filename: string): string {
  const base = filename.split("/").pop() ?? filename;
  const withoutExt = base.replace(/\.ya?ml$/i, "");
  return withoutExt.replace(/^\d+-/, "");
}

function parseBehavior(raw: Record<string, unknown>, filename: string): FishSpecies["behavior"] {
  const speed = requirePositiveNumber(raw.speed, "behavior.speed", filename);
  const locomotion = requireLocomotion(raw.locomotion, "behavior.locomotion", filename);
  const schooling = requireBoolean(raw.schooling, "behavior.schooling", filename);
  const activityRadius = requirePositiveNumber(raw.activityRadius, "behavior.activityRadius", filename);
  return {
    speed,
    locomotion,
    schooling,
    activityRadius,
    ...withOptionalNumber(raw, "hoverAmplitude", filename, "behavior.hoverAmplitude"),
    ...withOptionalNumber(raw, "hoverFrequency", filename, "behavior.hoverFrequency"),
    ...withOptionalNumber(raw, "depthPreference", filename, "behavior.depthPreference"),
    ...withOptionalNumber(raw, "maxTurnRate", filename, "behavior.maxTurnRate"),
    ...withOptionalNumber(raw, "rhythmAmplitude", filename, "behavior.rhythmAmplitude"),
    ...withOptionalNumber(raw, "rhythmFrequency", filename, "behavior.rhythmFrequency"),
    ...withOptionalNumber(raw, "territoryStrength", filename, "behavior.territoryStrength"),
  };
}

function parseSnout(raw: Record<string, unknown>, filename: string): FishSnoutShape {
  return {
    length: requirePositiveNumber(raw.length, "shape.snout.length", filename),
    taper: requirePositiveNumber(raw.taper, "shape.snout.taper", filename),
    ...withOptionalNumber(raw, "tipRadius", filename, "shape.snout.tipRadius"),
  };
}

function parseBody(raw: Record<string, unknown>, filename: string): FishBodyShape {
  const peak = requirePositiveNumber(raw.peak, "shape.body.peak", filename);
  if (peak >= 1) throw new Error(`${filename}: "shape.body.peak" must be < 1, got ${peak}`);
  return {
    length: requirePositiveNumber(raw.length, "shape.body.length", filename),
    maxHeight: requirePositiveNumber(raw.maxHeight, "shape.body.maxHeight", filename),
    maxWidth: requirePositiveNumber(raw.maxWidth, "shape.body.maxWidth", filename),
    peak,
    taper: requirePositiveNumber(raw.taper, "shape.body.taper", filename),
    ...withOptionalNumber(raw, "shoulderRadius", filename, "shape.body.shoulderRadius"),
  };
}

function parsePeduncle(raw: Record<string, unknown>, filename: string): FishPeduncleShape {
  return {
    length: requirePositiveNumber(raw.length, "shape.peduncle.length", filename),
    taper: requirePositiveNumber(raw.taper, "shape.peduncle.taper", filename),
    ...withOptionalNumber(raw, "width", filename, "shape.peduncle.width"),
  };
}

function requireTailFinStyle(value: unknown, field: string, filename: string): "fan" | "fork" {
  if (value !== "fan" && value !== "fork") {
    throw new Error(`${filename}: "${field}" must be "fan" or "fork", got ${JSON.stringify(value)}`);
  }
  return value;
}

function requirePaletteKey(value: unknown, field: string, filename: string): "body" | "fin" | "accent" {
  if (value !== "body" && value !== "fin" && value !== "accent") {
    throw new Error(`${filename}: "${field}" must be "body", "fin", or "accent", got ${JSON.stringify(value)}`);
  }
  return value;
}

function parseTailFin(raw: Record<string, unknown>, filename: string): FishTailFinShape {
  const style = requireTailFinStyle(raw.style, "shape.tailFin.style", filename);

  let notch: number | undefined;
  if (raw.notch !== undefined) {
    notch = requirePositiveNumber(raw.notch, "shape.tailFin.notch", filename);
    if (notch >= 1) throw new Error(`${filename}: "shape.tailFin.notch" must be < 1, got ${notch}`);
  }

  const upperColor =
    raw.upperColor === undefined
      ? undefined
      : requirePaletteKey(raw.upperColor, "shape.tailFin.upperColor", filename);
  const lowerColor =
    raw.lowerColor === undefined
      ? undefined
      : requirePaletteKey(raw.lowerColor, "shape.tailFin.lowerColor", filename);

  let tipBandWidth: number | undefined;
  if (raw.tipBandWidth !== undefined) {
    tipBandWidth = requireNumber(raw.tipBandWidth, "shape.tailFin.tipBandWidth", filename);
    if (tipBandWidth < 0 || tipBandWidth > 1) {
      throw new Error(`${filename}: "shape.tailFin.tipBandWidth" must be within 0..1, got ${tipBandWidth}`);
    }
  }

  return {
    style,
    height: requirePositiveNumber(raw.height, "shape.tailFin.height", filename),
    length: requirePositiveNumber(raw.length, "shape.tailFin.length", filename),
    ...(notch === undefined ? {} : { notch }),
    ...(upperColor === undefined ? {} : { upperColor }),
    ...(lowerColor === undefined ? {} : { lowerColor }),
    ...(tipBandWidth === undefined ? {} : { tipBandWidth }),
  };
}

function parseDorsalFin(raw: Record<string, unknown>, filename: string): FishDorsalFinShape {
  const start = requireNumber(raw.start, "shape.dorsalFin.start", filename);
  const end = requireNumber(raw.end, "shape.dorsalFin.end", filename);
  if (start < 0 || end > 1 || end <= start) {
    throw new Error(
      `${filename}: "shape.dorsalFin.start"/"end" must satisfy 0 <= start < end <= 1, got start=${start}, end=${end}`,
    );
  }
  return { start, end, height: requirePositiveNumber(raw.height, "shape.dorsalFin.height", filename) };
}

function parsePelvicFin(raw: Record<string, unknown>, filename: string): FishPelvicFinShape {
  return {
    length: requirePositiveNumber(raw.length, "shape.pelvicFin.length", filename),
    angle: requireNumber(raw.angle, "shape.pelvicFin.angle", filename),
    ...withOptionalNumber(raw, "at", filename, "shape.pelvicFin.at"),
  };
}

function parsePectoralFin(raw: Record<string, unknown>, filename: string): FishPectoralFinShape {
  return {
    length: requirePositiveNumber(raw.length, "shape.pectoralFin.length", filename),
    angle: requireNumber(raw.angle, "shape.pectoralFin.angle", filename),
    ...withOptionalNumber(raw, "at", filename, "shape.pectoralFin.at"),
  };
}

function parseShape(raw: Record<string, unknown>, filename: string): FishShape {
  const snout = parseSnout(requireObject(raw.snout, "shape.snout", filename), filename);
  const body = parseBody(requireObject(raw.body, "shape.body", filename), filename);
  const peduncle = parsePeduncle(requireObject(raw.peduncle, "shape.peduncle", filename), filename);

  if (snout.length + peduncle.length >= 1) {
    throw new Error(
      `${filename}: "shape.snout.length" + "shape.peduncle.length" must be < 1, got ${snout.length + peduncle.length}`,
    );
  }

  const tailFin = parseTailFin(requireObject(raw.tailFin, "shape.tailFin", filename), filename);
  const dorsalFin = parseDorsalFin(requireObject(raw.dorsalFin, "shape.dorsalFin", filename), filename);
  const pelvicFin = parsePelvicFin(requireObject(raw.pelvicFin, "shape.pelvicFin", filename), filename);
  const pectoralFin = parsePectoralFin(requireObject(raw.pectoralFin, "shape.pectoralFin", filename), filename);

  const patternRaw = requireObject(raw.pattern, "shape.pattern", filename);
  const stripes = requireNumber(patternRaw.stripes, "shape.pattern.stripes", filename);
  if (stripes < 0) throw new Error(`${filename}: "shape.pattern.stripes" must be >= 0, got ${stripes}`);

  const thread =
    raw.thread === undefined
      ? undefined
      : (() => {
          const threadRaw = requireObject(raw.thread, "shape.thread", filename);
          return {
            length: requirePositiveNumber(threadRaw.length, "shape.thread.length", filename),
            curvature: requireNumber(threadRaw.curvature, "shape.thread.curvature", filename),
          };
        })();

  const eye =
    raw.eye === undefined
      ? undefined
      : (() => {
          const eyeRaw = requireObject(raw.eye, "shape.eye", filename);
          return { ...withOptionalNumber(eyeRaw, "radius", filename, "shape.eye.radius") };
        })();

  return {
    length: body.length,
    snout,
    body,
    peduncle,
    tailFin,
    dorsalFin,
    pelvicFin,
    pectoralFin,
    pattern: { stripes },
    ...(thread === undefined ? {} : { thread }),
    ...(eye === undefined ? {} : { eye }),
  };
}

/** A `FishSpecies` narrowed to the `lowpoly-fish` geometry variant, i.e. the only kind this loader produces. */
export type LowpolyFishSpecies = Extract<FishSpecies, { geometry: "lowpoly-fish" }>;

/** Parses and validates one species YAML file's raw text. Throws `Error` naming `filename` on any missing/invalid field. */
export function parseFishSpeciesYaml(raw: string, filename: string): LowpolyFishSpecies {
  const doc: unknown = parse(raw);
  const root = requireObject(doc, "<root>", filename);

  const id = requireString(root.id, "id", filename);
  const expectedSlug = slugFromFilename(filename);
  if (id !== expectedSlug) {
    throw new Error(`${filename}: "id" ("${id}") does not match the filename slug ("${expectedSlug}")`);
  }

  const label = requireString(root.label, "label", filename);
  const description = requireString(root.description, "description", filename);
  const count = requirePositiveNumber(root.count, "count", filename);

  const paletteRaw = requireObject(root.palette, "palette", filename);
  const palette = {
    body: requireString(paletteRaw.body, "palette.body", filename),
    fin: requireString(paletteRaw.fin, "palette.fin", filename),
    accent: requireString(paletteRaw.accent, "palette.accent", filename),
    ...(paletteRaw.eye === undefined ? {} : { eye: requireString(paletteRaw.eye, "palette.eye", filename) }),
  };

  const behavior = parseBehavior(requireObject(root.behavior, "behavior", filename), filename);
  const shape = parseShape(requireObject(root.shape, "shape", filename), filename);

  return { id, label, description, geometry: "lowpoly-fish", palette, behavior, count, shape };
}

const rawFiles = import.meta.glob("/species/fish/*.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Eager-loads every `web/species/fish/*.yaml` file, sorted by path so numbered filenames control registry order. */
export function loadFishSpeciesFromYaml(): readonly LowpolyFishSpecies[] {
  return Object.keys(rawFiles)
    .sort()
    .map((path) => {
      const filename = path.split("/").pop() ?? path;
      return parseFishSpeciesYaml(rawFiles[path] as string, filename);
    });
}
