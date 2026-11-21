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