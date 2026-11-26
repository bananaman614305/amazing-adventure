// The firefly module decides where a night field of fireflies sits, how it
// drifts and how it blinks; the world turns those numbers into one InstancedMesh.
// These tests hold the module to its contract: the constants, the per-phase glow
// and its junk fallback, the spawn count and field bounds, determinism, the
// guards, the blink curve's range/periodicity/asymmetry, the drift bounds, and
// the quality gate.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FIREFLY_SEED, FIREFLY_COUNT, FIREFLY_TINT,
  FIREFLY_MIN_RADIUS, FIREFLY_MAX_RADIUS, FIREFLY_HEIGHT,
  FIREFLY_PHASE_GLOW, FIREFLY_BLINK_PERIOD,
  fireflyGlowLevel, fireflySpawns, fireflyBlink, fireflyDrift, fireflyEnabled
} from '../src/fireflies.js';

test('the authored constants are the ones the world relies on', () => {
  assert.equal(FIREFLY_SEED, 0x3c9d21);
  assert.equal(FIREFLY_COUNT, 64);
  assert.equal(FIREFLY_TINT, 0xd9e86a);
  assert.equal(FIREFLY_MIN_RADIUS, 9.6);
  assert.equal(FIREFLY_MAX_RADIUS, 15.8);
  assert.equal(FIREFLY_HEIGHT, 1.25);
  assert.ok(FIREFLY_MIN_RADIUS < FIREFLY_MAX_RADIUS);
});

test('the phase glow table is frozen and has the authored values', () => {
  assert.ok(Object.isFrozen(FIREFLY_PHASE_GLOW));
  assert.equal(FIREFLY_PHASE_GLOW.day, 0);
  assert.equal(FIREFLY_PHASE_GLOW.dusk, 0.45);
  assert.equal(FIREFLY_PHASE_GLOW.night, 1);
});

test('fireflyGlowLevel is per phase and falls back to day', () => {
  assert.equal(fireflyGlowLevel('day'), 0);
  assert.equal(fireflyGlowLevel('dusk'), 0.45);
  assert.equal(fireflyGlowLevel('night'), 1);
  // Unknown phase, and every kind of junk, reads as the day value (0).
  assert.equal(fireflyGlowLevel('dawn'), 0);
  for (const junk of [undefined, null, 42, NaN, {}, [], 'DUSK']) {
    assert.equal(fireflyGlowLevel(junk), 0);
  }
});

test('fireflySpawns returns exactly count items with finite fields', () => {
  const spawns = fireflySpawns();
  assert.equal(spawns.length, FIREFLY_COUNT);
  for (const s of spawns) {
    for (const key of ['x', 'z', 'radius', 'height', 'phase', 'speed']) {
      assert.ok(Number.isFinite(s[key]), `${key} is not finite`);
    }
    assert.ok(s.phase >= 0 && s.phase < 1, `phase ${s.phase} left [0,1)`);
  }
});

test('fireflySpawns honours an explicit count', () => {
  assert.equal(fireflySpawns({ count: 7 }).length, 7);
  assert.equal(fireflySpawns({ count: 1 }).length, 1);
});

test('fireflySpawns is deterministic for identical arguments', () => {
  assert.deepEqual(fireflySpawns(), fireflySpawns());
  assert.deepEqual(fireflySpawns({ count: 10, seed: 99 }), fireflySpawns({ count: 10, seed: 99 }));
});

test('a different seed gives a different field', () => {
  assert.notDeepEqual(fireflySpawns({ seed: 1 }), fireflySpawns({ seed: 2 }));
});

test('the field is spread, not every firefly on one spot', () => {
  const spawns = fireflySpawns();
  const angles = new Set(spawns.map((s) => Math.round(Math.atan2(s.z, s.x) * 1000)));
  const radii = new Set(spawns.map((s) => Math.round(s.radius * 1000)));
  assert.ok(angles.size > 10, `only ${angles.size} distinct angles`);
  assert.ok(radii.size > 10, `only ${radii.size} distinct radii`);
});

test('every spawn lies in the ground-plane ring and at a sane height', () => {
  for (const s of fireflySpawns()) {
    const reach = Math.hypot(s.x, s.z);
    assert.ok(reach >= FIREFLY_MIN_RADIUS - 1e-9, `reach ${reach} below min radius`);
    assert.ok(reach <= FIREFLY_MAX_RADIUS + 1e-9, `reach ${reach} above max radius`);
    assert.ok(Math.abs(reach - s.radius) < 1e-9, 'radius disagrees with x/z');
    assert.ok(s.height >= 0.35 - 1e-9 && s.height <= 2.6 + 1e-9, `height ${s.height} out of band`);
  }
});

test('the ring is off the plaza and inside the walls', () => {
  const spawns = fireflySpawns();
  const minReach = Math.min(...spawns.map((s) => Math.hypot(s.x, s.z)));
  const maxReach = Math.max(...spawns.map((s) => Math.hypot(s.x, s.z)));
  assert.ok(minReach >= FIREFLY_MIN_RADIUS - 1e-9, `closest firefly ${minReach} is on the plaza`);
  assert.ok(maxReach <= FIREFLY_MAX_RADIUS + 1e-9, `farthest firefly ${maxReach} is past the walls`);
});

test('a count of 0 yields an empty field', () => {
  assert.deepEqual(fireflySpawns({ count: 0 }), []);
});

test('a junk count clamps into [0, 512] and floors', () => {
  for (const junk of [NaN, Infinity, -Infinity, 'x', null, {}, undefined]) {
    const spawns = fireflySpawns({ count: junk });
    assert.ok(spawns.length >= 0 && spawns.length <= 512, `junk count gave ${spawns.length}`);
    // undefined falls back to the default count; the rest are finite-or-default.
    for (const s of spawns) assert.ok(Number.isFinite(s.x));
  }
  assert.equal(fireflySpawns({ count: 1e9 }).length, 512);
  assert.equal(fireflySpawns({ count: -5 }).length, 0);
  assert.equal(fireflySpawns({ count: 3.9 }).length, 3);
});

test('a junk seed falls back to the authored seed', () => {
  assert.deepEqual(fireflySpawns({ count: 5, seed: NaN }), fireflySpawns({ count: 5, seed: FIREFLY_SEED }));
  assert.deepEqual(fireflySpawns({ count: 5, seed: Infinity }), fireflySpawns({ count: 5 }));
});

test('swapped radii are handled and negative radii clamp to 0', () => {
  const swapped = fireflySpawns({ count: 8, minRadius: 15, maxRadius: 5 });
  for (const s of swapped) {
    assert.ok(s.radius >= 5 - 1e-9 && s.radius <= 15 + 1e-9, `radius ${s.radius} outside swapped band`);
  }
  const negative = fireflySpawns({ count: 8, minRadius: -4, maxRadius: -1 });
  for (const s of negative) {
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z));
    assert.ok(Math.hypot(s.x, s.z) <= 1e-9, 'negative radii should collapse to the centre');
  }
});

test('fireflyBlink stays in [0, 1] over a long sweep', () => {
  for (let t = 0; t < 200; t += 0.013) {
    for (const phase of [0, 0.25, 0.5, 0.75]) {
      const b = fireflyBlink(t, phase);
      assert.ok(Number.isFinite(b) && b >= 0 && b <= 1, `blink ${b} left [0,1]`);
    }
  }
});

test('fireflyBlink is periodic in time', () => {
  for (const phase of [0, 0.3, 0.7]) {
    for (const t of [0, 0.5, 1.1, 3.3, 7.7]) {
      const a = fireflyBlink(t, phase);
      const b = fireflyBlink(t + FIREFLY_BLINK_PERIOD, phase);
      assert.ok(Math.abs(a - b) < 1e-9, `not periodic at t=${t}, phase=${phase}`);
    }
  }
});

test('fireflyBlink reaches near 1 at its peak and near 0 at its trough', () => {
  let peak = 0;
  let trough = 1;
  for (let t = 0; t < FIREFLY_BLINK_PERIOD; t += 0.001) {
    const b = fireflyBlink(t, 0);
    if (b > peak) peak = b;
    if (b < trough) trough = b;
  }
  assert.ok(peak > 0.99, `peak only ${peak}`);
  assert.ok(trough < 0.01, `trough only ${trough}`);
});

test('fireflyBlink is asymmetric: it does not spend equal time lit and dark', () => {
  // Over one cycle, count the fraction above and below 0.5. A plain sine splits
  // 50/50; a blink spends more time dark than lit.
  let above = 0;
  let below = 0;
  const steps = 2000;
  for (let i = 0; i < steps; i += 1) {
    const t = (i / steps) * FIREFLY_BLINK_PERIOD;
    if (fireflyBlink(t, 0) > 0.5) above += 1;
    else below += 1;
  }
  const ratio = above / below;
  assert.ok(ratio < 0.9, `blink is too symmetric (above/below ${ratio})`);
});

test('fireflyBlink is exactly 0 for junk input', () => {
  for (const junk of [undefined, null, NaN, Infinity, -Infinity, 'x', {}]) {
    assert.equal(fireflyBlink(junk, 0), 0);
    assert.equal(fireflyBlink(0, junk), 0);
  }
});

test('fireflyDrift stays within bounds over a long sweep for a small field', () => {
  const spawns = fireflySpawns({ count: 8 });
  for (const s of spawns) {
    for (let t = 0; t < 120; t += 0.017) {
      const d = fireflyDrift(t, s);
      for (const key of ['x', 'y', 'z']) {
        assert.ok(Number.isFinite(d[key]), `${key} not finite`);
      }
      assert.ok(Math.abs(d.x) <= 0.55 + 1e-9, `drift x ${d.x} out of bounds`);
      assert.ok(Math.abs(d.z) <= 0.55 + 1e-9, `drift z ${d.z} out of bounds`);
      assert.ok(Math.abs(d.y) <= 0.3 + 1e-9, `drift y ${d.y} out of bounds`);
    }
  }
});

test('fireflyDrift does not retrace an obvious circle', () => {
  // Over a long sweep the path should fill area, not sit on a 1-D loop: the
  // spread of x and z values should both be substantial.
  const s = fireflySpawns({ count: 1 })[0];
  let minX = Infinity; let maxX = -Infinity;
  let minZ = Infinity; let maxZ = -Infinity;
  for (let t = 0; t < 60; t += 0.01) {
    const d = fireflyDrift(t, s);
    minX = Math.min(minX, d.x); maxX = Math.max(maxX, d.x);
    minZ = Math.min(minZ, d.z); maxZ = Math.max(maxZ, d.z);
  }
  assert.ok(maxX - minX > 0.4, `x range only ${maxX - minX}`);
  assert.ok(maxZ - minZ > 0.4, `z range only ${maxZ - minZ}`);
});

test('fireflyDrift returns all zeros for junk spawn or time', () => {
  for (const junk of [undefined, null, NaN, Infinity, 'x', {}]) {
    assert.deepEqual(fireflyDrift(junk, { speed: 1 }), { x: 0, y: 0, z: 0 });
    assert.deepEqual(fireflyDrift(0, junk), { x: 0, y: 0, z: 0 });
  }
  // A spawn with a non-finite speed is junk too.
  assert.deepEqual(fireflyDrift(1, { speed: NaN }), { x: 0, y: 0, z: 0 });
});

test('fireflyEnabled is false only for the low tier', () => {
  assert.equal(fireflyEnabled('low'), false);
  assert.equal(fireflyEnabled('full'), true);
  for (const junk of [undefined, null, 'LOW', 'high', 42, {}, []]) {
    assert.equal(fireflyEnabled(junk), true);
  }
});