// Shared <select> builders for the popup, options page, and onboarding. Option
// values, order, and labels come from the lists exported by contracts/tabWheel,
// so edit them there and every surface stays in step.

import {
  formatTabWheelClickAction,
  formatTabWheelModifierKey,
  formatTabWheelPresetLabel,
  TABWHEEL_CLICK_ACTIONS,
  TABWHEEL_MODIFIER_KEYS,
  TABWHEEL_PRESETS,
} from "../../common/contracts/tabWheel";

/** Fills `select` with every gesture modifier key and selects `selected`. */
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

/** Fills `select` with every wheel feel preset and selects `selected`. */
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

/** Fills `select` with every modifier+click action and selects `selected`. */
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

/** Replaces all options in `select`; safe to call again to rebuild it. */
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
