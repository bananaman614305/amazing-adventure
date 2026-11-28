// Paved surface heights: the one place that answers "what is the surface under
// this point".
//
// The plaza is a radius-9 CircleGeometry disc raised to y = 0.010, the market
// lane floor is a 2 cm-high plane, the terrace is a 1.2 m slab with a ramp, and
// the rest is grass at y = 0. world.js previously placed every flat ground
// overlay (contact-shadow decals, moss patches, rainwater puddles) at one
// absolute height, which buried overlays that did not land on the plaza: nine
// contact decals under lane and terrace props were invisible, and puddles on the
// terrace sat 1.2 m under the stone.
//
// `surfaceHeightAt(x, z)` centralises that knowledge. Overlays place themselves
// at `surfaceHeightAt(x, z) + lift` (a lift above the local surface, not an
// absolute world height), so a future surface is added in one place and the
// walking height from floorHeightAt never drifts from the overlay height.
//
// Pure: no Three.js, no DOM, no Math.random, no clock reads. Every export is
// total -- it guards junk input, and no call can produce NaN or Infinity.

import { floorHeightAt, onTerrace, TERRACE } from './terrain.js';
import { LANE } from './areas.js';

/** Radius of the plaza disc, matching world.js CircleGeometry(9, 48). */
export const PLAZA_DISC_RADIUS = 9;

/** Height of the plaza disc surface, matching plaza.position.y in world.js. */
export const PLAZA_SURFACE_Y = 0.01;

/** Height of the lane floor, matching laneFloor.position.y in world.js. */
export const LANE_SURFACE_Y = 0.02;

/**
 * Largest overlay lift in metres. A lift above this is a typo, not a decal: the
 * three ground-overlay films sit at 2 mm (contact shadow), 3 mm (moss) and
 * 12 mm (puddle), so one metre is far past anything a flat translucent quad
 * should ever be raised.
 */
export const MAX_OVERLAY_LIFT = 1;

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Which paved surface covers a point: 'terrace', 'ramp', 'lane', 'plaza' or
 * 'grass'. Junk x/z reads as 'grass' (the surface everywhere else) and never
 * throws. The branch order matches surfaceHeightAt exactly, so the two can
 * never disagree about which surface wins.
 */
export function pavingKindAt(x, z) {
  if (!finiteNumber(x) || !finiteNumber(z)) return 'grass';
  // Terrace and ramp come first: both rectangles overlap the plaza disc, and
  // the slab is the real, visible surface there.
  if (x >= TERRACE.minX && x <= TERRACE.maxX &&
      z >= TERRACE.minZ && z <= TERRACE.maxZ) return 'terrace';
  if (x >= TERRACE.ramp.minX && x <= TERRACE.ramp.maxX &&
      z >= TERRACE.ramp.minZ && z <= TERRACE.ramp.maxZ) return 'ramp';
  if (x >= LANE.minX && x <= LANE.maxX &&
      z >= LANE.minZ && z <= LANE.maxZ) return 'lane';
  if (Math.hypot(x, z) <= PLAZA_DISC_RADIUS) return 'plaza';
  return 'grass';
}

/**
 * The paved surface height in metres under a point. Priority, first match wins,
 * inclusive bounds (matching floorHeightAt's own comparisons):
 *   terrace rectangle -> TERRACE.height (1.2);
 *   ramp rectangle    -> the linear ramp height from floorHeightAt (0 at the
 *                        plaza end, 1.2 at the terrace lip);
 *   lane rectangle    -> 0.02;
 *   inside the plaza disc (hypot <= 9) -> 0.01;
 *   else              -> 0 (grass).
 *
 * The terrace/ramp branch MUST come first because both rectangles overlap the
 * plaza disc and the slab is the real, visible surface there.
 *
 * The terrace and ramp heights come from floorHeightAt rather than re-deriving
 * the ramp maths, so the walking height and the overlay height can never drift
 * apart. The ramp deck's own box is 0.24 m thick and stands half above the
 * walked plane; no ground overlay currently lands on the ramp, so that half-metre
 * discrepancy is documented here rather than corrected.
 *
 * Junk x/z reads as height 0 (grass, the surface everywhere else) and never
 * throws.
 */
export function surfaceHeightAt(x, z) {
  if (!finiteNumber(x) || !finiteNumber(z)) return 0;
  if (x >= TERRACE.minX && x <= TERRACE.maxX &&
      z >= TERRACE.minZ && z <= TERRACE.maxZ) return floorHeightAt(x, z);
  if (x >= TERRACE.ramp.minX && x <= TERRACE.ramp.maxX &&
      z >= TERRACE.ramp.minZ && z <= TERRACE.ramp.maxZ) return floorHeightAt(x, z);
  if (x >= LANE.minX && x <= LANE.maxX &&
      z >= LANE.minZ && z <= LANE.maxZ) return LANE_SURFACE_Y;
  if (Math.hypot(x, z) <= PLAZA_DISC_RADIUS) return PLAZA_SURFACE_Y;
  return 0;
}

/**
 * The world height for a ground overlay: surfaceHeightAt(x, z) plus a clamped
 * lift.
 *
 * A finite lift clamps into [0, MAX_OVERLAY_LIFT]. A non-finite, negative or
 * non-number lift reads as 0.
 *
 * A caller placing a translucent decal must pass a positive lift (see the module
 * header): the three shipped lifts are 0.002 (contact shadow), 0.003 (moss) and
 * 0.012 (puddle), stacked so no two translucent layers share a height and
 * z-fight. A zero or junk lift is clamped to 0, which would z-fight, so the
 * caller's lift is the one thing this function cannot infer.
 */
export function overlayHeightAt(x, z, lift) {
  const surface = surfaceHeightAt(x, z);
  const clamped = finiteNumber(lift) ? Math.min(MAX_OVERLAY_LIFT, Math.max(0, lift)) : 0;
  return surface + clamped;
}