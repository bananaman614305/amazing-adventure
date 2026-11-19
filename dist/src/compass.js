// A spoken compass, so a player who cannot see the world can still move through it.
//
// Round 13 made the game announce *what changed* -- quests, coins, areas. That is
// not enough: the world is still unnavigable, because walking is WASD against a
// canvas with no spatial feedback. This module supplies the missing sense: which
// way is that landmark, and how far.
//
// Everything here is pure and derived from real coordinates. The world's axes are
// fixed by the map: north is -Z (the north wall and the lane beyond it), east is
// +X (the market stalls), so south is +Z and west is -X. Getting that backwards
// would send a blind player the wrong way, so it is asserted in tests against the
// actual map data rather than assumed.

export const DIRECTIONS = [
  'north', 'north-east', 'east', 'south-east',
  'south', 'south-west', 'west', 'north-west'
];

/** The world bearing of a vector, in degrees clockwise from north. */
export function bearingDegrees(dx, dz) {
  // North is -Z, so negate z before taking the angle.
  const angle = Math.atan2(dx, -dz) * (180 / Math.PI);
  return (angle + 360) % 360;
}

/** The world compass direction of a vector, as one of eight names. */
export function compassBearing(dx, dz) {
  if (dx === 0 && dz === 0) return null;
  return DIRECTIONS[Math.round(bearingDegrees(dx, dz) / 45) % 8];
}

/** The bearing the player is facing, given their yaw. */
export function facingDegrees(yaw) {
  // Player forward is (-sin yaw, -cos yaw); north is -Z.
  return bearingDegrees(-Math.sin(yaw), -Math.cos(yaw));
}

/**
 * Where a target lies relative to the way the player is facing, as a phrase a
 * person would say out loud.
 */
export function relativeDirection(yaw, from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (dx === 0 && dz === 0) return 'right where you are';
  const target = bearingDegrees(dx, dz);
  // Signed shortest turn from the player's facing to the target.
  let delta = ((target - facingDegrees(yaw) + 540) % 360) - 180;
  const magnitude = Math.abs(delta);
  const side = delta >= 0 ? 'right' : 'left';
  if (magnitude <= 22.5) return 'straight ahead';
  if (magnitude <= 67.5) return `ahead and to your ${side}`;
  if (magnitude <= 112.5) return `to your ${side}`;
  if (magnitude <= 157.5) return `behind you and to your ${side}`;
  return 'behind you';
}

/** Capitalise the first letter so a phrase can start a sentence. */
export function sentenceCase(text) {
  if (!text) return text;
  return text[0].toUpperCase() + text.slice(1);
}

/** Distance in world units, rounded to something speakable. */
export function distanceTo(from, to) {
  return Math.hypot(to.x - from.x, to.z - from.z);
}

/** A plain distance phrase: near enough to use, or a rough walk. */
export function distancePhrase(distance) {
  if (distance < 2) return 'within reach';
  if (distance < 6) return 'a few steps away';
  if (distance < 14) return 'a short walk away';
  if (distance < 30) return 'across the plaza';
  return 'far off';
}

/**
 * One landmark described so it can be walked to: what it is, which way, how far,
 * and the world bearing, which does not change as the player turns.
 */
export function describeTarget(yaw, from, target) {
  const distance = distanceTo(from, target);
  return {
    id: target.id,
    label: target.label,
    distance,
    bearing: compassBearing(target.x - from.x, target.z - from.z),
    relative: relativeDirection(yaw, from, target),
    phrase: sentenceCase(`${target.label} is ${relativeDirection(yaw, from, target)}, ${distancePhrase(distance)}, ${compassBearing(target.x - from.x, target.z - from.z)} of you.`)
  };
}

/**
 * Everything walkable, nearest first. `targets` come from the caller so this
 * module never guesses at world contents; it only describes what it is given.
 * Targets the player is standing inside are dropped rather than reported as
 * "within reach" of nothing useful.
 */
export function nearbyTargets(yaw, from, targets, limit = 5) {
  return targets
    .map((target) => describeTarget(yaw, from, target))
    .filter((entry) => entry.distance > 0.4)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

/**
 * A route hint: which single landmark to head for next, given where the player is
 * trying to go. Returns null when the destination is already close.
 */
export function routeHint(yaw, from, destination) {
  if (!destination) return null;
  const distance = distanceTo(from, destination);
  if (distance < 2) return null;
  const relative = relativeDirection(yaw, from, destination);
  const bearing = compassBearing(destination.x - from.x, destination.z - from.z);
  return sentenceCase(`${destination.label} is ${relative}, ${distancePhrase(distance)}, ${bearing} of you.`);
}
