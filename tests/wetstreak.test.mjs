import test from 'node:test';
import assert from 'node:assert/strict';
import * as ws from '../src/wetstreak.js';

const A = [
  { x: 7, z: 7, warmth: 0.9, length: 2.0 },
  { x: -7, z: 7, warmth: 0.8 },
  { x: 7, z: -7 }
];

test('wetStreakStrength: day is zero', () => {
  assert.equal(ws.wetStreakStrength('day', 1), 0);
});

test('wetStreakStrength: dusk scales by night fraction', () => {
  assert.equal(ws.wetStreakStrength('dusk', 0.5), 0.175);
});

test('wetStreakStrength: night is full at night=1', () => {
  assert.equal(ws.wetStreakStrength('night', 1), 1);
});

test('wetStreakStrength: junk inputs yield 0', () => {
  assert.equal(ws.wetStreakStrength(42, 1), 0);
  assert.equal(ws.wetStreakStrength('night', NaN), 0);
  assert.equal(ws.wetStreakStrength('night', Infinity), 0);
});

test('wetStreakEnabled: full on, low off', () => {
  assert.equal(ws.wetStreakEnabled('full'), true);
  assert.equal(ws.wetStreakEnabled('low'), false);
});

test('wetStreakDecals: one streak per usable anchor', () => {
  const out = ws.wetStreakDecals(A);
  assert.equal(out.length, 3);
  for (const d of out) {
    assert.ok(Number.isFinite(d.x));
    assert.ok(Number.isFinite(d.z));
    assert.ok(Number.isFinite(d.length));
    assert.ok(Number.isFinite(d.width));
    assert.ok(Number.isFinite(d.angle));
    assert.ok(Number.isFinite(d.opacity));
    assert.ok(d.length >= ws.WETSTREAK_MIN_LENGTH && d.length <= ws.WETSTREAK_MAX_LENGTH);
  }
});

test('wetStreakDecals: junk anchors dropped', () => {
  const out = ws.wetStreakDecals([null, 42, { x: 1 }, { x: 1, z: 2, length: -1 }, { x: 1, z: 2, warmth: NaN }]);
  assert.equal(out.length, 0);
});

test('wetStreakDecals: non-array returns []', () => {
  assert.deepEqual(ws.wetStreakDecals(null), []);
  assert.deepEqual(ws.wetStreakDecals('x'), []);
});

test('wetStreakDecals: max count cap', () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ x: i, z: 0 }));
  const out = ws.wetStreakDecals(many);
  assert.equal(out.length, ws.WETSTREAK_MAX_COUNT);
});

test('wetStreakDecals: warmth drives length', () => {
  const warm = ws.wetStreakDecals([{ x: 0, z: 0, warmth: 1.0 }]);
  const cool = ws.wetStreakDecals([{ x: 0, z: 0, warmth: 0.7 }]);
  assert.ok(warm[0].length >= cool[0].length);
});

test('wetStreakDecals: deterministic', () => {
  const a = JSON.stringify(ws.wetStreakDecals(A));
  const b = JSON.stringify(ws.wetStreakDecals(A));
  assert.equal(a, b);
});

test('wetStreakDecals: no NaN/Infinity', () => {
  const out = ws.wetStreakDecals([{ x: NaN, z: 0 }]);
  assert.equal(out.length, 0);
  const out2 = ws.wetStreakDecals([{ x: 0, z: 0, length: 0 }]);
  assert.equal(out2.length, 1);
  for (const d of out2) {
    for (const k of ['x','z','length','width','angle','opacity']) {
      assert.ok(Number.isFinite(d[k]), `${k} not finite`);
    }
  }
});
