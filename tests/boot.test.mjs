// Round 82: the cast's boots.
//
// Two layers are tested here, mirroring tests/accent.test.mjs.
//
//  1. The pure rules in src/boot.js.
//
//  2. The real pass on the shipped GLBs (assets/npc_*.glb).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CAST_BOOT_TILE_METERS, CAST_BOOT_FAMILIES,
  castBootFamilyFor, castBootParams, shouldDressCastBoot
} from '../src/boot.js';

test('the cast boot tile is 0.2 m', () => {
  assert.equal(CAST_BOOT_TILE_METERS, 0.2);
});

test('exactly the authored Boot material belongs to a family', () => {
  assert.equal(castBootFamilyFor('Boot').id, 'boot');
  assert.equal(castBootFamilyFor('boot').id, 'boot');
});

test('every non-boot material is left alone', () => {
  for (const name of ['EyeWhite', 'EyeIris', 'Mouth', 'Cloth', 'Skin', 'HairC',
    'Accent', 'Steel', 'WoodP', 'Marker', 'Paper', '']) {
    assert.equal(castBootFamilyFor(name), null,
      `${name || '(empty)'} must not match a cast boot family`);
  }
  assert.equal(castBootFamilyFor(undefined), null);
  assert.equal(castBootFamilyFor(null), null);
});

test('a future variant name is not caught by accident', () => {
  assert.equal(castBootFamilyFor('Bootlace'), null);
  assert.equal(castBootFamilyFor('Bootie'), null);
});

test('the family states its exact material settings and keeps the tint', () => {
  const boot = castBootParams(castBootFamilyFor('Boot'));
  assert.deepEqual(boot, { roughness: 0.9, metalness: 0, keepTint: true });
  assert.equal(castBootParams(null), null);
  for (const family of CAST_BOOT_FAMILIES) assert.equal(family.keepTint, true);
});

test('a family waits for its maps rather than half-dressing', () => {
  const boot = castBootFamilyFor('Boot');
  assert.equal(shouldDressCastBoot(boot, { anyLoaded: true }), true);
  assert.equal(shouldDressCastBoot(boot, { anyLoaded: false }), false);
  assert.equal(shouldDressCastBoot(boot, null), false);
  assert.equal(shouldDressCastBoot(null, { anyLoaded: true }), false);
});

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

const BOOT = /^boot$/i;

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

test('the shipped rigs carry 18 Boot meshes, with no UVs', async () => {
  const { npcs, summary } = await modelledCast();
  assert.equal(summary.mode, 'model', 'all six rigs must load for this test to mean anything');
  const boots = meshesWithMaterial(npcs, BOOT);
  assert.equal(boots.length, 18);
  for (const { npc, mesh } of boots) {
    assert.equal(mesh.geometry.getAttribute('uv'), undefined,
      `${npc.id}/${mesh.name} ships without UVs -- the pass must project them`);
  }
});

test('dressCastBoot gives every boot mesh projected UVs and all three maps', async () => {
  const { THREE, npcs } = await modelledCast();
  const { dressCastBoot, CAST_BOOT_TILE_METERS } = await import('../src/npcs.js');
  const result = dressCastBoot(npcs, mapSet(THREE), { THREE });

  assert.equal(result.anyLoaded, true);
  assert.equal(result.dressed, 18);
  assert.deepEqual(result.perFamily, { boot: 18 });
  assert.equal(result.meshes.length, 18);

  const boots = meshesWithMaterial(npcs, BOOT);
  for (const { npc, mesh } of boots) {
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
    assert.equal(mesh.userData.bootDressed, true);
  }
  assert.equal(CAST_BOOT_TILE_METERS, 0.2);
});

test('the boot tint is the authored NPC colour, not a white replacement', async () => {
  const { THREE, npcs } = await modelledCast();
  const before = new Map();
  for (const { npc, mesh } of meshesWithMaterial(npcs, BOOT)) before.set(`${npc.id}/${mesh.name}`, mesh.material.color.getHex());

  const { dressCastBoot } = await import('../src/npcs.js');
  dressCastBoot(npcs, mapSet(THREE), { THREE });

  for (const { npc, mesh } of meshesWithMaterial(npcs, BOOT)) {
    const key = `${npc.id}/${mesh.name}`;
    assert.equal(mesh.material.color.getHex(), before.get(key), `${key} must keep its authored boot tint`);
    assert.notEqual(mesh.material.color.getHex(), 0xffffff, `${key} must not be flattened to white`);
  }
});

test('dressing the boots leaves every other cast material alone', async () => {
  const { THREE, npcs } = await modelledCast();
  const { dressCastBoot } = await import('../src/npcs.js');

  const before = [];
  for (const npc of npcs) {
    npc.group.traverse((o) => {
      if (!o.isMesh || BOOT.test(o.material.name)) return;
      before.push({
        key: `${npc.id}/${o.name}`,
        material: o.material,
        map: o.material.map,
        hasUv: Boolean(o.geometry.getAttribute('uv'))
      });
    });
  }
  assert.ok(before.length > 0, 'there are non-boot meshes to protect');

  dressCastBoot(npcs, mapSet(THREE), { THREE });

  for (const entry of before) {
    const [id, meshName] = entry.key.split('/');
    const npc = npcs.find((n) => n.id === id);
    let mesh = null;
    npc.group.traverse((o) => { if (o.isMesh && o.name === meshName) mesh = o; });
    assert.ok(mesh, `${entry.key} must still be in the rig`);
    assert.equal(mesh.material, entry.material, `${entry.key} must keep its own material object`);
    assert.equal(mesh.material.map, entry.map, `${entry.key} must not gain a boot map`);
    assert.equal(Boolean(mesh.geometry.getAttribute('uv')), entry.hasUv,
      `${entry.key} must not be re-projected`);
  }
});

test('a failed boot download leaves the boots flat instead of half-dressed', async () => {
  const { THREE, npcs } = await modelledCast();
  const { dressCastBoot, upgradeCastBoot } = await import('../src/npcs.js');

  const none = dressCastBoot(npcs, { map: null, normalMap: null, roughnessMap: null, anyLoaded: false }, { THREE });
  assert.equal(none.dressed, 0);
  assert.equal(none.anyLoaded, false);
  for (const { mesh } of meshesWithMaterial(npcs, BOOT)) {
    assert.equal(mesh.geometry.getAttribute('uv'), undefined);
    assert.equal(mesh.material.map, null);
    assert.ok(Math.abs(mesh.material.roughness - 0.9) < 1e-6, 'the authored roughness is untouched');
  }

  const failing = async () => { throw new Error('offline'); };
  const viaLoader = await upgradeCastBoot(npcs, { THREE, fetchImpl: failing });
  assert.equal(viaLoader.dressed, 0);
  assert.equal(viaLoader.anyLoaded, false);
});

test('upgradeCastBoot loads the leather maps and dresses all 18 boots', async () => {
  const { THREE, npcs } = await modelledCast();
  const { upgradeCastBoot } = await import('../src/npcs.js');
  const { LEATHER_TEXTURE_FILES } = await import('../src/assets.js');

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
    THREE, files: LEATHER_TEXTURE_FILES, fetchImpl, createBitmap
  });
  assert.equal(textures.anyLoaded, true, 'all three leather maps must load');
  for (const key of ['map', 'normalMap', 'roughnessMap']) assert.ok(textures[key], `${key} decoded`);
  assert.deepEqual(seen, [LEATHER_TEXTURE_FILES.map, LEATHER_TEXTURE_FILES.normalMap, LEATHER_TEXTURE_FILES.roughnessMap]);

  const { dressCastBoot } = await import('../src/npcs.js');
  const result = dressCastBoot(npcs, textures, { THREE });
  assert.equal(result.dressed, 18);
  for (const { mesh } of meshesWithMaterial(npcs, BOOT)) {
    assert.ok(mesh.material.normalMap);
    assert.ok(mesh.geometry.getAttribute('uv'));
  }
});
