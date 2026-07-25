// Classify the pointing device driving wheel gestures from a short, rolling
// window of content-free samples (timing + magnitude only — no direction, no
// target, no URL), then translate that classification into mild tuning
// adjustments. Kept pure/browser-free so the heuristics can be unit tested in
// isolation from DOM wheel events.

import { MomentumGuardTuning } from "./momentumGuardCore";

export interface WheelObservation {
  timeStampMs: number;
  deltaMode: number;
  deltaMagnitudePx: number;
}

export interface WheelSampleWindow {
  samples: WheelObservation[];
}

export interface TabWheelDeviceTuningAdjustment {
  triggerDistanceMultiplier: number;
  extraCooldownMs: number;
  momentumGuardTuning: MomentumGuardTuning;
}

const MAX_WHEEL_SAMPLES = 32;
const MIN_SAMPLES_FOR_CLASSIFICATION = 8;

export function createWheelSampleWindow(): WheelSampleWindow {
  return { samples: [] };
}

export function addWheelSample(sampleWindow: WheelSampleWindow, observation: WheelObservation): void {
  sampleWindow.samples.push(observation);
  if (sampleWindow.samples.length > MAX_WHEEL_SAMPLES) sampleWindow.samples.shift();
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  const midIndex = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midIndex - 1] + sorted[midIndex]) / 2
    : sorted[midIndex];
}

function fractionMatching(samples: WheelObservation[], predicate: (sample: WheelObservation) => boolean): number {
  if (samples.length === 0) return 0;
  return samples.filter(predicate).length / samples.length;
}

function computeGapsMs(samples: WheelObservation[]): number[] {
  const gaps: number[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    gaps.push(samples[index].timeStampMs - samples[index - 1].timeStampMs);
  }
  return gaps;
}

// Chrome reports one wheel notch as a fixed pixel step (100 or 120px, and
// small multiples of it for accelerated notches). Trackpads and free-spin
// wheels never land this cleanly on a shared step.
const QUANTIZATION_STEPS_PX = [100, 120];
const QUANTIZATION_TOLERANCE_PX = 12;

function isQuantizedToCommonStep(magnitudePx: number): boolean {
  return QUANTIZATION_STEPS_PX.some((step) => {
    const remainder = magnitudePx % step;
    const distanceToStep = Math.min(remainder, step - remainder);
    return distanceToStep <= QUANTIZATION_TOLERANCE_PX;
  });
}

// A momentum tail (trackpad flick) shrinks tick over tick; a held free-spin
// wheel keeps delivering roughly the same magnitude. This is the same
// decaying-run signal the momentum guard reacts to, used here only to tell
// the two device shapes apart.
function hasDecayingRuns(samples: WheelObservation[]): boolean {
  if (samples.length < 2) return false;
  let decreasingPairs = 0;
  for (let index = 1; index < samples.length; index += 1) {
    if (samples[index].deltaMagnitudePx < samples[index - 1].deltaMagnitudePx) decreasingPairs += 1;
  }
  return decreasingPairs / (samples.length - 1) >= 0.4;
}

const LINE_MODE_DOMINANT_FRACTION = 0.5;
const PIXEL_MODE_MIN_FRACTION = 0.75;
const QUANTIZED_DOMINANT_FRACTION = 0.7;
const DISCRETE_WHEEL_MIN_MEDIAN_GAP_MS = 40;
const TRACKPAD_MAX_MEDIAN_GAP_MS = 20;
const TRACKPAD_SMALL_MAGNITUDE_PX = 30;
const TRACKPAD_SMALL_DOMINANT_FRACTION = 0.6;
const FREE_SPIN_MAX_MEDIAN_GAP_MS = 16;
const FREE_SPIN_MIN_MAGNITUDE_PX = 60;
const FREE_SPIN_LARGE_DOMINANT_FRACTION = 0.7;

export function classifyWheelDevice(sampleWindow: WheelSampleWindow): TabWheelDeviceKind {
  const samples = sampleWindow.samples;
  if (samples.length < MIN_SAMPLES_FOR_CLASSIFICATION) return "unknown";

  // Firefox reports clicky wheels in line mode (deltaMode 1).
  if (fractionMatching(samples, (sample) => sample.deltaMode === 1) >= LINE_MODE_DOMINANT_FRACTION) {
    return "discreteWheel";
  }

  const pixelModeSamples = samples.filter((sample) => sample.deltaMode === 0);
  if (pixelModeSamples.length < samples.length * PIXEL_MODE_MIN_FRACTION) return "unknown";

  const medianGapMs = median(computeGapsMs(pixelModeSamples));

  // Chrome reports clicky wheels in pixel mode, quantized to a fixed step
  // and gated by physical detents (slower cadence than a smooth surface).
  const quantizedFraction = fractionMatching(pixelModeSamples, (sample) => isQuantizedToCommonStep(sample.deltaMagnitudePx));
  if (quantizedFraction >= QUANTIZED_DOMINANT_FRACTION && medianGapMs > DISCRETE_WHEEL_MIN_MEDIAN_GAP_MS) {
    return "discreteWheel";
  }

  const smallMagnitudeFraction = fractionMatching(
    pixelModeSamples,
    (sample) => sample.deltaMagnitudePx < TRACKPAD_SMALL_MAGNITUDE_PX,
  );
  if (
    medianGapMs < TRACKPAD_MAX_MEDIAN_GAP_MS
    && smallMagnitudeFraction >= TRACKPAD_SMALL_DOMINANT_FRACTION
    && hasDecayingRuns(pixelModeSamples)
  ) {
    return "trackpad";
  }

  const largeMagnitudeFraction = fractionMatching(
    pixelModeSamples,
    (sample) => sample.deltaMagnitudePx >= FREE_SPIN_MIN_MAGNITUDE_PX,
  );
  if (
    medianGapMs < FREE_SPIN_MAX_MEDIAN_GAP_MS
    && largeMagnitudeFraction >= FREE_SPIN_LARGE_DOMINANT_FRACTION
    && !hasDecayingRuns(pixelModeSamples)
  ) {
    return "freeSpinWheel";
  }

  return "unknown";
}

// Trackpad momentum streams are easy to over-trigger, so guard strictly:
// wider tail cadence, a higher bar for what counts as a fresh flick, and more
// evidence required before releasing a run as steady input. Wheel devices
// (and the conservative "unknown" default) rarely produce real momentum, so
// guard leniently and get out of the way quickly.
//
// maxTailGapMs sits below deviceProfileCore's own DISCRETE_WHEEL_MIN_MEDIAN_GAP_MS
// on purpose: a detented wheel cannot physically produce a momentum tail, so
// its cadence alone takes it out of the guard's scope at zero cost.
const STRICT_MOMENTUM_GUARD_TUNING: MomentumGuardTuning = {
  maxTailGapMs: 32,
  rampRatio: 1.7,
  steadyDecayFraction: 0.08,
  steadyEventCount: 6,
};

const LENIENT_MOMENTUM_GUARD_TUNING: MomentumGuardTuning = {
  maxTailGapMs: 24,
  rampRatio: 1.3,
  steadyDecayFraction: 0.08,
  steadyEventCount: 4,
};

export function resolveDeviceTuningAdjustment(kind: TabWheelDeviceKind): TabWheelDeviceTuningAdjustment {
  if (kind === "trackpad") {
    return {
      triggerDistanceMultiplier: 1.25,
      extraCooldownMs: 40,
      momentumGuardTuning: STRICT_MOMENTUM_GUARD_TUNING,
    };
  }
  // "freeSpinWheel", "discreteWheel", and "unknown" all keep the base feel.
  return {
    triggerDistanceMultiplier: 1.0,
    extraCooldownMs: 0,
    momentumGuardTuning: LENIENT_MOMENTUM_GUARD_TUNING,
  };
}

export function resolveSuggestedPreset(kind: TabWheelDeviceKind): TabWheelPreset {
  if (kind === "trackpad") return "precise";
  if (kind === "freeSpinWheel") return "fast";
  return "balanced";
}
