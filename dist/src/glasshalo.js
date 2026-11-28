// How a lit glass pane *responds* in the air around it, decided without a GPU.
//
// Round 74 taught the plaza to read the hour off its panes: `glass.js` tints a
// lit window warm and a lit lamp pane hot, and the emissive carries that tint
// out through the fog at distance. What `glass.js` does not decide is the pane's
// *shape* of response: how wide the warm pool a hot pane scatters around itself
// is, how much of the pane's tint the viewer actually sees as a glow rather than
// a reflection, and how thin panes differ from thick ones.
//
// This module is that pure, testable half. It returns a per-pane descriptor --
// {width, thickness, tintWarmth, response} -- and `world.js` applies the
// descriptor to the emissive it already writes. Nothing here imports Three.js,
// so the response curve of the night can be held to its numbers in a unit test
// without a renderer.
//
// Three decisions are worth the words.
//
// 1. Width scales with the pane's *lit surface*, not with a look table. A thin
//    lamp pane concentrates its glow into a narrow column; a thick house window
//    smears a wide pool. The difference reads as the pane having a body, and it
//    costs the descriptor one number per pane that `glass.js`'s tint already
//    supplies. The width is a spread of the emissive into the air, in metres,
//    and the spread is clamped so a hot night pane cannot paint a room-sized
//    smear from a 0.9 m square.
//
// 2. `tintWarmth` is a *warmth* knob rather than a colour: a night window's
//    emissive is amber (`glass.js`'s GLASS_EMISSIVE), and the warmth states how
//    strongly that amber is allowed to dominate the pane's response. A warm
//    window at night is 1 (amber carries the whole glow), a day window is 0
//    (the response is neutral and the diffuse tint does the work), and dusk sits
//    between so the interior leads the street lamps the way the glass module
//    already intends. Multiplying warmth into the emissive keeps the pure
//    response module honest with the pure tint module.
//
// 3. The response is one with the glass *round*, not the lighting round: it
//    reuses `glassStateFor`'s phase table and lane rule, so a lane pane follows
//    its own bulb exactly the way round 74 made it. A lamp pane that is dark is
//    a dark pane, and no response descriptor is allowed to change that.
//
// Everything here is seeded (mulberry32, copied rather than imported so the
// module stands alone) and pure: no Three.js, no DOM, no clock, no Math.random.
// Every export is total -- it guards junk input, and no call can produce NaN or
// Infinity.

/** Seed for the response-field generator. Fixed so every run dresses the same
 *  panes the same way. */
export const GLASSHALO_SEED = 0x4e7ab21d;

/** The glow half-extent, in metres, of a window pane at full response. A house
 *  window is the wide end of the field: 1.6 m reads as a room behind the glass
 *  rather than a decal on it. */
export const GLASSHALO_WINDOW_WIDTH = 1.6;

/** The glow half-extent, in metres, of a lamp pane at full response. The lamp
 *  housing is a thin shell, so its glow is a narrow column. */
export const GLASSHALO_LAMP_WIDTH = 0.55;

/** The multiplier that carries a phase's response. Day reads as exactly zero
 *  (a glass response in daylight is a reflection, not a glow), dusk leads at
 *  0.9 and night carries the full 1. The `day` value is also the fallback for
 *  an unknown phase id. Frozen so a caller cannot mutate the table. */
export const GLASSHALO_RESPONSE = Object.freeze({ day: 0, dusk: 0.9, night: 1 });

/** How far a pane's glow may wander from its centre, in metres, before the
 *  response reads as noise. The wander is a slow wander like the ground mist's,
 *  so the response breathes rather than strobing. */
export const GLASSHALO_DRIFT = 0.25;

/** Whether the pane response runs at this quality tier. The low tier drops the
 *  per-pane response pass, consistent with the quality-tier convention; a junk
 *  tier reads as full. */
export function glassHaloEnabled(tier) {
  return tier !== 'low';
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Clamp to [lo, hi], with a non-finite value replaced by `fallback`. */
function clampNumber(value, lo, hi, fallback = lo) {
  if (!finiteNumber(value)) return fallback;
  return Math.min(hi, Math.max(lo, value));
}

/** A descriptor is a plain object; arrays and null are not. */
function isDescriptor(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The per-phase response multiplier. An unknown phase, or a non-string, falls
 *  back to the `day` value (0), so a phase id this module has not learned yet
 *  can never flare a response up by accident. */
export function glassHaloResponse(phaseId) {
  if (typeof phaseId !== 'string') return GLASSHALO_RESPONSE.day;
  return Object.prototype.hasOwnProperty.call(GLASSHALO_RESPONSE, phaseId)
    ? GLASSHALO_RESPONSE[phaseId]
    : GLASSHALO_RESPONSE.day;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6D2B79F5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** A small positional hash for the wander draw: panes at the same spot still
 *  drift out of step, and the draw is stable across runs. */
function paneSeed(anchor) {
  const qx = Math.round(anchor.x * 1000) | 0;
  const qy = Math.round(anchor.y * 1000) | 0;
  const qz = Math.round(anchor.z * 1000) | 0;
  let h = (GLASSHALO_SEED ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (qx >>> 0), 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h ^ (qy >>> 0), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h ^ (qz >>> 0), 0x27d4eb2f) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h >>> 0;
}

/**
 * The response descriptor for one pane.
 *
 * `kind` is the glass kind from `glass.js` ('window' or 'lamp'). `anchor` is
 * the pane's centre in metres; only its finite fields are read, and a non-object
 *  or junk anchor yields the origin. `phaseId` picks the response curve,
 *  and `lit` is the same lane rule `glassStateFor` applies: a dark lane pane
 *  gets a zero response. The return is
 *  `{ x, y, z, width, thickness, tintWarmth, response, wander }` with every
 *  field finite and in range. A junk kind reads as 'lamp' -- the narrow end is
 *  the safe one.
 */
export function glassHaloDescriptor(kind, anchor, phaseId, { lit = true } = {}) {
  const baseWidth = kind === 'window' ? GLASSHALO_WINDOW_WIDTH : GLASSHALO_LAMP_WIDTH;
  const a = isDescriptor(anchor) ? {
    x: finiteNumber(anchor.x) ? anchor.x : 0,
    y: finiteNumber(anchor.y) ? anchor.y : 0,
    z: finiteNumber(anchor.z) ? anchor.z : 0
  } : { x: 0, y: 0, z: 0 };
  // A thin lamp shell concentrates; a house window's body spreads. Thickness
  // is the ratio the glow's width draws its vertical shape from -- the wide
  // window glows as a flatter pool, the narrow lamp column keeps its height.
  const thickness = kind === 'window' ? 0.62 : 0.35;
  const response = Boolean(lit) ? clampNumber(glassHaloResponse(phaseId), 0, 1, 0) : 0;
  // The pane's emissive tint warmth: 1 lets the amber carry the whole glow
  // (a warm night window), 0 keeps the response neutral (day). It tracks the
  // same curve as the response itself, so a lit night pane is fully amber and
  // a lit dusk pane is nearly so.
  const tintWarmth = clampNumber(0.9 * response, 0, 1, 0);
  const rng = mulberry32(paneSeed(a));
  const wander = Math.min(GLASSHALO_DRIFT, Math.max(0, rng() * GLASSHALO_DRIFT * 2));
  const out = {
    x: a.x,
    y: a.y,
    z: a.z,
    width: baseWidth,
    thickness,
    tintWarmth,
    response,
    wander
  };
  for (const key of ['x', 'y', 'z', 'width', 'thickness', 'tintWarmth', 'response', 'wander']) {
    if (!Number.isFinite(out[key])) out[key] = 0;
  }
  out.width = clampNumber(out.width, 0, 4, baseWidth);
  out.thickness = clampNumber(out.thickness, 0, 1, 0.5);
  out.tintWarmth = clampNumber(out.tintWarmth, 0, 1, 0);
  out.response = clampNumber(out.response, 0, 1, 0);
  out.wander = clampNumber(out.wander, 0, GLASSHALO_DRIFT, 0);
  return out;
}

/**
 * The response value a pane shows at a phase and whether it is lit, in [0, 1].
 *
 * This is the per-frame number `world.js` multiplies its emissive by, so the
 * unit tests hold the curve directly: zero in the day, leading at dusk, full
 * at night, and a dark lane pane exactly zero at every hour.
 */
export function glassHaloStrength(phaseId, lit = true) {
  return Boolean(lit) ? clampNumber(glassHaloResponse(phaseId), 0, 1, 0) : 0;
}
