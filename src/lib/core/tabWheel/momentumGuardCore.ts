// After a tab-switch commit, trackpad hardware keeps delivering wheel events
// for the physical fling that triggered it (momentum). Left unguarded, that
// tail re-triggers extra switches the user never intended. This module is a
// pure, browser-free decision + session-state tracker: it does not know
// about wheel events, tab indices, or timers — only signed pixel deltas and
// timestamps supplied by the caller.

export interface MomentumGuardTuning {
  idleGapMs: number;
  rampRatio: number;
  decayTolerance: number;
}

export interface MomentumGuardSession {
  direction: 1 | -1;
  active: boolean;
  lastEventAtMs: number;
  envelopeMagnitudePx: number | null;
}

export function createMomentumGuardSession(
  committedAtMs: number,
  direction: 1 | -1,
): MomentumGuardSession {
  return {
    direction,
    active: true,
    lastEventAtMs: committedAtMs,
    envelopeMagnitudePx: null,
  };
}

function signOfDelta(deltaPx: number): 1 | -1 | 0 {
  if (deltaPx > 0) return 1;
  if (deltaPx < 0) return -1;
  return 0;
}

function reArm(session: MomentumGuardSession): void {
  session.active = false;
  session.envelopeMagnitudePx = null;
}

// Pure decision with session-state update rules baked in: every call both
// answers "should this delta be swallowed?" and advances the session so the
// next call sees an up-to-date envelope/timestamp. A session is one-shot per
// commit — once re-armed it stays re-armed until a new session is created.
export function shouldBlockWheelDelta(
  session: MomentumGuardSession,
  deltaPx: number,
  nowMs: number,
  tuning: MomentumGuardTuning,
): boolean {
  const gapMs = nowMs - session.lastEventAtMs;
  session.lastEventAtMs = nowMs;

  // Momentum streams have no gaps. A pause this long means the physical
  // gesture ended, so any further input is new and intentional.
  if (gapMs > tuning.idleGapMs) reArm(session);
  if (!session.active) return false;

  // The user reversed direction; that can never be a momentum tail.
  const deltaSign = signOfDelta(deltaPx);
  if (deltaSign !== 0 && deltaSign !== session.direction) {
    reArm(session);
    return false;
  }

  const magnitude = Math.abs(deltaPx);
  const envelope = session.envelopeMagnitudePx;

  if (envelope == null) {
    // First same-sign sample since the commit: there is nothing to compare a
    // trend against yet. Treat it conservatively as still the trailing edge
    // of the gesture that fired the switch.
    session.envelopeMagnitudePx = magnitude;
    return true;
  }

  if (magnitude > envelope * tuning.rampRatio) {
    // A delta rising well above the recent envelope is a fresh, intentional
    // flick or spin — not a decaying tail.
    reArm(session);
    return false;
  }

  if (magnitude < envelope * (1 - tuning.decayTolerance)) {
    // Meaningfully smaller than the envelope: still decaying. Keep guarding
    // and shrink the envelope to the new low.
    session.envelopeMagnitudePx = magnitude;
    return true;
  }

  // Roughly steady (within tolerance of the envelope, neither shrinking nor
  // ramping). A free-spin wheel keeps delivering ticks like this, so this is
  // not a decaying tail — stop guarding and let it through.
  reArm(session);
  return false;
}
