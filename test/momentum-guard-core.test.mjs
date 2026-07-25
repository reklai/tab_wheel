import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transform } from "esbuild";

const ROOT = process.cwd();

async function loadCore() {
  const source = readFileSync(
    resolve(ROOT, "src/lib/core/tabWheel/momentumGuardCore.ts"),
    "utf8",
  );
  const transformed = await transform(source, {
    loader: "ts",
    format: "esm",
    target: "es2022",
  });
  const encoded = Buffer.from(transformed.code, "utf8").toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
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
