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

const TUNING = {
  idleGapMs: 120,
  maxTailGapMs: 32,
  rampRatio: 1.6,
  steadyDecayFraction: 0.08,
  steadyEventCount: 5,
};

// The tunings the product actually ships, so these requirements are pinned to
// shipped behavior rather than to numbers invented by the test.
async function loadShippedTunings() {
  const { resolveDeviceTuningAdjustment } = await loadModule("src/lib/core/tabWheel/deviceProfileCore.ts");
  return {
    strict: resolveDeviceTuningAdjustment("trackpad").momentumGuardTuning,
    lenient: resolveDeviceTuningAdjustment("unknown").momentumGuardTuning,
  };
}

// Decaying stream that starts at the seeded envelope and fades by `decayRate`
// per event, i.e. what real hardware momentum looks like at 60-120Hz.
function decayingTail(seedPx, decayRate, eventCount) {
  return Array.from({ length: eventCount }, (_, index) => seedPx * (1 - decayRate) ** (index + 1));
}

test("a decaying same-sign tail keeps being blocked", async () => {
  const { createMomentumGuardSession, shouldBlockWheelDelta } = await loadCore();

  const session = createMomentumGuardSession(1000, 1, 70);
  assert.equal(shouldBlockWheelDelta(session, 70, 1010, TUNING), true);
  assert.equal(shouldBlockWheelDelta(session, 50, 1025, TUNING), true);
  assert.equal(shouldBlockWheelDelta(session, 35, 1040, TUNING), true);
  assert.equal(shouldBlockWheelDelta(session, 22, 1055, TUNING), true);
});

test("a slow 5%-per-event tail stays blocked for its whole run", async () => {
  // The defect this replaced: judging decay one event at a time, a real
  // momentum tail (only a few percent down per event) reads as "steady" and
  // the guard released it after a single event. Cumulative decay from the
  // seeded envelope is what separates it from a free-spinning wheel.
  const { createMomentumGuardSession, shouldBlockWheelDelta } = await loadCore();
  const { strict, lenient } = await loadShippedTunings();

  for (const [label, tuning] of [["strict", strict], ["lenient", lenient]]) {
    const session = createMomentumGuardSession(1000, 1, 50);
    const results = decayingTail(50, 0.05, 24)
      .map((magnitude, index) => shouldBlockWheelDelta(session, magnitude, 1008 + index * 8, tuning));

    assert.equal(results.length, 24);
    assert.ok(results.every((blocked) => blocked === true), `${label} tuning released a real tail`);
  }
});

test("steady free-spin input re-arms within the steady event budget", async () => {
  const { createMomentumGuardSession, shouldBlockWheelDelta } = await loadCore();
  const { strict, lenient } = await loadShippedTunings();

  for (const [label, tuning] of [["strict", strict], ["lenient", lenient]]) {
    const session = createMomentumGuardSession(1000, 1, 80);
    // Slightly noisy but non-decaying, the way a free-spinning wheel delivers.
    const results = [80, 78, 82, 80, 79, 81, 80, 80]
      .map((magnitude, index) => shouldBlockWheelDelta(session, magnitude, 1010 + index * 10, tuning));

    const firstPass = results.indexOf(false);
    assert.ok(firstPass >= 0 && firstPass <= 5, `${label} tuning should re-arm within 6 events`);
    assert.ok(
      results.slice(firstPass).every((blocked) => blocked === false),
      `${label} tuning should stay re-armed once released`,
    );
  }
});

test("the seeded envelope judges the first post-commit delta instead of swallowing it", async () => {
  const { createMomentumGuardSession, shouldBlockWheelDelta } = await loadCore();

  // A fresh, harder flick right after a commit ramps above the gesture's own
  // envelope and must pass on the very first event — there is no longer an
  // unconditional grace block waiting for a reference magnitude.
  const rampSession = createMomentumGuardSession(1000, 1, 40);
  assert.equal(shouldBlockWheelDelta(rampSession, 90, 1010, TUNING), false);

  // The same first event at the gesture's own level is still a tail candidate.
  const tailSession = createMomentumGuardSession(1000, 1, 40);
  assert.equal(shouldBlockWheelDelta(tailSession, 38, 1010, TUNING), true);

  // Without a real envelope to inherit, the guard stays out of the way.
  const unseededSession = createMomentumGuardSession(1000, 1, 0);
  assert.equal(shouldBlockWheelDelta(unseededSession, 38, 1010, TUNING), false);
});

test("a stream too sparse to be hardware momentum is never blocked", async () => {
  // Detented wheels sit above deviceProfileCore's 40ms discrete-wheel cadence
  // floor, so they can never physically produce a tail. This is what keeps a
  // clicky wheel (Chrome notches, Firefox line mode) at zero guard cost.
  const { createMomentumGuardSession, shouldBlockWheelDelta } = await loadCore();
  const { lenient } = await loadShippedTunings();

  for (const gapMs of [lenient.maxTailGapMs + 1, 60, 100]) {
    const session = createMomentumGuardSession(1000, 1, 48);
    const results = [48, 48, 48, 48]
      .map((magnitude, index) => shouldBlockWheelDelta(session, magnitude, 1000 + (index + 1) * gapMs, lenient));
    assert.ok(results.every((blocked) => blocked === false), `gap ${gapMs}ms should never block`);
  }
});

test("an opposite-sign delta re-arms immediately and stays re-armed", async () => {
  const { createMomentumGuardSession, shouldBlockWheelDelta } = await loadCore();

  const session = createMomentumGuardSession(1000, 1, 60);
  assert.equal(shouldBlockWheelDelta(session, 60, 1010, TUNING), true);
  assert.equal(shouldBlockWheelDelta(session, -40, 1020, TUNING), false);
  assert.equal(shouldBlockWheelDelta(session, 60, 1030, TUNING), false);
});

test("a gap longer than idleGapMs re-arms the guard", async () => {
  const { createMomentumGuardSession, shouldBlockWheelDelta } = await loadCore();

  const session = createMomentumGuardSession(1000, 1, 60);
  assert.equal(shouldBlockWheelDelta(session, 60, 1010, TUNING), true);
  assert.equal(shouldBlockWheelDelta(session, 55, 1010 + TUNING.idleGapMs + 10, TUNING), false);
});

test("a delta ramping well above the recent envelope re-arms as a fresh flick", async () => {
  const { createMomentumGuardSession, shouldBlockWheelDelta } = await loadCore();

  const session = createMomentumGuardSession(1000, 1, 40);
  assert.equal(shouldBlockWheelDelta(session, 40, 1010, TUNING), true);
  assert.equal(shouldBlockWheelDelta(session, 90, 1025, TUNING), false);
});

// The guard swallows deltas while it decides, so its cost has to be priced
// against the rest of the wheel path rather than in isolation. This models the
// exact order appInit.ts wheelHandler runs in: guard -> accumulate (tracking
// the gesture's peak magnitude) -> trigger distance -> cooldown -> overshoot
// reset (overshootGuard is forced true for every preset by the contract).
async function runWheelPipeline(options) {
  const guardCore = await loadCore();
  const wheelCore = await loadModule("src/lib/core/tabWheel/tabWheelCore.ts");
  const { useGuard, sensitivity, cooldownMs, acceleration, gapMs, deltaPx, durationMs, tuning } = options;

  let accumulator = 0;
  let gesturePeakPx = 0;
  let lastCycleAt = 0;
  let burstCount = 0;
  let session = null;
  let blockedDeltas = 0;
  const commitTimes = [];

  for (let now = 1000; now <= 1000 + durationMs; now += gapMs) {
    if (useGuard && session && guardCore.shouldBlockWheelDelta(session, deltaPx, now, tuning)) {
      blockedDeltas += 1;
      continue;
    }
    accumulator += deltaPx;
    gesturePeakPx = Math.max(gesturePeakPx, Math.abs(deltaPx));
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
      session = guardCore.createMomentumGuardSession(now, 1, gesturePeakPx);
      commitTimes.push(now - 1000);
    }
    accumulator = 0;
    gesturePeakPx = 0;
  }
  return { commitTimes, blockedDeltas };
}

test("the guard costs no switches and no latency in the free-spin fast path", async () => {
  // Fast preset (sensitivity 1.35, 90ms cooldown, acceleration on) driven by a
  // free-spin wheel: large deltas at 8-16ms spacing, classified as
  // freeSpinWheel/unknown so the lenient universal tuning applies.
  const { lenient } = await loadShippedTunings();
  const fastPreset = { sensitivity: 1.35, cooldownMs: 90, acceleration: true, durationMs: 1000, tuning: lenient };
  for (const [gapMs, deltaPx] of [[8, 100], [10, 100], [16, 120], [16, 60]]) {
    const unguarded = await runWheelPipeline({ ...fastPreset, gapMs, deltaPx, useGuard: false });
    const guarded = await runWheelPipeline({ ...fastPreset, gapMs, deltaPx, useGuard: true });

    // Identical commit timestamps, not merely identical counts: every swallowed
    // delta lands inside the cooldown window, where the overshoot guard would
    // have zeroed the accumulator anyway.
    assert.deepEqual(guarded.commitTimes, unguarded.commitTimes, `gap ${gapMs}ms delta ${deltaPx}px`);
    assert.ok(
      guarded.blockedDeltas <= lenient.steadyEventCount * guarded.commitTimes.length,
      `gap ${gapMs}ms should settle within the steady event budget per commit`,
    );
  }
});

test("detented wheels pay nothing for the guard at any notch spacing", async () => {
  // Chrome 100px notches and Firefox line-mode 48px notches, balanced and
  // precise presets. The 48px/100ms row is the one that used to lose ~100ms
  // per switch to the old unconditional first-delta block; the tail-cadence
  // test now takes detented wheels out of the guard's scope entirely.
  const { lenient } = await loadShippedTunings();
  const cases = [
    { sensitivity: 1, cooldownMs: 160, deltaPx: 100, gapMs: 60 },
    { sensitivity: 1, cooldownMs: 160, deltaPx: 100, gapMs: 100 },
    { sensitivity: 1, cooldownMs: 160, deltaPx: 48, gapMs: 60 },
    { sensitivity: 1, cooldownMs: 160, deltaPx: 48, gapMs: 100 },
    { sensitivity: 0.8, cooldownMs: 220, deltaPx: 48, gapMs: 120 },
  ];
  for (const testCase of cases) {
    const base = { ...testCase, acceleration: false, durationMs: 1000, tuning: lenient };
    const unguarded = await runWheelPipeline({ ...base, useGuard: false });
    const guarded = await runWheelPipeline({ ...base, useGuard: true });
    const label = `${testCase.deltaPx}px @ ${testCase.gapMs}ms`;
    assert.deepEqual(guarded.commitTimes, unguarded.commitTimes, label);
    assert.equal(guarded.blockedDeltas, 0, `${label} should never reach the guard`);
  }
});
