// Where the daytime bird flock lives, how it circles the plaza, and how its
// wings beat, decided without a GPU.
//
// The village sky is busy at dusk, when the lanterns and the bunting carry the
// eye, and busy at night, when the moon and stars do. In the middle of the day
// it is a flat blue dome with nothing moving in it, and a first-person camera
// that looks up finds nothing to reward the glance. A small flock of birds
// crossing overhead fixes that for the price of one instanced draw call:
// `world.js` turns these numbers into simple wing-shaped meshes, and the sky
// comes alive for almost nothing.
//
// Three decisions are worth the words.
//
// 1. They orbit, they do not wander. A bird that flies in a straight line leaves
//    the play area and has to be respawned, which needs a clock, a boundary test
//    and a stateful loop. A slow circle around the plaza centre is periodic,
//    stateless and needs nothing but `time`: the same call with the same spawn
//    always gives the same point, so the motion is trivial to test and never
//    desynchronises. The orbital radius is the spawn's own radius, so every bird
//    stays overhead and inside the border walls by construction.
//
// 2. Height is a band, not a point. The plaza walls are near |x|,|z| ~ 18-20 and
//    the camera stands at 1.6 m, so a bird at 15-23 m sits high above the roofs
//    but still comfortably inside a normal upward view. A gentle vertical bob
//    around that height keeps the flight from looking like a painted ring.
//
// 3. The wing angle is bounded, not free. The caller only needs a flap phase to
//    rotate a wing mesh, so `birdFlight` returns a `wing` angle clamped by
//    construction to +/- BIRD_WING_AMPLITUDE. The caller cannot accidentally
//    spin a wing through a full turn, and the value is finite at time 0.
//
// Everything here is seeded (mulberry32, copied rather than imported so the
// module stands alone) and pure: no Three.js, no DOM, no clock, no Math.random.
// Two identical calls produce bit-identical numbers. Every export is total --
// it guards junk input, and no call can produce NaN or Infinity.

/** Seed for the flock generator. Fixed so every run builds the same flock. */
export const BIRD_SEED = 0x5b12d4;

/** How many birds cross the sky. One instanced draw call regardless. */
export const BIRD_COUNT = 8;

/** Lowest orbit height in metres. Well above the 1.6 m camera and the roofs. */
export const BIRD_MIN_HEIGHT = 15;

/** Highest orbit height in metres. Still inside a comfortable upward glance. */
export const BIRD_MAX_HEIGHT = 23;

/** Tightest orbit radius in metres; the bird passes almost overhead. */
export const BIRD_MIN_RADIUS = 6;

/** Widest orbit radius in metres. The whole flock stays inside a 26 m circle. */
export const BIRD_MAX_RADIUS = 24;

/** Slowest angular speed in radians per second. */
export const BIRD_MIN_SPEED = 0.09;

/** Fastest angular speed in radians per second. */
export const BIRD_MAX_SPEED = 0.16;

/** Peak wing rotation in radians. The wing mesh swings within this band. */
export const BIRD_WING_AMPLITUDE = 0.5;

/** Seconds for one full flap cycle. A bird beats faster than it orbits. */
export const BIRD_FLAP_PERIOD = 0.62;

/** Peak vertical bob in metres around the orbit height. */
export const BIRD_BOB_AMPLITUDE = 0.7;

/** Seconds for one full vertical bob cycle. Slow, so it reads as air, not a hop. */
export const BIRD_BOB_PERIOD = 6;

/** How strongly the flock shows in each phase. Birds are a daytime thing, so
 *  night is zero and dusk fades them halfway out. Frozen so the table cannot be
 *  mutated by a caller. */
export const BIRD_PHASE_GLOW = Object.freeze({ day: 1, dusk: 0.5, night: 0 });

/** A small deterministic PRNG (mulberry32). Copied from the other pure modules
 *  rather than imported, so `birds.js` stays independent of them. */
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

/** The per-phase visibility multiplier. Unknown phase, or a non-string, falls
 *  back to the `day` value (1), because a flock that vanishes on a phase id the
 *  code has not learned yet would be worse than one that lingers a little too
 *  long. */
export function birdGlowLevel(phaseId) {
  if (typeof phaseId !== 'string') return BIRD_PHASE_GLOW.day;
  return Object.prototype.hasOwnProperty.call(BIRD_PHASE_GLOW, phaseId)
    ? BIRD_PHASE_GLOW[phaseId]
    : BIRD_PHASE_GLOW.day;
}

/**
 * The spawn descriptors for the whole flock.
 *
 * Each bird is placed on its own orbit: a seeded heading in [0, 2pi), a seeded
 * radius in [minRadius, maxRadius], a seeded height in
 * [BIRD_MIN_HEIGHT, BIRD_MAX_HEIGHT], a seeded angular speed and a seeded phase
 * that offsets both the flap and the bob. The reported `x`/`z` are the position
 * on that orbit at heading, which is exactly where `birdFlight` puts the bird at
 * time 0, so spawning and flying agree without a special case.
 *
 * The return is an array of exactly `count` objects, each
 * `{ x, z, height, speed, phase, radius, heading }`. A junk `count` clamps into
 * [0, 512] and floors, a non-finite seed falls back to BIRD_SEED, swapped radii
 * are exchanged, negative radii clamp to 0, and the radius is capped at a
 * million metres so no absurd argument can overflow later arithmetic. The call
 * never throws and never yields NaN.
 */
export function birdFlock({
  count = BIRD_COUNT,
  seed = BIRD_SEED,
  minRadius = BIRD_MIN_RADIUS,
  maxRadius = BIRD_MAX_RADIUS
} = {}) {
  const n = finiteNumber(count) ? Math.min(512, Math.max(0, Math.floor(count))) : BIRD_COUNT;
  const base = finiteNumber(seed) ? seed : BIRD_SEED;
  let lo = clampNumber(minRadius, 0, 1e6, BIRD_MIN_RADIUS);
  let hi = clampNumber(maxRadius, 0, 1e6, BIRD_MAX_RADIUS);
  if (lo > hi) {
    const swap = lo;
    lo = hi;
    hi = swap;
  }

  const rng = mulberry32(base >>> 0);
  const spawns = [];
  for (let i = 0; i < n; i += 1) {
    const heading = rng() * Math.PI * 2;
    const radius = lo + rng() * (hi - lo);
    const height = BIRD_MIN_HEIGHT + rng() * (BIRD_MAX_HEIGHT - BIRD_MIN_HEIGHT);
    const speed = BIRD_MIN_SPEED + rng() * (BIRD_MAX_SPEED - BIRD_MIN_SPEED);
    const phase = rng();
    spawns.push({
      x: Math.cos(heading) * radius,
      z: Math.sin(heading) * radius,
      height,
      speed,
      phase,
      radius,
      heading
    });
  }
  return spawns;
}

/**
 * One bird's position and wing angle at `time`, as `{ x, y, z, wing }`.
 *
 * The bird sits on the circle of its spawn radius, at angle
 * `heading + speed * time`, so the path is periodic and stateless. Its height is
 * the spawn height plus a slow sine bob, and its wing is a sine within
 * +/- BIRD_WING_AMPLITUDE. A non-finite time reads as 0, and a missing or junk
 * spawn returns the origin with a level wing rather than NaN. Any arithmetic
 * that would overflow (an absurd time multiplied by a speed) is detected and the
 * angle falls back to 0, which keeps every returned number finite.
 */
export function birdFlight(time, spawn) {
  const t = finiteNumber(time) ? time : 0;
  if (spawn == null || typeof spawn !== 'object' || Array.isArray(spawn)) {
    return { x: 0, y: 0, z: 0, wing: 0 };
  }

  const radius = clampNumber(spawn.radius, 0, 1e6, 0);
  const height = clampNumber(spawn.height, 0, 1e6, 0);
  const speed = finiteNumber(spawn.speed) ? spawn.speed : 0;
  const heading = finiteNumber(spawn.heading) ? spawn.heading : 0;
  const phase = finiteNumber(spawn.phase) ? spawn.phase : 0;

  let angle = heading + speed * t;
  if (!Number.isFinite(angle)) angle = 0;
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;

  // Both sines take their argument from time, so the same overflow guard applies
  // to each before the trig call.
  let bobArg = (t / BIRD_BOB_PERIOD) * Math.PI * 2 + phase * Math.PI * 2;
  if (!Number.isFinite(bobArg)) bobArg = 0;
  const y = height + BIRD_BOB_AMPLITUDE * Math.sin(bobArg);

  let wingArg = (t / BIRD_FLAP_PERIOD) * Math.PI * 2 + phase * Math.PI * 2;
  if (!Number.isFinite(wingArg)) wingArg = 0;
  const wing = BIRD_WING_AMPLITUDE * Math.sin(wingArg);

  return { x, y, z, wing };
}

/**
 * The yaw a bird's body should face at `time`, in radians.
 *
 * `birdFlight` returns where a bird is, not which way it is pointing, and a
 * bird-shaped mesh that does not turn along its orbit reads as a paper dart
 * sliding sideways. The heading is the tangent of the circle: the derivative of
 * (cos a, sin a) is (-sin a, cos a), so the yaw is atan2(tangentX, tangentZ) in
 * the same convention `world.js` uses for its other yaw-driven meshes (local +z
 * forward). This stays in the module so the orbit maths is written once; a
 * caller that recomputed the angle itself could drift out of step with
 * `birdFlight` the moment either changed.
 *
 * Junk spawn returns 0 (the origin heading), and an angle that would overflow
 * falls back to 0, so the result is always finite.
 */
export function birdHeading(time, spawn) {
  const t = finiteNumber(time) ? time : 0;
  if (spawn == null || typeof spawn !== 'object' || Array.isArray(spawn)) return 0;
  const speed = finiteNumber(spawn.speed) ? spawn.speed : 0;
  const heading = finiteNumber(spawn.heading) ? spawn.heading : 0;
  let angle = heading + speed * t;
  if (!Number.isFinite(angle)) angle = 0;
  // Local +z forward, so yaw = atan2(x, z) of the tangent. The radius cancels,
  // which is why a bird on a tight orbit still faces along its path.
  return Math.atan2(-Math.sin(angle), Math.cos(angle));
}

/** Whether the flock runs at this quality tier. The low tier drops the per-frame
 *  bird pass, consistent with the quality-tier convention; junk reads as the
 *  full tier. */
export function birdsEnabled(tier) {
  return tier !== 'low';
}
