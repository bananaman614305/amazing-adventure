// The lane props' dressing pass. Round 87 dresses the lamp's lantern housings
// (LanternHousing) and the sacks' ties (SackTie) by reusing existing maps at a
// smaller physical tile. The pure rules live in tests/housing.test.mjs and
// tests/sacktie.test.mjs; this file tests the real pass on hand-built meshes.
//
// The lane props are procedural (the housings are tapered cylinders, the ties
// are small cylinders/torus), so the test builds them the way the scene does,
// with no UVs and one authored material shared by several meshes.
import test from 'node:test';
import assert from 'node:assert/strict';

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

// One tapered 8-sided housing material shared by two meshes, plus a tie
// material shared by two small meshes. No UVs anywhere, as authored.
async function laneMeshes() {
  const THREE = await import('three');
  const housing = new THREE.MeshStandardMaterial({ color: 0x4a5a6a, roughness: 0.8, metalness: 0.1 });
  housing.name = 'LanternHousing';
  const tie = new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 0.6, metalness: 0 });
  tie.name = 'SackTie';

  // Three.js' built-in geometries ship with UVs; the authored lane meshes have
  // none, so strip them to make the test prove the pass projects its own.
  const bare = (geometry) => {
    geometry.deleteAttribute('uv');
    return geometry;
  };

  const housings = [];
  for (let i = 0; i < 3; i += 1) {
    const mesh = new THREE.Mesh(bare(new THREE.CylinderGeometry(0.09, 0.13, 0.24, 8)), housing);
    mesh.name = `lanternHousing${i}`;
    housings.push(mesh);
  }

  const ties = [];
  for (let i = 0; i < 9; i += 1) {
    const geometry = i % 2 === 0
      ? bare(new THREE.CylinderGeometry(0.02, 0.02, 0.02, 6))
      : bare(new THREE.TorusGeometry(0.02, 0.006, 4, 8));
    const mesh = new THREE.Mesh(geometry, tie);
    mesh.name = `sackTie${i}`;
    ties.push(mesh);
  }

  return { THREE, housing, tie, housings, ties };
}

test('dressLanternHousing dresses every housing and shares one new material', async () => {
  const { THREE, housing, housings } = await laneMeshes();
  const { dressLanternHousing } = await import('../src/lanedress.js');
  const result = dressLanternHousing(housings, mapSet(THREE), { THREE });

  assert.deepEqual(result, { dressed: 3, seams: result.seams, materials: 1 });
  assert.ok(result.seams >= 0);

  for (const mesh of housings) {
    const uv = mesh.geometry.getAttribute('uv');
    assert.ok(uv, `${mesh.name} must gain a uv attribute`);
    assert.equal(uv.itemSize, 2);
    assert.equal(uv.count, mesh.geometry.getAttribute('position').count, 'one UV pair per vertex');
    assert.ok(uvSpan(mesh) > 0, `${mesh.name} UVs must not collapse to a point`);

    const material = mesh.material;
    for (const key of ['map', 'normalMap', 'roughnessMap']) {
      assert.ok(material[key], `${mesh.name} must carry ${key}`);
      assert.equal(material[key].wrapS, THREE.RepeatWrapping, `${key} wraps in U`);
      assert.equal(material[key].wrapT, THREE.RepeatWrapping, `${key} wraps in V`);
      assert.deepEqual([material[key].repeat.x, material[key].repeat.y], [1, 1],
        'the metre projection carries the tile, not a texture repeat');
    }
    assert.equal(material.roughness, 0.55);
    assert.equal(material.metalness, 0.35);
    // keepTint is false: the lamp albedo already carries the paint colour, so
    // the tint must stay white or the authored colour multiplies it down.
    assert.equal(material.color.getHexString(), 'ffffff');
    assert.equal(material.name, 'LanternHousing');
    assert.equal(mesh.userData.housingDressed, true);
  }

  // The source material was shared, so the dressed one must be too.
  assert.equal(housings[0].material, housings[1].material);
  assert.equal(housings[1].material, housings[2].material);
  assert.notEqual(housings[0].material, housing, 'the authored material is replaced');
});

test('dressSackTie dresses every tie, keeps the cord tint and shares one material', async () => {
  const { THREE, tie, ties } = await laneMeshes();
  const { dressSackTie } = await import('../src/lanedress.js');
  const result = dressSackTie(ties, mapSet(THREE), { THREE });

  assert.deepEqual(result, { dressed: 9, seams: result.seams, materials: 1 });
  assert.ok(result.seams >= 0);

  for (const mesh of ties) {
    const uv = mesh.geometry.getAttribute('uv');
    assert.ok(uv, `${mesh.name} must gain a uv attribute`);
    assert.equal(uv.itemSize, 2);
    assert.equal(uv.count, mesh.geometry.getAttribute('position').count);
    assert.ok(uvSpan(mesh) > 0, `${mesh.name} UVs must not collapse to a point`);

    const material = mesh.material;
    for (const key of ['map', 'normalMap', 'roughnessMap']) {
      assert.ok(material[key], `${mesh.name} must carry ${key}`);
      assert.equal(material[key].wrapS, THREE.RepeatWrapping);
      assert.equal(material[key].wrapT, THREE.RepeatWrapping);
      assert.deepEqual([material[key].repeat.x, material[key].repeat.y], [1, 1]);
    }
    assert.equal(material.roughness, 0.95);
    assert.equal(material.metalness, 0);
    // keepTint is true: the authored dark cord colour must survive.
    assert.equal(material.color.getHexString(), '241a12');
    assert.equal(material.name, 'SackTie');
    assert.equal(mesh.userData.sackTieDressed, true);
  }

  assert.equal(ties[0].material, ties[1].material);
  assert.notEqual(ties[0].material, tie);
});

test('the two passes leave an unrelated material untouched', async () => {
  const { THREE, housings, ties } = await laneMeshes();
  const { dressLanternHousing, dressSackTie } = await import('../src/lanedress.js');

  const other = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.42, metalness: 0.2 });
  other.name = 'LanternHousing2';
  const otherGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.2, 8);
  otherGeometry.deleteAttribute('uv');
  const mesh = new THREE.Mesh(otherGeometry, other);
  mesh.name = 'variantHousing';

  dressLanternHousing([...housings, mesh], mapSet(THREE), { THREE });
  dressSackTie([...ties, mesh], mapSet(THREE), { THREE });

  assert.equal(mesh.material, other, 'the variant keeps its authored material');
  assert.equal(mesh.material.map, null);
  assert.equal(mesh.material.normalMap, null);
  assert.equal(mesh.material.roughnessMap, null);
  assert.equal(mesh.material.roughness, 0.42, 'the authored roughness is intact');
  assert.equal(mesh.geometry.getAttribute('uv'), undefined, 'no UVs are projected onto it');
  assert.equal(mesh.userData.housingDressed, undefined);
  assert.equal(mesh.userData.sackTieDressed, undefined);
});

test('a failed download dresses nothing and leaves every material untouched', async () => {
  const { THREE, housing, tie, housings, ties } = await laneMeshes();
  const { dressLanternHousing, dressSackTie } = await import('../src/lanedress.js');
  const none = { map: null, normalMap: null, roughnessMap: null, anyLoaded: false };

  const housingResult = dressLanternHousing(housings, none, { THREE });
  const tieResult = dressSackTie(ties, none, { THREE });
  assert.deepEqual(housingResult, { dressed: 0, seams: 0, materials: 0 });
  assert.deepEqual(tieResult, { dressed: 0, seams: 0, materials: 0 });

  for (const mesh of housings) {
    assert.equal(mesh.material, housing, 'the authored material is untouched');
    assert.equal(mesh.userData.housingDressed, undefined);
    assert.equal(mesh.material.map, null);
    assert.equal(mesh.material.roughness, 0.8);
    assert.equal(mesh.geometry.getAttribute('uv'), undefined, 'nothing is projected');
  }
  for (const mesh of ties) {
    assert.equal(mesh.material, tie, 'the authored material is untouched');
    assert.equal(mesh.userData.sackTieDressed, undefined);
    assert.equal(mesh.material.map, null);
    assert.equal(mesh.material.roughness, 0.6);
  }
});

test('empty and missing inputs are safe', async () => {
  const THREE = await import('three');
  const { dressLanternHousing, dressSackTie } = await import('../src/lanedress.js');

  assert.deepEqual(dressLanternHousing([], mapSet(THREE), { THREE }),
    { dressed: 0, seams: 0, materials: 0 });
  assert.deepEqual(dressSackTie([], mapSet(THREE), { THREE }),
    { dressed: 0, seams: 0, materials: 0 });
  assert.deepEqual(dressLanternHousing(null, mapSet(THREE), { THREE }),
    { dressed: 0, seams: 0, materials: 0 });
  assert.deepEqual(dressSackTie(undefined, mapSet(THREE), { THREE }),
    { dressed: 0, seams: 0, materials: 0 });
  assert.deepEqual(dressLanternHousing([], null, { THREE }),
    { dressed: 0, seams: 0, materials: 0 });
  assert.deepEqual(dressSackTie([], undefined, { THREE }),
    { dressed: 0, seams: 0, materials: 0 });
});
