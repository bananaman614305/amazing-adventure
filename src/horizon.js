// The distant ridge on the skyline.
//
// Where the sky dome meets the fog the world currently ends on a flat edge: the
// ground disc stops and the haze begins with nothing in between, which reads as
// the inside of a box rather than a place outdoors. A ring of low hills just
// inside the dome fixes that for the cost of one unlit mesh: a silhouette at the
// horizon that the fog can soften, so the eye accepts the sky as distance rather
// than a wall.
//
// Everything decision-shaped is pure here so it can be unit-tested without a
// GPU: how tall the ridge is at each point around the circle, where a point sits,
// the triangles a renderer should build from it, and what colour and opacity the
// ridge takes per phase. `world.js` only turns these numbers into a mesh.
//
// The silhouette is a handful of low-frequency sinusoids with seeded phases, not
// white noise. Integer frequencies around the loop mean the shape closes exactly
// at the wrap seam, so no extra vertex is needed to hide a step, and the result
// has a couple of broad hills instead of a jagged static line. The phases are
// seeded so a screenshot taken twice looks the same and a save never changes the
// skyline. There is no Math.random in the sim.

/** The ridge sits just inside the 120 m sky dome, so it can never clip through
 *  it and the fog still has room to blend the two together. */
export const HORIZON_RADIUS = 112;

/** Points around the full circle. 96 is fine enough that a foothill reads as a
 *  curve and coarse enough that the ring is a few hundred triangles, cheap even
 *  on a phone. */
export const HORIZON_SEGMENTS = 96;

/** Height of the ridge's foot. Far below ground on purpose.
 *
 *  The plaza's ground disc is only 34 m across and the wall is at its edge, so
 *  the only place the far distance is visible is the gap over the wall (and
 *  through the open gate). From the middle of the plaza that gap runs from about
 *  5 degrees below the horizon (where the wall top cuts the view) down to about
 *  15 degrees, where the ground disc itself hides the dome. A ridge foot just
 *  under the grass would leave a hard cut across that band, so the foot is
 *  dropped 30 m: the ribbon then fills the whole gap and its lower edge is
 *  hidden behind the wall and the ground, never seen against the dome. */
export const HORIZON_BASE_Y = -30;

/** The ridge's nominal height above its foot, and how far a hill may rise or
 *  fall from it. Together they give hilltops in [38, 50] m above the foot, which
 *  is [8, 20] m above ground once the foot's -30 m offset is applied.
 *
 *  The number is set by what the player can actually see, not by taste. The wall
 *  is 3.2 m tall and the player's eye is 1.6 m, so from the middle of the plaza
 *  the wall top sits about 5.4 degrees above the horizon. A ridge at 112 m must
 *  clear that line to show at all, which means roughly 12 m of height above
 *  ground; 8-20 m gives hilltops that rise over the wall with valleys that duck
 *  behind it, which is exactly how a real skyline reads. */
export const HORIZON_BASE_HEIGHT = 44;
export const HORIZON_HEIGHT_VARIATION = 6;

/** Seed for the phase generator. Fixed so the skyline is identical every run. */
export const HORIZON_SEED = 0x5eed1a7;

/**
 * A small deterministic PRNG (mulberry32). Returns a function yielding 0..1.
 * Identical to the one in src/stars.js and src/clouds.js so the whole sky shares
 * one generator and nothing here touches Math.random.
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
 * The harmonics the silhouette is built from: `wave` is the number of full
 * cycles around the loop and `weight` is its share of the total deviation.
 * Integer wave numbers are the whole trick -- sin(wave * theta) is exactly
 * periodic over 2*PI, so the ring closes with no seam. One broad hill (wave 1)
 * dominates, with two smaller undulations so the ridge is not a single clean
 * sine.
 */
export const HORIZON_HARMONICS = Object.freeze([
  Object.freeze({ wave: 1, weight: 0.6 }),
  Object.freeze({ wave: 2, weight: 0.25 }),
  Object.freeze({ wave: 3, weight: 0.15 })
]);

/**
 * The ridge height at each point around the circle, index 0 at angle 0.
 *
 * Returns a Float64Array of length `count`, every value clamped to
 * [BASE_HEIGHT - VARIATION, BASE_HEIGHT + VARIATION]. Adjacent points differ by
 * little by construction (the waves are low frequency), and because the waves
 * are integer-periodic the wrap from the last point back to the first is just
 * as smooth as any other step.
 *
 * The phases are drawn from the seed in a fixed order, so the whole skyline is
 * a pure function of (count, seed).
 */
export function horizonHeights(count = HORIZON_SEGMENTS, seed = HORIZON_SEED) {
  const n = Number.isFinite(count) ? Math.floor(count) : 0;
  if (n <= 0) return new Float64Array(0);
  const rng = mulberry32(seed);
  // One seeded phase per harmonic, in table order so a seed always maps to the
  // same shape.
  const phases = HORIZON_HARMONICS.map(() => rng() * Math.PI * 2);
  const totalWeight = HORIZON_HARMONICS.reduce((sum, h) => sum + h.weight, 0) || 1;
  const minHeight = HORIZON_BASE_HEIGHT - HORIZON_HEIGHT_VARIATION;
  const maxHeight = HORIZON_BASE_HEIGHT + HORIZON_HEIGHT_VARIATION;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const theta = (i / n) * Math.PI * 2;
    let sum = 0;
    for (let h = 0; h < HORIZON_HARMONICS.length; h += 1) {
      const { wave, weight } = HORIZON_HARMONICS[h];
      sum += weight * Math.sin(wave * theta + phases[h]);
    }
    // Normalise by the sum of weights so |sum| <= 1 however many harmonics are
    // added, then map onto the authored height band. Clamped as a final guard:
    // the maths already respects the band, but a future tuning of weights
    // should never push a hill outside the declared range.
    const raw = HORIZON_BASE_HEIGHT + (sum / totalWeight) * HORIZON_HEIGHT_VARIATION;
    out[i] = Math.min(maxHeight, Math.max(minHeight, raw));
  }
  return out;
}

/**
 * One point on the ring at `index`, `height` metres above the ridge foot.
 *
 * Angle is index / count * 2*PI, measured so index 0 sits on +x and the ring
 * runs towards +z. y is always BASE_Y + height, so `height` is the same number
 * horizonHeights() returns and the caller never has to remember the foot offset.
 *
 * Guarded against count <= 0 (and non-finite index, height or radius) so a
 * degenerate build cannot emit NaN positions into a geometry buffer.
 */
export function horizonPoint(index, count = HORIZON_SEGMENTS, height = 0, radius = HORIZON_RADIUS) {
  const safeHeight = Number.isFinite(height) ? height : 0;
  if (!Number.isFinite(count) || count <= 0) {
    return { x: 0, y: HORIZON_BASE_Y + safeHeight, z: 0 };
  }
  const safeRadius = Number.isFinite(radius) ? radius : HORIZON_RADIUS;
  const safeIndex = Number.isFinite(index) ? index : 0;
  const angle = (safeIndex / count) * Math.PI * 2;
  return {
    x: safeRadius * Math.cos(angle),
    y: HORIZON_BASE_Y + safeHeight,
    z: safeRadius * Math.sin(angle)
  };
}

/**
 * The ridge as a non-indexed triangle list: two triangles (six vertices) per
 * segment, stretched from the foot up to the ridge line.
 *
 * For segment i the four corners are foot(i), foot(i+1), ridge(i),
 * ridge(i+1), wound so the front face looks inward at the plaza (the player is
 * always inside the ring). The vertex order is
 *
 *     foot(i), foot(i+1), ridge(i),   // triangle 1
 *     foot(i+1), ridge(i+1), ridge(i) // triangle 2
 *
 * which gives both triangles the same inside-facing winding. Length is
 * count * 2 * 3. Returns an empty array for count <= 0.
 */
export function horizonRibbonVertices(count = HORIZON_SEGMENTS, seed = HORIZON_SEED) {
  const n = Number.isFinite(count) ? Math.floor(count) : 0;
  if (n <= 0) return [];
  const heights = horizonHeights(n, seed);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const next = (i + 1) % n;
    const footI = horizonPoint(i, n, 0);
    const footNext = horizonPoint(next, n, 0);
    const ridgeI = horizonPoint(i, n, heights[i]);
    const ridgeNext = horizonPoint(next, n, heights[next]);
    out.push(footI, footNext, ridgeI);
    out.push(footNext, ridgeNext, ridgeI);
  }
  return out;
}

/**
 * The same ribbon as one flat Float32Array of x, y, z triples, ready to hand
 * straight to a Three.js BufferAttribute without a second conversion pass.
 * Length is count * 2 * 3 * 3, i.e. three times horizonRibbonVertices().
 */
export function horizonRibbonArray(count = HORIZON_SEGMENTS, seed = HORIZON_SEED) {
  const vertices = horizonRibbonVertices(count, seed);
  const out = new Float32Array(vertices.length * 3);
  for (let i = 0; i < vertices.length; i += 1) {
    const p = vertices[i];
    out[i * 3] = p.x;
    out[i * 3 + 1] = p.y;
    out[i * 3 + 2] = p.z;
  }
  return out;
}

/**
 * Per-vertex colours for the ribbon: the ridge line takes `ridgeHex`, the foot
 * takes `footHex`, and the triangles interpolate between them.
 *
 * This is what makes the ridge read as distance instead of a paper cut-out. A
 * flat silhouette has a hard bottom edge wherever it is not hidden, and the eye
 * reads that edge as a wall. Fading the foot towards the haze colour means the
 * ridge dissolves into the same air the sky is painted with, exactly as a far
 * hill does, for no cost beyond one more vertex attribute and no extra draw.
 *
 * Colours are returned in the same vertex order horizonRibbonVertices() builds,
 * so the two arrays can be uploaded side by side. Unknown/invalid hex reads as
 * the day tint for the ridge and the day haze for the foot.
 */
export function horizonRibbonColors(ridgeHex = HORIZON_DAY_TINT, footHex = HORIZON_DAY_HAZE,
  count = HORIZON_SEGMENTS) {
  const n = Number.isFinite(count) ? Math.floor(count) : 0;
  const out = new Float32Array(Math.max(0, n) * 2 * 3 * 3);
  if (n <= 0) return out;
  const ridge = colourChannels(ridgeHex, HORIZON_DAY_TINT);
  const foot = colourChannels(footHex, HORIZON_DAY_HAZE);
  // Vertex order per segment: foot(i), foot(i+1), ridge(i), foot(i+1),
  // ridge(i+1), ridge(i). See horizonRibbonVertices().
  const order = [foot, foot, ridge, foot, ridge, ridge];
  for (let i = 0; i < n; i += 1) {
    for (let v = 0; v < 6; v += 1) {
      const c = order[v];
      const at = (i * 6 + v) * 3;
      out[at] = c[0];
      out[at + 1] = c[1];
      out[at + 2] = c[2];
    }
  }
  return out;
}

/** Splits a hex colour into [r, g, b] in 0..1, falling back on invalid input. */
function colourChannels(hex, fallbackHex) {
  const value = typeof hex === 'number' && Number.isFinite(hex) ? hex : fallbackHex;
  const r = ((value >> 16) & 0xff) / 255;
  const g = ((value >> 8) & 0xff) / 255;
  const b = (value & 0xff) / 255;
  return [r, g, b];
}

/** Day tint: a hazy blue-grey that sits between the daylight sky and the fog,
 *  so the ridge reads as very distant land rather than a cut-out. */
export const HORIZON_DAY_TINT = 0x8fa6b8;

/** The haze colour the ridge's foot fades into. Matches the day fog so the
 *  bottom of the hills is indistinguishable from the air in front of them. */
export const HORIZON_DAY_HAZE = 0xcfe2f5;

/**
 * Per-phase colours for the foot gradient. Each entry is the haze the hills
 * dissolve into for that phase: the day fog, the dusk haze, the night fog. The
 * ridge line keeps the phase tint; only the bottom of the hills changes, which
 * is exactly how the far distance behaves as the light goes.
 */
export const HORIZON_FOOT = Object.freeze({
  day: HORIZON_DAY_HAZE,
  dusk: 0xf0a97c,
  night: 0x0b1730
});

/** The foot colour for a phase, falling back to the day haze. */
export function horizonFootTint(phaseId) {
  const v = HORIZON_FOOT[phaseId];
  return typeof v === 'number' ? v : HORIZON_DAY_HAZE;
}

/**
 * Per-phase tint as a hex number. Dusk pulls the ridge towards violet as the
 * low sun leaves it, night sinks it to near-sky darkness so it does not cut a
 * hard silhouette against the stars. Unknown phases fall back to the hazy day
 * tint, matching how the rest of the sky falls back to day.
 */
export const HORIZON_TINTS = Object.freeze({
  day: HORIZON_DAY_TINT,
  dusk: 0x6b5a72,
  night: 0x111a2b
});

export function horizonTint(phaseId) {
  const v = HORIZON_TINTS[phaseId];
  return typeof v === 'number' ? v : HORIZON_DAY_TINT;
}

/**
 * Per-phase opacity. The ridge is always just short of opaque so the fog colour
 * bleeds through it: that blend is what keeps it reading as distance rather
 * than a solid wall. Night is the most transparent of the three, because the
 * dark sky behind it is close to its own tint and a hard edge would draw the
 * eye. Unknown phases fall back to the day value.
 */
export const HORIZON_OPACITY = Object.freeze({
  day: 0.85,
  dusk: 0.9,
  night: 0.75
});

export function horizonOpacity(phaseId) {
  const v = HORIZON_OPACITY[phaseId];
  return typeof v === 'number' ? v : HORIZON_OPACITY.day;
}