// Popup and options use the same controls; edit labels and ordering here so the
// two surfaces cannot drift.

import {
  formatTabWheelCycleScopeLabel,
  formatTabWheelModifierKey,
  formatTabWheelMiddleClickAction,
  formatTabWheelPresetLabel,
  TABWHEEL_CYCLE_SCOPES,
  TABWHEEL_MIDDLE_CLICK_ACTIONS,
  TABWHEEL_MODIFIER_KEYS,
  TABWHEEL_PRESETS,
} from "../../common/contracts/tabWheel";

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

export function populateMiddleClickActionSelect(
  select: HTMLSelectElement,
  selected: TabWheelMiddleClickAction,
): void {
  setSelectOptions(
    select,
    TABWHEEL_MIDDLE_CLICK_ACTIONS,
    selected,
    (value) => formatTabWheelMiddleClickAction(value as TabWheelMiddleClickAction),
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
