// Reputation refusals: the other half of the standing system.
//
// Until now standing only ever *opened* doors — Wren hands out her ledger above
// Warm Market, and nothing anywhere turned the player away. A reputation that
// cannot be lost in any practical sense is not really a reputation, so this
// module gives it teeth: an NPC can refuse to serve you, and say why.
//
// Kept pure so the rules are unit-testable and identical everywhere they apply.

import { TIERS, npcTier, npcStanding, FACTIONS, NPC_FACTION } from './factions.js';

/** Tier order, lowest first. Shared with factions.js rather than re-listed. */
const TIER_ORDER = TIERS.map((tier) => tier.id);

/** Rank of a tier id, or -1 when it is not a real tier. */
export function tierRank(tierId) {
  return TIER_ORDER.indexOf(tierId);
}

/**
 * True when `tierId` is below `required` — i.e. the player is not good enough
 * yet. `required` is the *lowest tier that would be served*: a rule of 'cold'
 * turns away Hostile only, while 'warm' turns away Cold, Neutral and Hostile.
 */
export function belowTier(tierId, required) {
  const have = tierRank(tierId);
  const want = tierRank(required);
  if (have === -1 || want === -1) return false; // unknown ids never refuse
  return have < want;
}

/**
 * Whether an NPC refuses the player, and why.
 *
 * `rules` is a list of { npcIds, required, reason, until } describing who turns
 * away whom. `required` is the lowest tier that would still be served, so
 * 'warm' refuses everyone below Warm. The first matching rule wins, so put more
 * specific rules first. Returns null when nobody refuses, the common case.
 */
export function refusalFor(state, npcId, rules = []) {
  const tier = npcTier(state, npcId).id;
  for (const rule of rules) {
    if (rule.npcIds && !rule.npcIds.includes(npcId)) continue;
    if (!belowTier(tier, rule.required)) continue;
    // A rule can be lifted by story progress, so a refusal is never permanent
    // for a player who is willing to put the work in.
    if (typeof rule.until === 'function' && rule.until(state, npcId)) continue;
    // A refusal must never strand the player. `exempt` marks work that has to
    // stay possible even when the NPC despises them -- buying the oil that the
    // first quest needs, returning a key that unlocks the only route north.
    // Without this, tanking a faction early would soft-lock real progress.
    if (typeof rule.exempt === 'function' && rule.exempt(state, npcId)) continue;
    const reason = typeof rule.reason === 'function' ? rule.reason(state, npcId) : rule.reason;
    return {
      npcId,
      tier,
      required: rule.required,
      factionId: NPC_FACTION[npcId] ?? null,
      factionName: NPC_FACTION[npcId] ? FACTIONS[NPC_FACTION[npcId]].name : null,
      reason,
      // How far below the floor the player is, for a hint line.
      shortfall: Math.max(0, tierRank(rule.required) - tierRank(tier))
    };
  }
  return null;
}

/**
 * A one-line explanation the player can act on: who is unhappy, and what would
 * fix it. Deliberately names the faction so the Standing panel is discoverable
 * from the refusal itself.
 */
export function refusalHint(refusal) {
  if (!refusal) return '';
  if (refusal.shortfall >= 2) {
    return `${refusal.factionName} will not deal with you at all. Something has to change first.`;
  }
  return `${refusal.factionName} are wary of you. A little goodwill would go a long way.`;
}

/** Human-readable standing, for the refusal line itself. */
export function standingLabel(state, npcId) {
  const tier = npcTier(state, npcId);
  const score = npcStanding(state, npcId);
  return `${tier.name} (${score >= 0 ? '+' : ''}${score})`;
}
