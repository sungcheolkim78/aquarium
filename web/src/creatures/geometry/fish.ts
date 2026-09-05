import { BufferAttribute, BufferGeometry, Color, Vector3 } from "three";

import { FISH_DETAIL_PROFILES, type DetailLevel, type FishShape, type FishSpecies } from "../../config";

interface MeshBuffers {
  readonly positions: number[];
  readonly colors: number[];
}

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
  const shaped = Math.sin(Math.PI * Math.pow(t, 0.62));
  return 0.12 + 0.88 * shaped;
}

function hash2(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/** Deterministic facet perturbation for high-detail fish geometry. */
export function computeFacetJitter(
  ringIndex: number,
  dirIndex: number,
  sides: number,
  seed: number,
  facetJitter: number,
): { angleOffset: number; radialScale: number } {
  if (facetJitter <= 0) return { angleOffset: 0, radialScale: 1 };
  const angleOffset =
    (hash2(ringIndex * 7 + seed, dirIndex * 13 + 1) - 0.5) * facetJitter * ((Math.PI * 2) / sides);
  const radialScale = 1 + (hash2(ringIndex * 3 + seed, dirIndex * 5 + 2) - 0.5) * 2 * facetJitter;
  return { angleOffset, radialScale };
}

function facetJitterSeed(shape: FishShape): number {
  return Math.round(
    shape.length * 1000 + shape.height * 137 + shape.width * 29 + shape.tailSpan * 7 + shape.stripes * 3,
  );
}

function ringVertex(
  x: number,
  radius: number,
  shape: FishShape,
  dirIndex: number,
  sides: number,
  ringIndex = 0,
  seed = 0,
  facetJitter = 0,
): Vector3 {
  const { angleOffset, radialScale } = computeFacetJitter(
    ringIndex,
    dirIndex % sides,
    sides,
    seed,
    facetJitter,
  );
  const angle = (dirIndex / sides) * Math.PI * 2 + angleOffset;
  return new Vector3(
    x,
    Math.cos(angle) * radialScale * (shape.height / 2) * radius,
    Math.sin(angle) * radialScale * (shape.width / 2) * radius,
  );
}

/** Build the original faceted fish body and fins. */
export function buildFishGeometry(
  shape: FishShape,
  palette: FishSpecies["palette"],
  detail: DetailLevel = "medium",
): BufferGeometry {
  const body = new Color(palette.body);
  const fin = new Color(palette.fin);
  const accent = new Color(palette.accent);
  const { bodySegments, ringSides, facetJitter } = FISH_DETAIL_PROFILES[detail];
  const jitterSeed = facetJitterSeed(shape);
  const buffers: MeshBuffers = { positions: [], colors: [] };
  const half = shape.length / 2;

  const stripeSegments = new Set<number>();
  if (shape.stripes > 0) {
    const stride = bodySegments / (shape.stripes + 1);
    for (let s = 1; s <= shape.stripes; s += 1) {
      stripeSegments.add(Math.min(bodySegments - 1, Math.round(s * stride) - 1));
    }
  }

  for (let i = 0; i < bodySegments; i += 1) {
    const t0 = i / bodySegments;
    const t1 = (i + 1) / bodySegments;
    const x0 = half - shape.length * t0;
    const x1 = half - shape.length * t1;
    const r0 = bodyRadius(t0);
    const r1 = bodyRadius(t1);
    const segmentColor = stripeSegments.has(i) ? accent : body;
    for (let k = 0; k < ringSides; k += 1) {
      const a = ringVertex(x0, r0, shape, k, ringSides, i, jitterSeed, facetJitter);
      const b = ringVertex(x0, r0, shape, k + 1, ringSides, i, jitterSeed, facetJitter);
      const c = ringVertex(x1, r1, shape, k + 1, ringSides, i + 1, jitterSeed, facetJitter);
      const d = ringVertex(x1, r1, shape, k, ringSides, i + 1, jitterSeed, facetJitter);
      pushTriangle(buffers, a, c, b, segmentColor);
      pushTriangle(buffers, a, d, c, segmentColor);
    }
  }

  const tailRoot = new Vector3(half - shape.length, 0, 0);
  const tailNotch = new Vector3(tailRoot.x - shape.tailSpan * 0.55, 0, 0);
  const tailTop = new Vector3(tailRoot.x - shape.tailSpan, shape.tailSpan * 0.9, 0);
  const tailBottom = new Vector3(tailRoot.x - shape.tailSpan, -shape.tailSpan * 0.9, 0);
  pushFin(buffers, tailRoot, tailTop, tailNotch, fin);
  pushFin(buffers, tailRoot, tailNotch, tailBottom, fin);

  pushFin(
    buffers,
    new Vector3(half - shape.length * 0.25, shape.height * 0.44, 0),
    new Vector3(half - shape.length * 0.62, shape.height * 0.42, 0),
    new Vector3(half - shape.length * 0.5, shape.height * 0.86, 0),
    fin,
  );

  for (const side of [1, -1]) {
    pushFin(
      buffers,
      new Vector3(half - shape.length * 0.3, 0, (side * shape.width) / 2),
      new Vector3(half - shape.length * 0.52, 0, (side * shape.width) / 2),
      new Vector3(half - shape.length * 0.46, -shape.height * 0.34, side * shape.width * 1.1),
      fin,
    );
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(buffers.positions), 3));
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(buffers.colors), 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
