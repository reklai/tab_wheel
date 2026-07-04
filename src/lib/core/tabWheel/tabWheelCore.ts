// Pure wheel-cycling math — no browser APIs. Covers direction resolution,
// cycle target indices, wheel-delta normalization, sensitivity/acceleration
// trigger distances, and page-scroll delta scaling. Side-effect free so unit
// tests can exercise gesture behavior without a browser.

export function resolveWheelDirection(
  wheelDeltaY: number,
  invertScroll: boolean,
): "prev" | "next" {
  const normalDirection = wheelDeltaY > 0 ? "next" : "prev";
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

export function normalizeWheelDeltaY(event: Pick<WheelEvent, "deltaMode" | "deltaY">, pageHeight: number): number {
  if (event.deltaMode === 1) return event.deltaY * 16;
  if (event.deltaMode === 2) return event.deltaY * pageHeight;
  return event.deltaY;
}

export function normalizeWheelDelta(
  event: Pick<WheelEvent, "deltaMode" | "deltaX" | "deltaY">,
  pageHeight: number,
  pageWidth: number,
  horizontalWheel: boolean,
): number {
  const normalizedY = normalizeWheelDeltaY(event, pageHeight);
  if (!horizontalWheel) return normalizedY;
  const normalizedX = event.deltaMode === 1
    ? event.deltaX * 16
    : event.deltaMode === 2
      ? event.deltaX * pageWidth
      : event.deltaX;
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
  const burstReduction = cappedBurstCount * BURST_REDUCTION_PX_PER_BURST;
  return Math.max(MIN_ACCELERATED_TRIGGER_DISTANCE_PX, triggerDistancePx - burstReduction);
}

export function shouldUseNativePageScroll(
  speedMultiplier: number,
  viewportCapRatio: number,
): boolean {
  return Math.abs(speedMultiplier - 1) < 0.001 && Math.abs(viewportCapRatio - 1) < 0.001;
}

export function scalePageScrollDelta(
  wheelDelta: number,
  speedMultiplier: number,
  viewportSize: number,
  viewportCapRatio: number,
): number {
  const multiplier = Number.isFinite(speedMultiplier) ? Math.max(0, speedMultiplier) : 1;
  const capRatio = Number.isFinite(viewportCapRatio) ? Math.max(0, viewportCapRatio) : 1;
  const scaledDelta = wheelDelta * multiplier;
  const maxStep = Math.max(1, viewportSize) * capRatio;
  if (maxStep <= 0) return 0;
  return Math.sign(scaledDelta) * Math.min(Math.abs(scaledDelta), maxStep);
}
