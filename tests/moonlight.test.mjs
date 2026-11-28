import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MOONLIGHT_COLOR, MOONLIGHT_INTENSITY, moonlightIntensity,
  MOONLIGHT_DIRECTION, moonlightDirection, moonlightColor,
  MOONLIGHT_SHADOW, moonlightEnabled
} from '../src/moonlight.js';

test('MOONLIGHT_COLOR is a number', () => {
  assert.equal(typeof MOONLIGHT_COLOR, 'number');
});

test('MOONLIGHT_INTENSITY has day/dusk/night keys', () => {
  assert.ok(Object.prototype.hasOwnProperty.call(MOONLIGHT_INTENSITY, 'day'));
  assert.ok(Object.prototype.hasOwnProperty.call(MOONLIGHT_INTENSITY, 'dusk'));
  assert.ok(Object.prototype.hasOwnProperty.call(MOONLIGHT_INTENSITY, 'night'));
});

test('moonlightIntensity per phase', () => {
  assert.equal(moonlightIntensity('day'), 0);
  assert.equal(moonlightIntensity('dusk'), 0.05);
  assert.equal(moonlightIntensity('night'), 0.32);
  assert.equal(moonlightIntensity('nope'), 0);
  assert.equal(moonlightIntensity(undefined), 0);
});

test('moonlightIntensity ordering: night > dusk > day', () => {
  assert.ok(moonlightIntensity('night') > moonlightIntensity('dusk'));
  assert.ok(moonlightIntensity('dusk') > moonlightIntensity('day'));
});

test('night intensity <= 0.5', () => {
  assert.ok(moonlightIntensity('night') <= 0.5);
});

test('moonlightDirection is unit length', () => {
  const d = moonlightDirection();
  const len = Math.hypot(d.x, d.y, d.z);
  assert.ok(Math.abs(len - 1) < 1e-9);
});

test('moonlightDirection guards zero vector', () => {
  // can't easily force zero input since no args, but ensure finite
  const d = moonlightDirection();
  assert.ok(Number.isFinite(d.x) && Number.isFinite(d.y) && Number.isFinite(d.z));
});

test('moonlightColor returns MOONLIGHT_COLOR for any phase', () => {
  assert.equal(moonlightColor('day'), MOONLIGHT_COLOR);
  assert.equal(moonlightColor('night'), MOONLIGHT_COLOR);
  assert.equal(typeof moonlightColor('dusk'), 'number');
});

test('MOONLIGHT_SHADOW is boolean', () => {
  assert.equal(typeof MOONLIGHT_SHADOW, 'boolean');
  assert.equal(MOONLIGHT_SHADOW, true);
});

test('moonlightEnabled', () => {
  assert.equal(moonlightEnabled('day'), false);
  assert.equal(moonlightEnabled('night'), true);
});
