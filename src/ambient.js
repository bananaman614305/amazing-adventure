// NPC-to-NPC conversation. Two NPCs who are near each other strike up a short
// exchange; the player can walk up and overhear it.
//
// This is deliberately deterministic: the same (state, pair, topic index)
// always yields the same lines. That keeps it testable without a browser and
// makes saves reproducible, instead of sprinkling Math.random through the sim.

import { questStatus, memoryFor } from './state.js';
import { npcTier, FACTIONS, NPC_FACTION } from './factions.js';

export const AMBIENT_RANGE = 4.5;
export const AMBIENT_CHANCE = 0.35;

// Who will talk to whom. Order matters only for determinism.
const PAIRS = [
  ['mara', 'halden'],
  ['oswin', 'pip'],
  ['mara', 'sable'],
  ['halden', 'oswin'],
  ['pip', 'sable']
];

/**
 * Picks a topic for a pair based on the world state. Returns an id, which also
 * acts as the conversation's "seed" so lines stay stable.
 */
export function topicFor(state, a, b) {
  const facts = [];
  if (questStatus(state, 'lanterns') === 'done') facts.push('lanterns_done');
  else if (questStatus(state, 'lanterns') === 'started' || questStatus(state, 'lanterns') === 'oil_bought') facts.push('lanterns_pending');
  if (questStatus(state, 'key') === 'done') facts.push('key_done');
  if (questStatus(state, 'toll') === 'done') facts.push('toll_done');
  if (questStatus(state, 'toll') === 'waived') facts.push('toll_waived');
  if (questStatus(state, 'toll') === 'collected') facts.push('toll_collected');
  if (state.perks?.oswin_debt) facts.push('oswin_debt');
  if (state.perks?.oswin_favour) facts.push('oswin_favour');
  // Dusk/night is passed separately as a phase id by the caller.
  return facts;
}

/**
 * The line bank. Each entry is (speaker index, text) with the pair's ids
 * supplied by the caller, so the same script works for any two NPCs.
 */
const SCRIPTS = {
  toll_collected: [
    ['a', 'Halden says the toll is paid at last.'],
    ['b', 'Paid by someone. Not by the man who owed it, I hear.'],
    ['a', 'That is between the Watch and Oswin’s purse.']
  ],
  toll_waived: [
    ['a', 'The toll was waived, then. On whose word?'],
    ['b', 'On a good word. You could stand to hear one now and then.'],
    ['a', 'Words are cheap. Ledgers are not.']
  ],
  toll_done: [
    ['a', 'The toll business is settled. Finally.'],
    ['b', 'Settled the way you wanted it settled, you mean.']
  ],
  oswin_debt: [
    ['a', 'Oswin still has that promise in his ledger.'],
    ['b', 'He never lets one go. Somebody should tell the newcomer.'],
    ['a', 'Somebody just did.']
  ],
  oswin_favour: [
    ['a', 'Oswin owes a favour now. That is rarer than a dry night.'],
    ['b', 'Mark it. He will not forget it, and neither will I.']
  ],
  lanterns_done: [
    ['a', 'The north lantern has not guttered once since it was filled.'],
    ['b', 'One flask. That is all it ever needed.'],
    ['a', 'It needed someone to carry it.']
  ],
  lanterns_pending: [
    ['a', 'The north lantern is still low.'],
    ['b', 'I know. I am not the one who can fix it.'],
    ['a', 'Someone will. Someone always does.']
  ],
  key_done: [
    ['a', 'The gate key turned up, then.'],
    ['b', 'In the grass, of all places. Where else would it be?'],
    ['a', 'Where else.']
  ],
  dusk: [
    ['a', 'Sky is turning. Lanterns will be lit soon.'],
    ['b', 'I never tire of that minute.'],
    ['a', 'You say that every evening.']
  ],
  night: [
    ['a', 'Quiet tonight.'],
    ['b', 'Quiet is good. Quiet means the gate is holding.'],
    ['a', 'Quiet means nobody has noticed anything yet.']
  ],
  default: [
    ['a', 'Cold evening.'],
    ['b', 'Warmer than last week.'],
    ['a', 'Everything is warmer than last week.']
  ]
};

/** Picks which script a pair should use, from world state and phase. */
export function scriptKeyFor(state, phase) {
  if (questStatus(state, 'toll') === 'collected') return 'toll_collected';
  if (questStatus(state, 'toll') === 'waived') return 'toll_waived';
  if (questStatus(state, 'toll') === 'done') return 'toll_done';
  if (state.perks?.oswin_debt) return 'oswin_debt';
  if (state.perks?.oswin_favour) return 'oswin_favour';
  if (phase === 'dusk') return 'dusk';
  if (phase === 'night') return 'night';
  if (questStatus(state, 'lanterns') === 'done') return 'lanterns_done';
  if (questStatus(state, 'lanterns') === 'started' || questStatus(state, 'lanterns') === 'oil_bought') return 'lanterns_pending';
  if (questStatus(state, 'key') === 'done') return 'key_done';
  return 'default';
}

/**
 * Builds a whole ambient exchange for a pair as a list of
 * { speakerId, speakerName, text } lines. Pure: no timing, no randomness.
 */
export function buildExchange({ state, phase, a, b, names }) {
  const key = scriptKeyFor(state, phase);
  const script = SCRIPTS[key] || SCRIPTS.default;
  return script.map(([who, text]) => {
    const speakerId = who === 'a' ? a.id : b.id;
    return {
      speakerId,
      speakerName: names?.[speakerId] || speakerId,
      text
    };
  });
}

/** Distance helper, kept here so the pair logic has no Three.js dependency. */
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Chooses which pair (if any) should start talking this tick.
 *
 * `npcs` is a list of { id, name, position: { x, z } }, `activeId` is whoever
 * the player is already talking to (if anyone), and `busyIds` are NPCs already
 * running an exchange. Returns { a, b, key } or null.
 */
export function chooseAmbientPair({ npcs, state, phase, playerPosition, busyIds = [], activeId = null, playerDistanceLimit = 14 }) {
  if (!npcs || npcs.length < 2) return null;
  const available = npcs.filter((npc) => !busyIds.includes(npc.id) && npc.id !== activeId);
  // Do not stage a conversation right on top of the player: they should
  // overhear it by walking over, not have it start in their face.
  const eligible = available.filter((npc) =>
    !playerPosition || distance(npc.position, playerPosition) > 2.2
  );

  for (const [aId, bId] of PAIRS) {
    const a = eligible.find((npc) => npc.id === aId);
    const b = eligible.find((npc) => npc.id === bId);
    if (!a || !b) continue;
    if (distance(a.position, b.position) > AMBIENT_RANGE) continue;
    if (playerPosition && distance(a.position, playerPosition) > playerDistanceLimit) continue;
    return { a, b, key: scriptKeyFor(state, phase) };
  }
  return null;
}

/** True when the player is close enough to hear an exchange. */
export function canOverhear(position, playerPosition, range = 5) {
  if (!position || !playerPosition) return false;
  return distance(position, playerPosition) <= range;
}

/**
 * Two NPCs' opinions of each other drift based on how often they have talked.
 * Kept tiny and bounded so it never dominates personal opinion of the player.
 */
export function noteExchange(state, aId, bId) {
  state.ambient = state.ambient || {};
  const key = [aId, bId].sort().join('|');
  state.ambient[key] = (state.ambient[key] || 0) + 1;
  return state.ambient[key];
}

export function exchangesBetween(state, aId, bId) {
  const key = [aId, bId].sort().join('|');
  return state.ambient?.[key] || 0;
}

export { PAIRS, SCRIPTS };
