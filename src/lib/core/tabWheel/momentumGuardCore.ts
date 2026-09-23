// Momentum guard: decides whether a continuous wheel delta that arrives after a
// tab switch is the momentum tail of the swipe that caused it. Trackpads keep
// delivering deltas for the fling after the fingers lift, and left unguarded
// that tail re-accumulates into switches the user never asked for.
//
// Browser-free: it knows nothing of wheel events, tabs, or timers, only signed
// pixel deltas and caller-supplied timestamps, so it runs under node:test and
// the content script (appInit.ts) owns the wiring. On Chrome 151+ the content
// script drops events flagged WheelEvent.momentum before they get here; this
// guard judges every stream that carries no such flag.
//
// Three properties make the judgment hold on real hardware:
//
// 1. The session is seeded with the magnitude the gesture ended on, so the
//    first delta after a commit is measured against something real instead of
//    being swallowed for lack of a reference.
// 2. Decay is judged per millisecond, not per event. Hardware momentum loses a
//    fixed fraction per ms, so a 120Hz display shows half the per-event decay
//    of a 60Hz one, and an event count would misread its tail as steady input.
// 3. The session watches the whole stream rather than releasing once. A swipe
//    is finger motion followed by momentum with no gap, and the finger is
//    steady or ramping right up until it lifts. So a delta passes while the
//    stream is steady or rising and is blocked whenever it is decaying, until
//    the stream ends.

/** The knobs of the tail verdict. All times are in ms. */
export interface MomentumGuardTuning {
  /**
   * The widest gap between two deltas of one momentum stream. Momentum arrives
   * densely, so a wider gap is a detented wheel, a pause, or a new gesture, and
   * ends the session.
   */
  maxTailGapMs: number;
  /** A delta at least this multiple of the previous one is fresh input. */
  rampRatio: number;
  /**
   * ...and it must also rise by at least this many px, so the integer rounding
   * of a faint tail (2px, 3px, 2px) never reads as a fresh flick.
   */
  rampMinRisePx: number;
  /** How far back the decay verdict looks. */
  tailWindowMs: number;
  /**
   * Until the window spans this long there is too little evidence to call a
   * same-level delta steady, so it is blocked as a tail candidate.
   */
  minJudgeSpanMs: number;
  /**
   * A window losing at least this fraction of its magnitude per ms, without
   * rising anywhere inside it, is a decaying tail.
   */
  minTailDecayPerMs: number;
  /**
   * Rises smaller than this fraction of the previous delta are rounding noise,
   * not a rise, when checking that a window only falls.
   */
  riseToleranceRatio: number;
}

/**
 * The one tuning shipped for every device.
 *
 * maxTailGapMs 48 is three 60Hz frames: a tail survives a couple of dropped
 * frames on a busy page, while a detented wheel (~40ms+ between notches) is
 * recognized as a notch before it ever reaches the guard.
 *
 * minTailDecayPerMs 0.0008 is ~3% across the 40ms window. macOS momentum sheds
 * roughly 0.2% per ms, so it clears the bar with a wide margin at 60Hz and
 * 120Hz alike, while steady input shows ~0 and passes. That margin is pinned by
 * test/momentum-guard-core.test.mjs.
 */
export const DEFAULT_MOMENTUM_GUARD_TUNING: MomentumGuardTuning = {
  maxTailGapMs: 48,
  rampRatio: 1.3,
  rampMinRisePx: 2,
  tailWindowMs: 40,
  minJudgeSpanMs: 24,
  minTailDecayPerMs: 0.0008,
  riseToleranceRatio: 0.02,
};

/** One delta inside the decay window: its magnitude in px and time in ms. */
export interface MomentumGuardSample {
  atMs: number;
  magnitudePx: number;
}

/**
 * Guard state for the stream that followed one commit. Created by
 * createMomentumGuardSession and updated in place by shouldBlockWheelDelta.
 */
export interface MomentumGuardSession {
  /** Sign of the committing gesture; a delta the other way ends the session. */
  direction: 1 | -1;
  /** False once the stream has ended; an inactive session blocks nothing. */
  active: boolean;
  /** When the last delta arrived, blocked or not, for measuring gaps. */
  lastEventAtMs: number;
  /** Magnitude of the previous delta, in px: the reference for a fresh ramp. */
  envelopeMagnitudePx: number;
  /** The deltas inside the last tailWindowMs, oldest first. */
  recentSamples: MomentumGuardSample[];
}

/**
 * Starts a session when a gesture commits a tab switch at `committedAtMs`.
 * `seedMagnitudePx` is the delta the gesture ended on (its sign is ignored).
 */
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

// True when no sample rises above the one before it by more than the rounding
// tolerance.
function isOnlyFalling(samples: readonly MomentumGuardSample[], tuning: MomentumGuardTuning): boolean {
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1].magnitudePx;
    if (samples[index].magnitudePx > previous * (1 + tuning.riseToleranceRatio)) return false;
  }
  return true;
}

/**
 * Whether one continuous wheel delta is momentum tail and should be swallowed.
 * Every call also advances `session`, so the next call sees an up-to-date
 * window. A session lasts for the stream that followed its commit: a gap wider
 * than maxTailGapMs or a direction reversal ends it for good, and only a new
 * commit starts another. `nowMs` is the caller's clock in ms.
 */
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
  // Slide the window, always keeping the newest sample.
  while (samples.length > 1 && nowMs - samples[0].atMs > tuning.tailWindowMs) samples.shift();

  const oldest = samples[0];
  const spanMs = nowMs - oldest.atMs;
  // Too little of the stream seen to call it steady: hold it as a possible tail.
  if (spanMs < tuning.minJudgeSpanMs) return true;

  // A tail falls smoothly: nothing inside the window rises, and the window as
  // a whole loses ground at a real rate. Steady input (a held finger, a
  // free-spinning wheel) hovers and jitters, so it fails one test or the other
  // and passes through; a stream that fell once and settled is judged on its
  // settled level as soon as the fall slides out of the window.
  if (!isOnlyFalling(samples, tuning)) return false;
  if (oldest.magnitudePx <= 0) return false;
  // The per-ms rate that turns the oldest magnitude into this one over spanMs:
  // retained = (1 - decayPerMs) ^ spanMs.
  const retained = magnitude / oldest.magnitudePx;
  const decayPerMs = 1 - retained ** (1 / spanMs);
  return decayPerMs >= tuning.minTailDecayPerMs;
}
