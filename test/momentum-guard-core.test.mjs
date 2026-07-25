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

const TUNING = { idleGapMs: 120, rampRatio: 1.6, decayTolerance: 0.15 };

test("a decaying same-sign tail keeps being blocked", async () => {
  const { createMomentumGuardSession, shouldBlockWheelDelta } = await loadCore();

  const session = createMomentumGuardSession(1000, 1);
  assert.equal(shouldBlockWheelDelta(session, 70, 1010, TUNING), true);
  assert.equal(shouldBlockWheelDelta(session, 50, 1025, TUNING), true);
  assert.equal(shouldBlockWheelDelta(session, 35, 1040, TUNING), true);
  assert.equal(shouldBlockWheelDelta(session, 22, 1055, TUNING), true);
});

test("an opposite-sign delta re-arms immediately and stays re-armed", async () => {
  const { createMomentumGuardSession, shouldBlockWheelDelta } = await loadCore();

  const session = createMomentumGuardSession(1000, 1);
  assert.equal(shouldBlockWheelDelta(session, 60, 1010, TUNING), true);
  assert.equal(shouldBlockWheelDelta(session, -40, 1020, TUNING), false);
  assert.equal(shouldBlockWheelDelta(session, 60, 1030, TUNING), false);
});

test("a gap longer than idleGapMs re-arms the guard", async () => {
  const { createMomentumGuardSession, shouldBlockWheelDelta } = await loadCore();

  const session = createMomentumGuardSession(1000, 1);
  assert.equal(shouldBlockWheelDelta(session, 60, 1010, TUNING), true);
  assert.equal(shouldBlockWheelDelta(session, 55, 1010 + TUNING.idleGapMs + 10, TUNING), false);
});

test("a delta ramping well above the recent envelope re-arms as a fresh flick", async () => {
  const { createMomentumGuardSession, shouldBlockWheelDelta } = await loadCore();

  const session = createMomentumGuardSession(1000, 1);
  assert.equal(shouldBlockWheelDelta(session, 40, 1010, TUNING), true);
  assert.equal(shouldBlockWheelDelta(session, 90, 1025, TUNING), false);
});

// The guard blocks the first same-sign delta after every commit, so its cost
// has to be priced against the rest of the wheel path rather than in
// isolation. This models the exact order appInit.ts wheelHandler runs in:
// guard -> accumulate -> trigger distance -> cooldown -> overshoot reset
// (overshootGuard is forced true for every preset by the settings contract).
async function runWheelPipeline(options) {
  const guardCore = await loadCore();
  const wheelCore = await loadModule("src/lib/core/tabWheel/tabWheelCore.ts");
  const { useGuard, sensitivity, cooldownMs, acceleration, gapMs, deltaPx, durationMs, tuning } = options;

  let accumulator = 0;
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
      session = guardCore.createMomentumGuardSession(now, 1);
      commitTimes.push(now - 1000);
    }
    accumulator = 0;
  }
  return { commitTimes, blockedDeltas };
}

const LENIENT_TUNING = { idleGapMs: 100, rampRatio: 1.3, decayTolerance: 0.12 };

test("the post-commit grace block costs no switches in the free-spin fast path", async () => {
  // Fast preset (sensitivity 1.35, 90ms cooldown, acceleration on) driven by a
  // free-spin wheel: large deltas at 8-16ms spacing, classified as
  // freeSpinWheel/unknown so the lenient universal tuning applies.
  const fastPreset = { sensitivity: 1.35, cooldownMs: 90, acceleration: true, durationMs: 1000, tuning: LENIENT_TUNING };
  for (const [gapMs, deltaPx] of [[8, 100], [10, 100], [16, 120], [16, 60]]) {
    const unguarded = await runWheelPipeline({ ...fastPreset, gapMs, deltaPx, useGuard: false });
    const guarded = await runWheelPipeline({ ...fastPreset, gapMs, deltaPx, useGuard: true });

    // Identical commit cadence: the blocked delta always lands inside the
    // cooldown window, where the overshoot guard would have zeroed it anyway.
    assert.deepEqual(guarded.commitTimes, unguarded.commitTimes, `gap ${gapMs}ms delta ${deltaPx}px`);
    assert.ok(
      guarded.blockedDeltas <= guarded.commitTimes.length,
      `gap ${gapMs}ms should block at most one delta per commit`,
    );
  }
});

test("a single wheel notch larger than the trigger distance absorbs the grace block", async () => {
  // Chrome discrete wheel on the balanced preset: one 100px notch already
  // exceeds the 80px trigger, so the lost delta never delays a switch.
  const balanced = { sensitivity: 1, cooldownMs: 160, acceleration: false, durationMs: 1000, deltaPx: 100, tuning: LENIENT_TUNING };
  for (const gapMs of [60, 100]) {
    const unguarded = await runWheelPipeline({ ...balanced, gapMs, useGuard: false });
    const guarded = await runWheelPipeline({ ...balanced, gapMs, useGuard: true });
    assert.deepEqual(guarded.commitTimes, unguarded.commitTimes, `gap ${gapMs}ms`);
  }
});

test("steady non-decaying free-spin deltas are not locked out", async () => {
  const { createMomentumGuardSession, shouldBlockWheelDelta } = await loadCore();

  const session = createMomentumGuardSession(1000, 1);
  const results = [80, 80, 78, 82, 80, 79]
    .map((magnitude, index) => shouldBlockWheelDelta(session, magnitude, 1010 + index * 10, TUNING));

  // At most the very first tick after commit gets a conservative grace block;
  // every subsequent steady tick must pass through so rapid traversal works.
  assert.ok(results.slice(1).every((blocked) => blocked === false));
  assert.equal(results.filter(Boolean).length <= 1, true);
});
