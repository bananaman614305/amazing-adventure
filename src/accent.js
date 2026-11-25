// The cast's accent bands: sashes, scarves, tabards, cloaks, collars and the
// leg wrappings. Round 81 dresses them with the neutral felt maps, the same
// matted fibre the lane bunting already uses, because an accent band is the
// same kind of surface at the same scale: a 0.1-0.2 m strip of felted fabric
// carrying a per-NPC dye.
//
// This module is the pure, testable half: it names the family, its tile size and
// the material settings the dressed mesh must end up with, so the browser pass in
// npcs.js and the unit tests agree instead of each re-deriving a regex. It
// imports nothing, so a test can hold the rules in place without Three.js.
//
// Why not PROP_FAMILIES (assets.js)? That table drives the plaza prop registry,
// whose dresser builds a fresh white material -- exactly wrong for the cast,
// whose accent dye is the whole point. The cast keeps its per-rig colours, so it
// has its own pass -- the same split rounds 67 (coats) and 76 (skin/hair) made.
//
// Why felt and not a new set: the bunting flags are 0.16 x 0.22 m and felt is
// already matted fibre at a 0.18 m tile with a neutral albedo. An accent band is
// the same material at the same scale, so reusing felt keeps one fibre read
// across the whole scene instead of a second near-identical set that would drift.
// The felt family is already credited in CREDITS.md.

/**
 * Metres per accent tile.
 *
 * Matches FELT_FAMILY.tileMeters (BUNTING_TILE_METERS): one felt nap tile is
 * about one flag face wide, which is also about one sash width, so the fibre
 * scale agrees between the bunting and the cast's accent bands.
 */
export const CAST_ACCENT_TILE_METERS = 0.18;

/**
 * The single cast accent family.
 *
 * `keepTint` is what keeps six characters distinct: the felt albedo carries no
 * hue of its own, so the authored per-NPC accent colour (mara 0xffd479, oswin
 * 0xc94f3a, pip 0x8fd49a, halden 0x8f97a8, sable 0xc9a6f0, wren 0xf0c46b)
 * is the band's dye and the map supplies only the fibre relief.
 */
export const CAST_ACCENT_FAMILIES = [
  {
    id: 'accent',
    // Exactly the authored material name. A loose /accent/ would also catch a
    // future `AccentStripe` role material; the cast has exactly one accent
    // material per rig and this is its name (art/blender/make_cast.py).
    test: /^accent$/i,
    tileMeters: CAST_ACCENT_TILE_METERS,
    roughness: 0.9,
    metalness: 0,
    keepTint: true
  }
];

/** The family an authored cast material belongs to, or null when left alone. */
export function castAccentFamilyFor(materialName) {
  if (!materialName) return null;
  for (const family of CAST_ACCENT_FAMILIES) {
    if (family.test.test(materialName)) return family;
  }
  return null;
}

/** The material settings a dressed cast mesh must end up with. */
export function castAccentParams(family) {
  if (!family) return null;
  return {
    roughness: family.roughness,
    metalness: family.metalness,
    keepTint: family.keepTint === true
  };
}

/** Whether a family's maps should be projected at all. */
export function shouldDressCastAccent(family, textures) {
  if (!family || !textures) return false;
  return Boolean(textures.anyLoaded);
}
