// What a player is told when they first arrive.
//
// The game drops you in the plaza facing the people you are meant to meet, but at
// spawn nothing is within the 2.6m talk range, so the interaction hint stays hidden
// and the only instruction is a line in a quest tracker. A first-time player had no
// statement of what to do or which key does it.
//
// This is deliberately a pure function: given the state and the controls the current
// device actually has, it returns what to say. main.js decides when and how to show it.

/** Whether this is a brand-new game: nothing started, nothing done. */
export function isFreshStart(state) {
  if (!state) return false;
  const quests = state.quests || {};
  const untouched = Object.values(quests).every((status) => status === 'none');
  const noOutcomes = Object.keys(state.outcomes || {}).length === 0;
  return untouched && noOutcomes;
}

/**
 * The opening line. Touch and keyboard differ in what they can honestly promise:
 * a phone has no pointer lock and uses thumb controls, so telling someone to press
 * E there would be wrong.
 */
export function openingLine(device = 'keyboard') {
  if (device === 'touch') {
    return 'You are in the plaza. Walk with the left thumb, look with the right, and tap Use when someone is close.';
  }
  return 'You are in the plaza. Walk with W A S D or the arrow keys, and press E when someone is close.';
}

/** The first concrete thing to do, named after the person actually nearest. */
export function firstGoal(nearest = null, device = 'keyboard') {
  // Naming the wrong key is worse than naming none: a phone has no E key, so the
  // touch wording has to point at the Use button instead.
  const action = device === 'touch' ? 'tap Use' : 'press E';
  if (!nearest || !nearest.name) return `Look for someone to talk to, then ${action}.`;
  return `Someone is nearby: walk up to ${nearest.name} and ${action} to talk.`;
}

/**
 * Everything to show on arrival, in order. Kept as data so the UI can render it and
 * a test can assert it without a DOM.
 */
export function welcome({ state, nearest = null, device = 'keyboard' } = {}) {
  if (!isFreshStart(state)) return null;
  return {
    opening: openingLine(device),
    goal: firstGoal(nearest, device),
    spoken: `${openingLine(device)} ${firstGoal(nearest, device)}`
  };
}
