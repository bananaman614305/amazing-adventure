// The near cloud layer: footprints on the ground, drift over time, and how
// opaque the layer is per phase.
//
// The pure decisions behind Round 98's passer clouds (see the module header).
// What is worth pinning here: the field is deterministic and stays inside its
// documented square and radius band, the drift is bounded and smooth rather
// than jumping between frames, the altitude spread really spans the band, and
// the phase table never lights the layer at night or on a junk phase id.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PASSER_COUNT,
  PASSER_SEED,
  PASSER_MIN_ALT,
  PASSER_MAX_ALT,
  PASSER_SPAN,
  PASSER_MIN_RADIUS,
  PASSER_MAX_RADIUS,
  PASSER_DRIFT_MAX,
  PASSER_PHASE_OPACITY,
  mulberry32,
  passerFootprints,
  passerAltitude,
  passerDrift,
  passerOpacity
} from '../src/cloudpassers.js';

test('the constants are in a sensible order', () => {
  assert.ok(PASSER_COUNT >= 3 && PASSER_COUNT <= 8);
  assert.ok(PASSER_MIN_ALT < PASSER_MAX_ALT);
  assert.ok(PASSER_MIN_RADIUS < PASSER_MAX_RADIUS);
  assert.ok(PASSER_SPAN > 0 && PASSER_DRIFT_MAX > 0);
  assert.equal(PASSER_SEED, 0x51de);
});

test('mulberry32 is deterministic and yields [0, 1)', () => {
  const a = mulberry32(7);
  const b = mulberry32(7);
  for (let i = 0; i < 100; i += 1) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1);
  }
});

test('the footprint field is deterministic', () => {
  assert.deepEqual(passerFootprints(), passerFootprints());
  assert.deepEqual(passerFootprints(3, 99), passerFootprints(3, 99));
});

test('a different seed moves the field', () => {
  assert.notDeepEqual(passerFootprints(5, 1), passerFootprints(5, 2));
});

test('the field honours a custom count', () => {
  assert.equal(passerFootprints().length, PASSER_COUNT);
  assert.equal(passerFootprints(2).length, 2);
  assert.equal(passerFootprints(9).length, 9);
});

test('junk counts give an empty field rather than throwing', () => {
  assert.deepEqual(passerFootprints(0), []);
  assert.deepEqual(passerFootprints(-3), []);
  assert.deepEqual(passerFootprints(NaN), []);
  assert.deepEqual(passerFootprints(Infinity), []);
  assert.deepEqual(passerFootprints('5'), []);
  assert.deepEqual(passerFootprints(null), []);
  assert.deepEqual(passerFootprints(undefined, undefined).length, PASSER_COUNT,
    'an omitted count falls back to the default');
});

test('every footprint sits inside the documented square and radius band', () => {
  for (const seed of [PASSER_SEED, 1, 2, 3, 0xdeadbeef]) {
    for (const f of passerFootprints(24, seed)) {
      assert.ok(f.x >= -PASSER_SPAN && f.x <= PASSER_SPAN, `x ${f.x}`);
      assert.ok(f.z >= -PASSER_SPAN && f.z <= PASSER_SPAN, `z ${f.z}`);
      assert.ok(f.r >= PASSER_MIN_RADIUS && f.r <= PASSER_MAX_RADIUS, `r ${f.r}`);
    }
  }
});

test('the footprints are spread, not stacked on one spot', () => {
  const field = passerFootprints();
  for (let i = 0; i < field.length; i += 1) {
    for (let j = i + 1; j < field.length; j += 1) {
      const d = Math.hypot(field[i].x - field[j].x, field[i].z - field[j].z);
      assert.ok(d > 1, `passers ${i} and ${j} overlap (${d.toFixed(2)} m)`);
    }
  }
});

test('passerAltitude is deterministic and spans the band', () => {
  const seen = [];
  for (let i = 0; i < PASSER_COUNT; i += 1) {
    const a = passerAltitude(i);
    assert.equal(a, passerAltitude(i));
    assert.ok(a >= PASSER_MIN_ALT && a <= PASSER_MAX_ALT, `altitude ${a}`);
    seen.push(a);
  }
  // The five passers must not all float at the same height.
  assert.ok(Math.max(...seen) - Math.min(...seen) > 4,
    `altitudes too close: ${seen.map((v) => v.toFixed(1))}`);
  // A wider sweep still never leaves the band, and covers most of it.
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 40; i += 1) {
    const a = passerAltitude(i);
    lo = Math.min(lo, a);
    hi = Math.max(hi, a);
  }
  assert.ok(lo >= PASSER_MIN_ALT && hi <= PASSER_MAX_ALT);
  assert.ok(hi - lo > (PASSER_MAX_ALT - PASSER_MIN_ALT) * 0.8,
    `altitude sweep only covers ${(hi - lo).toFixed(1)} m`);
  assert.equal(passerAltitude(NaN), PASSER_MIN_ALT);
  assert.equal(passerAltitude('2'), PASSER_MIN_ALT);
});

test('passerDrift is deterministic and bounded', () => {
  for (let i = 0; i < PASSER_COUNT; i += 1) {
    for (let t = 0; t < 400; t += 7) {
      const d = passerDrift(i, t);
      assert.deepEqual(d, passerDrift(i, t));
      assert.ok(Math.abs(d.dx) <= PASSER_DRIFT_MAX + 1e-12, `dx ${d.dx}`);
      assert.ok(Math.abs(d.dz) <= PASSER_DRIFT_MAX + 1e-12, `dz ${d.dz}`);
    }
  }
  assert.deepEqual(passerDrift(NaN, 5), { dx: 0, dz: 0 });
  assert.deepEqual(passerDrift(1, Infinity), { dx: 0, dz: 0 });
});

test('passerDrift is smooth: no visible jump between frames', () => {
  const dt = 1 / 60;
  for (let i = 0; i < PASSER_COUNT; i += 1) {
    for (let t = 0; t < 200; t += 3.3) {
      const a = passerDrift(i, t);
      const b = passerDrift(i, t + dt);
      assert.ok(Math.abs(b.dx - a.dx) < 0.02, `dx jump at t=${t.toFixed(1)}`);
      assert.ok(Math.abs(b.dz - a.dz) < 0.02, `dz jump at t=${t.toFixed(1)}`);
    }
  }
});

test('the passers do not drift in lockstep', () => {
  const t = 23;
  const xs = [];
  for (let i = 0; i < PASSER_COUNT; i += 1) xs.push(passerDrift(i, t).dx);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 1, `all drift alike: ${xs}`);
});

test('the layer is day-and-dusk only, and unknown phases are off', () => {
  assert.equal(passerOpacity('day'), PASSER_PHASE_OPACITY.day);
  assert.equal(passerOpacity('dusk'), PASSER_PHASE_OPACITY.dusk);
  assert.equal(passerOpacity('night'), 0);
  assert.equal(passerOpacity('dawn'), 0);
  assert.equal(passerOpacity(''), 0);
  assert.equal(passerOpacity(null), 0);
  assert.equal(passerOpacity(7), 0);
  assert.ok(passerOpacity('day') > passerOpacity('dusk'));
  assert.ok(Object.isFrozen(PASSER_PHASE_OPACITY));
});

test('no input anywhere produces NaN', () => {
  const junk = [NaN, Infinity, -Infinity, undefined, null, 'x', {}, []];
  for (const j of junk) {
    const field = passerFootprints(j);
    assert.ok(Array.isArray(field));
    for (const f of field) {
      assert.ok(Number.isFinite(f.x) && Number.isFinite(f.z) && Number.isFinite(f.r));
    }
    assert.ok(Number.isFinite(passerAltitude(j)));
    const d = passerDrift(j, j);
    assert.ok(Number.isFinite(d.dx) && Number.isFinite(d.dz));
    assert.ok(Number.isFinite(passerOpacity(j)));
  }
  // ...and with junk in the second position too.
  assert.ok(Number.isFinite(passerAltitude(1)));
  const d = passerDrift(1, NaN);
  assert.ok(Number.isFinite(d.dx) && Number.isFinite(d.dz));
});
