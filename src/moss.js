// Where the damp moss grows on the courtyard's stone -- at the foot of the
// boundary walls and along the paving seams -- how big each patch is, which way
// its long axis runs, and how dark and how lit it reads at each phase.
//
// A courtyard cut from fresh stone reads as a model: every edge is sharp, every
// face the same colour, and the eye gets no sign that weather has touched it.
// Moss is the cheapest honest cue that the masonry is old. A handful of soft
// green patches gathered where damp actually collects -- against the walls and
// in the joints between paving stones -- breaks up the flat grey without a
// texture rebuild, and because the whole scatter can be one InstancedMesh of
// flat quads it costs a single draw call. This module is the pure half: it
// decides positions, sizes, orientations, tints and phase response; `world.js`
// turns those numbers into instance matrices and material factors.
//
// Four decisions are worth the words.
//
// 1. Forty patches is enough to read as neglect, not as a lawn. The paved
//    square is roughly 33 m on a side and the wall line adds another 130 m or
//    so of foot; forty patches works out at a few per wall run and a thin
//    scatter across the paving. Fewer than two dozen disappears into the
//    texture unless the player walks the perimeter; more than about sixty turns
//    the stonework green and stops reading as damp.
//
// 2. Most moss grows where the water runs. About two thirds of the patches hug
//    a boundary wall (MOSS_WALL_HUG_CHANCE), set a little way off the line on
//    the inside, because rain sheets down the wall and pools at its foot. The
//    rest scatter across the open paving, rejected only where a caller has put
//    something the moss must not cover. The wall-hugging patches carry their
//    long axis parallel to the wall, which is both how moss creeps along a
//    damp joint and what makes the placement legible as "at the wall" rather
//    than as a random blob that happens to be nearby.
//
// 3. A third of the patches are seam strips, not round blobs. Moss in a paving
//    joint is a long, thin, dark-green line, and drawing it as a circle would
//    miss the one shape that says "joint". MOSS_SEAM_CHANCE of the patches are
//    therefore long thin strips with a length from MOSS_SEAM_MIN_LENGTH to
//    MOSS_SEAM_MAX_LENGTH and a width of MOSS_SEAM_WIDTH; the rest are round
//    patches, squashed along their own axis by a stretch factor so no two read
//    as the same stamped disc. `seam` tells the world which shape to build and
//    `length` is zero for a round patch, so the renderer branches once.
//
// 4. The phase tables are multipliers, not colours. MOSS_PHASE_DARKNESS says
//    how far the tint is multiplied down (0 = no darkening, 1 = fully dark),
//    and it rises from day through dusk to night because wet stone keeps its
//    colour as the light drains out of it. MOSS_PHASE_GLOW is the opposite
//    reading -- how much of the moss's own soft green survives each phase -- and
//    it falls from a full day value to half at night. Both are frozen tables so
//    a caller cannot mutate them, and both fall back to `day` for a phase id the
//    code has not learned yet, because a moss patch that suddenly vanished on an
//    unknown phase would be worse than one that simply stayed ordinary.
//
// Everything here is seeded (mulberry32, copied rather than imported so the
// module stands alone) and pure: no Three.js, no DOM, no clock, no Math.random.
// Two identical calls produce bit-identical descriptors, which is what lets a
// saved courtyard match a fresh boot and lets the field be pinned by unit tests.
// Every export is total -- it guards junk input, and no call can produce NaN or
// Infinity.

/** Seed for the moss generator. Fixed so every run grows the same patches. */
export const MOSS_SEED = 0x6d4f2b;

/** How many moss patches the courtyard holds by default. See the header for why
 *  forty reads as neglect rather than as a lawn; one instanced draw call
 *  regardless. */
export const MOSS_COUNT = 40;

/** Upper clamp on a caller-supplied count, so a typo cannot carpet the plaza. */
export const MOSS_MAX_COUNT = 160;

/** Smallest round-patch half-extent in metres. Below about 0.18 m a patch reads
 *  as a speck of dirt rather than as a colony of moss. */
export const MOSS_MIN_RADIUS = 0.18;

/** Largest round-patch half-extent in metres. Above about 0.55 m the patch stops
 *  reading as a damp stain and starts reading as a shrub. */
export const MOSS_MAX_RADIUS = 0.55;

/** How far the moss tint is multiplied down per phase (0 = no darkening, 1 =
 *  fully dark). Frozen so a caller cannot mutate it. Wet stone darkens as the
 *  light leaves it, so night is the darkest reading. */
export const MOSS_PHASE_DARKNESS = Object.freeze({ day: 0.55, dusk: 0.7, night: 0.85 });

/** How much of the moss's own green survives per phase (1 = full colour, 0 =
 *  none). Frozen. It falls from day through dusk to night, because moss is the
 *  first thing to lose its colour when the sun goes. */
export const MOSS_PHASE_GLOW = Object.freeze({ day: 1, dusk: 0.9, night: 0.5 });

/** The mossy greens a patch may take, as packed 0xRRGGBB values. Four close but
 *  distinguishable greens keep the scatter from reading as one flat colour
 *  without letting it drift into lawn or lichen. Frozen, so a caller cannot
 *  mutate the palette out from under the field. */
export const MOSS_TINTS = Object.freeze([0x3f5a2e, 0x4c6a35, 0x35502a, 0x56703c]);

/** Probability that a patch is a long thin seam strip rather than a round
 *  patch. About a third of the field, matching how often moss runs along a
 *  paving joint instead of pooling in a patch. */
export const MOSS_SEAM_CHANCE = 0.35;

/** Shortest seam strip, in metres. Below about half a metre the strip reads as a
 *  round patch that has been stretched by mistake. */
export const MOSS_SEAM_MIN_LENGTH = 0.5;

/** Longest seam strip, in metres. Above about 1.6 m the strip starts to look
 *  like a painted line rather than moss in a joint. */
export const MOSS_SEAM_MAX_LENGTH = 1.6;

/** Width of a seam strip, in metres. A paving joint is a narrow line, so the
 *  strip is deliberately much thinner than any round patch. */
export const MOSS_SEAM_WIDTH = 0.07;

/** Smallest stretch multiplier for a round patch's long axis. A little squash
 *  stops the scatter reading as one stamped disc. */
export const MOSS_MIN_STRETCH = 0.75;

/** Largest stretch multiplier for a round patch's long axis, the upper half of
 *  the same band. */
export const MOSS_MAX_STRETCH = 1.25;

/** Probability that a patch hugs a boundary wall rather than scattering across
 *  the open paving. About two thirds, because rain sheets down the wall and
 *  pools at its foot (see the header). */
export const MOSS_WALL_HUG_CHANCE = 0.65;

/** How many candidates each patch may try before it is skipped. Twenty-four
 *  keeps a crowded keep-out set from spinning, while making it very unlikely
 *  that a patch with plenty of free stone around it is ever dropped. */
const MOSS_PLACEMENT_ATTEMPTS = 24;

/** Default half-extent of the playable square, in metres, matching the world's
 *  own extent; used when the caller does not say. */
const MOSS_DEFAULT_WORLD_HALF = 17;

/** Keep-out from the edge of the playable square for a scattered patch, in
 *  metres. Wall-hugging patches sit inside the wall line by their own offset and
 *  are not pushed through this margin, so this only keeps the open-paving
 *  scatter from hanging off the edge. */
const MOSS_MARGIN = 0.3;

/** Nearest a wall-hugging patch may sit to its wall line, in metres. Closer than
 *  this and the patch would sit on top of the stonework rather than at its foot. */
const MOSS_WALL_MIN_OFFSET = 0.15;

/** Farthest a wall-hugging patch may sit from its wall line, in metres. Farther
 *  and it stops reading as gathered at the wall. */
const MOSS_WALL_MAX_OFFSET = 0.7;

/** A small deterministic PRNG (mulberry32). Copied from the other pure modules
 *  rather than imported, so `moss.js` stays independent of them. */
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
 *  radius. `radius` is the canonical field; `r` is accepted as an alias because
 *  the scatter module already hands out circles shaped that way. */
function usableCircle(circle) {
  if (circle == null || typeof circle !== 'object' || Array.isArray(circle)) return null;
  if (!finiteNumber(circle.x) || !finiteNumber(circle.z)) return null;
  const r = finiteNumber(circle.radius)
    ? circle.radius
    : finiteNumber(circle.r) ? circle.r : null;
  if (r == null || r < 0) return null;
  return { x: circle.x, z: circle.z, radius: r };
}

/** A usable wall segment needs a known axis and three finite numbers. A reversed
 *  span is normalised by swapping its ends rather than rejected, because a
 *  caller that wrote `from` and `to` the other way round still meant a wall. A
 *  zero-length span is junk: there is no line to hug. */
function usableWall(wall) {
  if (wall == null || typeof wall !== 'object' || Array.isArray(wall)) return null;
  if (wall.axis !== 'x' && wall.axis !== 'z') return null;
  if (!finiteNumber(wall.at) || !finiteNumber(wall.from) || !finiteNumber(wall.to)) return null;
  const from = Math.min(wall.from, wall.to);
  const to = Math.max(wall.from, wall.to);
  if (to - from <= 0) return null;
  return { axis: wall.axis, at: wall.at, from, to };
}

/** True when a patch's centre is close enough to a keep-out that the patch, not
 *  just its centre, would overlap. Tested on squared distances to keep the inner
 *  loop free of a sqrt. Never throws: the circles are already normalised. */
function insideCircle(x, z, radius, circles) {
  for (let i = 0; i < circles.length; i += 1) {
    const c = circles[i];
    const need = c.radius + radius;
    const dx = x - c.x;
    const dz = z - c.z;
    if (dx * dx + dz * dz < need * need) return true;
  }
  return false;
}

/** Pick a point at the foot of `wall`, on its inside, and the long-axis angle
 *  parallel to the wall. For a wall on the positive side of the origin the
 *  inside is the negative side, and the other way round; a wall through the
 *  origin has no obvious inside, so a seeded coin picks a side. The along-wall
 *  coordinate is a uniform draw inside the segment. The angle is measured from
 *  +x toward +z: a wall running along x gives 0, a wall running along z gives
 *  PI/2. */
function wallCandidate(wall, rng) {
  const offset = MOSS_WALL_MIN_OFFSET
    + rng() * (MOSS_WALL_MAX_OFFSET - MOSS_WALL_MIN_OFFSET);
  let sign;
  if (wall.at > 0) sign = -1;
  else if (wall.at < 0) sign = 1;
  else sign = rng() < 0.5 ? -1 : 1;
  const along = wall.from + rng() * (wall.to - wall.from);
  if (wall.axis === 'x') {
    // The wall line is x = at and it runs along z, so the long axis is z.
    return { x: wall.at + sign * offset, z: along, angle: Math.PI / 2 };
  }
  // The wall line is z = at and it runs along x, so the long axis is x.
  return { x: along, z: wall.at + sign * offset, angle: 0 };
}

/**
 * The per-phase darkness multiplier. Unknown phase, or a non-string, falls back
 * to the `day` value, because a patch that suddenly went black on a phase id
 * the code has not learned yet would be worse than one that stays merely damp.
 * Higher means the tint is multiplied further down.
 */
export function mossDarkness(phaseId) {
  if (typeof phaseId !== 'string') return MOSS_PHASE_DARKNESS.day;
  return Object.prototype.hasOwnProperty.call(MOSS_PHASE_DARKNESS, phaseId)
    ? MOSS_PHASE_DARKNESS[phaseId]
    : MOSS_PHASE_DARKNESS.day;
}

/**
 * The per-phase glow multiplier, with the same `day` fallback for junk or an
 * unknown phase id. This is how much of the moss's own green survives the hour,
 * so it is the complement of `mossDarkness` rather than a second copy of it.
 */
export function mossGlowLevel(phaseId) {
  if (typeof phaseId !== 'string') return MOSS_PHASE_GLOW.day;
  return Object.prototype.hasOwnProperty.call(MOSS_PHASE_GLOW, phaseId)
    ? MOSS_PHASE_GLOW[phaseId]
    : MOSS_PHASE_GLOW.day;
}

/**
 * The spawn descriptors for the whole field.
 *
 * Each descriptor is `{ x, z, radius, stretch, angle, tint, seam, length }`:
 *   - `x` and `z` are metres from the plaza centre;
 *   - `radius` is the patch's nominal half-extent in [MOSS_MIN_RADIUS,
 *     MOSS_MAX_RADIUS], always present even when `seam` is true (a seam strip's
 *     short axis is MOSS_SEAM_WIDTH, so the world ignores `radius` for it);
 *   - `stretch` is a long-axis squash multiplier in [MOSS_MIN_STRETCH,
 *     MOSS_MAX_STRETCH], used by round patches;
 *   - `angle` is the direction of the long axis in radians from +x toward +z, in
 *     [0, 2*PI) for a scattered patch and exactly 0 or PI/2 for a wall-hugging
 *     one, parallel to its wall;
 *   - `tint` is one of MOSS_TINTS;
 *   - `seam` is true for a long thin strip and false for a round patch;
 *   - `length` is the strip's long dimension in [MOSS_SEAM_MIN_LENGTH,
 *     MOSS_SEAM_MAX_LENGTH] when `seam` is true, and exactly 0 otherwise.
 *
 * `options` may carry `count` (clamped into [0, MOSS_MAX_COUNT] and floored),
 * `seed`, `worldHalf` (clamped into [4, 64], junk reads as 17), `walls` (an
 * array of `{ axis: 'x' | 'z', at, from, to }` segments) and `circles` (an array
 * of `{ x, z, radius }` keep-out circles). Malformed walls and circles are
 * skipped rather than throwing. With no usable wall the whole field scatters
 * across the open paving; with walls available about MOSS_WALL_HUG_CHANCE of the
 * patches hug one, and the rest scatter with seeded rejection against the
 * keep-out circles.
 *
 * A junk `count` falls back to MOSS_COUNT, a non-finite `seed` falls back to
 * MOSS_SEED, and junk options collapse to the defaults. A candidate that cannot
 * be placed within MOSS_PLACEMENT_ATTEMPTS tries is skipped, so the field can
 * come back a little short of `count` rather than placing a patch inside a
 * keep-out. The call never throws and never yields NaN or Infinity, and
 * identical inputs yield bit-identical descriptors.
 */
export function mossSpawns(options = {}) {
  // A null, array or non-object argument must not throw before the field is
  // built, so junk collapses to the empty object and every field defaults.
  const opts = options != null && typeof options === 'object' && !Array.isArray(options)
    ? options
    : {};

  const n = finiteNumber(opts.count)
    ? Math.min(MOSS_MAX_COUNT, Math.max(0, Math.floor(opts.count)))
    : MOSS_COUNT;
  const base = finiteNumber(opts.seed) ? opts.seed : MOSS_SEED;
  const half = clampNumber(opts.worldHalf, 4, 64, MOSS_DEFAULT_WORLD_HALF);
  const limit = Math.max(0, half - MOSS_MARGIN);

  // Normalise the walls and keep-outs once, so the inner loop tests only valid
  // entries and a junk array element costs nothing per candidate.
  const walls = [];
  if (Array.isArray(opts.walls)) {
    for (let i = 0; i < opts.walls.length; i += 1) {
      const w = usableWall(opts.walls[i]);
      if (w != null) walls.push(w);
    }
  }
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
    // The wall-versus-scatter decision is made once per patch, not per attempt,
    // so a wall patch that is blocked by a keep-out retries another spot on a
    // wall instead of silently turning into a paving patch. With no usable wall
    // the coin is not flipped at all, so the PRNG stream (and therefore the
    // field) is the same as if `walls` had been omitted.
    const hugWall = walls.length > 0 && rng() < MOSS_WALL_HUG_CHANCE;
    for (let attempt = 0; attempt < MOSS_PLACEMENT_ATTEMPTS; attempt += 1) {
      const radius = MOSS_MIN_RADIUS
        + rng() * (MOSS_MAX_RADIUS - MOSS_MIN_RADIUS);
      let x;
      let z;
      let angle;
      if (hugWall) {
        const index = Math.min(
          walls.length - 1,
          Math.max(0, Math.floor(rng() * walls.length))
        );
        const candidate = wallCandidate(walls[index], rng);
        x = candidate.x;
        z = candidate.z;
        angle = candidate.angle;
      } else {
        x = -limit + rng() * 2 * limit;
        z = -limit + rng() * 2 * limit;
        angle = rng() * Math.PI * 2;
      }

      // A rejected candidate still advances the PRNG, so the stream (and the
      // whole field) stays deterministic for identical inputs even when a
      // keep-out forces a skip.
      if (!finiteNumber(x) || !finiteNumber(z) || !finiteNumber(angle)) continue;
      if (insideCircle(x, z, radius, circles)) continue;

      // The shape and colour are drawn only once a spot is accepted, so a
      // skipped candidate does not bias the seam fraction or the palette.
      const seam = rng() < MOSS_SEAM_CHANCE;
      const stretch = MOSS_MIN_STRETCH
        + rng() * (MOSS_MAX_STRETCH - MOSS_MIN_STRETCH);
      const length = seam
        ? MOSS_SEAM_MIN_LENGTH + rng() * (MOSS_SEAM_MAX_LENGTH - MOSS_SEAM_MIN_LENGTH)
        : 0;
      const tintIndex = Math.min(
        MOSS_TINTS.length - 1,
        Math.max(0, Math.floor(rng() * MOSS_TINTS.length))
      );
      spawns.push({
        x,
        z,
        radius,
        stretch,
        angle,
        tint: MOSS_TINTS[tintIndex],
        seam,
        length
      });
      break;
    }
  }
  return spawns;
}

/**
 * Whether the moss field runs at this quality tier.
 *
 * Moss is one instanced draw call, but its quads are translucent and cover real
 * screen area, and this game is fill-rate bound rather than draw-call bound (see
 * README: halving the pixel count more than doubled the frame rate). A scatter
 * of soft green patches is therefore exactly the sort of thing the low tier
 * should lose, so the field is dropped there, consistent with the quality-tier
 * convention. Junk reads as the full tier, so an unexpected tier never silently
 * removes the moss.
 */
export function mossEnabled(tier) {
  return tier !== 'low';
}
