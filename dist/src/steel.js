// The cast's armour: helmet, nasal, pauldrons and spear tip. Round 110 dresses
// the flat `Steel` material on halden's rig with the generated metal maps, so
// the one metal surface on the cast reads as forged iron rather than as a flat
// blue-grey disc.
//
// Why a separate pure module? The same reason as src/skin.js, src/accent.js,
// src/boot.js and src/paper.js: the browser pass in npcs.js and the unit tests
// must agree on the rules instead of each re-deriving a regex, and the module
// imports nothing so a test can hold the rules in place without Three.js.
//
// Why not PROP_FAMILIES (assets.js)? That table drives the plaza prop registry,
// whose dresser assumes every match is a prop mesh with a fresh white material
// and a fresh tile projection. The cast must keep its per-rig colour, so it has
// its own pass -- the same split rounds 67 (coats), 76 (skin/hair), 81
// (accent) and 82 (boots) made. The iron family in PROP_FAMILIES also catches
// `Iron`/`LampIron`, never `Steel`, so the cast's armour stayed flat until now.
//
// Why keepTint stays true: the authored blue-grey (0.56, 0.59, 0.66) is the
// character's identity, the same way the skin tones and coat dyes are. The maps
// supply relief and roughness variation only, and the albedo is deliberately
// omitted from CAST_STEEL_TEXTURE_FILES so a painted iron albedo cannot
// contaminate the tint (see src/npcs.js).
//
// Why the lamp metal maps rather than a dedicated steel bake: there is no steel
// texture set in assets/textures/ yet, and the lamp metal normal/roughness
// already read as forged iron at the cast's scale. A dedicated steel bake under
// art/kaggle/ can replace it later without touching this module, because the
// family only names the `files` id ('steel') and the loader resolves it.

/**
 * Metres per steel tile.
 *
 * The helmet and pauldrons are 0.2-0.3 m pieces, so a 0.2 m tile puts about
 * one tile across a pauldron and a little over one across the helmet. That makes
 * the forge marks and hammer texture about 5-10 mm wide on screen -- the scale
 * of real wrought-iron relief at Talk distance (~2 m) -- rather than a pore
 * pattern smeared over the whole helmet or a single smudge per plate.
 */
export const CAST_STEEL_TILE_METERS = 0.2;

/**
 * The single cast steel family.
 *
 * `keepTint` is what keeps the armour blue-grey rather than iron-painted: the
 * albedo carries no hue of its own (no map is loaded at all), so the authored
 * material colour is the steel and the map supplies only the relief.
 *
 * `roughness` is the base the map modulates: armour is matte but not chalky,
 * and `metalness` stays high because the surface is metal -- only the relief
 * changes, not the material class.
 */
export const CAST_STEEL_FAMILIES = [
  {
    id: 'steel',
    // Exactly the authored material name. A loose /steel/ would also catch a
    // future `SteelTrim` role material; the cast has exactly one steel material
    // per rig and this is its name (art/blender/make_cast.py).
    test: /^steel$/i,
    files: 'steel',
    tileMeters: CAST_STEEL_TILE_METERS,
    roughness: 0.35,
    metalness: 0.7,
    keepTint: true
  }
];

/**
 * The family an authored cast material belongs to, or null when it is left
 * alone.
 *
 * Everything except `Steel` is deliberately excluded: the eyes and mouth are
 * too small for a relief tile, the skin and hair carry the character's identity,
 * and the cloth/accent/boot/paper families already own their own materials.
 */
export function castSteelFamilyFor(materialName) {
  if (!materialName) return null;
  for (const family of CAST_STEEL_FAMILIES) {
    if (family.test.test(materialName)) return family;
  }
  return null;
}

/**
 * The material settings a dressed cast mesh must end up with.
 *
 * Returned as data (rather than written inline in npcs.js) so the unit test can
 * assert the exact numbers, and so the intent -- the maps own the small
 * variation, the material owns the tint and the metal class -- is stated once.
 */
export function castSteelParams(family) {
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
 * included), rather than half-dressed: the armour still has to look right when
 * the CDN is down. The steel family loads only normal and roughness maps, so
 * the check is against `anyLoaded` exactly as for the other families.
 */
export function shouldDressCastSteel(family, textures) {
  if (!family || !textures) return false;
  return Boolean(textures.anyLoaded);
}
