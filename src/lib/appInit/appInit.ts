// initApp can be injected more than once after installs, updates, or popup
// refreshes. Run the previous cleanup hook first so wheel listeners never stack.

import browser from "webextension-polyfill";
import {
  DEFAULT_TABWHEEL_SETTINGS,
  loadTabWheelSettings,
  normalizeTabWheelSettings,
  TABWHEEL_STORAGE_KEYS,
} from "../common/contracts/tabWheel";
import { ContentRuntimeMessage } from "../common/contracts/runtimeMessages";
import { sleep } from "../common/utils/asyncFlow";
import {
  isTabWheelModifier,
  normalizeWheelDelta,
  resolveAcceleratedWheelTriggerDistance,
  resolveWheelDirection,
  resolveWheelTriggerDistance,
} from "../core/tabWheel/tabWheelCore";
import {
  advanceTabDragState,
  clearTabDragBoundary,
  coalesceTabDragDirections,
  createTabDragState,
  isTabDragButtonPressed,
  markTabDragBoundary,
  reconcileTabDragBoundaryDirections,
  TabDragDirection,
  TabDragState,
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
  moveCurrentTabWheelTab,
  notifyTabWheelContentReady,
  openNativeNewTabWheelTab,
  openTabWheelOptions,
  saveTabWheelScrollPosition,
} from "../adapters/runtime/tabWheelApi";

declare global {
  interface Window {
    __tabWheelCleanup?: () => void;
    __tabWheelMouseClaim?: {
      button: number;
      expiresAt: number;
    };
  }
}

const SCROLL_SAVE_DEBOUNCE_MS = 700;
const SCROLL_RESTORE_SUPPRESS_SAVE_MS = 450;
const WHEEL_TRIGGER_THRESHOLD_PX = 80;
// How long after a tab becomes visible a wheel event can still be the tail of
// the gesture that switched to it, rather than new input from the user. A
// handed-off tail is a continuous 8-16ms stream, so its next event lands almost
// immediately; a detented notch cannot arrive faster than its own ~40ms cadence.
// Keeping this window under that cadence is what stops clicky wheels paying an
// arrival tax on every switch.
const WHEEL_ARRIVAL_GUARD_WINDOW_MS = 32;
// MV3 shuts the service worker down after ~30s idle, so the first switch after
// a pause pays worker cold start (~50-300ms) on top of the switch itself, with
// nothing waking the worker earlier than the switch message. Crossing the
// trigger distance takes 30-150ms of wheel motion the user is already
// spending, so a ping sent the moment the gesture chord is recognized overlaps
// the wake with that motion instead of stacking on top of it. One ping per 15s
// comfortably covers the idle threshold without turning every wheel event into
// a message.
const WORKER_PREWARM_INTERVAL_MS = 15000;
// KeyboardEvent.key values for the configurable gesture modifiers, so the
// modifier press itself — which precedes the first wheel notch by the user's
// wind-up — can trigger the same pre-warm.
const MODIFIER_PREWARM_KEYS = { alt: "Alt", ctrl: "Control", meta: "Meta" } as const;
const WHEEL_ACCELERATION_WINDOW_MS = 700;
const STATUS_TIMEOUT_MS = 1500;
const TAB_DRAG_KEEPALIVE_MS = 15000;
const STATUS_ID = "tw-status-indicator";
const SCROLL_RESTORE_DELAYS_MS = [0, 80, 220, 500, 900, 1500, 2400, 3600];
const LAYOUT_STABILITY_TIMEOUT_MS = 1600;
const LAYOUT_STABILITY_REQUIRED_FRAMES = 3;
const LAYOUT_DIMENSION_TOLERANCE_PX = 4;
const LAYOUT_DIMENSION_MATCH_RATIO = 0.08;

interface ActiveTabDragGesture {
  pointerId: number;
  button: number;
  gestureId: string;
  state: TabDragState;
  captureTarget: Element | null;
  pendingDirections: TabDragDirection[];
  moveInFlight: boolean;
  released: boolean;
  completionReceived: boolean;
  cancelled: boolean;
  finishTimer: number;
  waitForPreviousDrag: Promise<void>;
  releaseDragQueue: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(
    "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='textbox']",
  ) !== null;
}

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

function hasSimilarDimension(current: number, stored: number): boolean {
  if (!Number.isFinite(stored) || stored <= 0) return false;
  return Math.abs(current - stored)
    <= Math.max(LAYOUT_DIMENSION_TOLERANCE_PX, stored * LAYOUT_DIMENSION_MATCH_RATIO);
}

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

function suppressPageEvent(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function isTopFrame(): boolean {
  try {
    return window.top === window;
  } catch (_) {
    return false;
  }
}

export function initApp(): void {
  window.__tabWheelCleanup?.();

  const isTopFrameContext = isTopFrame();
  let settings: TabWheelSettings = { ...DEFAULT_TABWHEEL_SETTINGS };
  let areSettingsLoaded = false;
  let statusTimer = 0;
  let scrollSaveTimer = 0;
  let lastScrollSaveX = Number.NaN;
  let lastScrollSaveY = Number.NaN;
  let suppressScrollSaveUntil = 0;
  let scrollRestoreToken = 0;
  let wheelAccumulator = 0;
  // Magnitude of the most recent delta accumulated into the current gesture.
  // This is the envelope the momentum guard inherits on commit: a tail starts
  // from the magnitude the gesture ended on, which is also why it can never
  // trip the guard's ramp escape.
  let lastGestureMagnitudePx = 0;
  let lastVisibleAtMs = 0;
  let lastWorkerPrewarmAt = 0;
  let lastWheelCycleAt = 0;
  let wheelBurstCount = 0;
  let mouseGesturePolicies = buildMouseGesturePolicies(settings);
  let mouseGestureSession: TabWheelMouseGestureSession | null = null;
  let tabDragGesture: ActiveTabDragGesture | null = null;
  let momentumGuardSession: MomentumGuardSession | null = null;

  void loadTabWheelSettings()
    .then((loadedSettings) => {
      settings = loadedSettings;
      mouseGesturePolicies = buildMouseGesturePolicies(settings);
    })
    .finally(() => {
      areSettingsLoaded = true;
    });

  function showStatus(message: string): void {
    let status = document.getElementById(STATUS_ID);
    if (!status) {
      status = document.createElement("div");
      status.id = STATUS_ID;
      status.setAttribute("role", "status");
      status.style.cssText = [
        "position:fixed",
        "left:50%",
        "top:50%",
        "transform:translate(-50%,-50%)",
        "z-index:2147483646",
        "width:min(360px,calc(100vw - 32px))",
        "min-height:42px",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "text-align:center",
        "padding:10px 14px",
        "border-radius:8px",
        "border:1px solid rgba(255,255,255,0.14)",
        "background:#1e1e1e",
        "color:#e0e0e0",
        "box-shadow:0 18px 54px rgba(0,0,0,0.44)",
        "font:12px/1.35 system-ui,sans-serif",
        "pointer-events:none",
      ].join(";");
      document.documentElement.appendChild(status);
    }
    status.textContent = message;
    if (statusTimer) window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
      status?.remove();
      statusTimer = 0;
    }, STATUS_TIMEOUT_MS);
  }

  function sendScrollSnapshot(): void {
    if (!settings.restorePagePosition || Date.now() < suppressScrollSaveUntil) return;
    const snapshot = getRootScrollSnapshot();
    if (snapshot.scrollX === lastScrollSaveX && snapshot.scrollY === lastScrollSaveY) return;
    lastScrollSaveX = snapshot.scrollX;
    lastScrollSaveY = snapshot.scrollY;
    void saveTabWheelScrollPosition(snapshot).catch(() => {});
  }

  function flushScrollSnapshot(): void {
    if (scrollSaveTimer) {
      window.clearTimeout(scrollSaveTimer);
      scrollSaveTimer = 0;
    }
    sendScrollSnapshot();
  }

  function scheduleScrollSnapshot(): void {
    if (!settings.restorePagePosition || Date.now() < suppressScrollSaveUntil) return;
    if (scrollSaveTimer) window.clearTimeout(scrollSaveTimer);
    scrollSaveTimer = window.setTimeout(() => {
      scrollSaveTimer = 0;
      sendScrollSnapshot();
    }, SCROLL_SAVE_DEBOUNCE_MS);
  }

  function cancelScrollRestore(): void {
    scrollRestoreToken += 1;
  }

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

  async function restoreWindowScroll(snapshot: ScrollData): Promise<void> {
    if (!settings.restorePagePosition) return;
    const token = ++scrollRestoreToken;
    const isCurrentRestore = () => token === scrollRestoreToken
      && document.visibilityState !== "hidden"
      && settings.restorePagePosition;
    if (!isCurrentRestore()) return;
    await applyScrollRestoreAttempt(snapshot);
    if (!isCurrentRestore() || !await waitForLayoutStability(isCurrentRestore)) return;
    for (const delay of SCROLL_RESTORE_DELAYS_MS) {
      if (!isCurrentRestore()) return;
      if (delay > 0) await sleep(delay);
      if (!isCurrentRestore()) return;
      if (await applyScrollRestoreAttempt(snapshot)) return;
    }
  }

  function isKeyboardWheelEvent(event: WheelEvent): boolean {
    return areSettingsLoaded
      && event.isTrusted
      && isTabWheelModifier(event, settings.gestureModifier, settings.gestureWithShift)
      && (settings.allowGesturesInEditableFields || !isEditableTarget(event.target));
  }

  function resolveMousePolicy(event: MouseEvent): TabWheelMouseGesturePolicy | null {
    if (!areSettingsLoaded || !event.isTrusted) return null;
    if (!isTabWheelModifier(event, settings.gestureModifier, settings.gestureWithShift)) return null;
    if (!settings.allowGesturesInEditableFields && isEditableTarget(event.target)) return null;
    return resolveMouseGesturePolicy(event.button, mouseGesturePolicies);
  }

  function resetMouseGestureSession(): void {
    mouseGestureSession = null;
  }

  function rememberTabDragMouseClaim(session: ActiveTabDragGesture): void {
    if (session.completionReceived) return;
    window.__tabWheelMouseClaim = {
      button: session.button,
      expiresAt: Date.now() + MOUSE_GESTURE_CLAIM_MS,
    };
  }

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

  function isMouseClaimCompletionEvent(button: number, event: MouseEvent): boolean {
    if (button === 0) return event.type === "click";
    if (button === 1) return event.type === "auxclick";
    return event.type === "contextmenu";
  }

  function isMouseClaimReleaseEvent(event: MouseEvent): boolean {
    return event.type === "pointerup" || event.type === "mouseup";
  }

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

  function reserveTabDragQueue(): Pick<
    ActiveTabDragGesture,
    "gestureId" | "waitForPreviousDrag" | "releaseDragQueue"
  > {
    const gestureId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const waitForPreviousDrag = beginTabWheelDragGesture(gestureId).then((result) => {
      if (!result.ok) throw new Error(result.reason || "Tab drag unavailable");
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

  function resetTabDragGesture(session: ActiveTabDragGesture): void {
    if (session.finishTimer) window.clearTimeout(session.finishTimer);
    releaseTabDragPointerCapture(session);
    session.releaseDragQueue();
    if (tabDragGesture === session) tabDragGesture = null;
  }

  function finishTabDragGestureWhenIdle(session: ActiveTabDragGesture): void {
    if (
      session.cancelled
      || session.moveInFlight
      || session.pendingDirections.length > 0
      || !session.released
      || !session.completionReceived
    ) return;
    resetTabDragGesture(session);
  }

  function cancelTabDragGesture(preserveCompletionClaim = false): void {
    const session = tabDragGesture;
    if (!session) return;
    if (preserveCompletionClaim) rememberTabDragMouseClaim(session);
    session.cancelled = true;
    session.pendingDirections = [];
    resetTabDragGesture(session);
  }

  function cancelUnreleasedTabDragGesture(): void {
    if (!tabDragGesture?.released) cancelTabDragGesture();
  }

  function drainTabDragMoves(session: ActiveTabDragGesture): void {
    if (
      session.cancelled
      || session.moveInFlight
      || session.pendingDirections.length === 0
    ) {
      finishTabDragGestureWhenIdle(session);
      return;
    }
    const direction = session.pendingDirections.shift() as TabDragDirection;
    session.moveInFlight = true;
    void session.waitForPreviousDrag
      .then(() => {
        if (session.cancelled || tabDragGesture !== session) return null;
        return moveCurrentTabWheelTab(direction, session.gestureId);
      })
      .then((result) => {
        if (!result || session.cancelled || tabDragGesture !== session) return;
        if (!result.ok) {
          showStatus(result.reason || "Tab move failed");
          cancelTabDragGesture(true);
          return;
        }
        if (!result.moved) {
          session.state = markTabDragBoundary(session.state, direction);
          session.pendingDirections = reconcileTabDragBoundaryDirections(
            session.pendingDirections,
            direction,
          );
        } else {
          session.state = clearTabDragBoundary(session.state);
        }
      })
      .catch(() => {
        if (session.cancelled || tabDragGesture !== session) return;
        showStatus("Tab move failed");
        cancelTabDragGesture(true);
      })
      .finally(() => {
        session.moveInFlight = false;
        if (session.cancelled || tabDragGesture !== session) return;
        drainTabDragMoves(session);
      });
  }

  function startTabDragGesture(
    event: PointerEvent,
    policy: TabWheelMouseGesturePolicy,
  ): void {
    const captureTarget = event.target instanceof Element ? event.target : null;
    const dragQueue = reserveTabDragQueue();
    const session: ActiveTabDragGesture = {
      pointerId: event.pointerId,
      button: policy.button,
      state: createTabDragState(event.clientX),
      captureTarget,
      pendingDirections: [],
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

  function releaseActiveTabDragGesture(session: ActiveTabDragGesture): void {
    if (session.released) return;
    session.released = true;
    releaseTabDragPointerCapture(session);
    scheduleTabDragFinishTimer(session);
    finishTabDragGestureWhenIdle(session);
  }

  function scheduleTabDragFinishTimer(session: ActiveTabDragGesture): void {
    if (session.finishTimer) window.clearTimeout(session.finishTimer);
    session.finishTimer = window.setTimeout(() => {
      session.completionReceived = true;
      finishTabDragGestureWhenIdle(session);
    }, MOUSE_GESTURE_CLAIM_MS);
  }

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

  function tabDragPointerMoveHandler(event: PointerEvent): void {
    const session = tabDragGesture;
    if (!session || session.released || event.pointerId !== session.pointerId) return;
    if (!isTabDragButtonPressed(session.button, event.buttons)) {
      cancelTabDragGesture();
      return;
    }
    suppressPageEvent(event);
    const advanced = advanceTabDragState(session.state, event.clientX);
    session.state = advanced.state;
    if (advanced.directions.length === 0) return;
    session.pendingDirections = coalesceTabDragDirections(
      session.pendingDirections,
      advanced.directions,
    );
    drainTabDragMoves(session);
  }

  function tabDragPointerCancelHandler(event: PointerEvent): void {
    const session = tabDragGesture;
    if (!session || event.pointerId !== session.pointerId) return;
    suppressPageEvent(event);
    cancelUnreleasedTabDragGesture();
  }

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

  function isTabDragCompletionEvent(
    session: ActiveTabDragGesture,
    event: MouseEvent,
  ): boolean {
    if (session.button === 0) return event.type === "click";
    if (session.button === 1) return event.type === "auxclick";
    return event.type === "contextmenu";
  }

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

  async function runActionWithStatus(
    task: () => Promise<TabWheelActionResult>,
    failureStatus: string,
  ): Promise<void> {
    try {
      const result = await task();
      if (!result.ok) showStatus(result.reason || failureStatus);
    } catch (_) {
      showStatus(failureStatus);
    }
  }

  async function executeMouseGestureSession(
    session: TabWheelMouseGestureSession,
  ): Promise<void> {
    switch (session.policy.action) {
      case "nativeNewTab":
        await runActionWithStatus(openNativeNewTabWheelTab, "New tab unavailable");
        return;
      case "recentTab":
        await runActionWithStatus(activateMostRecentTabWheelTab, "Recent tab unavailable");
        return;
      case "closeToRecent":
        await runActionWithStatus(closeCurrentTabWheelTabAndActivateRecent, "Close tab failed");
        return;
      case "duplicateTab":
        await runActionWithStatus(duplicateCurrentTabWheelTab, "Duplicate unavailable");
        return;
      case "dragCurrentTab":
        return;
      case "openSettings":
        await runActionWithStatus(openTabWheelOptions, "Settings unavailable");
        return;
    }
  }

  function runMouseGestureSession(session: TabWheelMouseGestureSession): void {
    if (session.hasRun) return;
    session.hasRun = true;
    if (
      tabDragGesture?.released
      && (tabDragGesture.moveInFlight || tabDragGesture.pendingDirections.length > 0)
    ) {
      return;
    }
    void executeMouseGestureSession(session);
  }

  function mouseGestureHandler(event: MouseEvent): void {
    if (handleCarriedMouseClaim(event)) return;
    if (
      event.type === "pointerdown"
      && typeof PointerEvent !== "undefined"
      && event instanceof PointerEvent
      && event.pointerType === "mouse"
    ) {
      const existingDrag = tabDragGesture;
      if (existingDrag?.released) {
        if (existingDrag.moveInFlight || existingDrag.pendingDirections.length > 0) {
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
        if (!existingDrag.moveInFlight && existingDrag.pendingDirections.length === 0) {
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

  function computeNextBurstCount(now: number): number {
    return now - lastWheelCycleAt <= WHEEL_ACCELERATION_WINDOW_MS
      ? Math.min(wheelBurstCount + 1, 6)
      : 0;
  }

  function runWheelCycle(
    direction: "prev" | "next",
    deltaDirection: 1 | -1,
    now: number,
  ): boolean {
    // The configured cooldown, plain: nothing adjusts it per device, and every
    // settings object reaching here has been through normalizeTabWheelSettings,
    // which already clamps it to [MIN_WHEEL_COOLDOWN_MS, MAX_WHEEL_COOLDOWN_MS].
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

  // The earliest observable moment of a gesture is the modifier going down,
  // which beats the first wheel notch by the user's wind-up. Warming here
  // hides more of an MV3 cold start than the wheel-time ping alone; a press
  // that never becomes a gesture (Alt-Tab, shortcuts) costs at most one
  // rate-limited no-op message per interval. Same top-frame gate and shared
  // rate-limit clock as the wheel-time pre-warm, and equally fire-and-forget.
  function modifierKeydownPrewarmHandler(event: KeyboardEvent): void {
    if (!event.isTrusted) return;
    if (event.key !== MODIFIER_PREWARM_KEYS[settings.gestureModifier]) return;
    const now = Date.now();
    if (isTopFrameContext && now - lastWorkerPrewarmAt >= WORKER_PREWARM_INTERVAL_MS) {
      lastWorkerPrewarmAt = now;
      void notifyTabWheelContentReady().catch(() => {});
    }
  }

  function wheelHandler(event: WheelEvent): void {
    // Cheapest possible exit for plain scrolling, which is the overwhelming
    // majority of wheel events on any page: the chord check (which includes
    // the isTrusted test) runs before any work, so an unmodified scroll never
    // pays normalization or a clock read.
    if (!isKeyboardWheelEvent(event)) return;
    const wheelDelta = normalizeWheelDelta(
      event,
      window.innerHeight,
      window.innerWidth,
      settings.horizontalWheel,
    );
    if (wheelDelta === 0) return;
    const now = Date.now();
    suppressPageEvent(event);
    // Pre-warm the background worker as soon as the chord is recognized, so a
    // cold start overlaps the accumulation below instead of delaying the
    // switch that ends it. TABWHEEL_CONTENT_READY is reused rather than adding
    // a wake type: its handler is the only one in the router that returns
    // without awaiting anything (no tabs query or injection; the recent-tab
    // touch it triggers is detached and a no-op for a tab that is already
    // current), and what it asserts is literally true right here — this
    // content script is alive and handling an event. A worker that just
    // restarted also lost its readiness cache, so the same message re-seeds
    // this tab's entry for free.
    //
    // Top frame only, matching the send at the end of initApp: only the top
    // frame registers the runtime message listener, so only the top frame can
    // answer the ping that "ready" promises. A subframe claiming readiness
    // would leave the background willing to activate a tab whose gestures are
    // dead. Gestures started over an iframe therefore skip the pre-warm and
    // pay cold start exactly as they do today — no regression, just no gain.
    //
    // Fire-and-forget and never awaited: this sits above the accumulation path
    // on purpose, and a slow or failed wake must not delay, block, or alter
    // the gesture it is warming.
    if (isTopFrameContext && now - lastWorkerPrewarmAt >= WORKER_PREWARM_INTERVAL_MS) {
      lastWorkerPrewarmAt = now;
      void notifyTabWheelContentReady().catch(() => {});
    }
    // Cross-tab handoff: the gesture that switched tabs committed in the
    // previous document, whose guard session died with its visibility. The
    // rest of that tail is delivered here, to a tab with no session and no
    // cooldown, where it would re-accumulate into an unintended switch. Seed a
    // session from the first delta to arrive so the tail is judged in the tab
    // it landed in. The seeding delta is evidence, not input: it is dropped.
    //
    // The arrival guard is the last defense against a handed-off tail
    // switching again in the tab it lands in, and being wrong in that
    // direction costs an unintended switch, while being conservative costs at
    // most the single notch that lands inside a 32ms window. So it judges on
    // deltaMode and arrival timing only. Pixel mode is the only mode that
    // seeds: line mode is detented by definition, and page mode is a synthetic
    // multi-line jump — neither can be a momentum tail. Chrome reports clicky
    // wheels in pixel mode, so those users can still pay one swallowed notch
    // per switch when a notch happens to land inside the window; that is the
    // disclosed residual of judging on timing alone.
    if (
      !momentumGuardSession
      && event.deltaMode === 0
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
    // The whole trigger: the configured sensitivity, accelerated by the
    // current burst. Nothing adjusts it per device.
    if (Math.abs(wheelAccumulator) < acceleratedDistance) return;
    const direction = resolveWheelDirection(wheelAccumulator, settings.invertScroll);
    const cycleRan = runWheelCycle(
      direction,
      wheelAccumulator > 0 ? 1 : -1,
      now,
    );
    if (cycleRan || settings.overshootGuard) {
      wheelAccumulator = 0;
      lastGestureMagnitudePx = 0;
      return;
    }
    // Dead in the shipped product today: normalizeTabWheelSettings
    // force-trues overshootGuard, so `cycleRan || settings.overshootGuard`
    // above is always true and this line never runs. Kept as
    // defense-in-depth in case that ever changes (a future settings
    // relaxation, or an unnormalized settings object reaching here) — if it
    // does run, an overshoot may carry at most one trigger's worth of
    // distance into the next switch.
    wheelAccumulator = Math.sign(wheelAccumulator) * Math.min(
      Math.abs(wheelAccumulator),
      acceleratedDistance,
    );
  }

  function resetWheelGestureState(): void {
    wheelAccumulator = 0;
    lastGestureMagnitudePx = 0;
    lastWheelCycleAt = 0;
    wheelBurstCount = 0;
    momentumGuardSession = null;
  }

  function storageChangedHandler(
    changes: Record<string, browser.Storage.StorageChange>,
    areaName: string,
  ): void {
    if (areaName !== "local") return;
    // Filtering by key keeps the reset scoped to a real settings change: every
    // other key this extension writes (scroll memory, recent tabs, onboarding) lands
    // mid-gesture, and zeroing the accumulator on one would silently eat the
    // switch the user is actively scrolling toward.
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

  function pageHideHandler(): void {
    cancelScrollRestore();
    flushScrollSnapshot();
  }

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
  window.addEventListener("blur", cancelUnreleasedTabDragGesture);
  window.addEventListener("keydown", modifierKeydownPrewarmHandler, true);
  window.addEventListener("wheel", wheelHandler, { passive: false, capture: true });
  document.addEventListener("visibilitychange", visibilityHandler);
  browser.storage.onChanged.addListener(storageChangedHandler);

  if (isTopFrameContext) {
    window.addEventListener("scroll", scheduleScrollSnapshot, { passive: true, capture: true });
    window.addEventListener("pagehide", pageHideHandler);
    window.addEventListener("beforeunload", pageHideHandler);
    browser.runtime.onMessage.addListener(messageHandler);
  }

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
    window.removeEventListener("blur", cancelUnreleasedTabDragGesture);
    window.removeEventListener("keydown", modifierKeydownPrewarmHandler, true);
    window.removeEventListener("wheel", wheelHandler, true);
    document.removeEventListener("visibilitychange", visibilityHandler);
    browser.storage.onChanged.removeListener(storageChangedHandler);
    if (isTopFrameContext) {
      window.removeEventListener("scroll", scheduleScrollSnapshot, true);
      window.removeEventListener("pagehide", pageHideHandler);
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

  if (isTopFrameContext) {
    void notifyTabWheelContentReady().catch(() => {});
  }
}
