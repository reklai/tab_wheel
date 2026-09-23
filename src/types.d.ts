// Global types shared by every context: content script, background, and the
// extension pages. Declared ambient so contracts, cores, and entry points can
// use them without imports. Nothing here exists at runtime.

/**
 * A page's scroll position and the layout it was taken in. When the page
 * later has a similar size, the absolute position is restored; otherwise the
 * ratios are, so a reflowed page lands at the same relative spot.
 */
interface ScrollData {
  /** Absolute scroll offsets, in CSS px. */
  scrollX: number;
  scrollY: number;
  /** Offsets as a fraction (0-1) of the maximum scroll on each axis. */
  scrollRatioX: number;
  scrollRatioY: number;
  /** Document and viewport size, in CSS px, when the position was taken. */
  scrollWidth: number;
  scrollHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

/** One saved scroll position, as stored in scroll memory. */
interface TabWheelScrollMemoryEntry {
  tabId: number;
  windowId: number;
  /** The page URL, normalized; a position is only restored to the same URL. */
  url: string;
  scrollX: number;
  scrollY: number;
  scrollRatioX: number;
  scrollRatioY: number;
  scrollWidth: number;
  scrollHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  /** Date.now() at the last save; the oldest entries are evicted first. */
  updatedAt: number;
}

/** The key the wheel gesture is bound to (Shift is a separate flag). */
type TabWheelModifierKey = "alt" | "ctrl" | "meta";
/** A named wheel preset, or "custom" for values that match none. */
type TabWheelPreset = "precise" | "balanced" | "fast" | "custom";
/** Who asked for a cycle; only real gestures count toward first-use progress. */
type TabWheelCycleSource = "gesture" | "popup";
/** Direction of a tab drag step: "right" moves to a higher tab index. */
type TabWheelMoveDirection = "left" | "right";
/** What a mapped mouse button does; "none" leaves the button to the page. */
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
/** Whether the tab has a live content script that can take gestures. */
type TabWheelContentScriptStatus = "ready" | "unavailable";
/** Recent-tab history: tab ids per window id, most recently active first. */
type TabWheelRecentTabState = Record<string, number[]>;

/**
 * Counts from injecting content scripts into every open tab. Discarded and
 * restricted tabs are "skipped" and never counted as attempted.
 */
interface TabWheelContentScriptActivationResult {
  attempted: number;
  injected: number;
  skipped: number;
  failed: number;
}

/**
 * The user's settings, as stored and after normalization. Several flags are
 * internal reliability rules rather than user choices and always normalize to
 * true; see normalizeTabWheelSettings.
 */
interface TabWheelSettings {
  /** Swaps which wheel direction goes to the next tab. */
  invertScroll: boolean;
  gestureModifier: TabWheelModifierKey;
  /** Whether Shift must also be held for the wheel gesture. */
  gestureWithShift: boolean;
  allowGesturesInEditableFields: boolean;
  leftClickAction: TabWheelClickAction;
  middleClickAction: TabWheelClickAction;
  rightClickAction: TabWheelClickAction;
  /** "Drag speed" multiplier; pointer travel per slot is 96px / this. */
  tabDragSensitivity: number;
  /** Restore each page's scroll position when switching back to it. */
  restorePagePosition: boolean;
  skipPinnedTabs: boolean;
  /** Skip pages TabWheel cannot run on when cycling. */
  skipRestrictedPages: boolean;
  /** Skip tabs in collapsed tab groups when cycling. */
  skipHiddenTabs: boolean;
  /** Show a "!" toolbar badge on pages TabWheel cannot run on. */
  showRestrictedBadge: boolean;
  /** Cycle from the last tab to the first and back. */
  wrapAround: boolean;
  /** Cycle only among tabs in the current tab's group. */
  cycleWithinTabGroup: boolean;
  wheelPreset: TabWheelPreset;
  /** Wheel multiplier; the wheel travels 80px / this per switch. */
  wheelSensitivity: number;
  /** Least time, in ms, between two wheel switches. */
  wheelCooldownMs: number;
  /** Shorten the trigger distance during a quick burst of switches. */
  wheelAcceleration: boolean;
  /** Also switch on horizontal wheel input (tilt wheels, sideways swipes). */
  horizontalWheel: boolean;
  /**
   * Drop the leftover distance whenever a switch is blocked by the cooldown,
   * so a fast spin cannot bank distance for extra switches.
   */
  overshootGuard: boolean;
}

/** First-run progress. Stored apart from settings, and a settings reset keeps it. */
interface TabWheelOnboardingState {
  version: number;
  /** The user finished the onboarding page's gesture demo. */
  demoCompleted: boolean;
  /** The user has switched tabs with a real wheel gesture at least once. */
  firstGestureCycleCompleted: boolean;
  /** The user finished the onboarding page, which introduces click actions. */
  clickActionsReleaseSeen: boolean;
}

/** The reply to a background action. */
interface TabWheelActionResult {
  ok: boolean;
  /** Why the action failed, as user-facing copy shown as-is. */
  reason?: string;
  count?: number;
  /** The tab the action created, activated, or acted on. */
  tabId?: number;
}

/** The reply to one tab-drag step. */
interface TabWheelMoveResult extends TabWheelActionResult {
  /** False when the tab stayed put, e.g. at a pinned or group boundary. */
  moved: boolean;
  /** The tab's index after the step. */
  index?: number;
}

/** What the popup shows about the current window. */
interface TabWheelOverview {
  /** The active tab's position among the tabs a gesture can reach (0 if none). */
  activeIndex: number;
  activeTabId?: number;
  /** How many tabs in the window a gesture can reach. */
  tabCount: number;
  contentScriptStatus: TabWheelContentScriptStatus;
  firstGestureCycleCompleted: boolean;
}
