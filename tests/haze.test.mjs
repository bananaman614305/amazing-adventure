// The haze module decides where the mid-level atmospheric haze hangs above the
// meadow, how big and how faint each patch is, how that faintness varies by
// phase, and how each patch drifts; the world turns those numbers into one
// InstancedMesh of large soft quads. These tests hold the module to its
// contract: the authored constants and their bands, the frozen phase table and
// its junk fallback, the spawn count and field bounds, area-uniform spread over
// the disc, determinism, the guards for junk input, the bounded wander of
// hazeDrift over a long sweep of times, the overflow guard, and the quality gate.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HAZE_SEED, HAZE_COUNT, HAZE_MAX_COUNT,
  HAZE_MAX_RADIUS,
  HAZE_MIN_Y, HAZE_MAX_Y,
  HAZE_MIN_SIZE, HAZE_MAX_SIZE,
  HAZE_MIN_OPACITY, HAZE_MAX_OPACITY,
  HAZE_DRIFT, HAZE_BOB,
  HAZE_MIN_SPEED, HAZE_MAX_SPEED,
  HAZE_PHASE_OPACITY,
  hazeOpacity, hazeSpawns, hazeDrift, hazeEnabled
} from '../src/haze.js';

test('the authored constants are the ones the world relies on', () => {
  assert.equal(HAZE_SEED, 0x3c8e1f);
  assert.equal(HAZE_COUNT, 18);
  assert.equal(HAZE_MAX_COUNT, 96);
  assert.equal(HAZE_MAX_RADIUS, 18);
  assert.equal(HAZE_MIN_Y, 1.2);
  assert.equal(HAZE_MAX_Y, 4.0);
  assert.equal(HAZE_MIN_SIZE, 6.0);
  assert.equal(HAZE_MAX_SIZE, 14.0);
  assert.equal(HAZE_MIN_OPACITY, 0.02);
  assert.equal(HAZE_MAX_OPACITY, 0.06);
  assert.equal(HAZE_DRIFT, 2.5);
  assert.equal(HAZE_BOB, 0.3);
  assert.equal(HAZE_MIN_SPEED, 0.1);
  assert.equal(HAZE_MAX_SPEED, 0.35);
});

test('the bands are ordered and stay inside their stated limits', () => {
  assert.ok(HAZE_MIN_Y < HAZE_MAX_Y);
  assert.ok(HAZE_MIN_SIZE < HAZE_MAX_SIZE);
  assert.ok(HAZE_MIN_OPACITY < HAZE_MAX_OPACITY);
  assert.ok(HAZE_MIN_SPEED < HAZE_MAX_SPEED);
  // Mid-level haze sits above the ground mist and below cloud level.
  assert.ok(HAZE_MIN_Y >= 1, 'haze could sit in the ground mist');
  assert.ok(HAZE_MAX_Y < 6, 'haze sits too high to read as atmosphere');
  assert.ok(HAZE_COUNT <= HAZE_MAX_COUNT);
  assert.ok(HAZE_MAX_RADIUS > 0);
});

test('the phase opacity table is frozen and has the authored values', () => {
  assert.ok(Object.isFrozen(HAZE_PHASE_OPACITY));
  assert.equal(HAZE_PHASE_OPACITY.day, 0.25);
  assert.equal(HAZE_PHASE_OPACITY.dusk, 0.85);
  assert.equal(HAZE_PHASE_OPACITY.night, 0.5);
});

test('hazeOpacity is per phase and falls back to day', () => {
  assert.equal(hazeOpacity('day'), 0.25);
  assert.equal(hazeOpacity('dusk'), 0.85);
  assert.equal(hazeOpacity('night'), 0.5);
  assert.equal(hazeOpacity('dawn'), 0.25);
  assert.equal(hazeOpacity('constructor'), 0.25);
  assert.equal(hazeOpacity('__proto__'), 0.25);
  for (const junk of [undefined, null, 42, NaN, {}, [], 'DUSK']) {
    assert.equal(hazeOpacity(junk), 0.25);
  }
});

test('hazeSpawns returns exactly count items with the exact field names', () => {
  const spawns = hazeSpawns();
  assert.equal(spawns.length, HAZE_COUNT);
  const expected = ['x', 'y', 'z', 'size', 'opacity', 'phase', 'speed', 'driftX', 'driftZ'];
  for (const s of spawns) {
    assert.deepEqual(Object.keys(s).sort(), expected.slice().sort());
    for (const key of expected) {
      assert.ok(Number.isFinite(s[key]), `${key} is not finite`);
    }
  }
});

test('every sampled field lies inside its declared band', () => {
  for (const s of hazeSpawns({ count: 40 })) {
    assert.ok(s.y >= HAZE_MIN_Y - 1e-9 && s.y <= HAZE_MAX_Y + 1e-9, `y ${s.y} out of band`);
    assert.ok(s.size >= HAZE_MIN_SIZE - 1e-9 && s.size <= HAZE_MAX_SIZE + 1e-9, `size ${s.size} out of band`);
    assert.ok(s.opacity >= HAZE_MIN_OPACITY - 1e-9 && s.opacity <= HAZE_MAX_OPACITY + 1e-9, `opacity ${s.opacity} out of band`);
    assert.ok(s.phase >= 0 && s.phase < 1, `phase ${s.phase} left [0,1)`);
    assert.ok(s.speed >= HAZE_MIN_SPEED - 1e-9 && s.speed <= HAZE_MAX_SPEED + 1e-9, `speed ${s.speed} out of band`);
    assert.ok(s.driftX >= 0 && s.driftX < Math.PI * 2, `driftX ${s.driftX} out of [0,2pi)`);
    assert.ok(s.driftZ >= 0 && s.driftZ < Math.PI * 2, `driftZ ${s.driftZ} out of [0,2pi)`);
  }
});

test('every spawn lies in the disc, within the outer radius', () => {
  for (const s of hazeSpawns({ count: 60 })) {
    const reach = Math.hypot(s.x, s.z);
    assert.ok(reach >= -1e-9, 'reach negative');
    assert.ok(reach <= HAZE_MAX_RADIUS + 1e-9, `reach ${reach} above max radius`);
  }
});

test('the patches are spread by area over the disc, not piled at the centre', () => {
  // Area-uniform radius draw: the outer radial half of the disc holds 3/4 of
  // the area, so it must hold the majority of the patches. A linear radius draw
  // would favour the centre instead.
  const midRadius = HAZE_MAX_RADIUS / 2;
  let outer = 0;
  let total = 0;
  for (let seed = 0; seed < 20; seed += 1) {
    for (const s of hazeSpawns({ count: HAZE_MAX_COUNT, seed })) {
      total += 1;
      if (Math.hypot(s.x, s.z) >= midRadius) outer += 1;
    }
  }
  assert.ok(outer > total / 2, `outer half held only ${outer}/${total}`);
});

test('hazeSpawns is deterministic for identical arguments', () => {
  assert.deepEqual(hazeSpawns(), hazeSpawns());
  assert.deepEqual(hazeSpawns({ count: 12, seed: 99 }), hazeSpawns({ count: 12, seed: 99 }));
  assert.deepEqual(hazeSpawns({ count: 5, seed: 3, maxRadius: 12 }), hazeSpawns({ count: 5, seed: 3, maxRadius: 12 }));
});

test('a different seed gives a different field', () => {
  assert.notDeepEqual(hazeSpawns({ seed: 1 }), hazeSpawns({ seed: 2 }));
});

test('hazeSpawns honours an explicit count', () => {
  assert.equal(hazeSpawns({ count: 7 }).length, 7);
  assert.equal(hazeSpawns({ count: 1 }).length, 1);
  assert.equal(hazeSpawns({ count: 0 }).length, 0);
});

test('a junk count falls back to default when non-finite and clamps otherwise', () => {
  for (const junk of [NaN, Infinity, -Infinity, 'x', null, {}, undefined]) {
    const spawns = hazeSpawns({ count: junk });
    assert.equal(spawns.length, HAZE_COUNT, `junk count ${String(junk)} did not fall back`);
  }
  assert.equal(hazeSpawns({ count: 1e9 }).length, HAZE_MAX_COUNT);
  assert.equal(hazeSpawns({ count: -5 }).length, 0);
  assert.equal(hazeSpawns({ count: 3.9 }).length, 3);
});

test('a junk seed falls back to the authored seed', () => {
  assert.deepEqual(hazeSpawns({ count: 5, seed: NaN }), hazeSpawns({ count: 5, seed: HAZE_SEED }));
  assert.deepEqual(hazeSpawns({ count: 5, seed: Infinity }), hazeSpawns({ count: 5 }));
  assert.deepEqual(hazeSpawns({ count: 5, seed: 'x' }), hazeSpawns({ count: 5 }));
});

test('maxRadius clamps and falls back, no swap', () => {
  // non-finite -> fallback
  assert.deepEqual(hazeSpawns({ count: 5, seed: 7, maxRadius: NaN }), hazeSpawns({ count: 5, seed: 7 }));
  assert.deepEqual(hazeSpawns({ count: 5, seed: 7, maxRadius: Infinity }), hazeSpawns({ count: 5, seed: 7 }));
  // negative clamps to 0 -> all at centre
  const neg = hazeSpawns({ count: 8, seed: 1, maxRadius: -3 });
  for (const s of neg) {
    assert.ok(Math.hypot(s.x, s.z) <= 1e-9, 'negative maxRadius should collapse to centre');
  }
  // huge clamps to the sane radius cap, so reach stays finite and bounded
  const huge = hazeSpawns({ count: 3, seed: 1, maxRadius: 1e9 });
  for (const s of huge) {
    assert.ok(Number.isFinite(Math.hypot(s.x, s.z)));
    assert.ok(Math.hypot(s.x, s.z) <= 1e6 + 1e-9);
  }
  // sanity: clamped radius bounds reach
  const big = hazeSpawns({ count: 12, seed: 2, maxRadius: 5 });
  for (const s of big) {
    assert.ok(Math.hypot(s.x, s.z) <= 5 + 1e-9, `reach ${Math.hypot(s.x, s.z)} exceeds 5`);
  }
});

test('a junk options argument falls back to defaults', () => {
  assert.deepEqual(hazeSpawns(undefined), hazeSpawns());
  assert.deepEqual(hazeSpawns(null), hazeSpawns());
  for (const junk of [42, 'x', [], true]) {
    assert.deepEqual(hazeSpawns(junk), hazeSpawns(), `junk options ${String(junk)} did not fall back`);
  }
});

test('extra option keys are ignored', () => {
  assert.deepEqual(
    hazeSpawns({ count: 5, seed: 3, maxRadius: 12, size: 999, opacity: 9 }),
    hazeSpawns({ count: 5, seed: 3, maxRadius: 12 })
  );
});

test('hazeDrift returns finite coordinates over a long sweep', () => {
  const spawns = hazeSpawns({ count: 6 });
  for (const s of spawns) {
    for (let t = 0; t < 200; t += 0.017) {
      const p = hazeDrift(s, t);
      for (const key of ['x', 'y', 'z']) {
        assert.ok(Number.isFinite(p[key]), `${key} not finite at t=${t}`);
      }
    }
  }
});

test('hazeDrift never wanders further than the documented bound, for all time', () => {
  const spawns = hazeSpawns({ count: 8 });
  for (const s of spawns) {
    for (let t = -300; t < 400; t += 0.011) {
      const p = hazeDrift(s, t);
      assert.ok(Math.abs(p.x - s.x) <= HAZE_DRIFT + 1e-9, `x wander ${p.x - s.x} exceeds HAZE_DRIFT at t=${t}`);
      assert.ok(Math.abs(p.z - s.z) <= HAZE_DRIFT + 1e-9, `z wander ${p.z - s.z} exceeds HAZE_DRIFT at t=${t}`);
      assert.ok(Math.abs(p.y - s.y) <= HAZE_BOB + 1e-9, `y wander ${p.y - s.y} exceeds HAZE_BOB at t=${t}`);
    }
  }
});

test('hazeDrift is deterministic', () => {
  const s = hazeSpawns({ count: 1 })[0];
  assert.deepEqual(hazeDrift(s, 3.3), hazeDrift(s, 3.3));
});

test('hazeDrift reads non-finite time as 0', () => {
  const s = hazeSpawns({ count: 1 })[0];
  const zero = hazeDrift(s, 0);
  for (const junk of [NaN, Infinity, -Infinity, undefined, null, 'x', {}]) {
    assert.deepEqual(hazeDrift(s, junk), zero, `time ${String(junk)} did not read as 0`);
  }
});

test('hazeDrift returns a finite origin for a junk spawn', () => {
  const origin = { x: 0, y: 0, z: 0 };
  for (const junk of [undefined, null, 42, 'x', [], true]) {
    assert.deepEqual(hazeDrift(junk, 1.5), origin);
  }
  for (const junk of [
    {},
    { x: NaN, y: Infinity, z: 'x', speed: NaN, phase: null, driftX: {}, driftZ: [] },
    { x: -3, y: -9, z: -1, speed: -1, phase: NaN, driftX: NaN, driftZ: Infinity }
  ]) {
    const p = hazeDrift(junk, 2);
    for (const key of ['x', 'y', 'z']) {
      assert.ok(Number.isFinite(p[key]), `${key} not finite for junk spawn`);
    }
  }
});

test('a junk spawn is still held to the drift bound around the safe origin', () => {
  for (const junk of [{}, { speed: 1e9 }, { speed: Infinity, driftX: Infinity }]) {
    for (let t = 0; t < 50; t += 0.1) {
      const p = hazeDrift(junk, t);
      assert.ok(Math.abs(p.x) <= HAZE_DRIFT + 1e-9);
      assert.ok(Math.abs(p.z) <= HAZE_DRIFT + 1e-9);
      assert.ok(Math.abs(p.y) <= HAZE_BOB + 1e-9);
    }
  }
});

test('an absurd time does not overflow into non-finite numbers', () => {
  const s = hazeSpawns({ count: 1 })[0];
  for (const t of [Number.MAX_VALUE, 1e300, -1e300]) {
    const p = hazeDrift(s, t);
    for (const key of ['x', 'y', 'z']) {
      assert.ok(Number.isFinite(p[key]), `${key} overflowed at t=${t}`);
    }
  }
});

test('hazeEnabled is false only for the low tier', () => {
  assert.equal(hazeEnabled('low'), false);
  assert.equal(hazeEnabled('full'), true);
  for (const junk of [undefined, null, 'LOW', 'high', 42, {}, []]) {
    assert.equal(hazeEnabled(junk), true);
  }
});