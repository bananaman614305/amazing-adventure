// Where the tile courses lie on every roof plane in the plaza and the lane,
// decided without a GPU.
//
// The plaza's roofs carry one roof texture stretched across each sloping
// surface. A single texture on a single quad has no thickness and no break: the
// eave is a ruler-straight edge, the surface has one tone, and the eye reads a
// painted lid rather than a roof. Real tile roofs show courses of overlapping
// shingles, each course stepped up from the one below, each shingle a slightly
// different shade, and the eave a broken line where individual tiles end.
// `world.js` will render one thin instanced strip per shingle; this module
// decides where every strip goes, how wide it is, how bright and how far it is
// tilted, and knows nothing about Three.js.
//
// The caller supplies the roof planes -- `{ x, z, y, width, depth, yaw, pitch }`
// -- so the module carries no map of the world. (x, z) is the plane's centre, y
// its height, width and depth its footprint in metres, yaw its rotation about Y
// and pitch its rise over run. A positive pitch tips the far edge down, so the
// far edge is the eave and courses climb from it towards the near edge. A
// negative or junk pitch is read as flat rather than folding the roof the other
// way; a roof that falls away from its own ridge is a bug, not a design.
//
// The numbers worth the words:
//
// 1. A course is 0.26 m of run. That is about the pitch of a small slate or
//    peg-tile roof, and at the plaza's scale it reads as tile courses rather
//    than as planks. Fourteen courses cover 3.64 m, deeper than any roof plane
//    in the scene, so the per-plane clamp bounds the work without truncating a
//    real roof.
//
// 2. A course's visible strip is 90% of the course height. The missing 10% --
//    about 2.6 cm -- lets the roof plane show between courses as a shadow line,
//    and keeps two strips from sharing an edge that would z-fight. The strip is
//    also lifted SHINGLE_LIFT above the plane; at 12 mm that is above the depth
//    buffer's resolution at eye distance, and well below the 26 mm course pitch,
//    so a course overlaps the one below rather than hovering over it.
//
//    Courses are spaced 0.26 m apart in HORIZONTAL run, because `v` is the
//    plane's horizontal footprint and `depth` its horizontal extent. On a
//    pitched roof the distance a strip travels along the slope is
//    `0.26 * sqrt(1 + pitch^2)` -- 0.295 m on the house's 0.533 pitch -- so a
//    strip sized 0.9 * 0.26 and left untilted would cover only 79% of its
//    course and the roof would read as widely spaced battens. The descriptor's
//    `depth` is therefore the visible height measured ALONG THE SLOPE,
//    `0.9 * 0.26 * sqrt(1 + pitch^2)`, which is exactly the 0.9 * 0.26 the
//    untilted case used once the strip is tilted back to horizontal: the
//    horizontal footprint of every strip is unchanged, and so is the 10% gap.
//
// 3. Shingles are 0.5 to 1.1 m long along a course. Narrower than half a metre
//    aliases into a stripe at courtyard distance; wider than 1.1 m stops reading
//    as one tile and loses the tone break. Each course's last shingle is clipped
//    to fit exactly, which is what makes the run end on the plane's edge instead
//    of overshooting it.
//
// 4. Each shingle's tone is a brightness multiplier in 0.86..1.06. The band is
//    deliberately narrow: enough to break a single flat colour into individual
//    tiles, not so wide that the roof looks patched with different materials.
//    Values above 1 catch a little sun on a raised tile.
//
// 5. Widths are drawn independently per course, so the vertical seams stagger
//    from course to course and the seams of the bottom course break the eave
//    into a stepped line rather than a ruler edge. That staggering, not a
//    per-shingle height jitter, is what gives the silhouette its step while
//    keeping every course's y exactly even.
//
// Everything here is seeded (mulberry32, copied rather than imported so the
// module stands alone) and pure: no Three.js, no DOM, no clock, no Math.random.
// Two identical calls lay out identical shingles, and the layout can be pinned
// by unit tests. Every export is total: junk planes are skipped, junk numbers
// are clamped, and no call can produce NaN or Infinity.

/** Seed for the shingle generator. Fixed so every run lays out the same tiles. */
export const SHINGLE_SEED = 0x6d1f3a;

/** Height of one course of tiles, in metres of run up the roof. A slate or
 *  peg-tile course on a small building is roughly a quarter of a metre; 0.26
 *  reads as courses rather than planks at the plaza's scale. */
export const SHINGLE_COURSE_HEIGHT = 0.26;

/** Upper clamp on the courses laid on one plane. Fourteen courses cover 3.64 m,
 *  deeper than any roof plane in the scene, so this bounds the work without
 *  truncating a real roof. */
export const SHINGLE_COURSES_PER_PLANE = 14;

/** Length of the shortest shingle along a course, in metres. Below about half a
 *  metre a shingle aliases into a stripe at courtyard distance. */
export const SHINGLE_MIN_WIDTH = 0.5;

/** Length of the longest shingle along a course, in metres. Above 1.1 m one
 *  shingle spans enough of the roof to stop reading as a tile, and the tone
 *  break that makes the courses visible is lost. */
export const SHINGLE_MAX_WIDTH = 1.1;

/** How far a course sits above the plane's own surface, in metres. A strip laid
 *  exactly on the plane would z-fight the roof texture; 12 mm clears the depth
 *  buffer at eye distance while staying well under the 26 mm course pitch, so a
 *  course still overlaps the one below rather than visibly hovering. */
export const SHINGLE_LIFT = 0.012;

/** Darkest per-shingle brightness multiplier. Enough to read a tile as its own
 *  piece without the roof looking patched. */
export const SHINGLE_MIN_TONE = 0.86;

/** Brightest per-shingle brightness multiplier. Slightly above 1 so a raised
 *  tile can catch a little sun. */
export const SHINGLE_MAX_TONE = 1.06;

/**
 * Per-phase multiplier applied to the shingles' colour. A roof is lit by the
 * sky, so it is brightest by day, dims a little at dusk as the light warms and
 * falls, and drops to a dark shape at night without going fully black. The
 * values are multipliers, not absolute colours, so the world can apply them
 * without rebuilding buffers.
 */
export const SHINGLE_PHASE_GLOW = Object.freeze({
  day: 1,
  dusk: 0.8,
  night: 0.4
});

/** Fraction of a course's height that its strip covers. The 10% left over is
 *  the shadow gap that shows the plane between courses and keeps neighbouring
 *  strips from sharing an edge. */
const SHINGLE_VISIBLE_FRACTION = 0.9;

/** Largest plane width the module will lay out, in metres. A typo in `width`
 *  should not ask for a million shingles; 200 m is far beyond any roof here and
 *  still a bounded amount of work. */
const SHINGLE_MAX_PLANE_WIDTH = 200;

/** Largest plane depth the module will lay out, in metres. The course clamp
 *  already bounds the rows, but a finite depth keeps the pitch arithmetic and
 *  the footprint offsets away from overflow. */
const SHINGLE_MAX_PLANE_DEPTH = 40;

/** Largest pitch the module honours, as rise over run (~50 degrees). Steeper
 *  than this is a wall, not a roof, and is clamped rather than believed. */
const SHINGLE_MAX_PITCH = 1.2;

/** Smallest plane dimension worth shingling, in metres. Anything under a
 *  micrometre is junk rather than a roof. */
const SHINGLE_MIN_PLANE = 1e-6;

/** A small deterministic PRNG (mulberry32). Copied from the other pure modules
 *  rather than imported, so `shingles.js` stays independent of them. */
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

/**
 * A usable roof plane, or null. The position, height, width and depth are
 * required to be finite, and width and depth to be positive: a plane without a
 * real footprint cannot carry courses, and a shingle placed from one would hang
 * in the air. `yaw` and `pitch` are allowed to be junk and default to 0, because
 * an unrotated, flat roof is a sensible reading of a missing angle, while a
 * missing centre is not. Width and depth are clamped to the module's maxima so
 * an absurd number cannot ask for unbounded work.
 */
function usablePlane(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!finiteNumber(raw.x) || !finiteNumber(raw.z) || !finiteNumber(raw.y)) return null;
  if (!finiteNumber(raw.width) || !finiteNumber(raw.depth)) return null;
  if (raw.width <= 0 || raw.depth <= 0) return null;

  const width = Math.min(SHINGLE_MAX_PLANE_WIDTH, raw.width);
  const depth = Math.min(SHINGLE_MAX_PLANE_DEPTH, raw.depth);
  if (width < SHINGLE_MIN_PLANE || depth < SHINGLE_MIN_PLANE) return null;

  const yaw = finiteNumber(raw.yaw) ? raw.yaw : 0;
  // A roof slopes down from its ridge; a negative pitch would fold it the wrong
  // way, so it is read as flat rather than followed.
  const pitch = clampNumber(raw.pitch, 0, SHINGLE_MAX_PITCH, 0);

  return { x: raw.x, z: raw.z, y: raw.y, width, depth, yaw, pitch };
}

/** The per-phase glow multiplier. Unknown phase, or a non-string, falls back to
 *  the `day` value (1), so a new phase id can never darken the roofs by
 *  accident. */
export function shingleGlowLevel(phaseId) {
  if (typeof phaseId !== 'string') return SHINGLE_PHASE_GLOW.day;
  return Object.prototype.hasOwnProperty.call(SHINGLE_PHASE_GLOW, phaseId)
    ? SHINGLE_PHASE_GLOW[phaseId]
    : SHINGLE_PHASE_GLOW.day;
}

/** Read `maxCourses` once: junk falls back to the clamp, a finite value floors
 *  into [1, SHINGLE_COURSES_PER_PLANE]. The floor of 1 means a caller asking for
 *  zero still gets a single course on a real roof, which is a visible mistake
 *  rather than an invisible one. */
function readMaxCourses(value) {
  if (!finiteNumber(value)) return SHINGLE_COURSES_PER_PLANE;
  return Math.min(SHINGLE_COURSES_PER_PLANE, Math.max(1, Math.floor(value)));
}

/**
 * Walk every usable plane and course, drawing shingle widths and tones in a
 * fixed order. When `emit` is a function each shingle is handed to it; when it
 * is null the walk only counts. `shingleSpawns` and `shingleRowCount` share this
 * loop so their answers can never drift apart.
 *
 * Each plane gets its own generator, seeded from the call seed and the plane's
 * index among the usable planes. That keeps one plane's pattern independent of
 * the junk entries around it and of the order of rejected planes, while staying
 * identical between the two entry points.
 *
 * Geometry, in the plane's local frame: u runs along the course (the plane's
 * width), v runs across it (the plane's depth). The eave is the far edge at
 * v = +depth/2 because a positive pitch tips that edge down. A course k is
 * centred at v = depth/2 - (k*H + H/2), so its y is
 * `plane.y - pitch*v + SHINGLE_LIFT` and consecutive courses are exactly
 * pitch*H apart in height. A shingle's centre is at u = cursor + width/2.
 * Every descriptor also carries the plane's `pitch`, so the caller can tilt the
 * strip to lie flush with the sloping surface instead of leaving it flat.
 */
function walkPlanes(options, emit) {
  const opts = options !== null && typeof options === 'object' && !Array.isArray(options)
    ? options
    : {};

  const maxCourses = readMaxCourses(opts.maxCourses);
  const base = finiteNumber(opts.seed) ? opts.seed : SHINGLE_SEED;
  const baseSeed = base >>> 0;

  if (!Array.isArray(opts.planes)) return 0;

  let count = 0;
  let usableIndex = 0;

  for (let i = 0; i < opts.planes.length; i += 1) {
    const plane = usablePlane(opts.planes[i]);
    if (plane === null) continue;

    const rng = mulberry32((baseSeed ^ Math.imul(usableIndex + 1, 0x9e3779b1)) >>> 0);
    usableIndex += 1;

    const cosYaw = Math.cos(plane.yaw);
    const sinYaw = Math.sin(plane.yaw);

    // Only whole courses fit: the last one ends at or before the near edge, so
    // a sliver of the plane is left bare at the ridge rather than a shingle
    // overhanging it. The epsilon stops a depth that is an exact multiple of the
    // course height from losing its final course to floating-point dust.
    const courses = Math.min(
      maxCourses,
      Math.floor((plane.depth + 1e-9) / SHINGLE_COURSE_HEIGHT)
    );

    for (let k = 0; k < courses; k += 1) {
      const v = plane.depth / 2 - (k * SHINGLE_COURSE_HEIGHT + SHINGLE_COURSE_HEIGHT / 2);
      const y = plane.y - plane.pitch * v + SHINGLE_LIFT;

      let cursor = -plane.width / 2;
      let remaining = plane.width;

      // Each pass consumes exactly two draws -- a width and a tone -- so the
      // counting walk stays in step with the emitting one. The last shingle is
      // clipped to `remaining`, which then reaches exactly zero and ends the
      // course on the plane's edge.
      while (remaining > 0) {
        const sampled = SHINGLE_MIN_WIDTH + rng() * (SHINGLE_MAX_WIDTH - SHINGLE_MIN_WIDTH);
        const tone = SHINGLE_MIN_TONE + rng() * (SHINGLE_MAX_TONE - SHINGLE_MIN_TONE);
        const width = sampled < remaining ? sampled : remaining;

        if (emit !== null) {
          const u = cursor + width / 2;
          // The strip is tilted by atan(pitch) in world.js so it lies flush with
          // the slope; measured along that slope its visible height is the
          // course's 90% stretched by sqrt(1 + pitch^2), which keeps the
          // horizontal gap at 10% of the course (see the header).
          const slope = Math.sqrt(1 + plane.pitch * plane.pitch);
          emit({
            x: plane.x + u * cosYaw + v * sinYaw,
            y,
            z: plane.z - u * sinYaw + v * cosYaw,
            yaw: plane.yaw,
            pitch: plane.pitch,
            width,
            depth: SHINGLE_COURSE_HEIGHT * SHINGLE_VISIBLE_FRACTION * slope,
            tone
          });
        }

        count += 1;
        cursor += width;
        remaining -= width;
      }
    }
  }

  return count;
}

/**
 * The spawn descriptors for every shingle on every supplied roof plane.
 *
 * Options:
 *   - `planes` is the caller's array of `{ x, z, y, width, depth, yaw, pitch }`.
 *     The default is an empty array: a caller who forgets gets no shingles
 *     rather than an invented roof somewhere in the scene.
 *   - `seed` seeds the layout; a non-finite seed falls back to SHINGLE_SEED.
 *   - `maxCourses` clamps a finite value into [1, SHINGLE_COURSES_PER_PLANE] and
 *     floors it; junk falls back to SHINGLE_COURSES_PER_PLANE.
 *
 * Each descriptor is `{ x, y, z, yaw, pitch, width, depth, tone }` in world
 * metres:
 *   - `x`, `y`, `z` is the shingle's centre, on the plane and lifted by
 *     SHINGLE_LIFT above the plane's sloping surface;
 *   - `yaw` is the plane's yaw, so a strip's long axis runs along the course;
 *   - `pitch` is the plane's pitch, so the caller can tilt the strip by
 *     atan(pitch) about its local cross-course axis and lay it flush with the
 *     slope; it is 0 for a flat plane and for a junk pitch;
 *   - `width` is its length along the course, never wider than
 *     SHINGLE_MAX_WIDTH and clipped on the last shingle so each course spans the
 *     plane's width exactly;
 *   - `depth` is the course's visible height measured along the slope,
 *     90% of SHINGLE_COURSE_HEIGHT times sqrt(1 + pitch^2), so a tilted strip
 *     leaves the same 10% horizontal gap an untilted one did;
 *   - `tone` is a brightness multiplier in [SHINGLE_MIN_TONE, SHINGLE_MAX_TONE].
 *
 * Planes are visited in array order and their shingles in eave-to-ridge, then
 * left-to-right order, so the result is a flat array in a stable sequence.
 * Malformed planes are skipped. The call never throws and never yields NaN or
 * Infinity.
 */
export function shingleSpawns(options = {}) {
  const spawns = [];
  walkPlanes(options, (descriptor) => spawns.push(descriptor));
  return spawns;
}

/**
 * How many shingles {@link shingleSpawns} would produce for the same options.
 *
 * This walks the same courses and consumes the same random draws, but builds no
 * array, so a caller sizing an InstancedMesh does not pay for the descriptors
 * twice. The two functions share one loop, which is what keeps the count exact
 * rather than merely close.
 */
export function shingleRowCount(options = {}) {
  return walkPlanes(options, null);
}

/** Whether the shingle courses run at this quality tier. The low tier drops the
 *  instanced roof dressing, consistent with the quality-tier convention: the
 *  strips add a draw call and a per-instance transform, which is exactly the
 *  cost the low tier exists to shed. Junk reads as the full tier, so an
 *  unexpected tier never silently strips the roofs back to flat slabs. */
export function shinglesEnabled(tier) {
  return tier !== 'low';
}
