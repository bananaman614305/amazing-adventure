// Ambient NPC-to-NPC conversation tests. These are pure, so no browser needed.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AMBIENT_RANGE, chooseAmbientPair, buildExchange, scriptKeyFor,
  canOverhear, noteExchange, exchangesBetween, PAIRS, SCRIPTS
} from '../src/ambient.js';
import {
  createInitialState, startLanterns, buyOilWithCoins, deliverOil,
  startKey, pickUpKey, returnKey, startToll, collectToll, waiveToll, finishToll
} from '../src/state.js';

/** A tidy NPC list with controllable positions. */
function cast(overrides = {}) {
  const base = {
    mara: { x: 0, z: 0 },
    halden: { x: 1, z: 0.5 },
    oswin: { x: 12, z: 0 },
    pip: { x: 12.5, z: 0.5 },
    sable: { x: 20, z: 20 }
  };
  return Object.entries({ ...base, ...overrides }).map(([id, p]) => ({
    id, name: id[0].toUpperCase() + id.slice(1), position: p
  }));
}

// Far enough away that neither mara nor halden is excluded by the
// "do not start a conversation in the player's face" rule, but close enough
// that the pair is still staged nearby.
const nearPlayer = { x: 0, z: -8 };

test('a nearby eligible pair is chosen', () => {
  const pair = chooseAmbientPair({
    npcs: cast(), state: createInitialState(), phase: 'day', playerPosition: nearPlayer
  });
  assert.ok(pair);
  assert.equal(pair.a.id, 'mara');
  assert.equal(pair.b.id, 'halden');
});

test('NPCs further apart than the range do not converse', () => {
  // Spread everyone out so no scripted pair is close enough to each other.
  const spread = {};
  for (const [index, id] of ['mara', 'halden', 'oswin', 'pip', 'sable'].entries()) {
    spread[id] = { x: index * (AMBIENT_RANGE + 2), z: 0 };
  }
  const pair = chooseAmbientPair({
    npcs: cast(spread),
    state: createInitialState(),
    phase: 'day',
    playerPosition: { x: 0, z: -1 }
  });
  assert.equal(pair, null);
});

test('a conversation will not start right on top of the player', () => {
  // Player standing between mara and halden: those two must be excluded. A
  // different pair elsewhere may legitimately take over instead.
  const pair = chooseAmbientPair({
    npcs: cast(),
    state: createInitialState(),
    phase: 'day',
    playerPosition: { x: 0.5, z: 0.2 }
  });
  if (pair) {
    assert.deepEqual([pair.a.id, pair.b.id], ['oswin', 'pip'],
      'only the pair away from the player may converse');
  }

  // With nobody else eligible, standing on top of a pair means no conversation.
  const pairWhenAlone = chooseAmbientPair({
    npcs: cast({ oswin: { x: 60, z: 60 }, pip: { x: 61, z: 60 }, sable: { x: 70, z: 70 } }),
    state: createInitialState(),
    phase: 'day',
    playerPosition: { x: 0.5, z: 0.2 }
  });
  assert.equal(pairWhenAlone, null);
});

test('distant conversations are not staged', () => {
  // Everyone is either far from the player or far from each other.
  const pair = chooseAmbientPair({
    npcs: cast({
      mara: { x: 40, z: 40 }, halden: { x: 41, z: 40 },
      oswin: { x: -30, z: 30 }, pip: { x: 30, z: -30 }, sable: { x: 20, z: 20 }
    }),
    state: createInitialState(),
    phase: 'day',
    playerPosition: nearPlayer
  });
  assert.equal(pair, null);
});

test('busy and active NPCs are excluded', () => {
  const state = createInitialState();
  assert.equal(chooseAmbientPair({
    npcs: cast(), state, phase: 'day', playerPosition: nearPlayer, busyIds: ['mara']
  }), null);
  assert.equal(chooseAmbientPair({
    npcs: cast(), state, phase: 'day', playerPosition: nearPlayer, activeId: 'halden'
  }), null);
});

test('every script key produces well-formed lines', () => {
  for (const [key, script] of Object.entries(SCRIPTS)) {
    assert.ok(Array.isArray(script) && script.length >= 2, `${key} has at least two lines`);
    const lines = buildExchange({
      state: createInitialState(),
      phase: 'day',
      a: { id: 'mara' },
      b: { id: 'halden' },
      names: { mara: 'Mara', halden: 'Halden' }
    });
    assert.ok(lines.length >= 2);
    for (const line of lines) {
      assert.ok(['mara', 'halden'].includes(line.speakerId), `${key} speakers are from the pair`);
      assert.ok(line.text.length > 3, `${key} line has text`);
    }
  }
});

test('the lane lamps are what the cast talks about at dusk', () => {
  const state = createInitialState();
  assert.equal(scriptKeyFor(state, 'dusk'), 'lane_dark', 'an unlit lane is remarked on');
  // By full night an unlit lane has stopped being news: the pair talk about the
  // quiet, not repeat the dusk complaint.
  assert.equal(scriptKeyFor(state, 'night'), 'night');

  state.flags.laneLanternsLit = true;
  assert.equal(scriptKeyFor(state, 'dusk'), 'lane_lit');
  assert.equal(scriptKeyFor(state, 'night'), 'lane_lit', 'the lighting is noticed all night');
  // By day the flag is irrelevant: there is nothing lit or dark about noon.
  assert.equal(scriptKeyFor(state, 'day'), 'default', 'daylight ignores the lane flag');

  // The lit exchange has to actually be different text, not the same lines
  // under a new key, or the cast is silently ignoring what the player did.
  const dark = buildExchange({ state: createInitialState(), phase: 'dusk', a: { id: 'mara' }, b: { id: 'halden' } });
  const lit = buildExchange({ state, phase: 'dusk', a: { id: 'mara' }, b: { id: 'halden' } });
  assert.notDeepEqual(dark, lit);
  assert.ok(lit[0].text.toLowerCase().includes('bunting'), lit[0].text);
  assert.ok(dark[0].text.toLowerCase().includes('dark'), dark[0].text);

  // Higher-priority business still wins: a broken toll is never drowned out.
  state.quests.toll = 'collected';
  assert.equal(scriptKeyFor(state, 'dusk'), 'toll_collected');
});

// A script that scriptKeyFor() can never return is dead content: it reads as
// working dialogue in review and in the unit tests, but no player ever sees it.
// This round deleted exactly one of those, so it is checked from now on by
// walking real clock phases rather than trusting the keys to line up.
test('every script is reachable from some clock phase and state', () => {
  const reachable = new Set();
  for (const phase of ['day', 'dusk', 'night']) {
    reachable.add(scriptKeyFor(createInitialState(), phase));
  }
  const state = createInitialState();
  state.flags.laneLanternsLit = true;
  for (const phase of ['day', 'dusk', 'night']) reachable.add(scriptKeyFor(state, phase));

  // Walk the quest states the game can actually be in, which is how the other
  // scripts are reached. Prerequisites matter: startToll() refuses until the key
  // is returned, so a walk that skips it is not a state the game can reach and
  // would have made this guard pass on impossible states.
  const keyDone = (s) => { startKey(s); pickUpKey(s); returnKey(s); };
  const questWalks = [
    (s) => { startLanterns(s); },
    (s) => { startLanterns(s); buyOilWithCoins(s); },
    (s) => { startLanterns(s); buyOilWithCoins(s); deliverOil(s); },
    (s) => { startKey(s); },
    (s) => { startKey(s); pickUpKey(s); },
    (s) => { keyDone(s); },
    (s) => { keyDone(s); startToll(s); },
    (s) => { keyDone(s); startToll(s); collectToll(s); },
    (s) => { keyDone(s); startToll(s); collectToll(s); finishToll(s); },
    (s) => { keyDone(s); startToll(s); waiveToll(s, 'trusted'); },
    (s) => { keyDone(s); startToll(s); waiveToll(s, 'trusted'); finishToll(s); },
    (s) => { s.perks.oswin_debt = true; },
    (s) => { s.perks.oswin_favour = true; }
  ];
  for (const walk of questWalks) {
    const s = createInitialState();
    walk(s);
    for (const phase of ['day', 'dusk', 'night']) reachable.add(scriptKeyFor(s, phase));
  }

  // Prove the walks themselves are real: a walk whose action was silently
  // refused tests nothing, because the state it inspects is the initial one.
  const keyDoneState = createInitialState();
  keyDone(keyDoneState);
  assert.equal(keyDoneState.quests.key, 'done', 'the key walk must actually finish the key');
  const collected = createInitialState();
  keyDone(collected);
  startToll(collected);
  const paid = collectToll(collected);
  assert.equal(paid.changed, true, paid.message);
  assert.equal(collected.quests.toll, 'collected');

  for (const key of Object.keys(SCRIPTS)) {
    assert.ok(reachable.has(key), `script '${key}' is unreachable from any phase or state`);
  }
});

test('every script key has lines and a distinct opening', () => {
  const openings = new Map();
  for (const [key, script] of Object.entries(SCRIPTS)) {
    assert.ok(Array.isArray(script) && script.length >= 2, `${key} has an exchange`);
    for (const [who, text] of script) {
      assert.ok(['a', 'b'].includes(who), `${key} speaker is a or b`);
      assert.ok(typeof text === 'string' && text.length > 3, `${key} line has text`);
    }
    const opening = script[0][1];
    assert.ok(!openings.has(opening), `${key} shares its opening line with ${openings.get(opening)}`);
    openings.set(opening, key);
  }
});

test('the exchange is deterministic for the same inputs', () => {
  const args = {
    state: createInitialState(), phase: 'dusk',
    a: { id: 'mara' }, b: { id: 'halden' }
  };
  assert.deepEqual(buildExchange(args), buildExchange(args));
});

test('the script reflects quest progress', () => {
  const state = createInitialState();
  assert.equal(scriptKeyFor(state, 'day'), 'default');
  // Dusk now depends on the lane: an unlit lane is worth remarking on at dusk.
  assert.equal(scriptKeyFor(state, 'dusk'), 'lane_dark');
  assert.equal(scriptKeyFor(state, 'night'), 'night');

  startLanterns(state);
  assert.equal(scriptKeyFor(state, 'day'), 'lanterns_pending');
  buyOilWithCoins(state);
  deliverOil(state);
  assert.equal(scriptKeyFor(state, 'day'), 'lanterns_done');

  startKey(state);
  pickUpKey(state);
  assert.equal(scriptKeyFor(state, 'day'), 'lanterns_done', 'key quest is not done yet');
  returnKey(state);
  assert.equal(scriptKeyFor(state, 'day'), 'lanterns_done');
});

test('toll outcomes change what NPCs gossip about', () => {
  const paid = createInitialState();
  startKey(paid); pickUpKey(paid); returnKey(paid);
  startToll(paid);
  // No lantern quest done yet, so the pair gossips about the returned key.
  assert.equal(scriptKeyFor(paid, 'day'), 'key_done');
  collectToll(paid);
  assert.equal(scriptKeyFor(paid, 'day'), 'toll_collected');
  finishToll(paid);
  assert.equal(scriptKeyFor(paid, 'day'), 'toll_done');

  const waived = createInitialState();
  startKey(waived); pickUpKey(waived); returnKey(waived);
  startToll(waived);
  waiveToll(waived, 'warm');
  assert.equal(scriptKeyFor(waived, 'day'), 'toll_waived');
});

test('an unpaid debt is what the plaza whispers about', () => {
  const state = createInitialState();
  state.perks.oswin_debt = true;
  assert.equal(scriptKeyFor(state, 'day'), 'oswin_debt');
  state.perks.oswin_debt = false;
  state.perks.oswin_favour = true;
  assert.equal(scriptKeyFor(state, 'day'), 'oswin_favour');
});

test('overhearing requires proximity', () => {
  assert.equal(canOverhear({ x: 0, z: 0 }, { x: 2, z: 0 }), true);
  assert.equal(canOverhear({ x: 0, z: 0 }, { x: 10, z: 0 }), false);
  assert.equal(canOverhear(null, { x: 0, z: 0 }), false);
  assert.equal(canOverhear({ x: 0, z: 0 }, null), false);
});

test('exchanges are counted per pair, in either order', () => {
  const state = createInitialState();
  assert.equal(noteExchange(state, 'mara', 'halden'), 1);
  assert.equal(noteExchange(state, 'halden', 'mara'), 2);
  assert.equal(exchangesBetween(state, 'mara', 'halden'), 2);
  assert.equal(exchangesBetween(state, 'halden', 'mara'), 2);
  assert.equal(exchangesBetween(state, 'oswin', 'pip'), 0);
});

test('every scripted pair is a real pair of known NPCs', () => {
  const ids = new Set(['mara', 'oswin', 'pip', 'halden', 'sable']);
  for (const [a, b] of PAIRS) {
    assert.ok(ids.has(a) && ids.has(b), `${a}/${b} are known NPCs`);
    assert.notEqual(a, b);
  }
});
