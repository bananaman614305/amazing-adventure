// The job board's paper surface: the plaza job board's face and its pinned
// slips. Round 83 dresses them with a procedural paper/parchment map, because a
// 1.2 x 0.9 m plane of pinned paper should read as paper, not flat cream.
//
// This module is the pure, testable half: it names the family, its tile size
// and the material settings the dressed mesh must end up with, so the browser
// pass in world.js and the unit tests agree instead of each re-deriving a
// regex. It imports nothing, so a test can hold the rules in place without
// Three.js.
//
// Why not PROP_FAMILIES (assets.js)? That table drives the plaza prop registry
// whose dresser builds a fresh white material -- fine for wood/brick/cloth, but
// the board face and slips are plain meshes that live outside the prop registry
// (they are added to the scene directly, not lanePropsGroup), so they need
// their own pass, the same split rounds 67 (coats) and 76 (skin) made. The
// paper albedo carries its own cream hue, so the tint is forced white.

/**
 * Metres per paper tile.
 *
 * A 0.3 m tile puts roughly four tiles across the 1.2 m board face, so the
 * fibre tooth reads as paper rather than as a single smeared sheet.
 */
export const CAST_PAPER_TILE_METERS = 0.3;

/**
 * The single job-board paper family.
 *
 * `keepTint` is false: the paper albedo is already cream, so the material tint
 * must stay white or the authored 0xd8c9a8 gets multiplied down to brown.
 */
export const BOARD_PAPER_FAMILIES = [
  {
    id: 'paper',
    // Exactly the two authored material names. A loose /paper/i would also
    // catch a future `PaperSlip` role material and the cast's `Paper` face;
    // the job board has exactly these two surfaces and this is their name
    // (src/world.js).
    test: /^(boardface|boardpaper)$/i,
    tileMeters: CAST_PAPER_TILE_METERS,
    roughness: 0.9,
    metalness: 0,
    keepTint: false
  }
];

/** The family an authored board material belongs to, or null when left alone. */
export function boardPaperFamilyFor(materialName) {
  if (!materialName) return null;
  for (const family of BOARD_PAPER_FAMILIES) {
    if (family.test.test(materialName)) return family;
  }
  return null;
}

/** The material settings a dressed board mesh must end up with. */
export function boardPaperParams(family) {
  if (!family) return null;
  return {
    roughness: family.roughness,
    metalness: family.metalness,
    keepTint: family.keepTint === true
  };
}

/** Whether a family's maps should be projected at all. */
export function shouldDressBoardPaper(family, textures) {
  if (!family || !textures) return false;
  return Boolean(textures.anyLoaded);
}
