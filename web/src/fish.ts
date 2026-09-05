/**
 * Procedural low-poly fish geometry and instanced school simulation (SPEC F2, §6.2).
 *
 * One `InstancedMesh` per registry species keeps the whole school at a single
 * draw call. Body/fin/accent colours ride on a vertex-colour attribute so a
 * species needs no extra material and no texture assets.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type Scene,
} from "three";

import { FISH_REGISTRY, SCENE, type FishShape, type FishSpecies } from "./config";

/** Fish geometry is modelled nose-first along +X. */
export const FORWARD = new Vector3(1, 0, 0);

/** Deterministic 32-bit PRNG (mulberry32) so scenes and tests are repeatable. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cross-section directions (y, z) walked counter-clockwise around the body. */
const RING_DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

/** Number of body segments; 5 keeps the silhouette faceted and cheap. */
const BODY_SEGMENTS = 5;

/** Radius profile along the body: widest just behind the head. */
function bodyRadius(t: number): number {
  const shaped = Math.sin(Math.PI * Math.pow(t, 0.62));
  return 0.12 + 0.88 * shaped;
}

interface MeshBuffers {
  readonly positions: number[];
  readonly colors: number[];
}

function pushVertex(buffers: MeshBuffers, v: Vector3, c: Color): void {
  buffers.positions.push(v.x, v.y, v.z);
  buffers.colors.push(c.r, c.g, c.b);
}

function pushTriangle(buffers: MeshBuffers, a: Vector3, b: Vector3, c: Vector3, color: Color): void {
  pushVertex(buffers, a, color);
  pushVertex(buffers, b, color);
  pushVertex(buffers, c, color);
}

/** Emit a triangle twice with opposite winding so thin fins read from both sides. */
function pushFin(buffers: MeshBuffers, a: Vector3, b: Vector3, c: Vector3, color: Color): void {
  pushTriangle(buffers, a, b, c, color);
  pushTriangle(buffers, a, c, b, color);
}

function ringVertex(x: number, radius: number, shape: FishShape, dirIndex: number): Vector3 {
  const dir = RING_DIRS[dirIndex % RING_DIRS.length];
  const [dy, dz] = dir ?? [1, 0];
  return new Vector3(x, dy * (shape.height / 2) * radius, dz * (shape.width / 2) * radius);
}

/**
 * Build a faceted fish body plus caudal, dorsal and pectoral fins.
 * Roughly 50 triangles per species — 40 fish stay far under the N1 budget.
 */
export function buildFishGeometry(shape: FishShape, palette: FishSpecies["palette"]): BufferGeometry {
  const body = new Color(palette.body);
  const fin = new Color(palette.fin);
  const accent = new Color(palette.accent);

  const buffers: MeshBuffers = { positions: [], colors: [] };
  const half = shape.length / 2;

  const stripeSegments = new Set<number>();
  if (shape.stripes > 0) {
    const stride = BODY_SEGMENTS / (shape.stripes + 1);
    for (let s = 1; s <= shape.stripes; s += 1) {
      stripeSegments.add(Math.min(BODY_SEGMENTS - 1, Math.round(s * stride) - 1));
    }
  }

  for (let i = 0; i < BODY_SEGMENTS; i += 1) {
    const t0 = i / BODY_SEGMENTS;
    const t1 = (i + 1) / BODY_SEGMENTS;
    const x0 = half - shape.length * t0;
    const x1 = half - shape.length * t1;
    const r0 = bodyRadius(t0);
    const r1 = bodyRadius(t1);
    const segmentColor = stripeSegments.has(i) ? accent : body;

    for (let k = 0; k < RING_DIRS.length; k += 1) {
      const a = ringVertex(x0, r0, shape, k);
      const b = ringVertex(x0, r0, shape, k + 1);
      const c = ringVertex(x1, r1, shape, k + 1);
      const d = ringVertex(x1, r1, shape, k);
      // Winding chosen so face normals point away from the body axis.
      pushTriangle(buffers, a, c, b, segmentColor);
      pushTriangle(buffers, a, d, c, segmentColor);
    }
  }

  // Caudal (tail) fin: forked, in the X-Y plane behind the body.
  const tailRoot = new Vector3(half - shape.length, 0, 0);
  const tailNotch = new Vector3(tailRoot.x - shape.tailSpan * 0.55, 0, 0);
  const tailTop = new Vector3(tailRoot.x - shape.tailSpan, shape.tailSpan * 0.9, 0);
  const tailBottom = new Vector3(tailRoot.x - shape.tailSpan, -shape.tailSpan * 0.9, 0);
  pushFin(buffers, tailRoot, tailTop, tailNotch, fin);
  pushFin(buffers, tailRoot, tailNotch, tailBottom, fin);

  // Dorsal fin.
  pushFin(
    buffers,
    new Vector3(half - shape.length * 0.25, shape.height * 0.44, 0),
    new Vector3(half - shape.length * 0.62, shape.height * 0.42, 0),
    new Vector3(half - shape.length * 0.5, shape.height * 0.86, 0),
    fin,
  );

  // Pectoral fins, one per flank.
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

/** A single simulated fish. */
export interface Boid {
  readonly position: Vector3;
  readonly velocity: Vector3;
  /** Per-instance phase offset for the tail-sway shader. */
  readonly phase: number;
}

/** Mean position of a school; returns the origin for an empty school. */
export function computeCentroid(boids: readonly Boid[], out = new Vector3()): Vector3 {
  out.set(0, 0, 0);
  if (boids.length === 0) return out;
  for (const boid of boids) out.add(boid.position);
  return out.divideScalar(boids.length);
}

/**
 * Soft containment: pushes a fish back toward the swimmable box before it
 * reaches the wall, so the motion never snaps or wraps.
 */
export function containSteer(
  position: Vector3,
  bounds: { readonly x: number; readonly y: number; readonly z: number },
  floorY: number,
  margin = 2,
  out = new Vector3(),
): Vector3 {
  out.set(0, 0, 0);
  const ceilingY = floorY + bounds.y * 2;
  if (position.x > bounds.x - margin) out.x -= position.x - (bounds.x - margin);
  if (position.x < -bounds.x + margin) out.x += -bounds.x + margin - position.x;
  if (position.z > bounds.z - margin) out.z -= position.z - (bounds.z - margin);
  if (position.z < -bounds.z + margin) out.z += -bounds.z + margin - position.z;
  if (position.y > ceilingY - margin) out.y -= position.y - (ceilingY - margin);
  if (position.y < floorY + margin) out.y += floorY + margin - position.y;
  return out;
}

const COHESION = 0.5;
const SEPARATION = 1.4;
const SEPARATION_RADIUS = 0.95;
const CONTAIN = 1.8;
const WANDER = 0.55;

/** One species' school: geometry, instanced mesh, and its steering update. */
export class FishSchool {
  readonly species: FishSpecies;
  readonly mesh: InstancedMesh;

  private readonly boids: Boid[] = [];
  private readonly geometry: BufferGeometry;
  private readonly material: MeshLambertMaterial;
  private readonly timeUniform = { value: 0 };
  private readonly matrix = new Matrix4();
  private readonly quaternion = new Quaternion();
  private readonly unitScale = new Vector3(1, 1, 1);
  private readonly scratch = new Vector3();
  private readonly steer = new Vector3();
  private readonly centroid = new Vector3();
  private readonly heading = new Vector3();

  constructor(species: FishSpecies, rng: () => number) {
    this.species = species;
    this.geometry = buildFishGeometry(species.shape, species.palette);
    this.material = new MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
      emissive: new Color(species.palette.body).multiplyScalar(0.12),
    });
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms["uTime"] = this.timeUniform;
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
uniform float uTime;
attribute float aPhase;`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
float swayWeight = clamp(0.5 - transformed.x / ${species.shape.length.toFixed(4)}, 0.0, 1.0);
float swayWave = sin(uTime * 6.2 + aPhase + transformed.x * 4.0);
transformed.z += swayWave * swayWeight * swayWeight * ${(species.shape.length * 0.28).toFixed(4)};`,
        );
    };

    this.mesh = new InstancedMesh(this.geometry, this.material, species.count);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.name = `school:${species.id}`;

    const phases = new Float32Array(species.count);
    const radius = species.behavior.activityRadius;
    for (let i = 0; i < species.count; i += 1) {
      const phase = rng() * Math.PI * 2;
      phases[i] = phase;
      const angle = rng() * Math.PI * 2;
      const dist = radius * (0.35 + 0.6 * rng());
      this.boids.push({
        position: new Vector3(
          Math.cos(angle) * dist,
          SCENE.floorY + 2.2 + rng() * (SCENE.bounds.y * 1.4),
          Math.sin(angle) * dist,
        ),
        velocity: new Vector3(rng() - 0.5, (rng() - 0.5) * 0.25, rng() - 0.5)
          .normalize()
          .multiplyScalar(species.behavior.speed),
        phase,
      });
    }
    this.geometry.setAttribute("aPhase", new InstancedBufferAttribute(phases, 1));
    this.writeMatrices();
  }

  /** Fish currently drawn; lowered by the adaptive-quality population step. */
  get visibleCount(): number {
    return this.mesh.count;
  }

  addTo(scene: Scene): void {
    scene.add(this.mesh);
  }

  /** Advance the school. `dt` seconds, `elapsed` seconds since start. */
  update(dt: number, elapsed: number): void {
    this.timeUniform.value = elapsed;
    const { speed, schooling } = this.species.behavior;
    const active = this.mesh.count;
    const school = this.boids.slice(0, active);
    if (schooling) computeCentroid(school, this.centroid);

    for (let i = 0; i < active; i += 1) {
      const boid = school[i];
      if (!boid) continue;
      this.steer.set(0, 0, 0);

      if (schooling) {
        this.scratch.copy(this.centroid).sub(boid.position).multiplyScalar(COHESION * 0.1);
        this.steer.add(this.scratch);
        for (let j = 0; j < active; j += 1) {
          if (j === i) continue;
          const other = school[j];
          if (!other) continue;
          this.scratch.copy(boid.position).sub(other.position);
          const dist = this.scratch.length();
          if (dist > 1e-4 && dist < SEPARATION_RADIUS) {
            this.steer.add(
              this.scratch.multiplyScalar(SEPARATION / (dist * Math.max(dist, 0.2))),
            );
          }
        }
      }

      this.steer.add(
        this.scratch
          .set(
            Math.sin(elapsed * 0.41 + boid.phase),
            Math.sin(elapsed * 0.27 + boid.phase * 1.7) * 0.35,
            Math.cos(elapsed * 0.33 + boid.phase * 1.3),
          )
          .multiplyScalar(WANDER),
      );

      this.steer.add(
        containSteer(boid.position, SCENE.bounds, SCENE.floorY, 2, this.scratch).multiplyScalar(
          CONTAIN,
        ),
      );

      boid.velocity.addScaledVector(this.steer, dt);
      const currentSpeed = boid.velocity.length();
      if (currentSpeed < 1e-4) {
        boid.velocity.copy(FORWARD).multiplyScalar(speed);
      } else {
        boid.velocity.multiplyScalar(1 + (speed / currentSpeed - 1) * Math.min(1, dt * 1.8));
      }
      boid.position.addScaledVector(boid.velocity, dt);
    }

    this.writeMatrices();
  }

  /** Keep `Math.round(count * scale)` instances, never fewer than one. */
  setPopulationScale(scale: number): void {
    const next = Math.max(1, Math.min(this.species.count, Math.round(this.species.count * scale)));
    this.mesh.count = next;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }

  private writeMatrices(): void {
    for (let i = 0; i < this.mesh.count; i += 1) {
      const boid = this.boids[i];
      if (!boid) continue;
      this.heading.copy(boid.velocity);
      if (this.heading.lengthSq() < 1e-8) this.heading.copy(FORWARD);
      this.heading.normalize();
      this.quaternion.setFromUnitVectors(FORWARD, this.heading);
      this.matrix.compose(boid.position, this.quaternion, this.unitScale);
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Instantiate every registry species — the only place the registry is read. */
export function createSchools(
  registry: readonly FishSpecies[] = FISH_REGISTRY,
  rng: () => number = createRng(0x5eed),
): FishSchool[] {
  return registry.map((species) => new FishSchool(species, rng));
}
