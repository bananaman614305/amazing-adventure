// The night sky's star field.
//
// A dome full of points is the cheapest way to make the night sky read as a
// sky rather than a flat dark disc: a few hundred points on the inside of the
// 120 m dome, additive-blended so they glow, fading in at dusk and out at dawn.
//
// Everything decision-shaped is pure here so it can be unit-tested without a
// GPU: how many stars, where they sit, how bright the field is per phase, and
// how each star twinkles. `world.js` only turns these numbers into a Points
// mesh and applies them each frame.
//
// Positions are deterministic (seeded) so a screenshot taken twice looks the
// same and a save never changes the sky. There is no Math.random in the sim.

/** How many points the field carries. Cheap either way; 260 reads as a real
 *  sky without crowding the dome on a phone. */
export const STAR_COUNT = 260;

/** Radius the points sit at, just inside the 120 m dome so they never clip. */
export const STAR_FIELD_RADIUS = 116;

/** Minimum elevation in dome space (y / radius). Below this the horizon fog
 *  would swallow the star, so they are kept above the haze band. */
export const STAR_MIN_ELEVATION = 0.06;

/** Seed for the position generator. Fixed so the field is identical every run. */
export const STAR_SEED = 0x9e3779b9;

/**
 * A small deterministic PRNG (mulberry32). Returns a function yielding 0..1.
 * Used for star positions and colours so nothing here touches Math.random.
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
 * Deterministic star positions on the dome. Returns an array of {x, y, z}
 * already scaled to STAR_FIELD_RADIUS. Every entry sits above the horizon.
 */
export function starPositions(count = STAR_COUNT, seed = STAR_SEED) {
  const rng = mulberry32(seed);
  const out = [];
  let attempts = 0;
  const limit = count * 30;
  while (out.length < count && attempts < limit) {
    attempts += 1;
    // Uniform point on the unit sphere: u = cos(theta) in [-1, 1].
    const u = rng() * 2 - 1;
    if (u < STAR_MIN_ELEVATION) continue;
    const phi = rng() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - u * u));
    const x = r * Math.cos(phi);
    const y = u;
    const z = r * Math.sin(phi);
    out.push({
      x: x * STAR_FIELD_RADIUS,
      y: y * STAR_FIELD_RADIUS,
      z: z * STAR_FIELD_RADIUS
    });
  }
  return out;
}

/**
 * Per-phase visibility (0..1) for the whole field. Day is dark, dusk hints,
 * night is full. Unknown phases fall back to day so a bad id never leaves stars
 * blazing at noon.
 */
export const STAR_PHASE_VISIBILITY = Object.freeze({
  day: 0,
  dusk: 0.22,
  night: 1
});

export function starVisibility(phaseId) {
  const v = STAR_PHASE_VISIBILITY[phaseId];
  return typeof v === 'number' ? v : 0;
}

/**
 * Per-star twinkle multiplier (0..1-ish). Deterministic from index and time,
 * so the field breathes without Math.random. Combined sines keep it smooth.
 */
export function starTwinkle(index, time) {
  const a = Math.sin(time * 0.9 + index * 1.37);
  const b = Math.sin(time * 1.7 + index * 2.91);
  // Centre around 0.85 so stars never fully vanish mid-twinkle.
  return 0.85 + 0.1 + 0.05 * a + 0.05 * b;
}

/**
 * Per-star colour (plain {r, g, b} in 0..1). Most stars are white, with a
 * handful tinted cool or warm. Deterministic from index.
 */
export function starColor(index) {
  const rng = mulberry32(index * 7919 + 0x5a8279);
  const tint = rng();
  // Base white, nudged by tint.
  let r = 0.92 + rng() * 0.08;
  let g = 0.92 + rng() * 0.08;
  let b = 0.92 + rng() * 0.08;
  if (tint < 0.15) {
    // Cool blue-white.
    r -= 0.08; g -= 0.02; b += 0.1;
  } else if (tint > 0.88) {
    // Warm amber.
    r += 0.1; g += 0.04; b -= 0.12;
  }
  const clamp = (v) => Math.max(0, Math.min(1, v));
  return { r: clamp(r), g: clamp(g), b: clamp(b) };
}

/**
 * Per-star base size in world units (on the dome). Slight variation so the
 * field is not a uniform grid of identical dots.
 */
export function starSize(index) {
  const rng = mulberry32(index * 4099 + 0x1234abcd);
  return 0.5 + rng() * 0.7;
}

// --- Field preparation --------------------------------------------------
//
// The numbers above are what the world needs to know; the two helpers below
// turn them into the arrays a Three.js BufferGeometry is built from. They stay
// pure so the exact bytes that go to the GPU are unit-testable.

/**
 * Builds the three arrays a Points mesh needs: position (x, y, z per star),
 * color (r, g, b per star) and size (one float per star). Positions come from
 * starPositions(), colours and sizes are deterministic per index.
 */
export function buildStarField(count = STAR_COUNT, seed = STAR_SEED) {
  const positions = starPositions(count, seed);
  const n = positions.length;
  const position = new Float32Array(n * 3);
  const color = new Float32Array(n * 3);
  const size = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const p = positions[i];
    position[i * 3] = p.x;
    position[i * 3 + 1] = p.y;
    position[i * 3 + 2] = p.z;
    const c = starColor(i);
    color[i * 3] = c.r;
    color[i * 3 + 1] = c.g;
    color[i * 3 + 2] = c.b;
    size[i] = starSize(i);
  }
  return { position, color, size, count: n };
}

/**
 * The field's material opacity for a phase: the phase visibility, clamped to
 * 0..1. Unknown phases fall back to 0 so a bad id never leaves stars out.
 */
export function starFieldOpacity(phaseId) {
  return Math.max(0, Math.min(1, starVisibility(phaseId)));
}
