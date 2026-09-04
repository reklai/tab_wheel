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
type TabWheelPreset = "precise" | "balanced" | "fast" | "custom";
type TabWheelCycleSource = "gesture" | "popup";
type TabWheelMoveDirection = "left" | "right";
type TabWheelClickAction =
  | "nativeNewTab"
  | "recentTab"
  | "closeToRecent"
  | "duplicateTab"
  | "dragCurrentTab"
  | "openSettings"
  | "muteTab"
  | "goBack"
  | "goForward"
  | "none";
type TabWheelContentScriptStatus = "ready" | "unavailable";
type TabWheelRecentTabState = Record<string, number[]>;

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
  leftClickAction: TabWheelClickAction;
  middleClickAction: TabWheelClickAction;
  rightClickAction: TabWheelClickAction;
  restorePagePosition: boolean;
  skipPinnedTabs: boolean;
  skipRestrictedPages: boolean;
  skipHiddenTabs: boolean;
  showRestrictedBadge: boolean;
  wrapAround: boolean;
  cycleWithinTabGroup: boolean;
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
  clickActionsReleaseSeen: boolean;
}

interface TabWheelActionResult {
  ok: boolean;
  reason?: string;
  count?: number;
  tabId?: number;
}

interface TabWheelMoveResult extends TabWheelActionResult {
  moved: boolean;
  index?: number;
}

interface TabWheelRefreshResult extends TabWheelActionResult {
  overview?: TabWheelOverview;
  contentScriptStatus: TabWheelContentScriptStatus;
  injected?: boolean;
}

interface TabWheelOverview {
  activeIndex: number;
  activeTabId?: number;
  tabCount: number;
  contentScriptStatus: TabWheelContentScriptStatus;
  firstGestureCycleCompleted: boolean;
}
