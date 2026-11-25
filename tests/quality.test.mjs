// Tests for the adaptive quality tier. The important properties are that it
// only engages after resolution is spent, that it cannot flap, and that a
// manual override is respected.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUALITY_FULL, QUALITY_LOW, DROP_MS, RESTORE_MS, DROP_STREAK, RESTORE_STREAK,
  shouldDropQuality, shouldRestoreQuality, createQualityTier
} from '../src/quality.js';
import { SLOW_MS, MIN_RATIO } from '../src/perf.js';

test('quality only degrades at frame times worse than the resolution trigger', () => {
  // If DROP_MS were not worse than SLOW_MS, quality would shed before
  // resolution had been given a chance, which is the wrong order: measurement
  // showed resolution is by far the bigger lever.
  assert.ok(DROP_MS > SLOW_MS, `DROP_MS ${DROP_MS} must exceed SLOW_MS ${SLOW_MS}`);
});

test('the restore threshold is far below the drop threshold, so it cannot flap', () => {
  assert.ok(RESTORE_MS < DROP_MS / 4,
    `restore ${RESTORE_MS} must be well under drop ${DROP_MS}`);
  // And restoring needs more evidence than dropping, so a brief fast patch
  // does not undo a genuinely slow machine's setting.
  assert.ok(RESTORE_STREAK > DROP_STREAK);
});

test('shouldDropQuality only fires when full and genuinely slow', () => {
  assert.equal(shouldDropQuality(QUALITY_FULL, DROP_MS + 1), true);
  assert.equal(shouldDropQuality(QUALITY_FULL, DROP_MS), false, 'boundary is exclusive');
  assert.equal(shouldDropQuality(QUALITY_LOW, DROP_MS + 500), false, 'already low');
  assert.equal(shouldDropQuality(QUALITY_FULL, 16), false);
});

test('shouldRestoreQuality only fires when low and comfortably fast', () => {
  assert.equal(shouldRestoreQuality(QUALITY_LOW, RESTORE_MS - 1), true);
  assert.equal(shouldRestoreQuality(QUALITY_LOW, RESTORE_MS), false);
  assert.equal(shouldRestoreQuality(QUALITY_FULL, 5), false, 'already full');
  // Merely "less bad" must not restore: this is the anti-flap guard.
  assert.equal(shouldRestoreQuality(QUALITY_LOW, DROP_MS - 10), false);
});

test('bad frame times are ignored rather than treated as slow', () => {
  for (const bad of [NaN, Infinity, -Infinity, 0, -5]) {
    assert.equal(shouldDropQuality(QUALITY_FULL, bad), false, `drop ${bad}`);
    assert.equal(shouldRestoreQuality(QUALITY_LOW, bad), false, `restore ${bad}`);
  }
});

test('a sustained slow run drops quality exactly once', () => {
  const tier = createQualityTier();
  for (let i = 0; i < DROP_STREAK - 1; i += 1) {
    assert.equal(tier.sample(400), QUALITY_FULL, `frame ${i} still full`);
  }
  assert.equal(tier.sample(400), QUALITY_LOW, 'drops on the streak boundary');
  assert.equal(tier.changes, 1);
  // Further slow frames must not count as more changes.
  for (let i = 0; i < DROP_STREAK * 2; i += 1) tier.sample(400);
  assert.equal(tier.tier, QUALITY_LOW);
  assert.equal(tier.changes, 1);
});

test('a brief slow patch does not drop quality', () => {
  const tier = createQualityTier();
  for (let i = 0; i < DROP_STREAK - 1; i += 1) tier.sample(400);
  tier.sample(16);                       // one good frame breaks the streak
  for (let i = 0; i < DROP_STREAK - 1; i += 1) tier.sample(400);
  assert.equal(tier.tier, QUALITY_FULL, 'streak restarted, so no drop yet');
});

test('restoring needs a long comfortable run, not a few fast frames', () => {
  const tier = createQualityTier();
  tier.force(QUALITY_LOW);
  for (let i = 0; i < RESTORE_STREAK - 1; i += 1) {
    assert.equal(tier.sample(10), QUALITY_LOW, `frame ${i} still low`);
  }
  assert.equal(tier.sample(10), QUALITY_FULL);
});

test('the dead zone clears both streaks', () => {
  const tier = createQualityTier();
  tier.force(QUALITY_LOW);
  for (let i = 0; i < RESTORE_STREAK - 1; i += 1) tier.sample(10);
  tier.sample(60);                       // dead zone: neither fast nor terrible
  for (let i = 0; i < RESTORE_STREAK - 1; i += 1) tier.sample(10);
  assert.equal(tier.tier, QUALITY_LOW, 'restore streak was cleared');
});

test('a full drop-then-restore cycle reports two changes and ends full', () => {
  const tier = createQualityTier();
  for (let i = 0; i < DROP_STREAK; i += 1) tier.sample(500);
  assert.equal(tier.tier, QUALITY_LOW);
  for (let i = 0; i < RESTORE_STREAK; i += 1) tier.sample(8);
  assert.equal(tier.tier, QUALITY_FULL);
  assert.equal(tier.changes, 2);
});

test('force is idempotent and resets the evidence', () => {
  const tier = createQualityTier();
  assert.equal(tier.force(QUALITY_LOW), QUALITY_LOW);
  assert.equal(tier.changes, 1);
  assert.equal(tier.force(QUALITY_LOW), QUALITY_LOW);
  assert.equal(tier.changes, 1, 'no change counted for the same tier');
  // Evidence from before the force must not carry over.
  for (let i = 0; i < RESTORE_STREAK - 1; i += 1) tier.sample(8);
  assert.equal(tier.tier, QUALITY_LOW);
});

test('an unknown forced value falls back to full rather than a broken tier', () => {
  const tier = createQualityTier();
  assert.equal(tier.force('nonsense'), QUALITY_FULL);
  assert.equal(tier.force(undefined), QUALITY_FULL);
});

test('starting low is honoured so a remembered choice survives a reload', () => {
  const tier = createQualityTier({ start: QUALITY_LOW });
  assert.equal(tier.tier, QUALITY_LOW);
  assert.equal(tier.changes, 0, 'the starting tier is not a change');
});

test('the tier is independent of the resolution floor value', () => {
  // Sanity: the two controllers are separate. Resolution can sit at its floor
  // while quality is still full, which is the intended ordering.
  assert.equal(MIN_RATIO, 0.5);
  const tier = createQualityTier();
  assert.equal(tier.tier, QUALITY_FULL);
});
