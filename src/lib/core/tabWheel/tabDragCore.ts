// Browser-free mechanics for the live "Drag current tab" action. Pointer
// distance and tab-strip boundaries live here so page and background wiring
// can stay small and the interaction remains deterministic across browsers.

export type TabDragDirection = "left" | "right";

export interface TabDragState {
  anchorX: number;
  blockedDirection: TabDragDirection | null;
  // The direction of the last committed step, so a reversal can be made
  // "sticky" (require extra travel) without affecting continued travel.
  lastDirection: TabDragDirection | null;
}

export interface TabDragAdvance {
  state: TabDragState;
  directions: TabDragDirection[];
}

export interface TabDragTab {
  index: number;
  pinned?: boolean;
  groupId?: number;
}

export interface MovedTabResult {
  id: number;
  index: number;
}

export const TAB_DRAG_STEP_PX = 56;
// A reversal must clear the step plus this margin before the tab steps back,
// so a settled slot "sticks" and a small over-travel or hand jitter does not
// bounce the tab past where the user meant to drop it. Continuing in the same
// direction still costs one plain step, so forward travel stays 56px per slot.
export const TAB_DRAG_REVERSE_HYSTERESIS_PX = 24;

export function createTabDragState(anchorX: number): TabDragState {
  return {
    anchorX,
    blockedDirection: null,
    lastDirection: null,
  };
}

export function advanceTabDragState(
  state: TabDragState,
  clientX: number,
  stepPx = TAB_DRAG_STEP_PX,
  reverseHysteresisPx = TAB_DRAG_REVERSE_HYSTERESIS_PX,
): TabDragAdvance {
  const safeStepPx = Number.isFinite(stepPx) && stepPx > 0
    ? stepPx
    : TAB_DRAG_STEP_PX;
  const safeHysteresisPx = Number.isFinite(reverseHysteresisPx) && reverseHysteresisPx >= 0
    ? reverseHysteresisPx
    : TAB_DRAG_REVERSE_HYSTERESIS_PX;
  const deltaX = clientX - state.anchorX;
  if (deltaX === 0) return { state, directions: [] };

  const direction: TabDragDirection = deltaX > 0 ? "right" : "left";
  const directionSign = direction === "right" ? 1 : -1;
  const absDeltaX = Math.abs(deltaX);

  // A free reversal (changing direction, not pulling back off a blocked edge)
  // must clear one step plus the hysteresis before the first step back. Pulling
  // away from a blocked edge stays responsive so the tab is easy to recover.
  const isReversal = state.lastDirection != null && direction !== state.lastDirection;
  const isBoundaryRecovery = state.blockedDirection != null && direction !== state.blockedDirection;
  const firstStepPx = isReversal && !isBoundaryRecovery
    ? safeStepPx + safeHysteresisPx
    : safeStepPx;
  if (absDeltaX < firstStepPx) return { state, directions: [] };

  const stepCount = 1 + Math.floor((absDeltaX - firstStepPx) / safeStepPx);
  const consumedPx = firstStepPx + (stepCount - 1) * safeStepPx;
  const nextState: TabDragState = {
    anchorX: state.anchorX + directionSign * consumedPx,
    blockedDirection: state.blockedDirection === direction ? direction : null,
    lastDirection: direction,
  };
  return {
    state: nextState,
    directions: state.blockedDirection === direction
      ? []
      : Array.from({ length: stepCount }, () => direction),
  };
}

export function markTabDragBoundary(
  state: TabDragState,
  direction: TabDragDirection,
): TabDragState {
  return {
    ...state,
    blockedDirection: direction,
  };
}

export function clearTabDragBoundary(state: TabDragState): TabDragState {
  if (state.blockedDirection == null) return state;
  return {
    ...state,
    blockedDirection: null,
  };
}

export function coalesceTabDragDirections(
  pending: readonly TabDragDirection[],
  incoming: readonly TabDragDirection[],
): TabDragDirection[] {
  const next = [...pending];
  for (const direction of incoming) {
    const previous = next[next.length - 1];
    if (previous && previous !== direction) next.pop();
    else next.push(direction);
  }
  return next;
}

export function reconcileTabDragBoundaryDirections(
  pending: readonly TabDragDirection[],
  blockedDirection: TabDragDirection,
): TabDragDirection[] {
  const oppositeDirection: TabDragDirection =
    blockedDirection === "right" ? "left" : "right";
  if (pending[0] === oppositeDirection) return pending.slice(1);
  return pending.filter((direction) => direction !== blockedDirection);
}

export function isTabDragButtonPressed(button: number, buttons: number): boolean {
  const mask = button === 0 ? 1 : button === 1 ? 4 : button === 2 ? 2 : 0;
  return mask !== 0 && (buttons & mask) === mask;
}

export function resolveMovedTabResult(
  result: unknown,
  expectedTabId: number,
): MovedTabResult | null {
  const candidates: readonly unknown[] = Array.isArray(result)
    ? result
    : result != null
      ? [result]
      : [];

  for (const candidate of candidates) {
    if (candidate === null || typeof candidate !== "object") continue;
    try {
      const id = Reflect.get(candidate, "id");
      const index = Reflect.get(candidate, "index");
      if (
        id === expectedTabId
        && typeof index === "number"
        && Number.isInteger(index)
        && index >= 0
      ) {
        return { id, index };
      }
    } catch {
      // Treat malformed extension API values as an unsuccessful move.
    }
  }
  return null;
}

function normalizeGroupId(groupId: number | undefined): number {
  return groupId ?? -1;
}

export function resolveTabDragTargetIndex(
  activeTab: TabDragTab,
  tabs: readonly TabDragTab[],
  direction: TabDragDirection,
): number | null {
  const targetIndex = activeTab.index + (direction === "right" ? 1 : -1);
  const neighbor = tabs.find((tab) => tab.index === targetIndex);
  if (!neighbor) return null;
  if ((neighbor.pinned === true) !== (activeTab.pinned === true)) return null;
  if (normalizeGroupId(neighbor.groupId) !== normalizeGroupId(activeTab.groupId)) return null;
  return targetIndex;
}
