// Mechanics of the "Drag current tab" click action: how far the pointer must
// travel per slot, which slot the tab should sit in, and which neighbor a move
// may land on without crossing a pinned or tab-group boundary.
//
// Browser-free so it runs under node:test and is shared by the content script
// (appInit.ts), the background domain (tabWheelDomain.ts), and the onboarding
// demo, keeping the page and background wiring thin.

/** Direction along the tab strip: "right" moves to a higher tab index. */
export type TabDragDirection = "left" | "right";

/** Step-based drag state, advanced by advanceTabDragState. */
export interface TabDragState {
  /** Pointer x (client px) from which the next whole step is measured. */
  anchorX: number;
  /**
   * The direction in which the tab last hit a boundary. Further steps that
   * way produce no moves until the pointer turns back.
   */
  blockedDirection: TabDragDirection | null;
}

/** The result of advancing a drag: the new state and one entry per step. */
export interface TabDragAdvance {
  state: TabDragState;
  directions: TabDragDirection[];
}

/** The fields of a tabs.Tab that the boundary check reads. */
export interface TabDragTab {
  index: number;
  pinned?: boolean;
  /** Tab group id; missing or -1 means ungrouped. */
  groupId?: number;
}

/** The tab id and new index that tabs.move reported. */
export interface MovedTabResult {
  id: number;
  index: number;
}

/** Pointer travel, in px, per slot at drag speed 1. */
export const TAB_DRAG_STEP_PX = 96;
/** Bounds, in px, on the per-slot travel at any drag speed. */
export const MIN_TAB_DRAG_STEP_PX = 40;
export const MAX_TAB_DRAG_STEP_PX = 200;

/**
 * The signed number of slots the tab should sit from where the drag began,
 * read from the pointer's live position (`clientX` against `startX`, in px).
 * The caller re-reads this before every move and steps toward it, so a stopped
 * or reversed pointer settles the tab where the pointer is now; it can never
 * run past the pointer on a queued backlog.
 */
export function resolveTabDragTargetOffset(
  startX: number,
  clientX: number,
  stepPx = TAB_DRAG_STEP_PX,
): number {
  const safeStepPx = Number.isFinite(stepPx) && stepPx > 0 ? stepPx : TAB_DRAG_STEP_PX;
  return Math.trunc((clientX - startX) / safeStepPx);
}

/**
 * Pointer travel, in px, per slot for the user's "Drag speed". Speed is a
 * sensitivity multiplier like the wheel's (travel = base / speed), so a higher
 * speed means less travel per slot. Clamped to MIN/MAX_TAB_DRAG_STEP_PX; a
 * non-positive or non-finite speed counts as 1.
 */
export function resolveTabDragStepPx(
  sensitivity: number,
  basePx = TAB_DRAG_STEP_PX,
): number {
  const safeSensitivity = Number.isFinite(sensitivity) && sensitivity > 0 ? sensitivity : 1;
  return Math.max(
    MIN_TAB_DRAG_STEP_PX,
    Math.min(MAX_TAB_DRAG_STEP_PX, Math.round(basePx / safeSensitivity)),
  );
}

/** A step-based drag anchored at the press position (client px). */
export function createTabDragState(anchorX: number): TabDragState {
  return {
    anchorX,
    blockedDirection: null,
  };
}

/**
 * Advances a step-based drag to pointer `clientX`. Every whole `stepPx` of
 * travel from the anchor is one step, and the anchor moves by the steps taken
 * so leftover travel carries into the next call. Steps toward a blocked
 * boundary move the anchor but produce no directions; a step the other way
 * clears the block.
 */
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

/** Records that the tab could not move `direction` (strip end or boundary). */
export function markTabDragBoundary(
  state: TabDragState,
  direction: TabDragDirection,
): TabDragState {
  return {
    ...state,
    blockedDirection: direction,
  };
}

/** Clears a recorded boundary after a successful move; no-op when none is set. */
export function clearTabDragBoundary(state: TabDragState): TabDragState {
  if (state.blockedDirection == null) return state;
  return {
    ...state,
    blockedDirection: null,
  };
}

/**
 * Appends `incoming` steps to the `pending` queue, cancelling opposite pairs:
 * a step that reverses the last queued one removes it instead of queuing a
 * round trip, so the queue only ever holds steps in one direction.
 */
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

/**
 * Fixes up the queue after a move toward `blockedDirection` turned out to be a
 * no-op at a boundary. If the queue starts with the opposite step, that step
 * was queued to undo the move that never happened, so only it is dropped.
 * Otherwise every queued step toward the boundary is dropped, since none of
 * them can succeed.
 */
export function reconcileTabDragBoundaryDirections(
  pending: readonly TabDragDirection[],
  blockedDirection: TabDragDirection,
): TabDragDirection[] {
  const oppositeDirection: TabDragDirection =
    blockedDirection === "right" ? "left" : "right";
  if (pending[0] === oppositeDirection) return pending.slice(1);
  return pending.filter((direction) => direction !== blockedDirection);
}

/**
 * Whether `button` (MouseEvent.button: 0 left, 1 middle, 2 right) is still held
 * according to a MouseEvent.buttons bitmask. The two number the buttons
 * differently (in `buttons` right is 2 and middle is 4), hence the
 * mapping. Lets a drag notice a release that happened outside the page, where
 * no mouseup reached it.
 */
export function isTabDragButtonPressed(button: number, buttons: number): boolean {
  const mask = button === 0 ? 1 : button === 1 ? 4 : button === 2 ? 2 : 0;
  return mask !== 0 && (buttons & mask) === mask;
}

/**
 * Finds `expectedTabId` in what tabs.move resolved with, which is a single tab
 * or an array depending on the call. Returns null, meaning the move did not
 * happen, when that tab is missing or its index is not a valid index.
 */
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

// Chrome reports ungrouped tabs as -1 (tabGroups.TAB_GROUP_ID_NONE).
function normalizeGroupId(groupId: number | undefined): number {
  return groupId ?? -1;
}

/**
 * The index the active tab moves to one slot in `direction`, or null when that
 * slot is past the end of the strip or across a structural boundary: a drag
 * never moves a tab between the pinned and unpinned sections, or into or out
 * of a tab group.
 */
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
