// The job board's paper surface: the plaza job board's face and its pinned
// slips. Round 83 dresses them with a procedural paper/parchment map, because a
// 1.2 x 0.9 m plane of pinned paper should read as paper, not flat cream.
// Round 84 extends the same family to the cast's own paper props -- Oswin's
// apron and Wren's ledger pages -- with the same map, the same white tint and
// a tile at paper scale.
//
// This module is the pure, testable half: it names the families, their tile
// sizes and the material settings the dressed mesh must end up with, so the
// browser passes and the unit tests agree instead of each re-deriving a regex.
// It imports nothing, so a test can hold the rules in place without Three.js.
//
// Why not PROP_FAMILIES (assets.js)? That table drives the plaza prop registry
// whose dresser builds a fresh white material -- fine for wood/brick/cloth,
// but the board face, the slips and the cast's paper props are plain meshes
// that live outside the prop registry, so they need their own passes, the same
// split rounds 67 (coats), 76 (skin) and 82 (boots) made. The paper albedo
// carries its own cream hue, so the tint is forced white.

/**
 * Metres per paper tile.
 *
 * A 0.3 m tile puts roughly four tiles across the 1.2 m board face, so the
 * fibre tooth reads as paper rather than as a single smeared sheet. The same
 * tile serves the cast's paper: an apron is a 0.3 x 0.5 m strip and a ledger
 * page about 0.2 x 0.15 m, so at this size both show at least one full tile.
 */
export const CAST_PAPER_TILE_METERS = 0.3;

/**
 * The job-board paper family (Round 83).
 *
 * `keepTint` is false: the paper albedo is already cream, so the material tint
 * must stay white or the authored 0xd8c9a8 gets multiplied down to brown.
 */
export const BOARD_PAPER_FAMILIES = [
  {
    id: 'paper',
    // Exactly the two authored material names. A loose /paper/i would also
    // catch a future `PaperSlip` role material; the job board has exactly
    // these two surfaces and these are their names (src/world.js).
    test: /^(boardface|boardpaper)$/i,
    tileMeters: CAST_PAPER_TILE_METERS,
    roughness: 0.9,
    metalness: 0,
    keepTint: false
  }
];

/**
 * The cast's paper props family (Round 84).
 *
 * The GLB author named Oswin's apron and Wren's ledger pages `Paper` -- the
 * same word as the job board, but a different surface scale, so it gets its
 * own family rather than sharing the board's regex. The exact-name test keeps
 * it from catching a future `PaperNote` or the board itself.
 */
export const CAST_PAPER_FAMILIES = [
  {
    id: 'castPaper',
    test: /^paper$/i,
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

/** The family an authored cast material belongs to, or null when left alone. */
export function castPaperFamilyFor(materialName) {
  if (!materialName) return null;
  for (const family of CAST_PAPER_FAMILIES) {
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

/** The material settings a dressed cast mesh must end up with. */
export function castPaperParams(family) {
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

/** Whether the cast family's maps should be projected at all. */
export function shouldDressCastPaper(family, textures) {
  if (!family || !textures) return false;
  return Boolean(textures.anyLoaded);
}
