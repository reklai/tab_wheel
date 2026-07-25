// Keep the middle-click exception small and browser-free. The content script
// adapts DOM events to this session so pointer/mouse compatibility events never
// open settings twice.

export interface TabWheelMiddleClickSession {
  startedAt: number;
  hasRun: boolean;
}

export interface TabWheelMiddleClickEvent {
  type: string;
  button: number;
}

export const MIDDLE_CLICK_CLAIM_MS = 900;

export function isMiddleClickEvent(event: TabWheelMiddleClickEvent): boolean {
  return event.button === 1;
}

export function isMiddleClickSessionStartEvent(event: TabWheelMiddleClickEvent): boolean {
  return isMiddleClickEvent(event)
    && (event.type === "pointerdown" || event.type === "mousedown" || event.type === "auxclick");
}

export function createMiddleClickSession(startedAt: number): TabWheelMiddleClickSession {
  return { startedAt, hasRun: false };
}

export function isMiddleClickSessionExpired(
  session: TabWheelMiddleClickSession,
  now: number,
  claimMs = MIDDLE_CLICK_CLAIM_MS,
): boolean {
  return now - session.startedAt > claimMs;
}

export function shouldRunMiddleClickSession(
  session: TabWheelMiddleClickSession,
  event: TabWheelMiddleClickEvent,
): boolean {
  return !session.hasRun && isMiddleClickEvent(event) && event.type === "auxclick";
}

export function shouldFinishMiddleClickSession(event: TabWheelMiddleClickEvent): boolean {
  return isMiddleClickEvent(event) && (event.type === "auxclick" || event.type === "click");
}
