// The lane lamp's lantern housing: the small metal body (LanternHousing,
// 1.32 m2 across several meshes) of the lane lamp. Round 87 dresses it by
// reusing the existing LAMP texture maps at a smaller physical tile than the
// lamp post (which uses LAMP_TEXTURE_FILES in src/assets.js), because a 0.24 m
// housing would smear three chips of paint across the whole thing at the lamp
// post's tile.
//
// This module is the pure, testable half: it names the family, its tile size
// and the material settings the dressed mesh must end up with, so the browser
// pass and the unit tests agree instead of each re-deriving a regex.
// It imports nothing, so a test can hold the rules in place without Three.js.
//
// Why keepTint is false: the lamp albedo already carries the paint colour, so
// the material tint must stay white or the authored colour gets multiplied down.
// Metal housing: moderate roughness, some metalness.

/**
 * Metres per housing tile.
 *
 * A 0.25 m tile puts roughly one tile across a 0.24 m housing face, so the
 * metal grain reads as housing rather than as a single smeared chip.
 */
export const HOUSING_TILE_METERS = 0.25;

/**
 * The lane lamp's lantern housing family (Round 87).
 *
 * The exact-name test (case-insensitive) never catches a future
 * `LanternHousing2` or `Housing`; those get their own family or none at all.
 */
export const HOUSING_FAMILY = {
  id: 'housing',
  test: /^lanternhousing$/i,
  tileMeters: HOUSING_TILE_METERS,
  roughness: 0.55,
  metalness: 0.35,
  keepTint: false
};

/** The housing families, in the shape the other dressers' arrays take. */
export const HOUSING_FAMILIES = [HOUSING_FAMILY];

/** The family an authored housing material belongs to, or null when left alone. */
export function housingFamilyFor(materialName) {
  if (!materialName) return null;
  for (const family of HOUSING_FAMILIES) {
    if (family.test.test(materialName)) return family;
  }
  return null;
}

/** The material settings a dressed housing mesh must end up with. */
export function housingParams(family) {
  if (!family) return null;
  return {
    roughness: family.roughness,
    metalness: family.metalness,
    keepTint: family.keepTint === true
  };
}

/** Whether the housing family's maps should be projected at all. */
export function shouldDressHousing(family, textures) {
  if (!family) return false;
  return Boolean(textures?.anyLoaded);
}
