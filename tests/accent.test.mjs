// Round 81: the cast's accent bands.
//
// Two layers are tested here.
//
//  1. The pure rules in src/accent.js: which authored material names belong to
//     a family, the tile the family projects at, and the exact material settings
//     a dressed mesh must end up with.
//
//  2. The real pass on the shipped GLBs (assets/npc_*.glb), through the same
//     upgradeNPCs() path the game uses. Assertions are about the tint surviving,
//     every mesh gaining finite metre-space UVs, and nothing outside the family
//     being touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CAST_ACCENT_TILE_METERS, CAST_ACCENT_FAMILIES,
  castAccentFamilyFor, castAccentParams, shouldDressCastAccent
} from '../src/accent.js';

// --- The pure rules --------------------------------------------------------

test('the cast accent tile matches the felt family tile', () => {
  assert.equal(CAST_ACCENT_TILE_METERS, 0.18);
});

test('exactly the authored Accent material belongs to a family', () => {
  assert.equal(castAccentFamilyFor('Accent').id, 'accent');
  assert.equal(castAccentFamilyFor('accent').id, 'accent');
});

test('every non-accent material is left alone', () => {
  for (const name of ['EyeWhite', 'EyeIris', 'Mouth', 'Cloth', 'Skin', 'HairC',
    'Boot', 'Steel', 'WoodP', 'Marker', 'Paper', '']) {
    assert.equal(castAccentFamilyFor(name), null,
      `${name || '(empty)'} must not match a cast accent family`);
  }
  assert.equal(castAccentFamilyFor(undefined), null);
  assert.equal(castAccentFamilyFor(null), null);
});

test('a future variant name is not caught by accident', () => {
  assert.equal(castAccentFamilyFor('AccentStripe'), null);
  assert.equal(castAccentFamilyFor('AccentBand'), null);
});

test('the family states its exact material settings and keeps the tint', () => {
  const accent = castAccentParams(castAccentFamilyFor('Accent'));
  assert.deepEqual(accent, { roughness: 0.9, metalness: 0, keepTint: true });
  assert.equal(castAccentParams(null), null);
  for (const family of CAST_ACCENT_FAMILIES) assert.equal(family.keepTint, true);
});

test('a family waits for its maps rather than half-dressing', () => {
  const accent = castAccentFamilyFor('Accent');
  assert.equal(shouldDressCastAccent(accent, { anyLoaded: true }), true);
  assert.equal(shouldDressCastAccent(accent, { anyLoaded: false }), false);
  assert.equal(shouldDressCastAccent(accent, null), false);
  assert.equal(shouldDressCastAccent(null, { anyLoaded: true }), false);
});

// --- The real pass on the shipped GLBs -------------------------------------

async function modelledCast() {
  const THREE = await import('three');
  const { loadGlb } = await import('../src/glb.js');
  const { createNPCs, upgradeNPCs } = await import('../src/npcs.js');
  const scene = new THREE.Scene();
  const npcs = createNPCs(scene);
  const fetchImpl = async (url) => {
    const id = /npc_([a-z]+)\.glb$/.exec(url)[1];
    const buf = readFileSync(resolve(import.meta.dirname, '..', 'assets', `npc_${id}.glb`));
    const copy = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, status: 200, arrayBuffer: async () => copy };
  };
  const summary = await upgradeNPCs(npcs, { THREE, loadGlb, fetchImpl });
  return { THREE, npcs, summary };
}

function mapSet(THREE) {
  return {
    map: new THREE.Texture(),
    normalMap: new THREE.Texture(),
    roughnessMap: new THREE.Texture(),
    anyLoaded: true
  };
}

const ACCENT = /^accent$/i;

function meshesWithMaterial(npcs, pattern) {
  const out = [];
  for (const npc of npcs) {
    npc.group.traverse((o) => {
      if (o.isMesh && o.material && pattern.test(o.material.name)) out.push({ npc, mesh: o });
    });
  }
  return out;
}

function uvSpan(mesh) {
  const uv = mesh.geometry.getAttribute('uv');
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < uv.array.length; i++) {
    if (uv.array[i] < min) min = uv.array[i];
    if (uv.array[i] > max) max = uv.array[i];
  }
  return max - min;
}

test('the shipped rigs carry 9 Accent meshes, with no UVs', async () => {
  const { npcs, summary } = await modelledCast();
  assert.equal(summary.mode, 'model', 'all six rigs must load for this test to mean anything');
  const accents = meshesWithMaterial(npcs, ACCENT);
  assert.equal(accents.length, 9);
  for (const { npc, mesh } of accents) {
    assert.equal(mesh.geometry.getAttribute('uv'), undefined,
      `${npc.id}/${mesh.name} ships without UVs -- the pass must project them`);
  }
});

test('dressCastAccent gives every accent mesh projected UVs and all three maps', async () => {
  const { THREE, npcs } = await modelledCast();
  const { dressCastAccent, CAST_ACCENT_TILE_METERS } = await import('../src/npcs.js');
  const result = dressCastAccent(npcs, mapSet(THREE), { THREE });

  assert.equal(result.anyLoaded, true);
  assert.equal(result.dressed, 9);
  assert.deepEqual(result.perFamily, { accent: 9 });
  assert.equal(result.meshes.length, 9);

  const accents = meshesWithMaterial(npcs, ACCENT);
  for (const { npc, mesh } of accents) {
    const uv = mesh.geometry.getAttribute('uv');
    assert.ok(uv, `${npc.id}/${mesh.name} must gain a uv attribute`);
    assert.equal(uv.itemSize, 2);
    assert.equal(uv.count, mesh.geometry.getAttribute('position').count, 'one UV pair per vertex');
    for (let i = 0; i < uv.array.length; i++) {
      assert.ok(Number.isFinite(uv.array[i]), `${npc.id}/${mesh.name} UVs must be finite`);
    }
    assert.ok(uvSpan(mesh) > 0, `${npc.id}/${mesh.name} UVs must not collapse to a point`);

    const material = mesh.material;
    for (const key of ['map', 'normalMap', 'roughnessMap']) {
      assert.ok(material[key], `${npc.id}/${mesh.name} must carry ${key}`);
      assert.equal(material[key].wrapS, THREE.RepeatWrapping, `${key} wraps in U`);
      assert.equal(material[key].wrapT, THREE.RepeatWrapping, `${key} wraps in V`);
      assert.deepEqual([material[key].repeat.x, material[key].repeat.y], [1, 1],
        'the metre projection carries the tile, not a texture repeat');
    }
    assert.equal(material.roughness, 0.9);
    assert.equal(material.metalness, 0);
    assert.equal(mesh.userData.accentDressed, true);
  }
  assert.equal(CAST_ACCENT_TILE_METERS, 0.18);
});

test('the accent tint is the authored NPC colour, not a white replacement', async () => {
  const { THREE, npcs } = await modelledCast();
  const before = new Map();
  for (const { npc, mesh } of meshesWithMaterial(npcs, ACCENT)) before.set(`${npc.id}/${mesh.name}`, mesh.material.color.getHex());

  const { dressCastAccent } = await import('../src/npcs.js');
  dressCastAccent(npcs, mapSet(THREE), { THREE });

  for (const { npc, mesh } of meshesWithMaterial(npcs, ACCENT)) {
    const key = `${npc.id}/${mesh.name}`;
    assert.equal(mesh.material.color.getHex(), before.get(key), `${key} must keep its authored accent tint`);
    assert.notEqual(mesh.material.color.getHex(), 0xffffff, `${key} must not be flattened to white`);
  }
});

test('dressing the accents leaves every other cast material alone', async () => {
  const { THREE, npcs } = await modelledCast();
  const { dressCastAccent } = await import('../src/npcs.js');

  const before = [];
  for (const npc of npcs) {
    npc.group.traverse((o) => {
      if (!o.isMesh || ACCENT.test(o.material.name)) return;
      before.push({
        key: `${npc.id}/${o.name}`,
        material: o.material,
        map: o.material.map,
        hasUv: Boolean(o.geometry.getAttribute('uv'))
      });
    });
  }
  assert.ok(before.length > 0, 'there are non-accent meshes to protect');

  dressCastAccent(npcs, mapSet(THREE), { THREE });

  for (const entry of before) {
    const [id, meshName] = entry.key.split('/');
    const npc = npcs.find((n) => n.id === id);
    let mesh = null;
    npc.group.traverse((o) => { if (o.isMesh && o.name === meshName) mesh = o; });
    assert.ok(mesh, `${entry.key} must still be in the rig`);
    assert.equal(mesh.material, entry.material, `${entry.key} must keep its own material object`);
    assert.equal(mesh.material.map, entry.map, `${entry.key} must not gain an accent map`);
    assert.equal(Boolean(mesh.geometry.getAttribute('uv')), entry.hasUv,
      `${entry.key} must not be re-projected`);
  }
});

test('a failed accent download leaves the bands flat instead of half-dressed', async () => {
  const { THREE, npcs } = await modelledCast();
  const { dressCastAccent, upgradeCastAccent } = await import('../src/npcs.js');

  const none = dressCastAccent(npcs, { map: null, normalMap: null, roughnessMap: null, anyLoaded: false }, { THREE });
  assert.equal(none.dressed, 0);
  assert.equal(none.anyLoaded, false);
  for (const { mesh } of meshesWithMaterial(npcs, ACCENT)) {
    assert.equal(mesh.geometry.getAttribute('uv'), undefined);
    assert.equal(mesh.material.map, null);
    assert.ok(Math.abs(mesh.material.roughness - 0.6) < 1e-6, 'the authored roughness is untouched');
  }

  const failing = async () => { throw new Error('offline'); };
  const viaLoader = await upgradeCastAccent(npcs, { THREE, fetchImpl: failing });
  assert.equal(viaLoader.dressed, 0);
  assert.equal(viaLoader.anyLoaded, false);
});

test('upgradeCastAccent loads the felt maps and dresses all 9 accent bands', async () => {
  const { THREE, npcs } = await modelledCast();
  const { upgradeCastAccent } = await import('../src/npcs.js');
  const { FELT_TEXTURE_FILES } = await import('../src/assets.js');

  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    const bytes = readFileSync(resolve(import.meta.dirname, '..', url));
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return { ok: true, status: 200, blob: async () => new Blob([copy]) };
  };
  const createBitmap = async (blob) => ({ width: 512, height: 512, blob });

  const { loadMaterialTextures } = await import('../src/assets.js');
  const textures = await loadMaterialTextures({
    THREE, files: FELT_TEXTURE_FILES, fetchImpl, createBitmap
  });
  assert.equal(textures.anyLoaded, true, 'all three felt maps must load');
  for (const key of ['map', 'normalMap', 'roughnessMap']) assert.ok(textures[key], `${key} decoded`);
  assert.deepEqual(seen, [FELT_TEXTURE_FILES.map, FELT_TEXTURE_FILES.normalMap, FELT_TEXTURE_FILES.roughnessMap]);

  const result = (await import('../src/npcs.js')).dressCastAccent(npcs, textures, { THREE });
  assert.equal(result.dressed, 9);
  for (const { mesh } of meshesWithMaterial(npcs, ACCENT)) {
    assert.ok(mesh.material.normalMap);
    assert.ok(mesh.geometry.getAttribute('uv'));
  }
});
