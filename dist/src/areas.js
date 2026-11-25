// Areas and the north gate: the pure half of "more than one connected place".
//
// The plaza is the original courtyard. The market lane is a corridor north of
// it, reached through a gate in the north wall. Whether that gate is open is
// derived from quest state, so it needs no extra save field: returning
// Halden's key unlocks the lane and the door is open on every later load.

import { questStatus, getFlag, setFlag, addCoins, applyStanding, walkNightLight } from './state.js';

export const PLAZA = { id: 'plaza', name: 'The Plaza', minX: -17, maxX: 17, minZ: -17.5, maxZ: 17 };
export const LANE = { id: 'lane', name: 'The Market Lane', minX: 6, maxX: 14, minZ: -26, maxZ: -17.5 };

// The gate sits in the north wall at x = 9.5, spanning x 8..11.
export const GATE = {
  x: 9.5,
  z: -17,
  minX: 8,
  maxX: 11,
  width: 3,
  // How close the player must be for the gate to be usable.
  range: 2.6
};

export const AREAS = [PLAZA, LANE];

/**
 * The gate opens once Halden has his key back. That is the same fact that
 * warms the Watch, so the unlock reads as a consequence of the story rather
 * than an arbitrary switch.
 */
export function isGateOpen(state) {
  return questStatus(state, 'key') === 'done';
}

/** Why the gate is shut, for the hint line. */
export function gateHint(state) {
  if (isGateOpen(state)) return 'pass through the north gate';
  return 'the north gate is locked. Halden keeps the key.';
}

/** Which area a point is in, or null when it is outside every area. */
export function areaAt(x, z) {
  for (const area of AREAS) {
    if (x >= area.minX && x <= area.maxX && z >= area.minZ && z <= area.maxZ) return area.id;
  }
  return null;
}

/** True when a point is inside the gate opening in the north wall. */
export function insideGate(x, z) {
  return x >= GATE.minX && x <= GATE.maxX && z >= PLAZA.minZ - 0.6 && z <= PLAZA.maxZ;
}

/**
 * The wall segments either side of the gate opening. The gate itself is a
 * separate, toggleable collider, which is why the wall is split in two.
 */
export const NORTH_WALL_SEGMENTS = [
  { minX: -17, maxX: GATE.minX },
  { minX: GATE.maxX, maxX: 17 }
];

/** Props inside the lane, positioned so the corridor is not an empty tube. */
export const LANE_PROPS = [
  { kind: 'stall', x: 7.4, z: -21.5, width: 1.2, depth: 3.2, height: 1.0 },
  { kind: 'crate', x: 12.6, z: -19.6, width: 1.1, depth: 1.1, height: 1.1 },
  { kind: 'crate', x: 12.6, z: -21.0, width: 1.1, depth: 1.1, height: 1.1 },
  { kind: 'barrel', x: 6.9, z: -24.4, width: 1.0, depth: 1.0, height: 1.2 },
  { kind: 'post', x: 13.4, z: -24.8, width: 0.4, depth: 0.4, height: 3.0 }
];

/**
 * Dressing for the market lane: bunting overhead and sacks alongside the stall.
 *
 * The lane was a bare corridor with four props. These are chosen so they read as
 * a working market without narrowing the walkway: bunting hangs overhead at
 * 2.7 m (above head height, so it needs no collider at all), and the sacks sit
 * tight against the stall the lane already has. The clearance rule below is
 * enforced by a test rather than by eye, because a prop that quietly blocks the
 * way to the ledger would strand the player.
 */
export const LANE_BUNTING = [
  // Across the lane, each at a slightly different height so the strands read as
  // strung by hand rather than drawn with a ruler.
  { z: -19.4, y: 2.72, sag: 0.18, flags: 9 },
  { z: -21.6, y: 2.64, sag: 0.22, flags: 10 },
  { z: -23.8, y: 2.75, sag: 0.16, flags: 9 }
];

export const LANE_SACKS = [
  // Against the stall counter, which spans z -23.1..-19.9 at x 6.8..8.0.
  { x: 8.35, z: -20.1, radius: 0.26, height: 0.62 },
  { x: 8.42, z: -20.8, radius: 0.24, height: 0.55 },
  { x: 8.30, z: -23.0, radius: 0.27, height: 0.58 }
];

/** How far a lantern hangs below the strand it is tied to, and its body size. */
export const LANTERN_DROP = 0.07;
export const LANTERN_HEIGHT = 0.34;

/**
 * Lanterns hanging from the bunting, one per strand.
 *
 * These exist because of a real defect: the lane's three point lights used to
 * hover at y 2.6 with **no fixture at all**, so the lane glowed from empty air
 * and one of the three did not even sit over a strand. Each entry names the
 * strand it hangs from (`strandZ`) so the light is tied to a visible object, and
 * `laneLanternsHang()` refuses a lantern whose strand does not exist.
 */
export const LANE_LANTERNS = [
  { strandZ: -19.4, x: 9.1 },
  { strandZ: -21.6, x: 8.3 },
  { strandZ: -23.8, x: 9.9 }
];

/** Half-width of a sack's collider: the sack plus a little breathing room. */
const SACK_REACH = 0.32;

/** The narrowest point of the walkway, measured from the lane's free corridor. */
export const LANE_CORRIDOR = { minX: 6.4, maxX: 13.6 };

/**
 * True when every ground prop leaves at least `need` metres of walkway beside
 * it. Bunting is exempt because it hangs overhead: a player walks under it.
 *
 * This is the rule that keeps dressing from blocking the route to the ledger,
 * and it is checked against the real prop list rather than a hand-drawn map.
 */
export function laneDressingClear({ sacks = LANE_SACKS, corridor = LANE_CORRIDOR, need = 1.2 } = {}) {
  // Sacks are checked as the *widest continuous gap* through the lane at that
  // z, not as a per-prop distance from one wall. My first version measured the
  // wider side and passed a sack parked dead centre (4 m of clear floor on
  // either side), which is exactly the case the rule exists to reject.
  //
  // Treat the sack as one obstacle in a row of obstacles at that z, then take
  // the largest gap between adjacent obstacles (including the walls). A prop
  // is acceptable when that gap is at least `need` metres wide, because the
  // player only has to pass on one side.
  const reach = SACK_REACH;
  const laneMin = corridor.minX;
  const laneMax = corridor.maxX;
  const sorted = [...sacks].sort((a, b) => a.x - b.x);
  for (const sack of sacks) {
    // Only sacks at a similar z constrain the same crossing.
    const row = sorted.filter((other) => Math.abs(other.z - sack.z) < Math.abs(sack.x) + 1e9
      && Math.abs(other.z - sack.z) < 2.0);
    const spans = row.map((other) => [other.x - reach, other.x + reach]);
    let best = 0;
    let cursor = laneMin;
    for (const [lo, hi] of spans) {
      best = Math.max(best, lo - cursor);
      cursor = Math.max(cursor, hi);
    }
    best = Math.max(best, laneMax - cursor);
    if (best < need) {
      return { ok: false, at: { x: sack.x, z: sack.z }, widestGap: Number(best.toFixed(2)), need };
    }
  }
  return { ok: true, checked: sacks.length };
}

/** True when the bunting strands are above head height and need no collider. */
export function laneBuntingOverhead({ strands = LANE_BUNTING, headHeight = 2.0 } = {}) {
  for (const strand of strands) {
    // The lowest point of a sagging strand is y minus the sag.
    const lowest = strand.y - strand.sag;
    if (lowest <= headHeight) {
      return { ok: false, at: { z: strand.z }, lowest, headHeight };
    }
  }
  return { ok: true, checked: strands.length };
}

/** The height of a point on a sagging strand, at fraction `t` across the lane. */
export function strandHeightAt(strand, t) {
  const clamped = Math.min(1, Math.max(0, t));
  return strand.y - Math.sin(Math.PI * clamped) * strand.sag;
}

/** Where a lantern's body actually ends up, given the strand it hangs from. */
export function lanternPlacement(lantern, { strands = LANE_BUNTING, lane = LANE } = {}) {
  const strand = strands.find((candidate) => candidate.z === lantern.strandZ);
  if (!strand) return null;
  const span = lane.maxX - lane.minX;
  const t = span > 0 ? (lantern.x - lane.minX) / span : 0;
  const anchor = strandHeightAt(strand, t);
  const top = anchor - LANTERN_DROP;
  return {
    x: lantern.x,
    z: strand.z,
    anchorY: Number(anchor.toFixed(3)),
    topY: Number(top.toFixed(3)),
    centerY: Number((top - LANTERN_HEIGHT / 2).toFixed(3)),
    bottomY: Number((top - LANTERN_HEIGHT).toFixed(3))
  };
}

/**
 * True when every lantern hangs from a strand that exists, inside the lane, and
 * with its body above head height so it needs no collider.
 *
 * This is the guard the orphaned point lights never had: they floated at 2.6 m
 * with nothing above them, and one of the three sat at a z no strand crossed.
 */
export function laneLanternsHang({
  lanterns = LANE_LANTERNS,
  strands = LANE_BUNTING,
  lane = LANE,
  headHeight = 2.0
} = {}) {
  for (const lantern of lanterns) {
    const placement = lanternPlacement(lantern, { strands, lane });
    if (!placement) {
      return { ok: false, reason: 'no-strand', at: { z: lantern.strandZ } };
    }
    if (placement.x <= lane.minX || placement.x >= lane.maxX) {
      return { ok: false, reason: 'outside-lane', at: { x: lantern.x, z: placement.z } };
    }
    if (placement.bottomY <= headHeight) {
      return {
        ok: false,
        reason: 'too-low',
        at: { x: lantern.x, z: placement.z },
        bottomY: placement.bottomY,
        headHeight
      };
    }
  }
  return { ok: true, checked: lanterns.length };
}

// --- The lamp round --------------------------------------------------------
// Round 53 hung the lane lanterns from the bunting, but they lit themselves on
// a timer along with the plaza lamps. The lane was still a corridor you walked
// through, not somewhere you did anything. This is the smallest honest reason
// to stop: the lane's lanterns stay dark at dusk until someone walks the round
// and lights them, and the trade notices.

/**
 * The lane's lamp post: the far post the lane already has at x 13.4, z -24.8.
 * The round can only be walked from here, so reaching it is part of the chore.
 */
export const LANE_LIGHTING_POST = { x: 13.4, z: -24.8, range: 2.0, height: 3.0 };

/**
 * What one lamp round is worth. Deliberately small and paid by the market
 * traders, not a quest reward: the real cost is the walk and the clock, since it
 * can only be done after sundown and only once per night.
 */
export const LANE_LIGHT_REWARD = { coins: 2, factionId: 'trade', delta: 4 };

/**
 * The traders pay for the lamp round they asked for, not for every night after
 * it: a per-night reward with a night that repeats every four minutes is an
 * unbounded farm of coins and Market standing. So the purse is paid once, and
 * every later night is lit for free. What a lit lane keeps buying is the
 * gameplay round 56 added on top of it: Oswin's night order is only offered to
 * someone the traders have seen light the lane, and the round is what walks it.
 */
export function laneRoundIsPaid(state) {
  return Boolean(getFlag(state, 'laneRoundPaid'));
}

/**
 * Whether the lane lanterns can be lit right now, and if not, why. Both refusals
 * are real: daylight has its own light, and a night that is already lit must not
 * pay twice.
 */
export function laneLightingStatus(state, phase) {
  if (phase !== 'dusk' && phase !== 'night') {
    return { available: false, reason: 'The lane lanterns are only lit after sundown.' };
  }
  if (getFlag(state, 'laneLanternsLit')) {
    return { available: false, reason: 'The lane lanterns are already burning.' };
  }
  return { available: true, reason: '' };
}

/**
 * Whether the traders have ever seen this player light the lane. This is the
 * gate on Oswin's night order, and it is permanent: a trader who watched you
 * light the lane last night still knows you did, which is what makes the offer
 * reachable on a night when the lane happens to be dark at talking time.
 * Falls back to the current flag so a save written before this existed still
 * counts the night it was lit.
 */
export function laneRoundWasEverWalked(state) {
  return Boolean(getFlag(state, 'laneEverLit')) || Boolean(getFlag(state, 'laneLanternsLit'));
}

/**
 * Do the lane lanterns actually glow? Pure, so the visual wiring in world.js and
 * the browser checks can ask the same question the rule answers, instead of each
 * re-deriving "is it dark and has someone lit them".
 */
export function laneLanternsShouldGlow(state, phase) {
  if (phase !== 'dusk' && phase !== 'night') return false;
  return Boolean(getFlag(state, 'laneLanternsLit'));
}

/**
 * Dawn puts the lanterns out. The chore is per-night, so a previous night's help
 * must not light tonight's lane for free.
 *
 * Returns whether it actually cleared the flag, so the caller can tell the
 * player and the save only when something really changed. It is a separate rule
 * rather than an if inside syncPhase() because a status line that is silently
 * wrong at dawn is exactly the kind of bug this round is about.
 */
export function laneLanternsAtDawn(state, phase) {
  if (phase !== 'day') return { reset: false };
  if (!getFlag(state, 'laneLanternsLit')) return { reset: false };
  setFlag(state, 'laneLanternsLit', false);
  return { reset: true, message: 'Dawn. The lane lanterns have burned out and want lighting again tonight.' };
}

/**
 * Which way round the modelled lamp post must face so its arm and lantern hang
 * over the lane rather than into the wall.
 *
 * assets/lamp.glb is authored with the arm reaching +x (see
 * art/blender/make_lamp.py), while the lane's bunting lanterns hang along the
 * lane from `LANE_LANTERNS`. The post is a single prop, so instead of authoring a
 * second model the game rotates it: this returns the Y rotation in radians that
 * points the arm along the lane's hanging direction, and the world can be told
 * where the lantern ended up without re-deriving the geometry.
 *
 * Pure and parameterised on the authored arm reach so a re-proportioned model
 * cannot silently move the light away from the lantern again.
 */
export function lampArmFacing(post, target, armReach = LAMP_ARM_REACH) {
  if (!post || !target) return { rotationY: 0, lanternX: post ? post.x + armReach : armReach, lanternZ: post ? post.z : 0 };
  const dx = target.x - post.x;
  const dz = target.z - post.z;
  // atan2 of the target direction, then rotate the authored +x arm onto it.
  // Normalised through `+ 0` so an exactly-aligned target yields 0 rather than
  // -0: a negative zero would fail a strict equality and, worse, look like a
  // mistake in a later snapshot even though it rotates identically.
  const rotationY = -Math.atan2(dz, dx) + 0;
  const reach = Number.isFinite(armReach) ? armReach : 0;
  const length = Math.hypot(dx, dz);
  const unitX = length > 1e-6 ? dx / length : 1;
  const unitZ = length > 1e-6 ? dz / length : 0;
  return {
    rotationY,
    lanternX: post.x + unitX * reach,
    lanternZ: post.z + unitZ * reach
  };
}

/**
 * The bunting lantern nearest a point on the ground, as `{x, z}`.
 *
 * The lane's lamp post is rotated so its arm points at the lanterns it lights
 * rather than at whichever wall is nearest. There are three lanterns and one
 * post, so the fixture points at the closest of them: aiming at the far end of
 * the lane from a post 1.5 m away would swing the head nearly sideways for no
 * visual gain.
 *
 * Ties break toward the first declared lantern so the result is stable rather
 * than whichever the sort happened to leave first.
 */
export function nearestLaneLantern(post, lanterns = LANE_LANTERNS) {
  if (!post) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const lantern of lanterns || []) {
    const dx = lantern.x - post.x;
    const dz = lantern.strandZ - post.z;
    const distance = dx * dx + dz * dz;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { x: lantern.x, z: lantern.strandZ };
    }
  }
  return best;
}

/**
 * The lamp post's arm length in metres: the authored lamp.glb arm reaches +0.6
 * from the post origin, and the lantern hangs centred on the end of it.
 */
export const LAMP_ARM_REACH = 0.6;

/**
 * What the lamp post is labelled when the player is close enough to use it.
 * The post always has a label, even when the round cannot be walked, because a
 * hint that vanishes in daylight leaves the player standing at the one object
 * in the lane that answered a moment ago and now ignores them. When the round
 * is unavailable the label names the fixture and the interaction itself says
 * why -- see lightLaneLanterns(), whose refusal message is the explanation.
 */
export function laneLightingHint(state, phase) {
  const status = laneLightingStatus(state, phase);
  return status.available ? 'light the lane lanterns' : 'the lane lamp post';
}

// --- The Wick Round (round 60) ---------------------------------------------
// The plaza's side of the lamp round: Mara's late chore for the Keepers. The
// hotspot sits at the plaza lanterns, and the act is a dusk (or night) walk, so
// the chore costs the same thing the lane round costs: a real walk in the right
// phase. It answers at any hour so a noon visitor is told why there is nothing
// to do rather than finding an inert lantern.

/** Where the plaza lanterns stand, for the wick round's hotspot. */
export const WICKS_SPOT = { x: 2.6, z: -6.2, range: 2.0 };

/** Whether the wick round's hotspot should answer at all right now. */
export function wicksActive(state) {
  return questStatus(state, 'wicks') === 'started';
}

/** What the plaza lanterns are labelled when the player is in reach. */
export function wicksHint(state, phase) {
  const trimmed = getFlag(state, 'wicksTrimmed');
  if (trimmed) return 'the plaza lanterns';
  return (phase === 'dusk' || phase === 'night') ? 'trim the plaza lanterns' : 'the plaza lanterns';
}

/**
 * Walks the lamp round: lights the lane lanterns and pays for the help. Refused
 * in daylight or when they are already lit, so the reward cannot be collected
 * twice in a night. The caller owns the clock and the visual refresh.
 */
export function lightLaneLanterns(state, phase) {
  const status = laneLightingStatus(state, phase);
  if (!status.available) return { changed: false, message: status.reason };
  setFlag(state, 'laneLanternsLit', true);
  // The first round is the paid one. Later nights are lit for the lane's sake,
  // not for the purse: paying per night would let a repeatable clock mint
  // unlimited coins and Market standing out of nothing.
  const paid = !laneRoundIsPaid(state);
  if (paid) setFlag(state, 'laneRoundPaid', true);
  setFlag(state, 'laneEverLit', true);
  const standing = paid
    ? applyStanding(state, {
      factionId: LANE_LIGHT_REWARD.factionId,
      delta: LANE_LIGHT_REWARD.delta
    })
    : { changed: false, message: '' };
  const reward = paid ? LANE_LIGHT_REWARD.coins : 0;
  if (paid) addCoins(state, LANE_LIGHT_REWARD.coins);
  // The standing message is empty when the faction is already capped, so do not
  // append a dangling separator.
  // Walking the round and Oswin's night order are the same act, so the pure
  // rule advances them together. It needs no "was it already lit" guard: the
  // status check above already refuses an already-burning lane, so reaching
  // here means the player really did light a dark lane tonight. If they never
  // took his order `walkNightLight` is a no-op, which is why this lives here
  // rather than in a caller that might forget.
  const walked = walkNightLight(state);
  const parts = [paid
    ? `You light the lane lanterns. +${LANE_LIGHT_REWARD.coins} coins.`
    : 'You light the lane lanterns. The traders already paid for this round; tonight you light it for the lane itself.'];
  if (standing.message) parts.push(standing.message);
  if (walked.changed) parts.push('Oswin’s night order is walked; his stall will want the word.');
  const message = parts.join(' ');
  return { changed: true, message, reward, paid, standing, walked: walked.changed };
}

/** Where the missing toll ledger is tucked away, behind the far barrels. */
export const LEDGER_SPOT = { x: 7.6, z: -25.0, range: 1.7 };

/**
 * The work board in the plaza. Unlike a refused NPC, this is usable at any
 * standing, so a player can build goodwill *before* they need it — which is how
 * a real reputation works. Positioned by the fountain, on the walk between the
 * gate and Mara, where the player will actually pass it.
 */
export const JOB_BOARD = { x: -3.4, z: 8.6, range: 2.0, height: 1.9 };

/** The notice board in the lane that the player can read. */
export const NOTICE_BOARD = { x: 13.3, z: -23.2, range: 1.9, height: 1.9 };

/**
 * A short read for the notice board. Its text reflects faction standing, so the
 * new area is not just scenery: it reports on the systems built last round.
 */
export function noticeText(state, standing) {
  if (standing === 'hostile') return 'A watch notice: “Certain visitors are to be escorted.” Your name is underlined twice.';
  if (standing === 'cold') return 'A watch notice: “The gate closes at dusk.” Someone has added, in pencil, “Ask first.”';
  if (standing === 'trusted') return 'A watch notice: “The gate stays open for friends of the Watch.” Someone has written your name in the margin.';
  if (questStatus(state, 'toll') === 'waived') return 'A trader’s notice: “Toll waived by the Watch. Thank you.” It is unsigned, and looks freshly pinned.';
  if (questStatus(state, 'toll') === 'collected') return 'A watch notice: “Market toll collected in full.” Someone has drawn a small, unflattering face beside it.';
  return 'A trader’s notice: “Stalls open at dawn. No credit. Ask Oswin if you disagree.”';
}
