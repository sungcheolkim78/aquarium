import { BufferAttribute, BufferGeometry, Color, Vector3 } from "three";

import { FISH_DETAIL_PROFILES, type DetailLevel, type FishShape, type FishSpecies } from "../../config";

interface MeshBuffers {
  readonly positions: number[];
  readonly colors: number[];
}

const DEFAULT_SNOUT_TIP_RADIUS = 0.08;
const DEFAULT_SHOULDER_RADIUS = 0.82;
const DEFAULT_PEDUNCLE_WIDTH = 0.12;
const DEFAULT_EYE_COLOR = "#141414";
const DEFAULT_PELVIC_FIN_AT = 0.55;
const DEFAULT_PECTORAL_FIN_AT = 0.28;

function pushVertex(buffers: MeshBuffers, vertex: Vector3, color: Color): void {
  buffers.positions.push(vertex.x, vertex.y, vertex.z);
  buffers.colors.push(color.r, color.g, color.b);
}

function pushTriangle(buffers: MeshBuffers, a: Vector3, b: Vector3, c: Vector3, color: Color): void {
  pushVertex(buffers, a, color);
  pushVertex(buffers, b, color);
  pushVertex(buffers, c, color);
}

/** Double-sided single triangle — every fin in this file is a single-layer surface with no back geometry. */
function pushFin(buffers: MeshBuffers, a: Vector3, b: Vector3, c: Vector3, color: Color): void {
  pushTriangle(buffers, a, b, c, color);
  pushTriangle(buffers, a, c, b, color);
}

/** 0 at u=0, 1 at u=peak, 0 at u=1. Used only for the main-body zone's bulge. */
function bump(u: number, peak: number, taper: number): number {
  if (u <= peak) return Math.pow(u / peak, taper);
  return Math.pow((1 - u) / (1 - peak), taper);
}

/**
 * Nose-to-tail-fin-root cross-section radius fraction, `t ∈ [0,1]`. Three
 * zones — snout, main body, peduncle — each with their own taper exponent,
 * agreeing exactly at `shoulderRadius` where they meet so the profile is
 * continuous with no stitching seam (docs/superpowers/specs/2026-09-06-fish-procedural-grammar-design.md §3.1).
 */
export function fishBodyRadius(t: number, shape: FishShape): number {
  const s = shape.snout.length;
  const p = shape.peduncle.length;
  const shoulder = shape.body.shoulderRadius ?? DEFAULT_SHOULDER_RADIUS;

  if (t <= s) {
    const tipRadius = shape.snout.tipRadius ?? DEFAULT_SNOUT_TIP_RADIUS;
    const v = s > 0 ? t / s : 1;
    return tipRadius + (shoulder - tipRadius) * Math.pow(v, shape.snout.taper);
  }
  if (t >= 1 - p) {
    const peduncleWidth = shape.peduncle.width ?? DEFAULT_PEDUNCLE_WIDTH;
    const w = p > 0 ? (t - (1 - p)) / p : 0;
    return shoulder - (shoulder - peduncleWidth) * Math.pow(w, shape.peduncle.taper);
  }
  const u = (t - s) / (1 - s - p);
  return shoulder + (1 - shoulder) * bump(u, shape.body.peak, shape.body.taper);
}

function ringVertex(x: number, radius: number, shape: FishShape, index: number, sides: number): Vector3 {
  const angle = (index / sides) * Math.PI * 2;
  return new Vector3(
    x,
    Math.cos(angle) * (shape.body.maxHeight / 2) * radius,
    Math.sin(angle) * (shape.body.maxWidth / 2) * radius,
  );
}

/** Symmetric parametric fan per lobe; `notch` forks the trailing edge instead of a flat wedge. */
export function fishTailFin(
  shape: FishShape,
  finSegments: number,
): { root: Vector3; upperFan: Vector3[]; lowerFan: Vector3[] } {
  const half = shape.body.length / 2;
  const root = new Vector3(-half, 0, 0);
  const segments = Math.max(2, finSegments);
  const upperFan: Vector3[] = [];
  const lowerFan: Vector3[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const u = i / segments;
    const x = -half - shape.tailFin.length * (shape.tailFin.notch + u * (1 - shape.tailFin.notch));
    const y = shape.tailFin.height * u;
    upperFan.push(new Vector3(x, y, 0));
    lowerFan.push(new Vector3(x, -y, 0));
  }
  return { root, upperFan, lowerFan };
}

/** `finSegments` points along the body surface between `dorsalFin.start` and `dorsalFin.end`; elevation tapers to 0 at both ends. */
export function fishDorsalFin(
  shape: FishShape,
  finSegments: number,
): Array<{ base: Vector3; top: Vector3 }> {
  const half = shape.body.length / 2;
  const pointCount = Math.max(2, finSegments);
  const points: Array<{ base: Vector3; top: Vector3 }> = [];
  for (let i = 0; i < pointCount; i += 1) {
    const u = i / (pointCount - 1);
    const t = shape.dorsalFin.start + u * (shape.dorsalFin.end - shape.dorsalFin.start);
    const x = half - shape.body.length * t;
    const radius = fishBodyRadius(t, shape);
    const baseY = (radius * shape.body.maxHeight) / 2;
    const rise = shape.dorsalFin.height * Math.sin(Math.PI * u);
    points.push({ base: new Vector3(x, baseY, 0), top: new Vector3(x, baseY + rise, 0) });
  }
  return points;
}

/** A single thin triangular flap per side, hanging from the belly. */
export function fishPelvicFin(shape: FishShape, side: 1 | -1): { a: Vector3; b: Vector3; c: Vector3 } {
  const at = shape.pelvicFin.at ?? DEFAULT_PELVIC_FIN_AT;
  const half = shape.body.length / 2;
  const x0 = half - shape.body.length * at;
  const radius = fishBodyRadius(at, shape);
  const width = (radius * shape.body.maxWidth) / 2;
  const height = (radius * shape.body.maxHeight) / 2;
  const angleRad = (shape.pelvicFin.angle * Math.PI) / 180;
  const a = new Vector3(x0 + shape.body.length * 0.05, 0, side * width);
  const b = new Vector3(x0 - shape.body.length * 0.05, 0, side * width);
  const c = new Vector3(
    x0 - Math.sin(angleRad) * shape.pelvicFin.length,
    -height * 0.5 - Math.cos(angleRad) * shape.pelvicFin.length * 0.3,
    side * width * 1.3,
  );
  return { a, b, c };
}

/** A `finSegments`-wedge fan per side, rooted near the head. */
export function fishPectoralFin(
  shape: FishShape,
  finSegments: number,
  side: 1 | -1,
): { root: Vector3; fan: Vector3[] } {
  const at = shape.pectoralFin.at ?? DEFAULT_PECTORAL_FIN_AT;
  const half = shape.body.length / 2;
  const x0 = half - shape.body.length * at;
  const radius = fishBodyRadius(at, shape);
  const width = (radius * shape.body.maxWidth) / 2;
  const height = (radius * shape.body.maxHeight) / 2;
  const root = new Vector3(x0, -height * 0.3, side * width);
  const angleRad = (shape.pectoralFin.angle * Math.PI) / 180;
  const segments = Math.max(2, finSegments);
  const fan: Vector3[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const u = i / segments;
    const reach = shape.pectoralFin.length * (0.15 + 0.85 * u);
    fan.push(
      new Vector3(
        x0 - Math.sin(angleRad) * reach,
        -height * 0.3 - Math.cos(angleRad) * reach * 0.5,
        side * (width + reach * 1.4),
      ),
    );
  }
  return { root, fan };
}

/** Quadratic-bezier ribbon trailing from the dorsal fin's peak point; `null` when `shape.thread` is absent. */
export function fishThread(
  shape: FishShape,
  finSegments: number,
): Array<{ top: Vector3; bottom: Vector3 }> | null {
  if (!shape.thread) return null;
  const dorsal = fishDorsalFin(shape, finSegments);
  const peak = dorsal[Math.floor((dorsal.length - 1) / 2)];
  if (!peak) return null;
  const start = peak.top;
  const control = new Vector3(
    start.x - shape.thread.length * 0.4,
    start.y + shape.thread.curvature * shape.thread.length,
    0,
  );
  const end = new Vector3(start.x - shape.thread.length, start.y, 0);
  const segments = Math.max(2, finSegments);
  const points: Array<{ top: Vector3; bottom: Vector3 }> = [];
  for (let i = 0; i <= segments; i += 1) {
    const u = i / segments;
    const oneMinusU = 1 - u;
    const x = oneMinusU * oneMinusU * start.x + 2 * oneMinusU * u * control.x + u * u * end.x;
    const y = oneMinusU * oneMinusU * start.y + 2 * oneMinusU * u * control.y + u * u * end.y;
    const halfWidth = 0.01 * (1 - u);
    points.push({ top: new Vector3(x, y + halfWidth, 0), bottom: new Vector3(x, y - halfWidth, 0) });
  }
  return points;
}

/** Low-poly octahedron approximation of a UV sphere: 6 vertices, 8 faces. */
function octahedronFaces(center: Vector3, radius: number): ReadonlyArray<readonly [Vector3, Vector3, Vector3]> {
  const px = new Vector3(center.x + radius, center.y, center.z);
  const nx = new Vector3(center.x - radius, center.y, center.z);
  const py = new Vector3(center.x, center.y + radius, center.z);
  const ny = new Vector3(center.x, center.y - radius, center.z);
  const pz = new Vector3(center.x, center.y, center.z + radius);
  const nz = new Vector3(center.x, center.y, center.z - radius);
  return [
    [px, py, pz], [py, nx, pz], [nx, ny, pz], [ny, px, pz],
    [py, px, nz], [nx, py, nz], [ny, nx, nz], [px, ny, nz],
  ];
}

/** `null` when the eye radius resolves to 0 — either explicitly, or (never, since the default is always positive) by omission. */
export function fishEyePoints(shape: FishShape): { left: Vector3; right: Vector3; radius: number } | null {
  const radius = shape.eye?.radius ?? 0.16 * shape.body.maxHeight;
  if (radius <= 0) return null;
  const t = shape.snout.length * 0.6;
  const half = shape.body.length / 2;
  const x = half - shape.body.length * t;
  const radiusFraction = fishBodyRadius(t, shape);
  const z = (radiusFraction * shape.body.maxWidth * 0.9) / 2;
  const y = (radiusFraction * shape.body.maxHeight * 0.3) / 2;
  return { left: new Vector3(x, y, -z), right: new Vector3(x, y, z), radius };
}

/** Build the faceted fish body: snout + main body + peduncle loft, tail/dorsal/pelvic/pectoral fins, optional thread, optional eyes. */
export function buildFishGeometry(
  shape: FishShape,
  palette: FishSpecies["palette"],
  detail: DetailLevel = "medium",
): BufferGeometry {
  const bodyColor = new Color(palette.body);
  const finColor = new Color(palette.fin);
  const accentColor = new Color(palette.accent);
  const eyeColor = new Color(palette.eye ?? DEFAULT_EYE_COLOR);
  const profile = FISH_DETAIL_PROFILES[detail];
  const buffers: MeshBuffers = { positions: [], colors: [] };
  const half = shape.body.length / 2;

  const s = shape.snout.length;
  const p = shape.peduncle.length;
  const snoutSegments = Math.max(2, Math.round(profile.bodySegments * 0.4));
  const peduncleSegments = Math.max(2, Math.round(profile.bodySegments * 0.4));

  const tValues: number[] = [0];
  for (let i = 1; i <= snoutSegments; i += 1) tValues.push((i / snoutSegments) * s);
  for (let i = 1; i <= profile.bodySegments; i += 1) tValues.push(s + (i / profile.bodySegments) * (1 - s - p));
  for (let i = 1; i <= peduncleSegments; i += 1) tValues.push(1 - p + (i / peduncleSegments) * p);

  const totalSegments = snoutSegments + profile.bodySegments + peduncleSegments;
  const stripeSegments = new Set<number>();
  if (shape.pattern.stripes > 0) {
    const stride = profile.bodySegments / (shape.pattern.stripes + 1);
    for (let i = 1; i <= shape.pattern.stripes; i += 1) {
      const localIndex = Math.min(profile.bodySegments - 1, Math.round(i * stride) - 1);
      stripeSegments.add(snoutSegments + localIndex);
    }
  }

  for (let seg = 0; seg < totalSegments; seg += 1) {
    const t0 = tValues[seg] as number;
    const t1 = tValues[seg + 1] as number;
    const x0 = half - shape.body.length * t0;
    const x1 = half - shape.body.length * t1;
    const r0 = fishBodyRadius(t0, shape);
    const r1 = fishBodyRadius(t1, shape);
    const color = stripeSegments.has(seg) ? accentColor : bodyColor;
    for (let side = 0; side < profile.ringSides; side += 1) {
      const a = ringVertex(x0, r0, shape, side, profile.ringSides);
      const b = ringVertex(x0, r0, shape, side + 1, profile.ringSides);
      const c = ringVertex(x1, r1, shape, side + 1, profile.ringSides);
      const d = ringVertex(x1, r1, shape, side, profile.ringSides);
      pushTriangle(buffers, a, c, b, color);
      pushTriangle(buffers, a, d, c, color);
    }
  }

  const tail = fishTailFin(shape, profile.finSegments);
  for (let i = 0; i < tail.upperFan.length - 1; i += 1) {
    pushFin(buffers, tail.root, tail.upperFan[i] as Vector3, tail.upperFan[i + 1] as Vector3, finColor);
  }
  for (let i = 0; i < tail.lowerFan.length - 1; i += 1) {
    pushFin(buffers, tail.root, tail.lowerFan[i] as Vector3, tail.lowerFan[i + 1] as Vector3, finColor);
  }

  const dorsal = fishDorsalFin(shape, profile.finSegments);
  for (let i = 0; i < dorsal.length - 1; i += 1) {
    const p0 = dorsal[i] as { base: Vector3; top: Vector3 };
    const p1 = dorsal[i + 1] as { base: Vector3; top: Vector3 };
    pushFin(buffers, p0.base, p1.base, p1.top, finColor);
    pushFin(buffers, p0.base, p1.top, p0.top, finColor);
  }

  for (const side of [1, -1] as const) {
    const pelvic = fishPelvicFin(shape, side);
    pushFin(buffers, pelvic.a, pelvic.b, pelvic.c, finColor);

    const pectoral = fishPectoralFin(shape, profile.finSegments, side);
    for (let i = 0; i < pectoral.fan.length - 1; i += 1) {
      pushFin(buffers, pectoral.root, pectoral.fan[i] as Vector3, pectoral.fan[i + 1] as Vector3, finColor);
    }
  }

  const thread = fishThread(shape, profile.finSegments);
  if (thread) {
    for (let i = 0; i < thread.length - 1; i += 1) {
      const p0 = thread[i] as { top: Vector3; bottom: Vector3 };
      const p1 = thread[i + 1] as { top: Vector3; bottom: Vector3 };
      pushFin(buffers, p0.top, p1.top, p1.bottom, finColor);
      pushFin(buffers, p0.top, p1.bottom, p0.bottom, finColor);
    }
  }

  const eyes = fishEyePoints(shape);
  if (eyes) {
    for (const center of [eyes.left, eyes.right]) {
      for (const [a, b, c] of octahedronFaces(center, eyes.radius)) {
        pushTriangle(buffers, a, b, c, eyeColor);
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(buffers.positions), 3));
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(buffers.colors), 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
