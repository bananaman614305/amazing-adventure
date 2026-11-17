import { routineAt } from './npcs.js';
import { addItem, removeItem, remember } from './state.js';

export const BRASS_LANTERN = 'brass-lantern';

export function questStatusText(state) {
  if (state.quest.status === 'dormant') return 'Quest: speak with Mara the Keeper';
  if (state.quest.status === 'complete') {
    return state.quest.outcome === 'restored'
      ? 'Quest complete: fountain restored'
      : 'Quest complete: lantern sold to Oswin';
  }
  if (state.inventory.includes(BRASS_LANTERN)) return 'Quest: choose the lantern’s fate';
  return 'Quest: find the missing lantern';
}

function note(state, npcId, text) {
  const memory = state.memories[npcId] || {};
  const topics = Array.isArray(memory.topics)
    ? [...memory.topics]
    : memory.lastTopic ? [memory.lastTopic] : [];
  topics.push(text);
  remember(state, npcId, { met: true, topics: topics.slice(-6) });
}

export function beginConversation(state, npc) {
  const memory = state.memories[npc.id] || {};
  remember(state, npc.id, { met: true, talks: (memory.talks || 0) + 1 });
  note(state, npc.id, npc.id === 'mara'
    ? 'you asked about the missing lantern'
    : 'you stopped for a chat');

  if (npc.id === 'mara' && state.quest.status === 'dormant') {
    state.quest.status = 'active';
    state.quest.stage = 'search';
    state.facts.spokeToMara = true;
  }
}

export function recordPickup(state, itemId) {
  if (itemId === 'herb-bundle') {
    note(state, 'iria', 'you gathered herbs from her stall');
    return;
  }
  if (itemId !== BRASS_LANTERN) return;
  state.facts.lanternPicked = true;
  if (state.quest.status !== 'complete') {
    state.quest.status = 'active';
    state.quest.stage = 'carrying';
  }
  note(state, 'mara', 'you found the brass lantern');
}

export function buildConversation(npc, state) {
  const part = routineAt(npc, state.clockMinutes);
  const memory = state.memories[npc.id];
  const topics = memory?.topics || (memory?.lastTopic ? [memory.lastTopic] : []);
  const prior = topics.length > 1 ? topics[topics.length - 2] : null;
  const memoryLine = prior
    ? `Last time, you told me: "${prior}".`
    : 'I have not heard your news before.';

  return {
    context: `${npc.role} · ${part.activity}`,
    lines: [
      `${npc.role}. At this hour I am ${part.activity}.`,
      memoryLine,
      ...storyLines(npc.id, state)
    ],
    choices: questChoices(npc.id, state)
  };
}

export function applyQuestChoice(state, choiceId) {
  if (state.quest.status !== 'active' || !state.inventory.includes(BRASS_LANTERN)) return false;

  if (choiceId === 'restore') {
    removeItem(state, BRASS_LANTERN);
    addItem(state, 'fountain-token');
    state.quest = { status: 'complete', stage: 'done', choice: 'restore', outcome: 'restored' };
    state.facts.fountainRestored = true;
    note(state, 'mara', 'you restored the fountain');
    note(state, 'oswin', 'you refused a fine sale');
    note(state, 'nessa', 'you restored the fountain');
    return true;
  }

  if (choiceId === 'sell') {
    removeItem(state, BRASS_LANTERN);
    addItem(state, 'coin-pouch');
    state.quest = { status: 'complete', stage: 'done', choice: 'sell', outcome: 'sold' };
    state.facts.lanternSold = true;
    note(state, 'mara', 'you sold the lantern');
    note(state, 'oswin', 'you sold him the brass lantern');
    note(state, 'nessa', 'the fountain stayed dark');
    return true;
  }

  return false;
}

function questChoices(npcId, state) {
  if (npcId !== 'mara' || state.quest.status !== 'active') return [];
  if (!state.inventory.includes(BRASS_LANTERN)) return [];
  return [
    { id: 'restore', label: '1 — Put the lantern back in the fountain' },
    { id: 'sell', label: '2 — Take Oswin’s offer and sell it' }
  ];
}

function storyLines(npcId, state) {
  const carrying = state.inventory.includes(BRASS_LANTERN);
  const outcome = state.quest.outcome;
  const linesByNpc = {
    mara: () => {
      if (outcome === 'restored') return ['The fountain burns bright again. I will remember what you chose.'];
      if (outcome === 'sold') return ['Oswin has the lantern now. The fountain stays dark, and so does my trust.'];
      if (carrying) return ['That is the missing lantern. The fountain needs it, but Oswin will pay a fortune.'];
      if (state.quest.status === 'active') return ['The signal lantern vanished from the fountain. Check the crates near the south wall.'];
      return ['The fountain still runs. Long as it does, the plaza keeps its peace.'];
    },
    oswin: () => {
      if (outcome === 'sold') return ['A clean trade. You had the sense to take the coin.'];
      if (outcome === 'restored') return ['You gave up coin for a pretty light. Traders remember that.'];
      if (carrying) return ['Is that the keeper’s brass lantern in your pack? Name your price.'];
      return ['Stall is open. Everything worth having is worth haggling for.'];
    },
    pip: () => ['I trim the wicks by day and light them at dusk. A dark fountain means a hard evening.'],
    halden: () => {
      if (outcome === 'sold') return ['A visitor who sells the fountain light is not one I would trust at the gate.'];
      if (outcome === 'restored') return ['You did the plaza a good turn. The walls can rest easy tonight.'];
      return ['Keep off the walls and we will get along fine.'];
    },
    nessa: () => {
      if (outcome === 'sold') return ['Word travels: the fountain lantern was sold to the trader.'];
      if (outcome === 'restored') return ['Word travels: a stranger brought the light back to Moonmoss.'];
      return ['Nothing worth announcing today, unless you count a missing lantern.'];
    },
    bram: () => ['If that lantern is cracked, bring it here before you decide its fate.'],
    iria: () => ['The herb bundle by my stall is free to a traveller who needs it.'],
    tallow: () => ['The inn has a bed for anyone who brings good news, and stew for bad news.']
  };

  return linesByNpc[npcId]?.() || [];
}
