// Typed wrappers around every TabWheel runtime message. UI surfaces and the
// content script call these instead of building message objects by hand, so
// the message contract has one place to check on the sending side.

import { sendRuntimeMessage, sendRuntimeMessageWithRetry, RuntimeRetryPolicy } from "./runtimeClient";
import { normalizeSearchQuery } from "../../common/contracts/tabWheel";

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
): Promise<TabWheelActionResult> {
  return sendRuntimeMessage<TabWheelActionResult>({
    type: "TABWHEEL_CYCLE",
    direction,
  });
}

export function refreshCurrentTabWheel(windowId?: number): Promise<TabWheelRefreshResult> {
  return sendRuntimeMessage<TabWheelRefreshResult>({
    type: "TABWHEEL_REFRESH_CURRENT_TAB",
    windowId,
  });
}

export function toggleTabWheelCycleScope(windowId?: number): Promise<TabWheelActionResult> {
  return sendRuntimeMessage<TabWheelActionResult>({
    type: "TABWHEEL_TOGGLE_CYCLE_SCOPE",
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

export function openTabWheelSearchTab(query: string, windowId?: number): Promise<TabWheelActionResult> {
  return sendRuntimeMessage<TabWheelActionResult>({
    type: "TABWHEEL_OPEN_SEARCH_TAB",
    query: normalizeSearchQuery(query),
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

export function closeCurrentTabWheelTabAndActivateRecent(windowId?: number): Promise<TabWheelActionResult> {
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

export function saveTabWheelScrollPosition(scroll: ScrollData): Promise<TabWheelActionResult> {
  return sendRuntimeMessage<TabWheelActionResult>({
    type: "TABWHEEL_SAVE_SCROLL_POSITION",
    ...scroll,
  });
}

export function openTabWheelHelp(): Promise<TabWheelActionResult> {
  return sendRuntimeMessage<TabWheelActionResult>({ type: "TABWHEEL_OPEN_HELP" });
}

export function openTabWheelOptions(): Promise<TabWheelActionResult> {
  return sendRuntimeMessage<TabWheelActionResult>({ type: "TABWHEEL_OPEN_OPTIONS" });
}
