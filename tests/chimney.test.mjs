// The chimney module decides where the village's wood smoke comes from, how each
// puff climbs and fades, how strongly smoke reads by phase and which quality tier
// shows it; the world turns those numbers into billboards. These tests hold the
// module to its contract: the authored constants, the frozen phase table and its
// junk fallback, the spawn count and ring bounds, determinism, the guards on
// every entry point, the per-puff bounds and ordering, the exact-zero top of the
// plume, the fade-with-climb and fade-with-age behaviour, the phase ordering and
// the tier gate.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHIMNEY_SEED, CHIMNEY_COUNT, CHIMNEY_RISE, CHIMNEY_PUFFS,
  CHIMNEY_MIN_RADIUS, CHIMNEY_MAX_RADIUS,
  CHIMNEY_BASE_Y_MIN, CHIMNEY_BASE_Y_MAX,
  CHIMNEY_MIN_SIZE, CHIMNEY_MAX_SIZE, CHIMNEY_MAX_OPACITY,
  CHIMNEY_PUFF_LIFE, CHIMNEY_DRIFT_MIN, CHIMNEY_DRIFT_MAX,
  CHIMNEY_MAX_COUNT, CHIMNEY_PHASE_GLOW,
  smokeGlowLevel, chimneySpawns, smokePuff, chimneyEnabled
} from '../src/chimney.js';

test('the authored constants are the ones the world relies on', () => {
  assert.equal(CHIMNEY_SEED, 0x6b1d47);
  assert.equal(CHIMNEY_COUNT, 4);
  assert.equal(CHIMNEY_RISE, 6);
  assert.equal(CHIMNEY_PUFFS, 7);
  assert.equal(CHIMNEY_MAX_OPACITY, 0.55);
  assert.ok(CHIMNEY_MIN_RADIUS < CHIMNEY_MAX_RADIUS);
  assert.ok(CHIMNEY_MIN_SIZE < CHIMNEY_MAX_SIZE);
  assert.ok(CHIMNEY_BASE_Y_MIN < CHIMNEY_BASE_Y_MAX);
  assert.ok(CHIMNEY_DRIFT_MIN < CHIMNEY_DRIFT_MAX);
  // The houses are four to six metres tall, so the mouth band must sit there.
  assert.ok(CHIMNEY_BASE_Y_MIN >= 4 && CHIMNEY_BASE_Y_MAX <= 6);
  // A count above the default but within the cap is allowed; the cap is real.
  assert.ok(CHIMNEY_MAX_COUNT >= CHIMNEY_COUNT);
});

test('the phase glow table is frozen with dusk strongest and day weakest', () => {
  assert.ok(Object.isFrozen(CHIMNEY_PHASE_GLOW));
  assert.equal(CHIMNEY_PHASE_GLOW.dusk, 1);
  assert.equal(CHIMNEY_PHASE_GLOW.night, 0.8);
  assert.equal(CHIMNEY_PHASE_GLOW.day, 0.25);
  assert.ok(CHIMNEY_PHASE_GLOW.dusk > CHIMNEY_PHASE_GLOW.night);
  assert.ok(CHIMNEY_PHASE_GLOW.night > CHIMNEY_PHASE_GLOW.day);
});

test('smokeGlowLevel is per phase and falls back to day', () => {
  assert.equal(smokeGlowLevel('day'), 0.25);
  assert.equal(smokeGlowLevel('dusk'), 1);
  assert.equal(smokeGlowLevel('night'), 0.8);
  // Unknown phase, and every kind of junk, reads as the day value.
  assert.equal(smokeGlowLevel('dawn'), 0.25);
  for (const junk of [undefined, null, 42, NaN, {}, [], 'DUSK']) {
    assert.equal(smokeGlowLevel(junk), 0.25);
  }
});

test('chimneySpawns returns exactly count items with finite fields', () => {
  const spawns = chimneySpawns();
  assert.equal(spawns.length, CHIMNEY_COUNT);
  for (const s of spawns) {
    for (const key of ['x', 'z', 'baseY', 'phase', 'rise', 'drift']) {
      assert.ok(Number.isFinite(s[key]), `${key} is not finite`);
    }
    assert.ok(s.phase >= 0 && s.phase < 1, `phase ${s.phase} left [0,1)`);
  }
  // An explicit count is honoured, including zero and one.
  assert.equal(chimneySpawns({ count: 3 }).length, 3);
  assert.equal(chimneySpawns({ count: 1 }).length, 1);
  assert.deepEqual(chimneySpawns({ count: 0 }), []);
});

test('chimneySpawns is deterministic for identical arguments', () => {
  assert.deepEqual(chimneySpawns(), chimneySpawns());
  assert.deepEqual(chimneySpawns({ count: 6, seed: 99 }), chimneySpawns({ count: 6, seed: 99 }));
});

test('a different seed gives a different village', () => {
  assert.notDeepEqual(chimneySpawns({ seed: 1 }), chimneySpawns({ seed: 2 }));
});

test('every chimney sits inside the ring around the origin', () => {
  for (const s of chimneySpawns()) {
    const reach = Math.hypot(s.x, s.z);
    assert.ok(reach >= CHIMNEY_MIN_RADIUS - 1e-9, `reach ${reach} inside the plaza`);
    assert.ok(reach <= CHIMNEY_MAX_RADIUS + 1e-9, `reach ${reach} past the walls`);
  }
});

test('every chimney mouth sits at a plausible roof height', () => {
  for (const s of chimneySpawns()) {
    assert.ok(s.baseY >= CHIMNEY_BASE_Y_MIN - 1e-9, `baseY ${s.baseY} below the eaves`);
    assert.ok(s.baseY <= CHIMNEY_BASE_Y_MAX + 1e-9, `baseY ${s.baseY} above the ridge`);
  }
});

test('the plumes are spread around the ring, not stacked on one spot', () => {
  const spawns = chimneySpawns({ count: 6 });
  const angles = new Set(spawns.map((s) => Math.round(Math.atan2(s.z, s.x) * 1000)));
  const radii = new Set(spawns.map((s) => Math.round(Math.hypot(s.x, s.z) * 1000)));
  assert.ok(angles.size > 3, `only ${angles.size} distinct angles`);
  assert.ok(radii.size > 3, `only ${radii.size} distinct radii`);
});

test('a junk count clamps into [0, CHIMNEY_MAX_COUNT] and floors', () => {
  for (const junk of [NaN, Infinity, -Infinity, 'x', null, {}, undefined]) {
    const spawns = chimneySpawns({ count: junk });
    assert.ok(spawns.length >= 0 && spawns.length <= CHIMNEY_MAX_COUNT, `junk count gave ${spawns.length}`);
    for (const s of spawns) assert.ok(Number.isFinite(s.x));
  }
  assert.equal(chimneySpawns({ count: 1e9 }).length, CHIMNEY_MAX_COUNT);
  assert.equal(chimneySpawns({ count: -5 }).length, 0);
  assert.equal(chimneySpawns({ count: 3.9 }).length, 3);
});

test('a junk seed falls back to the authored seed', () => {
  assert.deepEqual(chimneySpawns({ count: 4, seed: NaN }), chimneySpawns({ count: 4, seed: CHIMNEY_SEED }));
  assert.deepEqual(chimneySpawns({ count: 4, seed: Infinity }), chimneySpawns({ count: 4 }));
  // A junk options argument as a whole falls back to the defaults too.
  for (const junk of [undefined, null, 42, 'x', NaN, [], true]) {
    const spawns = chimneySpawns(junk);
    assert.equal(spawns.length, CHIMNEY_COUNT);
    for (const s of spawns) assert.ok(Number.isFinite(s.x) && Number.isFinite(s.baseY));
  }
});

test('smokePuff returns finite, bounded values across a long sweep', () => {
  const spawns = chimneySpawns();
  for (const s of spawns) {
    for (let i = 0; i < CHIMNEY_PUFFS; i += 1) {
      for (let t = 0; t < 60; t += 0.37) {
        const p = smokePuff(s, i, t);
        for (const key of ['x', 'y', 'z', 'size', 'opacity']) {
          assert.ok(Number.isFinite(p[key]), `${key} not finite at i=${i}, t=${t}`);
        }
        assert.ok(p.size >= CHIMNEY_MIN_SIZE - 1e-9 && p.size <= CHIMNEY_MAX_SIZE + 1e-9, `size ${p.size} out of band`);
        assert.ok(p.opacity >= 0 && p.opacity <= CHIMNEY_MAX_OPACITY + 1e-9, `opacity ${p.opacity} out of band`);
      }
    }
  }
});

test('a puff at slot 0 sits at the chimney mouth', () => {
  const s = chimneySpawns({ count: 1 })[0];
  const p = smokePuff(s, 0, 0);
  // At the mouth the lean and wobble are both scaled out, so x/z are the spawn's.
  assert.ok(Math.abs(p.x - s.x) < 1e-9, `x ${p.x} drifted from the mouth`);
  assert.ok(Math.abs(p.z - s.z) < 1e-9, `z ${p.z} drifted from the mouth`);
  assert.ok(Math.abs(p.y - s.baseY) < 1e-9, `y ${p.y} is not the base height`);
});

test('the top puff has opacity exactly 0', () => {
  const spawns = chimneySpawns();
  for (const s of spawns) {
    for (const t of [0, 1.7, 12.3, 41.9]) {
      assert.equal(smokePuff(s, CHIMNEY_PUFFS - 1, t).opacity, 0);
    }
  }
});

test('puffs climb monotonically with index at any instant, and grow with it', () => {
  const s = chimneySpawns({ count: 1 })[0];
  for (const t of [0, 2.5, 9.1, 30.7]) {
    let previousY = -Infinity;
    let previousSize = -Infinity;
    for (let i = 0; i < CHIMNEY_PUFFS; i += 1) {
      const p = smokePuff(s, i, t);
      assert.ok(p.y > previousY, `slot ${i} at t=${t} is not above the one below`);
      assert.ok(p.size > previousSize, `slot ${i} is not bigger than the one below`);
      previousY = p.y;
      previousSize = p.size;
    }
  }
});

test('the column spans the rise and the top is near base + rise', () => {
  const s = chimneySpawns({ count: 1 })[0];
  const mouth = smokePuff(s, 0, 0).y;
  const top = smokePuff(s, CHIMNEY_PUFFS - 1, 0).y;
  assert.ok(Math.abs(mouth - s.baseY) < 1e-9);
  // The top is base + rise, with the shared bob scaled in at full weight.
  assert.ok(Math.abs(top - (s.baseY + s.rise + 0.35 * Math.sin(s.phase * Math.PI * 2))) < 1e-9);
  assert.ok(top - mouth >= 4.5 - 1e-9, `column only ${top - mouth} tall`);
});

test('opacity falls as a puff climbs the plume', () => {
  const s = chimneySpawns({ count: 1 })[0];
  for (const t of [0.4, 3.3, 17.2]) {
    let previous = Infinity;
    for (let i = 0; i < CHIMNEY_PUFFS; i += 1) {
      const opacity = smokePuff(s, i, t).opacity;
      assert.ok(opacity < previous, `slot ${i} at t=${t} is not fainter than the one below`);
      previous = opacity;
    }
  }
});

test('a puff fades with age over one life', () => {
  // A crafted spawn with phase 0 so the age starts at 0: the same slot then at
  // age 0 versus most of a life old. A seeded spawn would begin mid-cycle.
  const s = { x: 0, z: 0, baseY: 5, phase: 0, rise: 6, drift: 0.5 };
  const young = smokePuff(s, 1, 0).opacity;
  const old = smokePuff(s, 1, CHIMNEY_PUFF_LIFE * 0.95).opacity;
  assert.ok(old < young, `old ${old} is not fainter than young ${young}`);
});

test('a non-finite time reads as time 0 and a junk index reads as slot 0', () => {
  const s = chimneySpawns({ count: 1 })[0];
  const zero = smokePuff(s, 2, 0);
  for (const junk of [NaN, Infinity, -Infinity, undefined, null, 'x', {}]) {
    assert.deepEqual(smokePuff(s, 2, junk), zero);
  }
  assert.deepEqual(smokePuff(s, NaN, 1), smokePuff(s, 0, 1));
  assert.deepEqual(smokePuff(s, undefined, 1), smokePuff(s, 0, 1));
  assert.deepEqual(smokePuff(s, 'x', 1), smokePuff(s, 0, 1));
});

test('a finite out-of-range index clamps to the ends', () => {
  const s = chimneySpawns({ count: 1 })[0];
  assert.deepEqual(smokePuff(s, -3, 1), smokePuff(s, 0, 1));
  assert.deepEqual(smokePuff(s, 99, 1), smokePuff(s, CHIMNEY_PUFFS - 1, 1));
});

test('a junk spawn yields a finite, invisible puff rather than throwing', () => {
  for (const junk of [undefined, null, 42, 'x', NaN, []]) {
    const p = smokePuff(junk, 0, 1);
    for (const key of ['x', 'y', 'z', 'size', 'opacity']) {
      assert.ok(Number.isFinite(p[key]), `${key} not finite for junk spawn`);
    }
    assert.equal(p.opacity, 0);
    assert.equal(p.size, CHIMNEY_MIN_SIZE);
  }
});

test('a spawn with non-finite fields still yields finite puffs', () => {
  const broken = { x: NaN, z: Infinity, baseY: 'x', phase: NaN, rise: -Infinity, drift: undefined };
  for (let i = 0; i < CHIMNEY_PUFFS; i += 1) {
    const p = smokePuff(broken, i, 2);
    for (const key of ['x', 'y', 'z', 'size', 'opacity']) {
      assert.ok(Number.isFinite(p[key]), `${key} not finite for broken spawn`);
    }
  }
});

test('the top of the plume still leans with its drift', () => {
  // Two spawns at the same spot but opposite drift should part at the top,
  // proving the lean is real and not a fixed offset.
  const a = { x: 0, z: 0, baseY: 5, phase: 0, rise: 6, drift: 1 };
  const b = { x: 0, z: 0, baseY: 5, phase: 0.5, rise: 6, drift: 1 };
  const topA = smokePuff(a, CHIMNEY_PUFFS - 1, 0);
  const topB = smokePuff(b, CHIMNEY_PUFFS - 1, 0);
  assert.ok(Math.hypot(topA.x - topB.x, topA.z - topB.z) > 0.5, 'the two plumes did not part');
});

test('sites override the ring and keep the per-plume behaviour', () => {
  const sites = [
    { x: -8.3, z: -8.0, baseY: 5.3 },
    { x: 20.5, z: -15.5, baseY: 4.2 }
  ];
  const sited = chimneySpawns({ count: 2, sites });
  assert.equal(sited.length, 2);
  assert.equal(sited[0].x, -8.3);
  assert.equal(sited[0].z, -8.0);
  assert.equal(sited[0].baseY, 5.3);
  assert.equal(sited[1].x, 20.5);

  // The seeded draws must be the same as the ring's, index for index, so adding
  // a real roof does not reshuffle the smoke the module already generated.
  const ring = chimneySpawns({ count: 2 });
  for (let i = 0; i < 2; i += 1) {
    assert.equal(sited[i].phase, ring[i].phase);
    assert.equal(sited[i].rise, ring[i].rise);
    assert.equal(sited[i].drift, ring[i].drift);
  }
});

test('a site list is clamped to the count and drops broken sites', () => {
  const sites = [
    { x: 1, z: 2, baseY: 4 },
    { x: NaN, z: 2, baseY: 4 },     // dropped
    { x: 3, z: 4, baseY: 5 },
    [1, 2, 3],                       // dropped (array)
    null,                            // dropped
    { x: 5, z: 6, baseY: 6 }
  ];
  const spawns = chimneySpawns({ count: 10, sites });
  assert.equal(spawns.length, 3);
  assert.deepEqual(spawns.map((s) => s.x), [1, 3, 5]);
  for (const s of spawns) {
    for (const key of ['x', 'z', 'baseY', 'phase', 'rise', 'drift']) {
      assert.ok(Number.isFinite(s[key]), `${key} not finite for a sited plume`);
    }
  }
  // A count smaller than the site list trims it rather than expanding it.
  assert.equal(chimneySpawns({ count: 2, sites }).length, 2);
  // An empty or junk site list falls back to the seeded ring rather than an
  // empty array: a missing roof must not take the whole village's smoke away.
  assert.equal(chimneySpawns({ count: 3, sites: [] }).length, 3);
  assert.equal(chimneySpawns({ count: 3, sites: 'nope' }).length, 3);
});

test('chimneyEnabled is false only for the low tier', () => {
  assert.equal(chimneyEnabled('low'), false);
  assert.equal(chimneyEnabled('full'), true);
  for (const junk of [undefined, null, 'LOW', 'high', 42, {}, []]) {
    assert.equal(chimneyEnabled(junk), true);
  }
});
