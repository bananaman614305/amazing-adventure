// Scatter placement for the courtyard's small ground props. The pure numbers
// live in src/scatter.js; this file holds them to their contract so the exact
// scatter the meshes are built from is pinned: how many props, where they sit,
// that none land in an exclusion, the scale/rotation/variant ranges, and that the
// whole thing is deterministic -- a screenshot taken twice looks the same and a
// save restores the same courtyard.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCATTER_SEED, mulberry32, pointBlocked, scatterPoints
} from '../src/scatter.js';

// A generous patch of open grass, well clear of any exclusion, for the cases
// that just want room to place things.
const OPEN = { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };

function finite(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

test('SCATTER_SEED is a fixed 32-bit constant', () => {
  assert.equal(SCATTER_SEED, 0x2f9a1c);
  assert.ok(Number.isInteger(SCATTER_SEED));
});

test('mulberry32 is deterministic and lands in 0..1', () => {
  const a = mulberry32(SCATTER_SEED);
  const b = mulberry32(SCATTER_SEED);
  for (let i = 0; i < 200; i += 1) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
});

test('scatterPoints honours the count when the space is free', () => {
  const { points, rejected } = scatterPoints({ count: 50, area: OPEN });
  assert.equal(points.length, 50);
  assert.equal(rejected, 0);
});

test('scatterPoints is deterministic for a seed and differs across seeds', () => {
  const a = scatterPoints({ count: 30, seed: 7, area: OPEN });
  const b = scatterPoints({ count: 30, seed: 7, area: OPEN });
  const c = scatterPoints({ count: 30, seed: 8, area: OPEN });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.points, c.points);
});

test('every point lands inside the area', () => {
  const { points } = scatterPoints({ count: 200, area: OPEN });
  for (const p of points) {
    assert.ok(p.x >= OPEN.minX && p.x <= OPEN.maxX, `x ${p.x} inside area`);
    assert.ok(p.z >= OPEN.minZ && p.z <= OPEN.maxZ, `z ${p.z} inside area`);
  }
});

test('no point lands inside an exclusion circle, even in a dense ring', () => {
  // A ring of overlapping circles that walls off most of the area: the scatter
  // must thread the gaps and never place a prop inside one.
  const circles = [];
  for (let i = 0; i < 24; i += 1) {
    const a = (i / 24) * Math.PI * 2;
    circles.push({ x: Math.cos(a) * 10, z: Math.sin(a) * 10, radius: 3 });
  }
  circles.push({ x: 0, z: 0, radius: 4 });
  const { points } = scatterPoints({ count: 120, area: OPEN, circles, margin: 0.5 });
  for (const p of points) {
    for (const c of circles) {
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      assert.ok(d > c.radius + 0.5, `point (${p.x},${p.z}) clear of circle by margin`);
    }
  }
});

test('no point lands inside an exclusion rect', () => {
  const rects = [
    { minX: -5, maxX: 5, minZ: -30, maxZ: 30 },
    { minX: -30, maxX: 30, minZ: 8, maxZ: 12 }
  ];
  const { points } = scatterPoints({ count: 150, area: OPEN, rects, margin: 1 });
  for (const p of points) {
    for (const r of rects) {
      const inside = p.x >= r.minX - 1 && p.x <= r.maxX + 1 &&
        p.z >= r.minZ - 1 && p.z <= r.maxZ + 1;
      assert.equal(inside, false, `point (${p.x},${p.z}) clear of rect by margin`);
    }
  }
});

test('scale, rotation and variant stay in range and vary', () => {
  const { points } = scatterPoints({
    count: 300, area: OPEN, minScale: 0.8, maxScale: 1.25
  });
  const variants = new Set();
  for (const p of points) {
    assert.ok(p.scale >= 0.8 && p.scale <= 1.25, `scale ${p.scale} in band`);
    assert.ok(p.rotation >= 0 && p.rotation < Math.PI * 2, `rotation ${p.rotation} in range`);
    assert.ok(Number.isInteger(p.variant) && p.variant >= 0 && p.variant <= 3,
      `variant ${p.variant} is an integer in [0, 3]`);
    variants.add(p.variant);
  }
  assert.equal(variants.size, 4, 'all four visual variants are exercised');
});

test('pointBlocked is fail safe on a malformed point', () => {
  assert.equal(pointBlocked({ x: NaN, z: 0 }), true);
  assert.equal(pointBlocked({ x: 0, z: Infinity }), true);
  assert.equal(pointBlocked({ z: 0 }), true);
  assert.equal(pointBlocked(null), true);
  assert.equal(pointBlocked(undefined), true);
});

test('pointBlocked skips malformed exclusions instead of throwing', () => {
  const circles = [null, {}, { x: 0, z: 0 }, { x: 0, z: 0, radius: NaN }, { x: 0, z: 0, radius: 5 }];
  const rects = [null, {}, { minX: 0 }, { minX: 0, maxX: 1, minZ: 0, maxZ: 1 }];
  assert.doesNotThrow(() => pointBlocked({ x: 0, z: 0 }, circles, rects, 1));
  // The one well-formed circle still blocks.
  assert.equal(pointBlocked({ x: 0, z: 0 }, circles, [], 0), true);
  assert.equal(pointBlocked({ x: 0, z: 0 }, [], rects, 0), true);
});

test('pointBlocked honours the margin around circles and rects', () => {
  const circle = { x: 0, z: 0, radius: 2 };
  assert.equal(pointBlocked({ x: 3, z: 0 }, [circle], [], 0), false);
  assert.equal(pointBlocked({ x: 3, z: 0 }, [circle], [], 2), true);
  const rect = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
  assert.equal(pointBlocked({ x: 2, z: 0 }, [], [rect], 0), false);
  assert.equal(pointBlocked({ x: 2, z: 0 }, [], [rect], 1.5), true);
});

test('degenerate and non-positive counts return the empty shape', () => {
  for (const count of [0, -5, NaN, undefined]) {
    const r = scatterPoints({ count, area: OPEN });
    assert.deepEqual(r, { points: [], rejected: 0, attempts: 0 });
  }
});

test('a degenerate area returns the empty shape', () => {
  const areas = [
    { minX: 5, maxX: 5, minZ: -1, maxZ: 1 },
    { minX: 0, maxX: 1, minZ: 3, maxZ: 3 },
    { minX: NaN, maxX: 1, minZ: 0, maxZ: 1 },
    null,
    undefined
  ];
  for (const area of areas) {
    const r = scatterPoints({ count: 10, area });
    assert.deepEqual(r, { points: [], rejected: 0, attempts: 0 });
  }
});

test('a fully-blocked area terminates with zero points', () => {
  // One circle covering the whole area: every candidate is rejected, and the
  // bounded loop must give up rather than hang.
  const area = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
  const circles = [{ x: 0, z: 0, radius: 100 }];
  const r = scatterPoints({ count: 20, area, circles, maxAttempts: 200 });
  assert.equal(r.points.length, 0);
  assert.equal(r.attempts, 200);
  assert.equal(r.rejected, 200);
});

test('maxAttempts bounds the work when space is tight', () => {
  const area = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
  const circles = [{ x: 0, z: 0, radius: 1.5 }];
  const r = scatterPoints({ count: 100, area, circles, maxAttempts: 50 });
  assert.ok(r.attempts <= 50, 'never exceeds maxAttempts');
  assert.ok(r.points.length < 100, 'returns fewer points than asked');
  assert.equal(r.rejected + r.points.length, r.attempts);
});

test('no coordinate is ever NaN or Infinity across many points', () => {
  const circles = [{ x: 3, z: -2, radius: 2.5 }];
  const rects = [{ minX: -4, maxX: -1, minZ: 1, maxZ: 5 }];
  const { points } = scatterPoints({
    count: 400, seed: 99, area: OPEN, circles, rects, margin: 0.25
  });
  assert.ok(points.length > 0);
  for (const p of points) {
    assert.ok(finite(p.x) && finite(p.z), 'x and z are finite');
    assert.ok(finite(p.scale) && finite(p.rotation), 'scale and rotation are finite');
    assert.ok(Number.isInteger(p.variant), 'variant is an integer');
  }
});

test('a non-finite option falls back to a default rather than emitting NaN', () => {
  const r = scatterPoints({
    count: 20, seed: NaN, area: OPEN, minScale: Infinity, maxScale: -Infinity,
    margin: NaN
  });
  assert.equal(r.points.length, 20);
  for (const p of r.points) {
    assert.ok(finite(p.x) && finite(p.z) && finite(p.scale) && finite(p.rotation),
      'every emitted number is finite');
  }
  // A NaN seed falls back to SCATTER_SEED, so it matches an explicit default seed.
  const d = scatterPoints({ count: 20, area: OPEN });
  assert.deepEqual(r.points, d.points);
});

test('an inverted scale band is normalised, not emitted inverted', () => {
  const { points } = scatterPoints({ count: 50, area: OPEN, minScale: 2, maxScale: 1 });
  for (const p of points) {
    assert.ok(p.scale >= 1 && p.scale <= 2, `scale ${p.scale} within normalised band`);
  }
});