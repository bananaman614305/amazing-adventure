// The arrears quest is the first objective that forces travel between the two
// areas in both directions, so its guards matter: you must physically carry the
// pouch south and the mark north, not merely remember having done it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState, startArrears, deliverArrears, finishArrears, arrearsUnlocked,
  reissueArrearsMark,
  questStatus, hasItem, journalEntries, questCounts, coins, serialize, deserialize,
  QUEST_ORDER, QUESTS, ARREARS_REWARD, ITEMS
} from '../src/state.js';
import { reputation } from '../src/factions.js';

/** A state where Wren's ledger is closed, so the arrears are available. */
function afterLedger() {
  const state = createInitialState();
  state.quests.ledger = 'done';
  return state;
}

test('the arrears are locked until the ledger is closed', () => {
  const state = createInitialState();
  assert.equal(arrearsUnlocked(state), false);
  const result = startArrears(state);
  assert.equal(result.changed, false);
  assert.equal(questStatus(state, 'arrears'), 'none');
  assert.equal(hasItem(state, 'arrears_pouch'), false, 'no pouch before the quest starts');
});

test('starting the quest puts the pouch in the pack', () => {
  const state = afterLedger();
  assert.equal(arrearsUnlocked(state), true);
  const result = startArrears(state);
  assert.equal(result.changed, true);
  assert.equal(questStatus(state, 'arrears'), 'started');
  assert.equal(hasItem(state, 'arrears_pouch'), true);
});

test('the quest cannot be started twice', () => {
  const state = afterLedger();
  startArrears(state);
  const again = startArrears(state);
  assert.equal(again.changed, false);
  assert.equal(questStatus(state, 'arrears'), 'started');
});

test('Mara will not take arrears you are not carrying', () => {
  const state = afterLedger();
  startArrears(state);
  // Lose the pouch the way a bad save or a bug might.
  state.inventory = state.inventory.filter((id) => id !== 'arrears_pouch');
  const result = deliverArrears(state, 'pay');
  assert.equal(result.changed, false, 'refused without the item');
  assert.equal(questStatus(state, 'arrears'), 'started', 'still pending');
});

test('paying in full removes the pouch and gives a receipt', () => {
  const state = afterLedger();
  startArrears(state);
  const result = deliverArrears(state, 'pay');
  assert.equal(result.changed, true);
  assert.equal(hasItem(state, 'arrears_pouch'), false, 'the pouch changed hands');
  assert.equal(hasItem(state, 'keeper_receipt'), true);
  assert.equal(hasItem(state, 'keeper_note'), false, 'no note on the paying branch');
  assert.equal(questStatus(state, 'arrears'), 'delivered');
  assert.equal(state.outcomes.arrears, 'pay');
});

test('forgiving the debt gives a note instead of a receipt', () => {
  const state = afterLedger();
  startArrears(state);
  deliverArrears(state, 'forgive');
  assert.equal(hasItem(state, 'keeper_receipt'), false);
  assert.equal(hasItem(state, 'keeper_note'), true);
  assert.equal(state.outcomes.arrears, 'forgive');
});

test('paying pleases the Watch, forgiving costs standing with it', () => {
  const paid = afterLedger();
  startArrears(paid);
  deliverArrears(paid, 'pay');
  const forgiven = afterLedger();
  startArrears(forgiven);
  deliverArrears(forgiven, 'forgive');

  assert.ok(reputation(paid, 'watch') > reputation(forgiven, 'watch'),
    'paying is better for the Watch than forgiving');
  assert.ok(reputation(paid, 'keepers') > 0, 'Mara is grateful either way');
});

test('Wren needs Mara’s mark in hand to close the loop', () => {
  const state = afterLedger();
  startArrears(state);
  deliverArrears(state, 'pay');
  // Mara's receipt goes missing before the walk back.
  state.inventory = state.inventory.filter((id) => id !== 'keeper_receipt');
  const result = finishArrears(state);
  assert.equal(result.changed, false, 'refused without proof');
  assert.equal(questStatus(state, 'arrears'), 'delivered', 'still open');
});

test('finishing pays the reward and clears the carried item', () => {
  const state = afterLedger();
  const before = coins(state);
  startArrears(state);
  deliverArrears(state, 'pay');
  const result = finishArrears(state);
  assert.equal(result.changed, true);
  assert.equal(questStatus(state, 'arrears'), 'done');
  assert.equal(coins(state), before + ARREARS_REWARD);
  assert.equal(hasItem(state, 'keeper_receipt'), false, 'handed over, not kept');
  assert.equal(result.reward, ARREARS_REWARD);
});

test('the forgiving path reaches a different journal ending', () => {
  const pay = afterLedger();
  startArrears(pay); deliverArrears(pay, 'pay'); finishArrears(pay);
  const forgive = afterLedger();
  startArrears(forgive); deliverArrears(forgive, 'forgive'); finishArrears(forgive);

  const payEntry = journalEntries(pay).find((e) => e.id === 'arrears');
  const forgiveEntry = journalEntries(forgive).find((e) => e.id === 'arrears');
  assert.equal(payEntry.done, true);
  assert.equal(forgiveEntry.done, true);
  assert.notEqual(payEntry.text, forgiveEntry.text, 'the journal tells the two endings apart');
  assert.match(payEntry.text, /in full|signed/i);
  assert.match(forgiveEntry.text, /forgave|forgiven/i);
});

test('the journal points at the plaza while the pouch is still carried', () => {
  const state = afterLedger();
  startArrears(state);
  const entry = journalEntries(state).find((e) => e.id === 'arrears');
  assert.equal(entry.done, false);
  assert.match(entry.text, /Mara|plaza/i, 'it says where to go');
});

test('the journal points back north once Mara has settled', () => {
  const state = afterLedger();
  startArrears(state);
  deliverArrears(state, 'pay');
  const entry = journalEntries(state).find((e) => e.id === 'arrears');
  assert.match(entry.text, /Wren|lane/i, 'it says where to go next');
});

test('a lost mark is re-issued, so the quest can never dead-end', () => {
  const state = afterLedger();
  startArrears(state);
  deliverArrears(state, 'pay');
  // The receipt vanishes before the walk back north.
  state.inventory = state.inventory.filter((id) => id !== 'keeper_receipt');
  assert.equal(finishArrears(state).changed, false, 'cannot finish without it');

  const result = reissueArrearsMark(state);
  assert.equal(result.changed, true, 'Mara writes it out again');
  assert.equal(hasItem(state, 'keeper_receipt'), true);
  assert.equal(finishArrears(state).changed, true, 'and now the loop can close');
});

test('re-issuing restores a note on the forgiving branch, not a receipt', () => {
  const state = afterLedger();
  startArrears(state);
  deliverArrears(state, 'forgive');
  state.inventory = state.inventory.filter((id) => id !== 'keeper_note');
  reissueArrearsMark(state);
  assert.equal(hasItem(state, 'keeper_note'), true, 'the note is restored');
  assert.equal(hasItem(state, 'keeper_receipt'), false, 'the wrong item is not invented');
});

test('re-issuing does nothing while the mark is still held', () => {
  const state = afterLedger();
  startArrears(state);
  deliverArrears(state, 'pay');
  assert.equal(reissueArrearsMark(state).changed, false, 'no duplicate receipts');
  assert.equal(state.inventory.filter((id) => id === 'keeper_receipt').length, 1);
});

test('re-issuing is refused before Mara has ever settled the arrears', () => {
  const state = afterLedger();
  startArrears(state);
  assert.equal(reissueArrearsMark(state).changed, false);
  assert.equal(hasItem(state, 'keeper_receipt'), false);
});

test('the quest counts reflect a sixth quest', () => {
  assert.ok(QUEST_ORDER.includes('arrears'));
  assert.ok(QUESTS.arrears.doneBy.pay && QUESTS.arrears.doneBy.forgive);
  const state = afterLedger();
  startArrears(state);
  const counts = questCounts(state);
  assert.equal(counts.active, 1, 'the arrears are the only active quest here');
});

test('every new item is described for the inventory panel', () => {
  for (const id of ['arrears_pouch', 'keeper_receipt', 'keeper_note']) {
    assert.ok(ITEMS[id], `${id} missing from ITEMS`);
    assert.ok(ITEMS[id].name && ITEMS[id].description, `${id} needs a name and description`);
  }
});

test('carrying the pouch survives a save and reload', () => {
  const state = afterLedger();
  startArrears(state);
  const reloaded = deserialize(serialize(state));
  assert.equal(questStatus(reloaded, 'arrears'), 'started');
  assert.equal(hasItem(reloaded, 'arrears_pouch'), true, 'the item is still carried');
  assert.equal(finishArrears(reloaded).changed, false, 'and the loop still needs the walk');
});

test('an unknown arrears step in a save falls back to none', () => {
  const state = afterLedger();
  const raw = JSON.stringify({ state: { ...state, quests: { ...state.quests, arrears: 'teleported' } } });
  const reloaded = deserialize(raw);
  assert.equal(questStatus(reloaded, 'arrears'), 'none');
});
