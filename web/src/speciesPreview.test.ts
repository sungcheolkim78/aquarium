import { describe, expect, it } from "vitest";
import { framingDistance } from "./speciesPreview";

describe("framingDistance", () => {
  it("matches hand-computed trigonometry for a known fov/radius", () => {
    // fov=90deg -> half-angle 45deg -> sin(45deg) = sqrt(2)/2 ≈ 0.70711
    // distance = radius / sin(halfAngle) * marginScale = 1 / 0.70711 * 1.5 ≈ 2.12132
    expect(framingDistance(1, 90, 1.5)).toBeCloseTo(2.12132, 4);
  });

  it("defaults marginScale to 1.5 when omitted", () => {
    expect(framingDistance(1, 90)).toBeCloseTo(2.12132, 4);
  });

  it("scales linearly with boundingRadius for a fixed fov", () => {
    const base = framingDistance(1, 60);
    expect(framingDistance(3, 60)).toBeCloseTo(base * 3, 6);
  });

  it("decreases as fov widens for a fixed radius", () => {
    expect(framingDistance(1, 100)).toBeLessThan(framingDistance(1, 40));
  });
});
