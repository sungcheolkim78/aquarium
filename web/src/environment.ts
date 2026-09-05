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

import { SCENE } from "./config";

/** Shared animation clock handed to every generated shader. */
export interface TimeUniform {
  value: number;
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

/** Add shimmering light bands to any lit material (cheap analytic caustics). */
export function applyCaustics(material: MeshLambertMaterial, time: TimeUniform): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms["uTime"] = time;
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
diffuseColor.rgb += vec3( 0.16, 0.33, 0.36 ) * caustic * mix( 1.0, 0.35, depthFade );`,
      );
  };
}

function createFloor(time: TimeUniform): Mesh {
  const geometry = new PlaneGeometry(72, 72, 26, 26);
  geometry.rotateX(-Math.PI / 2);
  geometry.deleteAttribute("uv");

  const position = geometry.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  const deep = new Color("#123b4b");
  const sand = new Color("#4c6b73");
  const tint = new Color();

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const dune =
      Math.sin(x * 0.16) * 0.55 + Math.cos(z * 0.21) * 0.45 + Math.sin((x + z) * 0.09) * 0.7;
    position.setY(i, dune);
    const t = Math.min(1, Math.max(0, dune * 0.35 + 0.5));
    tint.copy(deep).lerp(sand, t);
    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  applyCaustics(material, time);

  const mesh = new Mesh(geometry, material);
  mesh.position.y = SCENE.floorY;
  mesh.name = "floor";
  return mesh;
}

const CORAL_COLORS = ["#e2705f", "#c9558c", "#e79b3f", "#5fb7a5", "#8d6bc4"] as const;

function createCoral(rng: () => number, time: TimeUniform): Mesh {
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

  for (let c = 0; c < SCENE.coral.clusters; c += 1) {
    const angle = (c / SCENE.coral.clusters) * Math.PI * 2 + rng() * 0.35;
    const radius = 4.5 + rng() * 8.5;
    const baseX = Math.cos(angle) * radius;
    const baseZ = Math.sin(angle) * radius;
    const hue = CORAL_COLORS[Math.floor(rng() * CORAL_COLORS.length)] ?? CORAL_COLORS[0];
    const color = new Color(hue).multiplyScalar(0.55 + rng() * 0.3);
    const pieces = 2 + Math.floor(rng() * 3);

    for (let p = 0; p < pieces; p += 1) {
      const height = 0.7 + rng() * 1.9;
      const spread = 0.5 + rng() * 0.9;
      position.set(
        baseX + (rng() - 0.5) * 1.6,
        SCENE.floorY + height * 0.5,
        baseZ + (rng() - 0.5) * 1.6,
      );
      euler.set((rng() - 0.5) * 0.3, rng() * Math.PI * 2, (rng() - 0.5) * 0.3);
      scale.set(1, 1, 1);

      const kind = rng();
      if (kind < 0.45) {
        place(new ConeGeometry(spread * 0.55, height, 6, 1), color);
      } else if (kind < 0.75) {
        scale.set(spread * 0.8, height * 0.55, spread * 0.8);
        place(new IcosahedronGeometry(0.75, 0), color);
      } else {
        euler.x += Math.PI / 2;
        place(new TorusGeometry(spread * 0.6, spread * 0.18, 5, 8), color);
      }

      if (rng() < 0.4) {
        position.y = SCENE.floorY + 0.18;
        euler.set(0, rng() * Math.PI * 2, 0);
        scale.set(1, 1, 1);
        place(new CylinderGeometry(spread * 0.7, spread * 0.9, 0.36, 7, 1), color);
      }
    }
  }

  const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  applyCaustics(material, time);

  const mesh = new Mesh(mergeBaked(parts), material);
  mesh.name = "coral";
  return mesh;
}

/** Instanced seaweed blades with a vertex sway that sells the current. */
function createSeaweed(rng: () => number, time: TimeUniform): InstancedMesh {
  const count = 64;
  const bladeHeight = 2.6;
  const geometry = new PlaneGeometry(0.28, bladeHeight, 1, 4);
  geometry.translate(0, bladeHeight / 2, 0);
  geometry.deleteAttribute("uv");

  const position = geometry.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  const root = new Color("#1d5c4a");
  const tip = new Color("#5fd3a3");
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
function createGodRays(rng: () => number): Mesh {
  const parts: BufferGeometry[] = [];
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const euler = new Euler();
  const scale = new Vector3(1, 1, 1);
  const position = new Vector3();
  const tint = new Color("#bfeaff");

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
    opacity: SCENE.godRays.opacity,
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
  update(elapsed: number): void;
  dispose(): void;
}

/** Populate the scene with fog, lights and the whole procedural reef. */
export function createEnvironment(scene: Scene, rng: () => number): Environment {
  scene.fog = new FogExp2(SCENE.fog.color, SCENE.fog.density);

  const time: TimeUniform = { value: 0 };
  const group = new Group();
  group.name = "environment";

  const hemisphere = new HemisphereLight(0xbfeaff, 0x0b2b3c, 1.15);
  const sun = new DirectionalLight(0xd8f4ff, 1.05);
  sun.position.set(4, 18, 6);
  const rim = new DirectionalLight(0x2f7fd1, 0.35);
  rim.position.set(-8, 4, -10);

  const floor = createFloor(time);
  const coral = createCoral(rng, time);
  const seaweed = createSeaweed(rng, time);
  const godRays = createGodRays(rng);

  group.add(hemisphere, sun, rim, floor, coral, seaweed, godRays);
  scene.add(group);

  return {
    group,
    update(elapsed: number): void {
      time.value = elapsed;
      // Barely perceptible drift of the light shafts.
      godRays.rotation.y = elapsed * 0.012;
      godRays.position.x = Math.sin(elapsed * 0.05) * 0.6;
    },
    dispose(): void {
      for (const mesh of [floor, coral, seaweed, godRays]) {
        mesh.geometry.dispose();
        if (Array.isArray(mesh.material)) {
          for (const material of mesh.material) material.dispose();
        } else {
          mesh.material.dispose();
        }
      }
      group.removeFromParent();
    },
  };
}
