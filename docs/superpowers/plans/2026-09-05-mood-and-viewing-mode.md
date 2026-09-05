# Mood Presets & Viewing Mode (Stage B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `docs/DEVELOPMENT_PROPOSAL.md`'s Stage B ("감상 경험"): three mood presets (§4.1), a camera drift/fixed toggle with a power-save mode and gradual quality recovery (§4.2), a volume slider (§5), and an idle UI auto-hide for long, uninterrupted viewing (§4.2/§6.4) — without regressing the default (unmodified) scene.

**Architecture:** Every new setting is an additive field on the existing `AquariumSettings` schema, flowing through the settings panel's existing pure-reducer + debounce + `onChange` pipeline (`settings.ts` → `settingsPanel.ts` → `main.ts`) — no new state-management path. Mood presets are *derived*, not persisted: a preset is just a bundle of existing field values, and "which preset is active" is computed by exact-matching the current settings against each preset (no new schema field, no extra persistence code). The adaptive-quality state machine in `main.ts` is refactored from one-directional (`downgrade()` only) to step-based and bidirectional, with the step→scale mapping extracted as a pure, unit-tested function so `main.ts`'s render loop (still excluded from automated tests per SPEC §9/CLAUDE.md) stays a thin wiring layer over testable logic.

**Tech Stack:** TypeScript, Vite, Three.js, vitest (environment: `node` — see Stage A's plan for why that matters for any test touching `window`).

**Spec:** `docs/SPEC.md`, extended by Task 1 of this plan. Motivated by `docs/DEVELOPMENT_PROPOSAL.md` §4.1, §4.2, §5, and the "B. 감상 경험" row of §6.

## Global Constraints

- Run all commands from `web/`. Build = `npm run build`. Single test file = `npx vitest run src/<file>.test.ts`. Full suite = `npm run test`.
- **Depends on Stage A** (`docs/superpowers/plans/2026-09-05-baseline-stabilization.md`), specifically Tasks 2 (`rawDt`/`dt` split), 3 (`prefersReducedMotion` at boot), and 4 (cancellable, bfcache-aware `pagehide`/`pageshow`), and Task 5 (`AmbientAudio`'s fade-then-suspend `stopTimer`). **Run Stage A first.** Task 5 and Task 6 below give their diffs against the post-Stage-A shape of `ui.ts`/`main.ts` (quoted in full at each step) rather than raw line numbers, since Stage A shifts the exact lines — locate each snippet by its surrounding code, not a line count, if the file has drifted further since either plan was written.
- vitest's `test.environment` is `"node"`, not `jsdom` — no real `window`/`document` in tests; anything needing one uses `vi.stubGlobal`.
- `main.ts`, `ui.ts`, and `settingsPanel.ts` are excluded from the automated test suite by project convention (CLAUDE.md, SPEC §9) — verify their changes visually via `npm run build && npm run preview`.
- Per this project's own methodology (SPEC §0: "Spec 먼저"), the data model and acceptance criteria for every field this plan adds must exist in `docs/SPEC.md` *before* the implementing code — that's why Task 1 is a pure documentation task.
- Mood presets must never touch `fish.detail` / `background.detail` / `fish.enabledSpecies` — those are device-performance/user-selection settings, independent of mood (proposal §4.1: "장면 분위기와 기기 성능 설정을 구분"). Don't fold them into `MOOD_PRESETS` even if it looks convenient.
- `DEFAULT_SETTINGS` must keep reproducing exactly today's v1 behavior (existing AC-1 regression rule) — every new field's default must match the current hardcoded constant it replaces: camera `"drift"`, `performance.powerSave: false`, `audio.volume: 0.16` (today's hardcoded `AmbientAudio` gain target).
- Don't rename any existing exported function (`withFishDetail`, `school.setVisible`, etc.) while adding neighbors to the same file.

---

### Task 1: Update `docs/SPEC.md` with the Stage B data model, mapping, and acceptance criteria

**Files:**
- Modify: `docs/SPEC.md` §2 (line 36), §3 (line 43), §6.5.2 (lines 163-192), §6.5.3 (after line 207), new §6.6/§6.7/§6.8 (after §6.5.6, before §7 at line 223), §7 (after line 233), §8 (after line 249), §10 (after line 273)

**Interfaces:** none (documentation only — this defines the contract Tasks 2-10 implement).

- [ ] **Step 1: Add feature rows to §2 (after line 36, F7)**

```
| F8 | 분위기 프리셋 | 설정 패널 상단에서 조명 세기·물고기 수·기포를 한 번에 바꾸는 프리셋 3개(맑은 산호초/고요한 바다/은은한 저녁). 기기 성능 설정(디테일)은 건드리지 않음 | v1.2 신규 |
| F9 | 감상 모드 | 카메라 "천천히 이동/고정" 선택, 절전 모드(30fps대 목표 + 낮은 DPR), 무입력 시 UI 자동 숨김·재입력 시 즉시 복귀 | v1.2 신규 |
| F10 | 음량 조절 | 앰비언트 사운드의 음량을 슬라이더로 조절(기존 켜기/끄기 토글과 별개 축) | v1.2 신규 |
```

- [ ] **Step 2: Extend N2 in §3 (replace line 43)**

Replace:

```
| N2 | 적응형 품질 | DPR 상한 1.5~2, 탭 숨김 시 렌더 중지, fps 하락 시 해상도 → 개체수 순 자동 축소. **자동 축소는 사용자가 설정 패널에서 지정한 값 위에서 동작하는 임시 스케일이며, 설정값 자체를 덮어쓰지 않는다** |
```

with:

```
| N2 | 적응형 품질 | DPR 상한 1.5~2, 탭 숨김 시 렌더 중지, fps 하락 시 해상도 → 개체수 순 자동 축소. **자동 축소는 사용자가 설정 패널에서 지정한 값 위에서 동작하는 임시 스케일이며, 설정값 자체를 덮어쓰지 않는다.** **fps가 충분히(§6.7 `recoverFps`) 오래(`recoverWindow`) 유지되면 한 단계씩 자동으로 되돌아간다(진동 방지). 절전 모드(F9)는 별도의 낮은 fps 임계값을 사용해 의도한 낮은 fps를 성능 장애로 오인하지 않는다** |
```

- [ ] **Step 3: Extend the `AquariumSettings` interface in §6.5.2 (inside the code block, lines 166-192)**

After the `bubbles` field (line 190, just before the closing `}` of the interface), insert:

```ts
  camera: {
    /** "drift" = 기존 카메라 드리프트, "fixed" = 고정(§6.7). */
    mode: "drift" | "fixed";
  };
  performance: {
    /** 절전 모드: 낮은 DPR 상한 + 낮은 fps 임계값을 함께 적용(§6.7). */
    powerSave: boolean;
  };
  audio: {
    /** 앰비언트 사운드 목표 음량, 0~1. 켜기/끄기 토글과 별개로 유지된다. */
    volume: number;
  };
```

Directly below the interface's existing bullet list (after line 195), add:

```
- 최초 방문(저장된 설정 없음) 시 `camera.mode`의 실effective값은 시스템의 `prefers-reduced-motion` 요청이 있으면 `"fixed"`로 시작하지만, `DEFAULT_SETTINGS.camera.mode` 자체는 `"drift"`로 유지된다 — 사용자가 명시적으로 `"drift"`를 저장한 뒤에는 시스템 설정이 이를 덮어쓰지 않는다(§6.7.1).
- `audio.volume`의 기본값 `0.16`은 v1의 하드코딩된 게인 목표값과 동일하다(회귀 없음).
```

- [ ] **Step 4: Add rows to the §6.5.3 mapping table (after the existing 물방울 row, line 207)**

```
| 카메라 모드 | "천천히 이동"/"고정" 라디오 | 즉시 — 다음 프레임부터 드리프트 계산을 건너뛰고 고정 위치로 스냅 | `main.ts`: `cameraMode` 지역 변수(§6.7.1) |
| 절전 모드 | 체크박스 | 즉시 — 해상도 상한과 fps 임계값을 재계산 | `config.ts`: `computeQualityScales`/`effectiveMinFps` · `main.ts`: `applyQualityStep`(§6.7.2) |
| 음량 | 슬라이더 0~1 | 즉시 — 재생 중이면 게인을 목표치로 부드럽게 램프(0.2초), 다음 재생부터도 이 값을 목표로 사용 | `ui.ts`: `AmbientAudio.setVolume(volume)`(§6.7.3) |
```

- [ ] **Step 5: Insert new §6.6/§6.7/§6.8 subsections (after §6.5.6, before §7 — i.e. after line 221, before line 223)**

```markdown
### 6.6 분위기 프리셋 (v1.2, F8)

설정 패널 최상단에 프리셋 3개 버튼을 둔다. 각 프리셋은 **기존에 이미 존재하는 설정 항목**(조명 세기, 물고기 수 배율, 기포 on/off·밀도)만 한 번에 바꾼다 — 물고기/배경 디테일과 종 선택은 건드리지 않는다(기기 성능 설정과 분위기 설정의 분리, §4.1).

| 프리셋 id | 라벨 | lighting.intensityScale | fish.countScale | bubbles.enabled | bubbles.densityScale |
|---|---|---|---|---|---|
| `clear-reef` | 맑은 산호초 | 1.3 | 1.2 | true | 1.2 |
| `calm-sea` | 고요한 바다 | 1.0 | 1.0 | true | 1.0 |
| `soft-evening` | 은은한 저녁 | 0.6 | 0.7 | true | 0.5 |

- `calm-sea`는 `DEFAULT_SETTINGS`의 값과 정확히 같다 — 최초 방문자가 아무것도 조작하지 않아도 화면은 이미 "고요한 바다"와 동일하게 시작한다(§4.1 "최초 진입은 지금의 기본 장면으로 바로 시작").
- 프리셋 적용은 새로운 저장 필드를 만들지 않는다. "지금 어떤 프리셋이 선택되어 있는가"는 현재 설정값을 세 프리셋과 정확히 비교(`matchingPresetId`)해 **파생**한다 — 정확히 일치하지 않으면(수동 조절 시) 어떤 프리셋도 활성 표시되지 않고 "사용자 설정"으로 보인다. 이 방식은 프리셋 전용 저장 로직이나 스키마 마이그레이션 없이 재방문 시 유지(§8 결정 로그)와 "빠른 연속 선택은 최종 상태로 수렴"을 공짜로 만족시킨다.
- 프리셋 변경은 사운드를 자동으로 켜지 않는다(§4.1).
- 색온도·포그 색·전용 사운드 레이어를 포함하는 2차 확장(§4.1의 "2차")은 이번 범위 밖이며, 스키마에 아직 존재하지 않는 필드를 프리셋이 만들어내지 않는다.

### 6.7 감상 모드와 절전 (v1.2, F9)

#### 6.7.1 카메라 모드
- `camera.mode: "drift" | "fixed"`. `"drift"`는 기존 카메라 드리프트/바빙과 동일. `"fixed"`는 매 프레임 위치 갱신을 건너뛰고 드리프트의 `elapsed = 0` 정지 자세(즉 `angle = 0`인 위치)에 고정한다.
- 최초 방문(저장된 설정 없음)이고 시스템이 `prefers-reduced-motion: reduce`를 요청하면, `main.ts`는 부팅 시점에만 `cameraMode`를 `"fixed"`로 시작한다. 사용자가 설정 패널에서 명시적으로 값을 바꾸면 그 값이 저장되고 이후에는 시스템 설정보다 우선한다.
- 라디오 그룹으로 제공하며(기존 `detailRadioGroup`과 동일한 키보드 접근성 패턴 재사용), 설정 패널을 열고 키보드만으로 모드를 바꾸고 패널을 닫을 수 있어야 한다(AC-12 참고 대신 육안 확인 — 네이티브 `<input type=radio>`/`<button>` 시맨틱만으로 충분하므로 별도 키보드 핸들러는 추가하지 않는다).

#### 6.7.2 절전 모드와 화질 복구
- `performance.powerSave: boolean`. 켜져 있으면 해상도 상한을 `SCENE.quality.powerSave.resolutionScale`(기존 자동 축소 단계의 해상도 스케일보다 더 낮음)로 즉시 클램프하고, 적응형 품질 저하 판정에 쓰는 fps 임계값을 `SCENE.quality.powerSave.minFps`(예: 24, 기존 `minFps` 40보다 낮음)로 낮춘다 — 절전 모드가 의도적으로 만든 낮은 fps를 "성능 장애"로 오인해 추가로 개체수를 줄이지 않기 위함(기존 40fps 임계값과 절전 모드가 충돌하는 문제의 해결).
- 두 계산은 순수 함수로 뽑아 단위 테스트로 고정한다: `computeQualityScales(downgradeStep, powerSave)`가 `{ resolutionScale, populationScale }`을, `effectiveMinFps(powerSave)`가 적용할 fps 임계값을 반환한다(둘 다 `config.ts`).
- 기존 다운그레이드는 한 방향(0→1→2)만 가능했다. 이제 `downgradeStep`은 0~2 사이를 양방향으로 움직인다: `fps < effectiveMinFps(powerSave)`가 `sampleWindow`초 지속되면 한 단계 내려가고(`downgradeStep += 1`, 상한 2), `fps >= SCENE.quality.recoverFps`(기존 임계값보다 확실히 높은 값, 예: 52)가 `recoverWindow`초(다운그레이드보다 긴 지속 시간, 예: 8초) 지속되면 한 단계 올라간다(`downgradeStep -= 1`, 하한 0). 두 방향 모두 한 번에 한 단계만 움직여 화질이 반복해서 오르내리지 않는다.
- 사용자가 설정한 물고기 수(countScale)와 이 자동 스케일은 기존과 마찬가지로 별개 축으로 곱해진다(§8 기존 결정 유지).

#### 6.7.3 음량
- `audio.volume: number`(0~1). 슬라이더로 조절하며, 재생 중이면 `AmbientAudio.setVolume(volume)`이 현재 게인을 새 목표치로 0.2초에 걸쳐 램프한다(끊김 방지). 정지 상태에서 바꾸면 다음 재생 시작 때 이 값을 목표로 사용한다. 음소거 페이드(정지)는 이 목표 음량과 무관하게 항상 0으로 향한다.

### 6.8 UI 자동 숨김 (v1.2, §6.4 확장)

- 포인터/터치/키보드 입력이 일정 시간(기본 6초) 없으면 제목과 컨트롤(사운드·설정 토글)이 서서히 사라진다. 캔버스 자체와 진행 중인 애니메이션은 영향받지 않는다 — 오직 오버레이 UI 표시 여부만 바뀐다.
- 어떤 포인터/터치/키보드 입력이든 즉시 다시 나타나며 숨김 타이머가 재시작된다.
- 설정 패널이 열려 있는 동안에는 자동으로 숨기지 않는다(타이머가 계속 재확인만 하다가, 패널이 닫히면 새로 카운트를 시작한다).
- 새로운 저장 필드는 만들지 않는다 — 항상 켜져 있는 동작이며(§6.4의 "UI 최소화" 철학 연장), 설정 패널에 온오프 토글을 추가하지 않는다.
```

- [ ] **Step 6: Add acceptance criteria to §7 (after AC-9, line 233)**

```
- [ ] **AC-10**: 프리셋 버튼을 누르면 `lighting.intensityScale`/`fish.countScale`/`bubbles.enabled`/`bubbles.densityScale`만 프리셋 값으로 바뀌고, `fish.detail`/`background.detail`/`fish.enabledSpecies`는 그대로 유지된다.
- [ ] **AC-11**: 세 프리셋 중 어느 것과도 정확히 일치하지 않는 조합(수동 조절 후)에서는 `matchingPresetId`가 `null`을 반환한다("사용자 설정" 표시).
- [ ] **AC-12**: 카메라 모드를 "고정"으로 선택하면 이후 60초 동안 `camera.position`이 변하지 않는다.
- [ ] **AC-13**: `performance.powerSave`가 켜진 동안 측정 fps가 `SCENE.quality.powerSave.minFps`(예: 24) 이상 `SCENE.quality.minFps`(40) 미만 범위여도 추가 다운그레이드가 발동하지 않는다.
- [ ] **AC-14**: 다운그레이드가 한 단계 이상 발동한 뒤 `SCENE.quality.recoverFps` 이상인 fps가 `recoverWindow`초 이상 지속되면 화질이 정확히 한 단계만 복구된다(연속 복구/진동 없음).
- [ ] **AC-15**: 사운드 재생 중 음량 슬라이더를 움직이면 다음 프레임 내에 실제 게인이 변화하기 시작한다(페이드 전체가 끝나길 기다리지 않음).
- [ ] **AC-16**: 무입력 상태로 숨김 지연 시간이 지나면 제목/컨트롤이 사라지고, 이후 포인터·터치·키보드 입력이 오면 즉시 다시 나타난다. 설정 패널이 열려 있는 동안에는 숨김이 발동하지 않는다.
```

- [ ] **Step 7: Add decision-log entries to §8 (after the existing last row, line 249)**

```
| 2026-09-05 (v1.2) | 분위기 프리셋은 전용 저장 필드 없이 기존 필드 값의 정확한 일치로 "현재 활성 프리셋"을 파생한다 | 새 스키마 필드·마이그레이션 없이 재방문 유지·빠른 연속 선택 수렴을 만족시키기 위함. `calm-sea` 프리셋을 `DEFAULT_SETTINGS`와 동일하게 정의해 첫 방문 화면이 이미 프리셋 하나와 일치하도록 함 |
| 2026-09-05 (v1.2) | 절전 모드는 기존 다운그레이드 임계값(`minFps: 40`)과 별도의 낮은 임계값(`powerSave.minFps`)을 사용 | 절전 모드가 의도적으로 낮춘 fps를 기존 자동 축소 로직이 "성능 장애"로 오인해 추가로 개체수를 줄이는 충돌을 막기 위함 |
| 2026-09-05 (v1.2) | 적응형 품질 다운그레이드를 한 단계씩 되돌리는 복구 경로를 추가(기존엔 한 방향으로만 축소) | 일시적으로 fps가 떨어졌다가 회복된 뒤에도 화질이 영구히 낮은 채로 남는 문제를 해결. 다운그레이드보다 긴 지속 시간(`recoverWindow` > `sampleWindow`)을 요구해 진동 방지 |
```

- [ ] **Step 8: Update §10 로드맵 (after the existing last row, line 273)**

```
| v1.2 | 분위기 프리셋 3개, 카메라 고정/절전 모드 + 화질 복구, 음량 슬라이더, UI 자동 숨김 (F8~F10) |
```

- [ ] **Step 9: Commit**

```bash
git add docs/SPEC.md
git commit -m "docs: spec Stage B — mood presets, viewing mode, power-save recovery, volume"
```

---

### Task 2: Settings schema — camera mode, power-save flag, audio volume

**Files:**
- Modify: `web/src/config.ts:217-278` (`AquariumSettings`, `SETTINGS_LIMITS`, `DEFAULT_SETTINGS`)
- Modify: `web/src/settings.ts:36-117` (`sanitizeSettings` and its helpers), `settings.ts:245-278` (new `with*` reducers, `MAX_SETTINGS`)
- Test: `web/src/settings.test.ts`

**Interfaces:**
- Produces: `withCameraMode(settings, mode: "drift" | "fixed"): AquariumSettings`, `withPowerSave(settings, powerSave: boolean): AquariumSettings`, `withVolume(settings, volume: number): AquariumSettings` (all in `settings.ts`, same shape as the existing `withXxx` reducers).
- Consumes: `SETTINGS_LIMITS`, `clampNumber` (already in `settings.ts`).

- [ ] **Step 1: Write the failing tests**

Add to `web/src/settings.test.ts` (extend the existing imports from `"./settings"` and `"./config"`):

```ts
import {
  DEFAULT_SETTINGS,
  FISH_REGISTRY,
  SETTINGS_LIMITS,
  type AquariumSettings,
} from "./config";
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
  withCameraMode,
  withCaustics,
  withFishCountScale,
  withFishDetail,
  withPowerSave,
  withSpeciesEnabled,
  withVolume,
} from "./settings";
```

```ts
describe("camera/performance/audio reducers (SPEC §6.5.2 v1.2)", () => {
  it("withCameraMode replaces only camera.mode", () => {
    const next = withCameraMode(DEFAULT_SETTINGS, "fixed");
    expect(next.camera.mode).toBe("fixed");
    expect(next.lighting).toEqual(DEFAULT_SETTINGS.lighting);
  });

  it("withPowerSave replaces only performance.powerSave", () => {
    const next = withPowerSave(DEFAULT_SETTINGS, true);
    expect(next.performance.powerSave).toBe(true);
    expect(next.fish).toEqual(DEFAULT_SETTINGS.fish);
  });

  it("withVolume clamps to SETTINGS_LIMITS.audio.volume", () => {
    expect(withVolume(DEFAULT_SETTINGS, 999).audio.volume).toBe(SETTINGS_LIMITS.audio.volume.max);
    expect(withVolume(DEFAULT_SETTINGS, -1).audio.volume).toBe(SETTINGS_LIMITS.audio.volume.min);
  });
});

describe("sanitizeSettings for camera/performance/audio (SPEC §6.5.2 v1.2)", () => {
  it("falls back to defaults for missing/invalid camera.mode, performance.powerSave, audio.volume", () => {
    const sanitized = sanitizeSettings({
      schemaVersion: 1,
      fish: { enabledSpecies: {}, detail: "medium", countScale: 1 },
      background: { detail: "medium", objectCountScale: 1 },
      lighting: { intensityScale: 1, caustics: true },
      bubbles: { enabled: true, densityScale: 1 },
      camera: { mode: "not-a-mode" },
      performance: { powerSave: "yes" },
      audio: { volume: -5 },
    });
    expect(sanitized?.camera.mode).toBe(DEFAULT_SETTINGS.camera.mode);
    expect(sanitized?.performance.powerSave).toBe(DEFAULT_SETTINGS.performance.powerSave);
    expect(sanitized?.audio.volume).toBe(SETTINGS_LIMITS.audio.volume.min);
  });

  it("round-trips valid camera/performance/audio values", () => {
    const sanitized = sanitizeSettings({
      schemaVersion: 1,
      fish: { enabledSpecies: {}, detail: "medium", countScale: 1 },
      background: { detail: "medium", objectCountScale: 1 },
      lighting: { intensityScale: 1, caustics: true },
      bubbles: { enabled: true, densityScale: 1 },
      camera: { mode: "fixed" },
      performance: { powerSave: true },
      audio: { volume: 0.5 },
    });
    expect(sanitized?.camera.mode).toBe("fixed");
    expect(sanitized?.performance.powerSave).toBe(true);
    expect(sanitized?.audio.volume).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/settings.test.ts`
Expected: FAIL — `withCameraMode`/`withPowerSave`/`withVolume` not exported; `sanitizeSettings` doesn't yet read `camera`/`performance`/`audio`; `AquariumSettings`/`DEFAULT_SETTINGS`/`MAX_SETTINGS` don't yet have these fields (TypeScript errors on the test file's object literals).

- [ ] **Step 3: Implement — `config.ts`**

In the `AquariumSettings` interface (`config.ts:218-242`), after the `bubbles` field (before the closing `}` on line 242), add:

```ts
  readonly camera: {
    readonly mode: "drift" | "fixed";
  };
  readonly performance: {
    readonly powerSave: boolean;
  };
  readonly audio: {
    readonly volume: number;
  };
```

In `SETTINGS_LIMITS` (`config.ts:245-250`), add a new top-level key:

```ts
export const SETTINGS_LIMITS = {
  fish: { countScale: { min: 0.25, max: 1.5 } },
  background: { objectCountScale: { min: 0.5, max: 2.0 } },
  lighting: { intensityScale: { min: 0.4, max: 1.6 } },
  bubbles: { densityScale: { min: 0, max: 2.0 } },
  audio: { volume: { min: 0, max: 1 } },
} as const;
```

In `DEFAULT_SETTINGS` (`config.ts:257-267`), add after `bubbles`:

```ts
  camera: { mode: "drift" },
  performance: { powerSave: false },
  audio: { volume: 0.16 },
```

- [ ] **Step 4: Implement — `settings.ts` sanitization**

Add a small type guard next to `isDetailLevel` (`settings.ts:36-38`):

```ts
function isCameraMode(value: unknown): value is "drift" | "fixed" {
  return value === "drift" || value === "fixed";
}
```

In `sanitizeSettings` (`settings.ts:64-117`), after `const bubbles = asRecord(value.bubbles);` (line 75), add:

```ts
  const camera = asRecord(value.camera);
  const performance = asRecord(value.performance);
  const audio = asRecord(value.audio);
```

In the returned object, after the `bubbles` field (before the closing `};` on line 117), add:

```ts
    camera: {
      mode: isCameraMode(camera.mode) ? camera.mode : DEFAULT_SETTINGS.camera.mode,
    },
    performance: {
      powerSave:
        typeof performance.powerSave === "boolean"
          ? performance.powerSave
          : DEFAULT_SETTINGS.performance.powerSave,
    },
    audio: {
      volume: clampNumber(
        audio.volume,
        SETTINGS_LIMITS.audio.volume.min,
        SETTINGS_LIMITS.audio.volume.max,
        DEFAULT_SETTINGS.audio.volume,
      ),
    },
```

- [ ] **Step 5: Implement — new reducers in `settings.ts`**

After `withBubblesDensityScale` (currently `settings.ts:249-265`), add:

```ts
export function withCameraMode(
  settings: AquariumSettings,
  mode: AquariumSettings["camera"]["mode"],
): AquariumSettings {
  return { ...settings, camera: { ...settings.camera, mode } };
}

export function withPowerSave(settings: AquariumSettings, powerSave: boolean): AquariumSettings {
  return { ...settings, performance: { ...settings.performance, powerSave } };
}

export function withVolume(settings: AquariumSettings, volume: number): AquariumSettings {
  return {
    ...settings,
    audio: {
      ...settings.audio,
      volume: clampNumber(volume, SETTINGS_LIMITS.audio.volume.min, SETTINGS_LIMITS.audio.volume.max, settings.audio.volume),
    },
  };
}
```

- [ ] **Step 6: Update `MAX_SETTINGS` so it still satisfies the (now larger) `AquariumSettings` type**

In `settings.ts:268-278`, add after the `bubbles` field (these three fields don't affect triangle count, so any valid value is fine — pick the "heaviest to reason about" ones for clarity):

```ts
  camera: { mode: "drift" },
  performance: { powerSave: false },
  audio: { volume: SETTINGS_LIMITS.audio.volume.max },
```

- [ ] **Step 7: Run tests to verify they pass, then full check**

Run: `npx vitest run src/settings.test.ts`, then `npm run test && npm run build`.
Expected: all green; `tsc --noEmit` clean (every existing `AquariumSettings` literal in the codebase — `DEFAULT_SETTINGS`, `MAX_SETTINGS`, test fixtures — now includes the three new fields).

- [ ] **Step 8: Commit**

```bash
git add web/src/config.ts web/src/settings.ts web/src/settings.test.ts
git commit -m "feat: add camera mode, power-save, and volume to the settings schema"
```

---

### Task 3: Mood presets — data and pure reducers

**Files:**
- Modify: `web/src/config.ts` (add `PresetId`, `MoodPreset`, `MOOD_PRESETS` after `DEFAULT_SETTINGS`, i.e. after line 267 pre-Task-2 / adjust for Task 2's insertions)
- Modify: `web/src/settings.ts` (add `withPreset`, `matchingPresetId` after the Task 2 reducers)
- Test: `web/src/settings.test.ts`

**Interfaces:**
- Consumes: `AquariumSettings`, `SETTINGS_LIMITS` are unaffected; presets only ever set values already inside their valid ranges (checked in Step 3).
- Produces: `PresetId = "clear-reef" | "calm-sea" | "soft-evening"`, `MOOD_PRESETS: Record<PresetId, MoodPreset>` (`config.ts`); `withPreset(settings, presetId: PresetId): AquariumSettings`, `matchingPresetId(settings): PresetId | null` (`settings.ts`).

- [ ] **Step 1: Write the failing tests**

Add to `web/src/settings.test.ts`, extending the `"./settings"` import with `matchingPresetId, withPreset` and the `"./config"` import with `MOOD_PRESETS, type PresetId`:

```ts
describe("withPreset / matchingPresetId (SPEC §6.6)", () => {
  it("withPreset sets lighting/fish-count/bubbles from the preset and leaves detail/species untouched", () => {
    const next = withPreset(DEFAULT_SETTINGS, "soft-evening");
    const preset = MOOD_PRESETS["soft-evening"];
    expect(next.lighting.intensityScale).toBe(preset.lightingIntensityScale);
    expect(next.fish.countScale).toBe(preset.fishCountScale);
    expect(next.bubbles.enabled).toBe(preset.bubblesEnabled);
    expect(next.bubbles.densityScale).toBe(preset.bubblesDensityScale);
    expect(next.fish.detail).toBe(DEFAULT_SETTINGS.fish.detail);
    expect(next.background).toEqual(DEFAULT_SETTINGS.background);
    expect(next.fish.enabledSpecies).toEqual(DEFAULT_SETTINGS.fish.enabledSpecies);
  });

  it("every preset's numeric values stay inside SETTINGS_LIMITS", () => {
    for (const id of Object.keys(MOOD_PRESETS) as PresetId[]) {
      const preset = MOOD_PRESETS[id];
      expect(preset.lightingIntensityScale).toBeGreaterThanOrEqual(SETTINGS_LIMITS.lighting.intensityScale.min);
      expect(preset.lightingIntensityScale).toBeLessThanOrEqual(SETTINGS_LIMITS.lighting.intensityScale.max);
      expect(preset.fishCountScale).toBeGreaterThanOrEqual(SETTINGS_LIMITS.fish.countScale.min);
      expect(preset.fishCountScale).toBeLessThanOrEqual(SETTINGS_LIMITS.fish.countScale.max);
      expect(preset.bubblesDensityScale).toBeGreaterThanOrEqual(SETTINGS_LIMITS.bubbles.densityScale.min);
      expect(preset.bubblesDensityScale).toBeLessThanOrEqual(SETTINGS_LIMITS.bubbles.densityScale.max);
    }
  });

  it("matchingPresetId finds calm-sea for DEFAULT_SETTINGS (unmodified first visit)", () => {
    expect(matchingPresetId(DEFAULT_SETTINGS)).toBe("calm-sea");
  });

  it("matchingPresetId returns the applied preset right after withPreset", () => {
    expect(matchingPresetId(withPreset(DEFAULT_SETTINGS, "clear-reef"))).toBe("clear-reef");
  });

  it("matchingPresetId returns null after a manual tweak breaks the match", () => {
    const custom = withLightingIntensityScale(withPreset(DEFAULT_SETTINGS, "clear-reef"), 0.5);
    expect(matchingPresetId(custom)).toBeNull();
  });

  it("rapid successive preset picks converge to the last one applied (AC-10-style)", () => {
    const sequence: PresetId[] = ["clear-reef", "soft-evening", "calm-sea"];
    const final = sequence.reduce((acc: AquariumSettings, id) => withPreset(acc, id), DEFAULT_SETTINGS);
    expect(matchingPresetId(final)).toBe("calm-sea");
  });
});
```

(`withLightingIntensityScale` is already imported per the existing test file.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/settings.test.ts`
Expected: FAIL — `MOOD_PRESETS`/`PresetId`/`withPreset`/`matchingPresetId` don't exist yet.

- [ ] **Step 3: Implement — `config.ts`**

After `DEFAULT_SETTINGS`, add:

```ts
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
```

- [ ] **Step 4: Implement — `settings.ts`**

After the Task 2 reducers (`withCameraMode`/`withPowerSave`/`withVolume`), add:

```ts
export function withPreset(settings: AquariumSettings, presetId: PresetId): AquariumSettings {
  const preset = MOOD_PRESETS[presetId];
  return {
    ...settings,
    lighting: { ...settings.lighting, intensityScale: preset.lightingIntensityScale },
    fish: { ...settings.fish, countScale: preset.fishCountScale },
    bubbles: {
      ...settings.bubbles,
      enabled: preset.bubblesEnabled,
      densityScale: preset.bubblesDensityScale,
    },
  };
}

/** Which mood preset (if any) the current settings exactly match — a derived UI hint, never persisted (SPEC §6.6). */
export function matchingPresetId(settings: AquariumSettings): PresetId | null {
  for (const id of Object.keys(MOOD_PRESETS) as PresetId[]) {
    const preset = MOOD_PRESETS[id];
    if (
      settings.lighting.intensityScale === preset.lightingIntensityScale &&
      settings.fish.countScale === preset.fishCountScale &&
      settings.bubbles.enabled === preset.bubblesEnabled &&
      settings.bubbles.densityScale === preset.bubblesDensityScale
    ) {
      return id;
    }
  }
  return null;
}
```

Add `MOOD_PRESETS` and `type PresetId` to `settings.ts`'s existing import from `"./config"`.

- [ ] **Step 5: Run tests to verify they pass, then full check**

Run: `npx vitest run src/settings.test.ts`, then `npm run test && npm run build`.

- [ ] **Step 6: Commit**

```bash
git add web/src/config.ts web/src/settings.ts web/src/settings.test.ts
git commit -m "feat: add the three mood presets and derived preset-matching"
```

---

### Task 4: Adaptive-quality recovery and power-save scaling (pure helpers)

**Files:**
- Modify: `web/src/config.ts:293-303` (`SCENE.quality`)
- Create: `web/src/config.test.ts`

**Interfaces:**
- Produces: `computeQualityScales(downgradeStep: 0 | 1 | 2, powerSave: boolean): { resolutionScale: number; populationScale: number }`, `effectiveMinFps(powerSave: boolean): number` (both `config.ts`).
- Consumed by: Task 6 (`main.ts`'s frame loop).

- [ ] **Step 1: Write the failing tests**

Create `web/src/config.test.ts`:

```ts
/**
 * Adaptive-quality step/power-save pure logic (SPEC §6.7.2, N2, AC-13/AC-14).
 * The FPS sampling and timing that *drives* these functions lives in
 * `main.ts` and is verified visually (SPEC §9) — only the step→scale mapping
 * itself is unit-tested here.
 */
import { describe, expect, it } from "vitest";

import { SCENE, computeQualityScales, effectiveMinFps } from "./config";

describe("computeQualityScales", () => {
  it("is full quality at step 0 without power save", () => {
    expect(computeQualityScales(0, false)).toEqual({ resolutionScale: 1, populationScale: 1 });
  });

  it("drops only resolution at step 1", () => {
    expect(computeQualityScales(1, false)).toEqual({
      resolutionScale: SCENE.quality.resolutionScale,
      populationScale: 1,
    });
  });

  it("drops resolution and population at step 2", () => {
    expect(computeQualityScales(2, false)).toEqual({
      resolutionScale: SCENE.quality.resolutionScale,
      populationScale: SCENE.quality.populationScale,
    });
  });

  it("clamps resolution to the power-save ceiling even at step 0", () => {
    expect(computeQualityScales(0, true).resolutionScale).toBe(SCENE.quality.powerSave.resolutionScale);
  });

  it("keeps the lower of the two resolution scales when both a downgrade step and power save apply", () => {
    expect(computeQualityScales(1, true).resolutionScale).toBe(
      Math.min(SCENE.quality.resolutionScale, SCENE.quality.powerSave.resolutionScale),
    );
  });
});

describe("effectiveMinFps", () => {
  it("uses the normal threshold outside power save", () => {
    expect(effectiveMinFps(false)).toBe(SCENE.quality.minFps);
  });

  it("uses a lower, dedicated threshold in power save so an intentional low fps isn't mistaken for a fault (AC-13)", () => {
    expect(effectiveMinFps(true)).toBe(SCENE.quality.powerSave.minFps);
    expect(effectiveMinFps(true)).toBeLessThan(SCENE.quality.minFps);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/config.test.ts`
Expected: FAIL — `computeQualityScales`/`effectiveMinFps`/`SCENE.quality.powerSave`/`SCENE.quality.recoverFps` don't exist yet.

- [ ] **Step 3: Implement**

Replace `SCENE.quality` (`config.ts:293-302`):

```ts
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
```

After the `SCENE` constant, add:

```ts
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
```

- [ ] **Step 4: Run to verify it passes, then full check**

Run: `npx vitest run src/config.test.ts`, then `npm run test && npm run build`.

- [ ] **Step 5: Commit**

```bash
git add web/src/config.ts web/src/config.test.ts
git commit -m "feat: add adaptive-quality recovery and power-save scale/threshold helpers"
```

---

### Task 5: Ambient audio volume control

**Files:**
- Modify: `web/src/ui.ts` (the `AmbientAudio` class and `createUi`)

**Interfaces:**
- Produces: `AmbientAudio.setVolume(volume: number): void` (public); `AquariumUi.setVolume(volume: number): void`; `CreateUiOptions.initialVolume?: number`.
- Consumed by: Task 6 (`main.ts` passes `settings.audio.volume` in and calls `ui.setVolume(...)` on change).

This task assumes Stage A Task 5 has landed, so `AmbientAudio` already has a `stopTimer` field and the fade-then-suspend `stop()`. Not unit-tested (`ui.ts` is excluded per CLAUDE.md) — verify by ear in the preview build.

- [ ] **Step 1: Implement**

Add a field next to the others in the class body:

```ts
  private targetVolume = 0.16;
```

Add a public method (anywhere in the class, e.g. right after the `isPlaying` getter):

```ts
  /** Live volume control (SPEC §6.7.3): re-targets the current fade-in level if already playing, and becomes the ramp target for the next `start()` either way. */
  setVolume(volume: number): void {
    this.targetVolume = volume;
    if (!this.playing || this.context === null || this.gain === null) return;
    const now = this.context.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(volume, now + 0.2);
  }
```

In `start()`, replace the hardcoded ramp target:

```ts
    gain.gain.linearRampToValueAtTime(0.16, now + 2.5);
```

with:

```ts
    gain.gain.linearRampToValueAtTime(this.targetVolume, now + 2.5);
```

Extend `AquariumUi` and `CreateUiOptions`:

```ts
export interface AquariumUi {
  finishLoading(): void;
  /** Update the ambient sound's target volume (SPEC §6.7.3). */
  setVolume(volume: number): void;
  dispose(): void;
}

export interface CreateUiOptions {
  readonly settingsPanel?: HTMLElement;
  /** Initial ambient-sound target volume, 0~1 (SPEC §6.7.3). Defaults to `AmbientAudio`'s own 0.16 if omitted. */
  readonly initialVolume?: number;
}
```

In `createUi`, right after `const audio = new AmbientAudio();`, add:

```ts
  if (options.initialVolume !== undefined) audio.setVolume(options.initialVolume);
```

In the returned object, add the new method alongside `finishLoading`/`dispose`:

```ts
    setVolume(volume: number): void {
      audio.setVolume(volume);
    },
```

- [ ] **Step 2: Verify**

`npm run build && npm run preview`. This method isn't wired to any UI control yet (Task 8 adds the slider) — for now, confirm nothing regressed: `npx vitest run` still green (no test touches `ui.ts`), sound toggle still works exactly as before with the same default loudness.

- [ ] **Step 3: Commit**

```bash
git add web/src/ui.ts
git commit -m "feat: add AmbientAudio.setVolume for the upcoming volume slider"
```

---

### Task 6: `main.ts` wiring — camera mode, quality-step machine, power-save, volume

**Files:**
- Modify: `web/src/main.ts` (post-Stage-A shape: camera/target setup, `frame()`, the adaptive-quality variables, the `onChange` handler, `createUi(...)` call)

**Interfaces:**
- Consumes: `computeQualityScales`, `effectiveMinFps` (Task 4), `AmbientAudio`/`AquariumUi.setVolume` (Task 5), `settings.camera.mode` / `settings.performance.powerSave` / `settings.audio.volume` (Task 2).

Not unit-tested (`main.ts` render loop excluded per SPEC §9/CLAUDE.md) — verify via `npm run build && npm run preview`. This task assumes the post-Stage-A `main.ts` shape (see this plan's Global Constraints); each snippet below is quoted in full so it's locatable even if line numbers have shifted.

- [ ] **Step 1: Camera mode — replace the boot-time reduced-motion block**

Find (post-Stage-A):

```ts
  const prefersReducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (prefersReducedMotion) {
    camera.position.set(0, SCENE.camera.height, SCENE.camera.radius);
    camera.lookAt(target);
  }
```

Replace with:

```ts
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
```

- [ ] **Step 2: Camera mode — update the `frame()` drift branch**

Find (post-Stage-A):

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

Replace the condition (body unchanged):

```ts
    if (cameraMode === "drift") {
```

- [ ] **Step 3: Quality-step machine — replace the one-directional `downgrade()`**

Find:

```ts
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
```

Replace with:

```ts
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
```

Add the import at the top of the file (extend the existing `"./config"` import):

```ts
import { FISH_REGISTRY, SCENE, computeQualityScales, effectiveMinFps, type AquariumSettings } from "./config";
```

- [ ] **Step 4: Quality-step machine — update the sampling block in `frame()`**

Find:

```ts
    sampleTime += rawDt;
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
```

Replace with:

```ts
    sampleTime += rawDt;
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
```

- [ ] **Step 5: Wire `camera.mode` / `performance.powerSave` / `audio.volume` into the `onChange` handler**

Inside the existing `settingsPanel = createSettingsPanel(FISH_REGISTRY, settings, { onChange(next) { ... } })` body, after the existing `bubbles` diff checks, add:

```ts
      if (prev.camera.mode !== next.camera.mode) {
        cameraMode = next.camera.mode;
        if (cameraMode === "fixed") applyFixedCameraPose();
      }
      if (prev.performance.powerSave !== next.performance.powerSave) applyQualityStep();
      if (prev.audio.volume !== next.audio.volume) ui.setVolume(next.audio.volume);
```

(`ui` is declared just below the `settingsPanel` object in the existing code — since `onChange` only runs after `ui` exists, referencing it here is fine; if your editor flags a use-before-declaration in the temporal-dead-zone sense, move the `createUi(...)` call above `createSettingsPanel(...)`, keeping `ui.dispose()`/`settingsPanel.dispose()` call order in `pagehide` unchanged.)

- [ ] **Step 6: Pass the initial volume into `createUi`**

Find:

```ts
  const ui = createUi(overlay, { settingsPanel: settingsPanel.element });
```

Replace with:

```ts
  const ui = createUi(overlay, { settingsPanel: settingsPanel.element, initialVolume: settings.audio.volume });
```

- [ ] **Step 7: Verify**

`npm run build && npm run preview`.
- Camera: with no settings changed, confirm drift is unchanged; this task adds no UI yet (Task 8 does) — temporarily call `withCameraMode`/`withPowerSave` from the browser console via a quick manual settings-object edit, or wait for Task 8, to exercise the branch. At minimum confirm `npm run build`'s `tsc --noEmit` passes and the app boots with no console errors.
- Quality step: throttle the CPU (DevTools → Performance → 6x slowdown) long enough to trigger a downgrade (watch `window.__aq` triangle count drop), then remove throttling and wait past `recoverWindow` (8s) of good fps — confirm quality steps back up (triangle count returns) without oscillating.

- [ ] **Step 8: Commit**

```bash
git add web/src/main.ts
git commit -m "feat: wire camera mode, adaptive-quality recovery, power-save, and volume into the render loop"
```

---

### Task 7: Settings panel UI — mood preset section and reset button

**Files:**
- Modify: `web/src/settingsPanel.ts` (new section at the top of the panel body)

**Interfaces:**
- Consumes: `MOOD_PRESETS`, `matchingPresetId`, `withPreset` (Tasks 2-3), `DEFAULT_SETTINGS` (`config.ts`).

Not unit-tested (`settingsPanel.ts` is explicitly excluded per its own header comment — "verified visually instead"). Verify via `npm run build && npm run preview`.

- [ ] **Step 1: Implement**

Add to the imports at the top of `settingsPanel.ts`:

```ts
import { DEFAULT_SETTINGS, MOOD_PRESETS, type PresetId } from "./config";
import {
  matchingPresetId,
  withBackgroundDetail,
  withBackgroundObjectCountScale,
  withBubblesDensityScale,
  withBubblesEnabled,
  withCaustics,
  withFishCountScale,
  withFishDetail,
  withLightingIntensityScale,
  withPreset,
  withSpeciesEnabled,
} from "./settings";
```

Add a small builder function near the other DOM builder helpers (`section`, `sliderRow`, etc.):

```ts
function presetButtonRow(
  current: AquariumSettings,
  onPick: (presetId: PresetId) => void,
  onReset: () => void,
  cleanups: (() => void)[],
): HTMLElement {
  const row = document.createElement("div");
  row.className = "settings-panel__presets";
  const active = matchingPresetId(current);

  for (const id of Object.keys(MOOD_PRESETS) as PresetId[]) {
    const preset = MOOD_PRESETS[id];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "settings-panel__preset";
    button.textContent = preset.label;
    button.setAttribute("aria-pressed", active === id ? "true" : "false");
    const onClick = (): void => onPick(id);
    button.addEventListener("click", onClick);
    cleanups.push(() => button.removeEventListener("click", onClick));
    row.append(button);
  }

  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "settings-panel__preset settings-panel__preset--reset";
  reset.textContent = "기본값으로 되돌리기";
  const onResetClick = (): void => onReset();
  reset.addEventListener("click", onResetClick);
  cleanups.push(() => reset.removeEventListener("click", onResetClick));
  row.append(reset);

  return row;
}
```

In `createSettingsPanel`, right after `const emit = (next: AquariumSettings): void => { ... };` and before the existing `// 물고기 종류` section, add:

```ts
  // 분위기 프리셋 -------------------------------------------------------------
  const mood = section("분위기");
  mood.body.append(
    presetButtonRow(
      current,
      (presetId) => emit(withPreset(current, presetId)),
      () => emit(DEFAULT_SETTINGS),
      cleanups,
    ),
  );
```

and add `mood.section` to the final `panel.append(...)` call, first in the list:

```ts
  panel.append(
    mood.section,
    species.section,
    fishDetail.section,
    fishCount.section,
    backgroundDetail.section,
    backgroundCount.section,
    lighting.section,
    bubbles.section,
  );
```

Note the preset buttons' `aria-pressed` is computed once at panel-build time from `current` — since every `emit(...)` call in this file already replaces the whole panel content only via reducers that don't re-render the DOM (`ui.ts`/`main.ts` never rebuild the settings panel itself), this matches the existing pattern where e.g. slider readouts update their own text on `input` but don't re-derive other rows' state. If a future task wants the preset buttons' pressed-state to live-update as the user adjusts other sliders, that's a `settingsPanel.ts` rendering change out of this task's scope — for now, the panel reflects the active preset accurately at open-time and after a preset click reopens correctly next session (state still persists correctly either way, since `matchingPresetId` is derived fresh from persisted settings on every reload).

- [ ] **Step 2: Add matching CSS**

In `web/src/style.css`, after the existing `.settings-panel__radios` rule (`style.css:222-226`), add:

```css
.settings-panel__presets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.settings-panel__preset {
  font: inherit;
  color: inherit;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 999px;
  padding: 0.35rem 0.9rem;
  cursor: pointer;
}

.settings-panel__preset[aria-pressed="true"] {
  background: rgba(255, 255, 255, 0.22);
  border-color: rgba(255, 255, 255, 0.4);
}

.settings-panel__preset--reset {
  opacity: 0.75;
}
```

- [ ] **Step 3: Verify**

`npm run build && npm run preview`. Open the settings panel: confirm "고요한 바다" shows pressed on first load (matches `DEFAULT_SETTINGS`). Click "맑은 산호초": confirm lighting/fish-count/bubbles change immediately, fish/background detail and species checkboxes stay untouched, and reopening the settings panel later (after a reload) shows "맑은 산호초" pressed again (persisted). Click rapidly through all three presets: confirm the scene ends at the last one clicked with no stuck intermediate state. Click "기본값으로 되돌리기": confirm the whole panel's settings return to `DEFAULT_SETTINGS` (reopen panel to see it reflected).

- [ ] **Step 4: Commit**

```bash
git add web/src/settingsPanel.ts web/src/style.css
git commit -m "feat: add mood preset buttons and a reset-to-default action to the settings panel"
```

---

### Task 8: Settings panel UI — camera mode, power-save, volume slider

**Files:**
- Modify: `web/src/settingsPanel.ts` (generalize the radio-group helper; add "카메라", "성능", "사운드" sections)

**Interfaces:**
- Produces (internal refactor): `radioGroup<T extends string>(name, options, current, onSelect, cleanups)`, with `detailRadioGroup` becoming a thin wrapper around it.
- Consumes: `withCameraMode`, `withPowerSave`, `withVolume` (Task 2).

Not unit-tested (same `settingsPanel.ts` exclusion). Verify via preview, including a keyboard-only pass.

- [ ] **Step 1: Generalize the radio-group helper**

Replace `detailRadioGroup` (currently `settingsPanel.ts:43-76`):

```ts
function detailRadioGroup(
  name: string,
  current: DetailLevel,
  onSelect: (detail: DetailLevel) => void,
  cleanups: (() => void)[],
): HTMLElement {
  const group = document.createElement("div");
  group.className = "settings-panel__radios";
  const options: { value: DetailLevel; label: string }[] = [
    { value: "low", label: "낮음" },
    { value: "medium", label: "보통" },
    { value: "high", label: "높음" },
  ];
  for (const option of options) {
    const id = `${name}-${option.value}`;
    const label = document.createElement("label");
    label.className = "settings-panel__radio";
    label.htmlFor = id;
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.id = id;
    input.value = option.value;
    input.checked = current === option.value;
    const onChange = (): void => onSelect(option.value);
    input.addEventListener("change", onChange);
    cleanups.push(() => input.removeEventListener("change", onChange));
    const text = document.createElement("span");
    text.textContent = option.label;
    label.append(input, text);
    group.append(label);
  }
  return group;
}
```

with:

```ts
function radioGroup<T extends string>(
  name: string,
  options: readonly { value: T; label: string }[],
  current: T,
  onSelect: (value: T) => void,
  cleanups: (() => void)[],
): HTMLElement {
  const group = document.createElement("div");
  group.className = "settings-panel__radios";
  for (const option of options) {
    const id = `${name}-${option.value}`;
    const label = document.createElement("label");
    label.className = "settings-panel__radio";
    label.htmlFor = id;
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.id = id;
    input.value = option.value;
    input.checked = current === option.value;
    const onChange = (): void => onSelect(option.value);
    input.addEventListener("change", onChange);
    cleanups.push(() => input.removeEventListener("change", onChange));
    const text = document.createElement("span");
    text.textContent = option.label;
    label.append(input, text);
    group.append(label);
  }
  return group;
}

const DETAIL_OPTIONS: readonly { value: DetailLevel; label: string }[] = [
  { value: "low", label: "낮음" },
  { value: "medium", label: "보통" },
  { value: "high", label: "높음" },
];

function detailRadioGroup(
  name: string,
  current: DetailLevel,
  onSelect: (detail: DetailLevel) => void,
  cleanups: (() => void)[],
): HTMLElement {
  return radioGroup(name, DETAIL_OPTIONS, current, onSelect, cleanups);
}

const CAMERA_MODE_OPTIONS: readonly { value: "drift" | "fixed"; label: string }[] = [
  { value: "drift", label: "천천히 이동" },
  { value: "fixed", label: "고정" },
];
```

(The two existing call sites, `detailRadioGroup("fish-detail", ...)` and `detailRadioGroup("background-detail", ...)`, need no changes — same signature.)

- [ ] **Step 2: Add imports**

Extend `settingsPanel.ts`'s import from `"./settings"` with `withCameraMode, withPowerSave, withVolume`.

- [ ] **Step 3: Add the "카메라"/"성능"/"사운드" sections**

In `createSettingsPanel`, after the `물방울` section (the last section before `panel.append(...)`), add:

```ts
  // 카메라 --------------------------------------------------------------------
  const camera = section("카메라");
  camera.body.append(
    radioGroup(
      "camera-mode",
      CAMERA_MODE_OPTIONS,
      current.camera.mode,
      (mode) => emit(withCameraMode(current, mode)),
      cleanups,
    ),
  );

  // 성능 ----------------------------------------------------------------------
  const performance = section("성능");
  performance.body.append(
    checkboxRow(
      "절전 모드 (낮은 해상도 + 30fps대 목표)",
      "performance-power-save",
      current.performance.powerSave,
      (checked) => emit(withPowerSave(current, checked)),
      cleanups,
    ),
  );

  // 사운드 ----------------------------------------------------------------------
  const audio = section("사운드");
  audio.body.append(
    sliderRow(
      "음량",
      "audio-volume",
      0,
      1,
      0.01,
      current.audio.volume,
      (v) => `${Math.round(v * 100)}%`,
      (v) => emit(withVolume(current, v)),
      cleanups,
    ),
  );
```

Update `panel.append(...)` to include the three new sections (after `bubbles.section`):

```ts
  panel.append(
    mood.section,
    species.section,
    fishDetail.section,
    fishCount.section,
    backgroundDetail.section,
    backgroundCount.section,
    lighting.section,
    bubbles.section,
    camera.section,
    performance.section,
    audio.section,
  );
```

- [ ] **Step 4: Verify**

`npm run build && npm run preview`.
- Mouse: toggle camera mode to "고정", confirm the camera stops moving immediately (no need to wait for the drift angle to cross zero). Toggle "절전 모드" on, confirm resolution visibly drops (check `window.__aq`/visual sharpness) right away. Drag the 음량 slider while sound is playing, confirm the loudness changes within a moment (not waiting for a fade cycle).
- Keyboard only: `Tab` to the settings gear button, `Enter`/`Space` to open the panel, `Tab` through to the camera-mode radios, use arrow keys to switch between "천천히 이동"/"고정", `Tab` to the gear button again, `Enter`/`Space` to close. Confirm every step works without a mouse.
- Mobile emulation (DevTools device toolbar, touch input): confirm all new controls (preset buttons, radios, checkbox, slider) are reachable and operable by tap/touch, matching the existing controls' behavior.

- [ ] **Step 5: Commit**

```bash
git add web/src/settingsPanel.ts
git commit -m "feat: add camera mode, power-save, and volume controls to the settings panel"
```

---

### Task 9: UI auto-hide for uninterrupted long-duration viewing

**Files:**
- Modify: `web/src/ui.ts` (`createUi`)
- Modify: `web/src/style.css` (after the existing `@media (prefers-reduced-motion: reduce)` block, `style.css:272-276`)

**Interfaces:** none new exported — internal behavior of `createUi`'s returned `dispose()` grows to remove the new listeners/timer, and `finishLoading`/the panel-toggle handler each need to poke the idle timer.

Not unit-tested (`ui.ts` exclusion). Verify via preview, watching a clock.

- [ ] **Step 1: Implement — `ui.ts`**

Inside `createUi`, after the `settingsButton`/`onSettingsToggle` block and before the final `root.append(loader, title, controls);`, add:

```ts
  const IDLE_HIDE_MS = 6000;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleIdleHide = (): void => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      if (settingsPanel?.classList.contains("is-open")) {
        scheduleIdleHide(); // panel's still open — check again later instead of hiding under it
        return;
      }
      root.classList.add("is-idle");
    }, IDLE_HIDE_MS);
  };

  const onActivity = (): void => {
    root.classList.remove("is-idle");
    scheduleIdleHide();
  };

  const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "touchstart", "keydown"] as const;
  for (const type of ACTIVITY_EVENTS) window.addEventListener(type, onActivity, { passive: true });
  scheduleIdleHide();
```

If the settings-toggle button exists, restart the idle countdown with a full fresh window whenever the panel closes — extend the existing `onSettingsToggle` (don't duplicate the block, just add one line at the end of the existing function body):

```ts
    onSettingsToggle = (): void => {
      const open = settingsPanel.classList.toggle("is-open");
      settingsButton?.setAttribute("aria-expanded", open ? "true" : "false");
      settingsButton?.setAttribute("aria-label", open ? "설정 닫기" : "설정 열기");
      onActivity();
    };
```

(`onActivity` is declared above this point in the function, so hoist the idle-timer block — Step 1's code — above the existing `settingsButton`/`onSettingsToggle` declaration, or declare `onActivity` before it and only wire the event listeners afterward; either ordering works as long as `onActivity` exists before `onSettingsToggle` references it.)

Update `dispose()`:

```ts
    dispose(): void {
      if (idleTimer !== null) clearTimeout(idleTimer);
      for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, onActivity);
      soundButton.removeEventListener("click", onToggle);
      if (settingsButton !== null && onSettingsToggle !== null) {
        settingsButton.removeEventListener("click", onSettingsToggle);
      }
      audio.dispose();
      root.textContent = "";
    },
```

- [ ] **Step 2: Implement — `style.css`**

After the `@media (prefers-reduced-motion: reduce)` block (`style.css:272-276`), add:

```css
/* Idle fade: hide title/controls after inactivity for uninterrupted viewing (SPEC §6.8). */
.overlay.is-idle .title,
.overlay.is-idle .controls {
  opacity: 0;
  transition: opacity 1.2s var(--aq-ease);
}

.overlay.is-idle .controls,
.overlay.is-idle .controls * {
  pointer-events: none;
}
```

- [ ] **Step 3: Verify**

`npm run build && npm run preview`. Leave the page untouched for a bit over 6 seconds: confirm the title and the sound/settings buttons fade out (the canvas keeps animating normally). Move the mouse, tap the screen, or press a key: confirm they reappear immediately. Open the settings panel and leave it open past 6 seconds: confirm the UI does NOT hide while it's open; close it and confirm the idle countdown restarts fresh from that moment.

- [ ] **Step 4: Commit**

```bash
git add web/src/ui.ts web/src/style.css
git commit -m "feat: auto-hide the overlay UI after inactivity, reveal on any input"
```

---

### Task 10: Manual QA pass and SPEC acceptance-criteria sign-off

**Files:**
- Modify: `docs/SPEC.md` (§7, the Stage B AC checkboxes added in Task 1)

**Interfaces:** none (documentation + manual verification only).

Stage B's UI-level acceptance criteria (AC-10 through AC-16) are, by this project's own test-strategy convention, not automatable (they live in `settingsPanel.ts`/`ui.ts`/`main.ts`) — this task is the "actually go look" step the proposal's own §9 checklist calls for ("모바일·키보드·오디오·장시간 감상을 확인한다").

- [ ] **Step 1: Run the full automated suite once more**

Run: `npm run test && npm run build`
Expected: green — confirms Tasks 2-4's unit tests (AC-10, AC-11, AC-13, AC-14 groundwork) still pass after all the UI wiring in Tasks 5-9.

- [ ] **Step 2: Walk every Stage B acceptance criterion by hand**

`npm run preview`, and for each of AC-10 through AC-16 (as written in `docs/SPEC.md` §7 after Task 1), perform the exact check the AC describes (most of these repeat a verification already done in Tasks 3, 6, 7, 8, 9 above — this step is about doing them all in one continuous pass, on both desktop and a mobile emulation/real device, to catch interaction effects between features that isolated per-task testing wouldn't surface — e.g. does opening the settings panel to change camera mode also interact correctly with the idle-hide timer from Task 9?).

Additionally, per the proposal's own §7 method, run a plain long-duration check: leave the tab open and visible for 15 minutes on a laptop and a phone, watching for heat/fan noise/unexpected motion complaints (§7 "오래 켜두기 편한가?").

- [ ] **Step 3: Tick the confirmed AC checkboxes in `docs/SPEC.md`**

For every AC-10 through AC-16 that Step 2 confirmed, change its `- [ ]` to `- [x]` in `docs/SPEC.md` §7. If any fails, do not check it — fix the underlying task first (reopen that task's commit with a follow-up fix), then re-verify before checking the box. Do not check a box you didn't personally verify in Step 2.

- [ ] **Step 4: Commit**

```bash
git add docs/SPEC.md
git commit -m "docs: confirm Stage B acceptance criteria after end-to-end manual QA"
```

---

## Self-Review Notes

- **Spec coverage**: §4.1 (presets) → Tasks 1, 3, 7. §4.2 camera → Tasks 1, 2, 6, 8. §4.2 power-save/recovery → Tasks 1, 4, 6, 8. §4.2 UI auto-hide → Tasks 1, 9. §5 volume → Tasks 1, 2, 5, 6, 8. Every acceptance criterion added in Task 1 (AC-10..AC-16) is either backed by a unit test (Task 3 for AC-10/11, Task 4 for AC-13/14) or explicitly walked in Task 10.
- **Placeholder scan**: no "TBD"/vague "handle it" steps; every code step is a literal diff or full new function.
- **Type consistency**: `withCameraMode`/`withPowerSave`/`withVolume`/`withPreset` (Tasks 2-3) are consumed with identical names/signatures in Task 6's `main.ts` and Tasks 7-8's `settingsPanel.ts`. `computeQualityScales`/`effectiveMinFps` (Task 4) match their Task 6 call sites exactly (same parameter order: `(downgradeStep, powerSave)`). `AmbientAudio.setVolume`/`AquariumUi.setVolume` (Task 5) match Task 6's `ui.setVolume(next.audio.volume)` call.
- Tasks 7 and 8 both add sections to `settingsPanel.ts` and both append to the same final `panel.append(...)` call — run them in order (7 before 8) and merge the two `panel.append(...)` edits by hand if executed by different subagents in parallel; as written here they're sequential, so Task 8's version of `panel.append(...)` already includes Task 7's `mood.section`.
- This plan does not touch `web/src/environment.ts`, `particles.ts`, or the fish/coral/seaweed geometry at all — no triangle/draw-call budget impact expected; Task 6's manual verification step still checks `window.__aq` as a sanity net.
