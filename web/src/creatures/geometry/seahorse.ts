import { BufferGeometry, Color, Vector3 } from "three";

import type { DetailLevel, FishSpecies, SeahorseShape } from "../../config";
import { createMeshBuffers, finalizeCreatureGeometry, pushFin, pushTriangle, type MeshBuffers } from "./base";

const DETAIL_PROFILES: Record<DetailLevel, { bodySegments: number; ringSides: number; tailSegments: number }> = {
  low: { bodySegments: 4, ringSides: 4, tailSegments: 4 },
  medium: { bodySegments: 7, ringSides: 5, tailSegments: 7 },
  high: { bodySegments: 12, ringSides: 7, tailSegments: 12 },
};

/** Trunk cross-section radius; `ridgeAmplitude` layers a periodic bony-plate bulge on top. */
export function seahorseBodyRadius(t: number, ridgeAmplitude: number): number {
  const base = 0.62 + 0.38 * Math.sin(Math.PI * t);
  const ridge = ridgeAmplitude * Math.abs(Math.sin(t * Math.PI * 8));
  return base * (1 + ridge);
}

function ringVertex(center: Vector3, radius: number, index: number, sides: number): Vector3 {
  const angle = (index / sides) * Math.PI * 2;
  return new Vector3(
    center.x + Math.cos(angle) * radius * 0.5,
    center.y,
    center.z + Math.sin(angle) * radius,
  );
}

/** Coronet (crown) spikes on top of the head; empty when `coronetHeight` is 0. */
export function seahorseCoronetSpikes(
  shape: SeahorseShape,
): Array<{ a: Vector3; b: Vector3; tip: Vector3 }> {
  if (shape.coronetHeight <= 0) return [];
  const headY = shape.height * 0.42;
  const spikes: Array<{ a: Vector3; b: Vector3; tip: Vector3 }> = [];
  for (let i = 0; i < 3; i += 1) {
    const t = i / 2 - 0.5;
    const baseX = t * shape.width * 0.5;
    spikes.push({
      a: new Vector3(baseX - shape.width * 0.16, headY + shape.width * 0.2, 0),
      b: new Vector3(baseX + shape.width * 0.16, headY + shape.width * 0.2, 0),
      tip: new Vector3(baseX, headY + shape.width * 0.2 + shape.coronetHeight, 0),
    });
  }
  return spikes;
}

/** Dorsal fin control points, mounted mid-trunk on the back (away from the snout). */
export function seahorseDorsalFin(
  shape: SeahorseShape,
): { root: Vector3; tip: Vector3; base: Vector3 } {
  const root = new Vector3(-shape.width * 0.5, shape.height * 0.1, 0);
  return {
    root,
    tip: new Vector3(-shape.width * 0.5 - shape.dorsalFinHeight, shape.height * 0.22, 0),
    base: new Vector3(-shape.width * 0.5, -shape.height * 0.08, 0),
  };
}

/** Build an upright seahorse: vertical torso, +X-facing snout, and curled tail. */
export function buildSeahorseGeometry(
  shape: SeahorseShape,
  palette: FishSpecies["palette"],
  detail: DetailLevel = "medium",
): BufferGeometry {
  const body = new Color(palette.body);
  const fin = new Color(palette.fin);
  const accent = new Color(palette.accent);
  const profile = DETAIL_PROFILES[detail];
  const buffers: MeshBuffers = createMeshBuffers();
  const bottom = -shape.height / 2;

  for (let segment = 0; segment < profile.bodySegments; segment += 1) {
    const t0 = segment / profile.bodySegments;
    const t1 = (segment + 1) / profile.bodySegments;
    const center0 = new Vector3(0, bottom + shape.height * t0, 0);
    const center1 = new Vector3(0, bottom + shape.height * t1, 0);
    const radius0 = shape.width * seahorseBodyRadius(t0, shape.ridgeAmplitude);
    const radius1 = shape.width * seahorseBodyRadius(t1, shape.ridgeAmplitude);
    const color = segment === profile.bodySegments - 1 ? accent : body;
    for (let side = 0; side < profile.ringSides; side += 1) {
      const a = ringVertex(center0, radius0, side, profile.ringSides);
      const b = ringVertex(center0, radius0, side + 1, profile.ringSides);
      const c = ringVertex(center1, radius1, side + 1, profile.ringSides);
      const d = ringVertex(center1, radius1, side, profile.ringSides);
      pushTriangle(buffers, a, c, b, color);
      pushTriangle(buffers, a, d, c, color);
    }
  }

  const headY = shape.height * 0.42;
  const head = new Vector3(shape.width * 0.18, headY, 0);
  const snoutTip = new Vector3(shape.width * 0.18 + shape.snoutLength, headY - shape.height * 0.04, 0);
  pushFin(
    buffers,
    new Vector3(head.x, head.y + shape.width * 0.32, -shape.width * 0.45),
    new Vector3(head.x, head.y - shape.width * 0.22, -shape.width * 0.45),
    snoutTip,
    accent,
  );
  pushFin(
    buffers,
    new Vector3(head.x, head.y + shape.width * 0.32, shape.width * 0.45),
    snoutTip,
    new Vector3(head.x, head.y - shape.width * 0.22, shape.width * 0.45),
    accent,
  );

  const tailPoints: Vector3[] = [];
  for (let i = 0; i <= profile.tailSegments; i += 1) {
    const t = i / profile.tailSegments;
    const angle = t * Math.PI * 1.55;
    tailPoints.push(
      new Vector3(
        -shape.curlRadius * (1 - Math.cos(angle)),
        bottom - shape.curlRadius * 0.2 + Math.sin(angle) * shape.curlRadius,
        Math.sin(angle) * shape.curlRadius * 0.72,
      ),
    );
  }
  for (let i = 0; i < tailPoints.length - 1; i += 1) {
    const current = tailPoints[i];
    const next = tailPoints[i + 1];
    if (!current || !next) continue;
    const radius = shape.width * (0.42 - 0.25 * (i / profile.tailSegments));
    for (let side = 0; side < profile.ringSides; side += 1) {
      const a = ringVertex(current, radius, side, profile.ringSides);
      const b = ringVertex(current, radius, side + 1, profile.ringSides);
      const c = ringVertex(next, radius * 0.94, side + 1, profile.ringSides);
      const d = ringVertex(next, radius * 0.94, side, profile.ringSides);
      pushTriangle(buffers, a, c, b, fin);
      pushTriangle(buffers, a, d, c, fin);
    }
  }

  const finRoot = new Vector3(shape.width * 0.52, 0, 0);
  pushFin(
    buffers,
    finRoot,
    new Vector3(shape.width * 0.52 + shape.finSpan, shape.height * 0.04, 0),
    new Vector3(shape.width * 0.52, -shape.height * 0.12, 0),
    fin,
  );

  for (const spike of seahorseCoronetSpikes(shape)) {
    pushFin(buffers, spike.a, spike.b, spike.tip, accent);
  }

  const dorsalFin = seahorseDorsalFin(shape);
  pushFin(buffers, dorsalFin.root, dorsalFin.tip, dorsalFin.base, fin);

  return finalizeCreatureGeometry(buffers);
}
