// The moth module decides which lantern each night moth circles, how tight its
// orbit is, how it flutters and how its wings beat; the world turns those numbers
// into one instanced mesh of pale quads. These tests hold the module to its
// contract: the authored constants and frozen site list, the phase table and its
// junk fallback, the spawn count and every field's band, determinism, the guards
// for junk input, the bounded orbit and flutter of mothFlight, the flap range and
// its variation over time, and the quality gate.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MOTH_SEED, MOTH_COUNT, MOTH_MAX_COUNT, MOTH_SITES,
  MOTH_MIN_ORBIT, MOTH_MAX_ORBIT,
  MOTH_MIN_HEIGHT, MOTH_MAX_HEIGHT,
  MOTH_MIN_SIZE, MOTH_MAX_SIZE,
  MOTH_MIN_SPEED, MOTH_MAX_SPEED,
  MOTH_FLUTTER_PERIOD, MOTH_FLUTTER_AMPLITUDE,
  MOTH_PHASE_GLOW,
  mothGlowLevel, mothSpawns, mothFlight, mothsEnabled
} from '../src/moths.js';

test('the authored constants are the ones the world relies on', () => {
  assert.equal(MOTH_SEED, 0x5e2a47);
  assert.equal(MOTH_COUNT, 30);
  assert.equal(MOTH_MAX_COUNT, 200);
  assert.equal(MOTH_MIN_ORBIT, 0.18);
  assert.equal(MOTH_MAX_ORBIT, 0.55);
  assert.equal(MOTH_MIN_HEIGHT, -0.25);
  assert.equal(MOTH_MAX_HEIGHT, 0.35);
  assert.equal(MOTH_MIN_SIZE, 0.7);
  assert.equal(MOTH_MAX_SIZE, 1.3);
  assert.equal(MOTH_FLUTTER_PERIOD, 0.16);
  assert.equal(MOTH_FLUTTER_AMPLITUDE, 0.03);
});

test('the declared bands are ordered and the count is a sane density', () => {
  assert.ok(MOTH_MIN_ORBIT < MOTH_MAX_ORBIT);
  assert.ok(MOTH_MIN_HEIGHT < MOTH_MAX_HEIGHT);
  assert.ok(MOTH_MIN_SIZE < MOTH_MAX_SIZE);
  assert.ok(MOTH_MIN_SPEED < MOTH_MAX_SPEED);
  assert.ok(MOTH_MIN_ORBIT > 0 && MOTH_MAX_ORBIT < 1, 'orbit must be tight around a head');
  assert.ok(MOTH_COUNT >= 24 && MOTH_COUNT <= 40, `count ${MOTH_COUNT} out of 24..40`);
  assert.ok(MOTH_MAX_COUNT >= MOTH_COUNT);
});

test('the site list is frozen, plausible and inside the world', () => {
  assert.ok(Object.isFrozen(MOTH_SITES));
  assert.equal(MOTH_SITES.length, 5);
  for (const site of MOTH_SITES) {
    assert.ok(Object.isFrozen(site), 'a site object is not frozen');
    for (const key of ['x', 'y', 'z']) {
      assert.ok(Number.isFinite(site[key]), `site ${key} is not finite`);
    }
    // Plaza lanterns sit inside the 17 m half-extent; the lane lamp hangs over
    // the market lane, which extends north to about z = -25, so allow 30.
    assert.ok(Math.abs(site.x) <= 30 && Math.abs(site.z) <= 30, 'site is outside the world');
    assert.ok(site.y > 0 && site.y < 6, 'site height is implausible');
  }
});

test('the site list cannot be mutated', () => {
  // The module is strict ESM, so a write to a frozen object throws rather than
  // silently doing nothing.
  assert.throws(() => { MOTH_SITES[0].x = 99; });
  assert.throws(() => { MOTH_SITES.push({ x: 0, z: 0, y: 0 }); });
  assert.equal(MOTH_SITES[0].x, 7);
});

test('the phase glow table is frozen and has the authored values', () => {
  assert.ok(Object.isFrozen(MOTH_PHASE_GLOW));
  assert.equal(MOTH_PHASE_GLOW.day, 0);
  assert.equal(MOTH_PHASE_GLOW.dusk, 0.45);
  assert.equal(MOTH_PHASE_GLOW.night, 1);
});

test('mothGlowLevel is per phase and falls back to day', () => {
  assert.equal(mothGlowLevel('day'), 0);
  assert.equal(mothGlowLevel('dusk'), 0.45);
  assert.equal(mothGlowLevel('night'), 1);
  // Unknown phase, and every kind of junk, reads as the day value (0).
  assert.equal(mothGlowLevel('dawn'), 0);
  for (const junk of [undefined, null, 42, NaN, {}, [], 'NIGHT']) {
    assert.equal(mothGlowLevel(junk), 0);
  }
});

test('the glow ordering is night > dusk > day', () => {
  const day = mothGlowLevel('day');
  const dusk = mothGlowLevel('dusk');
  const night = mothGlowLevel('night');
  assert.ok(night > dusk && dusk > day, `ordering broken: ${night}/${dusk}/${day}`);
  assert.ok(night <= 1 && day >= 0);
});

test('mothSpawns returns exactly count items with finite fields', () => {
  const spawns = mothSpawns();
  assert.equal(spawns.length, MOTH_COUNT);
  for (const s of spawns) {
    for (const key of ['site', 'angle', 'orbit', 'height', 'size', 'speed', 'flutter']) {
      assert.ok(Number.isFinite(s[key]), `${key} is not finite`);
    }
  }
});

test('every spawn field lies inside its documented band', () => {
  for (const s of mothSpawns()) {
    assert.ok(Number.isInteger(s.site) && s.site >= 0 && s.site < MOTH_SITES.length, `site ${s.site} invalid`);
    assert.ok(s.angle >= 0 && s.angle < Math.PI * 2, `angle ${s.angle} out of [0, 2pi)`);
    assert.ok(s.orbit >= MOTH_MIN_ORBIT - 1e-9 && s.orbit <= MOTH_MAX_ORBIT + 1e-9, `orbit ${s.orbit} out of band`);
    assert.ok(s.height >= MOTH_MIN_HEIGHT - 1e-9 && s.height <= MOTH_MAX_HEIGHT + 1e-9, `height ${s.height} out of band`);
    assert.ok(s.size >= MOTH_MIN_SIZE - 1e-9 && s.size <= MOTH_MAX_SIZE + 1e-9, `size ${s.size} out of band`);
    assert.ok(s.speed >= MOTH_MIN_SPEED - 1e-9 && s.speed <= MOTH_MAX_SPEED + 1e-9, `speed ${s.speed} out of band`);
    assert.ok(s.flutter >= 0 && s.flutter < 1, `flutter ${s.flutter} out of [0,1)`);
  }
});

test('every lantern gets an even share of the field', () => {
  // Round-robin assignment: with 30 moths over 5 sites each site is used 6 times.
  const counts = new Array(MOTH_SITES.length).fill(0);
  for (const s of mothSpawns()) counts[s.site] += 1;
  for (let i = 0; i < counts.length; i += 1) {
    assert.equal(counts[i], MOTH_COUNT / MOTH_SITES.length, `site ${i} got ${counts[i]} moths`);
  }
});

test('mothSpawns honours an explicit count', () => {
  assert.equal(mothSpawns({ count: 7 }).length, 7);
  assert.equal(mothSpawns({ count: 1 }).length, 1);
  assert.deepEqual(mothSpawns({ count: 0 }), []);
});

test('mothSpawns is deterministic for identical arguments', () => {
  assert.deepEqual(mothSpawns(), mothSpawns());
  assert.deepEqual(mothSpawns({ count: 12, seed: 99 }), mothSpawns({ count: 12, seed: 99 }));
});

test('a different seed gives a different field', () => {
  assert.notDeepEqual(mothSpawns({ seed: 1 }), mothSpawns({ seed: 2 }));
});

test('a junk count falls back to MOTH_COUNT, and a finite count clamps and floors', () => {
  // Non-finite counts are junk: they fall back to the authored count.
  for (const junk of [NaN, Infinity, -Infinity, 'x', null, {}, undefined]) {
    const spawns = mothSpawns({ count: junk });
    assert.equal(spawns.length, MOTH_COUNT, `junk count ${String(junk)} gave ${spawns.length}`);
    for (const s of spawns) assert.ok(Number.isFinite(s.orbit));
  }
  // Finite but absurd counts clamp into [0, MOTH_MAX_COUNT]; fractions floor.
  assert.equal(mothSpawns({ count: 1e9 }).length, MOTH_MAX_COUNT);
  assert.equal(mothSpawns({ count: -5 }).length, 0);
  assert.equal(mothSpawns({ count: 3.9 }).length, 3);
});

test('a junk seed falls back to the authored seed', () => {
  assert.deepEqual(mothSpawns({ count: 5, seed: NaN }), mothSpawns({ count: 5, seed: MOTH_SEED }));
  assert.deepEqual(mothSpawns({ count: 5, seed: Infinity }), mothSpawns({ count: 5 }));
});

test('mothSpawns tolerates a junk options argument', () => {
  assert.deepEqual(mothSpawns(undefined), mothSpawns());
  assert.deepEqual(mothSpawns(null), mothSpawns());
  for (const junk of [42, 'x', [], true]) {
    const spawns = mothSpawns(junk);
    assert.equal(spawns.length, MOTH_COUNT, `junk options ${String(junk)} gave ${spawns.length}`);
    for (const s of spawns) assert.ok(Number.isFinite(s.orbit));
  }
});

test('mothFlight returns finite numbers over a long sweep', () => {
  for (const s of mothSpawns()) {
    for (let t = 0; t < 200; t += 0.037) {
      const p = mothFlight(s, t);
      for (const key of ['x', 'y', 'z', 'flap']) {
        assert.ok(Number.isFinite(p[key]), `${key} not finite at t=${t}`);
      }
    }
  }
});

test('mothFlight stays inside the orbit and flutter envelope of its site', () => {
  for (const s of mothSpawns()) {
    const site = MOTH_SITES[s.site];
    for (let t = 0; t < 200; t += 0.017) {
      const p = mothFlight(s, t);
      const reach = Math.hypot(p.x - site.x, p.z - site.z);
      assert.ok(reach <= s.orbit + 1e-9, `reach ${reach} exceeded orbit ${s.orbit}`);
      const lowY = site.y + s.height - MOTH_FLUTTER_AMPLITUDE;
      const highY = site.y + s.height + MOTH_FLUTTER_AMPLITUDE;
      assert.ok(p.y >= lowY - 1e-9 && p.y <= highY + 1e-9, `y ${p.y} outside flutter band`);
    }
  }
});

test('mothFlight actually orbits its lantern over time', () => {
  const s = mothSpawns({ count: 1 })[0];
  const site = MOTH_SITES[s.site];
  const a = mothFlight(s, 0);
  const b = mothFlight(s, Math.PI / (2 * s.speed));
  assert.ok(Math.abs(a.x - b.x) > 1e-3 || Math.abs(a.z - b.z) > 1e-3, 'moth did not move along its orbit');
  // And it stays on the circle, not drifting in or out.
  const ra = Math.hypot(a.x - site.x, a.z - site.z);
  const rb = Math.hypot(b.x - site.x, b.z - site.z);
  assert.ok(Math.abs(ra - rb) < 1e-9, 'orbit radius changed with time');
});

test('flap stays in [0, 1] and varies with time', () => {
  const s = mothSpawns({ count: 1 })[0];
  let min = Infinity;
  let max = -Infinity;
  for (let t = 0; t < MOTH_FLUTTER_PERIOD; t += 0.0005) {
    const f = mothFlight(s, t).flap;
    assert.ok(f >= 0 && f <= 1, `flap ${f} left [0,1]`);
    if (f < min) min = f;
    if (f > max) max = f;
  }
  assert.ok(max - min > 0.9, `flap barely varied: ${min}..${max}`);
});

test('flap is periodic in MOTH_FLUTTER_PERIOD', () => {
  const s = mothSpawns({ count: 1 })[0];
  for (const t of [0, 0.03, 0.5, 3.3]) {
    const a = mothFlight(s, t).flap;
    const b = mothFlight(s, t + MOTH_FLUTTER_PERIOD).flap;
    assert.ok(Math.abs(a - b) < 1e-9, `flap not periodic at t=${t}`);
  }
});

test('mothFlight is deterministic for identical arguments', () => {
  const s = mothSpawns({ count: 1 })[0];
  assert.deepEqual(mothFlight(s, 3.3), mothFlight(s, 3.3));
});

test('mothFlight reads non-finite time as 0', () => {
  const s = mothSpawns({ count: 1 })[0];
  const zero = mothFlight(s, 0);
  for (const junk of [NaN, Infinity, -Infinity, undefined, null, 'x', {}]) {
    assert.deepEqual(mothFlight(s, junk), zero, `time ${String(junk)} did not read as 0`);
  }
});

test('mothFlight returns a finite zero-ish result for a junk spawn', () => {
  const origin = { x: 0, y: 0, z: 0, flap: 0 };
  for (const junk of [undefined, null, 42, 'x', [], true, [1, 2, 3]]) {
    assert.deepEqual(mothFlight(junk, 1.5), origin);
  }
  // An object with junk fields still yields finite numbers, not NaN.
  for (const junk of [
    {},
    { site: NaN, angle: Infinity, orbit: 'x', height: {}, size: [], speed: null, flutter: NaN },
    { site: -9, angle: NaN, orbit: -1, height: 1e9, size: NaN, speed: -1, flutter: Infinity }
  ]) {
    const p = mothFlight(junk, 2);
    for (const key of ['x', 'y', 'z', 'flap']) {
      assert.ok(Number.isFinite(p[key]), `${key} not finite for junk spawn`);
    }
  }
});

test('an absurd time does not overflow into non-finite numbers', () => {
  const s = mothSpawns({ count: 1 })[0];
  for (const t of [Number.MAX_VALUE, 1e300, -1e300]) {
    const p = mothFlight(s, t);
    for (const key of ['x', 'y', 'z', 'flap']) {
      assert.ok(Number.isFinite(p[key]), `${key} overflowed at t=${t}`);
    }
  }
});

test('a no-NaN sweep across the whole default field stays finite', () => {
  for (const s of mothSpawns()) {
    for (let t = 0; t < 60; t += 0.05) {
      const p = mothFlight(s, t);
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) && Number.isFinite(p.flap));
    }
  }
});

test('mothsEnabled is false only for the low tier', () => {
  assert.equal(mothsEnabled('low'), false);
  assert.equal(mothsEnabled('full'), true);
  for (const junk of [undefined, null, 'LOW', 'high', 42, {}, []]) {
    assert.equal(mothsEnabled(junk), true);
  }
});
