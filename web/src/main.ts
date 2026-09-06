/**
 * Bootstrap: renderer, camera drift, render loop and adaptive quality
 * (SPEC F1, F5, N2, §6.2, §6.4).
 */

import "./style.css";

import { Clock, Color, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3, WebGLRenderer } from "three";

import {
  FISH_REGISTRY,
  SCENE,
  computeQualityScales,
  effectiveMinFps,
  resolveEnvironmentPreset,
  type AquariumSettings,
  type EnvironmentPreset,
} from "./config";
import { createEnvironment } from "./environment";
import { createRng, createSchools, type FishSchool } from "./fish";
import { loadObservedSpecies, saveObservedSpecies, withObserved } from "./observations";
import { createBubbles } from "./particles";
import { debounce, getLocalStorage, loadSettings, saveSettings } from "./settings";
import { createSettingsPanel } from "./settingsPanel";
import { createSpeciesInfo } from "./speciesInfo";
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

  const applyFixedCameraPose = (): void => {
    camera.position.set(0, SCENE.camera.height, SCENE.camera.radius);
    camera.lookAt(target);
  };

  // A never-customized "drift" default still honours a system reduced-motion
  // request at boot; an explicit saved choice always wins (SPEC §6.7.1).
  let cameraMode: AquariumSettings["camera"]["mode"] =
    settings.camera.mode === "drift" && prefersReducedMotion ? "fixed" : settings.camera.mode;
  if (cameraMode === "fixed") applyFixedCameraPose();

  const rng = createRng(0x5eed_a17c);
  const environment = createEnvironment(scene, rng, {
    detail: settings.background.detail,
    objectCountScale: settings.background.objectCountScale,
    lightingIntensityScale: settings.lighting.intensityScale,
    caustics: settings.lighting.caustics,
    preset: resolveEnvironmentPreset(settings.background.presetId),
  });
  const schools = createSchools(undefined, rng, {
    detail: settings.fish.detail,
    countScale: settings.fish.countScale,
    enabledSpecies: settings.fish.enabledSpecies,
    coralClusterCenters: environment.coralClusterCenters,
  });
  const schoolsById = new Map<string, FishSchool>(schools.map((school) => [school.species.id, school]));
  for (const school of schools) school.addTo(scene);

  let observedSpecies = loadObservedSpecies(getLocalStorage(), FISH_REGISTRY);
  const speciesInfo = createSpeciesInfo(FISH_REGISTRY, observedSpecies, {
    onObserve(speciesId: string): void {
      observedSpecies = withObserved(observedSpecies, speciesId);
      saveObservedSpecies(observedSpecies, getLocalStorage());
    },
  });
  const bubbles = createBubbles(
    rng,
    SCENE.bubbles.count,
    new Color(resolveEnvironmentPreset(settings.background.presetId).bubbles.tint),
  );
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
    (
      detail: AquariumSettings["background"]["detail"],
      objectCountScale: number,
      preset: EnvironmentPreset,
    ): void => {
      environment.rebuild(detail, objectCountScale, preset);
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
        prev.background.objectCountScale !== next.background.objectCountScale ||
        prev.background.presetId !== next.background.presetId
      ) {
        rebuildBackground(
          next.background.detail,
          next.background.objectCountScale,
          resolveEnvironmentPreset(next.background.presetId),
        );
      }

      if (prev.background.presetId !== next.background.presetId) {
        const nextPreset = resolveEnvironmentPreset(next.background.presetId);
        environment.setPreset(nextPreset);
        bubbles.setTint(new Color(nextPreset.bubbles.tint));
      }

      if (
        prev.lighting.intensityScale !== next.lighting.intensityScale ||
        prev.lighting.caustics !== next.lighting.caustics
      ) {
        environment.setLighting(next.lighting.intensityScale, next.lighting.caustics);
      }

      if (prev.bubbles.enabled !== next.bubbles.enabled) bubbles.setEnabled(next.bubbles.enabled);
      if (prev.bubbles.densityScale !== next.bubbles.densityScale) applyBubbleDensity();

      if (prev.camera.mode !== next.camera.mode) {
        cameraMode = next.camera.mode;
        if (cameraMode === "fixed") applyFixedCameraPose();
      }
      if (prev.performance.powerSave !== next.performance.powerSave) applyQualityStep();
      if (prev.audio.volume !== next.audio.volume) ui.setVolume(next.audio.volume);
    },
  });

  const ui = createUi(overlay, {
    settingsPanel: settingsPanel.element,
    initialVolume: settings.audio.volume,
    speciesCard: speciesInfo.cardElement,
    speciesCatalog: speciesInfo.catalogElement,
  });

  const onResize = (): void => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(basePixelRatio * resolutionScale);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  };
  window.addEventListener("resize", onResize);

  const raycaster = new Raycaster();
  const pointerNdc = new Vector2();

  const onCanvasClick = (event: MouseEvent): void => {
    const rect = canvas.getBoundingClientRect();
    pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    // three.js's Raycaster applies no `.visible` check of its own — a
    // hidden species must be filtered out here, not left to the library.
    const pickableMeshes = schools.filter((school) => school.mesh.visible).map((school) => school.mesh);
    const hit = raycaster.intersectObjects(pickableMeshes)[0];
    if (!hit) {
      speciesInfo.closeCard();
      return;
    }
    const school = schools.find((candidate) => candidate.mesh === hit.object);
    if (school) speciesInfo.showSpecies(school.species.id);
  };
  canvas.addEventListener("click", onCanvasClick);

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") speciesInfo.closeCard();
  };
  window.addEventListener("keydown", onKeydown);

  const clock = new Clock();
  let elapsed = 0;
  let firstFrameDone = false;

  // Adaptive quality: bidirectional step 0~2, resolution first then
  // population going down, population first then resolution coming back
  // (SPEC §6.7.2, N2). `applyQualityStep` is the only place that touches the
  // renderer/schools/bubbles for this — both directions and power-save just
  // recompute from `downgradeStep`/`settings.performance.powerSave` via the
  // pure `computeQualityScales`.
  let downgradeStep: 0 | 1 | 2 = 0;
  let sampleTime = 0;
  let sampleFrames = 0;
  let lowFpsTime = 0;
  let goodFpsTime = 0;

  const applyQualityStep = (): void => {
    const scales = computeQualityScales(downgradeStep, settings.performance.powerSave);
    resolutionScale = scales.resolutionScale;
    renderer.setPixelRatio(basePixelRatio * resolutionScale);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    qualityPopulationScale = scales.populationScale;
    qualityBubbleScale = downgradeStep >= 2 ? 0.6 : 1;
    for (const school of schools) school.setPopulationScale(qualityPopulationScale);
    applyBubbleDensity();
  };
  applyQualityStep(); // applies power-save's resolution ceiling immediately, even before any downgrade

  const frame = (): void => {
    const rawDt = clock.getDelta();
    const dt = Math.min(rawDt, 0.05);
    elapsed += dt;

    if (cameraMode === "drift") {
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
      const minFps = effectiveMinFps(settings.performance.powerSave);
      if (fps < minFps) {
        lowFpsTime += sampleTime;
        goodFpsTime = 0;
      } else if (fps >= SCENE.quality.recoverFps) {
        goodFpsTime += sampleTime;
        lowFpsTime = 0;
      } else {
        lowFpsTime = 0;
        goodFpsTime = 0;
      }
      sampleTime = 0;
      sampleFrames = 0;
      if (lowFpsTime >= SCENE.quality.sampleWindow && downgradeStep < 2) {
        lowFpsTime = 0;
        goodFpsTime = 0;
        downgradeStep = (downgradeStep + 1) as 0 | 1 | 2;
        applyQualityStep();
      } else if (goodFpsTime >= SCENE.quality.recoverWindow && downgradeStep > 0) {
        goodFpsTime = 0;
        lowFpsTime = 0;
        downgradeStep = (downgradeStep - 1) as 0 | 1 | 2;
        applyQualityStep();
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
    goodFpsTime = 0;
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
    canvas.removeEventListener("click", onCanvasClick);
    window.removeEventListener("keydown", onKeydown);
    for (const school of schools) school.dispose();
    bubbles.dispose();
    environment.dispose();
    ui.dispose();
    settingsPanel.dispose();
    speciesInfo.dispose();
    renderer.dispose();
  });

  window.addEventListener("pageshow", (event) => {
    if (!event.persisted || disposed) return;
    onResize(); // viewport may have changed while frozen in the cache
    clock.getDelta(); // discard the time spent frozen in the cache
    sampleTime = 0;
    sampleFrames = 0;
    lowFpsTime = 0;
    goodFpsTime = 0;
    if (document.hidden) return; // restored into a background tab — stay stopped (SPEC N2)
    renderer.setAnimationLoop(frame);
  });
}

boot();
