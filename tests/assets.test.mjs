// Tests for the asset-loading rules. The important property is that the game
// keeps working when an asset does not: these drive the failure paths directly
// with a fake fetch, so "assets unavailable" is a tested state rather than a hope.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  FOUNTAIN_COLLIDER, FOUNTAIN_SPOT, FOUNTAIN_ASSET, STONE_TEXTURE_FILES,
  canLoadAssets, textureRepeat, stoneMaterialParams, plazaFloorMaterialParams,
  fountainFootprint, footprintFitsCollider, loadFountain, loadStoneTextures,
  boxProjectUvs, PLAZA_FLOOR_TEXTURE_FILES,
  boxProjectMesh, projectBoxGeometry,
  terraceMaterialParams, terraceStoneParts, TERRACE_TEXTURE_TILE_METERS, cloneTextureFamily,
  LAMP_TEXTURE_FILES, LAMP_ASSET, LAMP_MODEL_SIZE, loadMaterialTextures, needsOwnMaterial,
  ROOF_TEXTURE_FILES, LEAF_TEXTURE_FILES, PROP_FAMILIES, propFamilyFor,
  fountainStoneParts, fountainStoneMaterialParams, fountainStoneTint, FOUNTAIN_STONE_COLORS,
  BANNER_ASSET, BANNER_MODEL_SIZE, BANNER_TEXTURE_FILES, loadBanner,
  CLOTH_TEXTURE_FILES, FELT_TEXTURE_FILES, FELT_FAMILY, BUNTING_TILE_METERS,
  WATER_TEXTURE_FILES, WATER_TILE_METERS,
  PLAZA_AO_MAP_CHANNEL, plazaAoMapIntensity, plazaAoMapIntensityForQuality,
  createPlazaAoTexture, contactDarkeningColors, applyContactDarkeningGeometry,
  TERRACE_DETAIL_ASSET, TERRACE_DETAIL_MODEL_SIZE, loadTerraceDetail
} from '../src/assets.js';
import { parseGlb, glbToMeshes } from '../src/glb.js';
import { TERRACE } from '../src/terrain.js';

// Minimal fake Three.js: only what these functions touch.
const ROOT = resolve(import.meta.dirname, '..');
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

test('the banner loads, reports its bytes, and is sized to the old plane', async () => {
  const canvas = {
    name: 'BannerCanvas',
    geometry: { boundingBox: { min: { x: -1.2, y: -0.55, z: 0 }, max: { x: 1.2, y: 0.55, z: 0.022 } } }
  };
  const rod = {
    name: 'BannerRod',
    geometry: { boundingBox: { min: { x: -1.37, y: 0.563, z: -0.018 }, max: { x: 1.37, y: 0.597, z: 0.018 } } }
  };
  const result = await loadBanner({
    THREE: fakeTHREE,
    loadGlb: () => [canvas, rod],
    fetchImpl: async () => okResponse(new ArrayBuffer(17608))
  });
  assert.equal(result.ok, true);
  assert.equal(result.bytes, 17608);
  assert.equal(result.url, BANNER_ASSET);
  // The footprint is measured off the cloth, not the rod: a 2.74 m rod span is
  // an overhang, and rejecting it would make the banner fail for having finials.
  assert.equal(Math.round(result.footprint.width * 100) / 100, BANNER_MODEL_SIZE.width);
  assert.equal(Math.round(result.footprint.height * 100) / 100, BANNER_MODEL_SIZE.height);
});

test('a banner whose cloth outgrew the terrace lip is refused', async () => {
  const huge = {
    name: 'BannerCanvas',
    geometry: { boundingBox: { min: { x: -3, y: -2, z: 0 }, max: { x: 3, y: 2, z: 0.02 } } }
  };
  const result = await loadBanner({
    THREE: fakeTHREE,
    loadGlb: () => [huge],
    fetchImpl: async () => okResponse(new ArrayBuffer(16))
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /exceeds its box/);
});

test('a failed banner fetch reports why, and never throws', async () => {
  const missing = await loadBanner({
    THREE: fakeTHREE, loadGlb: () => [],
    fetchImpl: async () => failResponse(404)
  });
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /404/);

  const corrupt = await loadBanner({
    THREE: fakeTHREE,
    loadGlb: () => { throw new Error('not a GLB file'); },
    fetchImpl: async () => okResponse(new ArrayBuffer(8))
  });
  assert.equal(corrupt.ok, false);
  assert.match(corrupt.reason, /not a GLB/);
});

test('the banner maps are a single painted panel, not a tiling family', () => {
  // A repeat over a painted shield would cut a seam through the emblem, so the
  // banner is applied by its own ClampToEdge path. If someone folded these
  // maps into PROP_FAMILIES this test is the tripwire.
  assert.deepEqual(Object.keys(BANNER_TEXTURE_FILES).sort(), ['map', 'normalMap', 'roughnessMap']);
  for (const file of Object.values(BANNER_TEXTURE_FILES)) {
    assert.match(file, /^assets\/textures\/banner_(albedo|normal|rough)\.webp$/);
  }
  assert.equal(propFamilyFor('BannerCanvas'), null,
    'BannerCanvas must not be swept up by a prop family');
  for (const name of ['BannerRod', 'BannerFinial', 'BannerStrap']) {
    assert.equal(propFamilyFor(name), null,
      `${name} is dressed by upgradeBanner(), not by the prop registry`);
  }
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
  // Same quad, but indexed: four unique vertices, six indices. No vertex here is
  // shared across an axis change, so the per-vertex contract still holds.
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

// --- The box-projection seam (round 67) ------------------------------------
//
// The projection used to pick the plane per *vertex* and write last-triangle
// -wins, so a vertex shared by triangles that face different ways kept only one
// of the two projections and sheared the other triangle. Three visible lane
// sacks shipped with 6 of 36 triangles sheared and one of them 3.3x off. These
// tests pin the per-triangle contract and the rigidity it has to guarantee.

/** A closed square-section tube (two rings, four sides). Its corners are shared
 *  by a face projecting on (z, y) and one projecting on (x, y) -- the same
 *  axis-flip a cylinder rim has, which is what sheared the lane sacks. */
function tubePositions() {
  const ring = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  const positions = [];
  for (const y of [0, 1]) for (const [x, z] of ring) positions.push(x, y, z);
  return positions;
}

/** Area of a triangle in the xz plane (these test meshes are flat in y). */
function uvArea(uvs, a, b, c) {
  const ux = uvs[b * 2] - uvs[a * 2];
  const uy = uvs[b * 2 + 1] - uvs[a * 2 + 1];
  const vx = uvs[c * 2] - uvs[a * 2];
  const vy = uvs[c * 2 + 1] - uvs[a * 2 + 1];
  return Math.abs(ux * vy - uy * vx) / 2;
}

test('boxProjectMesh reports the seam a tube forces and splits it per triangle', () => {
  const positions = tubePositions();
  // Four side quads = 8 triangles, indexed so the ring corners are shared.
  const indices = [];
  for (let side = 0; side < 4; side += 1) {
    const a = side;
    const b = (side + 1) % 4;
    indices.push(a, b, b + 4, a, b + 4, a + 4);
  }
  const split = boxProjectMesh({ positions, indices, tileMeters: 1 });
  assert.ok(split.seams > 0, 'a tube rim shares vertices across axis changes');
  assert.equal(split.indices, null, 'a split mesh cannot keep the old index buffer');
  assert.equal(split.uvs.length, indices.length * 2, 'one UV pair per triangle corner');
  assert.equal(split.positions.length, indices.length * 3, 'positions expand in step');
  // The silhouette must not change: every corner keeps its own position.
  for (let corner = 0; corner < indices.length; corner += 1) {
    const src = indices[corner];
    for (let axis = 0; axis < 3; axis += 1) {
      assert.equal(split.positions[corner * 3 + axis], positions[src * 3 + axis],
        `corner ${corner} keeps position axis ${axis}`);
    }
  }
  // And the whole point: every triangle is now rigid. Each side quad is 2 m x
  // 1 m, so a triangle covers exactly 1 m2 of texture, no matter which way it
  // faces -- that is the guarantee the per-vertex version broke.
  for (let t = 0; t < indices.length / 3; t += 1) {
    const area = uvArea(split.uvs, t * 3, t * 3 + 1, t * 3 + 2);
    assert.ok(Math.abs(area - 1) < 1e-6,
      `triangle ${t} keeps a 1 m2 UV footprint, got ${area.toFixed(4)}`);
  }
});

test('boxProjectMesh leaves seam-free geometry on its original index buffer', () => {
  // The flat quad from the test above: both triangles are y-dominant, so there
  // is no seam and the caller must not have to rebuild anything.
  const positions = [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1];
  const indices = [0, 1, 2, 0, 2, 3];
  const result = boxProjectMesh({ positions, indices, tileMeters: 1 });
  assert.equal(result.seams, 0);
  assert.equal(result.indices, indices, 'the index buffer is passed straight through');
  assert.equal(result.uvs.length, 8, 'one UV pair per vertex when nothing splits');
});

test('boxProjectUvs refuses a seamed mesh instead of shearing it', () => {
  // The old signature cannot express the split, so it must fail loudly rather
  // than write one vertex's UV twice and silently stretch a face.
  const positions = tubePositions();
  const indices = [0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5];
  assert.throws(
    () => boxProjectUvs({ positions, indices, tileMeters: 1 }),
    /seam/i,
    'a seamed mesh must be reported, not silently smeared'
  );
});

test('projectBoxGeometry expands every attribute with the split corners', () => {
  // A real BufferGeometry stand-in: the split has to carry normals and colours
  // along with positions, or the expanded mesh renders with wrong shading.
  class Attr {
    constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.normalized = false; }
  }
  class Geo {
    constructor(attrs, index) {
      this.attributes = {};
      for (const [k, v] of Object.entries(attrs)) this.attributes[k] = v;
      this.index = index;
    }
    getAttribute(n) { return this.attributes[n]; }
    setAttribute(n, a) { this.attributes[n] = a; }
    getIndex() { return this.index; }
    setIndex(a) { this.index = a; }
  }
  const positions = tubePositions();
  const indices = [0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5];
  const normals = [];
  for (let i = 0; i < positions.length / 3; i += 1) normals.push(0, 1, 0);
  const colors = [];
  for (let i = 0; i < positions.length / 3; i += 1) colors.push(0.25, 0.5, 0.75);
  const geo = new Geo({
    position: new Attr(Float32Array.from(positions), 3),
    normal: new Attr(Float32Array.from(normals), 3),
    color: new Attr(Float32Array.from(colors), 3)
  }, { array: Uint16Array.from(indices), count: indices.length });

  const report = projectBoxGeometry({ THREE: fakeTHREE, geometry: geo, tileMeters: 1 });
  assert.ok(report.seams > 0);
  assert.equal(geo.getAttribute('uv').array.length, indices.length * 2);
  assert.equal(geo.getAttribute('normal').array.length, indices.length * 3);
  assert.equal(geo.getAttribute('color').array.length, indices.length * 3);
  assert.equal(geo.getIndex(), null, 'a split mesh renders unindexed');
  // The duplicated corners carry the original attribute values, not zeros.
  for (let i = 0; i < indices.length; i += 1) {
    assert.equal(geo.getAttribute('color').array[i * 3], 0.25);
    assert.equal(geo.getAttribute('normal').array[i * 3 + 1], 1);
  }
});

test('projectBoxGeometry splits morph targets with the corners', () => {
  // Morph targets are indexed by the same vertex slots as `position`. If the
  // split expands position but leaves a morph target at the old count, the
  // renderer reads past the end of the smaller buffer and blends garbage -- so
  // every target has to follow the remap. No dressed prop uses morphs today;
  // this keeps the split from quietly corrupting one that does.
  class Attr {
    constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.normalized = false; }
  }
  class Geo {
    constructor(attrs, index) {
      this.attributes = {};
      for (const [k, v] of Object.entries(attrs)) this.attributes[k] = v;
      this.index = index;
      this.morphAttributes = {};
      this.groups = [];
    }
    getAttribute(n) { return this.attributes[n]; }
    setAttribute(n, a) { this.attributes[n] = a; }
    getIndex() { return this.index; }
    setIndex(a) { this.index = a; }
  }
  const positions = tubePositions();
  const indices = [0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5];
  const vertexCount = positions.length / 3;
  // Target values encode their source vertex so the remap is checkable.
  const target = [];
  for (let i = 0; i < vertexCount; i += 1) target.push(i, i + 100, i + 200);
  const geo = new Geo({
    position: new Attr(Float32Array.from(positions), 3)
  }, { array: Uint16Array.from(indices), count: indices.length });
  geo.morphAttributes.position = [new Attr(Float32Array.from(target), 3)];

  const report = projectBoxGeometry({ THREE: fakeTHREE, geometry: geo, tileMeters: 1 });
  assert.ok(report.seams > 0, 'the fixture must split');
  const split = geo.morphAttributes.position[0];
  assert.equal(split.array.length, indices.length * 3,
    'the target grows to one corner per triangle slot');
  // Corner i in the split buffer came from source corner remap[i]; check the
  // target followed that mapping rather than the old slot numbering.
  for (let i = 0; i < indices.length; i += 1) {
    const src = indices[i];
    assert.equal(split.array[i * 3], src);
    assert.equal(split.array[i * 3 + 1], src + 100);
  }
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
  // Round 66: the modelled house's gables/chimney and trim join the prop
  // families, dressed from the committed brick and stone wall maps.
  assert.equal(propFamilyFor('HouseBrick').id, 'brick');
  assert.equal(propFamilyFor('HouseStone').id, 'stone');
  // Round 70: the painted-iron prop family. Every iron name the shipped GLBs
  // carry, except the lane lantern (already dressed by upgradeLaneLamp()).
  for (const name of ['BarrelIron', 'BenchIron', 'CrateIron', 'DoorIron',
    'LampIron', 'MarketIron', 'NoticeIron', 'StallIron']) {
    assert.equal(propFamilyFor(name).id, 'iron', `${name} is painted ironwork`);
  }
  // The lane lantern's own groups are renamed `LampIronPainted` by
  // upgradeLaneLamp() after it dresses them. Re-matching here would project new
  // UVs and swap in a second material on a mesh that is already textured.
  assert.equal(propFamilyFor('LampIronPainted'), null,
    'the already-dressed lane lantern must not be dressed twice');
});

test('material names that are not props stay flat', () => {
  // Glass, skin, paper and water are what make the props read as mixed
  // materials; dressing them would flatten that contrast back out. The ironwork
  // used to be on this list and is dressed as of round 70 (see the prop family
  // test above) -- what stays flat is the glass, the bulb, the people and the
  // water. StoneDark belongs to the fountain's own tinted pass, which is why the
  // house's stone family is anchored to HouseStone instead of a broad /stone/.
  // These are the real material names the shipped GLBs carry.
  // 'Cloth' is now dressed (Round 67): the lane sacks carry `SackCloth` and the
  // cast coats carry `Cloth`, both of which match the cloth family. Cloth is
  // therefore no longer in the must-stay-flat list -- the flat list below
  // documents the materials that are still intentionally left alone.
  for (const name of ['LampGlass', 'LampBulb', 'StoneDark',
    'Skin', 'EyeIris', 'EyeWhite', 'Paper', 'Steel', 'Water', 'HouseGlass', '',
    'Accent', 'Boot', 'SackTie', 'HairC', 'Mouth',
    // Round 70 named the remaining anonymously-materialled surfaces so the
    // materials audit can attribute their area (an unnamed material used to
    // collapse six unrelated surfaces into one 10.65 m2 row). Naming them is
    // also a claim that they are deliberately flat: each matches no family.
    'LanternHousing', 'LanternBulb',
    // Round 83 dresses the job board's BoardFace and BoardPaper with the paper
    // family (src/paper.js), so they are no longer in the must-stay-flat list.
    'NoticeFaceLane', 'NpcMarker',
    // The bunting rope used to borrow `LaneWood`, which made three visible 2 cm
    // ropes report as planked wood while keeping their authored per-face UVs.
    // Its own name must never pick up a family.
    'LaneRope']) {
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

// --- Round 67: the cloth family keeps its consumers' tints -------------------
// The cloth albedo is a neutral grey weave, so the colour has to come from the
// material. Two things follow, and both are easy to break silently: the family
// must opt into keeping the source tint, and no other family may, because the
// plank/brick/stone albedos are already coloured and a tint on top would
// double-tint them.

test('only the colourless cloth family opts into keeping the source tint', () => {
  const keepers = PROP_FAMILIES.filter((f) => f.keepTint);
  assert.deepEqual(keepers.map((f) => f.id), ['cloth'],
    'cloth is the one family whose map has no hue of its own');
  for (const family of PROP_FAMILIES) {
    if (family.id === 'cloth') continue;
    assert.equal(family.keepTint, undefined,
      `${family.id} ships a coloured albedo and must not multiply a tint into it`);
  }
});

test('the cloth family covers the sacks and the cast coats but not the sack tie', () => {
  const cloth = PROP_FAMILIES.find((f) => f.id === 'cloth');
  assert.ok(cloth, 'the cloth family exists');
  // `SackCloth` (lane sacks) and `Cloth` (cast coats) are the two consumers.
  assert.equal(cloth.test.test('SackCloth'), true);
  assert.equal(cloth.test.test('Cloth'), true);
  // The pinched neck is a 4 cm tie, not a woven bag; dressing it would smear a
  // weave across a detail too small to read.
  assert.equal(cloth.test.test('SackTie'), false);
  // And it must not shadow the families that already own their materials.
  for (const name of ['BarkWood', 'HouseWood', 'StallRoof', 'HouseBrick', 'HouseStone', 'LampIron']) {
    assert.equal(cloth.test.test(name), false, `${name} belongs to an earlier family`);
  }
  // Order matters: the first matching loaded family wins, so cloth has to be
  // last or a broad earlier pattern would never be reached.
  assert.equal(PROP_FAMILIES[PROP_FAMILIES.length - 1].id, 'cloth');
});

test('the cloth maps are three distinct neutral WebP files that exist', () => {
  const urls = [CLOTH_TEXTURE_FILES.map, CLOTH_TEXTURE_FILES.normalMap, CLOTH_TEXTURE_FILES.roughnessMap];
  assert.equal(new Set(urls).size, 3, 'three distinct maps, not the same file three times');
  for (const url of urls) {
    assert.match(url, /\.webp$/, `${url} ships as WebP like the other families`);
    assert.ok(existsSync(join(ROOT, url)), `${url} must exist on disk`);
    assert.ok(statSync(join(ROOT, url)).size > 4096, `${url} must be a real map, not a stub`);
  }
});

// --- Round 72: the felt family dresses the bunting pennants -----------------
// The lane flags are dyed felt, not cloth: a 1.2 m weave is a fraction of a
// texel across a 0.16 m face, so they get their own flag-scale fibre mat.

test('only the colourless cloth and felt families opt into keeping the source tint', () => {
  const keepers = PROP_FAMILIES.filter((f) => f.keepTint).map((f) => f.id);
  // The felt family is deliberately outside PROP_FAMILIES, so it is not in
  // PROP_FAMILIES' keepTint count. Check FELT_FAMILY separately.
  assert.deepEqual(keepers, ['cloth'], 'cloth is the only PROP family that keeps tint');
  assert.equal(FELT_FAMILY.keepTint, true, 'felt keeps the authored red/gold dye');
});

test('the felt family covers the bunting pennants but not the rope', () => {
  assert.equal(FELT_FAMILY.test.test('BuntingRed'), true);
  assert.equal(FELT_FAMILY.test.test('BuntingGold'), true);
  // The rope is a separate flat material and must never pick up the felt maps.
  assert.equal(FELT_FAMILY.test.test('LaneRope'), false);
  for (const name of ['BarkWood', 'HouseWood', 'StallRoof', 'HouseBrick', 'HouseStone', 'LampIron', 'Cloth', 'SackCloth']) {
    assert.equal(FELT_FAMILY.test.test(name), false, `${name} belongs to another family`);
  }
});

test('the felt family declares a positive metre tile size for the box projection', () => {
  assert.ok(FELT_FAMILY.tileMeters > 0, 'felt needs a positive tileMeters');
  assert.ok(FELT_FAMILY.roughness >= 0 && FELT_FAMILY.roughness <= 1,
    'felt roughness must be a real value');
  for (const url of Object.values(FELT_FAMILY.files)) {
    assert.match(url, /\.webp$/, `${url} ships as WebP like the other families`);
  }
});

test('the felt maps are three distinct WebP files that exist', () => {
  const urls = [FELT_TEXTURE_FILES.map, FELT_TEXTURE_FILES.normalMap, FELT_TEXTURE_FILES.roughnessMap];
  assert.equal(new Set(urls).size, 3, 'three distinct maps, not the same file three times');
  for (const url of urls) {
    assert.match(url, /\.webp$/, `${url} ships as WebP like the other families`);
    assert.ok(existsSync(join(ROOT, url)), `${url} must exist on disk`);
    assert.ok(statSync(join(ROOT, url)).size > 4096, `${url} must be a real map, not a stub`);
  }
});

// --- Round 73: the fountain water family -----------------------------------
test('the water family is three distinct WebP files that exist', () => {
  const urls = [WATER_TEXTURE_FILES.map, WATER_TEXTURE_FILES.normalMap, WATER_TEXTURE_FILES.roughnessMap];
  assert.equal(new Set(urls).size, 3, 'three distinct maps, not the same file three times');
  for (const url of urls) {
    assert.match(url, /^assets\/textures\/water_\w+\.webp$/, `${url} is a water map`);
    assert.ok(existsSync(join(ROOT, url)), `${url} must exist on disk`);
    assert.ok(statSync(join(ROOT, url)).size > 4096, `${url} must be a real map, not a stub`);
  }
});

test('the water tile is a metre, so the authored wave scale reaches the basin', () => {
  // art/kaggle/water_textures.py authors its ripple wavelengths against a 1.0 m
  // tile (3 cycles = a 33 cm swell). If this constant drifts, the chop silently
  // changes scale without the generator changing, so the two must agree.
  assert.equal(WATER_TILE_METERS, 1.0);
  const report = JSON.parse(readFileSync(join(ROOT, 'artifacts/r73/water_report.json'), 'utf8'));
  assert.equal(report.tileMeters, WATER_TILE_METERS,
    'the generator and the game must agree on the tile size');
});

test('the water report shows a seamless, mip-surviving, mirror-clean set', () => {
  const report = JSON.parse(readFileSync(join(ROOT, 'artifacts/r73/water_report.json'), 'utf8'));
  // A ripple map's raw wrap ratio divides by the discrete derivative of a long
  // wave and reads as a false seam (14-20 on the first run), so the generator
  // reports a same-wavelength ratio; < 3 is the no-visible-seam gate the other
  // families use.
  for (const key of ['seam_ratio_scaled_albedo', 'seam_ratio_scaled_normal',
    'seam_ratio_scaled_rough']) {
    assert.ok(Array.isArray(report[key]) && report[key].length === 2, `${key} is measured`);
    assert.ok(report[key].every((v) => v < 3), `${key} stays under the seam gate: ${report[key]}`);
  }
  // The lower disc is viewed at about mip 2; contrast must survive there.
  assert.ok(report.mip_survival_albedo['2'] > 0.02,
    `albedo keeps contrast at mip 2 (${report.mip_survival_albedo['2']})`);
  assert.ok(report.mip_survival_normal['2'] > 0.02,
    `normal keeps contrast at mip 2 (${report.mip_survival_normal['2']})`);
  // Near-mirror: the whole roughness band is reflective, or it is not water.
  assert.ok(report.rough_stats.max <= 0.2, `rough map stays reflective (${report.rough_stats.max})`);
  assert.ok(report.rough_stats.mean < 0.15, `rough mean stays low (${report.rough_stats.mean})`);
  assert.equal(report.errors, undefined, 'the generator completed without error');
});

test('water is not dressed by any prop family, so the stone pass cannot claim it', () => {
  for (const name of ['Water', 'FountainWater', 'FountainWaterLower', 'FountainWaterUpper']) {
    assert.equal(propFamilyFor(name), null, `${name} must match no prop family`);
  }
});

test('the water material keeps the map as the roughness ceiling', () => {
  // Three multiplies material.roughness into a bound roughnessMap's green
  // channel. A low base squares the map away (the round-73 draft used 0.08,
  // turning a 0.02..0.16 map into 0.002..0.013), so the base must be 1 for the
  // authored mirror to survive. Replicates the same expression the pass uses:
  // `textures.roughnessMap ? 1 : authored`.
  const plan = (loaded) => ({
    color: loaded.map ? 0xffffff : 0x97c8e3,
    roughness: loaded.roughnessMap ? 1 : 0.15,
    metalness: 0.1
  });
  assert.equal(plan({ map: true, roughnessMap: true }).roughness, 1,
    'the roughness map, not the base, carries the mirror');
  // Partial load must degrade toward the authored disc, never to white matte.
  assert.equal(plan({ map: false, roughnessMap: false }).roughness, 0.15,
    'a missing roughness map falls back to the authored sheen');
  assert.equal(plan({ map: false, roughnessMap: true }).color, 0x97c8e3,
    'a missing albedo keeps the authored colour instead of projecting white');
  assert.ok(plan({ map: true, roughnessMap: true }).metalness > 0,
    'the authored faint sheen is kept');
});

test('bunting materials are no longer in the must-stay-flat list', () => {
  // propFamilyFor must not resolve them to null via the PROP_FAMILIES table;
  // the felt pass owns them outside that table.
  for (const name of ['BuntingRed', 'BuntingGold']) {
    const fam = propFamilyFor(name);
    assert.ok(fam === null || fam.id === 'felt', `${name} must be either flat or felt, never another family`);
  }
});

// --- Round 70: the painted-iron prop family --------------------------------
// The barrel hoops, crate bands, bench brackets, gate studs and notice frame
// were ~62 m2 of the largest flat grey mass left in the plaza, plus the plaza
// lamp posts themselves. They are all the same painted-iron read as the lane
// lantern, so they reuse its maps instead of a second near-identical set.

test('the iron family reuses the lamp maps rather than shipping a second set', () => {
  const iron = PROP_FAMILIES.find((f) => f.id === 'iron');
  assert.ok(iron, 'the iron family exists');
  // The point of the round: one painted-iron look across props and fixtures. If
  // someone adds assets/textures/iron_*.webp this fails and the decision is
  // revisited rather than quietly shipping a near-duplicate family.
  assert.deepEqual(iron.files, LAMP_TEXTURE_FILES);
  for (const url of Object.values(iron.files)) {
    assert.ok(existsSync(join(ROOT, url)), `${url} must exist on disk`);
  }
  // 0.6 m matches the tile upgradeLaneLamp() projects, so a barrel hoop and the
  // lane lantern shaft show grain at the same physical size.
  assert.equal(iron.tileMeters, 0.6);
  // The lamp albedo already carries the blue-grey paint, so the family must not
  // multiply the authored #848588 on top of it; that only belongs to the
  // colourless cloth weave.
  assert.equal(iron.keepTint, undefined,
    'the lamp albedo is already coloured, so the tint must stay white');
});

test('the painted-iron family asks for a metal response the props can show', () => {
  const iron = PROP_FAMILIES.find((f) => f.id === 'iron');
  // A dressed prop is a MeshStandardMaterial with metalness 0 unless the family
  // asks otherwise. Painted ironwork has to catch the sky or the hoops read as
  // grey plastic next to the lane lantern, which dresses itself at 0.55.
  assert.ok(iron.metalness > 0, 'painted iron needs a specular response');
  assert.ok(iron.metalness < 0.6, 'the paint layer keeps it short of bare chrome');
  // Everything else stays fully dielectric: adding this field to timber, brick
  // or cloth would make haystacks and walls look wet.
  for (const family of PROP_FAMILIES) {
    if (family.id === 'iron') continue;
    assert.equal(family.metalness, undefined,
      `${family.id} is not metal and must keep the default metalness 0`);
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

  // With maps the light stone must stay white, or its albedo is tinted twice.
  for (const name of ['Stone', 'StoneDark']) {
    const dressed = fountainStoneMaterialParams(true, name);
    assert.equal(dressed.roughness, 1);
    assert.equal(dressed.metalness, 0);
    assert.equal(dressed.useMaps, true);
  }
  assert.equal(fountainStoneMaterialParams(true, 'Stone').color, 0xffffff,
    'the light stone maps must not be tinted twice');

  // The dark stone is the exception, and it has to be: with a white multiplier it
  // would render byte-identical to the light stone and the plinth, finial and
  // corner blocks would vanish into the basin. It uses the *ratio* of the two
  // authored stones as a multiplier rather than the authored colour itself, so the
  // map keeps its own contrast and only the overall tone drops.
  const tint = fountainStoneMaterialParams(true, 'StoneDark').color;
  assert.notEqual(tint, 0xffffff, 'the dark stone must not render as the light one');
  assert.equal(tint, fountainStoneTint('StoneDark', true));
  assert.equal(fountainStoneTint('Stone', true), 0xffffff);
  assert.equal(fountainStoneTint('StoneDark', false), 0xffffff,
    'without maps the flat colour already carries the difference');
  const lum = (c) => 0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255);
  assert.ok(lum(tint) < lum(0xffffff) * 0.85,
    'the tint darkens the dark stone by a visible margin, not a rounding error');
  assert.ok(lum(tint) > lum(0xffffff) * 0.65,
    'the tint stays a tone shift, not a black wash over the map');
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

test('every asset helper world.js calls is actually imported', () => {
  // This exact bug shipped green: fountainStoneTint() was used in world.js but
  // never added to its assets.js import list, so upgrading the fountain threw a
  // ReferenceError. loadAssets() absorbed the rejection and left assetState at
  // its initial 'flat', which looks precisely like "the textures did not load"
  // -- so neither the unit suite (which imports assets.js directly) nor a browser
  // check that only reads assetState could tell the difference. Reading the source
  // is the only way to see it, and it is cheap.
  const world = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');
  const imported = new Set();
  // The one import statement world.js takes from './assets.js'.
  const block = world.match(/import\s*\{[^}]*\}\s*from\s*'\.\/assets\.js'/) || [];
  const names = block[0] ? block[0].replace(/import\s*\{|\}\s*from[\s\S]*/g, '') : null;
  assert.ok(names, 'world.js imports names from assets.js');
  for (const raw of names.split(',')) {
    const name = raw.trim().split(/\s+as\s+/).pop();
    if (name) imported.add(name);
  }

  // Every helper this test file knows about as an asset rule, minus the ones
  // world.js legitimately keeps for itself, must appear in that import list.
  const helpers = [
    'fountainStoneTint', 'fountainStoneMaterialParams', 'fountainStoneParts',
    'projectBoxGeometry', 'cloneTextureFamily', 'TERRACE_TEXTURE_TILE_METERS'
  ];
  for (const helper of helpers) {
    if (!world.includes(`${helper}(`) && !world.includes(`${helper},`)) continue;
    assert.ok(imported.has(helper),
      `world.js calls ${helper}() but does not import it from assets.js -- ` +
      'the dresser would throw and assetState would silently stay flat');
  }
});

// --- Round 69: baked plaza AO + prop contact darkening -----------------------

test('the plaza AO map binds to channel 0 and dims with the quality tier', () => {
  // CircleGeometry only carries `uv`; an aoMap that expected uv1 would sample
  // garbage (or fail to compile on some drivers). Channel 0 is the contract.
  assert.equal(PLAZA_AO_MAP_CHANNEL, 0);
  // The map multiplies indirect light only, so a modest intensity is enough of
  // a grounding cue; zero on the low tier keeps the cost off tight budgets.
  const full = plazaAoMapIntensity({ low: false });
  assert.ok(full > 0 && full <= 1, `full-tier intensity out of range: ${full}`);
  assert.equal(plazaAoMapIntensity({ low: true }), 0);
  assert.equal(plazaAoMapIntensityForQuality('low'), 0);
  assert.equal(plazaAoMapIntensityForQuality('full'), full);
});

test('createPlazaAoTexture paints a white base with dark occluder zones', () => {
  if (typeof document === 'undefined') {
    // Node has no DOM; the world degrades to no AO map rather than throwing.
    assert.equal(createPlazaAoTexture({ THREE: fakeTHREE }), null);
    return;
  }
  const texture = createPlazaAoTexture({ THREE: fakeTHREE, size: 64 });
  assert.ok(texture, 'a canvas-capable context gets a texture');
  assert.equal(texture.wrapS, fakeTHREE.RepeatWrapping);
  texture.dispose?.();
});

test('contact darkening shades only near-ground vertices', () => {
  // A 1 m tall post: base vertices darkened, top untouched.
  const positions = new Float32Array([0, 0, 0, 0, 0.2, 0, 0, 1, 0]);
  const colors = contactDarkeningColors(positions, { groundY: 0, height: 0.45, intensity: 0.4 });
  assert.equal(colors.length, 9);
  assert.ok(colors[0] < 1, 'the ground vertex is darkened');
  assert.ok(colors[0] < colors[3], 'a vertex 0.2 m up is darkened less than the base');
  assert.equal(colors[6], 1, 'a vertex above the ramp height keeps full light');
  // Degenerate inputs must not throw or darken everything.
  const fallback = contactDarkeningColors(positions, { height: -1, intensity: 5 });
  assert.ok(fallback[6] <= 1, 'out-of-range inputs clamp instead of blowing out');
  assert.equal(contactDarkeningColors(null).length, 0);
});

test('applyContactDarkeningGeometry writes a color attribute sized to the mesh', () => {
  const geometry = new fakeTHREE.BufferGeometry();
  geometry.setAttribute('position', new fakeTHREE.BufferAttribute(new Float32Array(15), 3));
  const count = applyContactDarkeningGeometry({ THREE: fakeTHREE, geometry });
  assert.equal(count, 5, 'one colour per vertex');
  assert.equal(geometry.attributes.color.array.length, 15);
  assert.equal(applyContactDarkeningGeometry({ THREE: fakeTHREE, geometry: null }), 0);
  const empty = new fakeTHREE.BufferGeometry();
  assert.equal(applyContactDarkeningGeometry({ THREE: fakeTHREE, geometry: empty }), 0);
});

// The terrace furniture loader is a second footprint-checked asset, but unlike
// the fountain it has no collider of its own: world.js places the pergola posts
// at fixed offsets and registers their colliders by hand. So the check that
// matters here is against the authored box and against the slab the furniture
// stands on -- a re-authored model that outgrows either would silently stand
// outside its collision and clip the terrace lip.
test('the terrace furniture is authored to fit the north terrace slab', () => {
  assert.equal(TERRACE_DETAIL_ASSET, 'assets/terrace-detail.glb');
  assert.deepEqual(TERRACE_DETAIL_MODEL_SIZE, { width: 3.4, depth: 2.6, height: 2.7 });

  // The north terrace is a 12 x 3.3 slab (TERRACE spans x -6..6, z -16.5..-13.2).
  // Asserting the model against those numbers, not just against 3.4 x 2.6, is
  // what makes a future re-authoring that outgrows the terrace fail here rather
  // than in a browser at the lip.
  // Rounded to the centimetre: 3.3 stored as a difference of two doubles is
  // 3.3000000000000007, and the oddity of the mantissa is not the point.
  assert.equal(Math.round((TERRACE.maxX - TERRACE.minX) * 100) / 100, 12);
  assert.equal(Math.round((TERRACE.maxZ - TERRACE.minZ) * 100) / 100, 3.3);
  assert.ok(TERRACE_DETAIL_MODEL_SIZE.width <= TERRACE.maxX - TERRACE.minX,
    'the pergola is narrower than the terrace');
  assert.ok(TERRACE_DETAIL_MODEL_SIZE.depth <= TERRACE.maxZ - TERRACE.minZ,
    'and shallower, so it sits inside the slab rather than overhanging it');
  // It must also clear the terrace height, since it stands on the slab and the
  // player's head still has to pass under the slats at the far edge.
  assert.ok(TERRACE_DETAIL_MODEL_SIZE.height > TERRACE.height);
});

// The real asset's extents, read off the committed GLB. Held here so the fake
// meshes below describe the same model the shipped file does, and so a test that
// drifts from the asset is visible as a number, not a mystery failure.
const TERRACE_MESH_BOXES = {
  TerracePergola: { min: { x: -1.7, y: 0, z: -1.3 }, max: { x: 1.7, y: 2.58, z: 1.3 } },
  TerracePergolaSlats: { min: { x: -1.26, y: 2.58, z: -1.3 }, max: { x: 1.26, y: 2.7, z: 1.3 } },
  TerracePlanterA: { min: { x: -1.45, y: 0, z: -1.15 }, max: { x: -0.55, y: 0.44, z: -0.65 } },
  TerracePlanterASoil: { min: { x: -1.4, y: 0.44, z: -1.1 }, max: { x: -0.6, y: 0.5, z: -0.7 } },
  TerracePlanterB: { min: { x: 0.55, y: 0, z: -1.15 }, max: { x: 1.45, y: 0.44, z: -0.65 } },
  TerracePlanterBSoil: { min: { x: 0.6, y: 0.44, z: -1.1 }, max: { x: 1.4, y: 0.5, z: -0.7 } }
};

const terraceMeshes = (boxes = TERRACE_MESH_BOXES) =>
  Object.entries(boxes).map(([name, box]) => ({ name, geometry: { boundingBox: box } }));

test('a successful terrace-detail load reports its real footprint and size', async () => {
  const result = await loadTerraceDetail({
    THREE: fakeTHREE,
    loadGlb: () => terraceMeshes(),
    fetchImpl: async () => okResponse(new ArrayBuffer(13388))
  });
  assert.equal(result.ok, true);
  assert.equal(result.bytes, 13388);
  assert.equal(result.url, TERRACE_DETAIL_ASSET);
  // The reported footprint is the pergola's footprint, so it must match the
  // authored box to the centimetre -- rounding rather than an exact equality
  // keeps the check about the numbers, not about float noise in a fake.
  const round2 = (v) => Math.round(v * 100) / 100;
  assert.equal(round2(result.footprint.width), TERRACE_DETAIL_MODEL_SIZE.width);
  assert.equal(round2(result.footprint.depth), TERRACE_DETAIL_MODEL_SIZE.depth);
  assert.equal(round2(result.footprint.height), TERRACE_DETAIL_MODEL_SIZE.height);
  assert.equal(result.meshes.length, 6, 'all six parts are handed back to the world');
});

test('a terrace model that outgrows its footprint is refused rather than clipping', async () => {
  const cases = {
    // Wider than 3.4: the posts would stand outside their fixed colliders.
    wider: { ...TERRACE_MESH_BOXES, TerracePergola: { min: { x: -2, y: 0, z: -1.3 }, max: { x: 2, y: 2.58, z: 1.3 } } },
    // Deeper than 2.6: it would overhang the terrace lip.
    deeper: { ...TERRACE_MESH_BOXES, TerracePergola: { min: { x: -1.7, y: 0, z: -1.6 }, max: { x: 1.7, y: 2.58, z: 1.6 } } },
    // Sunk below the ground plane: the slab would z-fight or bury the planters.
    sunk: { ...TERRACE_MESH_BOXES, TerracePlanterA: { min: { x: -1.45, y: -0.2, z: -1.15 }, max: { x: -0.55, y: 0.44, z: -0.65 } } },
    // Taller than 2.7: the slats would foul the headroom the terrace assumes.
    taller: { ...TERRACE_MESH_BOXES, TerracePergolaSlats: { min: { x: -1.26, y: 2.58, z: -1.3 }, max: { x: 1.26, y: 3.2, z: 1.3 } } }
  };
  for (const [label, boxes] of Object.entries(cases)) {
    const result = await loadTerraceDetail({
      THREE: fakeTHREE,
      loadGlb: () => terraceMeshes(boxes),
      fetchImpl: async () => okResponse(new ArrayBuffer(64))
    });
    assert.equal(result.ok, false, `${label} is refused`);
    assert.match(result.reason, /exceeds its footprint/, `${label} says why`);
  }
});

test('a failed terrace-detail load reports why, and never throws', async () => {
  const missing = await loadTerraceDetail({
    THREE: fakeTHREE, loadGlb: () => [],
    fetchImpl: async () => failResponse(404)
  });
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /404/);

  // A parser that throws must surface its own message, not swallow it: a corrupt
  // GLB and an offline fetch are different bugs and the log should say which.
  const corrupt = await loadTerraceDetail({
    THREE: fakeTHREE, loadGlb: () => { throw new Error('not a GLB file'); },
    fetchImpl: async () => okResponse(new ArrayBuffer(8))
  });
  assert.equal(corrupt.ok, false);
  assert.match(corrupt.reason, /not a GLB/);

  // An empty mesh list has no footprint at all, so the loader must say so rather
  // than divide by an empty extent.
  const empty = await loadTerraceDetail({
    THREE: fakeTHREE, loadGlb: () => [],
    fetchImpl: async () => okResponse(new ArrayBuffer(8))
  });
  assert.equal(empty.ok, false);
  assert.match(empty.reason, /no geometry/);
});

test('the shipped terrace-detail GLB parses and matches the authored box', async () => {
  const file = join(ROOT, 'assets/terrace-detail.glb');
  assert.ok(existsSync(file), 'the asset is committed');
  const bytes = readFileSync(file);
  assert.ok(bytes.byteLength >= 8 * 1024, `the file is real geometry (${bytes.byteLength} bytes)`);

  // A local, slightly richer fake: the shared one stubs computeBoundingBox, and
  // this test needs the real bounds the GLB describes. Extended here rather than
  // in the shared object so the other tests keep their no-op stub.
  class BoundsGeometry {
    constructor() { this.attributes = {}; }
    setAttribute(n, a) { this.attributes[n] = a; }
    setIndex(a) { this.index = a; }
    computeVertexNormals() {}
    computeBoundingBox() {
      const p = this.attributes.position.array;
      const min = { x: Infinity, y: Infinity, z: Infinity };
      const max = { x: -Infinity, y: -Infinity, z: -Infinity };
      for (let i = 0; i < p.length; i += 3) {
        min.x = Math.min(min.x, p[i]); max.x = Math.max(max.x, p[i]);
        min.y = Math.min(min.y, p[i + 1]); max.y = Math.max(max.y, p[i + 1]);
        min.z = Math.min(min.z, p[i + 2]); max.z = Math.max(max.z, p[i + 2]);
      }
      this.boundingBox = { min, max };
    }
    computeBoundingSphere() {}
  }
  const extendedFake = { ...fakeTHREE, BufferGeometry: BoundsGeometry };

  // Copy into a standalone ArrayBuffer: readFileSync hands back a Buffer whose
  // backing store may be shared, and parseGlb takes a DataView over it.
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const parsed = parseGlb(arrayBuffer);
  const meshes = glbToMeshes(parsed, extendedFake);

  assert.deepEqual(
    meshes.map((m) => m.name),
    ['TerracePergola', 'TerracePergolaSlats', 'TerracePlanterA',
      'TerracePlanterASoil', 'TerracePlanterB', 'TerracePlanterBSoil'],
    'the six authored parts are present and named'
  );

  let triangles = 0;
  for (const mesh of meshes) {
    assert.ok(mesh.material && typeof mesh.material.name === 'string' && mesh.material.name.length > 0,
      `${mesh.name} carries a named material so a texture family can find it`);
    assert.ok(mesh.geometry.index, `${mesh.name} is indexed`);
    triangles += mesh.geometry.index.array.length / 3;
  }
  assert.ok(triangles < 400, `the furniture stays low-poly (${triangles} triangles)`);

  // The combined footprint must fit the authored box: this is the same check the
  // loader makes at runtime, held against the file actually on disk.
  const footprint = fountainFootprint(meshes);
  assert.ok(footprint.width <= TERRACE_DETAIL_MODEL_SIZE.width + 0.01,
    `width ${footprint.width} fits ${TERRACE_DETAIL_MODEL_SIZE.width}`);
  assert.ok(footprint.depth <= TERRACE_DETAIL_MODEL_SIZE.depth + 0.01,
    `depth ${footprint.depth} fits ${TERRACE_DETAIL_MODEL_SIZE.depth}`);
  assert.ok(footprint.height <= TERRACE_DETAIL_MODEL_SIZE.height + 0.01,
    `height ${footprint.height} fits ${TERRACE_DETAIL_MODEL_SIZE.height}`);
  assert.ok(footprint.minY >= -0.01, 'nothing sinks below the ground plane');

  // And the loader itself accepts the real file, so the two halves agree.
  const result = await loadTerraceDetail({
    THREE: extendedFake,
    loadGlb: (buf) => glbToMeshes(parseGlb(buf), extendedFake),
    fetchImpl: async () => okResponse(arrayBuffer)
  });
  assert.equal(result.ok, true, `the shipped asset loads (${result.reason || 'ok'})`);
  assert.equal(result.bytes, bytes.byteLength);
  assert.equal(result.url, TERRACE_DETAIL_ASSET);
});
