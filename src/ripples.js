// The expanding rings on the fountain's water, decided without a GPU.
//
// A fountain whose surface is a flat, mirror-smooth disc reads as a plate of
// glass sitting in a stone bowl; nothing about it says "water". What sells moving
// water from across the courtyard is not a shader but a handful of thin rings
// spreading out from where the jet lands and fading as they widen. `world.js`
// turns these numbers into one InstancedMesh of flat rings lying a hair above the
// water disc, scaled per frame; this module owns only the decisions. The whole
// effect is one draw call and no fragment work, which is why it earns its place
// even on a host with no GPU to spare.
//
// Four choices are worth the words.
//
// 1. The centres cluster where the jet lands. A real fountain drops its water
//    near the middle and the rings radiate from there, so the spawn ring is kept
//    to RIPPLE_SITE_RADIUS -- the basin radius minus the largest ring -- and every
//    ring, even one born at the edge of that cluster, still dies before it would
//    leave the water. Scattering centres across the whole basin would put rings
//    half over the stone rim.
//
// 2. One site carries several rings, not one. A single ring that grows, vanishes
//    and restarts reads as a slow pulse. Real water shows a train of rings at
//    different ages, so each site owns RIPPLE_RINGS_PER_SITE rings staggered
//    evenly through the life; `index` selects which one, and a single centre then
//    reads as continuous disturbance rather than a heartbeat.
//
// 3. A ring's last sliver of life is already invisible. A ring that fades to a
//    small positive alpha pops out of existence the instant it wraps back to
//    birth; one whose opacity reaches exactly zero over the final RIPPLE_FADE_TAIL
//    of its life is gone before the reset. That is why opacity is snapped to zero
//    at the top rather than left to approach it asymptotically.
//
// 4. Rings thin as they widen. A ripple spreads its energy around a larger
//    circumference as it grows, so the band gets narrower, not wider. `rippleRing`
//    therefore returns `band`, a world-unit band thickness (metres) that starts at
//    a birth thickness and RIPPLE_THIN shaves it down over the life, never below
//    RIPPLE_MIN_BAND. It also returns `alpha`, the per-instance opacity (including
//    the exact-zero fade tail) so `world.js` can drive an instanced attribute
//    instead of a global material opacity. `opacity` and `scale` are kept
//    unchanged for callers that still read them; the world should use `band` and
//    `alpha` for the ring geometry and per-instance fade.
//
// Everything here is seeded (mulberry32, copied rather than imported so the module
// stands alone) and pure: no Three.js, no DOM, no clock, no Math.random. Two
// identical runs therefore build byte-identical fields, and the motion can be
// pinned by unit tests. Every export is total -- it guards junk input, and no call
// can produce NaN or Infinity.

/** Seed for the ripple generator. Fixed so every run builds the same field. */
export const RIPPLE_SEED = 0x6e0f35;

/** How many ripple centres the fountain shows. One instanced draw call covers all
 *  of them and every ring they carry, so this is a look decision, not a cost one. */
export const RIPPLE_COUNT = 10;

/** An upper bound on a caller-supplied count, so a junk number cannot ask for a
 *  million centres. */
export const RIPPLE_MAX_COUNT = 48;

/** Inner radius of the fountain basin, in metres. The water disc sits inside it. */
export const RIPPLE_BASIN_RADIUS = 1.6;

/** The radius a ring reaches just before it has fully faded, in metres. Kept
 *  below RIPPLE_BASIN_RADIUS so a centred ring dies on the water. */
export const RIPPLE_MAX_RADIUS = 1.4;

/** How far a ripple centre may sit from the fountain's axis, in metres. This is
 *  RIPPLE_BASIN_RADIUS - RIPPLE_MAX_RADIUS, so even a centre on the edge of the
 *  cluster still keeps a full-size ring inside the basin. */
export const RIPPLE_SITE_RADIUS = 0.2;

/** Smallest and largest ring thickness scale. A ring's world size is its base
 *  geometry scaled by this, so these are multipliers, not metres. */
export const RIPPLE_MIN_SIZE = 0.5;
export const RIPPLE_MAX_SIZE = 1.1;

/** Seconds for one ring to expand from nothing to RIPPLE_MAX_RADIUS and fade out.
 *  Exposed so tests can state the life contract plainly. */
export const RIPPLE_LIFE = 2.6;

/** The most opaque a fresh ring may be. Water is a reflection, not a decal;
 *  anything denser reads as painted-on rings. */
export const RIPPLE_MAX_OPACITY = 0.5;

/** How strongly the rings show in each phase. Water reads at every hour, but
 *  dusk is strongest: a low bright sky is reflected off the surface and the
 *  moving rings catch it, while at night there is little light to catch and by
 *  day the surface is washed out. The day value is the fallback for unknown
 *  phase ids. */
export const RIPPLE_PHASE_GLOW = Object.freeze({ day: 0.9, dusk: 1, night: 0.7 });

/** Rings per ripple centre. Three is the smallest number that reads as a train of
 *  rings rather than a pulse, and it keeps the instanced mesh small. */
export const RIPPLE_RINGS_PER_SITE = 3;

/** Height of the ring plane above the water, in metres. A tiny lift keeps the
 *  rings from z-fighting the water disc; any more and they float. */
export const RIPPLE_WATER_Y = 0.02;

/** The fraction of a ring's life over which its opacity is exactly zero. The ring
 *  has already vanished by the time it wraps back to birth, so it never pops. */
export const RIPPLE_FADE_TAIL = 0.02;

/** How much of a ring's thickness it sheds over its life. 0.35 leaves a ring
 *  noticeably thinner at the rim without it vanishing to a hairline. */
export const RIPPLE_THIN = 0.35;

/** The thinnest a ripple's band may become, in metres. A ring that thinned to a
 *  hairline would alias into a dotted line in software rasterisation, so the
 *  band is floored here rather than allowed to reach zero. Just under two
 *  centimetres matches the width the rings read at from the fountain's edge;
 *  wider and the rings look like painted hoops rather than water. */
export const RIPPLE_MIN_BAND = 0.018;

/** The band thickness of a newborn ring before its spawn size is applied, in
 *  metres. The spawn's `size` multiplier (RIPPLE_MIN_SIZE..RIPPLE_MAX_SIZE)
 *  scales it, so the true birth thickness runs from 2.5 cm to 5.5 cm. Chosen so
 *  the thinnest spawn (0.5) is still above RIPPLE_MIN_BAND at birth, keeping the
 *  [RIPPLE_MIN_BAND, birth] clamp interval non-empty for every spawn. */
export const RIPPLE_BAND_BIRTH = 0.05;

/** The band a per-site speed multiplier is drawn from, and the band a
 *  caller-supplied speed is clamped into. A little variation keeps the sites from
 *  breathing in lockstep; the band is narrow so none races or stalls. */
export const RIPPLE_SPEED_MIN = 0.85;
export const RIPPLE_SPEED_MAX = 1.2;

/** A small deterministic PRNG (mulberry32). Copied from the other pure modules
 *  rather than imported, so `ripples.js` stays independent of them. */
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

/** Positive fractional part in [0, 1). Math.floor makes this correct for negative
 *  times too, so a ring wraps the same way before and after t = 0. */
function fract(value) {
  return value - Math.floor(value);
}

/** A spawn descriptor is a plain object; arrays and null are not. */
function isDescriptor(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The per-phase glow multiplier. An unknown phase, or a non-string, falls back
 *  to the `day` value, so a new phase id can never make the water go dark or flare
 *  up by accident. */
export function rippleGlowLevel(phaseId) {
  if (typeof phaseId !== 'string') return RIPPLE_PHASE_GLOW.day;
  return Object.prototype.hasOwnProperty.call(RIPPLE_PHASE_GLOW, phaseId)
    ? RIPPLE_PHASE_GLOW[phaseId]
    : RIPPLE_PHASE_GLOW.day;
}

/**
 * The spawn descriptors for every ripple centre.
 *
 * Positions are sampled in polar coordinates: a seeded angle in [0, 2pi) and a
 * seeded radius in [0, RIPPLE_SITE_RADIUS], then x = cos(angle)*radius and
 * z = sin(angle)*radius. Uniform radial sampling is denser towards the middle,
 * which is exactly where a jet lands, so the simple sampler happens to suit the
 * subject; no rejection loop is needed to keep every centre inside the basin.
 *
 * The return is an array of exactly `count` objects, each
 * `{ x, z, phase, speed, size }`. A junk count falls back to RIPPLE_COUNT when it
 * is non-finite and otherwise clamps into [0, RIPPLE_MAX_COUNT] and floors; a
 * non-finite seed falls back to RIPPLE_SEED; and every sampled field is clamped
 * into its documented band, so the call never throws and never yields NaN.
 */
export function rippleSpawns(options = {}) {
  const opts = isDescriptor(options) ? options : {};
  const rawCount = opts.count;
  const rawSeed = opts.seed;
  const n = finiteNumber(rawCount)
    ? Math.min(RIPPLE_MAX_COUNT, Math.max(0, Math.floor(rawCount)))
    : RIPPLE_COUNT;
  const base = finiteNumber(rawSeed) ? rawSeed : RIPPLE_SEED;

  const rng = mulberry32(base >>> 0);
  const spawns = [];
  for (let i = 0; i < n; i += 1) {
    const angle = rng() * Math.PI * 2;
    const radius = rng() * RIPPLE_SITE_RADIUS;
    // The phase offsets each site's train so two centres do not emit in lockstep;
    // it is a plain fraction of the life, wrapped by rippleRing.
    const phase = rng();
    const speed = RIPPLE_SPEED_MIN + rng() * (RIPPLE_SPEED_MAX - RIPPLE_SPEED_MIN);
    const size = RIPPLE_MIN_SIZE + rng() * (RIPPLE_MAX_SIZE - RIPPLE_MIN_SIZE);
    spawns.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      phase,
      speed,
      size
    });
  }
  return spawns;
}

/**
 * One ring of one centre at `time`, as
 * `{ x, y, z, radius, opacity, scale, band, alpha }`.
 *
 * `index` is the ring's slot within its site: 0 is the youngest of the
 * RIPPLE_RINGS_PER_SITE rings, the last is the oldest. The slot is folded into
 * the life position as `index / RIPPLE_RINGS_PER_SITE`, so the rings of one
 * centre sit evenly spaced through the life and a single site reads as a train of
 * rings at different radii at every instant.
 *
 * The life position is
 *   progress = frac(time * speed / RIPPLE_LIFE + phase + index / RINGS_PER_SITE)
 * which lies in [0, 1). Radius grows linearly from 0 at progress 0 to
 * RIPPLE_MAX_RADIUS as progress approaches 1; opacity falls from
 * RIPPLE_MAX_OPACITY to exactly 0 over the final RIPPLE_FADE_TAIL; and scale
 * shrinks from the spawn's size by RIPPLE_THIN over the life. The ring lies at a
 * constant RIPPLE_WATER_Y above the water. All values are finite and bounded.
 *
 * Two fields are added for the world's per-instance shader:
 *   - `band` is the ring's band thickness in world metres. It is born at
 *     RIPPLE_BAND_BIRTH * size and shed by RIPPLE_THIN over the life, clamped to
 *     [RIPPLE_MIN_BAND, birth], so the band narrows as the ring widens instead of
 *     keeping a constant *relative* width (which would make the rim ring four
 *     times as thick as a newborn one).
 *   - `alpha` is the per-instance opacity in [0, RIPPLE_MAX_OPACITY], the same
 *     value as `opacity` including the exact-zero fade tail. It exists so the
 *     world can feed an instanced attribute and keep each ring's own fade instead
 *     of averaging them into one global material opacity. `opacity` and `scale`
 *     are retained unchanged for existing callers.
 *
 * Junk is handled rather than thrown at: a spawn that is not a plain object yields
 * an invisible ring at the origin with the minimum scale and band; individual
 * non-finite spawn fields fall back to safe values; a non-finite `time` reads as
 * 0; and a non-finite `index` reads as slot 0, with a finite out-of-range index
 * clamped into the slots.
 */
export function rippleRing(spawn, index, time) {
  if (!isDescriptor(spawn)) {
    const birthBand = RIPPLE_BAND_BIRTH * RIPPLE_MIN_SIZE;
    return {
      x: 0, y: RIPPLE_WATER_Y, z: 0, radius: 0, opacity: 0, scale: RIPPLE_MIN_SIZE,
      band: Math.min(birthBand, Math.max(RIPPLE_MIN_BAND, birthBand)), alpha: 0
    };
  }

  const x0 = finiteNumber(spawn.x) ? spawn.x : 0;
  const z0 = finiteNumber(spawn.z) ? spawn.z : 0;
  const phase = finiteNumber(spawn.phase) ? spawn.phase : 0;
  const speed = clampNumber(spawn.speed, RIPPLE_SPEED_MIN, RIPPLE_SPEED_MAX, 1);
  const size = clampNumber(spawn.size, RIPPLE_MIN_SIZE, RIPPLE_MAX_SIZE, RIPPLE_MIN_SIZE);

  const t = finiteNumber(time) ? time : 0;
  const slot = finiteNumber(index)
    ? Math.min(RIPPLE_RINGS_PER_SITE - 1, Math.max(0, Math.floor(index)))
    : 0;

  // The slot stagger is what turns one site into a train of rings; dividing by
  // the ring count spaces them evenly through the life.
  // A finite-but-enormous time (near Number.MAX_VALUE) can overflow when scaled
  // by speed, and fract(Infinity) is NaN, so the product is checked before use
  // and a non-finite result reads as time 0. Phase is folded in the same step so
  // the whole argument to fract is guaranteed finite.
  const scaled = t * speed;
  const lived = finiteNumber(scaled) ? scaled / RIPPLE_LIFE + phase + slot / RIPPLE_RINGS_PER_SITE : 0;
  const progress = fract(lived);

  const radius = RIPPLE_MAX_RADIUS * progress;
  const scale = size * (1 - RIPPLE_THIN * progress);
  // Snap the tail to exactly zero: a ring that has reached the rim must be
  // invisible before it wraps back to birth, or it pops. The clamp below keeps
  // the value inside [0, RIPPLE_MAX_OPACITY] regardless of progress.
  const opacity = progress >= 1 - RIPPLE_FADE_TAIL
    ? 0
    : clampNumber(RIPPLE_MAX_OPACITY * (1 - progress), 0, RIPPLE_MAX_OPACITY, 0);

  // The band is a world thickness, not a scale, so it can narrow independently of
  // the radius. It starts at the spawn's birth thickness and sheds RIPPLE_THIN of
  // it over the life, floored so it never aliases to a hairline.
  const birthBand = RIPPLE_BAND_BIRTH * size;
  const band = Math.min(birthBand, Math.max(RIPPLE_MIN_BAND, birthBand * (1 - RIPPLE_THIN * progress)));

  return { x: x0, y: RIPPLE_WATER_Y, z: z0, radius, opacity, scale, band, alpha: opacity };
}

/** Whether the ripple field runs at this quality tier. The low tier drops the
 *  per-frame ripple pass, consistent with the quality-tier convention; junk reads
 *  as the full tier. */
export function ripplesEnabled(tier) {
  return tier !== 'low';
}
