// Shared TabWheel contract: storage keys, setting defaults, and normalizers.
// Every surface (background, content script, popup, options) passes settings
// through the normalizers here, so stored values stay valid even when they
// were written by an older version or changed outside the extension.

import browser from "webextension-polyfill";
import {
  DEFAULT_TABWHEEL_CLICK_ACTION_SETTINGS,
  TABWHEEL_CLICK_ACTIONS,
} from "../../core/tabWheel/mouseGestureCore";

export { TABWHEEL_CLICK_ACTIONS };

export const MAX_SCROLL_MEMORY_ENTRIES = 300;
export const MAX_MRU_TABS = 100;
export const TABWHEEL_STORAGE_KEYS = {
  settings: "tabWheelSettings",
  scrollMemory: "tabWheelScrollMemory",
  mruState: "tabWheelMruState",
} as const;
export const TABWHEEL_MODIFIER_KEYS: readonly TabWheelModifierKey[] = [
  "alt",
  "ctrl",
  "meta",
] as const;
export const TABWHEEL_CYCLE_SCOPES: readonly TabWheelCycleScope[] = ["general", "mru"];
export const TABWHEEL_PRESETS: readonly TabWheelPreset[] = ["precise", "balanced", "fast", "custom"];
export const MIN_WHEEL_SENSITIVITY = 0.5;
export const MAX_WHEEL_SENSITIVITY = 2;
export const MIN_WHEEL_COOLDOWN_MS = 60;
export const MAX_WHEEL_COOLDOWN_MS = 400;
export const MIN_PAGE_SCROLL_SPEED_MULTIPLIER = 0.5;
export const MAX_PAGE_SCROLL_SPEED_MULTIPLIER = 3;
export const MIN_PAGE_SCROLL_VIEWPORT_CAP_RATIO = 0.1;
export const MAX_PAGE_SCROLL_VIEWPORT_CAP_RATIO = 1;
export const GOOGLE_SEARCH_URL_TEMPLATE = "https://www.google.com/search?q=%s";
export const MAX_SEARCH_QUERY_LENGTH = 512;

export const TABWHEEL_PRESET_VALUES: Record<Exclude<TabWheelPreset, "custom">, {
  wheelSensitivity: number;
  wheelCooldownMs: number;
  pageScrollSpeedMultiplier: number;
  pageScrollViewportCapRatio: number;
  wheelAcceleration: boolean;
  overshootGuard: boolean;
}> = {
  precise: {
    wheelSensitivity: 0.8,
    wheelCooldownMs: 220,
    pageScrollSpeedMultiplier: 0.8,
    pageScrollViewportCapRatio: 0.35,
    wheelAcceleration: false,
    overshootGuard: true,
  },
  balanced: {
    wheelSensitivity: 1,
    wheelCooldownMs: 160,
    pageScrollSpeedMultiplier: 1,
    pageScrollViewportCapRatio: 1,
    wheelAcceleration: false,
    overshootGuard: true,
  },
  fast: {
    wheelSensitivity: 1.35,
    wheelCooldownMs: 90,
    pageScrollSpeedMultiplier: 1.4,
    pageScrollViewportCapRatio: 1,
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
  cycleScope: "general",
  skipPinnedTabs: false,
  skipRestrictedPages: true,
  skipHiddenTabs: false,
  wrapAround: true,
  wheelPreset: "balanced",
  wheelSensitivity: 1,
  wheelCooldownMs: 160,
  pageScrollSpeedMultiplier: 1,
  pageScrollViewportCapRatio: 1,
  wheelAcceleration: false,
  horizontalWheel: true,
  overshootGuard: true,
};

function normalizeModifierKey(
  value: unknown,
  fallback: TabWheelModifierKey,
): TabWheelModifierKey {
  return TABWHEEL_MODIFIER_KEYS.includes(value as TabWheelModifierKey)
    ? value as TabWheelModifierKey
    : fallback;
}

function normalizeShiftRequirement(value: unknown): boolean {
  return value === true;
}

function normalizeClickAction(
  value: unknown,
  fallback: TabWheelClickAction,
): TabWheelClickAction {
  return TABWHEEL_CLICK_ACTIONS.includes(value as TabWheelClickAction)
    ? value as TabWheelClickAction
    : fallback;
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

export function normalizeSearchQuery(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_SEARCH_QUERY_LENGTH);
}

export function buildSearchUrl(query: string): string {
  return GOOGLE_SEARCH_URL_TEMPLATE.replaceAll("%s", encodeURIComponent(normalizeSearchQuery(query)));
}

export function normalizeTabWheelCycleScope(value: unknown): TabWheelCycleScope {
  return TABWHEEL_CYCLE_SCOPES.includes(value as TabWheelCycleScope)
    ? value as TabWheelCycleScope
    : DEFAULT_TABWHEEL_SETTINGS.cycleScope;
}

function normalizeWheelPreset(value: unknown): TabWheelPreset {
  return TABWHEEL_PRESETS.includes(value as TabWheelPreset)
    ? value as TabWheelPreset
    : DEFAULT_TABWHEEL_SETTINGS.wheelPreset;
}

export function detectTabWheelPreset(settings: Pick<
  TabWheelSettings,
  | "wheelSensitivity"
  | "wheelCooldownMs"
  | "pageScrollSpeedMultiplier"
  | "pageScrollViewportCapRatio"
  | "wheelAcceleration"
  | "overshootGuard"
>): TabWheelPreset {
  for (const preset of ["precise", "balanced", "fast"] as const) {
    const presetValues = TABWHEEL_PRESET_VALUES[preset];
    if (
      settings.wheelSensitivity === presetValues.wheelSensitivity
      && settings.wheelCooldownMs === presetValues.wheelCooldownMs
      && settings.pageScrollSpeedMultiplier === presetValues.pageScrollSpeedMultiplier
      && settings.pageScrollViewportCapRatio === presetValues.pageScrollViewportCapRatio
      && settings.wheelAcceleration === presetValues.wheelAcceleration
      && settings.overshootGuard === presetValues.overshootGuard
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
  return {
    ...settings,
    ...TABWHEEL_PRESET_VALUES[preset],
    wheelPreset: preset,
  };
}

export function normalizeTabWheelSettings(
  value: unknown,
): TabWheelSettings {
  if (typeof value !== "object" || value === null) {
    return { ...DEFAULT_TABWHEEL_SETTINGS };
  }
  const settings = value as Partial<TabWheelSettings>;
  const normalizedSettings = {
    invertScroll: settings.invertScroll === true,
    gestureModifier: normalizeModifierKey(
      settings.gestureModifier,
      DEFAULT_TABWHEEL_SETTINGS.gestureModifier,
    ),
    gestureWithShift: normalizeShiftRequirement(settings.gestureWithShift),
    allowGesturesInEditableFields: normalizeEnabledFlag(
      settings.allowGesturesInEditableFields,
      DEFAULT_TABWHEEL_SETTINGS.allowGesturesInEditableFields,
    ),
    leftClickAction: normalizeClickAction(
      settings.leftClickAction,
      (value as Record<string, unknown>).openNativeNewTabOnLeftClick === true
        ? "nativeNewTab"
        : DEFAULT_TABWHEEL_SETTINGS.leftClickAction,
    ),
    middleClickAction: normalizeClickAction(
      settings.middleClickAction,
      DEFAULT_TABWHEEL_SETTINGS.middleClickAction,
    ),
    rightClickAction: normalizeClickAction(
      settings.rightClickAction,
      DEFAULT_TABWHEEL_SETTINGS.rightClickAction,
    ),
    cycleScope: normalizeTabWheelCycleScope(settings.cycleScope),
    skipPinnedTabs: normalizeEnabledFlag(
      settings.skipPinnedTabs,
      DEFAULT_TABWHEEL_SETTINGS.skipPinnedTabs,
    ),
    skipRestrictedPages: normalizeEnabledFlag(
      settings.skipRestrictedPages,
      DEFAULT_TABWHEEL_SETTINGS.skipRestrictedPages,
    ),
    skipHiddenTabs: normalizeEnabledFlag(
      settings.skipHiddenTabs,
      DEFAULT_TABWHEEL_SETTINGS.skipHiddenTabs,
    ),
    wrapAround: normalizeEnabledFlag(
      settings.wrapAround,
      DEFAULT_TABWHEEL_SETTINGS.wrapAround,
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
    pageScrollSpeedMultiplier: normalizeNumberInRange(
      settings.pageScrollSpeedMultiplier,
      DEFAULT_TABWHEEL_SETTINGS.pageScrollSpeedMultiplier,
      MIN_PAGE_SCROLL_SPEED_MULTIPLIER,
      MAX_PAGE_SCROLL_SPEED_MULTIPLIER,
    ),
    pageScrollViewportCapRatio: normalizeNumberInRange(
      settings.pageScrollViewportCapRatio,
      DEFAULT_TABWHEEL_SETTINGS.pageScrollViewportCapRatio,
      MIN_PAGE_SCROLL_VIEWPORT_CAP_RATIO,
      MAX_PAGE_SCROLL_VIEWPORT_CAP_RATIO,
    ),
    wheelAcceleration: normalizeEnabledFlag(
      settings.wheelAcceleration,
      DEFAULT_TABWHEEL_SETTINGS.wheelAcceleration,
    ),
    horizontalWheel: normalizeEnabledFlag(
      settings.horizontalWheel,
      DEFAULT_TABWHEEL_SETTINGS.horizontalWheel,
    ),
    overshootGuard: normalizeEnabledFlag(
      settings.overshootGuard,
      DEFAULT_TABWHEEL_SETTINGS.overshootGuard,
    ),
  };
  normalizedSettings.wheelPreset = settings.wheelPreset == null
    ? detectTabWheelPreset(normalizedSettings)
    : normalizedSettings.wheelPreset;
  return normalizedSettings;
}

export function formatTabWheelModifierKey(modifier: TabWheelModifierKey): string {
  if (modifier === "ctrl") return "Ctrl / Control";
  if (modifier === "meta") return "Meta / Command";
  return "Alt / Option";
}

export function formatTabWheelPresetLabel(preset: TabWheelPreset): string {
  if (preset === "precise") return "Precise";
  if (preset === "fast") return "Fast";
  if (preset === "custom") return "Custom";
  return "Balanced";
}

export function formatTabWheelCycleScopeLabel(scope: TabWheelCycleScope): string {
  return scope === "mru" ? "Most Recently Used" : "Left-To-Right";
}

const TABWHEEL_CLICK_ACTION_TEXT: Record<TabWheelClickAction, {
  label: string;
  description: string;
  summary: string | null;
}> = {
  search: {
    label: "TabWheel Search",
    description: "opens the in-page search launcher",
    summary: "opens TabWheel search",
  },
  nativeNewTab: {
    label: "Browser Default New Tab",
    description: "opens the browser's normal new tab page",
    summary: "opens new tab",
  },
  recentTab: {
    label: "Most Recent Tab",
    description: "jumps to the most recently used tab",
    summary: "opens most recent tab",
  },
  closeToRecent: {
    label: "Close Tab",
    description: "closes this tab; returns to the most recently used tab first when available",
    summary: "closes current tab",
  },
  duplicateTab: {
    label: "Duplicate Tab",
    description: "duplicates the current tab",
    summary: "duplicates tab",
  },
  openSettings: {
    label: "Open Settings",
    description: "opens the TabWheel settings page",
    summary: "opens settings",
  },
  none: {
    label: "Off (native click)",
    description: "keeps the browser's native click behavior",
    summary: null,
  },
};

function getClickActionText(action: TabWheelClickAction): typeof TABWHEEL_CLICK_ACTION_TEXT[TabWheelClickAction] {
  return TABWHEEL_CLICK_ACTION_TEXT[action] ?? TABWHEEL_CLICK_ACTION_TEXT.search;
}

export function formatTabWheelClickActionLabel(action: TabWheelClickAction): string {
  return getClickActionText(action).label;
}

export function describeTabWheelClickAction(action: TabWheelClickAction): string {
  return getClickActionText(action).description;
}

export function describeTabWheelClickActionSentence(action: TabWheelClickAction): string {
  const description = describeTabWheelClickAction(action);
  return `${description.charAt(0).toUpperCase()}${description.slice(1)}.`;
}

export function summarizeTabWheelClickAction(action: TabWheelClickAction): string | null {
  return getClickActionText(action).summary;
}

export function formatTabWheelModifierCombo(
  modifier: TabWheelModifierKey,
  withShift: boolean,
): string {
  const baseModifier = formatTabWheelModifierKey(modifier);
  return withShift ? `${baseModifier} + Shift` : baseModifier;
}

export async function loadTabWheelSettings(): Promise<TabWheelSettings> {
  try {
    const data = await browser.storage.local.get(TABWHEEL_STORAGE_KEYS.settings);
    return normalizeTabWheelSettings(data[TABWHEEL_STORAGE_KEYS.settings]);
  } catch (_) {
    return { ...DEFAULT_TABWHEEL_SETTINGS };
  }
}

export async function saveTabWheelSettings(
  settings: TabWheelSettings,
): Promise<void> {
  await browser.storage.local.set({
    [TABWHEEL_STORAGE_KEYS.settings]: normalizeTabWheelSettings(settings),
  });
}
