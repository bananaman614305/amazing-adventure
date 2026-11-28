// Per-window interior light tone, decided without a GPU.
//
// Room glow (round 112) gave every lit pane a warm rectangle behind it, and that
// was enough to make a window read as a room rather than a sticker. But a whole
// village at night was painted with one constant, 0xffc07a, so twelve windows
// read as twelve copies of the same orange rectangle. Real interiors differ: a
// candle, an oil lamp, a gas mantle and a hearth all land at different points on
// the warm spectrum, and the eye reads that variety as separate rooms even when
// it cannot name the colours. This module hands the caller a deterministic tone
// per window so the field of glows becomes a street of rooms.
//
// Three choices are worth the words.
//
// 1. The tone is seeded by position, not by list order. The window schedule is
//    rebuilt every round and may be reordered or filtered; if the tone came from
//    the anchor's index in the list, adding one window would reshuffle every
//    window after it and the whole street would change colour. Hashing the
//    anchor's own quantised x, y and z (the same shape roomglow.js uses for its
//    jitter) makes each window's tone a property of where it is, so the village
//    is stable across reorderings and across runs.
//
// 2. The palette is small and warm-only. A wide palette would tempt cool blues
//    and greens that read as moonlight or neon, not lamplight. Seven tones is
//    enough to break up a row of windows while every entry still sits clearly on
//    the warm side; the set deliberately includes one greener, gaslit-leaning
//    tone and one pinker, shaded-lamp tone so the variation is legible without
//    ever leaving the family of firelight.
//
// 3. Index 0 is both the amber the game already used and the fallback. Junk
//    input must still yield a usable colour, and the least surprising colour for
//    "we do not know this window" is the one every pane had before this module
//    existed. Keeping the old constant at index 0 means a missing or malformed
//    anchor degrades to exactly the previous look rather than to an arbitrary
//    palette entry.
//
// The positional hash is enough; there is no randomness to seed, so no
// mulberry32 here. Everything is pure: no Three.js, no DOM, no clock, no
// Math.random. Every export is total.

/** Seed for the positional hash. Fixed so every run lights the same village. */
export const ROOMTONE_SEED = 0x51d3a7;

/**
 * Warm interior tones, ordered so index 0 is the fallback (the amber the room
 * glow used before this module existed). Every entry is a hex integer and
 * reads as lamplight, but the set spans amber, cream, ember, pale lamp, old
 * oil, a greener gaslit tone and a pinker shaded-lamp tone.
 */
export const ROOMTONE_PALETTE = Object.freeze([
  0xffc07a, // amber — the previous constant, and the fallback
  0xffe0b0, // candle cream
  0xffa95e, // deep ember
  0xfff0d4, // pale lamp
  0xe8c98a, // old oil
  0xefe6a8, // gaslit — the greenest tone, still warm
  0xffb9a6  // shaded lamp — the pinkest tone, still warm
]);

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function usableAnchor(anchor) {
  if (anchor == null || typeof anchor !== 'object' || Array.isArray(anchor)) return null;
  if (!finiteNumber(anchor.x) || !finiteNumber(anchor.y) || !finiteNumber(anchor.z)) return null;
  return { x: anchor.x, y: anchor.y, z: anchor.z };
}

// Same mixing shape as roomglow.js's anchorSeed: quantise each coordinate to a
// thousandth so sub-millimetre float noise cannot flip a window's tone, then
// fold the three integers into one 32-bit value with a different odd multiplier
// per axis. Kept local rather than imported so this module stands alone.
function anchorHash(anchor) {
  const qx = Math.round(anchor.x * 1000) | 0;
  const qy = Math.round(anchor.y * 1000) | 0;
  const qz = Math.round(anchor.z * 1000) | 0;
  let h = (ROOMTONE_SEED ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (qx >>> 0), 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h ^ (qy >>> 0), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h ^ (qz >>> 0), 0x27d4eb2f) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h >>> 0;
}

function toneFromHex(hex) {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  return { hex, r, g, b };
}

/**
 * Palette index for an anchor. Same hash as roomToneFor, exposed so tests and
 * the browser check can reason about indices instead of float colours. Junk
 * input (null, undefined, a number, a string, an array, or an object missing
 * finite x/y/z) returns 0, the fallback.
 */
export function roomToneIndex(anchor) {
  const a = usableAnchor(anchor);
  if (a == null) return 0;
  const index = anchorHash(a) % ROOMTONE_PALETTE.length;
  return Number.isInteger(index) && index >= 0 && index < ROOMTONE_PALETTE.length ? index : 0;
}

/**
 * Interior light tone for an anchor as `{ hex, r, g, b }`. The same anchor
 * always yields the same tone, independent of where it sits in the list. Junk
 * input returns palette[0]'s tone, never a throw and never a NaN.
 */
export function roomToneFor(anchor) {
  const hex = ROOMTONE_PALETTE[roomToneIndex(anchor)];
  return toneFromHex(hex);
}

/**
 * How many usable anchors a list holds and how many distinct palette indices
 * they span. Junk entries are excluded and the list is capped at 4096 so the
 * call stays total on any input. Useful for asserting the palette actually gets
 * used rather than collapsing onto one tone.
 */
export function roomToneSpread(anchors) {
  const empty = { count: 0, distinct: 0 };
  if (!Array.isArray(anchors)) return empty;
  const limit = Math.min(4096, anchors.length);
  const seen = new Set();
  let count = 0;
  for (let i = 0; i < limit; i += 1) {
    const a = usableAnchor(anchors[i]);
    if (a == null) continue;
    count += 1;
    const index = anchorHash(a) % ROOMTONE_PALETTE.length;
    if (Number.isInteger(index) && index >= 0 && index < ROOMTONE_PALETTE.length) {
      seen.add(index);
    }
  }
  return { count, distinct: seen.size };
}
