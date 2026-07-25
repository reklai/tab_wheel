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

// A momentum tail (trackpad flick) shrinks tick over tick; a held free-spin
// wheel keeps delivering roughly the same magnitude. This is the same
// decaying-run signal the momentum guard reacts to, used here only to tell
// the two device shapes apart. Most real trackpad streams (jitter riding on
// a decelerating flick) satisfy this; a rising, still-accelerating drag does
// not — that case is deliberately left as "unknown" rather than guessed at.
function hasDecayingRuns(samples: WheelObservation[]): boolean {
  if (samples.length < 2) return false;
  let decreasingPairs = 0;
  for (let index = 1; index < samples.length; index += 1) {
    if (samples[index].deltaMagnitudePx < samples[index - 1].deltaMagnitudePx) decreasingPairs += 1;
  }
  return decreasingPairs / (samples.length - 1) >= 0.4;
}

// A held free-spin wheel keeps delivering roughly the same magnitude over
// the whole window even though the OS jitters each individual notch by a
// few pixels (real hardware, unlike a synthetic constant stream, makes
// roughly half of consecutive pairs "decreasing" — pairwise comparison
// can't tell a jittery spin from decay). Comparing first-half vs
// second-half medians cancels the jitter and isolates the trend: a
// sustained spin holds its median, a decaying inertia tail collapses well
// below it. 0.7 leaves headroom for a spin that eases off slightly without
// truly decaying, while still catching a real inertia tail (which typically
// halves or worse across the window).
const FREE_SPIN_SUSTAINED_TREND_RATIO = 0.7;

function hasSustainedMagnitudeTrend(samples: WheelObservation[]): boolean {
  const halfIndex = Math.floor(samples.length / 2);
  const firstHalfMedian = median(samples.slice(0, halfIndex).map((sample) => sample.deltaMagnitudePx));
  const secondHalfMedian = median(samples.slice(halfIndex).map((sample) => sample.deltaMagnitudePx));
  return secondHalfMedian >= firstHalfMedian * FREE_SPIN_SUSTAINED_TREND_RATIO;
}

// A held wheel notch is mechanically consistent: every event is close to
// the same magnitude, so almost all samples land within a tight band around
// the window median. A hand-driven trackpad plateau (a fast two-finger drag
// that hasn't started decaying yet) can also be "sustained" by the trend
// test above, but a *noisy* hand-driven plateau is measurably jumpier
// event-to-event than a wheel notch. Hand-verified against real jitter
// (~6-7% median deviation) and two adversarial noisy plateaus (two-finger
// drag ~9-15%, precision-touchpad drag ~11-27%): 9% is the tightest ratio
// that still passes genuine spin jitter (documented elsewhere as ≈8-9%)
// while rejecting both noisy plateaus tested. This only separates spins
// from *noisy* plateaus — a hand can also sustain a smooth, near-constant-
// velocity drag at ≥60px/frame with dispersion near 0, tighter than genuine
// spin jitter; no dispersion tolerance can tell that apart from a real
// spin, so it's a known leak into freeSpinWheel. Accepted: the only
// consequence is a wrong calibration label (live tuning is identical for
// freeSpinWheel and unknown — see resolveDeviceTuningAdjustment), and the
// durable discriminator to add once real captures are available is notch
// quantization (a wheel's magnitude repeats a small set of discrete values;
// a smooth drag's does not), not a tighter dispersion ratio.
const FREE_SPIN_DISPERSION_TOLERANCE_RATIO = 0.09;
// 0.7 mirrors the other "dominant fraction" gates in this module — the
// large majority of samples must sit inside the tolerance band, not just a
// bare majority.
const FREE_SPIN_DISPERSION_DOMINANT_FRACTION = 0.7;

function hasTightMagnitudeDispersion(samples: WheelObservation[]): boolean {
  const windowMedian = median(samples.map((sample) => sample.deltaMagnitudePx));
  if (windowMedian <= 0) return false;
  const tolerancePx = windowMedian * FREE_SPIN_DISPERSION_TOLERANCE_RATIO;
  const tightFraction = fractionMatching(
    samples,
    (sample) => Math.abs(sample.deltaMagnitudePx - windowMedian) <= tolerancePx,
  );
  return tightFraction >= FREE_SPIN_DISPERSION_DOMINANT_FRACTION;
}

// A detented wheel emits a near-identical pixel delta per notch regardless
// of platform (~53px Linux Chrome, 100px Windows Chrome, 120px hi-res
// Windows Chrome) — unlike a fixed step list, clustering on the observed
// modal magnitude generalizes across all of them without hardcoding
// per-platform numbers.
// 4px: coarse enough that jitter within one notch collapses into a single
// bucket, fine enough not to merge genuinely distinct notch sizes together.
const CLUSTER_BUCKET_PX = 4;
// 12px: the per-notch jitter budget observed across platforms (Linux/macOS
// wheels wobble a few px per detent); wide enough to keep one notch's
// samples together without blurring into a neighboring notch size.
const CLUSTER_TOLERANCE_PX = 12;
// 0.7: same "large majority, not bare majority" bar as the other dominant-
// fraction gates in this module.
const CLUSTER_DOMINANT_FRACTION = 0.7;
// No detented wheel on any supported platform emits under ~30px per notch
// (Linux Chrome ~53px, Windows Chrome 100px, hi-res Windows Chrome 120px);
// a tight cluster below this is a slow trackpad drag, not a wheel notch.
const CLUSTER_MIN_MODAL_MAGNITUDE_PX = 30;

// A detented wheel's magnitude cluster, keyed by its representative
// (mean) magnitude so CLUSTER_TOLERANCE_PX and CLUSTER_MIN_MODAL_MAGNITUDE_PX
// are compared against what the cluster actually measures, not against the
// 4px-rounded bucket label used only to group samples.
interface MagnitudeCluster {
  representativeMagnitudePx: number;
  sampleCount: number;
  inToleranceFraction: number;
}

function buildMagnitudeClusters(samples: WheelObservation[]): MagnitudeCluster[] {
  const bucketedSamples = new Map<number, WheelObservation[]>();
  for (const sample of samples) {
    const bucket = Math.round(sample.deltaMagnitudePx / CLUSTER_BUCKET_PX) * CLUSTER_BUCKET_PX;
    const bucketGroup = bucketedSamples.get(bucket);
    if (bucketGroup) bucketGroup.push(sample);
    else bucketedSamples.set(bucket, [sample]);
  }

  return Array.from(bucketedSamples.values()).map((bucketGroup) => {
    const representativeMagnitudePx =
      bucketGroup.reduce((total, sample) => total + sample.deltaMagnitudePx, 0) / bucketGroup.length;
    return {
      representativeMagnitudePx,
      sampleCount: bucketGroup.length,
      inToleranceFraction: fractionMatching(
        samples,
        (sample) => Math.abs(sample.deltaMagnitudePx - representativeMagnitudePx) <= CLUSTER_TOLERANCE_PX,
      ),
    };
  });
}

// Picking "the" modal bucket needs a tie-break: two or more bucket labels
// can land on the same sample count (a coin-flip in real streams once a
// window has a few dozen samples). Iterating a Map and keeping the first
// bucket to reach the max count makes the result depend on sample arrival
// order — the same multiset in a different event order could pick a
// different bucket and flip the classification. Instead, rank by sample
// count, then by in-tolerance fraction (which cluster best explains the
// window), then by the larger representative magnitude — every dimension is
// a plain number comparison, so the ranking (and therefore the result) is
// the same regardless of which order the buckets are visited in.
function selectDominantCluster(clusters: MagnitudeCluster[]): MagnitudeCluster | undefined {
  return clusters.reduce<MagnitudeCluster | undefined>((best, candidate) => {
    if (!best) return candidate;
    if (candidate.sampleCount !== best.sampleCount) {
      return candidate.sampleCount > best.sampleCount ? candidate : best;
    }
    if (candidate.inToleranceFraction !== best.inToleranceFraction) {
      return candidate.inToleranceFraction > best.inToleranceFraction ? candidate : best;
    }
    return candidate.representativeMagnitudePx > best.representativeMagnitudePx ? candidate : best;
  }, undefined);
}

function hasDominantMagnitudeCluster(samples: WheelObservation[]): boolean {
  if (samples.length === 0) return false;
  const dominantCluster = selectDominantCluster(buildMagnitudeClusters(samples));
  if (!dominantCluster) return false;
  if (dominantCluster.representativeMagnitudePx < CLUSTER_MIN_MODAL_MAGNITUDE_PX) return false;
  return dominantCluster.inToleranceFraction >= CLUSTER_DOMINANT_FRACTION;
}

const LINE_MODE_DOMINANT_FRACTION = 0.5;
const PIXEL_MODE_MIN_FRACTION = 0.75;
const DISCRETE_WHEEL_MIN_MEDIAN_GAP_MS = 40;
const TRACKPAD_MAX_MEDIAN_GAP_MS = 20;
const TRACKPAD_SMALL_MAGNITUDE_PX = 30;
const TRACKPAD_SMALL_DOMINANT_FRACTION = 0.6;
// 16.7ms = 60Hz frame cadence, the fastest gap real browsers deliver wheel
// events at. Raised from 16 because 16.7ms genuinely exceeds the old
// ceiling — not a rounding artifact; a real 60Hz spin is measurably slower
// than the old 16ms limit. This ceiling no longer does the work of
// excluding trackpads by itself (a fast two-finger drag can be just as
// rapid) — see hasTightMagnitudeDispersion below for what actually tells
// them apart. Discrete wheels still read much slower — see
// DISCRETE_WHEEL_MIN_MEDIAN_GAP_MS.
const FREE_SPIN_MAX_MEDIAN_GAP_MS = 18;
const FREE_SPIN_MIN_MAGNITUDE_PX = 60;
const FREE_SPIN_LARGE_DOMINANT_FRACTION = 0.7;
// A genuine spin floods events; this floor keeps a short burst of a handful
// of large deltas (which could be a hard trackpad flick) from reading as a
// sustained free-spin.
const FREE_SPIN_MIN_SAMPLE_COUNT = 12;

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

  // Chrome reports clicky wheels in pixel mode, clustered on a per-notch
  // magnitude and gated by physical detents (slower cadence than a smooth
  // surface).
  if (hasDominantMagnitudeCluster(pixelModeSamples) && medianGapMs > DISCRETE_WHEEL_MIN_MEDIAN_GAP_MS) {
    return "discreteWheel";
  }

  // Checked before free-spin below. Raising the free-spin gap ceiling to
  // 18ms grows its overlap with this branch's <20ms window, but the two
  // stay disjoint on magnitude: trackpad needs >=60% of samples under 30px,
  // free-spin needs >=70% at 60px+ — both fractions can't hold at once (they'd
  // sum past 1 over the same window), so a stream can only ever satisfy one.
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
    medianGapMs <= FREE_SPIN_MAX_MEDIAN_GAP_MS
    && largeMagnitudeFraction >= FREE_SPIN_LARGE_DOMINANT_FRACTION
    && pixelModeSamples.length >= FREE_SPIN_MIN_SAMPLE_COUNT
    && hasSustainedMagnitudeTrend(pixelModeSamples)
    && hasTightMagnitudeDispersion(pixelModeSamples)
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
