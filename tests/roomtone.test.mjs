import test from 'node:test';
import assert from 'node:assert/strict';
import * as rt from '../src/roomtone.js';

const A = [
  { x: 10, y: 2.2, z: 0 },
  { x: -5, y: 1.8, z: 6 },
  { x: 0, y: 2.0, z: -9 },
  { x: 3.5, y: 1.7, z: 2.25 }
];

const JUNK = [null, undefined, 42, 'x', [], {}, { x: 1 }, { x: NaN, y: 1, z: 1 }, { x: 1, y: 1, z: Infinity }];

function channelsOf(hex) {
  return {
    r: ((hex >> 16) & 0xff) / 255,
    g: ((hex >> 8) & 0xff) / 255,
    b: (hex & 0xff) / 255
  };
}

test('ROOMTONE_SEED is a fixed integer', () => {
  assert.equal(typeof rt.ROOMTONE_SEED, 'number');
  assert.ok(Number.isInteger(rt.ROOMTONE_SEED));
});

test('palette: 5..8 entries, integer hexes, array-shaped', () => {
  assert.ok(Array.isArray(rt.ROOMTONE_PALETTE));
  assert.ok(rt.ROOMTONE_PALETTE.length >= 5 && rt.ROOMTONE_PALETTE.length <= 8);
  for (const hex of rt.ROOMTONE_PALETTE) {
    assert.equal(typeof hex, 'number');
    assert.ok(Number.isInteger(hex));
    assert.ok(hex >= 0 && hex <= 0xffffff);
  }
});

test('palette: every entry is warm (red channel leads, blue trails)', () => {
  for (const hex of rt.ROOMTONE_PALETTE) {
    const c = channelsOf(hex);
    assert.ok(c.r >= c.g, `red should lead green in ${hex.toString(16)}`);
    assert.ok(c.g >= c.b, `green should lead blue in ${hex.toString(16)}`);
    assert.ok(c.r > 0.8, `too dim to read as lamplight: ${hex.toString(16)}`);
  }
});

test('palette: entries are distinguishable from each other', () => {
  const seen = new Set(rt.ROOMTONE_PALETTE);
  assert.equal(seen.size, rt.ROOMTONE_PALETTE.length);
});

test('roomToneFor: same anchor twice gives identical hex', () => {
  const a = rt.roomToneFor({ x: 10, y: 2.2, z: 0 });
  const b = rt.roomToneFor({ x: 10, y: 2.2, z: 0 });
  assert.equal(a.hex, b.hex);
  assert.deepEqual(a, b);
});

test('roomToneFor: reordering does not reshuffle tones', () => {
  const forward = A.map(a => rt.roomToneFor(a).hex);
  const reverse = [...A].reverse().map(a => rt.roomToneFor(a).hex);
  assert.deepEqual(
    [...forward].sort((u, v) => u - v),
    [...reverse].sort((u, v) => u - v)
  );
  // stronger: each anchor keeps its own tone by position
  for (const a of A) {
    assert.equal(rt.roomToneFor(a).hex, rt.roomToneFor({ x: a.x, y: a.y, z: a.z }).hex);
  }
});

test('junk inputs return palette[0] with finite channels', () => {
  const fallback = rt.roomToneFor(rt.ROOMTONE_PALETTE[0]);
  for (const junk of JUNK) {
    const tone = rt.roomToneFor(junk);
    assert.equal(tone.hex, rt.ROOMTONE_PALETTE[0], `hex for ${String(junk)}`);
    assert.ok(Number.isFinite(tone.r));
    assert.ok(Number.isFinite(tone.g));
    assert.ok(Number.isFinite(tone.b));
    assert.deepEqual(tone, fallback);
    assert.equal(rt.roomToneIndex(junk), 0);
  }
});

test('r/g/b match the hex exactly', () => {
  for (const a of A) {
    const tone = rt.roomToneFor(a);
    const c = channelsOf(tone.hex);
    assert.ok(Math.abs(tone.r - c.r) < 1e-9, 'r');
    assert.ok(Math.abs(tone.g - c.g) < 1e-9, 'g');
    assert.ok(Math.abs(tone.b - c.b) < 1e-9, 'b');
  }
});

test('every returned hex is a palette member', () => {
  const anchors = [
    ...A,
    { x: 100, y: 3, z: -100 },
    { x: 0.001, y: 0.002, z: 0.003 },
    { x: -12.5, y: 1.1, z: 7.75 }
  ];
  for (const a of anchors) {
    assert.ok(rt.ROOMTONE_PALETTE.includes(rt.roomToneFor(a).hex));
  }
});

test('a spread of well-separated anchors uses at least 2 indices', () => {
  const spread = Array.from({ length: 12 }, (_, i) => ({ x: i * 7 - 30, y: 2, z: i * 5 - 20 }));
  const spreadResult = rt.roomToneSpread(spread);
  assert.equal(spreadResult.count, spread.length);
  assert.ok(spreadResult.distinct >= 2, `distinct was ${spreadResult.distinct}`);
});

test('roomToneIndex agrees with roomToneFor hex', () => {
  for (const a of A) {
    const index = rt.roomToneIndex(a);
    assert.ok(Number.isInteger(index));
    assert.ok(index >= 0 && index < rt.ROOMTONE_PALETTE.length);
    assert.equal(rt.ROOMTONE_PALETTE[index], rt.roomToneFor(a).hex);
  }
});

test('roomToneSpread: junk gives zeros', () => {
  assert.deepEqual(rt.roomToneSpread(null), { count: 0, distinct: 0 });
  assert.deepEqual(rt.roomToneSpread('x'), { count: 0, distinct: 0 });
  assert.deepEqual(rt.roomToneSpread(JUNK), { count: 0, distinct: 0 });
});

test('roomToneSpread: mixed list counts only usable anchors', () => {
  const mixed = [null, { x: 10, y: 2.2, z: 0 }, 42, { x: -5, y: 1.8, z: 6 }, {}, { x: NaN, y: 0, z: 0 }];
  const result = rt.roomToneSpread(mixed);
  assert.equal(result.count, 2);
  assert.ok(result.distinct >= 1 && result.distinct <= 2);
});

test('roomToneSpread: caps at 4096 anchors', () => {
  const many = Array.from({ length: 5000 }, (_, i) => ({ x: i, y: 1, z: 0 }));
  const result = rt.roomToneSpread(many);
  assert.equal(result.count, 4096);
});

test('no NaN or Infinity in any returned object', () => {
  const samples = [...A, ...JUNK];
  for (const a of samples) {
    const tone = rt.roomToneFor(a);
    for (const k of ['hex', 'r', 'g', 'b']) {
      assert.ok(Number.isFinite(tone[k]), `${k} not finite for ${String(a)}`);
    }
    assert.ok(Number.isFinite(rt.roomToneIndex(a)));
  }
  const spread = rt.roomToneSpread(samples);
  assert.ok(Number.isFinite(spread.count));
  assert.ok(Number.isFinite(spread.distinct));
});
