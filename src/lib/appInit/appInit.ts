/**
 * The TabWheel content script. It runs in every frame of every page Chrome
 * lets extensions into, and it is the only part of TabWheel that sees input
 * on web pages. It recognizes gestures, swallows their events so the page never
 * reacts to them, and sends each resulting action to the background service
 * worker, which does the actual tab work.
 *
 * Everything is set up inside initApp. The main flows:
 *
 * - Wheel switching (wheelHandler): chord check -> measure the event
 *   (notch or continuous stream) -> drop Chrome's inertia events -> arrival
 *   and momentum guards -> accumulate distance -> past the trigger distance,
 *   runWheelCycle switches one tab, subject to the cooldown.
 * - Click actions (mouseGestureHandler): a modified button press opens a
 *   short session that swallows every event of that click and runs the
 *   configured action once, on the click's terminal event.
 * - Drag current tab: a modified press-and-drag moves the active tab one slot
 *   at a time toward the pointer (see ActiveTabDragGesture).
 * - Scroll memory (top frame only): the scroll position is saved on a
 *   debounce and restored when the background sends SET_SCROLL.
 * - Status pill (showStatus): the only UI TabWheel ever draws on a page.
 *
 * Logic that can be tested without a DOM lives in src/lib/core/tabWheel/:
 * tabWheelCore.ts (modifier chord, wheel measurement, trigger distance),
 * momentumGuardCore.ts, mouseGestureCore.ts, and tabDragCore.ts. This file
 * owns the listeners and the mutable state and wires those pieces together.
 *
 * initApp can run more than once in one document (install, update, and
 * refresh all re-inject), so it always runs the previous injection's cleanup
 * hook first; listeners must never stack.
 */

import browser from "webextension-polyfill";
import {
  DEFAULT_TABWHEEL_SETTINGS,
  loadTabWheelSettings,
  normalizeTabWheelSettings,
  TABWHEEL_STORAGE_KEYS,
} from "../common/contracts/tabWheel";
import { NOTICE_ENTER_MS, NOTICE_EXIT_MS, noticeDisplayMs, prefersReducedMotion } from "../common/utils/notice";
import { ContentRuntimeMessage } from "../common/contracts/runtimeMessages";
import { sleep } from "../common/utils/asyncFlow";
import {
  isTabWheelModifier,
  measureWheelInput,
  resolveAcceleratedWheelTriggerDistance,
  resolveWheelDirection,
  resolveWheelTriggerDistance,
} from "../core/tabWheel/tabWheelCore";
import {
  isTabDragButtonPressed,
  resolveTabDragStepPx,
  resolveTabDragTargetOffset,
  TabDragDirection,
} from "../core/tabWheel/tabDragCore";
import {
  buildMouseGesturePolicies,
  createMouseGestureSession,
  isMouseGestureEventForSession,
  isMouseGestureSessionExpired,
  isMouseGestureSessionStartEvent,
  MOUSE_GESTURE_CLAIM_MS,
  resolveMouseGesturePolicy,
  shouldFinishMouseGestureSession,
  shouldRunMouseGestureSession,
  TabWheelMouseGesturePolicy,
  TabWheelMouseGestureSession,
} from "../core/tabWheel/mouseGestureCore";
import {
  createMomentumGuardSession,
  DEFAULT_MOMENTUM_GUARD_TUNING,
  MomentumGuardSession,
  shouldBlockWheelDelta,
} from "../core/tabWheel/momentumGuardCore";
import {
  activateMostRecentTabWheelTab,
  beginTabWheelDragGesture,
  closeCurrentTabWheelTabAndActivateRecent,
  cycleTabWheel,
  duplicateCurrentTabWheelTab,
  endTabWheelDragGesture,
  goBackInCurrentTabWheelTab,
  goForwardInCurrentTabWheelTab,
  moveCurrentTabWheelTab,
  notifyTabWheelContentReady,
  openNativeNewTabWheelTab,
  openTabWheelOptions,
  saveTabWheelScrollPosition,
  toggleMuteCurrentTabWheelTab,
} from "../adapters/runtime/tabWheelApi";

declare global {
  interface Window {
    /** Tears down the current injection. The next initApp calls it first. */
    __tabWheelCleanup?: () => void;
    /**
     * A button whose remaining events (release, click, contextmenu) must still
     * be swallowed; expiresAt is a Date.now() deadline. It lives on window, not
     * in initApp's closure, so a re-injection that lands mid-click inherits it.
     */
    __tabWheelMouseClaim?: {
      button: number;
      expiresAt: number;
    };
  }
}

/** Quiet time after the last scroll before the position is sent for saving. */
const SCROLL_SAVE_DEBOUNCE_MS = 700;
/**
 * How long after a programmatic restore scroll to ignore scroll events, so the
 * restore's own scrolling is not saved back as the user's position.
 */
const SCROLL_RESTORE_SUPPRESS_SAVE_MS = 450;
/**
 * Wheel distance per switch at sensitivity 1; the sensitivity setting divides
 * it. Every preset resolves to 100px or less, so one notch (floored to
 * WHEEL_NOTCH_PX) always switches one tab. test/tabwheel-core.test.mjs pins
 * the Precise preset at exactly 100px.
 */
const WHEEL_TRIGGER_THRESHOLD_PX = 80;
/**
 * How long after a tab becomes visible a wheel event can still be the tail of
 * the gesture that switched to it, rather than new input from the user. A
 * handed-off tail is a continuous 8-16ms stream, so its next event lands almost
 * immediately; a detented notch cannot arrive faster than its own ~40ms
 * cadence. The window must stay under that cadence or clicky wheels lose a
 * notch on every switch. Pinned by test/runtime-wiring.test.mjs.
 */
const WHEEL_ARRIVAL_GUARD_WINDOW_MS = 32;
/**
 * A continuous wheel stream (trackpad, Magic Mouse) that goes quiet this long
 * has ended: lifting and re-placing fingers for the next swipe takes longer,
 * while the events inside one swipe, even a slow one, arrive far more often.
 */
const WHEEL_GESTURE_IDLE_MS = 250;
/**
 * Minimum gap between worker pre-warm pings. MV3 stops the service worker
 * after ~30s idle, and a cold start adds ~50-300ms to the first switch after a
 * pause. Crossing the trigger distance already takes 30-150ms of wheel motion,
 * so a ping sent when the chord is recognized hides the wake behind it. One
 * ping per 15s stays under the idle limit without a message per wheel event.
 */
const WORKER_PREWARM_INTERVAL_MS = 15000;
/**
 * KeyboardEvent.key for each configurable gesture modifier, so the modifier
 * press itself (which comes before the first wheel event) can pre-warm too.
 */
const MODIFIER_PREWARM_KEYS = { alt: "Alt", ctrl: "Control", meta: "Meta" } as const;
/**
 * A switch within this long of the previous one continues a burst. With
 * acceleration on, each burst step shortens the trigger distance.
 */
const WHEEL_ACCELERATION_WINDOW_MS = 700;
/** Shown when the message to the background itself fails, not the action. */
const ACTION_UNREACHABLE_STATUS =
  "TabWheel couldn't reach the browser. Use Refresh extension in the popup.";
/**
 * How often a held drag re-announces itself to the background. It must stay
 * well under MV3's ~30s idle limit so the worker, and the drag's slot in it,
 * stay alive while the pointer holds still.
 */
const TAB_DRAG_KEEPALIVE_MS = 15000;
/** DOM id of the status pill, so a re-injection reuses or removes the same node. */
const STATUS_ID = "tw-status-indicator";
/**
 * Retry schedule for a scroll restore, in ms between attempts. Pages that load
 * content late keep growing after they look ready, so a restore is re-applied
 * until the position sticks or the schedule runs out.
 */
const SCROLL_RESTORE_DELAYS_MS = [0, 80, 220, 500, 900, 1500, 2400, 3600];
/**
 * A restore first waits for the page's scroll size to hold still (within
 * LAYOUT_DIMENSION_TOLERANCE_PX) for LAYOUT_STABILITY_REQUIRED_FRAMES frames,
 * giving up after LAYOUT_STABILITY_TIMEOUT_MS.
 */
const LAYOUT_STABILITY_TIMEOUT_MS = 1600;
const LAYOUT_STABILITY_REQUIRED_FRAMES = 3;
const LAYOUT_DIMENSION_TOLERANCE_PX = 4;
/**
 * A saved layout still counts as the same one when each dimension is within
 * this fraction (or LAYOUT_DIMENSION_TOLERANCE_PX) of the saved size. Beyond
 * that, the restore uses the saved relative position instead of the pixels.
 */
const LAYOUT_DIMENSION_MATCH_RATIO = 0.08;

/**
 * A live "Drag current tab" gesture. The tab lives in the browser's tab strip,
 * which a page extension cannot see or draw in, so the drag is a closed loop:
 * we track where the pointer is and, on each background round-trip, move the
 * tab one slot toward that live position. Because nothing is queued, a stopped
 * or reversed pointer settles the tab exactly where it is, instead of replaying
 * a backlog and overshooting.
 */
interface ActiveTabDragGesture {
  /**
   * The pointer this drag is bound to; events from any other pointer id are
   * ignored so a second finger or stylus cannot hijack the drag.
   */
  pointerId: number;
  /**
   * The physical button held down (0 left, 1 middle, 2 right), used to
   * recognise this drag's own release and completion events.
   */
  button: number;
  /**
   * Correlates this drag's begin/move/end messages in the background, which
   * serialises drags per window so two windows cannot fight over one tab.
   */
  gestureId: string;
  /**
   * The element pointer capture was taken on, so movement keeps reaching us
   * when the cursor leaves it. Null when the event target was not an Element.
   */
  captureTarget: Element | null;

  // Closed-loop position model:
  /**
   * Pointer clientX where the drag began. The target slot is measured from
   * here, so the mapping is anchored to the gesture's start, not the last move.
   */
  startX: number;
  /**
   * The pointer's most recent X. The drain reads this live each step and moves
   * toward it; this is what makes the drag target-seeking rather than a queue.
   */
  latestClientX: number;
  /**
   * How many slots the tab has actually moved. The next move is one step toward
   * (target - appliedOffset); when they are equal the tab is under the pointer
   * and the drain rests.
   */
  appliedOffset: number;
  /**
   * The direction that last hit a pinned or tab-group edge. Moving that way is
   * suppressed until the pointer asks for the other way, so pushing against an
   * edge does not spin.
   */
  blockedDirection: TabDragDirection | null;

  // Lifecycle:
  /**
   * True while a move is awaiting the background, so only one move is ever in
   * flight. That single in-flight move is the one step a reversal cannot undo.
   */
  moveInFlight: boolean;
  /**
   * True once the button is up. The gesture then finishes as soon as the tab
   * reaches the pointer instead of cancelling mid-drag.
   */
  released: boolean;
  /**
   * True once the terminal click/auxclick/contextmenu for this button arrived,
   * confirming the browser considers the interaction complete.
   */
  completionReceived: boolean;
  /**
   * Set when the drag is abandoned (button released early, pointer lost). The
   * drain and finish paths bail as soon as they see it.
   */
  cancelled: boolean;
  /**
   * Timer id for the grace period that waits for a late completion event after
   * release, so a drag that never gets one still tears down. 0 when unset.
   */
  finishTimer: number;
  /**
   * Resolves once the background gives this drag its turn (after any earlier
   * drag in the window); every move awaits it. Rejects if the background
   * refuses the drag.
   */
  waitForPreviousDrag: Promise<void>;
  /** Gives up this drag's turn in the per-window queue and stops its keepalive. */
  releaseDragQueue: () => void;
}

/**
 * True when the target is inside a text-entry control. Gestures there are left
 * to the page unless the user turned on allowGesturesInEditableFields.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(
    "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='textbox']",
  ) !== null;
}

/**
 * The document's full scrollable size. Pages disagree on whether <html> or
 * <body> carries it, so take the largest of both elements' measurements.
 */
function getPageScrollWidth(): number {
  const documentElement = document.documentElement;
  const body = document.body;
  return Math.max(
    documentElement?.scrollWidth || 0,
    body?.scrollWidth || 0,
    documentElement?.offsetWidth || 0,
    body?.offsetWidth || 0,
    documentElement?.clientWidth || 0,
    body?.clientWidth || 0,
  );
}

function getPageScrollHeight(): number {
  const documentElement = document.documentElement;
  const body = document.body;
  return Math.max(
    documentElement?.scrollHeight || 0,
    body?.scrollHeight || 0,
    documentElement?.offsetHeight || 0,
    body?.offsetHeight || 0,
    documentElement?.clientHeight || 0,
    body?.clientHeight || 0,
  );
}

/** Largest scroll offsets the current layout allows. */
function getMaxScrollX(): number {
  return Math.max(0, getPageScrollWidth() - window.innerWidth);
}

function getMaxScrollY(): number {
  return Math.max(0, getPageScrollHeight() - window.innerHeight);
}

function clampScrollX(scrollX: number): number {
  return Math.max(0, Math.min(scrollX, getMaxScrollX()));
}

function clampScrollY(scrollY: number): number {
  return Math.max(0, Math.min(scrollY, getMaxScrollY()));
}

/**
 * The root scroller's position plus the layout it was taken in. The sizes and
 * ratios let a later restore tell whether the page still has the same layout,
 * and fall back to a relative position when it does not.
 */
function getRootScrollSnapshot(): ScrollData {
  const scrollX = Math.max(0, window.scrollX);
  const scrollY = Math.max(0, window.scrollY);
  const scrollWidth = getPageScrollWidth();
  const scrollHeight = getPageScrollHeight();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const maxScrollX = Math.max(0, scrollWidth - viewportWidth);
  const maxScrollY = Math.max(0, scrollHeight - viewportHeight);
  return {
    scrollX,
    scrollY,
    scrollRatioX: maxScrollX > 0 ? Math.max(0, Math.min(1, scrollX / maxScrollX)) : 0,
    scrollRatioY: maxScrollY > 0 ? Math.max(0, Math.min(1, scrollY / maxScrollY)) : 0,
    scrollWidth,
    scrollHeight,
    viewportWidth,
    viewportHeight,
  };
}

/**
 * True when current is close enough to a saved size to call it the same
 * layout. A missing (zero or non-finite) saved size never matches.
 */
function hasSimilarDimension(current: number, stored: number): boolean {
  if (!Number.isFinite(stored) || stored <= 0) return false;
  return Math.abs(current - stored)
    <= Math.max(LAYOUT_DIMENSION_TOLERANCE_PX, stored * LAYOUT_DIMENSION_MATCH_RATIO);
}

/**
 * Where to scroll to restore snapshot, decided per axis. If the layout matches
 * the saved one, or the snapshot has no layout to compare, restore the exact
 * pixel offset; if it changed (resized window, different content), restore the
 * same relative position instead.
 */
function resolveRootScrollTarget(snapshot: ScrollData): { left: number; top: number } {
  const current = getRootScrollSnapshot();
  const hasStoredWidth = snapshot.scrollWidth > 0 && snapshot.viewportWidth > 0;
  const hasStoredHeight = snapshot.scrollHeight > 0 && snapshot.viewportHeight > 0;
  const hasSimilarWidth = hasSimilarDimension(current.scrollWidth, snapshot.scrollWidth)
    && hasSimilarDimension(current.viewportWidth, snapshot.viewportWidth);
  const hasSimilarHeight = hasSimilarDimension(current.scrollHeight, snapshot.scrollHeight)
    && hasSimilarDimension(current.viewportHeight, snapshot.viewportHeight);
  const maxScrollX = Math.max(0, current.scrollWidth - current.viewportWidth);
  const maxScrollY = Math.max(0, current.scrollHeight - current.viewportHeight);
  const ratioX = Number.isFinite(snapshot.scrollRatioX)
    ? Math.max(0, Math.min(1, snapshot.scrollRatioX))
    : 0;
  const ratioY = Number.isFinite(snapshot.scrollRatioY)
    ? Math.max(0, Math.min(1, snapshot.scrollRatioY))
    : 0;
  return {
    left: !hasStoredWidth || hasSimilarWidth ? clampScrollX(snapshot.scrollX) : Math.round(maxScrollX * ratioX),
    top: !hasStoredHeight || hasSimilarHeight ? clampScrollY(snapshot.scrollY) : Math.round(maxScrollY * ratioY),
  };
}

/**
 * Resolves true once the page's scroll size has held still for a few frames,
 * or when LAYOUT_STABILITY_TIMEOUT_MS passes. Resolves false as soon as
 * shouldContinue reports the restore was superseded. Restoring into a page
 * that is still growing would clamp to a max offset that is about to change.
 */
async function waitForLayoutStability(shouldContinue: () => boolean): Promise<boolean> {
  const startedAt = performance.now();
  let stableFrames = 0;
  let previousWidth = getPageScrollWidth();
  let previousHeight = getPageScrollHeight();

  while (performance.now() - startedAt < LAYOUT_STABILITY_TIMEOUT_MS) {
    if (!shouldContinue()) return false;
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    if (!shouldContinue()) return false;
    const width = getPageScrollWidth();
    const height = getPageScrollHeight();
    if (
      Math.abs(width - previousWidth) <= LAYOUT_DIMENSION_TOLERANCE_PX
      && Math.abs(height - previousHeight) <= LAYOUT_DIMENSION_TOLERANCE_PX
    ) {
      stableFrames += 1;
      if (stableFrames >= LAYOUT_STABILITY_REQUIRED_FRAMES) return true;
    } else {
      stableFrames = 0;
      previousWidth = width;
      previousHeight = height;
    }
  }
  return shouldContinue();
}

/**
 * Hides an event from the page completely: no default action and no page
 * listener. Our listeners sit on window in the capture phase, the first stop
 * of every event's path, so the page never sees what we stop here.
 */
function suppressPageEvent(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

/** True in the top-level document. If window.top cannot be read, assume a subframe. */
function isTopFrame(): boolean {
  try {
    return window.top === window;
  } catch (_) {
    return false;
  }
}

/**
 * Installs TabWheel on this document: loads settings, registers every
 * listener, and publishes a cleanup hook on window. Safe to call repeatedly.
 * The body must start with the previous injection's cleanup, before anything
 * is attached, so listeners never stack (pinned by test/zero-reload.test.mjs).
 */
export function initApp(): void {
  window.__tabWheelCleanup?.();

  const isTopFrameContext = isTopFrame();
  let settings: TabWheelSettings = { ...DEFAULT_TABWHEEL_SETTINGS };
  // Every gesture is ignored until stored settings arrive, so a user's chosen
  // modifier is never judged against the defaults.
  let areSettingsLoaded = false;
  let statusTimer = 0;
  // True between pagehide and pageshow: the document is unloading or sitting
  // in the back/forward cache, so a late action failure must stay quiet.
  let pageHidden = false;
  let scrollSaveTimer = 0;
  let lastScrollSaveX = Number.NaN;
  let lastScrollSaveY = Number.NaN;
  let suppressScrollSaveUntil = 0;
  // Bumped to cancel a restore in flight; each restore checks it between steps.
  let scrollRestoreToken = 0;
  // Signed wheel distance collected toward the next switch.
  let wheelAccumulator = 0;
  // Magnitude of the most recent delta accumulated into the current gesture.
  // This is the envelope the momentum guard inherits on commit: a tail starts
  // from the magnitude the gesture ended on, which is also why it can never
  // trip the guard's ramp escape.
  let lastGestureMagnitudePx = 0;
  // When this document last became visible; the arrival guard's clock.
  let lastVisibleAtMs = 0;
  // Time of the previous gesture wheel event, for detecting an idle stream.
  let lastWheelEventAt = 0;
  // Shared by the wheel and keydown pre-warms, so they rate-limit together.
  let lastWorkerPrewarmAt = 0;
  // Time of the last switch (cooldown and burst clock) and the burst level.
  let lastWheelCycleAt = 0;
  let wheelBurstCount = 0;
  let mouseGesturePolicies = buildMouseGesturePolicies(settings);
  let mouseGestureSession: TabWheelMouseGestureSession | null = null;
  let tabDragGesture: ActiveTabDragGesture | null = null;
  let momentumGuardSession: MomentumGuardSession | null = null;

  // Settings count as loaded even if the read fails, so gestures still work
  // with the defaults.
  void loadTabWheelSettings()
    .then((loadedSettings) => {
      settings = loadedSettings;
      mouseGesturePolicies = buildMouseGesturePolicies(settings);
    })
    .finally(() => {
      areSettingsLoaded = true;
    });

  /**
   * The only thing TabWheel ever draws on a page: a one-line notice at the
   * bottom edge for a gesture that landed but could not do its job. The same
   * pill as the popup toast and the settings status; it never takes the
   * centre, never takes input, and leaves on its own. Styled inline because
   * the content script ships no stylesheet.
   */
  function showStatus(message: string): void {
    const reduceMotion = prefersReducedMotion();
    const hidden = "translate(-50%,6px) scale(0.96)";
    const shown = "translate(-50%,0) scale(1)";
    let status = document.getElementById(STATUS_ID);
    if (!status) {
      status = document.createElement("div");
      status.id = STATUS_ID;
      status.setAttribute("role", "status");
      status.style.cssText = [
        "position:fixed",
        "left:50%",
        "bottom:24px",
        "z-index:2147483646",
        "box-sizing:border-box",
        "width:max-content",
        "max-width:min(440px,calc(100vw - 32px))",
        "min-height:34px",
        "display:flex",
        "align-items:center",
        "padding:8px 14px",
        "border-radius:999px",
        "background:rgba(28, 28, 30, 0.72)",
        "backdrop-filter:blur(24px) saturate(160%)",
        "-webkit-backdrop-filter:blur(24px) saturate(160%)",
        "box-shadow:0 8px 24px rgba(0, 0, 0, 0.28), inset 0 0 0 1px rgba(255, 255, 255, 0.12)",
        "color:rgba(255, 255, 255, 0.92)",
        "font:500 13px/1.3 -apple-system, BlinkMacSystemFont, system-ui, \"Segoe UI\", sans-serif",
        "letter-spacing:-0.01em",
        "text-align:center",
        "white-space:normal",
        "pointer-events:none",
        "opacity:0",
        `transform:${hidden}`,
        reduceMotion
          ? ""
          : `transition:opacity ${NOTICE_ENTER_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1), transform ${NOTICE_ENTER_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`,
      ].join(";");
      document.documentElement.appendChild(status);
    }
    status.textContent = message;
    const visible = status;
    window.requestAnimationFrame(() => {
      visible.style.opacity = "1";
      visible.style.transform = shown;
    });
    if (statusTimer) window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
      visible.style.opacity = "0";
      visible.style.transform = hidden;
      statusTimer = window.setTimeout(() => {
        visible.remove();
        statusTimer = 0;
      }, reduceMotion ? 0 : NOTICE_EXIT_MS);
    }, noticeDisplayMs(message));
  }

  /**
   * Sends the current scroll position to the background, which keeps it per
   * tab. Skipped while a restore is scrolling the page and when nothing moved.
   */
  function sendScrollSnapshot(): void {
    if (!settings.restorePagePosition || Date.now() < suppressScrollSaveUntil) return;
    const snapshot = getRootScrollSnapshot();
    if (snapshot.scrollX === lastScrollSaveX && snapshot.scrollY === lastScrollSaveY) return;
    lastScrollSaveX = snapshot.scrollX;
    lastScrollSaveY = snapshot.scrollY;
    void saveTabWheelScrollPosition(snapshot).catch(() => {});
  }

  /** Sends a pending save now, for a page being hidden or unloaded. */
  function flushScrollSnapshot(): void {
    if (scrollSaveTimer) {
      window.clearTimeout(scrollSaveTimer);
      scrollSaveTimer = 0;
    }
    sendScrollSnapshot();
  }

  /** The scroll listener: saves once scrolling has been quiet for a moment. */
  function scheduleScrollSnapshot(): void {
    if (!settings.restorePagePosition || Date.now() < suppressScrollSaveUntil) return;
    if (scrollSaveTimer) window.clearTimeout(scrollSaveTimer);
    scrollSaveTimer = window.setTimeout(() => {
      scrollSaveTimer = 0;
      sendScrollSnapshot();
    }, SCROLL_SAVE_DEBOUNCE_MS);
  }

  /** Invalidates any restore in flight; it stops at its next token check. */
  function cancelScrollRestore(): void {
    scrollRestoreToken += 1;
  }

  /**
   * Scrolls once toward snapshot and reports whether the page actually landed
   * there (within 2px) a frame later. A page still growing clamps the scroll
   * short, which is what the retries in restoreWindowScroll wait out.
   */
  async function applyScrollRestoreAttempt(snapshot: ScrollData): Promise<boolean> {
    suppressScrollSaveUntil = Date.now() + SCROLL_RESTORE_SUPPRESS_SAVE_MS;
    if (scrollSaveTimer) {
      window.clearTimeout(scrollSaveTimer);
      scrollSaveTimer = 0;
    }
    const target = resolveRootScrollTarget(snapshot);
    window.scrollTo({ left: target.left, top: target.top, behavior: "auto" });
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    return Math.abs(window.scrollX - target.left) <= 2 && Math.abs(window.scrollY - target.top) <= 2;
  }

  /**
   * Restores a saved position sent by the background (SET_SCROLL). A restore
   * is abandoned when a newer one starts, the tab is hidden, or scroll memory
   * is turned off.
   */
  async function restoreWindowScroll(snapshot: ScrollData): Promise<void> {
    if (!settings.restorePagePosition) return;
    const token = ++scrollRestoreToken;
    const isCurrentRestore = () => token === scrollRestoreToken
      && document.visibilityState !== "hidden"
      && settings.restorePagePosition;
    if (!isCurrentRestore()) return;
    // An immediate attempt handles a page that is already laid out. Late
    // content can still shift or clamp it, so once layout settles we re-apply
    // on the SCROLL_RESTORE_DELAYS_MS schedule until one attempt sticks.
    await applyScrollRestoreAttempt(snapshot);
    if (!isCurrentRestore() || !await waitForLayoutStability(isCurrentRestore)) return;
    for (const delay of SCROLL_RESTORE_DELAYS_MS) {
      if (!isCurrentRestore()) return;
      if (delay > 0) await sleep(delay);
      if (!isCurrentRestore()) return;
      if (await applyScrollRestoreAttempt(snapshot)) return;
    }
  }

  /**
   * True when this wheel event is a TabWheel gesture: trusted, with the
   * configured modifier chord held, and not in an editable field (unless the
   * user allows that). Always false until settings have loaded.
   */
  function isKeyboardWheelEvent(event: WheelEvent): boolean {
    return areSettingsLoaded
      && event.isTrusted
      && isTabWheelModifier(event, settings.gestureModifier, settings.gestureWithShift)
      && (settings.allowGesturesInEditableFields || !isEditableTarget(event.target));
  }

  /**
   * The configured click action for this event's button, or null when the
   * event is not a gesture (same gating as wheel events) or the button is Off.
   */
  function resolveMousePolicy(event: MouseEvent): TabWheelMouseGesturePolicy | null {
    if (!areSettingsLoaded || !event.isTrusted) return null;
    if (!isTabWheelModifier(event, settings.gestureModifier, settings.gestureWithShift)) return null;
    if (!settings.allowGesturesInEditableFields && isEditableTarget(event.target)) return null;
    return resolveMouseGesturePolicy(event.button, mouseGesturePolicies);
  }

  function resetMouseGestureSession(): void {
    mouseGestureSession = null;
  }

  /**
   * Leaves a claim on window for a drag's button so its release and completion
   * events stay swallowed after the drag state is gone. No claim once the
   * completion event has arrived: nothing is left to swallow.
   */
  function rememberTabDragMouseClaim(session: ActiveTabDragGesture): void {
    if (session.completionReceived) return;
    window.__tabWheelMouseClaim = {
      button: session.button,
      expiresAt: Date.now() + MOUSE_GESTURE_CLAIM_MS,
    };
  }

  /**
   * Run by the cleanup hook. If a click or drag is mid-interaction, leave a
   * claim so the next injection swallows the rest of it instead of handing the
   * page half a click.
   */
  function rememberMouseClaimForReinjection(): void {
    let button = mouseGestureSession?.policy.button;
    if (button === undefined) {
      if (tabDragGesture) {
        rememberTabDragMouseClaim(tabDragGesture);
        return;
      }
    }
    if (button === undefined) return;
    window.__tabWheelMouseClaim = {
      button,
      expiresAt: Date.now() + MOUSE_GESTURE_CLAIM_MS,
    };
  }

  /**
   * The event that ends a click for button: click for left, auxclick for
   * middle, contextmenu for right.
   */
  function isMouseClaimCompletionEvent(button: number, event: MouseEvent): boolean {
    if (button === 0) return event.type === "click";
    if (button === 1) return event.type === "auxclick";
    return event.type === "contextmenu";
  }

  function isMouseClaimReleaseEvent(event: MouseEvent): boolean {
    return event.type === "pointerup" || event.type === "mouseup";
  }

  /**
   * Swallows events that belong to a claimed button's interaction and returns
   * true if it did. Release and completion events are always swallowed, and
   * the completion clears the claim; other events only until expiresAt. A new
   * pointerdown clears the claim first, so it never eats the next interaction.
   */
  function handleCarriedMouseClaim(event: MouseEvent): boolean {
    const claim = window.__tabWheelMouseClaim;
    if (!claim) return false;
    if (event.type === "pointerdown") {
      delete window.__tabWheelMouseClaim;
      return false;
    }
    const matchesButton = event.button === claim.button
      || (claim.button === 2 && event.type === "contextmenu");
    if (!matchesButton) return false;
    if (isMouseClaimReleaseEvent(event) || isMouseClaimCompletionEvent(claim.button, event)) {
      suppressPageEvent(event);
      if (isMouseClaimCompletionEvent(claim.button, event)) {
        delete window.__tabWheelMouseClaim;
      }
      return true;
    }
    if (Date.now() > claim.expiresAt) {
      delete window.__tabWheelMouseClaim;
      return false;
    }
    suppressPageEvent(event);
    return true;
  }

  function releaseTabDragPointerCapture(session: ActiveTabDragGesture): void {
    try {
      if (session.captureTarget?.hasPointerCapture(session.pointerId)) {
        session.captureTarget.releasePointerCapture(session.pointerId);
      }
    } catch (_) {
      // The page may remove the capture target during the drag.
    }
  }

  /**
   * Registers a new drag with the background, which runs drags one at a time
   * per window. The returned promise resolves when this drag's turn comes.
   * While it holds the turn, a keepalive re-sends the begin message every
   * TAB_DRAG_KEEPALIVE_MS; releaseDragQueue stops it and ends the drag there.
   */
  function reserveTabDragQueue(): Pick<
    ActiveTabDragGesture,
    "gestureId" | "waitForPreviousDrag" | "releaseDragQueue"
  > {
    // randomUUID only exists in secure contexts, so http pages need a fallback.
    const gestureId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const waitForPreviousDrag = beginTabWheelDragGesture(gestureId).then((result) => {
      if (!result.ok) throw new Error(result.reason || "Couldn't start the drag");
    });
    let isReleased = false;
    let keepAliveTimer = 0;
    void waitForPreviousDrag
      .then(() => {
        if (isReleased) return;
        keepAliveTimer = window.setInterval(() => {
          void beginTabWheelDragGesture(gestureId).catch(() => {});
        }, TAB_DRAG_KEEPALIVE_MS);
      })
      .catch(() => {});
    return {
      gestureId,
      waitForPreviousDrag,
      releaseDragQueue: () => {
        if (isReleased) return;
        isReleased = true;
        if (keepAliveTimer) window.clearInterval(keepAliveTimer);
        void waitForPreviousDrag
          .catch(() => {})
          .then(() => endTabWheelDragGesture(gestureId))
          .catch(() => {});
      },
    };
  }

  /** Tears down a drag's timer, pointer capture, and queue turn. Idempotent. */
  function resetTabDragGesture(session: ActiveTabDragGesture): void {
    if (session.finishTimer) window.clearTimeout(session.finishTimer);
    releaseTabDragPointerCapture(session);
    session.releaseDragQueue();
    if (tabDragGesture === session) tabDragGesture = null;
  }

  /**
   * The next slot to move toward the live pointer, or null when the tab is
   * already where the pointer is (or can't advance because it hit a boundary
   * in that direction). This is what makes the drag target-seeking: it is
   * recomputed from the current pointer, never replayed from a queue.
   */
  function nextTabDragMove(session: ActiveTabDragGesture): TabDragDirection | null {
    const stepPx = resolveTabDragStepPx(settings.tabDragSensitivity);
    const desiredOffset = resolveTabDragTargetOffset(session.startX, session.latestClientX, stepPx);
    const delta = desiredOffset - session.appliedOffset;
    if (delta === 0) return null;
    const direction: TabDragDirection = delta > 0 ? "right" : "left";
    return session.blockedDirection === direction ? null : direction;
  }

  /**
   * Ends a drag once it is fully over: no move in flight, the tab under the
   * pointer, the button released, and its completion event seen (or its grace
   * period lapsed). Called after every step that could satisfy the last one.
   */
  function finishTabDragGestureWhenIdle(session: ActiveTabDragGesture): void {
    if (
      session.cancelled
      || session.moveInFlight
      || nextTabDragMove(session) !== null
      || !session.released
      || !session.completionReceived
    ) return;
    resetTabDragGesture(session);
  }

  /**
   * Abandons the active drag and leaves the tab where it is. With
   * preserveCompletionClaim, the release and click still to come are claimed
   * so they stay swallowed after the drag state is gone.
   */
  function cancelTabDragGesture(preserveCompletionClaim = false): void {
    const session = tabDragGesture;
    if (!session) return;
    if (preserveCompletionClaim) rememberTabDragMouseClaim(session);
    session.cancelled = true;
    resetTabDragGesture(session);
  }

  /**
   * Cancels a drag only while its button is held. A released drag is left to
   * finish moving the tab to where the pointer let go.
   */
  function cancelUnreleasedTabDragGesture(): void {
    if (!tabDragGesture?.released) cancelTabDragGesture();
  }

  /**
   * Sends one move toward the pointer and, when it returns, recomputes and
   * repeats until the tab is under the pointer. Only one move is ever in
   * flight; pointer movement meanwhile just updates latestClientX.
   */
  function drainTabDragMoves(session: ActiveTabDragGesture): void {
    if (session.cancelled || session.moveInFlight) {
      finishTabDragGestureWhenIdle(session);
      return;
    }
    const direction = nextTabDragMove(session);
    if (!direction) {
      finishTabDragGestureWhenIdle(session);
      return;
    }
    session.moveInFlight = true;
    void session.waitForPreviousDrag
      .then(() => {
        if (session.cancelled || tabDragGesture !== session) return null;
        return moveCurrentTabWheelTab(direction, session.gestureId);
      })
      .then((result) => {
        if (!result || session.cancelled || tabDragGesture !== session) return;
        if (!result.ok) {
          showStatus(result.reason || "Couldn't move this tab");
          cancelTabDragGesture(true);
          return;
        }
        if (!result.moved) {
          // Hit a pinned or tab-group boundary; stop advancing this way until
          // the pointer asks for the other direction.
          session.blockedDirection = direction;
        } else {
          session.appliedOffset += direction === "right" ? 1 : -1;
          session.blockedDirection = null;
        }
      })
      .catch(() => {
        if (session.cancelled || tabDragGesture !== session) return;
        showStatus("Couldn't move this tab");
        cancelTabDragGesture(true);
      })
      .finally(() => {
        session.moveInFlight = false;
        if (session.cancelled || tabDragGesture !== session) return;
        drainTabDragMoves(session);
      });
  }

  /**
   * Starts a drag bound to this pointer and takes pointer capture, so movement
   * keeps arriving after the cursor leaves the pressed element.
   */
  function startTabDragGesture(
    event: PointerEvent,
    policy: TabWheelMouseGesturePolicy,
  ): void {
    const captureTarget = event.target instanceof Element ? event.target : null;
    const dragQueue = reserveTabDragQueue();
    const session: ActiveTabDragGesture = {
      pointerId: event.pointerId,
      button: policy.button,
      captureTarget,
      startX: event.clientX,
      latestClientX: event.clientX,
      appliedOffset: 0,
      blockedDirection: null,
      moveInFlight: false,
      released: false,
      completionReceived: false,
      cancelled: false,
      finishTimer: 0,
      ...dragQueue,
    };
    tabDragGesture = session;
    try {
      captureTarget?.setPointerCapture(event.pointerId);
    } catch (_) {
      // Window-level capture listeners still cover movement inside the page.
    }
  }

  /**
   * Marks the drag's button as released. The tab may still be catching up to
   * the pointer; the finish timer guarantees teardown even if the completion
   * event never arrives.
   */
  function releaseActiveTabDragGesture(session: ActiveTabDragGesture): void {
    if (session.released) return;
    session.released = true;
    releaseTabDragPointerCapture(session);
    scheduleTabDragFinishTimer(session);
    finishTabDragGestureWhenIdle(session);
  }

  /**
   * Waits MOUSE_GESTURE_CLAIM_MS for the completion event after a release,
   * then assumes it, so a drag whose click the browser never fires still ends.
   */
  function scheduleTabDragFinishTimer(session: ActiveTabDragGesture): void {
    if (session.finishTimer) window.clearTimeout(session.finishTimer);
    session.finishTimer = window.setTimeout(() => {
      session.completionReceived = true;
      finishTabDragGestureWhenIdle(session);
    }, MOUSE_GESTURE_CLAIM_MS);
  }

  /**
   * A drag press arrived while a released drag is still moving the tab. The
   * press is swallowed and the draining drag rebinds to it, so it waits for
   * this press's completion event too. The drag stays released, so this
   * press's movement does not steer the tab.
   */
  function claimTabDragPressWhileDraining(
    session: ActiveTabDragGesture,
    event: PointerEvent,
  ): void {
    suppressPageEvent(event);
    session.pointerId = event.pointerId;
    session.button = event.button;
    session.captureTarget = null;
    session.completionReceived = false;
    if (session.finishTimer) {
      window.clearTimeout(session.finishTimer);
      session.finishTimer = 0;
    }
  }

  /**
   * Follows the pointer while the drag button is held. A move without that
   * button pressed means the release happened where we could not see it, so
   * the drag is cancelled.
   */
  function tabDragPointerMoveHandler(event: PointerEvent): void {
    const session = tabDragGesture;
    if (!session || session.released || event.pointerId !== session.pointerId) return;
    if (!isTabDragButtonPressed(session.button, event.buttons)) {
      cancelTabDragGesture();
      return;
    }
    suppressPageEvent(event);
    // Just record where the pointer is now; the drain reads this live and moves
    // toward it, so nothing is queued and the tab cannot overshoot.
    session.latestClientX = event.clientX;
    drainTabDragMoves(session);
  }

  /** The browser took the pointer away; an unreleased drag is abandoned. */
  function tabDragPointerCancelHandler(event: PointerEvent): void {
    const session = tabDragGesture;
    if (!session || event.pointerId !== session.pointerId) return;
    suppressPageEvent(event);
    cancelUnreleasedTabDragGesture();
  }

  /**
   * Capture was lost while the button is held (the page removed the element
   * or took capture itself), so the drag can no longer track the pointer.
   */
  function tabDragPointerCaptureLostHandler(event: PointerEvent): void {
    const session = tabDragGesture;
    if (
      !session
      || session.released
      || session.cancelled
      || event.pointerId !== session.pointerId
    ) return;
    cancelUnreleasedTabDragGesture();
  }

  /** Same mapping as isMouseClaimCompletionEvent, for the drag's button. */
  function isTabDragCompletionEvent(
    session: ActiveTabDragGesture,
    event: MouseEvent,
  ): boolean {
    if (session.button === 0) return event.type === "click";
    if (session.button === 1) return event.type === "auxclick";
    return event.type === "contextmenu";
  }

  /**
   * Swallows the drag's own button events and advances its lifecycle; returns
   * true if the event belonged to the drag. Once the drag is released and its
   * completion seen, events go back to normal handling.
   */
  function handleActiveTabDragMouseEvent(event: MouseEvent): boolean {
    const session = tabDragGesture;
    if (!session) return false;
    if (session.released && session.completionReceived) return false;
    if (
      typeof PointerEvent !== "undefined"
      && event instanceof PointerEvent
      && event.pointerId !== session.pointerId
    ) return false;
    const matchesButton = event.button === session.button
      || (session.button === 2 && event.type === "contextmenu");
    if (!matchesButton) return false;
    suppressPageEvent(event);
    // A second pointerup on a released drag comes from a press folded in by
    // claimTabDragPressWhileDraining; it restarts the wait for completion.
    if (event.type === "pointerup") {
      if (session.released) scheduleTabDragFinishTimer(session);
      else releaseActiveTabDragGesture(session);
    }
    if (isTabDragCompletionEvent(session, event)) {
      session.completionReceived = true;
      if (session.finishTimer) {
        window.clearTimeout(session.finishTimer);
        session.finishTimer = 0;
      }
      finishTabDragGestureWhenIdle(session);
    }
    return true;
  }

  /** The click session this event belongs to, dropping one that has expired. */
  function getActiveMouseGestureSession(event: MouseEvent): TabWheelMouseGestureSession | null {
    if (!mouseGestureSession) return null;
    if (isMouseGestureSessionExpired(mouseGestureSession, Date.now())) {
      resetMouseGestureSession();
      return null;
    }
    return isMouseGestureEventForSession(mouseGestureSession, event)
      ? mouseGestureSession
      : null;
  }

  /**
   * Runs a one-shot background action and shows its failure on the page: the
   * background's reason, or ACTION_UNREACHABLE_STATUS when the message failed.
   */
  async function runActionWithStatus(
    task: () => Promise<TabWheelActionResult>,
  ): Promise<void> {
    let status: string | null = null;
    try {
      const result = await task();
      if (!result.ok) status = result.reason || ACTION_UNREACHABLE_STATUS;
    } catch (_) {
      status = ACTION_UNREACHABLE_STATUS;
    }
    // A successful back/forward unloads this document while the reply is in
    // flight; if it is later restored from bfcache the rejection must not
    // surface as a failure on a page that navigated fine.
    if (pageHidden) return;
    if (status) showStatus(status);
  }

  /**
   * Sends a click action to the background. dragCurrentTab is a no-op here:
   * drags run through the pointer handlers, never as a click session.
   */
  async function executeMouseGestureSession(
    session: TabWheelMouseGestureSession,
  ): Promise<void> {
    switch (session.policy.action) {
      case "nativeNewTab":
        await runActionWithStatus(openNativeNewTabWheelTab);
        return;
      case "recentTab":
        await runActionWithStatus(activateMostRecentTabWheelTab);
        return;
      case "closeToRecent":
        await runActionWithStatus(closeCurrentTabWheelTabAndActivateRecent);
        return;
      case "duplicateTab":
        await runActionWithStatus(duplicateCurrentTabWheelTab);
        return;
      case "dragCurrentTab":
        return;
      case "openSettings":
        await runActionWithStatus(openTabWheelOptions);
        return;
      case "muteTab":
        await runActionWithStatus(toggleMuteCurrentTabWheelTab);
        return;
      case "goBack":
        await runActionWithStatus(goBackInCurrentTabWheelTab);
        return;
      case "goForward":
        await runActionWithStatus(goForwardInCurrentTabWheelTab);
        return;
    }
  }

  /** Runs a click session's action, at most once per session. */
  function runMouseGestureSession(session: TabWheelMouseGestureSession): void {
    if (session.hasRun) return;
    session.hasRun = true;
    // A right-click action runs on contextmenu, which is not the last event of
    // the interaction: pointerup, mouseup, and auxclick still follow. Claim the
    // button so those trailing events are swallowed instead of reaching the
    // page. Left and middle actions run on their terminal event, so their claim
    // just lapses; a fresh pointerdown always clears it.
    window.__tabWheelMouseClaim = {
      button: session.policy.button,
      expiresAt: Date.now() + MOUSE_GESTURE_CLAIM_MS,
    };
    // A released drag is still moving the tab; running another tab action now
    // would act on a tab in mid-move, so this click is swallowed and dropped.
    if (
      tabDragGesture?.released
      && (tabDragGesture.moveInFlight || nextTabDragMove(tabDragGesture) !== null)
    ) {
      return;
    }
    void executeMouseGestureSession(session);
  }

  /**
   * The one capture-phase handler for every button event (pointer, mouse,
   * click, auxclick, contextmenu, dblclick). The order of checks matters:
   * carried claims, then dblclick, then drag bookkeeping on a new press, then
   * the active drag, then the active click session, and last a new gesture.
   */
  function mouseGestureHandler(event: MouseEvent): void {
    if (handleCarriedMouseClaim(event)) return;
    // The browser synthesizes dblclick after two clicks on the same element
    // even when both clicks were swallowed. A claimed button never hands the
    // page a double-click, or two quick toggles would fullscreen a video.
    if (event.type === "dblclick") {
      if (resolveMousePolicy(event)) suppressPageEvent(event);
      return;
    }
    // A new mouse press settles any drag left over. A released drag that is
    // still moving the tab absorbs the press if it starts another drag;
    // otherwise the press proves the old click is over, so we stop waiting
    // for its completion and tear it down once idle. A drag whose button is
    // still held here missed its release and is cancelled.
    if (
      event.type === "pointerdown"
      && typeof PointerEvent !== "undefined"
      && event instanceof PointerEvent
      && event.pointerType === "mouse"
    ) {
      const existingDrag = tabDragGesture;
      if (existingDrag?.released) {
        if (existingDrag.moveInFlight || nextTabDragMove(existingDrag) !== null) {
          const drainingPolicy = resolveMousePolicy(event);
          if (drainingPolicy?.interaction === "drag") {
            claimTabDragPressWhileDraining(existingDrag, event);
            return;
          }
          existingDrag.completionReceived = true;
          if (existingDrag.finishTimer) {
            window.clearTimeout(existingDrag.finishTimer);
            existingDrag.finishTimer = 0;
          }
        }
        if (!existingDrag.moveInFlight && nextTabDragMove(existingDrag) === null) {
          resetTabDragGesture(existingDrag);
        }
      } else if (existingDrag) {
        cancelTabDragGesture();
      }
    }
    if (handleActiveTabDragMouseEvent(event)) {
      return;
    }

    const activeSession = getActiveMouseGestureSession(event);
    if (activeSession) {
      suppressPageEvent(event);
      if (shouldRunMouseGestureSession(activeSession, event.type)) {
        runMouseGestureSession(activeSession);
      }
      if (shouldFinishMouseGestureSession(activeSession, event.type)) {
        resetMouseGestureSession();
      }
      return;
    }

    if (!isMouseGestureSessionStartEvent(event)) return;
    const policy = resolveMousePolicy(event);
    if (!policy) return;
    if (policy.interaction === "drag") {
      // A drag starts only from a real mouse pointerdown, which carries the
      // pointerId used for capture and for matching the drag's later events.
      if (
        event.type !== "pointerdown"
        || typeof PointerEvent === "undefined"
        || !(event instanceof PointerEvent)
        || event.pointerType !== "mouse"
      ) return;
      suppressPageEvent(event);
      startTabDragGesture(event, policy);
      return;
    }
    suppressPageEvent(event);
    mouseGestureSession = createMouseGestureSession(policy, Date.now());
  }

  /**
   * The burst level a switch at now would have: one more than the last switch
   * if it came within WHEEL_ACCELERATION_WINDOW_MS (capped at 6), else 0. Only
   * reads state; runWheelCycle commits it.
   */
  function computeNextBurstCount(now: number): number {
    return now - lastWheelCycleAt <= WHEEL_ACCELERATION_WINDOW_MS
      ? Math.min(wheelBurstCount + 1, 6)
      : 0;
  }

  /**
   * Switches one tab in direction unless the cooldown since the last switch is
   * still running, and returns whether it switched. A switch also arms the
   * momentum guard for the tail of the gesture that caused it. deltaDirection
   * is the raw wheel sign; direction is after invertScroll.
   */
  function runWheelCycle(
    direction: "prev" | "next",
    deltaDirection: 1 | -1,
    now: number,
  ): boolean {
    // The cooldown is the user's setting as is. normalizeTabWheelSettings has
    // already clamped it to [MIN_WHEEL_COOLDOWN_MS, MAX_WHEEL_COOLDOWN_MS].
    if (now - lastWheelCycleAt < settings.wheelCooldownMs) return false;
    wheelBurstCount = computeNextBurstCount(now);
    lastWheelCycleAt = now;
    // The guard tracks raw delta sign, not the mapped prev/next direction, so
    // an inverted-scroll setup still recognizes its own momentum tail. It also
    // inherits the magnitude this gesture ended on, so the first delta after
    // the commit is judged against a real envelope instead of being swallowed.
    momentumGuardSession = createMomentumGuardSession(now, deltaDirection, lastGestureMagnitudePx);
    void cycleTabWheel(direction, "gesture").catch(() => {});
    return true;
  }

  /**
   * Pre-warms the worker when the gesture modifier goes down, the earliest
   * sign of a gesture, so more of an MV3 cold start is hidden than by the
   * wheel-time ping alone. A press that never becomes a gesture (Alt-Tab,
   * shortcuts) costs at most one rate-limited message. Same top-frame gate,
   * rate-limit clock, and fire-and-forget rule as the wheel pre-warm.
   */
  function modifierKeydownPrewarmHandler(event: KeyboardEvent): void {
    if (!event.isTrusted) return;
    if (event.key !== MODIFIER_PREWARM_KEYS[settings.gestureModifier]) return;
    const now = Date.now();
    if (isTopFrameContext && now - lastWorkerPrewarmAt >= WORKER_PREWARM_INTERVAL_MS) {
      lastWorkerPrewarmAt = now;
      void notifyTabWheelContentReady().catch(() => {});
    }
  }

  /**
   * The wheel gesture pipeline, run for every wheel event in this frame. Each
   * step either drops the event or passes it on: chord check, measurement,
   * Chrome's inertia flag, notch/idle bookkeeping, arrival guard, momentum
   * guard, then accumulation toward the trigger distance and a switch.
   * test/runtime-wiring.test.mjs pins the order of these steps.
   */
  function wheelHandler(event: WheelEvent): void {
    // Plain scrolling is almost every wheel event a page sees, so the chord
    // check (which also covers isTrusted) comes first and an unmodified
    // scroll exits before measurement or a clock read.
    if (!isKeyboardWheelEvent(event)) return;
    // Measurement also classifies the event. A notch is recognized per event
    // from Chrome's legacy wheelDelta (whole 120-unit ticks, divided by
    // devicePixelRatio) and floored to 100px; anything else is a slice of a
    // continuous stream (trackpad, Magic Mouse, hi-res wheel).
    const { deltaPx: wheelDelta, isNotch } = measureWheelInput(
      event,
      window.innerHeight,
      window.innerWidth,
      settings.horizontalWheel,
      window.devicePixelRatio,
    );
    if (wheelDelta === 0) return;
    const now = Date.now();
    // From here on the event belongs to the gesture: the page never scrolls
    // on it, even when a guard below drops the delta.
    suppressPageEvent(event);
    // Pre-warm the worker as soon as the chord is recognized, so a cold start
    // overlaps the accumulation below instead of delaying the switch. The
    // wake reuses TABWHEEL_CONTENT_READY: its handler awaits nothing, what it
    // asserts is true here, and it re-seeds the readiness cache a restarted
    // worker has lost. Top frame only, because only the top frame answers the
    // ping that "ready" promises; gestures over an iframe skip the pre-warm.
    // Fire-and-forget: a slow or failed wake must never delay or alter the
    // gesture, which is also why it runs even for deltas the guards drop.
    if (isTopFrameContext && now - lastWorkerPrewarmAt >= WORKER_PREWARM_INTERVAL_MS) {
      lastWorkerPrewarmAt = now;
      void notifyTabWheelContentReady().catch(() => {});
    }
    const previousWheelEventAt = lastWheelEventAt;
    lastWheelEventAt = now;
    // Chrome 151+ flags the platform's inertia events after the fingers lift
    // (macOS trackpads and Magic Mouse, Chrome's touchpad fling elsewhere).
    // They are never the user's input, so they are swallowed and never
    // counted: a trackpad swipe switches by finger travel alone. Lifting the
    // fingers also ends the swipe, so any partial distance is dropped. Where
    // the flag is undefined (older Chrome), the momentum guard below does
    // this job.
    if ((event as WheelEvent & { momentum?: boolean }).momentum === true) {
      wheelAccumulator = 0;
      lastGestureMagnitudePx = 0;
      return;
    }
    // A notch is a deliberate detent: never a momentum tail, so it bypasses
    // both guards below and ends any session still watching a stream.
    if (isNotch) {
      momentumGuardSession = null;
    } else if (now - previousWheelEventAt > WHEEL_GESTURE_IDLE_MS) {
      // A continuous stream that went quiet this long was a finished swipe.
      // Starting the next one from zero is what makes the same swipe give the
      // same result every time, instead of inheriting a stale partial
      // distance from a swipe seconds or minutes ago.
      wheelAccumulator = 0;
    }
    // Arrival guard. The gesture that switched to this tab committed in the
    // previous document, whose guard session died with its visibility, and
    // the rest of its tail is delivered here, to a tab with no session and no
    // cooldown. Seed a session from the first continuous delta that arrives
    // within WHEEL_ARRIVAL_GUARD_WINDOW_MS of becoming visible, so the tail is
    // judged here too. The seeding delta is evidence, not input: it is
    // dropped. That costs at most one delta; missing a tail costs an unwanted
    // switch. A recognized notch never seeds (a detent cannot be a momentum
    // tail); only a wheel whose notches go unrecognized (see
    // isWheelNotchEvent) can lose one on arrival.
    if (
      !momentumGuardSession
      && !isNotch
      && now - lastVisibleAtMs <= WHEEL_ARRIVAL_GUARD_WINDOW_MS
    ) {
      momentumGuardSession = createMomentumGuardSession(
        now,
        wheelDelta > 0 ? 1 : -1,
        Math.abs(wheelDelta),
      );
      return;
    }
    if (
      momentumGuardSession
      && shouldBlockWheelDelta(
        momentumGuardSession,
        wheelDelta,
        now,
        DEFAULT_MOMENTUM_GUARD_TUNING,
      )
    ) {
      return;
    }
    wheelAccumulator += wheelDelta;
    // Blocked deltas return above, so a tail can never seed the next session.
    lastGestureMagnitudePx = Math.abs(wheelDelta);
    const baseDistance = resolveWheelTriggerDistance(
      WHEEL_TRIGGER_THRESHOLD_PX,
      settings.wheelSensitivity,
    );
    const acceleratedDistance = resolveAcceleratedWheelTriggerDistance(
      baseDistance,
      computeNextBurstCount(now),
      settings.wheelAcceleration,
    );
    // The trigger is the configured sensitivity, shortened by acceleration
    // during a burst, and nothing else.
    if (Math.abs(wheelAccumulator) < acceleratedDistance) return;
    const direction = resolveWheelDirection(wheelAccumulator, settings.invertScroll);
    const cycleRan = runWheelCycle(
      direction,
      wheelAccumulator > 0 ? 1 : -1,
      now,
    );
    // A switch spends the whole accumulated distance, so one swipe never pays
    // toward the next. With overshootGuard on, distance that crossed the
    // trigger during the cooldown is dropped the same way.
    if (cycleRan || settings.overshootGuard) {
      wheelAccumulator = 0;
      lastGestureMagnitudePx = 0;
      return;
    }
    // Only reachable with overshootGuard off, which normalizeTabWheelSettings
    // never produces (it always sets it true). If it can ever be off, a
    // trigger blocked by the cooldown keeps at most one trigger's worth of
    // distance for the next switch.
    wheelAccumulator = Math.sign(wheelAccumulator) * Math.min(
      Math.abs(wheelAccumulator),
      acceleratedDistance,
    );
  }

  /** Forgets the wheel gesture in progress, including its guard session. */
  function resetWheelGestureState(): void {
    wheelAccumulator = 0;
    lastGestureMagnitudePx = 0;
    lastWheelCycleAt = 0;
    wheelBurstCount = 0;
    momentumGuardSession = null;
  }

  /**
   * Applies settings saved from the popup or settings page to this live page,
   * and ends any gesture in progress so it is not finished under new rules.
   */
  function storageChangedHandler(
    changes: Record<string, browser.Storage.StorageChange>,
    areaName: string,
  ): void {
    if (areaName !== "local") return;
    // Filtering by key keeps the reset scoped to a real settings change: every
    // other key this extension writes (scroll memory, recent tabs, onboarding)
    // lands mid-gesture, and zeroing the accumulator on one would silently eat
    // the switch the user is actively scrolling toward.
    const settingsChange = changes[TABWHEEL_STORAGE_KEYS.settings];
    if (!settingsChange) return;
    settings = normalizeTabWheelSettings(settingsChange.newValue);
    mouseGesturePolicies = buildMouseGesturePolicies(settings);
    if (!settings.restorePagePosition) {
      cancelScrollRestore();
      if (scrollSaveTimer) {
        window.clearTimeout(scrollSaveTimer);
        scrollSaveTimer = 0;
      }
    }
    resetWheelGestureState();
    resetMouseGestureSession();
    cancelUnreleasedTabDragGesture();
  }

  /**
   * Answers the background (top frame only). TABWHEEL_PING confirms this tab
   * has a live content script; GET_SCROLL and SET_SCROLL carry scroll memory.
   * SET_SCROLL is acknowledged at once while the restore runs on its own.
   */
  function messageHandler(message: unknown): Promise<unknown> | undefined {
    const receivedMessage = message as ContentRuntimeMessage;
    switch (receivedMessage.type) {
      case "TABWHEEL_PING":
        return Promise.resolve({ ok: true });
      case "GET_SCROLL":
        return Promise.resolve(getRootScrollSnapshot());
      case "SET_SCROLL":
        void restoreWindowScroll(receivedMessage);
        return Promise.resolve({ ok: true });
    }
  }

  /**
   * Gaining visibility arms the arrival guard. Losing it ends every gesture in
   * progress and saves the scroll position while this tab is still current.
   */
  function visibilityHandler(): void {
    if (document.visibilityState !== "hidden") {
      // A tab activated by a wheel switch starts receiving the tail of the
      // gesture that activated it. Remember when it arrived so the wheel path
      // can tell that tail apart from a fresh gesture.
      lastVisibleAtMs = Date.now();
      return;
    }
    cancelScrollRestore();
    resetWheelGestureState();
    resetMouseGestureSession();
    cancelUnreleasedTabDragGesture();
    if (isTopFrameContext) flushScrollSnapshot();
  }

  /**
   * Saves the scroll position as the page goes away. Shared by pagehide and
   * beforeunload, but only pagehide marks the page hidden: the user can still
   * cancel a beforeunload.
   */
  function pageHideHandler(event: Event): void {
    if (event.type === "pagehide") pageHidden = true;
    cancelScrollRestore();
    flushScrollSnapshot();
  }

  /** The page is live again, e.g. restored from the back/forward cache. */
  function pageShowHandler(): void {
    pageHidden = false;
  }

  // Every input listener is on window in the capture phase, so TabWheel sees
  // an event before any page handler and can swallow it. wheel and
  // pointermove are non-passive because they call preventDefault.
  window.addEventListener("pointerdown", mouseGestureHandler, true);
  window.addEventListener("pointermove", tabDragPointerMoveHandler, { passive: false, capture: true });
  window.addEventListener("pointercancel", tabDragPointerCancelHandler, true);
  window.addEventListener("lostpointercapture", tabDragPointerCaptureLostHandler, true);
  window.addEventListener("mousedown", mouseGestureHandler, true);
  window.addEventListener("pointerup", mouseGestureHandler, true);
  window.addEventListener("mouseup", mouseGestureHandler, true);
  window.addEventListener("click", mouseGestureHandler, true);
  window.addEventListener("auxclick", mouseGestureHandler, true);
  window.addEventListener("contextmenu", mouseGestureHandler, true);
  window.addEventListener("dblclick", mouseGestureHandler, true);
  window.addEventListener("blur", cancelUnreleasedTabDragGesture);
  window.addEventListener("keydown", modifierKeydownPrewarmHandler, true);
  window.addEventListener("wheel", wheelHandler, { passive: false, capture: true });
  document.addEventListener("visibilitychange", visibilityHandler);
  browser.storage.onChanged.addListener(storageChangedHandler);

  // Scroll memory and the background's messages belong to the top frame: the
  // background keeps one scroll position per tab and expects one answer.
  if (isTopFrameContext) {
    window.addEventListener("scroll", scheduleScrollSnapshot, { passive: true, capture: true });
    window.addEventListener("pagehide", pageHideHandler);
    window.addEventListener("pageshow", pageShowHandler);
    window.addEventListener("beforeunload", pageHideHandler);
    browser.runtime.onMessage.addListener(messageHandler);
  }

  // Undoes everything above for the next injection. A claim is left first so
  // an interaction cut short by re-injection stays swallowed, and a released
  // drag is not cancelled so it can finish settling the tab.
  window.__tabWheelCleanup = () => {
    rememberMouseClaimForReinjection();
    window.removeEventListener("pointerdown", mouseGestureHandler, true);
    window.removeEventListener("pointermove", tabDragPointerMoveHandler, true);
    window.removeEventListener("pointercancel", tabDragPointerCancelHandler, true);
    window.removeEventListener("lostpointercapture", tabDragPointerCaptureLostHandler, true);
    window.removeEventListener("mousedown", mouseGestureHandler, true);
    window.removeEventListener("pointerup", mouseGestureHandler, true);
    window.removeEventListener("mouseup", mouseGestureHandler, true);
    window.removeEventListener("click", mouseGestureHandler, true);
    window.removeEventListener("auxclick", mouseGestureHandler, true);
    window.removeEventListener("contextmenu", mouseGestureHandler, true);
    window.removeEventListener("dblclick", mouseGestureHandler, true);
    window.removeEventListener("blur", cancelUnreleasedTabDragGesture);
    window.removeEventListener("keydown", modifierKeydownPrewarmHandler, true);
    window.removeEventListener("wheel", wheelHandler, true);
    document.removeEventListener("visibilitychange", visibilityHandler);
    browser.storage.onChanged.removeListener(storageChangedHandler);
    if (isTopFrameContext) {
      window.removeEventListener("scroll", scheduleScrollSnapshot, true);
      window.removeEventListener("pagehide", pageHideHandler);
      window.removeEventListener("pageshow", pageShowHandler);
      window.removeEventListener("beforeunload", pageHideHandler);
      browser.runtime.onMessage.removeListener(messageHandler);
    }
    cancelScrollRestore();
    resetMouseGestureSession();
    if (!tabDragGesture?.released) cancelTabDragGesture();
    if (scrollSaveTimer) window.clearTimeout(scrollSaveTimer);
    if (statusTimer) window.clearTimeout(statusTimer);
    document.getElementById(STATUS_ID)?.remove();
  };

  // Tell the background this tab can take gestures and answer pings. Top
  // frame only, since only the top frame registers the message listener.
  if (isTopFrameContext) {
    void notifyTabWheelContentReady().catch(() => {});
  }
}
