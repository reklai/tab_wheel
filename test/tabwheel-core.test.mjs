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
