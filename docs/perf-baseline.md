# Performance Baseline

Recorded once per device/browser combination before Stage B (§6 of `docs/DEVELOPMENT_PROPOSAL.md`) starts. Re-run after any change to `web/src/fish.ts`, `environment.ts`, `particles.ts`, or `config.ts`'s `SCENE`/`FISH_REGISTRY` that could move the triangle/draw-call budget.

## How to record a row

1. `cd web && npm run build && npm run preview`, open the printed URL on the target device/browser.
2. For the **default** row: leave settings untouched (`DEFAULT_SETTINGS`). For the **max** row: open the settings panel and push every control to its maximum (all species checked, fish detail High, fish-count slider to 1.5x, background detail High, background-object slider to 2.0x, lighting slider to 1.6x, bubbles on with density 2.0x) — this matches `MAX_SETTINGS` in `web/src/settings.ts`.
3. Let the scene run untouched for ~5 seconds, then paste this into the DevTools console:

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
| Headless Chromium (Playwright) | Darwin (CI-like sandbox) | Chromium | 1920x1080 | 1 | default | 60 | 33.3 | 33.4 | 12 | 6796 |
| Headless Chromium (Playwright) | Darwin (CI-like sandbox) | Chromium | 1920x1080 | 1 | max | 60 | 33.4 | 66.6 | 12 | 11984 |

### Notes

- **First measurements (2026-09-05):** Recorded in headless Chromium via Playwright automation in a macOS sandbox environment (Darwin, not a physical device). This represents the baseline for the current codebase.
- **Mobile devices pending:** iOS Safari (Safari on iPhone) and Android Chrome require actual devices. These will be added as real hardware testing becomes available.
- **Desktop browsers:** Additional measurements from Safari and Firefox on macOS/Windows are welcome contributions.
