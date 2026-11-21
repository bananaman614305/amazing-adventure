// The atmosphere curve: continuous fog over the day cycle.
//
// The old behaviour was a constant per phase, swapped in one frame. These tests
// pin the shape that replaced it: continuous, eased, wrapping without a step,
// and tied to the phase palettes so the haze cannot drift away from the sky.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ATMOSPHERE_KEYS, ease, mixHex, atmosphereAt, applyAtmosphere, keyDistances
} from '../src/atmosphere.js';
import { PHASE_LOOKS } from '../src/world.js';
import { CYCLE_SECONDS, PHASES, wrapClock } from '../src/daynight.js';

test('the key table spans the whole cycle exactly once', () => {
  assert.equal(ATMOSPHERE_KEYS[0].at, 0, 'the curve must start at the cycle start');
  assert.equal(ATMOSPHERE_KEYS.at(-1).at, CYCLE_SECONDS, 'the curve must close the cycle');
  for (let i = 1; i < ATMOSPHERE_KEYS.length; i += 1) {
    assert.ok(ATMOSPHERE_KEYS[i].at > ATMOSPHERE_KEYS[i - 1].at,
      `key ${i} does not move forward in time`);
  }
});

test('every key resolves to a real palette and usable distances', () => {
  for (const key of ATMOSPHERE_KEYS) {
    assert.ok(PHASE_LOOKS[key.phase], `${key.at}s names unknown phase ${key.phase}`);
    const { near, far } = keyDistances(key);
    assert.ok(Number.isFinite(near) && near > 0, `${key.at}s near must be positive`);
    assert.ok(Number.isFinite(far) && far > near, `${key.at}s far must sit beyond near`);
  }
});

test('keys without an override inherit the phase palette distances', () => {
  // The three phase anchors must stay in one place: if someone retunes the dusk
  // fog in world.js, the curve has to move with it instead of going stale.
  for (const key of ATMOSPHERE_KEYS) {
    const look = PHASE_LOOKS[key.phase];
    const { near, far } = keyDistances(key);
    if (Number.isFinite(key.near)) {
      assert.equal(near, key.near, `${key.at}s should use its own override`);
    } else {
      assert.equal(near, look.fogNear, `${key.at}s should inherit ${key.phase} fogNear`);
      assert.equal(far, look.fogFar, `${key.at}s should inherit ${key.phase} fogFar`);
    }
  }
  // At least one key of each phase palette uses the inherited values, or the
  // curve would have quietly decoupled from the phase table.
  for (const phase of ['day', 'dusk', 'night']) {
    const inherited = ATMOSPHERE_KEYS.some((k) => k.phase === phase && !Number.isFinite(k.near));
    assert.ok(inherited, `${phase} has no key inheriting the palette fog`);
  }
});

test('the wrap key matches the dawn key so dawn does not step', () => {
  const first = ATMOSPHERE_KEYS[0];
  const last = ATMOSPHERE_KEYS.at(-1);
  assert.deepEqual({ ...keyDistances(last), phase: last.phase },
    { ...keyDistances(first), phase: first.phase });
});

test('easing is clamped, symmetric and monotonic', () => {
  assert.equal(ease(-5), 0);
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  assert.equal(ease(5), 1);
  assert.equal(ease(NaN), 0);
  // Half way in, half way out, and eased values stay flat at both ends.
  assert.ok(Math.abs(ease(0.5) - 0.5) < 1e-12);
  assert.ok(ease(0.1) < 0.1, 'easing should start gently');
  assert.ok(ease(0.9) > 0.9, 'easing should finish gently');
  let previous = -1;
  for (let u = 0; u <= 1.0001; u += 0.05) {
    const value = ease(u);
    assert.ok(value >= previous, 'easing must never go backwards');
    previous = value;
  }
});

test('colour mixing hits the endpoints and stays in range', () => {
  assert.equal(mixHex(0x000000, 0xffffff, 0), 0x000000);
  assert.equal(mixHex(0x000000, 0xffffff, 1), 0xffffff);
  assert.equal(mixHex(0x000000, 0xffffff, 2), 0xffffff, 'clamped above');
  assert.equal(mixHex(0x000000, 0xffffff, -1), 0x000000, 'clamped below');
  assert.equal(mixHex(0x102030, 0x405060, NaN), 0x102030, 'NaN reads as the start');
  const mid = mixHex(0x000000, 0xffffff, 0.5);
  const c = [(mid >> 16) & 255, (mid >> 8) & 255, mid & 255];
  for (const channel of c) assert.ok(channel >= 127 && channel <= 128);
  // A channel-wise blend of two blues must not leak into red.
  const blue = mixHex(0x0000ff, 0x0000cc, 0.5);
  assert.equal(blue >> 16, 0);
});

test('fog distances are continuous across the whole cycle', () => {
  // Walk the clock in small steps and demand no jump. A phase-boundary step is
  // exactly the artefact this module exists to remove, so this is the key test.
  const step = 0.25;
  let previous = atmosphereAt(0);
  for (let t = step; t <= CYCLE_SECONDS; t += step) {
    const now = atmosphereAt(t);
    assert.ok(Math.abs(now.near - previous.near) <= 0.6,
      `near jumped ${previous.near} -> ${now.near} at ${t}s`);
    assert.ok(Math.abs(now.far - previous.far) <= 0.8,
      `far jumped ${previous.far} -> ${now.far} at ${t}s`);
    previous = now;
  }
});

test('the colour curve is continuous too, including at the wrap', () => {
  // Same walk, but on the colour: a hard step in hue is as visible as a step in
  // distance, and the wrap point is the easiest place to get it wrong.
  const channelDelta = (a, b) => {
    const ar = (a >> 16) & 255; const ag = (a >> 8) & 255; const ab = a & 255;
    const br = (b >> 16) & 255; const bg = (b >> 8) & 255; const bb = b & 255;
    return Math.max(Math.abs(ar - br), Math.abs(ag - bg), Math.abs(ab - bb));
  };
  let previous = atmosphereAt(CYCLE_SECONDS - 0.25);
  const first = atmosphereAt(0);
  assert.ok(channelDelta(previous.color, first.color) <= 3,
    'the haze pops at the cycle wrap');
  previous = first;
  for (let t = 0.25; t < CYCLE_SECONDS; t += 0.25) {
    const now = atmosphereAt(t);
    assert.ok(channelDelta(previous.color, now.color) <= 3,
      `colour jumped at ${t}s`);
    previous = now;
  }
});

test('the fog is thickest in the small hours and clearest at noon', () => {
  // The point of the curve, stated as a rule: vision is best mid-afternoon and
  // worst deep at night, with dawn mist in between.
  const clear = atmosphereAt(40); // mid-morning to noon
  const deep = atmosphereAt(150); // settled night
  const dawn = atmosphereAt(0);
  assert.ok(clear.far > deep.far, 'day should see further than night');
  assert.ok(clear.far > dawn.far, 'the morning burns the mist off');
  assert.ok(deep.far <= dawn.far, 'settled night is the tightest');
  // Night is also closer in on the near plane: the fog starts sooner.
  assert.ok(deep.near < clear.near);
});

test('each key returns its own values exactly on the key time', () => {
  for (const key of ATMOSPHERE_KEYS) {
    const { near, far } = keyDistances(key);
    const value = atmosphereAt(key.at);
    assert.ok(Math.abs(value.near - near) < 1e-9, `${key.at}s near`);
    assert.ok(Math.abs(value.far - far) < 1e-9, `${key.at}s far`);
  }
});

test('fog colour tracks the phase palettes it is meant to blend', () => {
  // At every key time the haze is that palette's own fog colour, so a palette
  // edit moves the haze with the sky instead of leaving it stale.
  for (const key of ATMOSPHERE_KEYS) {
    const look = PHASE_LOOKS[key.phase];
    assert.equal(atmosphereAt(key.at).color, (look.fog ?? look.sky) >>> 0,
      `${key.at}s haze does not match the ${key.phase} palette`);
  }
});

test('the reported phase agrees with the day/night clock inside each phase', () => {
  // Deep in each phase the haze should report the palette you are actually
  // standing in, so a HUD or bug report is not misleading. At the very start of
  // a phase the blend has only just left the previous palette, which is the
  // point of a blend, so only the settled part of each phase is pinned here.
  for (const phase of PHASES) {
    const mid = phase.start + (phase.end - phase.start) * 0.8;
    assert.equal(atmosphereAt(mid).phase, phase.id, `${phase.id} at ${mid}s`);
  }
  assert.ok(PHASE_LOOKS[atmosphereAt(0).phase], 'reported phase must be a real palette');
});

test('a nonsense clock reads as dawn instead of NaN', () => {
  for (const bad of [NaN, undefined, null, -1, CYCLE_SECONDS * 3, 'noon']) {
    const value = atmosphereAt(bad);
    assert.ok(Number.isFinite(value.near) && Number.isFinite(value.far),
      `bad clock ${String(bad)} produced ${value.near}/${value.far}`);
    assert.ok(PHASE_LOOKS[value.phase]);
  }
  // Negative input wraps exactly the way the clock does elsewhere.
  assert.deepEqual(atmosphereAt(-1), atmosphereAt(wrapClock(-1)));
});

test('applyAtmosphere writes the curve onto a scene fog', () => {
  const fog = {
    color: { setHex(hex) { this.hex = hex & 0xffffff; return this; } },
    near: 0,
    far: 0
  };
  const environment = { scene: { fog } };
  const value = applyAtmosphere(environment, 150);
  assert.equal(fog.near, value.near);
  assert.equal(fog.far, value.far);
  assert.equal(fog.color.hex, value.color);
});

test('applyAtmosphere survives a stub scene with no fog', () => {
  // Headless harnesses and focused tests build partial environments; a missing
  // fog object must not turn into a per-frame exception.
  assert.doesNotThrow(() => applyAtmosphere({ scene: {} }, 12));
  assert.doesNotThrow(() => applyAtmosphere(null, 12));
  assert.doesNotThrow(() => applyAtmosphere(undefined, 12));
  assert.doesNotThrow(() => applyAtmosphere({}, 12));
  // It still reports the curve so a caller can log or assert on it.
  assert.equal(typeof applyAtmosphere(null, 12).near, 'number');
});
