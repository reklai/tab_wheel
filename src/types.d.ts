interface ScrollData {
  scrollX: number;
  scrollY: number;
  scrollRatioX: number;
  scrollRatioY: number;
  scrollWidth: number;
  scrollHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

interface TabWheelScrollMemoryEntry {
  tabId: number;
  windowId: number;
  url: string;
  scrollX: number;
  scrollY: number;
  scrollRatioX: number;
  scrollRatioY: number;
  scrollWidth: number;
  scrollHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  updatedAt: number;
}

type TabWheelModifierKey = "alt" | "ctrl" | "meta";
type TabWheelCycleScope = "general" | "mru";
type TabWheelPreset = "precise" | "balanced" | "fast" | "custom";
type TabWheelCycleSource = "gesture" | "popup";
type TabWheelMiddleClickAction = "openSettings" | "none";
type TabWheelContentScriptStatus = "ready" | "unavailable";
type TabWheelMruState = Record<string, number[]>;
type TabWheelDeviceKind = "discreteWheel" | "freeSpinWheel" | "trackpad" | "unknown";

interface TabWheelContentScriptActivationResult {
  attempted: number;
  injected: number;
  skipped: number;
  failed: number;
}

interface TabWheelSettings {
  invertScroll: boolean;
  gestureModifier: TabWheelModifierKey;
  gestureWithShift: boolean;
  allowGesturesInEditableFields: boolean;
  middleClickAction: TabWheelMiddleClickAction;
  cycleScope: TabWheelCycleScope;
  restorePagePosition: boolean;
  skipPinnedTabs: boolean;
  skipRestrictedPages: boolean;
  skipHiddenTabs: boolean;
  wrapAround: boolean;
  wheelPreset: TabWheelPreset;
  wheelSensitivity: number;
  wheelCooldownMs: number;
  wheelAcceleration: boolean;
  horizontalWheel: boolean;
  overshootGuard: boolean;
}

interface TabWheelOnboardingState {
  version: number;
  demoCompleted: boolean;
  firstGestureCycleCompleted: boolean;
  focusedReleaseSeen: boolean;
}

interface TabWheelActionResult {
  ok: boolean;
  reason?: string;
  count?: number;
  tabId?: number;
  cycleScope?: TabWheelCycleScope;
}

interface TabWheelRefreshResult extends TabWheelActionResult {
  overview?: TabWheelOverview;
  contentScriptStatus: TabWheelContentScriptStatus;
  injected?: boolean;
}

interface TabWheelStatusOptions {
  suppressPageStatus?: boolean;
}

interface TabWheelOverview {
  activeIndex: number;
  activeTabId?: number;
  tabCount: number;
  cycleScope: TabWheelCycleScope;
  contentScriptStatus: TabWheelContentScriptStatus;
  firstGestureCycleCompleted: boolean;
}
