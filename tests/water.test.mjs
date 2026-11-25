// Round 75: the fountain's water surface moves.
//
// Round 73 dressed the fountain's two discs with a tileable normal map, but the
// ripples stayed frozen. A normal map that never moves reads as a photograph
// of water rather than water. These tests hold the pure decisions the world
// calls: the UV step per frame, the low-tier freeze, and the steady advance of
// the shared offset.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WATER_FLOW_SPEED,
  shouldAnimateWater,
  waterOffsetStep,
  advanceWaterOffset
} from '../src/water.js';

test('water flow speed is a gentle swell, not a conveyor belt', () => {
  assert.ok(WATER_FLOW_SPEED > 0 && WATER_FLOW_SPEED < 0.2,
    `speed ${WATER_FLOW_SPEED} should read as a swell`);
});

test('the low tier freezes the surface', () => {
  assert.equal(shouldAnimateWater('low'), false);
  assert.equal(shouldAnimateWater('full'), true);
  const step = waterOffsetStep(0.016, { low: true });
  assert.equal(step.x, 0);
  assert.equal(step.y, 0);
  const stepTier = waterOffsetStep(0.016, { tier: 'low' });
  assert.equal(stepTier.x, 0);
});

test('a zero or negative dt never moves the surface', () => {
  for (const dt of [0, -0.1, NaN, Infinity]) {
    const step = waterOffsetStep(dt);
    assert.equal(step.x, 0, `dt ${dt} must not move x`);
    assert.equal(step.y, 0, `dt ${dt} must not move y`);
  }
});

test('the y step is slower than the x step, so ripples are not square', () => {
  const step = waterOffsetStep(1);
  assert.ok(Math.abs(step.y) < Math.abs(step.x),
    `y ${step.y} should lag x ${step.x}`);
});

test('the offset advances and wraps into [0, 1)', () => {
  let cur = { x: 0, y: 0 };
  for (let i = 0; i < 100; i += 1) cur = advanceWaterOffset(cur, 0.05);
  assert.ok(cur.x >= 0 && cur.x < 1, `x ${cur.x} in range`);
  assert.ok(cur.y >= 0 && cur.y < 1, `y ${cur.y} in range`);
  assert.ok(cur.x > 0 || cur.y > 0, 'the surface moved');
});

test('the low tier leaves the offset untouched', () => {
  const cur = { x: 0.3, y: 0.7 };
  const next = advanceWaterOffset(cur, 0.5, { low: true });
  assert.equal(next.x, cur.x);
  assert.equal(next.y, cur.y);
  const nextTier = advanceWaterOffset(cur, 0.5, { tier: 'low' });
  assert.equal(nextTier.x, cur.x);
  assert.equal(nextTier.y, cur.y);
});

test('advanceWaterOffset returns a new object, never mutates', () => {
  const cur = { x: 0.1, y: 0.2 };
  const snapshot = { ...cur };
  advanceWaterOffset(cur, 0.1);
  assert.deepEqual(cur, snapshot, 'the input offset must not be mutated');
});

test('a missing current offset starts from zero', () => {
  const next = advanceWaterOffset(undefined, 0.1);
  assert.ok(next.x > 0);
  assert.ok(next.y > 0);
});