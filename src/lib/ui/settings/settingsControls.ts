// Popup and options use the same controls; edit labels and ordering here so the
// two surfaces cannot drift.

import {
  formatTabWheelClickAction,
  formatTabWheelModifierKey,
  formatTabWheelPresetLabel,
  TABWHEEL_CLICK_ACTIONS,
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

export function populateClickActionSelect(
  select: HTMLSelectElement,
  selected: TabWheelClickAction,
): void {
  setSelectOptions(
    select,
    TABWHEEL_CLICK_ACTIONS,
    selected,
    (value) => formatTabWheelClickAction(value as TabWheelClickAction),
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
