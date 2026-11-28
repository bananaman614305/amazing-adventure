import test from 'node:test';
import assert from 'node:assert/strict';
import * as mh from '../src/moonhalo.js';

const A = { x: -18, y: 22, z: 6 };
const JUNK = [
  null, 42, 'x', [], {},
  { x: 1, y: 2 },
  { x: NaN, y: 0, z: 0 }
];

test('moonhalo constants keep their documented values', () => {
  assert.equal(typeof mh.MOONHALO_SEED, 'number');
  assert.ok(Number.isInteger(mh.MOONHALO_SEED));
  assert.equal(mh.MOONHALO_MIN_RADIUS, 24);
  assert.equal(mh.MOONHALO_MAX_RADIUS, 48);
  assert.ok(mh.MOONHALO_MIN_OPACITY >= 0.08 && mh.MOONHALO_MIN_OPACITY <= 0.22);
  assert.ok(mh.MOONHALO_MAX_OPACITY >= 0.08 && mh.MOONHALO_MAX_OPACITY <= 0.22);
  assert.ok(mh.MOONHALO_MIN_OPACITY < mh.MOONHALO_MAX_OPACITY);
});

test('moonHaloStrength: day is zero', () => {
  assert.equal(mh.moonHaloStrength('day', 1), 0);
  assert.equal(mh.moonHaloStrength('day', 0.5), 0);
});

test('moonHaloStrength: dusk at 0.5 is the dusk base scaled', () => {
  assert.equal(mh.moonHaloStrength('dusk', 0.5), 0.15);
  assert.equal(mh.moonHaloStrength('dusk', 0), 0);
});

test('moonHaloStrength: night is the night fraction', () => {
  assert.equal(mh.moonHaloStrength('night', 1), 1);
  assert.equal(mh.moonHaloStrength('night', 0), 0);
  assert.equal(mh.moonHaloStrength('night', 0.5), 0.5);
});

test('moonHaloStrength: junk inputs yield 0', () => {
  for (const phase of [undefined, null, 42, {}, 'evening', 'DUSK', '']) {
    assert.equal(mh.moonHaloStrength(phase, 1), 0, `phase ${String(phase)}`);
  }
  assert.equal(mh.moonHaloStrength('night', NaN), 0);
  assert.equal(mh.moonHaloStrength('night', Infinity), 0);
  assert.equal(mh.moonHaloStrength('night', -Infinity), 0);
  assert.equal(mh.moonHaloStrength('dusk', NaN), 0);
});

test('moonHaloEnabled: full on, low off', () => {
  assert.equal(mh.moonHaloEnabled('full'), true);
  assert.equal(mh.moonHaloEnabled('low'), false);
});

test('moonHaloDescriptor: valid anchor returns finite in-range fields', () => {
  const d = mh.moonHaloDescriptor(A);
  assert.ok(d);
  for (const k of ['x', 'y', 'z', 'radius', 'opacity', 'tint']) {
    assert.ok(Number.isFinite(d[k]), `${k} not finite`);
  }
  assert.equal(d.x, A.x);
  assert.equal(d.y, A.y);
  assert.equal(d.z, A.z);
  assert.ok(d.radius >= mh.MOONHALO_MIN_RADIUS && d.radius <= mh.MOONHALO_MAX_RADIUS);
  assert.ok(d.opacity >= mh.MOONHALO_MIN_OPACITY && d.opacity <= mh.MOONHALO_MAX_OPACITY);
  assert.ok(Number.isInteger(d.tint));
  assert.ok(d.tint >= 0 && d.tint <= 0xffffff);
});

test('moonHaloDescriptor: junk anchors return null', () => {
  for (const j of JUNK) {
    assert.equal(mh.moonHaloDescriptor(j), null, `expected null for ${JSON.stringify(j)}`);
  }
  assert.equal(mh.moonHaloDescriptor(null), null);
  assert.equal(mh.moonHaloDescriptor(undefined), null);
});

test('moonHaloDescriptor: deterministic across calls', () => {
  assert.equal(JSON.stringify(mh.moonHaloDescriptor(A)), JSON.stringify(mh.moonHaloDescriptor(A)));
});

test('moonHaloDescriptor: position does not affect radius determinism by anchor', () => {
  const d1 = mh.moonHaloDescriptor({ x: 1, y: 2, z: 3 });
  const d2 = mh.moonHaloDescriptor({ x: 1, y: 2, z: 3 });
  assert.deepEqual(d1, d2);
});

test('moonHaloDescriptors: one per usable anchor, junk dropped', () => {
  const mixed = [A, null, { x: 1, y: 2, z: 3 }, 42];
  const out = mh.moonHaloDescriptors(mixed);
  assert.equal(out.length, 2);
  assert.equal(out[0].x, A.x);
});

test('moonHaloDescriptors: non-array returns []', () => {
  assert.deepEqual(mh.moonHaloDescriptors(null), []);
  assert.deepEqual(mh.moonHaloDescriptors('x'), []);
  assert.deepEqual(mh.moonHaloDescriptors(42), []);
});

test('moonHaloDescriptor: no NaN or Infinity with pathological input', () => {
  const d = mh.moonHaloDescriptor({ x: Number.MAX_VALUE, y: 3, z: -Number.MAX_VALUE });
  assert.ok(d);
  for (const k of ['x', 'y', 'z', 'radius', 'opacity', 'tint']) {
    assert.ok(Number.isFinite(d[k]), `${k} not finite`);
  }
});

test('moonHaloDescriptor: cool blue-white tint', () => {
  const d = mh.moonHaloDescriptor(A);
  // tint must be one of the cool palette entries
  assert.ok([0xd8e4ff, 0xe8f0ff, 0xc8d8ff].includes(d.tint));
});