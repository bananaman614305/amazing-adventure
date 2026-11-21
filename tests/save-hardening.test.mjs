// Save loading is the only place untrusted data enters the game. It already handled
// corrupt, missing and wrong-typed data; these tests cover the one hole left — a
// balance that is finite but absurd — and assert that legitimate play is untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deserialize, serialize, readSave, createInitialState, coins, addCoins,
  MAX_COINS, TOLL_COST, QUEST_ORDER
} from '../src/state.js';
import { runPlaythrough } from '../scripts/playthrough.mjs';

const withCoins = (value) => deserialize(JSON.stringify({ state: { quests: {}, flags: { coins: value } } }));

test('a coin balance is clamped at both ends', () => {
  assert.equal(coins(withCoins(1e308)), MAX_COINS, 'an absurd balance is capped');
  assert.equal(coins(withCoins(1e15)), MAX_COINS);
  assert.equal(coins(withCoins(MAX_COINS + 1)), MAX_COINS);
  assert.equal(coins(withCoins(MAX_COINS)), MAX_COINS, 'the cap itself is allowed');
  assert.equal(coins(withCoins(-50)), 0, 'a negative balance floors at zero');
  assert.equal(coins(withCoins(7)), 7, 'an ordinary balance passes through');
});

test('the cap is far beyond anything a playthrough can reach', () => {
  // If legitimate play could ever hit the cap, clamping would be silently taking
  // coins away from a real player.
  const { state } = runPlaythrough();
  const earned = coins(state);
  assert.ok(earned < MAX_COINS,
    `a finished run ends with ${earned} coins, which must stay under the ${MAX_COINS} cap`);
});

test('a fractional balance is floored, not rounded up', () => {
  assert.equal(coins(withCoins(2.9)), 2);
  assert.equal(coins(withCoins(0.5)), 0);
});

test('a non-numeric balance falls back to the starting purse rather than NaN', () => {
  assert.equal(coins(withCoins('lots')), 6);
  assert.equal(coins(withCoins(null)), 6);
  assert.equal(coins(withCoins(undefined)), 6);
});

test('spending coins still works normally after clamping is in place', () => {
  const state = createInitialState();
  addCoins(state, -TOLL_COST);
  assert.equal(coins(state), 1);
  addCoins(state, -TOLL_COST);
  assert.equal(coins(state), 0, 'a purse cannot go negative by being spent');
});

test('every kind of unusable save is refused rather than half-loaded', () => {
  for (const raw of [null, '', 'null', '{}', 'not json', '[]', '{"state":null}',
    '{"state":{"quests":[]}}', '{"state":{"quests":"nope"}}']) {
    assert.equal(deserialize(raw), null, `${JSON.stringify(raw)} must not load`);
  }
});

test('a save with junk quest values keeps the valid ones and drops the rest', () => {
  const state = deserialize(JSON.stringify({
    state: { quests: { lanterns: 'done', key: 'teleported', bogus: 'done' } }
  }));
  assert.equal(state.quests.lanterns, 'done', 'a real step is kept');
  assert.equal(state.quests.key, 'none', 'an invented step is discarded');
  assert.equal('bogus' in state.quests, false, 'an unknown quest is not added');
});

test('unknown inventory items are dropped rather than trusted', () => {
  const state = deserialize(JSON.stringify({
    state: { quests: {}, inventory: ['lantern_oil', 'excalibur', 'brass_key'] }
  }));
  assert.deepEqual(state.inventory.sort(), ['brass_key', 'lantern_oil']);
});

test('reputation is clamped to the range the game uses', () => {
  const state = deserialize(JSON.stringify({
    state: { quests: {}, reputation: { keepers: 1e9, trade: -1e9, watch: 0 } }
  }));
  assert.ok(state.reputation.keepers <= 100, 'reputation cannot exceed its ceiling');
  assert.ok(state.reputation.trade >= -100, 'reputation cannot fall through its floor');
});

test('a save round-trips through serialise and back unchanged', () => {
  const original = createInitialState();
  original.quests.lanterns = 'done';
  original.quests.key = 'found';
  original.flags.coins = 9;
  original.outcomes.ledger = 'name';
  const restored = deserialize(serialize(original));
  assert.equal(restored.quests.lanterns, 'done');
  assert.equal(restored.quests.key, 'found');
  assert.equal(coins(restored), 9);
  assert.equal(restored.outcomes.ledger, 'name');
});

test('readSave returns both halves for a good save and nothing for a bad one', () => {
  const good = readSave(serialize(createInitialState()));
  assert.ok(good && good.state, 'a good save gives a state');
  assert.equal(readSave('rubbish'), null);
});

test('clamping does not resurrect a finished game as unfinished', () => {
  const state = createInitialState();
  for (const questId of QUEST_ORDER) state.quests[questId] = 'done';
  state.flags.coins = 1e308;
  const restored = deserialize(serialize(state));
  assert.equal(QUEST_ORDER.every((q) => restored.quests[q] === 'done'), true);
  assert.equal(coins(restored), MAX_COINS);
});
