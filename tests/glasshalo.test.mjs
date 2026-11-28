// Unit tests for src/glasshalo.js -- the pure glass-pane response module.
//
// The module owns the per-pane response numbers (width, thickness, tintWarmth,
// response, wander) and the night-shaped response curve, so this suite holds
// both the curve and the totality of every export to its contract: every call
// returns finite in-range numbers, junk input can never throw or produce NaN,
// and two identical calls produce byte-identical descriptors.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GLASSHALO_SEED,
  GLASSHALO_WINDOW_WIDTH,
  GLASSHALO_LAMP_WIDTH,
  GLASSHALO_RESPONSE,
  GLASSHALO_DRIFT,
  glassHaloEnabled,
  glassHaloResponse,
  glassHaloDescriptor,
  glassHaloStrength
} from '../src/glasshalo.js';

const JUNK_ANCHORS = [
  null, undefined, 42, 'glass', NaN, Infinity, -Infinity,
  { x: 0, y: 0 }, { x: NaN, y: 0, z: 0 },
  { x: 1, y: 0, z: Infinity }, { x: 1, y: 0, z: -Infinity },
  [0, 0, 0], { x: 0, y: 0, z: 0, extra: 1 }
];

test('exports the authored response table', () => {
  assert.equal(GLASSHALO_RESPONSE.day, 0);
  assert.equal(GLASSHALO_RESPONSE.dusk, 0.9);
  assert.equal(GLASSHALO_RESPONSE.night, 1);
  assert.equal(typeof GLASSHALO_SEED, 'number');
  assert.ok(GLASSHALO_SEED > 0);
  assert.ok(GLASSHALO_WINDOW_WIDTH > GLASSHALO_LAMP_WIDTH);
  assert.ok(GLASSHALO_DRIFT > 0);
  assert.ok(GLASSHALO_DRIFT < 1);
});

test('glassHaloEnabled keeps full, drops low, junk reads full', () => {
  assert.equal(glassHaloEnabled('full'), true);
  assert.equal(glassHaloEnabled('low'), false);
  assert.equal(glassHaloEnabled(undefined), true);
  assert.equal(glassHaloEnabled(null), true);
  assert.equal(glassHaloEnabled(42), true);
  assert.equal(glassHaloEnabled({}), true);
});

test('glassHaloResponse follows the night curve, junk reads day', () => {
  assert.equal(glassHaloResponse('day'), 0);
  assert.equal(glassHaloResponse('dusk'), 0.9);
  assert.equal(glassHaloResponse('night'), 1);
  assert.equal(glassHaloResponse('midnight'), 0);
  assert.equal(glassHaloResponse(undefined), 0);
  assert.equal(glassHaloResponse(null), 0);
  assert.equal(glassHaloResponse(7), 0);
  assert.equal(glassHaloResponse({}), 0);
  assert.equal(glassHaloResponse('DUSK'), 0);
});

test('glassHaloStrength: day 0, dusk 0.9, night 1, dark lane 0', () => {
  assert.equal(glassHaloStrength('day', true), 0);
  assert.equal(glassHaloStrength('dusk', true), 0.9);
  assert.equal(glassHaloStrength('night', true), 1);
  assert.equal(glassHaloStrength('day', false), 0);
  assert.equal(glassHaloStrength('dusk', false), 0);
  assert.equal(glassHaloStrength('night', false), 0);
  // Junk args cannot flare the response.
  assert.equal(glassHaloStrength('junk', true), 0);
  assert.equal(glassHaloStrength('night', 'yes'), 1);
  assert.ok(Number.isFinite(glassHaloStrength('night', NaN)));
  assert.ok(Number.isFinite(glassHaloStrength('night', Infinity)));
});

test('a window pane draws wide, a lamp pane narrow', () => {
  const windowPane = glassHaloDescriptor('window', { x: 0, y: 1, z: 0 }, 'night', { lit: true });
  const lampPane = glassHaloDescriptor('lamp', { x: 0, y: 1, z: 0 }, 'night', { lit: true });
  assert.equal(windowPane.width, GLASSHALO_WINDOW_WIDTH);
  assert.equal(lampPane.width, GLASSHALO_LAMP_WIDTH);
  assert.ok(windowPane.thickness > lampPane.thickness);
  assert.ok(windowPane.thickness > 0);
  assert.ok(windowPane.thickness <= 1);
});

test('night panes are fully warm, day panes neutral, dusk nearly warm', () => {
  const night = glassHaloDescriptor('window', { x: 0, y: 1, z: 0 }, 'night', { lit: true });
  const dusk = glassHaloDescriptor('window', { x: 0, y: 1, z: 0 }, 'dusk', { lit: true });
  const day = glassHaloDescriptor('window', { x: 0, y: 1, z: 0 }, 'day', { lit: true });
  assert.equal(night.tintWarmth, 0.9);
  assert.equal(night.response, 1);
  assert.equal(dusk.tintWarmth, 0.81);
  assert.equal(dusk.response, 0.9);
  assert.equal(day.tintWarmth, 0);
  assert.equal(day.response, 0);
});

test('a dark lane pane gets a zero response at every hour', () => {
  for (const phase of ['day', 'dusk', 'night']) {
    const pane = glassHaloDescriptor('lamp', { x: 9, y: 2, z: -20 }, phase, { lit: false });
    assert.equal(pane.response, 0);
    assert.equal(pane.tintWarmth, 0);
    // The descriptor still states the pane's body; the glow is what is off.
    assert.equal(pane.width, GLASSHALO_LAMP_WIDTH);
    assert.ok(pane.thickness > 0);
  }
});

test('junk kinds read as the narrow (lamp) end', () => {
  const pane = glassHaloDescriptor('porthole', { x: 0, y: 0, z: 0 }, 'night', { lit: true });
  assert.equal(pane.width, GLASSHALO_LAMP_WIDTH);
  assert.equal(pane.response, 1);
});

test('junk anchors still describe a pane, with non-finite fields at the origin', () => {
  for (const anchor of JUNK_ANCHORS) {
    const pane = glassHaloDescriptor('window', anchor, 'night', { lit: true });
    for (const key of ['x', 'y', 'z']) {
      assert.ok(Number.isFinite(pane[key]), `${key} is finite`);
    }
    // A whole-anchor junk collapses to the origin...
    if (anchor == null || typeof anchor !== 'object' || Array.isArray(anchor)) {
      assert.equal(pane.x, 0);
      assert.equal(pane.y, 0);
      assert.equal(pane.z, 0);
      continue;
    }
    // ...and a partial anchor keeps its finite fields: the module's contract is
    // per-field finite-fallback, not whole-anchor rejection.
    assert.equal(pane.x, Number.isFinite(anchor.x) ? anchor.x : 0);
    assert.equal(pane.y, Number.isFinite(anchor.y) ? anchor.y : 0);
    assert.equal(pane.z, Number.isFinite(anchor.z) ? anchor.z : 0);
  }
});

test('every field of the descriptor is finite and in range', () => {
  for (const kind of ['window', 'lamp']) {
    for (const phase of ['day', 'dusk', 'night']) {
      for (const lit of [true, false]) {
        const pane = glassHaloDescriptor(kind, { x: 3, y: 1.5, z: -8 }, phase, { lit });
        for (const key of ['x', 'y', 'z', 'width', 'thickness', 'tintWarmth', 'response', 'wander']) {
          assert.ok(Number.isFinite(pane[key]), `${key} is finite`);
        }
        assert.ok(pane.width >= 0 && pane.width <= 4);
        assert.ok(pane.thickness >= 0 && pane.thickness <= 1);
        assert.ok(pane.tintWarmth >= 0 && pane.tintWarmth <= 1);
        assert.ok(pane.response >= 0 && pane.response <= 1);
        assert.ok(pane.wander >= 0 && pane.wander <= GLASSHALO_DRIFT);
      }
    }
  }
});

test('the wander is deterministic and bounded per anchor', () => {
  const a = { x: 4, y: 2, z: -3 };
  const first = glassHaloDescriptor('window', a, 'night', { lit: true });
  const second = glassHaloDescriptor('window', a, 'night', { lit: true });
  assert.equal(first.wander, second.wander);
  const other = glassHaloDescriptor('window', { x: 5, y: 2, z: -3 }, 'night', { lit: true });
  // A neighbouring pane drifts to a different value; the positional hash is
  // not degenerate across one metre.
  assert.ok(other.wander !== first.wander || GLASSHALO_DRIFT === 0);
});

test('two identical calls produce identical descriptors', () => {
  const a = { x: -10.5, y: 1.1, z: -9 };
  const one = glassHaloDescriptor('window', a, 'night', { lit: true });
  const two = glassHaloDescriptor('window', a, 'night', { lit: true });
  assert.deepEqual(one, two);
  // The curve is pure: the response does not depend on the anchor at all.
  const b = glassHaloDescriptor('lamp', { x: 9, y: 2, z: -20 }, 'dusk', { lit: true });
  const c = glassHaloDescriptor('lamp', { x: 0, y: 0, z: 0 }, 'dusk', { lit: true });
  assert.equal(b.response, c.response);
});
