// The cast's faces and hair: the last flat mass a player looks at directly.
//
// Round 76 dresses two authored cast materials from the modelled rigs:
//
//   `Skin`   36 meshes (six heads, six noses, twelve hands, twelve thumbs)
//            1.31 m2 measured in the live scene.
//   `HairC`  8 meshes (six hair caps, one bun, one tail), 0.67 m2.
//
// Both are neutral-albedo families: the authored per-NPC skin and hair colours
// (0xA87B5A..0xE0B892 and 0x1F1A16..0x8A5A2A) are the character's identity, so
// the maps supply relief and self-shadowing only and the material keeps its
// tint, exactly like the cloth pass in round 67.
//
// This module is the pure, testable half: it names the families, their tile
// sizes and the material settings each one imposes, so the browser pass in
// npcs.js and the unit tests agree instead of each re-deriving a regex. It
// imports nothing, so a test can hold the rules in place without Three.js.
//
// Why not put these in PROP_FAMILIES (assets.js)? That table drives the plaza
// prop registry, whose dresser assumes every match is a prop mesh with a fresh
// white material. The cast must keep its per-rig colours, so it has its own
// pass -- the same split round 67 made for coats.

/**
 * Metres per skin tile.
 *
 * Chosen against the head, which is the surface this has to work on: the
 * modelled head is 0.31 m wide, so a 0.35 m tile puts just under one tile
 * across a face. That makes the crease lattice about 3-10 mm wide on screen --
 * the scale of real skin creases -- rather than a pore pattern smeared over a
 * whole cheek.
 */
export const CAST_SKIN_TILE_METERS = 0.35;

/**
 * Metres per hair tile.
 *
 * Hair is authored as short ridges, so its tile is smaller than skin's: 0.22 m
 * puts about 1.6 tiles across a 0.35 m hair cap, and the generator's 24 locks
 * per tile land at roughly one lock per 9 mm -- a combed head at Talk distance
 * (~2 m) rather than a stripe pattern.
 */
export const CAST_HAIR_TILE_METERS = 0.22;

/**
 * The two cast families, in the order a material name is tested.
 *
 * `keepTint` is what keeps six characters distinct: the albedo carries no hue
 * of its own (see SKIN_TEXTURE_FILES / HAIR_TEXTURE_FILES in assets.js), so the
 * authored material colour is the skin tone and the hair dye.
 *
 * `roughness` is the base the map modulates: skin is matte but not chalky,
 * hair catches a little more sheen along the lock crowns.
 */
export const CAST_SKIN_FAMILIES = [
  {
    id: 'skin',
    // Exactly the authored material name. A loose /skin/ would also catch a
    // future `SkinTone` role material, or `SkinMarker`; the cast has exactly one
    // skin material per rig and this is its name (art/blender/make_cast.py).
    test: /^skin$/i,
    files: 'skin',
    tileMeters: CAST_SKIN_TILE_METERS,
    roughness: 0.7,
    metalness: 0,
    keepTint: true
  },
  {
    id: 'hair',
    // `HairC` is the authored name; the mesh names are Hair/HairBun/HairTail.
    // Prefix-anchored so a future `HairPinned` also belongs to the family.
    test: /^hairc$/i,
    files: 'hair',
    tileMeters: CAST_HAIR_TILE_METERS,
    roughness: 0.8,
    metalness: 0,
    keepTint: true
  }
];

/**
 * The family an authored cast material belongs to, or null when it is left
 * alone.
 *
 * The eyes and mouth are deliberately not in the table: `EyeWhite` and
 * `EyeIris` are 0.05 and 0.01 m2 and carry the character's gaze, and `Mouth` is
 * 0.01 m2 -- a 0.35 m relief tile on a 2 cm mouth would only blur the one mark
 * that lets a player read a face at distance. A texture pass that swallowed
 * them would make the cast stare blankly.
 */
export function castSkinFamilyFor(materialName) {
  if (!materialName) return null;
  for (const family of CAST_SKIN_FAMILIES) {
    if (family.test.test(materialName)) return family;
  }
  return null;
}

/**
 * The material settings a dressed cast mesh must end up with.
 *
 * Returned as data (rather than written inline in npcs.js) so the unit test can
 * assert the exact numbers, and so the intent -- the maps own the small
 * variation, the material owns the tint -- is stated once.
 */
export function castSkinParams(family) {
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
 * material byte-identical to what the GLB shipped (roughness included), rather
 * than half-dressed: the cast still has to look right when the CDN is down.
 */
export function shouldDressCastSkin(family, textures) {
  if (!family || !textures) return false;
  return Boolean(textures.anyLoaded);
}