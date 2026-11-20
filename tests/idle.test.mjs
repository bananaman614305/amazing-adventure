// Idle behaviour is pure maths, so these assert exact timing and bounds
// rather than watching a renderer.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  weightShift, glanceAngle,
  SHIFT_PERIOD, SHIFT_MAX, GLANCE_PERIOD, GLANCE_DURATION, GLANCE_MAX
} from '../src/idle.js';

test('weight shift stays within its lean budget', () => {
  for (let t = 0; t < 60; t += 0.05) {
    const v = weightShift(t, 1.7);
    assert.ok(Math.abs(v) <= SHIFT_MAX + 1e-9, `lean ${v} at t=${t}`);
  }
});

test('weight shift actually moves, rather than sitting at zero', () => {
  const values = [];
  for (let t = 0; t < SHIFT_PERIOD; t += 0.1) values.push(weightShift(t, 0));
  const spread = Math.max(...values) - Math.min(...values);
  assert.ok(spread > SHIFT_MAX, 'the sway spans a real range');
});

test('weight shift is periodic', () => {
  for (const seed of [0, 1.3, 4.2]) {
    for (const t of [0.3, 2.9, 5.5]) {
      assert.ok(Math.abs(weightShift(t, seed) - weightShift(t + SHIFT_PERIOD, seed)) < 1e-9,
        `seed ${seed} t ${t}`);
    }
  }
});

test('different seeds shift on different schedules', () => {
  const a = weightShift(1.0, 0);
  const b = weightShift(1.0, 2.5);
  assert.ok(Math.abs(a - b) > 1e-3, 'cast members do not sway in unison');
});

test('a glance is zero for most of its cycle', () => {
  let quiet = 0;
  let total = 0;
  for (let t = 0; t < GLANCE_PERIOD * 4; t += 0.05) {
    total += 1;
    if (glanceAngle(t, 0.9) === 0) quiet += 1;
  }
  // The glance window is GLANCE_DURATION of GLANCE_PERIOD; the rest is rest.
  const expectedQuiet = 1 - GLANCE_DURATION / GLANCE_PERIOD;
  assert.ok(quiet / total > expectedQuiet - 0.03,
    `quiet fraction ${(quiet / total).toFixed(3)} vs expected ${expectedQuiet.toFixed(3)}`);
});

test('a glance stays within its turn budget and never spins round', () => {
  for (let t = 0; t < GLANCE_PERIOD * 6; t += 0.02) {
    const v = glanceAngle(t, 2.2);
    assert.ok(Math.abs(v) <= GLANCE_MAX + 1e-9, `glance ${v} at t=${t}`);
  }
  assert.ok(GLANCE_MAX < 0.9, 'a glance must stay inside the attention clamp');
});

test('glances alternate direction between cycles', () => {
  const peakOf = (cycle) => {
    let peak = 0;
    const base = cycle * GLANCE_PERIOD;
    for (let t = base; t < base + GLANCE_DURATION; t += 0.01) {
      const v = glanceAngle(t, 0);
      if (Math.abs(v) > Math.abs(peak)) peak = v;
    }
    return peak;
  };
  const first = peakOf(0);
  const second = peakOf(1);
  assert.ok(first > 0 && second < 0, `first ${first} second ${second}`);
});

test('a glance starts and ends at rest, with no jump', () => {
  // Sample either side of the window boundary; the value must approach zero.
  const start = Math.abs(glanceAngle(0.001, 0));
  const end = Math.abs(glanceAngle(GLANCE_DURATION - 0.001, 0));
  const after = glanceAngle(GLANCE_DURATION + 0.001, 0);
  assert.ok(start < 0.01, `start ${start}`);
  assert.ok(end < 0.01, `end ${end}`);
  assert.equal(after, 0, 'the head is at rest once the glance is over');
});

test('glance is periodic across the whole cycle', () => {
  for (let t = 0.2; t < GLANCE_PERIOD; t += 0.7) {
    assert.ok(Math.abs(glanceAngle(t, 1.1) - glanceAngle(t + GLANCE_PERIOD * 2, 1.1)) < 1e-9,
      `t ${t}`);
  }
});

test('non-finite time is treated as rest, not NaN', () => {
  for (const bad of [NaN, Infinity, -Infinity, undefined]) {
    assert.equal(weightShift(bad, 0), 0);
    assert.equal(glanceAngle(bad, 0), 0);
  }
});
