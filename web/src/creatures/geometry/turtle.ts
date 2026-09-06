import { BufferGeometry, Color, Vector3 } from "three";

import type { DetailLevel, FishSpecies, TurtleShape } from "../../config";
import { createMeshBuffers, finalizeCreatureGeometry, pushFin, pushTriangle, type MeshBuffers } from "./base";

const DETAIL_PROFILES: Record<DetailLevel, { segments: number; ringSides: number }> = {
  low: { segments: 4, ringSides: 6 },
  medium: { segments: 7, ringSides: 8 },
  high: { segments: 12, ringSides: 10 },
};

function shellRadius(t: number): number {
  return Math.pow(Math.sin(Math.PI * t), 0.45);
}

/** Shell-height multiplier along the shell's length; `shellKeelHeight` raises a centerline ridge. */
export function turtleShellHeightScale(t: number, shellKeelHeight: number): number {
  return 1 + shellKeelHeight * Math.sin(Math.PI * t);
}

function shellVertex(
  x: number,
  radius: number,
  shape: TurtleShape,
  index: number,
  sides: number,
  heightScale: number,
): Vector3 {
  const angle = (index / sides) * Math.PI * 2;
  return new Vector3(
    x,
    Math.cos(angle) * shape.shellHeight * 0.5 * radius * heightScale,
    Math.sin(angle) * shape.shellWidth * 0.5 * radius,
  );
}

/** Beak control points, from the shell-adjacent root through a pinched midsection to the tip. */
export function turtleHeadPoints(
  shape: TurtleShape,
): {
  root: { top: Vector3; bottom: Vector3 };
  mid: { top: Vector3; bottom: Vector3 };
  tip: Vector3;
} {
  const half = shape.shellLength / 2;
  const rootX = half;
  const midX = half + shape.headLength * 0.5;
  const tipX = half + shape.headLength;
  const rootY = -shape.shellHeight * 0.04;
  const rootZ = shape.shellWidth * 0.2;
  const midZ = rootZ * shape.headTaper;
  return {
    root: {
      top: new Vector3(rootX, rootY + shape.shellHeight * 0.22, -rootZ),
      bottom: new Vector3(rootX, rootY - shape.shellHeight * 0.2, -rootZ),
    },
    mid: {
      top: new Vector3(midX, rootY + shape.shellHeight * 0.22 * shape.headTaper, -midZ),
      bottom: new Vector3(midX, rootY - shape.shellHeight * 0.2 * shape.headTaper, -midZ),
    },
    tip: new Vector3(tipX, rootY - shape.shellHeight * 0.06, 0),
  };
}

/** Flipper control points; `flipperSweep` pulls the tip back toward the tail. */
export function turtleFlipperPoints(
  shape: TurtleShape,
  which: "front" | "rear",
  side: 1 | -1,
): { root: Vector3; tip: Vector3; inner: Vector3 } {
  const frontX = shape.shellLength * 0.18;
  const rearX = -shape.shellLength * 0.2;
  const sweep = shape.flipperSweep * shape.flipperSpan * 0.4;
  if (which === "front") {
    return {
      root: new Vector3(frontX, -shape.shellHeight * 0.12, side * shape.shellWidth * 0.28),
      tip: new Vector3(
        frontX + shape.flipperSpan * 0.55 - sweep,
        -shape.shellHeight * 0.16,
        side * shape.shellWidth * 0.95,
      ),
      inner: new Vector3(
        frontX - shape.flipperSpan * 0.25,
        -shape.shellHeight * 0.2,
        side * shape.shellWidth * 0.3,
      ),
    };
  }
  return {
    root: new Vector3(rearX, -shape.shellHeight * 0.1, side * shape.shellWidth * 0.28),
    tip: new Vector3(
      rearX - shape.flipperSpan * 0.48 - sweep,
      -shape.shellHeight * 0.14,
      side * shape.shellWidth * 0.82,
    ),
    inner: new Vector3(
      rearX + shape.flipperSpan * 0.18,
      -shape.shellHeight * 0.2,
      side * shape.shellWidth * 0.3,
    ),
  };
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
  const buffers: MeshBuffers = createMeshBuffers();
  const half = shape.shellLength / 2;

  for (let segment = 0; segment < profile.segments; segment += 1) {
    const t0 = segment / profile.segments;
    const t1 = (segment + 1) / profile.segments;
    const x0 = half - shape.shellLength * t0;
    const x1 = half - shape.shellLength * t1;
    const r0 = shellRadius(t0);
    const r1 = shellRadius(t1);
    const heightScale0 = turtleShellHeightScale(t0, shape.shellKeelHeight);
    const heightScale1 = turtleShellHeightScale(t1, shape.shellKeelHeight);
    const isRim =
      shape.shellRimWidth > 0 &&
      (t0 < shape.shellRimWidth || t1 > 1 - shape.shellRimWidth);
    const color = isRim ? accent : shell;
    for (let side = 0; side < profile.ringSides; side += 1) {
      const a = shellVertex(x0, r0, shape, side, profile.ringSides, heightScale0);
      const b = shellVertex(x0, r0, shape, side + 1, profile.ringSides, heightScale0);
      const c = shellVertex(x1, r1, shape, side + 1, profile.ringSides, heightScale1);
      const d = shellVertex(x1, r1, shape, side, profile.ringSides, heightScale1);
      pushTriangle(buffers, a, c, b, color);
      pushTriangle(buffers, a, d, c, color);
    }
  }

  const head = turtleHeadPoints(shape);
  pushFin(buffers, head.root.top, head.root.bottom, head.mid.top, accent);
  pushFin(buffers, head.mid.top, head.root.bottom, head.mid.bottom, accent);
  pushFin(buffers, head.mid.top, head.mid.bottom, head.tip, accent);
  pushFin(
    buffers,
    new Vector3(head.root.top.x, head.root.top.y, -head.root.top.z),
    new Vector3(head.mid.top.x, head.mid.top.y, -head.mid.top.z),
    new Vector3(head.root.bottom.x, head.root.bottom.y, -head.root.bottom.z),
    accent,
  );
  pushFin(
    buffers,
    new Vector3(head.mid.top.x, head.mid.top.y, -head.mid.top.z),
    new Vector3(head.mid.bottom.x, head.mid.bottom.y, -head.mid.bottom.z),
    new Vector3(head.root.bottom.x, head.root.bottom.y, -head.root.bottom.z),
    accent,
  );
  pushFin(
    buffers,
    new Vector3(head.mid.top.x, head.mid.top.y, -head.mid.top.z),
    head.tip,
    new Vector3(head.mid.bottom.x, head.mid.bottom.y, -head.mid.bottom.z),
    accent,
  );

  for (const side of [-1, 1] as const) {
    const front = turtleFlipperPoints(shape, "front", side);
    pushFin(buffers, front.root, front.tip, front.inner, flipper);
    const rear = turtleFlipperPoints(shape, "rear", side);
    pushFin(buffers, rear.root, rear.tip, rear.inner, flipper);
  }

  return finalizeCreatureGeometry(buffers);
}
