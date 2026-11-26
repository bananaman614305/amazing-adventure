// The ripple module decides where the fountain's ripple centres sit, how each
// ring expands and fades over its life, how strongly water reads by phase and
// which quality tier shows the rings; the world turns those numbers into one
// InstancedMesh of flat rings. These tests hold the module to its contract: the
// authored constants, the frozen phase table and its junk fallback, the spawn
// count and basin bounds, determinism, the guards on every entry point, the
// per-ring bounds, the growth and fade over one life, the slot stagger, the
// exact-zero end of life and the tier gate.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RIPPLE_SEED, RIPPLE_COUNT, RIPPLE_MAX_COUNT,
  RIPPLE_BASIN_RADIUS, RIPPLE_MAX_RADIUS, RIPPLE_SITE_RADIUS,
  RIPPLE_MIN_SIZE, RIPPLE_MAX_SIZE, RIPPLE_LIFE, RIPPLE_MAX_OPACITY,
  RIPPLE_PHASE_GLOW, RIPPLE_RINGS_PER_SITE, RIPPLE_WATER_Y,
  RIPPLE_FADE_TAIL, RIPPLE_THIN, RIPPLE_SPEED_MIN, RIPPLE_SPEED_MAX,
  RIPPLE_MIN_BAND, RIPPLE_BAND_BIRTH,
  rippleGlowLevel, rippleSpawns, rippleRing, ripplesEnabled
} from '../src/ripples.js';

// A crafted centre with no seeded jitter, so the ring maths can be stated
// plainly: phase 0 means a ring is born exactly at t = 0 for slot 0.
const craft = (over = {}) => ({ x: 0, z: 0, phase: 0, speed: 1, size: 0.8, ...over });

test('the authored constants are the ones the world relies on', () => {
  assert.equal(RIPPLE_SEED, 0x6e0f35);
  assert.equal(RIPPLE_COUNT, 10);
  assert.equal(RIPPLE_MAX_COUNT, 48);
  assert.equal(RIPPLE_BASIN_RADIUS, 1.6);
  assert.equal(RIPPLE_MAX_RADIUS, 1.4);
  assert.equal(RIPPLE_LIFE, 2.6);
  assert.equal(RIPPLE_MAX_OPACITY, 0.5);
  assert.equal(RIPPLE_RINGS_PER_SITE, 3);
  assert.ok(RIPPLE_MIN_SIZE < RIPPLE_MAX_SIZE);
  assert.ok(RIPPLE_SPEED_MIN < RIPPLE_SPEED_MAX);
  // The biggest ring must still fit on the water when born at the cluster edge.
  assert.ok(RIPPLE_MAX_RADIUS < RIPPLE_BASIN_RADIUS);
  assert.ok(RIPPLE_SITE_RADIUS + RIPPLE_MAX_RADIUS <= RIPPLE_BASIN_RADIUS + 1e-9);
  // A count above the default but within the cap is allowed; the cap is real.
  assert.ok(RIPPLE_MAX_COUNT >= RIPPLE_COUNT);
  assert.equal(RIPPLE_MIN_BAND, 0.018);
  assert.equal(RIPPLE_BAND_BIRTH, 0.05);
});

test('the phase glow table is frozen with dusk strongest and night weakest', () => {
  assert.ok(Object.isFrozen(RIPPLE_PHASE_GLOW));
  assert.equal(RIPPLE_PHASE_GLOW.dusk, 1);
  assert.equal(RIPPLE_PHASE_GLOW.day, 0.9);
  assert.equal(RIPPLE_PHASE_GLOW.night, 0.7);
  assert.ok(RIPPLE_PHASE_GLOW.dusk > RIPPLE_PHASE_GLOW.day);
  assert.ok(RIPPLE_PHASE_GLOW.day > RIPPLE_PHASE_GLOW.night);
});

test('rippleGlowLevel is per phase and falls back to day', () => {
  assert.equal(rippleGlowLevel('day'), 0.9);
  assert.equal(rippleGlowLevel('dusk'), 1);
  assert.equal(rippleGlowLevel('night'), 0.7);
  // Unknown phase, and every kind of junk, reads as the day value.
  assert.equal(rippleGlowLevel('dawn'), 0.9);
  for (const junk of [undefined, null, 42, NaN, {}, [], 'DUSK']) {
    assert.equal(rippleGlowLevel(junk), 0.9);
  }
});

test('rippleSpawns returns exactly count items with finite fields', () => {
  const spawns = rippleSpawns();
  assert.equal(spawns.length, RIPPLE_COUNT);
  for (const s of spawns) {
    for (const key of ['x', 'z', 'phase', 'speed', 'size']) {
      assert.ok(Number.isFinite(s[key]), `${key} is not finite`);
    }
    assert.ok(s.phase >= 0 && s.phase < 1, `phase ${s.phase} left [0,1)`);
    assert.ok(s.speed >= RIPPLE_SPEED_MIN - 1e-9 && s.speed <= RIPPLE_SPEED_MAX + 1e-9, `speed ${s.speed} out of band`);
    assert.ok(s.size >= RIPPLE_MIN_SIZE - 1e-9 && s.size <= RIPPLE_MAX_SIZE + 1e-9, `size ${s.size} out of band`);
  }
});

test('rippleSpawns honours an explicit count', () => {
  assert.equal(rippleSpawns({ count: 7 }).length, 7);
  assert.equal(rippleSpawns({ count: 1 }).length, 1);
  assert.deepEqual(rippleSpawns({ count: 0 }), []);
});

test('rippleSpawns is deterministic for identical arguments', () => {
  assert.deepEqual(rippleSpawns(), rippleSpawns());
  assert.deepEqual(rippleSpawns({ count: 6, seed: 99 }), rippleSpawns({ count: 6, seed: 99 }));
});

test('a different seed gives a different field', () => {
  assert.notDeepEqual(rippleSpawns({ seed: 1 }), rippleSpawns({ seed: 2 }));
});

test('every centre sits inside the basin and every ring fits on the water', () => {
  for (const s of rippleSpawns()) {
    const reach = Math.hypot(s.x, s.z);
    assert.ok(reach <= RIPPLE_SITE_RADIUS + 1e-9, `centre ${reach} outside the site cluster`);
    // Even a full-size ring born here must still be on the water.
    assert.ok(reach + RIPPLE_MAX_RADIUS <= RIPPLE_BASIN_RADIUS + 1e-9, `ring would leave the basin`);
  }
});

test('the centres are spread around the cluster, not stacked on one spot', () => {
  const spawns = rippleSpawns({ count: 8 });
  const angles = new Set(spawns.map((s) => Math.round(Math.atan2(s.z, s.x) * 1000)));
  const radii = new Set(spawns.map((s) => Math.round(Math.hypot(s.x, s.z) * 1000)));
  assert.ok(angles.size > 3, `only ${angles.size} distinct angles`);
  assert.ok(radii.size > 3, `only ${radii.size} distinct radii`);
});

test('a junk count clamps into [0, RIPPLE_MAX_COUNT] and floors', () => {
  for (const junk of [NaN, Infinity, -Infinity, 'x', null, {}, undefined]) {
    const spawns = rippleSpawns({ count: junk });
    assert.ok(spawns.length >= 0 && spawns.length <= RIPPLE_MAX_COUNT, `junk count gave ${spawns.length}`);
    for (const s of spawns) assert.ok(Number.isFinite(s.x));
  }
  assert.equal(rippleSpawns({ count: 1e9 }).length, RIPPLE_MAX_COUNT);
  assert.equal(rippleSpawns({ count: -5 }).length, 0);
  assert.equal(rippleSpawns({ count: 3.9 }).length, 3);
});

test('a junk seed falls back to the authored seed', () => {
  assert.deepEqual(rippleSpawns({ count: 4, seed: NaN }), rippleSpawns({ count: 4, seed: RIPPLE_SEED }));
  assert.deepEqual(rippleSpawns({ count: 4, seed: Infinity }), rippleSpawns({ count: 4 }));
});

test('a junk options argument falls back to the defaults', () => {
  for (const junk of [undefined, null, 42, 'x', NaN, [], true]) {
    const spawns = rippleSpawns(junk);
    assert.equal(spawns.length, RIPPLE_COUNT);
    for (const s of spawns) assert.ok(Number.isFinite(s.x) && Number.isFinite(s.size));
  }
});

test('rippleRing returns finite, bounded values across a long sweep', () => {
  const spawns = rippleSpawns();
  const scaleFloor = RIPPLE_MIN_SIZE * (1 - RIPPLE_THIN);
  for (const s of spawns) {
    for (let i = 0; i < RIPPLE_RINGS_PER_SITE; i += 1) {
      for (let t = 0; t < 60; t += 0.29) {
        const r = rippleRing(s, i, t);
        for (const key of ['x', 'y', 'z', 'radius', 'opacity', 'scale', 'band', 'alpha']) {
          assert.ok(Number.isFinite(r[key]), `${key} not finite at i=${i}, t=${t}`);
        }
        assert.ok(r.radius >= 0 && r.radius <= RIPPLE_MAX_RADIUS + 1e-9, `radius ${r.radius} out of band`);
        assert.ok(r.opacity >= 0 && r.opacity <= RIPPLE_MAX_OPACITY + 1e-9, `opacity ${r.opacity} out of band`);
        assert.ok(r.scale >= scaleFloor - 1e-9 && r.scale <= RIPPLE_MAX_SIZE + 1e-9, `scale ${r.scale} out of band`);
      }
    }
  }
});

test('a ring is born at radius 0 and reaches near the rim by the end of its life', () => {
  const s = craft();
  assert.equal(rippleRing(s, 0, 0).radius, 0);
  const nearEnd = rippleRing(s, 0, RIPPLE_LIFE * 0.99).radius;
  assert.ok(nearEnd > RIPPLE_MAX_RADIUS * 0.98, `ring only reached ${nearEnd}`);
  assert.ok(nearEnd <= RIPPLE_MAX_RADIUS + 1e-9);
});

test('radius grows monotonically within one life', () => {
  const s = craft();
  let previous = -Infinity;
  for (let t = 0; t < RIPPLE_LIFE * 0.98; t += 0.02) {
    const radius = rippleRing(s, 0, t).radius;
    assert.ok(radius >= previous, `radius ${radius} shrank at t=${t}`);
    previous = radius;
  }
});

test('opacity starts at the maximum and reaches exactly 0 at the end of the life', () => {
  const s = craft();
  assert.equal(rippleRing(s, 0, 0).opacity, RIPPLE_MAX_OPACITY);
  // The fade tail guarantees an exact zero before the wrap, not a small alpha.
  // (At exactly RIPPLE_LIFE the ring has wrapped and been reborn, so the probes
  // stop just short of the wrap.)
  for (const t of [RIPPLE_LIFE * 0.99, RIPPLE_LIFE * 0.999, RIPPLE_LIFE * (1 - 1e-9)]) {
    assert.equal(rippleRing(s, 0, t).opacity, 0, `opacity not exactly 0 at t=${t}`);
  }
});

test('opacity falls monotonically within one life', () => {
  const s = craft();
  let previous = Infinity;
  for (let t = 0; t < RIPPLE_LIFE * 0.98; t += 0.02) {
    const opacity = rippleRing(s, 0, t).opacity;
    assert.ok(opacity <= previous + 1e-12, `opacity ${opacity} rose at t=${t}`);
    previous = opacity;
  }
});

test('a ring thins as it widens but stays positive', () => {
  const s = craft();
  const scaleFloor = RIPPLE_MIN_SIZE * (1 - RIPPLE_THIN);
  let previous = Infinity;
  for (let t = 0; t < RIPPLE_LIFE * 0.98; t += 0.02) {
    const scale = rippleRing(s, 0, t).scale;
    assert.ok(scale <= previous + 1e-12, `scale ${scale} grew at t=${t}`);
    assert.ok(scale >= scaleFloor - 1e-9, `scale ${scale} thinned away`);
    previous = scale;
  }
});

test('every ring lies at a constant height just above the water', () => {
  const s = craft();
  for (let t = 0; t < 20; t += 0.7) {
    assert.equal(rippleRing(s, 0, t).y, RIPPLE_WATER_Y);
  }
});

test('the slot index selects staggered rings at one instant', () => {
  const s = craft();
  const radii = new Set();
  for (let i = 0; i < RIPPLE_RINGS_PER_SITE; i += 1) {
    radii.add(rippleRing(s, i, 0).radius);
  }
  assert.equal(radii.size, RIPPLE_RINGS_PER_SITE, 'the slots of one site coincide');
});

test('a finite out-of-range index clamps into the slots', () => {
  const s = craft();
  assert.deepEqual(rippleRing(s, -3, 1), rippleRing(s, 0, 1));
  assert.deepEqual(rippleRing(s, 99, 1), rippleRing(s, RIPPLE_RINGS_PER_SITE - 1, 1));
});

test('a junk spawn yields a finite, invisible ring rather than throwing', () => {
  for (const junk of [undefined, null, 42, 'x', NaN, []]) {
    const r = rippleRing(junk, 0, 1);
    for (const key of ['x', 'y', 'z', 'radius', 'opacity', 'scale', 'band', 'alpha']) {
      assert.ok(Number.isFinite(r[key]), `${key} not finite for junk spawn`);
    }
    assert.equal(r.opacity, 0);
    assert.equal(r.scale, RIPPLE_MIN_SIZE);
    assert.equal(r.y, RIPPLE_WATER_Y);
  }
});

test('a spawn with non-finite fields still yields finite rings', () => {
  const broken = { x: NaN, z: Infinity, phase: 'x', speed: -Infinity, size: undefined };
  for (let i = 0; i < RIPPLE_RINGS_PER_SITE; i += 1) {
    const r = rippleRing(broken, i, 2);
    for (const key of ['x', 'y', 'z', 'radius', 'opacity', 'scale', 'band', 'alpha']) {
      assert.ok(Number.isFinite(r[key]), `${key} not finite for broken spawn`);
    }
    assert.ok(r.radius >= 0 && r.radius <= RIPPLE_MAX_RADIUS + 1e-9);
    assert.ok(r.opacity >= 0 && r.opacity <= RIPPLE_MAX_OPACITY + 1e-9);
  }
});

test('a non-finite time reads as time 0 and a junk index reads as slot 0', () => {
  const s = craft();
  const zero = rippleRing(s, 0, 0);
  for (const junk of [NaN, Infinity, -Infinity, undefined, null, 'x', {}]) {
    assert.deepEqual(rippleRing(s, 0, junk), zero);
    assert.deepEqual(rippleRing(s, junk, 0.5), rippleRing(s, 0, 0.5));
  }
});

test('ripplesEnabled is false only for the low tier', () => {
  assert.equal(ripplesEnabled('low'), false);
  assert.equal(ripplesEnabled('full'), true);
  for (const junk of [undefined, null, 'LOW', 'high', 42, {}, []]) {
    assert.equal(ripplesEnabled(junk), true);
  }
});

test('a finite-but-enormous time still yields a finite ring', () => {
  // time * speed can overflow to Infinity near Number.MAX_VALUE; the module must
  // not let that turn into NaN.
  const s = craft();
  for (const t of [Number.MAX_VALUE, 1e308, -1e308]) {
    const r = rippleRing(s, 0, t);
    for (const key of ['x', 'y', 'z', 'radius', 'opacity', 'scale', 'band', 'alpha']) {
      assert.ok(Number.isFinite(r[key]), `${key} not finite at t=${t}`);
    }
  }
});

test('no call produces NaN or Infinity across a sweep of every site and slot', () => {
  const spawns = rippleSpawns({ count: RIPPLE_MAX_COUNT });
  for (const s of spawns) {
    for (let i = -1; i <= RIPPLE_RINGS_PER_SITE; i += 1) {
      for (let t = -10; t < 30; t += 0.61) {
        const r = rippleRing(s, i, t);
        for (const key of ['x', 'y', 'z', 'radius', 'opacity', 'scale', 'band', 'alpha']) {
          assert.ok(Number.isFinite(r[key]), `${key} not finite at i=${i}, t=${t}`);
        }
      }
    }
  }
});

test('band thins as the ring expands but never drops below RIPPLE_MIN_BAND', () => {
  const s = craft();
  const birthBand = RIPPLE_BAND_BIRTH * s.size;
  let previous = Infinity;
  for (let t = 0; t < RIPPLE_LIFE * 0.98; t += 0.02) {
    const band = rippleRing(s, 0, t).band;
    assert.ok(Number.isFinite(band));
    assert.ok(band <= birthBand + 1e-12, `band ${band} grew above birth at t=${t}`);
    assert.ok(band >= RIPPLE_MIN_BAND - 1e-12, `band ${band} below floor at t=${t}`);
    assert.ok(band <= previous + 1e-12, `band ${band} grew at t=${t}`);
    previous = band;
  }
});

test('alpha is exactly 0 at the fade tail and equals opacity otherwise', () => {
  const s = craft();
  for (const t of [RIPPLE_LIFE * 0.99, RIPPLE_LIFE * 0.999, RIPPLE_LIFE * (1 - 1e-9)]) {
    assert.equal(rippleRing(s, 0, t).alpha, 0, `alpha not zero at t=${t}`);
  }
  assert.equal(rippleRing(s, 0, 0).alpha, rippleRing(s, 0, 0).opacity);
  for (let t = 0; t < RIPPLE_LIFE * 0.97; t += 0.05) {
    const r = rippleRing(s, 0, t);
    assert.equal(r.alpha, r.opacity);
    assert.ok(r.alpha >= 0 && r.alpha <= RIPPLE_MAX_OPACITY + 1e-9);
  }
});

test('band and alpha stay finite and in range across a sweep', () => {
  const spawns = rippleSpawns({ count: RIPPLE_MAX_COUNT });
  for (const s of spawns) {
    for (let i = 0; i < RIPPLE_RINGS_PER_SITE; i += 1) {
      for (let t = -5; t < 20; t += 0.37) {
        const r = rippleRing(s, i, t);
        assert.ok(Number.isFinite(r.band));
        assert.ok(Number.isFinite(r.alpha));
        assert.ok(r.band >= RIPPLE_MIN_BAND - 1e-12);
        assert.ok(r.alpha >= 0 && r.alpha <= RIPPLE_MAX_OPACITY + 1e-9);
      }
    }
  }
});

test('junk spawn yields band and alpha fields', () => {
  for (const junk of [undefined, null, 42, 'x', NaN, []]) {
    const r = rippleRing(junk, 0, 1);
    assert.ok(Number.isFinite(r.band));
    assert.ok(Number.isFinite(r.alpha));
    assert.equal(r.alpha, 0);
    const birthBand = RIPPLE_BAND_BIRTH * RIPPLE_MIN_SIZE;
    const expected = Math.min(birthBand, Math.max(RIPPLE_MIN_BAND, birthBand));
    assert.equal(r.band, expected);
  }
});
