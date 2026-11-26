// The reed module decides where the meadow's cattail clumps stand, how many stems
// each has, how tall and how wide they are, which green they read as, and how the
// stems bend in the wind; the world will turn those numbers into a small
// InstancedMesh. These tests hold the module to its contract: the authored
// constants, the frozen phase and tint tables and their junk fallbacks, the spawn
// count and clamping, determinism, the margin and keep-out bounds, the stems and
// height and lean and size bands, the sway bounds and per-stem variation, the
// guards for junk input, the quality gate, and a sweep proving no NaN.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REED_SEED, REED_COUNT, REED_MAX_COUNT, REED_DEFAULT_WORLD_HALF, REED_MARGIN,
  REED_MIN_STEMS, REED_MAX_STEMS,
  REED_MIN_HEIGHT, REED_MAX_HEIGHT,
  REED_MIN_LEAN, REED_MAX_LEAN,
  REED_MIN_SIZE, REED_MAX_SIZE,
  REED_PHASE_GLOW, REED_TINTS,
  REED_SWAY_PERIOD, REED_SWAY_AMPLITUDE,
  reedSpawns, reedStemSway, reedGlowLevel, reedsEnabled
} from '../src/reeds.js';

const LIMIT = REED_DEFAULT_WORLD_HALF - REED_MARGIN;

test('the authored constants are the ones the world relies on', () => {
  assert.equal(REED_SEED, 0x3c6e21);
  assert.equal(REED_COUNT, 26);
  assert.equal(REED_MAX_COUNT, 200);
  assert.equal(REED_DEFAULT_WORLD_HALF, 17);
  assert.equal(REED_MARGIN, 0.7);
  assert.equal(REED_MIN_STEMS, 2);
  assert.equal(REED_MAX_STEMS, 5);
  assert.equal(REED_MIN_HEIGHT, 0.45);
  assert.equal(REED_MAX_HEIGHT, 0.95);
  assert.equal(REED_MIN_LEAN, 0);
  assert.equal(REED_MAX_LEAN, 0.12);
  assert.equal(REED_MIN_SIZE, 0.7);
  assert.equal(REED_MAX_SIZE, 1.3);
  assert.equal(REED_SWAY_PERIOD, 2.6);
  assert.equal(REED_SWAY_AMPLITUDE, 0.09);
  assert.ok(REED_COUNT <= REED_MAX_COUNT);
});

test('the shape bands are ordered and sane', () => {
  assert.ok(REED_MIN_STEMS < REED_MAX_STEMS);
  assert.ok(REED_MIN_HEIGHT < REED_MAX_HEIGHT);
  assert.ok(REED_MIN_LEAN < REED_MAX_LEAN);
  assert.ok(REED_MIN_SIZE < REED_MAX_SIZE);
  // A clump is a small thing: half a metre to a metre, not a tree.
  assert.ok(REED_MAX_HEIGHT <= 1);
  assert.ok(REED_MAX_LEAN < Math.PI / 12);
});

test('the sway is slow and small', () => {
  assert.ok(REED_SWAY_PERIOD > 1);
  assert.ok(REED_SWAY_AMPLITUDE > 0);
  assert.ok(REED_SWAY_AMPLITUDE < 0.2);
});

test('the phase glow table is frozen and carries the authored values', () => {
  assert.ok(Object.isFrozen(REED_PHASE_GLOW));
  assert.deepEqual({ ...REED_PHASE_GLOW }, { day: 0.9, dusk: 1, night: 0.55 });
  // Brightest at dusk, dimmest at night.
  assert.ok(REED_PHASE_GLOW.dusk > REED_PHASE_GLOW.day);
  assert.ok(REED_PHASE_GLOW.day > REED_PHASE_GLOW.night);
});

test('the tint table is frozen and holds the authored greens', () => {
  assert.ok(Object.isFrozen(REED_TINTS));
  assert.deepEqual([...REED_TINTS], [0x6f8a4a, 0x7f9a55, 0x5f7a40]);
  for (const t of REED_TINTS) {
    assert.equal(typeof t, 'number');
    assert.ok(Number.isInteger(t));
  }
});

test('reedGlowLevel is per phase and falls back to day', () => {
  assert.equal(reedGlowLevel('day'), 0.9);
  assert.equal(reedGlowLevel('dusk'), 1);
  assert.equal(reedGlowLevel('night'), 0.55);
  assert.equal(reedGlowLevel('dawn'), 0.9);
});

test('reedGlowLevel reads junk as day', () => {
  for (const junk of [undefined, null, 42, NaN, {}, [], 'DAY', 'Night']) {
    assert.equal(reedGlowLevel(junk), 0.9, `glow junk ${String(junk)} did not read as day`);
  }
});

test('reedSpawns returns the default count with finite fields', () => {
  const spawns = reedSpawns();
  assert.equal(spawns.length, REED_COUNT);
  for (const s of spawns) {
    for (const key of ['x', 'z', 'stems', 'height', 'lean', 'size', 'tint', 'phase']) {
      assert.ok(Number.isFinite(s[key]), `${key} is not finite`);
    }
  }
});

test('reedSpawns honours an explicit count', () => {
  assert.equal(reedSpawns({ count: 1 }).length, 1);
  assert.equal(reedSpawns({ count: 0 }).length, 0);
  assert.equal(reedSpawns({ count: REED_MAX_COUNT }).length, REED_MAX_COUNT);
});

test('a junk count falls back to the default or clamps and floors', () => {
  for (const junk of [NaN, Infinity, -Infinity, 'x', null, {}, [], undefined]) {
    assert.equal(reedSpawns({ count: junk }).length, REED_COUNT, `junk count ${String(junk)} did not default`);
  }
  assert.equal(reedSpawns({ count: 1e9 }).length, REED_MAX_COUNT);
  assert.equal(reedSpawns({ count: -5 }).length, 0);
  assert.equal(reedSpawns({ count: 3.9 }).length, 3);
});

test('reedSpawns is deterministic for identical arguments', () => {
  assert.deepEqual(reedSpawns(), reedSpawns());
  assert.deepEqual(reedSpawns({ count: 12, seed: 99 }), reedSpawns({ count: 12, seed: 99 }));
});

test('a different seed gives a different field', () => {
  assert.notDeepEqual(reedSpawns({ seed: 1 }), reedSpawns({ seed: 2 }));
});

test('every clump centre lies inside the wall margin', () => {
  for (const s of reedSpawns({ count: REED_MAX_COUNT })) {
    assert.ok(Math.abs(s.x) <= LIMIT + 1e-9, `x ${s.x} past margin`);
    assert.ok(Math.abs(s.z) <= LIMIT + 1e-9, `z ${s.z} past margin`);
  }
});

test('stems are whole numbers inside their band', () => {
  for (const s of reedSpawns({ count: REED_MAX_COUNT })) {
    assert.ok(Number.isInteger(s.stems), `stems ${s.stems} is not an integer`);
    assert.ok(s.stems >= REED_MIN_STEMS && s.stems <= REED_MAX_STEMS, `stems ${s.stems} out of band`);
  }
});

test('height, lean and size stay inside their bands', () => {
  for (const s of reedSpawns({ count: REED_MAX_COUNT })) {
    assert.ok(s.height >= REED_MIN_HEIGHT - 1e-9 && s.height <= REED_MAX_HEIGHT + 1e-9, `height ${s.height} out of band`);
    assert.ok(s.lean >= REED_MIN_LEAN - 1e-9 && s.lean <= REED_MAX_LEAN + 1e-9, `lean ${s.lean} out of band`);
    assert.ok(s.size >= REED_MIN_SIZE - 1e-9 && s.size <= REED_MAX_SIZE + 1e-9, `size ${s.size} out of band`);
  }
});

test('every tint is one of the authored greens', () => {
  for (const s of reedSpawns({ count: REED_MAX_COUNT })) {
    assert.ok(REED_TINTS.includes(s.tint), `tint ${s.tint} is not an authored green`);
  }
});

test('every phase offset is in [0, 1)', () => {
  for (const s of reedSpawns()) {
    assert.ok(s.phase >= 0 && s.phase < 1, `phase ${s.phase} left [0,1)`);
  }
});

test('supplied keep-out circles are honoured', () => {
  const circles = [{ x: 10, z: 0, radius: 1.5 }];
  const spawns = reedSpawns({ count: 100, circles });
  assert.ok(spawns.length > 0);
  for (const s of spawns) {
    const d = Math.hypot(s.x - 10, s.z - 0);
    assert.ok(d >= 1.5 - 1e-9, `clump landed inside the keep-out at distance ${d}`);
  }
});

test('keep-out circles accept radius or r and skip malformed entries', () => {
  const canonical = [{ x: 10, z: 0, radius: 1.5 }];
  const aliased = [{ x: 10, z: 0, r: 1.5 }];
  assert.deepEqual(reedSpawns({ count: 60, circles: aliased }), reedSpawns({ count: 60, circles: canonical }));

  const junky = [null, 42, 'x', { x: NaN, z: 0, radius: 2 }, { x: 0, z: 0, radius: -1 }, {}, canonical[0]];
  const withJunk = reedSpawns({ count: 60, circles: junky });
  assert.equal(withJunk.length, 60);
  for (const s of withJunk) assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z));
});

test('a non-array circles option is ignored', () => {
  const base = reedSpawns({ count: 30 });
  for (const junk of [undefined, null, 42, 'x', {}, { x: 0, z: 0, radius: 5 }]) {
    assert.deepEqual(reedSpawns({ count: 30, circles: junk }), base);
  }
});

test('a fully blocked field skips rather than forcing a bad clump', () => {
  // A circle covering the whole square: no candidate can pass, so the field
  // comes back short of its count instead of placing reeds in the keep-out.
  const everywhere = [{ x: 0, z: 0, radius: 100 }];
  const blocked = reedSpawns({ count: 10, circles: everywhere });
  assert.ok(Array.isArray(blocked));
  assert.equal(blocked.length, 0);
});

test('a junk options argument reads as the defaults', () => {
  const base = reedSpawns();
  for (const junk of [undefined, null, 42, 'x', true, [], NaN]) {
    assert.deepEqual(reedSpawns(junk), base, `options ${String(junk)} did not default`);
  }
});

test('a junk seed falls back to the authored seed', () => {
  assert.deepEqual(reedSpawns({ count: 5, seed: NaN }), reedSpawns({ count: 5, seed: REED_SEED }));
  assert.deepEqual(reedSpawns({ count: 5, seed: Infinity }), reedSpawns({ count: 5 }));
});

test('worldHalf is clamped into [4, 64] and junk reads as 17', () => {
  // A generous world half and a clamped-to-64 one must agree, because both end
  // up at the 64 clamp.
  assert.deepEqual(reedSpawns({ count: 8, worldHalf: 100 }), reedSpawns({ count: 8, worldHalf: 64 }));
  assert.deepEqual(reedSpawns({ count: 8, worldHalf: NaN }), reedSpawns({ count: 8, worldHalf: REED_DEFAULT_WORLD_HALF }));
  // A tiny world half clamps to 4, leaving a positive margin band and a full field.
  const tiny = reedSpawns({ count: 8, worldHalf: 0.1 });
  assert.equal(tiny.length, 8);
  for (const s of tiny) {
    assert.ok(Math.abs(s.x) <= 4 - REED_MARGIN + 1e-9);
    assert.ok(Math.abs(s.z) <= 4 - REED_MARGIN + 1e-9);
  }
});

test('reedStemSway is bounded and finite across a full cycle', () => {
  const s = reedSpawns({ count: 1 })[0];
  for (let t = 0; t < 40; t += 0.05) {
    for (let i = 0; i < REED_MAX_STEMS; i += 1) {
      const { lean, tip } = reedStemSway(s, i, t);
      assert.ok(Number.isFinite(lean), `lean not finite at t=${t}`);
      assert.ok(Math.abs(lean) <= REED_SWAY_AMPLITUDE + 1e-9, `lean ${lean} exceeds amplitude`);
      assert.ok(Number.isFinite(tip), `tip not finite at t=${t}`);
      assert.ok(tip >= 0 && tip <= 1, `tip ${tip} left [0,1]`);
    }
  }
});

test('stems in one clump do not sway together', () => {
  const s = { x: 0, z: 0, stems: REED_MAX_STEMS, height: 0.7, lean: 0, size: 1, tint: REED_TINTS[0], phase: 0 };
  const leans = [];
  for (let i = 0; i < REED_MAX_STEMS; i += 1) leans.push(reedStemSway(s, i, 0.7).lean);
  // The per-stem phase offsets put the stems at distinct points on the wave, so
  // at least two of them must differ at any instant.
  assert.ok(new Set(leans).size > 1, `all stems swayed in unison: ${leans.join(',')}`);
});

test('stemIndex is floored and clamped into range', () => {
  const s = reedSpawns({ count: 1 })[0];
  assert.deepEqual(reedStemSway(s, 99, 1.2), reedStemSway(s, REED_MAX_STEMS - 1, 1.2));
  assert.deepEqual(reedStemSway(s, -3, 1.2), reedStemSway(s, 0, 1.2));
  assert.deepEqual(reedStemSway(s, 2.9, 1.2), reedStemSway(s, 2, 1.2));
  assert.deepEqual(reedStemSway(s, NaN, 1.2), reedStemSway(s, 0, 1.2));
});

test('reedStemSway reads junk time as 0', () => {
  const s = reedSpawns({ count: 1 })[0];
  const zero = reedStemSway(s, 0, 0);
  for (const junk of [NaN, Infinity, -Infinity, undefined, null, 'x', {}]) {
    assert.deepEqual(reedStemSway(s, 0, junk), zero, `time ${String(junk)} did not read as 0`);
  }
});

test('a junk spawn yields a zero sway', () => {
  for (const junk of [undefined, null, 42, 'x', [], true]) {
    assert.deepEqual(reedStemSway(junk, 0, 1.5), { lean: 0, tip: 0 }, `spawn ${String(junk)} did not read as rest`);
  }
});

test('a spawn with junk fields still yields finite bounds', () => {
  for (const junk of [{}, { phase: NaN }, { phase: {} }, { phase: Infinity }]) {
    const { lean, tip } = reedStemSway(junk, 1, 1.5);
    assert.ok(Number.isFinite(lean) && Math.abs(lean) <= REED_SWAY_AMPLITUDE + 1e-9);
    assert.ok(Number.isFinite(tip) && tip >= 0 && tip <= 1);
  }
});

test('reedStemSway is deterministic and never overflows at absurd time', () => {
  const s = reedSpawns({ count: 1 })[0];
  assert.deepEqual(reedStemSway(s, 1, 3.3), reedStemSway(s, 1, 3.3));
  for (const t of [Number.MAX_VALUE, 1e300, -1e300]) {
    const { lean, tip } = reedStemSway(s, 1, t);
    assert.ok(Number.isFinite(lean), `lean overflowed at t=${t}`);
    assert.ok(Number.isFinite(tip), `tip overflowed at t=${t}`);
  }
});

test('reedsEnabled is false only for the low tier', () => {
  assert.equal(reedsEnabled('low'), false);
  assert.equal(reedsEnabled('full'), true);
  for (const junk of [undefined, null, 'LOW', 'high', 42, {}, []]) {
    assert.equal(reedsEnabled(junk), true);
  }
});

test('a long sweep over seeds and options never yields NaN or Infinity', () => {
  for (let seed = 0; seed < 30; seed += 1) {
    const spawns = reedSpawns({ count: 30, seed: seed * 0x9e3779b1 });
    assert.ok(spawns.length <= 30);
    for (const s of spawns) {
      for (const key of ['x', 'z', 'stems', 'height', 'lean', 'size', 'tint', 'phase']) {
        assert.ok(Number.isFinite(s[key]), `${key} not finite at seed ${seed}`);
      }
      assert.ok(s.stems >= REED_MIN_STEMS && s.stems <= REED_MAX_STEMS);
      assert.ok(s.phase >= 0 && s.phase < 1);
    }
  }
});
