/**
 * Bootstrap: renderer, camera drift, render loop and adaptive quality
 * (SPEC F1, F5, N2, §6.2, §6.4).
 */

import "./style.css";

import { Clock, Color, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";

import { FISH_REGISTRY, SCENE, type AquariumSettings } from "./config";
import { createEnvironment } from "./environment";
import { createRng, createSchools, type FishSchool } from "./fish";
import { createBubbles } from "./particles";
import { debounce, getLocalStorage, loadSettings, saveSettings } from "./settings";
import { createSettingsPanel } from "./settingsPanel";
import { createUi } from "./ui";

declare global {
  interface Window {
    /** QA hook: live renderer statistics. */
    __aq?: { calls: number; triangles: number };
  }
}

function fail(root: HTMLElement, message: string): void {
  root.classList.add("overlay", "is-ready");
  root.textContent = "";
  const notice = document.createElement("p");
  notice.className = "notice";
  notice.textContent = message;
  root.append(notice);
}

function boot(): void {
  const canvas = document.getElementById("scene");
  const overlay = document.getElementById("overlay");
  if (!(canvas instanceof HTMLCanvasElement) || !(overlay instanceof HTMLElement)) {
    throw new Error("aquarium: #scene canvas or #overlay container is missing");
  }

  let settings: AquariumSettings = loadSettings(getLocalStorage());

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  } catch (error) {
    fail(overlay, "이 브라우저에서는 WebGL을 사용할 수 없어 아쿠아리움을 열 수 없습니다.");
    console.error("aquarium: WebGL renderer unavailable", error);
    return;
  }

  const basePixelRatio = Math.min(window.devicePixelRatio, SCENE.quality.maxPixelRatio);
  let resolutionScale = 1;
  renderer.setPixelRatio(basePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const scene = new Scene();
  scene.background = new Color(SCENE.background);

  const camera = new PerspectiveCamera(
    SCENE.camera.fov,
    window.innerWidth / window.innerHeight,
    SCENE.camera.near,
    SCENE.camera.far,
  );
  const target = new Vector3(0, SCENE.floorY + 3.4, 0);

  const prefersReducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (prefersReducedMotion) {
    camera.position.set(0, SCENE.camera.height, SCENE.camera.radius);
    camera.lookAt(target);
  }

  const rng = createRng(0x5eed_a17c);
  const environment = createEnvironment(scene, rng, {
    detail: settings.background.detail,
    objectCountScale: settings.background.objectCountScale,
    lightingIntensityScale: settings.lighting.intensityScale,
    caustics: settings.lighting.caustics,
  });
  const schools = createSchools(undefined, rng, {
    detail: settings.fish.detail,
    countScale: settings.fish.countScale,
    enabledSpecies: settings.fish.enabledSpecies,
  });
  const schoolsById = new Map<string, FishSchool>(schools.map((school) => [school.species.id, school]));
  for (const school of schools) school.addTo(scene);
  const bubbles = createBubbles(rng);
  bubbles.setEnabled(settings.bubbles.enabled);
  scene.add(bubbles.points);

  // Adaptive quality (N2) and the user's own settings each scale fish
  // population/bubble density independently; the two multiply together.
  let qualityPopulationScale = 1;
  let qualityBubbleScale = 1;
  const applyBubbleDensity = (): void => {
    bubbles.setDensityScale(settings.bubbles.densityScale * qualityBubbleScale);
  };
  applyBubbleDensity();

  const rebuildFishDetail = debounce((detail: AquariumSettings["fish"]["detail"]): void => {
    for (const school of schools) school.rebuildGeometry(detail);
  }, 150);

  const rebuildFishCount = debounce((countScale: number): void => {
    for (const school of schools) {
      school.rebuildInstances(countScale);
      school.setPopulationScale(qualityPopulationScale);
    }
  }, 150);

  const rebuildBackground = debounce(
    (detail: AquariumSettings["background"]["detail"], objectCountScale: number): void => {
      environment.rebuild(detail, objectCountScale);
    },
    150,
  );

  const settingsPanel = createSettingsPanel(FISH_REGISTRY, settings, {
    onChange(next: AquariumSettings): void {
      const prev = settings;
      settings = next;
      saveSettings(next, getLocalStorage());

      if (prev.fish.enabledSpecies !== next.fish.enabledSpecies) {
        for (const species of FISH_REGISTRY) {
          if (prev.fish.enabledSpecies[species.id] === next.fish.enabledSpecies[species.id]) continue;
          schoolsById.get(species.id)?.setVisible(next.fish.enabledSpecies[species.id] !== false);
        }
      }
      if (prev.fish.detail !== next.fish.detail) rebuildFishDetail(next.fish.detail);
      if (prev.fish.countScale !== next.fish.countScale) rebuildFishCount(next.fish.countScale);

      if (
        prev.background.detail !== next.background.detail ||
        prev.background.objectCountScale !== next.background.objectCountScale
      ) {
        rebuildBackground(next.background.detail, next.background.objectCountScale);
      }

      if (
        prev.lighting.intensityScale !== next.lighting.intensityScale ||
        prev.lighting.caustics !== next.lighting.caustics
      ) {
        environment.setLighting(next.lighting.intensityScale, next.lighting.caustics);
      }

      if (prev.bubbles.enabled !== next.bubbles.enabled) bubbles.setEnabled(next.bubbles.enabled);
      if (prev.bubbles.densityScale !== next.bubbles.densityScale) applyBubbleDensity();
    },
  });

  const ui = createUi(overlay, { settingsPanel: settingsPanel.element });

  const onResize = (): void => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(basePixelRatio * resolutionScale);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  };
  window.addEventListener("resize", onResize);

  const clock = new Clock();
  let elapsed = 0;
  let firstFrameDone = false;

  // Adaptive quality: resolution first, then population (SPEC N2).
  let downgradeStep = 0;
  let sampleTime = 0;
  let sampleFrames = 0;
  let lowFpsTime = 0;

  const downgrade = (): void => {
    downgradeStep += 1;
    if (downgradeStep === 1) {
      resolutionScale = SCENE.quality.resolutionScale;
      renderer.setPixelRatio(basePixelRatio * resolutionScale);
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      return;
    }
    if (downgradeStep === 2) {
      qualityPopulationScale = SCENE.quality.populationScale;
      qualityBubbleScale = 0.6;
      for (const school of schools) school.setPopulationScale(qualityPopulationScale);
      applyBubbleDensity();
    }
  };

  const frame = (): void => {
    const rawDt = clock.getDelta();
    const dt = Math.min(rawDt, 0.05);
    elapsed += dt;

    if (!prefersReducedMotion) {
      const angle = Math.sin(elapsed * SCENE.camera.driftSpeed) * SCENE.camera.driftRadians;
      camera.position.set(
        Math.sin(angle) * SCENE.camera.radius,
        SCENE.camera.height +
          Math.sin(elapsed * SCENE.camera.bobSpeed) * SCENE.camera.bobAmplitude,
        Math.cos(angle) * SCENE.camera.radius,
      );
      target.x = Math.sin(elapsed * 0.033) * 1.4;
      camera.lookAt(target);
    }

    environment.update(elapsed);
    for (const school of schools) school.update(dt, elapsed);
    bubbles.update(dt, elapsed);

    renderer.render(scene, camera);

    const info = renderer.info.render;
    window.__aq = { calls: info.calls, triangles: info.triangles };

    if (!firstFrameDone) {
      firstFrameDone = true;
      ui.finishLoading();
    }

    sampleTime += Math.min(rawDt, 1);
    sampleFrames += 1;
    if (sampleTime >= 1) {
      const fps = sampleFrames / sampleTime;
      lowFpsTime = fps < SCENE.quality.minFps ? lowFpsTime + sampleTime : 0;
      sampleTime = 0;
      sampleFrames = 0;
      if (lowFpsTime >= SCENE.quality.sampleWindow && downgradeStep < 2) {
        lowFpsTime = 0;
        downgrade();
      }
    }
  };

  renderer.setAnimationLoop(frame);

  // Stop rendering entirely while the tab is hidden (SPEC N2).
  const onVisibilityChange = (): void => {
    if (document.hidden) {
      renderer.setAnimationLoop(null);
      return;
    }
    clock.getDelta();
    sampleTime = 0;
    sampleFrames = 0;
    lowFpsTime = 0;
    renderer.setAnimationLoop(frame);
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  let disposed = false;

  window.addEventListener("pagehide", (event) => {
    renderer.setAnimationLoop(null);
    rebuildFishDetail.cancel();
    rebuildFishCount.cancel();
    rebuildBackground.cancel();
    if (event.persisted) return; // may return via `pageshow` from the bfcache — keep GPU resources alive
    disposed = true;
    window.removeEventListener("resize", onResize);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    for (const school of schools) school.dispose();
    bubbles.dispose();
    environment.dispose();
    ui.dispose();
    settingsPanel.dispose();
    renderer.dispose();
  });

  window.addEventListener("pageshow", (event) => {
    if (!event.persisted || disposed) return;
    onResize(); // viewport may have changed while frozen in the cache
    clock.getDelta(); // discard the time spent frozen in the cache
    sampleTime = 0;
    sampleFrames = 0;
    lowFpsTime = 0;
    if (document.hidden) return; // restored into a background tab — stay stopped (SPEC N2)
    renderer.setAnimationLoop(frame);
  });
}

boot();
