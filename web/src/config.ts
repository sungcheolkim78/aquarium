/**
 * Data-driven configuration for the aquarium (SPEC §6.1, N4).
 *
 * Adding a new fish species must never require touching rendering or
 * behaviour code: append one entry to `FISH_REGISTRY` and the scene picks it
 * up on the next reload.
 */

/** Procedural geometry builders available to the registry. */
export type FishGeometryId = "lowpoly-fish";

/** Per-species silhouette parameters fed to the procedural geometry builder. */
export interface FishShape {
  /** Nose-to-tail length in world units. */
  readonly length: number;
  /** Dorsal-to-ventral height in world units. */
  readonly height: number;
  /** Lateral thickness in world units. */
  readonly width: number;
  /** Caudal fin span in world units. */
  readonly tailSpan: number;
  /** Number of accent bands painted across the body (0 = none). */
  readonly stripes: number;
}

/** A single fish species definition (SPEC §6.1). */
export interface FishSpecies {
  readonly id: string;
  /** Human readable Korean name shown nowhere in v1 UI, kept for v2 labels. */
  readonly label: string;
  readonly geometry: FishGeometryId;
  readonly palette: {
    readonly body: string;
    readonly fin: string;
    readonly accent: string;
  };
  readonly behavior: {
    /** Base swim speed in world units per second. */
    readonly speed: number;
    /** Whether individuals steer toward their school centroid. */
    readonly schooling: boolean;
    /** Radius of the roaming volume around the reef centre. */
    readonly activityRadius: number;
  };
  readonly shape: FishShape;
  /** How many instances to spawn (one InstancedMesh draw call per species). */
  readonly count: number;
}

/**
 * Initial three species (SPEC F3): 클라운피시, 파랑참돔, 노란열대어.
 * Extended with three species inspired by resources/images reference art:
 * 나비치 (disc-shaped, eye band), 보라탱 (violet body, yellow fins),
 * 자주열대어 (small pink schooling fish).
 * Counts sum to 60, at the top of the 30~60 budget of N1.
 */
export const FISH_REGISTRY: readonly FishSpecies[] = [
  {
    id: "clownfish",
    label: "클라운피시",
    geometry: "lowpoly-fish",
    palette: { body: "#f2761b", fin: "#c84a09", accent: "#fff3e0" },
    behavior: { speed: 1.15, schooling: true, activityRadius: 7.5 },
    shape: { length: 0.62, height: 0.34, width: 0.16, tailSpan: 0.3, stripes: 3 },
    count: 20,
  },
  {
    id: "blue-sea-bream",
    label: "파랑참돔",
    geometry: "lowpoly-fish",
    palette: { body: "#2f7fd1", fin: "#1b4f87", accent: "#bfe3ff" },
    behavior: { speed: 0.95, schooling: true, activityRadius: 10.5 },
    shape: { length: 0.86, height: 0.46, width: 0.2, tailSpan: 0.4, stripes: 0 },
    count: 12,
  },
  {
    id: "yellow-tang",
    label: "노란열대어",
    geometry: "lowpoly-fish",
    palette: { body: "#f5c11d", fin: "#d19206", accent: "#fff8d0" },
    behavior: { speed: 0.7, schooling: false, activityRadius: 9 },
    shape: { length: 0.5, height: 0.44, width: 0.13, tailSpan: 0.26, stripes: 0 },
    count: 8,
  },
  {
    // Disc-shaped reef fish with a dark eye band (reference: poly_fish_1).
    id: "butterflyfish",
    label: "나비치",
    geometry: "lowpoly-fish",
    palette: { body: "#f2d531", fin: "#4a5560", accent: "#20272c" },
    behavior: { speed: 0.85, schooling: false, activityRadius: 7 },
    shape: { length: 0.46, height: 0.6, width: 0.12, tailSpan: 0.24, stripes: 1 },
    count: 6,
  },
  {
    // Violet body with bright yellow fins (reference: poly_fish_2).
    id: "purple-tang",
    label: "보라탱",
    geometry: "lowpoly-fish",
    palette: { body: "#5b4fd6", fin: "#f5c11d", accent: "#cfe6ff" },
    behavior: { speed: 0.8, schooling: false, activityRadius: 8.5 },
    shape: { length: 0.7, height: 0.52, width: 0.18, tailSpan: 0.34, stripes: 0 },
    count: 5,
  },
  {
    // Small pink fish that darts around in a tight school (reference: poly_fish_2).
    id: "pink-cardinalfish",
    label: "자주열대어",
    geometry: "lowpoly-fish",
    palette: { body: "#e8557f", fin: "#b23a5e", accent: "#ffd3e0" },
    behavior: { speed: 1.3, schooling: true, activityRadius: 6 },
    shape: { length: 0.34, height: 0.2, width: 0.11, tailSpan: 0.18, stripes: 0 },
    count: 9,
  },
];

/** Total number of fish requested by the registry. */
export const totalFishCount = (registry: readonly FishSpecies[] = FISH_REGISTRY): number =>
  registry.reduce((sum, species) => sum + species.count, 0);

/** Scene-wide tuning tokens (palette mirrored in `style.css`). */
export const SCENE = {
  /** Exponential-squared fog: the sense of depth (SPEC §6.3). */
  fog: { color: 0x0a3550, density: 0.052 },
  background: 0x061e30,
  /** Half-extents of the swimmable box, centred on the reef. */
  bounds: { x: 13, y: 6.5, z: 13 },
  floorY: -5.2,
  camera: {
    fov: 52,
    near: 0.1,
    far: 90,
    /** Resting position; the drift orbits gently around this radius. */
    radius: 15.5,
    height: 1.1,
    /** Radians per second of the slow healing drift (SPEC §6.4). */
    driftSpeed: 0.021,
    driftRadians: 0.55,
    bobAmplitude: 0.55,
    bobSpeed: 0.16,
  },
  bubbles: { count: 900, riseSpeed: 0.55, size: 0.1 },
  godRays: { count: 7, opacity: 0.06 },
  coral: { clusters: 22 },
  /** Adaptive quality thresholds (SPEC N2 / §6.2). */
  quality: {
    maxPixelRatio: 2,
    minFps: 40,
    /** Seconds of sustained low fps before a downgrade step fires. */
    sampleWindow: 3,
    resolutionScale: 0.75,
    /** Fraction of instances kept when the second downgrade step fires. */
    populationScale: 0.8,
  },
} as const;
