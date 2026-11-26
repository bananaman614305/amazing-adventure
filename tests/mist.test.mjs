// The mist module decides where the low ground haze lies over the meadow ring,
// how big and how faint each patch is, how that faintness varies by phase, and
// how each patch drifts; the world turns those numbers into one InstancedMesh of
// large soft quads. These tests hold the module to its contract: the authored
// constants and their bands, the frozen phase table and its junk fallback, the
// spawn count and field bounds, area-uniform spread, determinism, the guards for
// junk input, the bounded wander of mistDrift over a long sweep of times, the
// overflow guard, and the quality gate.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MIST_SEED, MIST_COUNT, MIST_MAX_COUNT,
  MIST_MIN_RADIUS, MIST_MAX_RADIUS,
  MIST_MIN_Y, MIST_MAX_Y,
  MIST_MIN_SIZE, MIST_MAX_SIZE,
  MIST_MIN_OPACITY, MIST_MAX_OPACITY,
  MIST_DRIFT, MIST_BOB,
  MIST_MIN_SPEED, MIST_MAX_SPEED,
  MIST_PHASE_OPACITY,
  mistOpacity, mistSpawns, mistDrift, mistEnabled
} from '../src/mist.js';

test('the authored constants are the ones the world relies on', () => {
  assert.equal(MIST_SEED, 0x2b6d94);
  assert.equal(MIST_COUNT, 14);
  assert.equal(MIST_MAX_COUNT, 80);
  assert.equal(MIST_MIN_RADIUS, 10);
  assert.equal(MIST_MAX_RADIUS, 16);
  assert.equal(MIST_MIN_Y, 0.25);
  assert.equal(MIST_MAX_Y, 0.9);
  assert.equal(MIST_MIN_SIZE, 3.5);
  assert.equal(MIST_MAX_SIZE, 7.5);
  assert.equal(MIST_MIN_OPACITY, 0.05);
  assert.equal(MIST_MAX_OPACITY, 0.14);
  assert.equal(MIST_DRIFT, 1.2);
  assert.equal(MIST_BOB, 0.12);
  assert.equal(MIST_MIN_SPEED, 0.25);
  assert.equal(MIST_MAX_SPEED, 0.6);
});

test('the bands are ordered and stay inside their stated limits', () => {
  assert.ok(MIST_MIN_RADIUS < MIST_MAX_RADIUS);
  assert.ok(MIST_MIN_Y < MIST_MAX_Y);
  assert.ok(MIST_MIN_SIZE < MIST_MAX_SIZE);
  assert.ok(MIST_MIN_OPACITY < MIST_MAX_OPACITY);
  assert.ok(MIST_MIN_SPEED < MIST_MAX_SPEED);
  // Off the paving (r9) and inside the wall's inner face (~16.5).
  assert.ok(MIST_MIN_RADIUS >= 9, 'mist could spawn over the paving');
  assert.ok(MIST_MAX_RADIUS <= 16.5, 'mist could spawn past the wall');
  // Low haze, not floating fog.
  assert.ok(MIST_MIN_Y > 0, 'mist could spawn in the ground');
  assert.ok(MIST_MAX_Y < 2, 'mist sits too high to read as ground haze');
  assert.ok(MIST_COUNT <= MIST_MAX_COUNT);
});

test('the phase opacity table is frozen and has the authored values', () => {
  assert.ok(Object.isFrozen(MIST_PHASE_OPACITY));
  assert.equal(MIST_PHASE_OPACITY.day, 0.35);
  assert.equal(MIST_PHASE_OPACITY.dusk, 1);
  assert.equal(MIST_PHASE_OPACITY.night, 0.6);
});

test('mistOpacity is per phase and falls back to day', () => {
  assert.equal(mistOpacity('day'), 0.35);
  assert.equal(mistOpacity('dusk'), 1);
  assert.equal(mistOpacity('night'), 0.6);
  // Unknown phase, inherited names, and every kind of junk read as the day value.
  assert.equal(mistOpacity('dawn'), 0.35);
  assert.equal(mistOpacity('constructor'), 0.35);
  assert.equal(mistOpacity('__proto__'), 0.35);
  for (const junk of [undefined, null, 42, NaN, {}, [], 'DUSK']) {
    assert.equal(mistOpacity(junk), 0.35);
  }
});

test('mistSpawns returns exactly count items with the exact field names', () => {
  const spawns = mistSpawns();
  assert.equal(spawns.length, MIST_COUNT);
  const expected = ['x', 'y', 'z', 'size', 'opacity', 'phase', 'speed', 'driftX', 'driftZ'];
  for (const s of spawns) {
    assert.deepEqual(Object.keys(s).sort(), expected.slice().sort());
    for (const key of expected) {
      assert.ok(Number.isFinite(s[key]), `${key} is not finite`);
    }
  }
});

test('every sampled field lies inside its declared band', () => {
  for (const s of mistSpawns({ count: 40 })) {
    assert.ok(s.y >= MIST_MIN_Y - 1e-9 && s.y <= MIST_MAX_Y + 1e-9, `y ${s.y} out of band`);
    assert.ok(s.size >= MIST_MIN_SIZE - 1e-9 && s.size <= MIST_MAX_SIZE + 1e-9, `size ${s.size} out of band`);
    assert.ok(s.opacity >= MIST_MIN_OPACITY - 1e-9 && s.opacity <= MIST_MAX_OPACITY + 1e-9, `opacity ${s.opacity} out of band`);
    assert.ok(s.phase >= 0 && s.phase < 1, `phase ${s.phase} left [0,1)`);
    assert.ok(s.speed >= MIST_MIN_SPEED - 1e-9 && s.speed <= MIST_MAX_SPEED + 1e-9, `speed ${s.speed} out of band`);
    assert.ok(s.driftX >= 0 && s.driftX < Math.PI * 2, `driftX ${s.driftX} out of [0,2pi)`);
    assert.ok(s.driftZ >= 0 && s.driftZ < Math.PI * 2, `driftZ ${s.driftZ} out of [0,2pi)`);
  }
});

test('every spawn lies in the ring, off the paving and inside the wall', () => {
  for (const s of mistSpawns({ count: 60 })) {
    const reach = Math.hypot(s.x, s.z);
    assert.ok(reach >= MIST_MIN_RADIUS - 1e-9, `reach ${reach} below min radius`);
    assert.ok(reach <= MIST_MAX_RADIUS + 1e-9, `reach ${reach} above max radius`);
  }
});

test('the patches are spread by area, not piled at the inner edge', () => {
  // The outer radial half of the annulus has more area than the inner half, so an
  // area-uniform radius draw puts the majority of patches there; a linear radius
  // draw would favour the inner edge instead. Sample across many seeds to get a
  // stable majority without one lucky field deciding the outcome.
  const midRadius = (MIST_MIN_RADIUS + MIST_MAX_RADIUS) / 2;
  let outer = 0;
  let total = 0;
  for (let seed = 0; seed < 20; seed += 1) {
    for (const s of mistSpawns({ count: MIST_MAX_COUNT, seed })) {
      total += 1;
      if (Math.hypot(s.x, s.z) >= midRadius) outer += 1;
    }
  }
  assert.ok(outer > total / 2, `outer half held only ${outer}/${total}`);
});

test('the field is spread in angle, not bunched on one bearing', () => {
  const spawns = mistSpawns({ count: 60 });
  // Split the circle into quadrants and check each got a fair share.
  const quadrants = [0, 0, 0, 0];
  for (const s of spawns) {
    const angle = Math.atan2(s.z, s.x) + Math.PI; // [0, 2pi)
    const q = Math.min(3, Math.floor(angle / (Math.PI / 2)));
    quadrants[q] += 1;
  }
  for (const count of quadrants) {
    assert.ok(count > 0, `a quadrant got no patches: ${quadrants.join(',')}`);
  }
});

test('mistSpawns is deterministic for identical arguments', () => {
  assert.deepEqual(mistSpawns(), mistSpawns());
  assert.deepEqual(mistSpawns({ count: 12, seed: 99 }), mistSpawns({ count: 12, seed: 99 }));
});

test('a different seed gives a different field', () => {
  assert.notDeepEqual(mistSpawns({ seed: 1 }), mistSpawns({ seed: 2 }));
});

test('mistSpawns honours an explicit count', () => {
  assert.equal(mistSpawns({ count: 7 }).length, 7);
  assert.equal(mistSpawns({ count: 1 }).length, 1);
  assert.equal(mistSpawns({ count: 0 }).length, 0);
});

test('a junk count falls back to default when non-finite and clamps otherwise', () => {
  for (const junk of [NaN, Infinity, -Infinity, 'x', null, {}, undefined]) {
    const spawns = mistSpawns({ count: junk });
    assert.equal(spawns.length, MIST_COUNT, `junk count ${String(junk)} did not fall back`);
  }
  assert.equal(mistSpawns({ count: 1e9 }).length, MIST_MAX_COUNT);
  assert.equal(mistSpawns({ count: -5 }).length, 0);
  assert.equal(mistSpawns({ count: 3.9 }).length, 3);
});

test('a junk seed falls back to the authored seed', () => {
  assert.deepEqual(mistSpawns({ count: 5, seed: NaN }), mistSpawns({ count: 5, seed: MIST_SEED }));
  assert.deepEqual(mistSpawns({ count: 5, seed: Infinity }), mistSpawns({ count: 5 }));
  assert.deepEqual(mistSpawns({ count: 5, seed: 'x' }), mistSpawns({ count: 5 }));
});

test('swapped radii are exchanged and negative radii clamp to 0', () => {
  const swapped = mistSpawns({ count: 12, minRadius: 15, maxRadius: 4 });
  for (const s of swapped) {
    const reach = Math.hypot(s.x, s.z);
    assert.ok(reach >= 4 - 1e-9 && reach <= 15 + 1e-9, `reach ${reach} outside swapped band`);
  }
  const negative = mistSpawns({ count: 12, minRadius: -4, maxRadius: -1 });
  for (const s of negative) {
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z));
    assert.ok(Math.hypot(s.x, s.z) <= 1e-9, 'negative radii should collapse to the centre');
  }
});

test('a junk options argument falls back to defaults', () => {
  assert.deepEqual(mistSpawns(undefined), mistSpawns());
  assert.deepEqual(mistSpawns(null), mistSpawns());
  for (const junk of [42, 'x', [], true]) {
    assert.deepEqual(mistSpawns(junk), mistSpawns(), `junk options ${String(junk)} did not fall back`);
  }
});

test('extra option keys are ignored', () => {
  // Only count, seed, minRadius and maxRadius are honoured.
  assert.deepEqual(
    mistSpawns({ count: 5, seed: 3, minRadius: 11, maxRadius: 14, size: 999, opacity: 9 }),
    mistSpawns({ count: 5, seed: 3, minRadius: 11, maxRadius: 14 })
  );
});

test('mistDrift returns finite coordinates over a long sweep', () => {
  const spawns = mistSpawns({ count: 6 });
  for (const s of spawns) {
    for (let t = 0; t < 200; t += 0.017) {
      const p = mistDrift(s, t);
      for (const key of ['x', 'y', 'z']) {
        assert.ok(Number.isFinite(p[key]), `${key} not finite at t=${t}`);
      }
    }
  }
});

test('mistDrift never wanders further than the documented bound, for all time', () => {
  const spawns = mistSpawns({ count: 8 });
  for (const s of spawns) {
    for (let t = -300; t < 400; t += 0.011) {
      const p = mistDrift(s, t);
      assert.ok(Math.abs(p.x - s.x) <= MIST_DRIFT + 1e-9, `x wander ${p.x - s.x} exceeds MIST_DRIFT at t=${t}`);
      assert.ok(Math.abs(p.z - s.z) <= MIST_DRIFT + 1e-9, `z wander ${p.z - s.z} exceeds MIST_DRIFT at t=${t}`);
      assert.ok(Math.abs(p.y - s.y) <= MIST_BOB + 1e-9, `y wander ${p.y - s.y} exceeds MIST_BOB at t=${t}`);
    }
  }
});

test('mistDrift does not retrace an obvious circle', () => {
  const s = mistSpawns({ count: 1 })[0];
  let minX = Infinity; let maxX = -Infinity;
  let minZ = Infinity; let maxZ = -Infinity;
  for (let t = 0; t < 120; t += 0.01) {
    const p = mistDrift(s, t);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  assert.ok(maxX - minX > MIST_DRIFT, `x range only ${maxX - minX}`);
  assert.ok(maxZ - minZ > MIST_DRIFT, `z range only ${maxZ - minZ}`);
});

test('mistDrift is deterministic', () => {
  const s = mistSpawns({ count: 1 })[0];
  assert.deepEqual(mistDrift(s, 3.3), mistDrift(s, 3.3));
});

test('mistDrift reads non-finite time as 0', () => {
  const s = mistSpawns({ count: 1 })[0];
  const zero = mistDrift(s, 0);
  for (const junk of [NaN, Infinity, -Infinity, undefined, null, 'x', {}]) {
    assert.deepEqual(mistDrift(s, junk), zero, `time ${String(junk)} did not read as 0`);
  }
});

test('mistDrift keeps the bound at negative times too', () => {
  const s = mistSpawns({ count: 1 })[0];
  for (let t = -0.01; t > -200; t -= 0.07) {
    const p = mistDrift(s, t);
    assert.ok(Math.abs(p.x - s.x) <= MIST_DRIFT + 1e-9, `x out of bound at t=${t}`);
    assert.ok(Math.abs(p.z - s.z) <= MIST_DRIFT + 1e-9, `z out of bound at t=${t}`);
    assert.ok(Math.abs(p.y - s.y) <= MIST_BOB + 1e-9, `y out of bound at t=${t}`);
  }
  // Negative time is on the same path, not snapped to zero.
  assert.notDeepEqual(mistDrift(s, -3.3), mistDrift(s, 0));
});

test('mistDrift returns a finite origin for a junk spawn', () => {
  const origin = { x: 0, y: 0, z: 0 };
  for (const junk of [undefined, null, 42, 'x', [], true]) {
    assert.deepEqual(mistDrift(junk, 1.5), origin);
  }
  // An object with junk fields still yields finite numbers, not NaN.
  for (const junk of [
    {},
    { x: NaN, y: Infinity, z: 'x', speed: NaN, phase: null, driftX: {}, driftZ: [] },
    { x: -3, y: -9, z: -1, speed: -1, phase: NaN, driftX: NaN, driftZ: Infinity }
  ]) {
    const p = mistDrift(junk, 2);
    for (const key of ['x', 'y', 'z']) {
      assert.ok(Number.isFinite(p[key]), `${key} not finite for junk spawn`);
    }
  }
});

test('a junk spawn is still held to the drift bound around the safe origin', () => {
  // The inner wander must stay bounded even when the base fields are junk.
  for (const junk of [{}, { speed: 1e9 }, { speed: Infinity, driftX: Infinity }]) {
    for (let t = 0; t < 50; t += 0.1) {
      const p = mistDrift(junk, t);
      assert.ok(Math.abs(p.x) <= MIST_DRIFT + 1e-9);
      assert.ok(Math.abs(p.z) <= MIST_DRIFT + 1e-9);
      assert.ok(Math.abs(p.y) <= MIST_BOB + 1e-9);
    }
  }
});

test('an absurd time does not overflow into non-finite numbers', () => {
  const s = mistSpawns({ count: 1 })[0];
  for (const t of [Number.MAX_VALUE, 1e300, -1e300]) {
    const p = mistDrift(s, t);
    for (const key of ['x', 'y', 'z']) {
      assert.ok(Number.isFinite(p[key]), `${key} overflowed at t=${t}`);
    }
  }
});

test('a no-NaN sweep across seeds and the whole field stays finite and bounded', () => {
  for (const seed of [0, 1, 2, 7, 99, 0xdeadbeef, 0x2b6d94]) {
    const spawns = mistSpawns({ count: 16, seed });
    for (const s of spawns) {
      for (let t = 0; t < 40; t += 0.09) {
        const p = mistDrift(s, t);
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
        assert.ok(Math.abs(p.x - s.x) <= MIST_DRIFT + 1e-9);
        assert.ok(Math.abs(p.z - s.z) <= MIST_DRIFT + 1e-9);
        assert.ok(Math.abs(p.y - s.y) <= MIST_BOB + 1e-9);
      }
    }
  }
});

test('mistEnabled is false only for the low tier', () => {
  assert.equal(mistEnabled('low'), false);
  assert.equal(mistEnabled('full'), true);
  for (const junk of [undefined, null, 'LOW', 'high', 42, {}, []]) {
    assert.equal(mistEnabled(junk), true);
  }
});
