// Browser-free mechanics for the live "Drag current tab" action. Pointer
// distance and tab-strip boundaries live here so page and background wiring
// can stay small and the interaction remains deterministic across browsers.

export type TabDragDirection = "left" | "right";

export interface TabDragState {
  anchorX: number;
  blockedDirection: TabDragDirection | null;
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

export const TAB_DRAG_STEP_PX = 80;

export function createTabDragState(anchorX: number): TabDragState {
  return {
    anchorX,
    blockedDirection: null,
  };
}

export function advanceTabDragState(
  state: TabDragState,
  clientX: number,
  stepPx = TAB_DRAG_STEP_PX,
): TabDragAdvance {
  const safeStepPx = Number.isFinite(stepPx) && stepPx > 0
    ? stepPx
    : TAB_DRAG_STEP_PX;
  const deltaX = clientX - state.anchorX;
  const stepCount = Math.floor(Math.abs(deltaX) / safeStepPx);
  if (stepCount === 0) return { state, directions: [] };

  const direction: TabDragDirection = deltaX > 0 ? "right" : "left";
  const directionSign = direction === "right" ? 1 : -1;
  const nextState: TabDragState = {
    anchorX: state.anchorX + directionSign * stepCount * safeStepPx,
    blockedDirection: state.blockedDirection === direction
      ? direction
      : null,
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
