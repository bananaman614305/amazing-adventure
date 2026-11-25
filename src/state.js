// Game state for the plaza: quests, inventory, coins, NPC memory, reputation
// and saves. Everything here is plain data plus pure functions, so it can be
// unit-tested in Node (`npm test`) without a browser.

import { createInitialReputation, changeReputation, clampReputation as clampReputationSafe, FACTIONS } from './factions.js';

export const ITEMS = {
  lantern_oil: { name: 'Lantern Oil', description: 'A flask of oil, still warm from the market stall.' },
  brass_key: { name: 'Brass Key', description: 'Small and worn smooth. Stamped with the north gate mark.' },
  keeper_promise: { name: 'Keeper’s Promise', description: 'Mara’s word that the plaza owes you a favour.' },
  pip_ribbon: { name: 'Pip’s Ribbon', description: 'A green ribbon. Pip tied it on and would not take it back.' },
  oswin_marker: { name: 'Trader’s Marker', description: 'A wooden token from Oswin. Good for one favour, whenever you ask.' },
  toll_ledger: { name: 'Toll Ledger', description: 'Wren’s missing ledger. The last page names someone, and it is not Oswin.' },
  arrears_pouch: { name: 'Pouch of Arrears', description: 'Three weeks of lane toll money, sewn into a canvas pouch. Mara is owed this.' },
  keeper_receipt: { name: 'Keeper’s Receipt', description: 'Mara’s mark, dated and countersigned. Proof the plaza took the arrears in full.' },
  keeper_note: { name: 'Keeper’s Note', description: 'Mara’s writing, forgiving the lane’s arrears this quarter. Wren will not like the reason.' },
  night_order: { name: 'Night Order', description: 'Oswin’s paper chit for two lanterns before the moon is up, signed in his own hand.' },
  rope: { name: 'Coil of Rope', description: 'Oswin’s good hemp rope. Strong enough to hold a gate shut.' }
};

export const QUEST_ORDER = ['lanterns', 'key', 'cheer', 'toll', 'ledger', 'arrears', 'nightlight'];

export const QUESTS = {
  lanterns: {
    title: 'The Failing Lantern',
    giver: 'mara',
    steps: [
      { id: 'started', journal: 'Mara says the north lantern is failing. Oswin sells the only oil in the plaza.' },
      { id: 'oil_bought', journal: 'You have lantern oil. Mara is waiting by the fountain.' },
      { id: 'delivered', journal: 'Mara has the oil. The lanterns will burn through the night.' }
    ],
    done: 'Mara has the oil. The lanterns burn all night without a flicker.'
  },
  key: {
    title: 'Halden’s Missing Key',
    giver: 'halden',
    steps: [
      { id: 'started', journal: 'Halden dropped the brass gate key near the crates south-east of the fountain.' },
      { id: 'found', journal: 'You found the brass key in the grass by the crates. Halden is at his post.' }
    ],
    done: 'Halden has his brass key back, and the north gate stands open.'
  },
  cheer: {
    title: 'Pip’s Small Favour',
    giver: 'pip',
    steps: [
      { id: 'started', journal: 'Pip wants to hear what the lanterns look like from the north wall at dusk. Stand there when the sky turns.' },
      { id: 'watched', journal: 'You watched the lanterns from the north wall at dusk. Tell Pip.' }
    ],
    done: 'You told Pip how the lanterns light up the plaza from the wall. Pip has not stopped talking about it.'
  },
  ledger: {
    title: 'The Missing Ledger',
    giver: 'wren',
    steps: [
      { id: 'started', journal: 'Wren needs the toll ledger that went missing from her stall. Nobody in the lane will own up.' },
      { id: 'booked', journal: 'You promised Wren a name. The ledger quarter is somewhere in the lane.' },
      { id: 'recovered', journal: 'You have the toll ledger. Wren is at her stall in the lane.' }
    ],
    doneBy: {
      name: 'You gave Wren the trader’s name and collected the reward. The lane’s accounts are square with the Watch.',
      cover: 'You gave Wren the ledger and kept the trader’s name out of it. The lane remembers that.'
    }
  },
  toll: {
    title: 'The Market Toll',
    giver: 'halden',
    steps: [
      { id: 'started', journal: 'Halden says Oswin has not paid the gate toll in weeks. Fetch it, or talk Oswin round.' },
      { id: 'collected', journal: 'You have Oswin’s toll money for the Watch.' },
      { id: 'waived', journal: 'You talked Halden into waiving the toll. Oswin owes you again.' }
    ],
    doneBy: {
      collected: 'You paid Oswin’s toll out of your own purse. Halden has the money; Oswin is not grateful.',
      waived: 'You talked Halden into waiving the toll. Oswin owes you again.'
    }
  },
  arrears: {
    title: 'The Lane’s Arrears',
    giver: 'wren',
    steps: [
      { id: 'started', journal: 'Wren gave you a pouch of lane arrears for Mara in the plaza. Carry it south through the gate.' },
      { id: 'delivered', journal: 'Mara has settled the arrears. Carry her mark back north to Wren in the market lane.' }
    ],
    doneBy: {
      pay: 'Mara took the lane’s arrears in full and signed for them. Wren’s books balance for the first time in a month.',
      forgive: 'Mara forgave the arrears instead of taking them. Wren has her note, and the Watch will have questions about the shortfall.'
    }
  },
  nightlight: {
    title: 'The Night Light', giver: 'oswin',
    steps: [
      { id: 'started', journal: 'Oswin paid you to walk the lane’s lamp round after sundown. The post is at the far end of the market lane, near the barrels.' },
      { id: 'walked', journal: 'You walked the round and the lane lanterns are burning. Take Oswin’s word back to his stall in the plaza.' }
    ],
    done: 'You walked Oswin’s lamp round and the lane lanterns burn over the market again. He paid, and he remembers.'
  },
  // --- Late faction chores (round 60) --------------------------------------
  // Two short errands that only become reachable in the last third of the game,
  // so the ending is not one faction’s story. They deliberately live outside
  // QUEST_ORDER: the six-quest spine stays six quests, while a player who did
  // the side work still gets the recognition for it.
  wicks: {
    title: 'The Wick Round', giver: 'mara',
    steps: [
      { id: 'started', journal: 'Mara asked you to walk the plaza’s wick round at dusk, checking every lantern the oil quest saved.' },
      { id: 'trimmed', journal: 'You trimmed the plaza lanterns at dusk. Mara is by the fountain, north side.' }
    ],
    done: 'You walked the plaza’s wick round at dusk. The lanterns burn steady, and Mara knows it.'
  },
  tally: {
    title: 'The Gate Tally', giver: 'halden',
    steps: [
      { id: 'started', journal: 'Halden wants a walked gate tally for the open gate. Step out into the market lane and back so the watch has a count.' },
      { id: 'walked', journal: 'You walked out through the north gate and back. Halden is at his post by the gate.' }
    ],
    done: 'You walked Halden’s gate tally. The open gate has a count, and the watch stands easier.'
  }
};

export const PHASES = ['day', 'dusk', 'night'];

/**
 * The late chores, kept apart from QUEST_ORDER on purpose. The spine is the
 * seven main quests; these two are the small end-of-game errands that make the
 * Keepers and the Watch matter in the final third. They still need to be
 * persisted, journalled and counted, so every place that walks quest state
 * walks this list too.
 */
export const CHORE_ORDER = ['wicks', 'tally'];

/** Every quest-shaped id the game tracks: the spine first, then the chores. */
const ALL_QUEST_IDS = [...QUEST_ORDER, ...CHORE_ORDER];

export const TOLL_COST = 5;

/**
 * The most coins a save is allowed to carry. A finished playthrough ends with
 * around seven, so this is far beyond anything reachable by playing. It exists
 * because the economy is finite and a hand-edited save claiming 1e308 coins should
 * not be treated as legitimate: coin balance is clamped at the bottom already,
 * and clamping only one end is arbitrary rather than safe.
 */
export const MAX_COINS = 9999;

// --- The late faction chores (round 60) ------------------------------------
//
// The Night Light (round 56) made the Market matter at the end of the game. The
// Keepers and the Watch still had nothing late to offer, so the final third read
// as one faction's story. These two chores fix that.
//
// Rules shared by both, so neither becomes a button:
//  - gated on visible progress, not on standing (lanterns delivered for Mara, an
//    open gate for Halden);
//  - paid once, keyed on a flag, so dawn or any clock trick cannot farm them;
//  - the purse is the same shape as the lamp round: a few coins and a little
//    standing, with the real cost being the walk and the phase;
//  - the quest closes with the giver, so the walk and the word are two acts.

export const WICKS_REWARD = { coins: 2, factionId: 'keepers', delta: 4 };
export const TALLY_REWARD = { coins: 2, factionId: 'watch', delta: 4 };

/** Whether Mara will offer the wick round right now. */
export function wicksUnlocked(state) {
  return isQuestDone(state, 'lanterns');
}

/** Takes Mara's wick round: the promise to trim the plaza lanterns at dusk. */
export function startWicks(state) {
  if (questStatus(state, 'wicks') !== 'none') return noChange('Mara has already given you the wick round.');
  if (!wicksUnlocked(state)) return noChange('Mara shakes her head. "Get the north lantern burning first. Then we will talk about the rest."');
  setQuestStep(state, 'wicks', 'started');
  return { changed: true, message: 'Quest started: The Wick Round', topic: 'wicks_started' };
}

/** The act: trimming the plaza lanterns at dusk. Advances the promised chore. */
export function trimWicks(state, phase) {
  if (questStatus(state, 'wicks') !== 'started') return noChange('You are not carrying the wick round.');
  if (phase !== 'dusk' && phase !== 'night') return noChange('The wick round is walked at dusk, when the lanterns are lit.');
  if (getFlag(state, 'wicksTrimmed')) return noChange('The plaza lanterns are already trimmed tonight.');
  setFlag(state, 'wicksTrimmed', true);
  const paid = !getFlag(state, 'wicksPaid');
  if (paid) setFlag(state, 'wicksPaid', true);
  setQuestStep(state, 'wicks', 'trimmed');
  const parts = ['You trim the plaza lanterns and check each flame. The square burns steady.'];
  if (paid) {
    addCoins(state, WICKS_REWARD.coins);
    const standing = applyStanding(state, { factionId: WICKS_REWARD.factionId, delta: WICKS_REWARD.delta });
    parts[0] = `You trim the plaza lanterns and check each flame. +${WICKS_REWARD.coins} coins.`;
    if (standing.message) parts.push(standing.message);
  }
  return { changed: true, message: parts.join(' '), reward: paid ? WICKS_REWARD.coins : 0 };
}

/** Closes the wick round with Mara. Pays once; the act is the gate. */
export function finishWicks(state) {
  if (questStatus(state, 'wicks') !== 'trimmed') return noChange('Mara is waiting on a walked wick round, not a promise.');
  setQuestStep(state, 'wicks', 'done');
  return { changed: true, message: 'Quest complete: The Wick Round. Mara nods, which from her is a speech.', topic: 'wicks_done', opinion: 2 };
}

/** Whether Halden will offer the gate tally right now. */
export function tallyUnlocked(state) {
  return questStatus(state, 'key') === 'done';
}

/** Takes Halden's tally: the promise to walk out through the gate and back. */
export function startTally(state) {
  if (questStatus(state, 'tally') !== 'none') return noChange('Halden has already given you the gate tally.');
  if (!tallyUnlocked(state)) return noChange('Halden jerks a thumb at the shut gate. "Open it first. Then I need a count I can trust."');
  setQuestStep(state, 'tally', 'started');
  return { changed: true, message: 'Quest started: The Gate Tally', topic: 'tally_started' };
}

/** The act: walking out through the open gate into the lane. Advances the chore. */
export function walkTally(state) {
  if (questStatus(state, 'tally') !== 'started') return noChange('You are not carrying the gate tally.');
  if (!tallyUnlocked(state)) return noChange('The gate is shut; there is nothing to tally.');
  setFlag(state, 'tallyWalked', true);
  setQuestStep(state, 'tally', 'walked');
  return { changed: true, message: 'You walk out through the north gate and back. The watch has its count.', topic: 'tally_walked' };
}

/** Closes the tally with Halden. Pays once; the walk is the gate. */
export function finishTally(state) {
  if (questStatus(state, 'tally') !== 'walked') return noChange('Halden is waiting on a walked gate tally, not a promise.');
  if (getFlag(state, 'tallyPaid')) return noChange('Halden has already paid for this tally.');
  setFlag(state, 'tallyPaid', true);
  setQuestStep(state, 'tally', 'done');
  addCoins(state, TALLY_REWARD.coins);
  const standing = applyStanding(state, { factionId: TALLY_REWARD.factionId, delta: TALLY_REWARD.delta });
  const parts = [`Quest complete: The Gate Tally (+${TALLY_REWARD.coins} coins). The watch stands easier for it.`];
  if (standing.message) parts.push(standing.message);
  return { changed: true, message: parts.join(' '), topic: 'tally_done', opinion: 2, reward: TALLY_REWARD.coins };
}

/** Dawn puts the wick round's act to bed, the same as the lane lanterns. */
export function wicksAtDawn(state, phase) {
  if (phase !== 'day') return { reset: false };
  if (!getFlag(state, 'wicksTrimmed')) return { reset: false };
  setFlag(state, 'wicksTrimmed', false);
  return { reset: true };
}

export function createInitialState() {
  return {
    version: 2,
    quests: { lanterns: 'none', key: 'none', cheer: 'none', toll: 'none', ledger: 'none', arrears: 'none', nightlight: 'none', wicks: 'none', tally: 'none' },
    inventory: [],
    perks: {},
    flags: { coins: 6 },
    // NPC memory: how often you have talked, the last topic, and small opinions.
    memory: {},
    // Faction standing, separate from personal opinion. See factions.js.
    reputation: createInitialReputation(),
    // Which resolution a branching quest ended on, so the journal can describe
    // what actually happened instead of guessing at the last listed step.
    outcomes: {}
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

// --- Oswin's stall: a priced purchase ---------------------------------------
// One real sink for the coins the game hands out. The rope is bought once and
// owned forever: there is no dawn reset and no restock, so it cannot be farmed
// into coins or standing. It costs coins and grants an item, nothing more.
export const OSWIN_WARES = [
  { id: 'rope', price: 3 }
];

export function buyOswinWare(state, itemId) {
  const ware = OSWIN_WARES.find((w) => w.id === itemId);
  if (!ware) return noChange('Oswin does not stock that.');
  if (hasItem(state, itemId)) return noChange('You already carry that.');
  if (coins(state) < ware.price) {
    return noChange(`Oswin shakes his head. “${ware.price} coins, or nothing.”`);
  }
  addCoins(state, -ware.price);
  addItem(state, itemId);
  return { changed: true, message: `Bought ${ITEMS[itemId].name} for ${ware.price} coins.` };
}

// --- Favours the game actually honours --------------------------------------
// The plaza hands out three tokens of gratitude — Mara's word, Oswin's marker,
// Pip's ribbon — and until now only Oswin's marker did anything (it lifted his
// refusal). These two redeem a real, one-time payoff and are then spent, so they
// cannot be farmed. Pip's ribbon stays a keepsake: Pip is a child, and a ribbon
// you wear is the favour.
export const KEEPER_PROMISE_REWARD = { coins: 2, factionId: 'keepers', delta: 10 };
export const TRADER_MARKER_REWARD = { coins: 2, factionId: 'trade', delta: 10 };

export function redeemKeeperPromise(state) {
  if (!hasItem(state, 'keeper_promise')) return noChange('Mara owes you nothing right now.');
  removeItem(state, 'keeper_promise');
  addCoins(state, KEEPER_PROMISE_REWARD.coins);
  const standing = applyStanding(state, { factionId: KEEPER_PROMISE_REWARD.factionId, delta: KEEPER_PROMISE_REWARD.delta });
  return {
    changed: true,
    message: `Mara honours her word: +${KEEPER_PROMISE_REWARD.coins} coins. ${standing.message}`.trim(),
    topic: 'promise_redeemed',
    opinion: 1
  };
}

export function redeemTraderMarker(state) {
  if (!hasItem(state, 'oswin_marker')) return noChange('Oswin owes you nothing right now.');
  removeItem(state, 'oswin_marker');
  addCoins(state, TRADER_MARKER_REWARD.coins);
  const standing = applyStanding(state, { factionId: TRADER_MARKER_REWARD.factionId, delta: TRADER_MARKER_REWARD.delta });
  return {
    changed: true,
    message: `Oswin honours the marker: +${TRADER_MARKER_REWARD.coins} coins. ${standing.message}`.trim(),
    topic: 'marker_redeemed',
    opinion: 1
  };
}


// --- Reputation actions (quest-level consequences) ------------------------

/**
 * Applies faction news with rival reactions and returns a readable message for
 * the toast. Nothing is reported when no score actually moved.
 */
export function applyStanding(state, { factionId, delta, rivals = [] }) {
  const applied = changeReputation(state, factionId, delta);
  const parts = [];
  if (applied !== 0) parts.push(`${FACTIONS[factionId].name} ${applied > 0 ? '+' : ''}${applied}`);
  for (const rival of rivals) {
    const rivalApplied = changeReputation(state, rival.id, rival.delta);
    if (rivalApplied !== 0) parts.push(`${FACTIONS[rival.id].name} ${rivalApplied > 0 ? '+' : ''}${rivalApplied}`);
  }
  return { changed: parts.length > 0, message: parts.length ? `Reputation: ${parts.join(', ')}` : '' };
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
  const owedOswin = hasPerk(state, 'oswin_debt');
  removeItem(state, 'lantern_oil');
  addItem(state, 'keeper_promise');
  addCoins(state, 3);
  setQuestStep(state, 'lanterns', 'done');
  // The Keepers care about the light itself; the Market notices whether the
  // trader was paid. A promise kept at Oswin's expense is not free goodwill.
  const standing = applyStanding(state, owedOswin
    ? { factionId: 'keepers', delta: 20, rivals: [{ id: 'trade', delta: -10 }] }
    : { factionId: 'keepers', delta: 20, rivals: [{ id: 'trade', delta: 10 }] });
  const suffix = state.perks.oswin_debt ? ' Oswin still holds your promise.' : '';
  return {
    changed: true,
    message: `Quest complete: The Failing Lantern (+3 coins). ${standing.message}${suffix}`,
    topic: 'delivered',
    opinion: 1
  };
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
  const owedOswin = hasPerk(state, 'oswin_debt');
  removeItem(state, 'brass_key');
  addItem(state, 'oswin_marker');
  if (owedOswin) addPerk(state, 'oswin_debt', false);
  setFlag(state, 'paid_oswin', true);
  setQuestStep(state, 'key', 'done');
  // Halden's vouch is worth more than a coin: the Watch warms to you, and the
  // Market forgives a promise because the guard made it good.
  const standing = applyStanding(state, {
    factionId: 'watch',
    delta: 25,
    rivals: [{ id: 'trade', delta: owedOswin ? 10 : 5 }]
  });
  return {
    changed: true,
    message: `Quest complete: Halden’s Missing Key. He vouched for you with Oswin. ${standing.message}`,
    topic: 'key_returned',
    opinion: 2
  };
}

// --- The Market Toll: a deliberate faction dilemma ------------------------
// The player cannot please both sides. Collecting the toll pays the Watch and
// costs the Market; waiving it does the opposite. This is the clearest example
// of the "choices affect one another" goal for this round.

export function startToll(state) {
  if (questStatus(state, 'toll') !== 'none') return noChange('Halden has already raised the toll with you.');
  if (questStatus(state, 'key') !== 'done') {
    return noChange('Halden does not trust you with Watch business yet. Return his key first.');
  }
  setQuestStep(state, 'toll', 'started');
  return { changed: true, message: 'Quest started: The Market Toll' };
}

/** Collect Oswin's toll for the Watch. */
export function collectToll(state) {
  if (questStatus(state, 'toll') !== 'started') return noChange('There is no toll to collect.');
  if (coins(state) < TOLL_COST) return noChange(`Oswin counts out what he owes. You would need ${TOLL_COST} coins to cover it.`);
  addCoins(state, -TOLL_COST);
  setQuestStep(state, 'toll', 'collected');
  // Paying the toll out of your own purse settles Oswin's dues with the Watch.
  // The Market is mildly put out at being covered for, but Wren -- whose ledger is
  // literally the toll book -- records that the dues are paid. Without this, paying
  // the toll dropped the Market below her trust gate and there was then no action
  // left anywhere in the game that could raise it again: a soft-lock.
  setFlag(state, 'dues_paid', true);
  const standing = applyStanding(state, {
    factionId: 'watch',
    delta: 20,
    rivals: [{ id: 'trade', delta: -5 }]
  });
  return {
    changed: true,
    message: `You pay Oswin’s toll out of your own purse. The dues are on Wren’s book now. ${standing.message}`,
    topic: 'toll_collected',
    opinion: -1
  };
}

/** Talk Halden into waiving the toll, which the Market rewards. */
export function waiveToll(state, tierId) {
  if (questStatus(state, 'toll') !== 'started') return noChange('There is no toll to waive.');
  const trusted = tierId === 'warm' || tierId === 'trusted';
  if (!trusted) {
    return noChange('Halden is not convinced. He would need to trust you more than he does.');
  }
  setQuestStep(state, 'toll', 'waived');
  addPerk(state, 'oswin_favour', true);
  const standing = applyStanding(state, {
    factionId: 'trade',
    delta: 20,
    rivals: [{ id: 'watch', delta: -10 }]
  });
  return {
    changed: true,
    message: `Halden agrees to let the toll go. ${standing.message}`,
    topic: 'toll_waived',
    opinion: 1
  };
}

export function finishToll(state) {
  const status = questStatus(state, 'toll');
  if (status !== 'collected' && status !== 'waived') return noChange('The toll business is not finished yet.');
  // Remember the branch before collapsing the status to 'done'.
  state.outcomes.toll = status;
  setQuestStep(state, 'toll', 'done');
  return { changed: true, message: 'Quest complete: The Market Toll' };
}

// --- The lane: Wren and the missing ledger -------------------------------
//
// Wren is the gate on the new area's content. Her quest needs Warm standing
// with the Market, so the reputation built in the plaza is what opens her up.
// Two resolutions change who she is angry with, and both move standing.

export const LEDGER_MIN_TIER = 'warm';

/**
 * Wren says trust is earned by "dues paid, promises kept, Oswin at his stall with
 * his accounts in order". Settling Oswin's toll yourself is exactly that, so it
 * qualifies even though the Market's own goodwill dips: she is the toll clerk, and
 * a paid due is a paid due.
 */
export function duesSettleTheBook(state) {
  return getFlag(state, 'dues_paid') === true;
}
export const LEDGER_REWARD = 4;

/** Whether Wren will hand out her quest at all, given standing. */
export function ledgerUnlocked(state, tierId) {
  if (duesSettleTheBook(state)) return true;
  const rank = { hostile: 0, cold: 1, neutral: 2, warm: 3, trusted: 4 };
  return rank[tierId] >= rank[LEDGER_MIN_TIER];
}

export function startLedger(state, tierId) {
  if (questStatus(state, 'ledger') !== 'none') return noChange('Wren has already told you about the ledger.');
  if (!ledgerUnlocked(state, tierId)) {
    return noChange('Wren looks you over. “Market business is for people the Market trusts.”');
  }
  setQuestStep(state, 'ledger', 'started');
  return { changed: true, message: 'Quest started: The Missing Ledger', topic: 'ledger_started' };
}

/** Wren tells you where the quarter went, if she likes you enough. */
export function hearLedgerRumour(state) {
  if (questStatus(state, 'ledger') !== 'started') return noChange('You have nothing to ask her about.');
  setQuestStep(state, 'ledger', 'booked');
  return { changed: true, message: 'Wren points you towards the barrels by the far wall.', topic: 'ledger_rumour' };
}

export function recoverLedger(state) {
  if (questStatus(state, 'ledger') !== 'booked') return noChange('You have no reason to search the barrels yet.');
  setQuestStep(state, 'ledger', 'recovered');
  addItem(state, 'toll_ledger');
  return { changed: true, message: 'You found the toll ledger tucked behind a barrel.' };
}

/**
 * Wren's two endings. Naming the trader is honest and pleases the Watch;
 * covering for him protects the Market. Neither is free.
 */
export function returnLedger(state, choice = 'name') {
  if (questStatus(state, 'ledger') !== 'recovered') return noChange('Wren is not waiting on you for anything.');
  state.outcomes.ledger = choice === 'cover' ? 'cover' : 'name';
  setQuestStep(state, 'ledger', 'done');
  removeItem(state, 'toll_ledger');
  if (choice === 'cover') {
    const standing = applyStanding(state, {
      factionId: 'trade',
      delta: 20,
      rivals: [{ id: 'watch', delta: -10 }]
    });
    addPerk(state, 'oswin_favour', true);
    return {
      changed: true,
      message: `You cover for the trader. ${standing.message}`,
      topic: 'ledger_covered', opinion: 1,
      reward: 0
    };
  }
  const standing = applyStanding(state, {
    factionId: 'watch',
    delta: 20,
    rivals: [{ id: 'trade', delta: -10 }]
  });
  addCoins(state, LEDGER_REWARD);
  return {
    changed: true,
    message: `Wren writes the name down. ${standing.message}`,
    topic: 'ledger_named', opinion: 1,
    reward: LEDGER_REWARD
  };
}

// --- The Night Light: a trader's work gated on the lit lane --------------
//
// The lane's bunting lanterns are lit by hand at dusk (areas.js). This is the
// round-56 payoff: a trader only offers paid work for a lantern round once the
// lane is actually glowing, so the visible progress the player makes at the
// lamp post becomes story progress. The light flag is the gate, the dawn reset
// means the offer is per-night, and the quest closes at Oswin's stall.

export const NIGHTLIGHT_REWARD = 6;

/**
 * Whether Oswin will offer the night-light work right now. It keys off the
 * player having walked the lamp round at all (`laneEverLit` in areas.js), not
 * merely the lane being dark or lit this instant: a trader who watched you
 * light the lane still knows you did after dawn, so the offer stays reachable
 * instead of evaporating with the flag it was gated on.
 */
export function nightLightUnlocked(state) {
  return Boolean(getFlag(state, 'laneEverLit')) || Boolean(getFlag(state, 'laneLanternsLit'));
}

/** Takes Oswin's order: the promise to walk the round tonight. */
export function startNightLight(state) {
  if (questStatus(state, 'nightlight') !== 'none') return noChange('Oswin has already given you the night order.');
  if (!nightLightUnlocked(state)) return noChange('Oswin waves a hand at the dark lane. “Light the lane lanterns first, then we will talk about the night trade.”');
  setQuestStep(state, 'nightlight', 'started');
  addItem(state, 'night_order');
  return { changed: true, message: 'Quest started: The Night Light', topic: 'nightlight_started' };
}

/**
 * Marks the round walked. Called after the lamp round succeeds, so the quest
 * only advances on a real lighting, never on a dawn or a refused attempt.
 */
export function walkNightLight(state) {
  if (questStatus(state, 'nightlight') !== 'started') return noChange('You are not carrying a night order.');
  setQuestStep(state, 'nightlight', 'walked');
  return { changed: true, message: 'You walked Oswin’s round. The lane lanterns are burning.', topic: 'nightlight_walked' };
}

/**
 * Closes the night-light order at Oswin's stall. Pays, warms the Market (the
 * traders paid for the light), and remembers the work. Needs the walked step,
 * so being paid requires the lantern round to have actually happened.
 */
export function finishNightLight(state) {
  if (questStatus(state, 'nightlight') !== 'walked') return noChange('Oswin is waiting on a walked lantern round, not a promise.');
  removeItem(state, 'night_order');
  setQuestStep(state, 'nightlight', 'done');
  addCoins(state, NIGHTLIGHT_REWARD);
  const standing = applyStanding(state, { factionId: 'trade', delta: 15 });
  return {
    changed: true,
    message: `Quest complete: The Night Light (+${NIGHTLIGHT_REWARD} coins). ${standing.message}`,
    topic: 'nightlight_done', opinion: 2, reward: NIGHTLIGHT_REWARD
  };
}

// --- Reputation refusals -------------------------------------------------
//
// The other half of the standing system. Until now standing only opened doors;
// these rules close them, so a player who treats the plaza badly finds the
// plaza closing around them. Every refusal is escapable: acting well lifts the
// tier and the NPC serves you again.
//
// `required` is the lowest tier that still gets served, so 'neutral' turns away
// Cold and Hostile while 'cold' turns away Hostile only.

export const REFUSAL_RULES = [
  {
    npcIds: ['oswin'],
    required: 'neutral',
    reason: 'Oswin will not deal with you.',
    // His ledger is the plaza's shop, so his refusal is about money and trust.
    until: (state) => hasItem(state, 'oswin_marker'),
    // Never block the only oil in the plaza: Mara's first quest needs it, and a
    // player who soured the Market early must still be able to finish the
    // tutorial and earn their way back into everyone's good books.
    exempt: (state) => questStatus(state, 'lanterns') === 'started'
      || questStatus(state, 'lanterns') === 'oil_bought'
  },
  {
    npcIds: ['halden'],
    required: 'cold',
    reason: 'Halden will not do business with you.',
    // No `until` here on purpose. An earlier version lifted the refusal forever
    // once the key quest was done, which made the Watch literally unable to
    // refuse in normal play -- so its refusal and the repair work behind it were
    // unreachable content. The `exempt` below is the part that actually protects
    // the critical path, and it only applies while the key is in hand.
    //
    // The key opens the only route to the market lane, so returning it has to
    // stay possible or the whole northern half of the game becomes unreachable.
    exempt: (state) => hasItem(state, 'brass_key')
  }
];

// --- The arrears: carrying between the two areas -------------------------
//
// Wren's ledger is only half the lane's problem. The toll money is owed to Mara
// in the plaza, and the only way to settle it is to walk it there -- so this
// quest exists to make the two areas depend on each other, in both directions.
// The pouch must physically be in the pack to hand over, and Mara's mark must
// physically be in the pack to close it out.

export const ARREARS_REWARD = 3;

/** Wren only trusts you with the pouch once her own ledger trouble is over. */
export function arrearsUnlocked(state) {
  return questStatus(state, 'ledger') === 'done';
}

export function startArrears(state) {
  if (questStatus(state, 'arrears') !== 'none') return noChange('Wren has already given you the pouch.');
  if (!arrearsUnlocked(state)) return noChange('Wren is still waiting on her ledger.');
  setQuestStep(state, 'arrears', 'started');
  addItem(state, 'arrears_pouch');
  return { changed: true, message: 'Quest started: The Lane’s Arrears', topic: 'arrears_started' };
}

/**
 * Handing the pouch to Mara. Paying in full pleases the Watch because the books
 * balance; forgiving it pleases the Keepers but leaves a shortfall the Watch
 * will ask about. Neither is free, and both are remembered.
 */
export function deliverArrears(state, choice = 'pay') {
  if (questStatus(state, 'arrears') !== 'started') return noChange('You are not carrying anything for Mara.');
  if (!hasItem(state, 'arrears_pouch')) return noChange('The pouch is not in your pack.');
  removeItem(state, 'arrears_pouch');
  state.outcomes.arrears = choice === 'forgive' ? 'forgive' : 'pay';
  setQuestStep(state, 'arrears', 'delivered');
  if (choice === 'forgive') {
    addItem(state, 'keeper_note');
    const standing = applyStanding(state, {
      factionId: 'keepers', delta: 10, rivals: [{ id: 'trade', delta: -5 }]
    });
    return {
      changed: true,
      message: `Mara writes off the arrears. ${standing.message}`,
      topic: 'arrears_forgiven', opinion: 1
    };
  }
  addItem(state, 'keeper_receipt');
  const standing = applyStanding(state, {
    factionId: 'keepers', delta: 10, rivals: [{ id: 'watch', delta: 5 }]
  });
  return {
    changed: true,
    message: `Mara takes the arrears and signs. ${standing.message}`,
    topic: 'arrears_paid', opinion: 1
  };
}

/**
 * Mara re-issues her mark if it somehow left the pack (a dropped save, a bug, a
 * hand-edited file). Without this the quest dead-ends: Mara tells you to take
 * something back to Wren that you no longer have, and neither of them offers it
 * again. Cheap insurance against a permanently stuck player.
 */
export function reissueArrearsMark(state) {
  if (questStatus(state, 'arrears') !== 'delivered') return noChange('Mara has nothing to re-issue.');
  if (hasItem(state, 'keeper_receipt') || hasItem(state, 'keeper_note')) {
    return noChange('You still have Mara’s mark.');
  }
  const item = state.outcomes?.arrears === 'forgive' ? 'keeper_note' : 'keeper_receipt';
  addItem(state, item);
  return { changed: true, message: 'Mara writes out her mark again.', topic: 'arrears_reissued' };
}

/** Closing the loop needs Mara's mark in hand, not just a memory of it. */
export function finishArrears(state) {
  const status = questStatus(state, 'arrears');
  if (status !== 'delivered') return noChange('Wren is not waiting on you for anything.');
  const paid = hasItem(state, 'keeper_receipt');
  const forgiven = hasItem(state, 'keeper_note');
  if (!paid && !forgiven) return noChange('You have nothing from Mara to show her.');
  removeItem(state, 'keeper_receipt');
  removeItem(state, 'keeper_note');
  setQuestStep(state, 'arrears', 'done');
  addCoins(state, ARREARS_REWARD);
  // Forgiving the debt costs the lane's standing with the Watch, and paying it
  // costs nothing: the choice the player made on the plaza side decides this.
  const standing = applyStanding(state, {
    factionId: 'trade',
    delta: 15,
    rivals: paid ? [] : [{ id: 'watch', delta: -5 }]
  });
  return {
    changed: true,
    message: `Quest complete: The Lane’s Arrears. ${standing.message}`,
    topic: 'arrears_done',
    opinion: 2,
    reward: ARREARS_REWARD
  };
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
  const standing = applyStanding(state, { factionId: 'trade', delta: 10 });
  return {
    changed: true,
    message: `Quest complete: Pip’s Small Favour. ${standing.message}`,
    topic: 'lanterns_seen',
    opinion: 2
  };
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
  for (const questId of ALL_QUEST_IDS) {
    const status = questStatus(state, questId);
    if (status === 'none') continue;
    const quest = QUESTS[questId];
    let text;
    if (status === 'done') {
      // Branching quests record which ending was reached; the journal must
      // report that ending, not whichever step happens to be listed last.
      const outcome = state.outcomes?.[questId];
      text = (outcome && quest.doneBy?.[outcome]) || quest.done || quest.steps[quest.steps.length - 1].journal;
    } else {
      const step = quest.steps.find((s) => s.id === status) || quest.steps[0];
      text = step.journal;
    }
    entries.push({
      id: questId,
      title: quest.title,
      text,
      done: status === 'done'
    });
  }
  return entries;
}

/** Human-readable counts for the HUD: { active, done }. */
export function questCounts(state) {
  let active = 0;
  let done = 0;
  for (const questId of ALL_QUEST_IDS) {
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
// The playable world spans the plaza and the market lane to its north. The
// lane reaches z -26 (see areas.js LANE), so a save taken there must survive
// the clamp instead of being teleported back into the plaza. x stays within the
// plaza's east/west extent, which also covers the lane's narrower corridor.
export const WORLD_BOUNDS = { minX: -17, maxX: 17, minZ: -26, maxZ: 17 };

export function sanitizeWorld(world) {
  if (!world || typeof world !== 'object') return null;
  const x = Number(world.x);
  const z = Number(world.z);
  const yaw = Number(world.yaw);
  const clock = Number(world.clock);
  if (![x, z, yaw, clock].every(Number.isFinite)) return null;
  return {
    x: Math.max(WORLD_BOUNDS.minX, Math.min(WORLD_BOUNDS.maxX, x)),
    z: Math.max(WORLD_BOUNDS.minZ, Math.min(WORLD_BOUNDS.maxZ, z)),
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
  // An array is an object to `typeof`, so a save with `"quests": []` used to pass
  // this check and load as a fresh game. It is a corrupt save, not an empty one.
  if (!saved.quests || typeof saved.quests !== 'object' || Array.isArray(saved.quests)) return null;

  const state = createInitialState();
  for (const questId of ALL_QUEST_IDS) {
    const status = saved.quests[questId];
    if (validQuestStatus(questId, status)) state.quests[questId] = status;
  }
  if (Array.isArray(saved.inventory)) {
    for (const id of saved.inventory) {
      if (ITEMS[id] && !state.inventory.includes(id)) state.inventory.push(id);
    }
  }
  if (saved.outcomes && typeof saved.outcomes === 'object') {
    for (const [questId, outcome] of Object.entries(saved.outcomes)) {
      if (QUESTS[questId]?.doneBy?.[outcome]) state.outcomes[questId] = outcome;
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
    // Clamp both ends: a floor of zero alone lets a doctored save carry infinities.
    state.flags.coins = Math.max(0, Math.min(MAX_COINS, Math.floor(state.flags.coins)));
  }
  if (saved.reputation && typeof saved.reputation === 'object') {
    for (const factionId of Object.keys(FACTIONS)) {
      if (Number.isFinite(saved.reputation[factionId])) {
        state.reputation[factionId] = clampReputationSafe(saved.reputation[factionId]);
      }
    }
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
