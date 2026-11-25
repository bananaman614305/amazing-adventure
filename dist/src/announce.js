// Screen-reader support, as a pure module with no DOM dependency so it can be
// tested in Node.
//
// The game is first-person and visual: almost everything it tells you -- the
// plaza around you, who is nearby, what you can interact with, that a quest
// moved on -- is rendered to a canvas or a toast that fades after three seconds.
// A screen-reader user currently gets silence, which makes the game unplayable
// rather than merely awkward.
//
// The rule this module follows: only announce things the game actually knows to
// be true. No invented descriptions of scenery we do not track.

import { AREAS, areaAt } from './areas.js';
import { questStatus } from './state.js';

/** The spoken name of an area, or a neutral phrase for being outside them. */
export function areaName(areaId) {
  const area = AREAS.find((candidate) => candidate.id === areaId);
  return area ? area.name : 'the open ground';
}

/**
 * The one line of context a blind player needs on entering an area: where they
 * are, and anything true about what is there.
 */
export function areaAnnouncement(state, areaId) {
  const name = areaName(areaId);
  if (areaId === 'plaza') {
    return `${name}. An open courtyard with a fountain at the centre. Shops and people stand around it.`;
  }
  if (areaId === 'lane') {
    return `${name}. A covered corridor of stalls running north from the gate.`;
  }
  return `${name}. Beyond the walls, nothing is marked.`;
}

/**
 * Announce the nearest thing the player can use. Kept separate from the visual
 * hint so both are derived from the same interactable, and cannot disagree.
 */
export function interactableAnnouncement(interactable) {
  if (!interactable) return '';
  return `You can ${interactable.label}.`;
}

/**
 * Quest changes are the main source of progression, and they were entirely
 * silent. Only report a change that actually happened, by comparing before and
 * after rather than guessing from a single state.
 */
export function questChanges(before, after) {
  const changes = [];
  for (const questId of Object.keys(after.quests || {})) {
    const from = before.quests?.[questId] ?? 'none';
    const to = after.quests?.[questId] ?? 'none';
    if (from === to) continue;
    if (to === 'done') {
      changes.push({ questId, kind: 'done', text: `Quest complete: ${questTitle(questId)}.` });
    } else if (from === 'none') {
      changes.push({ questId, kind: 'started', text: `New quest: ${questTitle(questId)}.` });
    } else {
      changes.push({ questId, kind: 'progress', text: `${questTitle(questId)}: ${to.replace(/_/g, ' ')}.` });
    }
  }
  return changes;
}

/**
 * Titles come from the same table the journal uses, so the spoken name and the
 * written name can never drift apart.
 */
import { QUESTS } from './state.js';

export function questTitle(questId) {
  return QUESTS[questId]?.title || questId;
}

/** Announce a coin change, with the real new total rather than a delta alone. */
export function coinAnnouncement(before, after) {
  const from = before.flags?.coins ?? 0;
  const to = after.flags?.coins ?? 0;
  if (from === to) return '';
  const delta = to - from;
  const plural = Math.abs(to) === 1 ? 'coin' : 'coins';
  return `${delta > 0 ? 'Gained' : 'Lost'} ${Math.abs(delta)} ${Math.abs(delta) === 1 ? 'coin' : 'coins'}. You have ${to} ${plural}.`;
}

/**
 * A single summary of a whole state, for pressing a "describe where I am" key.
 * Deliberately plain: it reports state, not atmosphere.
 */
export function describeState(state, areaId, interactable) {
  const parts = [areaAnnouncement(state, areaId)];
  const open = questStatus(state, 'key') === 'done';
  parts.push(open ? 'The north gate is open.' : 'The north gate is locked.');
  if (interactable) parts.push(interactableAnnouncement(interactable));
  parts.push(`You have ${state.flags?.coins ?? 0} coins.`);
  return parts.join(' ');
}
