// Cloud shadows on the ground.
//
// A cloud layer drifting across a sunlit plaza should not just be something to
// look up at: the ground beneath it should darken, and the edge of that dark
// should slide rather than snap. This module is the pure half of that idea. It
// takes the cloud layer's positions and the sun's direction and answers one
// question -- how lit is this patch of ground? -- with no Three.js, no scene and
// no clock, so the maths can be pinned by unit tests and the same answer can be
// reused by a renderer, a light probe or a minimap.
//
// The model is the obvious one. A cloud sits high on the dome; the sun's rays
// travel in a straight line; where those rays would have met the ground had the
// cloud not been in the way is the cloud's shadow. Projecting the cloud centre
// along the sun direction onto the ground plane gives that point exactly. A
// point on the ground is shadowed in proportion to how close it lies to that
// projected centre, eased so the shadow has a soft rim instead of a hard disc.

/**
 * How dark a full cloud shadow is, as a fraction of the light removed.
 *
 * A cloud should not plunge the plaza into night: it is a passing dimming, not
 * an eclipse. 0.35 removes just over a third of the light under a cloud centre,
 * which reads clearly against the sunlit ground without making the world look
 * broken when a cloud happens to sit over the player.
 */
export const CLOUD_SHADOW_STRENGTH = 0.35;

/** Default ground footprint of one cloud, in metres. The dome's clouds are
 *  broad and soft, so a shadow a dozen metres across is in scale with them. */
export const DEFAULT_CLOUD_RADIUS = 12;

/** Most of the sun the whole layer may remove at once. A fifth, so a passing
 *  cloud never makes the plaza look broken or the day feel like dusk. */
export const CLOUD_DAPPLE_MAX = 0.2;

/** Seconds for the two dapple waves: coprime-ish so the pattern does not
 *  repeat on any human timescale, slow enough that the change is never seen. */
export const CLOUD_DAPPLE_PERIOD_A = 71;
export const CLOUD_DAPPLE_PERIOD_B = 113;

/** A sun whose rays are within this of horizontal casts no useful shadow: the
 *  projection runs off to infinity. Treated as "no shadow" rather than dividing
 *  by a near-zero. */
const HORIZON_EPSILON = 1e-6;

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function finitePoint(value) {
  return value != null && finiteNumber(value.x) && finiteNumber(value.y) && finiteNumber(value.z);
}

/**
 * The ground-plane point a cloud's centre projects to along the sun's rays.
 *
 * `sunDir` may point either way along the ray (towards the sun or away from it);
 * the maths is the same. Writing the shadow as
 *
 *     ground = cloud - sunDir * (cloud.y / sunDir.y)
 *
 * moves the projection the correct way for both conventions: flip the sign of
 * every component of sunDir and both the numerator and denominator flip, so the
 * result is unchanged. Returns null when the projection is not defined (a
 * horizontal sun, or non-finite inputs) rather than dividing by a near-zero.
 *
 * Exported because the world needs the same answer in two directions: to know
 * where a cloud's shadow lands, and -- for the near passer layer -- where to
 * hang a cloud so that its shadow lands on the plaza. See
 * {@link raisePointToCloud}, which is this map's inverse.
 */
export function projectCloudToGround(cloud, sunDir) {
  if (!finitePoint(cloud) || !finitePoint(sunDir)) return null;
  const vertical = sunDir.y;
  if (!finiteNumber(vertical) || Math.abs(vertical) < HORIZON_EPSILON) return null;
  const t = cloud.y / vertical;
  const x = cloud.x - sunDir.x * t;
  const z = cloud.z - sunDir.z * t;
  if (!finiteNumber(x) || !finiteNumber(z)) return null;
  return { x, z };
}

/**
 * The inverse of {@link projectCloudToGround}: the point `altitude` metres up
 * along the sun's ray from a ground position, i.e. where a cloud must sit for
 * its shadow to fall on `ground`.
 *
 *     cloud = ground + sunDir * (altitude / sunDir.y)
 *
 * Only the direction of `sunDir` matters, so scaling it changes nothing; the
 * result keeps `y` exactly at `altitude` up to rounding. Returns null when the
 * ray is horizontal or the inputs are junk. The world uses this for the near
 * passer clouds: their ground footprint is the authored value and the overhead
 * disc is derived from it, so the disc and its shadow cannot drift apart.
 *
 * `ground.y` is optional and reads as 0 when absent, because the caller's
 * footprint is a flat `{ x, z, r }` and the ground is the y = 0 plane. A
 * non-finite `y`, if given, still makes the call fail rather than silently
 * treating it as zero.
 */
export function raisePointToCloud(ground, sunDir, altitude) {
  if (ground == null || !finiteNumber(ground.x) || !finiteNumber(ground.z)) return null;
  const baseY = ground.y === undefined ? 0 : ground.y;
  if (!finiteNumber(baseY) || !finitePoint(sunDir)) return null;
  if (!finiteNumber(altitude) || altitude <= 0) return null;
  const vertical = sunDir.y;
  if (!finiteNumber(vertical) || Math.abs(vertical) < HORIZON_EPSILON) return null;
  const t = altitude / vertical;
  const x = ground.x + sunDir.x * t;
  const y = baseY + sunDir.y * t;
  const z = ground.z + sunDir.z * t;
  if (!finiteNumber(x) || !finiteNumber(y) || !finiteNumber(z)) return null;
  return { x, y, z };
}

/** Smoothstep, clamped to [0, 1]. Used so the shadow's edge eases out rather
 *  than ending on a hard line. */
function smoothstep(u) {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
}

/**
 * How much one cloud shades a point, 0..1 (1 = directly under the cloud's
 * centre, 0 = outside its footprint). Falls off with the smoothstep of the
 * normalised distance so the rim is soft.
 */
function singleCloudShade(point, cloud, sunDir, radius) {
  const projected = projectCloudToGround(cloud, sunDir);
  if (!projected) return 0;
  const dx = point.x - projected.x;
  const dz = point.z - projected.z;
  const distance = Math.hypot(dx, dz);
  if (!finiteNumber(distance)) return 0;
  if (distance >= radius) return 0;
  // smoothstep(0 -> 1) rises from 0 to 1; invert it so the centre is darkest.
  return 1 - smoothstep(distance / radius);
}

/**
 * The lit factor at a ground point, in [0, 1]: 1 is full sun, 0 is fully under
 * a cloud. `point.y` is ignored -- shadows are read on the ground plane.
 *
 * Several overlapping clouds combine multiplicatively: two half-shaded patches
 * make one darker patch, and no number of clouds can drive the result below 0.
 * The raw factor is returned; callers that want the authored, softer darkness
 * pass it through {@link applyCloudShadow}.
 *
 * Never throws: a malformed point, sun or cloud list reads as full sun.
 */
export function cloudShadowFactor(point, clouds, sunDir, cloudRadius = DEFAULT_CLOUD_RADIUS) {
  if (!finitePoint(point) || !finitePoint(sunDir) || !Array.isArray(clouds)) return 1;
  const radius = finiteNumber(cloudRadius) && cloudRadius > 0 ? cloudRadius : DEFAULT_CLOUD_RADIUS;
  let light = 1;
  for (const cloud of clouds) {
    if (!finitePoint(cloud)) continue;
    const shade = singleCloudShade(point, cloud, sunDir, radius);
    if (shade <= 0) continue;
    // Multiplicative occlusion: each cloud removes a fraction of what is left.
    light *= 1 - shade;
  }
  return Math.min(1, Math.max(0, light));
}

/**
 * Distance on the ground plane from `point` to the nearest projected cloud
 * centre, in metres. `Infinity` when there are no clouds, no usable projection,
 * or the inputs are malformed.
 */
export function nearestCloudDistance(point, clouds, sunDir) {
  if (!finitePoint(point) || !finitePoint(sunDir) || !Array.isArray(clouds)) return Infinity;
  let nearest = Infinity;
  for (const cloud of clouds) {
    if (!finitePoint(cloud)) continue;
    const projected = projectCloudToGround(cloud, sunDir);
    if (!projected) continue;
    const distance = Math.hypot(point.x - projected.x, point.z - projected.z);
    if (finiteNumber(distance) && distance < nearest) nearest = distance;
  }
  return nearest;
}

/**
 * How strongly the cloud layer dims the sun at a given time, as a lit factor in
 * [1 - CLOUD_DAPPLE_MAX, 1].
 *
 * The dome's clouds sit on a 118 m ring around the plaza, so their true
 * projections never cross the ground the player walks on (a cloud 40 m up with
 * a sun 45 degrees high throws its shadow 40 m away). What the plaza does see is
 * the layer's aggregate effect: sometimes a broad cloud blocks part of the sun,
 * sometimes the sun is clear. This models exactly that, as a slow, smooth,
 * deterministic breathing rather than per-cloud geometry: two incommensurate
 * sinusoids so the cycle never visibly repeats, eased so the brightness never
 * steps.
 *
 * The dimming is deliberately capped well below CLOUD_SHADOW_STRENGTH: it is a
 * whole-sky modulation, not one cloud's footprint, so it only ever removes a
 * fifth of the sun at most. A clear spell is exactly the authored intensity.
 *
 * `time` is seconds; `seed` shifts the pattern per session so two runs do not
 * dim in lockstep. Never throws: non-finite input reads as full sun.
 */
export function cloudDapple(time, seed = 0, maxDim = CLOUD_DAPPLE_MAX) {
  if (!finiteNumber(time)) return 1;
  const off = finiteNumber(seed) ? seed : 0;
  const cap = finiteNumber(maxDim) ? Math.min(CLOUD_DAPPLE_MAX, Math.max(0, maxDim)) : CLOUD_DAPPLE_MAX;
  // Two slow waves at coprime-ish rates: 71 s and 113 s. Their sum stays in
  // [-2, 2]; map it to [0, 1] and ease it so there are long clear spells and
  // long gray spells instead of constant flicker.
  const a = Math.sin((time + off) * (Math.PI * 2) / CLOUD_DAPPLE_PERIOD_A);
  const b = Math.sin((time + off) * (Math.PI * 2) / CLOUD_DAPPLE_PERIOD_B + 1.3);
  const raw = (a + b + 2) / 4;
  const shade = smoothstep(raw);
  const lit = 1 - shade * cap;
  return Math.min(1, Math.max(1 - cap, lit));
}

/**
 * Softens a base lit factor by the authored cloud-shadow strength.
 *
 *     result = 1 - (1 - baseFactor) * strength
 *
 * With the default strength of 0.35, full sun (1) stays 1 and full shade (0)
 * becomes 0.65: the shadow dims the ground without blacking it out. The result
 * is clamped to [0, 1] so a caller cannot push it out of range.
 */
export function applyCloudShadow(baseFactor, strength = CLOUD_SHADOW_STRENGTH) {
  const base = finiteNumber(baseFactor) ? Math.min(1, Math.max(0, baseFactor)) : 1;
  const amount = finiteNumber(strength) ? Math.min(1, Math.max(0, strength)) : CLOUD_SHADOW_STRENGTH;
  const result = 1 - (1 - base) * amount;
  return Math.min(1, Math.max(0, result));
}
