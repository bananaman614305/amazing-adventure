// The cast's boots: the last flat leather surface on the modelled rigs.
//
// Round 82 dresses the per-rig `Boot` material (18 meshes across five of the
// six characters, 1.49 m2 measured): a dark grey-brown leather at 0.15 x 0.25 x
// 0.19 m. The leather maps are generated at boot scale, so the pore field reads
// as real grain rather than a smear.
//
// This module is the pure, testable half: it names the family, its tile size
// and the material settings it imposes, so the browser pass in npcs.js and the
// unit tests agree instead of each re-deriving a regex. It imports nothing, so
// a test can hold the rules in place without Three.js.
//
// Why not put this in PROP_FAMILIES (assets.js)? That table drives the plaza
// prop registry, whose dresser assumes every match is a prop mesh with a fresh
// white material. The cast must keep its per-rig colours, so it has its own
// pass -- the same split round 67 made for coats.

/**
 * Metres per leather tile.
 *
 * Chosen against the boot itself, which is 0.15 x 0.25 x 0.19 m: a 0.2 m tile
 * puts about one tile across the toe, so the pore field lands at 1-2 mm -- the
 * scale of real leather grain -- rather than a smear over the whole vamp.
 */
export const CAST_BOOT_TILE_METERS = 0.2;

/**
 * The single cast boot family.
 *
 * `keepTint` is what keeps the authored boot colour (#726c66, a dark
 * grey-brown) as the leather dye: the albedo carries no hue of its own (see
 * LEATHER_TEXTURE_FILES in assets.js), so the maps supply relief and
 * self-shadowing only.
 */
export const CAST_BOOT_FAMILIES = [
  {
    id: 'boot',
    // Exactly the authored material name. A loose /boot/ would also catch a
    // future `Bootlace` role material; the cast has exactly one boot material
    // per rig and this is its name (art/blender/make_cast.py).
    test: /^boot$/i,
    files: 'leather',
    tileMeters: CAST_BOOT_TILE_METERS,
    roughness: 0.9,
    metalness: 0,
    keepTint: true
  }
];

/**
 * The family an authored cast material belongs to, or null when it is left
 * alone.
 */
export function castBootFamilyFor(materialName) {
  if (!materialName) return null;
  for (const family of CAST_BOOT_FAMILIES) {
    if (family.test.test(materialName)) return family;
  }
  return null;
}

/**
 * The material settings a dressed cast mesh must end up with.
 */
export function castBootParams(family) {
  if (!family) return null;
  return {
    roughness: family.roughness,
    metalness: family.metalness,
    keepTint: family.keepTint === true
  };
}

/**
 * Whether a family's maps should be projected at all.
 */
export function shouldDressCastBoot(family, textures) {
  if (!family || !textures) return false;
  return Boolean(textures.anyLoaded);
}
