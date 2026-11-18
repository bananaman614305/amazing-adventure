import test from 'node:test';
import assert from 'node:assert/strict';
import {
  stickVector, knobOffset, lookDelta, clampPitch, wantsTouchControls,
  interactLabel, STICK_RADIUS, STICK_DEADZONE, MAX_PITCH
} from '../src/touch.js';

test('pushing up on the stick moves forward', () => {
  const v = stickVector(0, -STICK_RADIUS);
  assert.ok(v.forward > 0.9, `forward ${v.forward}`);
  assert.ok(Math.abs(v.strafe) < 1e-9);
  assert.equal(v.magnitude, 1);
});

test('pulling down on the stick moves backward', () => {
  const v = stickVector(0, STICK_RADIUS);
  assert.ok(v.forward < -0.9, `forward ${v.forward}`);
});

test('pushing right strafes right, pushing left strafes left', () => {
  assert.ok(stickVector(STICK_RADIUS, 0).strafe > 0.9);
  assert.ok(stickVector(-STICK_RADIUS, 0).strafe < -0.9);
});

test('diagonal is normalised so it is not faster than straight', () => {
  const straight = stickVector(STICK_RADIUS, 0);
  const diagonal = stickVector(STICK_RADIUS * 0.707, -STICK_RADIUS * 0.707);
  const straightLen = Math.hypot(straight.forward, straight.strafe);
  const diagonalLen = Math.hypot(diagonal.forward, diagonal.strafe);
  assert.ok(Math.abs(straightLen - diagonalLen) < 0.02,
    `${straightLen.toFixed(3)} vs ${diagonalLen.toFixed(3)}`);
});

test('a resting thumb inside the deadzone produces no movement', () => {
  const inside = STICK_RADIUS * STICK_DEADZONE * 0.8;
  for (const [dx, dy] of [[inside, 0], [0, inside], [inside * 0.7, inside * 0.7]]) {
    const v = stickVector(dx, dy);
    assert.deepEqual([v.forward, v.strafe, v.magnitude], [0, 0, 0]);
  }
});

test('movement ramps smoothly from the deadzone to the rim', () => {
  const edge = STICK_RADIUS * STICK_DEADZONE;
  assert.equal(stickVector(0, -edge).magnitude, 0, 'deadzone edge is still zero');
  const mid = stickVector(0, -(edge + (STICK_RADIUS - edge) / 2));
  assert.ok(mid.magnitude > 0.4 && mid.magnitude < 0.6, `mid ${mid.magnitude}`);
  assert.ok(stickVector(0, -STICK_RADIUS).magnitude > 0.99, 'rim is full speed');
});

test('pushing past the base is clamped to full speed', () => {
  const v = stickVector(0, -STICK_RADIUS * 4);
  assert.equal(v.magnitude, 1);
  assert.ok(v.forward <= 1.0001);
});

test('garbage offsets are ignored', () => {
  for (const [dx, dy] of [[NaN, 0], [0, Infinity], [0, 0]]) {
    const v = stickVector(dx, dy);
    assert.equal(v.magnitude, 0);
    assert.ok(Number.isFinite(v.forward) && Number.isFinite(v.strafe));
  }
});

test('the knob is drawn inside the base', () => {
  assert.deepEqual(knobOffset(10, -20), { x: 10, y: -20 });
  const far = knobOffset(500, 0);
  assert.ok(Math.abs(Math.hypot(far.x, far.y) - STICK_RADIUS) < 0.001);
  assert.deepEqual(knobOffset(0, 0), { x: 0, y: 0 });
});

test('dragging right looks right and dragging down looks down', () => {
  const right = lookDelta(100, 0);
  assert.ok(right.yaw < 0, 'positive yaw turns left in this renderer');
  assert.equal(right.pitch, 0);
  const down = lookDelta(0, 100);
  assert.ok(down.pitch < 0, 'looking down is negative pitch');
  assert.equal(down.yaw, 0);
});

test('look sensitivity is consistent in both directions', () => {
  const a = lookDelta(60, -40);
  const b = lookDelta(-60, 40);
  assert.ok(Math.abs(a.yaw + b.yaw) < 1e-12);
  assert.ok(Math.abs(a.pitch + b.pitch) < 1e-12);
});

test('pitch is clamped at the poles', () => {
  assert.equal(clampPitch(10), MAX_PITCH);
  assert.equal(clampPitch(-10), -MAX_PITCH);
  assert.equal(clampPitch(0.3), 0.3);
  assert.equal(clampPitch(NaN), 0);
});

test('touch controls appear on phones and tablets, not on touchscreen laptops', () => {
  assert.equal(wantsTouchControls({ maxTouchPoints: 5, coarsePointer: true }), true, 'phone');
  assert.equal(wantsTouchControls({ maxTouchPoints: 2, coarsePointer: false }), false, 'touchscreen laptop');
  assert.equal(wantsTouchControls({ maxTouchPoints: 0, coarsePointer: false }), false, 'desktop');
  assert.equal(wantsTouchControls({ maxTouchPoints: 0, coarsePointer: true }), false, 'no touch points');
  assert.equal(wantsTouchControls({ touchOnly: true }), true, 'forced for a test');
});

test('the interact button never says E on a phone', () => {
  for (const kind of ['npc', 'key', 'ledger', 'bench', 'gate', 'notice']) {
    const label = interactLabel(kind);
    assert.ok(label.length > 1, `${kind} has a real label`);
    assert.doesNotMatch(label, /^E$/, `${kind} is not the desktop key`);
  }
  assert.equal(interactLabel('npc'), 'Talk');
  assert.equal(interactLabel(undefined), 'Use');
});

// Player integration (analog speed, look clamping) needs Three.js, which this
// project loads from a CDN import map, so it is covered in the browser suite
// instead: see the "touch" section of scripts/test-round2.mjs.
