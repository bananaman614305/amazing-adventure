// Tests for the GLB reader. These run against the real exported asset, so a
// Blender re-export that breaks the contract fails here rather than in a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseGlb, readAccessor, glbToMeshes, loadGlb } from '../src/glb.js';

const ASSET = resolve(import.meta.dirname, '..', 'assets', 'fountain.glb');

function assetBuffer() {
  const buf = readFileSync(ASSET);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// A tiny stand-in for Three.js: enough surface for glbToMeshes to build
// descriptions without a real renderer or GPU.
const fakeTHREE = {
  Color: class { constructor(r, g, b) { this.r = r; this.g = g; this.b = b; } },
  MeshStandardMaterial: class {
    constructor(params) { Object.assign(this, params); }
  },
  BufferGeometry: class {
    constructor() { this.attributes = {}; this.index = null; }
    setAttribute(name, attr) { this.attributes[name] = attr; }
    setIndex(attr) { this.index = attr; }
    computeVertexNormals() { this.normalsComputed = true; }
    computeBoundingBox() {
      const pos = this.attributes.position.array;
      const min = { x: Infinity, y: Infinity, z: Infinity };
      const max = { x: -Infinity, y: -Infinity, z: -Infinity };
      for (let i = 0; i < pos.length; i += 3) {
        min.x = Math.min(min.x, pos[i]); max.x = Math.max(max.x, pos[i]);
        min.y = Math.min(min.y, pos[i + 1]); max.y = Math.max(max.y, pos[i + 1]);
        min.z = Math.min(min.z, pos[i + 2]); max.z = Math.max(max.z, pos[i + 2]);
      }
      this.boundingBox = { min, max };
    }
    computeBoundingSphere() { this.sphereComputed = true; }
  },
  BufferAttribute: class {
    constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; }
  }
};

test('the exported fountain is a valid GLB container', () => {
  const { json, bin } = parseGlb(assetBuffer());
  assert.equal(json.asset.version, '2.0');
  assert.ok(bin && bin.byteLength > 0, 'a binary chunk is present');
});

test('the fountain contains the meshes the game expects to find', () => {
  const { json } = parseGlb(assetBuffer());
  const names = json.meshes.map((m) => m.name);
  for (const required of ['FountainBasin', 'FountainColumn', 'FountainUpperBowl', 'FountainFinial']) {
    assert.ok(names.includes(required), `${required} is in the asset`);
  }
  // Water surfaces are separate meshes so they can be animated later.
  assert.ok(names.filter((n) => n.includes('Water')).length >= 2, 'water surfaces are separable');
});

test('the fountain ships three materials: two stone tones and water', () => {
  const { json } = parseGlb(assetBuffer());
  const names = json.materials.map((m) => m.name).sort();
  assert.deepEqual(names, ['Stone', 'StoneDark', 'Water']);
});

test('the fountain stays inside its low-poly budget', () => {
  // It has to render on a phone and under software rasterisation, so the budget
  // is a hard limit rather than a preference.
  const { json } = parseGlb(assetBuffer());
  let tris = 0;
  for (const mesh of json.meshes) {
    const prim = mesh.primitives[0];
    tris += json.accessors[prim.indices].count / 3;
  }
  assert.equal(tris, 332, 'the exported triangle count is the one reviewed');
  assert.ok(tris < 4000, 'and it is well under the budget');
});

test('every mesh is triangles with positions and normals', () => {
  const { json } = parseGlb(assetBuffer());
  for (const mesh of json.meshes) {
    assert.equal(mesh.primitives.length, 1, `${mesh.name} has one primitive`);
    const prim = mesh.primitives[0];
    assert.ok(prim.attributes.POSITION !== undefined, `${mesh.name} has positions`);
    assert.ok(prim.attributes.NORMAL !== undefined, `${mesh.name} has normals`);
    assert.ok(prim.indices !== undefined, `${mesh.name} is indexed`);
    assert.ok(prim.mode === undefined || prim.mode === 4, `${mesh.name} draws triangles`);
  }
});

test('materials are the flat PBR factors the game can consume', () => {
  const { json } = parseGlb(assetBuffer());
  for (const material of json.materials) {
    const pbr = material.pbrMetallicRoughness;
    assert.ok(Array.isArray(pbr.baseColorFactor) && pbr.baseColorFactor.length === 4,
      `${material.name} has a base colour`);
    for (const channel of pbr.baseColorFactor) {
      assert.ok(channel >= 0 && channel <= 1, `${material.name} colour is in range`);
    }
    // Stone is fully dielectric; water is deliberately slightly metallic (0.1) to
    // match the game's original water material, which had a faint sheen.
    const maxMetal = material.name === 'Water' ? 0.2 : 0;
    assert.ok(pbr.metallicFactor <= maxMetal,
      `${material.name} metalness ${pbr.metallicFactor} within its intended limit`);
    assert.ok(pbr.roughnessFactor >= 0 && pbr.roughnessFactor <= 1);
  }
});

test('the asset carries no embedded images, animations or skins', () => {
  // The reader deliberately refuses these; asserting the export stays within that
  // subset turns a runtime failure into a test failure.
  const { json } = parseGlb(assetBuffer());
  assert.equal(json.images, undefined);
  assert.equal(json.textures, undefined);
  assert.equal(json.animations, undefined);
  assert.equal(json.skins, undefined);
});

test('readAccessor returns sensible vertex data', () => {
  const { json, bin } = parseGlb(assetBuffer());
  const prim = json.meshes[0].primitives[0];
  const positions = readAccessor(json, bin, prim.attributes.POSITION);
  assert.equal(positions.length % 3, 0, 'positions are vec3');
  assert.ok(positions.length >= 9, 'there are vertices');
  for (const v of positions) assert.ok(Number.isFinite(v), 'no NaN in positions');
  const normals = readAccessor(json, bin, prim.attributes.NORMAL);
  assert.equal(normals.length, positions.length, 'one normal per position');
  // Normals must be unit length or lighting will be wrong.
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
    assert.ok(Math.abs(len - 1) < 1e-3, `normal at ${i / 3} is unit length (got ${len})`);
  }
  const indices = readAccessor(json, bin, prim.indices);
  assert.equal(indices.length % 3, 0, 'indices form whole triangles');
  const maxIndex = Math.max(...indices);
  assert.ok(maxIndex < positions.length / 3, 'indices stay in range');
});

test('loadGlb builds Three.js-ready meshes for the whole asset', () => {
  const meshes = loadGlb(assetBuffer(), fakeTHREE);
  assert.equal(meshes.length, 12, 'all twelve parts are built');
  for (const mesh of meshes) {
    assert.ok(mesh.geometry.attributes.position, 'geometry has positions');
    assert.ok(mesh.geometry.index, 'geometry is indexed');
    assert.ok(mesh.geometry.boundingBox, 'bounds are computed for placement checks');
    assert.ok(mesh.material && mesh.material.color, 'a material is attached');
  }
  // The export is Y-up, so the fountain must stand taller in Y than it is wide in
  // either horizontal axis -- a Z-up asset would look wrong and this catches it.
  let minY = Infinity, maxY = -Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const { geometry } of meshes) {
    minY = Math.min(minY, geometry.boundingBox.min.y);
    maxY = Math.max(maxY, geometry.boundingBox.max.y);
    maxX = Math.max(maxX, Math.abs(geometry.boundingBox.max.x));
    maxZ = Math.max(maxZ, Math.abs(geometry.boundingBox.max.z));
  }
  assert.ok(maxY - minY > maxX, 'the fountain is taller than its radius (Y-up)');
  assert.ok(maxY - minY > maxZ, 'the fountain is taller than its radius (Y-up)');
  assert.ok(minY > -0.001, 'it sits on the ground, not below it');
});

test('a truncated or foreign file is refused rather than half-loaded', () => {
  assert.throws(() => parseGlb(new ArrayBuffer(4)), /too short/);
  const notGlb = new ArrayBuffer(16);
  new DataView(notGlb).setUint32(0, 0x12345678, true);
  assert.throws(() => parseGlb(notGlb), /not a GLB/);
  // A real GLB cut in half must fail on the declared length, not silently return.
  const full = assetBuffer();
  const half = full.slice(0, Math.floor(full.byteLength / 2));
  assert.throws(() => parseGlb(half), /GLB/);
});

test('the reader refuses features it does not implement', () => {
  const parsed = parseGlb(assetBuffer());
  const withAnimation = { json: { ...parsed.json, animations: [{}] }, bin: parsed.bin };
  assert.throws(() => glbToMeshes(withAnimation, fakeTHREE), /animations not supported/);
  const withTextures = { json: { ...parsed.json, images: [{}] }, bin: parsed.bin };
  assert.throws(() => glbToMeshes(withTextures, fakeTHREE), /embedded textures not supported/);
  const multiPrimitive = {
    json: {
      ...parsed.json,
      meshes: [{ ...parsed.json.meshes[0], primitives: [parsed.json.meshes[0].primitives[0], parsed.json.meshes[0].primitives[0]] }]
    },
    bin: parsed.bin
  };
  assert.throws(() => glbToMeshes(multiPrimitive, fakeTHREE), /one primitive per mesh/);
});