// Idle behaviour for the cast: weight shifts and occasional glances.
//
// Pure maths, no Three.js, so the timing and bounds can be unit-tested without
// a renderer. animateCast() consumes these; the player-attention behaviour
// (head turns toward a nearby player) takes priority over glances and is
// handled separately in npcs.js.
//
// Design choices:
//   - Everything is a deterministic function of (time, seed), so two runs of
//     the game show the same behaviour and tests can assert exact values.
//   - The seed comes from the character's spawn position, so each cast member
//     shifts and glances on its own schedule without extra state or RNG.
//   - Glances are rare and short: most of the time the head is at rest, which
//     keeps the plaza calm rather than twitchy.

/** Period of the weight-shift sway, seconds. Slow enough to read as breathing. */
export const SHIFT_PERIOD = 7.5;
/** Peak lateral lean of a leg during a weight shift, radians. */
export const SHIFT_MAX = 0.05;

/** Period of the full glance cycle, seconds. */
export const GLANCE_PERIOD = 11;
/** How long one glance lasts within the cycle, seconds. */
export const GLANCE_DURATION = 2.6;
/** Peak head turn during a glance, radians. Well under the attention clamp. */
export const GLANCE_MAX = 0.45;

/** Smoothstep ease, 0..1 in, 0..1 out with zero slope at both ends. */
function ease(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/**
 * Lateral lean for one leg during idle, radians. The other leg gets the
 * negation, so the figure rocks its weight from foot to foot. Bounded by
 * SHIFT_MAX and continuous in time.
 */
export function weightShift(time, seed = 0) {
  if (!Number.isFinite(time)) return 0;
  const phase = ((time + seed * 2.3) / SHIFT_PERIOD) * Math.PI * 2;
  return Math.sin(phase) * SHIFT_MAX;
}

/**
 * Head yaw for an occasional glance around the plaza, radians. Zero for most
 * of the cycle; during the glance window it eases out to +/-GLANCE_MAX and
 * back, with the direction alternating per cycle so the character does not
 * always look the same way.
 */
export function glanceAngle(time, seed = 0) {
  if (!Number.isFinite(time)) return 0;
  const shifted = time + seed * 3.1;
  const cycle = Math.floor(shifted / GLANCE_PERIOD);
  const within = shifted - cycle * GLANCE_PERIOD;
  if (within >= GLANCE_DURATION) return 0;
  const progress = within / GLANCE_DURATION;
  // Out for the first half, back for the second, smooth at every join.
  const shape = progress < 0.5 ? ease(progress * 2) : ease((1 - progress) * 2);
  const direction = cycle % 2 === 0 ? 1 : -1;
  return shape * GLANCE_MAX * direction;
}
