// Keep wheel math browser-free so gesture behavior can be tested and reused by
// both normal pages and the first-run gesture demo.

export interface TabWheelModifierState {
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export function isTabWheelModifier(
  event: TabWheelModifierState,
  modifier: TabWheelModifierKey,
  withShift: boolean,
): boolean {
  const expected = {
    altKey: modifier === "alt",
    ctrlKey: modifier === "ctrl",
    metaKey: modifier === "meta",
    shiftKey: withShift,
  };
  return event.altKey === expected.altKey
    && event.ctrlKey === expected.ctrlKey
    && event.metaKey === expected.metaKey
    && event.shiftKey === expected.shiftKey;
}

export function resolveWheelDirection(
  wheelDelta: number,
  invertScroll: boolean,
): "prev" | "next" {
  const normalDirection = wheelDelta > 0 ? "next" : "prev";
  if (!invertScroll) return normalDirection;
  return normalDirection === "next" ? "prev" : "next";
}

export function resolveCycleTargetIndex(
  tabIndices: number[],
  currentTabIndex: number,
  direction: "prev" | "next",
  wrapAround: boolean,
): number {
  const candidates = tabIndices.slice().sort((left, right) => left - right);
  if (candidates.length === 0) return -1;
  if (candidates.length === 1) return candidates[0];

  if (direction === "next") {
    const nextIndex = candidates.find((index) => index > currentTabIndex);
    if (nextIndex != null) return nextIndex;
    return wrapAround ? candidates[0] : currentTabIndex;
  }

  for (let i = candidates.length - 1; i >= 0; i--) {
    if (candidates[i] < currentTabIndex) return candidates[i];
  }
  return wrapAround ? candidates[candidates.length - 1] : currentTabIndex;
}

export function normalizeWheelDelta(
  event: Pick<WheelEvent, "deltaMode" | "deltaX" | "deltaY">,
  pageHeight: number,
  pageWidth: number,
  horizontalWheel: boolean,
): number {
  return resolveWheelAxis(event, pageHeight, pageWidth, horizontalWheel).deltaPx;
}

interface WheelAxisReading {
  axis: "x" | "y";
  deltaPx: number;
}

function resolveWheelAxis(
  event: Pick<WheelEvent, "deltaMode" | "deltaX" | "deltaY">,
  pageHeight: number,
  pageWidth: number,
  horizontalWheel: boolean,
): WheelAxisReading {
  const modeMultiplierY = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageHeight : 1;
  const normalizedY = event.deltaY * modeMultiplierY;
  if (!horizontalWheel) return { axis: "y", deltaPx: normalizedY };
  const modeMultiplierX = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageWidth : 1;
  const normalizedX = event.deltaX * modeMultiplierX;
  return Math.abs(normalizedX) > Math.abs(normalizedY)
    ? { axis: "x", deltaPx: normalizedX }
    : { axis: "y", deltaPx: normalizedY };
}

// What one detent of a notched wheel is worth, whatever the OS claims. The
// pixels a notch reports are an OS decision, not a physical one: ~100-120px on
// Windows and Linux, and on macOS as little as 4px, because macOS accelerates
// wheel deltas — a slow notch is scaled way
// down and a fast spin way up. Measured in raw pixels, a Mac mouse needed ~20
// slow notches for one switch and then jumped several tabs on a quick spin.
// Flooring a recognized notch at this distance makes one detent switch one tab
// at every preset on every OS; below sensitivity 0.8 it takes two, as it should.
export const WHEEL_NOTCH_PX = 100;

// Chromium's legacy wheelDelta is the raw notch count times 120, divided by
// devicePixelRatio and truncated to an integer, so whole notches only come
// back to within this tolerance on Retina screens and zoomed pages.
const WHEEL_TICK_TOLERANCE = 0.05;
const LEGACY_WHEEL_DELTA_PER_TICK = 120;
// Precise (trackpad) events report wheelDelta = -3 x deltaY; the echo is off by
// at most the integer truncation.
const PRECISE_WHEEL_DELTA_RATIO = 3;
const PRECISE_ECHO_TOLERANCE = 1;

export interface WheelNotchEvent extends Pick<WheelEvent, "deltaMode" | "deltaX" | "deltaY"> {
  wheelDeltaX?: number;
  wheelDeltaY?: number;
}

export interface WheelInput {
  deltaPx: number;
  isNotch: boolean;
}

function isWholeTickCount(ticks: number): boolean {
  const rounded = Math.round(ticks);
  return rounded >= 1 && Math.abs(ticks - rounded) <= WHEEL_TICK_TOLERANCE;
}

// True when this one event is a detent of a notched wheel rather than a slice
// of a continuous (trackpad, Magic Mouse, hi-res wheel) stream. Judged from the
// event alone — no history, no device profile — from what Chrome already
// reports about the hardware:
//
// - Line and page mode are whole scroll units, which only a wheel produces.
// - In pixel mode, Chrome also reports the unaccelerated notch count through
//   the legacy wheelDelta (macOS: kCGScrollWheelEventDeltaAxis, +/-1 per notch
//   no matter how hard the OS scaled deltaY). A trackpad's wheelDelta is just
//   deltaY x -3, so that echo is excluded first.
export function isWheelNotchEvent(
  event: WheelNotchEvent,
  axis: "x" | "y",
  devicePixelRatio: number,
): boolean {
  const delta = axis === "x" ? event.deltaX : event.deltaY;
  if (!Number.isFinite(delta) || delta === 0) return false;
  if (event.deltaMode !== 0) return true;
  const legacyDelta = axis === "x" ? event.wheelDeltaX : event.wheelDeltaY;
  if (typeof legacyDelta !== "number" || !Number.isFinite(legacyDelta) || legacyDelta === 0) {
    return false;
  }
  const legacyMagnitude = Math.abs(legacyDelta);
  if (
    Math.abs(legacyMagnitude - PRECISE_WHEEL_DELTA_RATIO * Math.abs(delta))
    <= PRECISE_ECHO_TOLERANCE
  ) {
    return false;
  }
  const pixelRatio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? devicePixelRatio
    : 1;
  return isWholeTickCount(legacyMagnitude * pixelRatio / LEGACY_WHEEL_DELTA_PER_TICK);
}

// The signed distance one wheel event contributes to a gesture, with notches
// floored at WHEEL_NOTCH_PX. A notch that already reports more (Linux's
// 120px) keeps it, so no platform that already switched on one notch changes.
export function measureWheelInput(
  event: WheelNotchEvent,
  pageHeight: number,
  pageWidth: number,
  horizontalWheel: boolean,
  devicePixelRatio: number,
): WheelInput {
  const { axis, deltaPx } = resolveWheelAxis(event, pageHeight, pageWidth, horizontalWheel);
  if (deltaPx === 0 || !Number.isFinite(deltaPx)) return { deltaPx: 0, isNotch: false };
  if (!isWheelNotchEvent(event, axis, devicePixelRatio)) return { deltaPx, isNotch: false };
  return {
    deltaPx: Math.sign(deltaPx) * Math.max(Math.abs(deltaPx), WHEEL_NOTCH_PX),
    isNotch: true,
  };
}

export function resolveWheelTriggerDistance(
  baseThresholdPx: number,
  sensitivity: number,
): number {
  const safeSensitivity = Number.isFinite(sensitivity) && sensitivity > 0 ? sensitivity : 1;
  return Math.max(1, baseThresholdPx / safeSensitivity);
}

const MAX_BURST_COUNT = 6;
const BURST_REDUCTION_PX_PER_BURST = 6;
const MIN_ACCELERATED_TRIGGER_DISTANCE_PX = 40;

export function resolveAcceleratedWheelTriggerDistance(
  triggerDistancePx: number,
  burstCount: number,
  isAccelerationEnabled: boolean,
): number {
  if (!isAccelerationEnabled) return triggerDistancePx;
  const cappedBurstCount = Math.max(0, Math.min(MAX_BURST_COUNT, burstCount));
  return Math.max(
    MIN_ACCELERATED_TRIGGER_DISTANCE_PX,
    triggerDistancePx - cappedBurstCount * BURST_REDUCTION_PX_PER_BURST,
  );
}
