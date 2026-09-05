import { BufferAttribute, BufferGeometry, Color, Vector3 } from "three";

import type { DetailLevel, FishSpecies, SeahorseShape } from "../../config";

interface MeshBuffers {
  readonly positions: number[];
  readonly colors: number[];
}

const DETAIL_PROFILES: Record<DetailLevel, { bodySegments: number; ringSides: number; tailSegments: number }> = {
  low: { bodySegments: 4, ringSides: 4, tailSegments: 4 },
  medium: { bodySegments: 7, ringSides: 5, tailSegments: 7 },
  high: { bodySegments: 12, ringSides: 7, tailSegments: 12 },
};

function pushVertex(buffers: MeshBuffers, vertex: Vector3, color: Color): void {
  buffers.positions.push(vertex.x, vertex.y, vertex.z);
  buffers.colors.push(color.r, color.g, color.b);
}

function pushTriangle(buffers: MeshBuffers, a: Vector3, b: Vector3, c: Vector3, color: Color): void {
  pushVertex(buffers, a, color);
  pushVertex(buffers, b, color);
  pushVertex(buffers, c, color);
}

function pushFin(buffers: MeshBuffers, a: Vector3, b: Vector3, c: Vector3, color: Color): void {
  pushTriangle(buffers, a, b, c, color);
  pushTriangle(buffers, a, c, b, color);
}

function bodyRadius(t: number): number {
  return 0.62 + 0.38 * Math.sin(Math.PI * t);
}

function ringVertex(center: Vector3, radius: number, index: number, sides: number): Vector3 {
  const angle = (index / sides) * Math.PI * 2;
  return new Vector3(
    center.x + Math.cos(angle) * radius * 0.5,
    center.y,
    center.z + Math.sin(angle) * radius,
  );
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
  const buffers: MeshBuffers = { positions: [], colors: [] };
  const bottom = -shape.height / 2;

  for (let segment = 0; segment < profile.bodySegments; segment += 1) {
    const t0 = segment / profile.bodySegments;
    const t1 = (segment + 1) / profile.bodySegments;
    const center0 = new Vector3(0, bottom + shape.height * t0, 0);
    const center1 = new Vector3(0, bottom + shape.height * t1, 0);
    const radius0 = shape.width * bodyRadius(t0);
    const radius1 = shape.width * bodyRadius(t1);
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

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(buffers.positions), 3));
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(buffers.colors), 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
