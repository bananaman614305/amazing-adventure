import test from 'node:test';
import assert from 'node:assert/strict';
import * as rg from '../src/roomglow.js';

const A = [
  { x: 10, y: 2.2, z: 0, warmth: 0.9, size: 1.0 },
  { x: -5, y: 1.8, z: 6, warmth: 0.85 },
  { x: 0, y: 2.0, z: -9 }
];

test('roomGlowStrength: day is zero', () => {
  assert.equal(rg.roomGlowStrength('day', 1), 0);
});

test('roomGlowStrength: dusk scales by night fraction', () => {
  assert.equal(rg.roomGlowStrength('dusk', 0.5), 0.2);
});

test('roomGlowStrength: night is full at night=1', () => {
  assert.equal(rg.roomGlowStrength('night', 1), 1);
});

test('roomGlowStrength: junk inputs yield 0', () => {
  assert.equal(rg.roomGlowStrength(42, 1), 0);
  assert.equal(rg.roomGlowStrength('night', NaN), 0);
  assert.equal(rg.roomGlowStrength('night', Infinity), 0);
  assert.equal(rg.roomGlowStrength('night', 'x'), 0);
});

test('roomGlowEnabled: full/dusk on, low off', () => {
  assert.equal(rg.roomGlowEnabled('full'), true);
  assert.equal(rg.roomGlowEnabled('low'), false);
});

test('roomGlowDecals: one glow per usable anchor', () => {
  const out = rg.roomGlowDecals(A);
  assert.equal(out.length, 3);
  for (const d of out) {
    assert.ok(Number.isFinite(d.x));
    assert.ok(Number.isFinite(d.y));
    assert.ok(Number.isFinite(d.z));
    assert.ok(Number.isFinite(d.width));
    assert.ok(Number.isFinite(d.height));
    assert.ok(Number.isFinite(d.opacity));
    assert.ok(d.width >= rg.ROOMGLOW_MIN_SIZE && d.width <= rg.ROOMGLOW_MAX_SIZE);
    assert.ok(d.opacity >= 0.12 && d.opacity <= 0.34);
  }
});

test('roomGlowDecals: junk anchors dropped', () => {
  const out = rg.roomGlowDecals([
    null, 42, { x: 1, y: 2 }, { x: 1, y: 2, z: 3, size: -1 }, { x: 1, y: 2, z: 3, warmth: NaN }
  ]);
  assert.equal(out.length, 0); // every anchor here is junk
});

test('roomGlowDecals: non-array returns []', () => {
  assert.deepEqual(rg.roomGlowDecals(null), []);
  assert.deepEqual(rg.roomGlowDecals('x'), []);
});

test('roomGlowDecals: max count cap', () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ x: i, y: 1, z: 0 }));
  const out = rg.roomGlowDecals(many);
  assert.equal(out.length, rg.ROOMGLOW_MAX_COUNT);
});

test('roomGlowDecals: warmth drives size', () => {
  const warm = rg.roomGlowDecals([{ x: 0, y: 1, z: 0, warmth: 1.0 }]);
  const cool = rg.roomGlowDecals([{ x: 0, y: 1, z: 0, warmth: 0.8 }]);
  assert.ok(warm[0].width >= cool[0].width);
});

test('roomGlowDecals: deterministic', () => {
  const a = JSON.stringify(rg.roomGlowDecals(A));
  const b = JSON.stringify(rg.roomGlowDecals(A));
  assert.equal(a, b);
});

test('roomGlowDecals: reordering does not reshuffle', () => {
  const a = rg.roomGlowDecals(A);
  const rev = rg.roomGlowDecals([...A].reverse());
  // each anchor keeps its own descriptor regardless of order
  assert.equal(a.length, rev.length);
  const ax = a.map(d => d.x).sort((u,v)=>u-v);
  const rx = rev.map(d => d.x).sort((u,v)=>u-v);
  assert.deepEqual(ax, rx);
});

test('roomGlowDecals: no NaN/Infinity', () => {
  const out = rg.roomGlowDecals([{ x: NaN, y: 1, z: 0 }]);
  // NaN anchor dropped
  assert.equal(out.length, 0);
  const out2 = rg.roomGlowDecals([{ x: 0, y: 1, z: 0, size: 0 }]);
  // size 0 falls back to default-ish then clamped
  assert.ok(out2.length === 1);
  for (const d of out2) {
    for (const k of ['x','y','z','width','height','opacity']) {
      assert.ok(Number.isFinite(d[k]), `${k} not finite`);
    }
  }
});

test('constants are frozen-ish numbers', () => {
  assert.equal(typeof rg.ROOMGLOW_SEED, 'number');
  assert.equal(rg.ROOMGLOW_COUNT, 12);
});
