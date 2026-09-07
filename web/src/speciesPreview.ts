/**
 * Live per-species 3D preview for the species-info card. A second, tiny
 * renderer independent of the main scene — framed generically off each
 * species' own bounding sphere so it works for any of the four body plans
 * without per-geometry-kind camera logic.
 */

import {
  AmbientLight,
  Color,
  DirectionalLight,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  type BufferGeometry,
} from "three";

import { buildCreatureGeometry } from "./fish";
import type { FishSpecies } from "./config";

/**
 * Camera distance (along the view axis) so a sphere of `boundingRadius`
 * fits inside a `PerspectiveCamera`'s vertical field of view, with
 * `marginScale` extra breathing room (defaults to 1.5 = 50% margin).
 */
export function framingDistance(
  boundingRadius: number,
  fovDegrees: number,
  marginScale = 1.5,
): number {
  const halfAngleRadians = (fovDegrees * Math.PI) / 180 / 2;
  return (boundingRadius / Math.sin(halfAngleRadians)) * marginScale;
}

const PREVIEW_SIZE_PX = 120;
const FOV_DEGREES = 45;
const ROTATE_RADIANS_PER_SECOND = 0.6;
const MAX_PIXEL_RATIO = 2;

export interface SpeciesPreview {
  /** Swaps in a live rotating model of `species` and (re)starts the render loop. */
  show(species: FishSpecies): void;
  /** Stops the render loop; the mounted mesh/geometry/material are freed on the next `show()` or on `dispose()`. */
  hide(): void;
  dispose(): void;
}

/** Builds a small independent WebGL viewport mounted inside `container`, showing one live-rotating species model at a time. */
export function createSpeciesPreview(container: HTMLElement): SpeciesPreview {
  const canvas = document.createElement("canvas");
  container.append(canvas);

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.setSize(PREVIEW_SIZE_PX, PREVIEW_SIZE_PX, false);

  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, 0.8));
  const key = new DirectionalLight(0xffffff, 0.9);
  key.position.set(2, 3, 4);
  scene.add(key);

  const camera = new PerspectiveCamera(FOV_DEGREES, 1, 0.05, 100);

  let mesh: Mesh | null = null;
  let geometry: BufferGeometry | null = null;
  let material: MeshLambertMaterial | null = null;
  let rafId: number | null = null;
  let lastTimeMs: number | null = null;
  let running = false;

  const disposeMesh = (): void => {
    if (mesh) scene.remove(mesh);
    geometry?.dispose();
    material?.dispose();
    mesh = null;
    geometry = null;
    material = null;
  };

  const frame = (nowMs: number): void => {
    if (!running || !mesh) return;
    const dt = lastTimeMs === null ? 0 : Math.min((nowMs - lastTimeMs) / 1000, 0.1);
    lastTimeMs = nowMs;
    mesh.rotation.y += ROTATE_RADIANS_PER_SECOND * dt;
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(frame);
  };

  const startLoop = (): void => {
    if (rafId !== null) return;
    lastTimeMs = null;
    rafId = requestAnimationFrame(frame);
  };

  const stopLoop = (): void => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
  };

  const onVisibilityChange = (): void => {
    if (document.hidden) stopLoop();
    else if (running) startLoop();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  return {
    show(species: FishSpecies): void {
      disposeMesh();
      geometry = buildCreatureGeometry(species, "low");
      geometry.computeBoundingSphere();
      const sphere = geometry.boundingSphere;
      material = new MeshLambertMaterial({
        vertexColors: true,
        flatShading: true,
        emissive: new Color(species.palette.body).multiplyScalar(0.12),
      });
      mesh = new Mesh(geometry, material);
      if (sphere) {
        mesh.position.copy(sphere.center).negate();
        camera.position.set(0, 0, framingDistance(sphere.radius, FOV_DEGREES));
        camera.lookAt(0, 0, 0);
      }
      scene.add(mesh);

      running = true;
      if (!document.hidden) startLoop();
    },
    hide(): void {
      running = false;
      stopLoop();
    },
    dispose(): void {
      running = false;
      stopLoop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      disposeMesh();
      renderer.dispose();
      canvas.remove();
    },
  };
}
