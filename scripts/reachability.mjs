// Explores every reachable game state and looks for soft-locks: states where the
// story can no longer be finished, and no further action can rescue it.
//
// Round 17 fixed one such cliff by playing the game. Its report noted honestly that
// only completion was tested, not hostile paths. This script does the exhaustive
// version: breadth-first over every legal action, so a dead end anywhere is found
// rather than only the one a single playthrough happened to walk into.

import * as S from '../src/state.js';
import * as A from '../src/areas.js';
import { startConversation, applyChoice } from '../src/dialogue.js';
import { tierFor, reputation } from '../src/factions.js';

const NPCS = ['mara', 'oswin', 'pip', 'halden', 'wren', 'sable'];
const MAX_CHOICES = 6;

/** A canonical key for a state, so identical states are only explored once. */
function stateKey(state) {
  const quests = S.QUEST_ORDER.map((q) => state.quests[q]).join(',');
  const perks = Object.keys(state.perks).filter((k) => state.perks[k]).sort().join(',');
  const inv = [...state.inventory].sort().join(',');
  const rep = ['keepers', 'trade', 'watch'].map((f) => reputation(state, f)).join(',');
  const flags = Object.keys(state.flags).filter((f) => f !== 'coins' && state.flags[f]).sort().join(',');
  const outcomes = Object.entries(state.outcomes || {}).map(([k, v]) => `${k}=${v}`).sort().join(',');
  // Coins matter only insofar as they gate the toll, so bucket them.
  const coinBucket = Math.min(state.flags.coins || 0, 12);
  return `${quests}|${perks}|${inv}|${rep}|${flags}|${outcomes}|c${coinBucket}`;
}

/**
 * Every action available from a state. Dialogue choices are enumerated per NPC, and
 * the pure world actions (pickups, watch, hand-ins) are included because a player
 * can do those too.
 */
function actionsFrom(state) {
  const actions = [];
  for (const npc of NPCS) {
    let node;
    try {
      node = startConversation(state, npc);
    } catch {
      continue;
    }
    if (!node || !Array.isArray(node.choices)) continue;
    for (let i = 0; i < Math.min(node.choices.length, MAX_CHOICES); i += 1) {
      actions.push({
        key: `${npc}#${i}`,
        label: `${npc}: ${node.choices[i].label.slice(0, 40)}`,
        apply: (target) => {
          const fresh = startConversation(target, npc);
          if (!fresh || !fresh.choices[i]) return { changed: false };
          return applyChoice(target, npc, fresh.choices[i]);
        }
      });
    }
  }
  // World actions, each of which the game exposes as a pure function. Each one
  // must act on the branch it is given (`target`), never on the captured
  // `state`: otherwise the action mutates the state it was discovered from,
  // produces no new key, and the exploration silently loses that edge.
  const world = [
    ['pickUpKey', (t) => S.pickUpKey(t)],
    ['returnKey', (t) => S.returnKey(t)],
    ['watchLanterns:dusk', (t) => S.watchLanterns(t, 'dusk')],
    ['tellPip', (t) => S.tellPipAboutLanterns(t)],
    ['startToll', (t) => S.startToll(t)],
    ['collectToll', (t) => S.collectToll(t)],
    ['waiveToll', (t) => S.waiveToll(t, tierFor(reputation(t, 'watch')).id)],
    ['finishToll', (t) => S.finishToll(t)],
    ['startLedger', (t) => S.startLedger(t, tierFor(reputation(t, 'trade')).id)],
    ['hearRumour', (t) => S.hearLedgerRumour(t)],
    ['recoverLedger', (t) => S.recoverLedger(t)],
    ['returnLedger:name', (t) => S.returnLedger(t, 'name')],
    ['returnLedger:cover', (t) => S.returnLedger(t, 'cover')],
    ['startArrears', (t) => S.startArrears(t)],
    ['deliverArrears:pay', (t) => S.deliverArrears(t, 'pay')],
    ['deliverArrears:forgive', (t) => S.deliverArrears(t, 'forgive')],
    ['finishArrears', (t) => S.finishArrears(t)],
    // The lane round and its dawn reset: lighting the lane is the walk that
    // advances Oswin's night order, and dawn is what makes the round per-night.
    ['lightLane:dusk', (t) => A.lightLaneLanterns(t, 'dusk')],
    // Dawn reports `reset` rather than `changed` because it is a clock event,
    // not a player action; `explore` accepts either as a real transition.
    ['dawnReset', (t) => A.laneLanternsAtDawn(t, 'day')]
  ];
  for (const [key, fn] of world) {
    actions.push({
      key,
      label: key,
      apply: (target) => fn(target)
    });
  }
  return actions;
}

/** A deep copy, so exploring one branch cannot mutate another. */
function clone(state) {
  return structuredClone(state);
}

/**
 * Explore from the initial state. Returns every reachable dead end found: states
 * that are not complete and from which no sequence of actions reaches completion.
 */
export function findDeadEnds({ maxStates = 300000, log = () => {} } = {}) {
  const start = S.createInitialState();
  const startKey = stateKey(start);

  // Pass 1: collect the reachable graph.
  const seen = new Map([[startKey, start]]);
  const edges = new Map(); // key -> Set of next keys
  const queue = [start];
  let expanded = 0;

  while (queue.length && expanded < maxStates) {
    const state = queue.shift();
    const fromKey = stateKey(state);
    expanded += 1;
    const next = new Set();
    for (const action of actionsFrom(state)) {
      const branch = clone(state);
      let result;
      try {
        result = action.apply(branch);
      } catch {
        continue;
      }
      // `changed` is the player-action contract; `reset` is the clock's, used
      // by dawn putting the lane lanterns out. Both move the world, so both
      // count as a transition -- otherwise a whole night of state (order taken,
      // lane dark again) is invisible to the explorer and its quest step looks
      // unreachable.
      if (!result || !(result.changed || result.reset)) continue;
      const key = stateKey(branch);
      next.add(key);
      if (!seen.has(key)) {
        seen.set(key, branch);
        queue.push(branch);
      }
    }
    edges.set(fromKey, next);
  }
  log(`explored ${expanded} states, ${seen.size} distinct`);
  // A capped run is not a proof. If the frontier still had work when the cap
  // stopped us, whole branches were never walked and the reverse pass reports
  // them as unwinnable for no better reason than that we gave up. Saying so is
  // the difference between "no dead ends exist" and "I looked at part of the
  // graph", so the caller is told rather than handed a number to trust.
  const truncated = queue.length > 0;
  log(`truncated: ${truncated}${truncated ? ` (${queue.length} states still queued)` : ''}`);
  let allDone=0; for(const [k,v] of seen){ if(S.questCounts(v).done===S.QUEST_ORDER.length) allDone++; } log(`all-done states: ${allDone}`);

  // Pass 2: which states can reach completion?
  const complete = new Set();
  for (const [key, state] of seen) {
    if (S.questCounts(state).done === S.QUEST_ORDER.length) complete.add(key);
  }

  // Reverse-reachability: a state is winnable if it is complete or can step to a
  // winnable state. Iterate to a fixed point.
  const winnable = new Set(complete);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [fromKey, targets] of edges) {
      if (winnable.has(fromKey)) continue;
      for (const target of targets) {
        if (winnable.has(target)) { winnable.add(fromKey); changed = true; break; }
      }
    }
  }

  const deadEnds = [];
  for (const [key, state] of seen) {
    if (winnable.has(key)) continue;
    deadEnds.push({
      quests: { ...state.quests },
      coins: state.flags.coins,
      reputation: {
        keepers: reputation(state, 'keepers'),
        trade: reputation(state, 'trade'),
        watch: reputation(state, 'watch')
      },
      flags: { ...state.flags },
      perks: { ...state.perks },
      inventory: [...state.inventory],
      counts: S.questCounts(state)
    });
  }
  return { explored: seen.size, complete: complete.size, winnable: winnable.size, deadEnds, startReachable: winnable.has(startKey), truncated };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = findDeadEnds({ log: (line) => console.log(line) });
  if (result.truncated) {
    console.log('exploration was truncated by maxStates: this run proves nothing about the unexplored frontier');
    process.exit(2);
  }
  console.log(`start state can reach completion: ${result.startReachable}`);
  console.log(`complete states: ${result.complete} | winnable: ${result.winnable}/${result.explored}`);
  console.log(`dead ends: ${result.deadEnds.length}`);
  for (const dead of result.deadEnds.slice(0, 10)) {
    console.log('  DEAD END:', JSON.stringify({ quests: dead.quests, coins: dead.coins, rep: dead.reputation }));
  }
  process.exit(result.startReachable && result.deadEnds.length === 0 ? 0 : 1);
}
