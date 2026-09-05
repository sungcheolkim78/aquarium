/**
 * Rising bubble field (SPEC F4, §6.3).
 *
 * A single `Points` object — one draw call for the whole column of bubbles.
 * Motion is integrated on the CPU (a few hundred floats per frame) so the
 * material stays a stock `PointsMaterial` and inherits scene fog for free.
 * The sprite is a runtime canvas gradient: no image assets ship with the app.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  Points,
  PointsMaterial,
  SRGBColorSpace,
  type Texture,
} from "three";

import { SCENE } from "./config";

/** Radial white-to-transparent sprite, drawn once into an offscreen canvas. */
function createBubbleSprite(size = 64): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    const half = size / 2;
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, "rgba(255,255,255,0.95)");
    gradient.addColorStop(0.45, "rgba(206,240,255,0.45)");
    gradient.addColorStop(0.78, "rgba(160,215,240,0.16)");
    gradient.addColorStop(1, "rgba(160,215,240,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(half, half, half, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Handle returned to the render loop. */
export interface BubbleField {
  readonly points: Points;
  update(dt: number, elapsed: number): void;
  /** Draw only a fraction of the bubbles (adaptive quality, SPEC N2; also user density, §6.5.3). */
  setDensityScale(scale: number): void;
  /** Show or hide the whole bubble field (SPEC §6.5.3). */
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

/** Build the bubble field. `rng` keeps the layout deterministic. */
export function createBubbles(
  rng: () => number,
  count: number = SCENE.bubbles.count,
): BubbleField {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const columnX = new Float32Array(count);
  const columnZ = new Float32Array(count);
  const speeds = new Float32Array(count);
  const phases = new Float32Array(count);
  const wobbles = new Float32Array(count);

  const bottom = SCENE.floorY + 0.15;
  const span = SCENE.bounds.y * 2 + 2.5;
  const tint = new Color();

  for (let i = 0; i < count; i += 1) {
    const angle = rng() * Math.PI * 2;
    const radius = rng() * (SCENE.bounds.x * 0.92);
    columnX[i] = Math.cos(angle) * radius;
    columnZ[i] = Math.sin(angle) * radius;
    speeds[i] = SCENE.bubbles.riseSpeed * (0.45 + rng() * 1.35);
    phases[i] = rng() * Math.PI * 2;
    wobbles[i] = 0.12 + rng() * 0.34;

    positions[i * 3] = columnX[i] ?? 0;
    positions[i * 3 + 1] = bottom + rng() * span;
    positions[i * 3 + 2] = columnZ[i] ?? 0;

    tint.setRGB(0.72, 0.9, 1).multiplyScalar(0.45 + rng() * 0.55);
    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
  }

  const geometry = new BufferGeometry();
  const positionAttribute = new BufferAttribute(positions, 3);
  positionAttribute.setUsage(DynamicDrawUsage);
  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.setDrawRange(0, count);
  geometry.boundingSphere = null;

  const sprite = createBubbleSprite();
  const material = new PointsMaterial({
    size: SCENE.bubbles.size,
    map: sprite,
    vertexColors: true,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    blending: AdditiveBlending,
    sizeAttenuation: true,
    fog: true,
  });

  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.name = "bubbles";

  let drawCount = count;

  return {
    points,
    update(dt: number, elapsed: number): void {
      const top = bottom + span;
      for (let i = 0; i < drawCount; i += 1) {
        const base = i * 3;
        let y = (positions[base + 1] ?? bottom) + (speeds[i] ?? 0) * dt;
        if (y > top) y = bottom;
        positions[base + 1] = y;

        const phase = phases[i] ?? 0;
        const wobble = wobbles[i] ?? 0;
        positions[base] = (columnX[i] ?? 0) + Math.sin(elapsed * 0.9 + phase) * wobble;
        positions[base + 2] = (columnZ[i] ?? 0) + Math.cos(elapsed * 0.75 + phase * 1.4) * wobble;
      }
      positionAttribute.needsUpdate = true;
    },
    setDensityScale(scale: number): void {
      drawCount = Math.max(1, Math.min(count, Math.round(count * scale)));
      geometry.setDrawRange(0, drawCount);
    },
    setEnabled(enabled: boolean): void {
      points.visible = enabled;
    },
    dispose(): void {
      points.removeFromParent();
      geometry.dispose();
      material.dispose();
      sprite.dispose();
    },
  };
}
