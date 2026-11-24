// The fountain's animated water surface.
//
// Round 73 dressed the fountain's two discs with a tileable normal map, but the
// ripples stayed frozen: a normal map that never moves reads as a photograph
// of water rather than water. A per-frame UV offset on the normal map is the
// cheapest realism win left -- no new geometry, no new draw calls, one texture
// matrix update per frame -- and it is the first per-frame hook in world.js, so
// it is kept deliberate: a pure accumulator here, an environment.updateWater()
// there, and a low-tier switch so a struggling phone is not asked to chase a
// moving highlight.
//
// Why not animate the albedo too? The albedo is the water's colour, which
// should stay put while the surface moves over it; only the normal (and thus
// the specular highlight) should travel. Animating both makes the ripples look
// like a scrolling poster.

/** UV units per second along each axis. Slow enough to read as a gentle swell
 *  rather than a conveyor belt; the normal map's ripples are authored at a
 *  1.0 m tile, so this is a few centimetres of travel per second. */
export const WATER_FLOW_SPEED = 0.04;

/** The low tier freezes the surface: a moving highlight over a dark, unlit
 *  scene would draw the eye to a pond the player cannot see into. */
export function shouldAnimateWater(tier) {
  return tier !== 'low';
}

/** One frame's UV delta. Zero when the tier is low or dt is not usable, so a
 *  paused or backgrounded frame cannot jump the surface. */
export function waterOffsetStep(dt, { speed = WATER_FLOW_SPEED, low = false, tier } = {}) {
  const effectiveLow = low || tier === 'low';
  if (effectiveLow || !Number.isFinite(dt) || dt <= 0) return { x: 0, y: 0 };
  return { x: dt * speed, y: dt * speed * 0.6 };
}

/** Advances a stored offset by one frame, returning a new {x, y} in [0, 1). */
export function advanceWaterOffset(current, dt, { speed = WATER_FLOW_SPEED, low = false, tier } = {}) {
  const effectiveLow = low || tier === 'low';
  const step = waterOffsetStep(dt, { speed, low: effectiveLow });
  const x = ((current?.x ?? 0) + step.x) % 1;
  const y = ((current?.y ?? 0) + step.y) % 1;
  // Guard against -0 and tiny negatives from floating point.
  return { x: x < 0 ? x + 1 : x, y: y < 0 ? y + 1 : y };
}