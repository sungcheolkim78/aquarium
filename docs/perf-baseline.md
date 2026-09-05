# Performance Baseline

Recorded once per device/browser combination before Stage B (§6 of `docs/DEVELOPMENT_PROPOSAL.md`) starts. Re-run after any change to `web/src/fish.ts`, `environment.ts`, `particles.ts`, or `config.ts`'s `SCENE`/`FISH_REGISTRY` that could move the triangle/draw-call budget.

## How to record a row

1. `cd web && npm run build && npm run preview`, open the printed URL on the target device/browser.
2. For the **default** row: leave settings untouched (`DEFAULT_SETTINGS`). For the **max** row: open the settings panel and push every control to its maximum (all species checked, fish detail High, fish-count slider to 1.5x, background detail High, background-object slider to 2.0x, lighting slider to 1.6x, bubbles on with density 2.0x) — this matches `MAX_SETTINGS` in `web/src/settings.ts`.

   Then **verify** the applied settings before sampling, rather than trusting the clicks: read each control back (`document.querySelector('#fish-count-scale').value` and friends) and cross-check against `SETTINGS_LIMITS` in `web/src/config.ts`. A quicker and more reliable route is to write `MAX_SETTINGS` straight into `localStorage` under the `aquarium:settings` key and reload — the app then boots at max with no debounced rebuild in flight.
3. Start sampling **immediately**, and confirm no adaptive-quality downgrade fired during the run (see the caveat below): record `window.__aq` at the first and last sampled frame, and check the canvas is still at full size (`canvas.width === innerWidth * DPR`; a resolution downgrade shrinks it by `SCENE.quality.resolutionScale`). Then:

   ```js
   (() => {
     const samples = [];
     let last = performance.now();
     function tick(t) {
       samples.push(t - last);
       last = t;
       if (samples.length < 300) requestAnimationFrame(tick);
       else {
         const sorted = [...samples].sort((a, b) => a - b);
         const median = sorted[Math.floor(sorted.length / 2)];
         const p95 = sorted[Math.floor(sorted.length * 0.95)];
         console.log({
           medianMs: median.toFixed(2),
           p95Ms: p95.toFixed(2),
           calls: window.__aq?.calls,
           triangles: window.__aq?.triangles,
         });
       }
     }
     requestAnimationFrame(tick);
   })();
   ```

4. Record the logged `{ medianMs, p95Ms, calls, triangles }` plus the device/OS/browser/resolution/DPR into the table below.

## Results

| 기기 | OS | 브라우저 | 해상도 | DPR | 설정 | 표시 개체수 | 프레임 시간 중앙값(ms) | p95(ms) | draw calls | triangles |
|---|---|---|---|---|---|---|---|---|---|---|
| Headless Chromium (Playwright) | Darwin (CI-like sandbox) | Chromium | 1920x1080 | 1 | default | 물고기 60 | 16.7 | 17.6 | 12 | 7396 |
| Headless Chromium (Playwright) | Darwin (CI-like sandbox) | Chromium | 1920x1080 | 1 | max | 물고기 91 (실제 화면 표시 0 — 아래 ⚠️ 참조) | 16.7 | 17.6 | 12 | 28488 |

Both rows are comfortably inside the N1 budget (draw calls < 30, triangles < 300k).

### Notes

- **Measurements re-recorded (2026-09-05):** Headless Chromium via Playwright in a macOS sandbox (Darwin, not a physical device). Both rows come from the same session, at vsync-capped 60fps, with the settings read back from the DOM and verified against `MAX_SETTINGS`/`DEFAULT_SETTINGS` before sampling. `window.__aq` was identical on the first and last of 300 sampled frames and the canvas stayed at the full 1920x1080, so **no adaptive-quality downgrade fired during either run**.
- **⚠️ Adaptive quality can silently corrupt a recording.** `main.ts` drops `resolutionScale` and then fish population after `SCENE.quality.sampleWindow` (3s) below `SCENE.quality.minFps` (40fps). Any environment that renders below 40fps — headless, software-rendered, throttled, or a backgrounded tab — will trip that downgrade partway through a 300-frame (~5–10s) sample and quietly record post-downgrade numbers. The previous version of this table was recorded that way: both rows showed ~33.3ms (≈30fps, i.e. under `minFps`), and the default row's 6796 triangles is exactly the 7396 above minus a 0.8x population step. Always confirm no downgrade fired, as described in step 3. Real-device recordings (still pending) should not have this artifact.
- **⚠️ At `fish.countScale > 1` no fish are actually drawn (pre-existing bug).** `FishSchool.rebuildInstances()` in `web/src/fish.ts` grows `capacity` and allocates a larger `InstancedMesh`, but does not re-run `writePhaseAttribute()`, so the `aPhase` instanced attribute stays sized for the old capacity. Every fish draw call is then rejected with `GL_INVALID_OPERATION: glDrawArraysInstanced: Vertex buffer is not big enough for the draw call`, once per species per frame. `renderer.info` still counts the issued instances, so the max row's 28488 includes 11830 fish triangles the driver never rendered — the scene shows background only. The default row is unaffected (`countScale === 1` skips `rebuildInstances`), as is any value below 1 (the attribute is then oversized, which is legal). Re-record the max row once this is fixed.
- **`estimateTriangleBudget()` undercounts, and the observed numbers are the correct ones.** The estimator (`web/src/settings.ts`) derives triangles from `position.count / 3`, which is only valid for non-indexed geometry. Fish and coral are non-indexed after baking/merging and match exactly; the floor and seaweed are `PlaneGeometry` and therefore indexed, so they must be counted as `index.count / 3`. At max the estimator reports floor 533 / seaweed 853 where the real counts are 3042 / 2304, giving 24501 instead of ~28474 (plus ~14 god-ray triangles the estimator deliberately omits) — about 14% low. Measured against the 300k N1 ceiling the gap is harmless, but the estimator is the conservative-in-the-wrong-direction number, not the measurement.
- **Mobile devices pending:** iOS Safari (Safari on iPhone) and Android Chrome require actual devices. These will be added as real hardware testing becomes available.
- **Desktop browsers:** Additional measurements from Safari and Firefox on macOS/Windows are welcome contributions.
