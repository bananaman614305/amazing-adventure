// Where the wildflower clumps stand in the meadow, how tall and how wide each
// one is, which bloom colour it carries, and how it leans in the breeze --
// decided without a GPU.
//
// The meadow around the courtyard is a broad, even sheet of grass. Green on
// green is honest, but it is also flat: from standing height the eye gets no
// near-field detail to read the ground's scale against, and the field stops
// looking like a meadow and starts looking like a lawn texture. A scatter of
// small wildflower clumps fixes that for almost nothing. Each clump is a few
// blooms on a short stem, tinted from a fixed palette, and the whole scatter is
// one InstancedMesh of cheap quads and stems, so the colour costs a single draw
// call. This module is the pure half of it: `world.js` only turns these numbers
// into instance matrices and material factors.
//
// Five decisions are worth the words.
//
// 1. Ninety clumps is the density that reads as a meadow. The playable square is
//    roughly 34 m on a side and the margin trims the paving edge, so ninety
//    clumps work out at about one per 11 square metres: often enough that a walk
//    crosses colour every few steps, sparse enough that the grass still reads as
//    grass between them. Fewer than fifty disappears at distance; several
//    hundred starts to look sown rather than wild.
//
// 2. They keep clear of the paving by WILDFLOWER_MARGIN. The stone edge is a
//    hard, dressed line, and a flower clump growing through it reads as a
//    clipping bug rather than as wildness. The sampler insets each candidate by
//    its own clump radius as well as the margin, so the whole footprint stays on
//    the grass and no bloom pokes over the kerb.
//
// 3. The palette is five real meadow colours, not a rainbow. Buttercup yellow,
//    cornflower blue, poppy red, a warm white and lavender are what actually
//    grows in a British verge, and holding to those five keeps the scatter
//    coherent: a random hue per clump reads as confetti. The tints are plain hex
//    numbers so the pure module never has to know what a Three.js Color is.
//
// 4. The sway is slow, small, and out of step. WILDFLOWER_SWAY_PERIOD (3.2 s) is
//    about the rhythm of a light breeze, and WILDFLOWER_SWAY_AMPLITUDE (0.06 rad,
//    roughly three and a half degrees) is enough to catch the eye without the
//    field looking like it is being shaken. Each clump carries its own phase
//    offset, and lean and tilt run on different clocks, so a gust does not move
//    the whole meadow as one rigid board.
//
// 5. They dim with the light. WILDFLOWER_PHASE_GLOW keeps the colour full by
//    day, a little softer at dusk and well down at night, so the flowers settle
//    into the dark with the rest of the meadow instead of glowing like paint in
//    moonlight.
//
// Everything here is seeded (mulberry32, copied rather than imported so the
// module stands alone) and pure: no Three.js, no DOM, no clock, no Math.random.
// Two identical calls produce bit-identical descriptors, and every export is
// total -- it guards junk input, and no call can produce NaN or Infinity.

/** Seed for the wildflower generator. Fixed so every run scatters the same
 *  flowers. */
export const WILDFLOWER_SEED = 0x3c9a51;

/** How many clumps the meadow holds by default. About one per 11 m^2 of the
 *  playable square (see the header); one instanced draw call regardless. */
export const WILDFLOWER_COUNT = 90;

/** Upper clamp on a caller-supplied count, so a typo cannot carpet the meadow. */
export const WILDFLOWER_MAX_COUNT = 300;

/** Default half-extent of the playable square, in metres, matching the world's
 *  own extent; used when the caller does not say. */
export const WILDFLOWER_DEFAULT_WORLD_HALF = 17;

/** Keep-out from the paving edge in metres. The whole clump footprint, not just
 *  its centre, is kept inside this band (the sampler insets by the clump's own
 *  radius), so no bloom grows through the kerb. */
export const WILDFLOWER_MARGIN = 0.8;

/** Smallest clump footprint radius in metres. Below about a fifth of a metre a
 *  clump reads as a weed tuft rather than as a stand of flowers. */
export const WILDFLOWER_MIN_RADIUS = 0.22;

/** Largest clump footprint radius in metres. Above about half a metre a clump
 *  starts to read as a shrub and swallows the grass around it. */
export const WILDFLOWER_MAX_RADIUS = 0.55;

/** Lowest bloom height above the ground, in metres. Short, but tall enough to
 *  clear the grass blades the world draws. */
export const WILDFLOWER_MIN_HEIGHT = 0.12;

/** Highest bloom height above the ground, in metres. Knee-high at most, so the
 *  meadow never hides the path or the player's feet. */
export const WILDFLOWER_MAX_HEIGHT = 0.34;

/** Smallest per-clump scale multiplier; stops the scatter reading as one
 *  stamped mesh. */
export const WILDFLOWER_MIN_SIZE = 0.8;

/** Largest per-clump scale multiplier, the upper half of the same band. */
export const WILDFLOWER_MAX_SIZE = 1.2;

/** How strongly the colour shows in each phase, as a multiplier (1 = full
 *  colour, 0 = invisible). Day is full, dusk a little softer, night well down so
 *  the flowers settle into the dark. Frozen so a caller cannot mutate it. */
export const WILDFLOWER_PHASE_GLOW = Object.freeze({ day: 1, dusk: 0.85, night: 0.35 });

/** The bloom palette: buttercup yellow, cornflower blue, poppy red, warm white
 *  and lavender. Five real meadow colours rather than a rainbow (see the
 *  header). Frozen, array and values alike, so a caller cannot recolour the
 *  meadow underneath the renderer. */
export const WILDFLOWER_TINTS = Object.freeze([
  0xf2d24a,
  0x6f8fd6,
  0xd2544a,
  0xf0eee4,
  0xb08ad0
]);

/** Seconds for one full sway cycle. Slow on purpose: a clump bends in a breeze,
 *  it does not vibrate. */
export const WILDFLOWER_SWAY_PERIOD = 3.2;

/** Peak sway in radians (about three and a half degrees). Enough to catch the
 *  eye, far too little to look shaken. Both lean and tilt are bounded by it. */
export const WILDFLOWER_SWAY_AMPLITUDE = 0.06;

/** How many candidates each clump may try before it is skipped. Thirty-two
 *  keeps a crowded keep-out set from spinning, while making it very unlikely
 *  that a clump with plenty of free grass around it is ever dropped. */
const WILDFLOWER_PLACEMENT_ATTEMPTS = 32;

/** A small deterministic PRNG (mulberry32). Copied from the other pure modules
 *  rather than imported, so `wildflowers.js` stays independent of them. */
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

/** Replace a non-finite sine argument with 0, so an absurd time cannot turn a
 *  bounded sway into NaN. */
function safeAngle(value) {
  return Number.isFinite(value) ? value : 0;
}

/** A usable keep-out circle needs finite x and z and a finite, non-negative
 *  radius. `radius` is the canonical field; `r` is accepted as an alias because
 *  the other scatter modules already hand out circles shaped that way. */
function usableCircle(circle) {
  if (circle == null || typeof circle !== 'object' || Array.isArray(circle)) return null;
  if (!finiteNumber(circle.x) || !finiteNumber(circle.z)) return null;
  const radius = finiteNumber(circle.radius)
    ? circle.radius
    : finiteNumber(circle.r)
      ? circle.r
      : null;
  if (radius == null || radius < 0) return null;
  return { x: circle.x, z: circle.z, radius };
}

/** True when a clump may stand here. The whole footprint, not just the centre,
 *  must stay inside the margin band, and the footprint must clear every caller
 *  keep-out circle. Testing the footprint rather than the point is what keeps a
 *  wide clump from growing through the kerb or an object's foot. Comparisons
 *  are on squared distances to avoid a sqrt in the inner loop. Never throws:
 *  junk numbers are rejected. */
function placeable(x, z, radius, limit, circles) {
  if (!finiteNumber(x) || !finiteNumber(z) || !finiteNumber(radius)) return false;
  if (Math.abs(x) + radius > limit || Math.abs(z) + radius > limit) return false;
  for (let i = 0; i < circles.length; i += 1) {
    const c = circles[i];
    const need = c.radius + radius;
    const dx = x - c.x;
    const dz = z - c.z;
    if (dx * dx + dz * dz < need * need) return false;
  }
  return true;
}

/** The per-phase colour multiplier. Unknown phase, or a non-string, falls back
 *  to the `day` value, because a meadow that suddenly dimmed on a phase id the
 *  code has not learned yet would be worse than one that stays full. */
export function wildflowerGlowLevel(phaseId) {
  if (typeof phaseId !== 'string') return WILDFLOWER_PHASE_GLOW.day;
  return Object.prototype.hasOwnProperty.call(WILDFLOWER_PHASE_GLOW, phaseId)
    ? WILDFLOWER_PHASE_GLOW[phaseId]
    : WILDFLOWER_PHASE_GLOW.day;
}

/**
 * The spawn descriptors for the whole meadow.
 *
 * Each descriptor is `{ x, z, size, height, tint, phase, sway }`:
 *   - `x` and `z` are metres from the plaza centre, sampled uniformly in the
 *     square [-limit, limit] where `limit = worldHalf - WILDFLOWER_MARGIN`,
 *     then rejected unless the clump's whole footprint clears the margin band;
 *   - `size` is a scale multiplier in [WILDFLOWER_MIN_SIZE,
 *     WILDFLOWER_MAX_SIZE];
 *   - `height` is the bloom height above the ground in [WILDFLOWER_MIN_HEIGHT,
 *     WILDFLOWER_MAX_HEIGHT];
 *   - `tint` is one of the WILDFLOWER_TINTS hex values;
 *   - `phase` is a [0, 1) offset that keeps neighbouring clumps out of step in
 *     the sway;
 *   - `sway` is a second [0, 1) offset, used so lean and tilt do not share one
 *     clock.
 *
 * `options` may carry `count`, `seed`, `worldHalf` (clamped into [4, 64], junk
 * reads as WILDFLOWER_DEFAULT_WORLD_HALF) and `circles`, an array of
 * `{ x, z, radius }` keep-out circles. Malformed circles are skipped rather
 * than throwing.
 *
 * Placement is seeded rejection sampling: a candidate is accepted only when it
 * clears the margin band and every keep-out. If a clump cannot be placed in
 * WILDFLOWER_PLACEMENT_ATTEMPTS tries it is skipped, so the field can come back
 * a little short rather than with a clump on the paving. A junk count falls back
 * to WILDFLOWER_COUNT, a finite count clamps into [0, WILDFLOWER_MAX_COUNT] and
 * floors, and a non-finite seed falls back to WILDFLOWER_SEED. The call never
 * throws and never yields NaN or Infinity, and identical inputs yield
 * bit-identical descriptors.
 */
export function wildflowerSpawns(options = {}) {
  // A null, array or non-object argument must not throw before the field is
  // built, so junk collapses to the empty object and every field defaults.
  const opts = options != null && typeof options === 'object' && !Array.isArray(options)
    ? options
    : {};

  // A non-finite count is junk, not a clamp target: NaN and Infinity fall back to
  // the authored count, while a finite but absurd value clamps to the ceiling.
  const n = finiteNumber(opts.count)
    ? Math.min(WILDFLOWER_MAX_COUNT, Math.max(0, Math.floor(opts.count)))
    : WILDFLOWER_COUNT;
  const base = finiteNumber(opts.seed) ? opts.seed : WILDFLOWER_SEED;
  const half = clampNumber(opts.worldHalf, 4, 64, WILDFLOWER_DEFAULT_WORLD_HALF);
  // half is at least 4 and the margin is 0.8, so the limit stays positive.
  const limit = half - WILDFLOWER_MARGIN;

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
    // A rejected candidate still advances the PRNG, so the stream (and therefore
    // the whole meadow) stays deterministic for identical inputs even when a
    // keep-out forces a skip.
    for (let attempt = 0; attempt < WILDFLOWER_PLACEMENT_ATTEMPTS; attempt += 1) {
      const x = -limit + rng() * 2 * limit;
      const z = -limit + rng() * 2 * limit;
      // The footprint radius decides whether the whole clump clears the kerb and
      // the keep-outs; it is not exposed because the renderer scales its authored
      // mesh by `size`, but it must be drawn before acceptance so the PRNG stream
      // stays identical for identical inputs.
      const radius = WILDFLOWER_MIN_RADIUS + rng() * (WILDFLOWER_MAX_RADIUS - WILDFLOWER_MIN_RADIUS);
      if (!placeable(x, z, radius, limit, circles)) continue;

      const size = WILDFLOWER_MIN_SIZE + rng() * (WILDFLOWER_MAX_SIZE - WILDFLOWER_MIN_SIZE);
      const height = WILDFLOWER_MIN_HEIGHT + rng() * (WILDFLOWER_MAX_HEIGHT - WILDFLOWER_MIN_HEIGHT);
      // rng() is in [0, 1), so this index is always in range; the clamp is belt
      // and braces against a future change to the draw.
      const tintIndex = Math.min(
        WILDFLOWER_TINTS.length - 1,
        Math.floor(rng() * WILDFLOWER_TINTS.length)
      );
      const phase = rng();
      const sway = rng();
      spawns.push({ x, z, size, height, tint: WILDFLOWER_TINTS[tintIndex], phase, sway });
      break;
    }
  }
  return spawns;
}

/**
 * One clump's bend at `time`, as `{ lean, tilt }` in radians.
 *
 * Lean is a sine at WILDFLOWER_SWAY_PERIOD offset by the spawn's `phase`; tilt
 * runs at half that frequency offset by `sway`, so the two axes do not move as
 * one rigid stick. Both are bounded by WILDFLOWER_SWAY_AMPLITUDE, so the renderer
 * can apply them straight to the instance rotation without a further clamp.
 *
 * `time` is seconds; a non-finite time reads as 0. A missing, junk or array
 * spawn returns `{ lean: 0, tilt: 0 }`, and a spawn with junk offsets is read
 * with those offsets as 0. An absurd time that would overflow the sine argument
 * is detected and read as 0, so every returned number is finite.
 */
export function wildflowerSway(spawn, time) {
  const t = finiteNumber(time) ? time : 0;
  if (spawn == null || typeof spawn !== 'object' || Array.isArray(spawn)) {
    return { lean: 0, tilt: 0 };
  }
  const phase = finiteNumber(spawn.phase) ? spawn.phase : 0;
  const sway = finiteNumber(spawn.sway) ? spawn.sway : 0;

  const base = safeAngle((t / WILDFLOWER_SWAY_PERIOD) * Math.PI * 2);
  const leanAngle = safeAngle(base + phase * Math.PI * 2);
  const tiltAngle = safeAngle(base * 0.5 + sway * Math.PI * 2);

  let lean = WILDFLOWER_SWAY_AMPLITUDE * Math.sin(leanAngle);
  let tilt = WILDFLOWER_SWAY_AMPLITUDE * Math.sin(tiltAngle);
  if (!finiteNumber(lean)) lean = 0;
  if (!finiteNumber(tilt)) tilt = 0;
  // Clamp to the documented amplitude, not to unity: the bound test and the
  // stated contract both say the sway never exceeds WILDFLOWER_SWAY_AMPLITUDE.
  return {
    lean: Math.min(WILDFLOWER_SWAY_AMPLITUDE, Math.max(-WILDFLOWER_SWAY_AMPLITUDE, lean)),
    tilt: Math.min(WILDFLOWER_SWAY_AMPLITUDE, Math.max(-WILDFLOWER_SWAY_AMPLITUDE, tilt))
  };
}

/** Whether the wildflower field runs at this quality tier.
 *
 * The field is one instanced draw call, but its quads are translucent and cover
 * real screen area, and this game is fill-rate bound rather than draw-call bound
 * (see README: halving the pixel count more than doubled the frame rate). The
 * low tier therefore drops the flowers, consistent with the quality-tier
 * convention. Junk reads as the full tier, so an unexpected tier never silently
 * empties the meadow.
 */
export function wildflowersEnabled(tier) {
  return tier !== 'low';
}
