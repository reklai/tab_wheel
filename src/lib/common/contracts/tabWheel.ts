// The settings contract. Every surface (content script, background, popup,
// options page, onboarding) loads and saves settings and onboarding state
// through here. Storage keys, defaults, ranges, presets, and normalizers live
// together so a setting's default, range, and normalization cannot drift apart.

import browser from "webextension-polyfill";
import {
  DEFAULT_TABWHEEL_CLICK_ACTION_SETTINGS,
  TABWHEEL_CLICK_ACTIONS,
} from "../../core/tabWheel/mouseGestureCore";

export { TABWHEEL_CLICK_ACTIONS };

/** Most saved scroll positions kept; the least recently updated go first. */
export const MAX_SCROLL_MEMORY_ENTRIES = 300;
/** Most tab ids kept in each window's recent-tab history. */
export const MAX_RECENT_TABS = 100;
/** Version stamped on the stored onboarding state. */
export const TABWHEEL_ONBOARDING_VERSION = 2;
/**
 * The storage.local key of each persisted record. Renaming one orphans the
 * data already stored under it unless a storage migration moves it.
 */
export const TABWHEEL_STORAGE_KEYS = {
  settings: "tabWheelSettings",
  scrollMemory: "tabWheelScrollMemory",
  recentTabs: "tabWheelRecentTabs",
  onboarding: "tabWheelOnboarding",
} as const;
/** The modifiers the wheel gesture can be bound to (Shift is a separate flag). */
export const TABWHEEL_MODIFIER_KEYS: readonly TabWheelModifierKey[] = ["alt", "ctrl", "meta"];
/** Every wheel preset; "custom" is any combination no named preset matches. */
export const TABWHEEL_PRESETS: readonly TabWheelPreset[] = ["precise", "balanced", "fast", "custom"];
// Ranges of the two sensitivity multipliers; higher is faster for both.
// wheelSensitivity: the wheel travels 80px / sensitivity per switch.
// tabDragSensitivity ("Drag speed"): the pointer travels 96px / sensitivity
// per slot (see tabDragCore.ts).
export const MIN_WHEEL_SENSITIVITY = 0.5;
export const MIN_TAB_DRAG_SENSITIVITY = 0.6;
export const MAX_TAB_DRAG_SENSITIVITY = 2;
export const MAX_WHEEL_SENSITIVITY = 2;
// Range, in ms, of wheelCooldownMs: the least time between two wheel switches.
export const MIN_WHEEL_COOLDOWN_MS = 60;
export const MAX_WHEEL_COOLDOWN_MS = 400;

/**
 * The wheel values each named preset applies. Values that match a preset
 * exactly carry its name (detectTabWheelPreset); anything else is Custom.
 * Precise's sensitivity of 0.8 is the lowest at which one wheel notch still
 * switches one tab. test/wheel-profiles.test.mjs pins these values.
 */
export const TABWHEEL_PRESET_VALUES: Record<Exclude<TabWheelPreset, "custom">, {
  wheelSensitivity: number;
  wheelCooldownMs: number;
  wheelAcceleration: boolean;
  overshootGuard: boolean;
}> = {
  precise: {
    wheelSensitivity: 0.8,
    wheelCooldownMs: 220,
    wheelAcceleration: false,
    overshootGuard: true,
  },
  balanced: {
    wheelSensitivity: 1,
    wheelCooldownMs: 160,
    wheelAcceleration: false,
    overshootGuard: true,
  },
  fast: {
    wheelSensitivity: 1.35,
    wheelCooldownMs: 90,
    wheelAcceleration: true,
    overshootGuard: true,
  },
};

/**
 * Settings for a fresh install, and the fallback for any stored value that
 * fails normalization. The click-action defaults come from mouseGestureCore.
 */
export const DEFAULT_TABWHEEL_SETTINGS: TabWheelSettings = {
  invertScroll: false,
  gestureModifier: "alt",
  gestureWithShift: false,
  tabDragSensitivity: 1,
  allowGesturesInEditableFields: true,
  ...DEFAULT_TABWHEEL_CLICK_ACTION_SETTINGS,
  restorePagePosition: true,
  skipPinnedTabs: false,
  skipRestrictedPages: true,
  skipHiddenTabs: true,
  showRestrictedBadge: true,
  wrapAround: true,
  cycleWithinTabGroup: false,
  wheelPreset: "balanced",
  wheelSensitivity: 1,
  wheelCooldownMs: 160,
  wheelAcceleration: false,
  horizontalWheel: true,
  overshootGuard: true,
};

/** Onboarding state for a fresh install: nothing seen or completed yet. */
export const DEFAULT_TABWHEEL_ONBOARDING_STATE: TabWheelOnboardingState = {
  version: TABWHEEL_ONBOARDING_VERSION,
  demoCompleted: false,
  firstGestureCycleCompleted: false,
  clickActionsReleaseSeen: false,
};

function normalizeModifierKey(value: unknown): TabWheelModifierKey {
  return TABWHEEL_MODIFIER_KEYS.includes(value as TabWheelModifierKey)
    ? value as TabWheelModifierKey
    : DEFAULT_TABWHEEL_SETTINGS.gestureModifier;
}

function normalizeEnabledFlag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

// Coerces to a number clamped to [min, max]; a non-numeric value falls back.
function normalizeNumberInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function normalizeWheelPreset(value: unknown): TabWheelPreset {
  return TABWHEEL_PRESETS.includes(value as TabWheelPreset)
    ? value as TabWheelPreset
    : DEFAULT_TABWHEEL_SETTINGS.wheelPreset;
}

function normalizeClickAction(value: unknown, fallback: TabWheelClickAction): TabWheelClickAction {
  return TABWHEEL_CLICK_ACTIONS.includes(value as TabWheelClickAction)
    ? value as TabWheelClickAction
    : fallback;
}

/** The preset whose four wheel values `settings` matches exactly, else "custom". */
export function detectTabWheelPreset(settings: Pick<
  TabWheelSettings,
  "wheelSensitivity" | "wheelCooldownMs" | "wheelAcceleration" | "overshootGuard"
>): TabWheelPreset {
  for (const preset of ["precise", "balanced", "fast"] as const) {
    const values = TABWHEEL_PRESET_VALUES[preset];
    if (
      settings.wheelSensitivity === values.wheelSensitivity
      && settings.wheelCooldownMs === values.wheelCooldownMs
      && settings.wheelAcceleration === values.wheelAcceleration
      && settings.overshootGuard === values.overshootGuard
    ) {
      return preset;
    }
  }
  return "custom";
}

/**
 * Applies a preset's wheel values and name. Choosing Custom only relabels, so
 * the user edits from the values already in place.
 */
export function applyTabWheelPreset(
  settings: TabWheelSettings,
  preset: TabWheelPreset,
): TabWheelSettings {
  if (preset === "custom") return { ...settings, wheelPreset: "custom" };
  return { ...settings, ...TABWHEEL_PRESET_VALUES[preset], wheelPreset: preset };
}

/**
 * Turns any stored value into a valid TabWheelSettings: unknown choices and
 * non-booleans fall back to their defaults, and numbers are clamped to their
 * ranges. Internal reliability rules that the UI does not expose
 * (allowGesturesInEditableFields, restorePagePosition, skipRestrictedPages,
 * showRestrictedBadge, horizontalWheel, overshootGuard) are forced on whatever
 * is stored. A missing preset name is inferred from the wheel values; a stored
 * one is kept as is.
 */
export function normalizeTabWheelSettings(value: unknown): TabWheelSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ...DEFAULT_TABWHEEL_SETTINGS };
  }
  const settings = value as Partial<TabWheelSettings>;
  const normalized: TabWheelSettings = {
    invertScroll: settings.invertScroll === true,
    gestureModifier: normalizeModifierKey(settings.gestureModifier),
    gestureWithShift: settings.gestureWithShift === true,
    tabDragSensitivity: normalizeNumberInRange(
      settings.tabDragSensitivity,
      DEFAULT_TABWHEEL_SETTINGS.tabDragSensitivity,
      MIN_TAB_DRAG_SENSITIVITY,
      MAX_TAB_DRAG_SENSITIVITY,
    ),
    allowGesturesInEditableFields: true,
    leftClickAction: normalizeClickAction(
      settings.leftClickAction,
      DEFAULT_TABWHEEL_SETTINGS.leftClickAction,
    ),
    middleClickAction: normalizeClickAction(
      settings.middleClickAction,
      DEFAULT_TABWHEEL_SETTINGS.middleClickAction,
    ),
    rightClickAction: normalizeClickAction(
      settings.rightClickAction,
      DEFAULT_TABWHEEL_SETTINGS.rightClickAction,
    ),
    restorePagePosition: true,
    skipPinnedTabs: normalizeEnabledFlag(settings.skipPinnedTabs, DEFAULT_TABWHEEL_SETTINGS.skipPinnedTabs),
    skipRestrictedPages: true,
    skipHiddenTabs: normalizeEnabledFlag(settings.skipHiddenTabs, DEFAULT_TABWHEEL_SETTINGS.skipHiddenTabs),
    showRestrictedBadge: true,
    wrapAround: normalizeEnabledFlag(settings.wrapAround, DEFAULT_TABWHEEL_SETTINGS.wrapAround),
    cycleWithinTabGroup: normalizeEnabledFlag(
      settings.cycleWithinTabGroup,
      DEFAULT_TABWHEEL_SETTINGS.cycleWithinTabGroup,
    ),
    wheelPreset: normalizeWheelPreset(settings.wheelPreset),
    wheelSensitivity: normalizeNumberInRange(
      settings.wheelSensitivity,
      DEFAULT_TABWHEEL_SETTINGS.wheelSensitivity,
      MIN_WHEEL_SENSITIVITY,
      MAX_WHEEL_SENSITIVITY,
    ),
    wheelCooldownMs: normalizeNumberInRange(
      settings.wheelCooldownMs,
      DEFAULT_TABWHEEL_SETTINGS.wheelCooldownMs,
      MIN_WHEEL_COOLDOWN_MS,
      MAX_WHEEL_COOLDOWN_MS,
    ),
    wheelAcceleration: normalizeEnabledFlag(
      settings.wheelAcceleration,
      DEFAULT_TABWHEEL_SETTINGS.wheelAcceleration,
    ),
    horizontalWheel: true,
    overshootGuard: true,
  };
  normalized.wheelPreset = settings.wheelPreset == null
    ? detectTabWheelPreset(normalized)
    : normalized.wheelPreset;
  return normalized;
}

/**
 * Turns any stored value into a valid onboarding state. A flag counts only
 * when stored as literally true, and the version is always the current one.
 */
export function normalizeTabWheelOnboardingState(value: unknown): TabWheelOnboardingState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ...DEFAULT_TABWHEEL_ONBOARDING_STATE };
  }
  const state = value as Partial<TabWheelOnboardingState>;
  return {
    version: Number(state.version) === TABWHEEL_ONBOARDING_VERSION
      ? TABWHEEL_ONBOARDING_VERSION
      : TABWHEEL_ONBOARDING_VERSION,
    demoCompleted: state.demoCompleted === true,
    firstGestureCycleCompleted: state.firstGestureCycleCompleted === true,
    clickActionsReleaseSeen: state.clickActionsReleaseSeen === true,
  };
}

/** The modifier's user-facing name, covering both the PC and Mac key labels. */
export function formatTabWheelModifierKey(modifier: TabWheelModifierKey): string {
  if (modifier === "ctrl") return "Ctrl / Control";
  if (modifier === "meta") return "Meta / Command";
  return "Alt / Option";
}

/** The full chord's user-facing name, e.g. "Alt / Option + Shift". */
export function formatTabWheelModifierCombo(
  modifier: TabWheelModifierKey,
  withShift: boolean,
): string {
  const base = formatTabWheelModifierKey(modifier);
  return withShift ? `${base} + Shift` : base;
}

/** The preset's user-facing name. */
export function formatTabWheelPresetLabel(preset: TabWheelPreset): string {
  if (preset === "precise") return "Precise";
  if (preset === "fast") return "Fast";
  if (preset === "custom") return "Custom";
  return "Balanced";
}

/** The click action's user-facing name, as shown in the dropdowns. */
export function formatTabWheelClickAction(action: TabWheelClickAction): string {
  switch (action) {
    case "nativeNewTab": return "Browser new tab";
    case "recentTab": return "Most recent tab";
    case "closeToRecent": return "Close current tab";
    case "duplicateTab": return "Duplicate tab";
    case "dragCurrentTab": return "Drag current tab";
    case "openSettings": return "Open settings";
    case "muteTab": return "Mute / unmute tab";
    case "goBack": return "Go back";
    case "goForward": return "Go forward";
    case "none": return "Off";
  }
}

/** Reads normalized settings; falls back to the defaults if storage fails. */
export async function loadTabWheelSettings(): Promise<TabWheelSettings> {
  try {
    const data = await browser.storage.local.get(TABWHEEL_STORAGE_KEYS.settings);
    return normalizeTabWheelSettings(data[TABWHEEL_STORAGE_KEYS.settings]);
  } catch (_) {
    return { ...DEFAULT_TABWHEEL_SETTINGS };
  }
}

/** Normalizes and stores settings. Rejects if the write fails. */
export async function saveTabWheelSettings(settings: TabWheelSettings): Promise<void> {
  await browser.storage.local.set({
    [TABWHEEL_STORAGE_KEYS.settings]: normalizeTabWheelSettings(settings),
  });
}

/** Reads normalized onboarding state; falls back to the defaults if storage fails. */
export async function loadTabWheelOnboardingState(): Promise<TabWheelOnboardingState> {
  try {
    const data = await browser.storage.local.get(TABWHEEL_STORAGE_KEYS.onboarding);
    return normalizeTabWheelOnboardingState(data[TABWHEEL_STORAGE_KEYS.onboarding]);
  } catch (_) {
    return { ...DEFAULT_TABWHEEL_ONBOARDING_STATE };
  }
}

/** Normalizes and stores onboarding state. Rejects if the write fails. */
export async function saveTabWheelOnboardingState(state: TabWheelOnboardingState): Promise<void> {
  await browser.storage.local.set({
    [TABWHEEL_STORAGE_KEYS.onboarding]: normalizeTabWheelOnboardingState(state),
  });
}
