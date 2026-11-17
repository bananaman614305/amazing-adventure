# Grunt status — Amazing Adventure

**Branch:** `grunt/round3-living-world`, stacked on the published Round 2 HEAD
`f98386f` (PR #4, confirmed published).
**Last checkpoint:** Round 3 implemented, tested and committed as `332d710`.

## Current task

Round 3 — "a living world" — factions with reputation, choices that pull two
ways, a fourth quest that forces a side, and NPCs who talk to each other while
the player can overhear them.

## Round 2 publication (resolved)

The earlier `needs_attention` result was correct and my fault: my final
verification run had regenerated the committed screenshots, so the tree was
dirty at the publish HEAD. I restored the artifacts, confirmed a clean tree, and
the supervisor published:

    {"status":"published","head":"f98386f","branch":"grunt/continuous-adventure",
     "pullRequest":4,"url":".../pull/4"}

PR #4 is left open for the human. Round 3 continues on a new stacked branch
rather than waiting for it to merge.

## Decisions made this round

- Reputation is a *second* axis alongside the existing per-NPC opinion, not a
  replacement. `npcStanding` = faction score + (personal opinion × 10), clamped,
  so one good conversation cannot outshout a whole faction.
- Factions react in opposition. Paying the toll pleases the Watch and angers the
  Market; waiving it does the reverse. This is the concrete way "choices affect
  one another" ships this round instead of being described.
- The toll quest is gated on returning Halden's key, so reputation progression
  is sequential rather than a menu of free options.
- Waiving the toll requires Warm standing with the Watch. It is a *check*, not a
  dice roll, and it is tested — talking is not a get-out-of-jail card.
- Ambient NPC dialogue is deterministic from `(state, phase, pair)`. No
  `Math.random` in the sim, so saves stay consistent and the whole system is
  unit-testable. The occasional/random *timing* is a hash of the pair and clock.
- Fixed the artifact trap from last round at the source: browser tests now write
  to a temp directory unless `RECORD_ARTIFACTS=1` is set.

## Completed checks (real results this round)

- `npm test` — **98/98 pass** (was 58 at Round 2 start), re-run after a final
  unused-import cleanup. New coverage:
  `tests/factions.test.mjs` (24 cases: clamping, tier boundaries, NPC standing
  math, rival news, every quest's reputation outcome, the toll dilemma's
  mutual exclusivity and gating, greeting grammar, save round-trip and corrupt
  reputation) and `tests/ambient.test.mjs` (13 cases: pair selection, range and
  proximity rules, exclusion of busy NPCs, determinism, script choice per quest
  outcome and phase, earshot, exchange counting).
- `npm run test:browser` — **50/50 pass, exit 0** in real headless Chrome with a
  private temp profile. Round 2's 45 checks still pass, plus 5 new ones:
  reputation earned from quest outcomes, the standing panel listing three
  factions with tiers, the toll dilemma shifting two factions in opposite
  directions, an overheard exchange rendering for a nearby player, and that text
  hiding when the player walks away. No console errors.
- Screenshots: `artifacts/round3-overheard.png` and
  `artifacts/round3-standing.png` are new, real captures. Round 2's screenshots
  are byte-identical to what PR #4 carries (restored after the recording run).
  Verified programmatically at 1280×800 with 496 and 614 distinct sampled
  colours respectively. I did not visually inspect them.

## Bugs found and fixed this round

1. `allStandings()` used `tier` for a different key than `reputationView()`, so
   the HUD view and the NPC view disagreed. Both now return `{ tier, tierName }`.
2. Reputation greetings had three separate grammar defects — "TheKeepers"
   (missing space), "Every Keepers eye" (wrong number) and "for watch" (missing
   article, plus "The watch are" with a plural verb). Fixed with explicit
   `member`/`collective` noun fields per faction and tested for all three
   factions at all five tiers.
3. The toll's pay option could not be reached without leaving and re-entering
   the conversation; both resolutions are now offered in one exchange.
4. The overheard overlay never re-rendered when the player walked out of
   earshot, so text lingered. Earshot is now checked every frame.
5. Running the browser test rewrote committed screenshots and dirtied the tree
   (the cause of the Round 2 publish rejection). Fixed with a temp-dir default.

## Known limitations / remaining issues

- Still one courtyard. Connected areas (the market lane past the north gate) are
  the biggest remaining Round 3 gap.
- Factions do not yet *lock* content: no quest is refused purely for low
  standing, and there is no faction-exclusive item or ending.
- Ambient conversations are short (2–3 lines) and always between fixed pairs.
- No trading UI beyond fixed prices, no persuasion mechanic, no combat, no sound.
- Reputation currently only moves through quests, not through ambient choices.
- Only a few fps under software rasterisation in this environment; not measured
  on real GPU hardware.

## Next task

Add a second connected area reached through the north gate (opened by returning
Halden's key), with its own NPC and a faction-locked quest, and let reputation
refuse or unlock that content. Keep new logic in pure modules with tests, and
extend the browser suite for the new area's collision and interaction.
