// The kerb module decides the dimensions of the stone kerb around the plaza
// disc and the plinth around the lane rectangle, and nothing else. These tests
// hold it to its contract: the authored constants, the total guards, the clamps,
// the tier gates, and the determinism (there is no randomness, so determinism
// is trivially the constant result).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PLAZA_RADIUS,
  PLAZA_KERB_TUBE,
  PLAZA_KERB_MAJOR,
  PLAZA_KERB_SEGMENTS,
  PLAZA_KERB_TUBE_SEGMENTS,
  LANE_PLINTH_HEIGHT,
  LANE_PLINTH_WIDTH,
  kerbEnabled,
  plinthEnabled,
  plazaKerbSpec,
  lanePlinthSpec
} from '../src/kerb.js';

test('the authored constants keep their values', () => {
  assert.equal(PLAZA_RADIUS, 9);
  assert.equal(PLAZA_KERB_TUBE, 0.06);
  assert.equal(PLAZA_KERB_MAJOR, 9 + 0.06 / 2);
  assert.equal(PLAZA_KERB_SEGMENTS, 48);
  assert.equal(PLAZA_KERB_TUBE_SEGMENTS, 8);
  assert.equal(LANE_PLINTH_HEIGHT, 0.04);
  assert.equal(LANE_PLINTH_WIDTH, 0.12);
});

test('kerbEnabled is true except on the low tier', () => {
  assert.equal(kerbEnabled('full'), true);
  assert.equal(kerbEnabled('low'), false);
  assert.equal(kerbEnabled(undefined), true);
  assert.equal(kerbEnabled(null), true);
  assert.equal(kerbEnabled(42), true);
  assert.equal(kerbEnabled({}), true);
});

test('plinthEnabled follows the same rule', () => {
  assert.equal(plinthEnabled('full'), true);
  assert.equal(plinthEnabled('low'), false);
  assert.equal(plinthEnabled(undefined), true);
  assert.equal(plinthEnabled(null), true);
});

test('plazaKerbSpec defaults match the constants', () => {
  const s = plazaKerbSpec();
  assert.equal(s.majorRadius, PLAZA_KERB_MAJOR);
  assert.equal(s.tubeRadius, PLAZA_KERB_TUBE);
  assert.equal(s.segments, PLAZA_KERB_SEGMENTS);
  assert.equal(s.tubeSegments, PLAZA_KERB_TUBE_SEGMENTS);
  assert.equal(s.y, PLAZA_KERB_TUBE / 2);
});

test('plazaKerbSpec junk input does not throw and yields defaults', () => {
  for (const bad of [null, undefined, 42, 'x', [1, 2], NaN]) {
    const s = plazaKerbSpec(bad);
    assert.equal(s.majorRadius, PLAZA_KERB_MAJOR);
    assert.equal(s.tubeRadius, PLAZA_KERB_TUBE);
    assert.equal(s.segments, PLAZA_KERB_SEGMENTS);
    assert.equal(s.tubeSegments, PLAZA_KERB_TUBE_SEGMENTS);
    assert.ok(Number.isFinite(s.y));
  }
});

test('plazaKerbSpec ignores junk override fields', () => {
  const s = plazaKerbSpec({ tube: 'x', major: NaN, segments: Infinity, tubeSegments: null });
  assert.equal(s.tubeRadius, PLAZA_KERB_TUBE);
  assert.equal(s.majorRadius, PLAZA_KERB_MAJOR);
  assert.equal(s.segments, PLAZA_KERB_SEGMENTS);
  assert.equal(s.tubeSegments, PLAZA_KERB_TUBE_SEGMENTS);
});

test('plazaKerbSpec clamps tube to [0.004, 1]', () => {
  assert.equal(plazaKerbSpec({ tube: 0 }).tubeRadius, 0.004);
  assert.equal(plazaKerbSpec({ tube: 5 }).tubeRadius, 1);
  assert.equal(plazaKerbSpec({ tube: 0.03 }).tubeRadius, 0.03);
});

test('plazaKerbSpec clamps major to [tube, 100]', () => {
  const s = plazaKerbSpec({ tube: 0.06, major: 0.01 });
  assert.equal(s.majorRadius, 0.06);
  const s2 = plazaKerbSpec({ tube: 0.06, major: 500 });
  assert.equal(s2.majorRadius, 100);
});

test('plazaKerbSpec rounds segment counts into range', () => {
  assert.equal(plazaKerbSpec({ segments: 3 }).segments, 8);
  assert.equal(plazaKerbSpec({ segments: 200 }).segments, 128);
  assert.equal(plazaKerbSpec({ segments: 12.6 }).segments, 13);
  assert.equal(plazaKerbSpec({ tubeSegments: 2 }).tubeSegments, 4);
  assert.equal(plazaKerbSpec({ tubeSegments: 32 }).tubeSegments, 16);
});

test('plazaKerbSpec y is tube/2', () => {
  assert.equal(plazaKerbSpec({ tube: 0.1 }).y, 0.05);
  assert.equal(plazaKerbSpec({ tube: 0.004 }).y, 0.002);
});

test('plazaKerbSpec never emits NaN or Infinity', () => {
  const cases = [{}, null, { tube: 1e308, major: -1e308, segments: 0.1, tubeSegments: 0.1 }, { tube: -5 }];
  for (const c of cases) {
    const s = plazaKerbSpec(c);
    for (const v of Object.values(s)) {
      assert.ok(Number.isFinite(v), JSON.stringify(s));
    }
  }
});

test('lanePlinthSpec defaults match the constants', () => {
  const s = lanePlinthSpec();
  assert.equal(s.height, LANE_PLINTH_HEIGHT);
  assert.equal(s.width, LANE_PLINTH_WIDTH);
});

test('lanePlinthSpec junk input yields defaults', () => {
  for (const bad of [null, undefined, 42, 'x', [1, 2]]) {
    const s = lanePlinthSpec(bad);
    assert.equal(s.height, LANE_PLINTH_HEIGHT);
    assert.equal(s.width, LANE_PLINTH_WIDTH);
  }
});

test('lanePlinthSpec clamps height and width to [0.004, 1]', () => {
  assert.equal(lanePlinthSpec({ height: 0 }).height, 0.004);
  assert.equal(lanePlinthSpec({ height: 5 }).height, 1);
  assert.equal(lanePlinthSpec({ width: 0 }).width, 0.004);
  assert.equal(lanePlinthSpec({ width: 5 }).width, 1);
});

test('lanePlinthSpec never emits NaN or Infinity', () => {
  const s = lanePlinthSpec({ height: NaN, width: Infinity });
  assert.ok(Number.isFinite(s.height));
  assert.ok(Number.isFinite(s.width));
});

test('plazaKerbSpec is deterministic', () => {
  const a = JSON.stringify(plazaKerbSpec({ tube: 0.07, major: 9.2, segments: 33.2, tubeSegments: 9.1 }));
  const b = JSON.stringify(plazaKerbSpec({ tube: 0.07, major: 9.2, segments: 33.2, tubeSegments: 9.1 }));
  assert.equal(a, b);
});
