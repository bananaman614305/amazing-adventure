# Grunt status — Amazing Adventure

**Branch:** `grunt/continuous-adventure` (stacked on the Round 1 seed commit `afaf355`)
**Last checkpoint:** Round 2 complete, tested and committed as `69d08f4`
(publish requested for that HEAD; earlier Round 2 commit was `963ccb7`).

## Current task

Round 2 — "People and quests" — is finished, tested and committed. The game is
playable end to end: walking, five NPCs with routines and memory, a branching
questline with real consequences, two more quests, an inventory, a journal, a
day/dusk/night cycle and save/load.

## Decisions made this round

- Kept Round 1's code-generated art direction; no outside assets, so CREDITS
  still lists Three.js only.
- Split all story/quest/day/save logic into Three-free modules (`state.js`,
  `dialogue.js`, `daynight.js`, `terrain.js`) so the whole narrative can be
  tested in Node without a browser. `world.js`/`npcs.js`/`main.js` stay as the
  view layer.
- Dialogue is data with `do`/`next`/`end` choices rather than branching code, so
  a test can walk every reachable node.
- The oil quest branches on money versus a promise, and the promise has a
  lasting cost (Oswin's debt) that other dialogue reacts to and the player can
  settle. This is the first choice with consequences.
- Made Pip's quest require a real world action (standing on the north terrace
  during dusk) so quests are not all dialogue-only.
- Replaced the Round 1 `scripts/smoke.mjs` with a shared harness
  (`scripts/browser.mjs`) and a Round 2 test that plays the game through the DOM.
- Saves are hardened: any unreadable or partially invalid save is ignored or
  sanitised, and blocked storage falls back to memory rather than breaking.
- The dev server now binds `127.0.0.1` by default.

## Completed checks (all run this round, real results)

- `npm test` — **58/58 pass** (`node --test tests/*.test.mjs`): quest state
  transitions, both oil-payment branches, the debt and its settlement, key
  pickup/return, the dusk-only rule, inventory, journal counts, NPC memory
  clamping, save round-trips, corrupt/invalid saves, storage fallback, every
  reachable dialogue node across 9 quest states, ramp profile and terrace maths,
  clock phases and labels.
- `npm run test:browser` — **45/45 pass**, exit 0. Headless Chrome
  (`/opt/google/chrome/chrome`) with a private temp profile, `--no-sandbox`,
  `--disable-dev-shm-usage`, server on a free loopback port. It plays the full
  lantern quest (promise branch), Halden's key (world pickup, hint, return),
  Pip's dusk quest (grass attempt rejected, terrace attempt accepted), checks
  the ramp raises the player to y=2.90 and that the terrace side wall stops
  them, checks dialogue freezes movement, the day/dusk/night looks, NPC
  routines, save then reload then Continue restoring quests/inventory/coins/
  position/time, the final journal, the bench rest, and keyboard dialogue
  navigation. No console errors.
- Screenshots saved as real browser captures in `artifacts/`:
  `round2-plaza-day.png`, `round2-dusk.png`, `round2-night-plaza.png`,
  `round2-dialogue-mara.png`, `round2-dialogue-oswin.png`,
  `round2-key-pickup.png`, `round2-journal.png`, `round2-journal-final.png`.
  I verified their pixel statistics differ per phase (day sky blue, dusk warm
  orange, night navy) — I did not and cannot visually inspect images.

## Bugs found and fixed (by my own tests, this round)

1. `createSaveStore` used a supplied storage backend without probing it, so a
   throwing/blocked backend crashed instead of falling back.
2. Mara's oil-delivery dialogue passed arguments to `node()` in the wrong order.
3. Oswin's debt could only be settled after the lantern quest completed, not
   while it was still active.
4. Sable existed as an NPC but had no dialogue at all.
5. The terrace ramp rose sideways out of the plaza; rebuilt as a northward ramp
   and added step-height blocking so the 1.2m side cannot be walked up.
6. Sable's spot overlapped the bench, so the bench was unreachable.
7. Movement continued while dialogue was open; the player now freezes.
8. Found later in review: with the pointer locked, mouse clicks could never
   reach the dialogue choice buttons although the footer advertised clicking.
   Choices now have a visible keyboard highlight (W/S or arrows, E/Enter/1-5)
   and a click handler that works when paused; covered by three new checks.

## Known limitations / remaining issues

- One courtyard area only. Round 3 needs connected areas.
- Nobody talks to anyone else yet; NPC-to-NPC conversation is not started.
- Reputation is only per-NPC opinion (-3..3); there are no factions yet.
- No trading UI beyond the fixed oil price, no persuasion checks, no combat.
- No sound or music.
- The terrace is climbable but has little on it besides the view.
- The renderer runs at only a few fps under software rasterisation in the test
  environment; not measured on real GPU hardware.
- `puppeteer-core` is a dev dependency only; the game itself still needs no
  install. The browser test needs `npm install` and the host Chrome.

## Publication state

`/worker/state/outbox/publish.json` asks for `grunt/continuous-adventure` based
on `feature/corner-5a4c38eae323` at HEAD `69d08f4`, working tree clean. No
`publish-result.json` had appeared at this checkpoint, so publication is
**requested but not yet confirmed**.

## Next task (Round 3 direction)

A living world: a second connected area reached from the plaza (e.g. the market
lane through the north gate opened with Halden's key), factions with reputation
that changes dialogue, and NPC-to-NPC conversations the player can overhear.
Keep every new system pure-testable where possible and extend both test suites.
