/**
 * Procedural underwater environment (SPEC F4, §6.3).
 *
 * Everything is generated at runtime — no textures, no models. Coral clusters,
 * god-ray planes and the sea floor are merged into single geometries so the
 * whole reef costs three draw calls, and the caustics/sway are shader-only.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Euler,
  FogExp2,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  TorusGeometry,
  Vector3,
  type Scene,
} from "three";

import {
  BACKGROUND_DETAIL_PROFILES,
  DEFAULT_ENVIRONMENT_PRESET,
  SCENE,
  SEAWEED_COUNT,
  type CoralDetailProfile,
  type DetailLevel,
  type EnvironmentPreset,
} from "./config";

/** Shared animation clock handed to every generated shader. */
export interface TimeUniform {
  value: number;
}

/** Shared 0/1 switch handed to a shader; toggling it needs no recompile. */
export interface ToggleUniform {
  value: number;
}

/** Coral cluster count and seaweed instance count for a given scale (SPEC §6.5.4). */
export function computeObjectCounts(
  objectCountScale: number,
  baseClusters: number = SCENE.coral.clusters,
  baseSeaweed: number = SEAWEED_COUNT,
): { coralClusters: number; seaweedCount: number } {
  return {
    coralClusters: Math.max(1, Math.round(baseClusters * objectCountScale)),
    seaweedCount: Math.max(1, Math.round(baseSeaweed * objectCountScale)),
  };
}

function macroHeightField(x: number, z: number): number {
  return Math.sin(x * 0.045) * 0.6 + Math.cos(z * 0.05) * 0.5;
}

// Deliberately different frequency/phase from macroHeightField: biome regions
// don't just trace the height contours.
function macroBiomeField(x: number, z: number): number {
  return Math.sin(x * 0.031 + 1.7) * 0.5 + Math.cos(z * 0.027 - 0.9) * 0.5; // range [-1, 1]
}

type HeightTerrain = Pick<EnvironmentPreset["terrain"], "relief" | "roughness">;

/** Height Map: macro field + the original 3-term detail dune formula, each independently scaled. */
export function terrainHeight(x: number, z: number, terrain: HeightTerrain): number {
  const detail = Math.sin(x * 0.16) * 0.55 + Math.cos(z * 0.21) * 0.45 + Math.sin((x + z) * 0.09) * 0.7;
  return terrain.relief * macroHeightField(x, z) + terrain.roughness * detail;
}

const ANALYSIS_EPSILON = 0.5;

/** Gradient magnitude via finite difference. */
export function terrainSlope(x: number, z: number, terrain: HeightTerrain): number {
  const h0 = terrainHeight(x, z, terrain);
  const hx = terrainHeight(x + ANALYSIS_EPSILON, z, terrain);
  const hz = terrainHeight(x, z + ANALYSIS_EPSILON, terrain);
  return Math.hypot(hx - h0, hz - h0) / ANALYSIS_EPSILON;
}

/** Discrete Laplacian: negative = convex (ridge/bump), positive = concave (valley). */
export function terrainCurvature(x: number, z: number, terrain: HeightTerrain): number {
  const h0 = terrainHeight(x, z, terrain);
  const sum =
    terrainHeight(x + ANALYSIS_EPSILON, z, terrain) +
    terrainHeight(x - ANALYSIS_EPSILON, z, terrain) +
    terrainHeight(x, z + ANALYSIS_EPSILON, terrain) +
    terrainHeight(x, z - ANALYSIS_EPSILON, terrain);
  return (sum - 4 * h0) / (ANALYSIS_EPSILON * ANALYSIS_EPSILON);
}

export type Biome = "sand" | "reef" | "cliff";

export function classifyBiome(x: number, z: number, terrain: EnvironmentPreset["terrain"]): Biome {
  const slope = terrainSlope(x, z, terrain);
  const curvature = terrainCurvature(x, z, terrain);
  const biomeTendency = macroBiomeField(x, z);

  const cliffThreshold = 0.55 - terrain.cliffBias * 0.3;
  if (slope > cliffThreshold) return "cliff";

  const convexBonus = curvature < 0 ? 0.08 : 0;
  const reefThreshold = 0.15 - terrain.reefBias * 0.12;
  if (slope + convexBonus > reefThreshold && biomeTendency > -terrain.reefBias) return "reef";

  return "sand";
}

export interface ScatterPoint {
  readonly position: Vector3;
  readonly biome: Biome;
}

/** Same polar placement as today's coral clusters (radius 4.5–13, keeping the open center), now height- and biome-aware. */
export function computeScatterPoints(
  rng: () => number,
  count: number,
  terrain: EnvironmentPreset["terrain"],
): ScatterPoint[] {
  const points: ScatterPoint[] = [];
  for (let c = 0; c < count; c += 1) {
    const angle = (c / count) * Math.PI * 2 + rng() * 0.35;
    const radius = 4.5 + rng() * 8.5;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = SCENE.floorY + terrainHeight(x, z, terrain);
    points.push({ position: new Vector3(x, y, z), biome: classifyBiome(x, z, terrain) });
  }
  return points;
}

/** Strip a primitive down to position/normal/color, baked into world space. */
function bake(source: BufferGeometry, matrix: Matrix4, color: Color): BufferGeometry {
  const geometry = source.index === null ? source.clone() : source.toNonIndexed();
  geometry.applyMatrix4(matrix);
  geometry.deleteAttribute("uv");
  if (geometry.getAttribute("normal") === undefined) geometry.computeVertexNormals();
  const count = geometry.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  source.dispose();
  return geometry;
}

/**
 * Merge non-indexed position/normal/color geometries into one.
 * Local implementation so the app never imports a three addon.
 */
export function mergeBaked(parts: readonly BufferGeometry[]): BufferGeometry {
  let vertices = 0;
  for (const part of parts) vertices += part.getAttribute("position").count;

  const positions = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  const colors = new Float32Array(vertices * 3);

  let offset = 0;
  for (const part of parts) {
    positions.set(part.getAttribute("position").array as Float32Array, offset);
    normals.set(part.getAttribute("normal").array as Float32Array, offset);
    colors.set(part.getAttribute("color").array as Float32Array, offset);
    offset += part.getAttribute("position").count * 3;
    part.dispose();
  }

  const merged = new BufferGeometry();
  merged.setAttribute("position", new BufferAttribute(positions, 3));
  merged.setAttribute("normal", new BufferAttribute(normals, 3));
  merged.setAttribute("color", new BufferAttribute(colors, 3));
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Add shimmering light bands to any lit material (cheap analytic caustics).
 * `enabled` is a live 0/1 switch (SPEC §6.5.3) so the settings panel's caustics
 * toggle needs no shader recompile.
 */
export function applyCaustics(
  material: MeshLambertMaterial,
  time: TimeUniform,
  enabled: ToggleUniform,
  tint: Color = new Color(DEFAULT_ENVIRONMENT_PRESET.caustics.tint),
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms["uTime"] = time;
    shader.uniforms["uCausticsEnabled"] = enabled;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCausticPos;")
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
vCausticPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uTime;
uniform float uCausticsEnabled;
varying vec3 vCausticPos;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
vec2 cp = vCausticPos.xz * 0.55;
float ct = uTime * 0.32;
float wave = sin( cp.x + ct ) * sin( cp.y * 1.27 - ct * 0.8 )
  + sin( ( cp.x + cp.y ) * 0.71 + ct * 1.15 );
float caustic = pow( max( wave * 0.5 + 0.5, 0.0 ), 3.0 );
float depthFade = smoothstep( ${(SCENE.floorY - 1).toFixed(2)}, ${(SCENE.floorY + 6).toFixed(2)}, vCausticPos.y );
diffuseColor.rgb += vec3( ${tint.r.toFixed(3)}, ${tint.g.toFixed(3)}, ${tint.b.toFixed(3)} ) * caustic * mix( 1.0, 0.35, depthFade ) * uCausticsEnabled;`,
      );
  };
}

const ROCK_TINT_RADIUS = 2.5;

/** `segments` is the floor's detail-level knob (SPEC §6.2): higher = smoother dunes. */
export function createFloor(
  time: TimeUniform,
  segments: number = BACKGROUND_DETAIL_PROFILES.medium.floorSegments,
  causticsEnabled: ToggleUniform = { value: 1 },
  preset: EnvironmentPreset = DEFAULT_ENVIRONMENT_PRESET,
  scatterPoints: readonly ScatterPoint[] = [],
): Mesh {
  const geometry = new PlaneGeometry(72, 72, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  geometry.deleteAttribute("uv");

  const position = geometry.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  const deep = new Color(preset.floor.deep);
  const sand = new Color(preset.floor.sand);
  const rock = new Color(preset.terrain.rockColor);
  const tint = new Color();

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const dune = terrainHeight(x, z, preset.terrain);
    position.setY(i, dune);
    const t = Math.min(1, Math.max(0, dune * 0.35 + 0.5));
    tint.copy(deep).lerp(sand, t);

    let nearestDistSq = Infinity;
    let nearestBiome: Biome | null = null;
    for (const point of scatterPoints) {
      const dx = x - point.position.x;
      const dz = z - point.position.z;
      const distSq = dx * dx + dz * dz;
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearestBiome = point.biome;
      }
    }
    if (nearestBiome === "cliff") {
      const blend = Math.max(0, 1 - Math.sqrt(nearestDistSq) / ROCK_TINT_RADIUS);
      if (blend > 0) tint.lerp(rock, blend);
    }

    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  applyCaustics(material, time, causticsEnabled, new Color(preset.caustics.tint));

  const mesh = new Mesh(geometry, material);
  mesh.position.y = SCENE.floorY;
  mesh.name = "floor";
  return mesh;
}

/**
 * `profile` sets each primitive's segment counts (SPEC §6.2); `points` are the
 * reef-classified, coral-assigned scatter points this cluster set should
 * render at (see `computeScatterPoints` / the coral-vs-rock split in
 * `createEnvironment`) — the two are independent.
 */
export function createCoral(
  rng: () => number,
  time: TimeUniform,
  profile: CoralDetailProfile = BACKGROUND_DETAIL_PROFILES.medium.coral,
  points: readonly ScatterPoint[] = [],
  causticsEnabled: ToggleUniform = { value: 1 },
  preset: EnvironmentPreset = DEFAULT_ENVIRONMENT_PRESET,
): Mesh {
  const parts: BufferGeometry[] = [];
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const euler = new Euler();
  const scale = new Vector3();
  const position = new Vector3();

  const place = (source: BufferGeometry, color: Color): void => {
    quaternion.setFromEuler(euler);
    matrix.compose(position, quaternion, scale);
    parts.push(bake(source, matrix, color));
  };

  for (const point of points) {
    const baseX = point.position.x;
    const baseY = point.position.y;
    const baseZ = point.position.z;
    const hue = (preset.coral.colors[Math.floor(rng() * preset.coral.colors.length)] ??
      preset.coral.colors[0]) as string;
    const color = new Color(hue).multiplyScalar(0.55 + rng() * 0.3);
    const pieces = 2 + Math.floor(rng() * 3);

    for (let p = 0; p < pieces; p += 1) {
      const height = 0.7 + rng() * 1.9;
      const spread = 0.5 + rng() * 0.9;
      position.set(baseX + (rng() - 0.5) * 1.6, baseY + height * 0.5, baseZ + (rng() - 0.5) * 1.6);
      euler.set((rng() - 0.5) * 0.3, rng() * Math.PI * 2, (rng() - 0.5) * 0.3);
      scale.set(1, 1, 1);

      const kind = rng();
      if (kind < 0.45) {
        place(new ConeGeometry(spread * 0.55, height, profile.coneRadial, profile.coneHeight), color);
      } else if (kind < 0.75) {
        scale.set(spread * 0.8, height * 0.55, spread * 0.8);
        place(new IcosahedronGeometry(0.75, profile.icosahedronDetail), color);
      } else {
        euler.x += Math.PI / 2;
        place(
          new TorusGeometry(spread * 0.6, spread * 0.18, profile.torusRadial, profile.torusTubular),
          color,
        );
      }

      if (rng() < 0.4) {
        position.y = baseY + 0.18;
        euler.set(0, rng() * Math.PI * 2, 0);
        scale.set(1, 1, 1);
        place(
          new CylinderGeometry(
            spread * 0.7,
            spread * 0.9,
            0.36,
            profile.cylinderRadial,
            profile.cylinderHeight,
          ),
          color,
        );
      }
    }
  }

  const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  applyCaustics(material, time, causticsEnabled, new Color(preset.caustics.tint));

  const mesh = new Mesh(mergeBaked(parts), material);
  mesh.name = "coral";
  return mesh;
}

const CLIFF_HEIGHT_MIN = 2.4;
const CLIFF_HEIGHT_MAX = 4.2;
const CLIFF_TILT_MAX = (25 * Math.PI) / 180;

/**
 * Rock/cliff scatter — the "Primary Scatter: Rock" sibling to `createCoral`'s
 * "Primary Scatter: Large Coral" (docs/superpowers/specs/2026-09-06-procedural-terrain-biomes-design.md §1).
 * `cliff`-biome points get one tall, steeply-tilted formation; `reef`-biome
 * points (routed here instead of to coral, see `createEnvironment`) get a
 * boulder cluster at coral-like scale.
 */
export function createRocks(
  rng: () => number,
  time: TimeUniform,
  profile: CoralDetailProfile = BACKGROUND_DETAIL_PROFILES.medium.coral,
  points: readonly ScatterPoint[] = [],
  causticsEnabled: ToggleUniform = { value: 1 },
  preset: EnvironmentPreset = DEFAULT_ENVIRONMENT_PRESET,
): Mesh {
  const parts: BufferGeometry[] = [];
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const euler = new Euler();
  const scale = new Vector3();
  const position = new Vector3();
  const baseColor = new Color(preset.terrain.rockColor);

  const place = (source: BufferGeometry, color: Color): void => {
    quaternion.setFromEuler(euler);
    matrix.compose(position, quaternion, scale);
    parts.push(bake(source, matrix, color));
  };

  for (const point of points) {
    const color = baseColor.clone().multiplyScalar(0.75 + rng() * 0.3);

    if (point.biome === "cliff") {
      const height = CLIFF_HEIGHT_MIN + rng() * (CLIFF_HEIGHT_MAX - CLIFF_HEIGHT_MIN);
      const width = 0.5 + rng() * 0.5;
      position.set(point.position.x, point.position.y + height * 0.4, point.position.z);
      euler.set((rng() - 0.5) * CLIFF_TILT_MAX, rng() * Math.PI * 2, (rng() - 0.5) * CLIFF_TILT_MAX);
      scale.set(1, 1, 1);
      place(
        new CylinderGeometry(width * 0.4, width, height, profile.cylinderRadial, profile.cylinderHeight),
        color,
      );
    } else {
      const pieces = 1 + Math.floor(rng() * 2);
      for (let p = 0; p < pieces; p += 1) {
        const spread = 0.5 + rng() * 0.8;
        position.set(
          point.position.x + (rng() - 0.5) * 1.4,
          point.position.y + spread * 0.5,
          point.position.z + (rng() - 0.5) * 1.4,
        );
        euler.set(rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2);
        scale.set(spread, spread * (0.6 + rng() * 0.4), spread);
        place(new IcosahedronGeometry(0.75, profile.icosahedronDetail), color);
      }
    }
  }

  const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  applyCaustics(material, time, causticsEnabled, new Color(preset.caustics.tint));

  const mesh = new Mesh(mergeBaked(parts), material);
  mesh.name = "rocks";
  return mesh;
}

/**
 * Instanced seaweed blades with a vertex sway that sells the current.
 * `heightSegments` is the detail-level knob; `count` is the "background
 * object count" knob (SPEC §6.5.4) — independent of each other.
 */
export function createSeaweed(
  rng: () => number,
  time: TimeUniform,
  heightSegments: number = BACKGROUND_DETAIL_PROFILES.medium.seaweedHeightSegments,
  count: number = SEAWEED_COUNT,
  preset: EnvironmentPreset = DEFAULT_ENVIRONMENT_PRESET,
): InstancedMesh {
  const bladeHeight = 2.6;
  const geometry = new PlaneGeometry(0.28, bladeHeight, 1, heightSegments);
  geometry.translate(0, bladeHeight / 2, 0);
  geometry.deleteAttribute("uv");

  const position = geometry.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  const root = new Color(preset.seaweed.root);
  const tip = new Color(preset.seaweed.tip);
  const tint = new Color();
  for (let i = 0; i < position.count; i += 1) {
    tint.copy(root).lerp(tip, Math.min(1, position.getY(i) / bladeHeight));
    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));

  const material = new MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    side: DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms["uTime"] = time;
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
float swayWeight = clamp( transformed.y / ${bladeHeight.toFixed(2)}, 0.0, 1.0 );
swayWeight *= swayWeight;
transformed.x += sin( uTime * 0.9 + aPhase ) * swayWeight * 0.45;
transformed.z += cos( uTime * 0.7 + aPhase * 1.3 ) * swayWeight * 0.32;`,
      );
  };

  const mesh = new InstancedMesh(geometry, material, count);
  const phases = new Float32Array(count);
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const euler = new Euler();
  const scale = new Vector3();
  const spot = new Vector3();

  for (let i = 0; i < count; i += 1) {
    phases[i] = rng() * Math.PI * 2;
    const angle = rng() * Math.PI * 2;
    const radius = 3.5 + rng() * 10;
    spot.set(Math.cos(angle) * radius, SCENE.floorY - 0.1, Math.sin(angle) * radius);
    euler.set(0, rng() * Math.PI * 2, 0);
    quaternion.setFromEuler(euler);
    const s = 0.6 + rng() * 0.85;
    scale.set(s, s * (0.7 + rng() * 0.8), s);
    matrix.compose(spot, quaternion, scale);
    mesh.setMatrixAt(i, matrix);
  }
  geometry.setAttribute("aPhase", new InstancedBufferAttribute(phases, 1));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.name = "seaweed";
  return mesh;
}

/** A few additive planes standing in for sunlight shafts (SPEC §6.3). */
function createGodRays(rng: () => number, preset: EnvironmentPreset = DEFAULT_ENVIRONMENT_PRESET): Mesh {
  const parts: BufferGeometry[] = [];
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const euler = new Euler();
  const scale = new Vector3(1, 1, 1);
  const position = new Vector3();
  const tint = new Color(preset.godRays.tint);

  for (let i = 0; i < SCENE.godRays.count; i += 1) {
    const angle = (i / SCENE.godRays.count) * Math.PI * 2 + rng() * 0.6;
    const radius = 3 + rng() * 9;
    const height = 15 + rng() * 5;
    const width = 1.4 + rng() * 2.6;
    position.set(Math.cos(angle) * radius, SCENE.floorY + height / 2, Math.sin(angle) * radius);
    euler.set(rng() * 0.25 - 0.125, angle + Math.PI / 2, rng() * 0.16 - 0.08);
    quaternion.setFromEuler(euler);
    matrix.compose(position, quaternion, scale);

    const plane = new PlaneGeometry(width, height, 1, 1);
    plane.deleteAttribute("uv");
    const baked = bake(plane, matrix, tint.clone().multiplyScalar(0.6 + rng() * 0.4));
    // Fade each shaft out toward the sea floor.
    const pos = baked.getAttribute("position");
    const col = baked.getAttribute("color");
    for (let v = 0; v < pos.count; v += 1) {
      const fade = Math.min(1, Math.max(0, (pos.getY(v) - SCENE.floorY) / height));
      col.setXYZ(v, col.getX(v) * fade, col.getY(v) * fade, col.getZ(v) * fade);
    }
    parts.push(baked);
  }

  const material = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: preset.godRays.opacity,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    fog: true,
  });

  const mesh = new Mesh(mergeBaked(parts), material);
  mesh.name = "godRays";
  return mesh;
}

/** Handle returned to the render loop. */
export interface Environment {
  readonly group: Group;
  readonly coralClusterCenters: readonly Vector3[];
  update(elapsed: number): void;
  /** Rebuild floor/coral/rocks/seaweed/godRays at a new detail level, object count, and/or preset (SPEC §6.5.3). */
  rebuild(detail: DetailLevel, objectCountScale: number, preset?: EnvironmentPreset): void;
  /** Live light-intensity multiplier and caustics on/off (SPEC §6.5.3, instant). */
  setLighting(intensityScale: number, caustics: boolean): void;
  /** Immediately updates fog/background/light colors from a new preset — no geometry rebuild. */
  setPreset(preset: EnvironmentPreset): void;
  dispose(): void;
}

/** Initial settings applied while constructing the environment (SPEC §6.5). */
export interface CreateEnvironmentOptions {
  readonly detail?: DetailLevel;
  readonly objectCountScale?: number;
  readonly lightingIntensityScale?: number;
  readonly caustics?: boolean;
  readonly preset?: EnvironmentPreset;
}

const BASE_HEMISPHERE_INTENSITY = 1.15;
const BASE_SUN_INTENSITY = 1.05;
const BASE_RIM_INTENSITY = 0.35;

function disposeMesh(mesh: Mesh | InstancedMesh): void {
  mesh.removeFromParent();
  mesh.geometry.dispose();
  if (Array.isArray(mesh.material)) {
    for (const material of mesh.material) material.dispose();
  } else {
    mesh.material.dispose();
  }
}

const REEF_CORAL_SHARE = 0.7;

/** Splits scatter points into coral-bound vs. rock-bound sets: cliff -> rock always; reef -> coral most of the time, rock otherwise; sand -> neither. */
function partitionScatterPoints(
  rng: () => number,
  points: readonly ScatterPoint[],
): { coralPoints: ScatterPoint[]; rockPoints: ScatterPoint[] } {
  const coralPoints: ScatterPoint[] = [];
  const rockPoints: ScatterPoint[] = [];
  for (const point of points) {
    if (point.biome === "cliff") {
      rockPoints.push(point);
    } else if (point.biome === "reef") {
      if (rng() < REEF_CORAL_SHARE) coralPoints.push(point);
      else rockPoints.push(point);
    }
  }
  return { coralPoints, rockPoints };
}

/** Populate the scene with fog, lights and the whole procedural reef. */
export function createEnvironment(
  scene: Scene,
  rng: () => number,
  options: CreateEnvironmentOptions = {},
): Environment {
  const preset = options.preset ?? DEFAULT_ENVIRONMENT_PRESET;
  const fog = new FogExp2(preset.water.fogColor, preset.water.fogDensity);
  scene.fog = fog;
  scene.background = new Color(preset.water.backgroundColor);

  const time: TimeUniform = { value: 0 };
  const causticsEnabled: ToggleUniform = { value: options.caustics === false ? 0 : 1 };
  const group = new Group();
  group.name = "environment";

  const intensityScale = options.lightingIntensityScale ?? 1;
  const hemisphere = new HemisphereLight(
    preset.lighting.hemisphereSky,
    preset.lighting.hemisphereGround,
    BASE_HEMISPHERE_INTENSITY * intensityScale,
  );
  const sun = new DirectionalLight(preset.lighting.sun, BASE_SUN_INTENSITY * intensityScale);
  sun.position.set(4, 18, 6);
  const rim = new DirectionalLight(preset.lighting.rim, BASE_RIM_INTENSITY * intensityScale);
  rim.position.set(-8, 4, -10);

  const detail = options.detail ?? "medium";
  const objectCountScale = options.objectCountScale ?? 1;
  const profile = BACKGROUND_DETAIL_PROFILES[detail];
  const { coralClusters, seaweedCount } = computeObjectCounts(objectCountScale);

  const scatterPoints = computeScatterPoints(rng, coralClusters, preset.terrain);
  const { coralPoints, rockPoints } = partitionScatterPoints(rng, scatterPoints);

  let floor = createFloor(time, profile.floorSegments, causticsEnabled, preset, scatterPoints);
  let coral = createCoral(rng, time, profile.coral, coralPoints, causticsEnabled, preset);
  let rocks = createRocks(rng, time, profile.coral, rockPoints, causticsEnabled, preset);
  let seaweed = createSeaweed(rng, time, profile.seaweedHeightSegments, seaweedCount, preset);
  let godRays = createGodRays(rng, preset);

  group.add(floor, coral, rocks, seaweed);
  group.add(hemisphere, sun, rim, godRays);
  scene.add(group);

  return {
    group,
    coralClusterCenters: coralPoints.map((point) => point.position),
    update(elapsed: number): void {
      time.value = elapsed;
      // Barely perceptible drift of the light shafts.
      godRays.rotation.y = elapsed * 0.012;
      godRays.position.x = Math.sin(elapsed * 0.05) * 0.6;
    },
    rebuild(
      nextDetail: DetailLevel,
      nextObjectCountScale: number,
      nextPreset: EnvironmentPreset = DEFAULT_ENVIRONMENT_PRESET,
    ): void {
      const nextProfile = BACKGROUND_DETAIL_PROFILES[nextDetail];
      const counts = computeObjectCounts(nextObjectCountScale);
      const nextScatterPoints = computeScatterPoints(rng, counts.coralClusters, nextPreset.terrain);
      const nextPartition = partitionScatterPoints(rng, nextScatterPoints);

      const nextFloor = createFloor(time, nextProfile.floorSegments, causticsEnabled, nextPreset, nextScatterPoints);
      const nextCoral = createCoral(
        rng,
        time,
        nextProfile.coral,
        nextPartition.coralPoints,
        causticsEnabled,
        nextPreset,
      );
      const nextRocks = createRocks(
        rng,
        time,
        nextProfile.coral,
        nextPartition.rockPoints,
        causticsEnabled,
        nextPreset,
      );
      const nextSeaweed = createSeaweed(
        rng,
        time,
        nextProfile.seaweedHeightSegments,
        counts.seaweedCount,
        nextPreset,
      );
      const nextGodRays = createGodRays(rng, nextPreset);

      group.add(nextFloor, nextCoral, nextRocks, nextSeaweed, nextGodRays);
      disposeMesh(floor);
      disposeMesh(coral);
      disposeMesh(rocks);
      disposeMesh(seaweed);
      disposeMesh(godRays);

      floor = nextFloor;
      coral = nextCoral;
      rocks = nextRocks;
      seaweed = nextSeaweed;
      godRays = nextGodRays;
    },
    setLighting(nextIntensityScale: number, caustics: boolean): void {
      hemisphere.intensity = BASE_HEMISPHERE_INTENSITY * nextIntensityScale;
      sun.intensity = BASE_SUN_INTENSITY * nextIntensityScale;
      rim.intensity = BASE_RIM_INTENSITY * nextIntensityScale;
      causticsEnabled.value = caustics ? 1 : 0;
    },
    setPreset(nextPreset: EnvironmentPreset): void {
      fog.color.set(nextPreset.water.fogColor);
      fog.density = nextPreset.water.fogDensity;
      scene.background = new Color(nextPreset.water.backgroundColor);
      hemisphere.color.set(nextPreset.lighting.hemisphereSky);
      hemisphere.groundColor.set(nextPreset.lighting.hemisphereGround);
      sun.color.set(nextPreset.lighting.sun);
      rim.color.set(nextPreset.lighting.rim);
    },
    dispose(): void {
      for (const mesh of [floor, coral, rocks, seaweed, godRays]) disposeMesh(mesh);
      group.removeFromParent();
    },
  };
}
