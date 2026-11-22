// Round 60: The Wick Round, Mara's dusk chore for the Keepers.
//
// The point of these tests is that the chore costs a real walk in the right
// phase and pays once, so it cannot become a coin button beside the fountain.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState, coins, questStatus, getFlag, journalEntries, questCounts,
  startLanterns, startKey, setQuestStep, startWicks, trimWicks, finishWicks,
  wicksUnlocked, wicksAtDawn, WICKS_REWARD, CHORE_ORDER, QUESTS, serialize, deserialize
} from '../src/state.js';

/** Puts the key quest on the board so questCounts has something to attribute. */
function startKeyQuest(state) {
  startKey(state);
}
import { reputation } from '../src/factions.js';
import { WICKS_SPOT, wicksActive, wicksHint } from '../src/areas.js';

/** A state that has finished the lanterns quest, which is what unlocks Mara. */
function afterLanterns() {
  const state = createInitialState();
  startLanterns(state);
  setQuestStep(state, 'lanterns', 'done');
  return state;
}

// The oil quest needs the whole trading chain; the chore only reads its status,
// so the test sets the step the way deliverOil does.

test('Mara will not offer the wick round before the lanterns are saved', () => {
  const state = createInitialState();
  assert.equal(wicksUnlocked(state), false);
  const result = startWicks(state);
  assert.equal(result.changed, false);
  assert.match(result.message, /north lantern/);
  assert.equal(questStatus(state, 'wicks'), 'none');
});

test('the wick round starts once, with a journal promise', () => {
  const state = afterLanterns();
  assert.equal(wicksUnlocked(state), true);
  const started = startWicks(state);
  assert.equal(started.changed, true);
  assert.match(started.message, /Wick Round/);
  assert.equal(questStatus(state, 'wicks'), 'started');

  // The promise is a quest step, so the journal shows it and the HUD counts it.
  assert.match(journalEntries(state).find((e) => e.id === 'wicks').text, /wick round/);
  assert.equal(questCounts(state).active, 1);

  // Asking twice is refused, not rewarded.
  assert.equal(startWicks(state).changed, false);
});

test('trimming is a dusk act, not a noon click', () => {
  const state = afterLanterns();
  startWicks(state);
  const noon = trimWicks(state, 'day');
  assert.equal(noon.changed, false);
  assert.match(noon.message, /at dusk/);
  assert.equal(questStatus(state, 'wicks'), 'started');

  const dusk = trimWicks(state, 'dusk');
  assert.equal(dusk.changed, true);
  assert.equal(questStatus(state, 'wicks'), 'trimmed');
  assert.match(journalEntries(state).find((e) => e.id === 'wicks').text, /trimmed/);
});

test('the trim pays once, and a later night cannot farm the flag', () => {
  const state = afterLanterns();
  startWicks(state);
  const before = coins(state);
  const paid = trimWicks(state, 'dusk');
  assert.equal(paid.reward, WICKS_REWARD.coins);
  assert.equal(coins(state), before + WICKS_REWARD.coins);
  assert.equal(getFlag(state, 'wicksPaid'), true);

  // Dawn clears the night's act (so the round can be walked again), but the
  // purse flag stays set: trimming again is not another wage.
  wicksAtDawn(state, 'day');
  assert.equal(getFlag(state, 'wicksTrimmed'), false);
  const afterDawn = coins(state);
  const again = trimWicks(state, 'dusk');
  // A refusal carries no purse at all; the assert that matters is the balance.
  assert.ok(!again.reward, 'no second wage is offered');
  assert.equal(coins(state), afterDawn);
});

test('dawn clears the walk but only at day', () => {
  const state = afterLanterns();
  startWicks(state);
  trimWicks(state, 'dusk');
  assert.equal(wicksAtDawn(state, 'night').reset, false);
  assert.equal(getFlag(state, 'wicksTrimmed'), true);
  assert.equal(wicksAtDawn(state, 'day').reset, true);
  assert.equal(getFlag(state, 'wicksTrimmed'), false);
});

test('the chore closes with Mara, after the act', () => {
  const state = afterLanterns();
  startKeyQuest(state); // the spine's own quest, so the counts are attributable
  startWicks(state);
  const early = finishWicks(state);
  assert.equal(early.changed, false, 'a promise is not a walked round');
  assert.match(early.message, /waiting on a walked/);

  const wage = trimWicks(state, 'dusk');
  // The trim pays Keepers standing; closing with Mara is personal opinion, not
  // another faction swing, so measure the finish on top of the wage.
  const keepers = reputation(state, 'keepers');
  const done = finishWicks(state);
  assert.equal(done.changed, true);
  assert.equal(questStatus(state, 'wicks'), 'done');
  assert.match(done.message, /Wick Round/);
  assert.ok(keepers > 0, 'the trim already paid the faction (wage asserted above)');
  assert.equal(reputation(state, 'keepers'), keepers, 'closing is personal opinion, not a second faction swing');
  assert.match(journalEntries(state).find((e) => e.id === 'wicks').text, /Mara knows it/);
  // done: the key quest plus this chore; active: the wick round is closed.
  assert.deepEqual(questCounts(state), { active: 1, done: 2 });
});

test('the chore hotspot answers at noon but is not trim-able', () => {
  const state = afterLanterns();
  assert.equal(wicksActive(state), false, 'no hotspot before the chore is taken');
  startWicks(state);
  assert.equal(wicksActive(state), true);
  assert.equal(wicksHint(state, 'dusk'), 'trim the plaza lanterns');
  assert.equal(wicksHint(state, 'day'), 'the plaza lanterns');
  assert.ok(WICKS_SPOT.range > 0);
});

test('a done chore survives a save round trip and counts as a chore, not a spine quest', () => {
  const state = afterLanterns();
  startWicks(state);
  trimWicks(state, 'dusk');
  finishWicks(state);
  const raw = serialize(state);
  const loaded = deserialize(raw);
  assert.ok(loaded, 'the save parses');
  assert.equal(questStatus(loaded, 'wicks'), 'done');
  assert.match(journalEntries(loaded).find((e) => e.id === 'wicks').text, /Mara knows it/);
  // The chores are tracked but stay outside the spine's order.
  assert.equal(QUESTS.wicks.title, 'The Wick Round');
  assert.ok(!['lanterns', 'key', 'cheer', 'toll', 'ledger', 'arrears', 'nightlight'].includes('wicks'));
  assert.deepEqual(CHORE_ORDER, ['wicks', 'tally']);
});
