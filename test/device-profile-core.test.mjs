import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transform } from "esbuild";

const ROOT = process.cwd();

async function loadCore() {
  const source = readFileSync(
    resolve(ROOT, "src/lib/core/tabWheel/deviceProfileCore.ts"),
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

function fillWindow(addWheelSample, sampleWindow, observations) {
  for (const observation of observations) addWheelSample(sampleWindow, observation);
  return sampleWindow;
}

function buildSeries(startMs, gapMs, deltaMode, magnitudes) {
  return magnitudes.map((deltaMagnitudePx, index) => ({
    timeStampMs: startMs + index * gapMs,
    deltaMode,
    deltaMagnitudePx,
  }));
}

test("fewer than 8 samples classifies as unknown", async () => {
  const { createWheelSampleWindow, addWheelSample, classifyWheelDevice } = await loadCore();

  const sampleWindow = fillWindow(
    addWheelSample,
    createWheelSampleWindow(),
    buildSeries(0, 50, 0, [10, 10, 10, 10, 10]),
  );

  assert.equal(classifyWheelDevice(sampleWindow), "unknown");
});

test("line-mode deltas classify as a discrete wheel", async () => {
  const { createWheelSampleWindow, addWheelSample, classifyWheelDevice } = await loadCore();

  const sampleWindow = fillWindow(
    addWheelSample,
    createWheelSampleWindow(),
    buildSeries(0, 80, 1, [16, 16, 16, 16, 16, 16, 16, 16, 16, 16]),
  );

  assert.equal(classifyWheelDevice(sampleWindow), "discreteWheel");
});

test("quantized 120px pixel-mode deltas with slow gaps classify as a discrete wheel", async () => {
  const { createWheelSampleWindow, addWheelSample, classifyWheelDevice } = await loadCore();

  const sampleWindow = fillWindow(
    addWheelSample,
    createWheelSampleWindow(),
    buildSeries(0, 50, 0, [120, 120, 120, 120, 120, 120, 120, 120, 120, 120]),
  );

  assert.equal(classifyWheelDevice(sampleWindow), "discreteWheel");
});

test("small rapid decaying pixel-mode deltas classify as a trackpad", async () => {
  const { createWheelSampleWindow, addWheelSample, classifyWheelDevice } = await loadCore();

  const sampleWindow = fillWindow(
    addWheelSample,
    createWheelSampleWindow(),
    buildSeries(0, 10, 0, [25, 22, 18, 15, 12, 10, 8, 6, 5, 4]),
  );

  assert.equal(classifyWheelDevice(sampleWindow), "trackpad");
});

test("steady rapid large pixel-mode deltas classify as a free-spin wheel", async () => {
  const { createWheelSampleWindow, addWheelSample, classifyWheelDevice } = await loadCore();

  const sampleWindow = fillWindow(
    addWheelSample,
    createWheelSampleWindow(),
    buildSeries(0, 10, 0, [70, 70, 70, 70, 70, 70, 70, 70, 70, 70]),
  );

  assert.equal(classifyWheelDevice(sampleWindow), "freeSpinWheel");
});

test("the sample window ring buffer caps at 32 entries and evicts the oldest", async () => {
  const { createWheelSampleWindow, addWheelSample } = await loadCore();

  const sampleWindow = createWheelSampleWindow();
  for (let index = 0; index < 40; index += 1) {
    addWheelSample(sampleWindow, { timeStampMs: index * 10, deltaMode: 0, deltaMagnitudePx: 10 });
  }

  assert.equal(sampleWindow.samples.length, 32);
  assert.equal(sampleWindow.samples[0].timeStampMs, 8 * 10);
  assert.equal(sampleWindow.samples[31].timeStampMs, 39 * 10);
});

test("resolveDeviceTuningAdjustment keeps multipliers mild and matches device kind", async () => {
  const { resolveDeviceTuningAdjustment } = await loadCore();

  const trackpadTuning = resolveDeviceTuningAdjustment("trackpad");
  assert.ok(trackpadTuning.triggerDistanceMultiplier > 1 && trackpadTuning.triggerDistanceMultiplier <= 1.3);
  assert.ok(trackpadTuning.extraCooldownMs > 0);
  assert.ok(trackpadTuning.momentumGuardTuning);

  for (const kind of ["freeSpinWheel", "discreteWheel", "unknown"]) {
    const tuning = resolveDeviceTuningAdjustment(kind);
    assert.equal(tuning.triggerDistanceMultiplier, 1.0);
    assert.equal(tuning.extraCooldownMs, 0);
    assert.ok(tuning.momentumGuardTuning);
  }

  for (const kind of ["trackpad", "freeSpinWheel", "discreteWheel", "unknown"]) {
    assert.ok(resolveDeviceTuningAdjustment(kind).triggerDistanceMultiplier <= 1.3);
  }
});

test("resolveSuggestedPreset maps device kind to the closest wheel feel preset", async () => {
  const { resolveSuggestedPreset } = await loadCore();

  assert.equal(resolveSuggestedPreset("trackpad"), "precise");
  assert.equal(resolveSuggestedPreset("freeSpinWheel"), "fast");
  assert.equal(resolveSuggestedPreset("discreteWheel"), "balanced");
  assert.equal(resolveSuggestedPreset("unknown"), "balanced");
});
