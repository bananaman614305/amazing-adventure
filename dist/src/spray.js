// The fountain's falling water, decided without a GPU.
//
// A jet that rises out of the basin and simply stops at its apex reads as a
// frozen sculpture. What says "fountain" from across the plaza is the curtain of
// droplets between the top of the arc and the water below: a loose sleeve of
// small bright specks that widen, accelerate and fade as they fall. `world.js`
// renders that sleeve as one InstancedMesh of tiny quads driven by these numbers;
// this module owns only the decisions, so the motion can be tested without a
// renderer and the whole effect costs a single draw call.
//
// Four choices are worth the words.
//
// 1. The arc widens as it falls. Water leaving the jet at the apex has almost no
//    outward speed; by the time it reaches the basin it has spread across the
//    surface. So the horizontal radius is not constant over a droplet's life but
//    eases from a quarter of its landing radius to the full radius, and the
//    landing radius itself is seeded between SPRAY_MIN_RADIUS and
//    SPRAY_MAX_RADIUS. Every reachable landing radius stays well inside the basin,
//    so no droplet is ever painted over the stone rim.
//
// 2. The fall accelerates. Gravity is the one honest thing here: a droplet that
//    fell at a constant rate would read as a bead on a wire. Height follows
//    1 - p^2 from the apex, which hangs at the top and speeds up towards the
//    water, and it can never leave [SPRAY_LAND, SPRAY_APEX] because p is a
//    fraction in [0, 1).
//
// 3. Each droplet fades out before it lands. A speck that vanishes at full
//    opacity pops; one that has already faded to nothing over the final
//    SPRAY_FADE_TAIL of its life disappears into the water instead. The tail is a
//    real fraction of the life rather than a single frame, because the last
//    moments of the fall are when a droplet is largest on screen.
//
// 4. Water catches the light strongest at dusk. A low, bright sky reflects off
//    falling water while midday washes it out and night gives it little to catch,
//    so SPRAY_PHASE_GLOW peaks at dusk. The day value is the fallback for any
//    phase id this module has not learned, so a new phase can never make the
//    fountain flare or go dark by accident.
//
// Everything here is seeded (mulberry32, copied rather than imported so the
// module stands alone) and pure: no Three.js, no DOM, no clock, no Math.random.
// Two identical calls produce the same numbers, and every export is total -- it
// guards junk input, and no call can produce NaN or Infinity.

/** Seed for the droplet field. Fixed so every run builds the same curtain. */
export const SPRAY_SEED = 0x51c7a3;

/** How many droplets the curtain shows by default. One instanced draw call
 *  covers them all, so this is a density decision, not a cost one. */
export const SPRAY_COUNT = 64;

/** Upper clamp on a caller-supplied count, so a junk number cannot ask for an
 *  unbounded array of droplets. */
export const SPRAY_MAX_COUNT = 400;

/** Height of the jet's apex above the ground, in metres. The top of the arc. */
export const SPRAY_APEX = 2.55;

/** Height of the basin's water surface above the ground, in metres. A droplet
 *  dies here; it is the bottom of the fall. */
export const SPRAY_LAND = 0.18;

/** Innermost landing radius, in metres from the fountain's axis. Droplets that
 *  fall almost straight back onto the jet land here. */
export const SPRAY_MIN_RADIUS = 0.12;

/** Outermost landing radius, in metres. The basin radius is 1.6, so this leaves
 *  a wide safety margin and the spray never reaches the stone rim. */
export const SPRAY_MAX_RADIUS = 0.95;

/** Smallest droplet quad, in metres. */
export const SPRAY_MIN_SIZE = 0.03;

/** Largest droplet quad, in metres. Kept small so the curtain stays a mist of
 *  specks rather than a hail of pebbles. */
export const SPRAY_MAX_SIZE = 0.075;

/** Seconds for one droplet to fall from the apex to the water. Every droplet
 *  shares this life; only the speed multiplier varies it. */
export const SPRAY_LIFE = 1.15;

/** The most opaque a droplet may be. Falling water is translucent; anything
 *  denser reads as gravel suspended in the air. */
export const SPRAY_MAX_OPACITY = 0.55;

/** The fraction of a droplet's life over which it fades from full opacity to
 *  exactly zero at the end. Long enough to be a fade, not a pop. */
export const SPRAY_FADE_TAIL = 0.12;

/** How strongly the spray shows in each phase. Water catches a low bright sky
 *  best, so dusk is strongest; midday washes it out and night has little light
 *  to catch. The day value is the fallback for unknown phase ids. Frozen so a
 *  caller cannot mutate the table. */
export const SPRAY_PHASE_GLOW = Object.freeze({ day: 0.8, dusk: 1, night: 0.55 });

/** The band a per-droplet speed multiplier is drawn from, and the band a
 *  caller-supplied speed is clamped into. Narrow, so no droplet races or stalls;
 *  there is no exported constant because the band is part of the descriptor
 *  contract rather than a look the world tunes. */
const SPRAY_SPEED_MIN = 0.8;
const SPRAY_SPEED_MAX = 1.2;

/** A small deterministic PRNG (mulberry32). Copied from the other pure modules
 *  rather than imported, so `spray.js` stays independent of them. */
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

/** Positive fractional part in [0, 1). Math.floor makes this correct for
 *  negative times too, so a droplet wraps the same way before and after t = 0. */
function fract(value) {
  return value - Math.floor(value);
}

/** A spawn descriptor is a plain object; arrays and null are not. */
function isDescriptor(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The per-phase glow multiplier. An unknown phase, or a non-string, falls back
 *  to the `day` value, so a phase id the module has not learned can never make
 *  the spray vanish or flare up by accident. */
export function sprayGlowLevel(phaseId) {
  if (typeof phaseId !== 'string') return SPRAY_PHASE_GLOW.day;
  return Object.prototype.hasOwnProperty.call(SPRAY_PHASE_GLOW, phaseId)
    ? SPRAY_PHASE_GLOW[phaseId]
    : SPRAY_PHASE_GLOW.day;
}

/**
 * The spawn descriptors for the whole curtain.
 *
 * Each droplet draws a seeded angle in [0, 2pi), a landing radius in
 * [SPRAY_MIN_RADIUS, SPRAY_MAX_RADIUS], a seeded phase in [0, 1) that staggers
 * it through the shared life, a seed speed multiplier and a seed size. Sampling
 * the landing radius rather than the start radius keeps every droplet's farthest
 * reach inside SPRAY_MAX_RADIUS, which is in turn inside the basin, so no
 * rejection loop is needed.
 *
 * The return is an array of exactly `count` objects, each
 * `{ angle, radius, phase, speed, size }`. A non-finite count falls back to
 * SPRAY_COUNT; a finite count clamps into [0, SPRAY_MAX_COUNT] and floors; a
 * non-finite seed falls back to SPRAY_SEED; and a junk options argument collapses
 * to the defaults. The call never throws and never yields NaN.
 */
export function spraySpawns(options = {}) {
  const opts = isDescriptor(options) ? options : {};
  const rawCount = opts.count;
  const rawSeed = opts.seed;
  const n = finiteNumber(rawCount)
    ? Math.min(SPRAY_MAX_COUNT, Math.max(0, Math.floor(rawCount)))
    : SPRAY_COUNT;
  const base = finiteNumber(rawSeed) ? rawSeed : SPRAY_SEED;

  const rng = mulberry32(base >>> 0);
  const spawns = [];
  for (let i = 0; i < n; i += 1) {
    const angle = rng() * Math.PI * 2;
    const radius = SPRAY_MIN_RADIUS + rng() * (SPRAY_MAX_RADIUS - SPRAY_MIN_RADIUS);
    const phase = rng();
    const speed = SPRAY_SPEED_MIN + rng() * (SPRAY_SPEED_MAX - SPRAY_SPEED_MIN);
    const size = SPRAY_MIN_SIZE + rng() * (SPRAY_MAX_SIZE - SPRAY_MIN_SIZE);
    spawns.push({ angle, radius, phase, speed, size });
  }
  return spawns;
}

/**
 * One droplet at `time`, as `{ x, y, z, size, opacity }`.
 *
 * The life position is
 *   p = fract(time * speed / SPRAY_LIFE + phase)
 * in [0, 1). The droplet widens from a quarter of its landing radius to the full
 * radius as p rises, falls from SPRAY_APEX to SPRAY_LAND along 1 - p^2 (so it
 * hangs at the top and accelerates), keeps its seeded size, and holds full
 * opacity until the final SPRAY_FADE_TAIL of the life, over which it fades to
 * zero. Position is polar: x = cos(angle) * radius * (0.25 + 0.75p), z the same
 * with sin, and y always lies inside [SPRAY_LAND, SPRAY_APEX].
 *
 * Junk is handled rather than thrown at: a spawn that is not a plain object
 * yields a zero-width, fully transparent droplet at the water surface; individual
 * non-finite spawn fields fall back to safe values; a non-finite time reads as 0;
 * and a finite-but-enormous time that would overflow when scaled by speed is
 * caught before fract, so it cannot become NaN. Every returned number is finite.
 */
export function sprayDrop(spawn, time) {
  if (!isDescriptor(spawn)) {
    return { x: 0, y: SPRAY_LAND, z: 0, size: SPRAY_MIN_SIZE, opacity: 0 };
  }

  const angle = finiteNumber(spawn.angle) ? spawn.angle : 0;
  const radius = clampNumber(spawn.radius, SPRAY_MIN_RADIUS, SPRAY_MAX_RADIUS, SPRAY_MIN_RADIUS);
  const phase = finiteNumber(spawn.phase) ? spawn.phase : 0;
  const speed = clampNumber(spawn.speed, SPRAY_SPEED_MIN, SPRAY_SPEED_MAX, 1);
  const size = clampNumber(spawn.size, SPRAY_MIN_SIZE, SPRAY_MAX_SIZE, SPRAY_MIN_SIZE);

  const t = finiteNumber(time) ? time : 0;
  // A finite-but-enormous time (near Number.MAX_VALUE) can overflow when scaled
  // by speed, and fract(Infinity) is NaN; the product is checked before use and a
  // non-finite intermediate reads as time 0. The division and phase addition are
  // guarded too, so the argument to fract is always finite.
  const scaled = t * speed;
  const lived = finiteNumber(scaled) ? scaled / SPRAY_LIFE + phase : 0;
  const p = finiteNumber(lived) ? fract(lived) : 0;

  const r = radius * (0.25 + 0.75 * p);
  // 1 - p^2: the droplet hangs at the apex and speeds up as it falls. Because p
  // is in [0, 1), y stays in (SPRAY_LAND, SPRAY_APEX].
  const y = SPRAY_APEX - (SPRAY_APEX - SPRAY_LAND) * p * p;
  // The tail fades linearly to zero at p = 1, so the droplet is gone before it
  // wraps back to birth at full opacity. The clamp guards the range regardless.
  const opacity = clampNumber(
    p >= 1 - SPRAY_FADE_TAIL
      ? SPRAY_MAX_OPACITY * ((1 - p) / SPRAY_FADE_TAIL)
      : SPRAY_MAX_OPACITY,
    0,
    SPRAY_MAX_OPACITY,
    SPRAY_MAX_OPACITY
  );

  return {
    x: Math.cos(angle) * r,
    y,
    z: Math.sin(angle) * r,
    size,
    opacity
  };
}

/** Whether the spray runs at this quality tier. The low tier drops the per-frame
 *  droplet pass, consistent with the quality-tier convention; junk reads as the
 *  full tier. */
export function sprayEnabled(tier) {
  return tier !== 'low';
}
