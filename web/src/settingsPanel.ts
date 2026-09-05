/**
 * Settings panel DOM (SPEC F6, §6.5). Pure UI glue: every control edits an
 * `AquariumSettings` via the pure reducers in `settings.ts` and reports the
 * new value through `onChange` — this module owns no domain logic, so it is
 * intentionally left out of the automated test suite (SPEC §9) and verified
 * visually instead.
 */

import type { AquariumSettings, DetailLevel, FishSpecies } from "./config";
import {
  withBackgroundDetail,
  withBackgroundObjectCountScale,
  withBubblesDensityScale,
  withBubblesEnabled,
  withCaustics,
  withFishCountScale,
  withFishDetail,
  withLightingIntensityScale,
  withSpeciesEnabled,
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

  panel.append(
    species.section,
    fishDetail.section,
    fishCount.section,
    backgroundDetail.section,
    backgroundCount.section,
    lighting.section,
    bubbles.section,
  );

  return {
    element: panel,
    dispose(): void {
      for (const cleanup of cleanups) cleanup();
      panel.remove();
    },
  };
}
