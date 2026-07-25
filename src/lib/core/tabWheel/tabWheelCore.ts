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
  const modeMultiplierY = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageHeight : 1;
  const normalizedY = event.deltaY * modeMultiplierY;
  if (!horizontalWheel) return normalizedY;
  const modeMultiplierX = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageWidth : 1;
  const normalizedX = event.deltaX * modeMultiplierX;
  return Math.abs(normalizedX) > Math.abs(normalizedY) ? normalizedX : normalizedY;
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
