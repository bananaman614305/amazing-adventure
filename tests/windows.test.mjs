// The window module decides where the cottage windows are, how warm each one
// glows and when it goes out across the night; the world turns those numbers
// into small emissive quads on the house faces. These tests hold the module to
// its contract: the constants and frozen phase table, the per-phase curve, the
// bedtime gate, the subtle flicker band, the spawn count and field bounds,
// determinism and seed variation, the junk guards (including an array passed as
// a spawn), and the quality gate.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WINDOW_SEED, WINDOW_COUNT, WINDOW_MAX_COUNT,
  WINDOW_MIN_RADIUS, WINDOW_MAX_RADIUS,
  WINDOW_MIN_HEIGHT, WINDOW_MAX_HEIGHT,
  WINDOW_WARM_TINT, WINDOW_MAX_GLOW,
  WINDOW_MIN_WARMTH, WINDOW_MAX_WARMTH, WINDOW_FLICKER_AMPLITUDE,
  WINDOW_PHASE_GLOW,
  windowGlowLevel, windowSpawns, windowGlow, windowsEnabled
} from '../src/windows.js';

const LIT = { warmth: 1, phase: 0, bedtime: 1 };

test('the authored constants are the ones the world relies on', () => {
  assert.equal(WINDOW_SEED, 0x2f8c61);
  assert.equal(WINDOW_COUNT, 12);
  assert.ok(WINDOW_MAX_COUNT >= WINDOW_COUNT, 'the default count must fit under the ceiling');
  assert.equal(WINDOW_MIN_RADIUS, 8);
  assert.equal(WINDOW_MAX_RADIUS, 18);
  assert.ok(WINDOW_MIN_RADIUS < WINDOW_MAX_RADIUS);
  assert.equal(WINDOW_MIN_HEIGHT, 1.6);
  assert.equal(WINDOW_MAX_HEIGHT, 3.4);
  assert.ok(WINDOW_MIN_HEIGHT < WINDOW_MAX_HEIGHT);
  assert.equal(WINDOW_WARM_TINT, 0xffc879);
  assert.ok(WINDOW_MAX_GLOW >= 0.7 && WINDOW_MAX_GLOW <= 0.95, `max glow ${WINDOW_MAX_GLOW} outside 0.7..0.95`);
  assert.ok(WINDOW_MIN_WARMTH > 0 && WINDOW_MIN_WARMTH <= WINDOW_MAX_WARMTH);
});

test('the phase glow table is frozen and has the authored values', () => {
  assert.ok(Object.isFrozen(WINDOW_PHASE_GLOW));
  assert.equal(WINDOW_PHASE_GLOW.day, 0);
  assert.equal(WINDOW_PHASE_GLOW.dusk, 0.55);
  assert.equal(WINDOW_PHASE_GLOW.night, 1);
  // Windows light up as it gets dark, so the ordering is day < dusk < night.
  assert.ok(WINDOW_PHASE_GLOW.day < WINDOW_PHASE_GLOW.dusk);
  assert.ok(WINDOW_PHASE_GLOW.dusk < WINDOW_PHASE_GLOW.night);
});

test('windowGlowLevel is per phase and falls back to day', () => {
  assert.equal(windowGlowLevel('day'), 0);
  assert.equal(windowGlowLevel('dusk'), 0.55);
  assert.equal(windowGlowLevel('night'), 1);
  assert.equal(windowGlowLevel('dawn'), 0);
  for (const junk of [undefined, null, 42, NaN, {}, [], 'DUSK', true]) {
    assert.equal(windowGlowLevel(junk), 0, `junk ${String(junk)} did not fall back to day`);
  }
});

test('windowSpawns returns exactly count items with finite fields', () => {
  const spawns = windowSpawns();
  assert.equal(spawns.length, WINDOW_COUNT);
  for (const s of spawns) {
    for (const key of ['x', 'z', 'y', 'phase', 'warmth', 'bedtime']) {
      assert.ok(Number.isFinite(s[key]), `${key} is not finite`);
    }
  }
});

test('windowSpawns honours an explicit count', () => {
  assert.equal(windowSpawns({ count: 7 }).length, 7);
  assert.equal(windowSpawns({ count: 1 }).length, 1);
});

test('every spawn lies in the house ring and the upper-storey height band', () => {
  for (const s of windowSpawns()) {
    const reach = Math.hypot(s.x, s.z);
    assert.ok(reach >= WINDOW_MIN_RADIUS - 1e-9, `reach ${reach} below min radius`);
    assert.ok(reach <= WINDOW_MAX_RADIUS + 1e-9, `reach ${reach} above max radius`);
    assert.ok(s.y >= WINDOW_MIN_HEIGHT - 1e-9 && s.y <= WINDOW_MAX_HEIGHT + 1e-9, `height ${s.y} out of band`);
    assert.ok(s.phase >= 0 && s.phase < 1, `phase ${s.phase} left [0,1)`);
    assert.ok(s.warmth >= WINDOW_MIN_WARMTH - 1e-9 && s.warmth <= WINDOW_MAX_WARMTH + 1e-9, `warmth ${s.warmth} out of band`);
    assert.ok(s.bedtime >= 0 && s.bedtime <= 1, `bedtime ${s.bedtime} left [0,1]`);
  }
});

test('the default village mixes dark, early, late and all-night windows', () => {
  const bedtimes = windowSpawns().map((s) => s.bedtime);
  assert.ok(bedtimes.some((b) => b === 0), 'no window stays dark all night');
  assert.ok(bedtimes.some((b) => b === 1), 'no window burns until morning');
  assert.ok(bedtimes.some((b) => b > 0 && b < 1), 'no window goes out partway through the night');
});

test('windowSpawns is deterministic for identical arguments', () => {
  assert.deepEqual(windowSpawns(), windowSpawns());
  assert.deepEqual(windowSpawns({ count: 6, seed: 99 }), windowSpawns({ count: 6, seed: 99 }));
});

test('a different seed gives a different village', () => {
  assert.notDeepEqual(windowSpawns({ seed: 1 }), windowSpawns({ seed: 2 }));
});

test('a count of 0 yields an empty schedule', () => {
  assert.deepEqual(windowSpawns({ count: 0 }), []);
});

test('a junk count clamps into [0, WINDOW_MAX_COUNT] and floors', () => {
  for (const junk of [NaN, Infinity, -Infinity, 'x', null, {}, undefined, []]) {
    const spawns = windowSpawns({ count: junk });
    assert.ok(spawns.length >= 0 && spawns.length <= WINDOW_MAX_COUNT, `junk count gave ${spawns.length}`);
    for (const s of spawns) assert.ok(Number.isFinite(s.x));
  }
  assert.equal(windowSpawns({ count: 1e9 }).length, WINDOW_MAX_COUNT);
  assert.equal(windowSpawns({ count: -5 }).length, 0);
  assert.equal(windowSpawns({ count: 3.9 }).length, 3);
});

test('a junk seed falls back to the authored seed', () => {
  assert.deepEqual(windowSpawns({ count: 5, seed: NaN }), windowSpawns({ count: 5, seed: WINDOW_SEED }));
  assert.deepEqual(windowSpawns({ count: 5, seed: Infinity }), windowSpawns({ count: 5 }));
});

test('a junk options object falls back to the defaults', () => {
  const baseline = windowSpawns();
  for (const junk of [null, [], 'x', 42, true, NaN]) {
    assert.deepEqual(windowSpawns(junk), baseline, `options ${String(junk)} did not fall back`);
  }
});

test('windowGlow is exactly 0 by day for every spawn and night fraction', () => {
  for (const s of windowSpawns()) {
    for (let n = 0; n <= 1; n += 0.1) {
      assert.equal(windowGlow('day', s, n), 0, `day glow nonzero at n=${n}`);
    }
  }
});

test('glow ordering is night > dusk > day', () => {
  const pane = windowSpawns().find((s) => s.bedtime === 1);
  const day = windowGlow('day', pane, 0.5);
  const dusk = windowGlow('dusk', pane, 0.5);
  const night = windowGlow('night', pane, 0.5);
  assert.equal(day, 0);
  assert.ok(dusk > day, `dusk ${dusk} not above day ${day}`);
  assert.ok(night > dusk, `night ${night} not above dusk ${dusk}`);
});

test('a window is exactly dark after its bedtime', () => {
  const pane = { warmth: 1, phase: 0.4, bedtime: 0.7 };
  assert.ok(windowGlow('night', pane, 0.7) > 0, 'the window should still be lit at its bedtime');
  assert.equal(windowGlow('night', pane, 0.71), 0, 'the window should be dark past its bedtime');
  assert.equal(windowGlow('night', pane, 0.95), 0);
  assert.equal(windowGlow('night', pane, 1), 0);
});

test('an all-night window never goes dark', () => {
  for (let n = 0; n <= 1; n += 0.05) {
    assert.ok(windowGlow('night', LIT, n) > 0, `all-night window went dark at n=${n}`);
  }
});

test('the flicker stays within its documented band', () => {
  // Warmth 0.9 keeps the peak below WINDOW_MAX_GLOW, so the ceiling clamp does
  // not mask the flicker and the raw ratio is visible.
  const pane = { warmth: 0.9, phase: 0.3, bedtime: 1 };
  const base = WINDOW_MAX_GLOW * WINDOW_PHASE_GLOW.night * pane.warmth;
  const band = WINDOW_FLICKER_AMPLITUDE + 1e-9;
  for (let n = 0; n <= 1; n += 0.002) {
    const ratio = windowGlow('night', pane, n) / base;
    assert.ok(Math.abs(ratio - 1) <= band, `flicker ratio ${ratio} outside 1 +/- ${band}`);
  }
});

test('the flicker actually varies across the night', () => {
  const pane = { warmth: 0.9, phase: 0.3, bedtime: 1 };
  const base = WINDOW_MAX_GLOW * WINDOW_PHASE_GLOW.night * pane.warmth;
  let lo = Infinity;
  let hi = -Infinity;
  for (let n = 0; n <= 1; n += 0.002) {
    const ratio = windowGlow('night', pane, n) / base;
    lo = Math.min(lo, ratio);
    hi = Math.max(hi, ratio);
  }
  assert.ok(hi - lo > 0.02, `flicker barely moves (spread ${hi - lo})`);
});

test('different phases flicker out of step', () => {
  const a = { warmth: 0.9, phase: 0, bedtime: 1 };
  const b = { warmth: 0.9, phase: 0.5, bedtime: 1 };
  let differs = false;
  for (let n = 0; n <= 1; n += 0.05) {
    if (Math.abs(windowGlow('night', a, n) - windowGlow('night', b, n)) > 1e-6) differs = true;
  }
  assert.ok(differs, 'two panes with different phases breathed in lockstep');
});

test('a fully warm window reaches near the ceiling at night', () => {
  let peak = 0;
  for (let n = 0; n <= 1; n += 0.002) peak = Math.max(peak, windowGlow('night', LIT, n));
  assert.ok(peak >= WINDOW_MAX_GLOW * 0.95, `night peak only ${peak}`);
  assert.ok(peak <= WINDOW_MAX_GLOW + 1e-12);
});

test('windowGlow stays finite and in range over a long sweep', () => {
  const spawns = windowSpawns();
  const phases = ['day', 'dusk', 'night', 'dawn', 'bogus', undefined, null, 42, {}, []];
  for (const phaseId of phases) {
    for (const s of spawns) {
      for (let n = 0; n <= 1; n += 0.05) {
        const g = windowGlow(phaseId, s, n);
        assert.ok(Number.isFinite(g) && g >= 0 && g <= WINDOW_MAX_GLOW, `glow ${g} out of range`);
      }
    }
  }
});

test('windowGlow clamps a junk or out-of-range night fraction', () => {
  for (const n of [NaN, Infinity, -Infinity, 'x', null, undefined, -1, 2]) {
    const g = windowGlow('night', LIT, n);
    assert.ok(Number.isFinite(g) && g >= 0 && g <= WINDOW_MAX_GLOW, `night fraction ${String(n)} gave ${g}`);
  }
});

test('a junk spawn falls back to a neutral all-night pane', () => {
  const neutral = windowGlow('night', LIT, 0.5);
  for (const junk of [undefined, null, 42, 'x', {}, { warmth: NaN, phase: NaN, bedtime: NaN }]) {
    const g = windowGlow('night', junk, 0.5);
    assert.ok(Number.isFinite(g) && g >= 0 && g <= WINDOW_MAX_GLOW, `junk spawn gave ${g}`);
  }
  assert.ok(Math.abs(windowGlow('night', undefined, 0.5) - neutral) < 1e-9);
});

test('an array passed as a spawn is treated as junk, not as fields', () => {
  // An array has no warmth/phase/bedtime of its own; reading them would either
  // be undefined or pick up Array.prototype members, so it must read as neutral.
  const neutral = windowGlow('night', LIT, 0.5);
  for (const arr of [[], [1, 2, 3], [0.5, 0.5, 0.5]]) {
    const g = windowGlow('night', arr, 0.5);
    assert.ok(Number.isFinite(g) && g >= 0 && g <= WINDOW_MAX_GLOW, `array spawn gave ${g}`);
    assert.ok(Math.abs(g - neutral) < 1e-9, `array spawn did not read as neutral (${g} vs ${neutral})`);
  }
});

test('windowsEnabled is false only for the low tier', () => {
  assert.equal(windowsEnabled('low'), false);
  assert.equal(windowsEnabled('full'), true);
  for (const junk of [undefined, null, 'LOW', 'high', 42, {}, []]) {
    assert.equal(windowsEnabled(junk), true);
  }
});
