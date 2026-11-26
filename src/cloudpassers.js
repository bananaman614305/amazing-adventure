// Clouds that actually pass over the player's head.
//
// The dome's cloud layer (src/clouds.js) sits on a ring 118 m out, so its
// clouds are scenery: the sun is nearly overhead, and a cloud that far away
// projects its shadow hundreds of metres off the edge of a 34 m world. That is
// why Round 89 could only wire the layer's aggregate dapple and why the
// per-cloud maths in src/cloudshadow.js sat unused. The ground never had a
// shadow with an edge you could watch slide.
//
// This module authors a second, much nearer layer for exactly that: five
// clouds at 30-44 m, small enough and close enough that their shadows land on
// the plaza and the meadow, drifting a few metres either way over the course of
// a minute. The world draws each one twice -- as a dark footprint on the ground
// and as a disc in the sky -- and derives the sky disc from the footprint by
// inverse projection (see `raisePointToCloud` in src/cloudshadow.js), so the
// two halves are the same cloud and cannot disagree about where it is.
//
// The split of work follows the house pattern. Everything decision-shaped lives
// here: how many passers, where their footprints start, how high they float,
// how they drift, and how strong the layer is per phase. It is pure and seeded,
// so two runs are bit-identical and the unit suite can pin the field; the
// world only turns these numbers into meshes.
//
// Night is exactly zero on purpose. The moon is a soft key and a dark patch
// sliding across the ground under it would read as a rendering fault, not as
// weather; the same reasoning keeps the aggregate dapple off at night.

/** How many passer clouds the layer carries. Five is enough that the plaza is
 *  rarely in full sun and never entirely in shade; more turns a sunny day into
 *  a strobe as the discs sweep past at walking speed. */
export const PASSER_COUNT = 5;

/** Seed for the footprint and altitude draws. Fixed so the layer is identical
 *  on every load and a screenshot taken twice matches. */
export const PASSER_SEED = 0x51de;

/** Altitude band in metres. The lower bound keeps a passer above the roofs and
 *  the lamp posts (a shadow disc that walks through a building reads as a bug);
 *  the upper bound keeps the inverse projection's sky disc inside the 118 m
 *  dome even at dusk, when the sun is low and the disc is thrown far sideways. */
export const PASSER_MIN_ALT = 30;
export const PASSER_MAX_ALT = 44;

/** Half-width of the square the footprint centres are drawn from, in metres.
 *  The world is 34 m across (HALF = 17), so centres sampled in [-18, 18]^2 put
 *  some footprints over the border wall -- the plaza still sees those shadows
 *  enter and leave -- while the rest cross the walkable ground directly.
 *  Measured against the plaza disc: this span with the radii below leaves the
 *  square sunlit 11-77% of the time over a six-minute sweep (mean ~39%), which
 *  is the band that reads as passing weather rather than permanent overcast. */
export const PASSER_SPAN = 18;

/** Footprint radius band in metres. A passer's shadow has to be wide enough to
 *  read as weather rather than a smudge (5 m) and small enough that the player
 *  can stand in the sun beside one (8.5 m). Wider than this and the five
 *  footprints cover the plaza almost all the time, which is not a passing
 *  cloud, it is a cloudy day. */
export const PASSER_MIN_RADIUS = 5;
export const PASSER_MAX_RADIUS = 8.5;

/** Smallest allowed distance between two footprint centres, in metres. Below
 *  about one radius two shadows merge into one patch; this keeps five distinct
 *  clouds on the ground. The generator retries a draw that lands closer. */
export const PASSER_MIN_SEPARATION = 14;

/** Largest drift, in metres, from a footprint's starting centre. Slow enough
 *  that a shadow crosses the plaza over tens of seconds; bounded so no passer
 *  wanders far enough to leave the ground the world draws. */
export const PASSER_DRIFT_MAX = 6;

/** How opaque the layer is per phase: the sky disc's own opacity, and (times
 *  CLOUD_SHADOW_STRENGTH) the ground shadow's. Night is exactly zero. */
export const PASSER_PHASE_OPACITY = Object.freeze({ day: 0.4, dusk: 0.28, night: 0 });

/** A small deterministic PRNG (mulberry32), copied rather than imported so the
 *  module stands alone. Identical to the one in src/clouds.js. */
export function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * The layer's ground footprints, in metres, in the order the world draws them.
 *
 * Each entry is `{ x, z, r }`: a centre inside [-PASSER_SPAN, PASSER_SPAN]^2
 * and a radius in [PASSER_MIN_RADIUS, PASSER_MAX_RADIUS]. Deterministic for a
 * given seed; a junk count (not a finite non-negative number) returns an empty
 * list rather than throwing, so a caller's bad arithmetic cannot crash the sky.
 */
export function passerFootprints(count = PASSER_COUNT, seed = PASSER_SEED) {
  if (!finiteNumber(count) || count < 0) return [];
  const n = Math.min(Math.floor(count), 64);
  const rng = mulberry32(seed);
  const out = [];
  // Two passers drawn on top of each other would merge into one bigger, darker
  // patch, and the layer would read as three clouds plus a smudge. Draw again
  // (bounded, so the call always returns) until a centre is at least
  // PASSER_MIN_SEPARATION from every one already placed. The retry count is
  // capped rather than a while-true: a caller asking for sixty-four passers in
  // a 40 m square cannot keep them all apart, and must still get a field back.
  const attempts = 24;
  for (let i = 0; i < n; i += 1) {
    let x = 0;
    let z = 0;
    for (let a = 0; a < attempts; a += 1) {
      x = (rng() * 2 - 1) * PASSER_SPAN;
      z = (rng() * 2 - 1) * PASSER_SPAN;
      let clear = true;
      for (const other of out) {
        if (Math.hypot(x - other.x, z - other.z) < PASSER_MIN_SEPARATION) {
          clear = false;
          break;
        }
      }
      if (clear) break;
    }
    const r = PASSER_MIN_RADIUS + rng() * (PASSER_MAX_RADIUS - PASSER_MIN_RADIUS);
    out.push({ x, z, r });
  }
  return out;
}

/**
 * How high the passer at `index` floats, in metres. Derived from the index
 * rather than drawn from the footprint generator so that a caller can ask for
 * one passer's altitude without regenerating the field; the mix is a
 * fractional-part hash of the index, which spreads the five values across the
 * band without a table.
 */
export function passerAltitude(index) {
  if (!finiteNumber(index)) return PASSER_MIN_ALT;
  const i = Math.floor(Math.abs(index));
  // 0.618... is the golden ratio's fractional part: successive multiples are
  // maximally spread, so five consecutive indices land far apart in the band.
  const u = (i * 0.6180339887498949) % 1;
  return PASSER_MIN_ALT + u * (PASSER_MAX_ALT - PASSER_MIN_ALT);
}

/**
 * How far the passer at `index` has wandered from its starting footprint at
 * `time` seconds, as `{ dx, dz }` in metres.
 *
 * Two sinusoids per axis with different periods and an index-dependent phase
 * offset, so the five passers never move in lockstep and no two retrace the
 * same line. Each component is bounded by PASSER_DRIFT_MAX. Time is the
 * caller's clock (the world's cloud time), not a read of the system clock, so
 * the module stays pure. Junk time reads as the start position.
 */
export function passerDrift(index, time) {
  if (!finiteNumber(index) || !finiteNumber(time)) return { dx: 0, dz: 0 };
  const i = Math.abs(index);
  // Periods of 47 s and 83 s: coprime-ish, so the combined path does not repeat
  // on any timescale a player will notice, and slow enough that a shadow
  // crossing the plaza takes half a minute.
  const a = Math.sin((time / 47) * Math.PI * 2 + i * 1.7);
  const b = Math.sin((time / 83) * Math.PI * 2 + i * 2.9);
  const c = Math.cos((time / 61) * Math.PI * 2 + i * 0.9);
  const d = Math.cos((time / 97) * Math.PI * 2 + i * 2.1);
  // Each axis sums two unit waves and is scaled to half the drift bound, so the
  // sum cannot exceed the bound.
  const dx = (a + b) * 0.5 * PASSER_DRIFT_MAX;
  const dz = (c + d) * 0.5 * PASSER_DRIFT_MAX;
  return {
    dx: Math.max(-PASSER_DRIFT_MAX, Math.min(PASSER_DRIFT_MAX, dx)),
    dz: Math.max(-PASSER_DRIFT_MAX, Math.min(PASSER_DRIFT_MAX, dz))
  };
}

/**
 * The layer's opacity for a phase: the sky discs' own, and (scaled by the
 * authored cloud-shadow strength) the ground shadows'. Unknown or junk phase
 * ids read as zero -- an unrecognised sky has no passers rather than an
 * arbitrary fraction of them.
 */
export function passerOpacity(phaseId) {
  if (typeof phaseId !== 'string') return 0;
  const value = PASSER_PHASE_OPACITY[phaseId];
  return finiteNumber(value) ? value : 0;
}
