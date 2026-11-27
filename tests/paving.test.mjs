// The paving module is the one place that answers "what is the paved surface
// height under this point": the plaza disc, the market lane floor, the terrace
// slab, the ramp and the grass. These tests hold it to its contract: the three
// authored constants, each surface's height and kind, the inclusive lane and
// disc bounds, the terrace-first priority over the plaza disc, the ramp heights
// from floorHeightAt, the junk-input fallbacks, overlayHeightAt's lift clamping
// and ordering, and a determinism sweep proving no NaN.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PLAZA_DISC_RADIUS, PLAZA_SURFACE_Y, LANE_SURFACE_Y, MAX_OVERLAY_LIFT,
  pavingKindAt, surfaceHeightAt, overlayHeightAt
} from '../src/paving.js';

import { TERRACE, floorHeightAt } from '../src/terrain.js';
import { LANE } from '../src/areas.js';

// The three ground-overlay lifts world.js ships, in stacking order: contact
// shadow 2 mm, moss 3 mm, puddle 12 mm.
const SHADOW_LIFT = 0.002;
const MOSS_LIFT = 0.003;
const PUDDLE_LIFT = 0.012;

test('the authored constants are the ones the world relies on', () => {
  assert.equal(PLAZA_DISC_RADIUS, 9);
  assert.equal(PLAZA_SURFACE_Y, 0.01);
  assert.equal(LANE_SURFACE_Y, 0.02);
  assert.equal(MAX_OVERLAY_LIFT, 1);
  assert.ok(PLAZA_SURFACE_Y > 0 && PLAZA_SURFACE_Y < LANE_SURFACE_Y);
  assert.ok(LANE_SURFACE_Y < TERRACE.height);
  // The three shipped overlay lifts all fit under the clamp ceiling.
  for (const lift of [SHADOW_LIFT, MOSS_LIFT, PUDDLE_LIFT]) {
    assert.ok(lift > 0 && lift < MAX_OVERLAY_LIFT);
  }
});

test('the plaza interior sits at the disc height and grass lies just outside', () => {
  assert.equal(surfaceHeightAt(0, 0), PLAZA_SURFACE_Y);
  assert.equal(surfaceHeightAt(0, 0), 0.01);
  // A point just outside r9 is grass (height 0) unless another surface claims it.
  const outside = PLAZA_DISC_RADIUS + 0.001;
  assert.equal(surfaceHeightAt(outside, 0), 0);
  assert.equal(pavingKindAt(outside, 0), 'grass');
});

test('each lane corner is inclusive and sits at the lane height', () => {
  const corners = [
    [LANE.minX, LANE.minZ],
    [LANE.minX, LANE.maxZ],
    [LANE.maxX, LANE.minZ],
    [LANE.maxX, LANE.maxZ]
  ];
  for (const [x, z] of corners) {
    assert.equal(surfaceHeightAt(x, z), LANE_SURFACE_Y, `corner ${x},${z}`);
    assert.equal(surfaceHeightAt(x, z), 0.02);
    assert.equal(pavingKindAt(x, z), 'lane');
  }
});

test('a point a centimetre outside the lane falls back correctly', () => {
  // minX is 6, minZ is -26, maxX is 14, maxZ is -17.5; one centimetre past
  // maxX stays off the lane and (being well outside the plaza disc) is grass.
  const x = LANE.maxX + 0.01;
  const z = (LANE.minZ + LANE.maxZ) / 2;
  assert.equal(surfaceHeightAt(x, z), 0);
  assert.equal(pavingKindAt(x, z), 'grass');
});

test('the terrace centre sits at the slab height', () => {
  const cx = (TERRACE.minX + TERRACE.maxX) / 2;
  const cz = (TERRACE.minZ + TERRACE.maxZ) / 2;
  assert.equal(surfaceHeightAt(cx, cz), TERRACE.height);
  assert.equal(surfaceHeightAt(cx, cz), 1.2);
  assert.equal(pavingKindAt(cx, cz), 'terrace');
});

test('the ramp runs from 0 at the plaza end to 1.2 at the terrace lip', () => {
  const r = TERRACE.ramp;
  const midX = (r.minX + r.maxX) / 2;
  const plazaEnd = r.maxZ;
  const terraceLip = r.minZ;
  const midpoint = (r.minZ + r.maxZ) / 2;

  assert.ok(Math.abs(surfaceHeightAt(midX, plazaEnd) - 0) < 1e-9);
  // The lip is the shared edge with the terrace rectangle, so the terrace branch
  // wins there by design (inclusive bounds, terrace first); the ramp height at
  // the lip is the same 1.2 either way.
  assert.ok(Math.abs(surfaceHeightAt(midX, terraceLip) - 1.2) < 1e-9);
  assert.ok(Math.abs(surfaceHeightAt(midX, midpoint) - 0.6) < 1e-9);
  assert.equal(pavingKindAt(midX, plazaEnd), 'ramp');
  assert.equal(pavingKindAt(midX, midpoint), 'ramp');
  // The height is exactly floorHeightAt, not a re-derivation.
  assert.equal(surfaceHeightAt(midX, midpoint), floorHeightAt(midX, midpoint));
});

test('a point at (0, -14.85) on the terrace resolves to 1.2 with kind terrace', () => {
  const x = 0;
  const z = -14.85;
  assert.ok(z >= TERRACE.minZ && z <= TERRACE.maxZ, 'test point must be on the terrace');
  assert.equal(surfaceHeightAt(x, z), TERRACE.height);
  assert.equal(surfaceHeightAt(x, z), 1.2);
  assert.equal(pavingKindAt(x, z), 'terrace');
});

test('a ramp point inside the disc resolves to the ramp height with kind ramp', () => {
  // z = -9 sits inside the ramp (minZ -13.2 .. maxZ -8.6) and on the disc
  // edge (hypot 9 <= 9), so the terrace-first rule is exercised against the
  // plaza branch rather than against grass.
  const x = 0;
  const z = -9;
  assert.ok(Math.hypot(x, z) <= PLAZA_DISC_RADIUS, 'ramp point must be inside the disc');
  const expected = TERRACE.height * ((TERRACE.ramp.maxZ - z) / (TERRACE.ramp.maxZ - TERRACE.ramp.minZ));
  assert.ok(Math.abs(surfaceHeightAt(x, z) - expected) < 1e-9);
  assert.equal(pavingKindAt(x, z), 'ramp');
});

test('kinds agree with heights across all five surfaces', () => {
  assert.equal(pavingKindAt(0, 0), 'plaza');
  assert.equal(pavingKindAt((LANE.minX + LANE.maxX) / 2, (LANE.minZ + LANE.maxZ) / 2), 'lane');
  assert.equal(pavingKindAt(100, 100), 'grass');
  assert.equal(surfaceHeightAt(100, 100), 0);
});

test('every junk input returns a finite height and a string kind without throwing', () => {
  const junk = [NaN, Infinity, -Infinity, undefined, null, 'x', '0', {}, [], 42n, true, () => {}];
  for (const x of junk) {
    for (const z of junk) {
      assert.doesNotThrow(() => surfaceHeightAt(x, z));
      assert.doesNotThrow(() => pavingKindAt(x, z));
      assert.doesNotThrow(() => overlayHeightAt(x, z, 0.003));
      const h = surfaceHeightAt(x, z);
      assert.ok(Number.isFinite(h), `height not finite for ${String(x)},${String(z)}`);
      assert.equal(h, 0, 'junk reads as grass height 0');
      const k = pavingKindAt(x, z);
      assert.equal(typeof k, 'string');
      assert.equal(k, 'grass');
    }
  }
});

test('overlayHeightAt returns exactly surface + lift on plaza, lane and terrace', () => {
  const spots = [
    { name: 'plaza', x: 0, z: 0 },
    { name: 'lane', x: (LANE.minX + LANE.maxX) / 2, z: (LANE.minZ + LANE.maxZ) / 2 },
    { name: 'terrace', x: 0, z: (TERRACE.minZ + TERRACE.maxZ) / 2 }
  ];
  for (const spot of spots) {
    const base = surfaceHeightAt(spot.x, spot.z);
    for (const lift of [SHADOW_LIFT, MOSS_LIFT, PUDDLE_LIFT]) {
      assert.equal(
        overlayHeightAt(spot.x, spot.z, lift),
        base + lift,
        `${spot.name} lift ${lift}`
      );
    }
  }
});

test('the three shipped lifts stay strictly ordered on every surface', () => {
  const spots = [
    { name: 'plaza', x: 0, z: 0 },
    { name: 'lane', x: (LANE.minX + LANE.maxX) / 2, z: (LANE.minZ + LANE.maxZ) / 2 },
    { name: 'terrace', x: 0, z: (TERRACE.minZ + TERRACE.maxZ) / 2 }
  ];
  for (const spot of spots) {
    const shadow = overlayHeightAt(spot.x, spot.z, SHADOW_LIFT);
    const moss = overlayHeightAt(spot.x, spot.z, MOSS_LIFT);
    const puddle = overlayHeightAt(spot.x, spot.z, PUDDLE_LIFT);
    assert.ok(shadow < moss, `${spot.name}: shadow must sit below moss`);
    assert.ok(moss < puddle, `${spot.name}: moss must sit below puddle`);
  }
});

test('overlayHeightAt clamps junk, negative and absurd lifts', () => {
  const x = 0;
  const z = 0;
  const base = surfaceHeightAt(x, z);
  // Junk / negative / non-number reads as 0 lift.
  for (const junk of [NaN, Infinity, -Infinity, undefined, null, 'x', {}, [], -0.5, -1e9, 42n]) {
    assert.equal(overlayHeightAt(x, z, junk), base, `lift ${String(junk)} did not read as 0`);
  }
  // Absurd finite lift clamps to the ceiling.
  assert.equal(overlayHeightAt(x, z, 1e9), base + MAX_OVERLAY_LIFT);
  assert.equal(overlayHeightAt(x, z, MAX_OVERLAY_LIFT), base + MAX_OVERLAY_LIFT);
});

test('overlayHeightAt never yields NaN or Infinity over a junk grid', () => {
  const junk = [NaN, Infinity, -Infinity, undefined, null, 'x', {}, [], 1e9, -1e9];
  for (const x of junk) {
    for (const z of junk) {
      for (const lift of junk) {
        const h = overlayHeightAt(x, z, lift);
        assert.ok(Number.isFinite(h), `not finite for ${String(x)},${String(z)},${String(lift)}`);
      }
    }
  }
});

test('a determinism sweep over a grid is stable and all finite', () => {
  for (let x = -20; x <= 20; x += 1.5) {
    for (let z = -30; z <= 20; z += 1.5) {
      const h1 = surfaceHeightAt(x, z);
      const h2 = surfaceHeightAt(x, z);
      assert.equal(h1, h2, `surfaceHeightAt unstable at ${x},${z}`);
      assert.ok(Number.isFinite(h1));
      const k1 = pavingKindAt(x, z);
      const k2 = pavingKindAt(x, z);
      assert.equal(k1, k2);
      const o1 = overlayHeightAt(x, z, PUDDLE_LIFT);
      const o2 = overlayHeightAt(x, z, PUDDLE_LIFT);
      assert.equal(o1, o2);
      assert.ok(Number.isFinite(o1));
    }
  }
});