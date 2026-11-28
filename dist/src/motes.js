// Where the sunlit dust motes live, how they hang in the daylight air, and how
// each one drifts, decided without a GPU.
//
// A first-person courtyard in full daylight is bright and still, and a bright
// empty volume reads as a vacuum rather than as air. Real sunlit air is full of
// tiny motes catching the light, and a few dozen of them drifting lazily over
// the plaza and meadow sell the sense of volume for the price of one instanced
// draw call: `world.js` turns these numbers into a single InstancedMesh of tiny
// additive specks, and the daylight comes alive for almost nothing.
//
// Three decisions are worth the words.
//
// 1. They are a day thing, and only a day thing. The same field at night would
//    read as a swarm of bugs, so MOTE_PHASE_GLOW drives the field to exactly 0
//    after dusk and lets the world hide the mesh outright rather than dim a
//    barely-visible speck. Dusk keeps a third of the glow so the field fades out
//    with the light instead of snapping off.
//
// 2. They hang over both plaza and meadow. The paved plaza disc is r9 and the
//    border wall sits near r17, so a mote field between MOTE_MIN_RADIUS and
//    MOTE_MAX_RADIUS (0..15) covers the open plaza and the meadow ring beyond it
//    in one seeded scatter, with no rejection loop and nothing placed past the
//    wall.
//
// 3. They wander on a bounded, non-repeating path. Each mote's position is its
//    spawn plus two incommensurate sines per horizontal axis (and a slower
//    vertical bob), scaled by the mote's own speed. Incommensurate frequencies
//    keep the path from closing into a visible circle, and because every term is
//    a bounded sine the wander can never carry a mote further than a fixed
//    distance from where it spawned -- the field stays put no matter how long the
//    clock runs.
//
// Everything here is seeded (mulberry32, copied rather than imported so the
// module stands alone) and pure: no Three.js, no DOM, no clock, no Math.random.
// Two identical calls produce bit-identical numbers, and every export is total --
// it guards junk input, and no call can produce NaN or Infinity.

/** Seed for the mote field generator. Fixed so every run builds the same field. */
export const MOTE_SEED = 0x4d2b81;

/** How many motes the field holds by default. One instanced draw call regardless. */
export const MOTE_COUNT = 90;

/** Upper clamp on the requested count, so no absurd argument builds a huge array. */
export const MOTE_MAX_COUNT = 400;

/** Innermost spawn radius in metres from the plaza centre (0 = over the plaza). */
export const MOTE_MIN_RADIUS = 0;

/** Outermost spawn radius in metres, over the meadow but inside the r17 wall. */
export const MOTE_MAX_RADIUS = 15;

/** Lowest spawn height in metres above the ground, clear of the paving. */
export const MOTE_MIN_HEIGHT = 0.4;

/** Highest spawn height in metres, below the roofs and the first-floor windows. */
export const MOTE_MAX_HEIGHT = 5.5;

/** Peak horizontal wander in metres from the spawn, per axis. */
export const MOTE_DRIFT = 0.55;

/** Peak vertical wander in metres from the spawn height. */
export const MOTE_BOB = 0.3;

/** Smallest mote speck, in the world's size unit. */
export const MOTE_MIN_SIZE = 0.02;

/** Largest mote speck; nearer motes read bigger so the field has depth. */
export const MOTE_MAX_SIZE = 0.06;

/** Slowest drift-speed multiplier; no mote hangs dead still. */
export const MOTE_MIN_SPEED = 0.6;

/** Fastest drift-speed multiplier; none races across the plaza. */
export const MOTE_MAX_SPEED = 1.4;

/** How strongly the field shows in each phase. Motes are a daylight thing, so
 *  night is exactly 0 (the world hides the mesh) and dusk fades them a third
 *  out. Frozen so the table cannot be mutated by a caller. */
export const MOTE_PHASE_GLOW = Object.freeze({ day: 1, dusk: 0.35, night: 0 });

/** A small deterministic PRNG (mulberry32). Copied from the other pure modules
 *  rather than imported, so `motes.js` stays independent of them. */
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

/** The per-phase glow multiplier. Unknown phase, or a non-string, falls back to
 *  the `day` value (1), because a field that vanished on a phase id the code has
 *  not learned yet would be worse than one that lingers a little too long. */
export function moteGlowLevel(phaseId) {
  if (typeof phaseId !== 'string') return MOTE_PHASE_GLOW.day;
  return Object.prototype.hasOwnProperty.call(MOTE_PHASE_GLOW, phaseId)
    ? MOTE_PHASE_GLOW[phaseId]
    : MOTE_PHASE_GLOW.day;
}

/**
 * The spawn descriptors for the whole field.
 *
 * Positions are sampled in polar coordinates: a seeded angle in [0, 2pi) and a
 * seeded radius in [minRadius, maxRadius], then x = cos(angle)*radius and
 * z = sin(angle)*radius. That scatters the field evenly across the plaza and the
 * meadow in one pass, with no rejection loop. Each mote also draws a seeded
 * height in [MOTE_MIN_HEIGHT, MOTE_MAX_HEIGHT], a seeded size in
 * [MOTE_MIN_SIZE, MOTE_MAX_SIZE], a seeded drift-speed multiplier, and a seeded
 * phase in [0, 1) that offsets its wander so two motes at the same spot never
 * move in lockstep.
 *
 * The return is an array of exactly `count` objects, each
 * `{ x, y, z, phase, speed, size, driftX, driftZ }`. A junk `count` clamps into
 * [0, MOTE_MAX_COUNT] and floors, a non-finite seed falls back to MOTE_SEED,
 * swapped radii are exchanged, and negative radii clamp to 0, so the call never
 * throws and never yields NaN.
 */
export function moteSpawns(options = {}) {
  // A null or non-object options argument must not throw before the field is
  // built, so junk collapses to the empty object and every field takes its
  // default. (A plain destructuring default only catches `undefined`.)
  const opts = options == null || typeof options !== 'object' ? {} : options;
  const {
    count = MOTE_COUNT,
    seed = MOTE_SEED,
    minRadius = MOTE_MIN_RADIUS,
    maxRadius = MOTE_MAX_RADIUS
  } = opts;
  const n = finiteNumber(count)
    ? Math.min(MOTE_MAX_COUNT, Math.max(0, Math.floor(count)))
    : MOTE_COUNT;
  const base = finiteNumber(seed) ? seed : MOTE_SEED;
  let lo = clampNumber(minRadius, 0, Infinity, MOTE_MIN_RADIUS);
  let hi = clampNumber(maxRadius, 0, Infinity, MOTE_MAX_RADIUS);
  if (lo > hi) {
    const swap = lo;
    lo = hi;
    hi = swap;
  }

  const rng = mulberry32(base >>> 0);
  const spawns = [];
  for (let i = 0; i < n; i += 1) {
    const angle = rng() * Math.PI * 2;
    const radius = lo + rng() * (hi - lo);
    const y = MOTE_MIN_HEIGHT + rng() * (MOTE_MAX_HEIGHT - MOTE_MIN_HEIGHT);
    const size = MOTE_MIN_SIZE + rng() * (MOTE_MAX_SIZE - MOTE_MIN_SIZE);
    const phase = rng();
    const speed = MOTE_MIN_SPEED + rng() * (MOTE_MAX_SPEED - MOTE_MIN_SPEED);
    // The two horizontal wander phases are drawn from the mote's own phase so the
    // field is deterministic but each mote's x and z wander on different offsets.
    const driftX = phase * Math.PI * 2;
    const driftZ = phase * Math.PI * 2 * 1.7 + 0.9;
    spawns.push({
      x: Math.cos(angle) * radius,
      y,
      z: Math.sin(angle) * radius,
      phase,
      speed,
      size,
      driftX,
      driftZ
    });
  }
  return spawns;
}

/**
 * One mote's position at `time`, as `{ x, y, z }`.
 *
 * The mote sits at its spawn plus a bounded two-sine wander on each horizontal
 * axis and a slower single-sine bob on the vertical, all scaled by the mote's
 * `speed`. Incommensurate frequencies (1.0, 1.7 on x; 0.8, 1.9 on z; 1.3 on y)
 * keep the path from ever visibly closing. Because every term is a sine in
 * [-1, 1], the horizontal offset from the spawn is bounded by MOTE_DRIFT on each
 * axis and the vertical offset by MOTE_BOB, no matter how large `time` grows.
 *
 * A junk time reads as 0. A junk spawn, or an arithmetic overflow from an absurd
 * time, falls back to finite numbers rather than NaN, so the result is always a
 * finite `{ x, y, z }`.
 */
export function motePosition(spawn, time) {
  const t = finiteNumber(time) ? time : 0;
  if (spawn == null || typeof spawn !== 'object' || Array.isArray(spawn)) {
    return { x: 0, y: 0, z: 0 };
  }

  const bx = finiteNumber(spawn.x) ? spawn.x : 0;
  const by = finiteNumber(spawn.y) ? spawn.y : 0;
  const bz = finiteNumber(spawn.z) ? spawn.z : 0;
  const speed = clampNumber(spawn.speed, 0, Infinity, 1);
  const phaseX = finiteNumber(spawn.driftX) ? spawn.driftX : 0;
  const phaseZ = finiteNumber(spawn.driftZ) ? spawn.driftZ : 0;
  const phaseY = finiteNumber(spawn.phase) ? spawn.phase * Math.PI * 2 : 0;

  const st = t * speed;
  // Each sine argument is guarded before the trig call: an absurd time times a
  // speed can overflow to Infinity, and sin(Infinity) is NaN.
  let ax1 = st * 1.0 + phaseX;
  let ax2 = st * 1.7 + phaseX * 1.3;
  let az1 = st * 0.8 + phaseZ;
  let az2 = st * 1.9 + phaseZ * 0.5;
  let ay = st * 1.3 + phaseY;
  if (!Number.isFinite(ax1)) ax1 = 0;
  if (!Number.isFinite(ax2)) ax2 = 0;
  if (!Number.isFinite(az1)) az1 = 0;
  if (!Number.isFinite(az2)) az2 = 0;
  if (!Number.isFinite(ay)) ay = 0;

  // 0.8 + 0.2 = MOTE_DRIFT on each horizontal axis; the vertical is a single
  // sine bounded by MOTE_BOB.
  const x = bx + MOTE_DRIFT * (0.8 * Math.sin(ax1) + 0.2 * Math.sin(ax2));
  const y = by + MOTE_BOB * Math.sin(ay);
  const z = bz + MOTE_DRIFT * (0.8 * Math.cos(az1) + 0.2 * Math.cos(az2));
  return { x, y, z };
}

/** Whether the mote field runs at this quality tier. The low tier drops the
 *  per-frame mote pass, consistent with the quality-tier convention; junk reads
 *  as the full tier. */
export function motesEnabled(tier) {
  return tier !== 'low';
}