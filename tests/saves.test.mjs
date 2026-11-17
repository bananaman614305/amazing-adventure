// Save/load tests: round-trips, corrupt input and storage fallback.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialState, startLanterns, buyOilWithPromise, deliverOil,
  startKey, pickUpKey, remember, coins, serialize, deserialize,
  createSaveStore, SAVE_KEY, hasItem
} from '../src/state.js';

test('save round-trips quests, items, coins and memory', () => {
  const state = createInitialState();
  startLanterns(state);
  buyOilWithPromise(state);
  deliverOil(state);
  startKey(state);
  pickUpKey(state);
  remember(state, 'halden', { topic: 'key_lost', opinionDelta: 1 });

  const restored = deserialize(serialize(state));
  assert.deepEqual(restored.quests, state.quests);
  assert.deepEqual(restored.inventory, state.inventory);
  assert.deepEqual(restored.perks, state.perks);
  assert.equal(coins(restored), coins(state));
  assert.deepEqual(restored.memory.halden, state.memory.halden);
  assert.equal(hasItem(restored, 'brass_key'), true);
});

test('corrupt saves return null instead of throwing', () => {
  assert.equal(deserialize(null), null);
  assert.equal(deserialize(undefined), null);
  assert.equal(deserialize(''), null);
  assert.equal(deserialize('not json'), null);
  assert.equal(deserialize('{}'), null);
  assert.equal(deserialize('null'), null);
  assert.equal(deserialize(JSON.stringify({ state: {} })), null);
  assert.equal(deserialize(JSON.stringify({ state: { quests: 'nope' } })), null);
});

test('deserialize drops invalid steps, items and memory values', () => {
  const raw = JSON.stringify({
    state: {
      quests: { lanterns: 'oil_bought', key: 'not-a-step', cheer: 42 },
      inventory: ['brass_key', 'not_an_item', 'brass_key'],
      perks: { oswin_debt: true, bad: 'yes' },
      flags: { coins: -9, paid_oswin: true, junk: { nested: 1 } },
      memory: { mara: { talks: -5, lastTopic: 7, opinion: 99 }, broken: 'x' }
    }
  });
  const state = deserialize(raw);
  assert.equal(state.quests.lanterns, 'oil_bought');
  assert.equal(state.quests.key, 'none');
  assert.equal(state.quests.cheer, 'none');
  assert.deepEqual(state.inventory, ['brass_key']);
  assert.deepEqual(state.perks, { oswin_debt: true });
  assert.equal(state.flags.coins, 0);
  assert.equal(state.flags.junk, undefined);
  assert.deepEqual(state.memory.mara, { talks: 0, lastTopic: null, opinion: 3 });
  assert.equal(state.memory.broken, undefined);
});

test('a save with missing sections still loads with defaults', () => {
  const state = deserialize(JSON.stringify({ state: { quests: { lanterns: 'started' } } }));
  assert.equal(state.quests.lanterns, 'started');
  assert.equal(state.quests.key, 'none');
  assert.deepEqual(state.inventory, []);
  assert.equal(coins(state), 6);
  assert.deepEqual(state.memory, {});
});

test('save store works with localStorage-like storage', () => {
  const backing = new Map();
  const fakeStorage = {
    getItem: (k) => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => backing.set(k, String(v)),
    removeItem: (k) => backing.delete(k)
  };
  const store = createSaveStore(fakeStorage);
  assert.equal(store.available, true);
  assert.equal(store.hasSave(), false);
  const state = createInitialState();
  startKey(state);
  store.save(state);
  assert.equal(backing.has(SAVE_KEY), true);
  assert.equal(store.load().quests.key, 'started');
  store.clear();
  assert.equal(store.load(), null);
  assert.equal(store.hasSave(), false);
});

test('save store falling back when storage is missing', () => {
  // Passing an explicit null with no global localStorage in Node forces the
  // memory fallback path.
  const store = createSaveStore(null);
  const state = createInitialState();
  startKey(state);
  store.save(state);
  assert.equal(store.hasSave(), true);
  assert.equal(store.load().quests.key, 'started');
  store.clear();
  assert.equal(store.load(), null);
});

test('a throwing storage backend falls back to memory', () => {
  const throwing = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); }
  };
  const store = createSaveStore(throwing);
  // createSaveStore probes by writing, which throws, so `available` is false and
  // it must not throw on save/load.
  assert.equal(store.available, false);
  const state = createInitialState();
  startKey(state);
  store.save(state);
  assert.equal(store.load().quests.key, 'started');
});

// --- Position and clock in saves -----------------------------------------

import { serialize as serializeFull, readSave, sanitizeWorld } from '../src/state.js';
import { createInitialState as freshState } from '../src/state.js';

test('a save carries position and clock so Continue resumes in place', () => {
  const state = freshState();
  const raw = serializeFull(state, { x: 3.5, z: -2.25, yaw: 1.2, clock: 88 });
  const loaded = readSave(raw);
  assert.deepEqual(loaded.world, { x: 3.5, z: -2.25, yaw: 1.2, clock: 88 });
  assert.deepEqual(loaded.state.quests, state.quests);
});

test('a save without world data still loads the state', () => {
  const loaded = readSave(serialize(freshState()));
  assert.equal(loaded.world, null);
  assert.equal(loaded.state.quests.lanterns, 'none');
});

test('bad world data is dropped, never trusted', () => {
  assert.equal(sanitizeWorld(null), null);
  assert.equal(sanitizeWorld('nope'), null);
  assert.equal(sanitizeWorld({ x: 1, z: 2, yaw: 3 }), null, 'clock is required');
  assert.equal(sanitizeWorld({ x: NaN, z: 2, yaw: 3, clock: 4 }), null);
  const clamped = sanitizeWorld({ x: 999, z: -999, yaw: 0, clock: 400 });
  assert.deepEqual(clamped, { x: 16, z: -16, yaw: 0, clock: 40 });
});

test('readSave returns null for unusable saves', () => {
  assert.equal(readSave('garbage'), null);
  assert.equal(readSave('{}'), null);
});

test('the save store round-trips world data through the adapter', () => {
  const store = createSaveStore(null);
  const state = freshState();
  startKey(state);
  store.save(state, { x: -4, z: 6, yaw: 0.5, clock: 120 });
  const loaded = store.loadSave();
  assert.equal(loaded.state.quests.key, 'started');
  assert.deepEqual(loaded.world, { x: -4, z: 6, yaw: 0.5, clock: 120 });
  assert.equal(store.load().quests.key, 'started', 'load() still returns bare state');
});
