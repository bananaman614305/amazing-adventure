// The cast's carried timber: mara's lantern pole, pip's hoop, halden's spear
// shaft and wren's ledger board. Round 72 dresses the flat `WoodP` material on
// four carried props with the crate/barrel plank maps, so the one timber surface
// a player holds at Talk distance reads as wood grain rather than as 0.88 m2 of
// flat warm brown.
//
// Why a separate pure module? The same reason as src/skin.js, src/accent.js,
// src/boot.js, src/paper.js and src/steel.js: the browser pass in npcs.js and
// the unit tests must agree on the rules instead of each re-deriving a regex,
// and the module imports nothing so a test can hold the rules in place without
// Three.js.
//
// Why not PROP_FAMILIES (assets.js)? That table drives the plaza prop registry,
// whose dresser assumes every match is a prop mesh with a fresh white material
// and a fresh tile projection. The cast must keep its per-rig materials, so it
// has its own pass -- the same split rounds 67 (coats), 76 (skin/hair), 81
// (accent), 82 (boots) and 110 (steel) made. The wood family in PROP_FAMILIES
// also matches `Wood`/`Timber`, never `WoodP`, so the carried props stayed flat
// until now.
//
// Why reuse the crate/barrel wood maps rather than a new bake? The family's
// albedo mean is 115,75,43 (~0.45/0.29/0.17) and the authored `WoodP` is
// (0.541, 0.353, 0.200): a close colour match, so the existing plank grain reads
// as the same workshop timber with no new bake under art/kaggle/. This is the
// mirror of round 110's choice to borrow the lamp metal maps for steel.
//
// Why keepTint is NOT kept: the reused albedo already carries a wood colour, and
// the authored tint sits within a few percent of that albedo's mean. Multiplying
// the two would only darken the prop, so the albedo replaces the flat colour
// instead of being tinted by it. (Contrast steel and skin, where the map carries
// no hue and the authored colour is the character's identity.)

/**
 * Metres per carried-prop wood tile.
 *
 * Sized against the props themselves rather than the furniture: the ledger board
 * is about 0.25 x 0.35 m, the pole 0.8 m long but only 4 cm thick, and the hoop
 * about 0.3 m across. A 0.45 m tile puts roughly one tile across the ledger and
 * only a sliver of grain along the shaft -- the scale of real grain on small
 * personal items. The crate family's 1.5 m tile would smear one whole board's
 * worth of grain across an entire prop and read as a painted stripe up close.
 */
export const CAST_WOOD_TILE_METERS = 0.45;

/**
 * The single carried-prop wood family.
 *
 * `keepTint` is false because the reused albedo already carries the wood colour
 * (see the module header): the authored tint is within a few percent of the
 * albedo mean, so multiplying would only darken the prop.
 *
 * `roughness` is 0.78, the same base the crate/barrel wood family in assets.js
 * uses, so a cast prop and a plaza crate read as the same timber rather than two
 * different finishes on the same wood.
 */
export const CAST_WOOD_FAMILIES = [
  {
    id: 'wood',
    // Exactly the authored material name. A loose /wood/ would catch `BarkWood`
    // (the trunks, which own the bark pass) and any future `WoodTrim` role
    // material; the cast has exactly one carried-wood material and this is its
    // name (art/blender/make_cast.py).
    test: /^woodp$/i,
    files: 'wood',
    tileMeters: CAST_WOOD_TILE_METERS,
    roughness: 0.78,
    metalness: 0,
    keepTint: false
  }
];

/**
 * The family an authored cast material belongs to, or null when it is left
 * alone.
 *
 * Everything except `WoodP` is deliberately excluded: the cloth/accent/boot/
 * steel/skin/hair/paper families already own their own materials, the eyes and
 * mouth carry the character's gaze, and `BarkWood` belongs to the bark pass.
 */
export function castWoodFamilyFor(materialName) {
  if (!materialName) return null;
  for (const family of CAST_WOOD_FAMILIES) {
    if (family.test.test(materialName)) return family;
  }
  return null;
}

/**
 * The material settings a dressed cast prop must end up with.
 *
 * Returned as data (rather than written inline in npcs.js) so the unit test can
 * assert the exact numbers, and so the intent -- the albedo owns the wood colour,
 * the map owns the grain -- is stated once.
 */
export function castWoodParams(family) {
  if (!family) return null;
  return {
    roughness: family.roughness,
    metalness: family.metalness,
    keepTint: family.keepTint === true
  };
}

/**
 * Whether a family's maps should be projected at all.
 *
 * Kept separate from the dressing loop because "no maps arrived" must leave the
 * material byte-identical to what the GLB shipped (roughness and metalness
 * included), rather than half-dressed: the carried props still have to look
 * right when the CDN is down. The wood family loads albedo, normal and
 * roughness maps, so the check is against `anyLoaded` exactly as for the other
 * families.
 */
export function shouldDressCastWood(family, textures) {
  if (!family || !textures) return false;
  return Boolean(textures.anyLoaded);
}
