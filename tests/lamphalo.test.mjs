import test from 'node:test';
import assert from 'node:assert/strict';
import * as lh from '../src/lamphalo.js';

const A = [
  { x: 7, y: 3.2, z: 7, warmth: 0.9 },
  { x: -7, y: 3.4, z: 7, warmth: 0.8 },
  { x: 7, y: 3.0, z: -7 },
  { x: 0, y: 2.8, z: 0, radius: 1.0 }
];

const JUNK = [
  null, 42, 'x', [], {},
  { x: 1, y: 2 },
  { x: NaN, y: 0, z: 0 },
  { x: 0, y: 0, z: 0, warmth: NaN },
  { x: 0, y: 0, z: 0, radius: -1 },
  { x: 0, y: 0, z: 0, radius: NaN }
];

test('lamphalo constants keep their documented values', () => {
  assert.equal(typeof lh.LAMPHALO_SEED, 'number');
  assert.ok(Number.isInteger(lh.LAMPHALO_SEED));
  assert.equal(lh.LAMPHALO_COUNT, 4);
  assert.equal(lh.LAMPHALO_MAX_COUNT, 32);
  assert.equal(lh.LAMPHALO_MIN_RADIUS, 0.6);
  assert.equal(lh.LAMPHALO_MAX_RADIUS, 1.3);
  assert.ok(lh.LAMPHALO_MIN_OPACITY >= 0.12 && lh.LAMPHALO_MIN_OPACITY <= 0.3);
  assert.ok(lh.LAMPHALO_MAX_OPACITY >= 0.12 && lh.LAMPHALO_MAX_OPACITY <= 0.3);
  assert.ok(lh.LAMPHALO_MIN_OPACITY < lh.LAMPHALO_MAX_OPACITY);
});

test('lampHaloStrength: day is zero', () => {
  assert.equal(lh.lampHaloStrength('day', 1), 0);
  assert.equal(lh.lampHaloStrength('day', 0.5), 0);
});

test('lampHaloStrength: dusk at 0.5 is the dusk base scaled', () => {
  assert.equal(lh.lampHaloStrength('dusk', 0.5), 0.225);
  assert.equal(lh.lampHaloStrength('dusk', 0), 0);
});

test('lampHaloStrength: night is the night fraction', () => {
  assert.equal(lh.lampHaloStrength('night', 1), 1);
  assert.equal(lh.lampHaloStrength('night', 0), 0);
  assert.equal(lh.lampHaloStrength('night', 0.5), 0.5);
});

test('lampHaloStrength: junk inputs yield 0', () => {
  for (const phase of [undefined, null, 42, {}, 'evening', 'DUSK', '']) {
    assert.equal(lh.lampHaloStrength(phase, 1), 0, `phase ${String(phase)}`);
  }
  assert.equal(lh.lampHaloStrength('night', NaN), 0);
  assert.equal(lh.lampHaloStrength('night', Infinity), 0);
  assert.equal(lh.lampHaloStrength('night', -Infinity), 0);
  assert.equal(lh.lampHaloStrength('dusk', NaN), 0);
});

test('lampHaloEnabled: full on, low off', () => {
  assert.equal(lh.lampHaloEnabled('full'), true);
  assert.equal(lh.lampHaloEnabled('low'), false);
});

test('lampHalos: one halo per usable anchor, caller order', () => {
  const out = lh.lampHalos(A);
  assert.equal(out.length, 4);
  for (let i = 0; i < out.length; i += 1) {
    assert.equal(out[i].x, A[i].x);
    assert.equal(out[i].y, A[i].y);
    assert.equal(out[i].z, A[i].z);
  }
});

test('lampHalos: every field is finite and in range', () => {
  const out = lh.lampHalos(A);
  for (const h of out) {
    for (const k of ['x', 'y', 'z', 'radius', 'opacity', 'stretch', 'tint']) {
      assert.ok(Number.isFinite(h[k]), `${k} not finite`);
    }
    assert.ok(h.radius >= lh.LAMPHALO_MIN_RADIUS && h.radius <= lh.LAMPHALO_MAX_RADIUS);
    assert.ok(h.opacity >= lh.LAMPHALO_MIN_OPACITY && h.opacity <= lh.LAMPHALO_MAX_OPACITY);
    assert.ok(h.stretch >= 0.82 && h.stretch <= 1.0);
    assert.ok(Number.isInteger(h.tint));
    assert.ok(h.tint >= 0 && h.tint <= 0xffffff);
  }
});

test('lampHalos: explicit radius is clamped into range', () => {
  const small = lh.lampHalos([{ x: 0, y: 2, z: 0, radius: 0.01 }])[0];
  assert.ok(small.radius >= lh.LAMPHALO_MIN_RADIUS);
  const big = lh.lampHalos([{ x: 1, y: 2, z: 1, radius: 400 }])[0];
  assert.ok(big.radius <= lh.LAMPHALO_MAX_RADIUS);
});

test('lampHalos: junk anchors are dropped', () => {
  const out = lh.lampHalos(JUNK);
  assert.equal(out.length, 0);
  const mixed = [...JUNK, { x: 3, y: 3, z: 3 }];
  assert.equal(lh.lampHalos(mixed).length, 1);
});

test('lampHalos: non-array returns []', () => {
  assert.deepEqual(lh.lampHalos(null), []);
  assert.deepEqual(lh.lampHalos('x'), []);
  assert.deepEqual(lh.lampHalos(42), []);
});

test('lampHalos: capped at LAMPHALO_MAX_COUNT from 100 anchors', () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ x: i, y: 3, z: -i }));
  assert.equal(lh.lampHalos(many).length, lh.LAMPHALO_MAX_COUNT);
});

test('lampHalos: warmth drives radius and opacity', () => {
  const warm = lh.lampHalos([{ x: 0, y: 3, z: 0, warmth: 1.0 }])[0];
  const cool = lh.lampHalos([{ x: 0, y: 3, z: 0, warmth: 0.8 }])[0];
  assert.ok(warm.radius >= cool.radius);
  assert.ok(warm.opacity >= cool.opacity);
});

test('lampHalos: deterministic across calls', () => {
  assert.equal(JSON.stringify(lh.lampHalos(A)), JSON.stringify(lh.lampHalos(A)));
});

test('lampHalos: reordering does not change the multiset of radii and tints', () => {
  const forward = lh.lampHalos(A);
  const reversed = lh.lampHalos([...A].reverse());
  assert.deepEqual(
    [...forward].map((h) => [h.radius, h.tint]).sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    [...reversed].map((h) => [h.radius, h.tint]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  );
  // stronger: each anchor keeps its own radius and tint by position
  for (const a of A) {
    const again = lh.lampHalos([a])[0];
    const solo = lh.lampHalos(A).find((h) => h.x === a.x && h.y === a.y && h.z === a.z);
    assert.deepEqual({ radius: again.radius, tint: again.tint },
      { radius: solo.radius, tint: solo.tint });
  }
});

test('lampHalos: no NaN or Infinity with pathological input', () => {
  const sweep = [
    { x: Number.MAX_VALUE, y: 3, z: -Number.MAX_VALUE, radius: 1e300, warmth: 1 },
    { x: -0, y: -0, z: -0, radius: Number.MIN_VALUE },
    { x: 1e-320, y: 1e-320, z: 1e-320, warmth: 1e-320 },
    { x: 5, y: 5, z: 5, radius: 5, warmth: 0.9 }
  ];
  const out = lh.lampHalos(sweep);
  assert.equal(out.length, 4);
  for (const h of out) {
    for (const k of ['x', 'y', 'z', 'radius', 'opacity', 'stretch', 'tint']) {
      assert.ok(Number.isFinite(h[k]), `${k} not finite`);
    }
  }
});

test('lampHaloSpread: junk gives zeros', () => {
  assert.deepEqual(lh.lampHaloSpread(null), { count: 0, distinct: 0 });
  assert.deepEqual(lh.lampHaloSpread('x'), { count: 0, distinct: 0 });
  assert.deepEqual(lh.lampHaloSpread(JUNK), { count: 0, distinct: 0 });
});

test('lampHaloSpread: mixed list counts only usable anchors', () => {
  const mixed = [null, { x: 1, y: 3, z: 1 }, 42, { x: 2, y: 3, z: 2 }, {}, { x: NaN, y: 0, z: 0 }];
  const result = lh.lampHaloSpread(mixed);
  assert.equal(result.count, 2);
  assert.ok(result.distinct >= 1 && result.distinct <= 2);
});

test('lampHaloSpread: caps at 4096 anchors', () => {
  const many = Array.from({ length: 5000 }, (_, i) => ({ x: i, y: 3, z: -i }));
  const result = lh.lampHaloSpread(many);
  assert.equal(result.count, 4096);
});

test('lampHaloSpread: a spread of anchors uses at least 2 distinct tints', () => {
  const spread = Array.from({ length: 12 }, (_, i) => ({ x: i * 7 - 30, y: 3, z: i * 5 - 20 }));
  const result = lh.lampHaloSpread(spread);
  assert.equal(result.count, spread.length);
  assert.ok(result.distinct >= 2, `distinct was ${result.distinct}`);
});
