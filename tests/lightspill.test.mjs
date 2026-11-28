import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SPILL_SEED,
  SPILL_COUNT,
  SPILL_MAX_COUNT,
  SPILL_MIN_RADIUS,
  SPILL_MAX_RADIUS,
  SPILL_JITTER,
  SPILL_DECAL_LIFT,
  spillStrength,
  spillEnabled,
  spillDecals
} from '../src/lightspill.js';
import { PUDDLE_WATER_Y } from '../src/puddles.js';

const ANCHORS = [
  { x: 16, z: 0, radius: 1.2, warmth: 0.95 },
  { x: -16, z: 0, radius: 1.0, warmth: 0.9 },
  { x: 0, z: 16, radius: 0.9, warmth: 0.85 },
  { x: 0, z: -16, radius: 1.1, warmth: 1.0 },
  { x: 8, z: 8, warmth: 0.88 },
  { x: -8, z: -8 }
];

test('the documented constants keep their values', () => {
  assert.equal(SPILL_SEED, 0x7c4a91);
  assert.equal(SPILL_COUNT, 12);
  assert.equal(SPILL_MAX_COUNT, 64);
  assert.equal(SPILL_MIN_RADIUS, 0.5);
  assert.equal(SPILL_MAX_RADIUS, 2.4);
  assert.equal(SPILL_JITTER, 0.25);
  assert.ok(Number.isFinite(SPILL_DECAL_LIFT));
  assert.ok(SPILL_DECAL_LIFT > 0);
});

test('one pool per usable anchor, in the caller order', () => {
  const pools = spillDecals(ANCHORS);
  assert.equal(pools.length, ANCHORS.length);
  for (let i = 0; i < pools.length; i += 1) {
    const p = pools[i];
    const a = ANCHORS[i];
    assert.ok(Math.abs(p.x - a.x) <= SPILL_JITTER * SPILL_MAX_RADIUS + 1e-9);
    assert.ok(Math.abs(p.z - a.z) <= SPILL_JITTER * SPILL_MAX_RADIUS + 1e-9);
  }
});

test('every output field stays inside its documented range', () => {
  for (const p of spillDecals(ANCHORS)) {
    assert.ok(Number.isFinite(p.x));
    assert.ok(Number.isFinite(p.z));
    assert.ok(p.radius >= SPILL_MIN_RADIUS && p.radius <= SPILL_MAX_RADIUS);
    assert.ok(p.opacity >= 0.25 && p.opacity <= 0.55);
    assert.ok(p.yaw >= 0 && p.yaw < Math.PI * 2);
  }
});

test('a tiny explicit radius is lifted to the minimum', () => {
  const pools = spillDecals([{ x: 1, z: 1, radius: 0.01 }]);
  assert.equal(pools.length, 1);
  assert.ok(pools[0].radius >= SPILL_MIN_RADIUS);
});

test('a huge explicit radius is clamped to the maximum', () => {
  const pools = spillDecals([{ x: 2, z: 2, radius: 400 }]);
  assert.equal(pools.length, 1);
  assert.ok(pools[0].radius <= SPILL_MAX_RADIUS);
});

test('junk anchors are dropped without throwing', () => {
  const pools = spillDecals([
    null, undefined, 'x', 42, [], {},
    { x: 0 }, { x: NaN, z: 0 }, { x: 0, z: Infinity },
    { x: 0, z: 0, radius: NaN }, { x: 0, z: 0, radius: -3 },
    { x: 0, z: 0, warmth: NaN },
    { x: 3, z: 4, radius: 1 }
  ]);
  assert.equal(pools.length, 1);
  assert.ok(Number.isFinite(pools[0].x));
});

test('a non-array argument returns an empty list', () => {
  for (const junk of [undefined, null, 0, 'anchors', {}, { length: 3 }]) {
    assert.deepEqual(spillDecals(junk), []);
  }
});

test('the list is capped at SPILL_MAX_COUNT', () => {
  const many = [];
  for (let i = 0; i < SPILL_MAX_COUNT + 40; i += 1) {
    many.push({ x: i, z: -i, radius: 1 });
  }
  assert.equal(spillDecals(many).length, SPILL_MAX_COUNT);
});

test('identical anchors produce bit-identical pools', () => {
  const a = spillDecals(ANCHORS);
  const b = spillDecals(ANCHORS);
  assert.deepEqual(a, b);
});

test('reordering the anchor list does not change any pool', () => {
  const forward = spillDecals(ANCHORS);
  const reversed = spillDecals([...ANCHORS].reverse());
  for (let i = 0; i < forward.length; i += 1) {
    assert.deepEqual(reversed[reversed.length - 1 - i], forward[i]);
  }
});

test('a junk sweep never yields NaN or Infinity', () => {
  const sweep = [
    { x: Number.MAX_VALUE, z: -Number.MAX_VALUE, radius: 1e300, warmth: 1 },
    { x: -0, z: 0, radius: Number.MIN_VALUE },
    { x: 1e-320, z: 1e-320, radius: 1e-320 },
    { x: 5, z: 5, radius: 5, warmth: 0.9 }
  ];
  for (const p of spillDecals(sweep)) {
    for (const value of [p.x, p.z, p.radius, p.opacity, p.yaw]) {
      assert.ok(Number.isFinite(value));
    }
  }
});

test('spillStrength is zero by day and ramps through dusk and night', () => {
  assert.equal(spillStrength('day', 0.5), 0);
  assert.equal(spillStrength('day', 1), 0);
  assert.ok(spillStrength('dusk', 0.5) > 0);
  assert.ok(spillStrength('night', 1) > spillStrength('dusk', 1));
  assert.ok(spillStrength('night', 1) <= 1);
});

test('spillStrength clamps junk nightFraction and unknown phase', () => {
  for (const junk of [undefined, null, NaN, Infinity, 'x']) {
    assert.equal(spillStrength('day', junk), 0);
    assert.ok(Number.isFinite(spillStrength('night', junk)));
  }
  assert.equal(spillStrength(7, 0.5), 0);
  assert.equal(spillStrength(null, 0.5), 0);
});

test('the field runs on full and is dropped on low', () => {
  assert.equal(spillEnabled('full'), true);
  assert.equal(spillEnabled('low'), false);
  for (const junk of [undefined, null, 'medium', 0, {}]) {
    assert.equal(spillEnabled(junk), true);
  }
});

test('ground overlays stack from shadow to spill without z-fighting', () => {
  // Spill pools sit above contact shadows but below puddles, as a film.
  assert.ok(SPILL_DECAL_LIFT > 0);
  assert.ok(SPILL_DECAL_LIFT < 0.05);
});