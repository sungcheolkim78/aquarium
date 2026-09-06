/**
 * Data-driven configuration for the aquarium (SPEC §6.1, N4).
 *
 * Adding a new creature species must never require touching rendering or
 * behaviour code: append one entry to `FISH_REGISTRY` and the scene picks it
 * up on the next reload.
 */

/** Procedural geometry builders available to the registry. */
export type CreatureGeometryId =
  | "lowpoly-fish"
  | "lowpoly-shark"
  | "lowpoly-seahorse"
  | "lowpoly-turtle";
/** Backward-compatible name for callers that still use the fish terminology. */
export type FishGeometryId = CreatureGeometryId;

/** Polygon detail tier, user-selectable via the settings panel (SPEC §6.2, F7). */
export type DetailLevel = "low" | "medium" | "high";

/** Body cross-section/length subdivision counts per detail tier for fish geometry. */
export interface FishDetailProfile {
  /** Segment count for the main-body zone; snout/peduncle zones derive their own count as `max(2, round(bodySegments * 0.4))`. */
  readonly bodySegments: number;
  /** Number of vertices around each ring's cross-section. */
  readonly ringSides: number;
  /** Shared wedge/strip count for the tail fin, dorsal fin, pectoral fin, and (if present) the thread. */
  readonly finSegments: number;
}

/** `high` deliberately targets ~11x today's baseline triangle count — the scene-wide triangle budget (SPEC N1) has large headroom. No facet jitter at any tier: real segment counts now carry high-detail richness. */
export const FISH_DETAIL_PROFILES: Record<DetailLevel, FishDetailProfile> = {
  low: { bodySegments: 4, ringSides: 5, finSegments: 3 },
  medium: { bodySegments: 8, ringSides: 7, finSegments: 4 },
  high: { bodySegments: 16, ringSides: 10, finSegments: 7 },
};

/** Segment/subdivision counts for one procedural coral primitive kind. */
export interface CoralDetailProfile {
  readonly coneRadial: number;
  readonly coneHeight: number;
  readonly icosahedronDetail: number;
  readonly torusRadial: number;
  readonly torusTubular: number;
  readonly cylinderRadial: number;
  readonly cylinderHeight: number;
}

/** Background subdivision counts per detail tier (SPEC §6.2/AC-3). */
export interface BackgroundDetailProfile {
  /** Sea floor `PlaneGeometry` width/height segment count (square grid). */
  readonly floorSegments: number;
  /** Seaweed blade `PlaneGeometry` height segment count. */
  readonly seaweedHeightSegments: number;
  readonly coral: CoralDetailProfile;
}

/** `medium` reproduces the exact v1 baseline; `high` targets +125% (~2.25x) triangles. */
export const BACKGROUND_DETAIL_PROFILES: Record<DetailLevel, BackgroundDetailProfile> = {
  low: {
    floorSegments: 18,
    seaweedHeightSegments: 2,
    coral: {
      coneRadial: 5,
      coneHeight: 1,
      icosahedronDetail: 0,
      torusRadial: 4,
      torusTubular: 6,
      cylinderRadial: 5,
      cylinderHeight: 1,
    },
  },
  medium: {
    floorSegments: 26,
    seaweedHeightSegments: 4,
    coral: {
      coneRadial: 6,
      coneHeight: 1,
      icosahedronDetail: 0,
      torusRadial: 5,
      torusTubular: 8,
      cylinderRadial: 7,
      cylinderHeight: 1,
    },
  },
  high: {
    floorSegments: 39,
    seaweedHeightSegments: 9,
    coral: {
      coneRadial: 9,
      coneHeight: 1,
      icosahedronDetail: 1,
      torusRadial: 7,
      torusTubular: 12,
      cylinderRadial: 9,
      cylinderHeight: 1,
    },
  },
};

/** Base seaweed blade instance count at `objectCountScale: 1` (SPEC §6.5.4). */
export const SEAWEED_COUNT = 64;

export interface FishSnoutShape {
  /** Fraction (0..1) of `body.length` occupied by the snout zone. */
  readonly length: number;
  /** Exponent controlling how fast the snout widens from its tip toward the main body. */
  readonly taper: number;
  /** Radius fraction at the very tip of the nose. Defaults to 0.08. */
  readonly tipRadius?: number;
}

export interface FishBodyShape {
  /** Nose-to-tail-fin-root length in world units. */
  readonly length: number;
  readonly maxHeight: number;
  readonly maxWidth: number;
  /** Fraction (0..1, exclusive), position of the widest point within the main-body zone. */
  readonly peak: number;
  /** Exponent controlling how sharply the main-body zone bulges toward `peak`. */
  readonly taper: number;
  /** Radius fraction at the main-body zone's own start/end (where it meets the snout/peduncle zones). Defaults to 0.82. */
  readonly shoulderRadius?: number;
}

export interface FishPeduncleShape {
  /** Fraction (0..1) of `body.length` occupied by the peduncle zone. */
  readonly length: number;
  /** Exponent controlling how fast the peduncle narrows toward the tail fin. */
  readonly taper: number;
  /** Radius fraction at the tail-fin root. Defaults to 0.12. */
  readonly width?: number;
}

export interface FishTailFinShape {
  readonly height: number;
  readonly length: number;
  /** 0..1 (exclusive): how far the trailing-edge notch is pulled toward the root. */
  readonly notch: number;
}

export interface FishDorsalFinShape {
  /** t-fraction (0..1) along body.length where the fin base starts. */
  readonly start: number;
  /** t-fraction (0..1) along body.length where the fin base ends; must be greater than `start`. */
  readonly end: number;
  readonly height: number;
}

export interface FishPelvicFinShape {
  readonly length: number;
  /** Degrees swept back from vertical. */
  readonly angle: number;
  /** t-fraction along body.length where the fin root sits. Defaults to 0.55. */
  readonly at?: number;
}

export interface FishPectoralFinShape {
  readonly length: number;
  /** Degrees swept back from horizontal. */
  readonly angle: number;
  /** t-fraction along body.length where the fin root sits. Defaults to 0.28. */
  readonly at?: number;
}

export interface FishThreadShape {
  readonly length: number;
  readonly curvature: number;
}

export interface FishEyeShape {
  /** World-scale radius. 0 omits the eye entirely. Defaults to `0.16 * body.maxHeight` when the whole `eye` group is absent. */
  readonly radius?: number;
}

export interface FishPatternShape {
  readonly stripes: number;
}

/** Per-species silhouette parameters for the `lowpoly-fish` grammar (docs/superpowers/specs/2026-09-06-fish-procedural-grammar-design.md). */
export interface FishShape {
  /** Always equal to `body.length` — required because `fish.ts`'s sway shader reads `species.shape.length` generically across every creature kind. Never authored separately. */
  readonly length: number;
  readonly snout: FishSnoutShape;
  readonly body: FishBodyShape;
  readonly peduncle: FishPeduncleShape;
  readonly tailFin: FishTailFinShape;
  readonly dorsalFin: FishDorsalFinShape;
  readonly pelvicFin: FishPelvicFinShape;
  readonly pectoralFin: FishPectoralFinShape;
  readonly pattern: FishPatternShape;
  readonly thread?: FishThreadShape;
  readonly eye?: FishEyeShape;
}

/** Silhouette parameters for a shark's distinct body plan. */
export interface SharkShape {
  readonly length: number;
  readonly height: number;
  readonly width: number;
  readonly tailSpan: number;
  readonly dorsalFinHeight: number;
  /** Lower caudal lobe span as a fraction of `tailSpan`; 1 = symmetric, lower = more heterocercal (SPEC §6.2.1 reference art). */
  readonly tailAsymmetry: number;
  /** Exponent for the nose radius falloff; higher = sharper, more conical snout. */
  readonly snoutTaper: number;
  /** Count of accent-coloured gill-slit notches behind the head. */
  readonly gillSlits: number;
  /** 0..1: how far the pectoral fin tip sweeps back toward the tail. */
  readonly pectoralSweep: number;
}

/** Silhouette parameters for a vertical seahorse body plan. */
export interface SeahorseShape {
  /** Overall vertical body height, also used by the shared sway shader scale. */
  readonly length: number;
  readonly height: number;
  readonly width: number;
  readonly snoutLength: number;
  readonly curlRadius: number;
  readonly finSpan: number;
  /** Height of the coronet (crown) spikes on top of the head; 0 = none. */
  readonly coronetHeight: number;
  /** Amplitude of the periodic bony-plate bulge running down the trunk; 0 = smooth. */
  readonly ridgeAmplitude: number;
  /** How far the back-mounted dorsal fin extends from the trunk. */
  readonly dorsalFinHeight: number;
}

/** Silhouette parameters for a turtle shell and four flippers. */
export interface TurtleShape {
  readonly shellLength: number;
  readonly shellWidth: number;
  readonly shellHeight: number;
  readonly flipperSpan: number;
  readonly headLength: number;
  /** Shared shader scale; turtles are still authored nose-first along +X. */
  readonly length: number;
  readonly height: number;
  readonly width: number;
  /** Height of the raised centerline ridge running down the shell's spine; 0 = smooth dome. */
  readonly shellKeelHeight: number;
  /** Fraction of the shell length, at each end, painted with the accent colour as a rim/scute trim. */
  readonly shellRimWidth: number;
  /** 0..1: how much the beak pinches narrower at its midsection; 1 = straight wedge. */
  readonly headTaper: number;
  /** 0..1: how far the flippers sweep back toward the tail. */
  readonly flipperSweep: number;
}

export type CreatureVariant =
  | { readonly geometry: "lowpoly-fish"; readonly shape: FishShape }
  | { readonly geometry: "lowpoly-shark"; readonly shape: SharkShape }
  | { readonly geometry: "lowpoly-seahorse"; readonly shape: SeahorseShape }
  | { readonly geometry: "lowpoly-turtle"; readonly shape: TurtleShape };

interface CreatureDefinition {
  readonly id: string;
  /** Human readable Korean name shown nowhere in v1 UI, kept for v2 labels. */
  readonly label: string;
  /** One or two sentences describing the model's look/behavior for the species-info card (§4.4) — design-flavor only, never a validated biological claim. */
  readonly description: string;
  readonly palette: {
    readonly body: string;
    readonly fin: string;
    readonly accent: string;
    /** Eye color; defaults to a fixed dark constant (see `creatures/geometry/fish.ts`) when omitted. */
    readonly eye?: string;
  };
  readonly behavior: {
    /** Base swim speed in world units per second. */
    readonly speed: number;
    /** Movement model used by the shared creature school. */
    readonly locomotion: "swim" | "hover";
    /** Vertical hover displacement in world units; used only by `hover`. */
    readonly hoverAmplitude?: number;
    /** Hover oscillation frequency in cycles per second; used only by `hover`. */
    readonly hoverFrequency?: number;
    /** Whether individuals steer toward their school centroid. */
    readonly schooling: boolean;
    /** Radius of the roaming volume around the reef centre. */
    readonly activityRadius: number;
    /** 0 = hugs the floor, 1 = hugs the surface. Swim locomotion only; unused (no pull) if absent. */
    readonly depthPreference?: number;
    /** Max heading change per second, in radians. Swim locomotion only; uncapped if absent. */
    readonly maxTurnRate?: number;
    /** 0..1: how deep the periodic speed dip goes. Swim locomotion only; no rhythm (flat speed) if absent. */
    readonly rhythmAmplitude?: number;
    /** Speed-dip cycles per second. Swim locomotion only; irrelevant if `rhythmAmplitude` is absent. */
    readonly rhythmFrequency?: number;
    /** 0..1: pull strength toward this individual's habitat anchor. Swim locomotion only; no pull if absent. */
    readonly territoryStrength?: number;
  };
  /** How many instances to spawn (one InstancedMesh draw call per species). */
  readonly count: number;
}

/** A single registry creature definition (SPEC §6.1). */
export type CreatureSpecies = CreatureDefinition & CreatureVariant;
/** Compatibility alias while the school implementation is being generalized. */
export type FishSpecies = CreatureSpecies;

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
    description: "주황빛 몸에 하얀 줄무늬가 있는 작은 물고기예요. 무리를 지어 산호 밭 주변을 얌전히 맴돌아요.",
    geometry: "lowpoly-fish",
    palette: { body: "#f2761b", fin: "#c84a09", accent: "#fff3e0" },
    behavior: {
      speed: 1.15,
      locomotion: "swim",
      schooling: true,
      activityRadius: 7.5,
      depthPreference: 0.3,
      maxTurnRate: 4.5,
      rhythmAmplitude: 0.15,
      rhythmFrequency: 0.5,
    },
    shape: {
      length: 0.62,
      snout: { length: 0.16, taper: 0.8, tipRadius: 0.09 },
      body: { length: 0.62, maxHeight: 0.34, maxWidth: 0.16, peak: 0.42, taper: 1.1, shoulderRadius: 0.82 },
      peduncle: { length: 0.16, taper: 1.6, width: 0.13 },
      tailFin: { height: 0.27, length: 0.27, notch: 0.3 },
      dorsalFin: { start: 0.28, end: 0.74, height: 0.14 },
      pelvicFin: { length: 0.1, angle: 45, at: 0.56 },
      pectoralFin: { length: 0.13, angle: 30, at: 0.26 },
      eye: { radius: 0.06 },
      pattern: { stripes: 3 },
    },
    count: 20,
  },
  {
    id: "blue-sea-bream",
    label: "파랑참돔",
    description: "푸른빛이 도는 매끈한 몸을 가진 물고기예요. 무리를 지어 넓은 수역을 여유롭게 오가요.",
    geometry: "lowpoly-fish",
    palette: { body: "#2f7fd1", fin: "#1b4f87", accent: "#bfe3ff" },
    behavior: {
      speed: 0.95,
      locomotion: "swim",
      schooling: true,
      activityRadius: 10.5,
      depthPreference: 0.55,
      maxTurnRate: 3.2,
      rhythmAmplitude: 0.15,
      rhythmFrequency: 0.5,
    },
    shape: {
      length: 0.86,
      snout: { length: 0.14, taper: 0.9, tipRadius: 0.08 },
      body: { length: 0.86, maxHeight: 0.46, maxWidth: 0.2, peak: 0.4, taper: 1.0, shoulderRadius: 0.85 },
      peduncle: { length: 0.15, taper: 1.7, width: 0.12 },
      tailFin: { height: 0.36, length: 0.36, notch: 0.4 },
      dorsalFin: { start: 0.3, end: 0.8, height: 0.16 },
      pelvicFin: { length: 0.13, angle: 42, at: 0.55 },
      pectoralFin: { length: 0.16, angle: 28, at: 0.25 },
      eye: { radius: 0.055 },
      pattern: { stripes: 0 },
    },
    count: 12,
  },
  {
    id: "yellow-tang",
    label: "노란열대어",
    description: "샛노란 몸빛이 눈에 띄는 납작한 물고기예요. 한 산호 근처를 정해두고 그 주변을 잘 벗어나지 않아요.",
    geometry: "lowpoly-fish",
    palette: { body: "#f5c11d", fin: "#d19206", accent: "#fff8d0" },
    behavior: {
      speed: 0.7,
      locomotion: "swim",
      schooling: false,
      activityRadius: 9,
      depthPreference: 0.5,
      maxTurnRate: 3.2,
      rhythmAmplitude: 0.25,
      rhythmFrequency: 0.35,
      territoryStrength: 0.35,
    },
    shape: {
      length: 0.5,
      snout: { length: 0.13, taper: 0.75, tipRadius: 0.07 },
      body: { length: 0.5, maxHeight: 0.44, maxWidth: 0.13, peak: 0.46, taper: 1.3, shoulderRadius: 0.8 },
      peduncle: { length: 0.15, taper: 1.8, width: 0.11 },
      tailFin: { height: 0.23, length: 0.24, notch: 0.25 },
      dorsalFin: { start: 0.24, end: 0.82, height: 0.2 },
      pelvicFin: { length: 0.1, angle: 48, at: 0.58 },
      pectoralFin: { length: 0.12, angle: 32, at: 0.26 },
      eye: { radius: 0.06 },
      pattern: { stripes: 0 },
    },
    count: 8,
  },
  {
    // Disc-shaped reef fish with a dark eye band (reference: poly_fish_1).
    id: "butterflyfish",
    label: "나비치",
    description: "원반 모양 몸에 눈 주위로 짙은 띠무늬가 있는 물고기예요. 혼자 산호 곁을 서성이며 지내요.",
    geometry: "lowpoly-fish",
    palette: { body: "#f2d531", fin: "#4a5560", accent: "#20272c" },
    behavior: {
      speed: 0.85,
      locomotion: "swim",
      schooling: false,
      activityRadius: 7,
      depthPreference: 0.45,
      maxTurnRate: 3.2,
      rhythmAmplitude: 0.25,
      rhythmFrequency: 0.35,
      territoryStrength: 0.4,
    },
    shape: {
      length: 0.46,
      snout: { length: 0.12, taper: 0.6, tipRadius: 0.06 },
      body: { length: 0.46, maxHeight: 0.6, maxWidth: 0.12, peak: 0.48, taper: 1.4, shoulderRadius: 0.78 },
      peduncle: { length: 0.14, taper: 1.9, width: 0.1 },
      tailFin: { height: 0.22, length: 0.2, notch: 0.2 },
      dorsalFin: { start: 0.22, end: 0.86, height: 0.24 },
      pelvicFin: { length: 0.09, angle: 50, at: 0.6 },
      pectoralFin: { length: 0.11, angle: 34, at: 0.24 },
      eye: { radius: 0.055 },
      pattern: { stripes: 1 },
    },
    count: 6,
  },
  {
    // Violet body with bright yellow fins (reference: poly_fish_2).
    id: "purple-tang",
    label: "보라탱",
    description: "보라색 몸에 샛노란 지느러미가 대비되는 물고기예요. 자기 구역의 산호를 좀처럼 벗어나지 않아요.",
    geometry: "lowpoly-fish",
    palette: { body: "#5b4fd6", fin: "#f5c11d", accent: "#cfe6ff" },
    behavior: {
      speed: 0.8,
      locomotion: "swim",
      schooling: false,
      activityRadius: 8.5,
      depthPreference: 0.5,
      maxTurnRate: 3.2,
      rhythmAmplitude: 0.25,
      rhythmFrequency: 0.35,
      territoryStrength: 0.3,
    },
    shape: {
      length: 0.7,
      snout: { length: 0.14, taper: 0.85, tipRadius: 0.08 },
      body: { length: 0.7, maxHeight: 0.52, maxWidth: 0.18, peak: 0.44, taper: 1.15, shoulderRadius: 0.82 },
      peduncle: { length: 0.15, taper: 1.7, width: 0.12 },
      tailFin: { height: 0.3, length: 0.3, notch: 0.32 },
      dorsalFin: { start: 0.28, end: 0.8, height: 0.19 },
      pelvicFin: { length: 0.12, angle: 44, at: 0.56 },
      pectoralFin: { length: 0.15, angle: 30, at: 0.26 },
      eye: { radius: 0.058 },
      pattern: { stripes: 0 },
    },
    count: 3,
  },
  {
    // Small pink fish that darts around in a tight school (reference: poly_fish_2).
    id: "pink-cardinalfish",
    label: "자주열대어",
    description: "자줏빛이 도는 아주 작은 물고기예요. 촘촘한 무리를 이루어 빠르게 움직여요.",
    geometry: "lowpoly-fish",
    palette: { body: "#e8557f", fin: "#b23a5e", accent: "#ffd3e0" },
    behavior: {
      speed: 1.3,
      locomotion: "swim",
      schooling: true,
      activityRadius: 6,
      depthPreference: 0.4,
      maxTurnRate: 4.5,
      rhythmAmplitude: 0.15,
      rhythmFrequency: 0.5,
    },
    shape: {
      length: 0.34,
      snout: { length: 0.18, taper: 0.7, tipRadius: 0.06 },
      body: { length: 0.34, maxHeight: 0.2, maxWidth: 0.11, peak: 0.4, taper: 1.0, shoulderRadius: 0.84 },
      peduncle: { length: 0.17, taper: 1.5, width: 0.09 },
      tailFin: { height: 0.16, length: 0.16, notch: 0.3 },
      dorsalFin: { start: 0.3, end: 0.7, height: 0.1 },
      pelvicFin: { length: 0.07, angle: 40, at: 0.55 },
      pectoralFin: { length: 0.09, angle: 28, at: 0.26 },
      eye: { radius: 0.04 },
      pattern: { stripes: 0 },
    },
    count: 5,
  },
  {
    id: "great-white-shark",
    label: "백상아리",
    description: "몸집이 큰 회청색 헤엄손님이에요. 방향을 크고 느리게 틀며 넓은 구역을 순찰하듯 돌아요.",
    geometry: "lowpoly-shark",
    palette: { body: "#7894a5", fin: "#405563", accent: "#d9edf5" },
    behavior: {
      speed: 0.9,
      locomotion: "swim",
      schooling: false,
      activityRadius: 10.5,
      depthPreference: 0.6,
      maxTurnRate: 1.4,
      rhythmAmplitude: 0.1,
      rhythmFrequency: 0.2,
    },
    shape: {
      length: 1.45,
      height: 0.5,
      width: 0.26,
      tailSpan: 0.62,
      dorsalFinHeight: 0.42,
      tailAsymmetry: 0.45,
      snoutTaper: 1.1,
      gillSlits: 4,
      pectoralSweep: 0.5,
    },
    count: 2,
  },
  {
    id: "seahorse",
    label: "해마",
    description: "몸을 세운 채 헤엄치는 분홍빛 생물이에요. 꼬리를 산호에 말아 붙잡고 한자리에 머물러요.",
    geometry: "lowpoly-seahorse",
    palette: { body: "#d184a5", fin: "#a9587e", accent: "#f4c3d3" },
    behavior: {
      speed: 0.18,
      locomotion: "hover",
      schooling: false,
      activityRadius: 7,
      hoverAmplitude: 0.22,
      hoverFrequency: 0.16,
    },
    shape: {
      length: 1.1,
      height: 1.1,
      width: 0.2,
      snoutLength: 0.32,
      curlRadius: 0.28,
      finSpan: 0.26,
      coronetHeight: 0.1,
      ridgeAmplitude: 0.2,
      dorsalFinHeight: 0.16,
    },
    count: 2,
  },
  {
    id: "green-sea-turtle",
    label: "푸른바다거북",
    description: "둥근 등딱지를 지닌 큰 생물이에요. 네 다리로 천천히 헤엄치며 수면 가까이를 오가요.",
    geometry: "lowpoly-turtle",
    palette: { body: "#4e9b78", fin: "#2f665a", accent: "#b9d58a" },
    behavior: {
      speed: 0.48,
      locomotion: "swim",
      schooling: false,
      activityRadius: 8.5,
      depthPreference: 0.65,
      maxTurnRate: 1.1,
      rhythmAmplitude: 0.3,
      rhythmFrequency: 0.25,
    },
    shape: {
      shellLength: 1.05,
      shellWidth: 0.72,
      shellHeight: 0.32,
      flipperSpan: 0.62,
      headLength: 0.24,
      length: 1.25,
      height: 0.7,
      width: 0.95,
      shellKeelHeight: 0.22,
      shellRimWidth: 0.14,
      headTaper: 0.5,
      flipperSweep: 0.4,
    },
    count: 2,
  },
];

/** Total number of fish requested by the registry. */
export const totalFishCount = (registry: readonly FishSpecies[] = FISH_REGISTRY): number =>
  registry.reduce((sum, species) => sum + species.count, 0);

/** User-adjustable scene configuration, persisted via `settings.ts` (SPEC §6.5.2). */
export interface AquariumSettings {
  readonly schemaVersion: 1;
  readonly fish: {
    /** Species id -> shown. Unknown ids (stale registry) are ignored. */
    readonly enabledSpecies: Readonly<Record<string, boolean>>;
    readonly detail: DetailLevel;
    /** Multiplies every species' `count`. */
    readonly countScale: number;
  };
  readonly background: {
    readonly detail: DetailLevel;
    /** Multiplies coral cluster count and seaweed instance count. */
    readonly objectCountScale: number;
  };
  readonly lighting: {
    /** Multiplies every light's base intensity. */
    readonly intensityScale: number;
    readonly caustics: boolean;
  };
  readonly bubbles: {
    readonly enabled: boolean;
    /** Multiplies `SCENE.bubbles.count`. */
    readonly densityScale: number;
  };
  readonly camera: {
    readonly mode: "drift" | "fixed";
  };
  readonly performance: {
    readonly powerSave: boolean;
  };
  readonly audio: {
    readonly volume: number;
  };
}

/** Clamp ranges for each numeric settings field (SPEC §6.5.2). */
export const SETTINGS_LIMITS = {
  fish: { countScale: { min: 0.25, max: 1.5 } },
  background: { objectCountScale: { min: 0.5, max: 2.0 } },
  lighting: { intensityScale: { min: 0.4, max: 1.6 } },
  bubbles: { densityScale: { min: 0, max: 2.0 } },
  audio: { volume: { min: 0, max: 1 } },
} as const;

/**
 * Matches v1 behaviour exactly: every species shown, medium detail, every
 * multiplier at 1, caustics/bubbles on. A user who never opens the settings
 * panel must see this and only this (SPEC §6.5.2, AC-1).
 */
export const DEFAULT_SETTINGS: AquariumSettings = {
  schemaVersion: 1,
  fish: {
    enabledSpecies: Object.fromEntries(FISH_REGISTRY.map((species) => [species.id, true])),
    detail: "medium",
    countScale: 1,
  },
  background: { detail: "medium", objectCountScale: 1 },
  lighting: { intensityScale: 1, caustics: true },
  bubbles: { enabled: true, densityScale: 1 },
  camera: { mode: "drift" },
  performance: { powerSave: false },
  audio: { volume: 0.16 },
};

/** Stage-B mood preset identifiers (SPEC §6.6). */
export type PresetId = "clear-reef" | "calm-sea" | "soft-evening";

/** The exact field values one mood preset dials in — deliberately only fields the settings panel already exposes (SPEC §6.6). */
export interface MoodPreset {
  readonly label: string;
  readonly lightingIntensityScale: number;
  readonly fishCountScale: number;
  readonly bubblesEnabled: boolean;
  readonly bubblesDensityScale: number;
}

/**
 * Mood presets (SPEC §6.6, F8). Deliberately exclude `fish.detail` /
 * `background.detail` / `fish.enabledSpecies` — device-performance and
 * species-selection settings must stay independent of mood. `calm-sea`
 * mirrors `DEFAULT_SETTINGS` exactly so an untouched first visit already
 * matches a preset.
 */
export const MOOD_PRESETS: Record<PresetId, MoodPreset> = {
  "clear-reef": {
    label: "맑은 산호초",
    lightingIntensityScale: 1.3,
    fishCountScale: 1.2,
    bubblesEnabled: true,
    bubblesDensityScale: 1.2,
  },
  "calm-sea": {
    label: "고요한 바다",
    lightingIntensityScale: 1,
    fishCountScale: 1,
    bubblesEnabled: true,
    bubblesDensityScale: 1,
  },
  "soft-evening": {
    label: "은은한 저녁",
    lightingIntensityScale: 0.6,
    fishCountScale: 0.7,
    bubblesEnabled: true,
    bubblesDensityScale: 0.5,
  },
};

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
  coral: { clusters: 22, avoidanceRadius: 2.0, avoidanceHeight: 1.2 },
  /** Adaptive quality thresholds (SPEC N2 / §6.2). */
  quality: {
    maxPixelRatio: 2,
    minFps: 40,
    /** Seconds of sustained low fps before a downgrade step fires. */
    sampleWindow: 3,
    resolutionScale: 0.75,
    /** Fraction of instances kept when the second downgrade step fires. */
    populationScale: 0.8,
    /** fps at/above which sustained good performance starts counting toward recovery (SPEC §6.7.2). */
    recoverFps: 52,
    /** Seconds of sustained good fps before a step recovers — longer than `sampleWindow` so quality doesn't oscillate. */
    recoverWindow: 8,
    /** Power-save mode's own resolution ceiling and (lower, intentional) fps threshold (SPEC §6.7.2, F9). */
    powerSave: { resolutionScale: 0.6, minFps: 24 },
  },
} as const;

/** Pure step→scale mapping for the adaptive-quality state machine (SPEC §6.7.2, N2). Only the FPS sampling that drives `downgradeStep` lives in `main.ts`. */
export function computeQualityScales(
  downgradeStep: 0 | 1 | 2,
  powerSave: boolean,
): { resolutionScale: number; populationScale: number } {
  const stepResolutionScale = downgradeStep >= 1 ? SCENE.quality.resolutionScale : 1;
  const populationScale = downgradeStep >= 2 ? SCENE.quality.populationScale : 1;
  return {
    resolutionScale: powerSave
      ? Math.min(stepResolutionScale, SCENE.quality.powerSave.resolutionScale)
      : stepResolutionScale,
    populationScale,
  };
}

/** Effective low-fps downgrade threshold — power-save mode's intentional low fps must not read as a fault (SPEC §6.7.2, AC-13). */
export function effectiveMinFps(powerSave: boolean): number {
  return powerSave ? SCENE.quality.powerSave.minFps : SCENE.quality.minFps;
}
