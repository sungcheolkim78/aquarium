/**
 * Shared creature instancing and school simulation (SPEC F2, §6.2).
 *
 * One `InstancedMesh` per registry species keeps the whole school at a single
 * draw call. Body/fin/accent colours ride on a vertex-colour attribute so a
 * species needs no extra material and no texture assets.
 */

import {
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

import {
  FISH_REGISTRY,
  SCENE,
  type DetailLevel,
  type CreatureSpecies,
  type FishSpecies,
} from "./config";
import {
  buildFishGeometry,
} from "./creatures/geometry/fish";
import { buildSharkGeometry } from "./creatures/geometry/shark";
import { buildSeahorseGeometry } from "./creatures/geometry/seahorse";
import { buildTurtleGeometry } from "./creatures/geometry/turtle";

export { buildFishGeometry, computeFacetJitter } from "./creatures/geometry/fish";

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

/** Dispatch a registered creature to the builder for its body plan. */
export function buildCreatureGeometry(
  species: CreatureSpecies,
  detail: DetailLevel = "medium",
): BufferGeometry {
  switch (species.geometry) {
    case "lowpoly-fish":
      return buildFishGeometry(species.shape, species.palette, detail);
    case "lowpoly-shark":
      return buildSharkGeometry(species.shape, species.palette, detail);
    case "lowpoly-seahorse":
      return buildSeahorseGeometry(species.shape, species.palette, detail);
    case "lowpoly-turtle":
      return buildTurtleGeometry(species.shape, species.palette, detail);
  }
}

/** A single simulated fish. */
export interface Boid {
  readonly position: Vector3;
  readonly velocity: Vector3;
  /** Per-instance phase offset for the tail-sway shader. */
  readonly phase: number;
  /** Stable position used as the anchor for non-swimming creatures. */
  readonly hoverOrigin: Vector3;
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
  mesh: InstancedMesh;

  private readonly boids: Boid[] = [];
  private geometry: BufferGeometry;
  private readonly material: MeshLambertMaterial;
  private readonly rng: () => number;
  private readonly timeUniform = { value: 0 };
  private readonly matrix = new Matrix4();
  private readonly quaternion = new Quaternion();
  private readonly unitScale = new Vector3(1, 1, 1);
  private readonly scratch = new Vector3();
  private readonly steer = new Vector3();
  private readonly centroid = new Vector3();
  private readonly heading = new Vector3();
  /** Current instance capacity, set by the user's "fish count" scale (SPEC §6.5.3). */
  private capacity: number;

  constructor(species: FishSpecies, rng: () => number, detail: DetailLevel = "medium") {
    this.species = species;
    this.rng = rng;
    this.capacity = species.count;
    this.geometry = buildCreatureGeometry(species, detail);
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

    this.mesh = new InstancedMesh(this.geometry, this.material, this.capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.name = `school:${species.id}`;

    for (let i = 0; i < this.capacity; i += 1) this.boids.push(this.spawnBoid());
    this.writePhaseAttribute();
    this.writeMatrices();
  }

  /** Fish currently drawn; lowered by the adaptive-quality population step. */
  get visibleCount(): number {
    return this.mesh.count;
  }

  addTo(scene: Scene): void {
    scene.add(this.mesh);
  }

  /** Show or hide the whole species without touching its simulation state (AC-4). */
  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  /** Advance the school. `dt` seconds, `elapsed` seconds since start. */
  update(dt: number, elapsed: number): void {
    this.timeUniform.value = elapsed;
    if (this.species.behavior.locomotion === "hover") {
      this.updateHover(elapsed);
      this.writeMatrices();
      return;
    }
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

  /**
   * Keep `Math.round(capacity * scale)` instances visible, never fewer than
   * one. `capacity` is the current instance allocation (SPEC decision log:
   * the user's "fish count" setting and this adaptive-quality scale are
   * independent axes that multiply together).
   */
  setPopulationScale(scale: number): void {
    const next = Math.max(1, Math.min(this.capacity, Math.round(this.capacity * scale)));
    this.mesh.count = next;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Swap the vertex geometry for a new detail level in place (SPEC §6.5.3). */
  rebuildGeometry(detail: DetailLevel): void {
    const next = buildCreatureGeometry(this.species, detail);
    this.mesh.geometry = next;
    this.geometry.dispose();
    this.geometry = next;
    this.writePhaseAttribute();
  }

  /**
   * Reallocate instance capacity for a new "fish count" scale (SPEC §6.5.3).
   * Existing boids are kept (trimmed or extended); a brand-new `InstancedMesh`
   * replaces the old one in place in the scene graph, since instance capacity
   * is fixed at construction time in three.js.
   */
  rebuildInstances(countScale: number): void {
    const nextCapacity = Math.max(1, Math.round(this.species.count * countScale));
    if (nextCapacity > this.boids.length) {
      while (this.boids.length < nextCapacity) this.boids.push(this.spawnBoid());
    } else {
      this.boids.length = nextCapacity;
    }
    this.capacity = nextCapacity;

    const parent = this.mesh.parent;
    const visible = this.mesh.visible;
    const oldMesh = this.mesh;

    const next = new InstancedMesh(this.geometry, this.material, nextCapacity);
    next.instanceMatrix.setUsage(DynamicDrawUsage);
    next.frustumCulled = false;
    next.name = oldMesh.name;
    next.visible = visible;

    this.mesh = next;
    this.writePhaseAttribute();
    this.writeMatrices();

    if (parent) {
      parent.add(next);
      oldMesh.removeFromParent();
    }
    oldMesh.dispose();
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }

  private spawnBoid(): Boid {
    const rng = this.rng;
    const radius = this.species.behavior.activityRadius;
    const phase = rng() * Math.PI * 2;
    const angle = rng() * Math.PI * 2;
    const dist = radius * (0.35 + 0.6 * rng());
    const position = new Vector3(
        Math.cos(angle) * dist,
        SCENE.floorY + 2.2 + rng() * (SCENE.bounds.y * 1.4),
        Math.sin(angle) * dist,
      );
    return {
      position,
      velocity: new Vector3(rng() - 0.5, (rng() - 0.5) * 0.25, rng() - 0.5)
        .normalize()
        .multiplyScalar(this.species.behavior.speed),
      phase,
      hoverOrigin: position.clone(),
    };
  }

  private updateHover(elapsed: number): void {
    const amplitude = this.species.behavior.hoverAmplitude ?? 0.18;
    const frequency = this.species.behavior.hoverFrequency ?? 0.18;
    for (let i = 0; i < this.mesh.count; i += 1) {
      const boid = this.boids[i];
      if (!boid) continue;
      boid.position.x = boid.hoverOrigin.x;
      boid.position.z = boid.hoverOrigin.z;
      boid.position.y = boid.hoverOrigin.y + Math.sin(elapsed * frequency * Math.PI * 2 + boid.phase) * amplitude;
      boid.velocity.set(0, 0, 0);
    }
  }

  private writePhaseAttribute(): void {
    const phases = new Float32Array(this.capacity);
    for (let i = 0; i < this.capacity; i += 1) phases[i] = this.boids[i]?.phase ?? 0;
    this.geometry.setAttribute("aPhase", new InstancedBufferAttribute(phases, 1));
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

/** Initial settings applied while constructing a school (SPEC §6.5). */
export interface CreateSchoolsOptions {
  readonly detail?: DetailLevel;
  readonly countScale?: number;
  readonly enabledSpecies?: Readonly<Record<string, boolean>>;
}

/** Instantiate every registry species — the only place the registry is read. */
export function createSchools(
  registry: readonly FishSpecies[] = FISH_REGISTRY,
  rng: () => number = createRng(0x5eed),
  options: CreateSchoolsOptions = {},
): FishSchool[] {
  return registry.map((species) => {
    const school = new FishSchool(species, rng, options.detail ?? "medium");
    if (options.countScale !== undefined && options.countScale !== 1) {
      school.rebuildInstances(options.countScale);
    }
    if (options.enabledSpecies?.[species.id] === false) school.setVisible(false);
    return school;
  });
}
