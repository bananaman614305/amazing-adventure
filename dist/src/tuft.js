// The shape of a grass tuft, decided without a GPU.
//
// The courtyard's grass ring is a textured plane. A plane with a texture has no
// silhouette: from a standing eye the ground meets the props in one straight
// line, and nothing breaks that line, so the lawn reads as a painted floor. What
// makes ground read as ground is small geometry standing on it -- blades that
// catch the light at a different angle from the texture beneath them and that
// cut the horizon between a prop's foot and the grass.
//
// This module decides that geometry: how many blades a tuft has, how far each
// leans out from the centre, how wide and tall it is, and what colour it is at
// the root versus the tip. `world.js` takes the buffers and makes one
// InstancedMesh out of them, so a thousand tufts cost one draw call.
//
// Two decisions are worth the words:
//
// 1. Blade normals point up, not outward. A grass blade is a paper-thin
//    triangle; lit by its true normal it turns black the moment it faces away
//    from the sun, and a tuft of black spikes is worse than no tuft at all. Real
//    grass looks lit from above because it scatters light, so the accepted trick
//    is to fake that: every vertex normal is `+y`, and the tuft catches light
//    exactly like the ground it grows from, with only its silhouette reading as
//    geometry. That is also why the material renders double-sided.
//
// 2. The colour is baked as a base-to-tip gradient. A blade's root is in its own
//    shadow and in the shadow of the clump; its tip is in the light. A flat tuft
//    colour reads as a plastic spike, and the gradient is free at this scale --
//    it lives in a vertex attribute the mesh already uploads.
//
// Everything is deterministic (seeded mulberry32, no clock, no Math.random) and
// total: every export guards junk input and no call can produce NaN. The module
// has no Three.js dependency, so the geometry can be pinned by unit tests.

/**
 * Seed for the blade generator. Fixed so every run builds the same four
 * variants, which is what lets a saved world and a fresh boot agree.
 */
export const TUFT_SEED = 0x7a3f11;

/**
 * Blades per tuft. Five is the smallest count where a tuft reads as a clump
 * rather than a spike: three leaves a visible gap, four still reads as a cross,
 * and above six the extra blades are mostly hidden by the ones in front while
 * every one of them costs a triangle in an instanced buffer multiplied by the
 * instance count.
 */
export const TUFT_BLADES = 5;

/**
 * How many visual variants exist. The scatter module hands out `variant` in
 * [0, 3], so four shapes are enough to break up repetition; `world.js` emits the
 * four variants as instances of one InstancedMesh, so the whole meadow is still
 * a single draw call and the variety costs only instance data.
 */
export const TUFT_VARIANTS = 4;

/** Tallest blade in a tuft, in metres, before the instance scale is applied.
 *  Deliberately short: a 0.4 m clump is ankle-high from a 1.7 m eye, so it
 *  breaks the ground line without becoming a hedge the player walks through. */
export const TUFT_HEIGHT = 0.42;

/** Radius of the clump's footprint, in metres. A tuft that spreads wider than
 *  this stops reading as one plant and starts reading as a patch of grass. */
export const TUFT_RADIUS = 0.16;

/** Half-width of a single blade at its root, in metres. Thin enough to catch
 *  light as an edge, wide enough not to alias away at distance. */
export const TUFT_BLADE_WIDTH = 0.022;

/** Root colour: dark, cool and close to the ground's own shadow, so the base
 *  of a tuft does not float above the lawn it grows out of. */
export const TUFT_BASE_TINT = 0x33501f;

/** Tip colour: the sunlit green of dry meadow grass, a touch yellow so the
 *  tufts read as summer rather than as a green carpet with spikes. */
export const TUFT_TIP_TINT = 0xa8c067;

/**
 * Per-phase multiplier applied to the baked vertex colours (see
 * `tuftPhaseTint`). The baked colours are the daylight ones; a phase tint
 * darkens and cools the whole tuft without rebuilding its buffers, which is the
 * cheap way to keep grass from glowing at night. Dusk warms it instead.
 */
export const TUFT_PHASE_TINT = Object.freeze({
  day: 0xffffff,
  dusk: 0xd9b9a2,
  night: 0x46536e
});

/**
 * Maximum lean of an instance under full wind, in radians (~12.6 degrees).
 * Small on purpose: the grass leans, it does not fold flat. Anything past about
 * a quarter radian reads as an object being pushed rather than as wind.
 */
export const TUFT_MAX_LEAN = 0.22;

/** A small deterministic PRNG (mulberry32). Copied from the other pure modules
 *  rather than imported, so `tuft.js` stays independent of them. */
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

/** Clamp to [lo, hi], with a non-finite value replaced by `fallback`. */
function clampNumber(value, lo, hi, fallback = lo) {
  if (!finiteNumber(value)) return fallback;
  return Math.min(hi, Math.max(lo, value));
}

/** The per-phase colour multiplier as a hex number. Unknown phases fall back to
 *  the daylight tint (white, i.e. no change), so a new phase id cannot silently
 *  black the grass out. */
export function tuftPhaseTint(phaseId) {
  if (typeof phaseId !== 'string') return TUFT_PHASE_TINT.day;
  return Object.prototype.hasOwnProperty.call(TUFT_PHASE_TINT, phaseId)
    ? TUFT_PHASE_TINT[phaseId]
    : TUFT_PHASE_TINT.day;
}

/**
 * The blades of one variant, as plain numbers.
 *
 * Each blade carries its own angle around the tuft, the radius of its root from
 * the centre, an outward lean, a height and a sway factor. The per-blade values
 * come from a PRNG seeded with `variant`, so variant 2 is the same shape in
 * every session and on every device -- the reason the module takes no clock.
 *
 * The return is an array of exactly {@link TUFT_BLADES} objects. A junk
 * `variant` is folded to 0 rather than throwing, so a bad scatter point can
 * never take the meadow down.
 */
export function tuftBlades(variant, seed = TUFT_SEED) {
  const v = finiteNumber(variant) ? Math.abs(Math.floor(variant)) % TUFT_VARIANTS : 0;
  const base = finiteNumber(seed) ? seed : TUFT_SEED;
  // Mixing the variant into the seed rather than using it as the seed keeps
  // the four shapes from being four separate generator states that happen to
  // start close together.
  const rng = mulberry32((base ^ (v * 0x9e3779b1)) >>> 0);
  const blades = [];
  for (let i = 0; i < TUFT_BLADES; i += 1) {
    // Even fan with jitter: a perfectly even fan looks machined, a fully random
    // one clumps, so the angle is the even share plus up to a third of a share.
    const share = (Math.PI * 2) / TUFT_BLADES;
    const angle = i * share + (rng() - 0.5) * share * 0.66;
    const radius = TUFT_RADIUS * (0.15 + rng() * 0.45);
    // Height varies blade to blade so the tuft has a ragged top; the tallest
    // blade approaches TUFT_HEIGHT, so the clump's silhouette has a definite
    // size without every leaf standing at the same mark.
    const height = TUFT_HEIGHT * (0.55 + rng() * 0.45);
    const width = TUFT_BLADE_WIDTH * (0.7 + rng() * 0.6);
    // Outward lean, in metres at the tip. A tuft whose blades all leave the
    // same point reads as a star; splayed roots and tips read as a plant. Kept
    // to a fraction of the clump radius so root plus lean never pushes a tip
    // past TUFT_RADIUS -- a clump that spreads wider stops reading as one plant.
    const lean = TUFT_RADIUS * (0.1 + rng() * 0.3);
    // Per-blade shade breaks the clump into lit and shaded leaves rather than
    // one flat green fan.
    const shade = 0.82 + rng() * 0.18;
    blades.push({ angle, radius, height, width, lean, shade });
  }
  return blades;
}

/**
 * The geometry of one variant as typed arrays ready for a BufferGeometry.
 *
 * Non-indexed on purpose: each blade is a single triangle, so there are
 * `TUFT_BLADES * 3` vertices and no index buffer to reason about. At five
 * blades that is fifteen vertices per tuft -- the index buffer would have saved
 * a third of the vertex data and cost a buffer upload for the privilege, which
 * is the wrong trade at this size.
 *
 * Returns `{ positions, colours, normals, triangles, vertexCount, height }`.
 * `triangles` is the number of triangle corners (`TUFT_BLADES * 3`), i.e. the
 * number of vertices the buffers hold, and `vertexCount` is the same number
 * named plainly. Both are exported because the browser check and the unit tests
 * want to state the buffer size without recomputing `TUFT_BLADES * 3`.
 *
 * Buffers are Float32 (what WebGL wants), every value is finite, and no vertex
 * has a negative y: a blade that dipped below the ground plane would z-fight with
 * the lawn it grows from.
 */
export function tuftGeometry(variant) {
  const blades = tuftBlades(variant);
  const triangles = TUFT_BLADES * 3;
  const vertexCount = triangles;
  const positions = new Float32Array(vertexCount * 3);
  const colours = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);

  // sRGB-ish channel split of the two authored tints, done once.
  const baseR = ((TUFT_BASE_TINT >> 16) & 0xff) / 255;
  const baseG = ((TUFT_BASE_TINT >> 8) & 0xff) / 255;
  const baseB = (TUFT_BASE_TINT & 0xff) / 255;
  const tipR = ((TUFT_TIP_TINT >> 16) & 0xff) / 255;
  const tipG = ((TUFT_TIP_TINT >> 8) & 0xff) / 255;
  const tipB = (TUFT_TIP_TINT & 0xff) / 255;

  let top = 0;
  for (let i = 0; i < blades.length; i += 1) {
    const blade = blades[i];
    const cos = Math.cos(blade.angle);
    const sin = Math.sin(blade.angle);
    // Root centre sits a little off the tuft's centre along the blade's own
    // angle, so a clump has a hollow middle rather than every blade sharing a
    // single point.
    const rootX = cos * blade.radius;
    const rootZ = sin * blade.radius;
    // The blade's width runs perpendicular to the direction it leans.
    const perpX = -sin;
    const perpZ = cos;
    // Tip: further out than the root by the blade's outward lean, and up by its
    // height. The lean is measured *from the root*, so it must not add the root
    // radius a second time -- rootX already carries it, and double-counting
    // spread every clump past TUFT_RADIUS (0.278 m against a claimed 0.16 m),
    // which turned one plant into a patch. Composing the lean in the ground
    // plane keeps the tip's y a clean function of height, which the tests assert.
    const tipX = rootX + cos * blade.lean;
    const tipZ = rootZ + sin * blade.lean;
    const tipY = blade.height;
    if (tipY > top) top = tipY;

    const shade = blade.shade;
    // Three corners: root left, root right, tip. Root is base colour, tip is
    // tip colour; the per-blade shade multiplies both so leaves differ.
    const xs = [rootX + perpX * blade.width, rootX - perpX * blade.width, tipX];
    const ys = [0, 0, tipY];
    const zs = [rootZ + perpZ * blade.width, rootZ - perpZ * blade.width, tipZ];
    const taper = [0, 0, 1];
    for (let corner = 0; corner < 3; corner += 1) {
      const v = (i * 3 + corner) * 3;
      positions[v] = xs[corner];
      positions[v + 1] = ys[corner];
      positions[v + 2] = zs[corner];
      // Normals all point up (see the header): grass scatters light, it does
      // not reflect it off a flat leaf face.
      normals[v] = 0;
      normals[v + 1] = 1;
      normals[v + 2] = 0;
      const t = taper[corner];
      colours[v] = (baseR + (tipR - baseR) * t) * shade;
      colours[v + 1] = (baseG + (tipG - baseG) * t) * shade;
      colours[v + 2] = (baseB + (tipB - baseB) * t) * shade;
    }
  }

  return { positions, colours, normals, triangles, vertexCount, height: top };
}

/**
 * The lean angle in radians for one instance, from the wind's signed sway.
 *
 * The sway is expected in [-1, 1] (see `windSway` in `wind.js`), and is
 * multiplied by {@link TUFT_MAX_LEAN} and clamped so a caller that hands over
 * an out-of-range or junk value can never fold the grass flat. Positive and
 * negative both lean the tuft, in opposite directions -- the axis is the
 * caller's job (see {@link tuftLeanAxis}), because only the renderer knows which
 * way is "downwind" for its own transform order.
 */
export function tuftLeanAngle(sway) {
  const amount = clampNumber(sway, -1, 1, 0);
  return amount * TUFT_MAX_LEAN;
}

/**
 * The unit axis to rotate a tuft about so that it leans downwind.
 *
 * Given the wind's direction in the ground plane, the tuft must tip towards it,
 * which is a rotation about the horizontal axis perpendicular to it:
 * `cross(up, wind)`. The result is unit length and horizontal for any finite
 * input; a degenerate direction falls back to +x, and junk falls back to
 * `{x: 0, y: 0, z: 1}` (tilting about z, i.e. leaning along +x), which is the
 * `windDirection` default rather than a NaN quaternion.
 */
export function tuftLeanAxis(direction) {
  let dx = direction != null && finiteNumber(direction.x) ? direction.x : 1;
  let dz = direction != null && finiteNumber(direction.z) ? direction.z : 0;
  const length = Math.hypot(dx, dz);
  if (!Number.isFinite(length) || length < 1e-9) {
    dx = 1;
    dz = 0;
  } else {
    dx /= length;
    dz /= length;
  }
  // up x (dx, 0, dz) = (0, 1, 0) x (dx, 0, dz) = (dz, 0, -dx)
  return { x: dz, y: 0, z: -dx };
}
