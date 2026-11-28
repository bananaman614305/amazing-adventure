// The plaza runs on a short day cycle: day, dusk, then night, then back.
// Phase logic is pure so it can be unit-tested; the visual side lives in
// world.js (`applyPhase`) and main.js advances the clock.

export const CYCLE_SECONDS = 180;

export const PHASES = [
  { id: 'day', label: 'Day', start: 0, end: 70 },
  { id: 'dusk', label: 'Dusk', start: 70, end: 105 },
  { id: 'night', label: 'Night', start: 105, end: 180 }
];

/** Wraps an elapsed time into [0, CYCLE_SECONDS). */
export function wrapClock(seconds) {
  if (!Number.isFinite(seconds)) return 0;
  const wrapped = seconds % CYCLE_SECONDS;
  return wrapped < 0 ? wrapped + CYCLE_SECONDS : wrapped;
}

export function phaseAt(seconds) {
  const t = wrapClock(seconds);
  return PHASES.find((phase) => t >= phase.start && t < phase.end) || PHASES[0];
}

/** How far through the current phase we are, 0..1. */
export function phaseProgress(seconds) {
  const t = wrapClock(seconds);
  const phase = phaseAt(t);
  return (t - phase.start) / (phase.end - phase.start);
}

/** Seconds until this phase ends. Exactly on a boundary this is the phase's
 * own length, because the boundary belongs to the phase that starts there. */
export function phaseRemaining(seconds) {
  const t = wrapClock(seconds);
  const phase = phaseAt(t);
  return phase.end - t;
}

/** Clock time as a readable in-world hour, e.g. "18:40". */
export function clockLabel(seconds) {
  const t = wrapClock(seconds);
  const phase = phaseAt(t);
  // Day 07:00-17:00, dusk 17:00-20:00, night 20:00-07:00.
  const hourRanges = { day: [7, 17], dusk: [17, 20], night: [20, 31] };
  const [from, to] = hourRanges[phase.id];
  const hours = from + (to - from) * ((t - phase.start) / (phase.end - phase.start));
  const whole = Math.floor(hours) % 24;
  const minutes = Math.floor((hours % 1) * 60);
  return `${String(whole).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Jumps the clock to the start of the next phase (used by the bench rest). */
export function nextPhaseStart(seconds) {
  const t = wrapClock(seconds);
  const index = PHASES.findIndex((phase) => t >= phase.start && t < phase.end);
  return PHASES[(index + 1) % PHASES.length].start;
}

/** True when the lanterns are lit (dusk and night). */
export function lanternsLit(seconds) {
  return phaseAt(seconds).id !== 'day';
}

/**
 * How far through the dark half of the cycle it is, in [0, 1].
 *
 * Several schedules are not phase-shaped but night-shaped: a cottage window is
 * lit from dusk until its owner goes to bed, and "goes to bed" is a point in the
 * evening, not a phase boundary. The window schedule therefore needs one number
 * that advances smoothly from 0 at dusk's first minute to 1 as night ends, so a
 * pane can go out at 0.4 without waiting for the next phase to start.
 *
 * Dusk carries the first quarter of the ramp and night the remaining three
 * quarters. That split is deliberate: dusk is the short, busy part of the
 * evening (lanterns are lit, people are still about), while the long night is
 * when the village goes quiet, so most bedtimes should fall inside it. The day
 * is exactly 0, because a window that is not lit cannot be "later in the night".
 *
 * Total: a junk clock reads as 0 rather than NaN, so a caller can paint from it
 * without a guard.
 */
export function nightFraction(seconds) {
  const t = wrapClock(seconds);
  const phase = phaseAt(t);
  const progress = (t - phase.start) / (phase.end - phase.start);
  const safe = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  if (phase.id === 'dusk') return 0.25 * safe;
  if (phase.id === 'night') return 0.25 + 0.75 * safe;
  return 0;
}