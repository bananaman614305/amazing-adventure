// Game state for the plaza: quests, inventory, coins, NPC memory and saves.
// Everything here is plain data plus pure functions, so it can be unit-tested
// in Node (`npm test`) without a browser.

export const ITEMS = {
  lantern_oil: { name: 'Lantern Oil', description: 'A flask of oil, still warm from the market stall.' },
  brass_key: { name: 'Brass Key', description: 'Small and worn smooth. Stamped with the north gate mark.' },
  keeper_promise: { name: 'Keeper’s Promise', description: 'Mara’s word that the plaza owes you a favour.' },
  pip_ribbon: { name: 'Pip’s Ribbon', description: 'A green ribbon. Pip tied it on and would not take it back.' },
  oswin_marker: { name: 'Trader’s Marker', description: 'A wooden token from Oswin. Good for one favour, whenever you ask.' }
};

export const QUEST_ORDER = ['lanterns', 'key', 'cheer'];

export const QUESTS = {
  lanterns: {
    title: 'The Failing Lantern',
    giver: 'mara',
    steps: [
      { id: 'started', journal: 'Mara says the north lantern is failing. Oswin sells the only oil in the plaza.' },
      { id: 'oil_bought', journal: 'You have lantern oil. Mara is waiting by the fountain.' },
      { id: 'delivered', journal: 'Mara has the oil. The lanterns will burn through the night.' }
    ]
  },
  key: {
    title: 'Halden’s Missing Key',
    giver: 'halden',
    steps: [
      { id: 'started', journal: 'Halden dropped the brass gate key near the crates south-east of the fountain.' },
      { id: 'found', journal: 'You found the brass key in the grass by the crates. Halden is at his post.' }
    ]
  },
  cheer: {
    title: 'Pip’s Small Favour',
    giver: 'pip',
    steps: [
      { id: 'started', journal: 'Pip wants to hear what the lanterns look like from the north wall at dusk. Stand there when the sky turns.' },
      { id: 'watched', journal: 'You watched the lanterns from the north wall at dusk. Tell Pip.' }
    ]
  }
};

export const PHASES = ['day', 'dusk', 'night'];

export function createInitialState() {
  return {
    version: 2,
    quests: { lanterns: 'none', key: 'none', cheer: 'none' },
    inventory: [],
    perks: {},
    flags: { coins: 6 },
    // NPC memory: how often you have talked, the last topic, and small opinions.
    memory: {}
  };
}

// --- Quest helpers --------------------------------------------------------

/** Reads a quest status: 'none' | step id | 'done'. */
export function questStatus(state, questId) {
  return state.quests[questId] || 'none';
}

export function isQuestDone(state, questId) {
  return questStatus(state, questId) === 'done';
}

/** Moves a quest to `step`. Returns true when the state actually changed. */
export function setQuestStep(state, questId, step) {
  if (!QUESTS[questId]) throw new Error(`unknown quest ${questId}`);
  if (state.quests[questId] === step) return false;
  state.quests[questId] = step;
  return true;
}

/** Advances a quest past `expectedStep`. No-op if the quest is elsewhere. */
export function advanceQuest(state, questId, expectedStep, nextStep = 'done') {
  if (questStatus(state, questId) !== expectedStep) return false;
  state.quests[questId] = nextStep;
  return true;
}

export function addPerk(state, perkId, value = true) {
  if (state.perks[perkId] === value) return false;
  state.perks[perkId] = value;
  return true;
}

export function hasPerk(state, perkId) {
  return Boolean(state.perks[perkId]);
}

export function setFlag(state, flag, value = true) {
  if (state.flags[flag] === value) return false;
  state.flags[flag] = value;
  return true;
}

export function getFlag(state, flag) {
  return state.flags[flag];
}

export function coins(state) {
  return Number(state.flags.coins) || 0;
}

/** Adds coins (may be negative). Never goes below zero; returns the total. */
export function addCoins(state, delta) {
  const next = Math.max(0, coins(state) + delta);
  state.flags.coins = next;
  return next;
}

// --- Inventory ------------------------------------------------------------

export function hasItem(state, itemId) {
  return state.inventory.includes(itemId);
}

/** Adds an item once. Returns true when it was actually new. */
export function addItem(state, itemId) {
  if (!ITEMS[itemId]) throw new Error(`unknown item ${itemId}`);
  if (state.inventory.includes(itemId)) return false;
  state.inventory.push(itemId);
  return true;
}

/** Removes an item. Returns true when it was there. */
export function removeItem(state, itemId) {
  const index = state.inventory.indexOf(itemId);
  if (index === -1) return false;
  state.inventory.splice(index, 1);
  return true;
}

/** Items the player owns, expanded with names and descriptions. */
export function inventoryItems(state) {
  return state.inventory.map((id) => ({ id, ...ITEMS[id] }));
}

// --- Quest actions (the only places quest state changes) ------------------
// Each returns a result object: { changed, message }. Callers (dialogue and
// world pickups) only ever use these, which keeps transitions consistent.

const noChange = (message) => ({ changed: false, message });

export function startLanterns(state) {
  if (!setQuestStep(state, 'lanterns', 'started')) return noChange('Mara has already told you about the lantern.');
  return { changed: true, message: 'Quest started: The Failing Lantern' };
}

/** Buys oil for coins. Fails when the player cannot afford it. */
export function buyOilWithCoins(state) {
  if (questStatus(state, 'lanterns') !== 'started') return noChange('The trade is not open to you yet.');
  if (coins(state) < 4) return noChange('Oswin counts your coins and shakes his head. Four, or a promise.');
  addCoins(state, -4);
  addItem(state, 'lantern_oil');
  setQuestStep(state, 'lanterns', 'oil_bought');
  setFlag(state, 'paid_oswin', true);
  return { changed: true, message: 'Bought lantern oil for 4 coins.' };
}

/** Buys oil with a promise instead of coins: a real branch with consequences. */
export function buyOilWithPromise(state) {
  if (questStatus(state, 'lanterns') !== 'started') return noChange('The trade is not open to you yet.');
  addItem(state, 'lantern_oil');
  addPerk(state, 'oswin_debt', true);
  setQuestStep(state, 'lanterns', 'oil_bought');
  setFlag(state, 'paid_oswin', false);
  return { changed: true, message: 'Oswin gave you the oil and wrote your name in his ledger.' };
}

export function deliverOil(state) {
  if (questStatus(state, 'lanterns') !== 'oil_bought' || !hasItem(state, 'lantern_oil')) {
    return noChange('You have no oil to hand over.');
  }
  removeItem(state, 'lantern_oil');
  addItem(state, 'keeper_promise');
  addCoins(state, 3);
  setQuestStep(state, 'lanterns', 'done');
  return { changed: true, message: 'Quest complete: The Failing Lantern (+3 coins)' };
}

export function startKey(state) {
  if (!setQuestStep(state, 'key', 'started')) return noChange('Halden has already asked.');
  return { changed: true, message: 'Quest started: Halden’s Missing Key' };
}

/** Picks the key up from the grass. Only works while the quest is active. */
export function pickUpKey(state) {
  if (questStatus(state, 'key') !== 'started') return noChange('Nothing here but grass.');
  addItem(state, 'brass_key');
  setQuestStep(state, 'key', 'found');
  return { changed: true, message: 'Found the Brass Key.' };
}

export function returnKey(state) {
  if (questStatus(state, 'key') !== 'found' || !hasItem(state, 'brass_key')) {
    return noChange('You have no key to return.');
  }
  removeItem(state, 'brass_key');
  addItem(state, 'oswin_marker');
  if (hasPerk(state, 'oswin_debt')) addPerk(state, 'oswin_debt', false);
  setFlag(state, 'paid_oswin', true);
  setQuestStep(state, 'key', 'done');
  return { changed: true, message: 'Quest complete: Halden’s Missing Key. He vouched for you with Oswin.' };
}

export function startCheer(state) {
  if (!setQuestStep(state, 'cheer', 'started')) return noChange('Pip has already told you what they want.');
  return { changed: true, message: 'Quest started: Pip’s Small Favour' };
}

/** Called by the world when the player is on the north wall during dusk. */
export function watchLanterns(state, phase) {
  if (questStatus(state, 'cheer') !== 'started') return noChange('Pip is not waiting on this.');
  if (phase !== 'dusk') return noChange('The lanterns are not lit yet. Pip said dusk.');
  setQuestStep(state, 'cheer', 'watched');
  return { changed: true, message: 'You watched the lanterns light up from the wall.' };
}

export function tellPipAboutLanterns(state) {
  if (questStatus(state, 'cheer') !== 'watched') return noChange('You have nothing to tell Pip yet.');
  addItem(state, 'pip_ribbon');
  setQuestStep(state, 'cheer', 'done');
  return { changed: true, message: 'Quest complete: Pip’s Small Favour' };
}

// --- NPC memory -----------------------------------------------------------

export function memoryFor(state, npcId) {
  return state.memory[npcId] || { talks: 0, lastTopic: null, opinion: 0 };
}

export function remember(state, npcId, { topic, opinionDelta = 0 } = {}) {
  const memory = memoryFor(state, npcId);
  memory.talks = (memory.talks || 0) + 1;
  if (topic) memory.lastTopic = topic;
  memory.opinion = Math.max(-3, Math.min(3, (memory.opinion || 0) + opinionDelta));
  state.memory[npcId] = memory;
  return memory;
}

// --- Views ----------------------------------------------------------------

/** The journal view: one entry per started quest, current step text only. */
export function journalEntries(state) {
  const entries = [];
  for (const questId of QUEST_ORDER) {
    const status = questStatus(state, questId);
    if (status === 'none') continue;
    const quest = QUESTS[questId];
    const step = status === 'done'
      ? quest.steps[quest.steps.length - 1]
      : quest.steps.find((s) => s.id === status) || quest.steps[0];
    entries.push({
      id: questId,
      title: quest.title,
      text: step.journal,
      done: status === 'done'
    });
  }
  return entries;
}

/** Human-readable counts for the HUD: { active, done }. */
export function questCounts(state) {
  let active = 0;
  let done = 0;
  for (const questId of QUEST_ORDER) {
    const status = questStatus(state, questId);
    if (status === 'none') continue;
    if (status === 'done') done += 1;
    else active += 1;
  }
  return { active, done };
}

// --- Save / load ----------------------------------------------------------

export const SAVE_KEY = 'amazing-adventure:save:v2';

/**
 * Serialises a save. `world` is an optional snapshot of where the player was
 * and what time it was, so "continue" resumes in place instead of at the start.
 */
export function serialize(state, world = null) {
  return JSON.stringify({ version: 2, savedAt: Date.now(), state, world: sanitizeWorld(world) });
}

/** Keeps only the world fields a save understands, so bad data cannot leak in. */
export function sanitizeWorld(world) {
  if (!world || typeof world !== 'object') return null;
  const x = Number(world.x);
  const z = Number(world.z);
  const yaw = Number(world.yaw);
  const clock = Number(world.clock);
  if (![x, z, yaw, clock].every(Number.isFinite)) return null;
  return {
    x: Math.max(-16, Math.min(16, x)),
    z: Math.max(-16, Math.min(16, z)),
    yaw,
    clock: ((clock % 180) + 180) % 180
  };
}

/**
 * Reads a full save: { state, world }. `world` is null when absent or invalid.
 * Returns null when the save as a whole is unusable.
 */
export function readSave(raw) {
  const state = deserialize(raw);
  if (!state) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state, world: null };
  }
  return { state, world: sanitizeWorld(parsed?.world) };
}

/** True when every quest value is a step of that quest or 'done'/'none'. */
function validQuestStatus(questId, status) {
  if (status === 'none' || status === 'done') return true;
  return QUESTS[questId].steps.some((step) => step.id === status);
}

/**
 * Parses a save string. Returns null when it is unusable, so a corrupt save
 * can never wedge the game on load. Unknown fields are dropped and invalid
 * quest steps fall back to 'none'.
 */
export function deserialize(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const saved = parsed && parsed.state;
  if (!saved || typeof saved !== 'object') return null;
  if (!saved.quests || typeof saved.quests !== 'object') return null;

  const state = createInitialState();
  for (const questId of QUEST_ORDER) {
    const status = saved.quests[questId];
    if (validQuestStatus(questId, status)) state.quests[questId] = status;
  }
  if (Array.isArray(saved.inventory)) {
    for (const id of saved.inventory) {
      if (ITEMS[id] && !state.inventory.includes(id)) state.inventory.push(id);
    }
  }
  if (saved.perks && typeof saved.perks === 'object') {
    for (const [key, value] of Object.entries(saved.perks)) {
      if (typeof value === 'boolean') state.perks[key] = value;
    }
  }
  if (saved.flags && typeof saved.flags === 'object') {
    for (const [key, value] of Object.entries(saved.flags)) {
      if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
        state.flags[key] = value;
      }
    }
    if (!Number.isFinite(state.flags.coins)) state.flags.coins = 6;
    state.flags.coins = Math.max(0, Math.floor(state.flags.coins));
  }
  if (saved.memory && typeof saved.memory === 'object') {
    for (const [npcId, memory] of Object.entries(saved.memory)) {
      if (!memory || typeof memory !== 'object') continue;
      state.memory[npcId] = {
        talks: Number.isFinite(memory.talks) ? Math.max(0, Math.floor(memory.talks)) : 0,
        lastTopic: typeof memory.lastTopic === 'string' ? memory.lastTopic : null,
        opinion: Number.isFinite(memory.opinion) ? Math.max(-3, Math.min(3, memory.opinion)) : 0
      };
    }
  }
  return state;
}

/**
 * Storage adapter. Falls back to an in-memory store when localStorage is
 * missing or throws (private mode, blocked storage), so the game keeps working.
 */
export function createSaveStore(storage) {
  let backend = storage ?? null;
  if (!backend) {
    try {
      backend = globalThis.localStorage;
    } catch {
      backend = null;
    }
  }
  // Probe whichever backend we ended up with: private mode and broken shims
  // throw on write, and that must never break the game.
  if (backend) {
    try {
      backend.setItem(`${SAVE_KEY}:probe`, '1');
      backend.removeItem(`${SAVE_KEY}:probe`);
    } catch {
      backend = null;
    }
  }
  const memory = new Map();
  const ok = Boolean(backend);

  function read() {
    if (!ok) return memory.get(SAVE_KEY);
    try {
      return backend.getItem(SAVE_KEY);
    } catch {
      return memory.get(SAVE_KEY);
    }
  }

  return {
    available: ok,
    save(state, world = null) {
      const raw = serialize(state, world);
      if (ok) {
        try {
          backend.setItem(SAVE_KEY, raw);
          return raw;
        } catch {
          // Storage filled up or was revoked mid-session; keep going in memory.
        }
      }
      memory.set(SAVE_KEY, raw);
      return raw;
    },
    load() {
      return deserialize(read());
    },
    loadSave() {
      return readSave(read());
    },
    hasSave() {
      return Boolean(read());
    },
    clear() {
      if (ok) {
        try {
          backend.removeItem(SAVE_KEY);
        } catch {
          // Ignore: the in-memory copy is cleared below regardless.
        }
      }
      memory.delete(SAVE_KEY);
    }
  };
}
