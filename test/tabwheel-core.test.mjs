import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transform } from "esbuild";

const ROOT = process.cwd();

async function loadCore() {
  const source = readFileSync(resolve(ROOT, "src/lib/core/tabWheel/tabWheelCore.ts"), "utf8");
  const transformed = await transform(source, {
    loader: "ts",
    format: "esm",
    target: "es2022",
  });
  const encoded = Buffer.from(transformed.code, "utf8").toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

test("modifier matching requires the exact configured chord", async () => {
  const { isTabWheelModifier } = await loadCore();

  assert.equal(isTabWheelModifier(
    { altKey: true, ctrlKey: false, metaKey: false, shiftKey: false },
    "alt",
    false,
  ), true);
  assert.equal(isTabWheelModifier(
    { altKey: true, ctrlKey: false, metaKey: false, shiftKey: true },
    "alt",
    false,
  ), false);
  assert.equal(isTabWheelModifier(
    { altKey: false, ctrlKey: false, metaKey: true, shiftKey: true },
    "meta",
    true,
  ), true);
  assert.equal(isTabWheelModifier(
    { altKey: true, ctrlKey: true, metaKey: false, shiftKey: false },
    "alt",
    false,
  ), false);
});

test("direction follows wheel sign and optional inversion", async () => {
  const { resolveWheelDirection } = await loadCore();

  assert.equal(resolveWheelDirection(100, false), "next");
  assert.equal(resolveWheelDirection(-100, false), "prev");
  assert.equal(resolveWheelDirection(100, true), "prev");
  assert.equal(resolveWheelDirection(-100, true), "next");
});

test("left-to-right cycling wraps only when enabled", async () => {
  const { resolveCycleTargetIndex } = await loadCore();

  assert.equal(resolveCycleTargetIndex([0, 1, 2], 1, "next", true), 2);
  assert.equal(resolveCycleTargetIndex([0, 1, 2], 0, "prev", true), 2);
  assert.equal(resolveCycleTargetIndex([0, 1, 2], 2, "next", false), 2);
  assert.equal(resolveCycleTargetIndex([0, 2, 4], 3, "prev", false), 2);
  assert.equal(resolveCycleTargetIndex([], 0, "next", true), -1);
});

test("wheel deltas normalize pixels, lines, pages, and optional horizontal input", async () => {
  const { normalizeWheelDelta } = await loadCore();

  assert.equal(normalizeWheelDelta(
    { deltaMode: 0, deltaX: -40, deltaY: 12 },
    900,
    1200,
    false,
  ), 12);
  assert.equal(normalizeWheelDelta(
    { deltaMode: 0, deltaX: -40, deltaY: 12 },
    900,
    1200,
    true,
  ), -40);
  assert.equal(normalizeWheelDelta(
    { deltaMode: 1, deltaX: 3, deltaY: 1 },
    900,
    1200,
    true,
  ), 48);
  assert.equal(normalizeWheelDelta(
    { deltaMode: 2, deltaX: 0, deltaY: 1 },
    900,
    1200,
    false,
  ), 900);
});

test("sensitivity and acceleration keep bounded trigger distances", async () => {
  const {
    resolveWheelTriggerDistance,
    resolveAcceleratedWheelTriggerDistance,
  } = await loadCore();

  assert.equal(resolveWheelTriggerDistance(80, 0.5), 160);
  assert.equal(resolveWheelTriggerDistance(80, 1), 80);
  assert.equal(resolveWheelTriggerDistance(80, 2), 40);
  assert.equal(resolveWheelTriggerDistance(80, Number.NaN), 80);
  assert.equal(resolveAcceleratedWheelTriggerDistance(80, 0, false), 80);
  assert.equal(resolveAcceleratedWheelTriggerDistance(80, 3, true), 62);
  assert.equal(resolveAcceleratedWheelTriggerDistance(44, 20, true), 40);
});

// The Precise preset's base trigger, real-computed by the same function
// appInit calls: a preset's feel is exactly this arithmetic, with nothing
// adjusting it afterwards.
test("Precise preset's sensitivity (0.8) resolves to a 100px base trigger distance", async () => {
  const { resolveWheelTriggerDistance } = await loadCore();

  assert.equal(resolveWheelTriggerDistance(80, 0.8), 100);
});

test("a swipe is read on the axis that leads once it has travelled far enough to tell", async () => {
  const core = await loadCore();
  const lock = core.createSwipeAxisLock();

  // A noisy first event leans sideways, then the swipe turns out vertical.
  assert.equal(core.resolveSwipeAxis(lock, { x: 2, y: 1 }), "x");
  assert.equal(lock.axis, null, "3px is too little to commit to an axis");
  assert.equal(core.resolveSwipeAxis(lock, { x: -1, y: 6 }), "y");
  assert.equal(core.resolveSwipeAxis(lock, { x: 1, y: 6 }), "y");
  assert.equal(lock.axis, "y");
  // Locked: a later sideways-leaning event is still read vertically.
  assert.equal(core.resolveSwipeAxis(lock, { x: 30, y: 2 }), "y");
});

test("both wheel axes are measured in the same units as the gesture", async () => {
  const core = await loadCore();

  assert.deepEqual(core.measureWheelAxes({ deltaMode: 0, deltaX: -3, deltaY: 7 }, 800, 1200), { x: -3, y: 7 });
  assert.deepEqual(core.measureWheelAxes({ deltaMode: 1, deltaX: 1, deltaY: -2 }, 800, 1200), { x: 16, y: -32 });
  assert.deepEqual(core.measureWheelAxes({ deltaMode: 2, deltaX: 1, deltaY: 1 }, 800, 1200), { x: 1200, y: 800 });
});

test("a swipe's distance per tab is derived from the wheel sensitivity, 2x more sensitive", async () => {
  const core = await loadCore();

  // 100px / (sensitivity x 2): 50px at the default.
  assert.equal(core.resolveSwipeStepPx(1), 50);
  assert.ok(Math.abs(core.resolveSwipeStepPx(0.8) - 62.5) < 1e-9, "Precise");
  assert.ok(Math.abs(core.resolveSwipeStepPx(1.35) - 100 / 2.7) < 1e-9, "Fast");
  assert.ok(core.resolveSwipeStepPx(2) < core.resolveSwipeStepPx(0.5));
  assert.equal(core.resolveSwipeStepPx(0), core.resolveSwipeStepPx(1));
  assert.equal(core.resolveSwipeStepPx(Number.NaN), core.resolveSwipeStepPx(1));
});
