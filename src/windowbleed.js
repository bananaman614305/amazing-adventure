// Warm light bleed on the wall around a lit cottage window, decided without a GPU.
//
// Round 112 grounded the windows from below with spill pools on the paving.
// This module does the vertical half: a soft warm halo on the wall surface
// around each lit pane, so a window reads as light pouring out of a room rather
// than a glowing sticker on stone. It is one instanced additive quad per pane,
// slightly larger than the pane and sitting a hair proud of the wall, with a
// soft radial gradient; the only per-frame cost is the material opacity write.
//
// The bleed follows the window: its position comes from the same window schedule
// projected onto the nearest inner face (the caller already has that list), so a
// pane and its halo stay in lockstep. Its strength tracks the phase through
// bleedStrength(), and it drops on the low tier alongside the windows.
//
// Three choices are worth the words.
//
// 1. One halo per lit window, on the wall. The caller knows where every pane
//    sits and which wall it is on, so this is not a scatter: it takes the
//    footprint list and returns one halo per entry, in the caller's order.
//
// 2. The radius follows the pane's warmth, not its size. A warmer, brighter
//    pane throws a wider, softer halo; a cool dim pane barely bleeds. The
//    caller may pass a `radius` (metres) and otherwise it is derived from
//    `warmth`, clamped into [BLEED_MIN_RADIUS, BLEED_MAX_RADIUS].
//
// 3. The centre wanders, but only a little. A halo exactly concentric with its
//    pane reads as a painted ring; a halo offset by up to BLEED_JITTER of its
//    radius reads as light spilling unevenly out of a room. The jitter is
//    seeded from the anchor's own coordinates so reordering the list does not
//    reshuffle every other halo.
//
// Everything here is seeded (mulberry32, copied rather than imported so the
// module stands alone) and pure: no Three.js, no DOM, no clock, no Math.random.
// Every export is total.

/** Seed for the bleed generator. Fixed so every run lights the same village. */
export const BLEED_SEED = 0x4b1e7a;

/** How many halos the field holds when the caller does not say. Matches the
 *  window schedule's default count. */
export const BLEED_COUNT = 12;

/** Hard ceiling on halos per call. */
export const BLEED_MAX_COUNT = 64;

/** Smallest halo half-extent in metres. */
export const BLEED_MIN_RADIUS = 0.5;

/** Largest halo half-extent in metres. */
export const BLEED_MAX_RADIUS = 1.6;

/** How far, as a fraction of a halo's radius, its centre may wander. */
export const BLEED_JITTER = 0.12;

/** Height a bleed halo sits proud of the wall face, in metres, to beat
 *  z-fighting with the pane behind it. */
export const BLEED_WALL_LIFT = 0.02;

/** Per-halo opacity range, before the per-phase multiplier. */
const BLEED_MIN_OPACITY = 0.08;
const BLEED_MAX_OPACITY = 0.32;

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
  if (anchor.radius != null && (!finiteNumber(anchor.radius) || anchor.radius < 0)) return null;
  if (anchor.warmth != null && !finiteNumber(anchor.warmth)) return null;
  return {
    x: anchor.x,
    y: anchor.y,
    z: anchor.z,
    radius: finiteNumber(anchor.radius) ? anchor.radius : null,
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

export function bleedStrength(phaseId, nightFraction) {
  if (typeof phaseId !== 'string') return 0;
  const base = phaseId === 'dusk' ? 0.5 : phaseId === 'night' ? 1 : 0;
  const n = clampNumber(nightFraction, 0, 1, 0);
  const value = base * n;
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function bleedEnabled(tier) {
  return tier !== 'low';
}

export function bleedDecals(anchors) {
  const out = [];
  if (!Array.isArray(anchors)) return out;
  const limit = Math.min(BLEED_MAX_COUNT, anchors.length);
  for (let i = 0; i < limit; i += 1) {
    const anchor = usableAnchor(anchors[i]);
    if (anchor == null) continue;
    const rng = mulberry32(anchorSeed(anchor, BLEED_SEED));
    let baseRadius;
    if (anchor.radius != null) {
      baseRadius = anchor.radius;
    } else if (anchor.warmth != null) {
      const t = Math.min(1, Math.max(0, (anchor.warmth - 0.8) / 0.2));
      baseRadius = BLEED_MIN_RADIUS + t * (BLEED_MAX_RADIUS - BLEED_MIN_RADIUS) * 0.7;
    } else {
      baseRadius = 1.0;
    }
    if (!Number.isFinite(baseRadius) || baseRadius <= 0) baseRadius = 1.0;
    const jx = (rng() * 2 - 1) * BLEED_JITTER * baseRadius;
    const jy = (rng() * 2 - 1) * BLEED_JITTER * baseRadius;
    const scale = 0.95 + rng() * 0.15;
    const opacity = BLEED_MIN_OPACITY + rng() * (BLEED_MAX_OPACITY - BLEED_MIN_OPACITY);
    const radius = Math.min(
      BLEED_MAX_RADIUS,
      Math.max(BLEED_MIN_RADIUS, baseRadius * scale)
    );
    out.push({
      x: anchor.x + jx,
      y: anchor.y + jy,
      z: anchor.z,
      radius,
      opacity
    });
  }
  for (const d of out) {
    if (!Number.isFinite(d.x)) d.x = 0;
    if (!Number.isFinite(d.y)) d.y = 0;
    if (!Number.isFinite(d.z)) d.z = 0;
    if (!Number.isFinite(d.radius)) d.radius = BLEED_MIN_RADIUS;
    if (!Number.isFinite(d.opacity)) d.opacity = BLEED_MIN_OPACITY;
    d.radius = Math.min(BLEED_MAX_RADIUS, Math.max(BLEED_MIN_RADIUS, d.radius));
    d.opacity = Math.min(BLEED_MAX_OPACITY, Math.max(BLEED_MIN_OPACITY, d.opacity));
  }
  return out;
}
