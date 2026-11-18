// Touch controls: the pure maths behind the phone layout. No DOM and no
// Three.js, so the joystick and look-drag behaviour can be unit-tested in Node
// while the UI in index.html only supplies raw pointer positions.

// How far (in CSS pixels) the thumb must travel for full speed.
export const STICK_RADIUS = 56;
// Ignore tiny wobbles so a resting thumb does not creep forward.
export const STICK_DEADZONE = 0.16;
// Radians of turn per CSS pixel of right-thumb drag.
export const LOOK_SENSITIVITY = 0.0052;
// Mouse-style pointer lock uses a different scale; dragging a thumb across the
// whole screen should be a comfortable turn, not a spin.
export const MAX_PITCH = Math.PI / 2 - 0.05;

/**
 * Converts a joystick offset into movement intent.
 * dx/dy are measured from the stick centre, in CSS pixels, y pointing down.
 * Returns { forward, strafe, magnitude } where forward is +1 pushing up
 * (towards the screen top) and magnitude is 0..1 after the deadzone.
 */
export function stickVector(dx, dy, { radius = STICK_RADIUS, deadzone = STICK_DEADZONE } = {}) {
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance === 0 || radius <= 0) {
    return { forward: 0, strafe: 0, magnitude: 0 };
  }
  const clamped = Math.min(distance, radius);
  const magnitude = clamped / radius;
  if (magnitude <= deadzone) return { forward: 0, strafe: 0, magnitude: 0 };
  // Rescale so the deadzone edge is 0 and the rim is 1, keeping full speed
  // reachable without pushing past the base.
  const scaled = (magnitude - deadzone) / (1 - deadzone);
  const nx = dx / distance;
  const ny = dy / distance;
  return {
    forward: -ny * scaled,
    strafe: nx * scaled,
    magnitude: scaled
  };
}

/** The knob position to draw for a raw offset, clamped inside the base. */
export function knobOffset(dx, dy, radius = STICK_RADIUS) {
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance === 0) return { x: 0, y: 0 };
  if (distance <= radius) return { x: dx, y: dy };
  return { x: (dx / distance) * radius, y: (dy / distance) * radius };
}

/**
 * Converts a look-drag delta into yaw/pitch changes.
 * Dragging right turns the view right, dragging down looks down, matching a
 * touch pad rather than an inverted mouse.
 */
export function lookDelta(dx, dy, sensitivity = LOOK_SENSITIVITY) {
  // `|| 0` turns -0 into 0 so callers and tests compare cleanly.
  return {
    yaw: -dx * sensitivity || 0,
    pitch: -dy * sensitivity || 0
  };
}

/** Clamps pitch the same way the mouse path does, so both feel alike. */
export function clampPitch(pitch, limit = MAX_PITCH) {
  if (!Number.isFinite(pitch)) return 0;
  return Math.max(-limit, Math.min(limit, pitch));
}

/**
 * Decides whether to show the touch controls. Phones and tablets report a
 * coarse pointer and touch points; a laptop with a touchscreen still reports a
 * fine pointer and should keep mouse and keyboard.
 */
export function wantsTouchControls({ maxTouchPoints = 0, coarsePointer = false, touchOnly = false } = {}) {
  if (touchOnly) return true;
  return maxTouchPoints > 0 && coarsePointer;
}

/** Short label for the interact button, so it never says "E" on a phone. */
export function interactLabel(kind) {
  switch (kind) {
    case 'npc': return 'Talk';
    case 'key': return 'Pick up';
    case 'ledger': return 'Take';
    case 'bench': return 'Rest';
    case 'gate': return 'Gate';
    case 'notice': return 'Read';
    default: return 'Use';
  }
}
