// The wildflower module decides where the meadow's flower clumps stand, how big
// and tall each is, which bloom colour it carries, and how it leans in the
// breeze; the world will turn those numbers into one InstancedMesh. These tests
// hold the module to its contract: the authored constants, the frozen phase
// table and palette and their junk fallbacks, the spawn count and clamping,
// determinism, the margin and keep-out bounds, the size and height bands, the
// sway bound, the guards for junk input, the quality gate, and a sweep proving
// no NaN.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WILDFLOWER_SEED, WILDFLOWER_COUNT, WILDFLOWER_MAX_COUNT,
  WILDFLOWER_DEFAULT_WORLD_HALF, WILDFLOWER_MARGIN,
  WILDFLOWER_MIN_RADIUS, WILDFLOWER_MAX_RADIUS,
  WILDFLOWER_MIN_HEIGHT, WILDFLOWER_MAX_HEIGHT,
  WILDFLOWER_MIN_SIZE, WILDFLOWER_MAX_SIZE,
  WILDFLOWER_PHASE_GLOW, WILDFLOWER_TINTS,
  WILDFLOWER_SWAY_PERIOD, WILDFLOWER_SWAY_AMPLITUDE,
  wildflowerGlowLevel, wildflowerSpawns, wildflowerSway, wildflowersEnabled
} from '../src/wildflowers.js';

const LIMIT = WILDFLOWER_DEFAULT_WORLD_HALF - WILDFLOWER_MARGIN;

test('the authored constants are the ones the world relies on', () => {
  assert.equal(WILDFLOWER_SEED, 0x3c9a51);
  assert.equal(WILDFLOWER_COUNT, 90);
  assert.equal(WILDFLOWER_MAX_COUNT, 300);
  assert.equal(WILDFLOWER_DEFAULT_WORLD_HALF, 17);
  assert.equal(WILDFLOWER_MARGIN, 0.8);
  assert.equal(WILDFLOWER_MIN_RADIUS, 0.22);
  assert.equal(WILDFLOWER_MAX_RADIUS, 0.55);
  assert.equal(WILDFLOWER_MIN_HEIGHT, 0.12);
  assert.equal(WILDFLOWER_MAX_HEIGHT, 0.34);
  assert.equal(WILDFLOWER_MIN_SIZE, 0.8);
  assert.equal(WILDFLOWER_MAX_SIZE, 1.2);
  assert.equal(WILDFLOWER_SWAY_PERIOD, 3.2);
  assert.equal(WILDFLOWER_SWAY_AMPLITUDE, 0.06);
});

test('the constant bands are ordered and the default count fits the ceiling', () => {
  assert.ok(WILDFLOWER_MIN_RADIUS < WILDFLOWER_MAX_RADIUS);
  assert.ok(WILDFLOWER_MIN_HEIGHT < WILDFLOWER_MAX_HEIGHT);
  assert.ok(WILDFLOWER_MIN_SIZE < WILDFLOWER_MAX_SIZE);
  assert.ok(WILDFLOWER_COUNT <= WILDFLOWER_MAX_COUNT);
  assert.ok(WILDFLOWER_SWAY_PERIOD > 0);
  assert.ok(WILDFLOWER_SWAY_AMPLITUDE > 0 && WILDFLOWER_SWAY_AMPLITUDE < 0.2);
});

test('the phase table is frozen and carries the authored values', () => {
  assert.ok(Object.isFrozen(WILDFLOWER_PHASE_GLOW));
  assert.deepEqual({ ...WILDFLOWER_PHASE_GLOW }, { day: 1, dusk: 0.85, night: 0.35 });
  // The flowers settle into the dark, so night is the dimmest reading.
  assert.ok(WILDFLOWER_PHASE_GLOW.day > WILDFLOWER_PHASE_GLOW.dusk);
  assert.ok(WILDFLOWER_PHASE_GLOW.dusk > WILDFLOWER_PHASE_GLOW.night);
});

test('the palette is frozen and holds the five authored meadow tints', () => {
  assert.ok(Object.isFrozen(WILDFLOWER_TINTS));
  assert.deepEqual([...WILDFLOWER_TINTS], [0xf2d24a, 0x6f8fd6, 0xd2544a, 0xf0eee4, 0xb08ad0]);
});

test('wildflowerGlowLevel is per phase and falls back to day', () => {
  assert.equal(wildflowerGlowLevel('day'), 1);
  assert.equal(wildflowerGlowLevel('dusk'), 0.85);
  assert.equal(wildflowerGlowLevel('night'), 0.35);
  assert.equal(wildflowerGlowLevel('dawn'), 1);
  for (const junk of [undefined, null, 42, NaN, {}, [], 'DAY']) {
    assert.equal(wildflowerGlowLevel(junk), 1, `glow junk ${String(junk)} did not read as day`);
  }
});

test('wildflowerSpawns returns the default count with finite fields', () => {
  const spawns = wildflowerSpawns();
  assert.equal(spawns.length, WILDFLOWER_COUNT);
  for (const s of spawns) {
    for (const key of ['x', 'z', 'size', 'height', 'phase', 'sway']) {
      assert.ok(Number.isFinite(s[key]), `${key} is not finite`);
    }
    assert.ok(Number.isFinite(s.tint), 'tint is not finite');
  }
});

test('wildflowerSpawns honours an explicit count', () => {
  assert.equal(wildflowerSpawns({ count: 1 }).length, 1);
  assert.equal(wildflowerSpawns({ count: 0 }).length, 0);
  assert.equal(wildflowerSpawns({ count: 25 }).length, 25);
  assert.equal(wildflowerSpawns({ count: WILDFLOWER_MAX_COUNT }).length, WILDFLOWER_MAX_COUNT);
});

test('a junk count falls back to the default or clamps and floors', () => {
  for (const junk of [NaN, Infinity, -Infinity, 'x', null, {}, [], undefined]) {
    assert.equal(wildflowerSpawns({ count: junk }).length, WILDFLOWER_COUNT, `junk count ${String(junk)} did not default`);
  }
  assert.equal(wildflowerSpawns({ count: 1e9 }).length, WILDFLOWER_MAX_COUNT);
  assert.equal(wildflowerSpawns({ count: -5 }).length, 0);
  assert.equal(wildflowerSpawns({ count: 3.9 }).length, 3);
});

test('wildflowerSpawns is deterministic for identical arguments', () => {
  assert.deepEqual(wildflowerSpawns(), wildflowerSpawns());
  assert.deepEqual(wildflowerSpawns({ count: 12, seed: 99 }), wildflowerSpawns({ count: 12, seed: 99 }));
});

test('a different seed gives a different field', () => {
  assert.notDeepEqual(wildflowerSpawns({ seed: 1 }), wildflowerSpawns({ seed: 2 }));
});

test('a junk seed falls back to the authored seed', () => {
  assert.deepEqual(wildflowerSpawns({ count: 5, seed: NaN }), wildflowerSpawns({ count: 5, seed: WILDFLOWER_SEED }));
  assert.deepEqual(wildflowerSpawns({ count: 5, seed: Infinity }), wildflowerSpawns({ count: 5 }));
});

test('a junk options argument reads as the defaults', () => {
  const base = wildflowerSpawns();
  for (const junk of [undefined, null, 42, 'x', true, [], NaN]) {
    assert.deepEqual(wildflowerSpawns(junk), base, `options ${String(junk)} did not default`);
  }
});

test('every clump stands inside the paving margin', () => {
  for (const s of wildflowerSpawns({ count: WILDFLOWER_MAX_COUNT })) {
    // The sampler insets the whole footprint, so the centre is strictly inside
    // the margin band; testing the centre against the limit is the bound a
    // caller can actually assert without the unexposed footprint radius.
    assert.ok(Math.abs(s.x) < LIMIT + 1e-9, `x ${s.x} past margin`);
    assert.ok(Math.abs(s.z) < LIMIT + 1e-9, `z ${s.z} past margin`);
  }
});

test('size, height and offsets stay inside their bands', () => {
  for (const s of wildflowerSpawns()) {
    assert.ok(s.size >= WILDFLOWER_MIN_SIZE - 1e-9 && s.size <= WILDFLOWER_MAX_SIZE + 1e-9, `size ${s.size} out of band`);
    assert.ok(s.height >= WILDFLOWER_MIN_HEIGHT - 1e-9 && s.height <= WILDFLOWER_MAX_HEIGHT + 1e-9, `height ${s.height} out of band`);
    assert.ok(s.phase >= 0 && s.phase < 1, `phase ${s.phase} left [0,1)`);
    assert.ok(s.sway >= 0 && s.sway < 1, `sway ${s.sway} left [0,1)`);
  }
});

test('every tint comes from the frozen palette', () => {
  const allowed = new Set(WILDFLOWER_TINTS);
  for (const s of wildflowerSpawns()) {
    assert.ok(allowed.has(s.tint), `tint ${s.tint} is not in the palette`);
  }
});

test('the field uses more than one tint, so the meadow has colour variety', () => {
  const used = new Set(wildflowerSpawns({ count: WILDFLOWER_MAX_COUNT }).map((s) => s.tint));
  assert.ok(used.size > 1, 'every clump came back one colour');
});

test('supplied keep-out circles are honoured', () => {
  const circle = [{ x: 10, z: 0, radius: 2 }];
  const spawns = wildflowerSpawns({ count: 200, circles: circle });
  assert.ok(spawns.length > 0);
  for (const s of spawns) {
    const d = Math.hypot(s.x - 10, s.z - 0);
    // The sampler insets by the clump radius too, so the centre clears the
    // circle radius outright.
    assert.ok(d > 2, `clump landed inside the keep-out at distance ${d}`);
  }
});

test('keep-out circles accept r or radius and skip malformed entries', () => {
  const small = [{ x: 10, z: 0, r: 1.5 }];
  const aliased = [{ x: 10, z: 0, radius: 1.5 }];
  assert.deepEqual(wildflowerSpawns({ count: 60, circles: aliased }), wildflowerSpawns({ count: 60, circles: small }));

  const junky = [null, 42, 'x', { x: NaN, z: 0, radius: 2 }, { x: 0, z: 0, radius: -1 }, {}, small[0]];
  const withJunk = wildflowerSpawns({ count: 60, circles: junky });
  assert.equal(withJunk.length, 60);
  for (const s of withJunk) assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z));
});

test('a non-array circles option is ignored', () => {
  const base = wildflowerSpawns({ count: 30 });
  for (const junk of [undefined, null, 42, 'x', {}, { x: 0, z: 0, radius: 5 }]) {
    assert.deepEqual(wildflowerSpawns({ count: 30, circles: junk }), base);
  }
});

test('a fully blocked field skips rather than forcing a bad clump', () => {
  // A circle covering the whole square: no candidate can pass, so the field
  // comes back short of its count instead of planting clumps in the keep-out.
  const everywhere = [{ x: 0, z: 0, radius: 100 }];
  const blocked = wildflowerSpawns({ count: 10, circles: everywhere });
  assert.ok(Array.isArray(blocked));
  assert.equal(blocked.length, 0);
});

test('worldHalf is clamped into [4, 64] and junk reads as 17', () => {
  assert.deepEqual(wildflowerSpawns({ count: 8, worldHalf: 100 }), wildflowerSpawns({ count: 8, worldHalf: 64 }));
  assert.deepEqual(wildflowerSpawns({ count: 8, worldHalf: NaN }), wildflowerSpawns({ count: 8, worldHalf: WILDFLOWER_DEFAULT_WORLD_HALF }));
  // A tiny world half clamps up to 4, so the field is confined to that square.
  const tight = wildflowerSpawns({ count: 40, worldHalf: 0.1 });
  assert.equal(tight.length, 40);
  const tightLimit = 4 - WILDFLOWER_MARGIN;
  for (const s of tight) {
    assert.ok(Math.abs(s.x) < tightLimit + 1e-9, `x ${s.x} past the tight margin`);
    assert.ok(Math.abs(s.z) < tightLimit + 1e-9, `z ${s.z} past the tight margin`);
  }
});

test('wildflowerSway is bounded, finite and small', () => {
  const s = wildflowerSpawns({ count: 1 })[0];
  for (let t = 0; t < 40; t += 0.05) {
    const { lean, tilt } = wildflowerSway(s, t);
    assert.ok(Number.isFinite(lean) && Number.isFinite(tilt), `sway not finite at t=${t}`);
    assert.ok(Math.abs(lean) <= WILDFLOWER_SWAY_AMPLITUDE + 1e-9, `lean ${lean} exceeds amplitude`);
    assert.ok(Math.abs(tilt) <= WILDFLOWER_SWAY_AMPLITUDE + 1e-9, `tilt ${tilt} exceeds amplitude`);
  }
});

test('wildflowerSway is deterministic and never overflows at absurd time', () => {
  const s = wildflowerSpawns({ count: 1 })[0];
  assert.deepEqual(wildflowerSway(s, 3.3), wildflowerSway(s, 3.3));
  for (const t of [Number.MAX_VALUE, 1e300, -1e300]) {
    const { lean, tilt } = wildflowerSway(s, t);
    assert.ok(Number.isFinite(lean) && Number.isFinite(tilt), `sway overflowed at t=${t}`);
  }
});

test('wildflowerSway reads junk time as 0 and a junk spawn as no bend', () => {
  const s = wildflowerSpawns({ count: 1 })[0];
  const zero = wildflowerSway(s, 0);
  for (const junk of [NaN, Infinity, -Infinity, undefined, null, 'x', {}]) {
    assert.deepEqual(wildflowerSway(s, junk), zero, `time ${String(junk)} did not read as 0`);
  }
  for (const junk of [undefined, null, 42, 'x', [], true]) {
    assert.deepEqual(wildflowerSway(junk, 1.5), { lean: 0, tilt: 0 }, `spawn ${String(junk)} did not read as no bend`);
  }
  for (const junk of [{}, { phase: NaN, sway: NaN }, { phase: {}, sway: {} }, { phase: Infinity }]) {
    const { lean, tilt } = wildflowerSway(junk, 1.5);
    assert.ok(
      Number.isFinite(lean) && Number.isFinite(tilt) &&
      Math.abs(lean) <= WILDFLOWER_SWAY_AMPLITUDE && Math.abs(tilt) <= WILDFLOWER_SWAY_AMPLITUDE,
      'sway not finite for a junk-field spawn'
    );
  }
});

test('wildflowerSway uses the spawn phase so clumps are out of step', () => {
  // Two clumps with different phase offsets must not lean identically at the
  // same instant, or the whole meadow would move as one board.
  const a = { phase: 0, sway: 0 };
  const b = { phase: 0.37, sway: 0.61 };
  const at = wildflowerSway(a, 0.4);
  const bt = wildflowerSway(b, 0.4);
  assert.notDeepEqual(at, bt);
});

test('wildflowersEnabled is false only for the low tier', () => {
  assert.equal(wildflowersEnabled('low'), false);
  assert.equal(wildflowersEnabled('full'), true);
  for (const junk of [undefined, null, 'LOW', 'high', 42, {}, []]) {
    assert.equal(wildflowersEnabled(junk), true);
  }
});

test('a long sweep over seeds and options never yields NaN or Infinity', () => {
  for (let seed = 0; seed < 30; seed += 1) {
    const spawns = wildflowerSpawns({ count: 25, seed: seed * 0x9e3779b1 });
    assert.ok(spawns.length <= 25);
    for (const s of spawns) {
      for (const key of ['x', 'z', 'size', 'height', 'phase', 'sway']) {
        assert.ok(Number.isFinite(s[key]), `${key} not finite at seed ${seed}`);
      }
      assert.ok(s.size >= WILDFLOWER_MIN_SIZE && s.size <= WILDFLOWER_MAX_SIZE);
      assert.ok(s.height >= WILDFLOWER_MIN_HEIGHT && s.height <= WILDFLOWER_MAX_HEIGHT);
      assert.ok(s.phase >= 0 && s.phase < 1);
      assert.ok(s.sway >= 0 && s.sway < 1);
    }
  }
});
