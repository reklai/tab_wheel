// The runtime message contract: every message sent between the extension's
// contexts, grouped by receiver. Shared by the background, content script,
// popup, options page, and onboarding page, so a sender and its handler can
// never disagree on a message's shape.

/** Messages the background sends to a tab's content script (top frame only). */
export type ContentRuntimeMessage =
  // Liveness check: only a tab with a live content script answers.
  | { type: "TABWHEEL_PING" }
  | { type: "GET_SCROLL" }
  | ({ type: "SET_SCROLL" } & ScrollData);

/**
 * Messages the content script and extension pages send to the background.
 * The sender's tab picks the target tab; `windowId` is for senders without a
 * tab, such as the popup. Expected failures reply with `ok: false` results
 * rather than errors.
 */
export type BackgroundRuntimeMessage =
  // A content script finished loading. Also sent mid-gesture to wake a
  // suspended service worker early, because its handler awaits nothing.
  | { type: "TABWHEEL_CONTENT_READY" }
  | {
    type: "TABWHEEL_CYCLE";
    direction: "prev" | "next";
    source: TabWheelCycleSource;
    windowId?: number;
  }
  // Reinjects the content script into the current tab and reports whether it
  // is ready.
  | { type: "TABWHEEL_REFRESH_CURRENT_TAB"; windowId?: number }
  | { type: "TABWHEEL_GET_OVERVIEW"; windowId?: number }
  | { type: "TABWHEEL_OPEN_NATIVE_NEW_TAB"; windowId?: number }
  | { type: "TABWHEEL_ACTIVATE_MOST_RECENT_TAB"; windowId?: number }
  | { type: "TABWHEEL_CLOSE_CURRENT_TAB_AND_ACTIVATE_RECENT"; windowId?: number }
  | { type: "TABWHEEL_DUPLICATE_TAB"; windowId?: number }
  | { type: "TABWHEEL_TOGGLE_MUTE"; windowId?: number }
  | { type: "TABWHEEL_GO_BACK"; windowId?: number }
  | { type: "TABWHEEL_GO_FORWARD"; windowId?: number }
  // One drag is one gestureId from begin to end, so a late move from a drag
  // that already ended is rejected instead of moving the tab.
  | { type: "TABWHEEL_BEGIN_TAB_DRAG"; gestureId: string }
  | { type: "TABWHEEL_MOVE_CURRENT_TAB"; direction: TabWheelMoveDirection; gestureId: string }
  | { type: "TABWHEEL_END_TAB_DRAG"; gestureId: string }
  | ({ type: "TABWHEEL_SAVE_SCROLL_POSITION" } & ScrollData)
  | { type: "TABWHEEL_OPEN_OPTIONS" }
  // Restores default settings and clears scroll memory and recent tabs.
  | { type: "TABWHEEL_RESET_STATE" }
  // Injects the content script into every open tab except discarded and
  // restricted ones.
  | { type: "TABWHEEL_ACTIVATE_CONTENT_SCRIPTS" };
