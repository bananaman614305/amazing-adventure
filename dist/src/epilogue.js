// The ending. Seven quests currently just... stop. A player who finishes everything
// gets silence, which makes the whole thing feel unfinished rather than complete.
//
// The epilogue is deliberately composed from what the player actually did, using
// the same `outcomes` record the journal uses, plus their standing. There is no
// single "you win" text: two players who finish the same seven quests can read
// materially different endings, and the ending never claims something that did
// not happen.

import { QUEST_ORDER, QUESTS, questStatus } from './state.js';
import { reputation, tierFor, FACTIONS } from './factions.js';

/** True when every branching quest has a recorded outcome. */
export function hasAllOutcomes(state) {
  return Object.keys(BRANCH_LINES).every((questId) => Boolean(state.outcomes?.[questId]));
}

/** True when every quest in QUEST_ORDER has been completed. */
export function storyComplete(state) {
  return QUEST_ORDER.every((questId) => questStatus(state, questId) === 'done');
}

/** How many quests are finished, for progress display. */
export function storyProgress(state) {
  const done = QUEST_ORDER.filter((questId) => questStatus(state, questId) === 'done').length;
  return { done, total: QUEST_ORDER.length, complete: done === QUEST_ORDER.length };
}

/**
 * One line per branch choice the player made. Only branching quests appear here,
 * because those are the ones where two players' games genuinely differ.
 */
const BRANCH_LINES = {
  ledger: {
    name: 'You wrote the trader’s name in Wren’s ledger. The Watch got its culprit and the lane got its accounts back.',
    cover: 'You kept the trader’s name out of Wren’s ledger. The lane never forgot that you could have sold him and did not.'
  },
  toll: {
    collected: 'You paid Oswin’s toll out of your own purse rather than argue, and Halden has the coin to show for it.',
    waived: 'You talked Halden into waiving the toll. Oswin kept his money and owes you a favour he will not enjoy repaying.'
  },
  arrears: {
    pay: 'The lane’s arrears went south in full and Mara signed for them.',
    forgive: 'You carried the lane’s arrears to Mara and she wrote them off, which the Watch will have questions about come winter.'
  }
};

export function branchLines(state) {
  const lines = [];
  for (const questId of Object.keys(BRANCH_LINES)) {
    const outcome = state.outcomes?.[questId];
    const text = outcome && BRANCH_LINES[questId]?.[outcome];
    if (text) lines.push({ questId, outcome, text });
  }
  return lines;
}

/** The faction the player stands best and worst with, at the end. */
export function standingSummary(state) {
  const ranked = Object.keys(FACTIONS)
    .map((factionId) => ({
      factionId,
      name: FACTIONS[factionId].name,
      score: reputation(state, factionId),
      tier: tierFor(reputation(state, factionId)).id,
      tierName: tierFor(reputation(state, factionId)).name
    }))
    .sort((a, b) => b.score - a.score);
  return { best: ranked[0], worst: ranked[ranked.length - 1], all: ranked };
}

/**
 * A closing paragraph on where the player ended up with each faction. Written
 * per tier so it is honest about hostility as well as gratitude — an ending that
 * congratulates a player the Watch hates would be a lie.
 */
const FACTION_CLOSERS = {
  keepers: {
    trusted: 'Mara leaves the north lantern to you now, and does not check it after.',
    warm: 'Mara nods when you pass, which from her is a speech.',
    neutral: 'Mara keeps her distance, polite and no more.',
    cold: 'Mara keeps the fountain between you when she can.',
    hostile: 'Mara will not look at you, and the lanterns burn a little later every night.'
  },
  trade: {
    trusted: 'Oswin sets aside a crate for you and refuses to take payment for it.',
    warm: 'Oswin calls you by name and means it.',
    neutral: 'Oswin will sell to you, and watch you while he does.',
    cold: 'Oswin quotes you prices he knows you will refuse.',
    hostile: 'Oswin’s stall closes as you approach, and stays closed.'
  },
  watch: {
    trusted: 'Halden salutes you at the gate, and the gate stands open.',
    warm: 'Halden gives you a nod instead of a challenge.',
    neutral: 'Halden counts you in and out and says nothing.',
    cold: 'Halden searches you every time you pass the gate.',
    hostile: 'Halden has written your description in the gate ledger, underlined.'
  }
};

export function factionClosers(state) {
  return Object.keys(FACTIONS).map((factionId) => {
    const tier = tierFor(reputation(state, factionId)).id;
    return {
      factionId,
      name: FACTIONS[factionId].name,
      tier,
      text: FACTION_CLOSERS[factionId]?.[tier] || ''
    };
  }).filter((entry) => entry.text);
}

/**
 * The full epilogue. Returns null until the story is actually complete, so the
 * game cannot show an ending to someone who has not finished it.
 */
export function buildEpilogue(state) {
  if (!storyComplete(state)) return null;
  const branches = branchLines(state);
  const standing = standingSummary(state);
  const closers = factionClosers(state);
  return {
    title: 'The plaza at closing',
    opening: 'Seven errands, and none of them were only errands. The lanterns are lit, the gate is open, and the lane’s books are as straight as they have been in a month.',
    branches,
    // A save finished before branches were recorded (or a hand-edited one) has no
    // outcomes. Saying nothing about what the player chose would be a quiet lie,
    // so the ending admits the record is incomplete instead of implying it is not.
    branchesUnrecorded: !hasAllOutcomes(state),
    closers,
    standing,
    closing: 'The plaza does not need you any more. It is a strange thing to be given. You could stay, and the market would keep, and someone would find you a crate to sit on. Or you could walk out through the north gate while the light is still good.'
  };
}
