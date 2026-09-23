// After a tab-switch commit, trackpad hardware keeps delivering wheel events
// for the physical fling that triggered it (momentum). Left unguarded, that
// tail re-triggers extra switches the user never intended. This module is a
// pure, browser-free decision + session-state tracker: it does not know
// about wheel events, tab indices, or timers — only signed pixel deltas and
// timestamps supplied by the caller.
//
// Chrome 151+ flags momentum events directly (WheelEvent.momentum) and the
// content script drops those before they get here; this guard is what judges
// every stream that carries no such flag (Chrome before 151, and any platform
// that does not report the flag).
//
// Three properties make the judgment hold on real hardware:
//
// 1. The session is SEEDED with the magnitude the gesture ended on, so the
//    very first delta after a commit is measured against something real
//    instead of being swallowed for lack of a reference.
// 2. Decay is judged over TIME, not over a count of events. Hardware momentum
//    loses a fixed fraction per millisecond, so a 120Hz display delivers half
//    the per-event decay of a 60Hz one. Counting events let a ProMotion Mac's
//    tail read as steady input and switch tabs on its own.
// 3. The session WATCHES THE WHOLE STREAM rather than releasing once. A swipe
//    is finger motion followed by momentum with no gap in between, and a
//    finger is steady or ramping right up until it lifts. A guard that let go
//    the first time it saw steady or rising input was always gone by the time
//    the tail arrived. Now a delta passes while the stream is steady or
//    rising and is blocked whenever it is decaying, until the stream ends.

export interface MomentumGuardTuning {
  // Momentum arrives as a dense stream. A gap wider than this cannot be a
  // hardware tail: it is a detented wheel, a pause, or a new gesture.
  maxTailGapMs: number;
  // A delta this many times the previous one is a fresh, intentional input.
  rampRatio: number;
  // ...and it must also rise by at least this many pixels, so the integer
  // rounding of a faint tail (2px, 3px, 2px) never reads as a fresh flick.
  rampMinRisePx: number;
  // How far back the decay verdict looks.
  tailWindowMs: number;
  // Until the window spans this long there is too little evidence to call a
  // same-level delta steady, so it is held as a tail candidate.
  minJudgeSpanMs: number;
  // A window losing at least this fraction per millisecond, without rising
  // anywhere inside it, is a decaying tail.
  minTailDecayPerMs: number;
  // Rises smaller than this fraction of the previous delta are rounding noise,
  // not a rise, when checking that a window only falls.
  riseToleranceRatio: number;
}

// One tuning for every device.
//
// maxTailGapMs 48 is three 60Hz frames: a tail survives a couple of dropped
// frames on a busy page, while a detented wheel (~40ms+ between notches) is
// recognized as a notch before it ever reaches the guard.
//
// minTailDecayPerMs 0.0008 is ~3% across the 40ms window. macOS momentum
// sheds roughly 0.2% per millisecond, so it clears the bar with a wide margin
// at 60Hz and 120Hz alike; steady input shows ~0 and passes.
export const DEFAULT_MOMENTUM_GUARD_TUNING: MomentumGuardTuning = {
  maxTailGapMs: 48,
  rampRatio: 1.3,
  rampMinRisePx: 2,
  tailWindowMs: 40,
  minJudgeSpanMs: 24,
  minTailDecayPerMs: 0.0008,
  riseToleranceRatio: 0.02,
};

export interface MomentumGuardSample {
  atMs: number;
  magnitudePx: number;
}

export interface MomentumGuardSession {
  direction: 1 | -1;
  active: boolean;
  lastEventAtMs: number;
  envelopeMagnitudePx: number;
  recentSamples: MomentumGuardSample[];
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
    // The committing delta is the first real sample of the stream.
    recentSamples: seed > 0 ? [{ atMs: committedAtMs, magnitudePx: seed }] : [],
  };
}

function signOfDelta(deltaPx: number): 1 | -1 | 0 {
  if (deltaPx > 0) return 1;
  if (deltaPx < 0) return -1;
  return 0;
}

function endSession(session: MomentumGuardSession): void {
  session.active = false;
  session.recentSamples = [];
}

function isOnlyFalling(samples: readonly MomentumGuardSample[], tuning: MomentumGuardTuning): boolean {
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1].magnitudePx;
    if (samples[index].magnitudePx > previous * (1 + tuning.riseToleranceRatio)) return false;
  }
  return true;
}

// Pure decision with session-state update rules baked in: every call both
// answers "should this delta be swallowed?" and advances the session so the
// next call sees an up-to-date window. A session lasts for the stream that
// followed its commit: a gap or a reversal ends it for good, and nothing short
// of a new commit starts another.
export function shouldBlockWheelDelta(
  session: MomentumGuardSession,
  deltaPx: number,
  nowMs: number,
  tuning: MomentumGuardTuning,
): boolean {
  const gapMs = nowMs - session.lastEventAtMs;
  session.lastEventAtMs = nowMs;

  // Momentum streams have no gaps. A stream this sparse is a pause, a detented
  // wheel, or a new gesture — none of which is the tail this session guards.
  if (gapMs > tuning.maxTailGapMs) endSession(session);
  if (!session.active) return false;

  // The user reversed direction; that can never be a momentum tail.
  const deltaSign = signOfDelta(deltaPx);
  if (deltaSign !== 0 && deltaSign !== session.direction) {
    endSession(session);
    return false;
  }

  const magnitude = Math.abs(deltaPx);
  const previousMagnitude = session.envelopeMagnitudePx;
  session.envelopeMagnitudePx = magnitude;

  // A delta rising well above the one before it is a fresh, intentional flick
  // or spin — a tail only ever falls. The window restarts from here, so the
  // decay verdict never blends the flick with what came before it.
  if (
    magnitude > previousMagnitude * tuning.rampRatio
    && magnitude - previousMagnitude >= tuning.rampMinRisePx
  ) {
    session.recentSamples = [{ atMs: nowMs, magnitudePx: magnitude }];
    return false;
  }

  const samples = session.recentSamples;
  samples.push({ atMs: nowMs, magnitudePx: magnitude });
  while (samples.length > 1 && nowMs - samples[0].atMs > tuning.tailWindowMs) samples.shift();

  const oldest = samples[0];
  const spanMs = nowMs - oldest.atMs;
  if (spanMs < tuning.minJudgeSpanMs) return true;

  // A tail falls smoothly: nothing inside the window rises, and the window as
  // a whole loses ground at a real rate. Steady input (a held finger, a
  // free-spinning wheel) hovers and jitters, so it fails one test or the other
  // and passes through; a stream that fell once and settled is judged on its
  // settled level as soon as the fall slides out of the window.
  if (!isOnlyFalling(samples, tuning)) return false;
  if (oldest.magnitudePx <= 0) return false;
  const retained = magnitude / oldest.magnitudePx;
  const decayPerMs = 1 - retained ** (1 / spanMs);
  return decayPerMs >= tuning.minTailDecayPerMs;
}
