// Window and lamp glass: the last flat, unlit surfaces in the plaza.
//
// After round 73 dressed the fountain's water, the materials audit put two glass
// materials at the top of the remaining flat list: `HouseGlass` (4.63 m2 of flat
// #616c76, roughness 0.25) and `LampGlass` (4.50 m2 of flat #f9f1ce, roughness
// 0.15). Together they were a fifth of all the flat-coloured area the audit can
// still find, and glass is exactly the surface where a flat colour reads as
// plastic: a window should be dark and slightly reflective by day and warm from
// inside at night, and a lamp pane should glow when its own bulb is lit rather
// than stay the same cream at every hour.
//
// This module is the pure, testable half: it decides the numbers, and `world.js`
// applies them to the materials it owns. Nothing here imports Three.js, so a
// unit test can hold the whole day/night curve in place without a renderer.
//
// Why not a texture family? Every other dressed surface got maps because the map
// *is* the surface (flagstone, planks, felt nap). Glass at this scale is a
// *response*: a tint, a reflection and a light behind it. A 512 px roughness map
// across a 0.8 m pane would carry features finer than the pane itself and cost a
// fetch for something a per-phase value states exactly.

/**
 * The authored colour each glass material ships with, so a pane that never gets
 * dressed still has a sensible fallback and the audit can name what it replaced.
 */
export const GLASS_AUTHORED = {
  window: { color: 0x616c76, roughness: 0.25, metalness: 0.2 },
  lamp: { color: 0xf9f1ce, roughness: 0.15, metalness: 0 }
};

/** The warm tint a lit pane glows with. Kept apart from the diffuse tint so a
 * dark window can glow amber without its unlit side turning brown. */
export const GLASS_EMISSIVE = 0xffb45a;

/**
 * Per-phase glass response.
 *
 * `window*` drives `HouseGlass` (a window follows the hour; it has no bulb of
 * its own). `lamp*` drives `LampGlass` (a pane follows its own bulb as well, so
 * the lane post stays dark until its lamp is lit). Colours are the diffuse tint
 * a pane shows when the room behind it is unlit; the glow is separate.
 */
export const GLASS_LOOKS = {
  day: {
    windowColor: 0x2a3038, windowMetalness: 0.35, windowRoughness: 0.12, windowGlow: 0,
    lampColor: 0xf9f1ce, lampMetalness: 0.15, lampRoughness: 0.1, lampGlow: 0
  },
  dusk: {
    // A warm interior behind the windows at dusk is what makes a plaza read as
    // inhabited rather than vacated, so the glow leads the lamp intensity.
    windowColor: 0x3a2f22, windowMetalness: 0.35, windowRoughness: 0.12, windowGlow: 1.1,
    lampColor: 0xffe8b8, lampMetalness: 0.15, lampRoughness: 0.1, lampGlow: 1.4
  },
  night: {
    // Night is when the glow is the whole point: warm windows, hot panes over
    // the bulbs. Both are emissive, so they read through the fog at distance.
    windowColor: 0x4a3520, windowMetalness: 0.3, windowRoughness: 0.14, windowGlow: 2.2,
    lampColor: 0xffdf9e, lampMetalness: 0.15, lampRoughness: 0.1, lampGlow: 2.6
  }
};

/**
 * The look for a phase, falling back to day for an unknown id.
 *
 * Falling back rather than throwing matches `phaseExposure` and
 * `sunDiskIntensity`: a bad phase id should leave the glass in its daylight
 * state, not take the frame down.
 */
export function glassLook(phaseId) {
  return GLASS_LOOKS[phaseId] ?? GLASS_LOOKS.day;
}

/**
 * Which glass surface a material name belongs to, or null for anything else.
 *
 * `HouseGlass` is a window (follows the hour, no bulb); `LampGlass` is a lamp
 * pane (follows its own bulb too). Matching is exact rather than a substring
 * test: the shipped GLBs are the only authors of these names, and a loose
 * `/glass/` would also catch a future `Glassware` prop that belongs to no lamp.
 */
export function glassKindFor(materialName) {
  if (materialName === 'HouseGlass') return 'window';
  if (materialName === 'LampGlass') return 'lamp';
  return null;
}

/**
 * The complete material state for one pane.
 *
 * `laneLit` is the round-56 contract: the lane's lanterns are the player's to
 * light, so a lane pane must not glow over a dark bulb. Only lamp panes consult
 * it -- a window has no bulb in the game's model of the lane, so `laneLit` is
 * irrelevant to it and passing any value leaves it following the hour.
 *
 * `low` is the quality tier. The low tier turns the point lights off, so a full
 * night bloom would glow with nothing behind it and read as a bug; a small
 * constant glow keeps the fixture from going pitch black in a dark scene.
 * Emissive intensity itself is free (a material constant), so this is a
 * readability choice, not a cost one.
 */
export function glassStateFor(kind, phaseId, { laneLit = true, low = false } = {}) {
  const look = glassLook(phaseId);
  const isWindow = kind === 'window';
  const color = isWindow ? look.windowColor : look.lampColor;
  const metalness = isWindow ? look.windowMetalness : look.lampMetalness;
  const roughness = isWindow ? look.windowRoughness : look.lampRoughness;
  // A lamp pane only glows when its own bulb is lit; a window always follows the
  // hour. Zeroing rather than dimming keeps "dark" truthful.
  const lit = isWindow ? true : Boolean(laneLit);
  let glow = lit ? (isWindow ? look.windowGlow : look.lampGlow) : 0;
  if (low && glow > 0) glow = Math.min(glow, 0.6);
  return {
    color,
    metalness,
    roughness,
    emissive: GLASS_EMISSIVE,
    emissiveIntensity: glow
  };
}

/**
 * Whether a glass pane should cast a shadow.
 *
 * A lamp pane is a thin shell around a bulb; letting it cast would give every
 * lantern a hard quadrilateral shadow the bulb itself does not have and double
 * the shadow-caster count for no readable gain. Windows keep casting: the
 * modelled window frame is part of the house silhouette and its shadow is
 * honest.
 */
export function glassCastsShadow(kind) {
  return kind === 'window';
}