// Moonlight: the cool secondary DirectionalLight that lights the plaza at night.
//
// Pure module (no Three.js/DOM) so the fill-light numbers are unit-testable.

export const MOONLIGHT_COLOR = 0xc8d8ff;

export const MOONLIGHT_INTENSITY = Object.freeze({ day: 0, dusk: 0.05, night: 0.32 });

export function moonlightIntensity(phaseId) {
  const v = MOONLIGHT_INTENSITY[phaseId];
  return v ?? 0;
}

export const MOONLIGHT_DIRECTION = Object.freeze([-0.4, 0.7, 0.3]);

export function moonlightDirection() {
  const [x, y, z] = MOONLIGHT_DIRECTION;
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len };
}

export function moonlightColor(phaseId) {
  return MOONLIGHT_COLOR;
}

export const MOONLIGHT_SHADOW = true;

export function moonlightEnabled(phaseId) {
  return moonlightIntensity(phaseId) > 0;
}
