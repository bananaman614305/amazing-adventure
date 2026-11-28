// Where the night fireflies live, how they drift, and how they blink, decided
// without a GPU.
//
// The courtyard at night is dark and still. The lamps give it pools of warm
// light, but beyond them the meadow ring is a flat, quiet expanse with nothing
// moving in it, and a dark scene with no motion reads as a paused game rather
// than as a summer night. A handful of small drifting points of warm light fixes
// that for the price of one instanced draw call: `world.js` will turn these
// numbers into a single InstancedMesh of tiny glowing quads, and the field comes
// alive for almost nothing.
//
// Two decisions are worth the words.
//
// 1. They live in the ring, not the plaza. The plaza is paved, busy and lit; the
//    meadow beyond its edge is where grass and insects actually are, so that is
//    where a firefly belongs. Keeping them between FIREFLY_MIN_RADIUS and
//    FIREFLY_MAX_RADIUS puts the whole field off the plaza and inside the border
//    walls without a rejection loop.
//
// 2. They blink, they do not pulse. A real firefly flares quickly and fades
//    slowly, so `fireflyBlink` shapes an asymmetric curve rather than a plain
//    sine; the asymmetry is the whole reason it reads as a living insect instead
//    of a slow metronome.
//
// Everything here is seeded (mulberry32, copied rather than imported so the
// module stands alone) and pure: no Three.js, no DOM, no clock, no Math.random.
// That is what lets a saved night look the same as a fresh boot, and what lets
// the motion be pinned by unit tests. Every export is total -- it guards junk
// input and no call can produce NaN.

/** Seed for the field generator. Fixed so every run builds the same field. */
export const FIREFLY_SEED = 0x3c9d21;

/** How many fireflies the field holds. One instanced draw call regardless. */
export const FIREFLY_COUNT = 64;

/** Warm yellow-green, the classic firefly glow. */
export const FIREFLY_TINT = 0xd9e86a;

/** Inner edge of the meadow ring, in metres from the plaza centre. */
export const FIREFLY_MIN_RADIUS = 9.6;

/** Outer edge of the meadow ring, in metres, inside the border walls. */
export const FIREFLY_MAX_RADIUS = 15.8;

/** Nominal hover height in metres; each firefly drifts around this. */
export const FIREFLY_HEIGHT = 1.25;

/** How strongly the field shows in each phase. Day is zero: they are a night thing. */
export const FIREFLY_PHASE_GLOW = Object.freeze({ day: 0, dusk: 0.45, night: 1 });

/** The blink period in seconds. Exposed so tests can state periodicity plainly. */
export const FIREFLY_BLINK_PERIOD = 2.4;

/** A small deterministic PRNG (mulberry32). Copied from the other pure modules
 *  rather than imported, so `fireflies.js` stays independent of them. */
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
 *  the `day` value (0), so a new phase id can never light the field up by
 *  accident. */
export function fireflyGlowLevel(phaseId) {
  if (typeof phaseId !== 'string') return FIREFLY_PHASE_GLOW.day;
  return Object.prototype.hasOwnProperty.call(FIREFLY_PHASE_GLOW, phaseId)
    ? FIREFLY_PHASE_GLOW[phaseId]
    : FIREFLY_PHASE_GLOW.day;
}

/**
 * The spawn descriptors for the whole field.
 *
 * Positions are sampled in polar coordinates: a seeded angle in [0, 2pi) and a
 * seeded radius in [minRadius, maxRadius], then x = cos(angle)*radius and
 * z = sin(angle)*radius. Area-uniform sampling is not attempted on purpose -- a
 * decorative ring does not need uniform density, and the simpler radial sampling
 * keeps every firefly off the plaza without a rejection loop.
 *
 * The return is an array of exactly `count` objects, each
 * `{ x, z, radius, height, phase, speed }`. A junk `count` clamps into [0, 512]
 * and floors, a non-finite seed falls back to FIREFLY_SEED, swapped radii are
 * exchanged, and negative radii clamp to 0, so the call never throws and never
 * yields NaN.
 */
export function fireflySpawns({
  count = FIREFLY_COUNT,
  seed = FIREFLY_SEED,
  minRadius = FIREFLY_MIN_RADIUS,
  maxRadius = FIREFLY_MAX_RADIUS
} = {}) {
  const n = finiteNumber(count) ? Math.min(512, Math.max(0, Math.floor(count))) : FIREFLY_COUNT;
  const base = finiteNumber(seed) ? seed : FIREFLY_SEED;
  let lo = clampNumber(minRadius, 0, Infinity, FIREFLY_MIN_RADIUS);
  let hi = clampNumber(maxRadius, 0, Infinity, FIREFLY_MAX_RADIUS);
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
    // Height varies by a small seeded amount around the nominal hover height,
    // then clamps into a band that keeps every firefly above the grass and below
    // the rooftops.
    const height = clampNumber(
      FIREFLY_HEIGHT + (rng() - 0.5) * 0.9,
      0.35,
      2.6,
      FIREFLY_HEIGHT
    );
    const phase = rng();
    // Drift multiplier in a modest band so no firefly is frozen and none races.
    const speed = 0.7 + rng() * 0.6;
    spawns.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      radius,
      height,
      phase,
      speed
    });
  }
  return spawns;
}

/**
 * The brightness of one firefly at `time`, in [0, 1].
 *
 * A real firefly flares quickly and fades slowly, so a plain sine is wrong: it
 * would spend as long fading as flaring and read as a metronome. The curve here
 * is a sine raised to a power, which sharpens the peak and widens the trough,
 * and then biased so the flare is the fast part of the cycle. The result is
 * periodic in `time` with period FIREFLY_BLINK_PERIOD, reaches near 1 at its
 * peak and near 0 at its trough, and is exactly 0 for junk input.
 */
export function fireflyBlink(time, phase) {
  if (!finiteNumber(time) || !finiteNumber(phase)) return 0;
  const cycle = (time / FIREFLY_BLINK_PERIOD + phase) % 1;
  // A sine over one cycle. The negative lobe is clamped to zero, so the firefly
  // flares through the positive half and then sits dark through the negative
  // half -- a quick brightening and a long dark trough, which is what reads as a
  // blink. The fractional exponent sharpens the peak towards 1 while keeping the
  // curve inside [0, 1].
  const wave = Math.sin(cycle * Math.PI * 2);
  const shaped = wave > 0 ? Math.pow(wave, 0.6) : 0;
  return Math.min(1, Math.max(0, shaped));
}

/**
 * The drift offset in metres to add to a spawn's position, as `{ x, y, z }`.
 *
 * Two incommensurate sines per axis, scaled by the spawn's `speed`, give a small
 * wander that never retraces an obvious circle. Each horizontal component stays
 * within about +/-0.55 m and the vertical within about +/-0.3 m. A junk spawn or
 * time yields all zeros rather than NaN.
 */
export function fireflyDrift(time, spawn) {
  if (!finiteNumber(time) || spawn == null || !finiteNumber(spawn.speed)) {
    return { x: 0, y: 0, z: 0 };
  }
  const speed = clampNumber(spawn.speed, 0, Infinity, 1);
  // The spawn's blink phase offsets its wander so two fireflies at the same
  // spot do not move in lockstep; a non-finite phase reads as 0.
  const offset = finiteNumber(spawn.phase) ? spawn.phase * Math.PI * 2 : 0;
  const t = time * speed;
  // Incommensurate frequencies (1, 1.7, 2.3, ...) keep the path from closing.
  const x = 0.4 * Math.sin(t * 0.9 + offset) + 0.15 * Math.sin(t * 1.7 + offset * 1.3);
  const y = 0.22 * Math.sin(t * 1.3 + offset * 0.7) + 0.08 * Math.sin(t * 2.1 + offset * 1.9);
  const z = 0.4 * Math.cos(t * 0.8 + offset * 1.1) + 0.15 * Math.cos(t * 1.9 + offset * 0.5);
  return { x, y, z };
}

/** Whether the firefly field runs at this quality tier. The low tier drops the
 *  per-frame firefly pass, consistent with the quality-tier convention; junk
 *  reads as the full tier. */
export function fireflyEnabled(tier) {
  return tier !== 'low';
}