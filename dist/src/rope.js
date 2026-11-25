// The lane bunting's rope strand: the thin 2 cm box that spans the lane
// (LaneRope, 3 meshes, 1.92 m2, authored brown 0x6b5236). Round 86 dresses it
// with a procedural twisted-fibre rope map, because even a 2 cm rope should
// read as laid fibre rather than flat brown plastic.
//
// This module is the pure, testable half: it names the family, its tile size
// and the material settings the dressed mesh must end up with, so the browser
// pass and the unit tests agree instead of each re-deriving a regex.
// It imports nothing, so a test can hold the rules in place without Three.js.
//
// Why keepTint is true: the rope albedo carries no strong hue of its own, so
// the authored 0x6b5236 brown must survive as the tint over the map -- the
// opposite of the paper families in src/paper.js, whose albedo already has
// the hue and therefore forces a white tint.

/**
 * Metres per rope tile.
 *
 * A 0.08 m tile puts roughly two and a half tiles across the 2 cm rope's
 * width (and many along its 20+ m spans), so the twist reads as lay fibres
 * rather than as one smeared stripe. It sits inside the audited 0.05-0.1 m
 * band for a strand this thin.
 */
export const ROPE_TILE_METERS = 0.08;

/**
 * The lane bunting's rope family (Round 86).
 *
 * The exact-name test (case-insensitive) never catches a future `RopeTie`
 * or `LaneRope2`; those get their own family or none at all.
 */
export const ROPE_FAMILY = {
  id: 'rope',
  test: /^lanerope$/i,
  tileMeters: ROPE_TILE_METERS,
  roughness: 0.9,
  metalness: 0,
  keepTint: true
};

/** The rope families, in the shape the other dressers' arrays take. */
export const ROPE_FAMILIES = [ROPE_FAMILY];

/** The family an authored rope material belongs to, or null when left alone. */
export function ropeFamilyFor(materialName) {
  if (!materialName) return null;
  for (const family of ROPE_FAMILIES) {
    if (family.test.test(materialName)) return family;
  }
  return null;
}

/** The material settings a dressed rope mesh must end up with. */
export function ropeParams(family) {
  if (!family) return null;
  return {
    roughness: family.roughness,
    metalness: family.metalness,
    keepTint: family.keepTint === true
  };
}

/** Whether the rope family's maps should be projected at all. */
export function shouldDressRope(family, textures) {
  if (!family || !textures) return false;
  return Boolean(textures.anyLoaded);
}
