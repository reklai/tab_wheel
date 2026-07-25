// After a tab-switch commit, trackpad hardware keeps delivering wheel events
// for the physical fling that triggered it (momentum). Left unguarded, that
// tail re-triggers extra switches the user never intended. This module is a
// pure, browser-free decision + session-state tracker: it does not know
// about wheel events, tab indices, or timers — only signed pixel deltas and
// timestamps supplied by the caller.
//
// Two properties make the judgment work where a per-event comparison fails:
//
// 1. The session is SEEDED with the magnitude the gesture ended on, so the
//    very first delta after a commit is measured against something real
//    instead of being swallowed for lack of a reference.
// 2. Decay is judged over a SLIDING WINDOW of recent magnitudes. Hardware
//    momentum fades only a few percent per event at 60-120Hz, which is
//    indistinguishable from steady input one event at a time but unmistakable
//    across four. The window slides so a stream that fades and then settles
//    is released on its settled level, not held against where it started.

export interface MomentumGuardTuning {
  // Momentum arrives as a dense stream. A gap wider than this cannot be a
  // hardware tail — it is a detented wheel, a pause, or deliberate scrolling.
  maxTailGapMs: number;
  // A delta this many times the current envelope is a fresh, intentional input.
  rampRatio: number;
  // Net amplitude loss across the window below which a run counts as steady
  // input rather than a decaying tail.
  steadyDecayFraction: number;
  // How many same-sign magnitudes the steady window holds.
  steadyEventCount: number;
}

// One tuning for every device. The guard used to receive a stricter variant
// when a classifier decided the stream came from a trackpad; that machinery is
// gone, so these values are what every gesture is judged against.
//
// maxTailGapMs 24 is the load-bearing number: hardware momentum is a dense
// 8-16ms stream, so a gap wider than this cannot be a tail. A detented wheel
// cannot notch faster than its own ~40ms cadence, which is what keeps clicky
// wheels outside the guard's scope entirely — at zero cost, without needing to
// recognize them. steadyEventCount 4 with steadyDecayFraction 0.08 is the
// design's thinnest margin (a 3%/event tail shows 1 - 0.97^3 = 0.0873 net decay
// across the window, so it stays blocked); test/momentum-guard-core.test.mjs
// pins that trade explicitly.
export const DEFAULT_MOMENTUM_GUARD_TUNING: MomentumGuardTuning = {
  maxTailGapMs: 24,
  rampRatio: 1.3,
  steadyDecayFraction: 0.08,
  steadyEventCount: 4,
};

export interface MomentumGuardSession {
  direction: 1 | -1;
  active: boolean;
  lastEventAtMs: number;
  envelopeMagnitudePx: number;
  recentMagnitudesPx: number[];
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
    envelopeMagnitudePx: seed,
    recentMagnitudesPx: [],
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

  // Momentum streams have no gaps. A stream this sparse is a pause, a detented
  // wheel, or hand-driven scrolling — none of which has a momentum tail — so
  // whatever follows is new and intentional.
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
  const recent = session.recentMagnitudesPx;
  recent.push(magnitude);
  while (recent.length > tuning.steadyEventCount) recent.shift();
  if (recent.length < tuning.steadyEventCount) return true;

  // Verdict over the window rather than event to event: a real tail keeps
  // losing ground across every window it appears in, while steady input (a
  // free-spinning wheel, a held finger) hovers. Measuring the window against
  // itself instead of against the committing magnitude is what lets a stream
  // that dropped once and then settled be released on its settled level.
  const oldestMagnitude = recent[0];
  const netDecay = oldestMagnitude > 0 ? 1 - magnitude / oldestMagnitude : 0;
  if (netDecay < tuning.steadyDecayFraction) {
    reArm(session);
    return false;
  }

  return true;
}
