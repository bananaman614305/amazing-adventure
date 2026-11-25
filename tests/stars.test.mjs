// Round 85: the night sky's star field. The pure numbers live in src/stars.js;
// this file holds them to their contract so the exact field the GPU gets is
// pinned: where the stars sit, how bright the field is per phase, and that the
// whole thing is deterministic -- a screenshot taken twice looks the same.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STAR_COUNT, STAR_FIELD_RADIUS, STAR_MIN_ELEVATION, STAR_SEED,
  STAR_PHASE_VISIBILITY, mulberry32, starPositions, starVisibility,
  starTwinkle, starColor, starSize, buildStarField, starFieldOpacity
} from '../src/stars.js';

test('mulberry32 is deterministic and lands in 0..1', () => {
  const a = mulberry32(STAR_SEED);
  const b = mulberry32(STAR_SEED);
  for (let i = 0; i < 100; i += 1) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
});

test('starPositions returns STAR_COUNT unique points at the field radius, above the horizon', () => {
  const pts = starPositions();
  assert.equal(pts.length, STAR_COUNT);
  const seen = new Set();
  for (const p of pts) {
    const r = Math.hypot(p.x, p.y, p.z);
    assert.ok(Math.abs(r - STAR_FIELD_RADIUS) < 1e-6, 'every star sits at the field radius');
    assert.ok(p.y / r >= STAR_MIN_ELEVATION, 'every star is above the horizon haze band');
    seen.add(`${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`);
  }
  assert.equal(seen.size, STAR_COUNT, 'no two stars coincide');
});

test('starPositions is deterministic for a seed and differs across seeds', () => {
  assert.deepEqual(starPositions(50, 7), starPositions(50, 7));
  assert.notDeepEqual(starPositions(50, 7), starPositions(50, 8));
});

test('the phase table hides the field at day, hints at dusk, shows it at night', () => {
  assert.equal(starVisibility('day'), 0);
  assert.equal(starVisibility('dusk'), 0.22);
  assert.equal(starVisibility('night'), 1);
  assert.equal(starVisibility('midnight'), 0, 'an unknown phase falls back to day');
  assert.equal(starVisibility(undefined), 0);
  for (const v of Object.values(STAR_PHASE_VISIBILITY)) assert.ok(v >= 0 && v <= 1);
});

test('starTwinkle never lets a star vanish and is deterministic', () => {
  for (let i = 0; i < 40; i += 1) {
    for (let t = 0; t < 60; t += 0.37) {
      const v = starTwinkle(i, t);
      assert.ok(v >= 0.8 && v <= 1.2, `twinkle out of range for star ${i} at t=${t}`);
    }
    assert.equal(starTwinkle(i, 12), starTwinkle(i, 12));
  }
});

test('star colours and sizes stay in range per index', () => {
  for (let i = 0; i < 60; i += 1) {
    const c = starColor(i);
    for (const v of [c.r, c.g, c.b]) assert.ok(v >= 0 && v <= 1);
    assert.ok(starSize(i) >= 0.5 && starSize(i) <= 1.2);
  }
});

test('buildStarField returns flat GPU arrays shaped count-first', () => {
  const field = buildStarField();
  assert.equal(field.count, STAR_COUNT);
  assert.equal(field.position.length, field.count * 3);
  assert.equal(field.color.length, field.count * 3);
  assert.equal(field.size.length, field.count);
  for (let i = 0; i < field.count; i += 1) {
    assert.ok(field.position[i * 3 + 1] > 0, 'every star is above the horizon in dome space');
  }
  assert.equal(field.size.every((v) => v >= 0.5 && v <= 1.2), true);
});

test('buildStarField is byte-for-byte deterministic', () => {
  const a = buildStarField();
  const b = buildStarField();
  assert.deepEqual([...a.position], [...b.position]);
  assert.deepEqual([...a.color], [...b.color]);
  assert.deepEqual([...a.size], [...b.size]);
});

test('a small custom field honours the same contract', () => {
  const field = buildStarField(40, 0x1234);
  assert.equal(field.count, 40);
  assert.equal(field.position.length, 120);
  assert.equal(field.size.length, 40);
});

test('starFieldOpacity clamps and falls back to dark', () => {
  assert.equal(starFieldOpacity('day'), 0);
  assert.equal(starFieldOpacity('dusk'), 0.22);
  assert.equal(starFieldOpacity('night'), 1);
  assert.equal(starFieldOpacity('nonsense'), 0);
});
