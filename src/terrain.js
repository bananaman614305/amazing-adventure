// Pure terrain maths for the plaza. Kept free of Three.js so it can be
// unit-tested in Node; world.js re-exports these and builds the meshes.

export const WORLD_SIZE = 34;
export const HALF = WORLD_SIZE / 2;

// The north terrace: a raised stone gallery reached by a ramp from the plaza.
export const TERRACE = {
  minX: -6,
  maxX: 6,
  minZ: -16.5,
  maxZ: -13.2,
  height: 1.2,
  ramp: { minX: -1.9, maxX: 1.9, minZ: -13.2, maxZ: -8.6 }
};

// The tallest ledge a walking player can step up. This keeps the 1.2m terrace
// side from being climbable while still letting the ramp work.
export const STEP_HEIGHT = 0.45;

// Where Halden's key lies in the grass, and how close you must be to pick it up.
export const KEY_SPOT = { x: 7.2, z: 9.4 };
export const KEY_PICKUP_RANGE = 1.5;

// The bench on the west side. Resting there skips to the next phase.
export const BENCH = { x: -7, z: 12, range: 2.2 };

/** Ground height under a point: 0 on the grass, raised on terrace and ramp. */
export function floorHeightAt(x, z) {
  const onTerrace =
    x >= TERRACE.minX && x <= TERRACE.maxX &&
    z >= TERRACE.minZ && z <= TERRACE.maxZ;
  if (onTerrace) return TERRACE.height;

  const onRamp =
    x >= TERRACE.ramp.minX && x <= TERRACE.ramp.maxX &&
    z >= TERRACE.ramp.minZ && z <= TERRACE.ramp.maxZ;
  if (onRamp) {
    // 0 at the plaza end (maxZ), TERRACE.height at the terrace lip (minZ).
    const t = (TERRACE.ramp.maxZ - z) / (TERRACE.ramp.maxZ - TERRACE.ramp.minZ);
    return TERRACE.height * t;
  }
  return 0;
}

export function onTerrace(x, z) {
  return (
    x >= TERRACE.minX && x <= TERRACE.maxX &&
    z >= TERRACE.minZ && z <= TERRACE.maxZ
  );
}

/**
 * True when moving from `from` to `to` would climb more than STEP_HEIGHT, i.e.
 * the player is trying to walk up a wall rather than a ramp.
 */
export function climbsTooFar(from, to) {
  const fromY = floorHeightAt(from.x, from.z);
  const toY = floorHeightAt(to.x, to.z);
  return toY - fromY > STEP_HEIGHT;
}
