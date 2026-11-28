// A soft atmospheric halo around the moon disc, decided without a GPU.
//
// The star field and the moon disc already give the night sky its shape, but
// the moon itself still reads as a flat bright circle pasted on the dome: a
// real moon has a bright core and a wide, faint glow that comes from light
// scattering in the upper atmosphere, fading to nothing well beyond the disc.
// This module is the pure schedule behind that halo: one additive quad, wider
// than the disc, with a cool blue-white tint, its strength driven by the phase
// so it is gone in daylight and full at night.
//
// The halo follows the moon the same way the lamp halos follow their lamps: the
// caller already has the moon position, so moonHaloDescriptor() returns a single
// descriptor for it, and the mesh stays in lockstep with the disc. Its strength
// tracks the phase rather than any per-instance value on purpose, so one phase
// ramp drives the whole halo and it can never out-shine the disc it wraps.
//
// Everything here is seeded (mulberry32, copied rather than imported so the
// module stands alone) and pure: no Three.js, no DOM, no clock, no Math.random.
// Every export is total -- it guards junk input, and no call can produce NaN
// or Infinity.

/** Seed for the halo generator. Fixed so every run lights the same sky. */
export const MOONHALO_SEED = 0x7a3f1c9b;

/** Smallest halo half-extent in metres (on the dome). */
export const MOONHALO_MIN_RADIUS = 24;

/** Largest halo half-extent in metres. */
export const MOONHALO_MAX_RADIUS = 48;

/** Per-halo opacity range, before the per-phase multiplier. */
export const MOONHALO_MIN_OPACITY = 0.08;
export const MOONHALO_MAX_OPACITY = 0.22;

/** Halo tint palette: cool blue-whites, all clearly moonlight. */
const MOONHALO_TINTS = Object.freeze([
  0xd8e4ff,
  0xe8f0ff,
  0xc8d8ff
]);

/** Dusk strength: the halo base at dusk, scaled by the night fraction. */
const DUSK_BASE = 0.3;

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
  return { x: anchor.x, y: anchor.y, z: anchor.z };
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6D2B79F5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function anchorSeed(anchor) {
  const qx = Math.round(anchor.x * 1000) | 0;
  const qy = Math.round(anchor.y * 1000) | 0;
  const qz = Math.round(anchor.z * 1000) | 0;
  let h = (MOONHALO_SEED ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (qx >>> 0), 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h ^ (qy >>> 0), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h ^ (qz >>> 0), 0x27d4eb2f) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h >>> 0;
}

/**
 * The strength of the halo field at a given phase and night progress, in [0, 1].
 * By day the field is exactly zero. Junk phase ids read as day (0), and a junk
 * nightFraction clamps into [0, 1].
 */
export function moonHaloStrength(phaseId, nightFraction) {
  if (typeof phaseId !== 'string') return 0;
  const base = phaseId === 'dusk' ? DUSK_BASE : phaseId === 'night' ? 1 : 0;
  const n = clampNumber(nightFraction, 0, 1, 0);
  const value = base * n;
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Whether the halo field runs at this quality tier. The low tier drops it.
 */
export function moonHaloEnabled(tier) {
  return tier !== 'low';
}

/**
 * The halo descriptor for a moon anchor, or null for junk input.
 * Shape: { x, y, z, radius, opacity, tint }.
 */
export function moonHaloDescriptor(anchor) {
  const a = usableAnchor(anchor);
  if (a == null) return null;
  const rng = mulberry32(anchorSeed(a));
  const radius = MOONHALO_MIN_RADIUS + rng() * (MOONHALO_MAX_RADIUS - MOONHALO_MIN_RADIUS);
  const opacity = MOONHALO_MIN_OPACITY + rng() * (MOONHALO_MAX_OPACITY - MOONHALO_MIN_OPACITY);
  const tint = MOONHALO_TINTS[anchorSeed(a) % MOONHALO_TINTS.length];
  const out = { x: a.x, y: a.y, z: a.z, radius, opacity, tint };
  if (!Number.isFinite(out.x)) out.x = 0;
  if (!Number.isFinite(out.y)) out.y = 0;
  if (!Number.isFinite(out.z)) out.z = 0;
  if (!Number.isFinite(out.radius)) out.radius = MOONHALO_MIN_RADIUS;
  if (!Number.isFinite(out.opacity)) out.opacity = MOONHALO_MIN_OPACITY;
  out.radius = Math.min(MOONHALO_MAX_RADIUS, Math.max(MOONHALO_MIN_RADIUS, out.radius));
  out.opacity = Math.min(MOONHALO_MAX_OPACITY, Math.max(MOONHALO_MIN_OPACITY, out.opacity));
  if (typeof out.tint !== 'number' || !Number.isFinite(out.tint)) out.tint = MOONHALO_TINTS[0];
  out.tint = Math.min(0xffffff, Math.max(0, out.tint | 0));
  return out;
}

/**
 * Descriptors for a list of anchors (one per usable anchor).
 */
export function moonHaloDescriptors(anchors) {
  const out = [];
  if (!Array.isArray(anchors)) return out;
  for (const a of anchors) {
    const d = moonHaloDescriptor(a);
    if (d) out.push(d);
  }
  return out;
}