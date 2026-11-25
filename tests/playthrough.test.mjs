// Can the game actually be finished?
//
// Every other suite sets quest state directly, which means a chain could be
// impossible to complete and everything would still pass. These tests play the game
// the way a player does, and one of them caught a genuine soft-lock: paying the
// market toll out of pocket dropped Market standing below Wren's gate, and no
// remaining action in the game could raise it again.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState, questStatus, coins,
  pickUpKey, returnKey, startCheer, watchLanterns, tellPipAboutLanterns,
  startToll, collectToll, waiveToll, finishToll, startLedger, hearLedgerRumour,
  recoverLedger, returnLedger, startArrears, deliverArrears, finishArrears,
  arrearsUnlocked, ledgerUnlocked, QUEST_ORDER, questCounts
} from '../src/state.js';
import { reputation, tierFor } from '../src/factions.js';
import { startConversation, applyChoice } from '../src/dialogue.js';
import { runPlaythrough } from '../scripts/playthrough.mjs';
import { findDeadEnds } from '../scripts/reachability.mjs';
import { storyComplete, buildEpilogue } from '../src/epilogue.js';

function talk(state, npcId, matcher) {
  const node = startConversation(state, npcId);
  assert.ok(node, `no conversation with ${npcId}`);
  const index = node.choices.findIndex((choice) => matcher.test(choice.label));
  assert.notEqual(index, -1,
    `${npcId}: nothing matching ${matcher}; offered ${node.choices.map((c) => c.label).join(' | ')}`);
  return applyChoice(state, npcId, node.choices[index]);
}

/** Play up to the point where the toll is open, by real dialogue. */
function upToToll() {
  const state = createInitialState();
  talk(state, 'mara', /lanterns look low/i);
  talk(state, 'oswin', /lantern oil|Pay \d+ coins/i);
  talk(state, 'mara', /oil/i);
  talk(state, 'halden', /lost something/i);
  assert.equal(pickUpKey(state).changed, true);
  assert.equal(returnKey(state).changed, true);
  talk(state, 'pip', /special about the lanterns/i);
  assert.equal(watchLanterns(state, 'dusk').changed, true);
  assert.equal(tellPipAboutLanterns(state).changed, true);
  return state;
}

test('the whole game can be completed by playing it', () => {
  const { state } = runPlaythrough();
  assert.equal(storyComplete(state), true, 'every quest is done');
  const counts = questCounts(state);
  assert.equal(counts.done, QUEST_ORDER.length);
});

test('the ending is reachable by real play, with branches recorded', () => {
  const { state } = runPlaythrough();
  const epilogue = buildEpilogue(state);
  assert.ok(epilogue, 'the ending exists for a genuinely finished game');
  assert.ok(epilogue.branchesUnrecorded === false, 'real play records every branch choice');
  assert.equal(epilogue.branches.length, 3, 'all three branching quests were resolved');
});

test('paying the market toll does not make the game unwinnable', () => {
  // This is the regression test for the soft-lock. Paying is a legitimate choice
  // the menu offers, so it must not be a trap.
  const state = upToToll();
  assert.equal(startToll(state).changed, true);
  const paid = collectToll(state);
  assert.equal(paid.changed, true, 'the player can afford the toll at this point');
  const tier = tierFor(reputation(state, 'trade')).id;
  assert.equal(ledgerUnlocked(state, tier), true,
    `after paying, Wren must still deal with you (Market was ${reputation(state, 'trade')}, ${tier})`);
});

test('waiving the market toll also keeps the game winnable', () => {
  const state = upToToll();
  startToll(state);
  const waived = waiveToll(state, tierFor(reputation(state, 'watch')).id);
  assert.equal(waived.changed, true, 'the Watch trusts you by now');
  const tier = tierFor(reputation(state, 'trade')).id;
  assert.equal(ledgerUnlocked(state, tier), true, 'waiving keeps Market standing high');
});

test('both toll resolutions can be finished and lead on to the ledger', () => {
  for (const how of ['paid', 'waived']) {
    const state = upToToll();
    startToll(state);
    if (how === 'paid') collectToll(state); else waiveToll(state, tierFor(reputation(state, 'watch')).id);
    const finished = finishToll(state);
    assert.equal(finished.changed, true, `${how}: the toll finished`);
    // The game records the quest step id, which is 'collected' for paying.
    assert.equal(state.outcomes.toll, how === 'paid' ? 'collected' : 'waived',
      `${how}: the branch is recorded`);
    const tier = tierFor(reputation(state, 'trade')).id;
    assert.equal(startLedger(state, tier).changed, true, `${how}: Wren's ledger opens`);
  }
});

test('the ledger can then be recovered and returned', () => {
  const state = upToToll();
  startToll(state);
  collectToll(state);
  finishToll(state);
  assert.equal(startLedger(state, tierFor(reputation(state, 'trade')).id).changed, true);
  assert.equal(hearLedgerRumour(state).changed, true, 'Wren must point you at the barrels');
  assert.equal(recoverLedger(state).changed, true);
  assert.equal(returnLedger(state, 'name').changed, true);
  assert.equal(questStatus(state, 'ledger'), 'done');
});

test('the arrears follow the ledger and can be carried both ways', () => {
  const state = upToToll();
  startToll(state);
  collectToll(state);
  finishToll(state);
  startLedger(state, tierFor(reputation(state, 'trade')).id);
  hearLedgerRumour(state);
  recoverLedger(state);
  returnLedger(state, 'name');
  assert.equal(arrearsUnlocked(state), true);
  assert.equal(startArrears(state).changed, true);
  // "pay" and "forgive" are both offered; a player who pays must not be stranded.
  const delivered = deliverArrears(state, 'pay');
  assert.equal(delivered.changed, true, `paying the arrears failed: ${delivered.message}`);
});

test('no quest can be started out of order', () => {
  // Wren's quest needs the toll settled first, and the arrears need the ledger.
  const fresh = createInitialState();
  assert.equal(ledgerUnlocked(fresh, 'neutral'), false, 'the ledger is gated on trust');
  assert.equal(startArrears(fresh).changed, false, 'the arrears are gated on the ledger');
  assert.equal(startToll(fresh).changed, false, 'the toll is gated on the key');
});

test('playing the game never leaves the player without enough coins to proceed', () => {
  const { state } = runPlaythrough();
  assert.ok(coins(state) >= 0, `coins went negative: ${coins(state)}`);
});

test('every combination of the three branch choices can finish the game', () => {
  // The toll, the ledger and the arrears each have two resolutions. A choice that
  // quietly makes the story impossible is invisible to any test that sets state
  // directly, so all eight paths are played out here.
  for (const tollMode of ['paid', 'waived']) {
    for (const ledgerMode of ['name', 'cover']) {
      for (const arrearsMode of ['pay', 'forgive']) {
        const label = `${tollMode}/${ledgerMode}/${arrearsMode}`;
        const state = upToToll();
        assert.equal(startToll(state).changed, true, `${label}: toll starts`);
        if (tollMode === 'paid') {
          assert.equal(collectToll(state).changed, true, `${label}: can pay`);
        } else {
          assert.equal(waiveToll(state, tierFor(reputation(state, 'watch')).id).changed, true,
            `${label}: can waive`);
        }
        assert.equal(finishToll(state).changed, true, `${label}: toll finishes`);

        assert.equal(startLedger(state, tierFor(reputation(state, 'trade')).id).changed, true,
          `${label}: the ledger is reachable`);
        assert.equal(hearLedgerRumour(state).changed, true, `${label}: rumour heard`);
        assert.equal(recoverLedger(state).changed, true, `${label}: ledger recovered`);
        assert.equal(returnLedger(state, ledgerMode).changed, true, `${label}: ledger returned`);

        assert.equal(startArrears(state).changed, true, `${label}: arrears offered`);
        assert.equal(deliverArrears(state, arrearsMode).changed, true, `${label}: arrears delivered`);
        assert.equal(finishArrears(state).changed, true, `${label}: arrears finished`);

        assert.equal(questStatus(state, 'ledger'), 'done', `${label}: ledger done`);
        assert.equal(questStatus(state, 'arrears'), 'done', `${label}: arrears done`);
      }
    }
  }
});

test('paying the toll records the dues on the book, which is how Wren judges you', () => {
  // The specific mechanism behind the soft-lock fix: paying the toll sets a flag
  // rather than merely moving a reputation number.
  const state = upToToll();
  startToll(state);
  collectToll(state);
  assert.equal(state.flags.dues_paid, true, 'the dues are recorded');
  assert.equal(ledgerUnlocked(state, 'neutral'), true,
    'settled dues are enough for Wren even while the Market is only neutral');
});

test('the ledger is still gated for a player who has done nothing for the lane', () => {
  // The dues shortcut must not become a blanket unlock, or Wren's gate means nothing.
  const fresh = createInitialState();
  assert.equal(ledgerUnlocked(fresh, 'neutral'), false);
});

test('no reachable game state is a dead end, not just the one route I played', () => {
  // Round 17 found a soft-lock by following a single playthrough, and its report
  // noted honestly that only completion was tested, not every path. This is the
  // exhaustive version: breadth-first over every legal action from the start state,
  // then reverse-reachability to find any state that can never finish the story.
  // maxStates is a guard against a runaway graph, not the size of the proof: a
  // capped run stops mid-frontier and reports every unvisited branch as a dead
  // end, which looks like a finding and is only a truncation. So the cap is set
  // above the real graph (~33k states) and the result is checked for truncation
  // before any of its numbers are believed.
  const result = findDeadEnds({ maxStates: 60000 });
  assert.equal(result.truncated, false, 'the search finished; a capped run is not a proof');
  assert.ok(result.explored > 100, `the search actually covered ground, found ${result.explored}`);
  assert.equal(result.startReachable, true, 'the game is winnable from the start');
  if (result.deadEnds.length > 0) {
    const sample = result.deadEnds.slice(0, 3).map((dead) =>
      `${JSON.stringify(dead.quests)} coins=${dead.coins} rep=${JSON.stringify(dead.reputation)}`);
    assert.fail(`${result.deadEnds.length} unreachable-to-completion states, e.g. ${sample.join(' ; ')}`);
  }
});
