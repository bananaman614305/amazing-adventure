// Dialogue tests: every NPC, every quest state, every reachable choice.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialState, questStatus, startLanterns, buyOilWithCoins,
  buyOilWithPromise, deliverOil, startKey, pickUpKey, returnKey,
  startCheer, watchLanterns, tellPipAboutLanterns,
  startToll, collectToll, waiveToll, finishToll,
  hasItem, coins, addCoins, startWicks, trimWicks, finishWicks, startTally, walkTally, finishTally,
  setQuestStep
} from '../src/state.js';
import { startConversation, applyChoice, DIALOGUE } from '../src/dialogue.js';

const npcIds = Object.keys(DIALOGUE);

test('every NPC opens with a node that has at least one labelled choice', () => {
  for (const npcId of npcIds) {
    const node = startConversation(createInitialState(), npcId);
    assert.ok(node, `${npcId} has an opening node`);
    assert.ok(node.speaker && node.speaker.length > 0, `${npcId} names its speaker`);
    assert.ok(node.text.length > 10, `${npcId} says something real`);
    assert.ok(Array.isArray(node.choices) && node.choices.length > 0, `${npcId} offers choices`);
    for (const choice of node.choices) {
      assert.equal(typeof choice.label, 'string');
      assert.ok(choice.label.length > 0);
    }
  }
  assert.equal(startConversation(createInitialState(), 'nobody'), null);
});

test('the cast includes six distinct NPCs with unique ids', () => {
  assert.equal(npcIds.length, 6);
  const speakers = new Set(npcIds.map((id) => DIALOGUE[id].name));
  assert.equal(speakers.size, 6);
});

test('Wren refuses her quest until the Market trusts you', () => {
  const state = createInitialState();
  const open = startConversation(state, 'wren');
  assert.match(open.text, /Market business is for people the Market trusts/);
  const ask = open.choices.find((c) => /look for it/i.test(c.label));
  assert.equal(ask, undefined, 'no quest offer at neutral standing');
  assert.equal(questStatus(state, 'ledger'), 'none');
  // Asking what would earn trust must not start the quest either.
  const advice = open.choices.find((c) => /earn that trust/i.test(c.label));
  assert.ok(advice);
  const adviceNode = advice.next();
  assert.match(adviceNode.text, /Dues paid/);
  assert.equal(questStatus(state, 'ledger'), 'none');
});

test('Mara → Oswin → Mara completes the lantern quest', () => {
  const state = createInitialState();
  const maraOpen = startConversation(state, 'mara');
  const askChoice = maraOpen.choices.find((c) => c.label.includes('lanterns'));
  assert.ok(askChoice, 'Mara offers the lantern hook');
  assert.equal(applyChoice(state, 'mara', askChoice).changed, true);
  assert.equal(questStatus(state, 'lanterns'), 'started');

  const oswinOpen = startConversation(state, 'oswin');
  assert.match(oswinOpen.text, /Four coins/);
  const promise = oswinOpen.choices.find((c) => c.label.includes('owe you'));
  assert.equal(applyChoice(state, 'oswin', promise).changed, true);
  assert.equal(hasItem(state, 'lantern_oil'), true);
  assert.equal(state.perks.oswin_debt, true);

  const maraReturn = startConversation(state, 'mara');
  assert.match(maraReturn.text, /Hand it over/);
  const deliver = maraReturn.choices.find((c) => c.label.includes('oil'));
  assert.equal(applyChoice(state, 'mara', deliver).changed, true);
  assert.equal(questStatus(state, 'lanterns'), 'done');
  assert.equal(hasItem(state, 'keeper_promise'), true);
});

test('the coins branch of the oil trade actually spends coins', () => {
  const state = createInitialState();
  startLanterns(state);
  const open = startConversation(state, 'oswin');
  const pay = open.choices.find((c) => c.label.includes('Pay 4 coins'));
  assert.ok(pay);
  applyChoice(state, 'oswin', pay);
  assert.equal(coins(state), 2);
  assert.equal(state.perks.oswin_debt, undefined);
});

test('the oil trade is not offered before the quest starts', () => {
  const state = createInitialState();
  const open = startConversation(state, 'oswin');
  assert.equal(open.choices.some((c) => c.label.includes('Pay 4 coins')), false);
});

test('Oswin only offers the debt branch when his ledger has your name', () => {
  const state = createInitialState();
  startLanterns(state);
  buyOilWithPromise(state);
  const withDebt = startConversation(state, 'oswin');
  const settle = withDebt.choices.find((c) => c.label.includes('Settle'));
  assert.ok(settle, 'settle option appears while owed');
  const result = applyChoice(state, 'oswin', settle);
  assert.equal(result.changed, true);
  assert.equal(state.perks.oswin_debt, false);
  assert.equal(coins(state), 2, '6 starting coins minus the 4-coin debt');
  assert.equal(startConversation(state, 'oswin').choices.some((c) => c.label.includes('Settle')), false);
});

test('paying upfront leaves no debt for Mara to mention', () => {
  const state = createInitialState();
  startLanterns(state);
  buyOilWithCoins(state);
  const maraNode = startConversation(state, 'mara');
  assert.match(maraNode.text, /Hand it over/);
  // Complete it, then ask Mara about Oswin.
  applyChoice(state, 'mara', maraNode.choices[0]);
  const after = startConversation(state, 'mara');
  const oswinTalk = after.choices.find((c) => c.label.includes('Oswin'));
  assert.match(oswinTalk.next().text, /never lets a favour go/);
});

test('Halden gives the key quest and accepts the key back', () => {
  const state = createInitialState();
  const open = startConversation(state, 'halden');
  const lost = open.choices.find((c) => c.label.includes('lost'));
  assert.equal(applyChoice(state, 'halden', lost).changed, true);
  assert.equal(questStatus(state, 'key'), 'started');

  pickUpKey(state);
  const withKey = startConversation(state, 'halden');
  assert.match(withKey.text, /That is my key/);
  const hand = withKey.choices.find((c) => c.label.includes('Here it is'));
  assert.equal(applyChoice(state, 'halden', hand).changed, true);
  assert.equal(questStatus(state, 'key'), 'done');
  assert.equal(hasItem(state, 'oswin_marker'), true);
});

test('Halden will not take the key before it is found', () => {
  const state = createInitialState();
  startKey(state);
  const open = startConversation(state, 'halden');
  assert.equal(open.choices.some((c) => c.label.includes('Here it is')), false);
});

test('Pip gives the dusk quest and pays out after the watch', () => {
  const state = createInitialState();
  const open = startConversation(state, 'pip');
  const special = open.choices.find((c) => c.label.includes('special'));
  assert.equal(applyChoice(state, 'pip', special).changed, true);
  assert.equal(questStatus(state, 'cheer'), 'started');

  watchLanterns(state, 'dusk');
  const back = startConversation(state, 'pip');
  assert.match(back.text, /Did you see it/);
  const tell = back.choices.find((c) => c.label.includes('I did'));
  assert.equal(applyChoice(state, 'pip', tell).changed, true);
  assert.equal(questStatus(state, 'cheer'), 'done');
  assert.equal(hasItem(state, 'pip_ribbon'), true);
});

test('Pip will not pay out before the watch happens', () => {
  const state = createInitialState();
  startCheer(state);
  const open = startConversation(state, 'pip');
  assert.equal(open.choices.some((c) => c.label.includes('I did')), false);
});

test('Sable exists and reacts to what the player has done', () => {
  const state = createInitialState();
  const open = startConversation(state, 'sable');
  assert.ok(open.text.length > 10);
  startLanterns(state);
  startKey(state);
  const after = startConversation(state, 'sable');
  assert.notEqual(after.text, open.text);
});

// --- The exhaustive sweep -------------------------------------------------

// Quest states worth testing: every NPC must produce a sane node in each.
const STATES = [
  ['fresh', (s) => {}],
  ['lanterns started', startLanterns],
  ['oil paid', (s) => { startLanterns(s); buyOilWithCoins(s); }],
  ['oil promised', (s) => { startLanterns(s); buyOilWithPromise(s); }],
  ['key started', startKey],
  ['key found', (s) => { startKey(s); pickUpKey(s); }],
  ['cheer started', startCheer],
  ['cheer watched', (s) => { startCheer(s); watchLanterns(s, 'dusk'); }],
  ['key returned', (s) => { startKey(s); pickUpKey(s); returnKey(s); }],
  ['toll started', (s) => { startKey(s); pickUpKey(s); returnKey(s); startToll(s); }],
  ['toll collected', (s) => {
    startKey(s); pickUpKey(s); returnKey(s); startToll(s); collectToll(s);
  }],
  ['toll waived', (s) => {
    startKey(s); pickUpKey(s); returnKey(s); startToll(s); waiveToll(s, 'warm');
  }],
  ['everything', (s) => {
    startLanterns(s); buyOilWithPromise(s); deliverOil(s);
    startKey(s); pickUpKey(s); returnKey(s);
    startCheer(s); watchLanterns(s, 'dusk'); tellPipAboutLanterns(s);
    startToll(s); waiveToll(s, 'warm'); finishToll(s);
  }]
];

test('every reachable dialogue node in every quest state is well formed', () => {
  let nodes = 0;
  for (const [label, seed] of STATES) {
    for (const npcId of npcIds) {
      const state = createInitialState();
      seed(state);
      const open = startConversation(state, npcId);
      const queue = [open];
      const seen = new Set();
      while (queue.length) {
        const node = queue.shift();
        if (!node || seen.has(node)) continue;
        seen.add(node);
        nodes += 1;
        assert.equal(typeof node.text, 'string', `${label}/${npcId}: text is a string`);
        assert.ok(node.text.trim().length > 0, `${label}/${npcId}: text is not empty`);
        for (const choice of node.choices || []) {
          assert.equal(typeof choice.label, 'string');
          const next = typeof choice.next === 'function' ? choice.next() : choice.next;
          if (next) queue.push(next);
        }
      }
    }
  }
  assert.ok(nodes > 100, `walked ${nodes} dialogue nodes`);
});

test('applying every choice in every state never throws or corrupts state', () => {
  for (const [label, seed] of STATES) {
    for (const npcId of npcIds) {
      for (const index of [0, 1, 2, 3]) {
        const state = createInitialState();
        seed(state);
        const open = startConversation(state, npcId);
        const choice = open.choices?.[index];
        if (!choice) continue;
        assert.doesNotThrow(() => applyChoice(state, npcId, choice), `${label}/${npcId}#${index}`);
        // The state must always stay loadable.
        const parsed = JSON.parse(JSON.stringify(state));
        assert.ok(parsed.quests, `${label}/${npcId}#${index} keeps quests`);
        for (const value of Object.values(state.quests)) {
          assert.ok(['none', 'done', 'started', 'oil_bought', 'found', 'watched',
            'collected', 'waived', 'delivered', 'walked'].includes(value),
            `${label}/${npcId}#${index} keeps valid quest steps (saw ${value})`);
        }
      }
    }
  }
});

test('choice actions report a changed flag and a message when they do something', () => {
  const state = createInitialState();
  const open = startConversation(state, 'mara');
  const result = applyChoice(state, 'mara', open.choices[0]);
  assert.equal(result.changed, true);
  assert.match(result.message, /Quest started/);
});

test('Mara offers the wick round in the dialogue once the lanterns are saved', () => {
  const state = createInitialState();
  startKey(state); pickUpKey(state); returnKey(state);
  setQuestStep(state, 'lanterns', 'done');
  const open = startConversation(state, 'mara');
  const labels = open.choices.map((c) => c.label);
  assert.ok(labels.some((l) => /else need doing/.test(l)), 'Mara offers the extra work: ' + labels.join(' | '));
  applyChoice(state, 'mara', open.choices.find((c) => /else need doing/.test(c.label)));
  assert.equal(questStatus(state, 'wicks'), 'started', 'the choice takes the chore');

  // The walk is not a dialogue button; the hotspot does it, then Mara closes it.
  trimWicks(state, 'dusk');
  const again = startConversation(state, 'mara');
  const finish = again.choices.find((c) => /wick round is walked/.test(c.label));
  assert.ok(finish, 'Mara offers to close a walked round');
  applyChoice(state, 'mara', finish);
  assert.equal(questStatus(state, 'wicks'), 'done');
});

test('Halden offers the gate tally in the dialogue once the gate is open', () => {
  const state = createInitialState();
  startKey(state); pickUpKey(state); returnKey(state);
  const open = startConversation(state, 'halden');
  const labels = open.choices.map((c) => c.label);
  assert.ok(labels.some((l) => /else need doing/.test(l)), 'Halden offers the extra work: ' + labels.join(' | '));
  applyChoice(state, 'halden', open.choices.find((c) => /else need doing/.test(c.label)));
  assert.equal(questStatus(state, 'tally'), 'started', 'the choice takes the chore');

  walkTally(state);
  const again = startConversation(state, 'halden');
  const finish = again.choices.find((c) => /tally is walked/.test(c.label));
  assert.ok(finish, 'Halden offers to close a walked tally');
  applyChoice(state, 'halden', finish);
  assert.equal(questStatus(state, 'tally'), 'done');
});

test('neither chore is offered before its gate opens', () => {
  const state = createInitialState();
  const mara = startConversation(state, 'mara');
  assert.ok(!mara.choices.some((c) => /else need doing/.test(c.label)), 'Mara waits for the lanterns');
  const halden = startConversation(state, 'halden');
  assert.ok(!halden.choices.some((c) => /else need doing/.test(c.label)), 'Halden waits for the key');
  assert.equal(startWicks(state).changed, false);
  assert.equal(startTally(state).changed, false);
});

test('Oswin sells rope through the dialogue and will not sell it twice', () => {
  const state = createInitialState();
  const open = startConversation(state, 'oswin');
  const sell = open.choices.find((c) => /What do you sell/.test(c.label));
  assert.ok(sell, 'the stall offers its wares: ' + open.choices.map((c) => c.label).join(' | '));
  const wares = sell.next();
  const buy = wares.choices.find((c) => /Buy Coil of Rope/.test(c.label));
  assert.ok(buy, 'the rope is priced: ' + wares.choices.map((c) => c.label).join(' | '));
  assert.match(buy.label, /3 coins/, 'the label states the price');
  const bought = applyChoice(state, 'oswin', buy);
  assert.equal(bought.changed, true);
  assert.equal(coins(state), 3, '6 starting coins minus 3');
  assert.equal(hasItem(state, 'rope'), true);
  assert.match(buy.next().text, /No refunds/, 'the purchase closes with the handover');

  // Reopening the stall shows the rope as owned and a second attempt is inert.
  const again = startConversation(state, 'oswin')
    .choices.find((c) => /What do you sell/.test(c.label)).next();
  const owned = again.choices.find((c) => /already yours/.test(c.label));
  assert.ok(owned, 'the rope is shown as owned: ' + again.choices.map((c) => c.label).join(' | '));
  assert.ok(!again.choices.some((c) => /Buy Coil of Rope/.test(c.label)), 'no second purchase is offered');
  const noop = applyChoice(state, 'oswin', owned);
  assert.equal(noop.changed, false);
  assert.equal(coins(state), 3, 'the failed second buy costs nothing');
});

test('Oswin still offers the wares when the player cannot afford them', () => {
  const state = createInitialState();
  addCoins(state, -4); // down to 2 coins, a normal working balance
  assert.equal(coins(state), 2);
  const open = startConversation(state, 'oswin');
  const sell = open.choices.find((c) => /What do you sell/.test(c.label));
  assert.ok(sell, 'the stall is browsable with a light purse: ' + open.choices.map((c) => c.label).join(' | '));
  const wares = sell.next();
  const buy = wares.choices.find((c) => /Buy Coil of Rope/.test(c.label));
  const result = applyChoice(state, 'oswin', buy);
  assert.equal(result.changed, false, '2 coins cannot buy a 3-coin rope');
  assert.equal(coins(state), 2);
  assert.equal(hasItem(state, 'rope'), false);
  assert.match(buy.next().text, /Coins first/);
});
