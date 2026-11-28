// The butterfly module decides where a daytime field of butterflies sits, how it
// wanders and how its wings beat; the world turns those numbers into one
// instanced mesh. These tests hold the module to its contract: the authored
// constants, the frozen tint palette and phase table, the per-phase glow and its
// junk fallback, the spawn count and field bounds, determinism, the guards for
// junk input, the flight's finiteness and bounded displacement, the bounded wing,
// and the quality gate.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BUTTERFLY_SEED, BUTTERFLY_COUNT, BUTTERFLY_MAX_COUNT,
  BUTTERFLY_MIN_RADIUS, BUTTERFLY_MAX_RADIUS,
  BUTTERFLY_MIN_HEIGHT, BUTTERFLY_MAX_HEIGHT,
  BUTTERFLY_MIN_SPEED, BUTTERFLY_MAX_SPEED,
  BUTTERFLY_MIN_SCALE, BUTTERFLY_MAX_SCALE,
  BUTTERFLY_WING_PERIOD, BUTTERFLY_WING_AMPLITUDE,
  BUTTERFLY_WANDER_RADIUS, BUTTERFLY_BOB_AMPLITUDE,
  BUTTERFLY_TINTS, BUTTERFLY_PHASE_GLOW,
  butterflyGlowLevel, butterflySpawns, butterflyFlight, butterfliesEnabled
} from '../src/butterflies.js';

test('the authored constants are the ones the world relies on', () => {
  assert.equal(BUTTERFLY_SEED, 0x7a2f19);
  assert.equal(BUTTERFLY_COUNT, 16);
  assert.equal(BUTTERFLY_MAX_COUNT, 512);
  assert.equal(BUTTERFLY_MIN_RADIUS, 6);
  assert.equal(BUTTERFLY_MAX_RADIUS, 14);
  assert.equal(BUTTERFLY_MIN_HEIGHT, 0.6);
  assert.equal(BUTTERFLY_MAX_HEIGHT, 2.2);
  assert.equal(BUTTERFLY_WING_PERIOD, 0.34);
  assert.equal(BUTTERFLY_WING_AMPLITUDE, 0.95);
  assert.equal(BUTTERFLY_WANDER_RADIUS, 1.5);
  assert.equal(BUTTERFLY_BOB_AMPLITUDE, 0.4);
});

test('the declared bands are ordered and the count is in range', () => {
  assert.ok(BUTTERFLY_MIN_RADIUS < BUTTERFLY_MAX_RADIUS);
  assert.ok(BUTTERFLY_MIN_HEIGHT < BUTTERFLY_MAX_HEIGHT);
  assert.ok(BUTTERFLY_MIN_SPEED < BUTTERFLY_MAX_SPEED);
  assert.ok(BUTTERFLY_MIN_SCALE < BUTTERFLY_MAX_SCALE);
  assert.ok(BUTTERFLY_COUNT >= 12 && BUTTERFLY_COUNT <= 20, `count ${BUTTERFLY_COUNT} out of 12..20`);
  assert.ok(BUTTERFLY_MIN_RADIUS >= 5 && BUTTERFLY_MAX_RADIUS <= 15);
  assert.ok(BUTTERFLY_MIN_HEIGHT >= 0.5 && BUTTERFLY_MAX_HEIGHT <= 2.3);
});

test('the tint palette is frozen, small and warm', () => {
  assert.ok(Object.isFrozen(BUTTERFLY_TINTS));
  assert.ok(BUTTERFLY_TINTS.length >= 2 && BUTTERFLY_TINTS.length <= 4);
  for (const tint of BUTTERFLY_TINTS) {
    assert.equal(typeof tint, 'number');
    assert.ok(Number.isInteger(tint) && tint >= 0 && tint <= 0xffffff);
  }
});

test('the phase glow table is frozen and has the authored values', () => {
  assert.ok(Object.isFrozen(BUTTERFLY_PHASE_GLOW));
  assert.equal(BUTTERFLY_PHASE_GLOW.day, 1);
  assert.equal(BUTTERFLY_PHASE_GLOW.dusk, 0.5);
  assert.equal(BUTTERFLY_PHASE_GLOW.night, 0);
});

test('butterflyGlowLevel is per phase and falls back to day', () => {
  assert.equal(butterflyGlowLevel('day'), 1);
  assert.equal(butterflyGlowLevel('dusk'), 0.5);
  assert.equal(butterflyGlowLevel('night'), 0);
  // Unknown phase, and every kind of junk, reads as the day value (1).
  assert.equal(butterflyGlowLevel('dawn'), 1);
  for (const junk of [undefined, null, 42, NaN, {}, [], 'NIGHT']) {
    assert.equal(butterflyGlowLevel(junk), 1);
  }
});

test('the glow ordering is day > dusk > night', () => {
  const day = butterflyGlowLevel('day');
  const dusk = butterflyGlowLevel('dusk');
  const night = butterflyGlowLevel('night');
  assert.ok(day > dusk && dusk > night, `ordering broken: ${day}/${dusk}/${night}`);
  assert.ok(day <= 1 && night >= 0);
});

test('butterflySpawns returns exactly count items with finite fields', () => {
  const spawns = butterflySpawns();
  assert.equal(spawns.length, BUTTERFLY_COUNT);
  for (const s of spawns) {
    for (const key of ['x', 'z', 'height', 'phase', 'speed', 'scale', 'tintIndex']) {
      assert.ok(Number.isFinite(s[key]), `${key} is not finite`);
    }
    assert.ok(s.phase >= 0 && s.phase < 1, `phase ${s.phase} left [0,1)`);
    assert.ok(Number.isInteger(s.tintIndex));
    assert.ok(s.tintIndex >= 0 && s.tintIndex < BUTTERFLY_TINTS.length, `tintIndex ${s.tintIndex} out of range`);
  }
});

test('butterflySpawns honours an explicit count', () => {
  assert.equal(butterflySpawns({ count: 5 }).length, 5);
  assert.equal(butterflySpawns({ count: 1 }).length, 1);
  assert.equal(butterflySpawns({ count: 0 }).length, 0);
});

test('butterflySpawns is deterministic for identical arguments', () => {
  assert.deepEqual(butterflySpawns(), butterflySpawns());
  assert.deepEqual(butterflySpawns({ count: 10, seed: 99 }), butterflySpawns({ count: 10, seed: 99 }));
});

test('a different seed gives a different field', () => {
  assert.notDeepEqual(butterflySpawns({ seed: 1 }), butterflySpawns({ seed: 2 }));
});

test('the field is spread, not every butterfly on one spot', () => {
  const spawns = butterflySpawns();
  const angles = new Set(spawns.map((s) => Math.round(Math.atan2(s.z, s.x) * 1000)));
  const radii = new Set(spawns.map((s) => Math.round(Math.hypot(s.x, s.z) * 1000)));
  assert.ok(angles.size > 8, `only ${angles.size} distinct angles`);
  assert.ok(radii.size > 8, `only ${radii.size} distinct radii`);
});

test('every spawn lies in the meadow ring and at a sane height', () => {
  for (const s of butterflySpawns()) {
    const reach = Math.hypot(s.x, s.z);
    assert.ok(reach >= BUTTERFLY_MIN_RADIUS - 1e-9, `reach ${reach} below min radius`);
    assert.ok(reach <= BUTTERFLY_MAX_RADIUS + 1e-9, `reach ${reach} above max radius`);
    assert.ok(s.height >= BUTTERFLY_MIN_HEIGHT - 1e-9, `height ${s.height} below band`);
    assert.ok(s.height <= BUTTERFLY_MAX_HEIGHT + 1e-9, `height ${s.height} above band`);
    assert.ok(s.speed >= BUTTERFLY_MIN_SPEED - 1e-9, `speed ${s.speed} below band`);
    assert.ok(s.speed <= BUTTERFLY_MAX_SPEED + 1e-9, `speed ${s.speed} above band`);
    assert.ok(s.scale >= BUTTERFLY_MIN_SCALE - 1e-9, `scale ${s.scale} below band`);
    assert.ok(s.scale <= BUTTERFLY_MAX_SCALE + 1e-9, `scale ${s.scale} above band`);
  }
});

test('the ring is off the plaza and inside the walls', () => {
  const spawns = butterflySpawns();
  const minReach = Math.min(...spawns.map((s) => Math.hypot(s.x, s.z)));
  const maxReach = Math.max(...spawns.map((s) => Math.hypot(s.x, s.z)));
  assert.ok(minReach >= BUTTERFLY_MIN_RADIUS - 1e-9, `closest butterfly ${minReach} is on the plaza`);
  assert.ok(maxReach <= BUTTERFLY_MAX_RADIUS + 1e-9, `farthest butterfly ${maxReach} is past the walls`);
});

test('a junk count clamps into [0, BUTTERFLY_MAX_COUNT] and floors', () => {
  for (const junk of [NaN, Infinity, -Infinity, 'x', null, {}, undefined]) {
    const spawns = butterflySpawns({ count: junk });
    assert.ok(spawns.length >= 0 && spawns.length <= BUTTERFLY_MAX_COUNT, `junk count gave ${spawns.length}`);
    for (const s of spawns) assert.ok(Number.isFinite(s.x));
  }
  assert.equal(butterflySpawns({ count: 1e9 }).length, BUTTERFLY_MAX_COUNT);
  assert.equal(butterflySpawns({ count: -5 }).length, 0);
  assert.equal(butterflySpawns({ count: 3.9 }).length, 3);
});

test('a junk seed falls back to the authored seed', () => {
  assert.deepEqual(butterflySpawns({ count: 5, seed: NaN }), butterflySpawns({ count: 5, seed: BUTTERFLY_SEED }));
  assert.deepEqual(butterflySpawns({ count: 5, seed: Infinity }), butterflySpawns({ count: 5 }));
});

test('junk options fall back to defaults without throwing', () => {
  for (const junk of [undefined, null, 42, 'x', [], true]) {
    const spawns = butterflySpawns(junk);
    assert.equal(spawns.length, BUTTERFLY_COUNT, `junk options ${String(junk)} gave ${spawns.length}`);
    for (const s of spawns) assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z));
  }
  // An object whose options are all junk still yields a valid field.
  const spawns = butterflySpawns({ count: NaN, seed: {}, minRadius: 'a', maxRadius: NaN });
  assert.equal(spawns.length, BUTTERFLY_COUNT);
  for (const s of spawns) assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z));
});

test('swapped radii are handled and negative radii clamp to 0', () => {
  const swapped = butterflySpawns({ count: 8, minRadius: 12, maxRadius: 5 });
  for (const s of swapped) {
    assert.ok(Math.hypot(s.x, s.z) >= 5 - 1e-9 && Math.hypot(s.x, s.z) <= 12 + 1e-9, 'radius outside swapped band');
  }
  const negative = butterflySpawns({ count: 8, minRadius: -4, maxRadius: -1 });
  for (const s of negative) {
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z));
    assert.ok(Math.hypot(s.x, s.z) <= 1e-9, 'negative radii should collapse to the centre');
  }
});

test('butterflyFlight returns four finite numbers over a long sweep', () => {
  const spawns = butterflySpawns({ count: 4 });
  for (const s of spawns) {
    for (let t = 0; t < 120; t += 0.037) {
      const p = butterflyFlight(t, s);
      for (const key of ['x', 'y', 'z', 'wing']) {
        assert.ok(Number.isFinite(p[key]), `${key} not finite at t=${t}`);
      }
    }
  }
});

test('butterflyFlight stays within the wander radius of its spawn', () => {
  for (const s of butterflySpawns()) {
    for (let t = 0; t < 120; t += 0.017) {
      const p = butterflyFlight(t, s);
      const dx = p.x - s.x;
      const dz = p.z - s.z;
      const drift = Math.hypot(dx, dz);
      assert.ok(drift <= BUTTERFLY_WANDER_RADIUS + 1e-9, `drift ${drift} exceeded wander radius at t=${t}`);
    }
  }
});

test('butterflyFlight bobs within BUTTERFLY_BOB_AMPLITUDE of the spawn height', () => {
  for (const s of butterflySpawns()) {
    for (let t = 0; t < 120; t += 0.011) {
      const p = butterflyFlight(t, s);
      assert.ok(Math.abs(p.y - s.height) <= BUTTERFLY_BOB_AMPLITUDE + 1e-9, `bob ${p.y - s.height} too large`);
      assert.ok(p.y > 0, 'butterfly dipped below the ground');
    }
  }
});

test('butterflyFlight wing angle stays within +/- BUTTERFLY_WING_AMPLITUDE', () => {
  for (const s of butterflySpawns()) {
    for (let t = 0; t < 30; t += 0.007) {
      const p = butterflyFlight(t, s);
      assert.ok(Math.abs(p.wing) <= BUTTERFLY_WING_AMPLITUDE + 1e-9, `wing ${p.wing} out of amplitude`);
    }
  }
});

test('butterflyFlight flaps through its full amplitude over a period', () => {
  const s = butterflySpawns({ count: 1 })[0];
  let min = Infinity;
  let max = -Infinity;
  for (let t = 0; t < BUTTERFLY_WING_PERIOD; t += 0.001) {
    const w = butterflyFlight(t, s).wing;
    if (w < min) min = w;
    if (w > max) max = w;
  }
  assert.ok(max > BUTTERFLY_WING_AMPLITUDE * 0.9, `wing peak only ${max}`);
  assert.ok(min < -BUTTERFLY_WING_AMPLITUDE * 0.9, `wing trough only ${min}`);
});

test('the wing actually changes over time', () => {
  const s = butterflySpawns({ count: 1 })[0];
  const a = butterflyFlight(0, s).wing;
  const b = butterflyFlight(BUTTERFLY_WING_PERIOD / 4, s).wing;
  assert.ok(Math.abs(a - b) > 0.1, `wing barely moved: ${a} -> ${b}`);
});

test('butterflyFlight is deterministic for identical arguments', () => {
  const s = butterflySpawns({ count: 1 })[0];
  assert.deepEqual(butterflyFlight(3.3, s), butterflyFlight(3.3, s));
});

test('butterflyFlight reads non-finite time as 0', () => {
  const s = butterflySpawns({ count: 1 })[0];
  const zero = butterflyFlight(0, s);
  for (const junk of [NaN, Infinity, -Infinity, undefined, null, 'x', {}]) {
    assert.deepEqual(butterflyFlight(junk, s), zero, `time ${String(junk)} did not read as 0`);
  }
});

test('butterflyFlight returns a finite origin for a junk spawn', () => {
  const origin = { x: 0, y: 0, z: 0, wing: 0 };
  for (const junk of [undefined, null, 42, 'x', [], true]) {
    assert.deepEqual(butterflyFlight(1.5, junk), origin);
  }
  // An object with junk fields still yields finite numbers, not NaN.
  for (const junk of [
    {},
    { x: NaN, z: Infinity, height: 'x', speed: {}, phase: null },
    { x: -1e9, z: 1e9, height: -9, speed: -1, phase: NaN }
  ]) {
    const p = butterflyFlight(2, junk);
    for (const key of ['x', 'y', 'z', 'wing']) {
      assert.ok(Number.isFinite(p[key]), `${key} not finite for junk spawn`);
    }
  }
});

test('an array-as-spawn junk value returns the origin', () => {
  // Arrays are objects, so they must be rejected explicitly rather than read as
  // a spawn with numeric-looking indices.
  const p = butterflyFlight(1, [1, 2, 3]);
  assert.deepEqual(p, { x: 0, y: 0, z: 0, wing: 0 });
  const q = butterflyFlight(1, [{ x: 5, height: 1 }]);
  assert.deepEqual(q, { x: 0, y: 0, z: 0, wing: 0 });
});

test('an absurd time does not overflow into non-finite numbers', () => {
  const s = butterflySpawns({ count: 1 })[0];
  for (const t of [Number.MAX_VALUE, 1e300, -1e300]) {
    const p = butterflyFlight(t, s);
    for (const key of ['x', 'y', 'z', 'wing']) {
      assert.ok(Number.isFinite(p[key]), `${key} overflowed at t=${t}`);
    }
  }
});

test('butterfliesEnabled is false only for the low tier', () => {
  assert.equal(butterfliesEnabled('low'), false);
  assert.equal(butterfliesEnabled('full'), true);
  for (const junk of [undefined, null, 'LOW', 'high', 42, {}, []]) {
    assert.equal(butterfliesEnabled(junk), true);
  }
});
