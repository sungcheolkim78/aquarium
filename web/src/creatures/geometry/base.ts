import { BufferAttribute, BufferGeometry, Color, Vector3 } from "three";

/** Flat position/color arrays accumulated by a creature builder before being handed to `finalizeCreatureGeometry`. */
export interface MeshBuffers {
  readonly positions: number[];
  readonly colors: number[];
}

export function createMeshBuffers(): MeshBuffers {
  return { positions: [], colors: [] };
}

export function pushVertex(buffers: MeshBuffers, vertex: Vector3, color: Color): void {
  buffers.positions.push(vertex.x, vertex.y, vertex.z);
  buffers.colors.push(color.r, color.g, color.b);
}

export function pushTriangle(buffers: MeshBuffers, a: Vector3, b: Vector3, c: Vector3, color: Color): void {
  pushVertex(buffers, a, color);
  pushVertex(buffers, b, color);
  pushVertex(buffers, c, color);
}

/** Double-sided single triangle — for fins/flippers/spikes that are a single-layer surface with no back geometry. */
export function pushFin(buffers: MeshBuffers, a: Vector3, b: Vector3, c: Vector3, color: Color): void {
  pushTriangle(buffers, a, b, c, color);
  pushTriangle(buffers, a, c, b, color);
}

/** Assemble accumulated buffers into a renderable geometry: position/color attributes, normals, bounding sphere. */
export function finalizeCreatureGeometry(buffers: MeshBuffers): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(buffers.positions), 3));
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(buffers.colors), 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
