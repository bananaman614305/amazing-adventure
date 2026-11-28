// One wind field for the whole world.
//
// A perfectly still world reads as a diorama: the grass is a texture, the bunting
// is painted card, and the player's eye reads the scene as a model rather than a
// place. The cheapest honest fix is motion -- but not per-object animation. A
// hundred tufts each with their own sine wave would cost a hundred phases to
// store, drift out of agreement, and look like a hundred unrelated shivers. One
// shared wind field is both cheaper and more coherent: every blade and every
// pennant samples the same air, so the whole scene agrees on which way the wind
// is blowing and how hard, and a gust visibly crosses the plaza instead of
// happening everywhere at once.
//
// Everything decision-shaped is pure here so it can be unit-tested without a GPU:
// which way the air moves, how strong it is at a moment, how far a point is
// displaced, and the per-position phase that keeps a field from moving in
// lockstep. `world.js` only turns these numbers into bent blades and swung flags.
//
// The field is deterministic -- no clock, no Math.random -- so a screenshot taken
// twice looks the same and nothing in the sim can wander.

/**
 * The direction the air moves, as authored: roughly along +x with a little +z.
 *
 * Not normalised on purpose: this is the readable, art-directable form, and
 * {@link windDirection} is the unit-length one the renderer should use. Keeping
 * the authored vector unnormalised means tweaking the feel is a matter of
 * nudging two numbers rather than recomputing a length by hand.
 */
export const WIND_DIRECTION = Object.freeze([0.94, 0, 0.34]);

/**
 * The unit-length wind direction as `{x, y, z}`.
 *
 * `y` is exactly 0: the wind blows along the ground, so a blade is pushed
 * sideways and never lifted or pressed into the soil. Normalising here rather
 * than in the renderer keeps every consumer agreeing on the same vector, and a
 * degenerate authored vector falls back to +x instead of returning NaN.
 */
export function windDirection() {
  const [ax, ay, az] = WIND_DIRECTION;
  const length = Math.hypot(ax, ay, az);
  if (!Number.isFinite(length) || length < 1e-9) return { x: 1, y: 0, z: 0 };
  return { x: ax / length, y: 0, z: az / length };
}

/**
 * The steady breeze the field never drops below, as a fraction of full strength.
 *
 * Even at the quietest moment the grass leans a little: a world that is
 * perfectly still between gusts reads as paused.
 */
export const WIND_BASE = 0.35;

/**
 * The headroom the gust envelope may add on top of {@link WIND_BASE}.
 *
 * Base plus gust is exactly 1, so the total strength is bounded by [0, 1]
 * without any clamping: the authored numbers already cannot leave the range,
 * and the clamp in {@link windStrength} is only a belt-and-braces guard.
 */
export const WIND_GUST = 0.65;

/**
 * Seconds per cycle of the two slow strength waves. Incommensurate on purpose:
 * 7.3 and 11.9 share no small common multiple, so the breeze never visibly
 * repeats on a human timescale.
 */
const WIND_PERIOD_A = 7.3;
const WIND_PERIOD_B = 11.9;

/**
 * Seconds per cycle of the gust envelope. Much slower than the two waves above
 * -- roughly three times either -- because a gust is a thing that arrives and
 * leaves, not a vibration. If it moved at the breeze's rate the strength would
 * just be a faster flicker; at 23 s it swells and fades while the shorter waves
 * ripple across it.
 */
const WIND_GUST_PERIOD = 23;

/**
 * Seconds per cycle of the flutter, the fast ripple that rides on top of the
 * strength. Fast enough to read as a shiver in the flags rather than a sway, but
 * slow enough that at 60 fps it is sampled many times per cycle and never
 * aliases into a strobe.
 */
const WIND_FLUTTER_PERIOD = 2.6;

/** Metres of horizontal displacement at full strength. Small on purpose: this
 *  is a bend, not a slide, and a tuft that visibly translates looks detached
 *  from the ground it grows out of. */
const WIND_PUSH = 0.06;

/** Metres of downward dip per unit of sway. A blade bends *over* as it is
 *  pushed, so its tip drops; this is that drop, kept tiny so nothing sinks. */
const WIND_DIP = 0.02;

/** How much a world position shifts the field's phase, in radians per metre.
 *  Two incommensurate rates so the pattern does not line up along either axis. */
const WIND_PHASE_X = 0.15;
const WIND_PHASE_Z = 0.11;

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A finite number or the fallback. Every export funnels junk through here so
 *  nothing downstream can produce NaN. */
function orDefault(value, fallback) {
  return finiteNumber(value) ? value : fallback;
}

/** Smoothstep, clamped to [0, 1]: eases a ramp in and out so it never steps. */
function smoothstep(u) {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
}

/** A sine of `period`-second cycles, with `phase` in radians.
 *  A time so large that the angle overflows to Infinity -- or a non-finite
 *  input that slipped through -- has no meaningful sine, so it reads as 0
 *  rather than poisoning every downstream value with NaN. */
function wave(time, period, phase = 0) {
  const angle = (time * (Math.PI * 2)) / period + phase;
  return Number.isFinite(angle) ? Math.sin(angle) : 0;
}

/**
 * The scalar wind strength at a moment, in [0, 1].
 *
 * Two slow incommensurate sinusoids (7.3 s and 11.9 s) carry the breeze; their
 * sum is mapped from [-2, 2] to [0, 1] and eased with smoothstep, so there are
 * long soft spells of still air and long soft spells of movement instead of a
 * constant hum. A third, much slower wave (23 s) swells that result towards full
 * strength and back: the gust envelope. It is slower than the breeze because a
 * gust is a passing event, and slower than the flutter because the flutter is
 * what a gust is made of.
 *
 * The result is clamped to [0, 1] so no consumer can be handed a strength that
 * would blow a tuft out of the ground. Deterministic in `(time, offset)`.
 * Non-finite `time` reads as {@link WIND_BASE}; a non-finite `offset` reads as 0.
 */
export function windStrength(time, offset = 0) {
  const t = orDefault(time, NaN);
  if (!Number.isFinite(t)) return WIND_BASE;
  const off = orDefault(offset, 0);
  // Two breeze waves, mapped to [0, 1] and eased. Their sum is in [-2, 2].
  const a = wave(t + off, WIND_PERIOD_A);
  const b = wave(t + off, WIND_PERIOD_B, 1.3);
  const breeze = smoothstep((a + b + 2) / 4);
  // The gust envelope: one slow wave, eased so it swells and fades rather than
  // stepping, then scaled to the gust headroom and added to the steady base.
  const gust = smoothstep((wave(t + off, WIND_GUST_PERIOD, 0.7) + 1) / 2);
  const strength = WIND_BASE + WIND_GUST * gust * (0.35 + 0.65 * breeze);
  return Math.min(1, Math.max(0, strength));
}

/**
 * The signed sway at a moment, in [-1, 1]: what a renderer multiplies by a bend
 * angle.
 *
 * The sign is the direction of the shiver, the magnitude is how hard the air is
 * moving. The slow strength sets the envelope and a faster flutter (2.6 s) rides
 * on top, because a flag in a steady breeze still ripples -- the flutter is the
 * ripple, the strength is the lean. `strength` scales the whole thing and is
 * clamped to [0, 1], so a caller that fades an object in cannot ask for more
 * motion than the field allows.
 *
 * Never throws: non-finite `time` reads as 0 sway, a non-finite `offset` as 0,
 * and a non-finite `strength` as 1.
 */
export function windSway(time, offset = 0, strength = 1) {
  const t = orDefault(time, NaN);
  if (!Number.isFinite(t)) return 0;
  const off = orDefault(offset, 0);
  const amount = Math.min(1, Math.max(0, orDefault(strength, 1)));
  const envelope = windStrength(t, off);
  // Signed flutter: the fast ripple, positive and negative, scaled by how hard
  // the air is moving so a calm spell barely shivers.
  const flutter = wave(t + off, WIND_FLUTTER_PERIOD, 0.4);
  const sway = envelope * flutter;
  return Math.min(1, Math.max(-1, sway * amount));
}

/**
 * The deterministic per-position phase offset, in radians.
 *
 * A field of tufts sampled at the same phase would move as one rigid sheet,
 * which is exactly the diorama look the wind exists to avoid. Shifting the phase
 * by position -- `x * 0.15 + z * 0.11` -- means a gust crosses the plaza as a
 * wave rather than landing everywhere at once. Callers precompute this once per
 * tuft and pass it as `offset` to the other functions.
 *
 * Non-finite coordinates read as 0; the result is always finite.
 */
export function windPhase(x, z) {
  const px = orDefault(x, 0);
  const pz = orDefault(z, 0);
  const phase = px * WIND_PHASE_X + pz * WIND_PHASE_Z;
  return Number.isFinite(phase) ? phase : 0;
}

/**
 * The world-space displacement of a point on the ground, in metres, as
 * `{x, y, z}`.
 *
 * Horizontally the push is along {@link windDirection}, scaled by
 * `0.06 * windStrength(...)`, so the ground itself never slides -- only the
 * things rooted in it lean. Vertically there is a tiny negative dip proportional
 * to the sway: a blade bends *down* as it bends over, and a pennant's tip drops
 * as it swings. The dip is proportional to `|sway|` so it is always a dip, never
 * a lift.
 *
 * Position shifts the phase (see {@link windPhase}) so the field is not in
 * lockstep. Every component is clamped to a small finite range, so the function
 * never returns NaN and can never blow anything out of place, whatever it is
 * handed.
 */
export function windOffset(time, x, z, offset = 0) {
  const t = orDefault(time, NaN);
  if (!Number.isFinite(t)) return { x: 0, y: 0, z: 0 };
  const px = orDefault(x, 0);
  const pz = orDefault(z, 0);
  // The caller's offset plus the position's own phase: a per-tuft constant and
  // a where-it-grows term, added so either alone is enough to decorrelate.
  const phase = orDefault(offset, 0) + windPhase(px, pz);
  const strength = windStrength(t, phase);
  const sway = windSway(t, phase);
  const dir = windDirection();
  const push = WIND_PUSH * strength;
  const dx = dir.x * push;
  const dz = dir.z * push;
  // Always a dip: magnitude of the sway, never its sign, so the tip only falls.
  const dy = -WIND_DIP * Math.abs(sway);
  return {
    x: Number.isFinite(dx) ? dx : 0,
    y: Number.isFinite(dy) ? dy : 0,
    z: Number.isFinite(dz) ? dz : 0
  };
}