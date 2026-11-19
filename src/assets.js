// Loading the two hand-made assets: a modelled fountain and a stone material.
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
  map: 'assets/textures/stone_albedo.png',
  normalMap: 'assets/textures/stone_normal.png',
  roughnessMap: 'assets/textures/stone_rough.png'
};

export const COBBLE_TEXTURE_FILES = {
  map: 'assets/textures/cobble_albedo.png',
  normalMap: 'assets/textures/cobble_normal.png',
  roughnessMap: 'assets/textures/cobble_rough.png'
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

export const WOOD_TEXTURE_FILES = {
  map: 'assets/textures/wood_albedo.png',
  normalMap: 'assets/textures/wood_normal.png',
  roughnessMap: 'assets/textures/wood_rough.png'
};

export const PLASTER_TEXTURE_FILES = {
  map: 'assets/textures/plaster_albedo.png',
  normalMap: 'assets/textures/plaster_normal.png',
  roughnessMap: 'assets/textures/plaster_rough.png'
};

export const BRICK_TEXTURE_FILES = {
  map: 'assets/textures/brick_albedo.png',
  normalMap: 'assets/textures/brick_normal.png',
  roughnessMap: 'assets/textures/brick_rough.png'
};

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
 * Chooses the material settings for the stone given whether textures loaded.
 * With textures: white base colour so the map is not tinted twice, plus normal
 * and roughness maps. Without: the original flat colour, so the plaza still reads
 * correctly if the textures are missing.
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
export async function loadMaterialTextures({
  THREE, files = STONE_TEXTURE_FILES, fetchImpl = fetch,
  createBitmap = typeof createImageBitmap === 'function' ? createImageBitmap : null
} = {}) {
  const load = async (url) => {
    try {
      if (!createBitmap) return null; // no decoder available in this context
      const response = await fetchImpl(url);
      if (!response.ok) return null;
      const blob = await response.blob();
      const bitmap = await createBitmap(blob);
      const texture = new THREE.Texture(bitmap);
      texture.needsUpdate = true;
      return texture;
    } catch {
      return null;
    }
  };
  const [map, normalMap, roughnessMap] = await Promise.all([
    load(files.map), load(files.normalMap), load(files.roughnessMap)
  ]);
  return { map, normalMap, roughnessMap, anyLoaded: Boolean(map || normalMap || roughnessMap) };
}

/** Backwards-compatible alias: the stone family is the original user. */
export const loadStoneTextures = loadMaterialTextures;
