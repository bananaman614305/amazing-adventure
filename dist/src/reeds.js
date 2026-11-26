// Where the cattail/reed clumps stand in the meadow's damp ground, how tall and
// how thick each is, which green it reads as, and how its stems bend in the wind,
// decided without a GPU.
//
// The meadow around the fountain basin is a broad, low, horizontal surface: grass
// tufts, a scatter of stones, and a lot of sky. Nothing in it breaks the horizon
// line from standing height, so the eye reads the ground as a flat sheet rather
// than as a place with depth. A handful of reed clumps standing in the damp ground
// near the basin edge fixes that for almost nothing: each clump is a few thin
// vertical stems with a heavier cattail head, and the vertical silhouette gives
// the meadow a middle distance the grass alone cannot. `world.js` turns these
// numbers into a small InstancedMesh of tapered quads and heads, so the whole
// field is one or two draw calls no matter how many clumps there are. This module
// is the pure half: it decides placement, shape and motion, and knows nothing of
// Three.js.
//
// Five decisions are worth the words.
//
// 1. Twenty-six clumps is the density that reads right. The playable square inside
//    the margin is roughly 32 m on a side, and the fountain and its apron carve a
//    disc out of the middle, so twenty-six clumps work out at about one per 39
//    square metres of open ground. That is enough that a walk from the plaza to
//    the basin passes several and the meadow gains a skyline, but sparse enough
//    that the ground still reads as meadow rather than as a reed bed. Fewer than
//    twenty disappear against the grass; more than forty start to fence the basin
//    off.
//
// 2. Each clump is two to five stems. A single stem is a weed; a clump of two to
//    five reads as one plant that has grown a handful of shoots, which is what a
//    cattail does. Five is the cap because beyond that the clump silhouette turns
//    into a bush, and a bush is the wrong shape entirely -- the point is vertical
//    lines, not a blob. Stems are thin (the size factor is a width multiplier
//    around 0.7 to 1.3) so the clump stays a few lines against the sky.
//
// 3. The stems sway, and they sway out of step. A reed bed that moves in unison
//    reads as a rigid cardboard cut-out; real stems are at slightly different
//    angles to the wind and answer it on slightly different clocks. The motion is
//    one slow sine at REED_SWAY_PERIOD (2.6 s), which is a gust cycle rather than
//    a flutter, and each stem adds a fixed phase offset derived from its index so
//    the stems of one clump never cross zero together. The peak offset is only
//    REED_SWAY_AMPLITUDE (0.09 rad, about five degrees): enough to catch the eye
//    on a still afternoon, not enough to look like a storm.
//
// 4. The static lean and the sway are separate. REED_MIN_LEAN..REED_MAX_LEAN is
//    how far a clump is authored to stand off vertical, a fixed property of the
//    plant that the world bakes into the instance matrix once. The sway is a
//    bounded oscillation added on top every frame. Keeping them apart is what
//    lets the sway contract stay a clean `|lean| <= REED_SWAY_AMPLITUDE` bound
//    regardless of how far the clump itself is leaning.
//
// 5. The glow table is bright by day and dim at night. Reeds are lit by the sky,
//    so they are near full brightness in daylight (0.9) and at their brightest at
//    dusk (1), when a low warm sun rakes across the stems. At night they drop to
//    0.55: they are still visible in the moonlight, but they must not glow like a
//    lantern. Unknown phase ids fall back to day, so a phase the code has not
//    learned yet can never leave the field unnaturally dark or bright.
//
// Everything here is seeded (mulberry32, copied rather than imported so the module
// stands alone) and pure: no Three.js, no DOM, no clock, no Math.random. Two
// identical calls produce bit-identical descriptors, and every export is total --
// it guards junk input, and no call can produce NaN or Infinity.

/** Seed for the reed generator. Fixed so every run grows the same clumps. */
export const REED_SEED = 0x3c6e21;

/** How many clumps the meadow holds by default. Roughly one per 39 m^2 of open
 *  ground (see the header); a couple of instanced draw calls regardless. */
export const REED_COUNT = 26;

/** Upper clamp on a requested count, so a typo cannot fence in the whole basin. */
export const REED_MAX_COUNT = 200;

/** Default half-extent of the playable square, in metres, matching the world's
 *  own extent; used when the caller does not say. */
export const REED_DEFAULT_WORLD_HALF = 17;

/** Keep-out from the border wall in metres. The clump's centre is kept inside
 *  this band, so no clump stands against or through the stonework. */
export const REED_MARGIN = 0.7;

/** Fewest stems in one clump. One stem is a weed, not a plant. */
export const REED_MIN_STEMS = 2;

/** Most stems in one clump. Beyond five the silhouette turns into a bush, which
 *  loses the vertical lines the field exists to draw (see the header). */
export const REED_MAX_STEMS = 5;

/** Shortest clump, in metres. Below about half a metre it vanishes into the
 *  grass tufts and stops reading as a distinct plant. */
export const REED_MIN_HEIGHT = 0.45;

/** Tallest clump, in metres. Above about a metre the reeds start to fence the
 *  basin off and hide the water behind them. */
export const REED_MAX_HEIGHT = 0.95;

/** Least a clump may lean off vertical, in radians. Zero means it may stand
 *  straight; the band is deliberately asymmetric so some do. */
export const REED_MIN_LEAN = 0;

/** Most a clump may lean off vertical, in radians (about seven degrees). A fixed
 *  property of the plant, baked into the instance matrix, not the wind sway. */
export const REED_MAX_LEAN = 0.12;

/** Smallest stem width multiplier. Thin stems keep the clump a few lines against
 *  the sky. */
export const REED_MIN_SIZE = 0.7;

/** Largest stem width multiplier, the upper half of the same band. */
export const REED_MAX_SIZE = 1.3;

/** How strongly the field shows in each phase. Bright by day, brightest at dusk
 *  under a raking sun, dimmed at night so the reeds do not glow. Frozen so a
 *  caller cannot mutate the table. */
export const REED_PHASE_GLOW = Object.freeze({ day: 0.9, dusk: 1, night: 0.55 });

/** The reed greens a clump may read as, as 0xRRGGBB hex. Frozen, each entry a
 *  plain number, so a caller cannot recolor the field in place. */
export const REED_TINTS = Object.freeze([0x6f8a4a, 0x7f9a55, 0x5f7a40]);

/** Seconds for one full wind sway. Slow on purpose: a gust cycle, not a flutter,
 *  so the stems bend and recover over a couple of seconds. */
export const REED_SWAY_PERIOD = 2.6;

/** Peak sway offset in radians (about five degrees). Small enough to read as a
 *  breeze rather than a storm; the sway contract bounds every lean to this. */
export const REED_SWAY_AMPLITUDE = 0.09;

/** How many candidates each clump may try before it is skipped. Twenty-four
 *  keeps a crowded keep-out set from spinning while making it very unlikely that
 *  a clump with free ground around it is ever dropped. */
const REED_PLACEMENT_ATTEMPTS = 24;

/** A small deterministic PRNG (mulberry32). Copied from the other pure modules
 *  rather than imported, so `reeds.js` stays independent of them. */
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
function clampNumber(value, lo, hi, fallback) {
  if (!finiteNumber(value)) return fallback;
  return Math.min(hi, Math.max(lo, value));
}

/** A usable keep-out circle needs finite x and z and a finite, non-negative
 *  radius. `radius` is the canonical field named by the task; `r` is accepted as
 *  an alias because the puddle and scatter modules hand out circles shaped that
 *  way. Malformed entries are skipped rather than throwing. */
function usableCircle(circle) {
  if (circle == null || typeof circle !== 'object' || Array.isArray(circle)) return null;
  if (!finiteNumber(circle.x) || !finiteNumber(circle.z)) return null;
  const r = finiteNumber(circle.radius) ? circle.radius : finiteNumber(circle.r) ? circle.r : null;
  if (r == null || r < 0) return null;
  return { x: circle.x, z: circle.z, r };
}

/** True when a candidate clump centre may stand here: inside the margin band and
 *  outside every keep-out circle. All comparisons use squared distances to avoid
 *  a sqrt in the inner loop. Never throws: junk numbers are rejected. */
function placeable(x, z, limit, circles) {
  if (!finiteNumber(x) || !finiteNumber(z)) return false;
  if (Math.abs(x) > limit || Math.abs(z) > limit) return false;
  for (let i = 0; i < circles.length; i += 1) {
    const c = circles[i];
    const dx = x - c.x;
    const dz = z - c.z;
    if (dx * dx + dz * dz < c.r * c.r) return false;
  }
  return true;
}

/**
 * The per-phase glow multiplier. Unknown phase, or a non-string, falls back to
 * the `day` value, because a reed field that suddenly went dark on a phase id
 * the code has not learned yet would read as a bug.
 */
export function reedGlowLevel(phaseId) {
  if (typeof phaseId !== 'string') return REED_PHASE_GLOW.day;
  return Object.prototype.hasOwnProperty.call(REED_PHASE_GLOW, phaseId)
    ? REED_PHASE_GLOW[phaseId]
    : REED_PHASE_GLOW.day;
}

/**
 * The spawn descriptors for the whole reed field.
 *
 * Each descriptor is `{ x, z, stems, height, lean, size, tint, phase }`:
 *   - `x` and `z` are metres from the plaza centre, sampled uniformly in the
 *     square [-worldHalf + REED_MARGIN, worldHalf - REED_MARGIN];
 *   - `stems` is an integer in [REED_MIN_STEMS, REED_MAX_STEMS];
 *   - `height` is the clump's height in metres in [REED_MIN_HEIGHT,
 *     REED_MAX_HEIGHT];
 *   - `lean` is the fixed off-vertical angle in radians in [REED_MIN_LEAN,
 *     REED_MAX_LEAN], applied by the world, not the wind;
 *   - `size` is a stem width multiplier in [REED_MIN_SIZE, REED_MAX_SIZE];
 *   - `tint` is one of the REED_TINTS hex values;
 *   - `phase` is a [0, 1) offset so two clumps never sway in lockstep.
 *
 * `options` may carry `count`, `seed`, `worldHalf` (clamped into [4, 64], junk
 * reads as 17) and `circles`, an array of `{ x, z, radius }` keep-out circles.
 * Malformed circles are skipped rather than throwing. A candidate that cannot be
 * placed within REED_PLACEMENT_ATTEMPTS tries is skipped, so the field may come
 * back a little short rather than with a clump standing in a keep-out.
 *
 * A junk count falls back to REED_COUNT, a finite count clamps into [0,
 * REED_MAX_COUNT] and floors, and a non-finite seed falls back to REED_SEED. The
 * call never throws and never yields NaN or Infinity, and identical inputs yield
 * bit-identical descriptors.
 */
export function reedSpawns(options = {}) {
  // A null, array or non-object argument must not throw before the field is
  // built, so junk collapses to the empty object and every field defaults.
  const opts = options != null && typeof options === 'object' && !Array.isArray(options)
    ? options
    : {};

  const n = finiteNumber(opts.count)
    ? Math.min(REED_MAX_COUNT, Math.max(0, Math.floor(opts.count)))
    : REED_COUNT;
  const base = finiteNumber(opts.seed) ? opts.seed : REED_SEED;
  const half = clampNumber(opts.worldHalf, 4, 64, REED_DEFAULT_WORLD_HALF);
  // half is at least 4 and the margin is 0.7, so this stays comfortably positive.
  const limit = half - REED_MARGIN;

  // Normalise the keep-outs once, so the inner loop tests only valid circles.
  const circles = [];
  if (Array.isArray(opts.circles)) {
    for (let i = 0; i < opts.circles.length; i += 1) {
      const c = usableCircle(opts.circles[i]);
      if (c != null) circles.push(c);
    }
  }

  const rng = mulberry32(base >>> 0);
  const spawns = [];
  for (let i = 0; i < n; i += 1) {
    // Sample a candidate; a rejected candidate still advances the PRNG, so the
    // stream (and therefore the whole field) stays deterministic for identical
    // inputs even when a keep-out forces a skip.
    for (let attempt = 0; attempt < REED_PLACEMENT_ATTEMPTS; attempt += 1) {
      const x = -limit + rng() * 2 * limit;
      const z = -limit + rng() * 2 * limit;
      if (!placeable(x, z, limit, circles)) continue;
      // 2 + floor(rng * 4) is an integer in [2, 5]; rng() < 1 keeps it at 5 max.
      const stems = REED_MIN_STEMS + Math.floor(rng() * (REED_MAX_STEMS - REED_MIN_STEMS + 1));
      const height = REED_MIN_HEIGHT + rng() * (REED_MAX_HEIGHT - REED_MIN_HEIGHT);
      const lean = REED_MIN_LEAN + rng() * (REED_MAX_LEAN - REED_MIN_LEAN);
      const size = REED_MIN_SIZE + rng() * (REED_MAX_SIZE - REED_MIN_SIZE);
      const tintIndex = Math.min(
        REED_TINTS.length - 1,
        Math.max(0, Math.floor(rng() * REED_TINTS.length))
      );
      const phase = rng();
      spawns.push({
        x,
        z,
        stems,
        height,
        lean,
        size,
        tint: REED_TINTS[tintIndex],
        phase
      });
      break;
    }
  }
  return spawns;
}

/**
 * One stem's sway at `time`, as `{ lean, tip }`.
 *
 * `lean` is the wind offset in radians, a sine of the time with period
 * REED_SWAY_PERIOD and peak amplitude REED_SWAY_AMPLITUDE, so
 * `|lean| <= REED_SWAY_AMPLITUDE` always. `tip` is the same oscillator mapped
 * into [0, 1], describing how far the stem's top has moved from rest, so the
 * world can scale the top vertices of the stem quad by it.
 *
 * Each stem adds a fixed phase offset derived from `stemIndex`, so the stems of
 * one clump never cross zero together. The clump's own spawn `phase` offsets the
 * whole clump from its neighbours. `stemIndex` is floored and clamped into
 * [0, REED_MAX_STEMS - 1]; a non-finite index reads as 0. A non-finite time
 * reads as 0, and a missing, junk or array spawn yields `{ lean: 0, tip: 0 }`,
 * so every returned number is finite.
 */
export function reedStemSway(spawn, stemIndex, time) {
  const t = finiteNumber(time) ? time : 0;
  if (spawn == null || typeof spawn !== 'object' || Array.isArray(spawn)) {
    return { lean: 0, tip: 0 };
  }

  const rawIndex = finiteNumber(stemIndex) ? Math.floor(stemIndex) : 0;
  const stem = Math.min(REED_MAX_STEMS - 1, Math.max(0, rawIndex));
  const phase = finiteNumber(spawn.phase) ? spawn.phase : 0;

  // A fixed per-stem offset spread evenly around the circle, so stems 0..4 sit
  // at five distinct points on the wave and never bend in unison.
  const stemPhase = (stem / REED_MAX_STEMS) * Math.PI * 2;

  // An absurd time divided by the period and multiplied by 2*PI can overflow to
  // Infinity, and sin(Infinity) is NaN; fall back to the phase offsets then.
  let angle = (t / REED_SWAY_PERIOD) * Math.PI * 2 + phase * Math.PI * 2 + stemPhase;
  if (!finiteNumber(angle)) angle = phase * Math.PI * 2 + stemPhase;

  let wave = Math.sin(angle);
  if (!finiteNumber(wave)) wave = 0;

  // Clamp to the documented amplitude, not to unity: the bound test and the
  // stated contract both say the lean never exceeds REED_SWAY_AMPLITUDE.
  const lean = Math.min(
    REED_SWAY_AMPLITUDE,
    Math.max(-REED_SWAY_AMPLITUDE, REED_SWAY_AMPLITUDE * wave)
  );
  const tip = Math.min(1, Math.max(0, (wave + 1) / 2));
  return { lean, tip };
}

/**
 * Whether the reed field runs at this quality tier. The low tier drops the
 * per-frame sway pass and the clump instances, consistent with the quality-tier
 * convention that anything costing a draw call or a per-frame loop is dropped
 * there. Junk reads as the full tier, so an unexpected tier never silently
 * removes the reeds.
 */
export function reedsEnabled(tier) {
  return tier !== 'low';
}
