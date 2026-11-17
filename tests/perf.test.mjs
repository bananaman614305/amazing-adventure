import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampRatio, nextRatio, smooth, createAdaptiveResolution,
  MIN_RATIO, MAX_RATIO, STEP, SLOW_MS, FAST_MS, SETTLE_FRAMES, MAX_SAMPLE_MS
} from '../src/perf.js';

test('clampRatio stays inside the supported bounds', () => {
  assert.equal(clampRatio(-5), MIN_RATIO);
  assert.equal(clampRatio(99), MAX_RATIO);
  assert.equal(clampRatio(NaN), 1, 'garbage falls back to 1');
  assert.equal(clampRatio(undefined), 1);
  assert.equal(clampRatio(1), 1, 'exact ratios are reachable');
  assert.equal(clampRatio(2), 2);
  assert.equal(clampRatio(0.5), 0.5);
  for (const value of [0.5, 0.75, 1, 1.5, 2, 3, -1]) {
    const r = clampRatio(value);
    assert.ok(r >= MIN_RATIO && r <= MAX_RATIO, `${value} -> ${r} in range`);
    const steps = (r - MIN_RATIO) / STEP;
    assert.ok(Math.abs(steps - Math.round(steps)) < 1e-6, `${r} is on a step boundary`);
  }
});

test('slow frames lower the ratio and fast frames raise it', () => {
  assert.ok(nextRatio(1, SLOW_MS + 10) < 1, 'slow lowers');
  assert.ok(nextRatio(1, FAST_MS - 5) > 1, 'fast raises');
  assert.equal(nextRatio(1, (SLOW_MS + FAST_MS) / 2), 1, 'comfortable holds');
  assert.equal(nextRatio(MIN_RATIO, SLOW_MS + 50), MIN_RATIO, 'cannot go below the floor');
  assert.equal(nextRatio(MAX_RATIO, 5), MAX_RATIO, 'cannot go above the ceiling');
});

test('nextRatio never oscillates on the same input', () => {
  let ratio = 1;
  for (let i = 0; i < 20; i += 1) ratio = nextRatio(ratio, SLOW_MS + 1);
  const settled = ratio;
  for (let i = 0; i < 5; i += 1) ratio = nextRatio(ratio, SLOW_MS + 1);
  assert.equal(ratio, settled, 'repeated slow frames reach the floor and stay');
});

test('smooth moves toward the sample without jumping', () => {
  assert.equal(smooth(NaN, 40), 40, 'first sample is taken as-is');
  const s = smooth(20, 40, 0.1);
  assert.ok(s > 20 && s <= 22, `smoothed to ${s}`);
  // A single huge spike must not dominate.
  let v = 16;
  for (let i = 0; i < 10; i += 1) v = smooth(v, 16);
  assert.ok(smooth(v, 500) < 80, 'one spike is damped');
});

test('the controller ignores startup hitches', () => {
  const ctl = createAdaptiveResolution({ start: 1 });
  // Simulate a long shader compile on frame one.
  ctl.sample(800);
  assert.equal(ctl.ratio, 1, 'no change during the settle window');
  // Fast frames after the settle window may raise the ratio; what matters is
  // that the discarded 800ms hitch did not drag it down.
  for (let i = 0; i < SETTLE_FRAMES; i += 1) ctl.sample(16);
  assert.ok(ctl.ratio >= 1, `hitch did not lower the ratio (${ctl.ratio})`);
});

test('an absurd frame time is clamped, so one hitch cannot dominate', () => {
  const ctl = createAdaptiveResolution({ start: 1 });
  for (let i = 0; i < 100; i += 1) ctl.sample(25); // comfortable, settled
  const before = ctl.smoothed;
  ctl.sample(5000); // tab restore
  assert.ok(ctl.smoothed - before <= (MAX_SAMPLE_MS - before) * 0.2,
    `smoothed moved by ${(ctl.smoothed - before).toFixed(2)}ms, not by 5000`);
  // A short run of normal frames must not move the resolution afterwards.
  assert.equal(ctl.ratio, 1);
  assert.equal(ctl.changes, 0);
});

test('a machine slow enough that every frame is long still adapts', () => {
  // Regression: discarding long samples meant a 3fps machine (310ms frames)
  // never registered as slow, so it never got the resolution drop it needed.
  const ctl = createAdaptiveResolution({ start: 1 });
  for (let i = 0; i < 300; i += 1) ctl.sample(310); // ~3.2fps, like software GL
  assert.ok(ctl.ratio < 1, `resolution dropped on a very slow machine (${ctl.ratio})`);
  assert.equal(ctl.ratio, MIN_RATIO);
});

test('it settles on a slow machine instead of flapping', () => {
  // Realistic model: the game is fill-rate bound, so frame time scales with the
  // number of pixels. Lowering the ratio genuinely speeds frames up, which is
  // why an adaptive controller converges rather than oscillating.
  const start = 1;
  const baseMs = 310; // 3.2fps at ratio 1, close to what software GL measures
  const ctl = createAdaptiveResolution({ start });
  const history = [];
  for (let i = 0; i < 600; i += 1) {
    const ratio = ctl.ratio;
    const frameMs = baseMs * (ratio / start) ** 2;
    ctl.sample(frameMs);
    history.push(ctl.ratio);
  }
  const tail = history.slice(-200);
  assert.equal(new Set(tail).size, 1, `settled on one ratio (${[...new Set(tail)]})`);
  assert.ok(tail[0] < 1, `settled below full resolution (${tail[0]})`);
  // No endless up/down dance: a converged controller makes few changes.
  assert.ok(ctl.changes <= 10, `only ${ctl.changes} adjustments total`);
});

test('a machine that is fast enough settles at full resolution', () => {
  const ctl = createAdaptiveResolution({ start: 1 });
  for (let i = 0; i < 600; i += 1) {
    const frameMs = 5 * (ctl.ratio / 1) ** 2; // plenty of headroom
    ctl.sample(frameMs);
  }
  // FAST_MS headroom pushes it up until the ceiling, then it stops.
  assert.equal(ctl.ratio, MAX_RATIO);
  const changes = ctl.changes;
  for (let i = 0; i < 200; i += 1) ctl.sample(5 * (ctl.ratio / 1) ** 2);
  assert.equal(ctl.changes, changes, 'stable once converged');
});

test('non-finite and negative samples are ignored', () => {
  const ctl = createAdaptiveResolution({ start: 1 });
  ctl.sample(NaN);
  ctl.sample(-16);
  ctl.sample(0);
  assert.equal(ctl.smoothed, NaN, 'nothing was recorded');
  assert.equal(ctl.ratio, 1);
});

test('a slow machine is walked down to the floor', () => {
  const ctl = createAdaptiveResolution({ start: 1 });
  for (let i = 0; i < 400; i += 1) ctl.sample(60); // ~16fps
  assert.equal(ctl.ratio, MIN_RATIO);
  assert.ok(ctl.changes >= 3, `took several steps down (${ctl.changes})`);
});

test('a fast machine is walked up to the ceiling, then stops', () => {
  const ctl = createAdaptiveResolution({ start: 1 });
  for (let i = 0; i < 400; i += 1) ctl.sample(10); // 100fps
  assert.equal(ctl.ratio, MAX_RATIO);
  const changes = ctl.changes;
  for (let i = 0; i < 100; i += 1) ctl.sample(10);
  assert.equal(ctl.changes, changes, 'no further changes at the ceiling');
});

test('the controller passes through a comfortable middle ratio', () => {
  const ctl = createAdaptiveResolution({ start: 1 });
  // 25ms frames sit between FAST_MS and SLOW_MS, so nothing should move.
  for (let i = 0; i < 200; i += 1) ctl.sample(25);
  assert.equal(ctl.ratio, 1);
  assert.equal(ctl.changes, 0);
});
