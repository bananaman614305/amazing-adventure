// Factions and reputation. Plain data plus pure functions so the whole system
// is testable in Node and survives save/load without any Three.js involvement.
//
// Design: each faction has a reputation score in [-100, 100]. Scores map to
// named tiers, and NPCs belong to a faction. An NPC's reaction to the player is
// its faction tier plus its own personal opinion, which is what makes
// "reputation" feel like it has sources rather than one global number.

export const FACTIONS = {
  keepers: {
    id: 'keepers',
    name: 'The Keepers',
    // Singular noun used mid-sentence, e.g. "Every Keeper in the plaza".
    member: 'Keeper',
    // Lower-case collective used mid-sentence ("the keepers are careful").
    collective: 'keepers',
    blurb: 'Those who tend the plaza: its lanterns, its fountain and its peace.',
    color: '#ffd479'
  },
  trade: {
    id: 'trade',
    name: 'The Market',
    member: 'trader',
    collective: 'market',
    blurb: 'Stallholders and hagglers. They keep accounts of everyone.',
    color: '#c9a06a'
  },
  watch: {
    id: 'watch',
    name: 'The Watch',
    member: 'guard',
    collective: 'watch',
    blurb: 'The gate guard and their rules. Slow to trust, slow to forget.',
    color: '#8f97a8'
  }
};

export const FACTION_IDS = ['keepers', 'trade', 'watch'];

/** Which faction each NPC answers to. */
export const NPC_FACTION = {
  mara: 'keepers',
  sable: 'keepers',
  oswin: 'trade',
  pip: 'trade',
  halden: 'watch'
};

export const REPUTATION_MIN = -100;
export const REPUTATION_MAX = 100;

export const TIERS = [
  { id: 'hostile', name: 'Hostile', min: -100, max: -60 },
  { id: 'cold', name: 'Cold', min: -59, max: -25 },
  { id: 'neutral', name: 'Neutral', min: -24, max: 24 },
  { id: 'warm', name: 'Warm', min: 25, max: 59 },
  { id: 'trusted', name: 'Trusted', min: 60, max: 100 }
];

export function createInitialReputation() {
  return { keepers: 0, trade: 0, watch: 0 };
}

export function clampReputation(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(REPUTATION_MIN, Math.min(REPUTATION_MAX, Math.round(number)));
}

/** Reads a faction's reputation score (0 when unknown). */
export function reputation(state, factionId) {
  if (!FACTIONS[factionId]) return 0;
  return clampReputation(state.reputation?.[factionId] ?? 0);
}

/**
 * Changes a faction's reputation. Returns the delta actually applied, which is
 * smaller than requested when the score hits a bound — callers use that to
 * report "no further effect" honestly instead of claiming a change happened.
 */
export function changeReputation(state, factionId, delta) {
  if (!FACTIONS[factionId]) throw new Error(`unknown faction ${factionId}`);
  state.reputation = state.reputation || createInitialReputation();
  const before = reputation(state, factionId);
  const after = clampReputation(before + Number(delta || 0));
  state.reputation[factionId] = after;
  return after - before;
}

/** The named tier for a score. */
export function tierFor(score) {
  const value = clampReputation(score);
  return TIERS.find((tier) => value >= tier.min && value <= tier.max) || TIERS[2];
}

export function tierName(score) {
  return tierFor(score).name;
}

/**
 * How an NPC feels about the player, combining faction standing with the
 * personal opinion that dialogue has already been building. Range maps to the
 * same tier names as reputation, so callers only need one vocabulary.
 */
export function npcStanding(state, npcId) {
  const factionId = NPC_FACTION[npcId];
  const base = factionId ? reputation(state, factionId) : 0;
  const personal = state.memory?.[npcId]?.opinion ?? 0;
  // Personal opinion is worth 10 points each, bounded so one conversation
  // cannot outshout a faction's whole standing.
  const combined = clampReputation(base + Math.max(-3, Math.min(3, personal)) * 10);
  return combined;
}

export function npcTier(state, npcId) {
  return tierFor(npcStanding(state, npcId));
}

/** True when the player's standing with an NPC's faction is at least `tierId`. */
export function atLeast(state, npcId, tierId) {
  const order = TIERS.map((tier) => tier.id);
  const want = order.indexOf(tierId);
  const have = order.indexOf(npcTier(state, npcId).id);
  if (want === -1 || have === -1) return false;
  return have >= want;
}

/**
 * Faction-wide news. When the player does something one faction cares about,
 * another may care in the opposite direction: that tension is what makes the
 * choices feel like they matter.
 */
export function spreadNews(state, { factionId, delta, rivals = [] }) {
  const applied = changeReputation(state, factionId, delta);
  const results = [];
  if (applied !== 0) results.push({ factionId, delta: applied });
  for (const rival of rivals) {
    const rivalApplied = changeReputation(state, rival.id, rival.delta);
    if (rivalApplied !== 0) results.push({ factionId: rival.id, delta: rivalApplied });
  }
  return results;
}

/** A short line describing the player's standing with a faction. */
export function standingLine(state, factionId) {
  const tier = tierFor(reputation(state, factionId));
  switch (tier.id) {
    case 'hostile':
      return 'You are not welcome here.';
    case 'cold':
      return 'They keep their distance from you.';
    case 'neutral':
      return 'They have no strong feelings about you.';
    case 'warm':
      return 'They are glad to see you.';
    case 'trusted':
      return 'They would vouch for you to anyone.';
    default:
      return 'They have no strong feelings about you.';
  }
}

/** The HUD view: every faction with its score and tier. */
export function reputationView(state) {
  return FACTION_IDS.map((factionId) => {
    const score = reputation(state, factionId);
    const tier = tierFor(score);
    return {
      id: factionId,
      name: FACTIONS[factionId].name,
      score,
      tier: tier.id,
      tierName: tier.name
    };
  });
}

/** NPC id → tier, for dialogue that needs the whole picture at once. */
export function allStandings(state) {
  const result = {};
  for (const npcId of Object.keys(NPC_FACTION)) {
    const tier = npcTier(state, npcId);
    result[npcId] = {
      score: npcStanding(state, npcId),
      // Same shape as reputationView: `tier` is the id, `tierName` the label.
      tier: tier.id,
      tierName: tier.name,
      faction: NPC_FACTION[npcId]
    };
  }
  return result;
}
