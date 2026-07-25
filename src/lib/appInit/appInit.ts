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
  createMiddleClickSession,
  isMiddleClickEvent,
  isMiddleClickSessionExpired,
  isMiddleClickSessionStartEvent,
  shouldFinishMiddleClickSession,
  shouldRunMiddleClickSession,
  TabWheelMiddleClickSession,
} from "../core/tabWheel/middleClickCore";
import {
  addWheelSample,
  classifyWheelDevice,
  createWheelSampleWindow,
  resolveDeviceTuningAdjustment,
  TabWheelDeviceTuningAdjustment,
} from "../core/tabWheel/deviceProfileCore";
import {
  createMomentumGuardSession,
  MomentumGuardSession,
  shouldBlockWheelDelta,
} from "../core/tabWheel/momentumGuardCore";
import {
  cycleTabWheel,
  openTabWheelOptions,
  saveTabWheelScrollPosition,
} from "../adapters/runtime/tabWheelApi";

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
  // Peak delta magnitude of the events feeding the current accumulation. This
  // is the envelope the momentum guard inherits on commit: a fling's tail
  // starts at the gesture's peak, so the peak is what a tail has to decay from.
  let gestureMagnitudePeakPx = 0;
  let lastWheelCycleAt = 0;
  let wheelBurstCount = 0;
  let middleClickSession: TabWheelMiddleClickSession | null = null;
  // Device evidence lives here and nowhere else: in-memory for this document
  // only, never persisted, never messaged, never attached to settings.
  const wheelSampleWindow = createWheelSampleWindow();
  let momentumGuardSession: MomentumGuardSession | null = null;

  void loadTabWheelSettings()
    .then((loadedSettings) => {
      settings = loadedSettings;
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

  function isEnabledMiddleClickEvent(event: MouseEvent): boolean {
    return areSettingsLoaded
      && settings.middleClickAction === "openSettings"
      && event.isTrusted
      && isMiddleClickEvent(event)
      && isTabWheelModifier(event, settings.gestureModifier, settings.gestureWithShift)
      && (settings.allowGesturesInEditableFields || !isEditableTarget(event.target));
  }

  function resetMiddleClickSession(): void {
    middleClickSession = null;
  }

  function getActiveMiddleClickSession(event: MouseEvent): TabWheelMiddleClickSession | null {
    if (!middleClickSession) return null;
    if (isMiddleClickSessionExpired(middleClickSession, Date.now())) {
      resetMiddleClickSession();
      return null;
    }
    return isMiddleClickEvent(event) ? middleClickSession : null;
  }

  function openSettingsFromMiddleClick(session: TabWheelMiddleClickSession): void {
    if (session.hasRun) return;
    session.hasRun = true;
    void openTabWheelOptions()
      .then((result) => {
        if (!result.ok) showStatus(result.reason || "Settings unavailable");
      })
      .catch(() => showStatus("Settings unavailable"));
  }

  function middleClickHandler(event: MouseEvent): void {
    const activeSession = getActiveMiddleClickSession(event);
    if (activeSession) {
      suppressPageEvent(event);
      if (shouldRunMiddleClickSession(activeSession, event)) {
        openSettingsFromMiddleClick(activeSession);
      }
      if (shouldFinishMiddleClickSession(event)) resetMiddleClickSession();
      return;
    }

    if (!isMiddleClickSessionStartEvent(event) || !isEnabledMiddleClickEvent(event)) return;
    suppressPageEvent(event);
    middleClickSession = createMiddleClickSession(Date.now());
    if (shouldRunMiddleClickSession(middleClickSession, event)) {
      openSettingsFromMiddleClick(middleClickSession);
    }
    if (shouldFinishMiddleClickSession(event)) resetMiddleClickSession();
  }

  function computeNextBurstCount(now: number): number {
    return now - lastWheelCycleAt <= WHEEL_ACCELERATION_WINDOW_MS
      ? Math.min(wheelBurstCount + 1, 6)
      : 0;
  }

  // Classification is deliberately lazy: unmodified scrolling only feeds the
  // sample window, and the heuristics run once per gesture wheel event. With
  // device-aware tuning off we hold the neutral "unknown" posture, which is an
  // exact identity for trigger distance and cooldown while still handing the
  // momentum guard its lenient universal tuning.
  function resolveActiveDeviceAdjustment(): TabWheelDeviceTuningAdjustment {
    if (!settings.deviceAwareTuning) return resolveDeviceTuningAdjustment("unknown");
    return resolveDeviceTuningAdjustment(classifyWheelDevice(wheelSampleWindow));
  }

  function runWheelCycle(
    direction: "prev" | "next",
    deltaDirection: 1 | -1,
    now: number,
    extraCooldownMs: number,
  ): boolean {
    if (now - lastWheelCycleAt < settings.wheelCooldownMs + extraCooldownMs) return false;
    wheelBurstCount = computeNextBurstCount(now);
    lastWheelCycleAt = now;
    // The guard tracks raw delta sign, not the mapped prev/next direction, so
    // an inverted-scroll setup still recognizes its own momentum tail. It also
    // inherits this gesture's peak magnitude, so the first delta after the
    // commit is judged against a real envelope instead of being swallowed.
    momentumGuardSession = createMomentumGuardSession(now, deltaDirection, gestureMagnitudePeakPx);
    void cycleTabWheel(direction, "gesture").catch(() => {});
    return true;
  }

  function wheelHandler(event: WheelEvent): void {
    if (!event.isTrusted) return;
    const wheelDelta = normalizeWheelDelta(
      event,
      window.innerHeight,
      window.innerWidth,
      settings.horizontalWheel,
    );
    const now = Date.now();
    // Sampled before the modifier check on purpose: plain scrolling and
    // momentum tails are the evidence the classifier needs. Timing, deltaMode,
    // and magnitude only — no direction, no target, no page content.
    addWheelSample(wheelSampleWindow, {
      timeStampMs: now,
      deltaMode: event.deltaMode,
      deltaMagnitudePx: Math.abs(wheelDelta),
    });
    if (!isKeyboardWheelEvent(event)) return;
    if (wheelDelta === 0) return;
    suppressPageEvent(event);
    const deviceAdjustment = resolveActiveDeviceAdjustment();
    if (
      momentumGuardSession
      && shouldBlockWheelDelta(
        momentumGuardSession,
        wheelDelta,
        now,
        deviceAdjustment.momentumGuardTuning,
      )
    ) {
      return;
    }
    wheelAccumulator += wheelDelta;
    // Blocked deltas return above, so a tail can never raise this peak.
    gestureMagnitudePeakPx = Math.max(gestureMagnitudePeakPx, Math.abs(wheelDelta));
    const baseDistance = resolveWheelTriggerDistance(
      WHEEL_TRIGGER_THRESHOLD_PX,
      settings.wheelSensitivity,
    );
    const acceleratedDistance = resolveAcceleratedWheelTriggerDistance(
      baseDistance,
      computeNextBurstCount(now),
      settings.wheelAcceleration,
    );
    // Effective distance only: stored sensitivity, presets, and the settings
    // UI never see this. A 1.0 multiplier is an exact no-op.
    const triggerDistance = acceleratedDistance * deviceAdjustment.triggerDistanceMultiplier;
    if (Math.abs(wheelAccumulator) < triggerDistance) return;
    const direction = resolveWheelDirection(wheelAccumulator, settings.invertScroll);
    const cycleRan = runWheelCycle(
      direction,
      wheelAccumulator > 0 ? 1 : -1,
      now,
      deviceAdjustment.extraCooldownMs,
    );
    if (cycleRan || settings.overshootGuard) {
      wheelAccumulator = 0;
      gestureMagnitudePeakPx = 0;
      return;
    }
    wheelAccumulator = Math.sign(wheelAccumulator) * Math.min(
      Math.abs(wheelAccumulator),
      triggerDistance,
    );
  }

  function resetWheelGestureState(): void {
    wheelAccumulator = 0;
    gestureMagnitudePeakPx = 0;
    lastWheelCycleAt = 0;
    wheelBurstCount = 0;
    momentumGuardSession = null;
  }

  function storageChangedHandler(
    changes: Record<string, browser.Storage.StorageChange>,
    areaName: string,
  ): void {
    if (areaName !== "local") return;
    const settingsChange = changes[TABWHEEL_STORAGE_KEYS.settings];
    if (!settingsChange) return;
    settings = normalizeTabWheelSettings(settingsChange.newValue);
    if (!settings.restorePagePosition) {
      cancelScrollRestore();
      if (scrollSaveTimer) {
        window.clearTimeout(scrollSaveTimer);
        scrollSaveTimer = 0;
      }
    }
    resetWheelGestureState();
    resetMiddleClickSession();
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
    }
  }

  function visibilityHandler(): void {
    if (document.visibilityState !== "hidden") return;
    cancelScrollRestore();
    resetWheelGestureState();
    resetMiddleClickSession();
    if (isTopFrameContext) flushScrollSnapshot();
  }

  function pageHideHandler(): void {
    cancelScrollRestore();
    flushScrollSnapshot();
  }

  window.addEventListener("pointerdown", middleClickHandler, true);
  window.addEventListener("mousedown", middleClickHandler, true);
  window.addEventListener("pointerup", middleClickHandler, true);
  window.addEventListener("mouseup", middleClickHandler, true);
  window.addEventListener("auxclick", middleClickHandler, true);
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
    window.removeEventListener("pointerdown", middleClickHandler, true);
    window.removeEventListener("mousedown", middleClickHandler, true);
    window.removeEventListener("pointerup", middleClickHandler, true);
    window.removeEventListener("mouseup", middleClickHandler, true);
    window.removeEventListener("auxclick", middleClickHandler, true);
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
    resetMiddleClickSession();
    if (scrollSaveTimer) window.clearTimeout(scrollSaveTimer);
    if (statusTimer) window.clearTimeout(statusTimer);
    document.getElementById(STATUS_ID)?.remove();
  };

  if (isTopFrameContext) {
    void browser.runtime.sendMessage({ type: "TABWHEEL_CONTENT_READY" }).catch(() => {});
  }
}
