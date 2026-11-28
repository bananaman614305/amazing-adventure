// The puddle module decides where the courtyard's rainwater puddles lie, how big
// each is, how glossy and dark it reads per phase, and how its glint breathes;
// the world will turn those numbers into one InstancedMesh of flat quads. These
// tests hold the module to its contract: the authored constants, the frozen
// phase tables and their junk fallbacks, the spawn count and clamping,
// determinism, the margin and fountain and keep-out and spacing bounds, the
// radius and size bands, the shimmer bound, the guards for junk input, the
// quality gate, and a sweep proving no NaN.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PUDDLE_SEED, PUDDLE_COUNT, PUDDLE_MAX_COUNT,
  PUDDLE_MIN_RADIUS, PUDDLE_MAX_RADIUS,
  PUDDLE_MARGIN, PUDDLE_CLEAR_RADIUS, PUDDLE_WATER_Y,
  PUDDLE_PHASE_GLOSS, PUDDLE_PHASE_DARK,
  PUDDLE_MIN_SIZE, PUDDLE_MAX_SIZE,
  PUDDLE_SPACING_FACTOR, PUDDLE_SHIMMER_AMPLITUDE,
  puddleGloss, puddleDarkness, puddleSpawns, puddleShimmer, puddlesEnabled
} from '../src/puddles.js';

const DEFAULT_HALF = 17;
const LIMIT = DEFAULT_HALF - PUDDLE_MARGIN;

test('the authored constants are the ones the world relies on', () => {
  assert.equal(PUDDLE_SEED, 0x7b3e2a);
  assert.equal(PUDDLE_COUNT, 18);
  assert.equal(PUDDLE_MAX_COUNT, 120);
  assert.equal(PUDDLE_MIN_RADIUS, 0.25);
  assert.equal(PUDDLE_MAX_RADIUS, 0.9);
  assert.equal(PUDDLE_MARGIN, 0.6);
  assert.equal(PUDDLE_CLEAR_RADIUS, 4.2);
  assert.equal(PUDDLE_WATER_Y, 0.012);
  assert.ok(PUDDLE_MIN_RADIUS < PUDDLE_MAX_RADIUS);
  assert.ok(PUDDLE_MIN_SIZE < PUDDLE_MAX_SIZE);
  assert.ok(PUDDLE_COUNT <= PUDDLE_MAX_COUNT);
});

test('the water film floats above the paving but not visibly', () => {
  // Big enough to beat z-fighting, small enough never to read as a raised disc.
  assert.ok(PUDDLE_WATER_Y > 0);
  assert.ok(PUDDLE_WATER_Y < 0.05);
});

test('the phase tables are frozen and carry the authored values', () => {
  assert.ok(Object.isFrozen(PUDDLE_PHASE_GLOSS));
  assert.ok(Object.isFrozen(PUDDLE_PHASE_DARK));
  assert.deepEqual({ ...PUDDLE_PHASE_GLOSS }, { day: 0.55, dusk: 1, night: 0.75 });
  assert.deepEqual({ ...PUDDLE_PHASE_DARK }, { day: 0.72, dusk: 0.62, night: 0.5 });
  // Darkness falls through the day, so night is the darkest reading.
  assert.ok(PUDDLE_PHASE_DARK.day > PUDDLE_PHASE_DARK.dusk);
  assert.ok(PUDDLE_PHASE_DARK.dusk > PUDDLE_PHASE_DARK.night);
});

test('puddleGloss is per phase and falls back to day', () => {
  assert.equal(puddleGloss('day'), 0.55);
  assert.equal(puddleGloss('dusk'), 1);
  assert.equal(puddleGloss('night'), 0.75);
  assert.equal(puddleGloss('dawn'), 0.55);
  for (const junk of [undefined, null, 42, NaN, {}, [], 'DAY']) {
    assert.equal(puddleGloss(junk), 0.55, `gloss junk ${String(junk)} did not read as day`);
  }
});

test('puddleDarkness is per phase and falls back to day', () => {
  assert.equal(puddleDarkness('day'), 0.72);
  assert.equal(puddleDarkness('dusk'), 0.62);
  assert.equal(puddleDarkness('night'), 0.5);
  assert.equal(puddleDarkness('dawn'), 0.72);
  for (const junk of [undefined, null, 42, NaN, {}, [], 'NIGHT']) {
    assert.equal(puddleDarkness(junk), 0.72, `darkness junk ${String(junk)} did not read as day`);
  }
});

test('puddleSpawns returns the default count with finite fields', () => {
  const spawns = puddleSpawns();
  assert.equal(spawns.length, PUDDLE_COUNT);
  for (const s of spawns) {
    for (const key of ['x', 'z', 'radius', 'size', 'phase']) {
      assert.ok(Number.isFinite(s[key]), `${key} is not finite`);
    }
  }
});

test('puddleSpawns honours an explicit count', () => {
  assert.equal(puddleSpawns({ count: 1 }).length, 1);
  assert.equal(puddleSpawns({ count: 0 }).length, 0);
  assert.equal(puddleSpawns({ count: PUDDLE_MAX_COUNT }).length, PUDDLE_MAX_COUNT);
});

test('a junk count falls back to the default or clamps and floors', () => {
  for (const junk of [NaN, Infinity, -Infinity, 'x', null, {}, [], undefined]) {
    assert.equal(puddleSpawns({ count: junk }).length, PUDDLE_COUNT, `junk count ${String(junk)} did not default`);
  }
  assert.equal(puddleSpawns({ count: 1e9 }).length, PUDDLE_MAX_COUNT);
  assert.equal(puddleSpawns({ count: -5 }).length, 0);
  assert.equal(puddleSpawns({ count: 3.9 }).length, 3);
});

test('puddleSpawns is deterministic for identical arguments', () => {
  assert.deepEqual(puddleSpawns(), puddleSpawns());
  assert.deepEqual(puddleSpawns({ count: 12, seed: 99 }), puddleSpawns({ count: 12, seed: 99 }));
});

test('a different seed gives a different field', () => {
  assert.notDeepEqual(puddleSpawns({ seed: 1 }), puddleSpawns({ seed: 2 }));
});

test('every puddle quad lies inside the wall margin', () => {
  for (const s of puddleSpawns({ count: PUDDLE_MAX_COUNT })) {
    assert.ok(Math.abs(s.x) + s.radius <= LIMIT + 1e-9, `x edge ${Math.abs(s.x) + s.radius} past margin`);
    assert.ok(Math.abs(s.z) + s.radius <= LIMIT + 1e-9, `z edge ${Math.abs(s.z) + s.radius} past margin`);
  }
});

test('every puddle clears the fountain apron', () => {
  for (const s of puddleSpawns({ count: PUDDLE_MAX_COUNT })) {
    assert.ok(Math.hypot(s.x, s.z) > PUDDLE_CLEAR_RADIUS, `puddle at ${Math.hypot(s.x, s.z)} is inside the apron`);
  }
});

test('radius and size stay inside their bands', () => {
  for (const s of puddleSpawns()) {
    assert.ok(s.radius >= PUDDLE_MIN_RADIUS - 1e-9 && s.radius <= PUDDLE_MAX_RADIUS + 1e-9, `radius ${s.radius} out of band`);
    assert.ok(s.size >= PUDDLE_MIN_SIZE - 1e-9 && s.size <= PUDDLE_MAX_SIZE + 1e-9, `size ${s.size} out of band`);
  }
});

test('every phase offset is in [0, 1)', () => {
  for (const s of puddleSpawns()) {
    assert.ok(s.phase >= 0 && s.phase < 1, `phase ${s.phase} left [0,1)`);
  }
});

test('puddles keep the minimum spacing from one another', () => {
  const spawns = puddleSpawns({ count: PUDDLE_MAX_COUNT });
  for (let i = 0; i < spawns.length; i += 1) {
    for (let j = i + 1; j < spawns.length; j += 1) {
      const a = spawns[i];
      const b = spawns[j];
      const gap = Math.hypot(a.x - b.x, a.z - b.z);
      const need = PUDDLE_SPACING_FACTOR * Math.max(a.radius, b.radius);
      assert.ok(gap >= need - 1e-9, `puddles ${i}/${j} only ${gap} apart, need ${need}`);
    }
  }
});

test('supplied keep-out circles are honoured', () => {
  const circle = [{ x: 10, z: 0, r: 1.5 }];
  const spawns = puddleSpawns({ count: 100, circles: circle });
  assert.ok(spawns.length > 0);
  for (const s of spawns) {
    const d = Math.hypot(s.x - 10, s.z - 0);
    assert.ok(d > 1.5, `puddle landed inside the keep-out at distance ${d}`);
  }
});

test('keep-out circles accept r or radius and skip malformed entries', () => {
  const small = [{ x: 10, z: 0, r: 1.5 }];
  const aliased = [{ x: 10, z: 0, radius: 1.5 }];
  assert.deepEqual(puddleSpawns({ count: 60, circles: aliased }), puddleSpawns({ count: 60, circles: small }));

  const junky = [null, 42, 'x', { x: NaN, z: 0, r: 2 }, { x: 0, z: 0, r: -1 }, {}, small[0]];
  const withJunk = puddleSpawns({ count: 60, circles: junky });
  assert.equal(withJunk.length, 60);
  for (const s of withJunk) assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z));
});

test('a non-array circles option is ignored', () => {
  const base = puddleSpawns({ count: 30 });
  for (const junk of [undefined, null, 42, 'x', {}, { x: 0, z: 0, r: 5 }]) {
    assert.deepEqual(puddleSpawns({ count: 30, circles: junk }), base);
  }
});

test('a fully blocked field skips rather than forcing a bad puddle', () => {
  // A circle covering the whole square: no candidate can pass, so the field
  // comes back short of its count instead of placing puddles in the keep-out.
  const everywhere = [{ x: 0, z: 0, r: 100 }];
  const blocked = puddleSpawns({ count: 10, circles: everywhere });
  assert.ok(Array.isArray(blocked));
  assert.equal(blocked.length, 0);
});

test('a junk options argument reads as the defaults', () => {
  const base = puddleSpawns();
  for (const junk of [undefined, null, 42, 'x', true, [], NaN]) {
    assert.deepEqual(puddleSpawns(junk), base, `options ${String(junk)} did not default`);
  }
});

test('a junk seed falls back to the authored seed', () => {
  assert.deepEqual(puddleSpawns({ count: 5, seed: NaN }), puddleSpawns({ count: 5, seed: PUDDLE_SEED }));
  assert.deepEqual(puddleSpawns({ count: 5, seed: Infinity }), puddleSpawns({ count: 5 }));
});

test('worldHalf is clamped into [4, 64] and junk reads as 17', () => {
  // A generous world half and a clamped-to-64 one must agree, because both end
  // up at the 64 clamp.
  assert.deepEqual(puddleSpawns({ count: 8, worldHalf: 100 }), puddleSpawns({ count: 8, worldHalf: 64 }));
  assert.deepEqual(puddleSpawns({ count: 8, worldHalf: NaN }), puddleSpawns({ count: 8, worldHalf: DEFAULT_HALF }));
  // A tiny world half leaves no room outside the apron, so it simply skips.
  assert.equal(puddleSpawns({ count: 8, worldHalf: 0.1 }).length, 0);
});

test('puddleShimmer is bounded, finite and small', () => {
  const s = puddleSpawns({ count: 1 })[0];
  for (let t = 0; t < 40; t += 0.05) {
    const { wobble } = puddleShimmer(s, t);
    assert.ok(Number.isFinite(wobble), `wobble not finite at t=${t}`);
    assert.ok(wobble >= -1 && wobble <= 1, `wobble ${wobble} left [-1,1]`);
    assert.ok(Math.abs(wobble) <= PUDDLE_SHIMMER_AMPLITUDE + 1e-9, `wobble ${wobble} exceeds amplitude`);
  }
});

test('puddleShimmer reads junk time as 0 and a junk spawn as no wobble', () => {
  const s = puddleSpawns({ count: 1 })[0];
  const zero = puddleShimmer(s, 0);
  for (const junk of [NaN, Infinity, -Infinity, undefined, null, 'x', {}]) {
    assert.deepEqual(puddleShimmer(s, junk), zero, `time ${String(junk)} did not read as 0`);
  }
  for (const junk of [undefined, null, 42, 'x', [], true]) {
    assert.deepEqual(puddleShimmer(junk, 1.5), { wobble: 0 }, `spawn ${String(junk)} did not read as no wobble`);
  }
  // An object with junk fields is still a spawn: a non-finite phase reads as 0,
  // and the result stays finite rather than turning into NaN.
  for (const junk of [{}, { phase: NaN }, { phase: {} }, { phase: Infinity }]) {
    const { wobble } = puddleShimmer(junk, 1.5);
    assert.ok(Number.isFinite(wobble) && wobble >= -1 && wobble <= 1, `wobble not finite for junk spawn`);
  }
});

test('puddleShimmer is deterministic and never overflows at absurd time', () => {
  const s = puddleSpawns({ count: 1 })[0];
  assert.deepEqual(puddleShimmer(s, 3.3), puddleShimmer(s, 3.3));
  for (const t of [Number.MAX_VALUE, 1e300, -1e300]) {
    const { wobble } = puddleShimmer(s, t);
    assert.ok(Number.isFinite(wobble), `wobble overflowed at t=${t}`);
  }
});

test('puddlesEnabled is false only for the low tier', () => {
  assert.equal(puddlesEnabled('low'), false);
  assert.equal(puddlesEnabled('full'), true);
  for (const junk of [undefined, null, 'LOW', 'high', 42, {}, []]) {
    assert.equal(puddlesEnabled(junk), true);
  }
});

test('a long sweep over seeds and options never yields NaN or Infinity', () => {
  for (let seed = 0; seed < 30; seed += 1) {
    const spawns = puddleSpawns({ count: 25, seed: seed * 0x9e3779b1 });
    assert.ok(spawns.length <= 25);
    for (const s of spawns) {
      for (const key of ['x', 'z', 'radius', 'size', 'phase']) {
        assert.ok(Number.isFinite(s[key]), `${key} not finite at seed ${seed}`);
      }
      assert.ok(s.radius >= PUDDLE_MIN_RADIUS && s.radius <= PUDDLE_MAX_RADIUS);
      assert.ok(s.phase >= 0 && s.phase < 1);
    }
  }
});
