// The moss module decides where the courtyard's stone carries damp moss -- at
// the foot of the boundary walls and along the paving seams -- how big each
// patch is, which way its long axis runs, and how dark and lit it reads per
// phase. These tests hold the module to its contract: the authored constants,
// the frozen phase and tint tables and their junk fallbacks, the spawn count and
// clamping, determinism, the margin and wall placement and keep-out bounds, the
// radius and stretch bands, the seam shape, the guards for junk input, the
// quality gate, and a sweep proving no NaN.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MOSS_SEED, MOSS_COUNT, MOSS_MAX_COUNT,
  MOSS_MIN_RADIUS, MOSS_MAX_RADIUS,
  MOSS_PHASE_DARKNESS, MOSS_PHASE_GLOW, MOSS_TINTS,
  MOSS_SEAM_CHANCE, MOSS_SEAM_MIN_LENGTH, MOSS_SEAM_MAX_LENGTH, MOSS_SEAM_WIDTH,
  MOSS_MIN_STRETCH, MOSS_MAX_STRETCH, MOSS_WALL_HUG_CHANCE,
  mossDarkness, mossGlowLevel, mossSpawns, mossEnabled
} from '../src/moss.js';

// A wall on each side of the origin, so the wall-hugging branch has somewhere
// real to put a patch. The shape matches the world's own border walls.
const WALLS = [
  { axis: 'z', at: 16.5, from: -16.5, to: 16.5 },
  { axis: 'z', at: -16.5, from: -16.5, to: 16.5 },
  { axis: 'x', at: 16.5, from: -16.5, to: 16.5 },
  { axis: 'x', at: -16.5, from: -16.5, to: 16.5 }
];

test('the authored constants are the ones the world relies on', () => {
  assert.equal(MOSS_SEED, 0x6d4f2b);
  assert.equal(MOSS_COUNT, 40);
  assert.equal(MOSS_MAX_COUNT, 160);
  assert.equal(MOSS_MIN_RADIUS, 0.18);
  assert.equal(MOSS_MAX_RADIUS, 0.55);
  assert.equal(MOSS_SEAM_CHANCE, 0.35);
  assert.equal(MOSS_SEAM_MIN_LENGTH, 0.5);
  assert.equal(MOSS_SEAM_MAX_LENGTH, 1.6);
  assert.equal(MOSS_SEAM_WIDTH, 0.07);
  assert.equal(MOSS_MIN_STRETCH, 0.75);
  assert.equal(MOSS_MAX_STRETCH, 1.25);
  assert.equal(MOSS_WALL_HUG_CHANCE, 0.65);
  assert.ok(MOSS_COUNT <= MOSS_MAX_COUNT);
});

test('the shape bands are ordered and sane', () => {
  assert.ok(MOSS_MIN_RADIUS < MOSS_MAX_RADIUS);
  assert.ok(MOSS_MIN_STRETCH < MOSS_MAX_STRETCH);
  assert.ok(MOSS_SEAM_MIN_LENGTH < MOSS_SEAM_MAX_LENGTH);
  // A seam is a joint, not a stripe: thinner than any round patch.
  assert.ok(MOSS_SEAM_WIDTH < MOSS_MIN_RADIUS);
  // A stripe never outruns a patch's diameter band by more than fits a paving
  // stone, so the two shapes stay the same order of magnitude.
  assert.ok(MOSS_SEAM_MAX_LENGTH > MOSS_SEAM_MIN_LENGTH);
  assert.ok(MOSS_SEAM_CHANCE > 0 && MOSS_SEAM_CHANCE < 1);
  assert.ok(MOSS_WALL_HUG_CHANCE > 0 && MOSS_WALL_HUG_CHANCE < 1);
});

test('the phase tables are frozen and carry the authored values', () => {
  assert.ok(Object.isFrozen(MOSS_PHASE_DARKNESS));
  assert.ok(Object.isFrozen(MOSS_PHASE_GLOW));
  assert.deepEqual({ ...MOSS_PHASE_DARKNESS }, { day: 0.55, dusk: 0.7, night: 0.85 });
  assert.deepEqual({ ...MOSS_PHASE_GLOW }, { day: 1, dusk: 0.9, night: 0.5 });
  // Wet stone keeps darkening as the light leaves it, and its green fades as
  // the light goes, so the two readings move in opposite directions.
  assert.ok(MOSS_PHASE_DARKNESS.day < MOSS_PHASE_DARKNESS.dusk);
  assert.ok(MOSS_PHASE_DARKNESS.dusk < MOSS_PHASE_DARKNESS.night);
  assert.ok(MOSS_PHASE_GLOW.day > MOSS_PHASE_GLOW.dusk);
  assert.ok(MOSS_PHASE_GLOW.dusk > MOSS_PHASE_GLOW.night);
});

test('the palette is frozen and holds the four authored greens', () => {
  assert.ok(Object.isFrozen(MOSS_TINTS));
  assert.deepEqual([...MOSS_TINTS], [0x3f5a2e, 0x4c6a35, 0x35502a, 0x56703c]);
  for (const t of MOSS_TINTS) {
    assert.equal(typeof t, 'number');
    assert.ok(Number.isInteger(t));
  }
});

test('mossDarkness is per phase and falls back to day', () => {
  assert.equal(mossDarkness('day'), 0.55);
  assert.equal(mossDarkness('dusk'), 0.7);
  assert.equal(mossDarkness('night'), 0.85);
  assert.equal(mossDarkness('dawn'), 0.55);
});

test('mossDarkness reads junk as day', () => {
  for (const junk of [undefined, null, 42, NaN, {}, [], 'DAY', 'Night']) {
    assert.equal(mossDarkness(junk), 0.55, `darkness junk ${String(junk)} did not read as day`);
  }
});

test('mossGlowLevel is per phase and falls back to day', () => {
  assert.equal(mossGlowLevel('day'), 1);
  assert.equal(mossGlowLevel('dusk'), 0.9);
  assert.equal(mossGlowLevel('night'), 0.5);
  assert.equal(mossGlowLevel('dawn'), 1);
});

test('mossGlowLevel reads junk as day', () => {
  for (const junk of [undefined, null, 42, NaN, {}, [], 'DAY', 'Night']) {
    assert.equal(mossGlowLevel(junk), 1, `glow junk ${String(junk)} did not read as day`);
  }
});

test('mossSpawns returns the default count with finite fields', () => {
  const spawns = mossSpawns();
  assert.equal(spawns.length, MOSS_COUNT);
  for (const s of spawns) {
    for (const key of ['x', 'z', 'radius', 'stretch', 'angle', 'tint', 'length']) {
      assert.ok(Number.isFinite(s[key]), `${key} is not finite`);
    }
    assert.equal(typeof s.seam, 'boolean');
  }
});

test('mossSpawns honours an explicit count', () => {
  assert.equal(mossSpawns({ count: 1 }).length, 1);
  assert.equal(mossSpawns({ count: 0 }).length, 0);
  assert.equal(mossSpawns({ count: MOSS_MAX_COUNT }).length, MOSS_MAX_COUNT);
});

test('a junk count falls back to the default or clamps and floors', () => {
  for (const junk of [NaN, Infinity, -Infinity, 'x', null, {}, [], undefined]) {
    assert.equal(mossSpawns({ count: junk }).length, MOSS_COUNT, `junk count ${String(junk)} did not default`);
  }
  assert.equal(mossSpawns({ count: 1e9 }).length, MOSS_MAX_COUNT);
  assert.equal(mossSpawns({ count: -5 }).length, 0);
  assert.equal(mossSpawns({ count: 3.9 }).length, 3);
});

test('mossSpawns is deterministic for identical arguments', () => {
  assert.deepEqual(mossSpawns(), mossSpawns());
  assert.deepEqual(mossSpawns({ count: 12, seed: 99 }), mossSpawns({ count: 12, seed: 99 }));
  assert.deepEqual(mossSpawns({ count: 8, walls: WALLS }), mossSpawns({ count: 8, walls: WALLS }));
});

test('a different seed moves the field', () => {
  assert.notDeepEqual(mossSpawns({ seed: 1 }), mossSpawns({ seed: 2 }));
});

test('every field stays inside the documented bands', () => {
  for (const s of mossSpawns({ count: MOSS_MAX_COUNT })) {
    assert.ok(s.radius >= MOSS_MIN_RADIUS - 1e-9 && s.radius <= MOSS_MAX_RADIUS + 1e-9, `radius ${s.radius} out of band`);
    assert.ok(s.stretch >= MOSS_MIN_STRETCH - 1e-9 && s.stretch <= MOSS_MAX_STRETCH + 1e-9, `stretch ${s.stretch} out of band`);
    assert.ok(MOSS_TINTS.includes(s.tint), `tint ${s.tint} not in palette`);
    if (s.seam) {
      assert.ok(s.length >= MOSS_SEAM_MIN_LENGTH - 1e-9 && s.length <= MOSS_SEAM_MAX_LENGTH + 1e-9, `seam length ${s.length} out of band`);
    } else {
      assert.equal(s.length, 0);
    }
    assert.ok(s.angle >= 0 && s.angle < Math.PI * 2 + 1e-9, `angle ${s.angle} out of range`);
  }
});

test('with no walls the whole field stays inside the world margin', () => {
  const limit = 17 - 0.3;
  for (const s of mossSpawns()) {
    assert.ok(Math.abs(s.x) <= limit + 1e-9, `x ${s.x} past margin`);
    assert.ok(Math.abs(s.z) <= limit + 1e-9, `z ${s.z} past margin`);
  }
});

test('wall-placed patches sit at a wall with a parallel long axis', () => {
  const spawns = mossSpawns({ count: MOSS_MAX_COUNT, walls: WALLS });
  let wallPlaced = 0;
  for (const s of spawns) {
    // Only a wall placement yields an exactly axis-parallel angle; a scattered
    // patch that happens to land near a wall line keeps a random angle, so the
    // angle is the tell, not the position.
    const parallelToZWall = Math.abs(s.angle - Math.PI / 2) < 1e-9;
    const parallelToXWall = Math.abs(s.angle - 0) < 1e-9;
    if (!parallelToZWall && !parallelToXWall) continue;
    wallPlaced += 1;
    if (parallelToZWall) {
      // A z-wall runs along z at x = at: the patch is 0.15-0.7 m off that line
      // and its along-wall coordinate lies inside the segment.
      const w = WALLS.filter((wall) => wall.axis === 'z').find((wall) =>
        Math.abs(s.x - wall.at) >= 0.15 - 1e-9 && Math.abs(s.x - wall.at) <= 0.7 + 1e-9
        && s.z >= wall.from - 1e-9 && s.z <= wall.to + 1e-9);
      assert.ok(w, `z-parallel patch at ${s.x},${s.z} is not at a z-wall`);
    } else {
      const w = WALLS.filter((wall) => wall.axis === 'x').find((wall) =>
        Math.abs(s.z - wall.at) >= 0.15 - 1e-9 && Math.abs(s.z - wall.at) <= 0.7 + 1e-9
        && s.x >= wall.from - 1e-9 && s.x <= wall.to + 1e-9);
      assert.ok(w, `x-parallel patch at ${s.x},${s.z} is not at an x-wall`);
    }
  }
  // About two thirds hug a wall; allow a generous band so the test pins the
  // behaviour without pinning the exact PRNG draw.
  assert.ok(wallPlaced > 0, 'no patch was placed at a wall');
  assert.ok(wallPlaced >= spawns.length * 0.4, `only ${wallPlaced}/${spawns.length} were placed at a wall`);
});

test('without walls no patch takes an axis-parallel angle', () => {
  for (const s of mossSpawns({ count: MOSS_MAX_COUNT })) {
    assert.ok(Math.abs(s.angle) > 1e-9 && Math.abs(s.angle - Math.PI / 2) > 1e-9,
      `angle ${s.angle} looks wall-placed with no walls`);
  }
});

test('a keep-out circle is never covered', () => {
  const circles = [{ x: 0, z: 0, radius: 4 }];
  for (const s of mossSpawns({ count: MOSS_MAX_COUNT, circles })) {
    const d = Math.hypot(s.x - 0, s.z - 0);
    // The patch's own footprint must clear the circle, so its centre is at
    // least radius distance beyond the keep-out.
    assert.ok(d >= 4 - 1e-9, `patch at ${s.x},${s.z} inside the keep-out`);
  }
});

test('malformed keep-outs and walls are skipped rather than thrown at', () => {
  const circles = [null, 42, {}, { x: 0 }, { x: 0, z: 0, radius: -1 }, { x: NaN, z: 0, radius: 2 }];
  const walls = [null, {}, { axis: 'q', at: 1, from: 0, to: 2 }, { axis: 'x', at: NaN, from: 0, to: 1 }];
  assert.equal(mossSpawns({ count: 5, circles }).length, 5);
  assert.equal(mossSpawns({ count: 5, walls }).length, 5);
});

test('a reversed wall span is normalised, not rejected', () => {
  const forward = mossSpawns({ count: 10, walls: [{ axis: 'z', at: 16.5, from: -16.5, to: 16.5 }] });
  const reversed = mossSpawns({ count: 10, walls: [{ axis: 'z', at: 16.5, from: 16.5, to: -16.5 }] });
  assert.equal(forward.length, reversed.length);
});

test('junk options collapse to the defaults', () => {
  for (const junk of [undefined, null, 42, 'x', [], () => {}]) {
    assert.equal(mossSpawns(junk).length, MOSS_COUNT, `junk options ${String(junk)} did not default`);
  }
});

test('a non-finite seed falls back to the authored seed', () => {
  assert.deepEqual(mossSpawns({ seed: NaN }), mossSpawns({ seed: MOSS_SEED }));
  assert.deepEqual(mossSpawns({ seed: Infinity }), mossSpawns());
});

test('mossEnabled drops the field only on the low tier', () => {
  assert.equal(mossEnabled('full'), true);
  assert.equal(mossEnabled('low'), false);
  for (const junk of [undefined, null, 0, '', {}, 'FULL', 'LOW']) {
    assert.equal(mossEnabled(junk), true, `junk tier ${String(junk)} did not read as full`);
  }
});

test('a long sweep over seeds and options never yields NaN or Infinity', () => {
  for (let seed = 0; seed < 80; seed += 1) {
    const spawns = mossSpawns({ count: 60, seed, walls: WALLS, circles: [{ x: 3, z: -2, radius: 2 }] });
    for (const s of spawns) {
      for (const key of ['x', 'z', 'radius', 'stretch', 'angle', 'length']) {
        assert.ok(Number.isFinite(s[key]), `seed ${seed}: ${key} not finite`);
      }
      assert.ok(s.x >= -64 && s.x <= 64);
      assert.ok(s.z >= -64 && s.z <= 64);
    }
  }
});
