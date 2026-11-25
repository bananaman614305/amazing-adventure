// The job board's paper surfaces. Round 83 dresses the plaza work board's
// face (BoardFace, 1 mesh, 2.16 m2) and its three pinned slips (BoardPaper,
// 3 meshes, 0.4 m2) with a procedural paper/parchment map, because a 1.2 x
// 0.9 m plane of pinned paper should read as paper, not flat cream.
//
// Two layers are tested here, mirroring tests/boot.test.mjs.
//
//  1. The pure rules in src/paper.js.
//
//  2. The real pass on hand-built PlaneGeometry meshes (the board's surfaces
//     are procedural, not shipped GLBs, so the test builds them the way
//     src/world.js does and calls the exported dressBoardPaper()).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CAST_PAPER_TILE_METERS, BOARD_PAPER_FAMILIES, CAST_PAPER_FAMILIES,
  boardPaperFamilyFor, boardPaperParams, shouldDressBoardPaper,
  castPaperFamilyFor, castPaperParams, shouldDressCastPaper
} from '../src/paper.js';

test('the job board paper tile is 0.3 m', () => {
  assert.equal(CAST_PAPER_TILE_METERS, 0.3);
});

test('exactly the two authored board materials belong to a family', () => {
  assert.equal(boardPaperFamilyFor('BoardFace').id, 'paper');
  assert.equal(boardPaperFamilyFor('BoardPaper').id, 'paper');
});

test('every other material is left alone', () => {
  for (const name of ['EyeWhite', 'EyeIris', 'Mouth', 'Cloth', 'Skin', 'HairC',
    'Accent', 'Steel', 'WoodP', 'Marker', 'Paper', 'BuntingRed', '']) {
    assert.equal(boardPaperFamilyFor(name), null,
      `${name || '(empty)'} must not match a board paper family`);
  }
  assert.equal(boardPaperFamilyFor(undefined), null);
  assert.equal(boardPaperFamilyFor(null), null);
});

test('a future variant name is not caught by accident', () => {
  assert.equal(boardPaperFamilyFor('BoardNote'), null);
  assert.equal(boardPaperFamilyFor('JobPaper'), null);
});

test('the family states its exact material settings and forces a white tint', () => {
  const paper = boardPaperParams(boardPaperFamilyFor('BoardFace'));
  assert.deepEqual(paper, { roughness: 0.9, metalness: 0, keepTint: false });
  assert.equal(boardPaperParams(null), null);
  for (const family of BOARD_PAPER_FAMILIES) assert.equal(family.keepTint, false);
});

test('a family waits for its maps rather than half-dressing', () => {
  const paper = boardPaperFamilyFor('BoardFace');
  assert.equal(shouldDressBoardPaper(paper, { anyLoaded: true }), true);
  assert.equal(shouldDressBoardPaper(paper, { anyLoaded: false }), false);
  assert.equal(shouldDressBoardPaper(paper, null), false);
  assert.equal(shouldDressBoardPaper(null, { anyLoaded: true }), false);
});

test('the cast paper family names exactly the authored Paper material', () => {
  assert.equal(castPaperFamilyFor('Paper').id, 'castPaper');
  assert.equal(castPaperFamilyFor('paper').id, 'castPaper');
});

test('the cast family leaves every other material alone', () => {
  for (const name of ['BoardFace', 'BoardPaper', 'BoardNote', 'JobPaper', 'PaperNote',
    'EyeWhite', 'Mouth', 'Cloth', 'WoodP', 'Marker', '']) {
    assert.equal(castPaperFamilyFor(name), null,
      `${name || '(empty)'} must not match the cast paper family`);
  }
  assert.equal(castPaperFamilyFor(undefined), null);
  assert.equal(castPaperFamilyFor(null), null);
});

test('the cast family states its exact material settings and forces a white tint', () => {
  const paper = castPaperParams(castPaperFamilyFor('Paper'));
  assert.deepEqual(paper, { roughness: 0.9, metalness: 0, keepTint: false });
  assert.equal(castPaperParams(null), null);
  for (const family of CAST_PAPER_FAMILIES) assert.equal(family.keepTint, false);
});

test('the cast family waits for its maps rather than half-dressing', () => {
  const paper = castPaperFamilyFor('Paper');
  assert.equal(shouldDressCastPaper(paper, { anyLoaded: true }), true);
  assert.equal(shouldDressCastPaper(paper, { anyLoaded: false }), false);
  assert.equal(shouldDressCastPaper(paper, null), false);
  assert.equal(shouldDressCastPaper(null, { anyLoaded: true }), false);
});

// Round 84: the real pass on the shipped GLBs (assets/npc_*.glb), mirroring
// the boot layer in tests/boot.test.mjs. Oswin's apron and Wren's ledger pages
// are the `Paper` meshes.
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

const PAPER = /^paper$/i;

function paperMeshes(npcs) {
  const out = [];
  for (const npc of npcs) {
    npc.group.traverse((o) => {
      if (o.isMesh && o.material && PAPER.test(o.material.name)) out.push({ npc, mesh: o });
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

test('the shipped rigs carry the expected Paper meshes, with no UVs', async () => {
  const { npcs, summary } = await modelledCast();
  assert.equal(summary.mode, 'model', 'all six rigs must load for this test to mean anything');
  const paper = paperMeshes(npcs);
  // Oswin's apron and Wren's ledger pages, plus a third Paper mesh on one of
  // the other rigs (the live-scene audit counts 3): these are the meshes the
  // pass must dress.
  assert.equal(paper.length, 3);
  for (const { npc, mesh } of paper) {
    assert.equal(mesh.geometry.getAttribute('uv'), undefined,
      `${npc.id}/${mesh.name} ships without UVs -- the pass must project them`);
  }
});

test('dressCastPaper gives every paper mesh projected UVs and all three maps', async () => {
  const { THREE, npcs } = await modelledCast();
  const { dressCastPaper } = await import('../src/npcs.js');
  const result = dressCastPaper(npcs, mapSet(THREE), { THREE });

  assert.equal(result.anyLoaded, true);
  assert.equal(result.dressed, 3);
  assert.deepEqual(result.perFamily, { castPaper: 3 });
  assert.equal(result.meshes.length, 3);

  const paper = paperMeshes(npcs);
  for (const { npc, mesh } of paper) {
    const uv = mesh.geometry.getAttribute('uv');
    assert.ok(uv, `${npc.id}/${mesh.name} must gain a uv attribute`);
    assert.equal(uv.itemSize, 2);
    assert.equal(uv.count, mesh.geometry.getAttribute('position').count, 'one UV pair per vertex');
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
    // keepTint is false: the paper albedo is already cream, so the tint must
    // stay white, not the authored cream multiplied onto the map.
    assert.equal(material.color.getHexString(), 'ffffff');
    assert.equal(mesh.userData.paperDressed, true);
  }
});

test('dressing the paper leaves every other cast material alone', async () => {
  const { THREE, npcs } = await modelledCast();
  const { dressCastPaper } = await import('../src/npcs.js');

  const before = [];
  for (const npc of npcs) {
    npc.group.traverse((o) => {
      if (!o.isMesh || PAPER.test(o.material.name)) return;
      before.push({
        key: `${npc.id}/${o.name}`,
        material: o.material,
        map: o.material.map,
        hasUv: Boolean(o.geometry.getAttribute('uv'))
      });
    });
  }
  dressCastPaper(npcs, mapSet(THREE), { THREE });

  for (const { npc, mesh } of paperMeshes(npcs)) assert.ok(mesh.userData.paperDressed);
  for (const entry of before) {
    assert.equal(entry.material.map, null, `${entry.key} must keep no map`);
    assert.equal(Boolean(entry.material.normalMap), false, `${entry.key} must keep no normal map`);
    assert.equal(Boolean(entry.material.roughnessMap), false, `${entry.key} must keep no roughness map`);
  }
});

test('a future variant name is not caught by accident', () => {
  assert.equal(boardPaperFamilyFor('BoardNote'), null);
  assert.equal(boardPaperFamilyFor('JobPaper'), null);
});

test('the family states its exact material settings and forces a white tint', () => {
  const paper = boardPaperParams(boardPaperFamilyFor('BoardFace'));
  assert.deepEqual(paper, { roughness: 0.9, metalness: 0, keepTint: false });
  assert.equal(boardPaperParams(null), null);
  for (const family of BOARD_PAPER_FAMILIES) assert.equal(family.keepTint, false);
});

test('a family waits for its maps rather than half-dressing', () => {
  const paper = boardPaperFamilyFor('BoardFace');
  assert.equal(shouldDressBoardPaper(paper, { anyLoaded: true }), true);
  assert.equal(shouldDressBoardPaper(paper, { anyLoaded: false }), false);
  assert.equal(shouldDressBoardPaper(paper, null), false);
  assert.equal(shouldDressBoardPaper(null, { anyLoaded: true }), false);
});

async function boardGroup() {
  const THREE = await import('three');
  const { dressBoardPaper } = await import('../src/world.js');
  const group = new THREE.Group();
  // The job board's face: a 1.2 x 0.9 m plane of pinned paper.
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 0.9),
    new THREE.MeshStandardMaterial({ color: 0xd8c9a8, roughness: 0.95 })
  );
  face.material.name = 'BoardFace';
  face.name = 'jobBoardFace';
  face.userData.authoredRoughness = 0.95;
  group.add(face);
  // The three pinned slips, so it reads as a job board from a distance.
  for (let i = 0; i < 3; i += 1) {
    const slip = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xf2ead6, roughness: 1 })
    );
    slip.material.name = 'BoardPaper';
    slip.name = `jobBoardSlip${i}`;
    slip.userData.authoredRoughness = 1;
    group.add(slip);
  }
  return { THREE, group, face, dressBoardPaper };
}

function mapSet(THREE) {
  return {
    map: new THREE.Texture(),
    normalMap: new THREE.Texture(),
    roughnessMap: new THREE.Texture(),
    anyLoaded: true
  };
}

test('dressBoardPaper dresses the face and all three slips', async () => {
  const { THREE, group, face, dressBoardPaper } = await boardGroup();
  const result = dressBoardPaper(group, mapSet(THREE), { THREE });

  assert.equal(result.dressed, 4);
  assert.ok(result.seams >= 0);
  for (const { mesh } of [...group.children].map((m) => ({ mesh: m }))) {
    const material = mesh.material;
    for (const key of ['map', 'normalMap', 'roughnessMap']) {
      assert.ok(material[key], `${mesh.name} must carry ${key}`);
      assert.equal(material[key].wrapS, THREE.RepeatWrapping, `${key} wraps in U`);
      assert.equal(material[key].wrapT, THREE.RepeatWrapping, `${key} wraps in V`);
      assert.deepEqual([material[key].repeat.x, material[key].repeat.y], [1, 1],
        'the metre projection carries the tile, not a texture repeat');
    }
    assert.equal(material.roughness, 0.9);
    assert.equal(material.metalness, 0);
    // keepTint is false: the paper albedo is already cream, so the tint must
    // be white, not the authored cream multiplied onto the map.
    assert.equal(material.color.getHexString(), 'ffffff');
    assert.equal(mesh.userData.boardPaperDressed, true);
    assert.ok(mesh.geometry.getAttribute('uv'), `${mesh.name} must gain UVs`);
  }
  assert.equal(result.dressed, 4);
});

test('a failed download leaves the board flat instead of half-dressed', async () => {
  const { THREE, group, face } = await boardGroup();
  const { dressBoardPaper } = await import('../src/world.js');
  const none = dressBoardPaper(group, { map: null, normalMap: null, roughnessMap: null, anyLoaded: false }, { THREE });
  assert.equal(none.dressed, 0);
  for (const mesh of group.children) {
    assert.equal(mesh.userData.boardPaperDressed, undefined, 'nothing is marked dressed');
    assert.equal(mesh.material.map, null);
    assert.equal(mesh.material.normalMap, null);
    assert.ok(Math.abs(mesh.material.roughness - mesh.userData.authoredRoughness) < 1e-6,
      'the authored roughness is untouched');
  }
});
