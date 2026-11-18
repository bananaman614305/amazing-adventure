// Faction and reputation tests: scoring, tiers, NPC standing, and the
// cross-faction consequences of the quests.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FACTIONS, FACTION_IDS, NPC_FACTION, TIERS, createInitialReputation,
  clampReputation, reputation, changeReputation, tierFor, tierName,
  npcStanding, npcTier, atLeast, spreadNews, standingLine, reputationView,
  allStandings
} from '../src/factions.js';

import {
  createInitialState, startLanterns, buyOilWithCoins, buyOilWithPromise,
  deliverOil, startKey, pickUpKey, returnKey, startCheer, watchLanterns,
  tellPipAboutLanterns, startToll, collectToll, waiveToll, finishToll,
  questStatus, coins, TOLL_COST, serialize, deserialize
} from '../src/state.js';
import { DIALOGUE } from '../src/dialogue.js';
const NPC_IDS = Object.keys(DIALOGUE);

const fresh = () => ({ reputation: createInitialReputation(), memory: {} });

// --- Scoring and tiers ----------------------------------------------------

test('reputation starts neutral for every faction', () => {
  const state = fresh();
  for (const id of FACTION_IDS) assert.equal(reputation(state, id), 0);
  assert.equal(tierName(0), 'Neutral');
});

test('reputation clamps to the allowed range', () => {
  assert.equal(clampReputation(500), 100);
  assert.equal(clampReputation(-500), -100);
  assert.equal(clampReputation('12'), 12);
  assert.equal(clampReputation(NaN), 0);
  assert.equal(clampReputation(undefined), 0);
  const state = fresh();
  assert.equal(changeReputation(state, 'keepers', 500), 100);
  assert.equal(reputation(state, 'keepers'), 100);
  assert.equal(changeReputation(state, 'keepers', 50), 0, 'no change at the cap');
});

test('changeReputation reports the delta actually applied', () => {
  const state = fresh();
  assert.equal(changeReputation(state, 'trade', 30), 30);
  assert.equal(changeReputation(state, 'trade', -10), -10);
  assert.equal(changeReputation(state, 'trade', 0), 0);
});

test('unknown factions do not silently change anything', () => {
  const state = fresh();
  assert.equal(reputation(state, 'nobody'), 0);
  assert.throws(() => changeReputation(state, 'nobody', 10), /unknown faction/);
});

test('tier boundaries are exclusive and cover the range', () => {
  assert.equal(tierName(-100), 'Hostile');
  assert.equal(tierName(-60), 'Hostile');
  assert.equal(tierName(-59), 'Cold');
  assert.equal(tierName(-25), 'Cold');
  assert.equal(tierName(-24), 'Neutral');
  assert.equal(tierName(24), 'Neutral');
  assert.equal(tierName(25), 'Warm');
  assert.equal(tierName(59), 'Warm');
  assert.equal(tierName(60), 'Trusted');
  assert.equal(tierName(100), 'Trusted');
  for (let score = -100; score <= 100; score += 1) {
    assert.ok(TIERS.some((tier) => score >= tier.min && score <= tier.max), `no tier for ${score}`);
  }
});

test('every NPC maps to a real faction', () => {
  for (const [npcId, factionId] of Object.entries(NPC_FACTION)) {
    assert.ok(FACTIONS[factionId], `${npcId} has a real faction`);
  }
});

// --- NPC standing ---------------------------------------------------------

test('personal opinion moves NPC standing on top of faction score', () => {
  const state = fresh();
  changeReputation(state, 'keepers', 20);
  assert.equal(npcStanding(state, 'mara'), 20);
  state.memory.mara = { opinion: 2, talks: 1, lastTopic: null };
  assert.equal(npcStanding(state, 'mara'), 40, '+2 opinion is worth 20 points');
  state.memory.mara = { opinion: -3, talks: 1, lastTopic: null };
  assert.equal(npcStanding(state, 'mara'), -10);
});

test('npcStanding clamps and unknown NPCs read as faction-neutral', () => {
  const state = fresh();
  state.memory.mara = { opinion: 3, talks: 1, lastTopic: null };
  changeReputation(state, 'keepers', 100);
  assert.equal(npcStanding(state, 'mara'), 100, 'clamped at the cap');
  assert.equal(npcStanding(state, 'nobody'), 0);
});

test('atLeast compares tiers', () => {
  const state = fresh();
  assert.equal(atLeast(state, 'halden', 'neutral'), true);
  assert.equal(atLeast(state, 'halden', 'warm'), false);
  changeReputation(state, 'watch', 30);
  assert.equal(atLeast(state, 'halden', 'warm'), true);
  assert.equal(atLeast(state, 'halden', 'trusted'), false);
  assert.equal(atLeast(state, 'halden', 'nonsense'), false);
});

test('spreadNews applies rival reactions', () => {
  const state = fresh();
  const results = spreadNews(state, { factionId: 'watch', delta: 20, rivals: [{ id: 'trade', delta: -15 }] });
  assert.deepEqual(results, [{ factionId: 'watch', delta: 20 }, { factionId: 'trade', delta: -15 }]);
  assert.equal(reputation(state, 'watch'), 20);
  assert.equal(reputation(state, 'trade'), -15);
});

test('standing lines and the HUD view are complete', () => {
  const state = fresh();
  const view = reputationView(state);
  assert.equal(view.length, 3);
  for (const faction of view) {
    assert.ok(faction.name && faction.tierName);
    assert.ok(standingLine(state, faction.id).length > 5);
  }
  assert.equal(allStandings(state).mara.tier, 'neutral');
});

// --- Quest consequences ---------------------------------------------------

test('paying Oswin warms the Keepers and the Market', () => {
  const state = createInitialState();
  startLanterns(state);
  buyOilWithCoins(state);
  deliverOil(state);
  assert.equal(reputation(state, 'keepers'), 20);
  assert.equal(reputation(state, 'trade'), 10);
});

test('promising Oswin warms the Keepers but cools the Market', () => {
  const state = createInitialState();
  startLanterns(state);
  buyOilWithPromise(state);
  const result = deliverOil(state);
  assert.equal(reputation(state, 'keepers'), 20);
  assert.equal(reputation(state, 'trade'), -10);
  assert.equal(state.perks.oswin_debt, true);
  assert.match(result.message, /Keepers \+20/);
  assert.match(result.message, /Market -10/);
  assert.match(result.message, /Oswin still holds your promise/);
});

test('returning the key warms the Watch and repairs the Market', () => {
  const state = createInitialState();
  startLanterns(state);
  buyOilWithPromise(state);
  deliverOil(state);
  const before = reputation(state, 'trade');
  startKey(state);
  pickUpKey(state);
  returnKey(state);
  assert.equal(reputation(state, 'watch'), 25);
  assert.ok(reputation(state, 'trade') > before, 'the guard vouch helps with the Market');
  assert.equal(state.perks.oswin_debt, false, 'the vouch clears the debt');
});

test('Pip’s favour earns Market standing', () => {
  const state = createInitialState();
  startCheer(state);
  watchLanterns(state, 'dusk');
  tellPipAboutLanterns(state);
  assert.equal(reputation(state, 'trade'), 10);
});

// --- The Market Toll ------------------------------------------------------

function keyDone() {
  const state = createInitialState();
  startKey(state);
  pickUpKey(state);
  returnKey(state);
  return state;
}

test('the toll quest is gated behind returning the key', () => {
  const state = createInitialState();
  const blocked = startToll(state);
  assert.equal(blocked.changed, false);
  assert.equal(questStatus(state, 'toll'), 'none');
  const ready = keyDone();
  assert.equal(startToll(ready).changed, true);
  assert.equal(questStatus(ready, 'toll'), 'started');
  assert.equal(startToll(ready).changed, false, 'cannot start twice');
});

test('collecting the toll pleases the Watch and angers the Market', () => {
  const state = keyDone();
  startToll(state);
  const before = coins(state);
  const result = collectToll(state);
  assert.equal(result.changed, true);
  assert.equal(coins(state), before - TOLL_COST);
  assert.equal(reputation(state, 'watch'), 45);
  assert.equal(reputation(state, 'trade'), -10);
  assert.equal(questStatus(state, 'toll'), 'collected');
  assert.equal(finishToll(state).changed, true);
  assert.equal(questStatus(state, 'toll'), 'done');
});

test('collecting the toll needs enough coins', () => {
  const state = keyDone();
  startToll(state);
  state.flags.coins = TOLL_COST - 1;
  const result = collectToll(state);
  assert.equal(result.changed, false);
  assert.equal(questStatus(state, 'toll'), 'started');
  assert.equal(reputation(state, 'watch'), 25, 'unchanged');
});

test('waiving the toll needs Halden to trust you', () => {
  const state = keyDone();
  startToll(state);
  const refused = waiveToll(state, 'neutral');
  assert.equal(refused.changed, false);
  assert.match(refused.message, /trust you more/);
  assert.equal(questStatus(state, 'toll'), 'started');
  const accepted = waiveToll(state, 'warm');
  assert.equal(accepted.changed, true);
  assert.equal(questStatus(state, 'toll'), 'waived');
  assert.equal(state.perks.oswin_favour, true);
});

test('waiving pleases the Market at the Watch’s expense', () => {
  const state = keyDone();
  startToll(state);
  waiveToll(state, 'warm');
  assert.equal(reputation(state, 'trade'), 25);
  assert.equal(reputation(state, 'watch'), 15);
});

test('the two toll resolutions are mutually exclusive', () => {
  const paid = keyDone();
  startToll(paid);
  collectToll(paid);
  assert.equal(waiveToll(paid, 'trusted').changed, false, 'cannot waive after collecting');

  const waived = keyDone();
  startToll(waived);
  waiveToll(waived, 'warm');
  assert.equal(collectToll(waived).changed, false, 'cannot collect after waiving');
});

test('finishing the toll early is refused', () => {
  const state = keyDone();
  startToll(state);
  assert.equal(finishToll(state).changed, false);
  assert.equal(questStatus(state, 'toll'), 'started');
});

// --- Reputation changes what NPCs say -------------------------------------

test('NPC greetings change with faction standing, with correct grammar', async () => {
  const { startConversation } = await import('../src/dialogue.js');
  const cases = [
    { npc: 'mara', faction: 'keepers', neutral: true },
    { npc: 'oswin', faction: 'trade', neutral: true },
    { npc: 'halden', faction: 'watch', neutral: true }
  ];
  for (const { npc, faction } of cases) {
    const neutralState = createInitialState();
    const neutralLine = startConversation(neutralState, npc).text;
    // Neutral standing must not append any standing commentary.
    assert.equal(/saying good things|careful around you|heard of you|nobody questions/.test(neutralLine), false,
      `${npc} neutral line should be plain`);

    const warmState = createInitialState();
    changeReputation(warmState, faction, 30);
    const warmLine = startConversation(warmState, npc).text;
    assert.match(warmLine, /saying good things about you/);
    assert.equal(/\bThe (keepers|market|watch) are saying/.test(warmLine), false, 'no lowercase proper noun');
    assert.equal(/TheThe|TheThe |\wThe\w/.test(warmLine), false, 'no missing space');

    const coldState = createInitialState();
    changeReputation(coldState, faction, -40);
    const coldLine = startConversation(coldState, npc).text;
    assert.match(coldLine, /careful around you/);
    assert.match(coldLine, /\bthe (keepers|market|watch) have been careful/, 'plural verb after collective');

    const hostileState = createInitialState();
    changeReputation(hostileState, faction, -90);
    const hostileLine = startConversation(hostileState, npc).text;
    assert.match(hostileLine, /Every (Keeper|trader|guard) in this plaza/);
    assert.match(hostileLine, /none of it is kind/);

    const trustedState = createInitialState();
    changeReputation(trustedState, faction, 70);
    const trustedLine = startConversation(trustedState, npc).text;
    assert.match(trustedLine, /for the (keepers|market|watch) that nobody questions you now/);
    assert.equal(/for The /.test(trustedLine), false, 'no capitalised article mid-sentence');
  }
});

test('every faction exposes the name forms the dialogue needs', () => {
  for (const faction of Object.values(FACTIONS)) {
    assert.ok(faction.name.startsWith('The '), `${faction.id} has a proper name`);
    assert.ok(faction.member && faction.member.length > 2, `${faction.id} has a singular member noun`);
    assert.ok(faction.collective && faction.collective.length > 3, `${faction.id} has a collective noun`);
    assert.equal(faction.collective[0], faction.collective[0].toLowerCase());
  }
});

// --- Save/load of reputation ----------------------------------------------

test('reputation survives a save round-trip', () => {
  const state = createInitialState();
  startLanterns(state);
  buyOilWithPromise(state);
  deliverOil(state);
  changeReputation(state, 'watch', 55);
  const restored = deserialize(serialize(state));
  assert.equal(reputation(restored, 'keepers'), 20);
  assert.equal(reputation(restored, 'trade'), -10);
  assert.equal(reputation(restored, 'watch'), 55);
});

test('corrupt reputation in a save is sanitised, not trusted', () => {
  const raw = JSON.stringify({
    state: {
      quests: { lanterns: 'none', key: 'none', cheer: 'none', toll: 'none' },
      reputation: { keepers: 9999, trade: 'lots', watch: -9999, bogus: 50 }
    }
  });
  const restored = deserialize(raw);
  assert.equal(reputation(restored, 'keepers'), 100, 'clamped down');
  assert.equal(reputation(restored, 'trade'), 0, 'non-numeric ignored');
  assert.equal(reputation(restored, 'watch'), -100, 'clamped up');
  assert.equal(restored.reputation.bogus, undefined, 'unknown factions dropped');
});

test('a save without reputation starts everyone neutral', () => {
  const raw = JSON.stringify({
    state: { quests: { lanterns: 'none', key: 'none', cheer: 'none', toll: 'none' } }
  });
  const restored = deserialize(raw);
  for (const id of FACTION_IDS) assert.equal(reputation(restored, id), 0);
});

// --- Every NPC must belong to a faction -----------------------------------

test('every NPC in the cast has a faction, so standing can move', () => {
  const missing = NPC_IDS.filter((id) => !NPC_FACTION[id]);
  assert.deepEqual(missing, [], `NPCs with no faction: ${missing.join(', ')}`);
  for (const id of NPC_IDS) {
    assert.ok(FACTION_IDS.includes(NPC_FACTION[id]), `${id} has a known faction`);
  }
});

test('Wren follows Market standing, like the other traders', () => {
  const state = createInitialState();
  assert.equal(npcTier(state, 'wren').id, 'neutral');
  changeReputation(state, 'trade', 30);
  assert.equal(npcTier(state, 'wren').id, 'warm', 'Market standing carries to Wren');
  changeReputation(state, 'trade', -80);
  assert.equal(npcTier(state, 'wren').id, 'cold');
});
