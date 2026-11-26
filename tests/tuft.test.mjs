// The tuft module decides the shape of one clump of grass; the world turns
// those buffers into a single InstancedMesh. These tests hold the module to
// its contract: the buffers are the size it claims, every value is finite, the
// blades stand on the ground rather than through it, the four variants really
// differ, and the lean maths can never fold the grass flat.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TUFT_SEED, TUFT_BLADES, TUFT_VARIANTS, TUFT_BASE_TINT, TUFT_TIP_TINT,
  TUFT_PHASE_TINT, TUFT_MAX_LEAN,
  mulberry32, tuftBlades, tuftGeometry, tuftPhaseTint, tuftLeanAngle, tuftLeanAxis
} from '../src/tuft.js';

test('mulberry32 is deterministic and stays in [0, 1)', () => {
  const a = mulberry32(1234);
  const b = mulberry32(1234);
  for (let i = 0; i < 500; i += 1) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1, `value ${x} left [0,1)`);
  }
  const c = mulberry32(5678);
  assert.notEqual(a(), c());
});

test('the authored constants are the ones the world relies on', () => {
  assert.equal(TUFT_BLADES, 5);
  assert.equal(TUFT_VARIANTS, 4);
  assert.equal(TUFT_BASE_TINT, 0x33501f);
  assert.equal(TUFT_TIP_TINT, 0xa8c067);
  assert.ok(TUFT_MAX_LEAN > 0 && TUFT_MAX_LEAN < 0.5);
  assert.ok(Object.isFrozen(TUFT_PHASE_TINT));
});

test('tuftBlades returns exactly TUFT_BLADES blades with finite fields', () => {
  for (let variant = 0; variant < TUFT_VARIANTS; variant += 1) {
    const blades = tuftBlades(variant);
    assert.equal(blades.length, TUFT_BLADES);
    for (const blade of blades) {
      for (const key of ['angle', 'radius', 'height', 'width', 'lean', 'shade']) {
        assert.ok(Number.isFinite(blade[key]), `${key} is not finite`);
      }
      assert.ok(blade.height > 0 && blade.height <= 0.42 + 1e-9);
      assert.ok(blade.radius >= 0);
      assert.ok(blade.shade >= 0.82 && blade.shade <= 1.0 + 1e-9);
    }
  }
});

test('tuftBlades is deterministic for a given variant and seed', () => {
  for (let variant = 0; variant < TUFT_VARIANTS; variant += 1) {
    assert.deepEqual(tuftBlades(variant), tuftBlades(variant));
    assert.deepEqual(tuftBlades(variant, TUFT_SEED), tuftBlades(variant, TUFT_SEED));
  }
});

test('tuftBlades mixes the seed so a different seed gives a different shape', () => {
  const a = tuftBlades(0, TUFT_SEED);
  const b = tuftBlades(0, TUFT_SEED + 1);
  assert.notDeepEqual(a, b);
});

test('the four variants are different shapes, not the same shape four times', () => {
  const shapes = [];
  for (let variant = 0; variant < TUFT_VARIANTS; variant += 1) {
    shapes.push(JSON.stringify(tuftBlades(variant)));
  }
  assert.equal(new Set(shapes).size, TUFT_VARIANTS);
});

test('tuftBlades folds a junk variant to 0 instead of throwing', () => {
  const zero = tuftBlades(0);
  for (const junk of [undefined, null, NaN, Infinity, -Infinity, 'x', {}, [], -3]) {
    const blades = tuftBlades(junk);
    assert.equal(blades.length, TUFT_BLADES);
    for (const blade of blades) {
      assert.ok(Number.isFinite(blade.height));
    }
  }
  // A negative variant wraps the same way as its magnitude, and a non-finite one
  // reads as variant 0.
  assert.deepEqual(tuftBlades(NaN), zero);
  assert.deepEqual(tuftBlades(-1), tuftBlades(1));
  assert.deepEqual(tuftBlades(TUFT_VARIANTS), zero);
});

test('a junk seed falls back to the authored seed', () => {
  assert.deepEqual(tuftBlades(0, NaN), tuftBlades(0, TUFT_SEED));
  assert.deepEqual(tuftBlades(0, undefined), tuftBlades(0, TUFT_SEED));
});

test('tuftGeometry has the documented buffer sizes', () => {
  for (let variant = 0; variant < TUFT_VARIANTS; variant += 1) {
    const geo = tuftGeometry(variant);
    assert.equal(geo.vertexCount, TUFT_BLADES * 3);
    assert.equal(geo.triangles, TUFT_BLADES * 3);
    assert.equal(geo.positions.length, geo.vertexCount * 3);
    assert.equal(geo.colours.length, geo.vertexCount * 3);
    assert.equal(geo.normals.length, geo.vertexCount * 3);
    assert.ok(geo.positions instanceof Float32Array);
    assert.ok(geo.colours instanceof Float32Array);
    assert.ok(geo.normals instanceof Float32Array);
  }
});

test('every geometry value is finite', () => {
  for (let variant = 0; variant < TUFT_VARIANTS; variant += 1) {
    const geo = tuftGeometry(variant);
    for (const buffer of [geo.positions, geo.colours, geo.normals]) {
      for (const value of buffer) {
        assert.ok(Number.isFinite(value), 'a buffer value was not finite');
      }
    }
  }
});

test('no vertex sits below the ground plane', () => {
  // A blade dipping below y=0 would z-fight with the lawn it grows from.
  for (let variant = 0; variant < TUFT_VARIANTS; variant += 1) {
    const { positions } = tuftGeometry(variant);
    for (let i = 1; i < positions.length; i += 3) {
      assert.ok(positions[i] >= 0, `vertex y ${positions[i]} is below the ground`);
    }
  }
});

test('every tuft stands above its footprint and tops out near TUFT_HEIGHT', () => {
  for (let variant = 0; variant < TUFT_VARIANTS; variant += 1) {
    const geo = tuftGeometry(variant);
    assert.ok(geo.height > 0.2 && geo.height <= 0.42 + 1e-9);
    // The buffer's own maximum must agree with the reported height.
    let maxY = -Infinity;
    for (let i = 1; i < geo.positions.length; i += 3) maxY = Math.max(maxY, geo.positions[i]);
    assert.ok(Math.abs(maxY - geo.height) < 1e-6);
  }
});

test('all normals point straight up', () => {
  const { normals } = tuftGeometry(1);
  for (let i = 0; i < normals.length; i += 3) {
    assert.equal(normals[i], 0);
    assert.equal(normals[i + 1], 1);
    assert.equal(normals[i + 2], 0);
  }
});

test('root corners are darker than tip corners and colours stay in [0, 1]', () => {
  const { colours } = tuftGeometry(2);
  // Each blade is three corners: [rootLeft, rootRight, tip].
  for (let blade = 0; blade < TUFT_BLADES; blade += 1) {
    const rootIndex = blade * 9;
    const tipIndex = blade * 9 + 6;
    const rootSum = colours[rootIndex] + colours[rootIndex + 1] + colours[rootIndex + 2];
    const tipSum = colours[tipIndex] + colours[tipIndex + 1] + colours[tipIndex + 2];
    assert.ok(rootSum < tipSum, 'a tip was darker than its root');
  }
  for (const value of colours) {
    assert.ok(value >= 0 && value <= 1, `colour channel ${value} left [0,1]`);
  }
});

test('the base tint really is the darker end of the gradient', () => {
  const lum = (hex) => (((hex >> 16) & 0xff) + ((hex >> 8) & 0xff) + (hex & 0xff)) / 3;
  assert.ok(lum(TUFT_BASE_TINT) < lum(TUFT_TIP_TINT));
});

test('a junk variant still produces a usable geometry', () => {
  for (const junk of [undefined, null, NaN, Infinity, 'grass', {}]) {
    const geo = tuftGeometry(junk);
    assert.equal(geo.positions.length, TUFT_BLADES * 9);
    for (const value of geo.positions) assert.ok(Number.isFinite(value));
  }
});

test('tuftPhaseTint is per phase and falls back to the day tint', () => {
  assert.equal(tuftPhaseTint('day'), TUFT_PHASE_TINT.day);
  assert.equal(tuftPhaseTint('dusk'), TUFT_PHASE_TINT.dusk);
  assert.equal(tuftPhaseTint('night'), TUFT_PHASE_TINT.night);
  assert.equal(tuftPhaseTint('dawn'), TUFT_PHASE_TINT.day);
  assert.equal(tuftPhaseTint(undefined), TUFT_PHASE_TINT.day);
  assert.equal(tuftPhaseTint(null), TUFT_PHASE_TINT.day);
  assert.equal(tuftPhaseTint(42), TUFT_PHASE_TINT.day);
  // Night must actually darken: its channel sum is below the day white.
  const sum = (hex) => ((hex >> 16) & 0xff) + ((hex >> 8) & 0xff) + (hex & 0xff);
  assert.ok(sum(TUFT_PHASE_TINT.night) < sum(TUFT_PHASE_TINT.day));
});

test('tuftLeanAngle scales the sway, clamps it and never folds flat', () => {
  assert.equal(tuftLeanAngle(0), 0);
  assert.ok(Math.abs(tuftLeanAngle(1) - TUFT_MAX_LEAN) < 1e-12);
  assert.ok(Math.abs(tuftLeanAngle(-1) + TUFT_MAX_LEAN) < 1e-12);
  // Out-of-range and junk input clamps or zeroes rather than blowing out.
  assert.ok(Math.abs(tuftLeanAngle(50)) <= TUFT_MAX_LEAN);
  assert.ok(Math.abs(tuftLeanAngle(-50)) <= TUFT_MAX_LEAN);
  assert.equal(tuftLeanAngle(NaN), 0);
  assert.equal(tuftLeanAngle(undefined), 0);
  assert.equal(tuftLeanAngle('x'), 0);
});

test('tuftLeanAngle is monotonic in the sway', () => {
  let previous = tuftLeanAngle(-1);
  for (let s = -0.9; s <= 1; s += 0.1) {
    const current = tuftLeanAngle(s);
    assert.ok(current >= previous - 1e-12, 'lean angle went backwards');
    previous = current;
  }
});

test('tuftLeanAxis is horizontal, unit length and perpendicular to the wind', () => {
  for (const wind of [{ x: 0.94, z: 0.34 }, { x: 1, z: 0 }, { x: 0, z: -1 }, { x: -0.6, z: 0.8 }]) {
    const axis = tuftLeanAxis(wind);
    assert.equal(axis.y, 0);
    const length = Math.hypot(axis.x, axis.z);
    assert.ok(Math.abs(length - 1) < 1e-12, `axis length ${length}`);
    const dot = wind.x * axis.x + wind.z * axis.z;
    assert.ok(Math.abs(dot) < 1e-12, `axis is not perpendicular (dot ${dot})`);
  }
});

test('tuftLeanAxis guards a degenerate or junk direction', () => {
  for (const junk of [undefined, null, {}, { x: NaN, z: NaN }, { x: 0, z: 0 }, 'wind']) {
    const axis = tuftLeanAxis(junk);
    assert.equal(axis.y, 0);
    assert.ok(Math.abs(Math.hypot(axis.x, axis.z) - 1) < 1e-12);
    assert.ok(Number.isFinite(axis.x) && Number.isFinite(axis.z));
  }
});

test('leaning about tuftLeanAxis tips the tip downwind', () => {
  // A blade standing up the +y axis, rotated by a small positive angle about
  // the lean axis, must move its tip along the wind direction.
  const wind = { x: 1, z: 0 };
  const axis = tuftLeanAxis(wind);
  const angle = tuftLeanAngle(1);
  // Rodrigues: v' = v cos + (k x v) sin + k (k.v)(1 - cos), with v = +y.
  const k = { x: axis.x, y: axis.y, z: axis.z };
  const kDotV = k.y;
  const crossY = { x: -k.z, y: 0, z: k.x }; // k x (0,1,0)
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const tipX = crossY.x * sin + k.x * kDotV * (1 - cos);
  const tipZ = crossY.z * sin + k.z * kDotV * (1 - cos);
  assert.ok(tipX > 0, `tip should tip towards +x, got ${tipX}`);
  assert.ok(Math.abs(tipZ) < 1e-9, `tip should not move in z, got ${tipZ}`);
});
