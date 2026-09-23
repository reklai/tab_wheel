// Wheel math for the tab-switch gesture: which modifier chord counts, how one
// wheel event becomes a signed pixel distance, whether it is a detent of a
// notched wheel, how far the wheel must travel to switch a tab, and which tab
// a switch lands on.
//
// Browser-free (no DOM, no extension APIs) so it runs under node:test and is
// shared by the content script (appInit.ts), the first-run gesture demo
// (onboarding.ts), and the background's cycle logic. Callers own the
// accumulator, cooldown, and clock.

/** The modifier flags of a keyboard, mouse, or wheel event. */
export interface TabWheelModifierState {
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/**
 * True when exactly the configured chord is held: `modifier`, Shift only when
 * `withShift` is set, and nothing else. The match is exact so that chords the
 * user did not pick, such as Ctrl+wheel (page zoom) or Shift+wheel (sideways
 * scroll), stay with the browser.
 */
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

/**
 * Maps a signed wheel distance to a cycle direction. Positive (down or right)
 * is "next"; `invertScroll` swaps the two. Callers pass a non-zero distance.
 */
export function resolveWheelDirection(
  wheelDelta: number,
  invertScroll: boolean,
): "prev" | "next" {
  const normalDirection = wheelDelta > 0 ? "next" : "prev";
  if (!invertScroll) return normalDirection;
  return normalDirection === "next" ? "prev" : "next";
}

/**
 * The tab index one step from `currentTabIndex` in `direction`, chosen from the
 * eligible `tabIndices` (any order; the current tab need not be among them).
 * Past either end it wraps when `wrapAround` is set and otherwise returns
 * `currentTabIndex`, meaning "stay". Returns -1 when no tab is eligible.
 */
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

/**
 * The signed pixel distance of one wheel event on its dominant axis, without
 * notch flooring. The gesture itself accumulates measureWheelInput instead.
 */
export function normalizeWheelDelta(
  event: Pick<WheelEvent, "deltaMode" | "deltaX" | "deltaY">,
  pageHeight: number,
  pageWidth: number,
  horizontalWheel: boolean,
): number {
  return resolveWheelAxis(event, pageHeight, pageWidth, horizontalWheel).deltaPx;
}

// One event's distance in px, and the axis it was read from.
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
  // deltaMode 1 counts lines and 2 counts pages. A line is taken as 16px and a
  // page as the viewport's extent on that axis.
  const modeMultiplierY = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageHeight : 1;
  const normalizedY = event.deltaY * modeMultiplierY;
  if (!horizontalWheel) return { axis: "y", deltaPx: normalizedY };
  const modeMultiplierX = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageWidth : 1;
  const normalizedX = event.deltaX * modeMultiplierX;
  // A tilt wheel or a sideways swipe counts too. Only the axis that moved
  // further is read, so a diagonal swipe is never counted twice.
  return Math.abs(normalizedX) > Math.abs(normalizedY)
    ? { axis: "x", deltaPx: normalizedX }
    : { axis: "y", deltaPx: normalizedY };
}

/**
 * The minimum distance, in px, that one recognized notch of a detented wheel
 * contributes. How many pixels a notch reports is an OS choice: ~100-120px on
 * Windows and Linux, but macOS accelerates wheel deltas, so a slow notch can
 * report as little as 4px and a fast spin far more. Counted raw, a slow Mac
 * notch would need ~20 notches per switch and a quick spin would jump several
 * tabs. Flooring each notch here makes one detent switch one tab at every
 * preset on every OS. The trigger is 80px / sensitivity, so only a custom
 * sensitivity below 0.8 takes two notches (test/wheel-profiles.test.mjs).
 */
export const WHEEL_NOTCH_PX = 100;

// Chrome's legacy wheelDelta is the raw notch count x 120, divided by
// devicePixelRatio and truncated to an integer. Multiplying back only recovers
// whole notches to within this tolerance on HiDPI screens and zoomed pages.
const WHEEL_TICK_TOLERANCE = 0.05;
const LEGACY_WHEEL_DELTA_PER_TICK = 120;
// Precise (trackpad) events report wheelDelta = -3 x deltaY; the echo is off by
// at most the integer truncation.
const PRECISE_WHEEL_DELTA_RATIO = 3;
const PRECISE_ECHO_TOLERANCE = 1;

/**
 * The wheel-event fields notch detection reads. `wheelDeltaX`/`wheelDeltaY` are
 * Chrome's non-standard legacy deltas, missing from the WheelEvent typings.
 * When absent the event is never treated as a notch.
 */
export interface WheelNotchEvent extends Pick<WheelEvent, "deltaMode" | "deltaX" | "deltaY"> {
  wheelDeltaX?: number;
  wheelDeltaY?: number;
}

/** One wheel event as the gesture accumulates it. */
export interface WheelInput {
  /** Signed distance in px on the dominant axis; 0 means ignore the event. */
  deltaPx: number;
  /**
   * True for a detent of a notched wheel (see isWheelNotchEvent). A notch is
   * deliberate input, so it bypasses the momentum guard.
   */
  isNotch: boolean;
}

// True when a recovered tick count is a whole number of notches, at least one.
function isWholeTickCount(ticks: number): boolean {
  const rounded = Math.round(ticks);
  return rounded >= 1 && Math.abs(ticks - rounded) <= WHEEL_TICK_TOLERANCE;
}

/**
 * True when this one event is a detent of a notched wheel rather than a slice
 * of a continuous stream (trackpad, Magic Mouse, hi-res wheel). Judged from the
 * event alone, with no history or device profile, from what Chrome already
 * reports about the hardware:
 *
 * - Line and page deltaMode are whole scroll units, which only a wheel produces.
 * - In pixel mode, Chrome also reports the unaccelerated notch count through
 *   the legacy wheelDelta (on macOS from kCGScrollWheelEventDeltaAxis: +/-1 per
 *   notch however hard the OS scaled deltaY). A trackpad's wheelDelta is just
 *   -3 x deltaY, so that echo is ruled out first.
 *
 * `devicePixelRatio` must be the page's current window.devicePixelRatio,
 * because Chrome divides wheelDelta by it.
 */
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
  // A trackpad echo can land on a whole tick count by chance, so it has to be
  // excluded before the tick test below.
  if (
    Math.abs(legacyMagnitude - PRECISE_WHEEL_DELTA_RATIO * Math.abs(delta))
    <= PRECISE_ECHO_TOLERANCE
  ) {
    return false;
  }
  // Undo Chrome's division by devicePixelRatio to recover the raw tick count.
  const pixelRatio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? devicePixelRatio
    : 1;
  return isWholeTickCount(legacyMagnitude * pixelRatio / LEGACY_WHEEL_DELTA_PER_TICK);
}

/**
 * The signed distance, in px, that one wheel event contributes to a gesture,
 * read on its dominant axis. A recognized notch is floored at WHEEL_NOTCH_PX;
 * one that already reports more (Linux's 120px) keeps its own distance, so no
 * platform that switched on one notch without the floor behaves differently.
 */
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

/**
 * How far, in px, the wheel must travel to switch one tab:
 * `baseThresholdPx / sensitivity`, never below 1px. A non-positive or
 * non-finite sensitivity counts as 1.
 */
export function resolveWheelTriggerDistance(
  baseThresholdPx: number,
  sensitivity: number,
): number {
  const safeSensitivity = Number.isFinite(sensitivity) && sensitivity > 0 ? sensitivity : 1;
  return Math.max(1, baseThresholdPx / safeSensitivity);
}

// Wheel acceleration: each quick switch in a burst takes 6px off the trigger,
// counting at most 6 of them, and the trigger never drops below 40px.
const MAX_BURST_COUNT = 6;
const BURST_REDUCTION_PX_PER_BURST = 6;
const MIN_ACCELERATED_TRIGGER_DISTANCE_PX = 40;

/**
 * The trigger distance, in px, with wheel acceleration applied. `burstCount`
 * is how many switches in a row came quickly (counted by the caller); each
 * shortens the trigger, with the result held at 40px or more. Returns
 * `triggerDistancePx` unchanged when acceleration is off.
 */
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
