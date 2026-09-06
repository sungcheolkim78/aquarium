/**
 * Settings panel DOM (SPEC F6, §6.5). Pure UI glue: every control edits an
 * `AquariumSettings` via the pure reducers in `settings.ts` and reports the
 * new value through `onChange` — this module owns no domain logic, so it is
 * intentionally left out of the automated test suite (SPEC §9) and verified
 * visually instead.
 */

import type { AquariumSettings, DetailLevel, FishSpecies } from "./config";
import { DEFAULT_SETTINGS, ENVIRONMENT_PRESETS, MOOD_PRESETS, type PresetId } from "./config";
import {
  matchingPresetId,
  withBackgroundDetail,
  withBackgroundObjectCountScale,
  withBackgroundPreset,
  withBubblesDensityScale,
  withBubblesEnabled,
  withCameraMode,
  withCaustics,
  withFishCountScale,
  withFishDetail,
  withLightingIntensityScale,
  withPowerSave,
  withPreset,
  withSpeciesEnabled,
  withVolume,
} from "./settings";

export interface SettingsPanelCallbacks {
  onChange(next: AquariumSettings): void;
}

export interface SettingsPanel {
  readonly element: HTMLElement;
  dispose(): void;
}

function section(title: string): { section: HTMLElement; body: HTMLElement } {
  const el = document.createElement("section");
  el.className = "settings-panel__section";
  const heading = document.createElement("h3");
  heading.className = "settings-panel__heading";
  heading.textContent = title;
  const body = document.createElement("div");
  body.className = "settings-panel__body";
  el.append(heading, body);
  return { section: el, body };
}

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

function sliderRow(
  labelText: string,
  id: string,
  min: number,
  max: number,
  step: number,
  value: number,
  format: (value: number) => string,
  onInput: (value: number) => void,
  cleanups: (() => void)[],
): HTMLElement {
  const row = document.createElement("div");
  row.className = "settings-panel__slider-row";
  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = "range";
  input.id = id;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const readout = document.createElement("span");
  readout.className = "settings-panel__readout";
  readout.textContent = format(value);
  const onChange = (): void => {
    const next = Number(input.value);
    readout.textContent = format(next);
    onInput(next);
  };
  input.addEventListener("input", onChange);
  cleanups.push(() => input.removeEventListener("input", onChange));
  row.append(label, input, readout);
  return row;
}

function checkboxRow(
  labelText: string,
  id: string,
  checked: boolean,
  onToggle: (checked: boolean) => void,
  cleanups: (() => void)[],
): HTMLElement {
  const row = document.createElement("label");
  row.className = "settings-panel__checkbox";
  row.htmlFor = id;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = id;
  input.checked = checked;
  const onChange = (): void => onToggle(input.checked);
  input.addEventListener("change", onChange);
  cleanups.push(() => input.removeEventListener("change", onChange));
  const text = document.createElement("span");
  text.textContent = labelText;
  row.append(input, text);
  return row;
}

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

/** Build the settings panel form. `registry` drives the species list (AC-8). */
export function createSettingsPanel(
  registry: readonly FishSpecies[],
  initial: AquariumSettings,
  callbacks: SettingsPanelCallbacks,
): SettingsPanel {
  let current = initial;
  const cleanups: (() => void)[] = [];

  const panel = document.createElement("div");
  panel.className = "settings-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "아쿠아리움 설정");

  const emit = (next: AquariumSettings): void => {
    current = next;
    callbacks.onChange(current);
  };

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

  // 물고기 종류 -------------------------------------------------------------
  const species = section("물고기 종류");
  for (const fish of registry) {
    species.body.append(
      checkboxRow(
        fish.label,
        `species-${fish.id}`,
        current.fish.enabledSpecies[fish.id] !== false,
        (checked) => emit(withSpeciesEnabled(current, fish.id, checked)),
        cleanups,
      ),
    );
  }

  // 물고기 디테일 -----------------------------------------------------------
  const fishDetail = section("물고기 디테일");
  fishDetail.body.append(
    detailRadioGroup(
      "fish-detail",
      current.fish.detail,
      (detail) => emit(withFishDetail(current, detail)),
      cleanups,
    ),
  );

  // 물고기 수 ---------------------------------------------------------------
  const fishCount = section("물고기 수");
  fishCount.body.append(
    sliderRow(
      "전체 개체수 배율",
      "fish-count-scale",
      0.25,
      1.5,
      0.05,
      current.fish.countScale,
      (v) => `${v.toFixed(2)}x`,
      (v) => emit(withFishCountScale(current, v)),
      cleanups,
    ),
  );

  // 배경 테마 -----------------------------------------------------------------
  const backgroundTheme = section("배경 테마");
  backgroundTheme.body.append(
    radioGroup(
      "background-preset",
      Object.values(ENVIRONMENT_PRESETS).map((preset) => ({ value: preset.id, label: preset.label })),
      current.background.presetId,
      (presetId) => emit(withBackgroundPreset(current, presetId)),
      cleanups,
    ),
  );

  // 배경 설정 (디테일) -------------------------------------------------------
  const backgroundDetail = section("배경 설정");
  backgroundDetail.body.append(
    detailRadioGroup(
      "background-detail",
      current.background.detail,
      (detail) => emit(withBackgroundDetail(current, detail)),
      cleanups,
    ),
  );

  // 배경 물체 수 --------------------------------------------------------------
  const backgroundCount = section("배경 물체 수");
  backgroundCount.body.append(
    sliderRow(
      "산호/해초 개수 배율",
      "background-object-count-scale",
      0.5,
      2.0,
      0.1,
      current.background.objectCountScale,
      (v) => `${v.toFixed(1)}x`,
      (v) => emit(withBackgroundObjectCountScale(current, v)),
      cleanups,
    ),
  );

  // 조명 ----------------------------------------------------------------------
  const lighting = section("조명");
  lighting.body.append(
    sliderRow(
      "밝기",
      "lighting-intensity-scale",
      0.4,
      1.6,
      0.05,
      current.lighting.intensityScale,
      (v) => `${v.toFixed(2)}x`,
      (v) => emit(withLightingIntensityScale(current, v)),
      cleanups,
    ),
    checkboxRow(
      "코스틱(물결 그림자)",
      "lighting-caustics",
      current.lighting.caustics,
      (checked) => emit(withCaustics(current, checked)),
      cleanups,
    ),
  );

  // 물방울 --------------------------------------------------------------------
  const bubbles = section("물방울");
  bubbles.body.append(
    checkboxRow(
      "표시",
      "bubbles-enabled",
      current.bubbles.enabled,
      (checked) => emit(withBubblesEnabled(current, checked)),
      cleanups,
    ),
    sliderRow(
      "밀도",
      "bubbles-density-scale",
      0,
      2.0,
      0.1,
      current.bubbles.densityScale,
      (v) => `${v.toFixed(1)}x`,
      (v) => emit(withBubblesDensityScale(current, v)),
      cleanups,
    ),
  );

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

  panel.append(
    mood.section,
    species.section,
    fishDetail.section,
    fishCount.section,
    backgroundTheme.section,
    backgroundDetail.section,
    backgroundCount.section,
    lighting.section,
    bubbles.section,
    camera.section,
    performance.section,
    audio.section,
  );

  return {
    element: panel,
    dispose(): void {
      for (const cleanup of cleanups) cleanup();
      panel.remove();
    },
  };
}
