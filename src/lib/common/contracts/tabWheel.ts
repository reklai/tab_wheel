// Every surface loads settings through this contract. Keep defaults,
// normalizers, storage keys, and focused-product state together.

import browser from "webextension-polyfill";
import {
  DEFAULT_TABWHEEL_CLICK_ACTION_SETTINGS,
  TABWHEEL_CLICK_ACTIONS,
} from "../../core/tabWheel/mouseGestureCore";

export { TABWHEEL_CLICK_ACTIONS };

export const MAX_SCROLL_MEMORY_ENTRIES = 300;
export const MAX_RECENT_TABS = 100;
export const TABWHEEL_ONBOARDING_VERSION = 2;
export const TABWHEEL_STORAGE_KEYS = {
  settings: "tabWheelSettings",
  scrollMemory: "tabWheelScrollMemory",
  recentTabs: "tabWheelRecentTabs",
  onboarding: "tabWheelOnboarding",
} as const;
export const TABWHEEL_MODIFIER_KEYS: readonly TabWheelModifierKey[] = ["alt", "ctrl", "meta"];
export const TABWHEEL_PRESETS: readonly TabWheelPreset[] = ["precise", "balanced", "fast", "custom"];
export const MIN_WHEEL_SENSITIVITY = 0.5;
export const MAX_WHEEL_SENSITIVITY = 2;
export const MIN_WHEEL_COOLDOWN_MS = 60;
export const MAX_WHEEL_COOLDOWN_MS = 400;

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

export const DEFAULT_TABWHEEL_SETTINGS: TabWheelSettings = {
  invertScroll: false,
  gestureModifier: "alt",
  gestureWithShift: false,
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

export function applyTabWheelPreset(
  settings: TabWheelSettings,
  preset: TabWheelPreset,
): TabWheelSettings {
  if (preset === "custom") return { ...settings, wheelPreset: "custom" };
  return { ...settings, ...TABWHEEL_PRESET_VALUES[preset], wheelPreset: preset };
}

export function normalizeTabWheelSettings(value: unknown): TabWheelSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ...DEFAULT_TABWHEEL_SETTINGS };
  }
  const settings = value as Partial<TabWheelSettings>;
  const normalized: TabWheelSettings = {
    invertScroll: settings.invertScroll === true,
    gestureModifier: normalizeModifierKey(settings.gestureModifier),
    gestureWithShift: settings.gestureWithShift === true,
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

export function formatTabWheelModifierKey(modifier: TabWheelModifierKey): string {
  if (modifier === "ctrl") return "Ctrl / Control";
  if (modifier === "meta") return "Meta / Command";
  return "Alt / Option";
}

export function formatTabWheelModifierCombo(
  modifier: TabWheelModifierKey,
  withShift: boolean,
): string {
  const base = formatTabWheelModifierKey(modifier);
  return withShift ? `${base} + Shift` : base;
}

export function formatTabWheelPresetLabel(preset: TabWheelPreset): string {
  if (preset === "precise") return "Precise";
  if (preset === "fast") return "Fast";
  if (preset === "custom") return "Custom";
  return "Balanced";
}

export function formatTabWheelClickAction(action: TabWheelClickAction): string {
  switch (action) {
    case "nativeNewTab": return "Browser new tab";
    case "recentTab": return "Most recent tab";
    case "closeToRecent": return "Close current tab";
    case "duplicateTab": return "Duplicate tab";
    case "dragCurrentTab": return "Drag current tab";
    case "openSettings": return "Open settings";
    case "none": return "Off";
  }
}

export async function loadTabWheelSettings(): Promise<TabWheelSettings> {
  try {
    const data = await browser.storage.local.get(TABWHEEL_STORAGE_KEYS.settings);
    return normalizeTabWheelSettings(data[TABWHEEL_STORAGE_KEYS.settings]);
  } catch (_) {
    return { ...DEFAULT_TABWHEEL_SETTINGS };
  }
}

export async function saveTabWheelSettings(settings: TabWheelSettings): Promise<void> {
  await browser.storage.local.set({
    [TABWHEEL_STORAGE_KEYS.settings]: normalizeTabWheelSettings(settings),
  });
}

export async function loadTabWheelOnboardingState(): Promise<TabWheelOnboardingState> {
  try {
    const data = await browser.storage.local.get(TABWHEEL_STORAGE_KEYS.onboarding);
    return normalizeTabWheelOnboardingState(data[TABWHEEL_STORAGE_KEYS.onboarding]);
  } catch (_) {
    return { ...DEFAULT_TABWHEEL_ONBOARDING_STATE };
  }
}

export async function saveTabWheelOnboardingState(state: TabWheelOnboardingState): Promise<void> {
  await browser.storage.local.set({
    [TABWHEEL_STORAGE_KEYS.onboarding]: normalizeTabWheelOnboardingState(state),
  });
}
