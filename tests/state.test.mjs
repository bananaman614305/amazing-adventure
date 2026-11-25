// Unit tests for the pure game logic: quests, inventory, coins and saves.
// Run with `npm test` (node:test, no dependencies).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialState, questStatus, setQuestStep, advanceQuest, startLanterns, buyOilWithCoins, buyOilWithPromise, deliverOil, startKey, pickUpKey, returnKey, startCheer, watchLanterns, tellPipAboutLanterns, addCoins, coins, addItem, hasItem, removeItem, inventoryItems, journalEntries, questCounts, remember, memoryFor, serialize, deserialize, createSaveStore, SAVE_KEY, startToll, collectToll, waiveToll, finishToll, startLedger, hearLedgerRumour, recoverLedger, returnLedger, QUEST_ORDER, CHORE_ORDER, QUESTS,
  startWicks, trimWicks, finishWicks, startTally, walkTally, finishTally, getFlag
} from '../src/state.js';

test('new state starts with no quests and 6 coins', () => {
  const state = createInitialState();
  assert.equal(questStatus(state, 'lanterns'), 'none');
  assert.equal(coins(state), 6);
  assert.deepEqual(inventoryItems(state), []);
  assert.deepEqual(journalEntries(state), []);
  assert.deepEqual(questCounts(state), { active: 0, done: 0 });
});

test('setQuestStep rejects unknown quests', () => {
  const state = createInitialState();
  assert.throws(() => setQuestStep(state, 'nope', 'started'), /unknown quest/);
});

test('advanceQuest only fires from the expected step', () => {
  const state = createInitialState();
  assert.equal(advanceQuest(state, 'key', 'started', 'found'), false);
  assert.equal(questStatus(state, 'key'), 'none');
  setQuestStep(state, 'key', 'started');
  assert.equal(advanceQuest(state, 'key', 'started', 'found'), true);
  assert.equal(questStatus(state, 'key'), 'found');
});

test('lanterns: paying with coins spends 4 and grants oil', () => {
  const state = createInitialState();
  startLanterns(state);
  const result = buyOilWithCoins(state);
  assert.equal(result.changed, true);
  assert.equal(coins(state), 2);
  assert.equal(hasItem(state, 'lantern_oil'), true);
  assert.equal(questStatus(state, 'lanterns'), 'oil_bought');
  assert.equal(state.perks.oswin_debt, undefined);
});

test('lanterns: buying oil twice is rejected', () => {
  const state = createInitialState();
  startLanterns(state);
  buyOilWithCoins(state);
  assert.equal(buyOilWithCoins(state).changed, false);
  assert.equal(coins(state), 2);
});

test('lanterns: the promise branch creates a debt instead of spending coins', () => {
  const state = createInitialState();
  startLanterns(state);
  assert.equal(buyOilWithPromise(state).changed, true);
  assert.equal(coins(state), 6);
  assert.equal(state.perks.oswin_debt, true);
  assert.equal(hasItem(state, 'lantern_oil'), true);
});

test('lanterns: cannot trade before starting the quest', () => {
  const state = createInitialState();
  assert.equal(buyOilWithCoins(state).changed, false);
  assert.equal(buyOilWithPromise(state).changed, false);
  assert.equal(coins(state), 6);
});

test('lanterns: cannot afford oil with too few coins', () => {
  const state = createInitialState();
  startLanterns(state);
  state.flags.coins = 3;
  assert.equal(buyOilWithCoins(state).changed, false);
  assert.equal(hasItem(state, 'lantern_oil'), false);
  assert.equal(questStatus(state, 'lanterns'), 'started');
});

test('lanterns: delivering oil pays 3 coins and grants the promise', () => {
  const state = createInitialState();
  startLanterns(state);
  buyOilWithPromise(state);
  assert.equal(deliverOil(state).changed, true);
  assert.equal(questStatus(state, 'lanterns'), 'done');
  assert.equal(hasItem(state, 'lantern_oil'), false);
  assert.equal(hasItem(state, 'keeper_promise'), true);
  assert.equal(coins(state), 9);
  assert.equal(deliverOil(state).changed, false, 'cannot deliver twice');
});

test('lanterns: cannot deliver without oil', () => {
  const state = createInitialState();
  startLanterns(state);
  assert.equal(deliverOil(state).changed, false);
  assert.equal(questStatus(state, 'lanterns'), 'started');
});

test('key: pickup only while started, return pays a marker', () => {
  const state = createInitialState();
  assert.equal(pickUpKey(state).changed, false);
  startKey(state);
  assert.equal(pickUpKey(state).changed, true);
  assert.equal(hasItem(state, 'brass_key'), true);
  assert.equal(questStatus(state, 'key'), 'found');
  assert.equal(pickUpKey(state).changed, false, 'cannot pick it up twice');
  assert.equal(returnKey(state).changed, true);
  assert.equal(hasItem(state, 'brass_key'), false);
  assert.equal(hasItem(state, 'oswin_marker'), true);
  assert.equal(questStatus(state, 'key'), 'done');
  assert.equal(returnKey(state).changed, false, 'cannot return twice');
});

test('key: returning without the key is rejected', () => {
  const state = createInitialState();
  startKey(state);
  assert.equal(returnKey(state).changed, false);
  setQuestStep(state, 'key', 'found');
  assert.equal(returnKey(state).changed, false);
});

test('cheer: only counts at dusk and only once', () => {
  const state = createInitialState();
  assert.equal(watchLanterns(state, 'dusk').changed, false, 'cannot watch without starting');
  assert.equal(questStatus(state, 'cheer'), 'none');
  startCheer(state);
  assert.equal(watchLanterns(state, 'day').changed, false);
  assert.equal(watchLanterns(state, 'night').changed, false);
  assert.equal(watchLanterns(state, 'dusk').changed, true);
  assert.equal(questStatus(state, 'cheer'), 'watched');
  assert.equal(watchLanterns(state, 'dusk').changed, false);
  assert.equal(tellPipAboutLanterns(state).changed, true);
  assert.equal(hasItem(state, 'pip_ribbon'), true);
  assert.equal(questStatus(state, 'cheer'), 'done');
  assert.equal(tellPipAboutLanterns(state).changed, false);
});

test('coins never go below zero and inventory ignores duplicates', () => {
  const state = createInitialState();
  assert.equal(addCoins(state, -100), 0);
  assert.equal(coins(state), 0);
  assert.equal(addItem(state, 'brass_key'), true);
  assert.equal(addItem(state, 'brass_key'), false);
  assert.equal(removeItem(state, 'brass_key'), true);
  assert.equal(removeItem(state, 'brass_key'), false);
  assert.throws(() => addItem(state, 'sword_of_nothing'), /unknown item/);
});

test('journal and counts track active versus completed quests', () => {
  const state = createInitialState();
  startLanterns(state);
  startKey(state);
  assert.deepEqual(questCounts(state), { active: 2, done: 0 });
  buyOilWithCoins(state);
  deliverOil(state);
  assert.deepEqual(questCounts(state), { active: 1, done: 1 });
  const entries = journalEntries(state);
  assert.equal(entries.length, 2);
  assert.equal(entries.find((e) => e.id === 'lanterns').done, true);
  assert.equal(entries.find((e) => e.id === 'key').done, false);
  assert.match(entries.find((e) => e.id === 'lanterns').text, /lanterns burn all night/);
  // A completed quest must describe the finished state, not an instruction.
  assert.doesNotMatch(entries.find((e) => e.id === 'lanterns').text, /tell|waiting|should|need/i);
});

test('NPC memory counts talks and clamps opinion', () => {
  const state = createInitialState();
  assert.deepEqual(memoryFor(state, 'mara'), { talks: 0, lastTopic: null, opinion: 0 });
  remember(state, 'mara', { topic: 'lanterns', opinionDelta: 2 });
  remember(state, 'mara', { opinionDelta: 2 });
  const memory = memoryFor(state, 'mara');
  assert.equal(memory.talks, 2);
  assert.equal(memory.lastTopic, 'lanterns');
  assert.equal(memory.opinion, 3);
  remember(state, 'mara', { opinionDelta: -10 });
  assert.equal(memoryFor(state, 'mara').opinion, -3);
});

// --- Journal text must match the branch the player actually took -----------

test('a paid toll is never journalled as waived', () => {
  const paid = createInitialState();
  startKey(paid); pickUpKey(paid); returnKey(paid);
  startToll(paid); collectToll(paid); finishToll(paid);
  const text = journalEntries(paid).find((e) => e.id === 'toll').text;
  assert.match(text, /paid/i);
  assert.doesNotMatch(text, /waived|talked Halden into/i,
    'the paid branch must not claim the toll was waived');
});

test('a waived toll is never journalled as paid', () => {
  const waived = createInitialState();
  startKey(waived); pickUpKey(waived); returnKey(waived);
  startToll(waived); waiveToll(waived, 'warm'); finishToll(waived);
  const text = journalEntries(waived).find((e) => e.id === 'toll').text;
  assert.match(text, /waiv/i);
  assert.doesNotMatch(text, /purse/i, 'the waived branch must not claim payment');
});

test('the two ledger endings are journalled differently and truthfully', () => {
  const named = createInitialState();
  startLedger(named, 'warm'); hearLedgerRumour(named); recoverLedger(named); returnLedger(named, 'name');
  const cover = createInitialState();
  startLedger(cover, 'warm'); hearLedgerRumour(cover); recoverLedger(cover); returnLedger(cover, 'cover');
  const namedText = journalEntries(named).find((e) => e.id === 'ledger').text;
  const coverText = journalEntries(cover).find((e) => e.id === 'ledger').text;
  assert.notEqual(namedText, coverText, 'the endings read differently');
  assert.match(namedText, /name/i);
  assert.match(coverText, /kept the trader’s name out/i);
  // Neither should still be telling the player to go and fetch it.
  for (const text of [namedText, coverText]) {
    assert.doesNotMatch(text, /at her stall in the lane\.$/, 'not an unfinished instruction');
  }
});

test('every quest has truthful completion text for each of its endings', () => {
  for (const questId of QUEST_ORDER) {
    const quest = QUESTS[questId];
    const endings = quest.doneBy ? Object.keys(quest.doneBy) : ['default'];
    if (!quest.doneBy) assert.ok(quest.done, `${questId} declares completion text`);
    for (const ending of endings) {
      const text = quest.doneBy ? quest.doneBy[ending] : quest.done;
      assert.ok(text.length > 20, `${questId}/${ending} has a real sentence`);
      assert.match(text, /[.!]$/, `${questId}/${ending} ends cleanly`);
    }
    if (quest.doneBy) {
      const texts = Object.values(quest.doneBy);
      assert.equal(new Set(texts).size, texts.length, `${questId} endings are distinct`);
    }
  }
});

test('outcomes survive a save round-trip and corrupt outcomes are dropped', () => {
  const state = createInitialState();
  startKey(state); pickUpKey(state); returnKey(state);
  startToll(state); collectToll(state); finishToll(state);
  const restored = deserialize(serialize(state));
  assert.equal(restored.outcomes.toll, 'collected');
  assert.match(journalEntries(restored).find((e) => e.id === 'toll').text, /paid/i);

  const corrupt = deserialize(JSON.stringify({
    state: {
      quests: { toll: 'done', ledger: 'done' },
      outcomes: { toll: 'not-a-branch', ledger: 'cover', bogus: 'x' }
    }
  }));
  assert.equal(corrupt.outcomes.toll, undefined, 'an unknown branch is dropped');
  assert.equal(corrupt.outcomes.ledger, 'cover', 'a valid branch is kept');
  assert.equal(corrupt.outcomes.bogus, undefined, 'a branch for an unknown quest is dropped');
});

test('an old save with no recorded outcome still opens a journal entry', () => {
  const legacy = deserialize(JSON.stringify({
    state: { quests: { lanterns: 'done', key: 'none', cheer: 'none', toll: 'none', ledger: 'none' } }
  }));
  const entry = journalEntries(legacy).find((e) => e.id === 'lanterns');
  assert.equal(entry.done, true);
  assert.ok(entry.text.length > 10, 'falls back to a real sentence rather than crashing');
});

test('the chores are tracked outside the spine order, and a save keeps them', () => {
  const state = createInitialState();
  // The spine is the seven quests; the chores are not part of its order.
  assert.equal(QUEST_ORDER.length, 7);
  assert.deepEqual(CHORE_ORDER, ['wicks', 'tally']);
  for (const id of CHORE_ORDER) {
    assert.ok(!QUEST_ORDER.includes(id), `${id} stays outside the spine`);
    assert.equal(questStatus(state, id), 'none', `${id} starts at none`);
  }

  startKey(state); pickUpKey(state); returnKey(state);
  startTally(state); walkTally(state); finishTally(state);
  setQuestStep(state, 'lanterns', 'done');
  startWicks(state); trimWicks(state, 'dusk'); finishWicks(state);

  const restored = deserialize(serialize(state));
  assert.ok(restored, 'the save parses');
  assert.equal(questStatus(restored, 'wicks'), 'done', 'the wick round survives a load');
  assert.equal(questStatus(restored, 'tally'), 'done', 'the tally survives a load');
  assert.equal(getFlag(restored, 'wicksPaid'), true, 'the paid flag survives');
  assert.equal(getFlag(restored, 'tallyPaid'), true, 'the paid flag survives');
  // Both chores are in the journal and counted, on top of the spine.
  assert.match(journalEntries(restored).find((e) => e.id === 'wicks').text, /Mara knows it/);
  assert.match(journalEntries(restored).find((e) => e.id === 'tally').text, /watch stands easier/);
  // done: the key quest (the gate opening) plus the two chores, so three.
  // The lanterns step is set to done directly and counted too, which is why
  // this pins the total rather than re-deriving it.
  assert.equal(questCounts(restored).done, 4);
  assert.deepEqual(questCounts(restored), { active: 0, done: 4 });
});

test('an unknown chore step in a save falls back to none instead of wedging', () => {
  const corrupt = deserialize(JSON.stringify({
    state: { quests: { wicks: 'double-wicked', tally: 'walked' } }
  }));
  assert.equal(questStatus(corrupt, 'wicks'), 'none', 'an unknown step is dropped');
  assert.equal(questStatus(corrupt, 'tally'), 'walked', 'a valid step is kept');
});
