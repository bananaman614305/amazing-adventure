// The plaza work board: the fix for "goodwill can only be earned after it is
// needed". Unlike a refused NPC, the board is available to anyone, so a player
// can build standing up before a refusal ever happens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, REFUSAL_RULES } from '../src/state.js';
import { JOB_BOARD_SPEAKER, applyChoice, workMenu, startConversation } from '../src/dialogue.js';
import { JOB_BOARD, PLAZA } from '../src/areas.js';
import { refusalFor } from '../src/refusal.js';
import { changeReputation, reputation, tierFor } from '../src/factions.js';

test('the work board sits inside the plaza and is not inside a wall', () => {
  assert.ok(JOB_BOARD.x >= PLAZA.minX && JOB_BOARD.x <= PLAZA.maxX, 'x is in the plaza');
  assert.ok(JOB_BOARD.z >= PLAZA.minZ && JOB_BOARD.z <= PLAZA.maxZ, 'z is in the plaza');
  assert.ok(JOB_BOARD.range > 0, 'it has an interaction range');
  // Keep it off the plaza edge so the player is not reaching through a wall.
  assert.ok(Math.abs(JOB_BOARD.z) < PLAZA.maxZ - 1, 'not jammed against the north wall');
});

test('the board offers work to a player with neutral standing', () => {
  const state = createInitialState();
  const node = JOB_BOARD_SPEAKER.talk(state);
  assert.equal(node.speaker, 'The Work Board');
  const jobs = node.choices.filter((c) => /Sweep|Carry|Drill/.test(c.label));
  assert.equal(jobs.length, 3, 'all three jobs are posted');
  assert.ok(node.choices.some((c) => /Leave/.test(c.label)), 'and the player can walk away');
});

test('the board is reachable even when an NPC would refuse the player', () => {
  // This is the whole point of the board: a refused player still has a way to
  // earn standing, without needing to talk their way past anyone.
  const state = createInitialState();
  changeReputation(state, 'trade', -80);
  assert.ok(refusalFor(state, 'oswin', REFUSAL_RULES) !== null, 'Oswin refuses this player');
  const node = JOB_BOARD_SPEAKER.talk(state);
  assert.ok(node.choices.some((c) => /Carry crates/.test(c.label)),
    'the board still offers the Market job');
});

test('working at the board really raises standing', () => {
  const state = createInitialState();
  const node = JOB_BOARD_SPEAKER.talk(state);
  const carry = node.choices.find((c) => /Carry crates/.test(c.label));
  const before = reputation(state, 'trade');
  const result = applyChoice(state, 'job_board', carry);
  assert.equal(result.changed, true);
  assert.ok(reputation(state, 'trade') > before, 'standing improved');
});

test('the board invents no phantom NPC in the save', () => {
  const state = createInitialState();
  const node = JOB_BOARD_SPEAKER.talk(state);
  const carry = node.choices.find((c) => /Carry crates/.test(c.label));
  applyChoice(state, 'job_board', carry);
  assert.equal(state.memory.job_board, undefined,
    'the board is a notice, not a person, so it has no memory');
  assert.deepEqual(Object.keys(state.memory), [], 'and nothing else was invented either');
});

test('taking work from the board is not free', () => {
  const state = createInitialState();
  state.flags.coins = 0;
  const node = JOB_BOARD_SPEAKER.talk(state);
  const carry = node.choices.find((c) => /Carry crates/.test(c.label));
  const result = applyChoice(state, 'job_board', carry);
  assert.equal(result.changed, false, 'no coins means no carry job');
  assert.equal(reputation(state, 'trade'), 0, 'and no standing either');
});

test('a time job from the board asks the caller to advance the clock', () => {
  const state = createInitialState();
  const node = JOB_BOARD_SPEAKER.talk(state);
  const sweep = node.choices.find((c) => /Sweep/.test(c.label));
  const result = applyChoice(state, 'job_board', sweep);
  assert.equal(result.advanceTime, true);
});

test('the board and a refusal offer the same jobs', () => {
  // Two entry points, one set of jobs: the board must not quietly offer
  // different or better work than a refusing shopkeeper.
  const state = createInitialState();
  const boardJobs = JOB_BOARD_SPEAKER.talk(state).choices
    .filter((c) => /Sweep|Carry|Drill/.test(c.label)).map((c) => c.label).sort();
  const refusalMenu = workMenu(state, 'oswin', 'Oswin the Trader');
  const refusalJobs = refusalMenu.choices
    .filter((c) => /Sweep|Carry|Drill/.test(c.label)).map((c) => c.label).sort();
  assert.deepEqual(boardJobs, refusalJobs);
});

test('the board has its own copy, not a shopkeeper scolding the player', () => {
  const state = createInitialState();
  const line = JOB_BOARD_SPEAKER.talk(state).text;
  assert.match(line, /board|slips|posted/i);
  assert.equal(/Work is work/.test(line), false, 'no shopkeeper dialogue on a board');
});

test('board work can lift a player all the way out of a refusal', () => {
  const state = createInitialState();
  changeReputation(state, 'trade', -40);
  state.inventory = state.inventory.filter((id) => id !== 'oswin_marker');
  state.flags.coins = 200;
  assert.ok(refusalFor(state, 'oswin', REFUSAL_RULES) !== null, 'refused to start');
  for (let i = 0; i < 40 && refusalFor(state, 'oswin', REFUSAL_RULES) !== null; i += 1) {
    const node = JOB_BOARD_SPEAKER.talk(state);
    const carry = node.choices.find((c) => /Carry crates/.test(c.label));
    applyChoice(state, 'job_board', carry);
  }
  assert.equal(refusalFor(state, 'oswin', REFUSAL_RULES), null,
    'the board alone is enough to earn the refusal away');
  assert.ok(tierFor(reputation(state, 'trade')).id !== 'hostile');
});

test('the board is not a way to talk to an NPC without meeting them', () => {
  // Reaching for a conversation through the board must not resolve to a person.
  const state = createInitialState();
  assert.equal(startConversation(state, 'job_board'), null,
    'there is no NPC by that name; the board is opened through its own talk()');
});
