// Recovery policy for the two ways a phone game goes black: the browser
// throwing away the WebGL context, and the memory/time budget being hit. Kept
// pure and free of Three.js so the rules can be unit-tested in Node, while
// main.js only has to wire the events up.

// How many restore attempts before we stop retrying and ask the player instead.
export const MAX_RESTORE_ATTEMPTS = 3;
// Browsers restore a lost context asynchronously; if it never comes back within
// this window it is not coming back and we must offer a reload.
export const RESTORE_TIMEOUT_MS = 6000;
// While frames keep taking longer than this, shed resolution. Matches the
// adaptive controller's own slow threshold so the two do not fight.
export const PANIC_FRAME_MS = 120;

/**
 * State for one context-loss episode.
 * `begin()` marks the loss, `restored()` clears it, and `shouldGiveUp()` says
 * when retrying is pointless so the UI can offer a reload instead of spinning.
 */
export function createRecovery({ maxAttempts = MAX_RESTORE_ATTEMPTS, timeoutMs = RESTORE_TIMEOUT_MS } = {}) {
  return {
    lost: false,
    attempts: 0,
    lostAt: 0,
    lastReason: null,
    maxAttempts,
    timeoutMs,

    begin(reason, now = Date.now()) {
      // A second loss while already lost is the same episode, not a new one.
      if (this.lost) return false;
      this.lost = true;
      this.lostAt = now;
      this.lastReason = reason ?? null;
      this.attempts += 1;
      return true;
    },

    restored() {
      this.lost = false;
      this.lostAt = 0;
      return true;
    },

    /** True once the browser has had long enough and the context is still gone. */
    timedOut(now = Date.now()) {
      if (!this.lost) return false;
      return now - this.lostAt >= this.timeoutMs;
    },

    /** True when we should stop waiting and tell the player to reload. */
    shouldGiveUp(now = Date.now()) {
      if (!this.lost) return false;
      return this.attempts >= this.maxAttempts || this.timedOut(now);
    },

    /** A short human message for the overlay, or null when everything is fine. */
    message() {
      if (!this.lost) return null;
      return 'The graphics context was lost. Restoring…';
    }
  };
}

/**
 * Decides whether the game should shed resolution aggressively because frames
 * are catastrophically slow, which usually means the device is out of headroom
 * rather than merely slow. Separate from perf.js on purpose: that one nudges,
 * this one is for emergencies.
 */
export function shouldPanicShed(frameMs, alreadyAtFloor) {
  if (alreadyAtFloor) return false;
  if (!Number.isFinite(frameMs)) return false;
  return frameMs > PANIC_FRAME_MS;
}

/**
 * True when it is safe to persist the game: a lost context means the renderer
 * cannot be trusted, but the save data itself is unaffected, so saving is
 * actually a good idea — this returns whether to keep auto-saving.
 */
export function shouldAutoSaveOnContextLoss() {
  return true;
}
