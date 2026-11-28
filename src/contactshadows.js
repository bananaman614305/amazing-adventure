// Contact darkening where upright props meet the ground, decided without a GPU.
//
// A prop standing in open daylight casts a real shadow, but a shadow map only
// resolves down to its own texel size. On this host the sun's map is small
// (see the shadow settings in `world.js`), so the last hand's width around the
// foot of a barrel, a lamp post or a stall leg is where the shadow map gives
// up: the object meets the paving with a hard, bright seam, and the eye reads
// the prop as pasted on rather than standing on it. A soft dark smudge under
// every footprint is the cheapest fix there is -- one instanced draw call of
// flat discs, no lights, no extra passes -- and it is the single strongest
// grounding cue available for that price.
//
// Three choices are worth the words.
//
// 1. One decal per anchor, placed from the anchor itself. The caller already
//    knows where every prop stands and how wide its footprint is (it built the
//    collider), so this module is not a scatter: it takes the footprint list and
//    returns one ellipse per entry, in the caller's order. That keeps the decal
//    and the prop in lockstep -- move a barrel and its smudge moves with it --
//    and means the field needs no keep-out logic, because two props that
//    overlap already overlap in the scene.
//
// 2. The centre wanders a little, but never far. A decal exactly concentric
//    with its prop reads as a painted ring; a decal offset by up to
//    SHADOW_JITTER of the footprint's radius reads as light falling from one
//    side. The jitter is seeded from the anchor's own coordinates rather than
//    from its index in the list, so reordering the list (or inserting a new prop
//    in the middle) does not reshuffle every other decal's smudge, and two
//    anchors that happen to share a spot still get different draws.
//
// 3. The ellipse, not the radius, carries the sun. This module has no sun
//    vector -- that belongs to the world, which knows the hour -- so it cannot
//    aim the decal. What it can do is squash every decal along one axis by a
//    seeded factor, which reads as "light came in at an angle" without claiming
//    to know which angle. The world spins the squashed ellipse; the squash
//    itself is decided here, once, so the field is stable across frames.
//
// Everything here is seeded (mulberry32, copied rather than imported so the
// module stands alone) and pure: no Three.js, no DOM, no clock, no Math.random.
// Two identical calls produce bit-identical decals, which is what lets the unit
// suite pin the field. Every export is total -- it guards junk input, and no
// call can produce NaN or Infinity.

/** Seed for the decal generator. Fixed so every run places the same smudges. */
export const SHADOW_SEED = 0x5a0d0c;

/** How many decals the field holds when the caller does not say. The courtyard
 *  and lane together carry a few dozen upright props; this is only a ceiling on
 *  an unsized call, not a target. */
export const SHADOW_COUNT = 40;

/** Hard ceiling on decals per call, whatever the caller asks for. One instanced
 *  draw call regardless, but each decal is a translucent quad over real screen
 *  area, and this host is fill-rate bound; a runaway anchor list must not turn
 *  the ground into a grey wash. */
export const SHADOW_MAX_COUNT = 96;

/** Smallest decal half-extent in metres. Below this a smudge is lost inside the
 *  shadow map's own texel size and buys nothing. */
export const SHADOW_MIN_RADIUS = 0.4;

/** Largest decal half-extent in metres. A wide stall or the fountain's basin
 *  reads as grounded with an ellipse this size; larger and it starts to look
 *  like a stain on the paving rather than a shadow under the object. */
export const SHADOW_MAX_RADIUS = 3.5;

/** Per-phase strength of the decal field, multiplied by each decal's own
 *  opacity. Strongest in daylight, when the sun is high and the shadow map is
 *  doing the most work and failing at the same scale; weakest at night, when
 *  the moon's key is soft and a hard smudge under a barrel would read as a hole.
 *  The night value is deliberately not zero: the lamps still light the feet of
 *  the props they stand near, so a little grounding survives the dark. */
export const SHADOW_PHASE_OPACITY = Object.freeze({ day: 0.30, dusk: 0.20, night: 0.12 });

/** Smallest squash factor. A decal squashed to four tenths of its width still
 *  covers its prop's foot; anything flatter reads as a painted stripe. */
export const SHADOW_MIN_SQUASH = 0.4;

/** Largest squash factor. At 1 the decal is a circle: a footprint under a
 *  high sun. */
export const SHADOW_MAX_SQUASH = 1.0;

/** How far, as a fraction of an anchor's radius, a decal centre may wander from
 *  the anchor centre. A third of the footprint keeps the decal under its prop
 *  while breaking the painted-ring look. */
export const SHADOW_JITTER = 0.35;

/** Height of a contact-shadow decal above the paved surface under it, in metres.
 *  A decal is a translucent, depthWrite:false quad, so it must sit a little
 *  above the stone to beat z-fighting at grazing angles; 2 mm clears the paving
 *  without reading as a raised disc. This is a LIFT above the surface, not an
 *  absolute world height: the lane floor sits 2 cm higher than the plaza and the
 *  terrace 1.2 m higher, so one absolute height cannot work for every surface.
 *  It is the lowest of the three ground-overlay layers. */
export const SHADOW_DECAL_LIFT = 0.002;

/** Per-decal opacity range. This is the strength of one smudge relative to the
 *  others -- a big stall's foot is denser than a lamp post's -- before the
 *  per-phase multiplier is applied. */
const SHADOW_MIN_OPACITY = 0.4;
const SHADOW_MAX_OPACITY = 0.7;

/** How far a decal's radius may stray from its anchor's radius. Small: the
 *  smudge should be the size of the foot, not of the object. */
const SHADOW_MIN_SCALE = 0.9;
const SHADOW_MAX_SCALE = 1.15;

/** A small deterministic PRNG (mulberry32). Copied from the other pure modules
 *  rather than imported, so `contactshadows.js` stays independent of them. */
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

/** A usable anchor needs finite x and z and a finite, positive radius. A zero
 *  radius has no footprint to shade, so it is junk rather than a tiny decal. */
function usableAnchor(anchor) {
  if (anchor == null || typeof anchor !== 'object' || Array.isArray(anchor)) return null;
  if (!finiteNumber(anchor.x) || !finiteNumber(anchor.z)) return null;
  if (!finiteNumber(anchor.radius) || anchor.radius <= 0) return null;
  return { x: anchor.x, z: anchor.z, radius: anchor.radius };
}

/**
 * Mix an anchor's position into the field seed, so two props at different spots
 * draw from different streams while the whole field still derives from
 * SHADOW_SEED alone. The coordinates are folded through a 32-bit integer hash
 * of their quantised values: quantising to a tenth of a millimetre means a
 * position that merely round-trips through a float32 mesh transform still lands
 * in the same stream, while a genuinely different prop does not.
 */
function anchorSeed(anchor, base) {
  const qx = Math.round(anchor.x * 1000) | 0;
  const qz = Math.round(anchor.z * 1000) | 0;
  let h = (base ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (qx >>> 0), 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h ^ (qz >>> 0), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h;
}

/**
 * The per-phase opacity multiplier for the whole decal field. Unknown phase, or
 * a non-string, falls back to the `day` value for the same reason the moss does:
 * a field that vanished on a phase id the code has not learned yet would be a
 * worse failure than one that stays at daylight strength.
 */
export function shadowOpacity(phaseId) {
  if (typeof phaseId !== 'string') return SHADOW_PHASE_OPACITY.day;
  return Object.prototype.hasOwnProperty.call(SHADOW_PHASE_OPACITY, phaseId)
    ? SHADOW_PHASE_OPACITY[phaseId]
    : SHADOW_PHASE_OPACITY.day;
}

/**
 * Whether the decal field runs at this quality tier.
 *
 * The low tier already switches the sun's shadow map off entirely (see
 * `world.js`), so the seam these decals hide is not there to hide: without a
 * shadow map the props have no cast shadow at all, and a set of dark ellipses
 * under them would be the only shadow in the scene -- obvious, and wrong. The
 * field is therefore dropped on low, consistent with the quality-tier
 * convention. Junk reads as the full tier, so an unexpected tier never silently
 * removes the field.
 */
export function shadowsEnabled(tier) {
  return tier !== 'low';
}

/**
 * The decal descriptors for a list of prop footprints.
 *
 * Each entry in `anchors` is `{ x, z, radius }`: the ground position of an
 * upright object and the half-extent of its footprint in metres. The call
 * returns one descriptor per usable anchor, in the caller's order, each shaped
 * `{ x, z, radius, squash, opacity }`:
 *   - `x` and `z` are the decal centre, jittered from the anchor by up to
 *     SHADOW_JITTER of its radius;
 *   - `radius` is the decal's long-axis half-extent, the anchor radius scaled
 *     into [SHADOW_MIN_SCALE, SHADOW_MAX_SCALE] and clamped into
 *     [SHADOW_MIN_RADIUS, SHADOW_MAX_RADIUS];
 *   - `squash` is the short-axis factor in [SHADOW_MIN_SQUASH,
 *     SHADOW_MAX_SQUASH], applied to the second axis by the world;
 *   - `opacity` is this decal's own strength in [SHADOW_MIN_OPACITY,
 *     SHADOW_MAX_OPACITY], to be multiplied by `shadowOpacity(phase)`.
 *
 * Junk anchors are dropped rather than throwing, and at most SHADOW_MAX_COUNT
 * decals are returned. A non-array argument returns an empty list. The call
 * never throws and never yields NaN or Infinity, and identical anchors yield
 * bit-identical descriptors.
 */
export function shadowDecals(anchors) {
  const out = [];
  if (!Array.isArray(anchors)) return out;
  const limit = Math.min(SHADOW_MAX_COUNT, anchors.length);
  for (let i = 0; i < limit; i += 1) {
    const anchor = usableAnchor(anchors[i]);
    if (anchor == null) continue;
    // The radius is clamped before scaling, so an absurd anchor cannot scale
    // its way past the documented ceiling.
    const baseRadius = Math.min(SHADOW_MAX_RADIUS, Math.max(SHADOW_MIN_RADIUS, anchor.radius));
    const rng = mulberry32(anchorSeed(anchor, SHADOW_SEED));
    // Draw order is fixed: jitter, then scale, squash and opacity. A fixed
    // order is what makes the stream stable when the constants change.
    const jx = (rng() * 2 - 1) * SHADOW_JITTER * baseRadius;
    const jz = (rng() * 2 - 1) * SHADOW_JITTER * baseRadius;
    const scale = SHADOW_MIN_SCALE + rng() * (SHADOW_MAX_SCALE - SHADOW_MIN_SCALE);
    const squash = SHADOW_MIN_SQUASH + rng() * (SHADOW_MAX_SQUASH - SHADOW_MIN_SQUASH);
    const opacity = SHADOW_MIN_OPACITY + rng() * (SHADOW_MAX_OPACITY - SHADOW_MIN_OPACITY);
    const radius = Math.min(
      SHADOW_MAX_RADIUS,
      Math.max(SHADOW_MIN_RADIUS, baseRadius * scale)
    );
    out.push({
      x: anchor.x + jx,
      z: anchor.z + jz,
      radius,
      squash,
      opacity
    });
  }
  return out;
}

/**
 * The yaw, in radians, the world spins a contact-shadow decal by for a given
 * sun position, so the ellipse's major axis points AWAY from the sun and the
 * shadow falls opposite the light.
 *
 * The sun is authored as a plain [x, y, z] triple (see PHASE_LOOKS in
 * world.js). While it is above the horizon (y > 0) the shadow direction is the
 * sun's horizontal projection reversed: atan2(sunX, sunZ) + PI. When the sun is
 * on or below the horizon, or the input is junk, the world falls back to the
 * seeded placeholder yaw it used before this function existed,
 * `(decal.x * 0.7 + decal.z * 1.3) % (2*PI)`, so night decals stay stable and a
 * bad phase never breaks the frame. The result is always normalised into
 * [0, 2*PI).
 *
 * The decal position feeds only the fallback, so a phase with a real sun aims
 * every decal the same way (which is what makes the field read as one shadow
 * direction) while a sunless phase keeps the old per-decal variety.
 */
export const CONTACT_SHADOW_SUN_HORIZON = 0;

export function contactShadowYaw(sunPosition, decalX, decalZ) {
  const placeholder = () => {
    const x = Number.isFinite(decalX) ? decalX : 0;
    const z = Number.isFinite(decalZ) ? decalZ : 0;
    const raw = (x * 0.7 + z * 1.3) % (Math.PI * 2);
    const norm = raw < 0 ? raw + Math.PI * 2 : raw;
    return Number.isFinite(norm) ? norm : 0;
  };
  if (!Array.isArray(sunPosition) || sunPosition.length < 3) return placeholder();
  const [sx, sy, sz] = sunPosition;
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(sz)) return placeholder();
  if (sy <= CONTACT_SHADOW_SUN_HORIZON) return placeholder();
  const yaw = Math.atan2(sx, sz) + Math.PI;
  const norm = ((yaw % (Math.PI * 2)) + (Math.PI * 2)) % (Math.PI * 2);
  return Number.isFinite(norm) ? norm : 0;
}
