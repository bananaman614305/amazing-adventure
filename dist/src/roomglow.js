// Warm interior glow behind a lit cottage window, decided without a GPU.
//
// Rounds 112 and 113 grounded and walled the windows: spill pools on the paving
// and a soft bleed on the wall around each pane. This module is the third leg:
// the light that comes *from* the room. A pane by itself is a glowing sticker;
// a pane with a warm, slightly larger, slightly dimmer rectangle behind it reads
// as a lit interior seen through glass, which is what makes a window read as a
// room rather than a lamp.
//
// It is one instanced quad per lit pane, sitting at the wall face (just behind
// the pane quad, which sits proud of it) and sized a little larger than the
// pane, with a soft warm gradient and normal blending so it shows through the
// glass instead of blowing it out. The only per-frame cost is the material
// opacity write.
//
// The glow follows the window: its position comes from the same window schedule
// projected onto the nearest inner face (the caller already has that list), so a
// pane and its interior stay in lockstep. Its strength tracks the phase through
// roomGlowStrength(), and it drops on the low tier alongside the windows.
//
// Three choices are worth the words.
//
// 1. One glow per lit window, on the wall. The caller knows where every pane
//    sits and which wall it is on, so this is not a scatter: it takes the
//    footprint list and returns one glow per entry, in the caller's order.
//
// 2. The size follows the pane's warmth, not its count. A warmer, brighter
//    room throws a wider, softer glow; a cool dim pane barely lights its
//    interior. The caller may pass a `size` (metres) and otherwise it is
//    derived from `warmth`, clamped into [ROOMGLOW_MIN_SIZE, ROOMGLOW_MAX_SIZE].
//
// 3. The centre wanders, but only a little, and the rectangle is not square.
//    A glow exactly concentric and exactly the pane's size reads as a second
//    pane painted behind the first; a glow offset by up to ROOMGLOW_JITTER of
//    its size, and wider than it is tall, reads as light spilling out of a room
//    of a different shape than the window. The jitter is seeded from the anchor's
//    own coordinates so reordering the list does not reshuffle every other glow.
//
// Everything here is seeded (mulberry32, copied rather than imported so the
// module stands alone) and pure: no Three.js, no DOM, no clock, no Math.random.
// Every export is total.

/** Seed for the glow generator. Fixed so every run lights the same village. */
export const ROOMGLOW_SEED = 0x7a3b1c;

/** How many glows the field holds when the caller does not say. Matches the
 *  window schedule's default count. */
export const ROOMGLOW_COUNT = 12;

/** Hard ceiling on glows per call. */
export const ROOMGLOW_MAX_COUNT = 64;

/** Smallest glow half-extent in metres. */
export const ROOMGLOW_MIN_SIZE = 0.9;

/** Largest glow half-extent in metres. */
export const ROOMGLOW_MAX_SIZE = 1.7;

/** How far, as a fraction of a glow's size, its centre may wander. */
export const ROOMGLOW_JITTER = 0.1;

/** Height a room glow sits behind the pane, in metres, so it reads as recessed
 *  into the wall rather than painted on the same plane. */
export const ROOMGLOW_RECESS = 0.04;

/** Per-glow opacity range, before the per-phase multiplier. */
const ROOMGLOW_MIN_OPACITY = 0.12;
const ROOMGLOW_MAX_OPACITY = 0.34;

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

function usableAnchor(anchor) {
  if (anchor == null || typeof anchor !== 'object' || Array.isArray(anchor)) return null;
  if (!finiteNumber(anchor.x) || !finiteNumber(anchor.y) || !finiteNumber(anchor.z)) return null;
  if (anchor.size != null && (!finiteNumber(anchor.size) || anchor.size < 0)) return null;
  if (anchor.warmth != null && !finiteNumber(anchor.warmth)) return null;
  return {
    x: anchor.x,
    y: anchor.y,
    z: anchor.z,
    size: finiteNumber(anchor.size) ? anchor.size : null,
    warmth: finiteNumber(anchor.warmth) ? anchor.warmth : null
  };
}

function anchorSeed(anchor, base) {
  const qx = Math.round(anchor.x * 1000) | 0;
  const qy = Math.round(anchor.y * 1000) | 0;
  const qz = Math.round(anchor.z * 1000) | 0;
  let h = (base ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (qx >>> 0), 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h ^ (qy >>> 0), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h ^ (qz >>> 0), 0x27d4eb2f) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h;
}

export function roomGlowStrength(phaseId, nightFraction) {
  if (typeof phaseId !== 'string') return 0;
  const base = phaseId === 'dusk' ? 0.4 : phaseId === 'night' ? 1 : 0;
  const n = clampNumber(nightFraction, 0, 1, 0);
  const value = base * n;
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function roomGlowEnabled(tier) {
  return tier !== 'low';
}

export function roomGlowDecals(anchors) {
  const out = [];
  if (!Array.isArray(anchors)) return out;
  const limit = Math.min(ROOMGLOW_MAX_COUNT, anchors.length);
  for (let i = 0; i < limit; i += 1) {
    const anchor = usableAnchor(anchors[i]);
    if (anchor == null) continue;
    const rng = mulberry32(anchorSeed(anchor, ROOMGLOW_SEED));
    let baseSize;
    if (anchor.size != null) {
      baseSize = anchor.size;
    } else if (anchor.warmth != null) {
      const t = Math.min(1, Math.max(0, (anchor.warmth - 0.8) / 0.2));
      baseSize = ROOMGLOW_MIN_SIZE + t * (ROOMGLOW_MAX_SIZE - ROOMGLOW_MIN_SIZE) * 0.75;
    } else {
      baseSize = 1.1;
    }
    if (!Number.isFinite(baseSize) || baseSize <= 0) baseSize = 1.1;
    const jx = (rng() * 2 - 1) * ROOMGLOW_JITTER * baseSize;
    const jy = (rng() * 2 - 1) * ROOMGLOW_JITTER * baseSize;
    const scale = 0.9 + rng() * 0.25;
    const aspect = 0.78 + rng() * 0.18; // wider than tall: a room, not a pane
    const opacity = ROOMGLOW_MIN_OPACITY + rng() * (ROOMGLOW_MAX_OPACITY - ROOMGLOW_MIN_OPACITY);
    const size = Math.min(
      ROOMGLOW_MAX_SIZE,
      Math.max(ROOMGLOW_MIN_SIZE, baseSize * scale)
    );
    out.push({
      x: anchor.x + jx,
      y: anchor.y + jy,
      z: anchor.z,
      width: size,
      height: size * aspect,
      opacity
    });
  }
  for (const d of out) {
    if (!Number.isFinite(d.x)) d.x = 0;
    if (!Number.isFinite(d.y)) d.y = 0;
    if (!Number.isFinite(d.z)) d.z = 0;
    if (!Number.isFinite(d.width)) d.width = ROOMGLOW_MIN_SIZE;
    if (!Number.isFinite(d.height)) d.height = ROOMGLOW_MIN_SIZE;
    if (!Number.isFinite(d.opacity)) d.opacity = ROOMGLOW_MIN_OPACITY;
    d.width = Math.min(ROOMGLOW_MAX_SIZE, Math.max(ROOMGLOW_MIN_SIZE, d.width));
    d.height = Math.min(ROOMGLOW_MAX_SIZE, Math.max(ROOMGLOW_MIN_SIZE * 0.6, d.height));
    d.opacity = Math.min(ROOMGLOW_MAX_OPACITY, Math.max(ROOMGLOW_MIN_OPACITY, d.opacity));
  }
  return out;
}
