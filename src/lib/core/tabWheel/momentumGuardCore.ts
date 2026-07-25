// After a tab-switch commit, trackpad hardware keeps delivering wheel events
// for the physical fling that triggered it (momentum). Left unguarded, that
// tail re-triggers extra switches the user never intended. This module is a
// pure, browser-free decision + session-state tracker: it does not know
// about wheel events, tab indices, or timers — only signed pixel deltas and
// timestamps supplied by the caller.
//
// Two properties make the judgment work where a per-event comparison fails:
//
// 1. The session is SEEDED with the envelope of the gesture that committed,
//    so the very first delta after a commit is measured against something
//    real instead of being swallowed for lack of a reference.
// 2. Decay is judged CUMULATIVELY against that seed. Hardware momentum fades
//    only a few percent per event at 60-120Hz, which is indistinguishable
//    from steady input one event at a time but unmistakable over five.

export interface MomentumGuardTuning {
  // A pause this long ends the gesture outright.
  idleGapMs: number;
  // Momentum arrives as a dense stream. A gap wider than this cannot be a
  // hardware tail — it is a detented wheel or deliberate scrolling.
  maxTailGapMs: number;
  // A delta this many times the current envelope is a fresh, intentional input.
  rampRatio: number;
  // Cumulative amplitude loss (as a fraction of the seed) below which a run
  // counts as steady input rather than a decaying tail.
  steadyDecayFraction: number;
  // How many same-sign events to observe before the steady verdict is allowed.
  steadyEventCount: number;
}

export interface MomentumGuardSession {
  direction: 1 | -1;
  active: boolean;
  lastEventAtMs: number;
  seedMagnitudePx: number;
  envelopeMagnitudePx: number;
  sameSignEventCount: number;
}

export function createMomentumGuardSession(
  committedAtMs: number,
  direction: 1 | -1,
  seedMagnitudePx: number,
): MomentumGuardSession {
  const seed = Number.isFinite(seedMagnitudePx) ? Math.abs(seedMagnitudePx) : 0;
  return {
    direction,
    // With no envelope carried from the committing gesture there is nothing to
    // measure a tail against, so the guard stays out of the way entirely.
    active: seed > 0,
    lastEventAtMs: committedAtMs,
    seedMagnitudePx: seed,
    envelopeMagnitudePx: seed,
    sameSignEventCount: 0,
  };
}

function signOfDelta(deltaPx: number): 1 | -1 | 0 {
  if (deltaPx > 0) return 1;
  if (deltaPx < 0) return -1;
  return 0;
}

function reArm(session: MomentumGuardSession): void {
  session.active = false;
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
  // The tighter of the two cadence tests: a stream this sparse is a detented
  // wheel or hand-driven scrolling, neither of which has a momentum tail.
  if (gapMs > tuning.maxTailGapMs) reArm(session);
  if (!session.active) return false;

  // The user reversed direction; that can never be a momentum tail.
  const deltaSign = signOfDelta(deltaPx);
  if (deltaSign !== 0 && deltaSign !== session.direction) {
    reArm(session);
    return false;
  }

  const magnitude = Math.abs(deltaPx);

  // A delta rising well above the recent envelope is a fresh, intentional
  // flick or spin — not a decaying tail. Because the envelope tracks the
  // stream downward, this escape gets easier the further a tail has faded.
  if (magnitude > session.envelopeMagnitudePx * tuning.rampRatio) {
    reArm(session);
    return false;
  }

  session.envelopeMagnitudePx = magnitude;
  session.sameSignEventCount += 1;

  // Cumulative verdict against the seed rather than against the previous
  // event: a real tail keeps losing ground on the gesture that committed,
  // while steady input (a free-spinning wheel, a held finger) hovers around
  // it. A 5%/event tail clears this threshold within two events; steady
  // input never does, so it is released as soon as there is enough evidence.
  const cumulativeDecay = 1 - session.envelopeMagnitudePx / session.seedMagnitudePx;
  if (
    session.sameSignEventCount >= tuning.steadyEventCount
    && cumulativeDecay < tuning.steadyDecayFraction
  ) {
    reArm(session);
    return false;
  }

  return true;
}
