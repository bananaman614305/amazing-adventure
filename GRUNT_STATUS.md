# Grunt status — Amazing Adventure

**Branches:**
- `grunt/round3-living-world` — published inside PR #5.
- `grunt/round4-lane-quest` at `65c6263` — **published as PR #5**
  (`https://github.com/bananaman614305/amazing-adventure/pull/5`), left open for
  the human.
- `grunt/round5-mobile-preview` — the phone playtest candidate. This is the
  branch this checkpoint describes.

**Last checkpoint:** the mobile playtest candidate, committed and verified; see
the publication section at the end of this file.

## Round 5 — playable phone preview (owner priority)

The owner asked for a playable phone preview: simultaneous left-thumb movement
and right-thumb drag-to-look, onscreen interaction, journal and pause, the first
quest and save/load reachable by touch, and adaptive resolution on small screens
— without breaking desktop keyboard and mouse.

### What was built

- `src/touch.js` (pure, 14 unit tests): analog stick maths with a deadzone that
  ramps rather than snapping, magnitude preserved so half-push walks at half
  speed, clamped knob, touch look deltas, pitch clamping, and
  `wantsTouchControls` so a touchscreen *laptop* keeps mouse and keyboard.
- `src/player.js`: an analog input channel beside the keyboard that cannot stack
  with it (the larger request wins, so holding W and pushing the stick is not
  double speed), touch mode that enables play without pointer lock, `applyLook`.
- `index.html`: a stick that appears where the thumb presses, a right-side look
  zone, Talk/Use labelled per action, Journal and Pause with safe-area insets, a
  pause sheet, a dialogue ✕ button, and a phone layout for dialogue and panels.
- `src/main.js`: multi-touch with pointer capture, per-frame interact-button
  sync, a pause that genuinely freezes and blocks input, auto-pause on tab hide
  that keeps an open conversation, and touch-event fallbacks bound only when
  Pointer Events are missing (so one finger never drives two handlers).
- `src/version.js`, `RELEASE.md`, `vendor/`: the candidate is **self-contained**.
  Three.js r160 is vendored instead of loaded from a CDN.

### Checks actually run

- `npm test` — **151/151 pass** (14 new touch, 6 new version/self-containment).
- `npm run test:browser` — **70/70 pass, exit 0** (desktop regression).
- `npm run test:mobile` — **117/117 pass, exit 0** across four emulated profiles
  (iPhone 13 portrait, iPhone 13 landscape, Pixel 7, iPhone SE), driving real
  multi-touch events through CDP rather than synthetic clicks. That is 29 checks
  per profile, including pause-while-talking, the dialogue close control being
  hit-testable on top of its own centre, and a fresh overlay-start path.
- Self-containment: a test aborts every off-origin request and the game still
  plays; `index.html` has zero remote URLs; a Node test also asserts it.
- Evidence: `artifacts/mobile-*.png`, four real captures of live play at dusk
  with the touch UI visible. Verified programmatically as 1170x2532, 2532x1170,
  1071x2379 and 640x1136 with 654/833/664/583 distinct sampled colours. I did not
  visually inspect them; I am text-only.

### Bugs found and fixed this round

1. **Tapping the overlay background started the game without touch mode** — a
   phone player was left on an overlay that never cleared. Fixed on every start
   path; the mobile suite now tests the overlay tap specifically.
2. **Dialogue choices were rendered off-screen at x = -146.** The mobile rule
   set `left`/`right` but never cleared the desktop `transform: translateX(-50%)`,
   so choices were shoved left and the stick zone swallowed the taps. This was
   invisible until I tightened a weak assertion (`text !== undefined`, which
   passes on an empty string) to require that a tap actually changed something.
3. **The Journal/Pause cluster covered the dialogue choices** on short screens;
   the dialogue now layers above the touch controls and the cluster stops
   accepting input while talking.
4. **`pointerleave` reset the stick mid-drag**, which would stutter walking on
   real hardware. Released on `pointerup`/`pointercancel`/`lostpointercapture`.
5. **Only one way out of the pause sheet**, and no Escape handling for it; both
   fixed, and the sheet said Pause was top-right when it is bottom-right.
6. **Backgrounding the tab mid-dialogue discarded the conversation.** It is now
   kept, and only the world stops.
7. `package.json` said version `0.2.0` while the game was `0.3.0`; a test now
   holds them to the same release line.
8. **Pausing while a dialogue was open did not pause anything.** The handler set
   `player.frozen = true` and *then* called `closeDialogue()`, which clears
   `frozen`, so the world kept running behind the pause sheet. Closing the
   dialogue now happens first, and a test asserts the paused state is really
   frozen. Found by deliberately probing stuck-state scenarios rather than by a
   test I had already written.
9. The iPhone SE evidence screenshot came out almost black: adaptive resolution
   had walked the pixel ratio down furthest on the smallest viewport. Evidence
   capture now pins native resolution first, so all four screenshots are sharp,
   bright frames of live play (579-656 distinct sampled colours).

### Honest limits on device testing

No physical phone and no real iOS Safari were available. WebKit could not be
installed (`npx playwright install webkit` fails on missing system libraries I am
not permitted to install). All mobile testing is **Chrome device emulation**,
which exercises the DOM, CSS, touch plumbing, viewport behaviour and control
logic, but is not Safari. `RELEASE.md` states this precisely, per claim. Real
device verification is the obvious next step before calling the preview final.

## I misread a rejection, and it was my fault

`publish-result.json` said `{"status":"needs_attention","reason":"Commit the
clean working tree before publication"}`. For several resumes I dismissed it as
a stale Round 2 file, because its `head` was not mine. It was a real rejection
of my Round 3 request, and the timeline shows exactly why:

| Time | What happened |
| --- | --- |
| 22:48 | I requested publication of `grunt/round3-living-world` @ `57b9c1f`. Tree was clean. |
| 23:17–23:46 | I moved the checkout to a **new** branch and kept committing there. |
| 23:47 | The supervisor looked at the working tree: HEAD and branch no longer matched the requested commit. Rejected. |

Two lessons, both now policy for me:

1. **The result file is only stale if its `head` is a commit I already shipped
   and nothing of mine is outstanding.** Otherwise treat it as live. I should
   have compared `head` against my request, not against "did it mention my
   branch".
2. **Never commit or switch branches while a publication request is pending.**
   The request names a branch *and* a commit; changing the checkout under it
   invalidates it. Do the work, commit, request, then stop.

## Publication queue

One request now, covering all the unmerged work: **`grunt/round4-lane-quest` @
`20e6e14`**, base `grunt/continuous-adventure` (the Round 2 branch, PR #4, still
unmerged). It contains Round 3, the market lane and gate, Wren's ledger quest,
and adaptive resolution — `grunt/round3-living-world` is an ancestor, so nothing
is lost by superseding its rejected request.

Consolidating to one PR is deliberate: a human reviewer already has PR #4 open
and unmerged. A three-deep stack of unmerged PRs would be worse for them than
one coherent round.

## Earlier current task (Round 3 — completed)

Round 3 — "a living world" — factions with reputation, choices that pull two
ways, a fourth quest that forces a side, and NPCs who talk to each other while
the player can overhear them. Published in PR #5.

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

## Chunk 4 — keeping the game playable on weak hardware

Measured before changing anything, rather than guessing:

| Change | fps |
| --- | --- |
| baseline (1280x800, software GL) | 3.2 |
| shadows disabled | 3.3 (no gain) |
| every material swapped to Lambert | 3.7 |
| pixel ratio 0.5 | 8.1 |
| **adaptive resolution, settled** | **7.1** |

So the bottleneck is fill rate, not draw calls or material cost. The fix is
adaptive resolution, which also happens to be the right fix for real weak
hardware (integrated GPUs, high-DPI laptops).

- `src/perf.js` (pure): `clampRatio`, `nextRatio`, `smooth` and a
  `createAdaptiveResolution` state machine with an integer ratio grid, streak
  hysteresis and spike clamping.
- `src/main.js`: samples the real frame time each frame and applies the ratio;
  `P` toggles it; the setting persists in `localStorage`; the current ratio is
  exposed on `document.body.dataset.pixelRatio` and via
  `window.amazingAdventure.resolution` for testing.
- Browser evidence screenshots pin native resolution for the capture
  (`capture()` helper), because otherwise the evidence would be a blurry upscale
  of the reduced buffer. That is an honest capture of the scene, not of the
  adaptive buffer.
- Checks: `npm test` **125/125 pass** (13 new in `tests/perf.test.mjs`),
  `npm run test:browser` **66/66 pass, exit 0** (4 new: adaptive is on and
  reported honestly, slow frames really did lower the ratio, turning it off
  restores native and remembers the choice, turning it back on works).

### Bugs found in this chunk

1. **The controller was blind on the machines that need it most.** I first
   *discarded* frame times over 250ms as "not real frames". This environment
   renders at ~310ms per frame, so every sample was thrown away and the ratio
   never moved. Long samples are now clamped instead, so genuine slowness
   registers while a tab-restore spike still cannot dominate the average.
2. My own `clampRatio` used a 0.15 step from 0.5, which could never land on 1.0
   or 2.0. It now uses an integer grid of 0.05 steps.
3. Two perf tests initially encoded *fixed* frame times, which is unphysical for
   a fill-rate-bound game — lowering the resolution has to make frames faster,
   or convergence is impossible by construction. The tests now model frame time
   as proportional to pixel count, and assert that the controller settles.

## Chunk 5 — the journal was lying about what happened

Found by read-only review while a publish request was pending. `journalEntries()`
resolved a completed quest to `quest.steps[quest.steps.length - 1]`, i.e. the
last *listed* step. For the two quests with alternative endings that is simply
the wrong sentence:

| Quest played | Journal said |
| --- | --- |
| toll **paid** | "You talked Halden into waiving the toll. Oswin owes you again." |
| toll waived | same (correct by luck) |
| ledger, name given | "You have the toll ledger. Wren is at her stall in the lane." |
| ledger, trader covered | same |
| cheer completed | "You watched the lanterns… Tell Pip." |

So paying a toll was recorded as waiving it, and finished quests still read as
instructions.

- `src/state.js`: quests now declare completion text — `done` for linear quests
  and `doneBy: { branch: text }` for branching ones. `finishToll` and
  `returnLedger` record the branch in a new `state.outcomes` map before
  collapsing the status to `done`, and `journalEntries` prefers the recorded
  branch. `deserialize` sanitises `outcomes` against the known branches, so a
  corrupt or invented branch is dropped rather than displayed. Old saves with no
  recorded outcome fall back to the last step, which keeps them working.
- Checks: `npm test` **131/131 pass** (6 new: paid is never journalled as
  waived, waived never as paid, the two ledger endings differ and are truthful,
  every quest declares distinct completion text for every ending, outcomes
  survive a save round-trip, and a legacy save still opens a journal entry).
  `npm run test:browser` **70/70 pass, exit 0** (4 new: paid text, waived text,
  no instructional text on a finished quest, and the rendered journal panel
  itself showing what really happened).

## Current task

Round 6 — mobile resilience. The v0.3.0 playtest candidate is published as PR #6.
This round hardens the phone build against the way mobile WebGL actually fails:
the browser dropping the graphics context, which previously left a permanently
blank canvas with no explanation.

### What Round 6 adds

- `src/resilience.js` (pure, 9 unit tests): a context-loss recovery state machine
  with an attempt budget, a timeout and explicit give-up rules, plus a
  panic-shed predicate for catastrophically slow frames.
- `src/main.js`: real `webglcontextlost` / `webglcontextrestored` handling. On
  loss the game **saves immediately** (the save data is plain JSON and is
  unaffected by the renderer, so a renderer fault must never cost progress),
  shows a recovery sheet, and clears it when the context returns. If the context
  does not return within the timeout the sheet says so and offers a reload.
- `index.html`: the `#context-lost` recovery sheet, styled to match the pause menu.
- `src/perf.js`: added `force(ratio)` so emergency resolution shedding goes
  through the controller and the ratio it reports stays truthful.

### Bugs found and fixed this round

1. **The recovery sheet had two buttons that did nothing different** — "Try
   again" and "Reload the game" both reloaded the page, because once the context
   is gone a reload is the only way back. A button that promises a retry it
   cannot perform is a lie to the player, so the dead button is gone and the
   remaining one is honestly labelled.
2. **My own new test asserted almost nothing.** `hasReload` was computed as
   `typeof ...onclick !== 'undefined' || element !== null`, which is true for any
   element that exists — the same weak-assertion trap I had already fixed once
   this project. It now measures the button's real bounding box, computed
   visibility, and label, and requires a 44 px touch target.
3. **Panic-shedding disagreed with the adaptive controller.** My first version
   set the renderer's pixel ratio directly, so the controller reported 1 while
   the renderer actually ran at 0.5. The desktop suite caught it immediately
   (`adaptive resolution is on and reported honestly`). Fixed by adding
   `force()` to the controller and routing emergency shedding through it, with
   tests asserting the two agree.

### A release manifest the Play tab can read

The owner wants to launch the preview from a Play tab. Rather than leaving the
hosting step to guess, the release now describes itself:

- `src/manifest.js` (pure): entry point, the exact required-file list, directories
  not needed at runtime, control scheme, and `verifyManifest()` which fails loudly
  if a listed file is missing.
- `release-manifest.json` at the repo root, generated by
  `npm run release:manifest`, committed, and held to the real files by a test so
  it cannot drift. Exposed at runtime as `window.amazingAdventure.manifest`.
- 9 new unit tests: every required file exists, every `src/*.js` is listed (a
  forgotten module would 404), the manifest agrees with `version.js`, required
  files are not also in the omitted list, `verifyManifest` reports exactly the
  missing file, no engine file imports from `tests/`/`scripts/`/`artifacts/`, and
  the committed JSON is not stale.
- Verified the list is sufficient for real: copied **only** those 19 files
  (868 KB) into an empty directory, served it with a plain static server, and
  played it with every off-origin request aborted — 0 external requests, 0 failed
  requests, 0 console errors, two-thumb walk-and-look working, Talk button
  appearing at Mara.

### Checks actually run this round

- `npm test` — **171/171 pass** (was 151): 9 resilience cases, 2 `force()` cases
  and 9 manifest cases (plus a 10th added alongside).
- `npm run test:browser` — **70/70 pass, exit 0**.
- `npm run test:mobile` — **137/137 pass, exit 0** across four emulated profiles.
  Five new checks per profile drive the real `WEBGL_lose_context` extension: the
  recovery message appears, progress is saved at the moment of loss, the recovery
  sheet offers a *usable* reload button (visible, labelled, at least 44 px tall),
  the sheet tells the player their progress is kept, and the game recovers when
  the context returns.
- **Totals: 378 checks — 171 unit, 70 desktop, 137 mobile.**

## Next steps

1. **Get the candidate onto real hardware.** The biggest honest gap remains that
   no physical phone or iOS Safari was available here; a real-device pass should
   confirm touch gestures, safe-area insets on a notched phone, and frame rate on
   an actual GPU.
2. **Surface a play-test entry point in the dashboard.** The owner wants to launch
   the preview from a Play tab; the release metadata the Play tab needs is already
   in `RELEASE.md` and the publication request.
3. Then return to game content: let reputation refuse plaza content too, and give
   the two areas something to carry between them so the lane is not a dead end.
