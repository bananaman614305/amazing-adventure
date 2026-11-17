// Adaptive render resolution. Pure maths, no Three.js, so the stepping rules
// can be unit-tested without a GPU.
//
// The game is fill-rate bound on weak hardware (software rasterisation here
// measures ~3 fps at 1280x800 with shadows costing nothing). Drawing fewer
// pixels is the one lever that actually helps, so resolution is scaled by a
// pixel ratio that walks toward a target frame time.

export const MIN_RATIO = 0.5;
export const MAX_RATIO = 2;
// Ratios live on an integer grid of STEPs so 1.0 and 2.0 are reachable and no
// floating-point drift creeps in.
export const STEP = 0.05;
const STEP_COUNT = Math.round((MAX_RATIO - MIN_RATIO) / STEP);
// Frame times in ms. Above SLOW_MS the resolution drops; below FAST_MS it rises.
export const SLOW_MS = 32;
export const FAST_MS = 19;
// Wait this many samples before changing anything, so a single hitch or a
// first-frame compile does not slam the resolution to the floor.
export const SETTLE_FRAMES = 20;
// Samples longer than this are clamped, not trusted. A tab restore or shader
// compile can report seconds; clamping keeps one hitch from dominating the
// average while still letting a genuinely slow machine (where *every* frame is
// long) register as slow. Discarding instead would blind the controller on the
// weakest hardware, which is exactly where it is needed.
export const MAX_SAMPLE_MS = 250;
// Decisions must be consistent for this many frames before taking effect, so
// resolution does not flap on a noisy frame time.
export const STREAK = 12;

/** Clamps a proposed pixel ratio into the supported range, rounded to STEP. */
export function clampRatio(value) {
  if (!Number.isFinite(value)) return 1;
  const index = Math.round((value - MIN_RATIO) / STEP);
  const bounded = Math.min(STEP_COUNT, Math.max(0, index));
  return Number((MIN_RATIO + bounded * STEP).toFixed(2));
}

/**
 * Decides the next pixel ratio given a smoothed frame time.
 * Returns the same ratio when the frame time is comfortable, so this is stable
 * and does not oscillate between bounds.
 */
export function nextRatio(current, smoothedMs) {
  const clamped = clampRatio(current);
  if (!Number.isFinite(smoothedMs) || smoothedMs <= 0) return clamped;
  if (smoothedMs > SLOW_MS) return clampRatio(Math.max(MIN_RATIO, clamped - STEP));
  if (smoothedMs < FAST_MS) return clampRatio(Math.min(MAX_RATIO, clamped + STEP));
  return clamped;
}

/** Exponential smoothing so one slow frame does not move the resolution. */
export function smooth(previous, sample, weight = 0.1) {
  if (!Number.isFinite(previous)) return sample;
  return previous + (sample - previous) * weight;
}

/**
 * A small state machine around the rules above. Kept plain so tests can drive
 * it with fake frame times instead of waiting on a real browser.
 */
export function createAdaptiveResolution({ start = 1, settleFrames = SETTLE_FRAMES } = {}) {
  let ratio = clampRatio(start);
  let smoothed = NaN;
  let frames = 0;
  let changes = 0;
  let slowStreak = 0;
  let fastStreak = 0;

  return {
    get ratio() {
      return ratio;
    },
    get smoothed() {
      return smoothed;
    },
    get changes() {
      return changes;
    },
    reset(nextStart = ratio) {
      ratio = clampRatio(nextStart);
      smoothed = NaN;
      frames = 0;
      slowStreak = 0;
      fastStreak = 0;
    },
    /** Feed one frame's duration in ms. Returns the ratio to use now. */
    sample(frameMs) {
      if (!Number.isFinite(frameMs) || frameMs <= 0) return ratio;
      const clamped = Math.min(frameMs, MAX_SAMPLE_MS);
      smoothed = smooth(smoothed, clamped);
      frames += 1;
      if (frames < settleFrames) return ratio;

      slowStreak = smoothed > SLOW_MS ? slowStreak + 1 : 0;
      fastStreak = smoothed < FAST_MS ? fastStreak + 1 : 0;
      const decided = slowStreak >= STREAK || fastStreak >= STREAK;
      if (!decided) return ratio;

      const next = nextRatio(ratio, smoothed);
      if (next !== ratio) {
        ratio = next;
        changes += 1;
      }
      // Restart the streak either way, so the next change needs fresh evidence.
      slowStreak = 0;
      fastStreak = 0;
      return ratio;
    }
  };
}
