// The lane sacks' pinched neck/tie: the small dark cords that gather each sack
// shut (SackTie, ~9 meshes at ~0.02 m, 1.04 m2 total, authored dark cord).
// Round 87 dresses them by REUSING the existing CLOTH maps at a very small
// physical tile -- a knotted cord is tighter than woven sack cloth -- because
// even a 2 cm tie should read as cord rather than flat dark paint.
//
// This module is the pure, testable half: it names the family, its tile size
// and the material settings the dressed mesh must end up with, so the browser
// pass and the unit tests agree instead of each re-deriving a regex.
// It imports nothing, so a test can hold the rules in place without Three.js.
//
// Why keepTint is true: the reused cloth albedo is a neutral weave with no
// strong hue of its own (unlike the paper families in src/paper.js, whose
// albedo already carries the cream), so the authored dark cord colour must
// survive as the tint over the map.

/**
 * Metres per sack-tie tile.
 *
 * A 0.04 m tile shows roughly two tiles across a ~2 cm knotted cord, so the
 * cloth weave reads as tight cord rather than as a single smeared stripe. It
 * sits well below the rope's 0.08 m and the paper's 0.3 m, as a tie should.
 */
export const SACKTIE_TILE_METERS = 0.04;

/**
 * The lane sacks' tie family (Round 87).
 *
 * The exact-name test (case-insensitive) never catches a future `SackTie2` or
 * `NeckTie`; those get their own family or none at all.
 */
export const SACKTIE_FAMILY = {
  id: 'sacktie',
  test: /^sacktie$/i,
  tileMeters: SACKTIE_TILE_METERS,
  roughness: 0.95,
  metalness: 0,
  keepTint: true
};

/** The sack-tie families, in the shape the other dressers' arrays take. */
export const SACKTIE_FAMILIES = [SACKTIE_FAMILY];

/** The family an authored sack-tie material belongs to, or null when left alone. */
export function sackTieFamilyFor(materialName) {
  if (!materialName) return null;
  for (const family of SACKTIE_FAMILIES) {
    if (family.test.test(materialName)) return family;
  }
  return null;
}

/** The material settings a dressed sack-tie mesh must end up with. */
export function sackTieParams(family) {
  if (!family) return null;
  return {
    roughness: family.roughness,
    metalness: family.metalness,
    keepTint: family.keepTint === true
  };
}

/** Whether the sack-tie family's maps should be projected at all. */
export function shouldDressSackTie(family, textures) {
  if (!family || !textures) return false;
  return Boolean(textures.anyLoaded);
}
