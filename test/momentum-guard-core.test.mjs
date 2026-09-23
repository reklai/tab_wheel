import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transform } from "esbuild";

const ROOT = process.cwd();

async function loadModule(relativePath) {
  const source = readFileSync(resolve(ROOT, relativePath), "utf8");
  const transformed = await transform(source, {
    loader: "ts",
    format: "esm",
    target: "es2022",
  });
  const encoded = Buffer.from(transformed.code, "utf8").toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

function loadCore() {
  return loadModule("src/lib/core/tabWheel/momentumGuardCore.ts");
}

// Mirrors WHEEL_ARRIVAL_GUARD_WINDOW_MS in appInit.ts, whose value is pinned
// separately by test/runtime-wiring.test.mjs.
const ARRIVAL_WINDOW_MS = 32;

// The one tuning the product ships, for every device, so these requirements
// are pinned to shipped behavior rather than to numbers invented by the test.
// There is no second (strict) variant to compare against any more: the device
// classifier that chose between them is gone.
async function loadShippedTuning() {
  const { DEFAULT_MOMENTUM_GUARD_TUNING } = await loadCore();
  return DEFAULT_MOMENTUM_GUARD_TUNING;
}

// Decaying stream that starts at the seeded envelope and fades by `decayRate`
// per event, i.e. what real hardware momentum looks like at 60-120Hz.
function decayingTail(seedPx, decayRate, eventCount) {
  return Array.from({ length: eventCount }, (_, index) => seedPx * (1 - decayRate) ** (index + 1));
}

test("a decaying same-sign tail keeps being blocked", async () => {
  const { createMomentumGuardSession, shouldBlockWheelDelta } = await loadCore();
  const tuning = await loadShippedTuning();

  const session = createMomentumGuardSession(1000, 1, 70);
  assert.equal(shouldBlockWheelDelta(session, 70, 1010, tuning), true);
  assert.equal(shouldBlockWheelDelta(session, 50, 1025, tuning), true);
  assert.equal(shouldBlockWheelDelta(session, 35, 1040, tuning), true);
  assert.equal(shouldBlockWheelDelta(session, 22, 1055, tuning), true);
});

test("a slow 5%-per-event tail stays blocked for its whole run", async () => {
  // The defect this replaced: judging decay one event at a time, a real
  // momentum tail (only a few percent down per event) reads as "steady" and
  // the guard released it after a single event. Cumulative decay from the
  // seeded envelope is what separates it from a free-spinning wheel.
  const { createMomentumGuardSession, shouldBlockWheelDelta } = await loadCore();
  const tuning = await loadShippedTuning();

  const session = createMomentumGuardSession(1000, 1, 50);
  const results = decayingTail(50, 0.05, 24)
    .map((magnitude, index) => shouldBlockWheelDelta(session, magnitude, 1008 + index * 8, tuning));

  assert.equal(results.length, 24);
  assert.ok(results.every((blocked) => blocked === true), "the shipped tuning released a real tail");
});

test("steady free-spin input is released once the window can judge it", async () => {
  const { createMomentumGuardSession, shouldBlockWheelDelta } = await loadCore();
  const tuning = await loadShippedTuning();

  const session = createMomentumGuardSession(1000, 1, 80);
  // Slightly noisy but non-decaying, the way a free-spinning wheel delivers.
  const results = [80, 78, 82, 80, 79, 81, 80, 80]
    .map((magnitude, index) => shouldBlockWheelDelta(session, magnitude, 1010 + index * 10, tuning));

  const firstPass = results.indexOf(false);
  assert.ok(firstPass >= 0 && firstPass <= 5, "the guard should re-arm within 6 events");
  assert.ok(
    results.slice(firstPass).every((blocked) => blocked === false),
    "the guard should stay re-armed once released",
  );
});

test("the seeded envelope judges the first post-commit delta instead of swallowing it", async () => {
  const { createMomentumGuardSession, shouldBlockWheelDelta } = await loadCore();
  const tuning = await loadShippedTuning();

  // A fresh, harder flick right after a commit ramps above the gesture's own
  // envelope and must pass on the very first event — there is no longer an
  // unconditional grace block waiting for a reference magnitude.
  const rampSession = createMomentumGuardSession(1000, 1, 40);
  assert.equal(shouldBlockWheelDelta(rampSession, 90, 1010, tuning), false);

  // The same first event at the gesture's own level is still a tail candidate.
  const tailSession = createMomentumGuardSession(1000, 1, 40);
  assert.equal(shouldBlockWheelDelta(tailSession, 38, 1010, tuning), true);

  // Without a real envelope to inherit, the guard stays out of the way.
  const unseededSession = createMomentumGuardSession(1000, 1, 0);
  assert.equal(shouldBlockWheelDelta(unseededSession, 38, 1010, tuning), false);
});

test("a stream too sparse to be hardware momentum is never blocked", async () => {
  // A detented wheel cannot notch faster than its own ~40ms cadence, which is
  // wider than maxTailGapMs, so it can never physically produce a tail. This
  // is what keeps a clicky wheel whose notches go unrecognized at zero
  // guard cost without anything having to recognize it as a wheel.
  const { createMomentumGuardSession, shouldBlockWheelDelta } = await loadCore();
  const tuning = await loadShippedTuning();

  for (const gapMs of [tuning.maxTailGapMs + 1, 60, 100]) {
    const session = createMomentumGuardSession(1000, 1, 48);
    const results = [48, 48, 48, 48]
      .map((magnitude, index) => shouldBlockWheelDelta(session, magnitude, 1000 + (index + 1) * gapMs, tuning));
    assert.ok(results.every((blocked) => blocked === false), `gap ${gapMs}ms should never block`);
  }
});

test("an opposite-sign delta re-arms immediately and stays re-armed", async () => {
  const { createMomentumGuardSession, shouldBlockWheelDelta } = await loadCore();
  const tuning = await loadShippedTuning();

  const session = createMomentumGuardSession(1000, 1, 60);
  assert.equal(shouldBlockWheelDelta(session, 60, 1010, tuning), true);
  assert.equal(shouldBlockWheelDelta(session, -40, 1020, tuning), false);
  assert.equal(shouldBlockWheelDelta(session, 60, 1030, tuning), false);
});

test("a pause longer than the tail cadence re-arms the guard", async () => {
  const { createMomentumGuardSession, shouldBlockWheelDelta } = await loadCore();
  const tuning = await loadShippedTuning();

  const session = createMomentumGuardSession(1000, 1, 60);
  assert.equal(shouldBlockWheelDelta(session, 60, 1010, tuning), true);
  assert.equal(shouldBlockWheelDelta(session, 55, 1010 + tuning.maxTailGapMs + 1, tuning), false);
});

test("a stream that settles at a lower level is released on its settled level", async () => {
  // Regression: judging decay against a frozen seed locked out any stream that
  // settled even slightly below the magnitude the gesture ended on. With the
  // seed at 100 and steady 90px input, every event showed 10% "decay" from the
  // seed and was blocked forever despite zero decay from the first event on.
  const { createMomentumGuardSession, shouldBlockWheelDelta } = await loadCore();
  const tuning = await loadShippedTuning();

  const session = createMomentumGuardSession(1000, 1, 100);
  const results = Array.from({ length: 10 }, () => 90)
    .map((magnitude, index) => shouldBlockWheelDelta(session, magnitude, 1008 + index * 8, tuning));

  const firstPass = results.indexOf(false);
  assert.ok(firstPass >= 0 && firstPass <= 5, "the guard never released a steady 90px stream");
  assert.ok(results.slice(firstPass).every((blocked) => blocked === false), "the guard re-blocked");
});

test("a delta ramping well above the recent envelope re-arms as a fresh flick", async () => {
  const { createMomentumGuardSession, shouldBlockWheelDelta } = await loadCore();
  const tuning = await loadShippedTuning();

  const session = createMomentumGuardSession(1000, 1, 40);
  assert.equal(shouldBlockWheelDelta(session, 40, 1010, tuning), true);
  assert.equal(shouldBlockWheelDelta(session, 90, 1025, tuning), false);
});

// The guard swallows deltas while it decides, so its cost has to be priced
// against the rest of the wheel path rather than in isolation. This models the
// exact order appInit.ts wheelHandler runs in: guard -> accumulate (tracking
// the gesture's peak magnitude) -> trigger distance -> cooldown -> overshoot
// reset (overshootGuard is forced true for every preset by the contract).
async function runWheelPipeline(options) {
  const guardCore = await loadCore();
  const wheelCore = await loadModule("src/lib/core/tabWheel/tabWheelCore.ts");
  const { useGuard, sensitivity, cooldownMs, acceleration, gapMs, magnitudeAt, durationMs, tuning } = options;

  let accumulator = 0;
  let lastMagnitudePx = 0;
  let lastCycleAt = 0;
  let burstCount = 0;
  let session = null;
  let blockedDeltas = 0;
  const commitTimes = [];

  let index = 0;
  for (let now = 1000; now <= 1000 + durationMs; now += gapMs, index += 1) {
    const deltaPx = magnitudeAt(index);
    if (useGuard && session && guardCore.shouldBlockWheelDelta(session, deltaPx, now, tuning)) {
      blockedDeltas += 1;
      continue;
    }
    accumulator += deltaPx;
    lastMagnitudePx = Math.abs(deltaPx);
    const nextBurstCount = now - lastCycleAt <= 700 ? Math.min(burstCount + 1, 6) : 0;
    const triggerDistance = wheelCore.resolveAcceleratedWheelTriggerDistance(
      wheelCore.resolveWheelTriggerDistance(80, sensitivity),
      nextBurstCount,
      acceleration,
    );
    if (Math.abs(accumulator) < triggerDistance) continue;
    if (now - lastCycleAt >= cooldownMs) {
      burstCount = nextBurstCount;
      lastCycleAt = now;
      session = guardCore.createMomentumGuardSession(now, 1, lastMagnitudePx);
      commitTimes.push(now - 1000);
    }
    accumulator = 0;
    lastMagnitudePx = 0;
  }
  return { commitTimes, blockedDeltas };
}

// The switch itself destroys the committing tab's state: the background
// activates the target tab, the old document goes hidden, and
// resetWheelGestureState() drops its guard session. The rest of the physical
// tail is then delivered to the NEWLY ACTIVATED tab, whose content script has
// a fresh accumulator, no session, and no cooldown history. Two independent
// state instances, same pipeline order as appInit.ts.
async function runTabHandoffTail(options) {
  const guardCore = await loadCore();
  const wheelCore = await loadModule("src/lib/core/tabWheel/tabWheelCore.ts");
  const {
    useArrivalGuard, tuning, sensitivity, cooldownMs, gapMs, tailMagnitudes,
    firstEventOffsetMs = gapMs, deltaMode = 0,
  } = options;

  // Tab B, freshly activated at `becameVisibleAt`. Nothing carried over.
  const becameVisibleAt = 1e6;
  let accumulator = 0;
  let lastCycleAt = 0;
  let session = null;
  let arrivalSeeds = 0;
  const commitTimes = [];

  tailMagnitudes.forEach((deltaPx, index) => {
    const now = becameVisibleAt + firstEventOffsetMs + index * gapMs;
    if (
      !session
      && useArrivalGuard
      && deltaMode === 0
      && now - becameVisibleAt <= ARRIVAL_WINDOW_MS
    ) {
      session = guardCore.createMomentumGuardSession(now, Math.sign(deltaPx), Math.abs(deltaPx));
      arrivalSeeds += 1;
      return;
    }
    if (session && guardCore.shouldBlockWheelDelta(session, deltaPx, now, tuning)) return;
    accumulator += deltaPx;
    const triggerDistance = wheelCore.resolveAcceleratedWheelTriggerDistance(
      wheelCore.resolveWheelTriggerDistance(80, sensitivity),
      0,
      false,
    );
    if (Math.abs(accumulator) < triggerDistance) return;
    // A fresh tab has never cycled, so the cooldown offers no protection here.
    if (now - lastCycleAt >= cooldownMs) {
      lastCycleAt = now;
      commitTimes.push(now - becameVisibleAt);
    }
    accumulator = 0;
  });
  return { commitTimes, arrivalSeeds };
}

test("the guard costs no switches and no latency in the free-spin fast path", async () => {
  // Fast preset (sensitivity 1.35, 90ms cooldown, acceleration on) driven by a
  // free-spin wheel: large deltas at 8-16ms spacing.
  const tuning = await loadShippedTuning();
  const fastPreset = { sensitivity: 1.35, cooldownMs: 90, acceleration: true, durationMs: 1000, tuning };
  const cases = [
    // Constant magnitudes, then the shape a real wheel actually produces: the
    // gesture peaks into the commit and the spin settles into a lower band.
    { label: "8ms/100px", gapMs: 8, magnitudeAt: () => 100 },
    { label: "10ms/100px", gapMs: 10, magnitudeAt: () => 100 },
    { label: "16ms/120px", gapMs: 16, magnitudeAt: () => 120 },
    { label: "16ms/60px", gapMs: 16, magnitudeAt: () => 60 },
    { label: "10ms/100px peak settling to 85-90", gapMs: 10, magnitudeAt: (index) => (index < 2 ? 100 : [88, 85, 90, 87][index % 4]) },
    { label: "8ms/120px peak settling to 100-110", gapMs: 8, magnitudeAt: (index) => (index < 2 ? 120 : [104, 110, 100, 107][index % 4]) },
  ];
  for (const { label, gapMs, magnitudeAt } of cases) {
    const unguarded = await runWheelPipeline({ ...fastPreset, gapMs, magnitudeAt, useGuard: false });
    const guarded = await runWheelPipeline({ ...fastPreset, gapMs, magnitudeAt, useGuard: true });

    // Identical commit timestamps, not merely identical counts: every swallowed
    // delta lands inside the cooldown window, where the overshoot guard would
    // have zeroed the accumulator anyway.
    assert.ok(unguarded.commitTimes.length > 0, `${label} produced no commits to compare`);
    assert.deepEqual(guarded.commitTimes, unguarded.commitTimes, label);
    // Only the warm-up before the window can judge is held after each commit.
    const warmUpEvents = Math.ceil(tuning.minJudgeSpanMs / gapMs);
    assert.ok(
      guarded.blockedDeltas <= warmUpEvents * guarded.commitTimes.length,
      `${label} should settle within the judging warm-up per commit`,
    );
  }
});

test("detented wheels pay nothing for the guard at any notch spacing", async () => {
  // 100px pixel-mode notches and 48px line-mode notches, balanced and
  // precise presets. The 48px/100ms row is the one that used to lose ~100ms
  // per switch to the old unconditional first-delta block; the tail-cadence
  // test now takes detented wheels out of the guard's scope entirely.
  const tuning = await loadShippedTuning();
  const cases = [
    { sensitivity: 1, cooldownMs: 160, deltaPx: 100, gapMs: 60 },
    { sensitivity: 1, cooldownMs: 160, deltaPx: 100, gapMs: 100 },
    { sensitivity: 1, cooldownMs: 160, deltaPx: 48, gapMs: 60 },
    { sensitivity: 1, cooldownMs: 160, deltaPx: 48, gapMs: 100 },
    { sensitivity: 0.8, cooldownMs: 220, deltaPx: 48, gapMs: 120 },
  ];
  for (const testCase of cases) {
    const base = {
      ...testCase,
      magnitudeAt: () => testCase.deltaPx,
      acceleration: false,
      durationMs: 1000,
      tuning,
    };
    const unguarded = await runWheelPipeline({ ...base, useGuard: false });
    const guarded = await runWheelPipeline({ ...base, useGuard: true });
    const label = `${testCase.deltaPx}px @ ${testCase.gapMs}ms`;
    assert.ok(unguarded.commitTimes.length > 0, `${label} produced no commits to compare`);
    assert.deepEqual(guarded.commitTimes, unguarded.commitTimes, label);
    assert.equal(guarded.blockedDeltas, 0, `${label} should never reach the guard`);
  }
});

test("the arrival guard stops a handed-off tail from switching again in the new tab", async () => {
  // The scenario the whole feature exists for: the flick commits in tab A, A
  // goes hidden and loses its session, and the rest of the tail is delivered
  // to tab B — fresh accumulator, no session, no cooldown.
  const tuning = await loadShippedTuning();
  const decayingTailFrom = (peakPx, rate, count) =>
    Array.from({ length: count }, (_, index) => peakPx * (1 - rate) ** index);

  // A handed-off tail is a continuous stream, so its first event in the new
  // tab lands within one event period (8-16ms) of the visibility gain.
  for (const [peakPx, rate, gapMs] of [[60, 0.08, 8], [60, 0.15, 8], [110, 0.1, 8], [60, 0.1, 16]]) {
    const options = {
      tuning,
      sensitivity: 1,
      cooldownMs: 160,
      gapMs,
      tailMagnitudes: decayingTailFrom(peakPx, rate, 40),
    };
    const label = `${peakPx}px tail decaying ${rate * 100}%/event at ${gapMs}ms`;

    const unguarded = await runTabHandoffTail({ ...options, useArrivalGuard: false });
    const guarded = await runTabHandoffTail({ ...options, useArrivalGuard: true });

    assert.ok(unguarded.commitTimes.length >= 1, `${label} should re-trigger without the arrival guard`);
    assert.deepEqual(guarded.commitTimes, [], `${label} should not re-trigger with the arrival guard`);
    assert.equal(guarded.arrivalSeeds, 1, `${label} should seed exactly once`);
  }
});

test("detented wheels pay no arrival tax on a cross-tab handoff", async () => {
  // Every gesture switch is a cross-tab handoff, so an arrival guard that
  // cannot tell a notch from a tail taxes one notch per switch — 2N notches to
  // traverse N tabs. A notch cannot arrive faster than its own ~40ms cadence,
  // which is what keeps it outside the arrival window.
  const tuning = await loadShippedTuning();
  for (const gapMs of [60, 100]) {
    const options = {
      tuning,
      sensitivity: 1,
      cooldownMs: 160,
      gapMs,
      firstEventOffsetMs: 35,
      tailMagnitudes: Array.from({ length: 12 }, () => 100),
    };
    const unguarded = await runTabHandoffTail({ ...options, useArrivalGuard: false });
    const guarded = await runTabHandoffTail({ ...options, useArrivalGuard: true });

    assert.ok(unguarded.commitTimes.length > 0, `100px @ ${gapMs}ms produced no commits`);
    assert.equal(guarded.arrivalSeeds, 0, `100px @ ${gapMs}ms should never arrival-seed`);
    assert.deepEqual(guarded.commitTimes, unguarded.commitTimes, `100px @ ${gapMs}ms paid an arrival tax`);
  }
});

test("line-mode and page-mode events never arrival-seed, whatever their timing", async () => {
  // Line mode is whole scroll units only a wheel produces, and page mode is a
  // synthetic multi-line jump — belt and braces for a slow switch round-trip
  // that could otherwise land one inside the window: only deltaMode 0 (pixel)
  // is evidence of a real momentum tail.
  const tuning = await loadShippedTuning();
  for (const deltaMode of [1, 2]) {
    const options = {
      tuning,
      sensitivity: 1,
      cooldownMs: 160,
      gapMs: 100,
      firstEventOffsetMs: 8,
      deltaMode,
      tailMagnitudes: Array.from({ length: 12 }, () => 48),
    };
    const unguarded = await runTabHandoffTail({ ...options, useArrivalGuard: false });
    const guarded = await runTabHandoffTail({ ...options, useArrivalGuard: true });

    assert.ok(unguarded.commitTimes.length > 0, `deltaMode ${deltaMode} train produced no commits`);
    assert.equal(guarded.arrivalSeeds, 0, `deltaMode ${deltaMode} must never arrival-seed`);
    assert.deepEqual(guarded.commitTimes, unguarded.commitTimes, `deltaMode ${deltaMode} paid an arrival tax`);
  }
});

test("the arrival guard yields to deliberate input in the new tab", async () => {
  // Same arrival window, but the user is actually spinning the wheel: the
  // first delta seeds the session and the steady window releases it, so a
  // deliberate gesture still lands instead of being swallowed indefinitely.
  const tuning = await loadShippedTuning();
  const { commitTimes } = await runTabHandoffTail({
    useArrivalGuard: true,
    tuning,
    sensitivity: 1,
    cooldownMs: 160,
    gapMs: 12,
    tailMagnitudes: Array.from({ length: 40 }, () => 100),
  });

  assert.ok(commitTimes.length >= 1, "steady deliberate input must still switch tabs");
  // Seed, a warm-up the length of the judging span, then the trigger distance.
  assert.ok(
    commitTimes[0] <= 12 + tuning.minJudgeSpanMs + 12,
    `first deliberate switch took ${commitTimes[0]}ms, longer than the judging warm-up`,
  );
});

test("momentum is judged per millisecond, so a 120Hz tail is blocked like a 60Hz one", async () => {
  // The defect this replaced: decay judged over a count of events. Momentum
  // loses a fixed fraction per millisecond (~0.2%/ms on macOS), so a 120Hz
  // display delivers half the per-event decay of a 60Hz one, and the old
  // four-event window read a ProMotion tail as steady input and released it.
  const { createMomentumGuardSession, shouldBlockWheelDelta } = await loadCore();
  const tuning = await loadShippedTuning();

  for (const { label, gapMs } of [{ label: "60Hz", gapMs: 16.7 }, { label: "120Hz", gapMs: 8.3 }]) {
    const session = createMomentumGuardSession(1000, 1, 40);
    const results = Array.from({ length: 60 }, (_, index) => {
      const atMs = 1000 + (index + 1) * gapMs;
      return shouldBlockWheelDelta(session, 40 * 0.998 ** (atMs - 1000), atMs, tuning);
    });
    assert.ok(results.every((blocked) => blocked === true), `the ${label} tail was released`);
  }
});

test("the decay bar sits well below real momentum and well above steady input", async () => {
  // The margin that replaced the old razor-thin 3%/event pin: macOS sheds
  // ~0.2%/ms, and the bar is 2.5x lower than that.
  const tuning = await loadShippedTuning();
  assert.ok(tuning.minTailDecayPerMs * 2.5 <= 0.002, "the bar crept up towards real momentum");
  assert.ok(tuning.minTailDecayPerMs > 0, "steady input would be held as a tail");
});

test("a tail that follows steady finger motion is still blocked", async () => {
  // The inconsistency users felt on trackpads: the finger is steady right up
  // until it lifts, so a guard that released for good on the first steady
  // window was gone by the time the momentum arrived, and the tail switched
  // again. The session now watches the whole stream.
  const { createMomentumGuardSession, shouldBlockWheelDelta } = await loadCore();
  const tuning = await loadShippedTuning();

  const session = createMomentumGuardSession(1000, 1, 20);
  let now = 1000;
  const finger = [20, 21, 19, 20, 22, 20, 21, 20, 19, 21].map((magnitude) => {
    now += 8;
    return shouldBlockWheelDelta(session, magnitude, now, tuning);
  });
  assert.ok(finger.some((blocked) => blocked === false), "steady finger motion should pass");

  const tail = Array.from({ length: 80 }, (_, index) => {
    now += 8;
    return { blocked: shouldBlockWheelDelta(session, 21 * 0.998 ** ((index + 1) * 8), now, tuning), index };
  });
  // Only the first window's worth of the tail can pass while it still holds
  // the finger's last steady samples.
  const leaked = tail.filter(({ blocked, index }) => !blocked && index * 8 > tuning.tailWindowMs);
  assert.deepEqual(leaked, [], "the tail after steady finger motion was released");
});

test("a tail that follows a flick is still blocked", async () => {
  // A flick ramps just before the fingers lift. That ramp used to disarm the
  // guard permanently, handing it the whole momentum tail that follows.
  const { createMomentumGuardSession, shouldBlockWheelDelta } = await loadCore();
  const tuning = await loadShippedTuning();

  const session = createMomentumGuardSession(1000, 1, 10);
  let now = 1000;
  for (const magnitude of [16, 26, 40]) {
    now += 8;
    assert.equal(shouldBlockWheelDelta(session, magnitude, now, tuning), false, "a flick is intentional");
  }
  const tail = Array.from({ length: 80 }, (_, index) => {
    now += 8;
    return shouldBlockWheelDelta(session, 40 * 0.998 ** ((index + 1) * 8), now, tuning);
  });
  assert.ok(tail.every((blocked) => blocked === true), "the tail after a flick was released");
});
