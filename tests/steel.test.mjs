// Round 110: the cast's armour families.
//
// Two layers are tested here.
//
//  1. The pure rules in src/steel.js: which authored material names belong to a
//     family, the tile the family projects at, and the exact material settings a
//     dressed mesh must end up with. These are what npcs.js and the tests both
//     read, so a well-meaning regex edit that starts catching `WoodP` fails
//     here instead of dressing the spear shaft as metal.
//
//  2. The family must never swallow materials that already own their own passes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAST_STEEL_TILE_METERS, CAST_STEEL_FAMILIES,
  castSteelFamilyFor, castSteelParams, shouldDressCastSteel
} from '../src/steel.js';

// --- The pure rules --------------------------------------------------------

test('the steel tile is sized for a 0.2-0.3 m armour piece at Talk range', () => {
  // A 0.2 m tile puts about one tile across a pauldron and a little over one
  // across the helmet, so the forge marks read as relief rather than as a
  // single smudge per plate.
  assert.equal(CAST_STEEL_TILE_METERS, 0.2);
  assert.ok(CAST_STEEL_TILE_METERS > 0);
  assert.ok(CAST_STEEL_TILE_METERS < 1);
});

test('exactly the authored Steel material belongs to a family', () => {
  assert.equal(castSteelFamilyFor('Steel').id, 'steel');
  assert.equal(castSteelFamilyFor('steel').id, 'steel');
  assert.equal(castSteelFamilyFor('STEEL').id, 'steel');
});

test('every other cast material is left alone', () => {
  // The eyes and mouth are too small for a relief tile, the skin and hair carry
  // the character's identity, and the cloth/accent/boot/paper families already
  // own their own materials. None of these may be swallowed by the steel pass.
  for (const name of ['Skin', 'HairC', 'Cloth', 'Accent', 'Boot', 'WoodP',
    'Paper', 'EyeWhite', 'EyeIris', 'Mouth', 'Marker', '']) {
    assert.equal(castSteelFamilyFor(name), null,
      `${name || '(empty)'} must not match a cast steel family`);
  }
  assert.equal(castSteelFamilyFor(undefined), null);
  assert.equal(castSteelFamilyFor(null), null);
});

test('a future variant name is not caught by accident', () => {
  assert.equal(castSteelFamilyFor('SteelTrim'), null);
  assert.equal(castSteelFamilyFor('Steely'), null);
  assert.equal(castSteelFamilyFor('SteelMarker'), null);
});

test('non-string and junk input never throws and yields null', () => {
  for (const v of [42, {}, [], true, 0, NaN, Infinity, -Infinity]) {
    assert.equal(castSteelFamilyFor(v), null, `${String(v)} must not match`);
  }
});

test('each family states its exact material settings and keeps the tint', () => {
  const steel = castSteelParams(castSteelFamilyFor('Steel'));
  assert.deepEqual(steel, { roughness: 0.35, metalness: 0.7, keepTint: true });
  assert.equal(castSteelParams(null), null);
  // The authored blue-grey is the character's identity; the map must multiply
  // it rather than replace it.
  for (const family of CAST_STEEL_FAMILIES) assert.equal(family.keepTint, true);
});

test('a family waits for its maps rather than half-dressing', () => {
  const steel = castSteelFamilyFor('Steel');
  assert.equal(shouldDressCastSteel(steel, { anyLoaded: true }), true);
  assert.equal(shouldDressCastSteel(steel, { anyLoaded: false }), false);
  assert.equal(shouldDressCastSteel(steel, null), false);
  assert.equal(shouldDressCastSteel(null, { anyLoaded: true }), false);
});

test('the family never emits NaN or Infinity from params', () => {
  const params = castSteelParams(castSteelFamilyFor('Steel'));
  for (const v of Object.values(params)) {
    if (typeof v === 'number') assert.ok(Number.isFinite(v), `non-finite: ${v}`);
  }
});

test('determinism: repeated calls agree', () => {
  assert.equal(castSteelFamilyFor('Steel').id, castSteelFamilyFor('Steel').id);
  assert.deepEqual(castSteelParams(castSteelFamilyFor('Steel')),
    castSteelParams(castSteelFamilyFor('Steel')));
});
