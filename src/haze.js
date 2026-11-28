// Where the higher, larger, fainter mid-level atmospheric haze hangs above the
// ground mist, decided without a GPU.
//
// The ground mist (mist.js) hugs the grass in a ring around the paving. On its
// own the meadow still reads as a single flat plane once the eye travels past
// the near ground: there is nothing in the middle distance to separate the
// near grass from the wall behind it. A second layer -- higher, larger, and far
// fainter -- sitting as a soft disc of quads above the mist, puts depth into
// that middle distance without ever becoming a visible sheet. It is the same
// idea as the ground mist but tuned for altitude rather than proximity: full
// disc instead of a ring, because the haze is not avoiding the paving (it is
// well above it), bigger patches because they are further away, and a fraction
// of the opacity because anything denser would read as fog rather than haze.
// `world.js` turns these numbers into one InstancedMesh of those quads, so
// this module owns position, size, opacity and drift only.
//
// Four decisions are worth the words.
//
// 1. It is a full disc, not a ring. The ground mist stays off the paving and
//    inside the wall; the haze sits at 1.2-4.0 m above the ground, clear of
//    both, so it can cover the whole plaza footprint out to HAZE_MAX_RADIUS.
//    Sampling the radius as HAZE_MAX_RADIUS*sqrt(rand) (area-uniform over the
//    disc) keeps the patches spread evenly by area instead of piling them at
//    the centre, which is what a plain linear radius draw would do.
//
// 2. It is faint, and faintest at noon. HAZE_MAX_OPACITY is a small fraction
//    of the ground mist's, and the per-phase table HAZE_PHASE_OPACITY peaks at
//    dusk (0.85), keeps a quarter at day, and half at night -- the same dusk-
//    forward shape as the mist, scaled down, so the two layers read as one
//    weather system rather than two competing ones.
//
// 3. The patches are large and slow. HAZE_MIN_SIZE..HAZE_MAX_SIZE and the
//    HAZE_MIN_SPEED..HAZE_MAX_SPEED band are both shifted up relative to the
//    mist, so a haze patch drifts across a big soft area at a crawl and never
//    races. The wander bound HAZE_DRIFT is wider than the mist's for the same
//    reason: a higher layer can move further without breaking the illusion.
//
// 4. They wander, but never far. Each patch sits at its spawn plus a bounded
//    two-sine wander on each horizontal axis (weighted 0.8 and 0.2, so the
//    total is exactly bounded) and a slow single-sine bob, all scaled by the
//    patch's own speed. Incommensurate frequencies keep the path from visibly
//    closing, and because every term is a sine in [-1, 1] the wander can never
//    carry a patch further than HAZE_DRIFT horizontally or HAZE_BOB vertically
//    from its spawn -- for every time, however large or negative. The haze stays
//    where it was put.
//
// Everything here is seeded (mulberry32, copied rather than imported so the
// module stands alone) and pure: no Three.js, no DOM, no clock, no
// Math.random. Two identical calls produce bit-identical numbers, and every
// export is total -- it guards junk input, and no call can produce NaN or
// Infinity.

/** Seed for the haze field generator. Fixed so every run builds the same field. */
export const HAZE_SEED = 0x3c8e1f;

/** How many patches the field holds by default. */
export const HAZE_COUNT = 18;

/** Upper clamp on a caller-supplied count, so no absurd argument builds a huge
 *  array of patches. */
export const HAZE_MAX_COUNT = 96;

/** Outer radius in metres of the haze disc: the full footprint, since the haze
 *  sits well above the paving and the wall. */
export const HAZE_MAX_RADIUS = 18;

/** Lowest spawn height in metres above the ground: above the ground mist, clear
 *  of the grass, so the quads read as mid-level haze rather than ground fog. */
export const HAZE_MIN_Y = 1.2;

/** Highest spawn height in metres: still low enough to read as atmosphere
 *  rather than cloud. */
export const HAZE_MAX_Y = 4.0;

/** Smallest quad half-extent in metres. These are big soft patches. */
export const HAZE_MIN_SIZE = 6.0;

/** Largest quad half-extent in metres. */
export const HAZE_MAX_SIZE = 14.0;

/** Faintest a patch may be; the haze must never become a visible sheet. */
export const HAZE_MIN_OPACITY = 0.02;

/** Most opaque a patch may be. Anything denser reads as fog, not haze. */
export const HAZE_MAX_OPACITY = 0.06;

/** Peak horizontal wander in metres from the spawn, per axis. */
export const HAZE_DRIFT = 2.5;

/** Peak vertical wander in metres from the spawn height. */
export const HAZE_BOB = 0.3;

/** Slowest drift-speed multiplier; no patch hangs dead still. */
export const HAZE_MIN_SPEED = 0.1;

/** Fastest drift-speed multiplier; no patch races across the sky. */
export const HAZE_MAX_SPEED = 0.35;

/** How strongly the haze shows in each phase. Dusk-forward, scaled down from
 *  the ground mist so the two layers read as one weather system. Frozen so a
 *  caller cannot mutate the table. The `day` value is also the fallback for an
 *  unknown phase id. */
export const HAZE_PHASE_OPACITY = Object.freeze({ day: 0.25, dusk: 0.85, night: 0.5 });

/** Largest radius a caller may ask for, in metres. The area-uniform draw squares
 *  the radius, so this keeps that square far from overflow and stops an absurd
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
 *  rather than imported, so `haze.js` stays independent of them. */
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
export function hazeOpacity(phaseId) {
  if (typeof phaseId !== 'string') return HAZE_PHASE_OPACITY.day;
  return Object.prototype.hasOwnProperty.call(HAZE_PHASE_OPACITY, phaseId)
    ? HAZE_PHASE_OPACITY[phaseId]
    : HAZE_PHASE_OPACITY.day;
}

/**
 * The spawn descriptors for the whole haze field.
 *
 * Positions are sampled in polar coordinates over a full disc: a seeded angle in
 * [0, 2pi) and a seeded radius drawn as HAZE_MAX_RADIUS*sqrt(rand), which is the
 * inverse CDF of the uniform distribution over the disc's area, so the patches
 * spread evenly by area instead of piling at the centre. Each patch also draws a
 * seeded height in [HAZE_MIN_Y, HAZE_MAX_Y], a half-extent in
 * [HAZE_MIN_SIZE, HAZE_MAX_SIZE], an opacity in [HAZE_MIN_OPACITY,
 * HAZE_MAX_OPACITY], a drift-speed multiplier in [HAZE_MIN_SPEED,
 * HAZE_MAX_SPEED], a phase in [0, 1) that offsets its vertical bob, and two
 * wander offsets in [0, 2pi) so no two patches move in lockstep.
 *
 * The return is an array of exactly `count` objects, each
 * `{ x, y, z, size, opacity, phase, speed, driftX, driftZ }`. A non-finite count
 * falls back to HAZE_COUNT, a finite one clamps into [0, HAZE_MAX_COUNT] and
 * floors; a non-finite seed falls back to HAZE_SEED; a non-finite or out-of-range
 * maxRadius clamps into [0, 1e6] with HAZE_MAX_RADIUS as the fallback, so the
 * call never throws and never yields NaN. Only `count`, `seed` and `maxRadius`
 * are read from `options`; any other key, and a junk options argument, are
 * ignored.
 */
export function hazeSpawns(options = {}) {
  const opts = isDescriptor(options) ? options : {};
  const {
    count = HAZE_COUNT,
    seed = HAZE_SEED,
    maxRadius = HAZE_MAX_RADIUS
  } = opts;
  const n = finiteNumber(count)
    ? Math.min(HAZE_MAX_COUNT, Math.max(0, Math.floor(count)))
    : HAZE_COUNT;
  const base = finiteNumber(seed) ? seed : HAZE_SEED;
  const radius = clampNumber(maxRadius, 0, MAX_SANE_RADIUS, HAZE_MAX_RADIUS);

  const rng = mulberry32(base >>> 0);
  const spawns = [];
  for (let i = 0; i < n; i += 1) {
    const angle = rng() * Math.PI * 2;
    // Area-uniform radius over the full disc: r = R*sqrt(u) is the inverse CDF
    // of the uniform distribution over the disc's area, so equal areas get equal
    // shares of the patches instead of the centre collecting them.
    const r = radius * Math.sqrt(rng());
    const y = HAZE_MIN_Y + rng() * (HAZE_MAX_Y - HAZE_MIN_Y);
    const size = HAZE_MIN_SIZE + rng() * (HAZE_MAX_SIZE - HAZE_MIN_SIZE);
    const opacity = HAZE_MIN_OPACITY + rng() * (HAZE_MAX_OPACITY - HAZE_MIN_OPACITY);
    const phase = rng();
    const speed = HAZE_MIN_SPEED + rng() * (HAZE_MAX_SPEED - HAZE_MIN_SPEED);
    const driftX = rng() * Math.PI * 2;
    const driftZ = rng() * Math.PI * 2;
    spawns.push({
      x: Math.cos(angle) * r,
      y,
      z: Math.sin(angle) * r,
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
 * exceed 1 in magnitude and the offset is bounded by HAZE_DRIFT * speed on each
 * axis; the speed is clamped into [0, 1], so the guaranteed bound is
 *
 *   |x - spawn.x| <= HAZE_DRIFT,  |z - spawn.z| <= HAZE_DRIFT,
 *   |y - spawn.y| <= HAZE_BOB,
 *
 * for every time -- positive, negative or absurd -- and for any spawn object.
 * The frequencies are incommensurate (0.7 and 1.3 on x, 0.9 and 1.7 on z, 0.5 on
 * y) so the path never visibly closes into a loop, and sine is defined for
 * negative arguments, so a negative time is simply a point elsewhere on the same
 * path rather than something to fold or clamp away.
 *
 * A junk time reads as 0. A non-object spawn (arrays included) yields the
 * origin. Non-finite spawn fields fall back to safe values, and every sine
 * argument is checked for overflow before the trig call, so the result is always
 * a finite `{ x, y, z }`.
 */
export function hazeDrift(spawn, time) {
  const t = finiteNumber(time) ? time : 0;
  if (!isDescriptor(spawn)) {
    return { x: 0, y: 0, z: 0 };
  }

  const bx = finiteNumber(spawn.x) ? spawn.x : 0;
  const by = finiteNumber(spawn.y) ? spawn.y : 0;
  const bz = finiteNumber(spawn.z) ? spawn.z : 0;
  const speed = clampNumber(spawn.speed, 0, 1, 1);
  const phaseX = finiteNumber(spawn.driftX) ? spawn.driftX : 0;
  const phaseZ = finiteNumber(spawn.driftZ) ? spawn.driftZ : 0;
  const phaseY = finiteNumber(spawn.phase) ? spawn.phase * Math.PI * 2 : 0;

  const st = t * speed;
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

  const x = bx + HAZE_DRIFT * (DRIFT_W1 * Math.sin(ax1) + DRIFT_W2 * Math.sin(ax2));
  const y = by + HAZE_BOB * Math.sin(ay);
  const z = bz + HAZE_DRIFT * (DRIFT_W1 * Math.cos(az1) + DRIFT_W2 * Math.cos(az2));
  return { x, y, z };
}

/** Whether the haze field runs at this quality tier. The low tier drops the
 *  per-frame drift pass, consistent with the quality-tier convention; a junk tier
 *  reads as full. */
export function hazeEnabled(tier) {
  return tier !== 'low';
}