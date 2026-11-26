// The flutter module decides how a hanging cloth leans and billows; the world
// turns those numbers into mesh rotations and a displaced free edge. These tests
// hold the module to its contract: the authored constants are the ones the
// integration will rely on, the per-phase and per-piece helpers are
// deterministic and spread, the motion stays inside its bounds across a long
// sweep for every strength and offset, still air is exactly still, junk input
// yields zeros rather than NaN, the billow never goes negative, the low tier
// freezes cloth, and more wind really does mean more swing.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FLUTTER_SEED, FLUTTER_MAX_YAW, FLUTTER_MAX_ROLL, FLUTTER_MAX_BILLOW,
  FLUTTER_PHASE_AMOUNT,
  flutterAmount, flutterPhase, flutterMotion, flutterEnabled
} from '../src/flutter.js';

test('the authored constants are the documented values', () => {
  assert.equal(FLUTTER_SEED, 0x51c7e3);
  assert.equal(FLUTTER_MAX_YAW, 0.32);
  assert.equal(FLUTTER_MAX_ROLL, 0.12);
  assert.equal(FLUTTER_MAX_BILLOW, 0.06);
  assert.ok(Object.isFrozen(FLUTTER_PHASE_AMOUNT));
  assert.equal(FLUTTER_PHASE_AMOUNT.day, 1);
  assert.equal(FLUTTER_PHASE_AMOUNT.dusk, 0.85);
  assert.equal(FLUTTER_PHASE_AMOUNT.night, 0.55);
});

test('the bounds are ordered so the flag swings more than it twists', () => {
  // A sanity check on the authored feel: yaw is the big motion, roll the small
  // twist, billow a few centimetres. If these ever cross, the constants are wrong.
  assert.ok(FLUTTER_MAX_YAW > FLUTTER_MAX_ROLL);
  assert.ok(FLUTTER_MAX_ROLL > FLUTTER_MAX_BILLOW);
  assert.ok(FLUTTER_MAX_BILLOW > 0 && FLUTTER_MAX_BILLOW < 0.2);
});

test('flutterAmount is per phase with night the calmest', () => {
  assert.equal(flutterAmount('day'), 1);
  assert.equal(flutterAmount('dusk'), 0.85);
  assert.equal(flutterAmount('night'), 0.55);
  assert.ok(flutterAmount('night') < flutterAmount('dusk'));
  assert.ok(flutterAmount('dusk') < flutterAmount('day'));
});

test('flutterAmount falls back to the day value for junk and unknown phases', () => {
  for (const junk of [undefined, null, NaN, 42, {}, [], 'dawn', 'DAY', '']) {
    assert.equal(flutterAmount(junk), FLUTTER_PHASE_AMOUNT.day);
  }
});

test('flutterPhase is deterministic for a given index and seed', () => {
  for (let i = 0; i < 50; i += 1) {
    assert.equal(flutterPhase(i), flutterPhase(i));
    assert.equal(flutterPhase(i, FLUTTER_SEED), flutterPhase(i, FLUTTER_SEED));
  }
});

test('flutterPhase stays in [0, 1)', () => {
  for (let i = 0; i < 200; i += 1) {
    const p = flutterPhase(i);
    assert.ok(p >= 0 && p < 1, `phase ${p} left [0,1)`);
  }
});

test('flutterPhase spreads a row of flags instead of moving in lockstep', () => {
  const values = new Set();
  for (let i = 0; i < 20; i += 1) values.add(flutterPhase(i));
  assert.ok(values.size >= 15, `only ${values.size} distinct phases across 20 flags`);
});

test('flutterPhase folds a junk index to index 0', () => {
  const zero = flutterPhase(0);
  for (const junk of [undefined, null, NaN, Infinity, -Infinity, 'x', {}, []]) {
    assert.equal(flutterPhase(junk), zero);
  }
});

test('flutterPhase folds a junk seed to the authored seed', () => {
  assert.equal(flutterPhase(7, NaN), flutterPhase(7, FLUTTER_SEED));
  assert.equal(flutterPhase(7, undefined), flutterPhase(7, FLUTTER_SEED));
  assert.equal(flutterPhase(7, 'seed'), flutterPhase(7, FLUTTER_SEED));
});

test('flutterPhase gives different offsets to different indices', () => {
  // Neighbouring flags must not share a phase, or the row pulses as one.
  assert.notEqual(flutterPhase(0), flutterPhase(1));
  assert.notEqual(flutterPhase(1), flutterPhase(2));
});

test('flutterMotion is exactly still at strength 0', () => {
  for (const offset of [0, 0.25, 0.5, 0.9]) {
    for (const time of [0, 1.5, 42, 1000]) {
      const m = flutterMotion(time, offset, 0);
      assert.equal(m.yaw, 0);
      assert.equal(m.roll, 0);
      assert.equal(m.billow, 0);
    }
  }
});

test('flutterMotion stays within its bounds across a long sweep', () => {
  // 0..200 s in 0.01 steps for several offsets and strengths: every channel
  // finite and inside its authored bound.
  for (const offset of [0, 0.13, 0.5, 0.77]) {
    for (const strength of [0.2, 0.5, 1]) {
      for (let t = 0; t <= 200; t += 0.01) {
        const m = flutterMotion(t, offset, strength);
        assert.ok(Number.isFinite(m.yaw), 'yaw not finite');
        assert.ok(Number.isFinite(m.roll), 'roll not finite');
        assert.ok(Number.isFinite(m.billow), 'billow not finite');
        assert.ok(Math.abs(m.yaw) <= FLUTTER_MAX_YAW + 1e-12, `yaw ${m.yaw} out of bound`);
        assert.ok(Math.abs(m.roll) <= FLUTTER_MAX_ROLL + 1e-12, `roll ${m.roll} out of bound`);
        assert.ok(m.billow >= 0 && m.billow <= FLUTTER_MAX_BILLOW + 1e-12, `billow ${m.billow} out of bound`);
      }
    }
  }
});

test('flutterMotion is bit-for-bit deterministic', () => {
  for (const offset of [0, 0.3, 0.6]) {
    for (const time of [0, 2.5, 17.25, 133]) {
      assert.deepEqual(flutterMotion(time, offset, 0.8), flutterMotion(time, offset, 0.8));
    }
  }
});

test('flutterMotion gives zeros, not NaN, for junk input', () => {
  for (const junk of [undefined, null, NaN, Infinity, -Infinity, 'x', {}, []]) {
    const m = flutterMotion(junk, junk, junk);
    assert.equal(m.yaw, 0);
    assert.equal(m.roll, 0);
    assert.equal(m.billow, 0);
  }
});

test('flutterMotion treats a non-finite time as 0 but keeps a finite strength', () => {
  // A junk time reads as 0; with a real strength the cloth still moves, it just
  // samples the wave at t=0 rather than collapsing to stillness.
  const atZero = flutterMotion(0, 0.4, 0.9);
  const junkTime = flutterMotion(NaN, 0.4, 0.9);
  assert.deepEqual(junkTime, atZero);
  assert.ok(Math.abs(junkTime.yaw) > 0 || Math.abs(junkTime.roll) > 0 || junkTime.billow > 0);
});

test('flutterMotion clamps an out-of-range strength to [0, 1]', () => {
  // A strength above 1 behaves like 1, and a negative one like 0.
  for (const time of [0, 3.3, 50]) {
    assert.deepEqual(flutterMotion(time, 0.5, 5), flutterMotion(time, 0.5, 1));
    assert.deepEqual(flutterMotion(time, 0.5, -5), flutterMotion(time, 0.5, 0));
  }
});

test('flutterMotion billow is never negative', () => {
  // The free edge bulges outward only; cloth does not push through itself.
  for (const offset of [0, 0.2, 0.4, 0.6, 0.8]) {
    for (let t = 0; t <= 120; t += 0.05) {
      const m = flutterMotion(t, offset, 1);
      assert.ok(m.billow >= 0, `billow ${m.billow} went negative`);
    }
  }
});

test('an out-of-range offset shifts the wave without breaking continuity', () => {
  // Offsets outside [0,1) are allowed; the motion must stay bounded and vary
  // smoothly (no jump) as the offset is nudged across an integer boundary.
  for (const off of [-3, -1, 0, 1, 2.5, 7]) {
    const m = flutterMotion(12.5, off, 1);
    assert.ok(Number.isFinite(m.yaw) && Number.isFinite(m.roll) && Number.isFinite(m.billow));
    assert.ok(Math.abs(m.yaw) <= FLUTTER_MAX_YAW + 1e-12);
  }
  // Continuity: just below and just above offset 1 must be close.
  const below = flutterMotion(12.5, 1 - 1e-6, 1);
  const above = flutterMotion(12.5, 1 + 1e-6, 1);
  assert.ok(Math.abs(below.yaw - above.yaw) < 1e-3, 'yaw jumped across the offset boundary');
});

test('more wind produces a larger peak yaw over a fixed window', () => {
  const peakYaw = (strength) => {
    let peak = 0;
    for (let t = 0; t <= 60; t += 0.02) {
      peak = Math.max(peak, Math.abs(flutterMotion(t, 0.37, strength).yaw));
    }
    return peak;
  };
  const gentle = peakYaw(0.2);
  const strong = peakYaw(1.0);
  assert.ok(strong > gentle, `peak yaw did not grow with wind (${strong} vs ${gentle})`);
});

test('flutterEnabled is false only for the low tier', () => {
  assert.equal(flutterEnabled('low'), false);
  for (const tier of ['full', 'high', 'medium', '', 'LOW', 'Low']) {
    assert.equal(flutterEnabled(tier), true);
  }
});

test('flutterEnabled treats junk as enabled', () => {
  for (const junk of [undefined, null, NaN, 42, {}, []]) {
    assert.equal(flutterEnabled(junk), true);
  }
});

test('a zero strength and a full strength bracket the whole motion range', () => {
  // Sweeping strength 0..1 at a fixed offset, the peak |yaw| grows monotonically
  // enough that full strength dominates half strength, which dominates still air.
  const peak = (strength) => {
    let p = 0;
    for (let t = 0; t <= 80; t += 0.02) p = Math.max(p, Math.abs(flutterMotion(t, 0.5, strength).yaw));
    return p;
  };
  assert.equal(peak(0), 0);
  assert.ok(peak(1) > peak(0.5));
  assert.ok(peak(0.5) > peak(0));
});

test('the phase multiplier scales the motion through strength', () => {
  // flutterAmount is the per-phase multiplier a caller folds into strength; a
  // calmer phase (night) must yield a smaller peak than a livelier one (day).
  const peakFor = (phaseId) => {
    const amount = flutterAmount(phaseId);
    let p = 0;
    for (let t = 0; t <= 60; t += 0.02) p = Math.max(p, Math.abs(flutterMotion(t, 0.2, amount).yaw));
    return p;
  };
  assert.ok(peakFor('day') > peakFor('night'));
});