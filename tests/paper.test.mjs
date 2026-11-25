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
import {
  CAST_PAPER_TILE_METERS, BOARD_PAPER_FAMILIES,
  boardPaperFamilyFor, boardPaperParams, shouldDressBoardPaper
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
