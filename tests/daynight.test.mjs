// Day/night cycle: phases, wrapping, labels and the dusk rule.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CYCLE_SECONDS, PHASES, wrapClock, phaseAt, phaseProgress, phaseRemaining,
  clockLabel, nextPhaseStart, lanternsLit, nightFraction
} from '../src/daynight.js';

test('the cycle wraps in both directions', () => {
  assert.equal(wrapClock(-1), CYCLE_SECONDS - 1);
  assert.equal(wrapClock(CYCLE_SECONDS + 5), 5);
  assert.equal(wrapClock(12), 12);
  assert.equal(wrapClock(NaN), 0);
});

test('phases cover the whole cycle with no gaps or overlaps', () => {
  let total = 0;
  for (const phase of PHASES) {
    assert.equal(phase.end - phase.start > 0, true);
    total += phase.end - phase.start;
  }
  assert.equal(total, CYCLE_SECONDS);
  for (let t = 0; t < CYCLE_SECONDS; t += 0.5) {
    assert.ok(phaseAt(t), `no phase at ${t}`);
  }
});

test('phase boundaries land exactly on the next phase', () => {
  assert.equal(phaseAt(0).id, 'day');
  assert.equal(phaseAt(70).id, 'dusk');
  assert.equal(phaseAt(105).id, 'night');
  assert.equal(phaseAt(CYCLE_SECONDS - 0.01).id, 'night');
  assert.equal(phaseAt(CYCLE_SECONDS).id, 'day');
});

test('progress and remaining time agree with the phase bounds', () => {
  const phase = phaseAt(0);
  assert.equal(phaseProgress(phase.start), 0);
  assert.ok(phaseProgress(phase.end - 1) > 0.9);
  assert.equal(phaseRemaining(phase.start), phase.end - phase.start);
  // At a boundary the new phase is in effect, so the clock restarts there.
  assert.equal(phaseRemaining(phase.end), PHASES[1].end - PHASES[1].start);
  // Just before the boundary, almost no time is left.
  assert.ok(phaseRemaining(phase.end - 0.01) < 0.02);
});

test('nextPhaseStart moves forward one phase and wraps', () => {
  assert.equal(nextPhaseStart(10), PHASES[1].start);
  assert.equal(nextPhaseStart(80), PHASES[2].start);
  assert.equal(nextPhaseStart(150), PHASES[0].start);
});

test('clock labels read as plausible in-world times', () => {
  const pattern = /^\d{2}:\d{2}$/;
  for (let t = 0; t < CYCLE_SECONDS; t += 7) {
    const label = clockLabel(t);
    assert.match(label, pattern);
    const [hours, minutes] = label.split(':').map(Number);
    assert.ok(hours >= 0 && hours < 24);
    assert.ok(minutes >= 0 && minutes < 60);
  }
  assert.equal(clockLabel(PHASES[0].start), '07:00');
  assert.equal(clockLabel(PHASES[1].start), '17:00');
  assert.equal(clockLabel(PHASES[2].start), '20:00');
});

test('lanterns are only lit at dusk and night', () => {
  assert.equal(lanternsLit(10), false);
  assert.equal(lanternsLit(80), true);
  assert.equal(lanternsLit(150), true);
});

test('the night fraction advances smoothly from dusk into night', () => {
  // Day is exactly 0: nothing is lit while the sun is up.
  assert.equal(nightFraction(0), 0);
  assert.equal(nightFraction(69.99), 0);
  // Dusk starts the ramp at 0 and hands over to night at a quarter.
  assert.equal(nightFraction(70), 0);
  assert.ok(nightFraction(87.5) > 0.1 && nightFraction(87.5) < 0.15);
  assert.ok(nightFraction(104.99) > 0.24 && nightFraction(104.99) <= 0.25);
  // Night carries the remaining three quarters and ends at 1.
  assert.ok(nightFraction(105) >= 0.25 && nightFraction(105) < 0.26);
  assert.ok(nightFraction(150) > 0.55 && nightFraction(150) <= 0.7);
  assert.ok(nightFraction(179.99) > 0.99 && nightFraction(179.99) <= 1);
});

test('the night fraction is monotonic across the dark half and total on junk', () => {
  let previous = -1;
  for (let t = 70; t < CYCLE_SECONDS; t += 0.5) {
    const value = nightFraction(t);
    assert.ok(Number.isFinite(value));
    assert.ok(value >= 0 && value <= 1);
    assert.ok(value >= previous, `night fraction went backwards at ${t}`);
    previous = value;
  }
  assert.equal(nightFraction(NaN), 0);
  assert.equal(nightFraction(undefined), 0);
  assert.equal(nightFraction('night'), 0);
  // A negative or over-cycle clock wraps rather than reading as junk.
  assert.equal(nightFraction(CYCLE_SECONDS + 10), nightFraction(10));
});
