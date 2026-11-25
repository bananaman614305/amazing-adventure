// The lane sacks' pinched neck/tie. Round 87 dresses the SackTie cords by
// reusing the existing cloth maps at a very small physical tile, because a
// 2 cm knotted cord should read as cord, not flat dark paint.
//
// One layer is tested here, mirroring tests/rope.test.mjs but staying pure:
//
//  1. The pure rules in src/sacktie.js (the browser pass lands in a later
//     round with the projection work, so this file holds the rules only).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SACKTIE_TILE_METERS, SACKTIE_FAMILY, SACKTIE_FAMILIES,
  sackTieFamilyFor, sackTieParams, shouldDressSackTie
} from '../src/sacktie.js';

test('the sack-tie tile is 0.04 m', () => {
  assert.equal(SACKTIE_TILE_METERS, 0.04);
});

test('exactly the sack tie material belongs to a family', () => {
  assert.equal(sackTieFamilyFor('SackTie').id, 'sacktie');
  assert.equal(sackTieFamilyFor('sacktie').id, 'sacktie');
});

test('every other material is left alone', () => {
  for (const name of ['LaneRope', 'LanternHousing', 'SackCloth', 'Cloth',
    'Skin', 'BuntingRed', '']) {
    assert.equal(sackTieFamilyFor(name), null,
      `${name || '(empty)'} must not match the sack-tie family`);
  }
  assert.equal(sackTieFamilyFor(undefined), null);
  assert.equal(sackTieFamilyFor(null), null);
});

test('a future variant name is not caught by accident', () => {
  assert.equal(sackTieFamilyFor('SackTie2'), null);
  assert.equal(sackTieFamilyFor('NeckTie'), null);
});

test('the family states its exact material settings and keeps the cord tint', () => {
  const tie = sackTieParams(sackTieFamilyFor('SackTie'));
  assert.deepEqual(tie, { roughness: 0.95, metalness: 0, keepTint: true });
  assert.equal(sackTieParams(null), null);
});

test('the sack-tie family waits for its maps rather than half-dressing', () => {
  const tie = sackTieFamilyFor('SackTie');
  assert.equal(shouldDressSackTie(tie, { anyLoaded: true }), true);
  assert.equal(shouldDressSackTie(tie, { anyLoaded: false }), false);
  assert.equal(shouldDressSackTie(tie, null), false);
  assert.equal(shouldDressSackTie(null, { anyLoaded: true }), false);
  assert.equal(shouldDressSackTie(undefined, undefined), false);
});

test('the family declares a positive tile and an in-range roughness', () => {
  assert.ok(SACKTIE_FAMILY.tileMeters > 0);
  assert.ok(SACKTIE_FAMILY.roughness >= 0 && SACKTIE_FAMILY.roughness <= 1);
  for (const family of SACKTIE_FAMILIES) {
    assert.ok(family.tileMeters > 0);
    assert.ok(family.roughness >= 0 && family.roughness <= 1);
  }
});

test('the family keeps the authored tint', () => {
  for (const family of SACKTIE_FAMILIES) assert.equal(family.keepTint, true);
});
