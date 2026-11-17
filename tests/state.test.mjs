// Unit tests for the pure game logic: quests, inventory, coins and saves.
// Run with `npm test` (node:test, no dependencies).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialState, questStatus, setQuestStep, advanceQuest,
  startLanterns, buyOilWithCoins, buyOilWithPromise, deliverOil,
  startKey, pickUpKey, returnKey,
  startCheer, watchLanterns, tellPipAboutLanterns,
  addCoins, coins, addItem, hasItem, removeItem, inventoryItems,
  journalEntries, questCounts, remember, memoryFor,
  serialize, deserialize, createSaveStore, SAVE_KEY
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
  assert.match(entries.find((e) => e.id === 'lanterns').text, /lanterns will burn/);
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
