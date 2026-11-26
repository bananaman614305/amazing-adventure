// The litter module decides where fallen leaves lie on the meadow, how each is
// turned, how big it is and which colour and shape it wears; the world turns
// those numbers into one InstancedMesh of leaf quads. These tests hold the
// module to its contract: the authored constants, the frozen tint table, the
// per-phase glow and its junk fallback, the spawn count and finiteness, the
// area-uniform ring bounds, determinism, seed sensitivity, the tint/variant
// indices, the guards on count/seed/options/keep-out, the quality gate, and a
// long sweep proving no NaN.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LITTER_SEED, LITTER_COUNT, LITTER_MAX_COUNT,
  LITTER_MIN_RADIUS, LITTER_MAX_RADIUS,
  LITTER_MIN_SCALE, LITTER_MAX_SCALE, LITTER_VARIANTS,
  LITTER_TINTS, LITTER_PHASE_GLOW,
  litterGlowLevel, litterSpawns, litterEnabled
} from '../src/litter.js';

test('the authored constants are the ones the world relies on', () => {
  assert.equal(LITTER_SEED, 0x3c91a7);
  assert.equal(LITTER_COUNT, 140);
  assert.equal(LITTER_MAX_COUNT, 600);
  assert.equal(LITTER_MIN_RADIUS, 9.4);
  assert.equal(LITTER_MAX_RADIUS, 16.2);
  assert.equal(LITTER_MIN_SCALE, 0.55);
  assert.equal(LITTER_MAX_SCALE, 1.3);
  assert.equal(LITTER_VARIANTS, 4);
  assert.ok(LITTER_MIN_RADIUS < LITTER_MAX_RADIUS);
  assert.ok(LITTER_MIN_SCALE < LITTER_MAX_SCALE);
  assert.ok(LITTER_COUNT <= LITTER_MAX_COUNT);
});

test('the ring sits off the paved plaza and inside the border wall', () => {
  // The paved plaza disc has a 9 m radius and the wall's inner face is at
  // 16.5 m; the ring must fall between them.
  assert.ok(LITTER_MIN_RADIUS >= 9, 'leaves must not fall on the paving');
  assert.ok(LITTER_MAX_RADIUS <= 16.5, 'leaves must not reach the wall');
});

test('the tint table is frozen, warm and fully populated', () => {
  assert.ok(Object.isFrozen(LITTER_TINTS));
  assert.ok(LITTER_TINTS.length >= 4 && LITTER_TINTS.length <= 6);
  for (const tint of LITTER_TINTS) {
    assert.equal(typeof tint, 'number');
    assert.ok(Number.isInteger(tint));
    assert.ok(tint >= 0 && tint <= 0xffffff, `tint ${tint} is not a 24-bit colour`);
    // Warm: red channel at least as strong as blue for every authored leaf.
    const r = (tint >> 16) & 0xff;
    const b = tint & 0xff;
    assert.ok(r >= b, `tint ${tint.toString(16)} is not warm`);
  }
});

test('the phase glow table is frozen and has the authored values', () => {
  assert.ok(Object.isFrozen(LITTER_PHASE_GLOW));
  assert.equal(LITTER_PHASE_GLOW.day, 1);
  assert.equal(LITTER_PHASE_GLOW.dusk, 0.85);
  assert.equal(LITTER_PHASE_GLOW.night, 0.35);
  // Litter is a ground detail: it dims through dusk and nearly vanishes at night.
  assert.ok(LITTER_PHASE_GLOW.day > LITTER_PHASE_GLOW.dusk);
  assert.ok(LITTER_PHASE_GLOW.dusk > LITTER_PHASE_GLOW.night);
});

test('litterGlowLevel is per phase and falls back to day', () => {
  assert.equal(litterGlowLevel('day'), 1);
  assert.equal(litterGlowLevel('dusk'), 0.85);
  assert.equal(litterGlowLevel('night'), 0.35);
  // Unknown phase, and every kind of junk, reads as the day value (1).
  assert.equal(litterGlowLevel('dawn'), 1);
  for (const junk of [undefined, null, 42, NaN, {}, [], 'DAY']) {
    assert.equal(litterGlowLevel(junk), 1);
  }
});

test('litterSpawns returns exactly count items with finite fields', () => {
  const spawns = litterSpawns();
  assert.equal(spawns.length, LITTER_COUNT);
  for (const s of spawns) {
    for (const key of ['x', 'z', 'yaw', 'scale', 'tint', 'variant']) {
      assert.ok(Number.isFinite(s[key]), `${key} is not finite`);
    }
  }
});

test('litterSpawns honours an explicit count', () => {
  assert.equal(litterSpawns({ count: 7 }).length, 7);
  assert.equal(litterSpawns({ count: 1 }).length, 1);
  assert.equal(litterSpawns({ count: LITTER_MAX_COUNT }).length, LITTER_MAX_COUNT);
});

test('litterSpawns is deterministic for identical arguments', () => {
  assert.deepEqual(litterSpawns(), litterSpawns());
  assert.deepEqual(litterSpawns({ count: 12, seed: 99 }), litterSpawns({ count: 12, seed: 99 }));
});

test('a different seed gives a different field', () => {
  assert.notDeepEqual(litterSpawns({ seed: 1 }), litterSpawns({ seed: 2 }));
});

test('every spawn lies in the ring, and the field is spread out', () => {
  const spawns = litterSpawns();
  const angles = new Set();
  const radii = new Set();
  for (const s of spawns) {
    const reach = Math.hypot(s.x, s.z);
    assert.ok(reach >= LITTER_MIN_RADIUS - 1e-9, `reach ${reach} below min radius`);
    assert.ok(reach <= LITTER_MAX_RADIUS + 1e-9, `reach ${reach} above max radius`);
    angles.add(Math.round(Math.atan2(s.z, s.x) * 1000));
    radii.add(Math.round(reach * 1000));
  }
  assert.ok(angles.size > 10, `only ${angles.size} distinct angles`);
  assert.ok(radii.size > 10, `only ${radii.size} distinct radii`);
});

test('the scatter is area-uniform: the outer half holds the larger share', () => {
  // A radial-uniform field would put most leaves in the inner half; an
  // area-uniform one puts them in the outer half by the ratio of the ring areas.
  const spawns = litterSpawns({ count: 400 });
  const mid = (LITTER_MIN_RADIUS + LITTER_MAX_RADIUS) / 2;
  let outer = 0;
  for (const s of spawns) if (Math.hypot(s.x, s.z) > mid) outer += 1;
  assert.ok(outer > spawns.length / 2, `outer half only held ${outer}/${spawns.length}`);
});

test('every spawn has a yaw in [0, 2*PI)', () => {
  for (const s of litterSpawns()) {
    assert.ok(s.yaw >= 0 && s.yaw < Math.PI * 2 + 1e-9, `yaw ${s.yaw} out of range`);
  }
});

test('every spawn scale lies in the authored band', () => {
  for (const s of litterSpawns()) {
    assert.ok(s.scale >= LITTER_MIN_SCALE - 1e-9, `scale ${s.scale} below band`);
    assert.ok(s.scale <= LITTER_MAX_SCALE + 1e-9, `scale ${s.scale} above band`);
  }
});

test('tint and variant are valid integer indices', () => {
  for (const s of litterSpawns({ count: 300 })) {
    assert.ok(Number.isInteger(s.tint), `tint ${s.tint} is not an integer`);
    assert.ok(s.tint >= 0 && s.tint < LITTER_TINTS.length, `tint ${s.tint} out of table`);
    assert.ok(Number.isInteger(s.variant), `variant ${s.variant} is not an integer`);
    assert.ok(s.variant >= 0 && s.variant < LITTER_VARIANTS, `variant ${s.variant} out of range`);
  }
});

test('the field uses more than one tint and more than one variant', () => {
  const spawns = litterSpawns({ count: 300 });
  assert.ok(new Set(spawns.map((s) => s.tint)).size > 1, 'only one tint used');
  assert.ok(new Set(spawns.map((s) => s.variant)).size > 1, 'only one variant used');
});

test('a count of 0 yields an empty field', () => {
  assert.deepEqual(litterSpawns({ count: 0 }), []);
});

test('a junk count falls back to the default or clamps and floors', () => {
  for (const junk of [NaN, Infinity, -Infinity, 'x', null, {}, [], undefined]) {
    const spawns = litterSpawns({ count: junk });
    assert.equal(spawns.length, LITTER_COUNT, `junk count ${String(junk)} did not default`);
    for (const s of spawns) assert.ok(Number.isFinite(s.x));
  }
  // A finite count clamps into [0, LITTER_MAX_COUNT] and floors.
  assert.equal(litterSpawns({ count: 1e9 }).length, LITTER_MAX_COUNT);
  assert.equal(litterSpawns({ count: -5 }).length, 0);
  assert.equal(litterSpawns({ count: 3.9 }).length, 3);
});

test('a junk seed falls back to the authored seed', () => {
  assert.deepEqual(litterSpawns({ count: 5, seed: NaN }), litterSpawns({ count: 5, seed: LITTER_SEED }));
  assert.deepEqual(litterSpawns({ count: 5, seed: Infinity }), litterSpawns({ count: 5 }));
  assert.deepEqual(litterSpawns({ count: 5, seed: 'x' }), litterSpawns({ count: 5, seed: LITTER_SEED }));
});

test('a junk options argument reads as the defaults', () => {
  const base = litterSpawns();
  for (const junk of [undefined, null, 42, 'x', true, [], NaN]) {
    assert.deepEqual(litterSpawns(junk), base, `options ${String(junk)} did not default`);
  }
});

test('swapped radii and scales are exchanged, negative radii clamp to 0', () => {
  const swapped = litterSpawns({ count: 12, minRadius: 15, maxRadius: 10 });
  for (const s of swapped) {
    const reach = Math.hypot(s.x, s.z);
    assert.ok(reach >= 10 - 1e-9 && reach <= 15 + 1e-9, `radius ${reach} outside swapped band`);
  }
  const negative = litterSpawns({ count: 12, minRadius: -4, maxRadius: -1 });
  for (const s of negative) {
    assert.ok(Math.hypot(s.x, s.z) <= 1e-9, 'negative radii should collapse to the centre');
  }
  const scales = litterSpawns({ count: 12, minScale: 2, maxScale: 0.5 });
  for (const s of scales) {
    assert.ok(s.scale >= 0.5 - 1e-9 && s.scale <= 2 + 1e-9, `scale ${s.scale} outside swapped band`);
  }
});

test('junk radius and scale bands fall back to the authored defaults', () => {
  const base = litterSpawns({ count: 9 });
  for (const junk of [NaN, Infinity, 'x', null, {}]) {
    assert.deepEqual(litterSpawns({ count: 9, minRadius: junk, maxRadius: junk }), base);
    assert.deepEqual(litterSpawns({ count: 9, minScale: junk, maxScale: junk }), base);
  }
});

test('keepOut circles are honoured and the count is still exact', () => {
  // Cover the whole ring: the fallback must still return exactly `count`.
  const everywhere = [{ x: 0, z: 0, r: 100 }];
  const all = litterSpawns({ count: 20, keepOut: everywhere });
  assert.equal(all.length, 20);
  for (const s of all) {
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z));
  }

  // A small circle that leaves room: no leaf should land inside it.
  const small = [{ x: 12, z: 0, r: 1.5 }];
  const field = litterSpawns({ count: 300, keepOut: small });
  assert.equal(field.length, 300);
  for (const s of field) {
    const d = Math.hypot(s.x - 12, s.z - 0);
    assert.ok(d > 1.5 - 1e-9, `leaf landed in the keep-out at distance ${d}`);
  }
});

test('keepOut accepts the r or radius field and skips malformed entries', () => {
  const small = [{ x: 12, z: 0, r: 1.5 }];
  const aliased = [{ x: 12, z: 0, radius: 1.5 }];
  assert.deepEqual(litterSpawns({ count: 100, keepOut: aliased }), litterSpawns({ count: 100, keepOut: small }));

  // Junk keep-out entries are skipped, not fatal.
  const junky = [null, 42, 'x', { x: NaN, z: 0, r: 2 }, { x: 0, z: 0, r: -1 }, {}, small[0]];
  const withJunk = litterSpawns({ count: 100, keepOut: junky });
  assert.equal(withJunk.length, 100);
  for (const s of withJunk) assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z));
});

test('a non-array keepOut is ignored', () => {
  const base = litterSpawns({ count: 30 });
  for (const junk of [undefined, null, 42, 'x', {}, { x: 0, z: 0, r: 5 }]) {
    assert.deepEqual(litterSpawns({ count: 30, keepOut: junk }), base);
  }
});

test('litterEnabled is false only for the low tier', () => {
  assert.equal(litterEnabled('low'), false);
  assert.equal(litterEnabled('full'), true);
  for (const junk of [undefined, null, 'LOW', 'high', 42, {}, []]) {
    assert.equal(litterEnabled(junk), true);
  }
});

test('a long sweep over seeds and options never yields NaN or Infinity', () => {
  for (let seed = 0; seed < 40; seed += 1) {
    const spawns = litterSpawns({ count: 25, seed: seed * 0x9e3779b1 });
    assert.equal(spawns.length, 25);
    for (const s of spawns) {
      for (const key of ['x', 'z', 'yaw', 'scale', 'tint', 'variant']) {
        assert.ok(Number.isFinite(s[key]), `${key} not finite at seed ${seed}`);
      }
      assert.ok(s.tint >= 0 && s.tint < LITTER_TINTS.length);
      assert.ok(s.variant >= 0 && s.variant < LITTER_VARIANTS);
      assert.ok(s.scale >= 0);
    }
  }
});
