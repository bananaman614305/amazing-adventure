// Where the coping course, plinth course and pilasters sit on the five border
// wall runs, decided without a GPU.
//
// The plaza is a 34 m square of grass ringed by five stone wall boxes: three
// full sides (south, west, east) and the north side split in two segments around
// the gate, whose opening spans x 8..11. The wall boxes are 3.2 m tall and 1 m
// thick, centred on the lines x = ±17 and z = ±17, so their inner faces stand at
// ±16.5 and their outer faces at ±17.5. A plain box reads as a modern retaining
// wall; what makes it read as old dressed masonry is the stone trim -- a coping
// course on top, a plinth course at the foot and pilaster strips between them --
// exactly the detailing the gate piers and the terrace parapet already carry.
// `world.js` will turn each descriptor in `wallTrimLayout()` into a box mesh;
// this module owns only the decision of where each piece goes and how big it is.
//
// Two decisions are worth the words.
//
// 1. The module carries its own copy of the wall data. The five runs are authored
//    here (not imported from `areas.js` or `terrain.js`) for the same reason the
//    other pure modules take the world as arguments: `shingles.js` receives its
//    roof planes and `chimney.js` receives its sites rather than importing the
//    map, so a changed courtyard -- a moved gate, a shifted half-size -- has one
//    owner and this module stays independently testable. The values are pinned
//    to the world by unit tests instead: `wallRuns()` must agree with
//    `NORTH_WALL_SEGMENTS` and with `WORLD_SIZE`, and a drift in the world is
//    caught there rather than silently absorbed here.
//
// 2. The keep-clear margin is an upper bound on inward step, not a clearance
//    from the glass or the ivy. Window panes sit on a plane at 16.48 m
//    (HALF - 0.52) and ivy cards on a plane at 16.44 m (HALF - 0.56), both
//    inside the wall's inner face at 16.5 m, so the plinth's 0.12 m step and
//    the pilaster's 0.28 m step carry their inner edges to 16.38 m and 16.22 m
//    respectively -- in front of both planes, not behind them. Glass is still
//    safe because the trim band only occupies 0..0.77 m of height while the
//    lowest window starts at 1.6 m (WINDOW_MIN_HEIGHT): no trim piece ever
//    reaches the window band. Ivy is safe too: round 104 raised IVY_MIN_BASE_Y to
//    0.82 m, so ivy cards start above the trim band's 0.77 m top and no trim
//    piece can occlude an ivy card. That invariant -- band top =
//    plinthHeight + pilasterHeight = 0.77 m versus the 0.82 m ivy base, worst
//    sway dip excluded -- is pinned by a unit test in tests/ivy.test.mjs. The
//    coping projects nothing inward, so its inner edge stays at the inner face
//    and it never reaches either plane.
//
// The numbers worth the words:
//
// 1. The coping is 0.22 m tall and projects 0.14 m past the outer face. 0.22 m
//    is the difference between a wall that ends in a ruler line and one with a
//    cap, and 0.14 m is enough for the cap to read as a course rather than as
//    paint on the top face. It overhangs the outer face only: a coping that
//    projected inward would hang over the window plane and would shade the wall
//    top into the courtyard, which is where the sunlit parapet already lives.
//    It spans the run end to end and sits on top of the 3.2 m wall, so its
//    centre is at WALL_TRIM_HEIGHT + copingHeight / 2.
//
// 2. The plinth is 0.45 m tall -- the classic one-course base, small enough that
//    the wall does not read as a plinth with a thin wall above it -- and it
//    steps 0.12 m out past BOTH faces, so it reads as one course carried around
//    the wall. At 0.12 m past the inner face it stays well under the keep-clear
//    margin, and at 0.12 m past the outer face it grounds the wall into the
//    grass with a dressed foot rather than a raw edge.
//
// 3. A pilaster is 0.5 m wide and 0.32 m tall, stepped 0.28 m off the wall on
//    both faces. The 0.28 m band is what reads as a strip of masonry rather than
//    a seam in the stone, and it stays inside the keep-clear margin so the strip
//    cannot reach the glass or the ivy. The strips sit on the plinth course, so
//    their centre is at plinthHeight + pilasterHeight / 2. Spacing runs from 4
//    to 6 m nominal with a seeded per-gap jitter of ±0.5 m and a seeded
//    half-width offset for the first strip: tight enough that the long east and
//    west walls get a strip every few metres, loose enough that the segments
//    beside the gate keep their gate-front dignity, and no two strips land on
//    one line.
//
// The north wall is the one run that is not a full span: the two segments leave
//    the gate opening at x 8..11. A pilaster must never stand in that gap or
//    crowd the lane mouth between the piers, so the sampling band on a
//    gate-adjacent segment is inset by the pilaster half-width, which stops the
//    band short of the opening and leaves the piers (0.7 m wide at
//    GATE.minX - 0.35 and GATE.maxX + 0.35) entirely to themselves.
//
// Everything here is seeded (mulberry32, copied rather than imported so the
// module stands alone) and pure: no Three.js, no DOM, no clock, no Math.random.
// Two identical calls lay out identical trim, and the layout can be pinned by
// unit tests. Every export is total: junk input is clamped to sane defaults or
// replaced with the whole wall, and no call can produce NaN or Infinity.

/** Seed for the trim generator. Fixed so every run lays out the same courses. */
export const WALL_TRIM_SEED = 0x5a7d2e;

/** The wall's height in metres, matching world.js's wallHeight. The coping sits
 *  on top of this, so the spec must agree with the wall the world actually
 *  builds; the unit tests pin that agreement against the authored run data. */
export const WALL_TRIM_HEIGHT = 3.2;

/** The spec for the trim courses and strips. world.js applies this unchanged:
 *  - `copingHeight` / `copingProjection`: the cap course on top of the wall,
 *    overhanging the outer face only;
 *  - `plinthHeight` / `plinthProjection`: the foot course, stepping out a little
 *    on both faces but kept well under `keepClear` on the inner one;
 *  - `pilasterWidth` / `pilasterHeight` / `pilasterProjection` /
 *    `pilasterMinSpacing` / `pilasterMaxSpacing`: the vertical strips between
 *    courses, sitting on the plinth;
 *  - `keepClear`: the largest inward projection any trim may make. It is an
 *    upper bound on how far a piece may step in, not a clearance from the
 *    window plane (16.48 m) or the ivy plane (16.44 m): the plinth and
 *    pilasters step past both of those planes, and glass is safe because the
 *    trim band (0..0.77 m) sits below the lowest window (1.6 m). Ivy is safe
 *    too, because round 104 raised IVY_MIN_BASE_Y to 0.82 m, so ivy cards
 *    start above the band top (plinthHeight + pilasterHeight = 0.77 m) and no
 *    trim piece can occlude one; tests/ivy.test.mjs pins that invariant.
 *  - `tileMeters`: the stone texture family's tile, so the courses' UVs line up
 *    with the terrace stonework (`TERRACE_TEXTURE_TILE_METERS`). */
/** The plane (|coord|) at which window panes sit, inside the wall's inner face.
 *  Exported so tests name it instead of re-deriving 16.48. */
export const WALL_TRIM_WINDOW_PLANE = 16.48;

/** The plane (|coord|) at which ivy cards hang, inside the wall's inner face.
 *  Exported so tests name it instead of re-deriving 16.44. */
export const WALL_TRIM_IVY_PLANE = 16.44;

export const WALL_TRIM = Object.freeze({
  copingHeight: 0.22,
  copingProjection: 0.14,
  plinthHeight: 0.45,
  plinthProjection: 0.12,
  pilasterWidth: 0.5,
  pilasterHeight: 0.32,
  pilasterProjection: 0.28,
  pilasterMinSpacing: 4,
  pilasterMaxSpacing: 6,
  keepClear: 0.3,
  tileMeters: 1.6
});

/** Half the world's 34 m square: the wall lines sit at ±HALF and the inner
 *  faces at ±(HALF - 0.5). Copied rather than imported for the same reason as
 *  the run data, and pinned by the tests against `terrain.js`. */
const HALF = 17;

/** Half the wall's 1 m thickness. The boxes straddle the wall line, so the
 *  outer face stands a further half metre out. */
const WALL_HALF_THICK = 0.5;

/** Largest run the module will lay trim on, in metres. The longest real run is
 *  the 34 m side, so this bounds the work without truncating any wall; a typo
 *  cannot ask for trim along a kilometre. */
const MAX_RUN_LENGTH = 200;

/** The gate opening's span on the north wall, from areas.js's GATE. Authored
 *  here (see the header) and pinned by the tests so the pilaster skip can never
 *  drift into the lane mouth. */
const GATE_MIN_X = 8;
const GATE_MAX_X = 11;
// The gate piers are 0.7 m wide boxes centred half a pier-width either side of
// the opening, so each pier's inner face (toward the courtyard) sits at the
// opening face x 8 and x 11. The courses on a gate-adjacent run stop at that
// inner face, and the pilaster band keeps the same clear span so no strip
// crowds a pier.
const PIER_OVERHANG = 0.7 / 2;

/** The five runs. `axis` is the direction the wall runs, `from`/`to` the extent
 *  along it, `fixed` the coordinate on the other axis. The two north segments
 *  are flagged `gateAdjacent` so `pilastersFor` keeps its band clear of the
 *  gate. The wall runs from -HALF to HALF, so a run's end sits at a corner where
 *  the neighbouring side's box begins; the trim is centred on the run and its
 *  end overhang is the half-thickness, which is what lets the coping meet its
 *  neighbour at the corner. */
const WALL_RUNS = Object.freeze([
  { id: 'south', axis: 'x', from: -HALF, to: HALF, fixed: HALF, side: 'south', gateAdjacent: false },
  { id: 'east', axis: 'z', from: -HALF, to: HALF, fixed: HALF, side: 'east', gateAdjacent: false },
  { id: 'west', axis: 'z', from: -HALF, to: HALF, fixed: -HALF, side: 'west', gateAdjacent: false },
  { id: 'north-left', axis: 'x', from: -HALF, to: GATE_MIN_X, fixed: -HALF, side: 'north', gateAdjacent: true },
  { id: 'north-right', axis: 'x', from: GATE_MAX_X, to: HALF, fixed: -HALF, side: 'north', gateAdjacent: true }
]);

/** A small deterministic PRNG (mulberry32). Copied from the other pure modules
 *  rather than imported, so `walltrim.js` stays independent of them. */
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

/** A usable run, or null. The extent must be finite, non-negative and ordered
 *  into from <= to; a zero-length run cannot carry trim. An array is junk too:
 *  it has the wrong shape and reading `.from` off one would silently pick up
 *  `Array.isArray` members. `gateAdjacent` survives the normalisation so a run
 *  handed back from `wallRuns()` keeps its gate flag. */
function usableRun(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.axis !== 'x' && raw.axis !== 'z') return null;
  if (!finiteNumber(raw.from) || !finiteNumber(raw.fixed) || !finiteNumber(raw.to)) return null;
  const from = Math.min(raw.from, raw.to);
  const to = Math.max(raw.from, raw.to);
  if (to - from <= 0) return null;
  if (to - from > MAX_RUN_LENGTH) return null;
  return {
    id: String(raw.id),
    axis: raw.axis,
    from,
    to,
    fixed: raw.fixed,
    side: raw.side,
    gateAdjacent: Boolean(raw.gateAdjacent)
  };
}

/** The signed half-depth of a piece that steps `projection` out past both
 *  faces: the wall's own half-thickness plus the step. The inward face of the
 *  piece then sits exactly `projection` inside the wall's inner face, which is
 *  the number the keep-clear rule is checked against. */
function halfDepth(projection) {
  return WALL_HALF_THICK + projection;
}

/** The run's midpoint along its axis. */
function runCenter(run) {
  return (run.from + run.to) / 2;
}

/** The gate-adjacent run's far end on the opening side: the pier's inner face
 *  (the face toward the courtyard), so a course or pilaster band stops at the
 *  pier instead of overlapping it. The piers are 0.7 m wide boxes centred half
 *  a pier-width either side of the opening, so the inner faces sit at the
 *  opening faces x 8 and x 11. A non-gate-adjacent run has no stop. */
function gateStop(run) {
  if (!run.gateAdjacent) return null;
  if (run.to <= GATE_MIN_X) return GATE_MIN_X;
  if (run.from >= GATE_MAX_X) return GATE_MAX_X;
  return null;
}

/** The run's effective extent for a course: [from', to'], where the stop end
 *  replaces the opening end on a gate-adjacent run. Every course and band is
 *  laid out on this extent, so the stop end is honoured by length and centre
 *  alike and no course can overlap a pier or the lane mouth. */
function courseExtent(run) {
  const stop = gateStop(run);
  if (stop === null) return [run.from, run.to];
  // The stop replaces the end nearest the opening: the left run's `to`, the
  // right run's `from`.
  if (run.to <= GATE_MIN_X) return [run.from, stop];
  return [stop, run.to];
}

/** The span a course covers along its run, in run-axis coordinates. A course
 *  covers the wall face, so each end extends one half-thickness past the run
 *  end to meet the neighbouring wall at the corner -- but a gate-adjacent run's
 *  pier end stops exactly at the pier's inner face, because the pier there is
 *  not wall and there is nothing for the course to meet. */
function courseSpan(run) {
  const [from, to] = courseExtent(run);
  const stop = gateStop(run);
  // The corner end always gets the half-thickness; the pier end gets none.
  const cornerEnd = run.to <= GATE_MIN_X || !run.gateAdjacent
    ? from - WALL_HALF_THICK
    : to + WALL_HALF_THICK;
  const pierEnd = stop === null
    ? (run.to <= GATE_MIN_X || !run.gateAdjacent ? to + WALL_HALF_THICK : from - WALL_HALF_THICK)
    : stop;
  return [Math.min(cornerEnd, pierEnd), Math.max(cornerEnd, pierEnd)];
}

/** The run's full course length, from corner to corner (or pier to corner on a
 *  gate-adjacent north run), so courses and pilasters cannot overlap the gate
 *  piers or the lane mouth. */
function courseRunLength(run) {
  const [from, to] = courseSpan(run);
  return to - from;
}

/** The centre offset of the outer face from the wall line, signed so it points
 *  away from the courtyard. */
function outerFace(run) {
  return run.fixed >= 0 ? run.fixed + WALL_HALF_THICK : run.fixed - WALL_HALF_THICK;
}

/** The pilaster stop: the pier's outer edge (the edge away from the courtyard),
 *  because a strip projects past both faces and so needs the whole pier kept
 *  clear, not just its inner face. A non-gate-adjacent run has no stop. */
function pilasterStop(run) {
  if (!run.gateAdjacent) return null;
  // The pier's outer edge, not its centre or inner face: a pier is 2 *
  // PIER_OVERHANG wide, centred PIER_OVERHANG outside the opening, so its far
  // edge is a further PIER_OVERHANG out. A strip that cleared only the centre
  // would still overlap the half of the pier nearer the wall corner.
  if (run.to <= GATE_MIN_X) return GATE_MIN_X - 2 * PIER_OVERHANG;
  if (run.from >= GATE_MAX_X) return GATE_MAX_X + 2 * PIER_OVERHANG;
  return null;
}

/** The pilaster band this run offers, in run-axis coordinates. A band is the
 *  span a pilaster centre may occupy; its ends are inset by the pilaster
 *  half-width so a strip's edge never kisses the wall corner. On a
 *  gate-adjacent north segment the band stops at the pier's outer edge, so no
 *  strip can overlap the pier that frames the opening. */
function pilasterBand(run, halfWidth) {
  const stop = pilasterStop(run);
  let bandMin = run.from + halfWidth;
  let bandMax = run.to - halfWidth;
  if (stop !== null) {
    if (run.to <= GATE_MIN_X) bandMax = Math.min(bandMax, stop - halfWidth);
    if (run.from >= GATE_MAX_X) bandMin = Math.max(bandMin, stop + halfWidth);
  }
  return [bandMin, bandMax];
}

/**
 * The five wall runs as data.
 *
 * Each run is `{ id, axis: 'x'|'z', from, to, fixed, side, gateAdjacent }`, with
 * `from`/`to` the extent along the axis and `fixed` the coordinate on the other
 * axis. The three full sides and the two north segments beside the gate make
 * the five runs the wall actually consists of. The array is a fresh copy on
 * every call, so a caller that mutates it cannot corrupt the module's view of
 * the wall.
 *
 * The call never throws and every run carries finite, sane numbers.
 */
export function wallRuns() {
  return WALL_RUNS.map((run) => ({ ...run }));
}

/**
 * The coping box for one run.
 *
 * `{ size: [w, h, d], position: [x, y, z], name }` in world metres, with the
 * position the box's centre. The coping spans the run end to end, is exactly
 * `WALL_TRIM.copingHeight` tall, and sits on top of the 3.2 m wall so its
 * centre is at `WALL_TRIM_HEIGHT + copingHeight / 2`. It projects
 * `WALL_TRIM.copingProjection` past the outer face and nothing inward -- its
 * inner edge stops at the wall's inner face -- so it cannot reach the window
 * plane. The name is `border-wall-coping-<id>`.
 *
 * A junk or unknown `run` yields the south run's coping rather than nothing: a
 * coping on the wrong wall is visible and obvious, a missing wall top is not.
 * Every call returns finite numbers and the same `run` always lays out the same
 * box.
 */
export function copingFor(run) {
  const r = usableRun(run) || WALL_RUNS[0];
  const runLength = courseRunLength(r);
  // The cap covers the wall face plus one projection outward and nothing along
  // the run ends: a course stops at the corner rather than growing past the
  // wall it caps. The earlier draft grew the length too; the unit test pins
  // the span to the wall face [from - halfThickness, to + halfThickness], with
  // the gate-adjacent pier end stopping at the pier's inner face.
  const length = runLength;
  const depth = 2 * halfDepth(WALL_TRIM.copingProjection) - WALL_TRIM.copingProjection;
  const height = clampNumber(WALL_TRIM.copingHeight, 0, 1, 0.22);
  // The cap runs from the inner face to the outer face plus its projection, so
  // its centre is the wall line shifted half the projection toward the outside;
  // nothing of it hangs over the courtyard. The centre is the course span's
  // midpoint, so a gate-adjacent cap ends at the pier's inner face.
  const shift = (r.fixed >= 0 ? 1 : -1) * WALL_TRIM.copingProjection / 2;
  const [spanFrom, spanTo] = courseSpan(r);
  const center = r.axis === 'x'
    ? { x: (spanFrom + spanTo) / 2, z: r.fixed + shift }
    : { x: r.fixed + shift, z: (spanFrom + spanTo) / 2 };
  return {
    size: [r.axis === 'x' ? length : depth, height, r.axis === 'x' ? depth : length],
    position: [
      clampNumber(center.x, -MAX_RUN_LENGTH, MAX_RUN_LENGTH, 0),
      clampNumber(WALL_TRIM_HEIGHT + height / 2, 0, MAX_RUN_LENGTH, WALL_TRIM_HEIGHT + 0.11),
      clampNumber(center.z, -MAX_RUN_LENGTH, MAX_RUN_LENGTH, 0)
    ],
    name: `border-wall-coping-${r.id}`
  };
}

/**
 * The plinth box for one run.
 *
 * Same shape as `copingFor`, with the foot course exactly
 * `WALL_TRIM.plinthHeight` tall and stepping `WALL_TRIM.plinthProjection` out
 * past BOTH faces. The inner step stays well under the keep-clear margin, so
 * the plinth cannot reach the window or ivy plane; the outer step grounds the
 * wall into the grass. Its centre sits on the wall line at `plinthHeight / 2`.
 * The name is `border-wall-plinth-<id>`.
 *
 * A junk or unknown `run` yields the south run's plinth, on the same
 * visible-mistake reasoning as `copingFor`. The call never throws and never
 * yields NaN.
 */
export function plinthFor(run) {
  const r = usableRun(run) || WALL_RUNS[0];
  // Same discipline as the coping: the foot course stops at the corner rather
  // than growing along the run, so its span is the wall face [from -
  // halfThickness, to + halfThickness]. The projection only steps the depth
  // outward, never the length. A gate-adjacent run stops at the pier's inner
  // face instead of the opening face, so the course cannot overlap a pier.
  const runLength = courseRunLength(r);
  const length = runLength;
  const depth = 2 * halfDepth(WALL_TRIM.plinthProjection);
  const height = clampNumber(WALL_TRIM.plinthHeight, 0, 1, 0.45);
  // Symmetric steps: the centre sits on the wall line, half a projection inside
  // each face, because the foot course reads as one course around the wall. The
  // centre is the course span's midpoint, so a gate-adjacent course ends at the
  // pier's inner face.
  const [spanFrom, spanTo] = courseSpan(r);
  const along = (spanFrom + spanTo) / 2;
  const center = r.axis === 'x' ? { x: along, z: r.fixed } : { x: r.fixed, z: along };
  return {
    size: [r.axis === 'x' ? length : depth, height, r.axis === 'x' ? depth : length],
    position: [
      clampNumber(center.x, -MAX_RUN_LENGTH, MAX_RUN_LENGTH, 0),
      clampNumber(height / 2, 0, MAX_RUN_LENGTH, 0.225),
      clampNumber(center.z, -MAX_RUN_LENGTH, MAX_RUN_LENGTH, 0)
    ],
    name: `border-wall-plinth-${r.id}`
  };
}

/**
 * The pilaster boxes for one run.
 *
 * An array of `{ size: [w, h, d], position: [x, y, z], name }` in world metres,
 * the position each box's centre. The strips are `WALL_TRIM.pilasterWidth` wide
 * along the run and `WALL_TRIM.pilasterHeight` tall, stepped
 * `WALL_TRIM.pilasterProjection` off BOTH faces so they sit on the wall as bands
 * of masonry rather than cutouts of it, and they rest on the plinth course, so
 * their centre is at `plinthHeight + pilasterHeight / 2`. Their centres are
 * spaced at a run-sampled nominal in [pilasterMinSpacing, pilasterMaxSpacing]
 * plus a seeded per-gap jitter of ±0.5 m, and the first strip starts a seeded
 * fraction of a half-width inside the band, so the rhythm breaks across the run
 * without any two strips landing on one line.
 *
 * The gate-adjacent segments keep their band clear of the opening: the band is
 * inset by the pilaster half-width and stops short of x 8..11, which keeps every
 * pilaster out of the gap and leaves the piers and the lane mouth free. A band
 * too short for one pilaster yields an empty array rather than a strip jammed
 * into the gate.
 *
 * A junk or unknown `run` yields the south run's pilasters. Every call returns
 * finite numbers, every name is `border-wall-pilaster-<id>-<i>`, and the result
 * is identical for identical calls.
 */
export function pilastersFor(run) {
  const r = usableRun(run) || WALL_RUNS[0];

  const height = clampNumber(WALL_TRIM.pilasterHeight, 0, 1, 0.32);
  const width = clampNumber(WALL_TRIM.pilasterWidth, 0, 1, 0.5);
  // The inward step is the number the keep-clear rule guards, so it is clamped
  // to the spec's own margin: a spec edit cannot push a strip through the
  // window plane no matter what it sets.
  const projection = clampNumber(WALL_TRIM.pilasterProjection, 0, WALL_TRIM.keepClear, 0.28);
  const halfWidth = width / 2;
  const depth = 2 * halfDepth(projection);
  const size = r.axis === 'x' ? [width, height, depth] : [depth, height, width];
  const baseY = clampNumber(WALL_TRIM.plinthHeight, 0, 1, 0.45) + height / 2;

  const [bandMin, bandMax] = pilasterBand(r, halfWidth);

  // Seed from the run id so a renamed run cannot silently reshuffle its strips.
  let hash = 0;
  for (let i = 0; i < r.id.length; i += 1) hash = (hash * 31 + r.id.charCodeAt(i)) >>> 0;
  const rng = mulberry32((WALL_TRIM_SEED ^ (hash * 0x9e3779b1)) >>> 0);

  // One spacing sample per run, then a per-gap jitter of ±0.5 m. The jitter is
  // bounded by the nominal spacing, so strips never collide and the walk always
  // advances.
  const spacing = clampNumber(
    WALL_TRIM.pilasterMinSpacing + rng() * (WALL_TRIM.pilasterMaxSpacing - WALL_TRIM.pilasterMinSpacing),
    2 * halfWidth,
    MAX_RUN_LENGTH,
    (WALL_TRIM.pilasterMinSpacing + WALL_TRIM.pilasterMaxSpacing) / 2
  );

  const boxes = [];
  let cursor = bandMin + rng() * halfWidth;
  let index = 0;
  let guard = 0;
  while (cursor + halfWidth <= bandMax && guard < 100) {
    guard += 1;
    const along = cursor;
    const center = r.axis === 'x' ? { x: along, z: r.fixed } : { x: r.fixed, z: along };
    boxes.push({
      size,
      position: [
        clampNumber(center.x, -MAX_RUN_LENGTH, MAX_RUN_LENGTH, 0),
        clampNumber(baseY, 0, MAX_RUN_LENGTH, 0.45 + height / 2),
        clampNumber(center.z, -MAX_RUN_LENGTH, MAX_RUN_LENGTH, 0)
      ],
      name: `border-wall-pilaster-${r.id}-${index}`
    });
    index += 1;
    cursor += spacing + (rng() - 0.5);
  }
  return boxes;
}

/**
 * The full trim layout for all five runs.
 *
 * A flat array of `{ kind: 'coping'|'plinth'|'pilaster', run, size, position,
 * name }` in the order the runs are authored: coping, plinth, then the
 * pilasters for the run, then the next run. `run` is the run id, `size` and
 * `position` the box's `[w, h, d]` and centre `[x, y, z]` in world metres, and
 * `name` the stable mesh name the world and the browser checks find things by.
 * The layout is byte-identical for identical calls and never throws.
 */
export function wallTrimLayout() {
  const layout = [];
  for (const run of WALL_RUNS) {
    const coping = copingFor(run);
    const plinth = plinthFor(run);
    layout.push({ kind: 'coping', run: run.id, size: coping.size, position: coping.position, name: coping.name });
    layout.push({ kind: 'plinth', run: run.id, size: plinth.size, position: plinth.position, name: plinth.name });
    for (const pilaster of pilastersFor(run)) {
      layout.push({ kind: 'pilaster', run: run.id, size: pilaster.size, position: pilaster.position, name: pilaster.name });
    }
  }
  return layout;
}

/** Whether the trim runs at this quality tier. The low tier drops the trim
 *  meshes, consistent with the quality-tier convention: each box is a draw call,
 *  which is exactly the cost the low tier exists to shed. (The trim group carries
 *  no lights of its own.) Junk reads as the full tier, so an unexpected tier
 *  never silently strips the walls back to bare boxes. */
export function wallTrimEnabled(tier) {
  return tier !== 'low';
}
