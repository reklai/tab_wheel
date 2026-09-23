// Typed request functions for every background message. This is the only
// place UI code and the content script should build a BackgroundRuntimeMessage.
//
// Message path, end to end:
//   caller (content script appInit, popup, options, onboarding)
//     -> a function here, which builds the message
//     -> runtimeClient.sendRuntimeMessage (browser.runtime.sendMessage)
//     -> runtimeRouter: the background's single onMessage listener
//     -> tabWheelMessageHandler: switches on message.type
//     -> TabWheelDomain method, whose return value resolves the caller's promise.
// Adding a message means touching each hop plus the union in runtimeMessages.ts.
//
// `windowId` lets a caller with no sender tab (the toolbar popup) name the
// window to act on. When it is omitted, the background uses the sender tab's
// window, falling back to the current window.

import { sendRuntimeMessage, sendRuntimeMessageWithRetry, RuntimeRetryPolicy } from "./runtimeClient";

/**
 * Reads the active tab's position and whether TabWheel is live on that page,
 * retrying while the worker wakes. The router lets overview failures reject
 * (instead of returning a failure result) so this retry can tell a sleeping
 * worker from a real empty state.
 */
export function getTabWheelOverviewWithRetry(
  windowId?: number,
  policy: RuntimeRetryPolicy = { retryDelaysMs: [0, 90, 240, 450] },
): Promise<TabWheelOverview> {
  return sendRuntimeMessageWithRetry<TabWheelOverview>(
    { type: "TABWHEEL_GET_OVERVIEW", windowId },
    policy,
  );
}

/**
 * Tells the background this tab's content script is live. It doubles as the
 * MV3 worker pre-warm (see appInit's wheelHandler): the handler for this type
 * returns without awaiting anything, so it is the cheapest way to wake a
 * sleeping worker, and re-asserting readiness is exactly what a restarted
 * worker needs to hear. Keep the handler non-blocking for that reason.
 */
export function notifyTabWheelContentReady(): Promise<TabWheelActionResult> {
  return sendRuntimeMessage<TabWheelActionResult>({ type: "TABWHEEL_CONTENT_READY" });
}

/**
 * Switches one tab in `direction`. `source` says whether a wheel gesture or
 * the popup buttons asked; only gestures count toward the popup's first-use
 * note.
 */
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

/** Opens the browser's own New Tab page beside the current tab. */
export function openNativeNewTabWheelTab(windowId?: number): Promise<TabWheelActionResult> {
  return sendRuntimeMessage<TabWheelActionResult>({
    type: "TABWHEEL_OPEN_NATIVE_NEW_TAB",
    windowId,
  });
}

/** Switches to the most recently active other tab in the window. */
export function activateMostRecentTabWheelTab(windowId?: number): Promise<TabWheelActionResult> {
  return sendRuntimeMessage<TabWheelActionResult>({
    type: "TABWHEEL_ACTIVATE_MOST_RECENT_TAB",
    windowId,
  });
}

/** Closes the current tab and lands on the most recently active one. */
export function closeCurrentTabWheelTabAndActivateRecent(
  windowId?: number,
): Promise<TabWheelActionResult> {
  return sendRuntimeMessage<TabWheelActionResult>({
    type: "TABWHEEL_CLOSE_CURRENT_TAB_AND_ACTIVATE_RECENT",
    windowId,
  });
}

/** Duplicates the current tab beside it and selects the copy. */
export function duplicateCurrentTabWheelTab(windowId?: number): Promise<TabWheelActionResult> {
  return sendRuntimeMessage<TabWheelActionResult>({
    type: "TABWHEEL_DUPLICATE_TAB",
    windowId,
  });
}

/** Mutes or unmutes the current tab. */
export function toggleMuteCurrentTabWheelTab(windowId?: number): Promise<TabWheelActionResult> {
  return sendRuntimeMessage<TabWheelActionResult>({
    type: "TABWHEEL_TOGGLE_MUTE",
    windowId,
  });
}

/**
 * Navigates the current tab back one history entry. On success the sender
 * page unloads, so the returned promise may reject even though it worked.
 */
export function goBackInCurrentTabWheelTab(windowId?: number): Promise<TabWheelActionResult> {
  return sendRuntimeMessage<TabWheelActionResult>({
    type: "TABWHEEL_GO_BACK",
    windowId,
  });
}

/** Navigates the current tab forward; same unload caveat as going back. */
export function goForwardInCurrentTabWheelTab(windowId?: number): Promise<TabWheelActionResult> {
  return sendRuntimeMessage<TabWheelActionResult>({
    type: "TABWHEEL_GO_FORWARD",
    windowId,
  });
}

/**
 * Moves the sender tab one slot during a drag. `gestureId` must match the id
 * passed to beginTabWheelDragGesture, or the move is refused as timed out.
 */
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

/**
 * Opens a drag session for the sender tab. The background queues other tab
 * work in that window behind the session until endTabWheelDragGesture (or a
 * timeout) releases it.
 */
export function beginTabWheelDragGesture(gestureId: string): Promise<TabWheelActionResult> {
  return sendRuntimeMessage<TabWheelActionResult>({
    type: "TABWHEEL_BEGIN_TAB_DRAG",
    gestureId,
  });
}

/** Releases the drag session opened with the same `gestureId`. */
export function endTabWheelDragGesture(gestureId: string): Promise<TabWheelActionResult> {
  return sendRuntimeMessage<TabWheelActionResult>({
    type: "TABWHEEL_END_TAB_DRAG",
    gestureId,
  });
}

/** Clears stored settings, recent-tab history, and scroll memory. */
export function resetTabWheelState(): Promise<TabWheelActionResult> {
  return sendRuntimeMessage<TabWheelActionResult>({ type: "TABWHEEL_RESET_STATE" });
}

/**
 * Injects the content script into every open tab that can run it. Used by the
 * Refresh buttons; resolves with how many tabs were injected.
 */
export function activateTabWheelContentScripts(): Promise<TabWheelContentScriptActivationResult> {
  return sendRuntimeMessage<TabWheelContentScriptActivationResult>({
    type: "TABWHEEL_ACTIVATE_CONTENT_SCRIPTS",
  });
}

/** Records the sender tab's scroll position so a later switch can restore it. */
export function saveTabWheelScrollPosition(scroll: ScrollData): Promise<TabWheelActionResult> {
  return sendRuntimeMessage<TabWheelActionResult>({
    type: "TABWHEEL_SAVE_SCROLL_POSITION",
    ...scroll,
  });
}

/** Opens the settings page in a tab. */
export function openTabWheelOptions(): Promise<TabWheelActionResult> {
  return sendRuntimeMessage<TabWheelActionResult>({ type: "TABWHEEL_OPEN_OPTIONS" });
}
