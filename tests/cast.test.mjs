// Contract tests for the six shipped cast models (assets/npc_<id>.glb).
//
// These run against the real exported GLBs, so a Blender re-export that breaks
// the physical contract fails here rather than in a browser. The defects these
// tests pin down are all ones that shipped before round 59:
//   - figures floating above the cobbles,
//   - figures facing backwards (nose pointing away from walk direction),
//   - role props detached or buried inside their handles.
//
// The reader in src/glb.js maps accessor data straight into geometry and never
// reads glTF node transforms. Anything a Blender script authors as an object
// location/rotation/scale is therefore dropped at load time, which is exactly
// how the floating and misoffset-prop bugs happened. So the first test asserts
// every node is transform-free; the rest then measure geometry directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseGlb, readAccessor, glbToMeshes } from '../src/glb.js';

const CAST = ['mara', 'oswin', 'pip', 'halden', 'sable', 'wren'];

// Hip joint height in body space, from JOINTS.hip.y in src/npcs.js. Leg geometry
// is authored around the hip, so a sole at -0.78 lands exactly on the ground
// once the game hangs the leg under a pivot at y=0.78.
const HIP_Y = 0.78;

// Triangle budget per character. Six of these are on screen at once on a phone.
const TRI_BUDGET = 460;

function load(id) {
  const buf = readFileSync(resolve(import.meta.dirname, '..', 'assets', `npc_${id}.glb`));
  return parseGlb(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function meshNames(json) {
  return json.meshes.map((m) => m.name);
}

/** All POSITION vertices for one mesh, as flat [x,y,z,...] in glTF space. */
function positions(json, bin, name) {
  const mesh = json.meshes.find((m) => m.name === name);
  if (!mesh) return null;
  const acc = readAccessor(json, bin, mesh.primitives[0].attributes.POSITION);
  return acc.array ? Array.from(acc.array) : Array.from(acc);
}

/** Accessor min/max for one mesh's POSITION, which the exporter always writes. */
function bounds(json, name) {
  const mesh = json.meshes.find((m) => m.name === name);
  if (!mesh) return null;
  return json.accessors[mesh.primitives[0].attributes.POSITION];
}

function triangleCount(json) {
  let tris = 0;
  for (const mesh of json.meshes) {
    tris += json.accessors[mesh.primitives[0].indices].count / 3;
  }
  return tris;
}

for (const id of CAST) {
  test(`${id}: exports as glTF 2.0 with a binary chunk`, () => {
    const { json, bin } = load(id);
    assert.equal(json.asset.version, '2.0');
    assert.ok(bin && bin.byteLength > 0, 'a BIN chunk is present');
  });

  test(`${id}: no node carries a transform the reader would drop`, () => {
    const { json } = load(id);
    for (const node of json.nodes || []) {
      for (const key of ['translation', 'rotation', 'scale', 'matrix']) {
        assert.equal(node[key], undefined,
          `${node.name || 'node'} must not use node.${key}: src/glb.js ignores it, ` +
          'so bake the transform into the vertices instead');
      }
    }
  });

  test(`${id}: carries the animation contract meshes`, () => {
    const { json } = load(id);
    const names = meshNames(json);
    for (const required of [
      'Torso', 'Head', 'Nose',
      'LimbArmL', 'LimbArmR', 'LimbLegL', 'LimbLegR',
      'HandL', 'HandR'
    ]) {
      assert.ok(names.includes(required), `${id} has ${required}`);
    }
  });

  test(`${id}: the face points along local +Z, the walk direction`, () => {
    const { json, bin } = load(id);
    const nose = positions(json, bin, 'Nose');
    assert.ok(nose, 'a nose exists so the face has a direction');
    // The game turns figures with rotation.y = atan2(dx, dz), i.e. local +Z is
    // forward. Every nose vertex must be in front of the body centre line.
    let minZ = Infinity;
    for (let i = 2; i < nose.length; i += 3) minZ = Math.min(minZ, nose[i]);
    assert.ok(minZ > 0.1,
      `${id} nose min z is ${minZ.toFixed(3)}; it must be > 0.1 (in front), ` +
      'otherwise the character walks backwards');
  });

  test(`${id}: stays inside the triangle budget`, () => {
    const { json } = load(id);
    const tris = triangleCount(json);
    assert.ok(tris > 0 && tris < TRI_BUDGET,
      `${id} uses ${tris} triangles, budget ${TRI_BUDGET}`);
  });
}

// Boots: everything except the robed Keeper.
for (const id of ['oswin', 'pip', 'halden', 'sable', 'wren']) {
  test(`${id}: feet rest on the ground when hung from the hip joint`, () => {
    const { json, bin } = load(id);
    for (const boot of ['BootL', 'BootR']) {
      const pos = positions(json, bin, boot);
      assert.ok(pos, `${id} has ${boot}`);
      let minY = Infinity;
      let maxZ = -Infinity;
      for (let i = 0; i < pos.length; i += 3) {
        minY = Math.min(minY, pos[i + 1]);
        maxZ = Math.max(maxZ, pos[i + 2]);
      }
      // Legs are authored in hip space: sole at -HIP_Y plus the hip pivot puts
      // it on the floor.
      assert.ok(Math.abs(minY + HIP_Y) < 0.02,
        `${id} ${boot} sole is at y=${minY.toFixed(3)}, expected ${(-HIP_Y).toFixed(3)} ` +
        `(hip ${HIP_Y}); off by ${(minY + HIP_Y).toFixed(3)}`);
      assert.ok(maxZ > 0.1,
        `${id} ${boot} toe reaches z=${maxZ.toFixed(3)}; toes must point forward (+Z)`);
    }
  });
}

test('mara: the robed Keeper has no boots hanging below the robe', () => {
  const { json } = load('mara');
  const names = meshNames(json);
  assert.ok(!names.includes('BootL') && !names.includes('BootR'),
    'mara is robed to the ground, so she must not also have exposed boots');
  assert.ok(names.includes('LimbLegL') && names.includes('LimbLegR'),
    'her legs still exist so the walk cycle animates');
});

// Role props. Each companion prop must sit where its parent prop ends, because
// the game attaches both to the same hand pivot and never repositions one
// relative to the other.
test('mara: the lantern sits at the top of the carried pole', () => {
  const { json } = load('mara');
  const pole = bounds(json, 'PropPole');
  const lantern = bounds(json, 'PropLantern');
  assert.ok(pole && lantern, 'both pole and lantern are exported');
  // Pole is 0.8 tall in hand space (z -0.40..0.40); the lantern hangs at the
  // top and overlaps the last segment of the shaft.
  assert.ok(Math.abs(lantern.max[1] - pole.max[1]) < 0.15,
    `lantern top ${lantern.max[1].toFixed(2)} should meet pole top ${pole.max[1].toFixed(2)}`);
  assert.ok(lantern.max[1] <= pole.max[1] + 0.02,
    'the lantern must not float above the pole end it is tied to');
});

test('halden: the spear point sits on the shaft, not inside it', () => {
  const { json } = load('halden');
  const spear = bounds(json, 'PropSpear');
  const tip = bounds(json, 'PropSpearTip');
  assert.ok(spear && tip, 'both shaft and point are exported');
  // Shaft spans -0.85..0.85. A point that starts below 0.85 would be buried in
  // the shaft (the round 59 bug); it should start at the shaft top.
  assert.ok(tip.min[1] >= spear.max[1] - 0.02,
    `spear point starts at ${tip.min[1].toFixed(2)} but the shaft ends at ` +
    `${spear.max[1].toFixed(2)}; the point is buried inside the shaft`);
  assert.ok(tip.max[1] > spear.max[1],
    'the point is the outermost part of the spear');
});

test('wren: the ledger pages sit proud of the board face', () => {
  const { json } = load('wren');
  const board = bounds(json, 'PropLedger');
  const pages = bounds(json, 'PropLedgerPages');
  assert.ok(board && pages, 'both board and pages are exported');
  // Pages must be outside the board's front face, not coplanar with it.
  assert.ok(pages.max[2] > board.max[2],
    `pages reach z=${pages.max[2].toFixed(3)} but the board face is at ` +
    `${board.max[2].toFixed(3)}; the pages are inside the board`);
});

test('oswin carries a pouch and pip a hoop, sable a map', () => {
  for (const [id, prop] of [['oswin', 'PropPouch'], ['pip', 'PropHoop'], ['sable', 'PropMap']]) {
    const { json } = load(id);
    assert.ok(meshNames(json).includes(prop), `${id} carries ${prop}`);
  }
});

test('pip is authored at full size; the game applies the 0.72 child scale', () => {
  // If Blender baked 0.72 in AND src/npcs.js applies 0.72 as well, the child
  // would render at 0.518 scale. The decisive measure is leg length: legs are
  // authored in hip space and are 0.58 tall for every adult, so a pre-scaled
  // child would come out at 0.72 * 0.58 = 0.418.
  const { json } = load('pip');
  const leg = bounds(json, 'LimbLegL');
  const length = leg.max[1] - leg.min[1];
  assert.ok(length > 0.55,
    `pip's leg is ${length.toFixed(3)} long; a double-scaled child would be ` +
    `0.418 (0.72 * 0.58). The GLB must store full-size geometry.`);
});

test('the reader refuses GLBs whose nodes carry transforms', () => {
  // A synthetic parsed object, so this fails even if every shipped asset is
  // clean: it pins the guard itself. Without it, a future export that used node
  // translations would load with silently misplaced meshes.
  const fakeTHREE = {
    Color: class { constructor() {} },
    MeshStandardMaterial: class { constructor(p) { Object.assign(this, p); } },
    BufferGeometry: class {
      constructor() { this.attributes = {}; }
      setAttribute(n, a) { this.attributes[n] = a; }
      setIndex(a) { this.index = a; }
      computeVertexNormals() {}
      computeBoundingBox() { this.boundingBox = { min: {}, max: {} }; }
      computeBoundingSphere() {}
    },
    BufferAttribute: class { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; } }
  };
  const parsed = {
    json: {
      asset: { version: '2.0' },
      nodes: [{ name: 'Shifted', translation: [0, 0, -0.9], mesh: 0 }],
      meshes: [{ name: 'Shifted', primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2 }] }],
      accessors: [
        { type: 'VEC3', componentType: 5126, count: 3, min: [0, 0, 0], max: [1, 1, 1] },
        { type: 'VEC3', componentType: 5126, count: 3 },
        { type: 'SCALAR', componentType: 5123, count: 3 }
      ],
      materials: [],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
        { buffer: 0, byteOffset: 36, byteLength: 36 },
        { buffer: 0, byteOffset: 72, byteLength: 6 }
      ]
    },
    bin: new ArrayBuffer(80)
  };
  assert.throws(() => glbToMeshes(parsed, fakeTHREE), /node transforms not supported/);
});
// --- Round 67: dressing the cast coats with the cloth family -----------------
//
// The cast had 23 flat-shaded `Cloth` meshes (~13 m2) and no UVs at all, so the
// coats were the last large untextured mass on screen. These tests pin the three
// things that make the pass correct rather than merely present:
//   1. every coat ends up with metre-projected UVs and all three maps,
//   2. the authored per-NPC coat tint survives as the material colour (a pass
//      that built a fresh white material would silently recolour the cast),
//   3. nothing that is not a coat is touched -- Skin, Hair, Accent, Boots, the
//      carried props and the pickup marker all keep their own materials.

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

/** Three real Texture instances stand in for the downloaded cloth maps. */
function clothMaps(THREE) {
  return {
    map: new THREE.Texture(),
    normalMap: new THREE.Texture(),
    roughnessMap: new THREE.Texture(),
    anyLoaded: true
  };
}

function coatMeshes(npcs) {
  const coats = [];
  for (const npc of npcs) {
    npc.group.traverse((o) => {
      if (o.isMesh && o.material && /^cloth$/i.test(o.material.name)) coats.push({ npc, mesh: o });
    });
  }
  return coats;
}

test('every cast coat ships with a Cloth material and no UVs to texture with', async () => {
  const { npcs, summary } = await modelledCast();
  assert.equal(summary.mode, 'model', 'all six rigs must load for this test to mean anything');
  const coats = coatMeshes(npcs);
  assert.equal(coats.length, 23, '23 Cloth meshes are authored across the six rigs');
  for (const { npc, mesh } of coats) {
    assert.equal(mesh.geometry.getAttribute('uv'), undefined,
      `${npc.id}/${mesh.name} is expected to ship without UVs -- that is why the pass projects them`);
  }
});

test('dressCastCloth gives every coat projected UVs and all three maps', async () => {
  const { THREE, npcs } = await modelledCast();
  const { dressCastCloth, CAST_CLOTH_TILE_METERS } = await import('../src/npcs.js');
  const result = dressCastCloth(npcs, clothMaps(THREE));

  assert.equal(result.dressed, 23);
  assert.equal(result.anyLoaded, true);
  assert.equal(result.meshes.length, 23);

  const coats = coatMeshes(npcs);
  for (const { npc, mesh } of coats) {
    const uv = mesh.geometry.getAttribute('uv');
    assert.ok(uv, `${npc.id}/${mesh.name} must gain a uv attribute`);
    assert.equal(uv.itemSize, 2);
    const position = mesh.geometry.getAttribute('position');
    assert.equal(uv.count, position.count, 'one UV pair per vertex');

    // UVs are in metres, so the span must be positive and finite rather than
    // the all-zero buffer a naive stub would leave behind.
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < uv.array.length; i++) {
      assert.ok(Number.isFinite(uv.array[i]), 'UVs must be finite');
      if (uv.array[i] < min) min = uv.array[i];
      if (uv.array[i] > max) max = uv.array[i];
    }
    assert.ok(max - min > 0, `${npc.id}/${mesh.name} UVs must not collapse to a point`);

    const material = mesh.material;
    for (const key of ['map', 'normalMap', 'roughnessMap']) {
      assert.ok(material[key], `${npc.id}/${mesh.name} must carry ${key}`);
      assert.equal(material[key].wrapS, THREE.RepeatWrapping, `${key} wraps in U`);
      assert.equal(material[key].wrapT, THREE.RepeatWrapping, `${key} wraps in V`);
    }
    // One repeat: the metre projection already carries the tile size. A second
    // scale factor here would make the weave density depend on mesh size.
    const mapRepeat = material.map.repeat;
    assert.deepEqual([mapRepeat.x, mapRepeat.y], [1, 1]);
    assert.equal(material.roughness, 0.95);
    assert.equal(material.metalness, 0);
    assert.equal(mesh.userData.clothDressed, true);
    // The tile the coat was projected at is the family tile, so a coat and a
    // lane sack show the same weave.
    assert.equal(CAST_CLOTH_TILE_METERS, 1.2);
  }
});

test('the coat tint is the authored NPC colour, not a white replacement', async () => {
  const { THREE, npcs } = await modelledCast();
  const before = new Map();
  for (const { npc, mesh } of coatMeshes(npcs)) before.set(`${npc.id}/${mesh.name}`, mesh.material.color.getHex());

  const { dressCastCloth } = await import('../src/npcs.js');
  dressCastCloth(npcs, clothMaps(THREE));

  // The point of this pass: the neutral albedo multiplies the coat colour, so
  // the colour has to survive. A fresh `color: 0xffffff` material would make
  // all six characters the same shade of grey and would pass a naive
  // "material.map exists" test.
  for (const { npc, mesh } of coatMeshes(npcs)) {
    const key = `${npc.id}/${mesh.name}`;
    assert.equal(mesh.material.color.getHex(), before.get(key), `${key} must keep its authored coat tint`);
    assert.notEqual(mesh.material.color.getHex(), 0xffffff, `${key} must not be flattened to white`);
  }

  // And the tints really are distinct per character, so a bug that reused one
  // shared material would be caught.
  const torso = {};
  for (const { npc, mesh } of coatMeshes(npcs)) if (mesh.name === 'Torso') torso[npc.id] = mesh.material.color.getHex();
  assert.equal(new Set(Object.values(torso)).size, Object.keys(torso).length);
});

test('dressing the coats leaves every other cast material alone', async () => {
  const { THREE, npcs } = await modelledCast();
  const { dressCastCloth } = await import('../src/npcs.js');

  const before = [];
  for (const npc of npcs) {
    npc.group.traverse((o) => {
      if (!o.isMesh || /^cloth$/i.test(o.material.name)) return;
      before.push({
        key: `${npc.id}/${o.name}`,
        material: o.material,
        map: o.material.map,
        hasUv: Boolean(o.geometry.getAttribute('uv'))
      });
    });
  }
  assert.ok(before.length > 0, 'there are non-coat meshes to protect');

  dressCastCloth(npcs, clothMaps(THREE));

  for (const entry of before) {
    const [id, meshName] = entry.key.split('/');
    const npc = npcs.find((n) => n.id === id);
    // Limb pivots share the mesh name (`LimbLegL` is both a Group and its Mesh),
    // so look for the mesh specifically instead of whatever matches first.
    let mesh = null;
    npc.group.traverse((o) => { if (o.isMesh && o.name === meshName) mesh = o; });
    assert.ok(mesh, `${entry.key} must still be in the rig`);
    assert.equal(mesh.material, entry.material, `${entry.key} must keep its own material object`);
    assert.equal(mesh.material.map, entry.map, `${entry.key} must not gain a cloth map`);
    assert.equal(Boolean(mesh.geometry.getAttribute('uv')), entry.hasUv,
      `${entry.key} must not be re-projected`);
    assert.equal(mesh.material.name === 'Cloth', false, 'sanity: this is a non-cloth mesh');
  }
});

test('the cast cloth projection honours a custom tile size', async () => {
  const { THREE, npcs } = await modelledCast();
  const { dressCastCloth } = await import('../src/npcs.js');
  // Two runs on identical geometry: doubling the tile must halve the UV span.
  // This is what makes "metres per tile" a real setting instead of decoration.
  const span = () => {
    const uv = coatMeshes(npcs)[0].mesh.geometry.getAttribute('uv');
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < uv.array.length; i++) {
      if (uv.array[i] < min) min = uv.array[i];
      if (uv.array[i] > max) max = uv.array[i];
    }
    return max - min;
  };
  dressCastCloth(npcs, clothMaps(THREE), { tileMeters: 1.2 });
  const atSmall = span();
  dressCastCloth(npcs, clothMaps(THREE), { tileMeters: 2.4 });
  const atLarge = span();
  assert.ok(atSmall > atLarge, 'a larger metre tile covers more surface per repeat');
  assert.ok(Math.abs(atSmall / atLarge - 2) < 1e-6, 'the ratio is exactly the tile ratio');
});

test('a failed cloth download leaves the coats flat instead of half-dressed', async () => {
  const { THREE, npcs } = await modelledCast();
  const { dressCastCloth, upgradeCastCloth } = await import('../src/npcs.js');

  // Direct call with nothing loaded: no UVs written, no maps attached.
  const none = dressCastCloth(npcs, { map: null, normalMap: null, roughnessMap: null, anyLoaded: false });
  assert.equal(none.dressed, 0);
  assert.equal(none.anyLoaded, false);
  for (const { mesh } of coatMeshes(npcs)) {
    assert.equal(mesh.geometry.getAttribute('uv'), undefined);
    assert.equal(mesh.material.map, null);
    // Three stores roughness as a float32, so 0.85 round-trips as
    // 0.8500000238418579. Compare with a tolerance rather than by identity.
    assert.ok(Math.abs(mesh.material.roughness - 0.85) < 1e-6, 'the authored roughness is untouched');
  }

  // And through the loader, with a fetch that always fails.
  const failing = async () => { throw new Error('offline'); };
  const viaLoader = await upgradeCastCloth(npcs, { THREE, fetchImpl: failing });
  assert.equal(viaLoader.dressed, 0);
  assert.equal(viaLoader.anyLoaded, false);
});

test('upgradeCastCloth loads the neutral maps and dresses all 23 coats', async () => {
  const { THREE, npcs } = await modelledCast();
  const { upgradeCastCloth } = await import('../src/npcs.js');
  const { CLOTH_TEXTURE_FILES } = await import('../src/assets.js');

  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    const bytes = readFileSync(resolve(import.meta.dirname, '..', url));
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return { ok: true, status: 200, blob: async () => new Blob([copy]) };
  };
  // `createImageBitmap` is a browser API. The stub keeps the load path honest
  // (the real URL is fetched, the real file is decoded as a blob) without
  // pretending Node can decode WebP.
  const createBitmap = async (blob) => ({ width: 512, height: 512, blob });

  let result;
  const { loadMaterialTextures } = await import('../src/assets.js');
  const textures = await loadMaterialTextures({
    THREE, files: CLOTH_TEXTURE_FILES, fetchImpl, createBitmap
  });
  assert.equal(textures.anyLoaded, true, 'all three cloth maps must load');
  for (const key of ['map', 'normalMap', 'roughnessMap']) assert.ok(textures[key], `${key} decoded`);
  for (const key of ['map', 'normalMap', 'roughnessMap']) {
    assert.equal(textures[key].colorSpace, key === 'map' ? 'srgb' : '', `${key} colour space`);
  }
  assert.deepEqual(seen, [CLOTH_TEXTURE_FILES.map, CLOTH_TEXTURE_FILES.normalMap, CLOTH_TEXTURE_FILES.roughnessMap]);

  result = (await import('../src/npcs.js')).dressCastCloth(npcs, textures);
  assert.equal(result.dressed, 23);
  for (const { mesh } of coatMeshes(npcs)) {
    assert.ok(mesh.material.normalMap);
    assert.ok(mesh.geometry.getAttribute('uv'));
  }
});
