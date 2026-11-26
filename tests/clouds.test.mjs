// The sky's cloud layer. The pure numbers live in src/clouds.js; this file
// holds them to their contract so the exact layer the GPU gets is pinned: how
// many clouds, where they sit, how opaque and what colour they are per phase,
// how big each one is, how it drifts, and that the whole thing is deterministic
// -- a screenshot taken twice looks the same.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLOUD_COUNT, CLOUD_FIELD_RADIUS, CLOUD_SEED, CLOUD_MIN_ELEVATION,
  CLOUD_MAX_ELEVATION, CLOUD_PHASE_OPACITY, CLOUD_BASE_COLOR,
  mulberry32, cloudPositions, cloudOpacity, cloudColor, cloudSize, cloudDrift
} from '../src/clouds.js';

test('constants are numbers and sensible', () => {
  assert.equal(CLOUD_COUNT, 14);
  assert.equal(CLOUD_FIELD_RADIUS, 118);
  assert.equal(CLOUD_SEED, 0x7c3aed);
  assert.ok(CLOUD_COUNT > 0);
  assert.ok(CLOUD_FIELD_RADIUS > 0);
  assert.ok(CLOUD_FIELD_RADIUS < 120, 'clouds sit inside the 120 m dome');
  assert.ok(CLOUD_MIN_ELEVATION >= 0 && CLOUD_MIN_ELEVATION <= 1);
  assert.ok(CLOUD_MAX_ELEVATION > CLOUD_MIN_ELEVATION && CLOUD_MAX_ELEVATION <= 1);
});

test('mulberry32 is deterministic and lands in 0..1', () => {
  const a = mulberry32(CLOUD_SEED);
  const b = mulberry32(CLOUD_SEED);
  for (let i = 0; i < 100; i += 1) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
});

test('cloudPositions returns CLOUD_COUNT points at the field radius, above the horizon', () => {
  const pts = cloudPositions();
  assert.equal(pts.length, CLOUD_COUNT);
  for (const p of pts) {
    const r = Math.hypot(p.x, p.y, p.z);
    assert.ok(Math.abs(r - CLOUD_FIELD_RADIUS) < 1e-6, `every cloud sits at the field radius (${r})`);
    assert.ok(p.y >= 0, 'every cloud is above the horizon');
    const elev = p.y / CLOUD_FIELD_RADIUS;
    assert.ok(elev >= 0.05 && elev <= 0.6, `elevation ${elev} is inside [0.05, 0.6]`);
  }
});

test('cloudPositions honours a custom count', () => {
  const pts = cloudPositions(5);
  assert.equal(pts.length, 5);
  assert.equal(cloudPositions(0).length, 0);
});

test('cloudPositions is deterministic for a seed and differs across seeds', () => {
  assert.deepEqual(cloudPositions(8, 7), cloudPositions(8, 7));
  assert.notDeepEqual(cloudPositions(8, 7), cloudPositions(8, 8));
});

test('the phase table fades the layer from day through dusk to night', () => {
  assert.equal(CLOUD_PHASE_OPACITY.day, 0.55);
  assert.equal(CLOUD_PHASE_OPACITY.dusk, 0.4);
  assert.equal(CLOUD_PHASE_OPACITY.night, 0.12);
  for (const v of Object.values(CLOUD_PHASE_OPACITY)) assert.ok(v >= 0 && v <= 1);
});

test('cloudOpacity returns the right value per phase and falls back to zero', () => {
  assert.equal(cloudOpacity('day'), 0.55);
  assert.equal(cloudOpacity('dusk'), 0.4);
  assert.equal(cloudOpacity('night'), 0.12);
  assert.equal(cloudOpacity('midnight'), 0);
  assert.equal(cloudOpacity(undefined), 0);
});

test('cloudColor tints per phase and falls back to day white', () => {
  assert.equal(cloudColor('day'), 0xffffff);
  assert.equal(cloudColor('dusk'), 0xffd9b0);
  assert.equal(cloudColor('night'), 0x6b7a9a);
  assert.equal(cloudColor('nope'), 0xffffff);
  assert.equal(cloudColor(undefined), 0xffffff);
});

test('CLOUD_BASE_COLOR is the day white', () => {
  assert.equal(CLOUD_BASE_COLOR, 0xffffff);
  assert.equal(CLOUD_BASE_COLOR, cloudColor('day'));
});

test('cloudSize stays in [6, 14] and is deterministic per index', () => {
  for (let i = 0; i < 80; i += 1) {
    const s = cloudSize(i);
    assert.ok(s >= 6 && s <= 14, `size ${s} out of range for cloud ${i}`);
    assert.equal(cloudSize(i), s, 'size is deterministic from the index');
  }
  // The range is actually exercised, not just clamped to one value.
  const sizes = new Set();
  for (let i = 0; i < 40; i += 1) sizes.add(cloudSize(i).toFixed(4));
  assert.ok(sizes.size > 1, 'sizes vary across indices');
});

test('cloudDrift stays in [-0.1, 0.1] and is deterministic', () => {
  for (let i = 0; i < 30; i += 1) {
    for (let t = 0; t < 120; t += 0.5) {
      const d = cloudDrift(i, t);
      assert.ok(d >= -0.1 && d <= 0.1, `drift ${d} out of range for cloud ${i} at t=${t}`);
      assert.equal(cloudDrift(i, t), d, 'drift is deterministic from index and time');
    }
  }
});

test('cloudDrift is smooth: neighbouring times differ only slightly', () => {
  const dt = 0.01;
  for (let i = 0; i < 5; i += 1) {
    for (let t = 0; t < 20; t += 1) {
      const a = cloudDrift(i, t);
      const b = cloudDrift(i, t + dt);
      assert.ok(Math.abs(a - b) < 0.01, 'drift never jumps between close times');
    }
  }
});
