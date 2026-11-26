// One wind field for the whole world.
//
// These tests hold the pure half of the ambient motion: which way the air moves,
// how strong it is, how far a blade is displaced, and that the field is bounded,
// smooth, deterministic and never NaN. The world multiplies these numbers by a
// bend angle; if anything here can leave its range, a tuft leaves the ground.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WIND_DIRECTION,
  WIND_BASE,
  WIND_GUST,
  windDirection,
  windStrength,
  windSway,
  windOffset,
  windPhase
} from '../src/wind.js';

const SWEEP_STEP = 0.05;
const SWEEP_END = 120;

/** Walk the field over the dense sweep, handing each sample to `visit`. */
function sweep(visit, step = SWEEP_STEP, end = SWEEP_END) {
  for (let t = 0; t <= end; t += step) visit(t);
}

test('WIND_DIRECTION is frozen and roughly along +x with a little +z', () => {
  assert.ok(Object.isFrozen(WIND_DIRECTION));
  assert.equal(WIND_DIRECTION.length, 3);
  const [x, y, z] = WIND_DIRECTION;
  assert.ok(x > 0 && x > z, 'the wind should lean mostly along +x');
  assert.ok(z > 0, 'and a little towards +z');
  assert.equal(y, 0, 'the authored wind blows along the ground');
});

test('windDirection is unit length and exactly on the ground plane', () => {
  const dir = windDirection();
  assert.equal(dir.y, 0);
  const length = Math.hypot(dir.x, dir.y, dir.z);
  assert.ok(Math.abs(length - 1) < 1e-12, `direction length ${length} is not 1`);
  // Same heading as the authored vector.
  assert.ok(dir.x > 0 && dir.z > 0);
  assert.ok(Math.abs(dir.z / dir.x - WIND_DIRECTION[2] / WIND_DIRECTION[0]) < 1e-12);
});

test('WIND_BASE and WIND_GUST span the full, bounded strength range', () => {
  assert.equal(WIND_BASE, 0.35);
  assert.equal(WIND_GUST, 0.65);
  assert.equal(WIND_BASE + WIND_GUST, 1, 'base plus gust is exactly full strength');
});

test('windStrength is always within [0, 1] over a dense sweep', () => {
  sweep((t) => {
    const s = windStrength(t);
    assert.ok(Number.isFinite(s), `strength ${s} at ${t}s is not finite`);
    assert.ok(s >= 0 && s <= 1, `strength ${s} at ${t}s is out of [0, 1]`);
  });
});

test('windStrength never drops below the steady breeze', () => {
  sweep((t) => {
    assert.ok(windStrength(t) >= WIND_BASE - 1e-12,
      `strength ${windStrength(t)} at ${t}s broke the base floor`);
  });
});

test('windStrength actually varies: the world moves', () => {
  let lo = Infinity;
  let hi = -Infinity;
  sweep((t) => {
    const s = windStrength(t);
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
  });
  assert.ok(hi > 0.9, `the field never gusted (peak ${hi})`);
  assert.ok(hi - lo > 0.3, `the field is nearly constant (range ${hi - lo})`);
  // And no two adjacent samples are identical for the whole run.
  assert.ok(windStrength(3.1) !== windStrength(3.2));
});

test('windStrength is smooth: no step between neighbouring instants', () => {
  let worst = 0;
  let prev = windStrength(0);
  sweep((t) => {
    const s = windStrength(t);
    worst = Math.max(worst, Math.abs(s - prev));
    prev = s;
  }, 0.01);
  // A hundredth of a second must move the strength by far less than a percent-
  // scale jump; the waves are 7.3/11.9/23 s.
  assert.ok(worst < 0.005, `worst hundredth-second step was ${worst}`);
});

test('windStrength is deterministic and offset shifts the pattern', () => {
  for (const t of [0, 4.7, 31.25, 99.9, 120]) {
    assert.equal(windStrength(t, 0.37), windStrength(t, 0.37),
      `strength at ${t}s was not deterministic`);
  }
  assert.notEqual(windStrength(40, 0), windStrength(40, 0.37),
    'a different offset should shift the field');
});

test('windSway is always within [-1, 1] over a dense sweep', () => {
  sweep((t) => {
    const s = windSway(t);
    assert.ok(Number.isFinite(s), `sway ${s} at ${t}s is not finite`);
    assert.ok(s >= -1 && s <= 1, `sway ${s} at ${t}s is out of [-1, 1]`);
  });
});

test('windSway takes both signs and reaches near both extremes', () => {
  let lo = Infinity;
  let hi = -Infinity;
  sweep((t) => {
    const s = windSway(t);
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
  });
  assert.ok(lo < -0.5, `sway never swung negative (floor ${lo})`);
  assert.ok(hi > 0.5, `sway never swung positive (peak ${hi})`);
});

test('windSway is smooth: no step between neighbouring instants', () => {
  let worst = 0;
  let prev = windSway(0);
  sweep((t) => {
    const s = windSway(t);
    worst = Math.max(worst, Math.abs(s - prev));
    prev = s;
  }, 0.01);
  // The flutter is 2.6 s, so a hundredth-second step is at most ~2.5 % of full
  // amplitude; a larger jump would mean a discontinuity.
  assert.ok(worst < 0.03, `worst hundredth-second sway step was ${worst}`);
});

test('windSway clamps its strength scale to [0, 1]', () => {
  for (const t of [1.1, 7.7, 42, 88.8]) {
    const full = windSway(t, 0, 1);
    // A strength above 1 cannot exceed what full strength gives.
    assert.ok(Math.abs(windSway(t, 0, 5) - full) < 1e-12, 'over-strength should clamp to 1');
    // A negative strength cannot flip the sway into the other direction.
    assert.equal(windSway(t, 0, -3), 0, 'a negative strength should clamp to no motion');
    // Zero strength is exactly still.
    assert.equal(windSway(t, 0, 0), 0, 'zero strength is no sway');
  }
});

test('windSway never exceeds the strength envelope in magnitude', () => {
  sweep((t) => {
    const sway = Math.abs(windSway(t, 0, 1));
    const strength = windStrength(t, 0);
    assert.ok(sway <= strength + 1e-12,
      `sway ${sway} at ${t}s exceeded envelope ${strength}`);
  });
});

test('windPhase depends on position and is deterministic', () => {
  assert.equal(windPhase(0, 0), 0);
  assert.equal(windPhase(12.5, -3.2), windPhase(12.5, -3.2));
  // Distant points must not share a phase, or the field moves in lockstep.
  assert.notEqual(windPhase(10, 0), windPhase(0, 0));
  assert.notEqual(windPhase(0, 10), windPhase(0, 0));
  assert.notEqual(windPhase(10, 10), windPhase(10, 0));
  assert.ok(Math.abs(windPhase(10, 0) - 1.5) < 1e-12, 'phase is x*0.15 + z*0.11');
  assert.ok(Math.abs(windPhase(0, 10) - 1.1) < 1e-12);
});

test('windOffset stays small and finite over a dense sweep', () => {
  // Every component is bounded by the authored push and dip, so nothing can be
  // blown out of place.
  const maxPush = Math.hypot(0.06, 0.06) + 1e-12;
  sweep((t) => {
    const o = windOffset(t, 5, -7);
    assert.ok(Number.isFinite(o.x) && Number.isFinite(o.y) && Number.isFinite(o.z),
      `offset at ${t}s was not finite`);
    assert.ok(Math.hypot(o.x, o.z) <= maxPush, `horizontal push ${Math.hypot(o.x, o.z)} too large`);
    assert.ok(o.y <= 0, `the dip at ${t}s was a lift (${o.y})`);
    assert.ok(o.y >= -0.02 - 1e-12, `the dip at ${t}s went below its bound (${o.y})`);
  });
});

test('windOffset pushes along the wind direction, never against it', () => {
  const dir = windDirection();
  sweep((t) => {
    const o = windOffset(t, 2, 3);
    // The horizontal displacement must never point upwind.
    const along = o.x * dir.x + o.z * dir.z;
    assert.ok(along >= -1e-12, `offset at ${t}s pushed upwind (${along})`);
  });
});

test('windOffset changes with position, so a field is not in lockstep', () => {
  const a = windOffset(12.3, 0, 0);
  const b = windOffset(12.3, 40, 0);
  const moved = Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
  assert.ok(moved > 1e-6, 'distant tufts were displaced identically');
});

test('windOffset is deterministic', () => {
  for (let i = 0; i < 20; i += 1) {
    const o = windOffset(77.7, 1.5, -2.5, 0.37);
    assert.deepEqual(o, windOffset(77.7, 1.5, -2.5, 0.37));
  }
});

test('windStrength handles junk input without NaN', () => {
  const junk = [null, undefined, NaN, Infinity, -Infinity, 'nope', {}, []];
  for (const value of junk) {
    const s = windStrength(value);
    assert.equal(s, WIND_BASE, `windStrength(${String(value)}) should read as WIND_BASE`);
    // A junk offset reads as 0, not as a destroyed result.
    const withJunkOffset = windStrength(10, value);
    assert.ok(Number.isFinite(withJunkOffset) && withJunkOffset >= 0 && withJunkOffset <= 1);
  }
  // Huge and negative times stay in range.
  for (const t of [-1e9, -1, 1e12, Number.MAX_VALUE]) {
    const s = windStrength(t);
    assert.ok(Number.isFinite(s) && s >= 0 && s <= 1, `strength ${s} at ${t}`);
  }
});

test('windSway handles junk input without NaN', () => {
  const junk = [null, undefined, NaN, Infinity, -Infinity, 'nope', {}, []];
  for (const value of junk) {
    assert.equal(windSway(value), 0, `windSway(${String(value)}) should read as 0`);
    const withJunk = windSway(10, value, value);
    assert.ok(Number.isFinite(withJunk) && withJunk >= -1 && withJunk <= 1);
  }
  for (const t of [-1e9, -1, 1e12, Number.MAX_VALUE]) {
    const s = windSway(t);
    assert.ok(Number.isFinite(s) && s >= -1 && s <= 1, `sway ${s} at ${t}`);
  }
});

test('windOffset handles junk input without NaN', () => {
  const junk = [null, undefined, NaN, Infinity, -Infinity, 'nope', {}, []];
  for (const value of junk) {
    const o = windOffset(value, value, value, value);
    assert.ok(Number.isFinite(o.x) && Number.isFinite(o.y) && Number.isFinite(o.z),
      `windOffset junk produced ${JSON.stringify(o)}`);
  }
  // A junk time is exactly still.
  assert.deepEqual(windOffset(NaN, 0, 0), { x: 0, y: 0, z: 0 });
});

test('windPhase handles junk input without NaN', () => {
  const junk = [null, undefined, NaN, Infinity, -Infinity, 'nope', {}, []];
  for (const value of junk) {
    assert.ok(Number.isFinite(windPhase(value, value)));
  }
  assert.equal(windPhase(NaN, 0), 0);
  assert.equal(windPhase(0, Infinity), 0);
});

test('the field agrees on one direction for the whole scene', () => {
  // A blade at the far corner and a flag over the lane must lean the same way.
  const a = windOffset(30, -40, -40);
  const b = windOffset(30, 40, 40);
  const dir = windDirection();
  const crossA = a.x * dir.z - a.z * dir.x;
  const crossB = b.x * dir.z - b.z * dir.x;
  assert.ok(Math.abs(crossA) < 1e-12 && Math.abs(crossB) < 1e-12,
    'both points must push exactly along the shared wind direction');
});
