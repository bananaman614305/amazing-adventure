// The spray module decides where the fountain's falling droplets are at a given
// time, how big they are and how visible they are; the world turns those numbers
// into one InstancedMesh of small quads. These tests hold the module to its
// contract: the authored constants and their bands, the frozen phase table and
// its junk fallback, the spawn count and field bounds, determinism and seed
// sensitivity, the guards on every entry point, the fall and fade over one life,
// the enormous-time overflow guard, negative-time wrapping and the tier gate.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SPRAY_SEED, SPRAY_COUNT, SPRAY_MAX_COUNT,
  SPRAY_APEX, SPRAY_LAND, SPRAY_MIN_RADIUS, SPRAY_MAX_RADIUS,
  SPRAY_MIN_SIZE, SPRAY_MAX_SIZE, SPRAY_LIFE, SPRAY_MAX_OPACITY,
  SPRAY_FADE_TAIL, SPRAY_PHASE_GLOW,
  sprayGlowLevel, spraySpawns, sprayDrop, sprayEnabled
} from '../src/spray.js';

// A crafted droplet with no seeded jitter, so the fall maths can be stated
// plainly: phase 0 means a droplet starts at the apex at t = 0.
const craft = (over = {}) => ({ angle: 0, radius: 0.5, phase: 0, speed: 1, size: 0.05, ...over });

test('the authored constants are the ones the world relies on', () => {
  assert.equal(SPRAY_SEED, 0x51c7a3);
  assert.equal(SPRAY_COUNT, 64);
  assert.equal(SPRAY_MAX_COUNT, 400);
  assert.equal(SPRAY_APEX, 2.55);
  assert.equal(SPRAY_LAND, 0.18);
  assert.equal(SPRAY_MIN_RADIUS, 0.12);
  assert.equal(SPRAY_MAX_RADIUS, 0.95);
  assert.equal(SPRAY_MIN_SIZE, 0.03);
  assert.equal(SPRAY_MAX_SIZE, 0.075);
  assert.equal(SPRAY_LIFE, 1.15);
  assert.equal(SPRAY_MAX_OPACITY, 0.55);
  assert.equal(SPRAY_FADE_TAIL, 0.12);
});

test('the constants sit in their documented bands', () => {
  assert.ok(SPRAY_LAND > 0, 'the water surface must be above the ground');
  assert.ok(SPRAY_APEX > SPRAY_LAND, 'the apex must be above the water');
  // The jet apex is about 2.5 m; the authored apex must be plausible for it.
  assert.ok(SPRAY_APEX > 2.4 && SPRAY_APEX < 2.7);
  assert.ok(SPRAY_MIN_RADIUS > 0 && SPRAY_MIN_RADIUS < SPRAY_MAX_RADIUS);
  // The farthest landing radius must stay well inside the 1.6 m basin.
  assert.ok(SPRAY_MAX_RADIUS < 1.6);
  assert.ok(SPRAY_MAX_RADIUS < 1.6 * 0.75, 'the spray reaches too close to the rim');
  assert.ok(SPRAY_MIN_SIZE > 0 && SPRAY_MIN_SIZE < SPRAY_MAX_SIZE);
  assert.ok(SPRAY_LIFE > 0);
  assert.ok(SPRAY_MAX_OPACITY > 0 && SPRAY_MAX_OPACITY <= 1);
  assert.ok(SPRAY_FADE_TAIL > 0 && SPRAY_FADE_TAIL < 1);
  assert.ok(SPRAY_MAX_COUNT >= SPRAY_COUNT);
});

test('the phase glow table is frozen with dusk strongest and night weakest', () => {
  assert.ok(Object.isFrozen(SPRAY_PHASE_GLOW));
  assert.equal(SPRAY_PHASE_GLOW.dusk, 1);
  assert.equal(SPRAY_PHASE_GLOW.day, 0.8);
  assert.equal(SPRAY_PHASE_GLOW.night, 0.55);
  assert.ok(SPRAY_PHASE_GLOW.dusk > SPRAY_PHASE_GLOW.day);
  assert.ok(SPRAY_PHASE_GLOW.day > SPRAY_PHASE_GLOW.night);
});

test('sprayGlowLevel is per phase and falls back to day', () => {
  assert.equal(sprayGlowLevel('day'), 0.8);
  assert.equal(sprayGlowLevel('dusk'), 1);
  assert.equal(sprayGlowLevel('night'), 0.55);
  // Unknown phase, and every kind of junk, reads as the day value.
  assert.equal(sprayGlowLevel('dawn'), 0.8);
  for (const junk of [undefined, null, 42, NaN, {}, [], 'DUSK', new String('day')]) {
    assert.equal(sprayGlowLevel(junk), 0.8);
  }
});

test('sprayGlowLevel only reads own properties of the table', () => {
  // Inherited names such as `toString` must not leak a function or throw.
  assert.equal(sprayGlowLevel('toString'), 0.8);
  assert.equal(sprayGlowLevel('hasOwnProperty'), 0.8);
});

test('spraySpawns returns exactly count descriptors with the exact fields', () => {
  const spawns = spraySpawns();
  assert.equal(spawns.length, SPRAY_COUNT);
  for (const s of spawns) {
    assert.deepEqual(Object.keys(s).sort(), ['angle', 'phase', 'radius', 'size', 'speed']);
    for (const key of ['angle', 'radius', 'phase', 'speed', 'size']) {
      assert.ok(Number.isFinite(s[key]), `${key} is not finite`);
    }
  }
});

test('every spawn field lies inside its documented band', () => {
  for (const s of spraySpawns()) {
    assert.ok(s.angle >= 0 && s.angle < Math.PI * 2, `angle ${s.angle} left [0, 2pi)`);
    assert.ok(s.radius >= SPRAY_MIN_RADIUS - 1e-9, `radius ${s.radius} below the min`);
    assert.ok(s.radius <= SPRAY_MAX_RADIUS + 1e-9, `radius ${s.radius} above the max`);
    assert.ok(s.phase >= 0 && s.phase < 1, `phase ${s.phase} left [0,1)`);
    assert.ok(s.speed >= 0.8 - 1e-9 && s.speed <= 1.2 + 1e-9, `speed ${s.speed} out of band`);
    assert.ok(s.size >= SPRAY_MIN_SIZE - 1e-9 && s.size <= SPRAY_MAX_SIZE + 1e-9, `size ${s.size} out of band`);
  }
});

test('spraySpawns honours an explicit count', () => {
  assert.equal(spraySpawns({ count: 7 }).length, 7);
  assert.equal(spraySpawns({ count: 1 }).length, 1);
  assert.deepEqual(spraySpawns({ count: 0 }), []);
});

test('spraySpawns ignores options it does not document', () => {
  // Only `count` and `seed` are honoured; other keys must not change the field.
  const plain = spraySpawns({ count: 5, seed: 7 });
  const noisy = spraySpawns({ count: 5, seed: 7, radius: 99, apex: -1, junk: true });
  assert.deepEqual(noisy, plain);
});

test('spraySpawns is deterministic for identical arguments', () => {
  assert.deepEqual(spraySpawns(), spraySpawns());
  assert.deepEqual(spraySpawns({ count: 9, seed: 99 }), spraySpawns({ count: 9, seed: 99 }));
});

test('a different seed gives a different field', () => {
  assert.notDeepEqual(spraySpawns({ seed: 1 }), spraySpawns({ seed: 2 }));
});

test('the curtain is spread around the basin, not stacked on one spot', () => {
  const spawns = spraySpawns();
  const angles = new Set(spawns.map((s) => Math.round(s.angle * 1000)));
  const radii = new Set(spawns.map((s) => Math.round(s.radius * 1000)));
  assert.ok(angles.size > 30, `only ${angles.size} distinct angles`);
  assert.ok(radii.size > 30, `only ${radii.size} distinct radii`);
});

test('every droplet stays inside the basin across its whole life', () => {
  for (const s of spraySpawns()) {
    for (let t = 0; t < 3; t += 0.07) {
      const d = sprayDrop(s, t);
      const reach = Math.hypot(d.x, d.z);
      // Even at full spread the reach cannot exceed the landing radius, which is
      // capped below the basin edge.
      assert.ok(reach <= SPRAY_MAX_RADIUS + 1e-9, `reach ${reach} left the basin`);
    }
  }
});

test('a junk count clamps into [0, SPRAY_MAX_COUNT] and floors', () => {
  for (const junk of [NaN, Infinity, -Infinity, 'x', null, {}, undefined]) {
    const spawns = spraySpawns({ count: junk });
    assert.ok(spawns.length >= 0 && spawns.length <= SPRAY_MAX_COUNT, `junk count gave ${spawns.length}`);
    for (const s of spawns) assert.ok(Number.isFinite(s.angle));
  }
  assert.equal(spraySpawns({ count: 1e9 }).length, SPRAY_MAX_COUNT);
  assert.equal(spraySpawns({ count: -5 }).length, 0);
  assert.equal(spraySpawns({ count: 3.9 }).length, 3);
});

test('a junk seed falls back to the authored seed', () => {
  assert.deepEqual(spraySpawns({ count: 4, seed: NaN }), spraySpawns({ count: 4, seed: SPRAY_SEED }));
  assert.deepEqual(spraySpawns({ count: 4, seed: Infinity }), spraySpawns({ count: 4 }));
});

test('a junk options argument falls back to the defaults', () => {
  for (const junk of [undefined, null, 42, 'x', NaN, [], true]) {
    const spawns = spraySpawns(junk);
    assert.equal(spawns.length, SPRAY_COUNT);
    for (const s of spawns) assert.ok(Number.isFinite(s.angle) && Number.isFinite(s.size));
  }
});

test('sprayDrop returns finite, bounded values across a long sweep', () => {
  const spawns = spraySpawns();
  for (const s of spawns) {
    for (let t = 0; t < 120; t += 0.11) {
      const d = sprayDrop(s, t);
      for (const key of ['x', 'y', 'z', 'size', 'opacity']) {
        assert.ok(Number.isFinite(d[key]), `${key} not finite at t=${t}`);
      }
      assert.ok(d.y >= SPRAY_LAND - 1e-9 && d.y <= SPRAY_APEX + 1e-9, `y ${d.y} left the fall band`);
      assert.ok(d.opacity >= 0 && d.opacity <= SPRAY_MAX_OPACITY + 1e-9, `opacity ${d.opacity} out of band`);
      assert.ok(d.size >= SPRAY_MIN_SIZE - 1e-9 && d.size <= SPRAY_MAX_SIZE + 1e-9, `size ${d.size} out of band`);
    }
  }
});

test('a droplet starts at the apex and reaches the water by the end of its life', () => {
  const s = craft();
  const born = sprayDrop(s, 0);
  assert.ok(Math.abs(born.y - SPRAY_APEX) < 1e-9, `born at ${born.y}, not the apex`);
  const nearEnd = sprayDrop(s, SPRAY_LIFE * 0.999).y;
  assert.ok(nearEnd > SPRAY_LAND - 1e-9, `fell below the water at ${nearEnd}`);
  assert.ok(nearEnd < SPRAY_APEX * 0.1, `still high at the end: ${nearEnd}`);
});

test('y falls monotonically and stays inside [SPRAY_LAND, SPRAY_APEX]', () => {
  const s = craft();
  let previous = Infinity;
  for (let t = 0; t < SPRAY_LIFE * 0.999; t += 0.01) {
    const y = sprayDrop(s, t).y;
    assert.ok(y <= previous + 1e-12, `y ${y} rose at t=${t}`);
    assert.ok(y >= SPRAY_LAND - 1e-9 && y <= SPRAY_APEX + 1e-9, `y ${y} left the band at t=${t}`);
    previous = y;
  }
});

test('the fall accelerates: later equal time steps drop further', () => {
  const s = craft();
  const early = sprayDrop(s, 0).y - sprayDrop(s, SPRAY_LIFE * 0.1).y;
  const late = sprayDrop(s, SPRAY_LIFE * 0.85).y - sprayDrop(s, SPRAY_LIFE * 0.95).y;
  assert.ok(late > early, `the fall did not accelerate (early ${early}, late ${late})`);
});

test('the horizontal radius grows with the life position', () => {
  const s = craft({ angle: 0 });
  let previous = -Infinity;
  for (let t = 0; t < SPRAY_LIFE * 0.99; t += 0.01) {
    const r = Math.hypot(sprayDrop(s, t).x, sprayDrop(s, t).z);
    assert.ok(r >= previous - 1e-12, `radius ${r} shrank at t=${t}`);
    previous = r;
  }
  // It starts at a quarter of the landing radius and ends near the full one.
  assert.ok(Math.abs(sprayDrop(s, 0).x - s.radius * 0.25) < 1e-9);
  assert.ok(sprayDrop(s, SPRAY_LIFE * 0.999).x > s.radius * 0.95);
});

test('the droplet holds full opacity then fades to nothing at the end', () => {
  const s = craft();
  // Before the tail the opacity is the maximum.
  assert.equal(sprayDrop(s, 0).opacity, SPRAY_MAX_OPACITY);
  assert.equal(sprayDrop(s, SPRAY_LIFE * (1 - SPRAY_FADE_TAIL) * 0.5).opacity, SPRAY_MAX_OPACITY);
  // The fade starts at the top of the tail (opacity is still the maximum there)
  // and falls linearly to zero at p == 1.
  assert.ok(Math.abs(sprayDrop(s, SPRAY_LIFE * (1 - SPRAY_FADE_TAIL)).opacity - SPRAY_MAX_OPACITY) < 1e-9);
  let previous = Infinity;
  for (let p = 1 - SPRAY_FADE_TAIL; p < 1; p += 0.005) {
    const opacity = sprayDrop(s, SPRAY_LIFE * p).opacity;
    assert.ok(opacity <= previous + 1e-12, `opacity ${opacity} rose at p=${p}`);
    assert.ok(opacity >= -1e-12, `opacity ${opacity} went negative at p=${p}`);
    previous = opacity;
  }
  // p is a fraction in [0, 1), so p == 1 is never sampled; the droplet is
  // already invisible (far below one visible step) just short of the wrap.
  assert.ok(sprayDrop(s, SPRAY_LIFE * (1 - 1e-9)).opacity < 1e-6);
});

test('the droplet keeps its seeded size throughout the fall', () => {
  const s = craft({ size: 0.061 });
  for (const t of [0, 0.2, 0.5, 0.9, SPRAY_LIFE - 1e-6]) {
    assert.equal(sprayDrop(s, t).size, 0.061);
  }
});

test('a junk spawn yields a finite, invisible droplet rather than throwing', () => {
  for (const junk of [undefined, null, 42, 'x', NaN, [], true]) {
    const d = sprayDrop(junk, 1);
    assert.deepEqual(d, { x: 0, y: SPRAY_LAND, z: 0, size: SPRAY_MIN_SIZE, opacity: 0 });
  }
});

test('a spawn with non-finite or out-of-band fields still yields finite droplets', () => {
  for (const broken of [
    { angle: NaN, radius: Infinity, phase: 'x', speed: -Infinity, size: undefined },
    { angle: Infinity, radius: -5, phase: -3, speed: 99, size: 1e9 },
    {}
  ]) {
    for (let t = 0; t < 4; t += 0.3) {
      const d = sprayDrop(broken, t);
      for (const key of ['x', 'y', 'z', 'size', 'opacity']) {
        assert.ok(Number.isFinite(d[key]), `${key} not finite for a broken spawn`);
      }
      assert.ok(d.y >= SPRAY_LAND - 1e-9 && d.y <= SPRAY_APEX + 1e-9);
      assert.ok(d.opacity >= 0 && d.opacity <= SPRAY_MAX_OPACITY + 1e-9);
    }
  }
});

test('a non-finite time reads as time 0', () => {
  const s = craft();
  const zero = sprayDrop(s, 0);
  for (const junk of [NaN, Infinity, -Infinity, undefined, null, 'x', {}]) {
    assert.deepEqual(sprayDrop(s, junk), zero, `time ${String(junk)} did not read as 0`);
  }
});

test('a finite-but-enormous time does not overflow into NaN', () => {
  const s = craft();
  for (const t of [Number.MAX_VALUE, 1e308, -1e308]) {
    const d = sprayDrop(s, t);
    for (const key of ['x', 'y', 'z', 'size', 'opacity']) {
      assert.ok(Number.isFinite(d[key]), `${key} overflowed at t=${t}`);
    }
  }
});

test('negative time wraps the arc correctly', () => {
  const s = craft();
  // A negative time that lands one whole life before t = 0 is the same pose.
  assert.deepEqual(sprayDrop(s, -SPRAY_LIFE / s.speed), sprayDrop(s, 0));
  // And a negative time still yields a well-formed droplet, not a mirrored one.
  const d = sprayDrop(s, -SPRAY_LIFE * 0.5);
  for (const key of ['x', 'y', 'z', 'size', 'opacity']) {
    assert.ok(Number.isFinite(d[key]), `${key} not finite for negative time`);
  }
  assert.ok(d.y >= SPRAY_LAND - 1e-9 && d.y <= SPRAY_APEX + 1e-9, `y ${d.y} left the band`);
});

test('sprayEnabled is false only for the low tier', () => {
  assert.equal(sprayEnabled('low'), false);
  assert.equal(sprayEnabled('full'), true);
  for (const junk of [undefined, null, 'LOW', 'high', 42, {}, []]) {
    assert.equal(sprayEnabled(junk), true);
  }
});

test('no call produces NaN or Infinity across many seeds and long times', () => {
  for (const seed of [0, 1, 7, 0x51c7a3, 0xdeadbeef, 2 ** 32 - 1]) {
    const spawns = spraySpawns({ count: SPRAY_MAX_COUNT, seed });
    for (let i = 0; i < spawns.length; i += 7) {
      const s = spawns[i];
      for (let t = -20; t < 40; t += 1.37) {
        const d = sprayDrop(s, t);
        for (const key of ['x', 'y', 'z', 'size', 'opacity']) {
          assert.ok(Number.isFinite(d[key]), `${key} not finite at seed=${seed}, t=${t}`);
        }
        assert.ok(d.y >= SPRAY_LAND - 1e-9 && d.y <= SPRAY_APEX + 1e-9);
        assert.ok(d.opacity >= 0 && d.opacity <= SPRAY_MAX_OPACITY + 1e-9);
      }
    }
  }
});
