// The sky's cloud layer.
//
// A small band of soft discs on the inside of the 120 m dome, above the
// horizon haze and below the zenith, drifting slowly and fading with the day
// cycle. They are the daylight counterpart to the star field: where stars are
// points that glow at night, clouds are broad translucent patches that read
// best at noon and all but vanish once it is dark.
//
// Everything decision-shaped is pure here so it can be unit-tested without a
// GPU: how many clouds, where they sit, how opaque and what colour they are per
// phase, how big each one is, and how it drifts. `world.js` only turns these
// numbers into meshes and applies them each frame.
//
// Positions are deterministic (seeded) so a screenshot taken twice looks the
// same and a save never changes the sky. There is no Math.random in the sim.

/** How many cloud discs the layer carries. A dozen or so is enough to break up
 *  the dome without turning the sky into soup on a phone. */
export const CLOUD_COUNT = 14;

/** Radius the clouds sit at, just inside the 120 m dome so they never clip. */
export const CLOUD_FIELD_RADIUS = 118;

/** Elevation band in dome space (y / radius). Below the minimum the horizon
 *  haze would swallow a cloud; above the maximum it would crowd the zenith. */
export const CLOUD_MIN_ELEVATION = 0.05;
export const CLOUD_MAX_ELEVATION = 0.6;

/** Seed for the position generator. Fixed so the layer is identical every run. */
export const CLOUD_SEED = 0x7c3aed;

/**
 * A small deterministic PRNG (mulberry32). Returns a function yielding 0..1.
 * Identical to the one in src/stars.js so the whole sky shares one generator
 * and nothing here touches Math.random.
 */
export function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6D2B79F5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic cloud positions on the dome. Returns an array of {x, y, z}
 * already scaled to CLOUD_FIELD_RADIUS. Every entry sits above the horizon and
 * within the authored elevation band, so none hugs the ground or the zenith.
 */
export function cloudPositions(count = CLOUD_COUNT, seed = CLOUD_SEED) {
  const rng = mulberry32(seed);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    // Elevation straight from the band; the azimuth is uniform around the dome.
    const elev = CLOUD_MIN_ELEVATION +
      rng() * (CLOUD_MAX_ELEVATION - CLOUD_MIN_ELEVATION);
    const phi = rng() * Math.PI * 2;
    const ring = Math.sqrt(Math.max(0, 1 - elev * elev));
    out.push({
      x: ring * Math.cos(phi) * CLOUD_FIELD_RADIUS,
      y: elev * CLOUD_FIELD_RADIUS,
      z: ring * Math.sin(phi) * CLOUD_FIELD_RADIUS
    });
  }
  return out;
}

/**
 * Per-phase opacity (0..1) for the whole layer. Clouds are a daylight feature:
 * bold at noon, softened at dusk, a faint ghost at night. Unknown phases fall
 * back to 0 so a bad id never leaves clouds hanging in the dark.
 */
export const CLOUD_PHASE_OPACITY = Object.freeze({
  day: 0.55,
  dusk: 0.4,
  night: 0.12
});

export function cloudOpacity(phaseId) {
  const v = CLOUD_PHASE_OPACITY[phaseId];
  return typeof v === 'number' ? v : 0;
}

/** Base white the day clouds are painted with. */
export const CLOUD_BASE_COLOR = 0xffffff;

/**
 * Per-phase tint as a hex number. Day clouds are neutral white, dusk catches
 * the low sun's warmth, and night clouds take a cold blue so they read as
 * moonlit rather than grubby. Unknown phases fall back to the day white.
 */
export function cloudColor(phaseId) {
  if (phaseId === 'day') return 0xffffff;
  if (phaseId === 'dusk') return 0xffd9b0;
  if (phaseId === 'night') return 0x6b7a9a;
  return 0xffffff;
}

/**
 * Per-cloud base size in world units (on the dome). Deterministic from index,
 * spread across [6, 14] so the layer is not a uniform grid of identical discs.
 */
export function cloudSize(index) {
  const rng = mulberry32((index + 1) * 0x9e3779b1 + 0x1234abcd);
  return 6 + rng() * 8;
}

/**
 * Per-cloud drift in radians, smooth and deterministic. A slow shared sway,
 * phase-offset per cloud so the layer does not move as one rigid sheet. Kept
 * within +/-0.1 rad so clouds never wander far from where they were placed.
 */
export function cloudDrift(index, time) {
  return 0.1 * Math.sin(time * 0.05 + index * 1.7);
}
