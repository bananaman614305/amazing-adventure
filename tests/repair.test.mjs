// Repairing standing: the repeatable way back out of a refusal.
//
// The properties that matter are (a) it is never a free reputation button, so
// every job must cost something real, (b) it actually lifts the player out of a
// tier that blocks content, and (c) helping one faction is noticed by its rival,
// so the choice of who to work for is a choice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, startKey, pickUpKey, returnKey, REFUSAL_RULES } from '../src/state.js';
import { JOBS, work, canWork, payFor } from '../src/repair.js';
import { reputation, changeReputation, tierFor, npcStanding } from '../src/factions.js';
import { refusalFor } from '../src/refusal.js';
import { startConversation, applyChoice } from '../src/dialogue.js';

test('every job costs something real, so reputation is never free', () => {
  for (const job of Object.values(JOBS)) {
    const cost = job.cost ?? {};
    const paysSomething = Boolean(cost.coins) || Boolean(cost.time);
    assert.equal(paysSomething, true, `${job.id} must cost coins or time`);
  }
});

test('a coin job actually deducts the coins', () => {
  const state = createInitialState();
  const before = state.flags.coins;
  const result = work(state, 'carry');
  assert.equal(result.changed, true);
  assert.equal(state.flags.coins, before - JOBS.carry.cost.coins);
  assert.equal(result.spent, JOBS.carry.cost.coins);
});

test('a job cannot be done without the coins it costs', () => {
  const state = createInitialState();
  state.flags.coins = 0;
  const allowed = canWork(JOBS.carry, state);
  assert.equal(allowed.ok, false);
  assert.match(allowed.reason, /coins/i);
  const result = work(state, 'carry');
  assert.equal(result.changed, false, 'refused without payment');
  assert.equal(reputation(state, 'trade'), 0, 'no standing gained for free');
});

test('a time job reports that it should advance the clock', () => {
  const result = work(createInitialState(), 'sweep');
  assert.equal(result.changed, true);
  assert.equal(result.advanceTime, true, 'the caller must be told to move the clock');
});

test('a coin-only job does not advance the clock', () => {
  const result = work(createInitialState(), 'carry');
  assert.equal(result.advanceTime, false);
});

test('working earns less while the faction dislikes you', () => {
  const neutral = createInitialState();
  const hostile = createInitialState();
  changeReputation(hostile, 'trade', -80);
  assert.ok(payFor(JOBS.carry, hostile) < payFor(JOBS.carry, neutral),
    'the first points out of Hostile are the expensive ones');
});

test('working repeatedly does lift the player out of Hostile', () => {
  const state = createInitialState();
  changeReputation(state, 'trade', -80);
  state.flags.coins = 100;
  assert.equal(tierFor(reputation(state, 'trade')).id, 'hostile');
  let result = null;
  for (let i = 0; i < 40 && tierFor(reputation(state, 'trade')).id === 'hostile'; i += 1) {
    result = work(state, 'carry');
  }
  assert.notEqual(tierFor(reputation(state, 'trade')).id, 'hostile', 'the player climbed out');
  assert.ok(result && result.tierChanged, 'the job that did it says so');
  assert.match(result.note, /see you differently/i);
});

test('the work is not instant: many jobs are needed, not one', () => {
  const state = createInitialState();
  changeReputation(state, 'trade', -80);
  state.flags.coins = 100;
  let jobs = 0;
  while (tierFor(reputation(state, 'trade')).id === 'hostile' && jobs < 100) {
    work(state, 'carry');
    jobs += 1;
  }
  assert.ok(jobs >= 5, `climbing out of Hostile took ${jobs} jobs, which should be more than a couple`);
});

test('helping one faction costs a little with its rival', () => {
  const state = createInitialState();
  work(state, 'sweep'); // Keepers work
  assert.ok(reputation(state, 'keepers') > 0, 'the Keepers gained');
  assert.ok(reputation(state, 'trade') < 0, 'the Market noticed unfavourably');
});

test('a repaired reputation actually reopens refused content', () => {
  const state = createInitialState();
  changeReputation(state, 'trade', -40);
  state.inventory = state.inventory.filter((id) => id !== 'oswin_marker');
  assert.ok(refusalFor(state, 'oswin', REFUSAL_RULES) !== null, 'refused to begin with');
  state.flags.coins = 100;
  for (let i = 0; i < 20 && refusalFor(state, 'oswin', REFUSAL_RULES) !== null; i += 1) {
    work(state, 'carry');
  }
  assert.equal(refusalFor(state, 'oswin', REFUSAL_RULES), null, 'served again after honest work');
});

test('the refusal offers the work menu, so the way back is discoverable', () => {
  const state = createInitialState();
  changeReputation(state, 'trade', -40);
  state.inventory = state.inventory.filter((id) => id !== 'oswin_marker');
  const refusal = startConversation(state, 'oswin');
  const ask = refusal.choices.find((c) => /change your mind/i.test(c.label));
  assert.ok(ask, 'the refusal invites the question');
  const menu = ask.next().choices.find((c) => /show me the work/i.test(c.label));
  assert.ok(menu, 'and offers a way to see the work');
  const jobs = menu.next();
  assert.ok(jobs.choices.some((c) => /Sweep/.test(c.label)), 'the jobs are listed');
  assert.ok(jobs.choices.some((c) => /Leave/.test(c.label)), 'and the player can leave');
});

test('the Watch refusal is reachable in normal play, not dead content', () => {
  // An earlier version lifted Halden's refusal forever once the key quest was
  // done, which made the Watch unable to refuse at all after the first hour.
  const state = createInitialState();
  startKey(state); pickUpKey(state); returnKey(state);
  assert.equal(state.quests.key, 'done', 'the key quest is finished');
  // Return the key drops faction standing far enough that even his personal
  // goodwill cannot keep him above Hostile.
  changeReputation(state, 'watch', -100);
  assert.equal(tierFor(npcStanding(state, 'halden')).id, 'hostile',
    'combined standing is Hostile, not merely Cold');
  assert.ok(refusalFor(state, 'halden', REFUSAL_RULES) !== null,
    'Halden can still refuse after the key quest');
});

test('the Watch rule refuses Hostile but still serves Cold', () => {
  // `required: 'cold'` is the mildest rule in the set: it only turns away a
  // fully Hostile player, unlike Oswin's 'neutral'. Asserted so the two rules
  // cannot silently drift into being the same.
  const state = createInitialState();
  changeReputation(state, 'watch', -40);
  assert.equal(tierFor(npcStanding(state, 'halden')).id, 'cold');
  assert.equal(refusalFor(state, 'halden', REFUSAL_RULES), null, 'Cold is still served');
  changeReputation(state, 'watch', -60);
  assert.equal(tierFor(npcStanding(state, 'halden')).id, 'hostile');
  assert.ok(refusalFor(state, 'halden', REFUSAL_RULES) !== null, 'Hostile is refused');
});

test('a job label names its cost and its reward', () => {
  const state = createInitialState();
  changeReputation(state, 'trade', -40);
  state.inventory = state.inventory.filter((id) => id !== 'oswin_marker');
  const refusal = startConversation(state, 'oswin');
  const ask = refusal.choices.find((c) => /change your mind/i.test(c.label));
  const menu = ask.next().choices.find((c) => /show me the work/i.test(c.label)).next();
  const carry = menu.choices.find((c) => /Carry crates/.test(c.label));
  assert.match(carry.label, /2 coins/, 'the price is stated');
  assert.match(carry.label, /Market \+\d+/, 'the reward is stated');
  assert.equal(/1 coins/.test(carry.label), false, 'no plural after one');
});

test('an unaffordable job stays visible with the reason, rather than vanishing', () => {
  const state = createInitialState();
  changeReputation(state, 'trade', -40);
  state.inventory = state.inventory.filter((id) => id !== 'oswin_marker');
  state.flags.coins = 0;
  const refusal = startConversation(state, 'oswin');
  const ask = refusal.choices.find((c) => /change your mind/i.test(c.label));
  const menu = ask.next().choices.find((c) => /show me the work/i.test(c.label)).next();
  const carry = menu.choices.find((c) => /Carry crates/.test(c.label));
  assert.ok(carry, 'the job is still listed');
  assert.match(carry.label, /need 2 coins/i, 'and explains why it is unavailable');
  const result = carry.do();
  assert.equal(result.changed, false);
});

test('doing a job through the dialogue really moves standing', () => {
  const state = createInitialState();
  changeReputation(state, 'trade', -40);
  state.inventory = state.inventory.filter((id) => id !== 'oswin_marker');
  state.flags.coins = 10;
  const before = reputation(state, 'trade');
  const refusal = startConversation(state, 'oswin');
  const ask = refusal.choices.find((c) => /change your mind/i.test(c.label));
  const menu = ask.next().choices.find((c) => /show me the work/i.test(c.label)).next();
  const carry = menu.choices.find((c) => /Carry crates/.test(c.label));
  const result = applyChoice(state, 'oswin', carry);
  assert.equal(result.changed, true);
  assert.ok(reputation(state, 'trade') > before, 'standing improved through the real dialogue path');
});
