# Grunt status — Amazing Adventure

**Branches:**
- `grunt/round3-living-world` at `57b9c1f` — published-request pending with the
  supervisor; tree clean, untouched since the request was written.
- `grunt/round4-lane-quest` — the lane's NPC and faction-gated quest, stacked on
  it. This is the branch this checkpoint describes.

**Last checkpoint:** Round 4 committed at `2498888` (branch `grunt/round4-lane-quest`).

## Publication queue (one request at a time)

`/worker/state/outbox/publish.json` currently asks for **`grunt/round3-living-world`
at `57b9c1f`**, base `grunt/continuous-adventure`. It is still pending — the only
`publish-result.json` on disk is Round 2's (`f98386f`, PR #4), which I have
checked is stale rather than a rejection. That request is valid and its tree is
clean, so I am leaving it in place rather than overwriting it.

`grunt/round4-lane-quest` (`2498888`) contains Round 3 plus the lane NPC and
quest. **When the Round 3 result lands, request Round 4 with base
`grunt/round3-living-world`** so it stacks as its own PR. Both branches are
pushed by the supervisor only, never by me.

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

## Chunk 2 — the north gate and the market lane

Round 2's publication is confirmed (PR #4). The supervisor had not yet picked up
the Round 3 publish request, so instead of idling I began the next owned outcome:
a second connected area.

- `src/areas.js` (pure): the plaza and lane extents, the gate opening, wall
  segments either side of it, lane props and the notice-board text. Gate state is
  *derived* from `questStatus(state, 'key')`, so it needs no new save field and
  cannot desynchronise.
- `src/world.js`: the north wall is now split around the gate, with stone piers
  and a liftable door. `environment.setGateOpen()` toggles the door mesh and
  adds/removes its collider. The lane is built as a walled corridor with a stall,
  crates, a barrel, a lamp post, hanging point lights that follow the day/night
  phase, and a readable notice board.
- `src/main.js`: `syncGate()` runs from the HUD refresh; the gate and notice
  board are interactables with hint lines; `document.body.dataset.area` is
  updated every frame so area-gated UI is never stale.
- Checks: `npm test` **107/107 pass** (9 new in `tests/areas.test.mjs`:
  non-overlapping areas, gate reachability, wall split, gate unlocking only
  after the key is returned, props inside the lane and clear of the gate path,
  notice text per tier and per toll outcome). `npm run test:browser`
  **56/56 pass, exit 0** (6 new: gate shut and solid before the key, open with
  its collider gone after, walking through into the lane, the notice board being
  interactable and showing text, and a locked gate stopping the player).

### Bugs found in this chunk

1. The crate at (12.6, -19.6) physically covered the notice board; the board
   moved to z = -23.2, with a test that every prop clears every other feature.
2. `document.body.dataset.area` was only updated on the throttled HUD refresh
   (every 0.2s), so it lagged the player's real area. It is now set per frame.
3. The ramp-walk browser check became flaky once the lane was added: the bigger
   scene drops software-GL rendering to about 3.3 fps, so a fixed walk budget was
   too short. The check now waits on the actual condition with a longer timeout.
   The acceptance threshold was not loosened to hide anything: it was tightened
   to the true terrace height (1.18) after confirming the ramp maths is exact.

## Chunk 3 — Wren and the faction-gated lane quest

The lane had no reason to exist beyond scenery, so it now has an NPC whose
content is locked behind the reputation system built last chunk.

- `src/state.js`: the `ledger` quest (`none → started → booked → recovered →
  done`), `ledgerUnlocked`, `startLedger`, `hearLedgerRumour`, `recoverLedger`
  and `returnLedger(state, 'name' | 'cover')`. Naming the trader is Watch +20,
  Market −10 and pays 4 coins; covering for him is Market +20, Watch −10 and
  pays nothing. A `toll_ledger` item was added to `ITEMS`.
- `src/npcs.js`: **Wren the Toll Clerk**, in the lane, with a routine per phase.
- `src/dialogue.js`: Wren's conversation, including the refusal branch at low
  standing, so the gate is visible to the player rather than silent.
- `src/areas.js` / `src/world.js`: `LEDGER_SPOT` and a real ledger object behind
  the far barrels, hidden until Wren points at them.
- `src/main.js`: the ledger pickup interactable; `syncPickups()` now runs every
  frame.
- Checks: `npm test` **112/112 pass** (5 new), `npm run test:browser`
  **62/62 pass, exit 0** (6 new: Wren exists in the lane and refuses at neutral,
  Warm standing unlocks the quest, the ledger appears only afterwards, it is
  interactable by the barrels, picking it up advances and hides it, and covering
  for the trader moves two factions in opposite directions).

### Bugs found in this chunk

1. **Wren had dialogue but no faction**, so her standing was permanently neutral
   and the "Warm Market standing" gate could never open. Fixed by adding her to
   `NPC_FACTION`, with a new test asserting *every* cast member has a faction.
2. The ledger item did not exist in the `ITEMS` registry; `addItem` threw. Its
   eager validation caught this immediately.
3. The ledger never became visible after Wren's dialogue, because pickup
   visibility was refreshed from `refreshHint`, which returns early while a
   dialogue is open — the exact moment the ledger is revealed. Visibility now
   syncs every frame.
4. Two Round 2 browser assertions were counts of a five-NPC, three-quest world.
   They were updated to six NPCs and to the three *plaza* quests specifically,
   rather than deleted, so they still assert something true.

## Next task

1. Publish `grunt/round4-lane-quest` as a stacked PR once
   `grunt/round3-living-world` is picked up.
2. Reduce draw calls (97 today, ~3.3 fps under software GL) by merging the static
   plaza and lane geometry into batched meshes.
3. Let reputation *refuse* content in the plaza too, not only in the lane, so
   standing matters where the player starts.
