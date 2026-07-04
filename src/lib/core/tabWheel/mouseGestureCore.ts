// Pure click-gesture model with no browser APIs: the remappable click-action
// catalog, per-button event rules (which DOM event starts and finishes each
// gesture), and session timing. appInit.ts uses this to convert raw mouse
// events into actions; keeping it pure lets tests cover the mapping directly.

export type TabWheelMouseGestureAction = Exclude<TabWheelClickAction, "none">;
export type TabWheelMouseGestureRunPhase = "sessionStart" | "auxclick" | "contextmenu";
export type TabWheelMouseGestureEventType = "click" | "auxclick" | "contextmenu";

export interface TabWheelMouseGesturePolicy {
  action: TabWheelMouseGestureAction;
  button: number;
  runPhase: TabWheelMouseGestureRunPhase;
  finishEvents: readonly TabWheelMouseGestureEventType[];
}

export type TabWheelMouseGestureButtonMechanics = Omit<TabWheelMouseGesturePolicy, "action">;

export interface TabWheelClickActionSettings {
  leftClickAction: TabWheelClickAction;
  middleClickAction: TabWheelClickAction;
  rightClickAction: TabWheelClickAction;
}

export interface TabWheelMouseGestureSession {
  policy: TabWheelMouseGesturePolicy;
  hasRun: boolean;
  startedAt: number;
}

export interface TabWheelMouseGestureEvent {
  type: string;
  button: number;
}

export const MOUSE_GESTURE_CLAIM_MS = 900;

export const TABWHEEL_CLICK_ACTIONS: readonly TabWheelClickAction[] = [
  "search",
  "nativeNewTab",
  "recentTab",
  "closeToRecent",
  "duplicateTab",
  "openSettings",
  "none",
];

export const DEFAULT_TABWHEEL_CLICK_ACTION_SETTINGS: TabWheelClickActionSettings = {
  leftClickAction: "search",
  middleClickAction: "recentTab",
  rightClickAction: "closeToRecent",
};

export const MOUSE_GESTURE_BUTTON_MECHANICS: readonly TabWheelMouseGestureButtonMechanics[] = [
  {
    button: 0,
    runPhase: "sessionStart",
    finishEvents: ["click"],
  },
  {
    button: 1,
    runPhase: "auxclick",
    finishEvents: ["auxclick"],
  },
  {
    button: 2,
    runPhase: "contextmenu",
    finishEvents: ["click", "auxclick", "contextmenu"],
  },
];

export function buildMouseGesturePolicies(
  clickActions: TabWheelClickActionSettings,
): readonly TabWheelMouseGesturePolicy[] {
  const clickActionsByButton: readonly TabWheelClickAction[] = [
    clickActions.leftClickAction,
    clickActions.middleClickAction,
    clickActions.rightClickAction,
  ];
  return MOUSE_GESTURE_BUTTON_MECHANICS.flatMap((mechanics) => {
    const clickAction = clickActionsByButton[mechanics.button];
    if (clickAction === "none") return [];
    return [{ action: clickAction, ...mechanics }];
  });
}

export const MOUSE_GESTURE_POLICIES: readonly TabWheelMouseGesturePolicy[] =
  buildMouseGesturePolicies(DEFAULT_TABWHEEL_CLICK_ACTION_SETTINGS);

export function resolveMouseGesturePolicy(
  button: number,
  policies: readonly TabWheelMouseGesturePolicy[] = MOUSE_GESTURE_POLICIES,
): TabWheelMouseGesturePolicy | null {
  return policies.find((policy) => policy.button === button) || null;
}

export function isMouseGestureStartEventType(eventType: string): boolean {
  return eventType === "pointerdown" || eventType === "mousedown";
}

export function isMouseGestureSessionStartEventType(eventType: string): boolean {
  return isMouseGestureStartEventType(eventType)
    || eventType === "click"
    || eventType === "contextmenu"
    || eventType === "auxclick";
}

export function shouldSuppressRedundantGestureStart(
  eventType: string,
  button: number,
  firedButtons: ReadonlySet<number>,
): boolean {
  if (isMouseGestureStartEventType(eventType)) return false;
  return firedButtons.has(button);
}

export function createMouseGestureSession(
  policy: TabWheelMouseGesturePolicy,
  startedAt: number,
): TabWheelMouseGestureSession {
  return {
    policy,
    hasRun: false,
    startedAt,
  };
}

export function isMouseGestureSessionExpired(
  session: TabWheelMouseGestureSession,
  now: number,
  claimMs = MOUSE_GESTURE_CLAIM_MS,
): boolean {
  return now - session.startedAt > claimMs;
}

export function isMouseGestureEventForSession(
  session: TabWheelMouseGestureSession,
  event: TabWheelMouseGestureEvent,
): boolean {
  if (event.type === "contextmenu" && session.policy.button === 2) return true;
  return event.button === session.policy.button;
}

export function shouldRunMouseGestureSession(
  session: TabWheelMouseGestureSession,
  eventType: string,
): boolean {
  if (session.hasRun) return false;
  return session.policy.runPhase === "sessionStart" || eventType === session.policy.runPhase;
}

export function isMouseGestureFinishEventType(eventType: string): eventType is TabWheelMouseGestureEventType {
  return eventType === "click" || eventType === "auxclick" || eventType === "contextmenu";
}

export function shouldFinishMouseGestureSession(
  session: TabWheelMouseGestureSession,
  eventType: string,
): boolean {
  return isMouseGestureFinishEventType(eventType)
    && session.policy.finishEvents.includes(eventType);
}
