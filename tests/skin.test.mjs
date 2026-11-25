// Round 76: the cast's skin and hair families.
//
// Two layers are tested here.
//
//  1. The pure rules in src/skin.js: which authored material names belong to a
//     family, the tile each family projects at, and the exact material settings
//     a dressed mesh must end up with. These are what npcs.js and the tests both
//     read, so a well-meaning regex edit that starts catching `EyeWhite` fails
//     here instead of making the cast stare blankly in a browser.
//
//  2. The real pass on the shipped GLBs (assets/npc_*.glb), through the same
//     upgradeNPCs() path the game uses. The cloth round showed the failure mode
//     worth guarding: a dressing pass that builds a fresh white material
//     silently recolours the cast and still passes a naive "has a map" check. So
//     these assertions are about the tint surviving, every mesh gaining finite
//     metre-space UVs, and nothing outside the two families being touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CAST_SKIN_TILE_METERS, CAST_HAIR_TILE_METERS, CAST_SKIN_FAMILIES,
  castSkinFamilyFor, castSkinParams, shouldDressCastSkin
} from '../src/skin.js';

// --- The pure rules --------------------------------------------------------

test('the cast skin and hair tiles are sized for a head at Talk range', () => {
  // Talk opens at 2.6 m from a 0.31 m head. A skin tile nearly the head's width
  // is what turns the generator's 3-10 mm creases into creases rather than
  // noise; a smaller hair tile keeps the combed locks at about 9 mm.
  assert.equal(CAST_SKIN_TILE_METERS, 0.35);
  assert.equal(CAST_HAIR_TILE_METERS, 0.22);
  assert.ok(CAST_HAIR_TILE_METERS < CAST_SKIN_TILE_METERS);
});

test('exactly the authored Skin and HairC materials belong to a family', () => {
  assert.equal(castSkinFamilyFor('Skin').id, 'skin');
  assert.equal(castSkinFamilyFor('skin').id, 'skin');
  assert.equal(castSkinFamilyFor('HairC').id, 'hair');
  assert.equal(castSkinFamilyFor('hairc').id, 'hair');
});

test('the eyes, mouth and every non-cast material are left alone', () => {
  // These are the materials that must not be swallowed: the eyes carry the
  // character's gaze, the mouth is the one 2 cm mark that reads at distance, and
  // the coats have their own round-67 pass.
  for (const name of ['EyeWhite', 'EyeIris', 'Mouth', 'Cloth', 'Accent', 'Boot',
    'Steel', 'WoodP', 'Marker', '']) {
    assert.equal(castSkinFamilyFor(name), null,
      `${name || '(empty)'} must not match a cast skin family`);
  }
  assert.equal(castSkinFamilyFor(undefined), null);
  assert.equal(castSkinFamilyFor(null), null);
});

test('a future variant name is not caught by accident', () => {
  // The patterns are anchored on purpose. A loose /skin/ would catch a role
  // material such as `SkinMarker`; a loose /hair/ would catch `HairPinned`,
  // which may earn its own round but must not arrive with material settings
  // nobody chose.
  assert.equal(castSkinFamilyFor('SkinMarker'), null);
  assert.equal(castSkinFamilyFor('HairPinned'), null);
  assert.equal(castSkinFamilyFor('Hairy'), null);
});

test('each family states its exact material settings and keeps the tint', () => {
  const skin = castSkinParams(castSkinFamilyFor('Skin'));
  assert.deepEqual(skin, { roughness: 0.7, metalness: 0, keepTint: true });
  const hair = castSkinParams(castSkinFamilyFor('HairC'));
  assert.deepEqual(hair, { roughness: 0.8, metalness: 0, keepTint: true });
  assert.equal(castSkinParams(null), null);
  // Six characters share one neutral albedo per family, so a family that
  // replaced the colour instead of multiplying it would make the cast
  // facelessly identical.
  for (const family of CAST_SKIN_FAMILIES) assert.equal(family.keepTint, true);
});

test('a family waits for its maps rather than half-dressing', () => {
  const skin = castSkinFamilyFor('Skin');
  assert.equal(shouldDressCastSkin(skin, { anyLoaded: true }), true);
  assert.equal(shouldDressCastSkin(skin, { anyLoaded: false }), false);
  assert.equal(shouldDressCastSkin(skin, null), false);
  assert.equal(shouldDressCastSkin(null, { anyLoaded: true }), false);
});

// --- The real pass on the shipped GLBs -------------------------------------

/** Real cast rigs, built through the same upgradeNPCs() path the game uses. */
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

/** Three real Texture instances stand in for one downloaded map set. */
function mapSet(THREE) {
  return {
    map: new THREE.Texture(),
    normalMap: new THREE.Texture(),
    roughnessMap: new THREE.Texture(),
    anyLoaded: true
  };
}

const SKIN = /^skin$/i;
const HAIR = /^hairc$/i;

function meshesWithMaterial(npcs, pattern) {
  const out = [];
  for (const npc of npcs) {
    npc.group.traverse((o) => {
      if (o.isMesh && o.material && pattern.test(o.material.name)) out.push({ npc, mesh: o });
    });
  }
  return out;
}

function dressedMeshes(npcs) {
  return [...meshesWithMaterial(npcs, SKIN), ...meshesWithMaterial(npcs, HAIR)];
}

/** Full U+V span of a mesh's projected UVs. */
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

/** U-only span, for measuring against a mesh's width. */
function uSpan(mesh) {
  const uv = mesh.geometry.getAttribute('uv');
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < uv.array.length; i += 2) {
    if (uv.array[i] < min) min = uv.array[i];
    if (uv.array[i] > max) max = uv.array[i];
  }
  return max - min;
}

test('the shipped rigs carry 36 Skin meshes and 8 HairC meshes, with no UVs', async () => {
  const { npcs, summary } = await modelledCast();
  assert.equal(summary.mode, 'model', 'all six rigs must load for this test to mean anything');
  const skin = meshesWithMaterial(npcs, SKIN);
  const hair = meshesWithMaterial(npcs, HAIR);
  // Six rigs x (Head, Nose, HandL, ThumbL, HandR, ThumbR), and six caps plus
  // Mara's bun and Wren's tail. These are the counts the live audit measured.
  assert.equal(skin.length, 36);
  assert.equal(hair.length, 8);
  for (const { npc, mesh } of [...skin, ...hair]) {
    assert.equal(mesh.geometry.getAttribute('uv'), undefined,
      `${npc.id}/${mesh.name} ships without UVs -- the pass must project them`);
  }
});

test('dressing gives every skin and hair mesh projected UVs and all three maps', async () => {
  const { THREE, npcs } = await modelledCast();
  const { dressCastSkin } = await import('../src/npcs.js');
  const result = dressCastSkin(npcs, { skin: mapSet(THREE), hair: mapSet(THREE) }, { THREE });

  assert.equal(result.anyLoaded, true);
  assert.equal(result.dressed, 44);
  assert.deepEqual(result.perFamily, { skin: 36, hair: 8 });
  assert.equal(result.meshes.length, 44);

  for (const { npc, mesh } of dressedMeshes(npcs)) {
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
    assert.equal(mesh.userData.skinDressed, true);
  }
});

test('each family ends up with its own stated roughness and metalness', async () => {
  const { THREE, npcs } = await modelledCast();
  const { dressCastSkin } = await import('../src/npcs.js');
  dressCastSkin(npcs, { skin: mapSet(THREE), hair: mapSet(THREE) }, { THREE });

  for (const { mesh } of meshesWithMaterial(npcs, SKIN)) {
    assert.ok(Math.abs(mesh.material.roughness - 0.7) < 1e-6, 'skin keeps its authored 0.7 base');
    assert.equal(mesh.material.metalness, 0);
  }
  for (const { mesh } of meshesWithMaterial(npcs, HAIR)) {
    assert.ok(Math.abs(mesh.material.roughness - 0.8) < 1e-6, 'hair keeps its authored 0.8 base');
    assert.equal(mesh.material.metalness, 0);
  }
});

test('the skin and hair tints are the authored NPC colours, not a white replacement', async () => {
  const { THREE, npcs } = await modelledCast();
  const before = new Map();
  for (const { npc, mesh } of dressedMeshes(npcs)) {
    before.set(`${npc.id}/${mesh.name}`, mesh.material.color.getHex());
  }
  const { dressCastSkin } = await import('../src/npcs.js');
  dressCastSkin(npcs, { skin: mapSet(THREE), hair: mapSet(THREE) }, { THREE });

  for (const { npc, mesh } of dressedMeshes(npcs)) {
    const key = `${npc.id}/${mesh.name}`;
    assert.equal(mesh.material.color.getHex(), before.get(key), `${key} must keep its authored tint`);
    assert.notEqual(mesh.material.color.getHex(), 0xffffff, `${key} must not be flattened to white`);
  }

  // The six authored skin tones are distinct, so a pass that shared one
  // material across the cast would be caught here.
  const headTints = {};
  for (const { npc, mesh } of meshesWithMaterial(npcs, SKIN)) {
    if (mesh.name === 'Head') headTints[npc.id] = mesh.material.color.getHex();
  }
  assert.equal(Object.keys(headTints).length, 6);
  assert.equal(new Set(Object.values(headTints)).size, 6);
});

test('one material is dressed once, so 36 meshes do not allocate 36 map sets', async () => {
  const { THREE, npcs } = await modelledCast();
  const { dressCastSkin } = await import('../src/npcs.js');
  dressCastSkin(npcs, { skin: mapSet(THREE), hair: mapSet(THREE) }, { THREE });
  // The GLB reader gives every mesh of one material the same material object,
  // so all six Skin meshes in a rig must share one downloaded map set. Count
  // the distinct map textures rather than the meshes: six characters x two
  // families means at most 12 albedo maps, not one per mesh.
  const textures = new Set();
  for (const { mesh } of dressedMeshes(npcs)) textures.add(mesh.material.map);
  assert.ok(textures.size <= 12, `expected at most 12 albedo maps, got ${textures.size}`);
});

test('Pip is projected at a smaller tile so his features are the same size in metres', async () => {
  const { THREE, npcs } = await modelledCast();
  const { dressCastSkin } = await import('../src/npcs.js');
  dressCastSkin(npcs, { skin: mapSet(THREE), hair: mapSet(THREE) }, { THREE });

  // Pip's rig is scaled 0.72 (buildModelled). The projection works in the
  // mesh's local space, so his head must carry a 0.35/0.72 m local tile. The two
  // heads are authored at different local sizes, so measure UVs per local metre
  // rather than raw span: a larger local tile means fewer UV units per metre.
  const localUvPerMetre = (id) => {
    let head = null;
    npcs.find((n) => n.id === id).group.traverse((o) => {
      if (o.isMesh && o.name === 'Head') head = o;
    });
    head.geometry.computeBoundingBox();
    const box = head.geometry.boundingBox;
    // The head's side faces project from x, so the U span across it is its
    // x-extent over the local tile.
    return uSpan(head) / (box.max.x - box.min.x);
  };
  const mara = localUvPerMetre('mara');
  const pip = localUvPerMetre('pip');
  // Mara: 1/0.35 = 2.857 UV per metre. Pip: 1/(0.35/0.72) = 2.057.
  assert.ok(Math.abs(mara - 1 / CAST_SKIN_TILE_METERS) < 1e-3,
    `Mara's skin UVs should be 1/0.35 per metre, got ${mara.toFixed(4)}`);
  assert.ok(Math.abs(pip / mara - 0.72) < 1e-3,
    `Pip's local tile is 0.35/0.72, so his UV density should be 0.72 of Mara's, got ${(pip / mara).toFixed(4)}`);
});

test('dressing the faces leaves every other cast material alone', async () => {
  const { THREE, npcs } = await modelledCast();
  const { dressCastSkin } = await import('../src/npcs.js');

  const before = [];
  for (const npc of npcs) {
    npc.group.traverse((o) => {
      if (!o.isMesh) return;
      const name = o.material && o.material.name;
      if (SKIN.test(name) || HAIR.test(name)) return;
      before.push({
        key: `${npc.id}/${o.name}`,
        material: o.material,
        map: o.material.map,
        roughness: o.material.roughness,
        hasUv: Boolean(o.geometry.getAttribute('uv'))
      });
    });
  }
  assert.ok(before.length > 0, 'there are non-skin meshes to protect');

  dressCastSkin(npcs, { skin: mapSet(THREE), hair: mapSet(THREE) }, { THREE });

  for (const entry of before) {
    const [id, meshName] = entry.key.split('/');
    const npc = npcs.find((n) => n.id === id);
    // Limb pivots share the mesh name (`LimbLegL` is both a Group and its Mesh).
    let mesh = null;
    npc.group.traverse((o) => { if (o.isMesh && o.name === meshName) mesh = o; });
    assert.ok(mesh, `${entry.key} must still be in the rig`);
    assert.equal(mesh.material, entry.material, `${entry.key} must keep its own material object`);
    assert.equal(mesh.material.map, entry.map, `${entry.key} must not gain a skin map`);
    assert.equal(mesh.material.roughness, entry.roughness, `${entry.key} roughness must be untouched`);
    assert.equal(Boolean(mesh.geometry.getAttribute('uv')), entry.hasUv,
      `${entry.key} must not be re-projected`);
  }

  // Name what this round must never touch, so a future pattern change cannot
  // quietly start texturing a gaze: four eye meshes and one mouth per rig.
  assert.equal(meshesWithMaterial(npcs, /^EyeWhite$|^EyeIris$/).length, 24);
  assert.equal(meshesWithMaterial(npcs, /^Mouth$/).length, 6);
});

test('a missing family only leaves that family flat', async () => {
  const { THREE, npcs } = await modelledCast();
  const { dressCastSkin } = await import('../src/npcs.js');
  // Hair failed to download, skin did not. The faces must still be dressed and
  // the hair must be byte-identical to what the GLB shipped -- not projected
  // with no map, which would render as a flat but slightly-different grey.
  const result = dressCastSkin(npcs, {
    skin: mapSet(THREE),
    hair: { map: null, normalMap: null, roughnessMap: null, anyLoaded: false }
  }, { THREE });

  assert.equal(result.anyLoaded, true);
  assert.deepEqual(result.perFamily, { skin: 36, hair: 0 });
  for (const { mesh } of meshesWithMaterial(npcs, HAIR)) {
    assert.equal(mesh.geometry.getAttribute('uv'), undefined, 'hair keeps its unprojected geometry');
    assert.equal(mesh.material.map, null);
    assert.ok(Math.abs(mesh.material.roughness - 0.9) < 1e-6,
      'the authored hair roughness (0.9) is untouched');
  }
  for (const { mesh } of meshesWithMaterial(npcs, SKIN)) assert.ok(mesh.material.map);
});

test('nothing loaded leaves all 44 meshes exactly as the GLB shipped them', async () => {
  const { THREE, npcs } = await modelledCast();
  const { dressCastSkin, upgradeCastSkin } = await import('../src/npcs.js');

  const none = dressCastSkin(npcs, {
    skin: { map: null, normalMap: null, roughnessMap: null, anyLoaded: false },
    hair: { map: null, normalMap: null, roughnessMap: null, anyLoaded: false }
  }, { THREE });
  assert.equal(none.dressed, 0);
  assert.equal(none.anyLoaded, false);
  for (const { mesh } of dressedMeshes(npcs)) {
    assert.equal(mesh.geometry.getAttribute('uv'), undefined);
    assert.equal(mesh.material.map, null);
  }
  // And through the loader with a fetch that always fails.
  const failing = async () => { throw new Error('offline'); };
  const viaLoader = await upgradeCastSkin(npcs, { THREE, fetchImpl: failing });
  assert.equal(viaLoader.dressed, 0);
  assert.equal(viaLoader.anyLoaded, false);
});

test('upgradeCastSkin fetches both families and dresses all 44 meshes', async () => {
  const { THREE, npcs } = await modelledCast();
  const { upgradeCastSkin } = await import('../src/npcs.js');
  const { SKIN_TEXTURE_FILES, HAIR_TEXTURE_FILES } = await import('../src/assets.js');

  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    const bytes = readFileSync(resolve(import.meta.dirname, '..', url));
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return { ok: true, status: 200, blob: async () => new Blob([copy]) };
  };
  // `createImageBitmap` is a browser API. The stub keeps the load path honest
  // (the real URL is fetched and the real file is read) without pretending Node
  // can decode WebP.
  const createBitmap = async (blob) => ({ width: 512, height: 512, blob });
  const { loadMaterialTextures } = await import('../src/assets.js');
  const textures = {
    skin: await loadMaterialTextures({ THREE, files: SKIN_TEXTURE_FILES, fetchImpl, createBitmap }),
    hair: await loadMaterialTextures({ THREE, files: HAIR_TEXTURE_FILES, fetchImpl, createBitmap })
  };
  for (const family of ['skin', 'hair']) {
    assert.equal(textures[family].anyLoaded, true, `${family} maps must load`);
    for (const key of ['map', 'normalMap', 'roughnessMap']) {
      assert.equal(textures[family][key].colorSpace, key === 'map' ? 'srgb' : '',
        `${family}/${key} colour space`);
    }
  }
  assert.deepEqual(seen, [
    SKIN_TEXTURE_FILES.map, SKIN_TEXTURE_FILES.normalMap, SKIN_TEXTURE_FILES.roughnessMap,
    HAIR_TEXTURE_FILES.map, HAIR_TEXTURE_FILES.normalMap, HAIR_TEXTURE_FILES.roughnessMap
  ]);

  const result = await upgradeCastSkin(npcs, { THREE, textures });
  assert.equal(result.dressed, 44);
  for (const { mesh } of dressedMeshes(npcs)) {
    assert.ok(mesh.material.normalMap);
    assert.ok(mesh.geometry.getAttribute('uv'));
  }
});
