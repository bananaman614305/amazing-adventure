// The moon: a separate night-sky disc from the sun disc.
//
// Why a separate module. The sun disc still carries the dim night anchor that
// the graphics test pins (sunDiskIntensity('night') === 0.16), so it cannot be
// repurposed into a bright moon without breaking that contract. The moon is
// therefore its own authored point and its own visibility table: full at night,
// a hint at dusk, gone in daylight. Keeping it pure (no Three.js, no DOM) lets
// the position and phase math be unit-tested the same way sunDiscPosition and
// the star field are.
//
// moonVisibility('night') is 1 and moonVisibility('day') is 0 by design: the
// moon only reads as a moon once the sun has set, and never competes with it.

/** Distance the moon sits from the origin, on the dome. */
export const MOON_DISTANCE = 96;

/** Angular size of the bright core and of the soft glow around it. */
export const MOON_CORE_RADIUS = 4;
export const MOON_GLOW_RADIUS = 12;

/** Cool white, slightly blue so it reads as moonlight rather than sunlight. */
export const MOON_COLOR = 0xd8e4ff;

/** Per-phase visibility (0..1) for the moon disc. Day is dark, dusk hints,
 *  night is full. Unknown phases fall back to 0 so a bad id never leaves a
 *  moon blazing at noon. */
export const MOON_PHASE_VISIBILITY = Object.freeze({
  day: 0,
  dusk: 0.3,
  night: 1
});

export function moonVisibility(phaseId) {
  const v = MOON_PHASE_VISIBILITY[phaseId];
  return v ?? 0;
}

/** Authored point around the origin the moon is pushed out from. */
export const MOON_POSITION = Object.freeze([-18, 22, 6]);

/** Base opacity multiplier for the moon's glow halo. */
export const MOON_GLOW_OPACITY = 0.18;

/**
 * Where the moon disc's centre belongs: the authored point pushed out onto the
 * dome at MOON_DISTANCE. Mirrors sunDiscPosition in src/graphics.js so the
 * visible moon agrees with its declared direction. Guarded against a zero
 * vector so a degenerate input never produces NaN.
 */
export function moonDiscPosition(position, distance = MOON_DISTANCE) {
  const [x, y, z] = position;
  const len = Math.hypot(x, y, z) || 1;
  return {
    x: (x / len) * distance,
    y: (y / len) * distance,
    z: (z / len) * distance
  };
}
