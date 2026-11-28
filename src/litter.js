// Where the fallen leaves lie on the meadow, decided without a GPU.
//
// The plaza's grass ring is a flat plane wearing a grass texture, and a plane
// with a texture reads as a mown lawn rather than as ground. Grass tufts break
// that plane up, but a summer meadow also carries the litter of its own trees:
// a scatter of small dry leaves in warm browns and ochres lying flat in the
// grass. Without them the ring reads as turf that someone vacuums; with them it
// reads as a place where trees stand. The whole field is one InstancedMesh of
// tiny leaf quads, so the realism costs a single draw call, and this module is
// the pure half of it: it decides where each leaf lies, how it is turned, how
// big it is and which of a few leaf colours and shapes it wears. `world.js`
// only turns those numbers into instance matrices and colours.
//
// Three decisions are worth the words.
//
// 1. The leaves live in the meadow ring, not on the plaza. The plaza is paved,
//    swept and walked; leaves belong in the grass beyond its edge, under and
//    around the trees. Keeping every leaf between LITTER_MIN_RADIUS and
//    LITTER_MAX_RADIUS puts the field off the paving and inside the border wall
//    without a rejection loop. LITTER_MAX_RADIUS sits a little inside the wall's
//    inner face so no leaf pokes through the stonework.
//
// 2. The ring is sampled area-uniformly, not radially. A firefly ring is
//    decorative and may crowd its inner edge, but litter should fall evenly
//    across the grass, and a plain uniform radius would pile the leaves towards
//    the plaza. Drawing the radius from the square root of a uniform value makes
//    the density even, which is what a meadow actually looks like.
//
// 3. `tint` and `variant` are indices, not colours and geometry. The module
//    hands out a small integer for each, and the world looks the value up in
//    LITTER_TINTS (a colour) or in its own four leaf shapes. That keeps this
//    file free of any renderer detail and lets the world share one material
//    across the whole field.
//
// The world can also pass `keepOut`, a list of ground circles the leaves must
// avoid -- the fountain bowl, the foot of a tree trunk, the lane mouth -- and
// each candidate is resampled a bounded number of times before it is accepted
// anyway, so a pathological keep-out set can never starve the field of its
// promised count.
//
// Everything here is seeded (mulberry32, copied rather than imported so the
// module stands alone) and pure: no Three.js, no DOM, no clock, no Math.random.
// That is what lets a saved meadow match a fresh boot, and what lets the field
// be pinned by unit tests. Every export is total -- it guards junk input and no
// call can produce NaN or Infinity.

/** Seed for the litter generator. Fixed so every run scatters the same leaves. */
export const LITTER_SEED = 0x3c91a7;

/** How many leaves the field holds. One instanced draw call regardless. */
export const LITTER_COUNT = 140;

/** Upper clamp on a caller-supplied count, so a typo cannot allocate a forest
 *  of leaves. 600 over this ring is still sparse enough to read as scatter. */
export const LITTER_MAX_COUNT = 600;

/** Inner edge of the meadow ring, in metres from the plaza centre. The paved
 *  plaza disc has a 9 m radius; this sits just outside it so leaves fall in
 *  grass rather than on stone. */
export const LITTER_MIN_RADIUS = 9.4;

/** Outer edge of the meadow ring, in metres. The border wall's inner face is at
 *  16.5 m, so this stops short of it and keeps leaves out of the stonework. */
export const LITTER_MAX_RADIUS = 16.2;

/** Smallest instance scale multiplier. Below about half size a leaf aliases
 *  away to a speck on the ground at eye height. */
export const LITTER_MIN_SCALE = 0.55;

/** Largest instance scale multiplier. Above this a leaf stops reading as a
 *  leaf and starts reading as a dropped paper bag. */
export const LITTER_MAX_SCALE = 1.3;

/** How many leaf shapes exist. `variant` is an index in [0, LITTER_VARIANTS);
 *  the world emits that many instanced leaf geometries, so variety costs only
 *  instance data. */
export const LITTER_VARIANTS = 4;

/**
 * The leaf palette, as hex numbers. Five warm dry-leaf colours -- russet,
 * ochre, brown, olive and pale gold -- so a scatter reads as the mixed fall of
 * more than one kind of tree. A single colour would read as a decal; the mix is
 * what makes the field look strewn rather than stamped. `tint` in a spawn
 * descriptor is an index into this array.
 */
export const LITTER_TINTS = Object.freeze([
  0xa9552b, // russet
  0xb87a2e, // ochre
  0x6e4a26, // brown
  0x8f8a3c, // olive
  0xc9a24b  // pale gold
]);

/**
 * Per-phase multiplier applied to the leaves' colour. Litter is a ground
 * detail, so it is brightest in daylight, dims a little at dusk as the light
 * warms and cools, and all but vanishes at night when a warm brown leaf would
 * otherwise be the brightest thing on a dark lawn. The values are multipliers,
 * not absolute colours, so the world can apply them without rebuilding buffers.
 */
export const LITTER_PHASE_GLOW = Object.freeze({
  day: 1,
  dusk: 0.85,
  night: 0.35
});

/** A small deterministic PRNG (mulberry32). Copied from the other pure modules
 *  rather than imported, so `litter.js` stays independent of them. */
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

/** A usable keep-out circle needs finite x and z and a finite, non-negative
 *  radius. `r` is the canonical field; `radius` is accepted as an alias because
 *  the scatter module already hands out circles shaped that way, and making the
 *  caller reshape them would only invite a bug. */
function usableCircle(circle) {
  if (circle == null || typeof circle !== 'object') return null;
  if (!finiteNumber(circle.x) || !finiteNumber(circle.z)) return null;
  const r = finiteNumber(circle.r) ? circle.r : finiteNumber(circle.radius) ? circle.radius : null;
  if (r == null || r < 0) return null;
  return { x: circle.x, z: circle.z, r };
}

/** True when a ground point falls inside any usable keep-out circle. Malformed
 *  entries are skipped rather than throwing, and a non-array reads as "no
 *  keep-outs", so one bad circle cannot take the meadow down. */
function pointInCircles(x, z, circles) {
  if (!Array.isArray(circles)) return false;
  for (let i = 0; i < circles.length; i += 1) {
    const c = circles[i];
    if (c == null) continue;
    const dx = x - c.x;
    const dz = z - c.z;
    // Compare squared distances to avoid a sqrt in the inner loop.
    if (dx * dx + dz * dz <= c.r * c.r) return true;
  }
  return false;
}

/** The per-phase glow multiplier. Unknown phase, or a non-string, falls back to
 *  the `day` value (1), so a new phase id can never darken the field by
 *  accident. */
export function litterGlowLevel(phaseId) {
  if (typeof phaseId !== 'string') return LITTER_PHASE_GLOW.day;
  return Object.prototype.hasOwnProperty.call(LITTER_PHASE_GLOW, phaseId)
    ? LITTER_PHASE_GLOW[phaseId]
    : LITTER_PHASE_GLOW.day;
}

/** How many times a blocked candidate is resampled before it is accepted
 *  anyway. Eight keeps a keep-out-covered field from spinning while making it
 *  vanishingly unlikely that a leaf lands inside a small circle by chance. */
const KEEP_OUT_ATTEMPTS = 8;

/**
 * The spawn descriptors for the whole field.
 *
 * Each descriptor is `{ x, z, yaw, scale, tint, variant }`:
 *   - `x` and `z` are metres from the plaza centre, sampled area-uniformly in
 *     the ring (see the header);
 *   - `yaw` is the leaf's rotation about the vertical axis, in [0, 2*PI);
 *   - `scale` is a multiplier in [minScale, maxScale];
 *   - `tint` is an integer index into LITTER_TINTS;
 *   - `variant` is an integer index in [0, LITTER_VARIANTS).
 *
 * The return is an array of exactly `count` objects. A junk `count` falls back
 * to LITTER_COUNT; a finite count clamps into [0, LITTER_MAX_COUNT] and floors.
 * A non-finite seed falls back to LITTER_SEED, swapped radii are exchanged,
 * negative radii clamp to 0, and `keepOut` entries are validated and skipped if
 * malformed. Candidates that land inside a keep-out circle are resampled up to
 * KEEP_OUT_ATTEMPTS times and then accepted, so the count is always honoured
 * even if the keep-outs cover the whole ring. The call never throws and never
 * yields NaN or Infinity.
 */
export function litterSpawns(options) {
  const opts = options != null && typeof options === 'object' && !Array.isArray(options)
    ? options
    : {};

  const n = finiteNumber(opts.count)
    ? Math.min(LITTER_MAX_COUNT, Math.max(0, Math.floor(opts.count)))
    : LITTER_COUNT;
  const base = finiteNumber(opts.seed) ? opts.seed : LITTER_SEED;

  let lo = clampNumber(opts.minRadius, 0, Infinity, LITTER_MIN_RADIUS);
  let hi = clampNumber(opts.maxRadius, 0, Infinity, LITTER_MAX_RADIUS);
  if (lo > hi) {
    const swap = lo;
    lo = hi;
    hi = swap;
  }

  let sLo = clampNumber(opts.minScale, 0, Infinity, LITTER_MIN_SCALE);
  let sHi = clampNumber(opts.maxScale, 0, Infinity, LITTER_MAX_SCALE);
  if (sLo > sHi) {
    const swap = sLo;
    sLo = sHi;
    sHi = swap;
  }

  // Normalise the keep-outs once, so the inner loop tests only valid circles.
  const circles = [];
  if (Array.isArray(opts.keepOut)) {
    for (let i = 0; i < opts.keepOut.length; i += 1) {
      const c = usableCircle(opts.keepOut[i]);
      if (c != null) circles.push(c);
    }
  }

  // Precompute the area-uniform radius band. hi*hi - lo*lo is non-negative
  // because the swap above guarantees lo <= hi.
  const lo2 = lo * lo;
  const span = hi * hi - lo2;

  const rng = mulberry32(base >>> 0);
  const spawns = [];
  for (let i = 0; i < n; i += 1) {
    let x = 0;
    let z = 0;
    // Sample a candidate, and if it falls in a keep-out, resample. After the
    // bounded attempts the last candidate is accepted, which is the deliberate
    // fallback that keeps the promised count intact.
    for (let attempt = 0; attempt < KEEP_OUT_ATTEMPTS; attempt += 1) {
      const angle = rng() * Math.PI * 2;
      const radius = Math.sqrt(lo2 + rng() * span);
      x = Math.cos(angle) * radius;
      z = Math.sin(angle) * radius;
      if (!pointInCircles(x, z, circles)) break;
    }
    const yaw = rng() * Math.PI * 2;
    const scale = sLo + rng() * (sHi - sLo);
    // A floor of rng()*n lands in [0, n-1] because rng() is in [0, 1); the min
    // guards the theoretical 1.0 edge so the index can never fall off the table.
    const tint = Math.min(LITTER_TINTS.length - 1, Math.floor(rng() * LITTER_TINTS.length));
    const variant = Math.min(LITTER_VARIANTS - 1, Math.floor(rng() * LITTER_VARIANTS));
    spawns.push({ x, z, yaw, scale, tint, variant });
  }
  return spawns;
}

/** Whether the litter field runs at this quality tier. The low tier drops the
 *  instanced dressing, consistent with the quality-tier convention; junk reads
 *  as the full tier, so an unexpected tier never silently removes the leaves. */
export function litterEnabled(tier) {
  return tier !== 'low';
}
