// Content-script application: wheel cycling, click gestures, the in-page
// scroll filter, scroll-memory snapshots, and background message handling.
// initApp() runs once per frame and is safe to re-run — it first calls the
// previous instance's window.__tabWheelCleanup, which is how re-injecting from
// code (installs, updates, popup refresh) avoids stacking listeners.

import browser from "webextension-polyfill";
import {
  DEFAULT_TABWHEEL_SETTINGS,
  loadTabWheelSettings,
  normalizeTabWheelSettings,
  TABWHEEL_MODIFIER_KEYS,
  TABWHEEL_STORAGE_KEYS,
} from "../common/contracts/tabWheel";
import { ContentRuntimeMessage } from "../common/contracts/runtimeMessages";
import { sleep } from "../common/utils/asyncFlow";
import { dismissPanel } from "../common/utils/panelHost";
import {
  buildMouseGesturePolicies,
  createMouseGestureSession as createCoreMouseGestureSession,
  isMouseGestureEventForSession,
  isMouseGestureSessionExpired,
  isMouseGestureSessionStartEventType,
  MOUSE_GESTURE_POLICIES,
  resolveMouseGesturePolicy as resolveMouseGesturePolicyByButton,
  shouldFinishMouseGestureSession as shouldFinishCoreMouseGestureSession,
  shouldRunMouseGestureSession as shouldRunCoreMouseGestureSession,
} from "../core/tabWheel/mouseGestureCore";
import type {
  TabWheelMouseGestureAction,
  TabWheelMouseGesturePolicy,
  TabWheelMouseGestureSession,
} from "../core/tabWheel/mouseGestureCore";
import {
  normalizeWheelDelta,
  normalizeWheelDeltaY,
  resolveAcceleratedWheelTriggerDistance,
  resolveWheelDirection,
  resolveWheelTriggerDistance,
  scalePageScrollDelta,
  shouldUseNativePageScroll,
} from "../core/tabWheel/tabWheelCore";
import {
  activateMostRecentTabWheelTab,
  closeCurrentTabWheelTabAndActivateRecent,
  cycleTabWheel,
  duplicateCurrentTabWheelTab,
  openNativeNewTabWheelTab,
  openTabWheelOptions,
  saveTabWheelScrollPosition,
} from "../adapters/runtime/tabWheelApi";
import { openTabWheelHelpOverlay } from "../ui/panels/help/help";
import { openTabWheelSearchLauncher } from "../ui/panels/searchLauncher/searchLauncher";

declare global {
  interface Window {
    __tabWheelCleanup?: () => void;
  }
}

const SCROLL_SAVE_DEBOUNCE_MS = 700;
const SCROLL_RESTORE_SUPPRESS_SAVE_MS = 450;
const WHEEL_TRIGGER_THRESHOLD_PX = 80;
const WHEEL_ACCELERATION_WINDOW_MS = 700;
const STATUS_TIMEOUT_MS = 1500;
const STATUS_ID = "tw-status-indicator";
const SCROLL_RESTORE_DELAYS_MS = [0, 80, 220, 500, 900, 1500, 2400, 3600];
const LAYOUT_STABILITY_TIMEOUT_MS = 1600;
const LAYOUT_STABILITY_REQUIRED_FRAMES = 3;
const LAYOUT_DIMENSION_TOLERANCE_PX = 4;
const LAYOUT_DIMENSION_MATCH_RATIO = 0.08;

type TabWheelEventModifierKey = TabWheelModifierKey | "shift";
type PageScrollTarget = { type: "window" } | { type: "element"; element: HTMLElement };

const EVENT_MODIFIER_KEYS: readonly TabWheelEventModifierKey[] = ["alt", "ctrl", "shift", "meta"];

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const editable = target.closest(
    "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='textbox']",
  );
  return editable !== null;
}

function hasAnyWheelModifier(event: WheelEvent): boolean {
  return event.altKey || event.ctrlKey || event.shiftKey || event.metaKey;
}

function isTabWheelModifier(
  event: MouseEvent | WheelEvent | KeyboardEvent,
  modifier: TabWheelModifierKey,
  withShift: boolean,
): boolean {
  const modifierState: Record<TabWheelEventModifierKey, boolean> = {
    alt: event.altKey,
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    meta: event.metaKey,
  };
  if (!TABWHEEL_MODIFIER_KEYS.includes(modifier)) return false;
  return EVENT_MODIFIER_KEYS.every((key) => {
    if (key === modifier) return modifierState[key];
    if (key === "shift") return modifierState.shift === withShift;
    return !modifierState[key];
  });
}

function clampScrollY(scrollY: number): number {
  return Math.max(0, Math.min(scrollY, getMaxScrollY()));
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

const PAGE_SCROLL_FILTER_BLOCKED_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable='']",
  "[contenteditable='true']",
  "[role='textbox']",
  "[role='slider']",
  "[role='spinbutton']",
  "[role='scrollbar']",
  "[role='application']",
  "iframe",
  "embed",
  "object",
  "video",
  "audio",
  "canvas",
  "[data-tabwheel-native-scroll='true']",
  "[class*='mapbox' i]",
  "[class*='leaflet' i]",
  "[class*='monaco' i]",
  "[class*='cm-editor' i]",
].join(",");

function isPageScrollFilterBlockedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(PAGE_SCROLL_FILTER_BLOCKED_SELECTOR) !== null;
}

function isScrollableOverflowY(value: string): boolean {
  return value === "auto" || value === "scroll" || value === "overlay";
}

function getElementMaxScrollTop(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.clientHeight);
}

function canScrollElementVertically(element: HTMLElement, direction: number): boolean {
  if (direction === 0) return false;
  if (element === document.documentElement || element === document.body) return false;
  const maxScrollTop = getElementMaxScrollTop(element);
  if (maxScrollTop <= 1) return false;
  if (!isScrollableOverflowY(window.getComputedStyle(element).overflowY)) return false;
  return direction > 0 ? element.scrollTop < maxScrollTop - 1 : element.scrollTop > 1;
}

function canScrollWindowVertically(direction: number): boolean {
  if (direction === 0) return false;
  const maxScrollY = getMaxScrollY();
  if (maxScrollY <= 1) return false;
  return direction > 0 ? window.scrollY < maxScrollY - 1 : window.scrollY > 1;
}

function getPageScrollPath(target: EventTarget | null, event: WheelEvent): HTMLElement[] {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  const elements = path.filter((item): item is HTMLElement => item instanceof HTMLElement);
  if (elements.length > 0) return elements;
  const fallbackElements: HTMLElement[] = [];
  let current = target instanceof HTMLElement ? target : null;
  while (current) {
    fallbackElements.push(current);
    current = current.parentElement;
  }
  return fallbackElements;
}

function resolvePageScrollTarget(event: WheelEvent, direction: number): PageScrollTarget | null {
  for (const element of getPageScrollPath(event.target, event)) {
    if (canScrollElementVertically(element, direction)) {
      return { type: "element", element };
    }
  }
  return canScrollWindowVertically(direction) ? { type: "window" } : null;
}

function getPageScrollTargetViewportHeight(target: PageScrollTarget): number {
  return target.type === "window" ? window.innerHeight : target.element.clientHeight;
}

function scrollPageTarget(target: PageScrollTarget, deltaY: number): void {
  if (target.type === "window") {
    window.scrollTo({
      left: window.scrollX,
      top: clampScrollY(window.scrollY + deltaY),
      behavior: "auto",
    });
    return;
  }
  const maxScrollTop = getElementMaxScrollTop(target.element);
  target.element.scrollTop = Math.max(0, Math.min(maxScrollTop, target.element.scrollTop + deltaY));
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
  return Math.abs(current - stored) <= Math.max(LAYOUT_DIMENSION_TOLERANCE_PX, stored * LAYOUT_DIMENSION_MATCH_RATIO);
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
  const ratioX = Number.isFinite(snapshot.scrollRatioX) ? Math.max(0, Math.min(1, snapshot.scrollRatioX)) : 0;
  const ratioY = Number.isFinite(snapshot.scrollRatioY) ? Math.max(0, Math.min(1, snapshot.scrollRatioY)) : 0;
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

function isTabWheelPanelOpen(): boolean {
  return document.getElementById("ht-panel-host") !== null;
}

function isTopFrame(): boolean {
  try {
    return window.top === window;
  } catch (_) {
    return false;
  }
}

export function initApp(): void {
  if (window.__tabWheelCleanup) {
    window.__tabWheelCleanup();
  }

  const isTopFrameContext = isTopFrame();
  let settings: TabWheelSettings = { ...DEFAULT_TABWHEEL_SETTINGS };
  let statusTimer = 0;
  let scrollSaveTimer = 0;
  let lastScrollSaveX = Number.NaN;
  let lastScrollSaveY = Number.NaN;
  let suppressScrollSaveUntil = 0;
  let scrollRestoreToken = 0;
  let wheelAccumulator = 0;
  let lastWheelCycleAt = 0;
  let wheelBurstCount = 0;
  let areSettingsLoaded = false;
  let mouseGestureSession: TabWheelMouseGestureSession | null = null;
  let mouseGesturePolicies: readonly TabWheelMouseGesturePolicy[] = MOUSE_GESTURE_POLICIES;

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
        "font:12px/1.35 'SF Mono','JetBrains Mono','Fira Code','Consolas',monospace",
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
    if (Date.now() < suppressScrollSaveUntil) return;
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
    if (Date.now() < suppressScrollSaveUntil) return;
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
    window.scrollTo({
      left: target.left,
      top: target.top,
      behavior: "auto",
    });

    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    return Math.abs(window.scrollX - target.left) <= 2 && Math.abs(window.scrollY - target.top) <= 2;
  }

  async function restoreWindowScroll(snapshot: ScrollData): Promise<void> {
    const token = ++scrollRestoreToken;
    const isCurrentRestore = () => token === scrollRestoreToken && document.visibilityState !== "hidden";
    if (!isCurrentRestore()) return;

    await applyScrollRestoreAttempt(snapshot);
    if (!isCurrentRestore()) return;
    if (!await waitForLayoutStability(isCurrentRestore)) return;

    for (const delay of SCROLL_RESTORE_DELAYS_MS) {
      if (!isCurrentRestore()) return;
      if (delay > 0) await sleep(delay);
      if (!isCurrentRestore()) return;
      if (await applyScrollRestoreAttempt(snapshot)) return;
    }
  }

  function isWheelGestureBlockedTarget(target: EventTarget | null): boolean {
    return !settings.allowGesturesInEditableFields && isEditableTarget(target);
  }

  function isKeyboardWheelEvent(event: WheelEvent): boolean {
    return areSettingsLoaded
      && event.isTrusted
      && isTabWheelModifier(event, settings.gestureModifier, settings.gestureWithShift)
      && !isWheelGestureBlockedTarget(event.target);
  }

  function resolveMouseGesturePolicyForEvent(event: MouseEvent): TabWheelMouseGesturePolicy | null {
    if (!areSettingsLoaded) return null;
    if (isTabWheelPanelOpen()) return null;
    if (!event.isTrusted) return null;
    if (!isTabWheelModifier(event, settings.gestureModifier, settings.gestureWithShift)) return null;
    if (isWheelGestureBlockedTarget(event.target)) return null;
    return resolveMouseGesturePolicyByButton(event.button, mouseGesturePolicies);
  }

  function resolvePanelSuppressedMouseGesturePolicy(event: MouseEvent): TabWheelMouseGesturePolicy | null {
    if (event.type === "contextmenu") {
      return mouseGesturePolicies.find((policy) => policy.runPhase === "contextmenu") || null;
    }
    return resolveMouseGesturePolicyByButton(event.button, mouseGesturePolicies);
  }

  function shouldSuppressPanelMouseShortcut(event: MouseEvent): boolean {
    if (!areSettingsLoaded) return false;
    if (!isTabWheelPanelOpen()) return false;
    if (!event.isTrusted) return false;
    // Primary-button clicks are how the user operates the panel itself. Only the
    // non-primary gesture buttons (and the context menu) need swallowing.
    if (event.button === 0 && event.type !== "contextmenu") return false;
    if (!isTabWheelModifier(event, settings.gestureModifier, settings.gestureWithShift)) return false;
    return resolvePanelSuppressedMouseGesturePolicy(event) !== null;
  }

  function isMouseGestureSessionStartEvent(event: MouseEvent): boolean {
    return isMouseGestureSessionStartEventType(event.type);
  }

  function finishMouseGestureSession(): void {
    mouseGestureSession = null;
  }

  function resetWheelGestureState(): void {
    wheelAccumulator = 0;
    lastWheelCycleAt = 0;
    wheelBurstCount = 0;
  }

  function resetInputGestureState(): void {
    resetWheelGestureState();
    finishMouseGestureSession();
  }

  function getActiveMouseGestureSession(event: MouseEvent): TabWheelMouseGestureSession | null {
    if (!mouseGestureSession) return null;
    if (isMouseGestureSessionExpired(mouseGestureSession, Date.now())) {
      finishMouseGestureSession();
      return null;
    }
    return isMouseGestureEventForSession(mouseGestureSession, event) ? mouseGestureSession : null;
  }

  function runMouseGestureSession(session: TabWheelMouseGestureSession): void {
    if (session.hasRun) return;
    session.hasRun = true;
    runMouseGestureAction(session.policy.action);
  }

  function runGestureActionWithStatus(
    task: () => Promise<TabWheelActionResult>,
    failureStatus: string,
  ): void {
    void task()
      .then((result) => {
        if (!result.ok) showStatus(result.reason || failureStatus);
      })
      .catch(() => showStatus(failureStatus));
  }

  function runMouseGestureAction(action: TabWheelMouseGestureAction): void {
    switch (action) {
      case "search":
        void openTabWheelSearchLauncher().catch(() => showStatus("Search unavailable"));
        return;
      case "recentTab":
        runGestureActionWithStatus(() => activateMostRecentTabWheelTab(), "Recent tab unavailable");
        return;
      case "nativeNewTab":
        runGestureActionWithStatus(() => openNativeNewTabWheelTab(), "New tab unavailable");
        return;
      case "duplicateTab":
        runGestureActionWithStatus(() => duplicateCurrentTabWheelTab(), "Duplicate unavailable");
        return;
      case "openSettings":
        runGestureActionWithStatus(() => openTabWheelOptions(), "Settings unavailable");
        return;
      case "closeToRecent":
        runGestureActionWithStatus(() => closeCurrentTabWheelTabAndActivateRecent(), "Close tab failed");
        return;
      default: {
        // Compile-time exhaustiveness: a new action must be wired here explicitly
        // rather than falling through to a destructive default.
        const unhandled: never = action;
        void unhandled;
      }
    }
  }

  function getTabCycleWheelDelta(event: WheelEvent): number {
    return normalizeWheelDelta(event, window.innerHeight, window.innerWidth, settings.horizontalWheel);
  }

  function computeNextBurstCount(now: number): number {
    return now - lastWheelCycleAt <= WHEEL_ACCELERATION_WINDOW_MS
      ? Math.min(wheelBurstCount + 1, 6)
      : 0;
  }

  function getWheelTriggerDistance(now: number): number {
    const baseDistance = resolveWheelTriggerDistance(WHEEL_TRIGGER_THRESHOLD_PX, settings.wheelSensitivity);
    return resolveAcceleratedWheelTriggerDistance(
      baseDistance,
      computeNextBurstCount(now),
      settings.wheelAcceleration,
    );
  }

  function runWheelCycle(direction: "prev" | "next", now: number): boolean {
    if (now - lastWheelCycleAt < settings.wheelCooldownMs) return false;
    wheelBurstCount = computeNextBurstCount(now);
    lastWheelCycleAt = now;
    if (isTabWheelPanelOpen()) dismissPanel();
    void cycleTabWheel(direction).catch(() => {});
    return true;
  }

  function handlePageScrollFilter(event: WheelEvent): boolean {
    if (!isTopFrameContext) return false;
    if (!areSettingsLoaded || !event.isTrusted || event.defaultPrevented) return false;
    if (hasAnyWheelModifier(event)) return false;
    // If an overlay is open, it owns plain wheel input — its own listener locks
    // the page. Filtering here would scroll the page underneath.
    if (isTabWheelPanelOpen()) return false;
    if (shouldUseNativePageScroll(settings.pageScrollSpeedMultiplier, settings.pageScrollViewportCapRatio)) return false;
    if (event.deltaY === 0) return false;
    if (isPageScrollFilterBlockedTarget(event.target)) return false;
    const scrollTarget = resolvePageScrollTarget(event, Math.sign(event.deltaY));
    if (!scrollTarget) return false;
    const viewportHeight = getPageScrollTargetViewportHeight(scrollTarget);
    const rawDeltaY = normalizeWheelDeltaY(event, viewportHeight);
    if (rawDeltaY === 0) return false;
    const scaledDeltaY = scalePageScrollDelta(
      rawDeltaY,
      settings.pageScrollSpeedMultiplier,
      viewportHeight,
      settings.pageScrollViewportCapRatio,
    );
    if (scaledDeltaY === 0) return false;
    suppressPageEvent(event);
    scrollPageTarget(scrollTarget, scaledDeltaY);
    return true;
  }

  function wheelHandler(event: WheelEvent): void {
    if (!isKeyboardWheelEvent(event)) {
      handlePageScrollFilter(event);
      return;
    }
    const wheelDelta = getTabCycleWheelDelta(event);
    if (wheelDelta === 0) return;
    suppressPageEvent(event);
    const now = Date.now();
    wheelAccumulator += wheelDelta;
    const triggerDistance = getWheelTriggerDistance(now);
    if (Math.abs(wheelAccumulator) < triggerDistance) return;
    const direction = resolveWheelDirection(wheelAccumulator, settings.invertScroll);
    const cycleRan = runWheelCycle(direction, now);
    if (cycleRan || settings.overshootGuard) {
      wheelAccumulator = 0;
      return;
    }
    wheelAccumulator = Math.sign(wheelAccumulator) * Math.min(Math.abs(wheelAccumulator), triggerDistance);
  }

  function mouseGestureHandler(event: MouseEvent): void {
    if (shouldSuppressPanelMouseShortcut(event)) {
      suppressPageEvent(event);
      return;
    }

    const activeSession = getActiveMouseGestureSession(event);
    if (activeSession) {
      suppressPageEvent(event);
      if (shouldRunCoreMouseGestureSession(activeSession, event.type)) runMouseGestureSession(activeSession);
      if (shouldFinishCoreMouseGestureSession(activeSession, event.type)) finishMouseGestureSession();
      return;
    }

    const policy = resolveMouseGesturePolicyForEvent(event);
    if (!policy) return;
    suppressPageEvent(event);

    if (isMouseGestureSessionStartEvent(event)) {
      mouseGestureSession = createCoreMouseGestureSession(policy, Date.now());
      if (shouldRunCoreMouseGestureSession(mouseGestureSession, event.type)) {
        runMouseGestureSession(mouseGestureSession);
      }
      if (shouldFinishCoreMouseGestureSession(mouseGestureSession, event.type)) {
        finishMouseGestureSession();
      }
    }
  }

  function storageChangedHandler(
    changes: Record<string, browser.Storage.StorageChange>,
    areaName: string,
  ): void {
    if (areaName !== "local") return;
    const settingsChange = changes[TABWHEEL_STORAGE_KEYS.settings];
    if (settingsChange) {
      settings = normalizeTabWheelSettings(settingsChange.newValue);
      mouseGesturePolicies = buildMouseGesturePolicies(settings);
      resetInputGestureState();
    }
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
      case "TABWHEEL_STATUS":
        showStatus(receivedMessage.message);
        return Promise.resolve({ ok: true });
      case "TABWHEEL_DISMISS_PANEL":
        dismissPanel();
        return Promise.resolve({ ok: true });
      case "OPEN_TABWHEEL_HELP":
        void openTabWheelHelpOverlay();
        return Promise.resolve({ ok: true });
    }
  }

  function visibilityHandler(): void {
    if (document.visibilityState !== "hidden") return;
    cancelScrollRestore();
    resetInputGestureState();
    if (!isTopFrameContext) return;
    flushScrollSnapshot();
    dismissPanel();
  }

  function pageHideHandler(): void {
    cancelScrollRestore();
    flushScrollSnapshot();
  }

  function beforeUnloadHandler(): void {
    cancelScrollRestore();
    flushScrollSnapshot();
  }

  window.addEventListener("pointerdown", mouseGestureHandler, true);
  window.addEventListener("mousedown", mouseGestureHandler, true);
  window.addEventListener("pointerup", mouseGestureHandler, true);
  window.addEventListener("mouseup", mouseGestureHandler, true);
  window.addEventListener("click", mouseGestureHandler, true);
  window.addEventListener("auxclick", mouseGestureHandler, true);
  window.addEventListener("contextmenu", mouseGestureHandler, true);
  window.addEventListener("wheel", wheelHandler, { passive: false, capture: true });
  document.addEventListener("visibilitychange", visibilityHandler);
  browser.storage.onChanged.addListener(storageChangedHandler);

  if (isTopFrameContext) {
    window.addEventListener("scroll", scheduleScrollSnapshot, { passive: true, capture: true });
    window.addEventListener("pagehide", pageHideHandler);
    window.addEventListener("beforeunload", beforeUnloadHandler);
    browser.runtime.onMessage.addListener(messageHandler);
  }

  window.__tabWheelCleanup = () => {
    window.removeEventListener("pointerdown", mouseGestureHandler, true);
    window.removeEventListener("mousedown", mouseGestureHandler, true);
    window.removeEventListener("pointerup", mouseGestureHandler, true);
    window.removeEventListener("mouseup", mouseGestureHandler, true);
    window.removeEventListener("click", mouseGestureHandler, true);
    window.removeEventListener("auxclick", mouseGestureHandler, true);
    window.removeEventListener("contextmenu", mouseGestureHandler, true);
    window.removeEventListener("wheel", wheelHandler, true);
    document.removeEventListener("visibilitychange", visibilityHandler);
    browser.storage.onChanged.removeListener(storageChangedHandler);
    if (isTopFrameContext) {
      window.removeEventListener("scroll", scheduleScrollSnapshot, true);
      window.removeEventListener("pagehide", pageHideHandler);
      window.removeEventListener("beforeunload", beforeUnloadHandler);
      browser.runtime.onMessage.removeListener(messageHandler);
    }
    cancelScrollRestore();
    if (scrollSaveTimer) window.clearTimeout(scrollSaveTimer);
    if (statusTimer) window.clearTimeout(statusTimer);
    document.getElementById(STATUS_ID)?.remove();
    dismissPanel();
  };

  if (isTopFrameContext) {
    void browser.runtime.sendMessage({ type: "TABWHEEL_CONTENT_READY" }).catch(() => {});
  }
}
