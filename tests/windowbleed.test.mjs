import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BLEED_SEED,
  BLEED_COUNT,
  BLEED_MAX_COUNT,
  BLEED_MIN_RADIUS,
  BLEED_MAX_RADIUS,
  BLEED_JITTER,
  BLEED_WALL_LIFT,
  bleedStrength,
  bleedEnabled,
  bleedDecals
} from '../src/windowbleed.js';

const ANCHORS = [
  { x: 16, z: 0, y: 2.4, radius: 0.8, warmth: 0.95 },
  { x: -16, z: 0, y: 2.0, radius: 0.7, warmth: 0.9 }
];

test('bleedStrength: day is 0', () => {
  assert.equal(bleedStrength('day', 0), 0);
  assert.equal(bleedStrength('day', 1), 0);
});

test('bleedStrength: dusk scales night fraction', () => {
  assert.equal(bleedStrength('dusk', 0), 0);
  assert.ok(bleedStrength('dusk', 1) > 0);
  assert.ok(bleedStrength('dusk', 0.5) > 0);
});

test('bleedStrength: night is full at night=1', () => {
  assert.equal(bleedStrength('night', 1), 1);
});

test('bleedStrength: junk guards', () => {
  assert.equal(bleedStrength(null, 1), 0);
  assert.equal(bleedStrength('night', NaN), 0);
  assert.equal(bleedStrength('night', Infinity), 0);
  assert.equal(bleedStrength('night', -1), 0);
  assert.equal(bleedStrength('night', 2), 1);
  assert.equal(bleedStrength('bogus', 1), 0);
});

test('bleedEnabled: low drops, others keep', () => {
  assert.equal(bleedEnabled('low'), false);
  assert.equal(bleedEnabled('full'), true);
  assert.equal(bleedEnabled('bogus'), true);
});

test('bleedDecals: returns one per usable anchor', () => {
  const out = bleedDecals(ANCHORS);
  assert.equal(out.length, 2);
});

test('bleedDecals: each descriptor has x,y,z,radius,opacity', () => {
  const out = bleedDecals(ANCHORS);
  for (const d of out) {
    assert.ok(Number.isFinite(d.x));
    assert.ok(Number.isFinite(d.y));
    assert.ok(Number.isFinite(d.z));
    assert.ok(Number.isFinite(d.radius));
    assert.ok(Number.isFinite(d.opacity));
    assert.ok(d.radius >= BLEED_MIN_RADIUS && d.radius <= BLEED_MAX_RADIUS);
    assert.ok(d.opacity >= 0.08 && d.opacity <= 0.32);
  }
});

test('bleedDecals: determinism', () => {
  const a = JSON.stringify(bleedDecals(ANCHORS));
  const b = JSON.stringify(bleedDecals(ANCHORS));
  assert.equal(a, b);
});

test('bleedDecals: junk anchors dropped', () => {
  const out = bleedDecals([{ x: NaN, y: 1, z: 0 }, { x: 1, y: 1, z: 1 }, null, 42]);
  assert.equal(out.length, 1);
});

test('bleedDecals: non-array returns empty', () => {
  assert.deepEqual(bleedDecals(null), []);
  assert.deepEqual(bleedDecals('foo'), []);
});

test('bleedDecals: max count cap', () => {
  const big = Array.from({ length: 100 }, (_, i) => ({ x: i, y: 1, z: 0 }));
  const out = bleedDecals(big);
  assert.equal(out.length, BLEED_MAX_COUNT);
});

test('bleedDecals: warmth drives radius', () => {
  const cool = bleedDecals([{ x: 1, y: 1, z: 0, warmth: 0.82 }]);
  const warm = bleedDecals([{ x: 1, y: 1, z: 0, warmth: 1.0 }]);
  assert.ok(warm[0].radius >= cool[0].radius);
});

test('bleedDecals: no NaN/Infinity', () => {
  const junk = bleedDecals([{ x: 1e10, y: -1e10, z: 0, radius: 1e10, warmth: 1e10 }]);
  for (const d of junk) {
    for (const v of Object.values(d)) {
      assert.ok(Number.isFinite(v));
    }
  }
});
