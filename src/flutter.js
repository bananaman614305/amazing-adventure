// The motion of a hanging cloth, decided without a GPU.
//
// The market-lane bunting is a row of cones and the terrace banner is a rigid
// plane, and both read as cardboard: cloth that never moves is the visual tell
// that a scene is a model rather than a place. Real flags and pennants move all
// the time, and they move because the air around them is turbulent -- not one
// steady push but a stack of overlapping waves at unrelated rates, so the cloth
// never settles into an obvious loop.
//
// The world already has one shared wind field (src/wind.js) that every blade and
// pennant samples, so the whole scene agrees on which way the air blows and how
// hard. What the shared field cannot give a row of flags is individuality: cloth
// sampled at the same phase swings as one rigid sheet, which is the diorama look
// all over again. So each piece carries its own fixed phase offset (see
// {@link flutterPhase}), seeded rather than random, and that offset is what keeps
// a run of bunting rippling instead of pulsing in unison.
//
// The maths is bounded on purpose. Every channel is a sum of sines scaled into a
// fixed range, so no gust, no matter how the wind is driven, can spin a flag past
// its authored swing or turn it inside out -- {@link flutterMotion} can only ever
// return a yaw within {@link FLUTTER_MAX_YAW}, a roll within
// {@link FLUTTER_MAX_ROLL}, and a billow within [0, {@link FLUTTER_MAX_BILLOW}].
// The billow is shaped from a squared sine so the free edge only ever bulges away
// from the hanging plane and never pushes back through the cloth.
//
// Everything here is pure: no Three.js, no DOM, no clock, no Math.random, no
// imports. That is not only good hygiene -- it is what lets the motion be pinned
// by unit tests, so the bounds and the determinism are proved rather than eyeballed.

/**
 * Fixed seed for the per-flag phase offsets. Constant so a saved world and a
 * fresh boot hand the same flag the same offset, and so the unit tests can pin
 * the spread of a row exactly.
 */
export const FLUTTER_SEED = 0x51c7e3;

/**
 * Largest rotation about the vertical axis, in radians (~18.3 degrees). This is
 * the flag swinging side to side; kept small so a pennant flutters rather than
 * turning to face downwind and sticking there.
 */
export const FLUTTER_MAX_YAW = 0.32;

/**
 * Largest rotation about the flag's own horizontal hanging axis, in radians
 * (~6.9 degrees). This is the twist that lets a banner catch the light on a
 * different face; any more and the cloth reads as being wrung.
 */
export const FLUTTER_MAX_ROLL = 0.12;

/**
 * Largest outward bulge of the cloth's free edge, in metres. A few centimetres
 * is enough to break the flat silhouette at reading distance without the flag
 * visibly inflating like a sail.
 */
export const FLUTTER_MAX_BILLOW = 0.06;

/**
 * Per-phase multiplier on the whole flutter. The wind is calmer at night, so the
 * same gust moves the cloth less; dusk sits between the two. Day is the authored
 * reference (1), which is also why an unknown phase falls back to it.
 */
export const FLUTTER_PHASE_AMOUNT = Object.freeze({ day: 1, dusk: 0.85, night: 0.55 });

/**
 * Seconds per cycle of the yaw waves. Three incommensurate periods -- 3.1, 5.3
 * and 8.9 -- share no small common multiple, so their sum never visibly repeats
 * on a human timescale: the flag's swing wanders instead of looping. 3.1 s is the
 * readable sway, 5.3 s and 8.9 s are the slower wander that keeps the sway from
 * looking metronomic. All are slow enough that at 60 fps each is sampled many
 * times per cycle and none aliases into a strobe.
 */
const FLUTTER_YAW_PERIOD_A = 3.1;
const FLUTTER_YAW_PERIOD_B = 5.3;
const FLUTTER_YAW_PERIOD_C = 8.9;

/**
 * Seconds per cycle of the roll waves. Different periods from the yaw set (2.3,
 * 4.7, 7.9) so the twist and the swing do not rise and fall together -- cloth
 * that twisted in time with its swing would look hinged rather than limp.
 */
const FLUTTER_ROLL_PERIOD_A = 2.3;
const FLUTTER_ROLL_PERIOD_B = 4.7;
const FLUTTER_ROLL_PERIOD_C = 7.9;

/**
 * Seconds per cycle of the two billow waves. Slower than either the swing or the
 * twist (6.1 and 10.3) because the belly of the cloth is the last thing to fill
 * and the first to settle; a billow that flickered at the swing's rate would read
 * as a pulse rather than as air getting under the fabric.
 */
const FLUTTER_BILLOW_PERIOD_A = 6.1;
const FLUTTER_BILLOW_PERIOD_B = 10.3;

/** A small deterministic PRNG (mulberry32). Copied from the other pure modules
 *  rather than imported, so `flutter.js` stays independent of them. */
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6D2B79F5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Clamp to [lo, hi], with a non-finite value replaced by `fallback`. */
function clampNumber(value, lo, hi, fallback = lo) {
  if (!finiteNumber(value)) return fallback;
  return Math.min(hi, Math.max(lo, value));
}

/** A sine of `period`-second cycles at `time`, with `phase` in radians. A time
 *  so large the angle overflows to Infinity has no meaningful sine, so it reads
 *  as 0 rather than poisoning the result with NaN. */
function wave(time, period, phase = 0) {
  const angle = (time * (Math.PI * 2)) / period + phase;
  return Number.isFinite(angle) ? Math.sin(angle) : 0;
}

/** The per-phase flutter multiplier as a number. Unknown phase, or a non-string,
 *  falls back to the day value (1) so a new phase id cannot silently still the
 *  cloth. Never throws. */
export function flutterAmount(phaseId) {
  if (typeof phaseId !== 'string') return FLUTTER_PHASE_AMOUNT.day;
  return Object.prototype.hasOwnProperty.call(FLUTTER_PHASE_AMOUNT, phaseId)
    ? FLUTTER_PHASE_AMOUNT[phaseId]
    : FLUTTER_PHASE_AMOUNT.day;
}

/**
 * The deterministic phase offset in [0, 1) for the piece of cloth at `index`.
 *
 * A row of flags all starting at phase 0 swings as one sheet; giving each a
 * different offset is what makes the row ripple. The offset is drawn from a
 * mulberry32 seeded with `index` mixed into `seed`, so index 3 is the same offset
 * in every session and on every device -- the reason the function takes no clock.
 *
 * A junk `index` (NaN, non-number, object) folds to 0 rather than throwing, and a
 * junk `seed` falls back to {@link FLUTTER_SEED}. The result is always in [0, 1).
 */
export function flutterPhase(index, seed = FLUTTER_SEED) {
  const i = finiteNumber(index) ? Math.abs(Math.floor(index)) >>> 0 : 0;
  const base = finiteNumber(seed) ? seed : FLUTTER_SEED;
  // Mixing the index into the seed rather than seeding with it directly keeps
  // neighbouring indices from landing on neighbouring generator states.
  const rng = mulberry32((base ^ Math.imul(i, 0x9e3779b1)) >>> 0);
  return rng();
}

/**
 * The flutter of one piece of cloth at a moment, as `{ yaw, roll, billow }`.
 *
 * `yaw` is the side-to-side swing in radians, `roll` the twist about the hanging
 * axis, and `billow` the outward bulge of the free edge in metres. Each is a sum
 * of incommensurate sines (see the period constants) so the motion never loops
 * obviously, scaled by `strength` so still air means still cloth.
 *
 * `time` is seconds (non-finite reads as 0); `offset` is the per-piece phase in
 * [0, 1), but values outside that range are allowed and simply shift the wave --
 * it is used as a continuous phase, not wrapped or clamped, so nudging it never
 * jumps the motion; a non-finite offset reads as 0. `strength` is wind strength,
 * clamped to [0, 1] (non-finite reads as 0).
 *
 * The yaw and roll sums are each divided by their weight total, so the raw sum is
 * bounded by 1 and the result by the matching MAX; the billow is a sum of squared
 * sines (each in [0, 1]) divided by its weight total, so it is bounded by
 * [0, {@link FLUTTER_MAX_BILLOW}] and never negative -- cloth does not push
 * through itself. At `strength === 0` every channel is exactly 0, and the same
 * inputs always give bit-identical outputs.
 */
export function flutterMotion(time, offset, strength) {
  const t = finiteNumber(time) ? time : 0;
  const off = finiteNumber(offset) ? offset : 0;
  const amount = clampNumber(strength, 0, 1, 0);
  if (amount === 0) return { yaw: 0, roll: 0, billow: 0 };

  // Yaw: three signed sines, weighted so the fastest sway leads and the slower
  // two only colour it. Weights sum to 6, so the sum stays in [-1, 1].
  const yawWave = (
    3 * wave(t, FLUTTER_YAW_PERIOD_A, off) +
    2 * wave(t, FLUTTER_YAW_PERIOD_B, off * 1.7 + 1.1) +
    1 * wave(t, FLUTTER_YAW_PERIOD_C, off * 2.3 + 2.2)
  ) / 6;

  // Roll: its own three sines at unrelated periods, so the twist does not track
  // the swing. Same weight scheme, same [-1, 1] bound.
  const rollWave = (
    3 * wave(t, FLUTTER_ROLL_PERIOD_A, off * 1.3 + 0.6) +
    2 * wave(t, FLUTTER_ROLL_PERIOD_B, off * 1.9 + 1.7) +
    1 * wave(t, FLUTTER_ROLL_PERIOD_C, off * 2.7 + 2.8)
  ) / 6;

  // Billow: two squared sines, each in [0, 1], so the free edge only ever bulges
  // outward and the channel never goes negative. Weights sum to 3.
  const billowWave = (
    2 * wave(t, FLUTTER_BILLOW_PERIOD_A, off * 1.1 + 0.3) ** 2 +
    1 * wave(t, FLUTTER_BILLOW_PERIOD_B, off * 2.1 + 1.9) ** 2
  ) / 3;

  const yaw = clampNumber(yawWave * amount, -1, 1, 0) * FLUTTER_MAX_YAW;
  const roll = clampNumber(rollWave * amount, -1, 1, 0) * FLUTTER_MAX_ROLL;
  const billow = clampNumber(billowWave * amount, 0, 1, 0) * FLUTTER_MAX_BILLOW;

  return {
    yaw: Number.isFinite(yaw) ? yaw : 0,
    roll: Number.isFinite(roll) ? roll : 0,
    billow: Number.isFinite(billow) ? billow : 0
  };
}

/**
 * Whether cloth should animate at all for a quality tier. The low tier freezes
 * cloth, consistent with the rest of the game dropping per-frame work on `low`
 * (see the quality-tier convention); everything else -- including junk -- animates,
 * so a new or unknown tier never accidentally stills the scene.
 */
export function flutterEnabled(tier) {
  return tier !== 'low';
}