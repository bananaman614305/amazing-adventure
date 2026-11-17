// Terrain maths: ramp profile, terrace height and step blocking.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TERRACE, STEP_HEIGHT, KEY_SPOT, floorHeightAt, onTerrace, climbsTooFar
} from '../src/terrain.js';

test('the plaza floor is flat at zero away from the terrace', () => {
  assert.equal(floorHeightAt(0, 0), 0);
  assert.equal(floorHeightAt(12, 12), 0);
  assert.equal(floorHeightAt(-14, 5), 0);
});

test('the terrace is raised to its full height', () => {
  assert.equal(floorHeightAt(0, -15), TERRACE.height);
  assert.equal(floorHeightAt(TERRACE.minX, TERRACE.minZ), TERRACE.height);
  assert.equal(onTerrace(0, -15), true);
  assert.equal(onTerrace(0, -10), false);
});

test('the ramp rises evenly from the plaza to the terrace lip', () => {
  const ramp = TERRACE.ramp;
  const foot = floorHeightAt((ramp.minX + ramp.maxX) / 2, ramp.maxZ);
  const lip = floorHeightAt((ramp.minX + ramp.maxX) / 2, ramp.minZ);
  const mid = floorHeightAt((ramp.minX + ramp.maxX) / 2, (ramp.minZ + ramp.maxZ) / 2);
  assert.equal(foot, 0);
  assert.equal(lip, TERRACE.height);
  assert.ok(Math.abs(mid - TERRACE.height / 2) < 0.02, `midpoint was ${mid}`);
});

test('the ramp is monotonic: every step north is higher', () => {
  let previous = -1;
  for (let z = TERRACE.ramp.maxZ; z >= TERRACE.ramp.minZ; z -= 0.1) {
    const height = floorHeightAt(0, z);
    assert.ok(height >= previous - 1e-9, `height dropped at z=${z}`);
    previous = height;
  }
});

test('no point on the ramp is a step taller than STEP_HEIGHT', () => {
  // Walk the ramp in small steps and confirm it can be climbed.
  let previous = { x: 0, z: TERRACE.ramp.maxZ + 0.5 };
  for (let z = TERRACE.ramp.maxZ; z >= TERRACE.ramp.minZ - 0.4; z -= 0.15) {
    const point = { x: 0, z };
    assert.equal(climbsTooFar(previous, point), false, `climb blocked at z=${z}`);
    previous = point;
  }
});

test('the terrace side wall is too tall to climb', () => {
  // From the grass just south of the terrace, stepping straight in is a 1.2m rise.
  assert.equal(climbsTooFar({ x: -4, z: -12.9 }, { x: -4, z: -13.4 }), true);
});

test('the ramp is narrower than the terrace and inside the play area', () => {
  assert.ok(TERRACE.ramp.minX > TERRACE.minX && TERRACE.ramp.maxX < TERRACE.maxX);
  assert.ok(TERRACE.ramp.maxZ > TERRACE.maxZ, 'ramp starts in front of the terrace');
  assert.ok(STEP_HEIGHT > 0 && STEP_HEIGHT < TERRACE.height);
});

test('the key spot is on open grass outside colliders and off the terrace', () => {
  assert.equal(floorHeightAt(KEY_SPOT.x, KEY_SPOT.z), 0);
  assert.equal(onTerrace(KEY_SPOT.x, KEY_SPOT.z), false);
  assert.ok(Math.abs(KEY_SPOT.x) < 15 && Math.abs(KEY_SPOT.z) < 15, 'inside the courtyard');
});
