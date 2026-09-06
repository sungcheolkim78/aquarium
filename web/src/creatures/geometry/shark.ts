import { BufferGeometry, Color, Vector3 } from "three";

import type { DetailLevel, SharkShape, FishSpecies } from "../../config";
import { createMeshBuffers, finalizeCreatureGeometry, pushFin, pushTriangle, type MeshBuffers } from "./base";

const DETAIL_PROFILES: Record<DetailLevel, { segments: number; ringSides: number }> = {
  low: { segments: 4, ringSides: 5 },
  medium: { segments: 6, ringSides: 6 },
  high: { segments: 12, ringSides: 8 },
};

/** Nose-to-tail cross-section radius; a higher `snoutTaper` sharpens the nose into a conical point. */
export function sharkBodyRadius(t: number, snoutTaper: number): number {
  return Math.sin(Math.PI * Math.pow(t, snoutTaper));
}

function ringVertex(
  x: number,
  radius: number,
  shape: SharkShape,
  index: number,
  sides: number,
): Vector3 {
  const angle = (index / sides) * Math.PI * 2;
  return new Vector3(
    x,
    Math.cos(angle) * (shape.height / 2) * radius,
    Math.sin(angle) * (shape.width / 2) * radius,
  );
}

/** Caudal fin control points; `tailAsymmetry` < 1 shrinks the lower lobe for a heterocercal silhouette. */
export function sharkTailLobes(
  shape: SharkShape,
): {
  root: Vector3;
  upperTip: Vector3;
  upperInner: Vector3;
  lowerTip: Vector3;
  lowerInner: Vector3;
} {
  const half = shape.length / 2;
  const root = new Vector3(-half, 0, 0);
  const lowerSpan = shape.tailSpan * shape.tailAsymmetry;
  return {
    root,
    upperTip: new Vector3(-half - shape.tailSpan * 0.72, shape.tailSpan, 0),
    upperInner: new Vector3(-half - shape.tailSpan, 0.04, 0),
    lowerTip: new Vector3(-half - lowerSpan * 0.72, -lowerSpan, 0),
    lowerInner: new Vector3(-half - lowerSpan, -0.04, 0),
  };
}

/** Pectoral fin control points; `pectoralSweep` pulls the tip back toward the tail. */
export function sharkPectoralFin(
  shape: SharkShape,
): { root: Vector3; tip: Vector3; inner: Vector3 } {
  const root = new Vector3(shape.length * 0.02, -shape.height * 0.2, shape.width * 0.35);
  const tip = new Vector3(
    shape.length * 0.22 - shape.pectoralSweep * shape.length * 0.3,
    -shape.height * 0.3,
    shape.width * 1.7,
  );
  const inner = new Vector3(-shape.length * 0.18, -shape.height * 0.2, shape.width * 0.3);
  return { root, tip, inner };
}

/** Accent-coloured gill-slit notches on the flank just behind the head. */
export function sharkGillSlits(
  shape: SharkShape,
): Array<{ a: Vector3; b: Vector3; c: Vector3 }> {
  const slits: Array<{ a: Vector3; b: Vector3; c: Vector3 }> = [];
  for (let i = 0; i < shape.gillSlits; i += 1) {
    const t = shape.gillSlits === 1 ? 0.5 : i / (shape.gillSlits - 1);
    const x = shape.length * 0.32 - t * shape.length * 0.14;
    const z = shape.width * 0.48;
    slits.push({
      a: new Vector3(x, shape.height * 0.18, z),
      b: new Vector3(x, -shape.height * 0.2, z),
      c: new Vector3(x - shape.length * 0.03, -shape.height * 0.02, z * 1.15),
    });
  }
  return slits;
}

/** Build a faceted shark with an asymmetric caudal fin and dorsal fin. */
export function buildSharkGeometry(
  shape: SharkShape,
  palette: FishSpecies["palette"],
  detail: DetailLevel = "medium",
): BufferGeometry {
  const body = new Color(palette.body);
  const fin = new Color(palette.fin);
  const accent = new Color(palette.accent);
  const profile = DETAIL_PROFILES[detail];
  const buffers: MeshBuffers = createMeshBuffers();
  const half = shape.length / 2;

  for (let segment = 0; segment < profile.segments; segment += 1) {
    const t0 = segment / profile.segments;
    const t1 = (segment + 1) / profile.segments;
    const x0 = half - shape.length * t0;
    const x1 = half - shape.length * t1;
    const r0 = sharkBodyRadius(t0, shape.snoutTaper);
    const r1 = sharkBodyRadius(t1, shape.snoutTaper);
    const color = segment === profile.segments - 1 ? accent : body;
    for (let side = 0; side < profile.ringSides; side += 1) {
      const a = ringVertex(x0, r0, shape, side, profile.ringSides);
      const b = ringVertex(x0, r0, shape, side + 1, profile.ringSides);
      const c = ringVertex(x1, r1, shape, side + 1, profile.ringSides);
      const d = ringVertex(x1, r1, shape, side, profile.ringSides);
      pushTriangle(buffers, a, c, b, color);
      pushTriangle(buffers, a, d, c, color);
    }
  }

  const tailLobes = sharkTailLobes(shape);
  pushFin(buffers, tailLobes.root, tailLobes.upperTip, tailLobes.upperInner, fin);
  pushFin(buffers, tailLobes.root, tailLobes.lowerTip, tailLobes.lowerInner, fin);

  const dorsalRoot = new Vector3(-shape.length * 0.12, shape.height * 0.34, 0);
  pushFin(
    buffers,
    dorsalRoot,
    new Vector3(-shape.length * 0.28, shape.height * 0.34 + shape.dorsalFinHeight, 0),
    new Vector3(shape.length * 0.08, shape.height * 0.34, 0),
    fin,
  );

  const pectoral = sharkPectoralFin(shape);
  pushFin(buffers, pectoral.root, pectoral.tip, pectoral.inner, fin);

  for (const slit of sharkGillSlits(shape)) {
    pushFin(buffers, slit.a, slit.b, slit.c, accent);
  }

  return finalizeCreatureGeometry(buffers);
}
