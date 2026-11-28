// Round 72: the cast's carried-prop wood family.
//
// Two layers are tested here.
//
//  1. The pure rules in src/woodprop.js: which authored material names belong to
//     a family, the tile the family projects at, and the exact material settings
//     a dressed mesh must end up with. These are what npcs.js and the tests both
//     read, so a well-meaning regex edit that starts catching `BarkWood` fails
//     here instead of overwriting the trunks with plank grain.
//
//  2. The family must never swallow materials that already own their own passes,
//     and must not keep the tint (the reused albedo already carries the wood
//     colour).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAST_WOOD_TILE_METERS, CAST_WOOD_FAMILIES,
  castWoodFamilyFor, castWoodParams, shouldDressCastWood
} from '../src/woodprop.js';

// --- The pure rules --------------------------------------------------------

test('the wood tile is sized for 0.25-0.35 m personal props at Talk range', () => {
  // A 0.45 m tile puts about one tile across the ledger board and only a sliver
  // of grain along the 4 cm pole, which is the scale of real grain on a small
  // carried item -- not the crate family's 1.5 m board smeared over a whole prop.
  assert.equal(CAST_WOOD_TILE_METERS, 0.45);
  assert.ok(CAST_WOOD_TILE_METERS > 0);
  assert.ok(CAST_WOOD_TILE_METERS < 1);
});

test('exactly the authored WoodP material belongs to a family', () => {
  assert.equal(castWoodFamilyFor('WoodP').id, 'wood');
  assert.equal(castWoodFamilyFor('woodp').id, 'wood');
  assert.equal(castWoodFamilyFor('WOODP').id, 'wood');
});

test('every other cast material is left alone', () => {
  // `BarkWood` owns the bark pass and must not be caught by the loose "Wood"
  // substring; `WoodTrim` and `WoodPHandle` are future role materials that must
  // not join the carried-prop family; the rest already own their own passes.
  for (const name of ['BarkWood', 'WoodTrim', 'Wood', 'WoodPHandle', 'Cloth',
    'Steel', 'Skin', 'HairC', 'Accent', 'Boot', 'Paper', 'EyeWhite', 'EyeIris',
    'Mouth', 'Marker', '']) {
    assert.equal(castWoodFamilyFor(name), null,
      `${name || '(empty)'} must not match a cast wood family`);
  }
  assert.equal(castWoodFamilyFor(undefined), null);
  assert.equal(castWoodFamilyFor(null), null);
});

test('non-string and junk input never throws and yields null', () => {
  for (const v of [42, {}, [], true, 0, NaN, Infinity, -Infinity]) {
    assert.equal(castWoodFamilyFor(v), null, `${String(v)} must not match`);
  }
});

test('each family states its exact material settings and does not keep the tint', () => {
  const wood = castWoodParams(castWoodFamilyFor('WoodP'));
  assert.deepEqual(wood, { roughness: 0.78, metalness: 0, keepTint: false });
  assert.equal(castWoodParams(null), null);
  // The reused albedo already carries the wood colour; a tint multiply would
  // only darken the prop, so the family deliberately drops the tint.
  for (const family of CAST_WOOD_FAMILIES) assert.equal(family.keepTint, false);
});

test('a family waits for its maps rather than half-dressing', () => {
  const wood = castWoodFamilyFor('WoodP');
  assert.equal(shouldDressCastWood(wood, { anyLoaded: true }), true);
  assert.equal(shouldDressCastWood(wood, { anyLoaded: false }), false);
  assert.equal(shouldDressCastWood(wood, null), false);
  assert.equal(shouldDressCastWood(null, { anyLoaded: true }), false);
});

test('the family never emits NaN or Infinity from params', () => {
  const params = castWoodParams(castWoodFamilyFor('WoodP'));
  for (const v of Object.values(params)) {
    if (typeof v === 'number') assert.ok(Number.isFinite(v), `non-finite: ${v}`);
  }
});

test('determinism: repeated calls agree', () => {
  assert.equal(castWoodFamilyFor('WoodP').id, castWoodFamilyFor('WoodP').id);
  assert.deepEqual(castWoodParams(castWoodFamilyFor('WoodP')),
    castWoodParams(castWoodFamilyFor('WoodP')));
});
