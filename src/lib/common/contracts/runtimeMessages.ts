// Single focused message contract shared by the background, content script,
// popup, options page, and onboarding page.

export type ContentRuntimeMessage =
  | { type: "TABWHEEL_PING" }
  | { type: "GET_SCROLL" }
  | ({ type: "SET_SCROLL" } & ScrollData)
  | { type: "TABWHEEL_STATUS"; message: string };

export type BackgroundRuntimeMessage =
  | { type: "TABWHEEL_CONTENT_READY" }
  | { type: "TABWHEEL_CYCLE"; direction: "prev" | "next"; source: TabWheelCycleSource }
  | { type: "TABWHEEL_REFRESH_CURRENT_TAB"; windowId?: number }
  | { type: "TABWHEEL_GET_OVERVIEW"; windowId?: number }
  | { type: "TABWHEEL_SET_CYCLE_SCOPE"; cycleScope: TabWheelCycleScope; windowId?: number; suppressPageStatus?: boolean }
  | ({ type: "TABWHEEL_SAVE_SCROLL_POSITION" } & ScrollData)
  | { type: "TABWHEEL_OPEN_OPTIONS" }
  | { type: "TABWHEEL_RESET_STATE" }
  | { type: "TABWHEEL_ACTIVATE_CONTENT_SCRIPTS" };
