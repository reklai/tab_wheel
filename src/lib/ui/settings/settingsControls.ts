// Shared select-population helpers so the options page and toolbar popup
// render the same option labels and ordering from the same contract data —
// edit labels here, not in each page.

import {
  formatTabWheelClickActionLabel,
  formatTabWheelCycleScopeLabel,
  formatTabWheelModifierKey,
  formatTabWheelPresetLabel,
  TABWHEEL_CLICK_ACTIONS,
  TABWHEEL_CYCLE_SCOPES,
  TABWHEEL_MODIFIER_KEYS,
  TABWHEEL_PRESETS,
} from "../../common/contracts/tabWheel";

export function populateClickActionSelect(
  select: HTMLSelectElement,
  selected: TabWheelClickAction,
): void {
  setSelectOptions(
    select,
    TABWHEEL_CLICK_ACTIONS,
    selected,
    (value) => formatTabWheelClickActionLabel(value as TabWheelClickAction),
  );
}

export function populateModifierSelect(
  select: HTMLSelectElement,
  selected: TabWheelModifierKey,
): void {
  setSelectOptions(
    select,
    TABWHEEL_MODIFIER_KEYS,
    selected,
    (value) => formatTabWheelModifierKey(value as TabWheelModifierKey),
  );
}

export function populatePresetSelect(
  select: HTMLSelectElement,
  selected: TabWheelPreset,
): void {
  setSelectOptions(
    select,
    TABWHEEL_PRESETS,
    selected,
    (value) => formatTabWheelPresetLabel(value as TabWheelPreset),
  );
}

export function populateCycleScopeSelect(
  select: HTMLSelectElement,
  selected: TabWheelCycleScope,
): void {
  setSelectOptions(
    select,
    TABWHEEL_CYCLE_SCOPES,
    selected,
    (value) => formatTabWheelCycleScopeLabel(value as TabWheelCycleScope),
  );
}

function setSelectOptions(
  select: HTMLSelectElement,
  values: readonly string[],
  selected: string,
  label: (value: string) => string,
): void {
  select.replaceChildren();
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label(value);
    if (value === selected) option.selected = true;
    select.appendChild(option);
  }
}
