// Wet-pavement reflection streaks under the plaza lamps, decided without a GPU.
//
// Round 112-114 grounded and walled the windows and lit their rooms. The plaza
// itself still reads dry: a lamp over dry cobble is a bright point in the air,
// while a lamp over damp cobble throws a long warm streak across the ground.
// This module is the pure schedule behind that effect: one elongated additive
// quad per plaza lamp, laid on the paving and aimed away from the lamp, with a
// soft warm gradient; the only per-frame cost is the material opacity write.
//
// The streak follows the lamp: its position comes from the caller's lamp list,
// so a lamp and its streak stay in lockstep. Its strength tracks the phase
// through wetStreakStrength(), and it drops on the low tier alongside the
// windows.
//
// Three choices are worth the words.
//
// 1. One streak per plaza lamp, on the ground. The caller knows where every
//    lamp sits, so this is not a scatter: it takes the lamp list and returns one
//    streak per entry, in the caller's order.
//
// 2. The length follows the lamp's warmth, not its height. A brighter, warmer
//    lamp throws a longer, softer streak; a dim lamp barely streaks. The caller
//    may pass a `length` (metres) and otherwise it is derived from `warmth`,
//    clamped into [WETSTREAK_MIN_LENGTH, WETSTREAK_MAX_LENGTH].
//
// 3. The centre wanders, but only a little, and the streak is not centred on
//    the lamp. A streak exactly under and exactly symmetrical around its lamp
//    reads as a painted line; a streak offset slightly away from the lamp, with
//    a little jitter, reads as light skidding across damp stone. The jitter is
//    seeded from the lamp's own coordinates so reordering the list does not
//    reshuffle every other streak.
//
// Everything here is seeded (mulberry32, copied rather than imported so the
// module stands alone) and pure: no Three.js, no DOM, no clock, no Math.random.
// Every export is total.

/** Seed for the streak generator. Fixed so every run lights the same plaza. */
export const WETSTREAK_SEED = 0x2e7c4a;

/** How many streaks the field holds when the caller does not say. Matches the
 *  plaza lamp count. */
export const WETSTREAK_COUNT = 4;

/** Hard ceiling on streaks per call. */
export const WETSTREAK_MAX_COUNT = 32;

/** Shortest streak half-length in metres. */
export const WETSTREAK_MIN_LENGTH = 1.2;

/** Longest streak half-length in metres. */
export const WETSTREAK_MAX_LENGTH = 3.6;

/** How far, as a fraction of a streak's length, its centre may wander. */
export const WETSTREAK_JITTER = 0.15;

/** Height a streak sits above the paving, in metres, to beat z-fighting. */
export const WETSTREAK_LIFT = 0.015;

/** Per-streak opacity range, before the per-phase multiplier. */
const WETSTREAK_MIN_OPACITY = 0.1;
const WETSTREAK_MAX_OPACITY = 0.3;

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
  if (!finiteNumber(anchor.x) || !finiteNumber(anchor.z)) return null;
  if (anchor.length != null && (!finiteNumber(anchor.length) || anchor.length < 0)) return null;
  if (anchor.warmth != null && !finiteNumber(anchor.warmth)) return null;
  return {
    x: anchor.x,
    z: anchor.z,
    length: finiteNumber(anchor.length) ? anchor.length : null,
    warmth: finiteNumber(anchor.warmth) ? anchor.warmth : null
  };
}

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

export function wetStreakStrength(phaseId, nightFraction) {
  if (typeof phaseId !== 'string') return 0;
  const base = phaseId === 'dusk' ? 0.35 : phaseId === 'night' ? 1 : 0;
  const n = clampNumber(nightFraction, 0, 1, 0);
  const value = base * n;
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function wetStreakEnabled(tier) {
  return tier !== 'low';
}

export function wetStreakDecals(anchors) {
  const out = [];
  if (!Array.isArray(anchors)) return out;
  const limit = Math.min(WETSTREAK_MAX_COUNT, anchors.length);
  for (let i = 0; i < limit; i += 1) {
    const anchor = usableAnchor(anchors[i]);
    if (anchor == null) continue;
    const rng = mulberry32(anchorSeed(anchor, WETSTREAK_SEED));
    let baseLength;
    if (anchor.length != null) {
      baseLength = anchor.length;
    } else if (anchor.warmth != null) {
      const t = Math.min(1, Math.max(0, (anchor.warmth - 0.7) / 0.3));
      baseLength = WETSTREAK_MIN_LENGTH + t * (WETSTREAK_MAX_LENGTH - WETSTREAK_MIN_LENGTH) * 0.8;
    } else {
      baseLength = 2.0;
    }
    if (!Number.isFinite(baseLength) || baseLength <= 0) baseLength = 2.0;
    const jitter = (rng() * 2 - 1) * WETSTREAK_JITTER * baseLength;
    const scale = 0.85 + rng() * 0.3;
    const angle = rng() * Math.PI * 2; // direction the streak skids
    const opacity = WETSTREAK_MIN_OPACITY + rng() * (WETSTREAK_MAX_OPACITY - WETSTREAK_MIN_OPACITY);
    const length = Math.min(
      WETSTREAK_MAX_LENGTH,
      Math.max(WETSTREAK_MIN_LENGTH, baseLength * scale)
    );
    out.push({
      x: anchor.x + Math.cos(angle) * jitter,
      z: anchor.z + Math.sin(angle) * jitter,
      length,
      width: length * (0.18 + rng() * 0.12),
      angle,
      opacity
    });
  }
  for (const d of out) {
    if (!Number.isFinite(d.x)) d.x = 0;
    if (!Number.isFinite(d.z)) d.z = 0;
    if (!Number.isFinite(d.length)) d.length = WETSTREAK_MIN_LENGTH;
    if (!Number.isFinite(d.width)) d.width = WETSTREAK_MIN_LENGTH * 0.2;
    if (!Number.isFinite(d.angle)) d.angle = 0;
    if (!Number.isFinite(d.opacity)) d.opacity = WETSTREAK_MIN_OPACITY;
    d.length = Math.min(WETSTREAK_MAX_LENGTH, Math.max(WETSTREAK_MIN_LENGTH, d.length));
    d.width = Math.min(WETSTREAK_MAX_LENGTH * 0.4, Math.max(WETSTREAK_MIN_LENGTH * 0.15, d.width));
    d.opacity = Math.min(WETSTREAK_MAX_OPACITY, Math.max(WETSTREAK_MIN_OPACITY, d.opacity));
  }
  return out;
}
