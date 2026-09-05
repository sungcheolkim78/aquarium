/**
 * Bootstrap: renderer, camera drift, render loop and adaptive quality
 * (SPEC F1, F5, N2, §6.2, §6.4).
 */

import "./style.css";

import { Clock, Color, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";

import { SCENE } from "./config";
import { createEnvironment } from "./environment";
import { createRng, createSchools } from "./fish";
import { createBubbles } from "./particles";
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

  const ui = createUi(overlay);

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  } catch (error) {
    ui.dispose();
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

  const rng = createRng(0x5eed_a17c);
  const environment = createEnvironment(scene, rng);
  const schools = createSchools(undefined, rng);
  for (const school of schools) school.addTo(scene);
  const bubbles = createBubbles(rng);
  scene.add(bubbles.points);

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
      for (const school of schools) school.setPopulationScale(SCENE.quality.populationScale);
      bubbles.setDensityScale(0.6);
    }
  };

  const frame = (): void => {
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;

    const angle = Math.sin(elapsed * SCENE.camera.driftSpeed) * SCENE.camera.driftRadians;
    camera.position.set(
      Math.sin(angle) * SCENE.camera.radius,
      SCENE.camera.height +
        Math.sin(elapsed * SCENE.camera.bobSpeed) * SCENE.camera.bobAmplitude,
      Math.cos(angle) * SCENE.camera.radius,
    );
    target.x = Math.sin(elapsed * 0.033) * 1.4;
    camera.lookAt(target);

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

    sampleTime += dt;
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

  window.addEventListener("pagehide", () => {
    renderer.setAnimationLoop(null);
    window.removeEventListener("resize", onResize);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    for (const school of schools) school.dispose();
    bubbles.dispose();
    environment.dispose();
    ui.dispose();
    renderer.dispose();
  });
}

boot();
