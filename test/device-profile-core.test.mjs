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

test("quantized 100px pixel-mode deltas with slow gaps classify as a discrete wheel", async () => {
  const { createWheelSampleWindow, addWheelSample, classifyWheelDevice } = await loadCore();

  const sampleWindow = fillWindow(
    addWheelSample,
    createWheelSampleWindow(),
    buildSeries(0, 50, 0, [100, 100, 100, 100, 100, 100, 100, 100, 100, 100]),
  );

  assert.equal(classifyWheelDevice(sampleWindow), "discreteWheel");
});

// Regression for the real-hardware bug: Linux Chrome reports ~53px per
// notch, which the old fixed [100, 120]px step list never matched, so a
// Linux clicky wheel fell through to "unknown" during calibration.
// Clustering on the observed modal magnitude (instead of a hardcoded step
// list) generalizes to this platform.
test("linux chrome 53px clicky-wheel deltas classify as a discrete wheel", async () => {
  const { createWheelSampleWindow, addWheelSample, classifyWheelDevice } = await loadCore();

  const sampleWindow = fillWindow(
    addWheelSample,
    createWheelSampleWindow(),
    buildSeries(0, 90, 0, [53, 52, 54, 53, 51, 55, 53, 52, 54, 53]),
  );

  assert.equal(classifyWheelDevice(sampleWindow), "discreteWheel");
});

// IMPORTANT regression: no detented wheel on any supported platform emits
// under ~30px per notch (Linux 53px, Windows 100px, hi-res Windows 120px);
// a tight 16-30px cluster is a slow trackpad drag, not a wheel notch. The
// old 16px floor let this read as discreteWheel.
test("slow trackpad drag deltas do not classify as a discrete wheel", async () => {
  const { createWheelSampleWindow, addWheelSample, classifyWheelDevice } = await loadCore();

  const sampleWindow = fillWindow(
    addWheelSample,
    createWheelSampleWindow(),
    buildSeries(0, 50, 0, [22, 20, 24, 22, 26, 20, 22, 24, 21, 23, 25, 22]),
  );

  assert.notEqual(classifyWheelDevice(sampleWindow), "discreteWheel");
});

// IMPORTANT regression: the same multiset of magnitudes, delivered in a
// different arrival order, must classify identically. The old modal
// tie-break kept whichever equally-sized bucket the Map visited first
// (insertion order = arrival order), so this exact pair flipped between
// "discreteWheel" and "unknown" depending only on event order.
test("modal-bucket tie-break is deterministic regardless of sample arrival order", async () => {
  const { createWheelSampleWindow, addWheelSample, classifyWheelDevice } = await loadCore();

  const arrivalOrderA = fillWindow(
    addWheelSample,
    createWheelSampleWindow(),
    buildSeries(0, 60, 0, [46, 25, 12, 50, 31, 14, 18, 14, 46, 19]),
  );
  const arrivalOrderB = fillWindow(
    addWheelSample,
    createWheelSampleWindow(),
    buildSeries(0, 60, 0, [19, 50, 46, 14, 18, 14, 31, 46, 12, 25]),
  );

  assert.equal(classifyWheelDevice(arrivalOrderA), classifyWheelDevice(arrivalOrderB));
});

// macOS Chrome accelerates per-notch magnitude with scroll speed, so deltas
// never cluster the way a detented wheel's do. Falling through to
// "unknown" (rather than a wrong guess) is the correct, accepted outcome —
// the calibration UI shows the neutral "Balanced" message, which is
// harmless since Balanced is the right suggestion for it anyway.
test("macOS accelerated clicky-wheel deltas do not cluster and stay unknown", async () => {
  const { createWheelSampleWindow, addWheelSample, classifyWheelDevice } = await loadCore();

  const sampleWindow = fillWindow(
    addWheelSample,
    createWheelSampleWindow(),
    buildSeries(0, 80, 0, [8, 20, 33, 47, 58, 71, 85, 14, 40, 65]),
  );

  assert.equal(classifyWheelDevice(sampleWindow), "unknown");
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

// A trackpad inertia tail must not be confused with a free-spin wheel: both
// can have rapid gaps, but the tail's magnitude decays hard across the
// window rather than holding, so hasSustainedMagnitudeTrend fails it.
test("decaying trackpad inertia tail is not classified as a free-spin wheel", async () => {
  const { createWheelSampleWindow, addWheelSample, classifyWheelDevice } = await loadCore();

  const magnitudes = [
    80, 70, 62, 55, 48, 42, 37, 33, 29, 25, 22, 20,
    17, 15, 13, 12, 10, 9, 8, 7, 6, 5, 5, 4,
  ];
  const smallMagnitudeFraction = magnitudes.filter((magnitude) => magnitude < 30).length / magnitudes.length;
  assert.ok(smallMagnitudeFraction >= 0.6, "fixture must exercise the trackpad small-magnitude branch");

  const sampleWindow = fillWindow(
    addWheelSample,
    createWheelSampleWindow(),
    buildSeries(0, 10, 0, magnitudes),
  );

  const classification = classifyWheelDevice(sampleWindow);
  assert.notEqual(classification, "freeSpinWheel");
  assert.equal(classification, "trackpad");
});

test("steady rapid large pixel-mode deltas classify as a free-spin wheel", async () => {
  const { createWheelSampleWindow, addWheelSample, classifyWheelDevice } = await loadCore();

  const sampleWindow = fillWindow(
    addWheelSample,
    createWheelSampleWindow(),
    buildSeries(0, 10, 0, [70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70]),
  );

  assert.equal(classifyWheelDevice(sampleWindow), "freeSpinWheel");
});

// Regression for the real-hardware bug: a genuine free-spin wheel never
// delivers perfectly-constant deltas the way the test above does — the OS
// jitters each notch by a few pixels, so roughly half of consecutive pairs
// are decreasing even while the spin is sustained. Real Chrome also reports
// wheel events at frame cadence (16.67ms at 60Hz), not <16ms. The old
// predicate required strictly non-decaying pairs and gap < 16ms, so it never
// fired on real hardware. This test must classify as freeSpinWheel; it is
// expected to FAIL against the pre-fix predicate (captured as the TDD RED
// step before the predicate was replaced).
test("jittery real-hardware free-spin stream still classifies as a free-spin wheel", async () => {
  const { createWheelSampleWindow, addWheelSample, classifyWheelDevice } = await loadCore();

  const sampleWindow = fillWindow(
    addWheelSample,
    createWheelSampleWindow(),
    buildSeries(0, 16.7, 0, [
      70, 66, 73, 68, 71, 65, 72, 67, 74, 69, 70, 66,
      73, 68, 71, 65, 72, 67, 74, 69, 70, 66, 73, 68,
    ]),
  );

  assert.equal(classifyWheelDevice(sampleWindow), "freeSpinWheel");
});

// FREE_SPIN_MIN_SAMPLE_COUNT boundary: an otherwise-valid jittery spin with
// only 11 pixel-mode samples is one short of the "genuine spin floods
// events" floor and must not free-spin; the same stream with a 12th sample
// appended must.
test("a jittery spin one sample short of the minimum window is not a free-spin wheel", async () => {
  const { createWheelSampleWindow, addWheelSample, classifyWheelDevice } = await loadCore();

  const sampleWindow = fillWindow(
    addWheelSample,
    createWheelSampleWindow(),
    buildSeries(0, 16.7, 0, [70, 66, 73, 68, 71, 65, 72, 67, 74, 69, 70]),
  );

  assert.equal(sampleWindow.samples.length, 11);
  assert.equal(classifyWheelDevice(sampleWindow), "unknown");
});

test("the same jittery spin at exactly the minimum window is a free-spin wheel", async () => {
  const { createWheelSampleWindow, addWheelSample, classifyWheelDevice } = await loadCore();

  const sampleWindow = fillWindow(
    addWheelSample,
    createWheelSampleWindow(),
    buildSeries(0, 16.7, 0, [70, 66, 73, 68, 71, 65, 72, 67, 74, 69, 70, 66]),
  );

  assert.equal(sampleWindow.samples.length, 12);
  assert.equal(classifyWheelDevice(sampleWindow), "freeSpinWheel");
});

// The modal-magnitude floor is the only guard keeping tight trackpad jitter
// (a gentle, still-moving drag with no momentum decay yet) from reading as
// a detented wheel; without it, a small tightly-clustered magnitude would
// satisfy the cluster-fraction test just as well as a real notch does.
test("gentle small-magnitude trackpad jitter never classifies as a discrete wheel", async () => {
  const { createWheelSampleWindow, addWheelSample, classifyWheelDevice } = await loadCore();

  const sampleWindow = fillWindow(
    addWheelSample,
    createWheelSampleWindow(),
    buildSeries(0, 16.7, 0, [5, 6, 4, 7, 5, 6, 8, 5, 4, 6, 7, 5]),
  );

  assert.notEqual(classifyWheelDevice(sampleWindow), "discreteWheel");
});

// A 30ms gap is slower than any real free-spin cadence (60Hz frame cadence
// tops out at 16.67ms) even though the magnitudes are large and steady;
// the gap ceiling alone should keep this out of freeSpinWheel.
// CRITICAL regression: a fast two-finger trackpad drag / flick plateau can
// hold large magnitudes for a full window without decaying (no momentum
// tail yet), which satisfies every pre-dispersion-gate free-spin conjunct
// (gap, large-magnitude fraction, sustained trend, sample count) and was
// misclassified as freeSpinWheel — telling a trackpad user "Free-spin wheel
// — Fast" during calibration. A held wheel notch repeats a near-identical
// per-event magnitude; a hand-driven trackpad plateau is measurably noisier
// even without decaying. These two streams are expected to FAIL against the
// pre-dispersion-gate predicate (captured as TDD RED before the gate was
// added).
test("fast trackpad drag plateau (12 samples) is not classified as a free-spin wheel", async () => {
  const { createWheelSampleWindow, addWheelSample, classifyWheelDevice } = await loadCore();

  const sampleWindow = fillWindow(
    addWheelSample,
    createWheelSampleWindow(),
    buildSeries(0, 8, 0, [62, 78, 85, 90, 74, 88, 80, 92, 70, 86, 84, 76]),
  );

  assert.notEqual(classifyWheelDevice(sampleWindow), "freeSpinWheel");
});

test("windows precision-touchpad drag plateau (16 samples) is not classified as a free-spin wheel", async () => {
  const { createWheelSampleWindow, addWheelSample, classifyWheelDevice } = await loadCore();

  const sampleWindow = fillWindow(
    addWheelSample,
    createWheelSampleWindow(),
    buildSeries(0, 16.7, 0, [72, 95, 68, 104, 80, 88, 76, 110, 66, 92, 84, 78, 100, 70, 90, 82]),
  );

  assert.notEqual(classifyWheelDevice(sampleWindow), "freeSpinWheel");
});

test("steady slow large pixel-mode deltas are not classified as a free-spin wheel", async () => {
  const { createWheelSampleWindow, addWheelSample, classifyWheelDevice } = await loadCore();

  const sampleWindow = fillWindow(
    addWheelSample,
    createWheelSampleWindow(),
    buildSeries(0, 30, 0, [70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70]),
  );

  assert.equal(classifyWheelDevice(sampleWindow), "unknown");
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
