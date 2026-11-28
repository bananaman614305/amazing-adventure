// The mote module decides where the sunlit dust motes hang, how each one drifts,
// and how strongly the field shows in each phase; the world turns those numbers
// into one InstancedMesh of additive specks. These tests hold the module to its
// contract: the authored constants, the frozen phase table and its junk fallback,
// the spawn count and field bounds, determinism, the guards for junk input, the
// bounded non-repeating wander of motePosition, and the quality gate.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MOTE_SEED, MOTE_COUNT, MOTE_MAX_COUNT,
  MOTE_MIN_RADIUS, MOTE_MAX_RADIUS,
  MOTE_MIN_HEIGHT, MOTE_MAX_HEIGHT,
  MOTE_DRIFT, MOTE_BOB,
  MOTE_MIN_SIZE, MOTE_MAX_SIZE,
  MOTE_MIN_SPEED, MOTE_MAX_SPEED,
  MOTE_PHASE_GLOW,
  moteGlowLevel, moteSpawns, motePosition, motesEnabled
} from '../src/motes.js';

test('the authored constants are the ones the world relies on', () => {
  assert.equal(MOTE_SEED, 0x4d2b81);
  assert.equal(MOTE_COUNT, 90);
  assert.equal(MOTE_MAX_COUNT, 400);
  assert.equal(MOTE_MIN_RADIUS, 0);
  assert.equal(MOTE_MAX_RADIUS, 15);
  assert.equal(MOTE_MIN_HEIGHT, 0.4);
  assert.equal(MOTE_MAX_HEIGHT, 5.5);
  assert.equal(MOTE_DRIFT, 0.55);
  assert.equal(MOTE_BOB, 0.3);
  assert.equal(MOTE_MIN_SIZE, 0.02);
  assert.equal(MOTE_MAX_SIZE, 0.06);
  // The declared bands must be ordered or the sampler is meaningless.
  assert.ok(MOTE_MIN_RADIUS < MOTE_MAX_RADIUS);
  assert.ok(MOTE_MIN_HEIGHT < MOTE_MAX_HEIGHT);
  assert.ok(MOTE_MIN_SIZE < MOTE_MAX_SIZE);
  assert.ok(MOTE_MIN_SPEED < MOTE_MAX_SPEED);
});

test('the field hangs over plaza and meadow but inside the wall', () => {
  // The plaza disc is r9 and the wall sits near r17, so the field must reach past
  // the plaza edge yet stay inside the wall.
  assert.ok(MOTE_MAX_RADIUS > 9, 'motes never reach the meadow');
  assert.ok(MOTE_MAX_RADIUS < 17, 'motes could spawn past the wall');
  assert.ok(MOTE_MIN_HEIGHT > 0, 'motes could sit in the paving');
});

test('the phase glow table is frozen and has the authored values', () => {
  assert.ok(Object.isFrozen(MOTE_PHASE_GLOW));
  assert.equal(MOTE_PHASE_GLOW.day, 1);
  assert.equal(MOTE_PHASE_GLOW.dusk, 0.35);
  assert.equal(MOTE_PHASE_GLOW.night, 0);
});

test('moteGlowLevel is per phase and falls back to day', () => {
  assert.equal(moteGlowLevel('day'), 1);
  assert.equal(moteGlowLevel('dusk'), 0.35);
  assert.equal(moteGlowLevel('night'), 0);
  // Unknown phase, and every kind of junk, reads as the day value (1).
  assert.equal(moteGlowLevel('dawn'), 1);
  for (const junk of [undefined, null, 42, NaN, {}, [], 'NIGHT']) {
    assert.equal(moteGlowLevel(junk), 1);
  }
});

test('moteSpawns returns exactly count items with finite fields', () => {
  const spawns = moteSpawns();
  assert.equal(spawns.length, MOTE_COUNT);
  for (const s of spawns) {
    for (const key of ['x', 'y', 'z', 'phase', 'speed', 'size', 'driftX', 'driftZ']) {
      assert.ok(Number.isFinite(s[key]), `${key} is not finite`);
    }
    assert.ok(s.phase >= 0 && s.phase < 1, `phase ${s.phase} left [0,1)`);
    assert.ok(s.speed >= MOTE_MIN_SPEED - 1e-9 && s.speed <= MOTE_MAX_SPEED + 1e-9, `speed ${s.speed} out of band`);
    assert.ok(s.size >= MOTE_MIN_SIZE - 1e-9 && s.size <= MOTE_MAX_SIZE + 1e-9, `size ${s.size} out of band`);
  }
});

test('moteSpawns honours an explicit count', () => {
  assert.equal(moteSpawns({ count: 7 }).length, 7);
  assert.equal(moteSpawns({ count: 1 }).length, 1);
  assert.equal(moteSpawns({ count: 0 }).length, 0);
});

test('moteSpawns is deterministic for identical arguments', () => {
  assert.deepEqual(moteSpawns(), moteSpawns());
  assert.deepEqual(moteSpawns({ count: 12, seed: 99 }), moteSpawns({ count: 12, seed: 99 }));
});

test('a different seed gives a different field', () => {
  assert.notDeepEqual(moteSpawns({ seed: 1 }), moteSpawns({ seed: 2 }));
});

test('the field is spread, not every mote on one spot', () => {
  const spawns = moteSpawns();
  const angles = new Set(spawns.map((s) => Math.round(Math.atan2(s.z, s.x) * 1000)));
  const radii = new Set(spawns.map((s) => Math.round(Math.hypot(s.x, s.z) * 1000)));
  assert.ok(angles.size > 10, `only ${angles.size} distinct angles`);
  assert.ok(radii.size > 10, `only ${radii.size} distinct radii`);
});

test('every spawn lies inside the declared radius and height bands', () => {
  for (const s of moteSpawns()) {
    const reach = Math.hypot(s.x, s.z);
    assert.ok(reach >= MOTE_MIN_RADIUS - 1e-9, `reach ${reach} below min radius`);
    assert.ok(reach <= MOTE_MAX_RADIUS + 1e-9, `reach ${reach} above max radius`);
    assert.ok(s.y >= MOTE_MIN_HEIGHT - 1e-9, `height ${s.y} below band`);
    assert.ok(s.y <= MOTE_MAX_HEIGHT + 1e-9, `height ${s.y} above band`);
  }
});

test('a junk count clamps into [0, MOTE_MAX_COUNT] and floors', () => {
  for (const junk of [NaN, Infinity, -Infinity, 'x', null, {}, undefined]) {
    const spawns = moteSpawns({ count: junk });
    assert.ok(spawns.length >= 0 && spawns.length <= MOTE_MAX_COUNT, `junk count gave ${spawns.length}`);
    for (const s of spawns) assert.ok(Number.isFinite(s.x));
  }
  assert.equal(moteSpawns({ count: 1e9 }).length, MOTE_MAX_COUNT);
  assert.equal(moteSpawns({ count: -5 }).length, 0);
  assert.equal(moteSpawns({ count: 3.9 }).length, 3);
});

test('a junk seed falls back to the authored seed', () => {
  assert.deepEqual(moteSpawns({ count: 5, seed: NaN }), moteSpawns({ count: 5, seed: MOTE_SEED }));
  assert.deepEqual(moteSpawns({ count: 5, seed: Infinity }), moteSpawns({ count: 5 }));
});

test('swapped radii are handled and negative radii clamp to 0', () => {
  const swapped = moteSpawns({ count: 8, minRadius: 14, maxRadius: 4 });
  for (const s of swapped) {
    const reach = Math.hypot(s.x, s.z);
    assert.ok(reach >= 4 - 1e-9 && reach <= 14 + 1e-9, `reach ${reach} outside swapped band`);
  }
  const negative = moteSpawns({ count: 8, minRadius: -4, maxRadius: -1 });
  for (const s of negative) {
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z));
    assert.ok(Math.hypot(s.x, s.z) <= 1e-9, 'negative radii should collapse to the centre');
  }
});

test('moteSpawns tolerates a junk options argument', () => {
  // No argument at all, and a non-object argument, both fall back to defaults.
  assert.deepEqual(moteSpawns(undefined), moteSpawns());
  assert.deepEqual(moteSpawns(null), moteSpawns());
  for (const junk of [42, 'x', [], true]) {
    const spawns = moteSpawns(junk);
    assert.equal(spawns.length, MOTE_COUNT);
    for (const s of spawns) assert.ok(Number.isFinite(s.x));
  }
});

test('motePosition returns finite coordinates over a long sweep', () => {
  const spawns = moteSpawns({ count: 6 });
  for (const s of spawns) {
    for (let t = 0; t < 200; t += 0.017) {
      const p = motePosition(s, t);
      for (const key of ['x', 'y', 'z']) {
        assert.ok(Number.isFinite(p[key]), `${key} not finite at t=${t}`);
      }
    }
  }
});

test('motePosition never wanders further than the documented bound from the spawn', () => {
  const spawns = moteSpawns({ count: 10 });
  for (const s of spawns) {
    for (let t = 0; t < 400; t += 0.013) {
      const p = motePosition(s, t);
      assert.ok(Math.abs(p.x - s.x) <= MOTE_DRIFT + 1e-9, `x wander ${p.x - s.x} exceeds MOTE_DRIFT`);
      assert.ok(Math.abs(p.z - s.z) <= MOTE_DRIFT + 1e-9, `z wander ${p.z - s.z} exceeds MOTE_DRIFT`);
      assert.ok(Math.abs(p.y - s.y) <= MOTE_BOB + 1e-9, `y wander ${p.y - s.y} exceeds MOTE_BOB`);
    }
  }
});

test('motePosition does not retrace an obvious circle', () => {
  // Over a long sweep the path should fill area: the spread of x and z offsets
  // should both be substantial, not sit on a 1-D loop.
  const s = moteSpawns({ count: 1 })[0];
  let minX = Infinity; let maxX = -Infinity;
  let minZ = Infinity; let maxZ = -Infinity;
  for (let t = 0; t < 120; t += 0.01) {
    const p = motePosition(s, t);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  assert.ok(maxX - minX > MOTE_DRIFT * 0.8, `x range only ${maxX - minX}`);
  assert.ok(maxZ - minZ > MOTE_DRIFT * 0.8, `z range only ${maxZ - minZ}`);
});

test('motePosition is deterministic', () => {
  const s = moteSpawns({ count: 1 })[0];
  assert.deepEqual(motePosition(s, 3.3), motePosition(s, 3.3));
});

test('motePosition reads non-finite time as 0', () => {
  const s = moteSpawns({ count: 1 })[0];
  const zero = motePosition(s, 0);
  for (const junk of [NaN, Infinity, -Infinity, undefined, null, 'x', {}]) {
    assert.deepEqual(motePosition(s, junk), zero, `time ${String(junk)} did not read as 0`);
  }
});

test('motePosition returns a finite origin for a junk spawn', () => {
  const origin = { x: 0, y: 0, z: 0 };
  for (const junk of [undefined, null, 42, 'x', [], true]) {
    assert.deepEqual(motePosition(junk, 1.5), origin);
  }
  // An object with junk fields still yields finite numbers, not NaN.
  for (const junk of [
    {},
    { x: NaN, y: Infinity, z: 'x', speed: NaN, phase: null, driftX: {}, driftZ: [] },
    { x: -3, y: -9, z: -1, speed: -1, phase: NaN, driftX: NaN, driftZ: Infinity }
  ]) {
    const p = motePosition(junk, 2);
    for (const key of ['x', 'y', 'z']) {
      assert.ok(Number.isFinite(p[key]), `${key} not finite for junk spawn`);
    }
  }
});

test('an absurd time does not overflow into non-finite numbers', () => {
  const s = moteSpawns({ count: 1 })[0];
  for (const t of [Number.MAX_VALUE, 1e300, -1e300]) {
    const p = motePosition(s, t);
    for (const key of ['x', 'y', 'z']) {
      assert.ok(Number.isFinite(p[key]), `${key} overflowed at t=${t}`);
    }
  }
});

test('a no-NaN sweep across the whole default field stays finite', () => {
  const spawns = moteSpawns();
  for (const s of spawns) {
    for (let t = 0; t < 60; t += 0.05) {
      const p = motePosition(s, t);
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
    }
  }
});

test('motesEnabled is false only for the low tier', () => {
  assert.equal(motesEnabled('low'), false);
  assert.equal(motesEnabled('full'), true);
  for (const junk of [undefined, null, 'LOW', 'high', 42, {}, []]) {
    assert.equal(motesEnabled(junk), true);
  }
});