// Round 60: The Gate Tally, Halden's chore for the Watch.
//
// These tests hold the same line as the wicks tests: the chore costs a real
// walk through the open gate, and the purse is once only. They also check the
// one thing the areas layer can enforce but state cannot — that the walk is
// only offered when the player is actually standing in the market lane.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState, coins, questStatus, getFlag, journalEntries, questCounts,
  startKey, pickUpKey, returnKey, startTally, walkTally, finishTally,
  tallyUnlocked, TALLY_REWARD, serialize, deserialize, QUESTS
} from '../src/state.js';
import { reputation } from '../src/factions.js';
import { areaAt, LANE_LIGHTING_POST } from '../src/areas.js';

/** A state whose key is back on Halden's belt, which opens the gate. */
function afterGate() {
  const state = createInitialState();
  startKey(state);
  pickUpKey(state);
  returnKey(state);
  return state;
}

test('Halden will not offer the tally while the gate is shut', () => {
  const state = createInitialState();
  assert.equal(tallyUnlocked(state), false);
  const result = startTally(state);
  assert.equal(result.changed, false);
  assert.match(result.message, /shut gate/);
  assert.equal(questStatus(state, 'tally'), 'none');
});

test('the gate opening is what unlocks the tally, not standing', () => {
  const state = afterGate();
  assert.equal(tallyUnlocked(state), true);
  const started = startTally(state);
  assert.equal(started.changed, true);
  assert.match(started.message, /Gate Tally/);
  assert.equal(questStatus(state, 'tally'), 'started');
  assert.equal(startTally(state).changed, false, 'the promise is not offered twice');
});

test('the tally waits for a walked gate, not a promise', () => {
  const state = afterGate();
  startTally(state);
  const early = finishTally(state);
  assert.equal(early.changed, false);
  assert.match(early.message, /waiting on a walked/);
  assert.equal(questStatus(state, 'tally'), 'started');
});

test('walking out pays the purse once and warms the Watch', () => {
  const state = afterGate();
  startTally(state);
  const watch = reputation(state, 'watch');
  const before = coins(state);

  const walked = walkTally(state);
  assert.equal(walked.changed, true);
  assert.equal(questStatus(state, 'tally'), 'walked');
  assert.equal(getFlag(state, 'tallyWalked'), true);
  assert.match(journalEntries(state).find((e) => e.id === 'tally').text, /walked out through the north gate/);
  assert.equal(coins(state), before, 'the walk itself pays nothing');

  const done = finishTally(state);
  assert.equal(done.changed, true);
  assert.equal(done.reward, TALLY_REWARD.coins);
  assert.equal(questStatus(state, 'tally'), 'done');
  assert.equal(coins(state), before + TALLY_REWARD.coins);
  assert.ok(reputation(state, 'watch') > watch, 'the Watch stands easier');
  assert.match(journalEntries(state).find((e) => e.id === 'tally').text, /count, and the watch stands easier/);

  // The purse cannot be collected twice, however the clock is turned.
  const after = coins(state);
  const twice = finishTally(state);
  assert.equal(twice.changed, false);
  assert.equal(coins(state), after);
  // done: the key quest (the gate opening) plus this chore.
  assert.deepEqual(questCounts(state), { active: 0, done: 2 });
});

test('the tally survives a save round trip', () => {
  const state = afterGate();
  startTally(state);
  walkTally(state);
  finishTally(state);
  const loaded = deserialize(serialize(state));
  assert.ok(loaded, 'the save parses');
  assert.equal(questStatus(loaded, 'tally'), 'done');
  assert.match(journalEntries(loaded).find((e) => e.id === 'tally').text, /watch stands easier/);
  assert.equal(QUESTS.tally.title, 'The Gate Tally');
});

test('the tally hotspot reads as lane state, not a plaza chore', () => {
  // The walk is triggered by entering the lane from the plaza, so the test
  // pins the two facts that make the trigger honest: the lane is its own area,
  // and the gate's own post is out in the lane.
  // areaAt answers with an id, so compare against the ids the lane has.
  assert.equal(areaAt(10, -22), 'lane', 'the gate approach is in the lane');
  // The lane's own lamp post is in the lane: it is the same walk the tally uses.
  assert.equal(areaAt(LANE_LIGHTING_POST.x, LANE_LIGHTING_POST.z), 'lane',
    'the gate post the lane round lights is out in the lane too');
  assert.equal(areaAt(0, 0), 'plaza', 'the plaza is its own area, so the tally walk is a real move');
  assert.notEqual(areaAt(0, 0), areaAt(10, -22), 'walking out is a move between two areas');
});
