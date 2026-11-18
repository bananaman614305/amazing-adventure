// Reputation refusals: the half of the standing system that closes doors.
// The most important property tested here is that a refusal never soft-locks
// the player -- it may cost them a shop, but never the only route forward.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, REFUSAL_RULES, startLanterns, startKey, pickUpKey } from '../src/state.js';
import { refusalFor, refusalHint, belowTier, tierRank, standingLabel } from '../src/refusal.js';
import { changeReputation, npcTier } from '../src/factions.js';
import { startConversation, applyChoice } from '../src/dialogue.js';

/** A state whose Market standing is set to a specific score. */
function marketAt(score) {
  const state = createInitialState();
  changeReputation(state, 'trade', score);
  return state;
}

function watchAt(score) {
  const state = createInitialState();
  changeReputation(state, 'watch', score);
  return state;
}

test('the tier order runs hostile to trusted', () => {
  assert.deepEqual(
    ['hostile', 'cold', 'neutral', 'warm', 'trusted'].map(tierRank),
    [0, 1, 2, 3, 4]
  );
  assert.equal(tierRank('nonsense'), -1, 'unknown tiers are not mistakable for real ones');
});

test('belowTier treats required as the lowest tier still served', () => {
  assert.equal(belowTier('hostile', 'neutral'), true);
  assert.equal(belowTier('cold', 'neutral'), true);
  assert.equal(belowTier('neutral', 'neutral'), false, 'exactly at the floor is served');
  assert.equal(belowTier('warm', 'neutral'), false);
  assert.equal(belowTier('anything', 'nonsense'), false, 'unknown ids never refuse');
});

test('a neutral Market is served, a cold one is refused', () => {
  assert.equal(refusalFor(marketAt(0), 'oswin', REFUSAL_RULES), null);
  const cold = refusalFor(marketAt(-40), 'oswin', REFUSAL_RULES);
  assert.ok(cold, 'a cold Market refuses');
  assert.equal(cold.tier, 'cold');
  assert.equal(cold.factionId, 'trade');
  assert.equal(cold.reason, 'Oswin will not deal with you.');
});

test('a rule only applies to the NPCs it names', () => {
  const cold = marketAt(-40);
  assert.ok(refusalFor(cold, 'oswin', REFUSAL_RULES), 'Oswin refuses');
  assert.equal(refusalFor(cold, 'mara', REFUSAL_RULES), null, 'Mara is a different faction');
  assert.equal(refusalFor(cold, 'wren', REFUSAL_RULES), null, 'Wren is not covered by the rule');
});

test('the hint gets more severe the further below the floor the player is', () => {
  const cold = refusalFor(marketAt(-40), 'oswin', REFUSAL_RULES);
  const hostile = refusalFor(marketAt(-80), 'oswin', REFUSAL_RULES);
  assert.match(refusalHint(cold), /wary|goodwill/i);
  assert.match(refusalHint(hostile), /will not deal/i);
  assert.notEqual(refusalHint(cold), refusalHint(hostile));
  assert.equal(refusalHint(null), '', 'no refusal means no hint');
});

test('every rule is escapable by story progress, not only by grinding reputation', () => {
  // Oswin relents once the player holds his marker, so a trader the player has
  // actually helped is never permanently shut out.
  const hostile = marketAt(-80);
  assert.ok(refusalFor(hostile, 'oswin', REFUSAL_RULES) !== null, 'refused while hostile');
  hostile.inventory.push('oswin_marker');
  assert.equal(refusalFor(hostile, 'oswin', REFUSAL_RULES), null, 'the marker lifts it');
});

test('the key carrier can always hand the key back, however the Watch feels', () => {
  // The gate is the only route to the market lane, so this must never be blocked.
  const hostile = watchAt(-80);
  assert.ok(refusalFor(hostile, 'halden', REFUSAL_RULES) !== null, 'refused while hostile');
  startKey(hostile);
  pickUpKey(hostile);
  assert.equal(refusalFor(hostile, 'halden', REFUSAL_RULES), null,
    'holding the brass key exempts the player');
});

test('the lantern oil stays buyable at any standing, because the first quest needs it', () => {
  const hostile = marketAt(-80);
  assert.ok(refusalFor(hostile, 'oswin', REFUSAL_RULES) !== null, 'refused while idle');
  startLanterns(hostile);
  assert.equal(refusalFor(hostile, 'oswin', REFUSAL_RULES), null,
    'starting the oil quest lifts the refusal');
});

test('Oswin actually refuses in dialogue when the Market is cold', () => {
  const cold = marketAt(-40);
  const node = startConversation(cold, 'oswin');
  assert.match(node.text, /nothing for you|goes back to folding/i);
  const labels = node.choices.map((c) => c.label);
  assert.ok(labels.some((l) => /change your mind/i.test(l)),
    'the refusal offers a way to learn what would help');
  assert.ok(labels.some((l) => /leave/i.test(l)));
});

test('the refusal panel explains what would help', () => {
  const cold = marketAt(-40);
  const node = startConversation(cold, 'oswin');
  const ask = node.choices.find((c) => /change your mind/i.test(c.label));
  const answer = ask.next();
  assert.match(answer.text, /help|good turn|turn/i);
});

test('refusal lifts once standing is earned back through play', () => {
  const state = createInitialState();
  // Knock the Market down by waiving the toll, which costs Trade standing.
  changeReputation(state, 'trade', -40);
  assert.ok(refusalFor(state, 'oswin', REFUSAL_RULES) !== null, 'refused to begin with');
  changeReputation(state, 'trade', 40);
  assert.equal(refusalFor(state, 'oswin', REFUSAL_RULES), null, 'served again');
  assert.equal(npcTier(state, 'oswin').id, 'neutral');
});

test('a refused NPC still lets the player leave, so nobody is trapped in a menu', () => {
  const cold = marketAt(-40);
  const node = startConversation(cold, 'oswin');
  const leave = node.choices.find((c) => /leave/i.test(c.label));
  assert.ok(leave, 'a Leave choice is always present');
  assert.equal(leave.end, true);
});

test('standingLabel is readable and signed', () => {
  const cold = marketAt(-40);
  assert.match(standingLabel(cold, 'oswin'), /Cold \(-40\)/);
  assert.match(standingLabel(createInitialState(), 'oswin'), /Neutral \(\+0\)/);
});

test('a refusal never fires on an NPC with no faction or no rule', () => {
  const state = createInitialState();
  assert.equal(refusalFor(state, 'sable', REFUSAL_RULES), null);
  assert.equal(refusalFor(state, 'nobody', REFUSAL_RULES), null);
});

test('every configured rule names real NPCs and real tiers', () => {
  const state = createInitialState();
  for (const rule of REFUSAL_RULES) {
    assert.ok(Array.isArray(rule.npcIds) && rule.npcIds.length > 0, 'a rule must name NPCs');
    for (const npcId of rule.npcIds) {
      assert.ok(state.memory !== undefined);
      assert.notEqual(npcTier(state, npcId), undefined, `${npcId} must resolve to a tier`);
    }
    assert.notEqual(tierRank(rule.required), -1, `${rule.required} must be a real tier`);
    assert.ok(rule.reason, 'a refusal must say something');
  }
});
