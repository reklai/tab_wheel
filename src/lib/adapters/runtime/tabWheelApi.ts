import { sendRuntimeMessage, sendRuntimeMessageWithRetry, RuntimeRetryPolicy } from "./runtimeClient";

export function getTabWheelOverview(windowId?: number): Promise<TabWheelOverview> {
  return sendRuntimeMessage<TabWheelOverview>({ type: "TABWHEEL_GET_OVERVIEW", windowId });
}

export function getTabWheelOverviewWithRetry(
  windowId?: number,
  policy: RuntimeRetryPolicy = { retryDelaysMs: [0, 90, 240, 450] },
): Promise<TabWheelOverview> {
  return sendRuntimeMessageWithRetry<TabWheelOverview>(
    { type: "TABWHEEL_GET_OVERVIEW", windowId },
    policy,
  );
}

// Doubles as the MV3 worker pre-warm (see appInit's wheelHandler): the
// background handler for this type returns without awaiting anything, so it is
// the cheapest way to wake a sleeping worker, and re-asserting readiness is
// exactly what a restarted worker needs to hear from a live content script.
export function notifyTabWheelContentReady(): Promise<TabWheelActionResult> {
  return sendRuntimeMessage<TabWheelActionResult>({ type: "TABWHEEL_CONTENT_READY" });
}

export function cycleTabWheel(
  direction: "prev" | "next",
  source: TabWheelCycleSource = "gesture",
  windowId?: number,
): Promise<TabWheelActionResult> {
  return sendRuntimeMessage<TabWheelActionResult>({
    type: "TABWHEEL_CYCLE",
    direction,
    source,
    windowId,
  });
}

export function refreshCurrentTabWheel(windowId?: number): Promise<TabWheelRefreshResult> {
  return sendRuntimeMessage<TabWheelRefreshResult>({
    type: "TABWHEEL_REFRESH_CURRENT_TAB",
    windowId,
  });
}

export function openNativeNewTabWheelTab(windowId?: number): Promise<TabWheelActionResult> {
  return sendRuntimeMessage<TabWheelActionResult>({
    type: "TABWHEEL_OPEN_NATIVE_NEW_TAB",
    windowId,
  });
}

export function activateMostRecentTabWheelTab(windowId?: number): Promise<TabWheelActionResult> {
  return sendRuntimeMessage<TabWheelActionResult>({
    type: "TABWHEEL_ACTIVATE_MOST_RECENT_TAB",
    windowId,
  });
}

export function closeCurrentTabWheelTabAndActivateRecent(
  windowId?: number,
): Promise<TabWheelActionResult> {
  return sendRuntimeMessage<TabWheelActionResult>({
    type: "TABWHEEL_CLOSE_CURRENT_TAB_AND_ACTIVATE_RECENT",
    windowId,
  });
}

export function duplicateCurrentTabWheelTab(windowId?: number): Promise<TabWheelActionResult> {
  return sendRuntimeMessage<TabWheelActionResult>({
    type: "TABWHEEL_DUPLICATE_TAB",
    windowId,
  });
}

export function moveCurrentTabWheelTab(
  direction: TabWheelMoveDirection,
  gestureId: string,
): Promise<TabWheelMoveResult> {
  return sendRuntimeMessage<TabWheelMoveResult>({
    type: "TABWHEEL_MOVE_CURRENT_TAB",
    direction,
    gestureId,
  });
}

export function beginTabWheelDragGesture(gestureId: string): Promise<TabWheelActionResult> {
  return sendRuntimeMessage<TabWheelActionResult>({
    type: "TABWHEEL_BEGIN_TAB_DRAG",
    gestureId,
  });
}

export function endTabWheelDragGesture(gestureId: string): Promise<TabWheelActionResult> {
  return sendRuntimeMessage<TabWheelActionResult>({
    type: "TABWHEEL_END_TAB_DRAG",
    gestureId,
  });
}

export function resetTabWheelState(): Promise<TabWheelActionResult> {
  return sendRuntimeMessage<TabWheelActionResult>({ type: "TABWHEEL_RESET_STATE" });
}

export function activateTabWheelContentScripts(): Promise<TabWheelContentScriptActivationResult> {
  return sendRuntimeMessage<TabWheelContentScriptActivationResult>({
    type: "TABWHEEL_ACTIVATE_CONTENT_SCRIPTS",
  });
}

export function saveTabWheelScrollPosition(scroll: ScrollData): Promise<TabWheelActionResult> {
  return sendRuntimeMessage<TabWheelActionResult>({
    type: "TABWHEEL_SAVE_SCROLL_POSITION",
    ...scroll,
  });
}

export function openTabWheelOptions(): Promise<TabWheelActionResult> {
  return sendRuntimeMessage<TabWheelActionResult>({ type: "TABWHEEL_OPEN_OPTIONS" });
}
