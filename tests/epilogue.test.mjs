// The ending. The properties that matter: it never appears before the story is
// actually finished, it never claims a branch the player did not take, and two
// different playthroughs do not produce the same text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, QUEST_ORDER, QUESTS } from '../src/state.js';
import {
  buildEpilogue, storyComplete, storyProgress, branchLines,
  standingSummary, factionClosers, hasAllOutcomes
} from '../src/epilogue.js';
import { FACTIONS } from '../src/factions.js';

/** A finished game with the given branches and standing. */
function finished(outcomes = {}, reputation = { keepers: 0, trade: 0, watch: 0 }) {
  const state = createInitialState();
  for (const questId of QUEST_ORDER) state.quests[questId] = 'done';
  state.outcomes = outcomes;
  state.reputation = reputation;
  return state;
}

test('there is no ending before the story is finished', () => {
  const fresh = createInitialState();
  assert.equal(storyComplete(fresh), false);
  assert.equal(buildEpilogue(fresh), null, 'a new game has no ending to show');
});

test('one missing quest is enough to withhold the ending', () => {
  const state = createInitialState();
  for (const questId of QUEST_ORDER.slice(1)) state.quests[questId] = 'done';
  assert.equal(storyComplete(state), false);
  assert.equal(buildEpilogue(state), null);
});

test('the ending appears once every quest is done', () => {
  const state = finished();
  assert.equal(storyComplete(state), true);
  const epilogue = buildEpilogue(state);
  assert.ok(epilogue, 'the ending exists');
  assert.equal(typeof epilogue.title, 'string');
  assert.ok(epilogue.opening.length > 40);
  assert.ok(epilogue.closing.length > 40);
});

test('progress counts match the quest list', () => {
  const state = createInitialState();
  assert.deepEqual(storyProgress(state), { done: 0, total: QUEST_ORDER.length, complete: false });
  state.quests.lanterns = 'done';
  assert.equal(storyProgress(state).done, 1);
  for (const questId of QUEST_ORDER) state.quests[questId] = 'done';
  const done = storyProgress(state);
  assert.equal(done.complete, true);
  assert.equal(done.done, done.total);
});

test('branch lines only describe branches that were actually taken', () => {
  const state = finished({ ledger: 'name' });
  const lines = branchLines(state);
  assert.equal(lines.length, 1, 'only the ledger branch was taken');
  assert.match(lines[0].text, /wrote the trader’s name/i);
  assert.equal(/kept the trader’s name out/i.test(lines[0].text), false, 'the other branch is not mentioned');
});

test('the opposite branches produce different text', () => {
  const named = branchLines(finished({ ledger: 'name' }))[0].text;
  const covered = branchLines(finished({ ledger: 'cover' }))[0].text;
  assert.notEqual(named, covered);

  const collected = branchLines(finished({ toll: 'collected' }))[0].text;
  const waived = branchLines(finished({ toll: 'waived' }))[0].text;
  assert.notEqual(collected, waived);

  const paid = branchLines(finished({ arrears: 'pay' }))[0].text;
  const forgiven = branchLines(finished({ arrears: 'forgive' }))[0].text;
  assert.notEqual(paid, forgiven);
});

test('an unknown outcome is ignored rather than invented', () => {
  // A hand-edited save could carry anything; the ending must not repeat it back.
  const lines = branchLines(finished({ ledger: 'teleported', toll: 42, arrears: null }));
  assert.deepEqual(lines, []);
});

test('two full playthroughs end differently', () => {
  const a = buildEpilogue(finished(
    { ledger: 'name', toll: 'collected', arrears: 'pay' },
    { keepers: 50, trade: 10, watch: 60 }
  ));
  const b = buildEpilogue(finished(
    { ledger: 'cover', toll: 'waived', arrears: 'forgive' },
    { keepers: 20, trade: 70, watch: -80 }
  ));
  assert.notDeepEqual(a.branches.map((x) => x.text), b.branches.map((x) => x.text));
  assert.notDeepEqual(a.closers.map((x) => x.text), b.closers.map((x) => x.text),
    'where you stand with people changes the ending too');
});

test('the standing summary names a best and a worst faction', () => {
  const summary = standingSummary(finished({}, { keepers: 10, trade: 70, watch: -40 }));
  assert.equal(summary.best.factionId, 'trade');
  assert.equal(summary.worst.factionId, 'watch');
  assert.equal(summary.all.length, Object.keys(FACTIONS).length);
  assert.equal(summary.best.tier, 'trusted');
  assert.equal(summary.worst.tier, 'cold');
});

test('every faction gets a closer in every tier, so none is ever blank', () => {
  for (const tier of ['hostile', 'cold', 'neutral', 'warm', 'trusted']) {
    const score = { hostile: -90, cold: -40, neutral: 0, warm: 40, trusted: 80 }[tier];
    const closers = factionClosers(finished({}, { keepers: score, trade: score, watch: score }));
    assert.equal(closers.length, Object.keys(FACTIONS).length, `all factions speak at ${tier}`);
    for (const closer of closers) {
      assert.ok(closer.text.length > 10, `${closer.factionId} at ${tier} needs real text`);
      assert.equal(closer.tier, tier);
    }
  }
});

test('the ending is honest about hostility rather than congratulating everyone', () => {
  const hostile = buildEpilogue(finished({}, { keepers: -90, trade: -90, watch: -90 }));
  for (const closer of hostile.closers) {
    assert.match(closer.text, /will not|keeps the fountain|closes as you approach|written your description/i,
      `${closer.factionId} should not sound warm when hostile`);
  }
  const trusted = buildEpilogue(finished({}, { keepers: 90, trade: 90, watch: 90 }));
  for (const closer of trusted.closers) {
    assert.match(closer.text, /lantern to you|sets aside a crate|salutes you/i,
      `${closer.factionId} should feel earned when trusted`);
  }
});

test('the epilogue never describes a quest as unfinished', () => {
  const epilogue = buildEpilogue(finished());
  const text = [
    epilogue.opening, epilogue.closing,
    ...epilogue.branches.map((b) => b.text),
    ...epilogue.closers.map((c) => c.text)
  ].join(' ');
  assert.equal(/need to|still waiting|not yet|find the|go and/i.test(text), false,
    'the ending should not issue instructions');
});

test('branch lines are ordered consistently', () => {
  const lines = branchLines(finished({ ledger: 'name', toll: 'waived', arrears: 'pay' }));
  assert.deepEqual(lines.map((l) => l.questId), ['ledger', 'toll', 'arrears']);
});

test('every branching quest in the game is covered by the epilogue', () => {
  // If a quest gains a branch and the ending does not know about it, the ending
  // would silently omit what the player did.
  const branching = QUEST_ORDER.filter((questId) => QUESTS[questId].doneBy);
  for (const questId of branching) {
    for (const outcome of Object.keys(QUESTS[questId].doneBy)) {
      const lines = branchLines(finished({ [questId]: outcome }));
      assert.equal(lines.length, 1, `${questId}/${outcome} must produce a line`);
    }
  }
});

test('a save with no recorded outcomes admits it instead of omitting the story', () => {
  // A game finished before branches were recorded, or a hand-edited save, has no
  // outcomes. Presenting a shorter ending as the whole story would be a quiet lie.
  const state = createInitialState();
  for (const questId of QUEST_ORDER) state.quests[questId] = 'done';
  assert.equal(hasAllOutcomes(state), false);
  const epilogue = buildEpilogue(state);
  assert.equal(epilogue.branches.length, 0, 'nothing is invented');
  assert.equal(epilogue.branchesUnrecorded, true, 'and the ending says so');
});

test('a fully recorded ending is not flagged as incomplete', () => {
  const state = finished({ ledger: 'name', toll: 'collected', arrears: 'pay' });
  assert.equal(hasAllOutcomes(state), true);
  const epilogue = buildEpilogue(state);
  assert.equal(epilogue.branchesUnrecorded, false);
  assert.equal(epilogue.branches.length, 3);
});
