// Policy for the modifier+click actions: which physical button maps to which
// action, which DOM event runs it, and when the button's claim on its event
// sequence ends. A configured button is claimed from press through completion,
// so the page sees none of it, and runs exactly one mapped action.
//
// Browser-free so it runs under node:test; the content script (appInit.ts)
// owns the listeners. The action list and default mapping live here too, and
// the settings contract (contracts/tabWheel.ts) re-exports them.

/** A click action that does something; "none" never produces a policy. */
export type TabWheelMouseGestureAction = Exclude<TabWheelClickAction, "none">;
/** The DOM event on which a click action runs (see BUTTON_RUN_PHASES). */
export type TabWheelMouseGestureRunPhase = "click" | "auxclick" | "contextmenu";
/**
 * "click" runs the action once at its run phase; "drag" hands the press to
 * the live tab-drag gesture instead.
 */
export type TabWheelMouseGestureInteraction = "click" | "drag";

/** The per-button action mapping, as stored in settings. */
export interface TabWheelClickActionSettings {
  leftClickAction: TabWheelClickAction;
  middleClickAction: TabWheelClickAction;
  rightClickAction: TabWheelClickAction;
}

/** How the content script handles presses of one mapped button. */
export interface TabWheelMouseGesturePolicy {
  action: TabWheelMouseGestureAction;
  /** MouseEvent.button: 0 left, 1 middle, 2 right. */
  button: number;
  interaction: TabWheelMouseGestureInteraction;
  /** Set only for "click" interactions. */
  runPhase?: TabWheelMouseGestureRunPhase;
}

/** One claimed press of a mapped button. */
export interface TabWheelMouseGestureSession {
  policy: TabWheelMouseGesturePolicy;
  /** Set once the action has run, so a press runs it at most once. */
  hasRun: boolean;
  /** When the press arrived, in ms (Date.now()). */
  startedAt: number;
}

/** The fields of a DOM mouse or pointer event the policy reads. */
export interface TabWheelMouseGestureEvent {
  type: string;
  button: number;
}

/**
 * How long, in ms, a press stays claimed. An older session is dropped, so a
 * press whose closing event never arrived (released outside the window, focus
 * lost) cannot swallow a later, unrelated click. The content script also uses
 * it to claim the events that trail a right-click action.
 */
export const MOUSE_GESTURE_CLAIM_MS = 900;

/**
 * Every click action, in dropdown order: alphabetical by user-facing label,
 * with Off ("none") pinned last as the disable option. Membership, defaults,
 * and normalization do not depend on this order, so reordering never changes
 * any saved or default mapping.
 */
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

/**
 * The mapping for a fresh install: left opens a browser new tab, middle drags
 * the current tab, and right closes the current tab for the most recent one.
 */
export const DEFAULT_TABWHEEL_CLICK_ACTION_SETTINGS: TabWheelClickActionSettings = {
  leftClickAction: "nativeNewTab",
  middleClickAction: "dragCurrentTab",
  rightClickAction: "closeToRecent",
};

// The event each button's action runs on. Right runs on contextmenu, which is
// not the last event of a right press; the content script keeps the button
// claimed afterwards so the trailing mouseup and auxclick are swallowed too.
const BUTTON_RUN_PHASES: ReadonlyArray<{
  button: number;
  runPhase: TabWheelMouseGestureRunPhase;
}> = [
  { button: 0, runPhase: "click" },
  { button: 1, runPhase: "auxclick" },
  { button: 2, runPhase: "contextmenu" },
];

/**
 * One policy per mapped button, skipping buttons set to Off. "dragCurrentTab"
 * becomes a drag with no run phase; every other action runs on its button's
 * phase from BUTTON_RUN_PHASES.
 */
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

/** The policy for `button`, or null when that button is not mapped. */
export function resolveMouseGesturePolicy(
  button: number,
  policies: readonly TabWheelMouseGesturePolicy[],
): TabWheelMouseGesturePolicy | null {
  return policies.find((policy) => policy.button === button) ?? null;
}

/**
 * Whether `event` is a press that can open a session. Either press event
 * qualifies; whichever arrives first opens it, and the other is then
 * swallowed as part of the same press.
 */
export function isMouseGestureSessionStartEvent(event: TabWheelMouseGestureEvent): boolean {
  return event.type === "pointerdown" || event.type === "mousedown";
}

/** Claims a press of `policy.button` that arrived at `startedAt` (ms). */
export function createMouseGestureSession(
  policy: TabWheelMouseGesturePolicy,
  startedAt: number,
): TabWheelMouseGestureSession {
  return { policy, hasRun: false, startedAt };
}

/** True once more than `claimMs` has passed since the press. */
export function isMouseGestureSessionExpired(
  session: TabWheelMouseGestureSession,
  now: number,
  claimMs = MOUSE_GESTURE_CLAIM_MS,
): boolean {
  return now - session.startedAt > claimMs;
}

/**
 * Whether `event` belongs to the press `session` claimed. A contextmenu event
 * always belongs to a right-button session, whatever its button field says.
 */
export function isMouseGestureEventForSession(
  session: TabWheelMouseGestureSession,
  event: TabWheelMouseGestureEvent,
): boolean {
  return event.type === "contextmenu" && session.policy.button === 2
    ? true
    : event.button === session.policy.button;
}

/**
 * True for the one event that runs a click session's action: its run phase,
 * the first time it arrives. Drag sessions never run here.
 */
export function shouldRunMouseGestureSession(
  session: TabWheelMouseGestureSession,
  eventType: string,
): boolean {
  return session.policy.interaction === "click"
    && !session.hasRun
    && eventType === session.policy.runPhase;
}

/**
 * True when `eventType` ends a click session. A right-button session also ends
 * on click or auxclick, so a press whose contextmenu never arrived is not left
 * claimed.
 */
export function shouldFinishMouseGestureSession(
  session: TabWheelMouseGestureSession,
  eventType: string,
): boolean {
  if (session.policy.interaction !== "click") return false;
  if (eventType === session.policy.runPhase) return true;
  return session.policy.button === 2 && (eventType === "click" || eventType === "auxclick");
}
