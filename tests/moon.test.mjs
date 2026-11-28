import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MOON_DISTANCE, MOON_CORE_RADIUS, MOON_GLOW_RADIUS, MOON_COLOR,
  MOON_PHASE_VISIBILITY, moonVisibility, MOON_POSITION, moonDiscPosition,
  MOON_GLOW_OPACITY
} from '../src/moon.js';

test('constants are numbers and sensible', () => {
  assert.equal(typeof MOON_DISTANCE, 'number');
  assert.equal(typeof MOON_CORE_RADIUS, 'number');
  assert.equal(typeof MOON_GLOW_RADIUS, 'number');
  assert.ok(MOON_DISTANCE > 0);
  assert.ok(MOON_CORE_RADIUS > 0);
  assert.ok(MOON_GLOW_RADIUS > MOON_CORE_RADIUS);
  assert.ok(MOON_DISTANCE + MOON_GLOW_RADIUS < 120);
});

test('MOON_PHASE_VISIBILITY has day/dusk/night keys with sensible values', () => {
  assert.ok(Object.prototype.hasOwnProperty.call(MOON_PHASE_VISIBILITY, 'day'));
  assert.ok(Object.prototype.hasOwnProperty.call(MOON_PHASE_VISIBILITY, 'dusk'));
  assert.ok(Object.prototype.hasOwnProperty.call(MOON_PHASE_VISIBILITY, 'night'));
  assert.equal(MOON_PHASE_VISIBILITY.day, 0);
  assert.equal(MOON_PHASE_VISIBILITY.night, 1);
  assert.ok(MOON_PHASE_VISIBILITY.dusk > MOON_PHASE_VISIBILITY.day);
  assert.ok(MOON_PHASE_VISIBILITY.dusk < MOON_PHASE_VISIBILITY.night);
  assert.equal(moonVisibility('midnight'), 0);
  assert.equal(moonVisibility(undefined), 0);
});

test('moonVisibility returns the right value per phase and unknown', () => {
  assert.equal(moonVisibility('day'), 0);
  assert.equal(moonVisibility('dusk'), 0.3);
  assert.equal(moonVisibility('night'), 1);
  assert.equal(moonVisibility('nope'), 0);
});

test('moonVisibility ordering: night > dusk > day', () => {
  assert.ok(moonVisibility('night') > moonVisibility('dusk'));
  assert.ok(moonVisibility('dusk') > moonVisibility('day'));
});

test('moonDiscPosition normalizes to MOON_DISTANCE', () => {
  const p = moonDiscPosition(MOON_POSITION);
  const len = Math.hypot(p.x, p.y, p.z);
  assert.ok(Math.abs(len - MOON_DISTANCE) < 1e-9);
  // direction preserved
  const [x, y, z] = MOON_POSITION;
  const origLen = Math.hypot(x, y, z);
  const dot = (p.x * x + p.y * y + p.z * z) / (MOON_DISTANCE * origLen);
  assert.ok(Math.abs(dot - 1) < 1e-9);
});

test('moonDiscPosition guards a zero vector without producing NaN', () => {
  // Mirrors sunDiscPosition in src/graphics.js: len || 1 keeps the division
  // finite, so a degenerate input collapses to the origin instead of NaN.
  const p = moonDiscPosition([0, 0, 0]);
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
  assert.equal(p.x, 0);
  assert.equal(p.y, 0);
  assert.equal(p.z, 0);
});

test('MOON_COLOR is a number', () => {
  assert.equal(typeof MOON_COLOR, 'number');
});

test('MOON_POSITION is a 3-element array of finite numbers', () => {
  assert.ok(Array.isArray(MOON_POSITION));
  assert.equal(MOON_POSITION.length, 3);
  for (const v of MOON_POSITION) assert.ok(Number.isFinite(v));
});

test('MOON_GLOW_OPACITY is a number', () => {
  assert.equal(typeof MOON_GLOW_OPACITY, 'number');
});
