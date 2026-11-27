// Where the ivy clings to the border walls, how big each patch is, which way it
// faces, what tint it wears and how it sways -- all decided without a GPU.
//
// The plaza is ringed by 3.2 m stone walls whose inner faces are plain coursed
// masonry. A wall of neat courses reads as a modern retaining wall, not as
// something old; what breaks the courses up and gives the wall a vertical
// silhouette is a scattering of dark green ivy patches, each with an irregular
// edge that eats into the stone. `world.js` renders the whole set as one
// InstancedMesh of quads, each quad carrying a procedurally generated
// leaf-cluster alpha texture and tinted per instance from IVY_TINTS. This module
// is the pure half: it decides where each patch sits, how wide it is, how far up
// the wall it reaches, which way its face points, its tint and a slow sway. One
// patch is ONE quad, not a cloud of leaves -- the texture supplies the leaves,
// and the module only has to place the card.
//
// Three decisions are worth the words.
//
// 1. The default placement is a ring on the wall's inner face. The play area is
//    a 36 m square, so the inner face of each wall is about 16.5 m from the
//    centre. IVY_WALL_RADIUS sits a little inside that face, and each patch's
//    yaw is derived from its own position as atan2(-x, -z) so the quad's outward
//    normal -- (sin(yaw), cos(yaw)) -- points back at the plaza centre. A patch
//    on the outer face of the wall would be invisible from inside the courtyard,
//    so deriving the normal from the position is not just convenient; it is the
//    only orientation that can be seen.
//
// 2. When the world knows its real wall geometry it passes `faces`, an array of
//    { x, z, yaw, length } describing actual wall segments. A patch then picks a
//    face (seeded) and slides along that face's tangent within +/-length/2 of the
//    face centre, and it takes the face's yaw unchanged. The tangent for a yaw is
//    (cos(yaw), -sin(yaw)), which is the normal rotated a quarter turn; the
//    position is face + tangent * offset. The module never second-guesses a
//    supplied face -- a face is real geometry, and a patch belongs on the stone
//    the caller actually built.
//
// 3. A patch never reaches the top of the wall. The wall is 3.2 m tall, and a
//    patch that ran to the coping would read as a curtain hung over the stone
//    rather than ivy growing up it. Every baseY is capped so baseY + span stays
//    at or below 3.1 m, leaving a sliver of bare stone above the highest leaf.
//    The cap only ever lowers a sampled baseY; because the tallest span (2.28 m)
//    still leaves 0.82 m of headroom, the floor of 0.82 m is never violated.
//
// 4. A patch starts above the border wall's trim band. The wall carries a
//    plinth course (0..0.45 m) and a pilaster band (0.45..0.77 m), and both step
//    courtyard-side of the 16.44 m card plane -- 0.06 m and 0.22 m respectively
//    (see `walltrim.js`). A card that began near the ground would therefore be
//    sliced by stone it cannot grow through, which is exactly what the first
//    layout did on 6 of 14 patches. The base floor is 0.82 m: the 0.77 m band
//    top plus the largest corner dip a card can swing into from its own sway
//    rotation (half the widest card times sin of the widest sway, 0.033 m),
//    rounded up. The cost is that no patch creeps up from the foot of the wall,
//    but ivy that has climbed reads better than ivy cut off at knee height, and
//    the floor clears the band for every possible patch rather than for the
//    shipped seed alone.
//
// The seeded draws are laid out so the ring and the `faces` path consume the RNG
// in exactly the same order: two position draws first (the ring uses the first
// for its angle and discards the second; the faces path uses them for the face
// pick and the tangent offset), then width, span, baseY, phase, tint and sway.
// Adding a real face list therefore changes only where a patch sits and which
// way it faces, never its size, tint or sway.
//
// Everything here is seeded (mulberry32, copied rather than imported so the
// module stands alone) and pure: no Three.js, no DOM, no clock, no Math.random.
// Two identical runs place the same ivy, and the placement can be pinned by unit
// tests. Every export is total -- it guards junk input, and no call can produce
// NaN or Infinity.

/** Seed for the ivy generator. Fixed so every run grows the same patches. */
export const IVY_SEED = 0x8b3e52;

/** How many patches the walls carry. One instanced draw call regardless. */
export const IVY_COUNT = 14;

/** Upper clamp on a caller-supplied count, so a typo cannot carpet the walls.
 *  Even at the cap the quads are sparse enough to read as scattered ivy. */
export const IVY_MAX_COUNT = 80;

/** Default ring radius from the plaza centre, in metres. The wall inner face is
 *  at about 16.5 m, so this sits just inside it and keeps every patch on the
 *  visible stone rather than floating in front of it. */
export const IVY_WALL_RADIUS = 16.3;

/** Lowest base height above the ground, in metres. A patch that starts at the
 *  very foot of the wall reads as ground cover creeping in, and worse, it is
 *  cut by the border wall's plinth and pilaster courses, which step in front of
 *  the card plane up to 0.77 m. 0.82 m clears that band plus the widest sway
 *  dip (see the header). */
export const IVY_MIN_BASE_Y = 0.82;

/** Highest base height above the ground, in metres. Above this a patch starts
 *  too near the top of the 3.2 m wall to leave any bare stone showing. */
export const IVY_MAX_BASE_Y = 1.6;

/** Smallest patch width along the wall, in metres. Below about 0.7 m a patch
 *  aliases into a dark smudge at courtyard distance. */
export const IVY_MIN_WIDTH = 0.7;

/** Largest patch width along the wall, in metres. Above this one patch spans a
 *  whole panel and stops reading as a plant. */
export const IVY_MAX_WIDTH = 1.9;

/** Smallest patch height up the wall, in metres. A shorter patch reads as a
 *  stain rather than a climber. */
export const IVY_MIN_SPAN = 0.9;

/** Largest patch height up the wall, in metres. Chosen so baseY + span can stay
 *  under the 3.1 m cap even at the raised 0.82 m floor: 0.82 + 2.28 = 3.10. */
export const IVY_MAX_SPAN = 2.28;

/** Smallest sway amplitude, in radians. Even on a still day a leaf edge moves a
 *  little; zero would make the card look like paint. */
export const IVY_MIN_SWAY = 0.01;

/** Largest sway amplitude, in radians. Enough to notice at the wall without the
 *  patch visibly detaching from the stone. */
export const IVY_MAX_SWAY = 0.035;

/**
 * The ivy palette, as hex numbers. Four dark-to-mid greens -- a deep shaded
 * green, a lighter sunlit green, a cold blue-green and a yellow-green -- so a
 * wall of patches reads as more than one plant and more than one depth. `tint`
 * in a spawn descriptor is an index into this array; the world looks the value
 * up and colours the instance, keeping this file free of renderer detail.
 */
export const IVY_TINTS = Object.freeze([
  0x3f6b32, // deep shaded green
  0x4e7a35, // sunlit green
  0x2f5a2c, // cold blue-green
  0x5c7f3a  // yellow-green
]);

/**
 * Per-phase multiplier applied to a patch's colour. Ivy is a plant in daylight,
 * so it is fully lit by day, dims a little at dusk as the light warms and
 * falls, and drops to a dark silhouette at night when a bright green would be
 * the most saturated thing on a moonlit wall. The values are multipliers, not
 * absolute colours, so the world can apply them without rebuilding buffers.
 */
export const IVY_PHASE_GLOW = Object.freeze({
  day: 1,
  dusk: 0.8,
  night: 0.35
});

/** The highest a patch may reach on the 3.2 m wall, in metres. The 0.1 m below
 *  the coping keeps a strip of bare stone above every patch. */
const IVY_TOP_LIMIT = 3.1;

/** Angular speed of the sway, in radians per second. Slow enough that a patch
 *  drifts rather than flutters; ivy on stone is not a flag. */
const IVY_SWAY_SPEED = 0.55;

/** Angular speed of the brightness breathing, in radians per second. Slower
 *  than the sway so the two do not pulse in lockstep. */
const IVY_BREATH_SPEED = 0.4;

/** Centre and half-amplitude of the brightness breathing: the result stays in
 *  [0.92, 1.0], so a patch is always just short of flat white. */
const IVY_BREATH_BASE = 0.96;
const IVY_BREATH_AMP = 0.04;

/** A small deterministic PRNG (mulberry32). Copied from the other pure modules
 *  rather than imported, so `ivy.js` stays independent of them. */
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

/** A usable wall face needs finite x, z and yaw and a finite, non-negative
 *  length. Everything else is dropped rather than repaired: a patch placed from
 *  a broken face would hang off the stone, which is worse than one fewer face.
 *  An array that survives none of its entries reads as null, so the caller falls
 *  back to the seeded ring rather than losing its ivy. */
function usableFaces(raw) {
  if (!Array.isArray(raw)) return null;
  const faces = [];
  for (let i = 0; i < raw.length; i += 1) {
    const f = raw[i];
    if (f === null || typeof f !== 'object' || Array.isArray(f)) continue;
    if (!finiteNumber(f.x) || !finiteNumber(f.z)) continue;
    if (!finiteNumber(f.yaw) || !finiteNumber(f.length)) continue;
    if (f.length < 0) continue;
    faces.push({ x: f.x, z: f.z, yaw: f.yaw, length: f.length });
  }
  return faces.length ? faces : null;
}

/** The per-phase glow multiplier. Unknown phase, or a non-string, falls back to
 *  the `day` value (1), so a new phase id can never darken the ivy by accident. */
export function ivyGlowLevel(phaseId) {
  if (typeof phaseId !== 'string') return IVY_PHASE_GLOW.day;
  return Object.prototype.hasOwnProperty.call(IVY_PHASE_GLOW, phaseId)
    ? IVY_PHASE_GLOW[phaseId]
    : IVY_PHASE_GLOW.day;
}

/**
 * The spawn descriptors for every patch.
 *
 * Each descriptor is `{ x, z, yaw, width, span, baseY, phase, tint, sway }`:
 *   - `x` and `z` are metres from the plaza centre, on the wall face;
 *   - `yaw` is in radians, and the patch's outward normal is
 *     (sin(yaw), cos(yaw)); on the ring it is atan2(-x, -z), which points the
 *     normal back at the plaza centre;
 *   - `width` is metres along the wall in [IVY_MIN_WIDTH, IVY_MAX_WIDTH];
 *   - `span` is metres up the wall in [IVY_MIN_SPAN, IVY_MAX_SPAN];
 *   - `baseY` is metres above ground in [IVY_MIN_BASE_Y, IVY_MAX_BASE_Y], with
 *     baseY + span <= 3.1;
 *   - `phase` is in [0, 1);
 *   - `tint` is an integer index into IVY_TINTS;
 *   - `sway` is this patch's sway amplitude in [IVY_MIN_SWAY, IVY_MAX_SWAY].
 *
 * With no `faces`, a seeded angle in [0, 2*PI) places the patch on the ring:
 * x = cos(angle)*IVY_WALL_RADIUS and z = sin(angle)*IVY_WALL_RADIUS. With a
 * usable `faces` array, a patch instead picks a face and slides along its
 * tangent (cos(yaw), -sin(yaw)) by an offset in [-length/2, length/2], taking
 * the face's yaw. The two position draws are consumed in both modes, so size,
 * tint, phase and sway depend only on the seed and index, not on whether faces
 * were supplied.
 *
 * The return is an array of exactly `count` objects. A non-finite `count` falls
 * back to IVY_COUNT; a finite count clamps into [0, IVY_MAX_COUNT] and floors. A
 * non-finite `seed` falls back to IVY_SEED. Malformed face entries are dropped,
 * and an empty or junk `faces` array falls back to the ring. The call never
 * throws and never yields NaN or Infinity.
 */
export function ivySpawns(options = {}) {
  const opts = options !== null && typeof options === 'object' && !Array.isArray(options)
    ? options
    : {};

  const n = finiteNumber(opts.count)
    ? Math.min(IVY_MAX_COUNT, Math.max(0, Math.floor(opts.count)))
    : IVY_COUNT;
  const base = finiteNumber(opts.seed) ? opts.seed : IVY_SEED;

  const faces = usableFaces(opts.faces);
  const rng = mulberry32(base >>> 0);
  const spawns = [];

  for (let i = 0; i < n; i += 1) {
    // Two position draws, always consumed in this order. The ring spends the
    // first on its angle and discards the second; the faces path spends them on
    // the face pick and the tangent offset. Keeping the pair in both modes is
    // what holds the later draws aligned.
    const a = rng();
    const b = rng();

    let x;
    let z;
    let yaw;
    if (faces) {
      const face = faces[Math.min(faces.length - 1, Math.floor(a * faces.length))];
      const offset = (b - 0.5) * face.length;
      const tx = Math.cos(face.yaw);
      const tz = -Math.sin(face.yaw);
      x = face.x + tx * offset;
      z = face.z + tz * offset;
      yaw = face.yaw;
    } else {
      const angle = a * Math.PI * 2;
      x = Math.cos(angle) * IVY_WALL_RADIUS;
      z = Math.sin(angle) * IVY_WALL_RADIUS;
      // The outward normal (sin yaw, cos yaw) then points at the plaza centre.
      yaw = Math.atan2(-x, -z);
    }

    const width = IVY_MIN_WIDTH + rng() * (IVY_MAX_WIDTH - IVY_MIN_WIDTH);
    const span = IVY_MIN_SPAN + rng() * (IVY_MAX_SPAN - IVY_MIN_SPAN);
    // Cap the base so the patch never reaches the coping; the tallest span
    // leaves exactly 0.82 m of headroom, so this can never push baseY below
    // its floor.
    const sampledBase = IVY_MIN_BASE_Y + rng() * (IVY_MAX_BASE_Y - IVY_MIN_BASE_Y);
    const baseY = Math.min(sampledBase, IVY_TOP_LIMIT - span);
    const phase = rng();
    // The min guards the theoretical 1.0 edge of rng() so the index cannot fall
    // off the table.
    const tint = Math.min(IVY_TINTS.length - 1, Math.floor(rng() * IVY_TINTS.length));
    const sway = IVY_MIN_SWAY + rng() * (IVY_MAX_SWAY - IVY_MIN_SWAY);

    spawns.push({ x, z, yaw, width, span, baseY, phase, tint, sway });
  }

  return spawns;
}

/**
 * One patch's sway and brightness at `time`, as `{ sway, brightness }`.
 *
 * `sway` is the patch's own amplitude times a slow sine of `time` offset by the
 * patch's phase, so neighbouring patches drift out of step instead of rocking
 * together. `brightness` is a gentle 0.92..1.0 breathing on a slower, unlinked
 * sine, so a patch never reads as a flat painted-on decal. Both results are
 * finite: the sine argument is checked before the trig call, so an absurdly
 * large time (whose product would overflow to Infinity) falls back to a still
 * frame rather than producing NaN.
 *
 * A junk patch -- null, a number, a string, an array -- yields
 * `{ sway: 0, brightness: 1 }`, an untinted still patch. A non-finite time reads
 * as 0. Inside a real patch, a non-finite `sway` reads as 0 amplitude and a
 * non-finite `phase` as 0.
 */
export function ivySway(patch, time) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return { sway: 0, brightness: 1 };
  }

  const amplitude = clampNumber(patch.sway, 0, IVY_MAX_SWAY, 0);
  const phase = finiteNumber(patch.phase) ? patch.phase : 0;
  const t = finiteNumber(time) ? time : 0;
  const turn = phase * Math.PI * 2;

  // Guard the scaled argument itself: a finite but enormous time can still push
  // t * speed past Number.MAX_VALUE, and Math.sin(Infinity) is NaN.
  const swingAngle = t * IVY_SWAY_SPEED + turn;
  const swing = Number.isFinite(swingAngle) ? Math.sin(swingAngle) : 0;
  const sway = clampNumber(amplitude * swing, -IVY_MAX_SWAY, IVY_MAX_SWAY, 0);

  const breathAngle = t * IVY_BREATH_SPEED + turn;
  const breath = Number.isFinite(breathAngle) ? Math.sin(breathAngle) : 0;
  const brightness = clampNumber(
    IVY_BREATH_BASE + IVY_BREATH_AMP * breath,
    0,
    1,
    1
  );

  return { sway, brightness };
}

/** Whether the ivy runs at this quality tier. The low tier drops the instanced
 *  wall dressing, consistent with the quality-tier convention; junk reads as the
 *  full tier, so an unexpected tier never silently strips the walls bare. */
export function ivyEnabled(tier) {
  return tier !== 'low';
}
