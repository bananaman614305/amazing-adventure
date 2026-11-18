// Earning standing back: the answer to "a hostile faction is a dead end".
//
// Refusals in refusal.js give reputation teeth. The problem they create is that
// every route back out of Hostile went through quests, and a player who had
// already finished those had no repeatable way to climb out. Once the plaza shut
// them out, it stayed shut.
//
// This module is that repeatable route. It is deliberately not free: each job
// costs something real — coins, a walk across the map, or a chunk of the day —
// so reputation cannot be farmed by pressing a button in place. The jobs are
// also one-directional in their politics: helping one faction is honest work for
// that faction and is noticed, unfavourably, by its rival.

import { changeReputation, reputation, tierFor, FACTIONS } from './factions.js';
import { addCoins, coins } from './state.js';

/**
 * The odd jobs on offer. `pay` is measured in the same arbitrary "points" the
 * reputation system uses, scaled down by which tier the player is trying to
 * leave: climbing out of Hostile is the slow part, which is the point.
 */
export const JOBS = {
  sweep: {
    id: 'sweep',
    factionId: 'keepers',
    title: 'Sweep the fountain steps',
    // Costs time, not money: it moves the clock to the next phase.
    cost: { time: true },
    pay: 8,
    rivals: [{ id: 'trade', delta: -1 }],
    blurb: 'Mara always needs the steps cleared before the evening.'
  },
  carry: {
    id: 'carry',
    factionId: 'trade',
    title: 'Carry crates for the stallholders',
    cost: { coins: 2 },
    pay: 8,
    rivals: [{ id: 'keepers', delta: -1 }],
    blurb: 'Oswin pays for the lifting and charges for the privilege.'
  },
  drill: {
    id: 'drill',
    factionId: 'watch',
    title: 'Drill with the gate watch',
    cost: { time: true, coins: 1 },
    pay: 8,
    rivals: [{ id: 'trade', delta: -1 }],
    blurb: 'Halden will not train a stranger for free.'
  }
};

/**
 * How much a job actually pays at a given standing. Working while someone
 * actively dislikes you earns less, so the first point out of Hostile is the
 * expensive one; once you are merely Cold, the same work goes further.
 */
export function payFor(job, state) {
  const score = reputation(state, job.factionId);
  const tier = tierFor(score).id;
  if (tier === 'hostile') return Math.max(1, Math.round(job.pay * 0.5));
  if (tier === 'cold') return Math.max(1, Math.round(job.pay * 0.75));
  return job.pay;
}

/** Whether the player can do this job right now, and if not, why. */
export function canWork(job, state, purse = coins(state)) {
  if (!job) return { ok: false, reason: 'There is no work here.' };
  const need = job.cost?.coins ?? 0;
  if (need > 0 && purse < need) {
    return { ok: false, reason: `You need ${need} coins for this.` };
  }
  if (reputation(state, job.factionId) >= 100) {
    return { ok: false, reason: 'They could not think better of you than they already do.' };
  }
  return { ok: true, reason: '' };
}

/**
 * Applies a job. Returns what changed so the caller can report it honestly —
 * including the rival's reaction, which is the interesting part: helping the
 * Watch makes the Market trust you slightly less.
 */
export function work(state, jobId) {
  const job = JOBS[jobId];
  if (!job) return { changed: false, message: 'There is no work here.' };
  const allowed = canWork(job, state);
  if (!allowed.ok) return { changed: false, message: allowed.reason };
  // The cost is paid before the work happens, so a job can never be a free
  // reputation button: it always costs coins, or time, or both.
  const spent = job.cost?.coins ?? 0;
  if (spent > 0) addCoins(state, -spent);
  const before = reputation(state, job.factionId);
  const gain = changeReputation(state, job.factionId, payFor(job, state));
  const parts = [];
  if (gain !== 0) parts.push(`${FACTIONS[job.factionId].name} ${gain > 0 ? '+' : ''}${gain}`);
  for (const rival of job.rivals) {
    const applied = changeReputation(state, rival.id, rival.delta);
    if (applied !== 0) parts.push(`${FACTIONS[rival.id].name} ${applied > 0 ? '+' : ''}${applied}`);
  }
  if (gain === 0 && parts.length === 0) {
    return { changed: false, message: 'Nobody was watching, and nothing changed.' };
  }
  const after = reputation(state, job.factionId);
  const climbed = tierFor(after).id !== tierFor(before).id;
  return {
    changed: true,
    message: parts.length ? `Reputation: ${parts.join(', ')}` : '',
    gain,
    tierChanged: climbed,
    // A job that lifts the player out of a tier deserves to say so out loud.
    note: climbed ? `The ${FACTIONS[job.factionId].collective} see you differently now.` : '',
    // Time-passing jobs are advanced by the caller, which owns the clock.
    advanceTime: Boolean(job.cost?.time),
    spent
  };
}
