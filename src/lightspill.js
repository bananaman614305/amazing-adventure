// Warm window-light spill on the ground, decided without a GPU.
//
// Night is a third of the cycle. The lit windows are emissive quads that cast
// nothing, so the plaza reads as stickers glowing in the dark; warm pools under
// lit windows are the classic grounding cue, done as one instanced additive
// decal mesh at low per-frame cost.
//
// A village at night reads as inhabited because of its windows, not its roofs:
// a row of dark houses is scenery, a handful of warm panes is a place where
// someone lives. The cottage windows themselves are emissive quads on the
// border walls (src/windows.js), and by day they are dark. By night they glow
// warm yellow -- but a glow on a wall is a sticker until the ground under it
// agrees. A soft warm pool on the paving just inside the wall, under every lit
// pane, is the cue that makes the light read as coming from a room rather than
// painted on a surface, and it is the single cheapest grounding cue available
// for that price: one InstancedMesh of flat additive discs, no lights, no extra
// passes, dropped on the low tier alongside the windows.
//
// The pools are static per phase: their positions come from the window schedule
// (which is fixed for a given seed) and their strength follows the night, so
// the field is rebuilt on a phase change rather than every frame. The only
// per-frame cost is the material opacity write, which is one number.
//
// Three choices are worth the words.
//
// 1. One pool per lit window, placed on the ground under the wall face. The
//    caller already knows where every pane sits and which wall it is on (it
//    projected the schedule onto the nearest inner face), so this module is not
//    a scatter: it takes the footprint list and returns one disc per entry, in
//    the caller's order. That keeps the pool and the pane in lockstep -- move a
//    window and its pool moves with it.
//
// 2. The radius follows the pane, not the wall. A window is ~0.6 m wide, so a
//    pool a little larger than that reads as light spreading on the stone; the
//    caller may pass a `radius` (metres) and otherwise it is derived from the
//    pane's `warmth`, so a cooler, dimmer pane throws a smaller pool. The
//    result is clamped into [SPILL_MIN_RADIUS, SPILL_MAX_RADIUS] so a junk
//    anchor cannot ask for a floodlight.
//
// 3. The centre wanders and the disc spins, but only a little. A pool exactly
//    concentric with its pane reads as a painted halo; a pool offset by up to
//    SPILL_JITTER of its radius, and spun by a seeded angle, reads as light
//    falling from one side. The jitter and the spin are seeded from the anchor's
//    own coordinates rather than from its index, so reordering the list (or
//    inserting a new window in the middle) does not reshuffle every other pool,
//    and two anchors that happen to share a spot still get different draws.
//
// Everything here is seeded (mulberry32, copied rather than imported so the
// module stands alone) and pure: no Three.js, no DOM, no clock, no Math.random.
// Two identical calls produce bit-identical pools, which is what lets the unit
// suite pin the field. Every export is total -- it guards junk input, and no
// call can produce NaN or Infinity. Seeded mulberry32 copied in.

/** Seed for the spill generator. Fixed so every run lights the same village. */
export const SPILL_SEED = 0x7c4a91;

/** How many pools the field holds when the caller does not say. Matches the
 *  window schedule's default count. */
export const SPILL_COUNT = 12;

/** Hard ceiling on pools per call, whatever the caller asks for. One instanced
 *  draw call regardless, but each pool is a translucent additive quad over real
 *  screen area, and this host is fill-rate bound; a runaway anchor list must not
 *  turn the ground into a white wash. */
export const SPILL_MAX_COUNT = 64;

/** Smallest pool half-extent in metres. Below this a pool is lost inside the
 *  window's own texel size and buys nothing. */
export const SPILL_MIN_RADIUS = 0.5;

/** Largest pool half-extent in metres. A pool larger than this stops reading as
 *  light spilling from one pane and starts to read as a floodlit courtyard. */
export const SPILL_MAX_RADIUS = 2.4;

/** How far, as a fraction of a pool's radius, its centre may wander from the
 *  anchor centre. A quarter of the radius breaks the painted-halo look while
 *  keeping the pool under its window. */
export const SPILL_JITTER = 0.25;

/** Height of a spill pool above the paved surface under it, in metres. A pool
 *  is a translucent, depthWrite:false quad, so it must sit a little above the
 *  stone to beat z-fighting at grazing angles; 3 mm clears the paving without
 *  reading as a raised disc. This is a LIFT above the surface, not an absolute
 *  world height. */
export const SPILL_DECAL_LIFT = 0.003;

/** Per-pool opacity range. This is the strength of one pool relative to the
 *  others -- a warm, bright pane throws a denser pool than a cool one -- before
 *  the per-phase multiplier from spillStrength() is applied. */
const SPILL_MIN_OPACITY = 0.25;
const SPILL_MAX_OPACITY = 0.55;

/** A small deterministic PRNG (mulberry32). Copied from the other pure modules
 *  rather than imported, so `lightspill.js` stays independent of them. */
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

/** A usable anchor needs finite x and z. A radius, if supplied, must be finite
 *  and non-negative; a warmth, if supplied, must be finite. Either may be
 *  absent, in which case a neutral pool is derived. */
function usableAnchor(anchor) {
  if (anchor == null || typeof anchor !== 'object' || Array.isArray(anchor)) return null;
  if (!finiteNumber(anchor.x) || !finiteNumber(anchor.z)) return null;
  if (anchor.radius != null && (!finiteNumber(anchor.radius) || anchor.radius < 0)) return null;
  if (anchor.warmth != null && !finiteNumber(anchor.warmth)) return null;
  return {
    x: anchor.x,
    z: anchor.z,
    radius: finiteNumber(anchor.radius) ? anchor.radius : null,
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

/**
 * The strength of the spill field at a given phase and night progress, in [0, 1].
 *
 * By day the field is exactly zero: a window that is not lit cannot spill
 * light. Through dusk and night it follows the night ramp, scaled by how fully
 * the phase reads as night, so the pools fade in as the windows light up and
 * out as dawn breaks. Junk phase ids read as day (0), and a junk nightFraction
 * clamps into [0, 1], so the call never throws and never yields NaN.
 */
export function spillStrength(phaseId, nightFraction) {
  if (typeof phaseId !== 'string') return 0;
  const base = phaseId === 'dusk' ? 0.55 : phaseId === 'night' ? 1 : 0;
  const n = clampNumber(nightFraction, 0, 1, 0);
  const value = base * n;
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Whether the spill field runs at this quality tier. The low tier drops the
 * per-frame window pass and its spill with it, consistent with the quality-tier
 * convention; junk reads as the full tier.
 */
export function spillEnabled(tier) {
  return tier !== 'low';
}

/**
 * The pool descriptors for a list of window footprints.
 *
 * Each entry in `anchors` is `{ x, z }` plus an optional `radius` (metres) or
 * `warmth` (0..1-ish, the pane's warmth factor). The call returns one
 * descriptor per usable anchor, in the caller's order, each shaped
 * `{ x, z, radius, opacity, yaw }`:
 *   - `x` and `z` are the pool centre, jittered from the anchor by up to
 *     SPILL_JITTER of its radius;
 *   - `radius` is the pool's half-extent, derived from the anchor's radius or
 *     warmth and clamped into [SPILL_MIN_RADIUS, SPILL_MAX_RADIUS];
 *   - `opacity` is this pool's own strength in [SPILL_MIN_OPACITY,
 *     SPILL_MAX_OPACITY], to be multiplied by spillStrength(phase, night);
 *   - `yaw` is a seeded spin angle in [0, 2*PI), applied by the world.
 *
 * Junk anchors are dropped rather than throwing, and at most SPILL_MAX_COUNT
 * pools are returned. A non-array argument returns an empty list. The call
 * never throws and never yields NaN or Infinity, and identical anchors yield
 * bit-identical descriptors.
 */
export function spillDecals(anchors) {
  const out = [];
  if (!Array.isArray(anchors)) return out;
  const limit = Math.min(SPILL_MAX_COUNT, anchors.length);
  for (let i = 0; i < limit; i += 1) {
    const anchor = usableAnchor(anchors[i]);
    if (anchor == null) continue;
    const rng = mulberry32(anchorSeed(anchor, SPILL_SEED));
    // Derive the base radius from an explicit radius, else from warmth, else a
    // neutral metre. Warmth sits in [0.82, 1] in practice; map it onto the
    // middle of the radius range so a cool pane throws a smaller pool.
    let baseRadius;
    if (anchor.radius != null) {
      baseRadius = anchor.radius;
    } else if (anchor.warmth != null) {
      const t = Math.min(1, Math.max(0, (anchor.warmth - 0.8) / 0.2));
      baseRadius = SPILL_MIN_RADIUS + t * (SPILL_MAX_RADIUS - SPILL_MIN_RADIUS) * 0.6;
    } else {
      baseRadius = 1.0;
    }
    // Guard against non-finite baseRadius slipping through (e.g. huge warmth).
    if (!Number.isFinite(baseRadius) || baseRadius <= 0) baseRadius = 1.0;
    const jx = (rng() * 2 - 1) * SPILL_JITTER * baseRadius;
    const jz = (rng() * 2 - 1) * SPILL_JITTER * baseRadius;
    const scale = 0.9 + rng() * 0.25;
    const opacity = SPILL_MIN_OPACITY + rng() * (SPILL_MAX_OPACITY - SPILL_MIN_OPACITY);
    const yaw = rng() * Math.PI * 2;
    const radius = Math.min(
      SPILL_MAX_RADIUS,
      Math.max(SPILL_MIN_RADIUS, baseRadius * scale)
    );
    out.push({
      x: anchor.x + jx,
      z: anchor.z + jz,
      radius,
      opacity,
      yaw
    });
  }
  // Final totality pass.
  for (const d of out) {
    if (!Number.isFinite(d.x)) d.x = 0;
    if (!Number.isFinite(d.z)) d.z = 0;
    if (!Number.isFinite(d.radius)) d.radius = SPILL_MIN_RADIUS;
    if (!Number.isFinite(d.opacity)) d.opacity = SPILL_MIN_OPACITY;
    if (!Number.isFinite(d.yaw)) d.yaw = 0;
    d.radius = Math.min(SPILL_MAX_RADIUS, Math.max(SPILL_MIN_RADIUS, d.radius));
    d.opacity = Math.min(SPILL_MAX_OPACITY, Math.max(SPILL_MIN_OPACITY, d.opacity));
    d.yaw = ((d.yaw % (Math.PI * 2)) + (Math.PI * 2)) % (Math.PI * 2);
  }
  return out;
}
