// Areas and the north gate: the pure half of "more than one connected place".
//
// The plaza is the original courtyard. The market lane is a corridor north of
// it, reached through a gate in the north wall. Whether that gate is open is
// derived from quest state, so it needs no extra save field: returning
// Halden's key unlocks the lane and the door is open on every later load.

import { questStatus } from './state.js';

export const PLAZA = { id: 'plaza', name: 'The Plaza', minX: -17, maxX: 17, minZ: -17.5, maxZ: 17 };
export const LANE = { id: 'lane', name: 'The Market Lane', minX: 6, maxX: 14, minZ: -26, maxZ: -17.5 };

// The gate sits in the north wall at x = 9.5, spanning x 8..11.
export const GATE = {
  x: 9.5,
  z: -17,
  minX: 8,
  maxX: 11,
  width: 3,
  // How close the player must be for the gate to be usable.
  range: 2.6
};

export const AREAS = [PLAZA, LANE];

/**
 * The gate opens once Halden has his key back. That is the same fact that
 * warms the Watch, so the unlock reads as a consequence of the story rather
 * than an arbitrary switch.
 */
export function isGateOpen(state) {
  return questStatus(state, 'key') === 'done';
}

/** Why the gate is shut, for the hint line. */
export function gateHint(state) {
  if (isGateOpen(state)) return 'pass through the north gate';
  return 'the north gate is locked. Halden keeps the key.';
}

/** Which area a point is in, or null when it is outside every area. */
export function areaAt(x, z) {
  for (const area of AREAS) {
    if (x >= area.minX && x <= area.maxX && z >= area.minZ && z <= area.maxZ) return area.id;
  }
  return null;
}

/** True when a point is inside the gate opening in the north wall. */
export function insideGate(x, z) {
  return x >= GATE.minX && x <= GATE.maxX && z >= PLAZA.minZ - 0.6 && z <= PLAZA.maxZ;
}

/**
 * The wall segments either side of the gate opening. The gate itself is a
 * separate, toggleable collider, which is why the wall is split in two.
 */
export const NORTH_WALL_SEGMENTS = [
  { minX: -17, maxX: GATE.minX },
  { minX: GATE.maxX, maxX: 17 }
];

/** Props inside the lane, positioned so the corridor is not an empty tube. */
export const LANE_PROPS = [
  { kind: 'stall', x: 7.4, z: -21.5, width: 1.2, depth: 3.2, height: 1.0 },
  { kind: 'crate', x: 12.6, z: -19.6, width: 1.1, depth: 1.1, height: 1.1 },
  { kind: 'crate', x: 12.6, z: -21.0, width: 1.1, depth: 1.1, height: 1.1 },
  { kind: 'barrel', x: 6.9, z: -24.4, width: 1.0, depth: 1.0, height: 1.2 },
  { kind: 'post', x: 13.4, z: -24.8, width: 0.4, depth: 0.4, height: 3.0 }
];

/** The notice board in the lane that the player can read. */
export const NOTICE_BOARD = { x: 13.3, z: -23.2, range: 1.9, height: 1.9 };

/**
 * A short read for the notice board. Its text reflects faction standing, so the
 * new area is not just scenery: it reports on the systems built last round.
 */
export function noticeText(state, standing) {
  if (standing === 'hostile') return 'A watch notice: “Certain visitors are to be escorted.” Your name is underlined twice.';
  if (standing === 'cold') return 'A watch notice: “The gate closes at dusk.” Someone has added, in pencil, “Ask first.”';
  if (standing === 'trusted') return 'A watch notice: “The gate stays open for friends of the Watch.” Someone has written your name in the margin.';
  if (questStatus(state, 'toll') === 'waived') return 'A trader’s notice: “Toll waived by the Watch. Thank you.” It is unsigned, and looks freshly pinned.';
  if (questStatus(state, 'toll') === 'collected') return 'A watch notice: “Market toll collected in full.” Someone has drawn a small, unflattering face beside it.';
  return 'A trader’s notice: “Stalls open at dawn. No credit. Ask Oswin if you disagree.”';
}
