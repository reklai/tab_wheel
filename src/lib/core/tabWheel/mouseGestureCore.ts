// Browser-free click gesture policy. A configured physical button is claimed
// from press through completion and runs exactly one mapped action.

export type TabWheelMouseGestureAction = Exclude<TabWheelClickAction, "none">;
export type TabWheelMouseGestureRunPhase = "click" | "auxclick" | "contextmenu";
export type TabWheelMouseGestureInteraction = "click" | "drag";

export interface TabWheelClickActionSettings {
  leftClickAction: TabWheelClickAction;
  middleClickAction: TabWheelClickAction;
  rightClickAction: TabWheelClickAction;
}

export interface TabWheelMouseGesturePolicy {
  action: TabWheelMouseGestureAction;
  button: number;
  interaction: TabWheelMouseGestureInteraction;
  runPhase?: TabWheelMouseGestureRunPhase;
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

// The actions are listed alphabetically by their user-facing label (the
// dropdown order), with Off ("none") pinned last as the disable option.
// Membership, defaults, and normalization do not depend on this order, so
// reordering never changes any saved or default mapping.
export const TABWHEEL_CLICK_ACTIONS: readonly TabWheelClickAction[] = [
  "nativeNewTab",   // Browser new tab
  "closeToRecent",  // Close current tab
  "dragCurrentTab", // Drag current tab
  "duplicateTab",   // Duplicate tab
  "goBack",         // Go back
  "goForward",      // Go forward
  "recentTab",      // Most recent tab
  "muteTab",        // Mute / unmute tab
  "openSettings",   // Open settings
  "none",           // Off (always last)
];

export const DEFAULT_TABWHEEL_CLICK_ACTION_SETTINGS: TabWheelClickActionSettings = {
  leftClickAction: "nativeNewTab",
  middleClickAction: "dragCurrentTab",
  rightClickAction: "closeToRecent",
};

const BUTTON_RUN_PHASES: ReadonlyArray<{
  button: number;
  runPhase: TabWheelMouseGestureRunPhase;
}> = [
  { button: 0, runPhase: "click" },
  { button: 1, runPhase: "auxclick" },
  { button: 2, runPhase: "contextmenu" },
];

export function buildMouseGesturePolicies(
  actions: TabWheelClickActionSettings,
): readonly TabWheelMouseGesturePolicy[] {
  const actionsByButton = [
    actions.leftClickAction,
    actions.middleClickAction,
    actions.rightClickAction,
  ] as const;
  const policies: TabWheelMouseGesturePolicy[] = [];
  for (const { button, runPhase } of BUTTON_RUN_PHASES) {
    const action = actionsByButton[button];
    if (action === "none") continue;
    if (action === "dragCurrentTab") {
      policies.push({ action, button, interaction: "drag" });
      continue;
    }
    policies.push({ action, button, interaction: "click", runPhase });
  }
  return policies;
}

export function resolveMouseGesturePolicy(
  button: number,
  policies: readonly TabWheelMouseGesturePolicy[],
): TabWheelMouseGesturePolicy | null {
  return policies.find((policy) => policy.button === button) ?? null;
}

export function isMouseGestureSessionStartEvent(event: TabWheelMouseGestureEvent): boolean {
  return event.type === "pointerdown" || event.type === "mousedown";
}

export function createMouseGestureSession(
  policy: TabWheelMouseGesturePolicy,
  startedAt: number,
): TabWheelMouseGestureSession {
  return { policy, hasRun: false, startedAt };
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
  return event.type === "contextmenu" && session.policy.button === 2
    ? true
    : event.button === session.policy.button;
}

export function shouldRunMouseGestureSession(
  session: TabWheelMouseGestureSession,
  eventType: string,
): boolean {
  return session.policy.interaction === "click"
    && !session.hasRun
    && eventType === session.policy.runPhase;
}

export function shouldFinishMouseGestureSession(
  session: TabWheelMouseGestureSession,
  eventType: string,
): boolean {
  if (session.policy.interaction !== "click") return false;
  if (eventType === session.policy.runPhase) return true;
  return session.policy.button === 2 && (eventType === "click" || eventType === "auxclick");
}
