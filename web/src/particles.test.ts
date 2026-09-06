import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Color } from "three";

import { createRng } from "./fish";
import { createBubbles } from "./particles";

// particles.ts draws its bubble sprite via `document.createElement("canvas")`.
// This file runs in vitest's "node" environment (no DOM, matching this
// project's vite.config.ts) — stub just enough of `document` for that call
// to succeed. `createBubbleSprite` already tolerates a null 2D context.
beforeAll(() => {
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      if (tag !== "canvas") throw new Error(`unexpected createElement("${tag}") in test stub`);
      return { width: 0, height: 0, getContext: () => null };
    },
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("createBubbles tint", () => {
  it("bakes each particle's color from the supplied tint scaled by its own random brightness", () => {
    // Pure magenta (G=0): every particle's green channel must stay exactly 0 regardless
    // of its per-particle brightness multiplier; red/blue must stay > 0.
    const tint = new Color(1, 0, 1);
    const field = createBubbles(createRng(1), 20, tint);
    const color = field.points.geometry.getAttribute("color");
    for (let i = 0; i < color.count; i += 1) {
      expect(color.getY(i)).toBe(0);
      expect(color.getX(i)).toBeGreaterThan(0);
      expect(color.getZ(i)).toBeGreaterThan(0);
    }
    field.dispose();
  });

  it("setTint recolors every particle while preserving relative brightness ordering", () => {
    const field = createBubbles(createRng(2), 20, new Color(1, 1, 1));
    const color = field.points.geometry.getAttribute("color");
    const before = Array.from({ length: color.count }, (_, i) => color.getX(i));

    field.setTint(new Color(0.5, 0.5, 0.5));
    const after = Array.from({ length: color.count }, (_, i) => color.getX(i));

    for (let i = 0; i < color.count; i += 1) expect(after[i]).toBeLessThan(before[i] as number);
    const brightestBefore = before.indexOf(Math.max(...before));
    const brightestAfter = after.indexOf(Math.max(...after));
    expect(brightestAfter).toBe(brightestBefore);
    field.dispose();
  });
});
