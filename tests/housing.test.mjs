import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HOUSING_TILE_METERS, HOUSING_FAMILY, HOUSING_FAMILIES,
  housingFamilyFor, housingParams, shouldDressHousing
} from '../src/housing.js';

test('the housing tile is 0.25 m', () => {
  assert.equal(HOUSING_TILE_METERS, 0.25);
});

test('exactly the lantern housing material belongs to a family', () => {
  assert.equal(housingFamilyFor('LanternHousing').id, 'housing');
  assert.equal(housingFamilyFor('lanternhousing').id, 'housing');
  for (const name of ['LaneRope', 'SackTie', 'LampIronPainted', 'Cloth', 'Skin', 'BuntingRed', '']) {
    assert.equal(housingFamilyFor(name), null,
      `${name || '(empty)'} must not match the housing family`);
  }
  assert.equal(housingFamilyFor(undefined), null);
  assert.equal(housingFamilyFor(null), null);
});

test('a future variant name is not caught by accident', () => {
  assert.equal(housingFamilyFor('LanternHousing2'), null);
  assert.equal(housingFamilyFor('Housing'), null);
});

test('the family states its exact material settings and forces a white tint', () => {
  const housing = housingParams(housingFamilyFor('LanternHousing'));
  assert.deepEqual(housing, { roughness: 0.55, metalness: 0.35, keepTint: false });
});

test('the housing family waits for its maps rather than half-dressing', () => {
  const housing = housingFamilyFor('LanternHousing');
  assert.equal(shouldDressHousing(housing, { anyLoaded: true }), true);
  assert.equal(shouldDressHousing(housing, { anyLoaded: false }), false);
  assert.equal(shouldDressHousing(housing, null), false);
  assert.equal(shouldDressHousing(null, { anyLoaded: true }), false);
  assert.equal(shouldDressHousing(undefined, undefined), false);
});

test('the family declares a positive tile and in-range roughness and metalness', () => {
  assert.ok(HOUSING_FAMILY.tileMeters > 0);
  assert.ok(HOUSING_FAMILY.roughness >= 0 && HOUSING_FAMILY.roughness <= 1);
  assert.ok(HOUSING_FAMILY.metalness >= 0 && HOUSING_FAMILY.metalness <= 1);
  for (const family of HOUSING_FAMILIES) {
    assert.ok(family.tileMeters > 0);
    assert.ok(family.roughness >= 0 && family.roughness <= 1);
    assert.ok(family.metalness >= 0 && family.metalness <= 1);
  }
});

test('the family forces a white tint', () => {
  for (const family of HOUSING_FAMILIES) assert.equal(family.keepTint, false);
});

test('housingParams(null) === null', () => {
  assert.equal(housingParams(null), null);
});
