# Baseline Stabilization (Stage A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the six concrete robustness/accuracy gaps `docs/DEVELOPMENT_PROPOSAL.md` §2 identified (accessibility, FPS measurement, page-lifecycle recovery, audio fade, storage access, SPEC inconsistencies) and record the performance/acceptance-criteria baseline the proposal's Stage A ("기준선 정리") calls for, before any Stage B feature work starts.

**Architecture:** No new modules. Every fix lands inside the existing `main.ts`/`ui.ts`/`settings.ts` responsibilities described in `CLAUDE.md`; two tasks are documentation-only edits to `docs/SPEC.md` and a new `docs/perf-baseline.md`. `settings.ts` changes get real vitest coverage (it's already unit-tested); `main.ts`/`ui.ts` changes are verified through `npm run build && npm run preview` instead, matching this project's existing test strategy (SPEC §9: "렌더 루프(`main.ts`)와 실제 셰이더 픽셀 결과는 자동 테스트 대상에서 제외").

**Tech Stack:** TypeScript, Vite, Three.js, vitest (environment: `node`, not jsdom — see Global Constraints).

**Spec:** `docs/SPEC.md` (v1.1), motivated by `docs/DEVELOPMENT_PROPOSAL.md` §2 and §9 checklist items 1–3.

## Global Constraints

- Run all commands from `web/`. Build = `npm run build` (`tsc --noEmit && vite build`). Single test file = `npx vitest run src/<file>.test.ts`. Full suite = `npm run test`.
- vitest's `test.environment` is `"node"` (`web/vite.config.ts`), **not** `jsdom` — there is no real `window`/`document` global in tests. Any test that needs a `window` stand-in must use `vi.stubGlobal("window", ...)` / `vi.unstubAllGlobals()`, not assume a DOM.
- `main.ts` and `ui.ts` are excluded from the automated test suite by project convention (CLAUDE.md, SPEC §9) — verify their changes visually via `npm run build && npm run preview`, not by adding jsdom/mocks.
- Before considering any task done, run `npm run build && npm run preview` and check the result — this is a standing project rule (CLAUDE.md), not optional for "just a small fix."
- Don't touch the fish/environment/particle rendering budget (draw calls < 30, triangles < 300k) — none of these tasks add geometry, but double-check `window.__aq` after any `main.ts` change.
- The working tree currently has an unrelated, uncommitted move in progress (`SPEC.md`/`DEVELOPMENT_PROPOSAL.md` deleted from repo root, `docs/` untracked). Do not stage or commit those with `git add -A` — each task below stages only the exact files it lists.
- Never rename `withXxx`/`rebuildXxx`/`school.setVisible`-style existing function names while touching adjacent code — keep signatures identical to what's documented in SPEC §6.5.3 unless a task explicitly changes one (none here do).

---

### Task 1: Safe `localStorage` access at boot and on every save

**Files:**
- Modify: `web/src/settings.ts:120-137` (`loadSettings`, `saveSettings`), add `getLocalStorage`
- Modify: `web/src/main.ts:14` (import), `main.ts:41`, `main.ts:117`
- Test: `web/src/settings.test.ts`

**Interfaces:**
- Produces: `getLocalStorage(): Storage | undefined` (new export from `settings.ts`)
- Modifies: `loadSettings(storage: Pick<Storage, "getItem"> | undefined): AquariumSettings` and `saveSettings(settings: AquariumSettings, storage: Pick<Storage, "setItem"> | undefined): void` — both now accept `undefined` and treat it as "storage unavailable."

Currently `main.ts:41` calls `loadSettings(window.localStorage)` — the `window.localStorage` **property access** happens outside `loadSettings`'s own try/catch, as an argument expression. In a browser where reading that property throws (old Safari private mode, a sandboxed iframe without storage access), this throws before `loadSettings` ever runs, and the whole app fails to boot instead of falling back to defaults.

- [ ] **Step 1: Write the failing tests**

Add to `web/src/settings.test.ts` (new `import` of `getLocalStorage` alongside the existing ones from `"./settings"`, and `vi` is already imported):

```ts
describe("getLocalStorage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns window.localStorage when accessible", () => {
    const fakeStorage = { getItem: () => null } as unknown as Storage;
    vi.stubGlobal("window", { localStorage: fakeStorage });
    expect(getLocalStorage()).toBe(fakeStorage);
  });

  it("returns undefined when there is no window global (non-browser environment)", () => {
    vi.stubGlobal("window", undefined);
    expect(getLocalStorage()).toBeUndefined();
  });

  it("returns undefined when the localStorage getter itself throws", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new DOMException("denied", "SecurityError");
      },
    });
    expect(getLocalStorage()).toBeUndefined();
  });
});

describe("loadSettings/saveSettings with unavailable storage", () => {
  it("loadSettings returns DEFAULT_SETTINGS when storage is undefined", () => {
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("saveSettings no-ops without throwing when storage is undefined", () => {
    expect(() => saveSettings(DEFAULT_SETTINGS, undefined)).not.toThrow();
  });
});
```

Update the top of `settings.test.ts` to import `getLocalStorage`:

```ts
import {
  MAX_SETTINGS,
  debounce,
  estimateTriangleBudget,
  getLocalStorage,
  loadSettings,
  saveSettings,
  sanitizeSettings,
  withBackgroundObjectCountScale,
  withBubblesDensityScale,
  withCaustics,
  withFishCountScale,
  withFishDetail,
  withSpeciesEnabled,
} from "./settings";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/settings.test.ts`
Expected: FAIL — `getLocalStorage` is not exported; the two new `loadSettings`/`saveSettings` calls with `undefined` fail TypeScript's current (non-optional) parameter type.

- [ ] **Step 3: Implement**

In `web/src/settings.ts`, add after the `STORAGE_KEY` constant (currently line 29):

```ts
/**
 * Safely access `window.localStorage`. In some environments (private
 * browsing in older Safari, sandboxed iframes, non-browser test runners)
 * the `localStorage` property getter itself throws, before any call
 * reaches `loadSettings`/`saveSettings`'s own try/catch.
 */
export function getLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
```

Replace `loadSettings` (currently lines 120-128):

```ts
/** Read persisted settings, falling back to `DEFAULT_SETTINGS` on any problem (N5, AC-6). */
export function loadSettings(storage: Pick<Storage, "getItem"> | undefined): AquariumSettings {
  if (storage === undefined) return DEFAULT_SETTINGS;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_SETTINGS;
    return sanitizeSettings(JSON.parse(raw)) ?? DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}
```

Replace `saveSettings` (currently lines 131-137):

```ts
/** Persist settings (N5). Silently no-ops if storage is unavailable (quota/private mode). */
export function saveSettings(settings: AquariumSettings, storage: Pick<Storage, "setItem"> | undefined): void {
  if (storage === undefined) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable — the setting simply won't survive a reload.
  }
}
```

In `web/src/main.ts`, change the import on line 14 from:

```ts
import { debounce, loadSettings, saveSettings } from "./settings";
```

to:

```ts
import { debounce, getLocalStorage, loadSettings, saveSettings } from "./settings";
```

Change line 41 from `let settings: AquariumSettings = loadSettings(window.localStorage);` to:

```ts
  let settings: AquariumSettings = loadSettings(getLocalStorage());
```

Change line 117 from `saveSettings(next, window.localStorage);` to:

```ts
      saveSettings(next, getLocalStorage());
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/settings.test.ts`
Expected: PASS, all cases including the three new `describe` blocks.

- [ ] **Step 5: Full check**

Run: `npm run test && npm run build`
Expected: full suite green, `tsc --noEmit` clean (the loosened parameter types are still compatible with every existing call site, since `createMemoryStorage()` in the test file satisfies `Pick<Storage, "getItem"|"setItem">`).

- [ ] **Step 6: Commit**

```bash
git add web/src/settings.ts web/src/settings.test.ts web/src/main.ts
git commit -m "fix: don't let localStorage access failure crash boot"
```

---

### Task 2: Separate the measured frame delta from the clamped simulation delta

**Files:**
- Modify: `web/src/main.ts:183-223` (the `frame` function)

**Interfaces:**
- No exported signatures change; this is a local-variable fix inside `frame()`.

Currently:

```ts
const frame = (): void => {
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;
    ...
    sampleTime += dt;
    sampleFrames += 1;
    if (sampleTime >= 1) {
      const fps = sampleFrames / sampleTime;
```

`dt` is clamped to 50ms *before* being used both for simulation (correct — this prevents huge boid jumps after a stall) and for the FPS sample window (wrong — a real 100ms frame is counted as 50ms, so the computed `fps` never reflects how slow the frame actually was, and `SCENE.quality.minFps`-based downgrades under-react).

Not unit-tested — `main.ts`'s render loop is excluded from the automated suite (SPEC §9, CLAUDE.md). Verify by reproducing the mismeasurement, then confirming the fix, in the browser.

- [ ] **Step 1: Reproduce the bug**

Run `npm run dev` (or `npm run build && npm run preview`). Open DevTools → Performance → enable CPU throttling ("6x slowdown"). In the console, temporarily run:

```js
let last = performance.now();
setInterval(() => {
  console.log("raw ms/frame:", performance.now() - last);
  last = performance.now();
}, 1000);
```

Confirm the raw interval is well above the 50ms clamp (i.e., real frames are much slower than what `dt` reports), while the app's own adaptive-quality downgrade (visible via `window.__aq` staying at full triangle count, or by watching for a resolution drop) is slow to trigger — this is the bug: the FPS sample computed from clamped `dt` reads healthier than reality.

- [ ] **Step 2: Implement the fix**

Replace the start of `frame()` (currently lines 183-185):

```ts
  const frame = (): void => {
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;
```

with:

```ts
  const frame = (): void => {
    const rawDt = clock.getDelta();
    const dt = Math.min(rawDt, 0.05);
    elapsed += dt;
```

Replace the sampling lines (currently lines 211-212):

```ts
    sampleTime += dt;
    sampleFrames += 1;
```

with:

```ts
    sampleTime += rawDt;
    sampleFrames += 1;
```

Everything else in `frame()` (camera drift, `environment.update(elapsed)`, `school.update(dt, elapsed)`, `bubbles.update(dt, elapsed)`) keeps using the clamped `dt`, unchanged — only the FPS-sample accumulator switches to the unclamped `rawDt`.

- [ ] **Step 3: Verify the fix**

Repeat the Step 1 throttling test. Confirm the adaptive-quality downgrade (`resolutionScale`, then population) now triggers within `SCENE.quality.sampleWindow` (3s) of sustained throttled frames, matching how bad the real frame time is. Remove throttling, confirm normal playback stays at full quality and no downgrade fires spuriously.

- [ ] **Step 4: Commit**

```bash
git add web/src/main.ts
git commit -m "fix: measure FPS from unclamped frame delta, not the sim-clamped one"
```

---

### Task 3: Camera drift respects `prefers-reduced-motion` at boot

**Files:**
- Modify: `web/src/main.ts:60-68` (camera/target setup), `main.ts:183-196` (inside `frame()`)

**Interfaces:**
- No exported signatures change.

The CSS `prefers-reduced-motion` handling that exists today (`style.css:272`) only shortens the loading-spinner animation; the 3D camera still drifts/bobs continuously regardless of the system setting. Not unit-tested (same `main.ts` exclusion as Task 2) — verify via DevTools media-feature emulation.

- [ ] **Step 1: Implement**

After the existing camera/target setup (currently lines 60-66):

```ts
  const camera = new PerspectiveCamera(
    SCENE.camera.fov,
    window.innerWidth / window.innerHeight,
    SCENE.camera.near,
    SCENE.camera.far,
  );
  const target = new Vector3(0, SCENE.floorY + 3.4, 0);
```

add:

```ts
  const prefersReducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (prefersReducedMotion) {
    camera.position.set(0, SCENE.camera.height, SCENE.camera.radius);
    camera.lookAt(target);
  }
```

(`angle = 0` at `elapsed = 0` in the existing drift formula already resolves to exactly this resting position — `Math.sin(0) * radius = 0`, `Math.cos(0) * radius = radius`, `height + Math.sin(0) * bobAmplitude = height` — so this is the scene's normal starting pose, just held fixed.)

Inside `frame()`, wrap the drift block (currently lines 187-195):

```ts
    const angle = Math.sin(elapsed * SCENE.camera.driftSpeed) * SCENE.camera.driftRadians;
    camera.position.set(
      Math.sin(angle) * SCENE.camera.radius,
      SCENE.camera.height +
        Math.sin(elapsed * SCENE.camera.bobSpeed) * SCENE.camera.bobAmplitude,
      Math.cos(angle) * SCENE.camera.radius,
    );
    target.x = Math.sin(elapsed * 0.033) * 1.4;
    camera.lookAt(target);
```

with:

```ts
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
```

- [ ] **Step 2: Verify**

`npm run build && npm run preview`. DevTools → Rendering tab → "Emulate CSS media feature prefers-reduced-motion" → `reduce`. Reload the preview tab: confirm the camera holds still (no orbit/bob) while fish/environment/bubbles keep animating normally. Switch the emulation back to "no preference" and reload: confirm the camera drifts exactly as before (no regression).

- [ ] **Step 3: Commit**

```bash
git add web/src/main.ts
git commit -m "feat: lock camera drift when the system requests reduced motion"
```

---

### Task 4: Cancel debounced rebuilds and recover cleanly from a back/forward-cache restore

**Files:**
- Modify: `web/src/main.ts:241-251` (the `pagehide` listener), add a `pageshow` listener

**Interfaces:**
- Consumes: `rebuildFishDetail`, `rebuildFishCount`, `rebuildBackground` (each a `debounce(...)` result, already exposing `.cancel()` per `settings.ts:144-161`), `clock`, `sampleTime`, `sampleFrames`, `lowFpsTime`, `renderer`, `frame` — all already in scope inside `boot()`.

Today, `pagehide` unconditionally disposes every GPU resource and removes every listener — including on a back/forward-cache-eligible navigation (`event.persisted === true`), after which there is no `pageshow` handler to either resume or rebuild the scene, so returning via the back button shows a frozen or blank canvas. Separately, none of the three debounced rebuild timers are cancelled on teardown, so a pending rebuild can still fire after (partial) cleanup. Not unit-tested (same `main.ts` exclusion) — verify via a real back/forward navigation.

- [ ] **Step 1: Implement**

Replace the existing `pagehide` listener (currently lines 241-251):

```ts
  window.addEventListener("pagehide", () => {
    renderer.setAnimationLoop(null);
    window.removeEventListener("resize", onResize);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    for (const school of schools) school.dispose();
    bubbles.dispose();
    environment.dispose();
    ui.dispose();
    settingsPanel.dispose();
    renderer.dispose();
  });
```

with:

```ts
  window.addEventListener("pagehide", (event) => {
    renderer.setAnimationLoop(null);
    rebuildFishDetail.cancel();
    rebuildFishCount.cancel();
    rebuildBackground.cancel();
    if (event.persisted) return; // may return via `pageshow` from the bfcache — keep GPU resources alive
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
    if (!event.persisted) return;
    clock.getDelta(); // discard the time spent frozen in the cache
    sampleTime = 0;
    sampleFrames = 0;
    lowFpsTime = 0;
    renderer.setAnimationLoop(frame);
  });
```

- [ ] **Step 2: Verify**

`npm run build && npm run preview`. In a real browser (not headless), open the preview page, then navigate to a different page in the same tab (e.g. type a new URL), then press the Back button. Confirm the aquarium resumes animating smoothly (not frozen on the last frame, not blank) and that the FPS-based adaptive-quality logic doesn't immediately misfire from the frozen gap (no sudden downgrade right after returning). Then, separately, fully close/reload the tab (a non-bfcache unload) and confirm the app still starts fresh with no console errors (proving the full-dispose path still runs on a real unload).

Chrome DevTools also has a dedicated check: Application panel → "Back/forward cache" → "Test back/forward cache" — use it if available to confirm the page is bfcache-eligible (no blocking API is used elsewhere in the app).

- [ ] **Step 3: Commit**

```bash
git add web/src/main.ts
git commit -m "fix: cancel debounced rebuilds and recover from back/forward-cache restores"
```

---

### Task 5: Ambient audio fade completes before suspend; safe under rapid retoggle

**Files:**
- Modify: `web/src/ui.ts:28-133` (the `AmbientAudio` class)

**Interfaces:**
- No exported signatures change (`AmbientAudio.toggle()`/`isPlaying`/`dispose()` keep their shapes).

Today, `AmbientAudio.stop()` (`ui.ts:65-76`) schedules a 1.2s gain ramp to 0 and then immediately calls `context.suspend()` in the next line, without waiting. `AudioContext.suspend()` stops the context's time from advancing, so the scheduled ramp is cut short instead of audibly completing — the sound stops abruptly rather than fading out. Not unit-tested (`ui.ts` is excluded from the automated suite per CLAUDE.md — "declarative scene construction"/audio synthesis, verified visually). Verify by listening, in the browser.

- [ ] **Step 1: Implement**

Add a field to track the pending suspend timer (in the class body, alongside the existing fields around `ui.ts:29-33`):

```ts
class AmbientAudio {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private lfo: OscillatorNode | null = null;
  private playing = false;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
```

Replace `start()` (currently `ui.ts:49-63`) to cancel any pending suspend first, so a rapid off-then-on doesn't suspend the context out from under the resumed sound:

```ts
  private async start(): Promise<void> {
    if (this.stopTimer !== null) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    const context = this.context ?? new AudioContext();
    this.context = context;
    if (context.state === "suspended") await context.resume();

    if (this.gain === null) this.buildGraph(context);
    const gain = this.gain;
    if (gain === null) return;

    const now = context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0.16, now + 2.5);
    this.playing = true;
  }
```

Replace `stop()` (currently `ui.ts:65-76`) to wait out the fade before suspending, and to bail if `start()` ran again mid-fade:

```ts
  private async stop(): Promise<void> {
    const context = this.context;
    const gain = this.gain;
    this.playing = false;
    if (context === null || gain === null) return;

    const now = context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    const fadeSeconds = 1.2;
    gain.gain.linearRampToValueAtTime(0, now + fadeSeconds);

    await new Promise<void>((resolve) => {
      this.stopTimer = setTimeout(() => {
        this.stopTimer = null;
        resolve();
      }, fadeSeconds * 1000);
    });
    if (this.playing) return; // `start()` ran again during the fade — stay playing, don't suspend
    await context.suspend();
  }
```

Update `dispose()` (currently `ui.ts:123-132`) to also clear a pending timer:

```ts
  dispose(): void {
    if (this.stopTimer !== null) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    this.source?.stop();
    this.lfo?.stop();
    void this.context?.close();
    this.source = null;
    this.lfo = null;
    this.gain = null;
    this.context = null;
    this.playing = false;
  }
```

- [ ] **Step 2: Verify**

`npm run build && npm run preview`. Click the sound toggle on, wait a couple seconds, click it off: confirm the sound fades smoothly over roughly 1.2s rather than cutting off abruptly. Then click off/on/off/on rapidly several times in a row: confirm no console errors, the audio ends up in the state matching the last click, and there's no audible glitch/overlap from a suspended context fighting a resumed one.

- [ ] **Step 3: Commit**

```bash
git add web/src/ui.ts
git commit -m "fix: let the ambient-audio mute fade finish before suspending the context"
```

---

### Task 6: Fix SPEC.md's internal inconsistencies to match real, measured behavior

**Files:**
- Modify: `docs/SPEC.md:58` (§4 Backend), `docs/SPEC.md:210` (§6.5.3 dispose order), `docs/SPEC.md:221` (§6.5.6), `docs/SPEC.md:228` (AC-4)

**Interfaces:** none (documentation only).

Three concrete inconsistencies, matched against the real code read while writing this plan:

1. **§4** claims "3D 렌더링·물고기 AI·파티클이 모두 브라우저 GPU에서 처리되므로 서버가 할 일이 없음." But `FishSchool.update()` (`fish.ts`) and the bubble particle update (`particles.ts`) run every frame on the CPU in JavaScript — only the draw itself is GPU work (matches CLAUDE.md's own description of `particles.ts` as "CPU-driven").
2. **§6.5.3** claims rebuild functions "always dispose 이전 `BufferGeometry`/`InstancedMesh`를 먼저 `dispose()`한 뒤 새 것으로 교체한다" — but the real code (`fish.ts:410-451`, `rebuildGeometry`/`rebuildInstances`) creates the *new* geometry/mesh, swaps it into the scene, and only *then* disposes the old one — the opposite order. That order is also the correct one: disposing first is exactly what would cause the "빈 프레임" (blank frame) the same section says to avoid.
3. **§6.5.6 / AC-4** claims a hidden species' `InstancedMesh` "mesh는 씬에 남아 draw call 1개를 계속 소모함" while also saying visibility toggles don't cost a draw call — self-contradictory. Real Three.js behavior: `InstancedMesh.visible = false` excludes the mesh from the render list entirely, so both its draw call *and* its triangles drop out of `renderer.info.render` while hidden.

- [ ] **Step 1: Confirm the empirical claim (#3) before editing the doc**

`npm run build && npm run preview`. Open the settings panel, note `window.__aq` in the console (e.g. type `window.__aq`). Uncheck one fish species. Re-check `window.__aq`: confirm both `calls` and `triangles` decreased (not just `triangles`). Re-check the species and confirm both increase back. Keep the before/after numbers — they go into the AC-4 edit below.

- [ ] **Step 2: Edit §4 (line 58)**

Replace:

```
- **v1: 없음** — 3D 렌더링·물고기 AI·파티클이 모두 브라우저 GPU에서 처리되므로 서버가 할 일이 없음
```

with:

```
- **v1: 없음** — 3D 렌더링은 브라우저 GPU가 처리하고, 물고기 AI(군집 시뮬레이션)와 파티클 위치 갱신은 매 프레임 CPU(JavaScript)에서 계산한다. 둘 다 서버가 관여해야 하는 상태를 만들지 않으므로 서버가 할 일이 없음
```

- [ ] **Step 3: Edit §6.5.3 (line 210)**

Replace:

```
- 리빌드가 필요한 함수들은 always dispose 이전 `BufferGeometry`/`InstancedMesh`를 먼저 `dispose()`한 뒤 새 것으로 교체한다 (메모리 누수 방지 — 기존 `pagehide` cleanup 패턴과 동일한 원칙).
```

with:

```
- 리빌드가 필요한 함수들은 새 `BufferGeometry`/`InstancedMesh`를 먼저 만들어 씬에 교체 투입한 뒤, 이전 것을 `dispose()`한다(교체 후 dispose) — 순서를 반대로 하면 교체가 끝나기 전 한 프레임 동안 빈 지오메트리가 보인다. 교체가 끝난 뒤에는 이전 리소스를 반드시 `dispose()`해 메모리 누수를 막는다(기존 `pagehide` cleanup 패턴과 동일한 원칙).
```

- [ ] **Step 4: Edit §6.5.6 (line 221)**

Replace:

```
- 설정 조합의 최댓값(모든 종 표시 × 물고기수 1.5× × 디테일 High × 배경물체수 2.0× × 디테일 High)에서 예상 삼각형 수를 계산하는 순수 함수 `estimateTriangleBudget(settings)`를 `settings.ts`(또는 별도 `budget.ts`)에 만들고, 이 값이 300,000 미만인지 단위 테스트로 고정한다(§9). 드로우콜은 설정에 따라 종 수·배경 메시 수가 변하지 않는 한 늘지 않으므로(가시성 토글은 드로우콜을 소모하지 않음 — `visible=false`인 인스턴스도 별도 draw call을 만들지 않음, 단 종 자체를 "완전히 표시 안 함"으로 둬도 mesh는 씬에 남아 draw call 1개를 계속 소모함을 알고 있을 것), 최댓값 시나리오에서도 드로우콜 예산이 그대로 유지됨을 함께 확인한다.
```

with:

```
- 설정 조합의 최댓값(모든 종 표시 × 물고기수 1.5× × 디테일 High × 배경물체수 2.0× × 디테일 High)에서 예상 삼각형 수를 계산하는 순수 함수 `estimateTriangleBudget(settings)`를 `settings.ts`(또는 별도 `budget.ts`)에 만들고, 이 값이 300,000 미만인지 단위 테스트로 고정한다(§9). 드로우콜 예산은 "모든 종을 표시한" 상태를 기준으로 검증한다 — 종 수 + 배경 고정 메시 수로 고정되며 설정 조작으로는 늘지 않는다. 반대로 종 체크박스를 꺼서 `InstancedMesh.visible = false`가 되면 Three.js가 해당 메시를 렌더 목록에서 완전히 제외하므로, 그 종의 draw call과 triangle이 모두 줄어든다(실측: `window.__aq`) — 즉 숨김은 예산을 늘리지 않고 오히려 줄인다.
```

- [ ] **Step 5: Edit AC-4 (line 228)**

Replace:

```
- [ ] **AC-4**: 설정 패널에서 종 체크박스를 끄면 다음 프레임 내에 해당 종이 화면(및 `window.__aq`의 draw call 수는 불변, triangle 수만 감소하는 것이 아니라 — 주의: visible=false는 삼각형 계산 자체를 스킵하므로 triangle 카운트도 감소)에서 사라진다.
```

with (checked, since Step 1 above just confirmed it):

```
- [x] **AC-4**: 설정 패널에서 종 체크박스를 끄면 다음 프레임 내에 해당 종이 화면에서 사라진다. `InstancedMesh.visible = false`는 Three.js 렌더 목록에서 해당 메시를 완전히 제외하므로, `window.__aq`의 draw call 수와 triangle 수가 모두 그 종만큼 감소한다(실측 확인, 2026-09-05).
```

- [ ] **Step 6: Sanity check and commit**

Run: `npm run test && npm run build` (this task touches no code, so both should already pass — this just confirms nothing was accidentally broken while editing the file).

```bash
git add docs/SPEC.md
git commit -m "docs: reconcile SPEC.md's dispose-order/draw-call/GPU-CPU claims with real behavior"
```

---

### Task 7: Record the default/max-settings performance baseline

**Files:**
- Create: `docs/perf-baseline.md`

**Interfaces:** none (documentation only). Uses the already-exposed `window.__aq` (`main.ts:203-204`) and a temporary in-console frame-time sampler (no source change needed).

The proposal (§7) calls for a recorded baseline — device/OS/browser/resolution/DPR/settings/displayed-fish-count/frame-time median & p95 — before Stage B work starts, and notes "현재 수치는 아직 측정하지 않았다." This task defines the exact procedure and file so the numbers get captured once, then reused as the "did we regress?" reference for every later change.

- [ ] **Step 1: Create the baseline doc with its data-collection method**

Write `docs/perf-baseline.md`:

```markdown
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
| _(fill in)_ | | | | | default | | | | | |
| _(fill in)_ | | | | | max | | | | | |

Target browser/device coverage per proposal §7: desktop 주요 브라우저 (Chrome/Safari/Firefox), iOS Safari, Android Chrome — actual device.
```

- [ ] **Step 2: Fill in at least one real row**

Run the Step 1 procedure once on whatever desktop browser is available in this environment, for both the `default` and `max` settings, and fill in the corresponding rows. Note in the file if mobile devices aren't available yet ("iOS Safari / Android Chrome: 실제 기기 확보 후 추가 예정") rather than leaving the table looking complete when it isn't — no silent gaps.

- [ ] **Step 3: Commit**

```bash
git add docs/perf-baseline.md
git commit -m "docs: add performance baseline recording procedure and first results"
```

---

### Task 8: Audit v1.1 acceptance criteria against current tests

**Files:**
- Modify: `docs/SPEC.md:225-233` (§7 Acceptance Criteria checkboxes)

**Interfaces:** none (documentation only).

Cross-checking each AC against the actual test suite (already confirmed while writing this plan):

| AC | Verified by | Check? |
|---|---|---|
| AC-1 | `fish.test.ts:131` "defaults to medium detail, matching the exact v1 baseline (AC-1)" | ✅ |
| AC-2 | `fish.test.ts:156` "scales high detail to ~2.5x ... (AC-2)" | ✅ |
| AC-3 | `environment.test.ts:28` "scales the whole background ... (AC-3)" | ✅ |
| AC-4 | `fish.test.ts:346` (visibility toggles instance count, unit-level) **+** the manual `window.__aq` draw-call/triangle check done in Task 6 Step 1 (render-level, not unit-testable) | ✅ (already ticked by Task 6) |
| AC-5 | `settings.test.ts:112` "calls the wrapped function once after rapid repeated calls" | ✅ |
| AC-6 | `settings.test.ts:44-69` (`loadSettings` fallback cases) | ✅ |
| AC-7 | `settings.test.ts:172` "stays under the 300,000-triangle budget ... " | ✅ |
| AC-8 | **none** — `settingsPanel.ts`'s own header comment states it is "intentionally left out of the automated test suite ... and verified visually instead"; no `settingsPanel.test.ts` exists | ❌ leave unchecked |
| AC-9 | `fish.test.ts:187-246` (`computeFacetJitter` + high-detail jitter tests) | ✅ |

- [ ] **Step 1: Run the suite to confirm the table above is still accurate**

Run: `npm run test`
Expected: all listed test names still exist and pass (the table was built from a point-in-time read of the test files — re-grep before editing SPEC.md if any test names have since changed: `grep -n "AC-[0-9]" web/src/*.test.ts`).

- [ ] **Step 2: Edit §7 checkboxes**

In `docs/SPEC.md`, change AC-1, AC-2, AC-3, AC-5, AC-6, AC-7, AC-9 from `- [ ]` to `- [x]` (AC-4 was already changed by Task 6; leave AC-8 as `- [ ]`). For AC-8, append a note explaining the gap rather than leaving it silently unchecked:

```
- [ ] **AC-8**: 새 어종을 `FISH_REGISTRY`에 추가하면, 설정 패널의 "물고기 종류" 목록에 코드 수정 없이 자동으로 나타난다(하드코딩 목록 금지 — 회귀 테스트로 레지스트리 길이와 렌더된 체크박스 수가 일치하는지 확인). **미검증**: `settingsPanel.ts`는 자동 테스트에서 제외되어 있어(육안 검증 대상, §9) 이 AC를 고정하는 테스트가 없다. 검증하려면 DOM 렌더링 로직 중 "레지스트리 → 체크박스 개수"만 순수 함수로 분리해 jsdom 없이 테스트하거나, 최소한 `npm run preview`에서 레지스트리 길이와 렌더된 체크박스 수를 육안 대조한다.
```

- [ ] **Step 3: Commit**

```bash
git add docs/SPEC.md
git commit -m "docs: check off SPEC v1.1 acceptance criteria confirmed by the current test suite"
```

---

## Self-Review Notes

- **Spec coverage**: all six `docs/DEVELOPMENT_PROPOSAL.md` §2 items are covered 1:1 — item 1→Task 3, item 2→Task 2, item 3→Task 4, item 4→Task 5, item 5→Task 1, item 6→Task 6. The two remaining §9 checklist bullets ("기본·최대 설정 성능 기준선" and "v1.1 구현과 SPEC 수용 기준 대조") are Tasks 7 and 8.
- **Placeholder scan**: no "TBD"/"handle edge cases"/"similar to Task N" — every step has the literal diff or exact command.
- **Type consistency**: `getLocalStorage`, `loadSettings`, `saveSettings` signatures are used identically in Task 1's test additions and `main.ts` call-site edits. `rebuildFishDetail.cancel()` etc. in Task 4 match the `debounce()` return type already defined in `settings.ts:144-161` (no new function needed).
- Task 6 and Task 8 both touch `docs/SPEC.md` — run them in order (6 before 8) since Task 8's AC-4 row assumes Task 6 already ticked that box.
