// What a brand-new player is told. The plaza drops you a few metres from anyone, so
// the interaction hint stays hidden at spawn; before this existed a first-time player
// was given no statement of what to do or which key does it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isFreshStart, openingLine, firstGoal, welcome } from '../src/onboard.js';
import { createInitialState } from '../src/state.js';

test('a new game is recognised as fresh', () => {
  const state = createInitialState();
  assert.equal(isFreshStart(state), true);
});

test('a game in progress is not fresh', () => {
  for (const status of ['started', 'done']) {
    const state = createInitialState();
    state.quests.lanterns = status;
    assert.equal(isFreshStart(state), false, `lanterns=${status} means the player has begun`);
  }
});

test('a finished game with recorded outcomes is not fresh', () => {
  const state = createInitialState();
  state.outcomes.ledger = 'name';
  assert.equal(isFreshStart(state), false);
});

test('a missing or malformed state is not treated as fresh', () => {
  assert.equal(isFreshStart(null), false);
  assert.equal(isFreshStart(undefined), false);
  assert.equal(welcome({ state: null }), null);
});

test('the opening line names the controls the device actually has', () => {
  const keyboard = openingLine('keyboard');
  assert.match(keyboard, /W A S D/, 'keyboard players are told the movement keys');
  assert.match(keyboard, /press E/, 'and the interact key');

  const touch = openingLine('touch');
  assert.match(touch, /thumb/, 'phone players are told about thumb controls');
  assert.doesNotMatch(touch, /\\bE\\b/, 'a phone has no E key, so it must not be named');
});

test('the first goal names the nearest person and the right action', () => {
  assert.match(firstGoal({ name: 'Sable the Cartographer' }), /Sable the Cartographer/);
  assert.match(firstGoal({ name: 'Sable the Cartographer' }, 'keyboard'), /press E/);
  assert.match(firstGoal({ name: 'Sable the Cartographer' }, 'touch'), /tap Use/);
});

test('the first goal still says something useful when nobody is nearby', () => {
  const goal = firstGoal(null);
  assert.ok(goal.length > 0);
  assert.match(goal, /talk/i, 'it still points at the thing to do');
});

test('the whole welcome is absent for a continuing player', () => {
  const state = createInitialState();
  state.quests.key = 'found';
  assert.equal(welcome({ state, nearest: { name: 'Mara' } }), null,
    'a returning player must not be re-tutorialised');
});

test('the spoken version contains everything the visible one does', () => {
  const state = createInitialState();
  const message = welcome({ state, nearest: { name: 'Sable' } });
  assert.ok(message.spoken.includes(message.opening), 'the spoken line includes the opening');
  assert.ok(message.spoken.includes(message.goal), 'and the goal');
});

test('the touch welcome never mentions a key that does not exist', () => {
  const message = welcome({ state: createInitialState(), nearest: { name: 'Sable' }, device: 'touch' });
  assert.doesNotMatch(message.spoken, /press E/, 'no keyboard-only instruction on a phone');
  assert.match(message.spoken, /tap Use/);
});
