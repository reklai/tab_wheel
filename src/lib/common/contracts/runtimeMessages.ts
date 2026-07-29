// Single focused message contract shared by the background, content script,
// popup, options page, and onboarding page.

export type ContentRuntimeMessage =
  | { type: "TABWHEEL_PING" }
  | { type: "GET_SCROLL" }
  | ({ type: "SET_SCROLL" } & ScrollData);

export type BackgroundRuntimeMessage =
  | { type: "TABWHEEL_CONTENT_READY" }
  | {
    type: "TABWHEEL_CYCLE";
    direction: "prev" | "next";
    source: TabWheelCycleSource;
    windowId?: number;
  }
  | { type: "TABWHEEL_REFRESH_CURRENT_TAB"; windowId?: number }
  | { type: "TABWHEEL_GET_OVERVIEW"; windowId?: number }
  | { type: "TABWHEEL_OPEN_NATIVE_NEW_TAB"; windowId?: number }
  | { type: "TABWHEEL_ACTIVATE_MOST_RECENT_TAB"; windowId?: number }
  | { type: "TABWHEEL_CLOSE_CURRENT_TAB_AND_ACTIVATE_RECENT"; windowId?: number }
  | { type: "TABWHEEL_DUPLICATE_TAB"; windowId?: number }
  | { type: "TABWHEEL_BEGIN_TAB_DRAG"; gestureId: string }
  | { type: "TABWHEEL_MOVE_CURRENT_TAB"; direction: TabWheelMoveDirection; gestureId: string }
  | { type: "TABWHEEL_END_TAB_DRAG"; gestureId: string }
  | ({ type: "TABWHEEL_SAVE_SCROLL_POSITION" } & ScrollData)
  | { type: "TABWHEEL_OPEN_OPTIONS" }
  | { type: "TABWHEEL_RESET_STATE" }
  | { type: "TABWHEEL_ACTIVATE_CONTENT_SCRIPTS" };
