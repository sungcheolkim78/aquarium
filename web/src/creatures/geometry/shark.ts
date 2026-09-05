import { BufferAttribute, BufferGeometry, Color, Vector3 } from "three";

import type { DetailLevel, SharkShape, FishSpecies } from "../../config";

interface MeshBuffers {
  readonly positions: number[];
  readonly colors: number[];
}

const DETAIL_PROFILES: Record<DetailLevel, { segments: number; ringSides: number }> = {
  low: { segments: 4, ringSides: 5 },
  medium: { segments: 6, ringSides: 6 },
  high: { segments: 12, ringSides: 8 },
};

function pushVertex(buffers: MeshBuffers, vertex: Vector3, color: Color): void {
  buffers.positions.push(vertex.x, vertex.y, vertex.z);
  buffers.colors.push(color.r, color.g, color.b);
}

function pushTriangle(
  buffers: MeshBuffers,
  a: Vector3,
  b: Vector3,
  c: Vector3,
  color: Color,
): void {
  pushVertex(buffers, a, color);
  pushVertex(buffers, b, color);
  pushVertex(buffers, c, color);
}

function pushFin(
  buffers: MeshBuffers,
  a: Vector3,
  b: Vector3,
  c: Vector3,
  color: Color,
): void {
  pushTriangle(buffers, a, b, c, color);
  pushTriangle(buffers, a, c, b, color);
}

function bodyRadius(t: number): number {
  return Math.sin(Math.PI * Math.pow(t, 0.72));
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
  const buffers: MeshBuffers = { positions: [], colors: [] };
  const half = shape.length / 2;

  for (let segment = 0; segment < profile.segments; segment += 1) {
    const t0 = segment / profile.segments;
    const t1 = (segment + 1) / profile.segments;
    const x0 = half - shape.length * t0;
    const x1 = half - shape.length * t1;
    const r0 = bodyRadius(t0);
    const r1 = bodyRadius(t1);
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

  const tailRoot = new Vector3(-half, 0, 0);
  pushFin(
    buffers,
    tailRoot,
    new Vector3(-half - shape.tailSpan * 0.72, shape.tailSpan, 0),
    new Vector3(-half - shape.tailSpan, 0.04, 0),
    fin,
  );
  pushFin(
    buffers,
    tailRoot,
    new Vector3(-half - shape.tailSpan * 0.72, -shape.tailSpan * 0.58, 0),
    new Vector3(-half - shape.tailSpan, -0.04, 0),
    fin,
  );

  const dorsalRoot = new Vector3(-shape.length * 0.12, shape.height * 0.34, 0);
  pushFin(
    buffers,
    dorsalRoot,
    new Vector3(-shape.length * 0.28, shape.height * 0.34 + shape.dorsalFinHeight, 0),
    new Vector3(shape.length * 0.08, shape.height * 0.34, 0),
    fin,
  );

  const pectoralRoot = new Vector3(shape.length * 0.02, -shape.height * 0.2, shape.width * 0.35);
  pushFin(
    buffers,
    pectoralRoot,
    new Vector3(shape.length * 0.22, -shape.height * 0.3, shape.width * 1.7),
    new Vector3(-shape.length * 0.18, -shape.height * 0.2, shape.width * 0.3),
    fin,
  );

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(buffers.positions), 3));
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(buffers.colors), 3));
  geometry.computeVertexNormals();
  return geometry;
}
