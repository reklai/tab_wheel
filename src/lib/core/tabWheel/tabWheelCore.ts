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

/** One wheel event's distance on each axis, in px. */
export interface WheelAxesPx {
  x: number;
  y: number;
}

/** Both axes of one wheel event in px, using the same units as resolveWheelAxis. */
export function measureWheelAxes(
  event: Pick<WheelEvent, "deltaMode" | "deltaX" | "deltaY">,
  pageHeight: number,
  pageWidth: number,
): WheelAxesPx {
  const multiplierX = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageWidth : 1;
  const multiplierY = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageHeight : 1;
  const x = event.deltaX * multiplierX;
  const y = event.deltaY * multiplierY;
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
}

/**
 * How far, in px, a swipe must travel on its leading axis before that axis is
 * locked in. A few events' worth: enough to see past the first noisy deltas,
 * far short of the distance that switches a tab.
 */
export const SWIPE_AXIS_LOCK_PX = 10;
/**
 * After the lock is set, travel is judged in stretches of this many px (both
 * axes added together). A stretch that ran mostly on the other axis moves the
 * lock there.
 */
export const SWIPE_AXIS_RELOCK_PX = 24;
/** How many times further the other axis must go in a stretch to take the lock. */
export const SWIPE_AXIS_RELOCK_RATIO = 2;

/**
 * Which axis a continuous swipe is read on. Fingers never move in a perfectly
 * straight line, so reading each event on whichever axis moved further lets a
 * diagonal swipe count some events vertically and some horizontally; when the
 * two point opposite ways (down and to the left) the swipe cancels itself. A
 * swipe is instead read on one axis: the axis that covered more ground once
 * SWIPE_AXIS_LOCK_PX has been travelled. The lock only moves when the fingers
 * plainly run along the other axis (see SWIPE_AXIS_RELOCK_PX), so a swipe
 * whose first few px leaned the wrong way is not lost for its whole length.
 */
export interface SwipeAxisLock {
  /** The locked axis, or null while the swipe has not travelled far enough. */
  axis: "x" | "y" | null;
  /** Unsigned distance seen on each axis so far, in px. */
  travelXPx: number;
  travelYPx: number;
  /** Unsigned distance on each axis in the current stretch since the lock. */
  stretchXPx: number;
  stretchYPx: number;
}

/** A lock for a swipe that has not started. Also used to reset one in place. */
export function createSwipeAxisLock(): SwipeAxisLock {
  return { axis: null, travelXPx: 0, travelYPx: 0, stretchXPx: 0, stretchYPx: 0 };
}

/**
 * The axis to read one event of a swipe on, updating `lock`. Until the lock
 * is set this is the axis leading so far, with vertical winning a tie. Once
 * set it is the locked axis, which a stretch run on the other axis can move.
 */
export function resolveSwipeAxis(lock: SwipeAxisLock, axes: WheelAxesPx): "x" | "y" {
  if (lock.axis) {
    lock.stretchXPx += Math.abs(axes.x);
    lock.stretchYPx += Math.abs(axes.y);
    if (lock.stretchXPx + lock.stretchYPx < SWIPE_AXIS_RELOCK_PX) return lock.axis;
    const lockedPx = lock.axis === "x" ? lock.stretchXPx : lock.stretchYPx;
    const otherPx = lock.axis === "x" ? lock.stretchYPx : lock.stretchXPx;
    if (otherPx >= lockedPx * SWIPE_AXIS_RELOCK_RATIO) lock.axis = lock.axis === "x" ? "y" : "x";
    lock.stretchXPx = 0;
    lock.stretchYPx = 0;
    return lock.axis;
  }
  lock.travelXPx += Math.abs(axes.x);
  lock.travelYPx += Math.abs(axes.y);
  const leading = lock.travelXPx > lock.travelYPx ? "x" : "y";
  if (Math.max(lock.travelXPx, lock.travelYPx) >= SWIPE_AXIS_LOCK_PX) lock.axis = leading;
  return leading;
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
  /**
   * True for part of a detent from a wheel that reports less than a whole
   * notch per event (hi-res and smooth-scrolling wheels). It is wheel input,
   * so it is paced by the wheel's trigger and cooldown, not counted as swipe
   * travel; unlike a notch it is not floored and does not bypass the guards.
   */
  isWheelSlice: boolean;
}

/**
 * What kind of device one wheel event came from: a whole detent of a notched
 * wheel, part of a detent ("slice"), or a continuous swipe.
 */
export type WheelEventKind = "notch" | "slice" | "swipe";

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
  return classifyWheelEvent(event, axis, devicePixelRatio) === "notch";
}

/**
 * Sorts one event into notch, slice, or swipe by the rules described on
 * isWheelNotchEvent. A slice is what is left when the legacy wheelDelta is
 * present, is not a trackpad's echo of deltaY, and is not a whole number of
 * notches: a wheel reporting a fraction of a detent (a hi-res wheel sends a
 * quarter notch as wheelDelta 30). An event with no usable wheelDelta is a
 * swipe.
 */
export function classifyWheelEvent(
  event: WheelNotchEvent,
  axis: "x" | "y",
  devicePixelRatio: number,
): WheelEventKind {
  const delta = axis === "x" ? event.deltaX : event.deltaY;
  if (!Number.isFinite(delta) || delta === 0) return "swipe";
  if (event.deltaMode !== 0) return "notch";
  const legacyDelta = axis === "x" ? event.wheelDeltaX : event.wheelDeltaY;
  if (typeof legacyDelta !== "number" || !Number.isFinite(legacyDelta) || legacyDelta === 0) {
    return "swipe";
  }
  const legacyMagnitude = Math.abs(legacyDelta);
  // A trackpad echo can land on a whole tick count by chance, so it has to be
  // excluded before the tick test below.
  if (
    Math.abs(legacyMagnitude - PRECISE_WHEEL_DELTA_RATIO * Math.abs(delta))
    <= PRECISE_ECHO_TOLERANCE
  ) {
    return "swipe";
  }
  // Undo Chrome's division by devicePixelRatio to recover the raw tick count.
  const pixelRatio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? devicePixelRatio
    : 1;
  return isWholeTickCount(legacyMagnitude * pixelRatio / LEGACY_WHEEL_DELTA_PER_TICK)
    ? "notch"
    : "slice";
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
  if (deltaPx === 0 || !Number.isFinite(deltaPx)) {
    return { deltaPx: 0, isNotch: false, isWheelSlice: false };
  }
  const kind = classifyWheelEvent(event, axis, devicePixelRatio);
  if (kind !== "notch") return { deltaPx, isNotch: false, isWheelSlice: kind === "slice" };
  return {
    deltaPx: Math.sign(deltaPx) * Math.max(Math.abs(deltaPx), WHEEL_NOTCH_PX),
    isNotch: true,
    isWheelSlice: false,
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

/** Finger travel per switch, in px, before any sensitivity is applied. */
export const SWIPE_STEP_PX = 100;
/**
 * How much more sensitive a swipe is than SWIPE_STEP_PX at the same setting.
 * At the default sensitivity of 1 this makes a tab cost 50px of travel.
 */
export const SWIPE_SENSITIVITY_BOOST = 2;

/**
 * How far, in px, fingers travel per tab on a continuous device (trackpad,
 * Magic Mouse): SWIPE_STEP_PX / (wheelSensitivity x SWIPE_SENSITIVITY_BOOST).
 * It is derived from the one Sensitivity setting, so a preset that makes the
 * wheel quicker makes swipes quicker with it. A swipe switches one tab each
 * time it covers this distance and keeps the remainder, so the same travel
 * gives the same number of tabs at any speed. A non-positive or non-finite
 * sensitivity counts as 1.
 */
export function resolveSwipeStepPx(wheelSensitivity: number): number {
  const safeSensitivity = Number.isFinite(wheelSensitivity) && wheelSensitivity > 0
    ? wheelSensitivity
    : 1;
  return SWIPE_STEP_PX / (safeSensitivity * SWIPE_SENSITIVITY_BOOST);
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
