// A soft atmospheric halo around each lit lamp head, decided without a GPU.
//
// The wet-streak work (rounds 112-114) grounded the lamps: the plaza streaks read
// as light skidding across damp stone, and the windows read as rooms. The lamps
// themselves, though, still read as small hard emissive spheres floating in the
// dark. A lit lantern over damp air does not look like that: it has a bright
// core where the bulb is, and around the core a wider, dimmer glow that comes
// from the light scattering in the air itself, brightest at the core and falling
// off smoothly to nothing at the rim. This module is the pure schedule behind
// that halo: one additive quad per lit lamp head, wider than tall, with a warm
// tint from a small fixed palette; the only per-frame cost is the material
// opacity write, driven by lampHaloStrength().
//
// The halo follows the lamp the same way the streak does: the caller already has
// the lamp list, so lampHalos() returns one descriptor per anchor, in caller
// order, and a lamp and its halo stay in lockstep. Its strength tracks the phase
// rather than the lamp's own intensity on purpose. The lamps' emissive bulbs are
// already driven per-bulb (the bulbs dim as dawn breaks, and a low-quality
// switch dims them too), but the haze the light scatters through belongs to the
// atmosphere, and the atmosphere darkens with the night -- so the halo should
// grow and brighten as the night deepens and be essentially absent in daylight
// regardless of what any one bulb is doing. Tying the halo to the phase keeps
// the two in agreement: the halo cannot out-shine its lamp in the morning, and a
// single phase ramp drives every lamp at once.
//
// Three choices are worth the words.
//
// 1. One halo per lamp head, centered on the lamp. The halo is a quad whose
//    half-extent is the radius, and the descriptor carries the lamp's own y so
//    the quad sits on the lamp head, not on the ground. A radius between 0.6 m
//    and 1.3 m keeps the halo wider than the lantern head but smaller than a
//    room: above 1.3 m it stops reading as light around a lamp and starts
//    reading as a cloud.
//
// 2. The halo is a little wider than tall. A lamp hangs from an arm, and the arm
//    above it is the nearest obstruction to the light, so the glow is a little
//    cut off at the top: the quad is scaled 1 by stretch by 1 in world space
//    with stretch in [0.82, 1.0]. stretch 1 is a symmetric disc; stretch 0.82
//    flattens the top a fifth. The squash is seeded from the lamp's position
//    along with its tint so each lamp keeps its own halo no matter how the list
//    is reordered, and the tint is chosen by the same positional hash -- same
//    lamp, same tint, and reordering the anchor list does not reshuffle every
//    other halo.
//
// 3. The halo is an additive transparency-heavy quad and is dropped entirely on
//    the low quality tier. Additive blending over bright emissive cores is the
//    expensive way to do it, but it is also the only way to get the glow to
//    lighten the air around the bulb without going through the forward pass of
//    every other material; on a fill-rate-bound, software-rasterised host that
//    price is only paid on the full tier, alongside the wet streaks and the
//    window spill.
//
// Everything here is seeded (mulberry32, copied rather than imported so the
// module stands alone) and pure: no Three.js, no DOM, no clock, no Math.random.
// Every export is total -- it guards junk input, and no call can produce NaN or
// Infinity.
//
// Integrator notes. Build the quad with scale (radius, radius * stretch, radius)
// and rotate it in the lamp's local plane if the lamp head is not vertical; the
// opacity field is the halo's own strength, to be multiplied by
// lampHaloStrength(phase, night) and then by the lamp's own glow factor, so the
// halo can never out-shine the bulb it wraps.

/** Seed for the halo generator. Fixed so every run lights the same plaza. */
export const LAMPHALO_SEED = 0x2e7c4a11;

/** How many halos the field holds when the caller does not say. Matches the
 *  plaza lamp count. */
export const LAMPHALO_COUNT = 4;

/** Hard ceiling on halos per call. */
export const LAMPHALO_MAX_COUNT = 32;

/** Smallest halo half-extent in metres. Below this the halo is lost inside the
 *  bulb's own sphere and buys nothing. */
export const LAMPHALO_MIN_RADIUS = 0.6;

/** Largest halo half-extent in metres. A halo wider than this stops reading as
 *  light around a lantern head and starts to read as a cloud. */
export const LAMPHALO_MAX_RADIUS = 1.3;

/** Per-halo opacity range, before the per-phase multiplier. */
export const LAMPHALO_MIN_OPACITY = 0.12;
export const LAMPHALO_MAX_OPACITY = 0.3;

/** Halo tint palette. Three warm tones, all clearly lamplight: the amber every
 *  lamp had before this module, a paler cream for the smaller heads, and a
 *  deeper ember for the bigger ones. Small enough that the plaza reads as one
 *  family of lights, varied enough that adjacent lamps are not copies. */
const LAMPHALO_TINTS = Object.freeze([
  0xffc07a,
  0xffd9a0,
  0xffb066
]);

/** Dusk strength: the halo base at dusk, scaled by the night fraction. */
const DUSK_BASE = 0.45;

/** Where the arm squash goes. 1 is a symmetric disc; LAMPHALO_MIN_STRETCH flattens
 *  the top by this much because the arm above the lamp cuts the glow. */
const LAMPHALO_MIN_STRETCH = 0.82;

/** The halo is considered a safe spread when at least this many distinct tints
 *  appear across a spread of anchors. */
const SPREAD_CAP = 4096;

/** A small deterministic PRNG (mulberry32). Copied from the other pure modules
 *  rather than imported, so `lamphalo.js` stays independent of them. */
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

function clampNumber(value, lo, hi, fallback) {
  if (!finiteNumber(value)) return fallback;
  return Math.min(hi, Math.max(lo, value));
}

/** A usable anchor needs finite x, y and z. A warmth, if supplied, must be
 *  finite -- a NaN warmth is junk and the anchor is dropped, not defaulted. A
 *  radius, if supplied, must be finite and non-negative. */
function usableAnchor(anchor) {
  if (anchor == null || typeof anchor !== 'object' || Array.isArray(anchor)) return null;
  if (!finiteNumber(anchor.x) || !finiteNumber(anchor.y) || !finiteNumber(anchor.z)) return null;
  if (anchor.warmth != null && !finiteNumber(anchor.warmth)) return null;
  if (anchor.radius != null && (!finiteNumber(anchor.radius) || anchor.radius < 0)) return null;
  return {
    x: anchor.x,
    y: anchor.y,
    z: anchor.z,
    radius: finiteNumber(anchor.radius) ? anchor.radius : null,
    warmth: finiteNumber(anchor.warmth) ? anchor.warmth : null
  };
}

// Same mixing shape as the roomtone and lightspill positional hashes: quantise
// each coordinate to a thousandth so sub-millimetre float noise cannot flip a
// halo's tint or squash, then fold the three integers into one 32-bit value with
// a different odd multiplier per axis. Kept local so this module stands alone.
function anchorSeed(anchor) {
  const qx = Math.round(anchor.x * 1000) | 0;
  const qy = Math.round(anchor.y * 1000) | 0;
  const qz = Math.round(anchor.z * 1000) | 0;
  let h = (LAMPHALO_SEED ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (qx >>> 0), 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h ^ (qy >>> 0), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h ^ (qz >>> 0), 0x27d4eb2f) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h >>> 0;
}

function tintIndex(seed) {
  const index = seed % LAMPHALO_TINTS.length;
  return Number.isInteger(index) && index >= 0 ? index : 0;
}

/**
 * The strength of the halo field at a given phase and night progress, in [0, 1].
 *
 * By day the field is exactly zero: a lamp in daylight has no visible halo. The
 * halo grows through dusk on a base of DUSK_BASE (the glow is visible before the
 * night is full, at half strength) and reaches 1 at full night. Junk phase ids
 * read as day (0), and a junk nightFraction clamps into [0, 1], so the call
 * never throws and never yields NaN.
 */
export function lampHaloStrength(phaseId, nightFraction) {
  if (typeof phaseId !== 'string') return 0;
  const base = phaseId === 'dusk' ? DUSK_BASE : phaseId === 'night' ? 1 : 0;
  const n = clampNumber(nightFraction, 0, 1, 0);
  const value = base * n;
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Whether the halo field runs at this quality tier. The low tier drops the
 * transparency-heavy additive pass, consistent with the quality-tier convention;
 * junk reads as the full tier.
 */
export function lampHaloEnabled(tier) {
  return tier !== 'low';
}

/**
 * The halo descriptors for a list of lamp anchors.
 *
 * Each entry in `anchors` is `{ x, y, z }` -- the lamp head's world position, y
 * included so the quad sits on the head -- plus an optional `warmth` (0..1-ish,
 * the bulb's warmth factor) or `radius` (metres, the requested half-extent). The
 * call returns one descriptor per usable anchor, in the caller's order, each
 * shaped `{ x, y, z, radius, opacity, stretch, tint }`:
 *   - `x`, `y` and `z` are the halo centre, exactly at the anchor;
 *   - `radius` is the halo half-extent in metres, derived from the anchor's
 *     radius or warmth and clamped into [LAMPHALO_MIN_RADIUS,
 *     LAMPHALO_MAX_RADIUS]; a warmer lamp throws a larger halo;
 *   - `opacity` is this halo's own strength in [LAMPHALO_MIN_OPACITY,
 *     LAMPHALO_MAX_OPACITY], to be multiplied by lampHaloStrength(phase, night);
 *   - `stretch` is a small vertical squash in [0.82, 1.0] -- the halo is a
 *     little wider than tall because the arm above the lamp cuts the top -- and
 *     the world applies it as a y scale of radius * stretch;
 *   - `tint` is an integer hex colour from LAMPHALO_TINTS, selected by the
 *     anchor's quantised position so the same lamp always gets the same tint
 *     and reordering the list does not reshuffle.
 *
 * Junk anchors are dropped rather than throwing, and at most LAMPHALO_MAX_COUNT
 * halos are returned. A non-array argument returns an empty list. The call never
 * throws and never yields NaN or Infinity, and identical anchors yield
 * bit-identical descriptors.
 */
export function lampHalos(anchors) {
  const out = [];
  if (!Array.isArray(anchors)) return out;
  const limit = Math.min(LAMPHALO_MAX_COUNT, anchors.length);
  for (let i = 0; i < limit; i += 1) {
    const anchor = usableAnchor(anchors[i]);
    if (anchor == null) continue;
    const rng = mulberry32(anchorSeed(anchor));
    // Derive the base radius from an explicit radius, else from warmth, else a
    // neutral metre. Warmth sits in [0.82, 1] in practice; map it onto the
    // middle of the radius range so a cool lamp throws a smaller halo.
    let baseRadius;
    if (anchor.radius != null) {
      baseRadius = anchor.radius;
    } else if (anchor.warmth != null) {
      const t = Math.min(1, Math.max(0, (anchor.warmth - 0.8) / 0.2));
      baseRadius = LAMPHALO_MIN_RADIUS + t * (LAMPHALO_MAX_RADIUS - LAMPHALO_MIN_RADIUS) * 0.6;
    } else {
      baseRadius = 0.9;
    }
    // Guard against a non-finite baseRadius slipping through.
    if (!Number.isFinite(baseRadius) || baseRadius <= 0) baseRadius = 0.9;
    // Warmth also drives opacity: a warmer lamp is a slightly denser halo. The
    // warmth term is clamped so it cannot push opacity out of range on its own.
    const warmthT = Math.min(1, Math.max(0, (anchor.warmth - 0.8) / 0.2));
    const opacity = LAMPHALO_MIN_OPACITY
      + rng() * (LAMPHALO_MAX_OPACITY - LAMPHALO_MIN_OPACITY)
      + warmthT * (LAMPHALO_MAX_OPACITY - LAMPHALO_MIN_OPACITY) * 0.15;
    const scale = 0.9 + rng() * 0.2;
    const radius = Math.min(
      LAMPHALO_MAX_RADIUS,
      Math.max(LAMPHALO_MIN_RADIUS, baseRadius * scale)
    );
    const stretch = LAMPHALO_MIN_STRETCH + rng() * (1 - LAMPHALO_MIN_STRETCH);
    const tint = LAMPHALO_TINTS[tintIndex(anchorSeed(anchor))];
    out.push({
      x: anchor.x,
      y: anchor.y,
      z: anchor.z,
      radius,
      opacity,
      stretch,
      tint
    });
  }
  // Final totality pass.
  for (const d of out) {
    if (!Number.isFinite(d.x)) d.x = 0;
    if (!Number.isFinite(d.y)) d.y = 0;
    if (!Number.isFinite(d.z)) d.z = 0;
    if (!Number.isFinite(d.radius)) d.radius = LAMPHALO_MIN_RADIUS;
    if (!Number.isFinite(d.opacity)) d.opacity = LAMPHALO_MIN_OPACITY;
    if (!Number.isFinite(d.stretch)) d.stretch = 1;
    if (!Number.isFinite(d.tint)) d.tint = LAMPHALO_TINTS[0];
    d.radius = Math.min(LAMPHALO_MAX_RADIUS, Math.max(LAMPHALO_MIN_RADIUS, d.radius));
    d.opacity = Math.min(LAMPHALO_MAX_OPACITY, Math.max(LAMPHALO_MIN_OPACITY, d.opacity));
    d.stretch = Math.min(1, Math.max(LAMPHALO_MIN_STRETCH, d.stretch));
    d.tint = Math.min(0xffffff, Math.max(0, d.tint | 0));
  }
  return out;
}

/**
 * How many usable anchors a list holds and how many distinct tints they span.
 * Junk entries are excluded and the list is capped at 4096 so the call stays
 * total on any input. Useful for asserting the palette actually gets used rather
 * than collapsing onto one tint.
 */
export function lampHaloSpread(anchors) {
  const empty = { count: 0, distinct: 0 };
  if (!Array.isArray(anchors)) return empty;
  const limit = Math.min(SPREAD_CAP, anchors.length);
  const seen = new Set();
  let count = 0;
  for (let i = 0; i < limit; i += 1) {
    const a = usableAnchor(anchors[i]);
    if (a == null) continue;
    count += 1;
    seen.add(tintIndex(anchorSeed(a)));
  }
  return { count, distinct: seen.size };
}
