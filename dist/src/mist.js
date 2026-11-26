// Where the low ground mist lies over the meadow ring, how big and how faint
// each patch is, and how it wanders, decided without a GPU.
//
// The plaza is a walled square with a paved disc at its centre; past the paving
// there is grass, trees and props. A lawn read straight off reads as a flat
// painted plane with nothing between the near ground and the wall behind it. A
// handful of very large, very faint horizontal quads lying just above the grass,
// drifting slowly, put a soft ground haze into the middle distance and separate
// the two, so the eye reads depth in the meadow instead of one even surface.
// `world.js` turns these numbers into a single InstancedMesh of those quads (with
// a soft radial alpha texture it builds itself), so this module owns position,
// size, opacity and drift only -- the whole effect is one instanced draw call.
//
// Four decisions are worth the words.
//
// 1. The patches live in a ring, not over the plaza. The paving has a 9 m radius
//    and mist lying over stone reads as a smear, so MIST_MIN_RADIUS keeps every
//    spawn out on the grass; MIST_MAX_RADIUS stops short of the wall's inner
//    face at about 16.5 m, so a patch never pushes through it.
//
// 2. The radius is drawn area-uniform, not length-uniform. Drawing the radius
//    straight from [lo, hi] crams the patches towards the inner edge, because a
//    thin band of radius near lo covers less ground than the same band near hi.
//    Taking the radius as sqrt(lo^2 + rand*(hi^2 - lo^2)) spreads them evenly by
//    area, so the meadow reads as an even haze rather than a collar of fog piled
//    at the paving edge. One consequence is worth pinning: under this sampler the
//    outer half of the ring holds the majority of the patches, and a unit test
//    states exactly that.
//
// 3. They are faint, and faintest at noon. Mist against a bright midday sky is
//    nearly invisible, so MIST_MAX_OPACITY is deliberately small and the per-phase
//    table MIST_PHASE_OPACITY peaks at dusk, when the light rakes low and catches
//    the haze; day keeps a third of that, and night keeps more than day because a
//    lit wall behind mist shows it off. The world multiplies these in.
//
// 4. They wander, but never far. Each patch sits at its spawn plus a bounded
//    two-sine wander on each horizontal axis (weighted 0.8 and 0.2, so the total
//    is exactly bounded) and a slow single-sine bob, all scaled by the patch's own
//    speed. Incommensurate frequencies keep the path from visibly closing, and
//    because every term is a sine in [-1, 1] the wander can never carry a patch
//    further than MIST_DRIFT horizontally or MIST_BOB vertically from its spawn --
//    for every time, however large or negative. The mist stays where it was put.
//
// Everything here is seeded (mulberry32, copied rather than imported so the module
// stands alone) and pure: no Three.js, no DOM, no clock, no Math.random. Two
// identical calls produce bit-identical numbers, and every export is total -- it
// guards junk input, and no call can produce NaN or Infinity.

/** Seed for the mist field generator. Fixed so every run builds the same field. */
export const MIST_SEED = 0x2b6d94;

/** How many patches the field holds by default. One instanced draw call covers
 *  the lot, so this is a look decision rather than a cost one. */
export const MIST_COUNT = 14;

/** Upper clamp on a caller-supplied count, so no absurd argument builds a huge
 *  array of patches. */
export const MIST_MAX_COUNT = 80;

/** Innermost spawn radius in metres from the plaza centre. Just past the 9 m
 *  paving, so no patch spawns over stone. */
export const MIST_MIN_RADIUS = 10;

/** Outermost spawn radius in metres, inside the wall's inner face at about 16.5. */
export const MIST_MAX_RADIUS = 16;

/** Lowest spawn height in metres above the ground: above the grass, clear of the
 *  blades, so the quads read as haze rather than as decals. */
export const MIST_MIN_Y = 0.25;

/** Highest spawn height in metres: still low enough to hug the ground. */
export const MIST_MAX_Y = 0.9;

/** Smallest quad half-extent in metres. These are big soft patches, not puffs. */
export const MIST_MIN_SIZE = 3.5;

/** Largest quad half-extent in metres. */
export const MIST_MAX_SIZE = 7.5;

/** Faintest a patch may be; the haze must never become a visible sheet. */
export const MIST_MIN_OPACITY = 0.05;

/** Most opaque a patch may be. Anything denser reads as a painted decal. */
export const MIST_MAX_OPACITY = 0.14;

/** Peak horizontal wander in metres from the spawn, per axis. */
export const MIST_DRIFT = 1.2;

/** Peak vertical wander in metres from the spawn height. */
export const MIST_BOB = 0.12;

/** Slowest drift-speed multiplier; no patch hangs dead still. */
export const MIST_MIN_SPEED = 0.25;

/** Fastest drift-speed multiplier; no patch races across the meadow. */
export const MIST_MAX_SPEED = 0.6;

/** How strongly the haze shows in each phase. Mist is a dusk thing: the low sun
 *  catches it, day washes it out to a third, and night leaves more than daylight
 *  because a lit wall glows through it. Frozen so a caller cannot mutate the
 *  table. The `day` value is also the fallback for an unknown phase id. */
export const MIST_PHASE_OPACITY = Object.freeze({ day: 0.35, dusk: 1, night: 0.6 });

/** Largest radius a caller may ask for, in metres. The area-uniform draw squares
 *  the radii, so this keeps that square far from overflow and stops an absurd
 *  argument from making the sampler emit Infinity. */
const MAX_SANE_RADIUS = 1e6;

// Incommensurate drift frequencies: the ratios are deliberately not simple, so a
// patch's path never closes into a visible loop. x uses 0.7 and 1.3, z uses 0.9
// and 1.7, and the vertical bob is a single slow 0.5.
const DRIFT_X1 = 0.7;
const DRIFT_X2 = 1.3;
const DRIFT_Z1 = 0.9;
const DRIFT_Z2 = 1.7;
const DRIFT_Y = 0.5;

// The two horizontal sines are weighted so their sum can never exceed 1 in
// magnitude: 0.8 + 0.2 = 1, which is what makes the drift bound exact.
const DRIFT_W1 = 0.8;
const DRIFT_W2 = 0.2;

/** A small deterministic PRNG (mulberry32). Copied from the other pure modules
 *  rather than imported, so `mist.js` stays independent of them. */
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

/** A descriptor is a plain object; arrays and null are not. */
function isDescriptor(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The per-phase opacity multiplier. An unknown phase, or a non-string, falls
 *  back to the `day` value, so a phase id this module has not learned yet can
 *  never blank the haze or flare it up by accident. Only own properties count, so
 *  a name inherited from the prototype (say `constructor`) is not a phase. */
export function mistOpacity(phaseId) {
  if (typeof phaseId !== 'string') return MIST_PHASE_OPACITY.day;
  return Object.prototype.hasOwnProperty.call(MIST_PHASE_OPACITY, phaseId)
    ? MIST_PHASE_OPACITY[phaseId]
    : MIST_PHASE_OPACITY.day;
}

/**
 * The spawn descriptors for the whole mist field.
 *
 * Positions are sampled in polar coordinates: a seeded angle in [0, 2pi) and a
 * seeded radius, then x = cos(angle)*radius and z = sin(angle)*radius. The radius
 * is drawn as sqrt(lo^2 + rand*(hi^2 - lo^2)) rather than lo + rand*(hi - lo), so
 * the patches are spread evenly *by area* over the ring; a plain linear draw
 * would pile them at the inner edge because the same radial band covers less
 * ground there. Each patch also draws a seeded height in [MIST_MIN_Y, MIST_MAX_Y],
 * a half-extent in [MIST_MIN_SIZE, MIST_MAX_SIZE], an opacity in
 * [MIST_MIN_OPACITY, MIST_MAX_OPACITY], a drift-speed multiplier in
 * [MIST_MIN_SPEED, MIST_MAX_SPEED], a phase in [0, 1) that offsets its vertical
 * bob, and two wander offsets in [0, 2pi) so no two patches move in lockstep.
 *
 * The return is an array of exactly `count` objects, each
 * `{ x, y, z, size, opacity, phase, speed, driftX, driftZ }`. A non-finite count
 * falls back to MIST_COUNT, a finite one clamps into [0, MIST_MAX_COUNT] and
 * floors; a non-finite seed falls back to MIST_SEED; swapped radii are exchanged
 * and negative radii clamp to 0, so the call never throws and never yields NaN.
 * Only `count`, `seed`, `minRadius` and `maxRadius` are read from `options`; any
 * other key, and a junk options argument, are ignored.
 */
export function mistSpawns(options = {}) {
  // A null or non-object options argument must not throw before the field is
  // built, so junk collapses to the empty object and every field takes its
  // default. (A plain destructuring default only catches `undefined`.)
  const opts = isDescriptor(options) ? options : {};
  const {
    count = MIST_COUNT,
    seed = MIST_SEED,
    minRadius = MIST_MIN_RADIUS,
    maxRadius = MIST_MAX_RADIUS
  } = opts;
  const n = finiteNumber(count)
    ? Math.min(MIST_MAX_COUNT, Math.max(0, Math.floor(count)))
    : MIST_COUNT;
  const base = finiteNumber(seed) ? seed : MIST_SEED;
  let lo = clampNumber(minRadius, 0, MAX_SANE_RADIUS, MIST_MIN_RADIUS);
  let hi = clampNumber(maxRadius, 0, MAX_SANE_RADIUS, MIST_MAX_RADIUS);
  if (lo > hi) {
    const swap = lo;
    lo = hi;
    hi = swap;
  }
  // Squaring on the way in keeps the sampler cheap and, with the sane-radius
  // clamp above, keeps both squares comfortably finite even for absurd input.
  const lo2 = lo * lo;
  const hi2 = hi * hi;

  const rng = mulberry32(base >>> 0);
  const spawns = [];
  for (let i = 0; i < n; i += 1) {
    const angle = rng() * Math.PI * 2;
    // Area-uniform radius. sqrt(lo^2 + u*(hi^2 - lo^2)) is the inverse CDF of the
    // uniform distribution over the ring's area, so equal areas get equal shares
    // of the patches instead of the inner edge collecting them.
    const radius = Math.sqrt(lo2 + rng() * (hi2 - lo2));
    const y = MIST_MIN_Y + rng() * (MIST_MAX_Y - MIST_MIN_Y);
    const size = MIST_MIN_SIZE + rng() * (MIST_MAX_SIZE - MIST_MIN_SIZE);
    const opacity = MIST_MIN_OPACITY + rng() * (MIST_MAX_OPACITY - MIST_MIN_OPACITY);
    const phase = rng();
    const speed = MIST_MIN_SPEED + rng() * (MIST_MAX_SPEED - MIST_MIN_SPEED);
    // The two wander offsets are independent draws in [0, 2pi), so even two
    // patches at the same spot and the same phase do not drift in step.
    const driftX = rng() * Math.PI * 2;
    const driftZ = rng() * Math.PI * 2;
    spawns.push({
      x: Math.cos(angle) * radius,
      y,
      z: Math.sin(angle) * radius,
      size,
      opacity,
      phase,
      speed,
      driftX,
      driftZ
    });
  }
  return spawns;
}

/**
 * One patch's position at `time`, as `{ x, y, z }`.
 *
 * The patch sits at its spawn plus a bounded two-sine wander on each horizontal
 * axis and a slower single-sine bob on the vertical, all scaled by the patch's
 * `speed`. The horizontal sines are weighted 0.8 and 0.2, so their sum can never
 * exceed 1 in magnitude and the offset is bounded by MIST_DRIFT * speed on each
 * axis; the speed is clamped into [0, 1], so the guaranteed bound is
 *
 *   |x - spawn.x| <= MIST_DRIFT,  |z - spawn.z| <= MIST_DRIFT,
 *   |y - spawn.y| <= MIST_BOB,
 *
 * for every time -- positive, negative or absurd -- and for any spawn object.
 * The frequencies are incommensurate (0.7 and 1.3 on x, 0.9 and 1.7 on z, 0.5 on
 * y) so the path never visibly closes into a loop, and sine is defined for
 * negative arguments, so a negative time is simply a point elsewhere on the same
 * path rather than something to fold or clamp away.
 *
 * A junk time reads as 0. A non-object spawn (arrays included) yields the origin.
 * Non-finite spawn fields fall back to safe values, and every sine argument is
 * checked for overflow before the trig call, so the result is always a finite
 * `{ x, y, z }`.
 */
export function mistDrift(spawn, time) {
  const t = finiteNumber(time) ? time : 0;
  if (!isDescriptor(spawn)) {
    return { x: 0, y: 0, z: 0 };
  }

  const bx = finiteNumber(spawn.x) ? spawn.x : 0;
  const by = finiteNumber(spawn.y) ? spawn.y : 0;
  const bz = finiteNumber(spawn.z) ? spawn.z : 0;
  // 1 is the largest multiplier the bound above permits, so it is also the safe
  // fallback for a missing speed; a huge or negative speed would break the bound
  // and is clamped away.
  const speed = clampNumber(spawn.speed, 0, 1, 1);
  const phaseX = finiteNumber(spawn.driftX) ? spawn.driftX : 0;
  const phaseZ = finiteNumber(spawn.driftZ) ? spawn.driftZ : 0;
  const phaseY = finiteNumber(spawn.phase) ? spawn.phase * Math.PI * 2 : 0;

  const st = t * speed;
  // Each sine argument is guarded before the trig call: an absurd time times a
  // speed can overflow to Infinity, and sin(Infinity) is NaN. The spawn's phase
  // is folded in before the check so an absurd phase cannot slip through either.
  let ax1 = st * DRIFT_X1 + phaseX;
  let ax2 = st * DRIFT_X2 + phaseX * 1.3;
  let az1 = st * DRIFT_Z1 + phaseZ;
  let az2 = st * DRIFT_Z2 + phaseZ * 0.5;
  let ay = st * DRIFT_Y + phaseY;
  if (!Number.isFinite(ax1)) ax1 = 0;
  if (!Number.isFinite(ax2)) ax2 = 0;
  if (!Number.isFinite(az1)) az1 = 0;
  if (!Number.isFinite(az2)) az2 = 0;
  if (!Number.isFinite(ay)) ay = 0;

  const x = bx + MIST_DRIFT * (DRIFT_W1 * Math.sin(ax1) + DRIFT_W2 * Math.sin(ax2));
  const y = by + MIST_BOB * Math.sin(ay);
  const z = bz + MIST_DRIFT * (DRIFT_W1 * Math.cos(az1) + DRIFT_W2 * Math.cos(az2));
  return { x, y, z };
}

/** Whether the mist field runs at this quality tier. The low tier drops the
 *  per-frame drift pass, consistent with the quality-tier convention; a junk tier
 *  reads as full. */
export function mistEnabled(tier) {
  return tier !== 'low';
}
