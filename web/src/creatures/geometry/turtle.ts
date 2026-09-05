import { BufferAttribute, BufferGeometry, Color, Vector3 } from "three";

import type { DetailLevel, FishSpecies, TurtleShape } from "../../config";

interface MeshBuffers {
  readonly positions: number[];
  readonly colors: number[];
}

const DETAIL_PROFILES: Record<DetailLevel, { segments: number; ringSides: number }> = {
  low: { segments: 4, ringSides: 6 },
  medium: { segments: 7, ringSides: 8 },
  high: { segments: 12, ringSides: 10 },
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

function shellRadius(t: number): number {
  return Math.pow(Math.sin(Math.PI * t), 0.45);
}

function shellVertex(
  x: number,
  radius: number,
  shape: TurtleShape,
  index: number,
  sides: number,
): Vector3 {
  const angle = (index / sides) * Math.PI * 2;
  return new Vector3(
    x,
    Math.cos(angle) * shape.shellHeight * 0.5 * radius,
    Math.sin(angle) * shape.shellWidth * 0.5 * radius,
  );
}

/** Build a low-poly turtle shell, head, and four broad flippers along +X. */
export function buildTurtleGeometry(
  shape: TurtleShape,
  palette: FishSpecies["palette"],
  detail: DetailLevel = "medium",
): BufferGeometry {
  const shell = new Color(palette.body);
  const flipper = new Color(palette.fin);
  const accent = new Color(palette.accent);
  const profile = DETAIL_PROFILES[detail];
  const buffers: MeshBuffers = { positions: [], colors: [] };
  const half = shape.shellLength / 2;

  for (let segment = 0; segment < profile.segments; segment += 1) {
    const t0 = segment / profile.segments;
    const t1 = (segment + 1) / profile.segments;
    const x0 = half - shape.shellLength * t0;
    const x1 = half - shape.shellLength * t1;
    const r0 = shellRadius(t0);
    const r1 = shellRadius(t1);
    for (let side = 0; side < profile.ringSides; side += 1) {
      const a = shellVertex(x0, r0, shape, side, profile.ringSides);
      const b = shellVertex(x0, r0, shape, side + 1, profile.ringSides);
      const c = shellVertex(x1, r1, shape, side + 1, profile.ringSides);
      const d = shellVertex(x1, r1, shape, side, profile.ringSides);
      pushTriangle(buffers, a, c, b, shell);
      pushTriangle(buffers, a, d, c, shell);
    }
  }

  const headRoot = new Vector3(half, -shape.shellHeight * 0.04, 0);
  const headTip = new Vector3(half + shape.headLength, -shape.shellHeight * 0.06, 0);
  pushFin(
    buffers,
    new Vector3(headRoot.x, headRoot.y + shape.shellHeight * 0.22, -shape.shellWidth * 0.2),
    new Vector3(headRoot.x, headRoot.y - shape.shellHeight * 0.2, -shape.shellWidth * 0.2),
    headTip,
    accent,
  );
  pushFin(
    buffers,
    new Vector3(headRoot.x, headRoot.y + shape.shellHeight * 0.22, shape.shellWidth * 0.2),
    headTip,
    new Vector3(headRoot.x, headRoot.y - shape.shellHeight * 0.2, shape.shellWidth * 0.2),
    accent,
  );

  const frontX = shape.shellLength * 0.18;
  const rearX = -shape.shellLength * 0.2;
  for (const side of [-1, 1]) {
    pushFin(
      buffers,
      new Vector3(frontX, -shape.shellHeight * 0.12, side * shape.shellWidth * 0.28),
      new Vector3(frontX + shape.flipperSpan * 0.55, -shape.shellHeight * 0.16, side * shape.shellWidth * 0.95),
      new Vector3(frontX - shape.flipperSpan * 0.25, -shape.shellHeight * 0.2, side * shape.shellWidth * 0.3),
      flipper,
    );
    pushFin(
      buffers,
      new Vector3(rearX, -shape.shellHeight * 0.1, side * shape.shellWidth * 0.28),
      new Vector3(rearX - shape.flipperSpan * 0.48, -shape.shellHeight * 0.14, side * shape.shellWidth * 0.82),
      new Vector3(rearX + shape.flipperSpan * 0.18, -shape.shellHeight * 0.2, side * shape.shellWidth * 0.3),
      flipper,
    );
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(buffers.positions), 3));
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(buffers.colors), 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
