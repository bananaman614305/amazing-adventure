// The lane bunting's rope strand. Round 86 dresses the LaneRope boxes with
// a procedural twisted-fibre rope map, because a 2 cm rope spanning the lane
// should read as laid fibre, not flat brown plastic.
//
// One layer is tested here, mirroring tests/paper.test.mjs but staying pure:
//
//  1. The pure rules in src/rope.js (the browser pass lands in a later
//     round with the projection work, so this file holds the rules only).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROPE_TILE_METERS, ROPE_FAMILY, ROPE_FAMILIES,
  ropeFamilyFor, ropeParams, shouldDressRope
} from '../src/rope.js';

test('the rope tile is 0.08 m', () => {
  assert.equal(ROPE_TILE_METERS, 0.08);
});

test('exactly the lane rope material belongs to a family', () => {
  assert.equal(ropeFamilyFor('LaneRope').id, 'rope');
  assert.equal(ropeFamilyFor('lanerope').id, 'rope');
});

test('every other material is left alone', () => {
  for (const name of ['EyeWhite', 'Cloth', 'Skin', 'HairC', 'Accent', 'Steel',
    'WoodP', 'Marker', 'Paper', 'BuntingRed', 'SackTie', '']) {
    assert.equal(ropeFamilyFor(name), null,
      `${name || '(empty)'} must not match the rope family`);
  }
  assert.equal(ropeFamilyFor(undefined), null);
  assert.equal(ropeFamilyFor(null), null);
});

test('a future variant name is not caught by accident', () => {
  assert.equal(ropeFamilyFor('RopeTie'), null);
  assert.equal(ropeFamilyFor('LaneRope2'), null);
});

test('the family states its exact material settings and keeps the brown tint', () => {
  const rope = ropeParams(ropeFamilyFor('LaneRope'));
  assert.deepEqual(rope, { roughness: 0.9, metalness: 0, keepTint: true });
  assert.equal(ropeParams(null), null);
});

test('the rope family waits for its maps rather than half-dressing', () => {
  const rope = ropeFamilyFor('LaneRope');
  assert.equal(shouldDressRope(rope, { anyLoaded: true }), true);
  assert.equal(shouldDressRope(rope, { anyLoaded: false }), false);
  assert.equal(shouldDressRope(rope, null), false);
  assert.equal(shouldDressRope(null, { anyLoaded: true }), false);
  assert.equal(shouldDressRope(undefined, undefined), false);
});

test('the family declares a positive tile and an in-range roughness', () => {
  assert.ok(ROPE_FAMILY.tileMeters > 0);
  assert.ok(ROPE_FAMILY.roughness >= 0 && ROPE_FAMILY.roughness <= 1);
  for (const family of ROPE_FAMILIES) {
    assert.ok(family.tileMeters > 0);
    assert.ok(family.roughness >= 0 && family.roughness <= 1);
  }
});

test('the family keeps the authored tint', () => {
  for (const family of ROPE_FAMILIES) assert.equal(family.keepTint, true);
});
