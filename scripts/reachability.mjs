// Explores every reachable game state and looks for soft-locks: states where the
// story can no longer be finished, and no further action can rescue it.
//
// Round 17 fixed one such cliff by playing the game. Its report noted honestly that
// only completion was tested, not hostile paths. This script does the exhaustive
// version: breadth-first over every legal action, so a dead end anywhere is found
// rather than only the one a single playthrough happened to walk into.

import * as S from '../src/state.js';
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
  // World actions, each of which the game exposes as a pure function.
  const world = [
    ['pickUpKey', () => S.pickUpKey(state)],
    ['returnKey', () => S.returnKey(state)],
    ['watchLanterns:dusk', () => S.watchLanterns(state, 'dusk')],
    ['tellPip', () => S.tellPipAboutLanterns(state)],
    ['startToll', () => S.startToll(state)],
    ['collectToll', () => S.collectToll(state)],
    ['waiveToll', () => S.waiveToll(state, tierFor(reputation(state, 'watch')).id)],
    ['finishToll', () => S.finishToll(state)],
    ['startLedger', () => S.startLedger(state, tierFor(reputation(state, 'trade')).id)],
    ['hearRumour', () => S.hearLedgerRumour(state)],
    ['recoverLedger', () => S.recoverLedger(state)],
    ['returnLedger:name', () => S.returnLedger(state, 'name')],
    ['returnLedger:cover', () => S.returnLedger(state, 'cover')],
    ['startArrears', () => S.startArrears(state)],
    ['deliverArrears:pay', () => S.deliverArrears(state, 'pay')],
    ['deliverArrears:forgive', () => S.deliverArrears(state, 'forgive')],
    ['finishArrears', () => S.finishArrears(state)]
  ];
  for (const [key, fn] of world) {
    actions.push({
      key,
      label: key,
      apply: () => fn()
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
export function findDeadEnds({ maxStates = 20000, log = () => {} } = {}) {
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
      if (!result || !result.changed) continue;
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
  return { explored: seen.size, complete: complete.size, winnable: winnable.size, deadEnds, startReachable: winnable.has(startKey) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = findDeadEnds({ log: (line) => console.log(line) });
  console.log(`start state can reach completion: ${result.startReachable}`);
  console.log(`complete states: ${result.complete} | winnable: ${result.winnable}/${result.explored}`);
  console.log(`dead ends: ${result.deadEnds.length}`);
  for (const dead of result.deadEnds.slice(0, 10)) {
    console.log('  DEAD END:', JSON.stringify({ quests: dead.quests, coins: dead.coins, rep: dead.reputation }));
  }
  process.exit(result.startReachable && result.deadEnds.length === 0 ? 0 : 1);
}
