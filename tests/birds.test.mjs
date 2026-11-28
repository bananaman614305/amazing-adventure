// The bird module decides where a daytime flock circles, how each bird moves and
// how its wings beat; the world turns those numbers into instanced wing meshes.
// These tests hold the module to its contract: the authored constants, the
// per-phase glow and its junk fallback, the flock count and its bounds,
// determinism, the guards for junk input, the flight path and its bounded wing,
// and the quality gate.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BIRD_SEED, BIRD_COUNT,
  BIRD_MIN_HEIGHT, BIRD_MAX_HEIGHT,
  BIRD_MIN_RADIUS, BIRD_MAX_RADIUS,
  BIRD_MIN_SPEED, BIRD_MAX_SPEED,
  BIRD_WING_AMPLITUDE, BIRD_FLAP_PERIOD,
  BIRD_BOB_AMPLITUDE, BIRD_BOB_PERIOD,
  BIRD_PHASE_GLOW,
  birdGlowLevel, birdFlock, birdFlight, birdHeading, birdsEnabled
} from '../src/birds.js';

test('the authored constants are the ones the world relies on', () => {
  assert.equal(BIRD_SEED, 0x5b12d4);
  assert.equal(BIRD_COUNT, 8);
  assert.equal(BIRD_MIN_HEIGHT, 15);
  assert.equal(BIRD_MAX_HEIGHT, 23);
  assert.equal(BIRD_MIN_RADIUS, 6);
  assert.equal(BIRD_MAX_RADIUS, 24);
  assert.equal(BIRD_WING_AMPLITUDE, 0.5);
  assert.equal(BIRD_FLAP_PERIOD, 0.62);
  assert.equal(BIRD_BOB_AMPLITUDE, 0.7);
  assert.equal(BIRD_BOB_PERIOD, 6);
  // The declared bands must be ordered or the sampler is meaningless.
  assert.ok(BIRD_MIN_HEIGHT < BIRD_MAX_HEIGHT);
  assert.ok(BIRD_MIN_RADIUS < BIRD_MAX_RADIUS);
  assert.ok(BIRD_MIN_SPEED < BIRD_MAX_SPEED);
});

test('the flock stays overhead: heights clear the camera and roofs', () => {
  // A 1.6 m camera looking up needs the birds well above it, and above the
  // village roofs, to read as a flock rather than as obstacles.
  assert.ok(BIRD_MIN_HEIGHT > 10, 'birds could be at eye level');
  assert.ok(BIRD_MAX_RADIUS <= 26, 'the flock could leave the plaza airspace');
});

test('the phase glow table is frozen and has the authored values', () => {
  assert.ok(Object.isFrozen(BIRD_PHASE_GLOW));
  assert.equal(BIRD_PHASE_GLOW.day, 1);
  assert.equal(BIRD_PHASE_GLOW.dusk, 0.5);
  assert.equal(BIRD_PHASE_GLOW.night, 0);
});

test('birdGlowLevel is per phase and falls back to day', () => {
  assert.equal(birdGlowLevel('day'), 1);
  assert.equal(birdGlowLevel('dusk'), 0.5);
  assert.equal(birdGlowLevel('night'), 0);
  // Unknown phase, and every kind of junk, reads as the day value (1).
  assert.equal(birdGlowLevel('dawn'), 1);
  for (const junk of [undefined, null, 42, NaN, {}, [], 'NIGHT']) {
    assert.equal(birdGlowLevel(junk), 1);
  }
});

test('birdFlock returns exactly count items with finite fields', () => {
  const flock = birdFlock();
  assert.equal(flock.length, BIRD_COUNT);
  for (const b of flock) {
    for (const key of ['x', 'z', 'height', 'speed', 'phase', 'radius', 'heading']) {
      assert.ok(Number.isFinite(b[key]), `${key} is not finite`);
    }
    assert.ok(b.phase >= 0 && b.phase < 1, `phase ${b.phase} left [0,1)`);
    assert.ok(b.heading >= 0 && b.heading < Math.PI * 2 + 1e-9, `heading ${b.heading} out of range`);
  }
});

test('birdFlock honours an explicit count', () => {
  assert.equal(birdFlock({ count: 3 }).length, 3);
  assert.equal(birdFlock({ count: 1 }).length, 1);
  assert.equal(birdFlock({ count: 0 }).length, 0);
});

test('birdFlock is deterministic for identical arguments', () => {
  assert.deepEqual(birdFlock(), birdFlock());
  assert.deepEqual(birdFlock({ count: 5, seed: 99 }), birdFlock({ count: 5, seed: 99 }));
});

test('a different seed gives a different flock', () => {
  assert.notDeepEqual(birdFlock({ seed: 1 }), birdFlock({ seed: 2 }));
});

test('the flock is spread, not every bird on one spot', () => {
  const flock = birdFlock();
  const headings = new Set(flock.map((b) => Math.round(b.heading * 1000)));
  const radii = new Set(flock.map((b) => Math.round(b.radius * 1000)));
  assert.ok(headings.size > 5, `only ${headings.size} distinct headings`);
  assert.ok(radii.size > 5, `only ${radii.size} distinct radii`);
});

test('every spawn lies inside the declared radius and height bands', () => {
  for (const b of birdFlock()) {
    const reach = Math.hypot(b.x, b.z);
    assert.ok(reach >= BIRD_MIN_RADIUS - 1e-9, `reach ${reach} below min radius`);
    assert.ok(reach <= BIRD_MAX_RADIUS + 1e-9, `reach ${reach} above max radius`);
    assert.ok(Math.abs(reach - b.radius) < 1e-9, 'radius disagrees with x/z');
    assert.ok(b.height >= BIRD_MIN_HEIGHT - 1e-9, `height ${b.height} below band`);
    assert.ok(b.height <= BIRD_MAX_HEIGHT + 1e-9, `height ${b.height} above band`);
    assert.ok(b.speed >= BIRD_MIN_SPEED - 1e-9, `speed ${b.speed} below band`);
    assert.ok(b.speed <= BIRD_MAX_SPEED + 1e-9, `speed ${b.speed} above band`);
  }
});

test('every spawn lies at its own heading, matching the time-0 flight', () => {
  for (const b of birdFlock()) {
    const p = birdFlight(0, b);
    assert.ok(Math.abs(p.x - b.x) < 1e-9, 'x at time 0 disagrees with spawn');
    assert.ok(Math.abs(p.z - b.z) < 1e-9, 'z at time 0 disagrees with spawn');
  }
});

test('a junk count clamps into [0, 512] and floors', () => {
  for (const junk of [NaN, Infinity, -Infinity, 'x', null, {}, undefined]) {
    const flock = birdFlock({ count: junk });
    assert.ok(flock.length >= 0 && flock.length <= 512, `junk count gave ${flock.length}`);
    for (const b of flock) assert.ok(Number.isFinite(b.x));
  }
  assert.equal(birdFlock({ count: 1e9 }).length, 512);
  assert.equal(birdFlock({ count: -5 }).length, 0);
  assert.equal(birdFlock({ count: 3.9 }).length, 3);
});

test('a junk seed falls back to the authored seed', () => {
  assert.deepEqual(birdFlock({ count: 5, seed: NaN }), birdFlock({ count: 5, seed: BIRD_SEED }));
  assert.deepEqual(birdFlock({ count: 5, seed: Infinity }), birdFlock({ count: 5 }));
});

test('swapped radii are handled and negative radii clamp to 0', () => {
  const swapped = birdFlock({ count: 8, minRadius: 20, maxRadius: 8 });
  for (const b of swapped) {
    assert.ok(b.radius >= 8 - 1e-9 && b.radius <= 20 + 1e-9, `radius ${b.radius} outside swapped band`);
  }
  const negative = birdFlock({ count: 8, minRadius: -4, maxRadius: -1 });
  for (const b of negative) {
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.z));
    assert.ok(Math.hypot(b.x, b.z) <= 1e-9, 'negative radii should collapse to the centre');
  }
});

test('birdFlight returns four finite numbers over a long sweep', () => {
  const flock = birdFlock({ count: 4 });
  for (const b of flock) {
    for (let t = 0; t < 120; t += 0.037) {
      const p = birdFlight(t, b);
      for (const key of ['x', 'y', 'z', 'wing']) {
        assert.ok(Number.isFinite(p[key]), `${key} not finite at t=${t}`);
      }
    }
  }
});

test('birdFlight keeps the bird on its orbit radius and inside the walls', () => {
  const flock = birdFlock();
  for (const b of flock) {
    for (let t = 0; t < 60; t += 0.13) {
      const p = birdFlight(t, b);
      const reach = Math.hypot(p.x, p.z);
      assert.ok(Math.abs(reach - b.radius) < 1e-9, `orbit drifted at t=${t}`);
      assert.ok(reach <= BIRD_MAX_RADIUS + 1e-9, `bird left the plaza airspace at t=${t}`);
    }
  }
});

test('birdFlight bobs within BIRD_BOB_AMPLITUDE of the spawn height', () => {
  const flock = birdFlock();
  for (const b of flock) {
    for (let t = 0; t < 60; t += 0.11) {
      const p = birdFlight(t, b);
      assert.ok(Math.abs(p.y - b.height) <= BIRD_BOB_AMPLITUDE + 1e-9, `bob ${p.y - b.height} too large`);
      assert.ok(p.y > 0, 'bird dipped below the ground');
    }
  }
});

test('birdFlight wing angle stays within +/- BIRD_WING_AMPLITUDE', () => {
  const flock = birdFlock();
  for (const b of flock) {
    for (let t = 0; t < 30; t += 0.007) {
      const p = birdFlight(t, b);
      assert.ok(Math.abs(p.wing) <= BIRD_WING_AMPLITUDE + 1e-9, `wing ${p.wing} out of amplitude`);
    }
  }
});

test('birdFlight is finite at time 0 and flaps through its full amplitude', () => {
  const b = birdFlock({ count: 1 })[0];
  assert.ok(Number.isFinite(birdFlight(0, b).wing));
  // Over a flap period the wing should reach close to both extremes.
  let min = Infinity;
  let max = -Infinity;
  for (let t = 0; t < BIRD_FLAP_PERIOD; t += 0.001) {
    const w = birdFlight(t, b).wing;
    if (w < min) min = w;
    if (w > max) max = w;
  }
  assert.ok(max > BIRD_WING_AMPLITUDE * 0.9, `wing peak only ${max}`);
  assert.ok(min < -BIRD_WING_AMPLITUDE * 0.9, `wing trough only ${min}`);
});

test('birdFlight is deterministic and periodic in the orbit', () => {
  const b = birdFlock({ count: 1 })[0];
  assert.deepEqual(birdFlight(3.3, b), birdFlight(3.3, b));
  // One full orbit returns the bird to its start; the period is 2pi/speed.
  const period = (Math.PI * 2) / b.speed;
  const a = birdFlight(0, b);
  const c = birdFlight(period, b);
  assert.ok(Math.abs(a.x - c.x) < 1e-6 && Math.abs(a.z - c.z) < 1e-6, 'orbit did not close');
});

test('birdFlight reads non-finite time as 0', () => {
  const b = birdFlock({ count: 1 })[0];
  const zero = birdFlight(0, b);
  for (const junk of [NaN, Infinity, -Infinity, undefined, null, 'x', {}]) {
    assert.deepEqual(birdFlight(junk, b), zero, `time ${String(junk)} did not read as 0`);
  }
});

test('birdFlight returns a finite origin for a junk spawn', () => {
  const origin = { x: 0, y: 0, z: 0, wing: 0 };
  for (const junk of [undefined, null, 42, 'x', [], true]) {
    assert.deepEqual(birdFlight(1.5, junk), origin);
  }
  // An object with junk fields still yields finite numbers, not NaN.
  for (const junk of [
    {},
    { radius: NaN, height: Infinity, speed: 'x', heading: {}, phase: null },
    { radius: -3, height: -9, speed: -1, heading: NaN, phase: NaN }
  ]) {
    const p = birdFlight(2, junk);
    for (const key of ['x', 'y', 'z', 'wing']) {
      assert.ok(Number.isFinite(p[key]), `${key} not finite for junk spawn`);
    }
  }
});

test('an absurd time does not overflow into non-finite numbers', () => {
  const b = birdFlock({ count: 1 })[0];
  for (const t of [Number.MAX_VALUE, 1e300, -1e300]) {
    const p = birdFlight(t, b);
    for (const key of ['x', 'y', 'z', 'wing']) {
      assert.ok(Number.isFinite(p[key]), `${key} overflowed at t=${t}`);
    }
  }
});

test('birdHeading follows the orbit tangent and stays finite', () => {
  const spawn = { radius: 10, height: 18, speed: 0.12, phase: 0.3, heading: 1.1 };
  // Step the position a hair forward in time and check the heading points along
  // that step: the whole point of a separate heading is that it matches the path
  // birdFlight draws, so this is asserted rather than trusted.
  for (const t of [0, 3.7, 41]) {
    const dt = 1e-4;
    const a = birdFlight(t, spawn);
    const b = birdFlight(t + dt, spawn);
    const heading = birdHeading(t, spawn);
    // Local +z forward: the facing vector is (sin(yaw), cos(yaw)).
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const dot = fx * dx + fz * dz;
    assert.ok(dot > 0, `heading at t=${t} points against the path (dot=${dot})`);
    assert.ok(Number.isFinite(heading), 'heading not finite');
    assert.ok(Math.abs(heading) <= Math.PI + 1e-9, 'heading outside [-pi, pi]');
  }
  // Junk spawns and absurd times read as 0 rather than NaN.
  for (const junk of [undefined, null, 5, 'x', [], {}, { speed: NaN, heading: Infinity }]) {
    assert.ok(Number.isFinite(birdHeading(2, junk)));
  }
  for (const t of [Number.MAX_VALUE, 1e300, -1e300]) {
    assert.ok(Number.isFinite(birdHeading(t, spawn)));
  }
});

test('birdsEnabled is false only for the low tier', () => {
  assert.equal(birdsEnabled('low'), false);
  assert.equal(birdsEnabled('full'), true);
  for (const junk of [undefined, null, 'LOW', 'high', 42, {}, []]) {
    assert.equal(birdsEnabled(junk), true);
  }
});
