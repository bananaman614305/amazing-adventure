import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRecovery, shouldPanicShed, shouldAutoSaveOnContextLoss,
  MAX_RESTORE_ATTEMPTS, RESTORE_TIMEOUT_MS, PANIC_FRAME_MS
} from '../src/resilience.js';

test('a fresh recovery state is healthy', () => {
  const r = createRecovery();
  assert.equal(r.lost, false);
  assert.equal(r.attempts, 0);
  assert.equal(r.message(), null);
  assert.equal(r.shouldGiveUp(), false);
});

test('losing the context marks it lost and counts an attempt', () => {
  const r = createRecovery();
  assert.equal(r.begin('webglcontextlost', 1000), true);
  assert.equal(r.lost, true);
  assert.equal(r.attempts, 1);
  assert.equal(r.lastReason, 'webglcontextlost');
  assert.match(r.message(), /Restoring/);
});

test('a repeated loss during the same episode is not a new attempt', () => {
  const r = createRecovery();
  r.begin('lost', 1000);
  assert.equal(r.begin('lost again', 1200), false, 'same episode');
  assert.equal(r.attempts, 1, 'attempts did not double-count');
});

test('a restored context clears the episode', () => {
  const r = createRecovery();
  r.begin('lost', 1000);
  r.restored();
  assert.equal(r.lost, false);
  assert.equal(r.message(), null);
  assert.equal(r.shouldGiveUp(999999), false, 'healthy state never gives up');
});

test('it gives up after the attempt budget, not an infinite retry', () => {
  const r = createRecovery({ maxAttempts: 3, timeoutMs: 60000 });
  for (let i = 0; i < 3; i += 1) {
    r.begin('lost', 1000 + i * 10);
    if (i < 2) r.restored();
  }
  assert.equal(r.attempts, MAX_RESTORE_ATTEMPTS);
  assert.equal(r.shouldGiveUp(1100), true, 'stops retrying at the budget');
});

test('it gives up when the restore never arrives in time', () => {
  const r = createRecovery({ maxAttempts: 5, timeoutMs: RESTORE_TIMEOUT_MS });
  r.begin('lost', 1000);
  assert.equal(r.timedOut(1000 + RESTORE_TIMEOUT_MS - 1), false, 'still waiting');
  assert.equal(r.timedOut(1000 + RESTORE_TIMEOUT_MS), true, 'timed out exactly at the limit');
  assert.equal(r.shouldGiveUp(1000 + RESTORE_TIMEOUT_MS), true);
});

test('recovery survives a full cycle and can start again', () => {
  const r = createRecovery({ maxAttempts: 2 });
  r.begin('lost', 1000); r.restored();
  assert.equal(r.shouldGiveUp(2000), false);
  r.begin('lost', 3000);
  assert.equal(r.lost, true, 'a new episode after recovery counts again');
});

test('panic shedding only fires on genuinely catastrophic frames', () => {
  assert.equal(shouldPanicShed(PANIC_FRAME_MS + 1, false), true);
  assert.equal(shouldPanicShed(PANIC_FRAME_MS, false), false, 'boundary is not panic');
  assert.equal(shouldPanicShed(16, false), false, 'normal frames are not panic');
  assert.equal(shouldPanicShed(500, true), false, 'nothing left to shed at the floor');
  assert.equal(shouldPanicShed(NaN, false), false);
  assert.equal(shouldPanicShed(Infinity, false), false);
});

test('saving is still allowed when the context is lost', () => {
  // The save data is plain JSON and unaffected by the renderer, so losing the
  // context must never cost the player progress.
  assert.equal(shouldAutoSaveOnContextLoss(), true);
});
