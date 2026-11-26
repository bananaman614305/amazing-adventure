// Where the daytime butterflies live, how they wander over the meadow, and how
// their wings beat, decided without a GPU.
//
// `birds.js` fills the high sky with a distant flock and `fireflies.js` fills the
// night meadow with drifting points of light, but the middle of a summer day --
// the grass just beyond the plaza edge, where the player actually walks -- has
// nothing moving at eye level. Butterflies belong exactly there: low, close and
// slow enough to notice, the daylight counterpart to the fireflies. `world.js`
// turns these numbers into one instanced draw call of small tinted quads, and the
// meadow comes alive for almost nothing.
//
// Three decisions are worth the words.
//
// 1. They stay in the meadow band, not the plaza. The plaza is paved and busy;
//    the ring beyond its edge is grass. Keeping every butterfly between
//    BUTTERFLY_MIN_RADIUS and BUTTERFLY_MAX_RADIUS puts the field off the paving
//    and inside the border walls without a rejection loop, exactly as the
//    fireflies do at night.
//
// 2. They wander a small loop, they do not migrate. A butterfly that flies in a
//    straight line leaves the play area and has to be respawned, which needs a
//    clock, a boundary test and state. Two incommensurate sines per horizontal
//    axis, scaled by the spawn's speed and offset by its phase, give a bounded
//    wander that is periodic enough to test and never drifts away from the spawn.
//    The horizontal displacement is capped by construction at
//    BUTTERFLY_WANDER_RADIUS and the vertical bob at BUTTERFLY_BOB_AMPLITUDE, so
//    the same call with the same spawn always gives the same point.
//
// 3. The wing angle is bounded, not free. The caller only needs a flap phase to
//    rotate a wing pair, so `butterflyFlight` returns a `wing` angle clamped by
//    construction to +/- BUTTERFLY_WING_AMPLITUDE. The caller cannot accidentally
//    spin a wing through a full turn, and the value is finite at time 0.
//
// Everything here is seeded (mulberry32, copied rather than imported so the
// module stands alone) and pure: no Three.js, no DOM, no clock, no Math.random.
// Two identical calls produce bit-identical numbers. Every export is total -- it
// guards junk input, and no call can produce NaN or Infinity.

/** Seed for the field generator. Fixed so every run builds the same field. */
export const BUTTERFLY_SEED = 0x7a2f19;

/** How many butterflies the meadow holds. One instanced draw call regardless. */
export const BUTTERFLY_COUNT = 16;

/** Upper bound on an explicit count, so a junk argument cannot allocate wildly. */
export const BUTTERFLY_MAX_COUNT = 512;

/** Inner edge of the meadow ring, in metres from the plaza centre. */
export const BUTTERFLY_MIN_RADIUS = 6;

/** Outer edge of the meadow ring, in metres, inside the border walls. */
export const BUTTERFLY_MAX_RADIUS = 14;

/** Lowest flight height in metres; just above the grass tips. */
export const BUTTERFLY_MIN_HEIGHT = 0.6;

/** Highest flight height in metres; below a standing player's eye line. */
export const BUTTERFLY_MAX_HEIGHT = 2.2;

/** Slowest wander multiplier. Keeps one butterfly from crawling to a stop. */
export const BUTTERFLY_MIN_SPEED = 0.6;

/** Fastest wander multiplier. Keeps one butterfly from racing the others. */
export const BUTTERFLY_MAX_SPEED = 1.4;

/** Smallest body scale multiplier. */
export const BUTTERFLY_MIN_SCALE = 0.8;

/** Largest body scale multiplier. */
export const BUTTERFLY_MAX_SCALE = 1.3;

/** Seconds for one full flap cycle. Fast, because a butterfly beats quickly. */
export const BUTTERFLY_WING_PERIOD = 0.34;

/** Peak wing rotation in radians. The wing mesh swings within this band. */
export const BUTTERFLY_WING_AMPLITUDE = 0.95;

/** Largest horizontal displacement from a spawn, in metres. Bounds the wander. */
export const BUTTERFLY_WANDER_RADIUS = 1.5;

/** Peak vertical bob in metres around the spawn height. */
export const BUTTERFLY_BOB_AMPLITUDE = 0.4;

/** Warm body colours a caller picks from by `tintIndex`. Frozen so a caller
 *  cannot mutate the palette the world reads. */
export const BUTTERFLY_TINTS = Object.freeze([0xf4c542, 0xe8892f, 0xf6e08a]);

/** How strongly the field shows in each phase. Butterflies are a day thing, so
 *  night is zero and dusk fades them halfway out -- the opposite of the
 *  fireflies. Frozen so the table cannot be mutated by a caller. */
export const BUTTERFLY_PHASE_GLOW = Object.freeze({ day: 1, dusk: 0.5, night: 0 });

/** A small deterministic PRNG (mulberry32). Copied from the other pure modules
 *  rather than imported, so `butterflies.js` stays independent of them. */
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

/** Replace a non-finite sine argument with 0, so an absurd time cannot turn a
 *  bounded wander into NaN. */
function safeAngle(value) {
  return Number.isFinite(value) ? value : 0;
}

/** The per-phase visibility multiplier. Unknown phase, or a non-string, falls
 *  back to the `day` value (1), because a field that vanishes on a phase id the
 *  code has not learned yet would be worse than one that lingers a little too
 *  long. */
export function butterflyGlowLevel(phaseId) {
  if (typeof phaseId !== 'string') return BUTTERFLY_PHASE_GLOW.day;
  return Object.prototype.hasOwnProperty.call(BUTTERFLY_PHASE_GLOW, phaseId)
    ? BUTTERFLY_PHASE_GLOW[phaseId]
    : BUTTERFLY_PHASE_GLOW.day;
}

/**
 * The spawn descriptors for the whole field.
 *
 * Positions are sampled in polar coordinates: a seeded angle in [0, 2pi) and a
 * seeded radius in [minRadius, maxRadius], then x = cos(angle)*radius and
 * z = sin(angle)*radius. Area-uniform sampling is not attempted on purpose -- a
 * decorative ring does not need uniform density, and the simpler radial sampling
 * keeps every butterfly off the plaza without a rejection loop. The remaining
 * fields (height, phase, speed, scale, tint) are seeded draws from their bands.
 *
 * The return is an array of exactly `count` objects, each
 * `{ x, z, height, phase, speed, scale, tintIndex }`. A junk `count` clamps into
 * [0, BUTTERFLY_MAX_COUNT] and floors, a non-finite seed falls back to
 * BUTTERFLY_SEED, junk options fall back to the defaults, swapped radii are
 * exchanged, and negative radii clamp to 0, so the call never throws and never
 * yields NaN.
 */
export function butterflySpawns(options = {}) {
  const opts = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
  const {
    count = BUTTERFLY_COUNT,
    seed = BUTTERFLY_SEED,
    minRadius = BUTTERFLY_MIN_RADIUS,
    maxRadius = BUTTERFLY_MAX_RADIUS
  } = opts;

  const n = finiteNumber(count)
    ? Math.min(BUTTERFLY_MAX_COUNT, Math.max(0, Math.floor(count)))
    : BUTTERFLY_COUNT;
  const base = finiteNumber(seed) ? seed : BUTTERFLY_SEED;
  let lo = clampNumber(minRadius, 0, 1e6, BUTTERFLY_MIN_RADIUS);
  let hi = clampNumber(maxRadius, 0, 1e6, BUTTERFLY_MAX_RADIUS);
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
    const height = BUTTERFLY_MIN_HEIGHT + rng() * (BUTTERFLY_MAX_HEIGHT - BUTTERFLY_MIN_HEIGHT);
    const phase = rng();
    const speed = BUTTERFLY_MIN_SPEED + rng() * (BUTTERFLY_MAX_SPEED - BUTTERFLY_MIN_SPEED);
    const scale = BUTTERFLY_MIN_SCALE + rng() * (BUTTERFLY_MAX_SCALE - BUTTERFLY_MIN_SCALE);
    const tintIndex = Math.min(
      BUTTERFLY_TINTS.length - 1,
      Math.floor(rng() * BUTTERFLY_TINTS.length)
    );
    spawns.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      height,
      phase,
      speed,
      scale,
      tintIndex
    });
  }
  return spawns;
}

/**
 * One butterfly's position and wing angle at `time`, as `{ x, y, z, wing }`.
 *
 * The position is the spawn point plus a small bounded wander: two
 * incommensurate sines per horizontal axis, so the path never retraces an obvious
 * circle and never drifts away from the spawn. The horizontal amplitudes sum to
 * 0.9 m per axis, so the radial displacement is at most about 1.27 m, comfortably
 * inside BUTTERFLY_WANDER_RADIUS; the vertical amplitudes sum to
 * BUTTERFLY_BOB_AMPLITUDE. The wing is a sine within +/- BUTTERFLY_WING_AMPLITUDE.
 *
 * A non-finite time reads as 0. A missing, junk or array spawn returns the origin
 * with a level wing rather than NaN. Any sine argument that would overflow (an
 * absurd time multiplied by a speed) is detected and read as 0, which keeps every
 * returned number finite.
 */
export function butterflyFlight(time, spawn) {
  const t = finiteNumber(time) ? time : 0;
  if (spawn == null || typeof spawn !== 'object' || Array.isArray(spawn)) {
    return { x: 0, y: 0, z: 0, wing: 0 };
  }

  const baseX = clampNumber(spawn.x, -1e6, 1e6, 0);
  const baseZ = clampNumber(spawn.z, -1e6, 1e6, 0);
  const baseY = clampNumber(spawn.height, 0, 1e6, 0);
  const speed = clampNumber(spawn.speed, 0, 100, 1);
  const phase = finiteNumber(spawn.phase) ? spawn.phase : 0;

  // The spawn's phase offsets every oscillator so two butterflies at the same
  // spot do not move in lockstep.
  const offset = phase * Math.PI * 2;
  const ts = t * speed;

  // Horizontal wander: incommensurate frequencies (0.9, 1.7, 0.8, 1.9) keep the
  // path from closing, and the amplitudes sum to 0.9 m per axis.
  const ax1 = safeAngle(ts * 0.9 + offset);
  const ax2 = safeAngle(ts * 1.7 + offset * 1.3);
  const az1 = safeAngle(ts * 0.8 + offset * 1.1);
  const az2 = safeAngle(ts * 1.9 + offset * 0.5);
  const x = baseX + 0.6 * Math.sin(ax1) + 0.3 * Math.sin(ax2);
  const z = baseZ + 0.6 * Math.cos(az1) + 0.3 * Math.cos(az2);

  // Vertical bob: amplitudes sum to BUTTERFLY_BOB_AMPLITUDE.
  const ay1 = safeAngle(ts * 1.2 + offset * 0.7);
  const ay2 = safeAngle(ts * 2.3 + offset * 1.9);
  const y = baseY + 0.28 * Math.sin(ay1) + 0.12 * Math.sin(ay2);

  // Wing flap: one sine over BUTTERFLY_WING_PERIOD, offset by phase.
  const wingArg = safeAngle((t / BUTTERFLY_WING_PERIOD) * Math.PI * 2 + offset);
  const wing = BUTTERFLY_WING_AMPLITUDE * Math.sin(wingArg);

  return { x, y, z, wing };
}

/** Whether the butterfly field runs at this quality tier. The low tier drops the
 *  per-frame butterfly pass, consistent with the quality-tier convention; junk
 *  reads as the full tier. */
export function butterfliesEnabled(tier) {
  return tier !== 'low';
}
