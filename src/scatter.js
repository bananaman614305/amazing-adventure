// Deterministic scatter for the courtyard's small ground props.
//
// The grass ring around the paved plaza is a single flat plane wearing a grass
// texture. A flat plane with a texture is a decal, not ground: it has no depth,
// no broken silhouette and no sense that anything grows out of it, so the eye
// reads it as a lawn painted on the floor. What makes it read as ground is small
// scatter -- grass tufts and stones sitting on the plane, breaking the surface
// and catching the light differently from the texture beneath. This module is
// the pure half of that: it decides how many props, where they sit, how big they
// are, how they are turned and which of a few visual variants each one is, and
// `world.js` only turns those numbers into meshes.
//
// Placement is rejection sampling against exclusion zones rather than pure
// random, because the courtyard is not empty grass. The plaza disc, the curtain
// walls, the lane's props and the fountain all own ground that a tuft must not
// grow through -- a stone inside the fountain or a tuft through a wall reads as
// a bug, not as detail. Sampling a candidate and testing it against those zones
// (with a margin so nothing kisses an edge) is the simplest way to honour "any
// free ground, none of the owned ground" without hand-authoring positions.
//
// Everything here is deterministic: a seeded PRNG, no clock, no Math.random.
// That matters because the world is captured and saved -- a screenshot taken
// twice must match pixel for pixel, and a save must restore the same courtyard,
// so the same (count, seed, area, exclusions) has to yield the same scatter
// every run.
//
// The module is dependency-free (no Three.js, no DOM) so the placement maths can
// be pinned by unit tests, exactly like the sky's stars and clouds.

/**
 * Seed for the scatter generator. Fixed so the courtyard's tufts and stones are
 * in the same place every run, which is what lets a screenshot and a save agree.
 */
export const SCATTER_SEED = 0x2f9a1c;

/**
 * A small deterministic PRNG (mulberry32). Returns a function yielding 0..1.
 * Copied verbatim from src/stars.js and src/clouds.js rather than imported, so
 * the scatter module stays independent of the sky modules and shares the one
 * generator the whole sim uses -- nothing here touches Math.random.
 */
export function mulberry32(seed) {
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

/** A usable ground point needs finite x and z; anything else is not a place. */
function finiteGroundPoint(value) {
  return value != null && finiteNumber(value.x) && finiteNumber(value.z);
}

/**
 * True when a ground point falls inside, or within `margin` of, any exclusion.
 *
 * A circle is `{x, z, radius}`; a rect is `{minX, maxX, minZ, maxZ}`. The margin
 * widens every exclusion by a fixed distance so a tuft never kisses the lip of
 * the plaza or the foot of a wall -- a little breathing room reads as care, and
 * it keeps props from z-fighting the geometry they abut.
 *
 * Fail safe by design: a malformed point (missing or non-finite x/z) returns
 * true, i.e. "blocked", so a bad candidate is dropped rather than placed
 * somewhere nonsensical. Malformed exclusion entries are skipped rather than
 * throwing, because a single bad circle in a hand-authored list must not take
 * the whole scatter down. Never throws.
 */
export function pointBlocked(point, circles = [], rects = [], margin = 0) {
  // A point we cannot read is treated as blocked: better to place nothing than
  // to place something at NaN.
  if (!finiteGroundPoint(point)) return true;
  const pad = finiteNumber(margin) && margin > 0 ? margin : 0;
  if (Array.isArray(circles)) {
    for (const circle of circles) {
      if (!finiteGroundPoint(circle) || !finiteNumber(circle.radius)) continue;
      const r = circle.radius + pad;
      if (r < 0) continue;
      const dx = point.x - circle.x;
      const dz = point.z - circle.z;
      // Compare squared distances to avoid a sqrt in the inner loop.
      if (dx * dx + dz * dz <= r * r) return true;
    }
  }
  if (Array.isArray(rects)) {
    for (const rect of rects) {
      if (!rect || !finiteNumber(rect.minX) || !finiteNumber(rect.maxX) ||
          !finiteNumber(rect.minZ) || !finiteNumber(rect.maxZ)) continue;
      // Inflate the rectangle by the margin on every side so the keep-out zone
      // is the rect grown by `pad`, matching how a circle's radius grows.
      if (point.x >= rect.minX - pad && point.x <= rect.maxX + pad &&
          point.z >= rect.minZ - pad && point.z <= rect.maxZ + pad) return true;
    }
  }
  return false;
}

/** Normalises an area to finite bounds, or returns null when it is unusable. */
function normaliseArea(area) {
  if (!area || !finiteNumber(area.minX) || !finiteNumber(area.maxX) ||
      !finiteNumber(area.minZ) || !finiteNumber(area.maxZ)) return null;
  const minX = Math.min(area.minX, area.maxX);
  const maxX = Math.max(area.minX, area.maxX);
  const minZ = Math.min(area.minZ, area.maxZ);
  const maxZ = Math.max(area.minZ, area.maxZ);
  // A zero-width or zero-depth area has no room to place anything.
  if (!(maxX > minX) || !(maxZ > minZ)) return null;
  return { minX, maxX, minZ, maxZ };
}

/**
 * Seeded rejection sampling of small ground props.
 *
 * Returns `{ points, rejected, attempts }`. Each point is
 * `{x, z, scale, rotation, variant}`: x/z uniform inside `area`, scale uniform
 * in [minScale, maxScale], rotation uniform in [0, 2*PI), and variant an integer
 * in [0, 3] (four visual variants) chosen by the PRNG.
 *
 * Candidates that land in an exclusion (see {@link pointBlocked}) are rejected
 * and re-rolled, so the result is "as many props as fit in the free ground". The
 * loop is bounded by `maxAttempts` so a fully-blocked area returns fewer points
 * instead of spinning forever -- the caller can see `rejected`/`attempts` and
 * decide whether that is a problem.
 *
 * Everything is guarded: a non-positive count or a degenerate area returns an
 * empty result, and non-finite numbers are clamped or defaulted so no NaN or
 * Infinity ever reaches a point. Deterministic for a given (count, seed, area,
 * exclusions).
 */
export function scatterPoints(options = {}) {
  const opts = options != null && typeof options === 'object' ? options : {};
  const count = finiteNumber(opts.count) ? Math.max(0, Math.floor(opts.count)) : 0;
  const area = normaliseArea(opts.area);
  // No room or nothing to place: return the empty shape without touching the
  // PRNG, so the result is stable and cheap.
  if (count <= 0 || !area) return { points: [], rejected: 0, attempts: 0 };

  const seed = finiteNumber(opts.seed) ? opts.seed : SCATTER_SEED;
  const minScale = finiteNumber(opts.minScale) ? opts.minScale : 0.8;
  const maxScale = finiteNumber(opts.maxScale) ? opts.maxScale : 1.25;
  // Keep the scale band well-formed even if a caller passes it inverted.
  const lo = Math.min(minScale, maxScale);
  const hi = Math.max(minScale, maxScale);
  const margin = finiteNumber(opts.margin) && opts.margin > 0 ? opts.margin : 0;
  const circles = Array.isArray(opts.circles) ? opts.circles : [];
  const rects = Array.isArray(opts.rects) ? opts.rects : [];
  // Bound the work. Default to a generous multiple of the count; a caller can
  // lower it, but never below a single attempt (or nothing is ever tried).
  const requested = finiteNumber(opts.maxAttempts) ? Math.floor(opts.maxAttempts) : count * 40;
  const maxAttempts = Math.max(1, requested);

  const rng = mulberry32(seed);
  const points = [];
  let attempts = 0;
  while (points.length < count && attempts < maxAttempts) {
    attempts += 1;
    const x = area.minX + rng() * (area.maxX - area.minX);
    const z = area.minZ + rng() * (area.maxZ - area.minZ);
    // Roll the per-prop attributes up front so a rejected candidate still
    // advances the PRNG deterministically; only the placement is re-rolled.
    const scale = lo + rng() * (hi - lo);
    const rotation = rng() * Math.PI * 2;
    const variant = Math.min(3, Math.floor(rng() * 4));
    if (pointBlocked({ x, z }, circles, rects, margin)) continue;
    points.push({ x, z, scale, rotation, variant });
  }
  return { points, rejected: attempts - points.length, attempts };
}