// Tests for the asset-loading rules. The important property is that the game
// keeps working when an asset does not: these drive the failure paths directly
// with a fake fetch, so "assets unavailable" is a tested state rather than a hope.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import {
  FOUNTAIN_COLLIDER, FOUNTAIN_SPOT, FOUNTAIN_ASSET, STONE_TEXTURE_FILES,
  canLoadAssets, textureRepeat, stoneMaterialParams, plazaFloorMaterialParams,
  fountainFootprint, footprintFitsCollider, loadFountain, loadStoneTextures,
  boxProjectUvs, PLAZA_FLOOR_TEXTURE_FILES,
  terraceMaterialParams, terraceStoneParts, TERRACE_TEXTURE_TILE_METERS, cloneTextureFamily,
  LAMP_TEXTURE_FILES, LAMP_ASSET, LAMP_MODEL_SIZE, loadMaterialTextures, needsOwnMaterial,
  ROOF_TEXTURE_FILES, LEAF_TEXTURE_FILES, PROP_FAMILIES, propFamilyFor,
  fountainStoneParts, fountainStoneMaterialParams, FOUNTAIN_STONE_COLORS
} from '../src/assets.js';

// Minimal fake Three.js: only what these functions touch.
const fakeTHREE = {
  Color: class {},
  MeshStandardMaterial: class { constructor(p) { Object.assign(this, p); } },
  BufferGeometry: class {
    constructor() { this.attributes = {}; }
    setAttribute(n, a) { this.attributes[n] = a; }
    setIndex(a) { this.index = a; }
    computeVertexNormals() {}
    computeBoundingBox() {}
    computeBoundingSphere() {}
  },
  BufferAttribute: class { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; } },
  Texture: class { constructor(image) { this.image = image; } }
};

const okResponse = (body) => ({ ok: true, status: 200, arrayBuffer: async () => body, blob: async () => body });
const failResponse = (status) => ({ ok: false, status });

test('the fountain is placed at the plaza centre where the game already had one', () => {
  assert.deepEqual(FOUNTAIN_SPOT, { x: 0, z: 0 });
  // The old procedural fountain sat on a 4x4 block, i.e. +/-2. A collider smaller
  // than that would let the player walk into the new stonework.
  assert.ok(FOUNTAIN_COLLIDER >= 2, 'the collider covers the old footprint');
  assert.ok(FOUNTAIN_COLLIDER <= 2.5, 'and is not so large it blocks the walkways');
});

test('assets are skipped when the context cannot fetch them', () => {
  assert.equal(canLoadAssets({ hasFetch: false, protocol: 'http:' }), false);
  assert.equal(canLoadAssets({ hasFetch: true, protocol: 'file:' }), false,
    'a file:// page cannot fetch siblings reliably');
  assert.equal(canLoadAssets({ hasFetch: true, protocol: 'http:' }), true);
  assert.equal(canLoadAssets({ hasFetch: true, protocol: 'https:' }), true);
});

test('texture tiling keeps density roughly constant across surface sizes', () => {
  // A 2 m tile on a 2 m face repeats once; a 6 m wall repeats three times.
  assert.deepEqual(textureRepeat(2, 2), { repeatX: 1, repeatY: 1 });
  assert.deepEqual(textureRepeat(6, 2), { repeatX: 3, repeatY: 1 });
  assert.deepEqual(textureRepeat(6, 6), { repeatX: 3, repeatY: 3 });
  // Never zero or negative, which would make the texture vanish.
  const degenerate = textureRepeat(0, -5);
  assert.ok(degenerate.repeatX >= 1 && degenerate.repeatY >= 1);
  const nan = textureRepeat(NaN, undefined);
  assert.ok(Number.isFinite(nan.repeatX) && Number.isFinite(nan.repeatY));
});

test('stone falls back to the original flat colour when textures are missing', () => {
  const withMaps = stoneMaterialParams(true);
  assert.equal(withMaps.color, 0xffffff, 'a texture map must not be tinted twice');
  assert.equal(withMaps.useMaps, true);

  const without = stoneMaterialParams(false);
  assert.equal(without.color, 0xb3a892, 'the plaza keeps its original colour');
  assert.equal(without.useMaps, false);
  assert.equal(without.roughness, 0.9);
});

test('the plaza floor keeps its dressed-paving colour when maps are missing', () => {
  const withMaps = plazaFloorMaterialParams(true);
  assert.equal(withMaps.color, 0xffffff, 'a texture map must not be tinted twice');
  assert.equal(withMaps.useMaps, true);
  assert.equal(withMaps.roughness, 1);

  const without = plazaFloorMaterialParams(false);
  assert.equal(without.useMaps, false);
  // Distinct from the wall stone: the plaza is lighter dressed paving, so a
  // missing texture still leaves the two surfaces readable as different places.
  assert.notEqual(without.color, stoneMaterialParams(false).color);
  assert.ok(without.roughness < stoneMaterialParams(false).roughness);
});

test('the plaza floor family is a separate set of files from the lane cobbles', () => {
  assert.deepEqual(
    Object.keys(PLAZA_FLOOR_TEXTURE_FILES).sort(),
    ['map', 'normalMap', 'roughnessMap']
  );
  for (const url of Object.values(PLAZA_FLOOR_TEXTURE_FILES)) {
    assert.match(url, /^assets\/textures\/plaza_floor_.+\.webp$/, `${url} is a served relative path`);
  }
  // No file may be shared with the stone wall family: a shared map would mean
  // the plaza and the border walls were really the same surface.
  const walls = new Set(Object.values(STONE_TEXTURE_FILES));
  for (const url of Object.values(PLAZA_FLOOR_TEXTURE_FILES)) {
    assert.equal(walls.has(url), false, `${url} is not also a wall stone map`);
  }
});

test('the plaza floor maps are all present on disk', () => {
  for (const url of Object.values(PLAZA_FLOOR_TEXTURE_FILES)) {
    assert.ok(existsSync(new URL(`../${url}`, import.meta.url)), `${url} exists`);
  }
});

test('the terrace reuses the wall stone family instead of a third set of maps', () => {
  // The terrace, its ramp and the parapet are the same quarried stone as the
  // border walls, so sharing the family is the point -- there is no terrace
  // texture file and there should not be one.
  const family = Object.values(STONE_TEXTURE_FILES);
  assert.equal(family.length, 3);
  for (const url of family) {
    assert.ok(existsSync(new URL(`../${url}`, import.meta.url)), `${url} exists`);
  }
  assert.equal(
    Object.values(PLAZA_FLOOR_TEXTURE_FILES).some((url) => family.includes(url)),
    false,
    'the terrace stone is not the plaza flagstone'
  );
});

test('terrace tread and parapet stay distinguishable without maps', () => {
  const tread = terraceMaterialParams(false, 'tread');
  const parapet = terraceMaterialParams(false, 'parapet');
  assert.notEqual(tread.color, parapet.color, 'a missing map must not flatten the step edge');
  assert.equal(tread.useMaps, false);
  assert.equal(parapet.useMaps, false);
  // The walked tread is the lighter surface, the upright kerb the darker one.
  assert.ok(tread.color > parapet.color);
  assert.ok(tread.roughness >= parapet.roughness);

  for (const part of ['tread', 'parapet']) {
    const withMaps = terraceMaterialParams(true, part);
    assert.equal(withMaps.color, 0xffffff, 'a texture map must not be tinted twice');
    assert.equal(withMaps.useMaps, true);
    assert.equal(withMaps.metalness, 0);
  }
});

test('the terrace groups its meshes into one walked stone and one upright band', () => {
  // The whole terrace is one built structure, so it must not accumulate a material
  // per mesh. Two shared materials keep the flat fallback edge readable and let the
  // whole north end be re-dressed by one pass.
  const parts = terraceStoneParts();
  assert.deepEqual(Object.keys(parts).sort(), ['parapet', 'tread']);
  assert.deepEqual(parts.tread, ['terrace-tread', 'terrace-ramp']);
  assert.deepEqual(parts.parapet, ['terrace-kerb', 'terrace-parapet']);

  // No mesh may appear in two groups: it would be dressed twice, and the second
  // pass would win on the fallback colour.
  const flat = [...parts.tread, ...parts.parapet];
  assert.equal(new Set(flat).size, flat.length);
});

test('the terrace stone projects at one believable texel density', () => {
  // Because the terrace is box-projected in metres, a single tile size governs every
  // surface -- the 12 m slab, the rotated ramp deck and the 0.18 m kerb face alike.
  // That is the property the old per-material repeat scheme could not have.
  assert.ok(TERRACE_TEXTURE_TILE_METERS >= 1 && TERRACE_TEXTURE_TILE_METERS <= 2.5,
    `${TERRACE_TEXTURE_TILE_METERS} m is ashlar scale, not gravel or paving`);

  // Projecting a real box at that tile size must produce more than one joint across
  // each visible surface, or the map would look smeared rather than coursed.
  const surfaces = {
    tread: [12, 3.3],   // terrace top slab
    ramp: [3.8, 4.77],  // ramp deck, measured up the slope
    kerb: [0.18, 4.77], // one ramp kerb face
    parapet: [6.2, 0.55]
  };
  for (const [label, [width, depth]] of Object.entries(surfaces)) {
    const across = width / TERRACE_TEXTURE_TILE_METERS;
    const along = depth / TERRACE_TEXTURE_TILE_METERS;
    assert.ok(Math.max(across, along) >= 1.5, `${label} shows at least one joint`);
  }

  // And the ramp must not shear: a box-projected UV pair is derived from the two
  // axes perpendicular to each face's normal, so the slope is absorbed by geometry,
  // not by stretching a repeat. Assert that on a real wedge.
  const slope = Math.atan2(1.2, 4.4);
  const box = [
    // two triangles of the ramp deck's top face, raised along +Z
    [-1.9, 0, -2.2], [1.9, 0, -2.2], [1.9, 1.2, 2.2],
    [-1.9, 0, -2.2], [1.9, 1.2, 2.2], [-1.9, 1.2, 2.2]
  ];
  assert.ok(Number.isFinite(slope));
  const positions = box.flat();
  const uvs = boxProjectUvs({ positions, tileMeters: TERRACE_TEXTURE_TILE_METERS });
  assert.equal(uvs.length, positions.length / 3 * 2);
  // The top face is Y-dominant, so a metre of X and a metre of Z are each one tile.
  for (const [i, u] of uvs.entries()) {
    assert.ok(Number.isFinite(u), `uv ${i} is finite`);
    assert.ok(Math.abs(u) < 10, `uv ${i} stays inside a sane tile count, got ${u}`);
  }

  // Two deck vertices a metre apart along X must differ by exactly one tile in U.
  const tile = TERRACE_TEXTURE_TILE_METERS;
  const uAt = (x) => uvs[positions.indexOf(x) / 3 * 2];
  const uMinus = uAt(-1.9);
  const uPlus = uAt(1.9);
  assert.ok(Math.abs((uPlus - uMinus) - 3.8 / tile) < 1e-5,
    `3.8 m of deck spans 3.8/${tile} tiles, got ${(uPlus - uMinus).toFixed(3)}`);
});

test('a cloned texture family carries its own sampler state', () => {
  // Two materials cannot share one texture object and still tile differently:
  // repeat/wrap/anisotropy live on the texture. Prove the clone is independent.
  const source = {
    map: { repeat: { set() {} }, wrapS: 0, wrapT: 0, anisotropy: 1, needsUpdate: false },
    normalMap: { repeat: { set() {} }, wrapS: 0, wrapT: 0, anisotropy: 1, needsUpdate: false },
    roughnessMap: null,
    anyLoaded: true
  };
  for (const key of ['map', 'normalMap']) {
    source[key].clone = function clone() {
      return { ...this, repeat: { set() {} }, cloned: true };
    };
  }
  const copy = cloneTextureFamily(source);
  assert.equal(copy.anyLoaded, true);
  assert.notEqual(copy.map, source.map, 'the map is a distinct object');
  assert.notEqual(copy.normalMap, source.normalMap, 'the normal map is a distinct object');
  assert.equal(copy.roughnessMap, null);
  assert.equal(copy.map.cloned, true);
  assert.equal(copy.map.needsUpdate, true, 'a clone must be uploaded before use');

  // A family that never loaded must clone to an empty family, not throw.
  const empty = cloneTextureFamily({ map: null, normalMap: null, roughnessMap: null, anyLoaded: false });
  assert.equal(empty.anyLoaded, false);
  assert.equal(empty.map, null);
});

test('the footprint measure covers every mesh', () => {
  // fountainFootprint walks { geometry, material } mesh descriptions, matching what
  // glbToMeshes returns -- not raw geometry objects.
  const box = (minY, maxY, r) => ({
    geometry: { boundingBox: { min: { x: -r, y: minY, z: -r }, max: { x: r, y: maxY, z: r } } }
  });
  const meshes = [box(0, 0.4, 1.95), box(0, 2.24, 0.2)];
  const footprint = fountainFootprint(meshes);
  assert.equal(footprint.minY, 0);
  assert.equal(footprint.maxY, 2.24);
  assert.equal(footprint.width, 3.9);
  assert.equal(footprint.height, 2.24);
  assert.equal(fountainFootprint([]), null, 'no meshes means no footprint');
});

test('the fountain must fit inside its collider', () => {
  const fits = { minX: -1.95, maxX: 1.95, minY: 0, maxY: 2.24, minZ: -1.95, maxZ: 1.95 };
  assert.equal(footprintFitsCollider(fits), true);
  // A model that grew past the collider is rejected, so the player cannot walk
  // through visible stone.
  const tooWide = { ...fits, maxX: 2.6 };
  assert.equal(footprintFitsCollider(tooWide), false);
  assert.equal(footprintFitsCollider(null), false);
});

test('a successful load reports its real footprint and size', async () => {
  const vertices = new Float32Array([-1, 0, -1, 1, 2, 1, 0, 1, 0]);
  const stubLoadGlb = () => [{
    geometry: {
      attributes: { position: { array: vertices } },
      boundingBox: { min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 2, z: 1 } }
    }
  }];
  const result = await loadFountain({
    THREE: fakeTHREE,
    loadGlb: stubLoadGlb,
    fetchImpl: async () => okResponse(new ArrayBuffer(64))
  });
  assert.equal(result.ok, true);
  assert.equal(result.footprint.height, 2);
  assert.equal(result.bytes, 64);
  assert.equal(result.url, FOUNTAIN_ASSET);
});

test('a failed fetch reports why, and never throws', async () => {
  const missing = await loadFountain({
    THREE: fakeTHREE, loadGlb: () => [],
    fetchImpl: async () => failResponse(404)
  });
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /404/);

  const offline = await loadFountain({
    THREE: fakeTHREE, loadGlb: () => [],
    fetchImpl: async () => { throw new Error('Failed to fetch'); }
  });
  assert.equal(offline.ok, false);
  assert.match(offline.reason, /Failed to fetch/);

  const corrupt = await loadFountain({
    THREE: fakeTHREE,
    loadGlb: () => { throw new Error('not a GLB file'); },
    fetchImpl: async () => okResponse(new ArrayBuffer(8))
  });
  assert.equal(corrupt.ok, false);
  assert.match(corrupt.reason, /not a GLB/);
});

test('a model larger than the collider is refused rather than clipping', async () => {
  const result = await loadFountain({
    THREE: fakeTHREE,
    loadGlb: () => [{
      geometry: { boundingBox: { min: { x: -9, y: 0, z: -9 }, max: { x: 9, y: 3, z: 9 } } }
    }],
    fetchImpl: async () => okResponse(new ArrayBuffer(16))
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /exceeds its collider/);
});

test('stone textures degrade to nulls instead of failing', async () => {
  const fakeBitmap = async () => ({ width: 512, height: 512 });
  const none = await loadStoneTextures({
    THREE: fakeTHREE,
    createBitmap: fakeBitmap,
    fetchImpl: async () => failResponse(500)
  });
  assert.equal(none.anyLoaded, false);
  assert.equal(none.map, null);
  assert.equal(none.normalMap, null);

  const offline = await loadStoneTextures({
    THREE: fakeTHREE,
    createBitmap: fakeBitmap,
    fetchImpl: async () => { throw new Error('offline'); }
  });
  assert.equal(offline.anyLoaded, false, 'a thrown fetch is treated as unavailable');

  // Partial success: one map present is still worth using.
  const requested = [];
  const partial = await loadStoneTextures({
    THREE: fakeTHREE,
    createBitmap: fakeBitmap,
    fetchImpl: async (url) => {
      requested.push(url);
      if (url.endsWith('stone_albedo.webp')) return okResponse({});
      return failResponse(404);
    }
  });
  assert.equal(partial.anyLoaded, true);
  assert.ok(partial.map, 'the albedo map survived');
  assert.equal(partial.normalMap, null);
  assert.deepEqual(requested.sort(), Object.values(STONE_TEXTURE_FILES).sort(),
    'all three maps are attempted');
});

test('a decoded texture is marked ready and keeps its image', async () => {
  const bitmap = { width: 512, height: 512, fake: true };
  const loaded = await loadStoneTextures({
    THREE: fakeTHREE,
    createBitmap: async () => bitmap,
    fetchImpl: async () => okResponse({})
  });
  assert.equal(loaded.anyLoaded, true);
  for (const key of ['map', 'normalMap', 'roughnessMap']) {
    assert.equal(loaded[key].image, bitmap, `${key} wraps the decoded bitmap`);
    assert.equal(loaded[key].needsUpdate, true, `${key} is flagged for upload`);
  }
});

test('without a decoder, textures report unavailable rather than half-loaded', async () => {
  // Node has no createImageBitmap; the browser may also lack it in odd webviews.
  // The material must then fall back to its flat colour, not render black.
  const loaded = await loadStoneTextures({
    THREE: fakeTHREE,
    createBitmap: null,
    fetchImpl: async () => okResponse({})
  });
  assert.equal(loaded.anyLoaded, false);
  assert.equal(loaded.map, null);
  assert.equal(stoneMaterialParams(loaded.anyLoaded).useMaps, false);
});

test('the texture list covers the three maps the material uses', () => {
  assert.deepEqual(Object.keys(STONE_TEXTURE_FILES).sort(), ['map', 'normalMap', 'roughnessMap']);
  for (const url of Object.values(STONE_TEXTURE_FILES)) {
    assert.match(url, /^assets\/textures\/.+\.webp$/, `${url} is a served relative path`);
  }
});
// --- boxProjectUvs: box projection for untextured prop models ---------------

test('boxProjectUvs gives a flat quad sensible UVs whatever the winding', () => {
  // A 2 m x 2 m quad in the z = 0 plane, both triangles counter-clockwise
  // seen from +y. It must project onto the (x, z) plane, not stretch.
  const positions = [
    -1, 0, -1, 1, 0, -1, 1, 0, 1,
    -1, 0, -1, 1, 0, 1, -1, 0, 1
  ];
  const uvs = boxProjectUvs({ positions, tileMeters: 1 });
  assert.equal(uvs.length, 12);
  for (const [i, expect] of [[0, [-1, -1]], [1, [1, -1]], [2, [1, 1]],
    [3, [-1, -1]], [4, [1, 1]], [5, [-1, 1]]]) {
    assert.ok(Math.abs(uvs[i * 2] - expect[0]) < 1e-6, `u${i} ${uvs[i * 2]}`);
    assert.ok(Math.abs(uvs[i * 2 + 1] - expect[1]) < 1e-6, `v${i} ${uvs[i * 2 + 1]}`);
  }
});

test('boxProjectUvs scales with the tile size instead of hard-coding it', () => {
  const positions = [0, 0, 0, 3, 0, 0, 0, 0, 3];
  const at1 = boxProjectUvs({ positions, tileMeters: 1 });
  const at3 = boxProjectUvs({ positions, tileMeters: 3 });
  // A 3 m tile means the same 3 m edge covers exactly one UV unit.
  assert.ok(Math.abs(at3[2] - 1) < 1e-6, `u at tile 3: ${at3[2]}`);
  assert.ok(Math.abs(at1[2] - 3) < 1e-6, `u at tile 1: ${at1[2]}`);
});

test('boxProjectUvs honours an index buffer and writes per vertex', () => {
  // Same quad, but indexed: four unique vertices, six indices.
  const positions = [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1];
  const indices = [0, 1, 2, 0, 2, 3];
  const uvs = boxProjectUvs({ positions, indices, tileMeters: 1 });
  assert.equal(uvs.length, 8, 'one UV pair per vertex, not per index');
  // v0 = (-1, 0, -1) projects to (u, v) = (-1, -1); v3 = (-1, 0, 1) to (-1, 1).
  assert.ok(Math.abs(uvs[0] + 1) < 1e-6, `v0.u ${uvs[0]}`);
  assert.ok(Math.abs(uvs[1] + 1) < 1e-6, `v0.v ${uvs[1]}`);
  assert.ok(Math.abs(uvs[6] + 1) < 1e-6, `v3.u ${uvs[6]}`);
  assert.ok(Math.abs(uvs[7] - 1) < 1e-6, `v3.v ${uvs[7]}`);
});

test('boxProjectUvs picks the dominant axis for a side face', () => {
  // A quad in the x = 5 plane (facing +x): UVs must come from (z, y).
  const positions = [5, 0, 0, 5, 2, 0, 5, 2, 3];
  const uvs = boxProjectUvs({ positions, tileMeters: 1 });
  // Layout is [u0, v0, u1, v1, u2, v2]; v1 is at index 3, u2 at index 4.
  assert.ok(Math.abs(uvs[3] - 2) < 1e-6, `v uses y: ${uvs[3]}`);
  assert.ok(Math.abs(uvs[4] - 3) < 1e-6, `u uses z: ${uvs[4]}`);
});

// --- The painted-iron lamp maps (round 55) ---------------------------------

test('the lamp texture family names the three iron maps and stays on disk', () => {
  assert.deepEqual(Object.keys(LAMP_TEXTURE_FILES).sort(), ['map', 'normalMap', 'roughnessMap']);
  for (const [kind, url] of Object.entries(LAMP_TEXTURE_FILES)) {
    assert.equal(url, `assets/textures/lamp_${kind === 'map' ? 'albedo' : kind === 'normalMap' ? 'normal' : 'rough'}.webp`);
    assert.ok(existsSync(new URL(`../${url}`, import.meta.url)), `${kind} map is shipped`);
  }
  // The maps belong to the lamp model, and the model must still be there or the
  // maps would dress nothing.
  assert.ok(existsSync(new URL(`../${LAMP_ASSET}`, import.meta.url)));
  assert.ok(LAMP_MODEL_SIZE.postHeight > 2 && LAMP_MODEL_SIZE.lanternHeight > 0);
});

test('the lamp maps load through the shared texture pipeline', async () => {
  // Same loader the stone/wood/bark families use: this asserts the lamp job did
  // not invent a second loading path that could drift.
  const requested = [];
  const loaded = await loadMaterialTextures({
    THREE: fakeTHREE,
    files: LAMP_TEXTURE_FILES,
    createBitmap: async () => ({ width: 512, height: 512 }),
    fetchImpl: async (url) => { requested.push(url); return okResponse({}); }
  });
  assert.equal(loaded.anyLoaded, true);
  assert.deepEqual(requested.sort(), Object.values(LAMP_TEXTURE_FILES).sort());
  // THREE.NoColorSpace is the empty string; colour is 'srgb'. Compare against the
  // real constants the loader uses rather than a literal that could drift.
  assert.equal(loaded.map.colorSpace, 'srgb');
  assert.equal(loaded.normalMap.colorSpace, loaded.roughnessMap.colorSpace);
  assert.notEqual(loaded.map.colorSpace, loaded.normalMap.colorSpace,
    'normal/rough maps must not be decoded as colour');
});

test('a missing lamp map degrades to the authored flat material', async () => {
  const loaded = await loadMaterialTextures({
    THREE: fakeTHREE,
    files: LAMP_TEXTURE_FILES,
    createBitmap: async () => ({ width: 8, height: 8 }),
    fetchImpl: async (url) => (url.endsWith('lamp_albedo.webp') ? okResponse({}) : failResponse(404))
  });
  assert.equal(loaded.anyLoaded, true);
  assert.ok(loaded.map);
  // Partial is honest: the world only reports 'textured' when something
  // actually dressed, and the maps it names must be the ones present.
  assert.equal(loaded.normalMap, null);
});

test('a material the world animates must not be shared with a cached model', () => {
  // Round 55's real bug: loadLampAsset() caches one parse, so the lane post and
  // the four plaza posts held the same material objects. applyPhase() writes the
  // lane head's emissiveIntensity to 0 every daylight frame, and that turned all
  // four plaza lanterns dark -- caught by a browser check, not by any unit test.
  assert.equal(needsOwnMaterial({ mutatesMaterial: true, sharedSource: true }), true,
    'animating a cached material must clone it');
  // Sharing is still fine when nobody writes to the material.
  assert.equal(needsOwnMaterial({ mutatesMaterial: false, sharedSource: true }), false);
  // And a material the caller already owns needs no clone.
  assert.equal(needsOwnMaterial({ mutatesMaterial: true, sharedSource: false }), false);
  // Degenerate input must not accidentally claim ownership.
  assert.equal(needsOwnMaterial(), false);
  assert.equal(needsOwnMaterial({}), false);
});

// --- Round 63: the prop material families ------------------------------------
//
// The roof and canopy were the two largest flat masses left in the plaza (about
// 190 m2 and 271 m2 of untextured triangles). These tests hold the two decisions
// that make one family dress many differently-sized props honestly: which name
// picks which family, and that the bark/wood overlap resolves the right way.

test('the roof and leaf families name their three maps and stay on disk', () => {
  for (const family of [ROOF_TEXTURE_FILES, LEAF_TEXTURE_FILES]) {
    assert.ok(family.map, 'the family needs an albedo map');
    assert.ok(family.normalMap, 'the family needs a normal map');
    assert.ok(family.roughnessMap, 'the family needs a roughness map');
    for (const file of Object.values(family)) {
      assert.ok(existsSync(new URL(`../${file}`, import.meta.url)),
        `${file} must be committed next to the other textures`);
    }
  }
});

test('propFamilyFor picks the family from the authored material name', () => {
  // The names Blender actually exports in the prop GLBs.
  assert.equal(propFamilyFor('HouseRoof').id, 'roof');
  assert.equal(propFamilyFor('MarketRoof').id, 'roof');
  assert.equal(propFamilyFor('StallRoof').id, 'roof');
  assert.equal(propFamilyFor('Canopy').id, 'leaf');
  assert.equal(propFamilyFor('BenchWood').id, 'wood');
  assert.equal(propFamilyFor('CrateWood').id, 'wood');
  assert.equal(propFamilyFor('MarketWood').id, 'wood');
  assert.equal(propFamilyFor('DoorWood').id, 'wood');
  assert.equal(propFamilyFor('Trunk').id, 'bark');
});

test('material names that are not props stay flat', () => {
  // Iron, glass and stone trim are what make the props read as mixed materials;
  // dressing them would flatten that contrast back out.
  // These are the real material names the shipped GLBs carry.
  for (const name of ['BarrelIron', 'LampIron', 'LampGlass', 'StoneDark', 'Cloth',
    'Skin', 'EyeIris', 'Paper', 'Steel', 'Water', 'HouseBrick', 'HouseGlass', '']) {
    assert.equal(propFamilyFor(name), null, `${name} must not match a family`);
  }
  assert.equal(propFamilyFor(null), null);
  assert.equal(propFamilyFor(undefined), null);
});

test('BarkWood resolves to bark, not the wood family it also matches', () => {
  // upgradeBark() renames the trunks to `BarkWood`, which contains "Wood". If the
  // wood family were tested first, the later prop pass would overwrite the trunk
  // maps with plank grain -- a real bug this ordering prevents.
  assert.equal(propFamilyFor('BarkWood').id, 'bark');
});

test('a family whose maps failed degrades to the next matching one', () => {
  // With no bark maps downloaded, a BarkWood trunk should still get wood grain
  // rather than render flat.
  const barkFailed = (family) => family.id !== 'bark';
  assert.equal(propFamilyFor('BarkWood', barkFailed).id, 'wood');
  // If nothing matching loaded, the first (unloaded) match is returned so the
  // caller's own anyLoaded check can skip it and leave the material flat.
  const nothingLoaded = () => false;
  assert.equal(propFamilyFor('HouseRoof', nothingLoaded).id, 'roof');
});

test('every family declares a positive metre tile size for the box projection', () => {
  for (const family of PROP_FAMILIES) {
    assert.ok(family.tileMeters > 0, `${family.id} needs a positive tileMeters`);
    assert.ok(family.roughness >= 0 && family.roughness <= 1,
      `${family.id} roughness must be a real value`);
    assert.ok(family.files.map.startsWith('assets/textures/'),
      `${family.id} maps must live in the served texture directory`);
  }
});

// --- The gate and the fountain's quarried stone -----------------------------
// The border walls, the terrace and now the gate piers/lintel and the modelled
// fountain are all the same quarried stone. They share one texture request and
// clone their sampler state, so these tests pin the rules that keeps honest:
// one family, projected in metres, and a material per surface that is never
// tinted twice.

test('the gate and fountain stone reuse the wall stone family, not a fourth set', () => {
  // STONE_TEXTURE_FILES is the single source of quarried stone. If someone adds a
  // gate_*.webp or fountain_*.webp set, this fails and the decision gets revisited
  // rather than quietly shipping a third near-duplicate family.
  const family = Object.values(STONE_TEXTURE_FILES);
  assert.equal(family.length, 3, 'one stone family: albedo, normal, roughness');
  for (const url of family) {
    assert.ok(!/gate|fountain/i.test(url), `${url} must not be a separate stone set`);
    assert.ok(existsSync(new URL(`../${url}`, import.meta.url)), `${url} exists`);
  }
});

test('the fountain stone parts cover every stone mesh and no water surface', () => {
  const parts = fountainStoneParts();
  assert.deepEqual(Object.keys(parts).sort(), ['dark', 'stone']);
  assert.deepEqual(parts.stone, [
    'FountainPlinthUpper', 'FountainBasin', 'FountainColumn', 'FountainUpperBowl'
  ]);
  assert.deepEqual(parts.dark, [
    'FountainPlinthLower', 'FountainFinial',
    'FountainCornerBlock0', 'FountainCornerBlock1', 'FountainCornerBlock2', 'FountainCornerBlock3'
  ]);
  const all = [...parts.stone, ...parts.dark];
  // The model has 12 meshes; two of them are Water and must never be dressed.
  assert.equal(all.length, 10, 'ten stone meshes, two water meshes left alone');
  assert.equal(new Set(all).size, all.length, 'no mesh is dressed twice');
  for (const name of all) {
    assert.ok(!/Water/i.test(name), `${name} is not a water surface`);
  }
});

test('the fountain keeps its two stones distinguishable with and without maps', () => {
  // StoneDark exists to be visibly darker than Stone. A flat fallback that matched
  // them would erase the plinth, finial and corner blocks the moment assets fail.
  const stone = fountainStoneMaterialParams(false, 'Stone');
  const dark = fountainStoneMaterialParams(false, 'StoneDark');
  assert.notEqual(stone.color, dark.color, 'the two stones must not collapse to one');
  assert.equal(stone.color, FOUNTAIN_STONE_COLORS.Stone);
  assert.equal(dark.color, FOUNTAIN_STONE_COLORS.StoneDark);
  assert.ok(dark.roughness !== undefined && stone.roughness !== undefined);
  assert.equal(stone.useMaps, false);
  assert.equal(dark.useMaps, false);

  // With maps the base colour must stay white, or the albedo is tinted twice.
  for (const name of ['Stone', 'StoneDark']) {
    const dressed = fountainStoneMaterialParams(true, name);
    assert.equal(dressed.color, 0xffffff, `${name} maps must not be tinted twice`);
    assert.equal(dressed.roughness, 1);
    assert.equal(dressed.metalness, 0);
    assert.equal(dressed.useMaps, true);
  }
});

test('the gate piers and fountain stone project at the terrace tile size', () => {
  // A fountain bowl and a 0.2 m corner block sit metres apart in the plaza. If they
  // projected at different tile sizes their ashlar courses would clash, so they all
  // use the one constructed-stone scale.
  assert.ok(TERRACE_TEXTURE_TILE_METERS >= 1 && TERRACE_TEXTURE_TILE_METERS <= 2.5);

  // The gate pier is a 0.7 x 4.1 x 1.4 box and the lintel a 4.4 x 0.55 x 1.4 box;
  // both must show more than one joint across their tallest face, or the map reads
  // as a smear rather than courses.
  for (const [label, width, height] of [
    ['gate pier', 0.7, 4.1],
    ['gate lintel', 4.4, 0.55],
    ['fountain basin', 2.99, 0.5],
    ['fountain plinth', 3.9, 0.18]
  ]) {
    assert.ok(Math.max(width, height) / TERRACE_TEXTURE_TILE_METERS >= 1.35,
      `${label} shows at least one joint`);
  }

  // Thin members are the exception and that is expected, not a defect: a 0.55 m
  // column or a 0.24 m finial is smaller than one 1.6 m tile, so it shows a
  // partial course. That still beats the smooth flat colour it had, because the
  // partial course carries the same surface fabric as the basin beside it.
  for (const [label, width, height] of [
    ['fountain column', 0.55, 1.15],
    ['fountain finial', 0.24, 0.32]
  ]) {
    assert.ok(Math.max(width, height) / TERRACE_TEXTURE_TILE_METERS < 1,
      `${label} is thinner than one tile by design`);
  }
});

test('box-projecting a UV-less fountain mesh produces one uv per vertex', () => {
  // The fountain GLB ships POSITION+NORMAL only, so the dressing pass has to
  // generate UVs from scratch. This is the shape of that call: a 2.99 m basin disc
  // as two triangles, projected at the terrace tile size.
  const r = 1.495;
  const positions = [
    -r, 0, -r, r, 0, -r, r, 0, r,
    -r, 0, -r, r, 0, r, -r, 0, r
  ];
  const uvs = boxProjectUvs({ positions, tileMeters: TERRACE_TEXTURE_TILE_METERS });
  assert.ok(uvs instanceof Float32Array);
  assert.equal(uvs.length, (positions.length / 3) * 2);
  for (const [i, value] of uvs.entries()) {
    assert.ok(Number.isFinite(value), `uv ${i} is finite`);
  }
  // A Y-dominant face projects X and Z: two vertices 2.99 m apart along X must be
  // 2.99/1.6 tiles apart in U, not a whole tile. Vertex 0 sits at x=-r, vertex 1 at
  // x=+r, so the difference between their U values is the full basin width in tiles.
  const tile = TERRACE_TEXTURE_TILE_METERS;
  assert.ok(Math.abs((uvs[2] - uvs[0]) - (2 * r) / tile) < 1e-5,
    'a flat basin top tiles at the projected metre scale');
});

test('the gate and fountain stone share the wall stone request', () => {
  // One fetch for walls, terrace, gate and fountain: these are the same three
  // files, and a second request for them would be a wasted download on a mobile
  // connection. cloneTextureFamily shares the decoded bitmap and only separates the
  // sampler state, so every consumer can still tile independently.
  const textures = {
    map: { clone() { return { kind: 'map', repeat: { set() {} } }; } },
    normalMap: { clone() { return { kind: 'normal', repeat: { set() {} } }; } },
    roughnessMap: null,
    anyLoaded: true
  };
  const gate = cloneTextureFamily(textures);
  const fountain = cloneTextureFamily(textures);
  assert.equal(gate.anyLoaded, true);
  assert.notEqual(gate.map, textures.map, 'the gate gets its own sampler state');
  assert.notEqual(gate.map, fountain.map, 'the fountain and gate do not share one');
  assert.equal(gate.roughnessMap, null, 'a missing map stays missing');
  assert.equal(fountain.roughnessMap, null);
});
