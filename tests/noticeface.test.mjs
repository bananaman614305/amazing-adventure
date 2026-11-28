// The lane's notice board face. Round 72 dresses the 1.4 x 1.2 m painted panel
// (NoticeFaceLane) with the board-paper maps at a coarser tile than the job
// board's slips, because the lane board is read up close from 1-2 m.
//
// Two layers are tested here, mirroring tests/lanedress.test.mjs.
//
//  1. The pure rules in src/noticeface.js.
//
//  2. The real pass on hand-built PlaneGeometry meshes (the board face is
//     procedural, not a shipped GLB, so the test builds it the way
//     src/world.js does and calls the exported dressNoticeFace()).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTICE_FACE_TILE_METERS, NOTICE_FACE_FAMILY, NOTICE_FACE_FAMILIES,
  noticeFaceFamilyFor, noticeFaceParams, shouldDressNoticeFace
} from '../src/noticeface.js';

test('the notice-face tile is 0.4 m', () => {
  assert.equal(NOTICE_FACE_TILE_METERS, 0.4);
  assert.equal(NOTICE_FACE_FAMILY.tileMeters, 0.4);
  assert.deepEqual(NOTICE_FACE_FAMILIES, [NOTICE_FACE_FAMILY]);
});

test('both authored notice-face materials match case-insensitively', () => {
  // NoticeFace is the modelled panel from assets/notice.glb -- the one the
  // player sees; NoticeFaceLane is the procedural stand-in the model pass
  // hides. Both are paper faces at the same tile, so both belong here.
  for (const name of ['NoticeFaceLane', 'noticefacelane', 'NOTICEFACELANE',
    'NoticeFace', 'noticeface', 'NOTICEFACE']) {
    assert.equal(noticeFaceFamilyFor(name).id, 'noticeFace',
      `${name} must match the notice-face family`);
  }
});

test('every near-miss material is left alone', () => {
  for (const name of ['NoticeFrame', 'BoardFace', 'BoardPaper', 'NoticeFaces',
    'LaneNotice', 'NoticeFaceLane2', 'NoticeFaceLaneSlip', 'NoticeFaceWood',
    'EyeWhite', 'WoodP', '']) {
    assert.equal(noticeFaceFamilyFor(name), null,
      `${name || '(empty)'} must not match the notice-face family`);
  }
  assert.equal(noticeFaceFamilyFor(undefined), null);
  assert.equal(noticeFaceFamilyFor(null), null);
});

test('the family states its exact material settings and forces a white tint', () => {
  const params = noticeFaceParams(noticeFaceFamilyFor('NoticeFaceLane'));
  assert.deepEqual(params, { roughness: 0.9, metalness: 0, keepTint: false });
  assert.equal(noticeFaceParams(null), null);
  assert.equal(NOTICE_FACE_FAMILY.keepTint, false);
  assert.equal(NOTICE_FACE_FAMILY.id, 'noticeFace');
  assert.equal(NOTICE_FACE_FAMILY.roughness, 0.9);
  assert.equal(NOTICE_FACE_FAMILY.metalness, 0);
});

test('a family waits for its maps rather than half-dressing', () => {
  const family = noticeFaceFamilyFor('NoticeFaceLane');
  assert.equal(shouldDressNoticeFace(family, { anyLoaded: true }), true);
  assert.equal(shouldDressNoticeFace(family, { anyLoaded: false }), false);
  assert.equal(shouldDressNoticeFace(family, null), false);
  assert.equal(shouldDressNoticeFace(null, { anyLoaded: true }), false);
  assert.equal(shouldDressNoticeFace(undefined, undefined), false);
});

function mapSet(THREE) {
  return {
    map: new THREE.Texture(),
    normalMap: new THREE.Texture(),
    roughnessMap: new THREE.Texture(),
    anyLoaded: true
  };
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

// The lane board face as src/world.js builds it: a 1.4 x 1.2 m plane of
// painted cream with no UVs, plus a second mesh sharing the same source
// material so the pass must reuse one dressed material.
async function noticeMeshes() {
  const THREE = await import('three');
  const faceMaterial = new THREE.MeshStandardMaterial({ color: 0xd8c9a8, roughness: 0.95 });
  faceMaterial.name = 'NoticeFaceLane';

  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.2), faceMaterial);
  face.name = 'laneNoticeFace';

  const twin = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.2), faceMaterial);
  twin.name = 'laneNoticeFaceTwin';

  return { THREE, faceMaterial, face, twin, meshes: [face, twin] };
}

test('dressNoticeFace dresses the face with UVs, all three maps and a white tint', async () => {
  const { THREE, face, twin, meshes } = await noticeMeshes();
  const { dressNoticeFace } = await import('../src/noticeface.js');
  const result = dressNoticeFace(meshes, mapSet(THREE), { THREE });

  assert.equal(result.dressed, 2);
  assert.equal(result.materials, 1);
  assert.ok(result.seams >= 0);

  for (const mesh of meshes) {
    const uv = mesh.geometry.getAttribute('uv');
    assert.ok(uv, `${mesh.name} must carry projected UVs`);
    assert.equal(uv.itemSize, 2);
    assert.equal(uv.count, mesh.geometry.getAttribute('position').count, 'one UV pair per vertex');
    assert.ok(uvSpan(mesh) > 1,
      `${mesh.name} UVs must span more than one tile -- the 0.4 m projection replaced the plane's 0..1 UVs`);

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
    // keepTint is false: the paper albedo already carries the cream, so the
    // tint must stay white or the authored 0xd8c9a8 multiplies it down.
    assert.equal(material.color.getHexString(), 'ffffff');
    assert.equal(material.name, 'NoticeFaceLane');
    assert.equal(mesh.userData.noticeFaceDressed, true);
  }

  // The source material was shared, so the dressed one must be too.
  assert.equal(face.material, twin.material);
});

test('an unrelated material is left untouched', async () => {
  const { THREE, meshes } = await noticeMeshes();
  const { dressNoticeFace } = await import('../src/noticeface.js');

  const other = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.42 });
  other.name = 'NoticeFrame';
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), other);
  mesh.name = 'nearMissFace';
  const authoredUv = mesh.geometry.getAttribute('uv');

  dressNoticeFace([...meshes, mesh], mapSet(THREE), { THREE });

  assert.equal(mesh.material, other, 'the near-miss keeps its authored material');
  assert.equal(mesh.material.map, null);
  assert.equal(mesh.material.normalMap, null);
  assert.equal(mesh.material.roughnessMap, null);
  assert.equal(mesh.material.roughness, 0.42, 'the authored roughness is intact');
  assert.equal(mesh.geometry.getAttribute('uv'), authoredUv,
    'the authored UVs are not reprojected');
  assert.equal(mesh.userData.noticeFaceDressed, undefined);
});

test('a failed download dresses nothing and leaves the authored roughness intact', async () => {
  const { THREE, faceMaterial, meshes } = await noticeMeshes();
  const { dressNoticeFace } = await import('../src/noticeface.js');
  const none = { map: null, normalMap: null, roughnessMap: null, anyLoaded: false };
  const authoredUvs = meshes.map((mesh) => mesh.geometry.getAttribute('uv'));

  const result = dressNoticeFace(meshes, none, { THREE });
  assert.deepEqual(result, { dressed: 0, seams: 0, materials: 0 });

  meshes.forEach((mesh, i) => {
    assert.equal(mesh.material, faceMaterial, 'the authored material is untouched');
    assert.equal(mesh.material.map, null);
    assert.equal(mesh.material.normalMap, null);
    assert.equal(mesh.material.roughnessMap, null);
    assert.equal(mesh.material.roughness, 0.95, 'the authored roughness is intact');
    assert.equal(mesh.material.color.getHexString(), 'd8c9a8', 'the authored cream is intact');
    assert.equal(mesh.userData.noticeFaceDressed, undefined);
    assert.equal(mesh.geometry.getAttribute('uv'), authoredUvs[i], 'nothing is reprojected');
  });
});

test('empty and missing inputs are safe', async () => {
  const THREE = await import('three');
  const { dressNoticeFace } = await import('../src/noticeface.js');

  assert.deepEqual(dressNoticeFace([], mapSet(THREE), { THREE }),
    { dressed: 0, seams: 0, materials: 0 });
  assert.deepEqual(dressNoticeFace(null, mapSet(THREE), { THREE }),
    { dressed: 0, seams: 0, materials: 0 });
  assert.deepEqual(dressNoticeFace([], null, { THREE }),
    { dressed: 0, seams: 0, materials: 0 });
  assert.deepEqual(dressNoticeFace([], undefined, { THREE }),
    { dressed: 0, seams: 0, materials: 0 });
});
