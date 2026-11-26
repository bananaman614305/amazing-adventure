// Where the village's wood smoke comes from, how each puff climbs, and how
// strongly it reads by phase -- all decided without a GPU.
//
// The houses around the plaza are boxes with roofs. A roof alone says "building";
// it does not say "someone lives here". What sells an inhabited house from across
// a courtyard is a thin column of smoke leaning with the wind, and it is one of
// the cheapest effects in the whole scene: a handful of billboards per chimney,
// a shared material, and no light. `world.js` turns these numbers into those
// quads; this module owns only the decisions.
//
// Three choices are worth the words.
//
// 1. A puff's identity is its slot, not its birth time. `smokePuff` places puff
//    `index` at a fixed fraction of the way up the plume: index 0 sits in the
//    chimney mouth, the last index sits at the top and is exactly transparent.
//    Because the height is positional, the plume can be evaluated at any time
//    with no per-puff bookkeeping and no spawn order to keep in sync with a save.
//    The vertical bob is applied to the whole column in proportion to that
//    fraction, so a lower puff can never overtake a higher one and the column
//    never folds back on itself.
//
// 2. Opacity reaches exactly zero at the top. A plume that fades to a small
//    positive alpha pops out of existence when its last billboard is culled; one
//    that reaches zero is already invisible when it stops being drawn. The fade
//    also thins with the puff's age, because a column of smoke is oldest at the
//    top and a freshly emitted puff is denser than one that has been in the air
//    for a while.
//
// 3. Smoke reads best at dusk and night. In daylight it is washed out against a
//    bright sky; in the cool, damp air after sunset the column stands out, and
//    at night it catches the lamplight. So the phase table is strongest at dusk,
//    a little lower at night, and lowest at day -- the opposite emphasis from
//    the fireflies, which are a night-only thing.
//
// Everything here is seeded (mulberry32, copied rather than imported so the
// module stands alone) and pure: no Three.js, no DOM, no clock, no Math.random.
// That keeps two identical runs bit-identical and lets the motion be pinned by
// unit tests. Every export is total -- it guards junk input, and no call can
// produce NaN or Infinity.

/** Seed for the chimney generator. Fixed so every run builds the same village. */
export const CHIMNEY_SEED = 0x6b1d47;

/** How many plumes the village shows. The plaza has a handful of roofs, and one
 *  column per roof is enough to read as a living place; more would be clutter
 *  and more billboards for the same effect. */
export const CHIMNEY_COUNT = 4;

/** Metres a plume climbs from the chimney mouth before it has fully faded. */
export const CHIMNEY_RISE = 6;

/** Billboards per plume. Six or seven is the smallest count that reads as a
 *  continuous column rather than a row of separate blobs; above eight the extra
 *  quads overlap almost entirely and cost fill rate for nothing. */
export const CHIMNEY_PUFFS = 7;

/** The closest a chimney may sit to the plaza centre, in metres. Keeps the
 *  plumes on the roofs around the courtyard rather than over the fountain. */
export const CHIMNEY_MIN_RADIUS = 7;

/** The farthest a chimney may sit, in metres. The houses are inside this ring,
 *  so no plume is generated out past the border walls. */
export const CHIMNEY_MAX_RADIUS = 16;

/** Lowest and highest plausible chimney-mouth heights, in metres. The houses
 *  stand roughly four to six metres tall, so a mouth below the eave or above the
 *  ridge would float or sink. */
export const CHIMNEY_BASE_Y_MIN = 4;
export const CHIMNEY_BASE_Y_MAX = 6;

/** Smallest and largest billboard size, in metres. A puff starts about the width
 *  of a chimney pot and expands as it rises and cools. */
export const CHIMNEY_MIN_SIZE = 0.3;
export const CHIMNEY_MAX_SIZE = 1.3;

/** The most opaque a fresh puff at the chimney mouth may be. Smoke is a hint,
 *  not a fog bank; anything much denser reads as a chimney fire. */
export const CHIMNEY_MAX_OPACITY = 0.55;

/** Seconds a puff takes to age through one cycle. Exposed so tests can state
 *  the fade-with-age contract plainly. */
export const CHIMNEY_PUFF_LIFE = 3.5;

/** Smallest and largest horizontal lean of a plume, in metres over its full
 *  rise. A still day still drifts a little; a breezy one leans noticeably. */
export const CHIMNEY_DRIFT_MIN = 0.3;
export const CHIMNEY_DRIFT_MAX = 1.2;

/** An upper bound on a caller-supplied count, so a junk number cannot ask for a
 *  million plumes. */
export const CHIMNEY_MAX_COUNT = 24;

/** How strongly smoke shows in each phase. Dusk is strongest (cool damp air and
 *  a low, bright sky make a column stand out), night is close behind (lamplight
 *  catches it), and day is weakest (a pale column against a bright sky). */
export const CHIMNEY_PHASE_GLOW = Object.freeze({ day: 0.25, dusk: 1, night: 0.8 });

/** A small deterministic PRNG (mulberry32). Copied from the other pure modules
 *  rather than imported, so `chimney.js` stays independent of them. */
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

/** The per-phase glow multiplier. An unknown phase, or a non-string, falls back
 *  to the `day` value, so a new phase id can never make smoke flare up by
 *  accident. */
export function smokeGlowLevel(phaseId) {
  if (typeof phaseId !== 'string') return CHIMNEY_PHASE_GLOW.day;
  return Object.prototype.hasOwnProperty.call(CHIMNEY_PHASE_GLOW, phaseId)
    ? CHIMNEY_PHASE_GLOW[phaseId]
    : CHIMNEY_PHASE_GLOW.day;
}

/**
 * The spawn descriptors for every plume.
 *
 * Positions are sampled in polar coordinates: a seeded angle in [0, 2pi) and a
 * seeded radius between CHIMNEY_MIN_RADIUS and CHIMNEY_MAX_RADIUS, then
 * x = cos(angle)*radius and z = sin(angle)*radius. That is not area-uniform, but
 * a decorative ring of four roofs does not need uniform density, and the simpler
 * sampling keeps every plume off the fountain without a rejection loop.
 *
 * `sites` overrides the ring. The world knows where its roofs actually are and
 * this module does not, so a caller that has real chimneys passes them as
 * `[{ x, z, baseY }]` and gets one descriptor per site, in order, with the same
 * seeded phase/rise/drift it would have generated. That keeps the "where" with
 * the geometry and the "how" here, instead of making world.js hand-roll the
 * behaviour the tests already pin. A site with a non-finite coordinate is
 * dropped rather than repaired: a plume hanging in space is worse than one fewer
 * plume, and the count is clamped to the sites that survived.
 *
 * The return is an array of exactly `count` objects, each
 * `{ x, z, baseY, phase, rise, drift }`. A junk count falls back to
 * CHIMNEY_COUNT when it is non-finite and otherwise clamps into
 * [0, CHIMNEY_MAX_COUNT] and floors; a non-finite seed falls back to
 * CHIMNEY_SEED; and every sampled field is clamped into its documented band, so
 * the call never throws and never yields NaN.
 */
export function chimneySpawns(options = {}) {
  const opts = options !== null && typeof options === 'object' ? options : {};
  const rawCount = opts.count;
  const rawSeed = opts.seed;
  const n = finiteNumber(rawCount)
    ? Math.min(CHIMNEY_MAX_COUNT, Math.max(0, Math.floor(rawCount)))
    : CHIMNEY_COUNT;
  const base = finiteNumber(rawSeed) ? rawSeed : CHIMNEY_SEED;

  const passedSites = Array.isArray(opts.sites)
    ? opts.sites.filter((site) => site !== null && typeof site === 'object'
        && !Array.isArray(site)
        && finiteNumber(site.x) && finiteNumber(site.z) && finiteNumber(site.baseY))
    : [];
  // A site list that survives none of its entries reads as "no roofs known",
  // not as "no smoke wanted": the seeded ring is still a plausible village and
  // a world that loses its roof list should not lose its chimneys with it.
  const sites = passedSites.length ? passedSites : null;

  const rng = mulberry32(base >>> 0);
  const spawns = [];
  const total = sites ? Math.min(n, sites.length) : n;
  for (let i = 0; i < total; i += 1) {
    // Every seeded draw happens for every plume whether or not a site supplies
    // the position, so a ring plume and a sited plume with the same index get
    // the same phase, rise and drift. Otherwise adding a roof would silently
    // reshuffle the smoke of the roofs that were already there.
    const angle = rng() * Math.PI * 2;
    const radius = CHIMNEY_MIN_RADIUS + rng() * (CHIMNEY_MAX_RADIUS - CHIMNEY_MIN_RADIUS);
    // A small seeded spread around the nominal roof height keeps four plumes
    // from starting on one flat line, while staying inside the eaves-to-ridge
    // band the houses actually occupy.
    const sampledY = clampNumber(
      CHIMNEY_BASE_Y_MIN + rng() * (CHIMNEY_BASE_Y_MAX - CHIMNEY_BASE_Y_MIN),
      CHIMNEY_BASE_Y_MIN,
      CHIMNEY_BASE_Y_MAX,
      CHIMNEY_BASE_Y_MIN
    );
    const phase = rng();
    // Per-plume rise varies a little so the columns are not identical; the band
    // stays around CHIMNEY_RISE rather than ranging wildly.
    const rise = clampNumber(
      CHIMNEY_RISE + (rng() - 0.5) * 1.6,
      4.5,
      7,
      CHIMNEY_RISE
    );
    const drift = CHIMNEY_DRIFT_MIN + rng() * (CHIMNEY_DRIFT_MAX - CHIMNEY_DRIFT_MIN);
    const site = sites ? sites[i] : null;
    spawns.push({
      x: site ? site.x : Math.cos(angle) * radius,
      z: site ? site.z : Math.sin(angle) * radius,
      baseY: site ? site.baseY : sampledY,
      phase,
      rise,
      drift
    });
  }
  return spawns;
}

/**
 * One puff of one plume at `time`, as `{ x, y, z, size, opacity }`.
 *
 * `index` is the puff's slot: 0 is the chimney mouth and CHIMNEY_PUFFS - 1 is
 * the top. Height is `baseY + fraction * (rise + bob)`, where the bob is one
 * slow sine shared by the whole column; because the bob is scaled by the same
 * fraction as the height, a higher slot always sits above a lower one and the
 * column cannot fold. The horizontal lean grows with the fraction and is aimed
 * by the spawn's phase, with a small wobble that is itself scaled by the
 * fraction so the mouth stays put while the top wanders.
 *
 * Size grows from CHIMNEY_MIN_SIZE at the mouth to CHIMNEY_MAX_SIZE at the top.
 * Opacity is CHIMNEY_MAX_OPACITY times a climb fade `(1 - fraction)^1.15` times
 * an age fade in [0.45, 1], so it falls both as the puff climbs and as it ages,
 * and is exactly 0 at the top. All values are finite and bounded.
 *
 * Junk is handled rather than thrown at: a non-finite `time` reads as 0, a
 * non-finite `index` reads as slot 0 (a finite out-of-range index clamps into
 * the slots), and a spawn that is not an object yields an invisible puff at the
 * origin with a nominal size. Individual non-finite spawn fields fall back to
 * zero, or to CHIMNEY_RISE for `rise`.
 */
export function smokePuff(spawn, index, time) {
  // An array is not a spawn descriptor even though `typeof` says object, so it
  // is treated as junk alongside numbers, strings and null.
  const isSpawn = spawn !== null && typeof spawn === 'object' && !Array.isArray(spawn);
  const x0 = isSpawn && finiteNumber(spawn.x) ? spawn.x : 0;
  const z0 = isSpawn && finiteNumber(spawn.z) ? spawn.z : 0;
  const baseY = isSpawn && finiteNumber(spawn.baseY) ? spawn.baseY : 0;
  const phase = isSpawn && finiteNumber(spawn.phase) ? spawn.phase : 0;
  const rise = isSpawn ? clampNumber(spawn.rise, 4.5, 7, CHIMNEY_RISE) : CHIMNEY_RISE;
  const drift = isSpawn ? clampNumber(spawn.drift, 0, CHIMNEY_DRIFT_MAX, 0) : 0;

  const t = finiteNumber(time) ? time : 0;
  const slot = finiteNumber(index)
    ? Math.min(CHIMNEY_PUFFS - 1, Math.max(0, Math.floor(index)))
    : 0;
  const fraction = slot / (CHIMNEY_PUFFS - 1);
  const turn = phase * Math.PI * 2;

  // One slow vertical bob for the column, scaled by the slot fraction so the
  // mouth is fixed and the ordering of slots is preserved (the rise always
  // exceeds the bob amplitude).
  const bob = 0.35 * Math.sin(t * 0.9 + turn);
  const y = baseY + fraction * (rise + bob);

  // The lean is a seeded heading; the wobble rides on top and fades out at the
  // mouth, where a puff should still be inside the chimney pot.
  const heading = turn + 0.7;
  const lean = drift * Math.pow(fraction, 1.25);
  const wobbleX = 0.12 * Math.sin(t * 1.3 + fraction * 3 + turn) * fraction;
  const wobbleZ = 0.12 * Math.cos(t * 1.1 + fraction * 2.4 + turn) * fraction;
  const x = x0 + Math.cos(heading) * lean + wobbleX;
  const z = z0 + Math.sin(heading) * lean + wobbleZ;

  const size = clampNumber(
    CHIMNEY_MIN_SIZE + (CHIMNEY_MAX_SIZE - CHIMNEY_MIN_SIZE) * fraction,
    CHIMNEY_MIN_SIZE,
    CHIMNEY_MAX_SIZE,
    CHIMNEY_MIN_SIZE
  );

  // Age cycles over CHIMNEY_PUFF_LIFE. The fractional part is taken with a
  // positive modulo so a negative time still lands in [0, 1). The age is shared
  // by every slot of a plume on purpose: giving each slot its own offset would
  // have the column thin unevenly and, worse, would break the contract that a
  // higher puff is always the fainter one. The sense of upward travel comes from
  // the climb (each slot sits higher) and from the bob, not from the fade.
  const rawAge = (t / CHIMNEY_PUFF_LIFE + phase) % 1;
  const age = rawAge < 0 ? rawAge + 1 : rawAge;
  const ageFade = 1 - 0.55 * age;
  // The climb fade reaches exactly zero at the top slot, so the last billboard
  // is already invisible when it stops being drawn.
  const climbFade = Math.pow(1 - fraction, 1.15);
  const opacity = isSpawn
    ? clampNumber(CHIMNEY_MAX_OPACITY * climbFade * ageFade, 0, CHIMNEY_MAX_OPACITY, 0)
    : 0;

  return { x, y, z, size, opacity };
}

/** Whether the smoke runs at this quality tier. The low tier drops the per-frame
 *  billboard pass, consistent with the quality-tier convention; junk reads as
 *  the full tier. */
export function chimneyEnabled(tier) {
  return tier !== 'low';
}
