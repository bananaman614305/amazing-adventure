// Adaptive render quality. Pure state machine, no Three.js, so the rules can be
// unit-tested without a GPU.
//
// Why this exists alongside perf.js: adaptive resolution is the first lever and
// it bottoms out at MIN_RATIO (0.5). Measurement on a Pixel 7 profile showed the
// game is still fill-rate bound at that floor -- 2.5 fps at ratio 2, 10.5 fps at
// ratio 0.5, and 14.4 fps at ratio 0.5 with shadows off. So once resolution has
// nothing left to give, the next honest lever is to stop paying for per-pixel
// shadow sampling and the point-light loop.
//
// Measured contributions on that profile (same scene, same camera, one lever at
// a time): shadows off 2.5 -> 2.62 fps, point lights hidden 2.5 -> 3.32 fps,
// quarter ratio 2.5 -> 10.53 fps, shadows off + quarter ratio 14.43 fps.
// Resolution dominates; the other two are worth having only after it is spent.
//
// What the low tier deliberately does NOT do: it keeps the lamp bulbs' emissive
// glow, so night still reads as lit lamps rather than a dark scene. It removes
// the point lights' per-pixel contribution and the shadow pass, not the art.

export const QUALITY_FULL = 'full';
export const QUALITY_LOW = 'low';

// Frame times in ms. DROP_MS is deliberately worse than perf.js SLOW_MS (32):
// quality only degrades once resolution has already been driven to its floor
// and the game is still badly slow (below ~7 fps).
export const DROP_MS = 140;
// Recovery needs genuinely comfortable frames, not merely "less bad". Without
// this asymmetry the tier would flap: dropping quality makes frames faster,
// which would immediately argue for restoring it, which makes them slow again.
export const RESTORE_MS = 22;
// Consecutive qualifying samples before a change takes effect.
export const DROP_STREAK = 24;
export const RESTORE_STREAK = 90;

/** True when a tier should shed quality: slow frames and not already low. */
export function shouldDropQuality(tier, smoothedMs) {
  if (tier === QUALITY_LOW) return false;
  if (!Number.isFinite(smoothedMs) || smoothedMs <= 0) return false;
  return smoothedMs > DROP_MS;
}

/** True when a tier may restore quality: comfortably fast and currently low. */
export function shouldRestoreQuality(tier, smoothedMs) {
  if (tier !== QUALITY_LOW) return false;
  if (!Number.isFinite(smoothedMs) || smoothedMs <= 0) return false;
  return smoothedMs < RESTORE_MS;
}

/**
 * A small state machine around those rules. `smoothedMs` is expected to come
 * from the same smoothed frame time perf.js uses, so the two controllers agree
 * about how slow the machine is.
 */
export function createQualityTier({ start = QUALITY_FULL } = {}) {
  let tier = start === QUALITY_LOW ? QUALITY_LOW : QUALITY_FULL;
  let dropStreak = 0;
  let restoreStreak = 0;
  let changes = 0;

  return {
    get tier() {
      return tier;
    },
    get changes() {
      return changes;
    },
    /** Forces a tier (manual override or a panic shed). Returns the tier. */
    force(next) {
      const value = next === QUALITY_LOW ? QUALITY_LOW : QUALITY_FULL;
      if (value !== tier) changes += 1;
      tier = value;
      dropStreak = 0;
      restoreStreak = 0;
      return tier;
    },
    /**
     * Feed one smoothed frame time. Returns the tier to use now. A change needs
     * a full streak of consistent evidence, and the streak resets afterwards so
     * the next change must earn its own evidence.
     */
    sample(smoothedMs) {
      if (shouldDropQuality(tier, smoothedMs)) {
        dropStreak += 1;
        restoreStreak = 0;
        if (dropStreak >= DROP_STREAK) {
          tier = QUALITY_LOW;
          changes += 1;
          dropStreak = 0;
        }
        return tier;
      }
      if (shouldRestoreQuality(tier, smoothedMs)) {
        restoreStreak += 1;
        dropStreak = 0;
        if (restoreStreak >= RESTORE_STREAK) {
          tier = QUALITY_FULL;
          changes += 1;
          restoreStreak = 0;
        }
        return tier;
      }
      // Neither band: the frame time is in the dead zone, so forget both
      // streaks rather than letting stale evidence accumulate.
      dropStreak = 0;
      restoreStreak = 0;
      return tier;
    }
  };
}
