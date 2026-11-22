// Loading the hand-made assets and the procedural texture families: a modelled
// fountain plus the paving, wall, wood, brick and leaf materials.
//
// Design rules that shaped this file:
//   - The game must never depend on an asset to run. If the fetch fails (offline,
//     a stale cache, a host that 404s a binary), the caller keeps the procedural
//     fountain it already had. Assets are an upgrade, not a dependency.
//   - Loading is asynchronous, so it must not block play. The fountain appears a
//     moment after the world does; nothing else waits on it.
//   - The placement/fallback decisions are pure functions here so they can be
//     unit-tested without a browser or a renderer.

/** Where the fountain sits, and how big the collider around it is. */
export const FOUNTAIN_SPOT = { x: 0, z: 0 };
// The modelled fountain has a 1.95 m radius plinth. The collider is slightly
// larger so the player cannot stand inside the stonework, and square because the
// movement system only knows AABBs. 2.15 keeps the octagonal corners outside.
export const FOUNTAIN_COLLIDER = 2.15;

/** Texture files the stone material needs, relative to the served root. */
export const STONE_TEXTURE_FILES = {
  map: 'assets/textures/stone_albedo.webp',
  normalMap: 'assets/textures/stone_normal.webp',
  roughnessMap: 'assets/textures/stone_rough.webp'
};

export const COBBLE_TEXTURE_FILES = {
  map: 'assets/textures/cobble_albedo.webp',
  normalMap: 'assets/textures/cobble_normal.webp',
  roughnessMap: 'assets/textures/cobble_rough.webp'
};

/**
 * The plaza floor's own paving family.
 *
 * Deliberately separate from COBBLE_TEXTURE_FILES: the market lane is laid with
 * small rounded worn cobbles while the plaza is dressed with large rectangular
 * flagstones. Same shader, different maps, so the two surfaces read as
 * different places underfoot rather than one texture tiled twice.
 */
export const PLAZA_FLOOR_TEXTURE_FILES = {
  map: 'assets/textures/plaza_floor_albedo.webp',
  normalMap: 'assets/textures/plaza_floor_normal.webp',
  roughnessMap: 'assets/textures/plaza_floor_rough.webp'
};

export const GRASS_TEXTURE_FILES = {
  map: 'assets/textures/grass_albedo.webp',
  normalMap: 'assets/textures/grass_normal.webp',
  roughnessMap: 'assets/textures/grass_rough.webp'
};

export const HOUSE_ASSET = 'assets/house.glb';

/** Authored size of the house trim model (roof span 8 x 6, chimney to 5.33). */
export const HOUSE_MODEL_SIZE = { width: 8.1, depth: 6.2, height: 5.33 };

export const GATE_DOOR_ASSET = 'assets/gate_door.glb';

/** Authored size of the gate door model (matches the procedural box). */
export const GATE_DOOR_MODEL_SIZE = { width: 3.0, height: 2.9, depth: 0.28 };

export const FOUNTAIN_ASSET = 'assets/fountain.glb';
export const BARREL_ASSET = 'assets/barrel.glb';

/** Authored size of the barrel model, so instances can be scaled to fit. */
export const BARREL_MODEL_SIZE = { radius: 0.46, height: 1.30 };

export const STALL_ASSET = 'assets/stall.glb';

/** Authored size of the stall model, so instances can be scaled to fit. */
export const STALL_MODEL_SIZE = { width: 1.2, depth: 3.2, height: 1.35 };

export const LAMP_ASSET = 'assets/lamp.glb';

/** Authored size of the lamp model: the post is 3 m, the lantern overhangs. */
export const LAMP_MODEL_SIZE = { postHeight: 3.0, lanternHeight: 0.55 };

export const MARKET_STALL_ASSET = 'assets/market_stall.glb';

/** Authored size of the market stall model (the larger of the two). */
export const MARKET_STALL_MODEL_SIZE = { width: 4.0, depth: 0.4, height: 1.25 };

export const BENCH_ASSET = 'assets/bench.glb';

/** Authored size of the bench model. */
export const BENCH_MODEL_SIZE = { width: 2.2, depth: 0.7, height: 1.05 };

export const NOTICE_ASSET = 'assets/notice.glb';

/** Authored size of the notice board model. */
export const NOTICE_MODEL_SIZE = { width: 0.2, depth: 1.4, height: 2.0 };

export const CRATE_ASSET = 'assets/crates.glb';

/** Authored size of one crate model. */
export const CRATE_MODEL_SIZE = { width: 1.2, depth: 1.2, height: 1.2 };

export const TREE_ASSET = 'assets/tree.glb';

/** Authored size of the tree model (trunk + canopy). */
export const TREE_MODEL_SIZE = { trunkRadius: 0.22, trunkHeight: 2.6, canopyRadius: 1.35 };

export const BARK_TEXTURE_FILES = {
  map: 'assets/textures/bark_albedo.webp',
  normalMap: 'assets/textures/bark_normal.webp',
  roughnessMap: 'assets/textures/bark_rough.webp'
};

export const WOOD_TEXTURE_FILES = {
  map: 'assets/textures/wood_albedo.webp',
  normalMap: 'assets/textures/wood_normal.webp',
  roughnessMap: 'assets/textures/wood_rough.webp'
};

export const PLASTER_TEXTURE_FILES = {
  map: 'assets/textures/plaster_albedo.webp',
  normalMap: 'assets/textures/plaster_normal.webp',
  roughnessMap: 'assets/textures/plaster_rough.webp'
};

export const BRICK_TEXTURE_FILES = {
  map: 'assets/textures/brick_albedo.webp',
  normalMap: 'assets/textures/brick_normal.webp',
  roughnessMap: 'assets/textures/brick_rough.webp'
};

export const LAMP_TEXTURE_FILES = {
  map: 'assets/textures/lamp_albedo.webp',
  normalMap: 'assets/textures/lamp_normal.webp',
  roughnessMap: 'assets/textures/lamp_rough.webp'
};

/**
 * Roofing family: overlapping timber shingles for the house, market stalls and
 * lane stalls. These three share `HouseRoof`/`MarketRoof`/`StallRoof` materials
 * and were the single largest remaining flat mass in the plaza (about 190 m2 of
 * untextured triangles), so one warm tan family dresses all of them.
 */
export const ROOF_TEXTURE_FILES = {
  map: 'assets/textures/roof_albedo.webp',
  normalMap: 'assets/textures/roof_normal.webp',
  roughnessMap: 'assets/textures/roof_rough.webp'
};

/**
 * Foliage family for the tree canopies (about 271 m2 of flat green geometry).
 * A low-poly canopy has almost no silhouette detail, so the normal map carries
 * the read: dense leaf clusters with a strong vein crease.
 */
export const LEAF_TEXTURE_FILES = {
  map: 'assets/textures/leaf_albedo.webp',
  normalMap: 'assets/textures/leaf_normal.webp',
  roughnessMap: 'assets/textures/leaf_rough.webp'
};

/**
 * Which loaded family dresses which authored material, and at what tile size.
 *
 * The prop GLBs are authored untextured and blend-named (`BenchWood`, `Canopy`,
 * `HouseRoof`), so the family is chosen from the material name, not the mesh. One
 * tile size per family is the whole point: box-projected UVs are in metres, so a
 * 0.5 m crate and a 6 m awning read at the same texel density without any
 * per-surface repeat.
 *
 * Order matters. `BarkWood` is renamed by upgradeBark() after it dresses the
 * trunks, and it contains "Wood", so the bark family must be tested before the
 * generic wood one or the last pass wins and overwrites the bark maps with
 * planks.
 */
export const PROP_FAMILIES = [
  {
    id: 'leaf',
    // The canopy is authored as `Canopy` (tree.glb) with no "leaf" in the name.
    test: /canopy|leaf|foliage/i,
    files: LEAF_TEXTURE_FILES,
    tileMeters: 0.9,
    roughness: 0.92
  },
  {
    id: 'roof',
    // Only the three roof materials carry this word: HouseRoof, MarketRoof and
    // StallRoof. Keeping the pattern tight matters -- the shipped GLBs have no
    // cloth awning material, so a broader `/awning|c cloth/` would dress a
    // future cloth material with shingles.
    test: /roof/i,
    files: ROOF_TEXTURE_FILES,
    tileMeters: 1.1,
    roughness: 0.9
  },
  {
    id: 'bark',
    // `BarkWood` is what upgradeBark() renames the trunks to, and `Trunk` is the
    // authored tree.glb name; both are bark, not planks. Tested before `wood`
    // because `BarkWood` contains "Wood" -- otherwise the wood family would win
    // and overwrite the trunk maps with plank grain.
    test: /bark|trunk/i,
    files: BARK_TEXTURE_FILES,
    tileMeters: 1.2,
    roughness: 0.85
  },
  {
    id: 'wood',
    test: /wood/i,
    files: WOOD_TEXTURE_FILES,
    tileMeters: 1.5,
    roughness: 0.78
  }
];

/**
 * Picks the dressing family for an authored material name.
 *
 * Pure so the browser pass and the unit tests agree on what gets dressed instead
 * of both re-deriving the regexes. Returns null for iron, glass, stone, cloth and
 * every other material that should stay flat -- the props read as mixed materials
 * precisely because the bands and trim are left alone.
 *
 * `isLoaded` lets a caller prefer a family whose maps actually arrived. When a
 * material matches several families (a `BarkWood` trunk matches both bark and
 * wood) the first *loaded* one wins, so a failed bark download degrades to wood
 * grain instead of leaving the trunk flat. Without it the first match is used,
 * which keeps the function total and testable on its own.
 */
export function propFamilyFor(materialName, isLoaded = () => true) {
  if (!materialName) return null;
  let fallback = null;
  for (const family of PROP_FAMILIES) {
    if (!family.test.test(materialName)) continue;
    if (fallback === null) fallback = family;
    if (isLoaded(family)) return family;
  }
  return fallback;
}

/**
 * Whether the current context can load local assets at all. `fetch` is absent in
 * some embedded webviews and `file://` pages cannot fetch siblings even when
 * fetch exists, so both are checked before anything is requested.
 */
export function canLoadAssets({ hasFetch, protocol, isSecureContext } = {}) {
  if (!hasFetch) return false;
  // A file:// document has an opaque origin; fetching a sibling may be blocked by
  // the browser and would throw at runtime. Treat it as "assets unavailable" and
  // let the procedural fountain stand.
  if (protocol === 'file:') return false;
  // http:// works locally on loopback; a remote http:// page is not a secure
  // context but plain fetches of same-origin data still work, so this is only
  // recorded, not used to block.
  void isSecureContext;
  return true;
}

/**
 * Picks how big the stone texture should repeat on a given surface, so texel
 * density stays roughly constant rather than stretching on large faces.
 * Returns { repeatX, repeatY } for THREE.Texture.repeat.
 */
export function textureRepeat(widthMeters, heightMeters, tileMeters = 2) {
  const safe = (v) => (Number.isFinite(v) && v > 0 ? v : 1);
  return {
    repeatX: Math.max(1, Math.round(safe(widthMeters) / safe(tileMeters))),
    repeatY: Math.max(1, Math.round(safe(heightMeters) / safe(tileMeters)))
  };
}

/**
 * Box-projects UVs for a flat-shaded model whose GLB carried no TEXCOORD_0.
 *
 * Why this exists: the Blender prop models are authored from untextured box
 * primitives, so Blender writes no UVs for them. The wood texture can only
 * dress a mesh that has UVs, so the loader generates them here instead of
 * re-authoring every model with a UV unwrap.
 *
 * Box projection puts each triangle in the plane of its dominant normal axis:
 * a face pointing mostly along x gets (z, y) as its UV pair, and so on. That is
 * exactly right for crate/slab geometry (no stretching on the flat faces) and
 * cheap enough to do once at load time.
 *
 * Pure: positions in, UVs out, no THREE. `indices` may be null for
 * already-expanded geometry. Returns UVs in the same order as `positions`.
 */
export function boxProjectUvs({ positions, indices = null, tileMeters = 1 }) {
  const tile = Number.isFinite(tileMeters) && tileMeters > 0 ? tileMeters : 1;
  const uvs = new Float32Array((positions.length / 3) * 2);
  const triangleCount = indices ? indices.length / 3 : positions.length / 9;

  const projected = (i, nx, ny, nz) => {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    if (ax >= ay && ax >= az) return [z / tile, y / tile];
    if (ay >= az) return [x / tile, z / tile];
    return [x / tile, y / tile];
  };

  for (let t = 0; t < triangleCount; t += 1) {
    const a = indices ? indices[t * 3] : t * 3;
    const b = indices ? indices[t * 3 + 1] : t * 3 + 1;
    const c = indices ? indices[t * 3 + 2] : t * 3 + 2;
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const e1x = positions[b * 3] - ax, e1y = positions[b * 3 + 1] - ay,
      e1z = positions[b * 3 + 2] - az;
    const e2x = positions[c * 3] - ax, e2y = positions[c * 3 + 1] - ay,
      e2z = positions[c * 3 + 2] - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (const i of [a, b, c]) {
      const [u, v] = projected(i, nx, ny, nz);
      uvs[i * 2] = u;
      uvs[i * 2 + 1] = v;
    }
  }
  return uvs;
}

/**
 * Chooses the material settings for the border-wall stone given whether textures
 * loaded. With textures: white base colour so the map is not tinted twice, plus
 * normal and roughness maps. Without: the original flat block colour, so the
 * walls still read as stone if the textures are missing.
 *
 * The plaza floor has its own family and fallback colour (see
 * plazaFloorMaterialParams) so the two stone surfaces stay visually distinct.
 */
export function stoneMaterialParams(texturesLoaded) {
  if (texturesLoaded) {
    return {
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
      useMaps: true
    };
  }
  return {
    color: 0xb3a892, // the plaza's original colour
    roughness: 0.9,
    metalness: 0,
    useMaps: false
  };
}

/**
 * Material settings for the plaza's flagstone paving.
 *
 * A separate fallback colour from stoneMaterialParams(): the plaza reads as
 * dressed, lighter paving even when the maps are missing, while the border wall
 * keeps stoneMaterialParams()' warmer block colour. Both are only ever the
 * flat-colour fallback; the textured path is white in both cases.
 */
export function plazaFloorMaterialParams(texturesLoaded) {
  if (texturesLoaded) {
    return { color: 0xffffff, roughness: 1, metalness: 0, useMaps: true };
  }
  return {
    color: 0x9a9384, // dressed flagstone, a touch lighter than the wall stone
    roughness: 0.88,
    metalness: 0,
    useMaps: false
  };
}

/**
 * How wide one stone map tile is on the terrace, in metres.
 *
 * The terrace is a built structure, not a wall: its top is a 12 x 3.3 m slab that
 * the player walks across, so the tile has to be small enough that the joints
 * read underfoot as paving courses, and large enough that a single slab does not
 * look like a mosaic of pebbles. 1.6 m gives roughly two joints across the width
 * of the walk and a handful along its length -- closer to cut ashlar than to the
 * plaza's metre-wide flagstones or the lane's 5 cm cobbles. Because the terrace
 * is box-projected at this scale (see upgradeTerrace), the same number also
 * governs the ramp deck and the narrow kerb faces, so every piece of the terrace
 * stonework ends up with one texel density.
 */
export const TERRACE_TEXTURE_TILE_METERS = 1.6;

/**
 * Material settings for the north terrace's built stone.
 *
 * Two parts share the stone maps but not the fallback colour, because they are
 * genuinely different stonework: `tread` is the walked surface (terrace top and
 * ramp deck) and `parapet` is the upright kerb/parapet wall. Keeping the two flat
 * colours distinct means the step edge still reads as an edge if the maps never
 * load, which is the same rule the plaza floor and border walls follow.
 */
export function terraceMaterialParams(texturesLoaded, part = 'tread') {
  const upright = part === 'parapet';
  if (texturesLoaded) {
    return {
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
      useMaps: true
    };
  }
  return {
    color: upright ? 0x7f7567 : 0x9a9184,
    roughness: upright ? 0.85 : 0.9,
    metalness: 0,
    useMaps: false
  };
}

/**
 * The meshes the terrace stone pass dresses, grouped by which material each one
 * uses.
 *
 * Data rather than logic so the unit tests and the browser check agree with the
 * world about what should be dressed instead of re-deriving the list by hand.
 * Two groups, not five, because the terrace is one structure: `tread` is shared
 * by the slab and the ramp deck (both walked stone), and `parapet` by the kerbs
 * and the low wall. They stay separate materials only so their flat fallback
 * colours differ and the step edge still reads as an edge without maps.
 *
 * There is deliberately no per-surface repeat here. All of these are
 * box-projected at TERRACE_TEXTURE_TILE_METERS, which is what keeps the density
 * identical across a 12 m slab, a rotated ramp deck and a 0.2 m kerb face -- one
 * per-material repeat cannot do that, and the ramp's rotated box would shear.
 */
export function terraceStoneParts() {
  return {
    tread: ['terrace-tread', 'terrace-ramp'],
    parapet: ['terrace-kerb', 'terrace-parapet']
  };
}

/**
 * The modelled fountain's stone meshes, split by the GLB material each one uses.
 *
 * The fountain is authored in two stones -- a lighter carved stone for the basin,
 * bowl and column, and a darker one for the base plinth, finial and corner blocks
 * -- so the dressing pass must not flatten them into one material. Listing the
 * meshes here keeps the world and the tests reading the same list instead of
 * re-deriving it from names in two places.
 *
 * The two `Water` meshes are absent on purpose: they are a reflective surface, not
 * stone, and the stone maps would read as a wet flagstone on them.
 */
export function fountainStoneParts() {
  return {
    stone: [
      'FountainPlinthUpper', 'FountainBasin', 'FountainColumn', 'FountainUpperBowl'
    ],
    dark: [
      'FountainPlinthLower', 'FountainFinial',
      'FountainCornerBlock0', 'FountainCornerBlock1', 'FountainCornerBlock2', 'FountainCornerBlock3'
    ]
  };
}

/**
 * The authored base colour of each fountain stone, straight out of the GLB's
 * `pbrMetallicRoughness.baseColorFactor`.
 *
 * A stone map must not be tinted twice, so a dressed material projects white. But
 * `StoneDark` exists to be visibly darker than `Stone`, and throwing that away
 * would turn the plinth, finial and corner blocks into copies of the basin. The
 * dressing pass keeps the map at full strength and only nudges roughness and a
 * light tint, so the courses still read at eye level while the two stones stay
 * distinguishable.
 */
export const FOUNTAIN_STONE_COLORS = {
  Stone: 0x8f8577,
  StoneDark: 0x706a5e
};

/**
 * Material settings for the fountain's dressed stone.
 *
 * `map` means the stone maps loaded, so the base colour is white and the fabric of
 * the texture is left alone; the dark stone is still darkened by lighting and its
 * slightly rougher surface rather than by a tint over the map.
 */
export function fountainStoneMaterialParams(texturesLoaded, stone = 'Stone') {
  const dark = stone === 'StoneDark';
  if (texturesLoaded) {
    return {
      color: fountainStoneTint(stone, true),
      roughness: 1,
      metalness: 0,
      useMaps: true
    };
  }
  return {
    color: dark ? FOUNTAIN_STONE_COLORS.StoneDark : FOUNTAIN_STONE_COLORS.Stone,
    roughness: dark ? 0.9 : 0.85,
    metalness: 0,
    useMaps: false
  };
}

/**
 * The tint a dressed stone material multiplies its map by.
 *
 * Three multiplies `material.color` into the sampled albedo, so white leaves the
 * map untouched. The lighter `Stone` therefore stays white. `StoneDark` cannot:
 * with maps it would render byte-identical to `Stone`, erasing the plinth, finial
 * and corner blocks that give the fountain its base -- a 21% luma difference in
 * the authored colours would be lost. Instead of tinting by the authored colour
 * (which would darken the map twice, since the map is already a mid-grey stone)
 * the dark stone is scaled by the *ratio* between the two authored stones, so the
 * map's own detail survives at its original contrast and only the overall tone
 * shifts. That ratio is near-neutral (it darkens blue the least), which keeps the
 * warm-grey character of both stones.
 */
export function fountainStoneTint(stone, texturesLoaded) {
  if (!texturesLoaded || stone !== 'StoneDark') return 0xffffff;
  const light = FOUNTAIN_STONE_COLORS.Stone;
  const dark = FOUNTAIN_STONE_COLORS.StoneDark;
  const ratio = (shift) => {
    const a = (light >> shift) & 0xff;
    const b = (dark >> shift) & 0xff;
    return Math.max(0, Math.min(255, Math.round((b / a) * 255)));
  };
  return (ratio(16) << 16) | (ratio(8) << 8) | ratio(0);
}

/**
 * Copies a loaded texture family so two surfaces can tile the same maps
 * differently.
 *
 * `applyTextureFamily()` writes `wrapS`/`wrapT`/`repeat`/`anisotropy` onto the
 * texture itself, not onto the material. Two materials sharing one texture object
 * therefore cannot have different sampler settings: the last one applied wins, and
 * the first surface silently renders wrong. The terrace shares the stone maps with
 * the border walls while projecting at a different tile scale, so each consumer
 * gets its own copy.
 *
 * The clone shares the decoded image bitmap, so this costs no extra download or
 * GPU upload of pixel data -- only a separate sampler state.
 *
 * Every texture in a projected family is left at `repeat = 1`: box-projected UVs
 * are already in tile units, so a repeat here would tile the tile.
 */
export function cloneTextureFamily(textures) {
  const out = { anyLoaded: Boolean(textures && textures.anyLoaded) };
  if (!textures) return out;
  for (const key of ['map', 'normalMap', 'roughnessMap']) {
    const texture = textures[key];
    if (!texture) {
      out[key] = null;
      continue;
    }
    const copy = typeof texture.clone === 'function' ? texture.clone() : texture;
    copy.needsUpdate = true;
    out[key] = copy;
  }
  return out;
}

/**
 * Bounds a loaded fountain so the caller can verify it matches the collider.
 * Walks the geometry bounding box the loader already computed, so this needs no
 * renderer and can be checked in a unit test.
 */
export function fountainFootprint(meshes) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const { geometry } of meshes) {
    const box = geometry.boundingBox;
    if (!box) continue;
    minX = Math.min(minX, box.min.x); maxX = Math.max(maxX, box.max.x);
    minY = Math.min(minY, box.min.y); maxY = Math.max(maxY, box.max.y);
    minZ = Math.min(minZ, box.min.z); maxZ = Math.max(maxZ, box.max.z);
  }
  if (!Number.isFinite(minX)) return null;
  return {
    minX, maxX, minY, maxY, minZ, maxZ,
    width: maxX - minX,
    height: maxY - minY,
    depth: maxZ - minZ
  };
}

/**
 * True when the modelled fountain fits inside its collider, so the player can
 * never walk into visible geometry. Checked at load time in the browser and in a
 * unit test against the exported numbers.
 */
export function footprintFitsCollider(footprint, colliderHalfSize = FOUNTAIN_COLLIDER) {
  if (!footprint) return false;
  const reach = Math.max(
    Math.abs(footprint.minX), Math.abs(footprint.maxX),
    Math.abs(footprint.minZ), Math.abs(footprint.maxZ)
  );
  return reach <= colliderHalfSize;
}

/** Fetches the GLB and returns an ArrayBuffer, or null if unavailable. */
export async function fetchFountain(url = FOUNTAIN_ASSET) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return response.arrayBuffer();
}

/**
 * Best-effort asset load. Never rejects: resolves to a report so the caller can
 * record honestly what actually happened (and tests can assert on it).
 */
export async function loadFountain({ THREE, loadGlb, url = FOUNTAIN_ASSET, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      return { ok: false, reason: `status ${response.status}`, url };
    }
    const buffer = await response.arrayBuffer();
    const meshes = loadGlb(buffer, THREE);
    const footprint = fountainFootprint(meshes);
    if (!footprintFitsCollider(footprint)) {
      return { ok: false, reason: 'model exceeds its collider', footprint, url };
    }
    return { ok: true, meshes, footprint, url, bytes: buffer.byteLength };
  } catch (error) {
    // Offline, blocked, corrupt, or a browser without fetch: all the same to the
    // caller. Report, do not throw -- the procedural fountain is still there.
    return { ok: false, reason: String(error && error.message ? error.message : error), url };
  }
}

/**
 * Loads the barrel GLB. Same contract as loadFountain: never throws, reports
 * what happened, and refuses a model that does not fit the collider the game
 * already registers for barrels (1.1 x 1.1, so a 0.55 half-extent).
 */
export async function loadBarrel({ THREE, loadGlb, url = BARREL_ASSET, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      return { ok: false, reason: `status ${response.status}`, url };
    }
    const buffer = await response.arrayBuffer();
    const meshes = loadGlb(buffer, THREE);
    const footprint = fountainFootprint(meshes);
    const reach = footprint
      ? Math.max(Math.abs(footprint.minX), Math.abs(footprint.maxX),
                 Math.abs(footprint.minZ), Math.abs(footprint.maxZ))
      : Infinity;
    if (reach > 0.55) {
      return { ok: false, reason: 'barrel exceeds its collider', footprint, url };
    }
    return { ok: true, meshes, footprint, url, bytes: buffer.byteLength };
  } catch (error) {
    return { ok: false, reason: String(error && error.message ? error.message : error), url };
  }
}

/**
 * Loads the stall GLB. Same contract as loadBarrel: never throws, reports what
 * happened, and refuses a model that does not fit the collider the game already
 * registers for stalls (1.2 x 3.2, so a 0.6 wide / 1.6 deep half-extent).
 */
export async function loadStall({ THREE, loadGlb, url = STALL_ASSET, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      return { ok: false, reason: `status ${response.status}`, url };
    }
    const buffer = await response.arrayBuffer();
    const meshes = loadGlb(buffer, THREE);
    const footprint = fountainFootprint(meshes);
    const reachX = footprint
      ? Math.max(Math.abs(footprint.minX), Math.abs(footprint.maxX))
      : Infinity;
    const reachZ = footprint
      ? Math.max(Math.abs(footprint.minZ), Math.abs(footprint.maxZ))
      : Infinity;
    if (reachX > 0.61 || reachZ > 1.61) {
      return { ok: false, reason: 'stall exceeds its collider', footprint, url };
    }
    return { ok: true, meshes, footprint, url, bytes: buffer.byteLength };
  } catch (error) {
    return { ok: false, reason: String(error && error.message ? error.message : error), url };
  }
}

/**
 * Loads the lantern-post GLB. Same contract as loadStall: never throws, reports
 * what happened, and refuses a model whose *base* does not fit the collider the
 * game already registers for posts (0.4 x 0.4, so a 0.2 half-extent). The arm
 * and lantern are allowed to overhang the collider -- only the post must fit.
 */
export async function loadLamp({ THREE, loadGlb, url = LAMP_ASSET, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      return { ok: false, reason: `status ${response.status}`, url };
    }
    const buffer = await response.arrayBuffer();
    const meshes = loadGlb(buffer, THREE);
    // The base parts (LampPost, LampBase) must sit inside the collider; the
    // overhanging arm/lantern may not. Reject only on base overflow.
    const baseMeshes = meshes.filter((m) => m.name === 'LampPost' || m.name === 'LampBase');
    const check = baseMeshes.length ? baseMeshes : meshes;
    const footprint = fountainFootprint(check);
    const reachX = footprint
      ? Math.max(Math.abs(footprint.minX), Math.abs(footprint.maxX))
      : Infinity;
    const reachZ = footprint
      ? Math.max(Math.abs(footprint.minZ), Math.abs(footprint.maxZ))
      : Infinity;
    if (reachX > 0.21 || reachZ > 0.21) {
      return { ok: false, reason: 'lamp base exceeds its collider', footprint, url };
    }
    return { ok: true, meshes, footprint, url, bytes: buffer.byteLength };
  } catch (error) {
    return { ok: false, reason: String(error && error.message ? error.message : error), url };
  }
}

/**
 * Loads the market-stall GLB. Same contract as the others: never throws, and
 * refuses a model whose base exceeds the larger collider (4.0 x 0.4, so a
 * 2.0 wide / 0.2 deep half-extent). The smaller stall is a uniform scale-down.
 */
export async function loadMarketStall({ THREE, loadGlb, url = MARKET_STALL_ASSET, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      return { ok: false, reason: `status ${response.status}`, url };
    }
    const buffer = await response.arrayBuffer();
    const meshes = loadGlb(buffer, THREE);
    // Only the counter and posts must fit the collider; the awning overhangs.
    const baseMeshes = meshes.filter((m) =>
      m.name === 'MarketCounter' || m.name === 'MarketShelf' ||
      m.name.startsWith('MarketPost'));
    const check = baseMeshes.length ? baseMeshes : meshes;
    const footprint = fountainFootprint(check);
    const reachX = footprint
      ? Math.max(Math.abs(footprint.minX), Math.abs(footprint.maxX))
      : Infinity;
    const reachZ = footprint
      ? Math.max(Math.abs(footprint.minZ), Math.abs(footprint.maxZ))
      : Infinity;
    if (reachX > 2.05 || reachZ > 0.22) {
      return { ok: false, reason: 'market stall exceeds its collider', footprint, url };
    }
    return { ok: true, meshes, footprint, url, bytes: buffer.byteLength };
  } catch (error) {
    return { ok: false, reason: String(error && error.message ? error.message : error), url };
  }
}

/**
 * Loads the bench GLB. Same contract as the others: never throws, refuses a
 * model whose base exceeds the collider (2.2 x 0.7, so a 1.1 wide / 0.35 deep
 * half-extent). The backrest is allowed to overhang slightly.
 */
export async function loadBench({ THREE, loadGlb, url = BENCH_ASSET, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      return { ok: false, reason: `status ${response.status}`, url };
    }
    const buffer = await response.arrayBuffer();
    const meshes = loadGlb(buffer, THREE);
    const footprint = fountainFootprint(meshes);
    const reachX = footprint
      ? Math.max(Math.abs(footprint.minX), Math.abs(footprint.maxX))
      : Infinity;
    const reachZ = footprint
      ? Math.max(Math.abs(footprint.minZ), Math.abs(footprint.maxZ))
      : Infinity;
    if (reachX > 1.15 || reachZ > 0.4) {
      return { ok: false, reason: 'bench exceeds its collider', footprint, url };
    }
    return { ok: true, meshes, footprint, url, bytes: buffer.byteLength };
  } catch (error) {
    return { ok: false, reason: String(error && error.message ? error.message : error), url };
  }
}

/**
 * Loads the notice-board GLB. Same contract: never throws, refuses a model
 * whose footprint exceeds the collider (0.6 x 1.8, so a 0.3 wide / 0.9 deep
 * half-extent). The board is authored with its long side along x and rotated
 * 90 deg by the game, so the loader checks the wider extent against depth.
 */
export async function loadNotice({ THREE, loadGlb, url = NOTICE_ASSET, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      return { ok: false, reason: `status ${response.status}`, url };
    }
    const buffer = await response.arrayBuffer();
    const meshes = loadGlb(buffer, THREE);
    const footprint = fountainFootprint(meshes);
    const reachX = footprint
      ? Math.max(Math.abs(footprint.minX), Math.abs(footprint.maxX))
      : Infinity;
    const reachZ = footprint
      ? Math.max(Math.abs(footprint.minZ), Math.abs(footprint.maxZ))
      : Infinity;
    if (reachX > 0.95 || reachZ > 0.35) {
      return { ok: false, reason: 'notice exceeds its collider', footprint, url };
    }
    return { ok: true, meshes, footprint, url, bytes: buffer.byteLength };
  } catch (error) {
    return { ok: false, reason: String(error && error.message ? error.message : error), url };
  }
}

/**
 * Loads the tree GLB. Same contract: never throws, refuses a model whose trunk
 * exceeds the collider (0.5 m half-extent). The canopy is allowed to overhang.
 */
export async function loadTree({ THREE, loadGlb, url = TREE_ASSET, fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      return { ok: false, reason: `status ${response.status}`, url };
    }
    const buffer = await response.arrayBuffer();
    const meshes = loadGlb(buffer, THREE);
    const names = new Set(meshes.map((m) => m.name));
    if (!names.has('TreeTrunk')) {
      return { ok: false, reason: 'tree model missing TreeTrunk', url };
    }
    const trunkMeshes = meshes.filter((m) => m.name === 'TreeTrunk');
    const footprint = fountainFootprint(trunkMeshes.length ? trunkMeshes : meshes);
    const reach = footprint
      ? Math.max(Math.abs(footprint.minX), Math.abs(footprint.maxX),
                 Math.abs(footprint.minZ), Math.abs(footprint.maxZ))
      : Infinity;
    if (reach > 0.5) {
      return { ok: false, reason: 'tree trunk exceeds its collider', footprint, url };
    }
    return { ok: true, meshes, footprint, url, bytes: buffer.byteLength };
  } catch (error) {
    return { ok: false, reason: String(error && error.message ? error.message : error), url };
  }
}

/**
 * Loads the crate GLB. Same contract: never throws, refuses a model whose
 * footprint exceeds the collider (1.2 x 1.2, so a 0.6 half-extent).
 */
export async function loadCrate({ THREE, loadGlb, url = CRATE_ASSET, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      return { ok: false, reason: `status ${response.status}`, url };
    }
    const buffer = await response.arrayBuffer();
    const meshes = loadGlb(buffer, THREE);
    const footprint = fountainFootprint(meshes);
    const reachX = footprint
      ? Math.max(Math.abs(footprint.minX), Math.abs(footprint.maxX))
      : Infinity;
    const reachZ = footprint
      ? Math.max(Math.abs(footprint.minZ), Math.abs(footprint.maxZ))
      : Infinity;
    if (reachX > 0.65 || reachZ > 0.65) {
      return { ok: false, reason: 'crate exceeds its collider', footprint, url };
    }
    return { ok: true, meshes, footprint, url, bytes: buffer.byteLength };
  } catch (error) {
    return { ok: false, reason: String(error && error.message ? error.message : error), url };
  }
}

/**
 * Loads the gate-door GLB. Same contract: never throws, refuses a model whose
 * footprint exceeds the door box (3.0 wide x 2.9 tall; the straps and handle
 * may stand slightly proud in depth).
 */
export async function loadGateDoor({ THREE, loadGlb, url = GATE_DOOR_ASSET, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      return { ok: false, reason: `status ${response.status}`, url };
    }
    const buffer = await response.arrayBuffer();
    const meshes = loadGlb(buffer, THREE);
    const footprint = fountainFootprint(meshes);
    const reachX = footprint
      ? Math.max(Math.abs(footprint.minX), Math.abs(footprint.maxX))
      : Infinity;
    const reachY = footprint
      ? Math.max(Math.abs(footprint.minY), Math.abs(footprint.maxY))
      : Infinity;
    if (reachX > GATE_DOOR_MODEL_SIZE.width / 2 + 0.05 ||
        reachY > GATE_DOOR_MODEL_SIZE.height / 2 + 0.05) {
      return { ok: false, reason: 'gate door exceeds its box', footprint, url };
    }
    return { ok: true, meshes, footprint, url, bytes: buffer.byteLength };
  } catch (error) {
    return { ok: false, reason: String(error && error.message ? error.message : error), url };
  }
}

/**
 * Loads the house-trim GLB. Same contract: never throws. The trim overlays the
 * brick body, so it checks the roof span (8 x 6) plus a small overhang, and
 * that nothing sinks below the ground plane.
 */
export async function loadHouse({ THREE, loadGlb, url = HOUSE_ASSET, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      return { ok: false, reason: `status ${response.status}`, url };
    }
    const buffer = await response.arrayBuffer();
    const meshes = loadGlb(buffer, THREE);
    const footprint = fountainFootprint(meshes);
    if (!footprint) {
      return { ok: false, reason: 'no geometry', url };
    }
    const reachX = Math.max(Math.abs(footprint.minX), Math.abs(footprint.maxX));
    const reachZ = Math.max(Math.abs(footprint.minZ), Math.abs(footprint.maxZ));
    if (reachX > HOUSE_MODEL_SIZE.width / 2 + 0.05 ||
        reachZ > HOUSE_MODEL_SIZE.depth / 2 + 0.05 ||
        footprint.minY < -0.01) {
      return { ok: false, reason: 'house trim exceeds its span', footprint, url };
    }
    return { ok: true, meshes, footprint, url, bytes: buffer.byteLength };
  } catch (error) {
    return { ok: false, reason: String(error && error.message ? error.message : error), url };
  }
}

/** Cast model per NPC id; loaded by loadCast. */
export const CAST_ASSETS = {
  mara: 'assets/npc_mara.glb',
  oswin: 'assets/npc_oswin.glb',
  pip: 'assets/npc_pip.glb',
  halden: 'assets/npc_halden.glb',
  sable: 'assets/npc_sable.glb',
  wren: 'assets/npc_wren.glb'
};

/**
 * Loads one cast model. Same contract as the other model loaders: never throws.
 * There is no collider to respect, so the checks are the honest ones: the file
 * exists, parses, and carries the joint-contract meshes (limbs authored around
 * their joints so the game can animate them).
 */
export async function loadCast({ THREE, loadGlb, url, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      return { ok: false, reason: `status ${response.status}`, url };
    }
    const buffer = await response.arrayBuffer();
    const meshes = loadGlb(buffer, THREE);
    const names = new Set(meshes.map((m) => m.name));
    for (const required of ['Torso', 'Head', 'LimbArmL', 'LimbArmR', 'LimbLegL', 'LimbLegR']) {
      if (!names.has(required)) {
        return { ok: false, reason: `cast model missing ${required}`, url };
      }
    }
    return { ok: true, meshes, url, bytes: buffer.byteLength };
  } catch (error) {
    return { ok: false, reason: String(error && error.message ? error.message : error), url };
  }
}

/**
 * Loads a set of three maps (albedo / normal / roughness) for one material family.
 * Shared by stone, wood and brick; `files` selects which family.
 *
 * Resolves to nulls for any map that fails. `createBitmap` is injectable because
 * the decode step needs a browser API (`createImageBitmap`) that Node does not
 * have. Without a decoder a texture cannot exist, so this returns nulls rather
 * than pretending otherwise -- the material then falls back to its flat colour.
 */
/**
 * Which colour space each map kind must use.
 *
 * Three.js r160 tags a texture as 'srgb' or 'no-color-space' (linear). Getting
 * this wrong is not cosmetic: an albedo map left in linear space is rendered
 * too dark, and a normal/roughness map tagged sRGB is silently mis-decoded and
 * lights the surface wrongly. So the choice is data, not a comment.
 */
export const TEXTURE_COLOR_SPACE = {
  map: 'srgb',
  // Three r160's NoColorSpace is the empty string, NOT the glTF-looking
  // 'no-color-space'. Setting an unknown string makes Three look up a colour
  // space that does not exist and throw on `.primaries`, which killed the
  // render loop -- found the hard way, and the reason this is a named constant
  // with the real value instead of a plausible-looking one.
  normalMap: '',
  roughnessMap: ''
};

export async function loadMaterialTextures({
  THREE, files = STONE_TEXTURE_FILES, fetchImpl = fetch,
  createBitmap = typeof createImageBitmap === 'function' ? createImageBitmap : null
} = {}) {
  const load = async (url, kind) => {
    try {
      if (!createBitmap) return null; // no decoder available in this context
      const response = await fetchImpl(url);
      if (!response.ok) return null;
      const blob = await response.blob();
      const bitmap = await createBitmap(blob);
      const texture = new THREE.Texture(bitmap);
      // Tag the colour space per map kind so colour maps are decoded as sRGB
      // and data maps stay linear.
      const space = TEXTURE_COLOR_SPACE[kind];
      // '' (NoColorSpace) is a real value, so this must test membership, not
      // truthiness -- a falsy check would silently skip the linear maps.
      if (space !== undefined) texture.colorSpace = space;
      texture.needsUpdate = true;
      return texture;
    } catch {
      return null;
    }
  };
  const [map, normalMap, roughnessMap] = await Promise.all([
    load(files.map, 'map'),
    load(files.normalMap, 'normalMap'),
    load(files.roughnessMap, 'roughnessMap')
  ]);
  return { map, normalMap, roughnessMap, anyLoaded: Boolean(map || normalMap || roughnessMap) };
}

/**
 * Whether a mesh the world is about to build must own a private copy of a
 * cached model's material.
 *
 * loadLampAsset()/loadXAsset() cache one GLB parse and hand the same material
 * objects to every instance. That is fine until one instance's material is
 * animated per-frame: the lane head's emissiveIntensity is written to 0 on
 * every daylight frame, and the plaza posts hold the same object, so the four
 * plaza lanterns went dark the moment the lane post was modelled. Anything that
 * mutates a material afterwards has to clone it first.
 *
 * Returns true when the caller intends to mutate, so the world can clone rather
 * than share. Kept here as a named rule instead of an inline `material.clone()`
 * so a test can hold it in place.
 */
export function needsOwnMaterial({ mutatesMaterial = false, sharedSource = false } = {}) {
  return Boolean(mutatesMaterial && sharedSource);
}

/** Backwards-compatible alias: the stone family is the original user. */
export const loadStoneTextures = loadMaterialTextures;
