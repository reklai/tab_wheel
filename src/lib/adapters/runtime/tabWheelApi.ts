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

export function cycleTabWheel(
  direction: "prev" | "next",
  source: TabWheelCycleSource = "gesture",
): Promise<TabWheelActionResult> {
  return sendRuntimeMessage<TabWheelActionResult>({
    type: "TABWHEEL_CYCLE",
    direction,
    source,
  });
}

export function refreshCurrentTabWheel(windowId?: number): Promise<TabWheelRefreshResult> {
  return sendRuntimeMessage<TabWheelRefreshResult>({
    type: "TABWHEEL_REFRESH_CURRENT_TAB",
    windowId,
  });
}

export function setTabWheelCycleScope(
  cycleScope: TabWheelCycleScope,
  windowId?: number,
  options: TabWheelStatusOptions = {},
): Promise<TabWheelActionResult> {
  return sendRuntimeMessage<TabWheelActionResult>({
    type: "TABWHEEL_SET_CYCLE_SCOPE",
    cycleScope,
    windowId,
    suppressPageStatus: options.suppressPageStatus,
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
