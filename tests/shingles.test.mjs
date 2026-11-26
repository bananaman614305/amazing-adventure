// The shingles module decides where every course and shingle lies on the
// caller's roof planes, how wide each is and how bright, and how many there are;
// the world turns those numbers into thin instanced strips. These tests hold the
// module to its contract: the authored constants and their bands, the frozen
// phase table and its fallback, the empty and junk-plane guards, determinism,
// the eave-to-ridge course spacing and clamp, the clipped last shingle, the
// footprint and lift placement under yaw and pitch, the tone band, the count
// agreement, the quality gate, and a junk/huge-seed sweep proving no NaN.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SHINGLE_SEED, SHINGLE_COURSE_HEIGHT, SHINGLE_COURSES_PER_PLANE,
  SHINGLE_MIN_WIDTH, SHINGLE_MAX_WIDTH, SHINGLE_LIFT,
  SHINGLE_MIN_TONE, SHINGLE_MAX_TONE, SHINGLE_PHASE_GLOW,
  shingleGlowLevel, shingleSpawns, shingleRowCount, shinglesEnabled
} from '../src/shingles.js';

const FIELDS = ['x', 'y', 'z', 'yaw', 'width', 'depth', 'tone'];

/** A pitched, yawed roof plane used by several tests. */
const PLANE = { x: 4, z: -2, y: 5, width: 6, depth: 2, yaw: 0.7, pitch: 0.4 };

/** Round a y to a key so descriptors of one course group together. */
function yKey(y) {
  return y.toFixed(6);
}

test('the authored constants are the ones the world relies on', () => {
  assert.equal(SHINGLE_SEED, 0x6d1f3a);
  assert.equal(SHINGLE_COURSE_HEIGHT, 0.26);
  assert.equal(SHINGLE_COURSES_PER_PLANE, 14);
  assert.equal(SHINGLE_MIN_WIDTH, 0.5);
  assert.equal(SHINGLE_MAX_WIDTH, 1.1);
  assert.equal(SHINGLE_LIFT, 0.012);
  assert.equal(SHINGLE_MIN_TONE, 0.86);
  assert.equal(SHINGLE_MAX_TONE, 1.06);
});

test('the bands are ordered and the lift sits under one course', () => {
  assert.ok(SHINGLE_MIN_WIDTH < SHINGLE_MAX_WIDTH);
  assert.ok(SHINGLE_MIN_TONE < SHINGLE_MAX_TONE);
  assert.ok(SHINGLE_LIFT > 0);
  // A lift at or above the course pitch would stop a course overlapping the one
  // below, so it must stay well under it.
  assert.ok(SHINGLE_LIFT < SHINGLE_COURSE_HEIGHT * 0.1);
});

test('the phase glow table is frozen with the authored values and ordering', () => {
  assert.ok(Object.isFrozen(SHINGLE_PHASE_GLOW));
  assert.equal(SHINGLE_PHASE_GLOW.day, 1);
  assert.equal(SHINGLE_PHASE_GLOW.dusk, 0.8);
  assert.equal(SHINGLE_PHASE_GLOW.night, 0.4);
  // A roof is lit by the sky: brightest by day, dimmest at night.
  assert.ok(SHINGLE_PHASE_GLOW.day > SHINGLE_PHASE_GLOW.dusk);
  assert.ok(SHINGLE_PHASE_GLOW.dusk > SHINGLE_PHASE_GLOW.night);
});

test('shingleGlowLevel is per phase and falls back to day', () => {
  assert.equal(shingleGlowLevel('day'), 1);
  assert.equal(shingleGlowLevel('dusk'), 0.8);
  assert.equal(shingleGlowLevel('night'), 0.4);
  for (const junk of [undefined, null, 42, NaN, {}, [], 'DAY', true]) {
    assert.equal(shingleGlowLevel(junk), 1, `phase ${String(junk)} did not fall back to day`);
  }
  // Own-property lookup only: an inherited name must not leak a value.
  assert.equal(shingleGlowLevel('toString'), 1);
});

test('empty and junk planes yield an empty array and never throw', () => {
  assert.deepEqual(shingleSpawns(), []);
  assert.deepEqual(shingleSpawns({ planes: [] }), []);
  assert.deepEqual(shingleSpawns({ planes: null }), []);
  assert.deepEqual(shingleSpawns({ planes: 'nope' }), []);
  const junk = [null, 42, 'x', [], {}, { x: NaN, z: 0, y: 0, width: 2, depth: 2 },
    { x: 0, z: 0, y: 0, width: -2, depth: 2 }];
  assert.deepEqual(shingleSpawns({ planes: junk }), []);
});

test('shingleSpawns is deterministic for identical arguments', () => {
  assert.deepEqual(shingleSpawns({ planes: [PLANE] }), shingleSpawns({ planes: [PLANE] }));
  assert.deepEqual(
    shingleSpawns({ planes: [PLANE], seed: 99 }),
    shingleSpawns({ planes: [PLANE], seed: 99 })
  );
});

test('a different seed gives a different layout', () => {
  assert.notDeepEqual(
    shingleSpawns({ planes: [PLANE], seed: 1 }),
    shingleSpawns({ planes: [PLANE], seed: 2 })
  );
});

test('one pitched plane lays evenly spaced courses, eave lowest', () => {
  const spawns = shingleSpawns({ planes: [PLANE] });
  assert.ok(spawns.length > 0);
  const ys = [...new Set(spawns.map((s) => yKey(s.y)))].map(Number).sort((a, b) => a - b);
  // floor(2 / 0.26) = 7 whole courses fit the 2 m depth.
  assert.equal(ys.length, Math.floor(PLANE.depth / SHINGLE_COURSE_HEIGHT));
  // The eave course is the lowest, and every course climbs by pitch*H.
  const expectedStep = PLANE.pitch * SHINGLE_COURSE_HEIGHT;
  for (let i = 1; i < ys.length; i += 1) {
    assert.ok(Math.abs((ys[i] - ys[i - 1]) - expectedStep) < 1e-9, 'courses are not evenly spaced');
  }
  // The lowest course sits at the far (eave) edge of the sloping plane.
  const eaveV = PLANE.depth / 2 - SHINGLE_COURSE_HEIGHT / 2;
  assert.ok(Math.abs(ys[0] - (PLANE.y - PLANE.pitch * eaveV + SHINGLE_LIFT)) < 1e-9);
});

test('maxCourses caps the courses and is clamped into range', () => {
  const spawns = shingleSpawns({ planes: [PLANE], maxCourses: 3 });
  const ys = new Set(spawns.map((s) => yKey(s.y)));
  assert.ok(ys.size <= 3, `laid ${ys.size} courses against a cap of 3`);
  // A huge maxCourses clamps to SHINGLE_COURSES_PER_PLANE, which still covers
  // this 2 m plane's 7 whole courses, so the result is unchanged from default.
  assert.deepEqual(
    shingleSpawns({ planes: [PLANE], maxCourses: 1e9 }),
    shingleSpawns({ planes: [PLANE] })
  );
});

test('the clipped last shingle makes every course span the plane width exactly', () => {
  const spawns = shingleSpawns({ planes: [PLANE] });
  const totals = new Map();
  for (const s of spawns) {
    const key = yKey(s.y);
    totals.set(key, (totals.get(key) || 0) + s.width);
  }
  for (const [key, total] of totals) {
    assert.ok(Math.abs(total - PLANE.width) < 1e-9, `course ${key} spans ${total}, not ${PLANE.width}`);
  }
});

test('every descriptor stands inside the footprint and lifted above the surface', () => {
  const spawns = shingleSpawns({ planes: [PLANE] });
  const cos = Math.cos(PLANE.yaw);
  const sin = Math.sin(PLANE.yaw);
  for (const s of spawns) {
    const dx = s.x - PLANE.x;
    const dz = s.z - PLANE.z;
    // Rotate the world offset back into the plane's local u (along course) and
    // v (across course) axes.
    const u = dx * cos - dz * sin;
    const v = dx * sin + dz * cos;
    assert.ok(Math.abs(u) <= PLANE.width / 2 + 1e-9, `u ${u} left the plane`);
    assert.ok(Math.abs(v) <= PLANE.depth / 2 + 1e-9, `v ${v} left the plane`);
    // The surface at this v, lifted by SHINGLE_LIFT, is the strip's y.
    const surfaceY = PLANE.y - PLANE.pitch * v;
    assert.ok(Math.abs(s.y - (surfaceY + SHINGLE_LIFT)) < 1e-9, `lift wrong at v=${v}`);
  }
});

test('every tone and width lies in its authored band', () => {
  for (const s of shingleSpawns({ planes: [PLANE], seed: 7 })) {
    assert.ok(s.tone >= SHINGLE_MIN_TONE - 1e-9 && s.tone <= SHINGLE_MAX_TONE + 1e-9, `tone ${s.tone} out of band`);
    assert.ok(s.width > 0 && s.width <= SHINGLE_MAX_WIDTH + 1e-9, `width ${s.width} out of band`);
  }
});

test('a descriptor carries the exact field set with finite values', () => {
  for (const s of shingleSpawns({ planes: [PLANE] })) {
    assert.deepEqual(Object.keys(s).sort(), [...FIELDS].sort());
    for (const key of FIELDS) {
      assert.ok(Number.isFinite(s[key]), `${key} is not finite`);
    }
  }
});

test('shingleRowCount agrees with shingleSpawns length for several inputs', () => {
  const cases = [
    undefined,
    {},
    { planes: [] },
    { planes: null },
    { planes: [PLANE] },
    { planes: [PLANE], seed: 5 },
    { planes: [PLANE], maxCourses: 2 },
    { planes: [PLANE, { x: 0, z: 0, y: 1, width: 3, depth: 1, yaw: 0, pitch: 0.2 }] },
    { planes: [null, 42, PLANE, { x: NaN }] },
    { planes: 'nope' }
  ];
  for (const options of cases) {
    assert.equal(
      shingleRowCount(options),
      shingleSpawns(options).length,
      `count disagreed for ${JSON.stringify(options)}`
    );
  }
});

test('junk options and huge seeds stay total', () => {
  for (const junk of [null, 42, 'x', true, [], NaN]) {
    assert.deepEqual(shingleSpawns(junk), [], `options ${String(junk)} did not read as empty`);
    assert.equal(shingleRowCount(junk), 0);
  }
  for (const seed of [Number.MAX_SAFE_INTEGER, -1, 0xffffffff, 1e12, NaN, Infinity, 'x']) {
    const spawns = shingleSpawns({ planes: [PLANE], seed });
    assert.ok(spawns.length > 0, `seed ${String(seed)} produced nothing`);
    for (const s of spawns) {
      for (const key of FIELDS) {
        assert.ok(Number.isFinite(s[key]), `${key} not finite at seed ${String(seed)}`);
      }
      assert.ok(s.tone >= SHINGLE_MIN_TONE - 1e-9 && s.tone <= SHINGLE_MAX_TONE + 1e-9);
    }
  }
});

test('shinglesEnabled is false only for the low tier', () => {
  assert.equal(shinglesEnabled('low'), false);
  assert.equal(shinglesEnabled('full'), true);
  for (const junk of [undefined, null, 'LOW', 'high', 42, {}, []]) {
    assert.equal(shinglesEnabled(junk), true);
  }
});
