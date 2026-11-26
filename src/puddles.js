// Where the rainwater puddles lie on the courtyard floor, how big each one is,
// how glossy and how dark it reads at each phase, and how its glint breathes.
//
// The plaza and the lane are paved: a broad, uniformly textured stone surface.
// Dry, that surface is honest but inert -- the eye gets no cue that the ground
// is a real material sitting under a real sky. A scatter of shallow rainwater
// puddles is one of the cheapest realism wins a courtyard can have. Each puddle
// is a flat, darker, glossier patch whose sheen follows the hour: the sun glints
// off it by day, dusk leaves it holding a low bright sky, and at night it goes
// near-black with only a thin sky reflection left in it. The whole scatter is
// one InstancedMesh of flat quads a hair above the paving, so the realism costs
// a single draw call, and this module is the pure half of it. `world.js` will
// only turn these numbers into instance matrices and material factors.
//
// Five decisions are worth the words.
//
// 1. There are eighteen of them by default. The paved square inside the wall
//    margin is roughly 32.8 m on a side, and the fountain carves a 4.2 m disc
//    out of its middle, so eighteen puddles work out at about one per 57 square
//    metres: enough that a walk across the plaza passes several and the ground
//    reads wet, but sparse
//    enough that the paving still reads as paving rather than as a pond. Fewer
//    than a dozen disappears unless you go looking; more than two dozen starts
//    to look like the courtyard has no drainage.
//
// 2. They keep clear of the fountain to PUDDLE_CLEAR_RADIUS. The paving inside
//    that ring is dressed and carved -- a decorative apron around the basin --
//    and a puddle lying across a carved motif reads as a texture bug rather than
//    as weather. The radius is measured from the fountain centre at (0, 0), which
//    is the world origin, so it is one hard test rather than another keep-out
//    the caller must remember to pass.
//
// 3. They sit only PUDDLE_WATER_Y above the paving. A puddle is a film of water
//    lying on stone, not a raised disc, so the quads have to sit above the
//    paving to beat z-fighting but must not float: a centimetre and a bit is
//    enough to win the depth test at the distances the player ever sees, and far
//    too little for the eye to catch the gap from standing height.
//
// 4. The two phase tables mean different things. PUDDLE_PHASE_GLOSS is the
//    reflectivity multiplier: dusk is exactly 1 because a low bright sky is the
//    most a flat water film can mirror, day is 0.55 because a high sun glints
//    only at a grazing angle, and night is 0.75 because the puddle still holds a
//    thin reflection of the sky over the lanterns. PUDDLE_PHASE_DARK is how far
//    the tint is multiplied down: 0.72 by day, 0.62 at dusk and 0.5 at night, so
//    the water reads progressively blacker as the light leaves it. Both are
//    multipliers rather than absolute colours, so the world can apply them to a
//    shared material without rebuilding anything.
//
// 5. Placement is seeded rejection sampling with a skip, not a forced placement.
//    A candidate is accepted only when it is inside the paved square's margin,
//    outside the fountain apron, outside every caller keep-out circle, and at
//    least PUDDLE_SPACING_FACTOR times the larger radius away from every puddle
//    already accepted. If a puddle cannot be placed in PUDDLE_PLACEMENT_ATTEMPTS
//    tries it is skipped, and the field comes back a little short rather than
//    with a puddle clipping the stonework, sitting in the fountain or merging
//    into its neighbour. The count is therefore "up to count"; in practice the
//    free square is so much larger than the puddles that every one is placed.
//
// Everything here is seeded (mulberry32, copied rather than imported so the
// module stands alone) and pure: no Three.js, no DOM, no clock, no Math.random.
// Two identical calls produce bit-identical descriptors, which is what lets a
// saved courtyard match a fresh boot and lets the field be pinned by unit tests.
// Every export is total -- it guards junk input, and no call can produce NaN or
// Infinity.

/** Seed for the puddle generator. Fixed so every run scatters the same water. */
export const PUDDLE_SEED = 0x7b3e2a;

/** How many puddles the courtyard holds by default. Roughly one per 57 m^2 of
 *  the playable square (see the header); one instanced draw call regardless. */
export const PUDDLE_COUNT = 18;

/** Upper clamp on a caller-supplied count, so a typo cannot flood the plaza. */
export const PUDDLE_MAX_COUNT = 120;

/** Smallest puddle half-extent in metres. Below about a quarter metre a flat
 *  quad reads as a smudge on the texture rather than as standing water. */
export const PUDDLE_MIN_RADIUS = 0.25;

/** Largest puddle half-extent in metres. Above about a metre the quad starts to
 *  read as a pool someone would have drained, not as rain left in the joints. */
export const PUDDLE_MAX_RADIUS = 0.9;

/** Keep-out from the border wall in metres. The whole quad, not just its
 *  centre, is kept inside this band (the sampler insets by the puddle's own
 *  radius), so no puddle half-clips the stonework at its widest. */
export const PUDDLE_MARGIN = 0.6;

/** Radius around the fountain centre (0, 0) that puddles must stay outside.
 *  The paving inside this ring is dressed and carved, so rain there would sit
 *  across a motif and read as a bug (see the header). */
export const PUDDLE_CLEAR_RADIUS = 4.2;

/** Height of the water quads above the paving, in metres. Tiny on purpose: just
 *  enough to beat z-fighting, far too little to read as a raised disc. */
export const PUDDLE_WATER_Y = 0.012;

/** How glossy a puddle reads per phase, as a reflectivity multiplier (1 = a
 *  full mirror of the sky, 0 = flat matte). Frozen so a caller cannot mutate it.
 *  Dusk peaks at 1, day is lower under a high sun, night keeps a thin sheen. */
export const PUDDLE_PHASE_GLOSS = Object.freeze({ day: 0.55, dusk: 1, night: 0.75 });

/** How far the puddle tint is multiplied down per phase (1 = full colour, 0 =
 *  black). Frozen. It darkens from day through dusk to night, so the water goes
 *  from merely damp to near-black as the sky's light drains out of it. */
export const PUDDLE_PHASE_DARK = Object.freeze({ day: 0.72, dusk: 0.62, night: 0.5 });

/** Smallest per-puddle scale multiplier. A little variety stops the scatter
 *  reading as one stamped quad; 0.85 is small enough to notice, not to shrink a
 *  puddle below its authored radius. */
export const PUDDLE_MIN_SIZE = 0.85;

/** Largest per-puddle scale multiplier, the upper half of the same band. */
export const PUDDLE_MAX_SIZE = 1.15;

/** Minimum centre spacing is this times the larger of two puddles' radii. 1.6
 *  leaves a visible strip of dry paving between them, so two puddles never merge
 *  into one shapeless wet patch. */
export const PUDDLE_SPACING_FACTOR = 1.6;

/** Seconds for one shimmer cycle. Slow on purpose: a puddle glints, it does not
 *  pulse, so a full breath takes a few seconds rather than a few frames. */
export const PUDDLE_SHIMMER_PERIOD = 3.7;

/** Peak shimmer amplitude. 0.18 is a few percent of a scale or opacity swing --
 *  enough to catch the light, not enough to look like a blinking blob. */
export const PUDDLE_SHIMMER_AMPLITUDE = 0.18;

/** How many candidates each puddle may try before it is skipped. Twenty-four
 *  keeps a crowded keep-out set from spinning, while making it very unlikely
 *  that a puddle with plenty of free square around it is ever dropped. */
const PUDDLE_PLACEMENT_ATTEMPTS = 24;

/** Default half-extent of the playable square, in metres, matching the world's
 *  own extent; used when the caller does not say. */
const PUDDLE_DEFAULT_WORLD_HALF = 17;

/** A small deterministic PRNG (mulberry32). Copied from the other pure modules
 *  rather than imported, so `puddles.js` stays independent of them. */
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
 *  radius. `r` is the canonical field; `radius` is accepted as an alias because
 *  the scatter module already hands out circles shaped that way. */
function usableCircle(circle) {
  if (circle == null || typeof circle !== 'object' || Array.isArray(circle)) return null;
  if (!finiteNumber(circle.x) || !finiteNumber(circle.z)) return null;
  const r = finiteNumber(circle.r) ? circle.r : finiteNumber(circle.radius) ? circle.radius : null;
  if (r == null || r < 0) return null;
  return { x: circle.x, z: circle.z, r };
}

/** True when a candidate puddle may go here: its whole quad, not just its
 *  centre, must clear the fountain apron and every caller keep-out, and its
 *  centre must sit at least PUDDLE_SPACING_FACTOR times the larger radius from
 *  every puddle already placed. Testing the quad rather than the point is what
 *  keeps a wide puddle from lapping over the carved apron or an object's foot.
 *  All comparisons are on squared distances to avoid a sqrt in the inner loop.
 *  Never throws: junk numbers are rejected. */
function placeable(x, z, radius, limit, circles, placed) {
  if (!finiteNumber(x) || !finiteNumber(z) || !finiteNumber(radius)) return false;
  // The whole quad stays inside the margin band, not just its centre, so a wide
  // puddle cannot poke a corner through the wall the way a point test would let
  // it.
  if (Math.abs(x) + radius > limit || Math.abs(z) + radius > limit) return false;
  const clear = PUDDLE_CLEAR_RADIUS + radius;
  if (x * x + z * z < clear * clear) return false;
  for (let i = 0; i < circles.length; i += 1) {
    const c = circles[i];
    const need = c.r + radius;
    const dx = x - c.x;
    const dz = z - c.z;
    if (dx * dx + dz * dz < need * need) return false;
  }
  for (let i = 0; i < placed.length; i += 1) {
    const p = placed[i];
    const need = PUDDLE_SPACING_FACTOR * Math.max(radius, p.radius);
    const dx = x - p.x;
    const dz = z - p.z;
    if (dx * dx + dz * dz < need * need) return false;
  }
  return true;
}

/**
 * The per-phase gloss multiplier. Unknown phase, or a non-string, falls back to
 * the `day` value, because a puddle that suddenly looked like a mirror on a
 * phase id the code has not learned yet would be worse than one that stays
 * merely damp.
 */
export function puddleGloss(phaseId) {
  if (typeof phaseId !== 'string') return PUDDLE_PHASE_GLOSS.day;
  return Object.prototype.hasOwnProperty.call(PUDDLE_PHASE_GLOSS, phaseId)
    ? PUDDLE_PHASE_GLOSS[phaseId]
    : PUDDLE_PHASE_GLOSS.day;
}

/** The per-phase darkness multiplier, with the same day fallback for junk or an
 *  unknown phase id. Lower means the puddle's tint is multiplied further down. */
export function puddleDarkness(phaseId) {
  if (typeof phaseId !== 'string') return PUDDLE_PHASE_DARK.day;
  return Object.prototype.hasOwnProperty.call(PUDDLE_PHASE_DARK, phaseId)
    ? PUDDLE_PHASE_DARK[phaseId]
    : PUDDLE_PHASE_DARK.day;
}

/**
 * The spawn descriptors for the whole field.
 *
 * Each descriptor is `{ x, z, radius, size, phase }`:
 *   - `x` and `z` are metres from the plaza centre, sampled uniformly in the
 *     square [-worldHalf + PUDDLE_MARGIN, worldHalf - PUDDLE_MARGIN];
 *   - `radius` is the flat quad's half-extent in [PUDDLE_MIN_RADIUS,
 *     PUDDLE_MAX_RADIUS];
 *   - `size` is a scale multiplier in [PUDDLE_MIN_SIZE, PUDDLE_MAX_SIZE];
 *   - `phase` is a [0, 1) offset so two puddles never shimmer in lockstep.
 *
 * `options` may carry `count`, `seed`, `worldHalf` (clamped into [4, 64], junk
 * reads as 17) and `circles`, an array of `{ x, z, r }` keep-out circles.
 * Malformed circles are skipped rather than throwing.
 *
 * Returns up to `count` descriptors: a candidate that cannot be placed within
 * PUDDLE_PLACEMENT_ATTEMPTS tries is skipped (see the header). A junk count
 * falls back to PUDDLE_COUNT, a finite count clamps into [0, PUDDLE_MAX_COUNT]
 * and floors, and a non-finite seed falls back to PUDDLE_SEED. The call never
 * throws and never yields NaN or Infinity, and identical inputs yield
 * bit-identical descriptors.
 */
export function puddleSpawns(options = {}) {
  // A null, array or non-object argument must not throw before the field is
  // built, so junk collapses to the empty object and every field defaults.
  const opts = options != null && typeof options === 'object' && !Array.isArray(options)
    ? options
    : {};

  const n = finiteNumber(opts.count)
    ? Math.min(PUDDLE_MAX_COUNT, Math.max(0, Math.floor(opts.count)))
    : PUDDLE_COUNT;
  const base = finiteNumber(opts.seed) ? opts.seed : PUDDLE_SEED;
  const half = clampNumber(opts.worldHalf, 4, 64, PUDDLE_DEFAULT_WORLD_HALF);
  // half is at least 4 and the margin is 0.6, so this stays comfortably positive.
  const limit = half - PUDDLE_MARGIN;

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
    for (let attempt = 0; attempt < PUDDLE_PLACEMENT_ATTEMPTS; attempt += 1) {
      const x = -limit + rng() * 2 * limit;
      const z = -limit + rng() * 2 * limit;
      const radius = PUDDLE_MIN_RADIUS + rng() * (PUDDLE_MAX_RADIUS - PUDDLE_MIN_RADIUS);
      if (!placeable(x, z, radius, limit, circles, spawns)) continue;
      const size = PUDDLE_MIN_SIZE + rng() * (PUDDLE_MAX_SIZE - PUDDLE_MIN_SIZE);
      const phase = rng();
      spawns.push({ x, z, radius, size, phase });
      break;
    }
  }
  return spawns;
}

/**
 * One puddle's glint as `{ wobble }`, a finite number in [-1, 1].
 *
 * The renderer maps it to a tiny scale or opacity modulation. The wobble is a
 * sine of the time with period PUDDLE_SHIMMER_PERIOD (3.7 s) and peak amplitude
 * PUDDLE_SHIMMER_AMPLITUDE (0.18), offset by the spawn's phase so the field
 * does not blink in unison. A puddle is not a pulsing blob, hence the small
 * amplitude. `time` is seconds; a non-finite time reads as 0, and a junk spawn
 * yields wobble 0, so the result is always finite.
 */
export function puddleShimmer(spawn, time) {
  const t = finiteNumber(time) ? time : 0;
  if (spawn == null || typeof spawn !== 'object' || Array.isArray(spawn)) {
    return { wobble: 0 };
  }
  const phase = finiteNumber(spawn.phase) ? spawn.phase : 0;
  // An absurd time divided by the period and multiplied by 2*PI can overflow to
  // Infinity, and sin(Infinity) is NaN; fall back to the phase offset then.
  let angle = (t / PUDDLE_SHIMMER_PERIOD) * Math.PI * 2 + phase * Math.PI * 2;
  if (!finiteNumber(angle)) angle = phase * Math.PI * 2;
  let wobble = PUDDLE_SHIMMER_AMPLITUDE * Math.sin(angle);
  if (!finiteNumber(wobble)) wobble = 0;
  // Clamp to the documented amplitude, not to unity: the bound test and the
  // stated contract both say the wobble never exceeds PUDDLE_SHIMMER_AMPLITUDE.
  return { wobble: Math.min(PUDDLE_SHIMMER_AMPLITUDE, Math.max(-PUDDLE_SHIMMER_AMPLITUDE, wobble)) };
}

/**
 * Whether the puddle field runs at this quality tier.
 *
 * Puddles are one instanced draw call, but their quads are translucent and
 * cover real screen area, and this game is fill-rate bound rather than
 * draw-call bound (see README: halving the pixel count more than doubled the
 * frame rate). A glossy sheet of water is therefore exactly the sort of thing
 * the low tier should lose, so the field is dropped there, consistent with the
 * quality-tier convention. Junk reads as the full tier, so an unexpected tier
 * never silently removes the water.
 */
export function puddlesEnabled(tier) {
  return tier !== 'low';
}
