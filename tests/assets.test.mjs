// Tests for the asset-loading rules. The important property is that the game
// keeps working when an asset does not: these drive the failure paths directly
// with a fake fetch, so "assets unavailable" is a tested state rather than a hope.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FOUNTAIN_COLLIDER, FOUNTAIN_SPOT, FOUNTAIN_ASSET, STONE_TEXTURE_FILES,
  canLoadAssets, textureRepeat, stoneMaterialParams, fountainFootprint,
  footprintFitsCollider, loadFountain, loadStoneTextures
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
      if (url.endsWith('stone_albedo.png')) return okResponse({});
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
    assert.match(url, /^assets\/textures\/.+\.png$/, `${url} is a served relative path`);
  }
});