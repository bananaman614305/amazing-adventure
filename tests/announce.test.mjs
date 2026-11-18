// Screen-reader support. The property that matters most: a blind player is told
// what is actually true, and is never told something the game does not know.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, QUEST_ORDER, QUESTS } from '../src/state.js';
import {
  areaName, areaAnnouncement, interactableAnnouncement, questChanges,
  questTitle, coinAnnouncement, describeState
} from '../src/announce.js';
import { AREAS } from '../src/areas.js';

test('every real area has a spoken name that is not its id', () => {
  for (const area of AREAS) {
    const name = areaName(area.id);
    assert.equal(name, area.name);
    assert.notEqual(name, area.id, 'an id is not a spoken name');
  }
});

test('an unknown area is described neutrally, not as a crash', () => {
  assert.equal(areaName('nowhere'), 'the open ground');
  assert.ok(areaAnnouncement(createInitialState(), 'nowhere').length > 10);
});

test('each area announcement says where you are', () => {
  for (const area of AREAS) {
    const text = areaAnnouncement(createInitialState(), area.id);
    assert.ok(text.startsWith(area.name), `${area.id} should open with its name`);
    assert.ok(text.length > 40, `${area.id} needs a real description`);
  }
});

test('an interactable is announced with its real label', () => {
  assert.equal(interactableAnnouncement({ label: 'talk to Oswin' }), 'You can talk to Oswin.');
  assert.equal(interactableAnnouncement(null), '', 'nothing to say when nothing is near');
});

test('a started quest is reported once, and not as progress', () => {
  const before = createInitialState();
  const after = createInitialState();
  after.quests.lanterns = 'started';
  const changes = questChanges(before, after);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, 'started');
  assert.match(changes[0].text, /^New quest: /);
});

test('a finished quest is announced as complete', () => {
  const before = createInitialState();
  before.quests.lanterns = 'started';
  const after = createInitialState();
  after.quests.lanterns = 'done';
  const changes = questChanges(before, after);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, 'done');
  assert.match(changes[0].text, /^Quest complete: /);
});

test('an unchanged state announces nothing at all', () => {
  const state = createInitialState();
  assert.deepEqual(questChanges(state, createInitialState()), []);
});

test('quest titles come from the same table the journal uses', () => {
  for (const questId of QUEST_ORDER) {
    assert.equal(questTitle(questId), QUESTS[questId].title,
      'spoken and written titles must not drift apart');
  }
});

test('a mid-quest step is spoken in words, not as an identifier', () => {
  const before = createInitialState();
  before.quests.lanterns = 'started';
  const after = createInitialState();
  after.quests.lanterns = 'oil_bought';
  const [change] = questChanges(before, after);
  assert.equal(/oil_bought/.test(change.text), false, 'underscores must not be read out');
  assert.match(change.text, /oil bought/i);
});

test('coin changes state the real total, not just the difference', () => {
  const before = createInitialState();
  const after = createInitialState();
  after.flags.coins = 9;
  const text = coinAnnouncement(before, after);
  assert.match(text, /Gained 3 coins/);
  assert.match(text, /You have 9 coins/, 'the player needs to know their balance');
});

test('spending coins is announced as a loss', () => {
  const before = createInitialState();
  before.flags.coins = 10;
  const after = createInitialState();
  after.flags.coins = 4;
  assert.match(coinAnnouncement(before, after), /^Lost 6 coins/);
});

test('a single coin is not called coins', () => {
  const before = createInitialState();
  before.flags.coins = 0;
  const after = createInitialState();
  after.flags.coins = 1;
  const text = coinAnnouncement(before, after);
  assert.match(text, /Gained 1 coin\./);
  assert.equal(/1 coins/.test(text), false);
});

test('an unchanged balance says nothing', () => {
  const state = createInitialState();
  assert.equal(coinAnnouncement(state, createInitialState()), '');
});

test('describing the state reports the gate honestly in both states', () => {
  const locked = createInitialState();
  assert.match(describeState(locked, 'plaza', null), /gate is locked/);
  const open = createInitialState();
  open.quests.key = 'done';
  assert.match(describeState(open, 'plaza', null), /gate is open/);
});

test('describing the state never claims an interactable that is not there', () => {
  const state = createInitialState();
  const text = describeState(state, 'plaza', null);
  assert.equal(/You can /.test(text), false);
  const withItem = describeState(state, 'plaza', { label: 'sit on the bench' });
  assert.match(withItem, /You can sit on the bench\./);
});

test('the description is one readable paragraph, not fragments', () => {
  const text = describeState(createInitialState(), 'plaza', { label: 'talk to Mara' });
  assert.equal(text.includes('  '), false, 'no double spaces');
  assert.match(text, /\.$/, 'ends cleanly');
});
