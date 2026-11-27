// Kerb and plinth dimensions for the paving, decided without a GPU.
//
// The plaza disc and the lane rectangle sit a centimetre or two above the
// grass plane, with nothing filling the step at their edges, so from the ground
// the rim reads as a thin floating line rather than as paving laid on a bed.
// This module decides how thick and how tall the stone kerb around the plaza
// and the plinth edge around the lane are, and nothing else: no Three.js, no
// DOM, no clock, no randomness. `world.js` turns each descriptor into the
// matching mesh, and the same numbers drive the unit tests so a typo in a
// radius cannot ship silently.
//
// Two decisions worth the words.
//
// 1. The plaza kerb is a torus (a rounded tube) rather than a flat ring. A
//    flat `RingGeometry` annulus is a zero-thickness sheet: viewed from above
//    it is a line, and from the side it vanishes, so it adds the side face
//    without adding any top. A tube with a small radius (6 cm) reads as a
//    chamfered stone kerb from both angles, and a single `TorusGeometry` costs
//    one draw call and no extra instances.
//
// 2. The lane plinth is a low box band, not a torus, because the lane is a
//    rectangle and a torus cannot follow a straight edge without faceting. Four
//    thin boxes (one per side, mitred at the corners by overlap) read as a
//    continuous plinth and stay cheap. The height (4 cm) matches the plaza
//    kerb's tube radius so the two read as one family of stone.
//
// Every export is total: junk input is clamped, and no call yields NaN or
// Infinity. The enabled flags follow the quality-tier convention (dropped on
// `low`), with junk reading as the full tier.
/** Seed-less constants: the kerb and plinth are fixed geometry, not generated. */

/** Radius of the plaza disc's outer edge, in metres. Matches the
 *  `CircleGeometry(9, 48)` in `world.js`. */
export const PLAZA_RADIUS = 9;

/** Tube radius of the plaza kerb torus, in metres. Small enough to read as a
 *  chamfered edge, large enough to cast a shadow of its own. */
export const PLAZA_KERB_TUBE = 0.06;

/** Major radius of the plaza kerb torus, in metres: the disc edge plus half the
 *  tube, so the tube's outer face sits just past the paving. */
export const PLAZA_KERB_MAJOR = PLAZA_RADIUS + PLAZA_KERB_TUBE / 2;

/** Segment count around the plaza kerb torus. 48 matches the disc's 48-gon so
 *  the kerb facets line up with the paving facets rather than fighting them. */
export const PLAZA_KERB_SEGMENTS = 48;

/** Tube segment count. 8 is enough for a rounded profile at courtyard distance
 *  and keeps the polygon count low. */
export const PLAZA_KERB_TUBE_SEGMENTS = 8;

/** Height of the lane plinth band, in metres. Matches the plaza kerb's tube
 *  radius so the two read as one family. */
export const LANE_PLINTH_HEIGHT = 0.04;

/** Width (thickness) of the lane plinth band, in metres. Thin enough to read
 *  as an edge, thick enough to cast a shadow. */
export const LANE_PLINTH_WIDTH = 0.12;

/** Whether the kerb ring runs at this quality tier. Dropped on `low`, consistent
 *  with the convention: it is an extra mesh and a shadow caster. Junk reads as
 *  the full tier. */
export function kerbEnabled(tier) {
  return tier !== 'low';
}

/** Whether the lane plinth runs at this quality tier. Same rule as the kerb. */
export function plinthEnabled(tier) {
  return tier !== 'low';
}

/** A finite, positive number, or `fallback`. */
function finiteNumber(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Clamp a number to [lo, hi], non-finite -> fallback. */
function clampNumber(value, lo, hi, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(hi, Math.max(lo, value));
}

/** The plaza kerb's dimensions as a plain descriptor, clamped and finite. Useful
 *  for callers and tests that want the numbers without Three.js. Returns
 *  `{ majorRadius, tubeRadius, segments, tubeSegments, y }`. `y` is the tube
 *  centre height: half the tube radius, so the kerb sits on the grass plane and
 *  rises to the paving edge. */
export function plazaKerbSpec(overrides = {}) {
  const o = overrides !== null && typeof overrides === 'object' && !Array.isArray(overrides)
    ? overrides : {};
  const tube = clampNumber(finiteNumber(o.tube, PLAZA_KERB_TUBE), 0.004, 1, PLAZA_KERB_TUBE);
  const major = clampNumber(finiteNumber(o.major, PLAZA_KERB_MAJOR), tube, 100, PLAZA_KERB_MAJOR);
  const segs = clampNumber(finiteNumber(o.segments, PLAZA_KERB_SEGMENTS), 8, 128, PLAZA_KERB_SEGMENTS);
  const tubeSegs = clampNumber(finiteNumber(o.tubeSegments, PLAZA_KERB_TUBE_SEGMENTS), 4, 16, PLAZA_KERB_TUBE_SEGMENTS);
  return {
    majorRadius: major,
    tubeRadius: tube,
    segments: Math.round(segs),
    tubeSegments: Math.round(tubeSegs),
    y: tube / 2
  };
}

/** The lane plinth's dimensions as a plain descriptor. Returns
 *  `{ height, width }`, both clamped to sane minima. */
export function lanePlinthSpec(overrides = {}) {
  const o = overrides !== null && typeof overrides === 'object' && !Array.isArray(overrides)
    ? overrides : {};
  return {
    height: clampNumber(finiteNumber(o.height, LANE_PLINTH_HEIGHT), 0.004, 1, LANE_PLINTH_HEIGHT),
    width: clampNumber(finiteNumber(o.width, LANE_PLINTH_WIDTH), 0.004, 1, LANE_PLINTH_WIDTH)
  };
}
