# Amazing Adventure

A first-person 3D adventure game for the browser, built with Three.js. It has many NPCs, deep storylines, branching quests and complex interactions. We aim for the best visuals a browser can show.

This repository is also a test. **Grunt builds the whole game on free AI sources only.**

## Why this project exists

Amazing Adventure tests whether Grunt can deliver a large, long-running project using free model sources alone. The test covers these points:

1. **Free sources only.** Every model call goes through Grunt's free source pool. No paid model writes or reviews game code.
2. **Switching sources when one runs dry.** When a source runs out of quota, Grunt moves the task to another source and continues. It does not start the task again.
3. **Efficient use.** Each task stays on one source for as long as that source works. This keeps the prompt cache warm. Grunt does not switch sources without a reason.
4. **Parallel work.** Grunt splits work into independent tasks and runs them at the same time where it can.
5. **Getting new sources.** When tokens run low, Grunt looks on the web for new free providers and adds them. It uses one account per provider, because Grunt serves one user. It never makes extra accounts on the same provider.
6. **Using the 12-hour pool.** Every 12 hours, the provider scout adds newly verified free sources to the automatic pool. Grunt starts using them as they appear.

## Who does what

| Who | Role |
| --- | --- |
| **Grunt** | The only builder. Grunt writes all game code, makes all design and art decisions, plans each round, tests its own work and reviews it. No other agent writes, edits or reviews game code. |
| **Ruby** | Works on Grunt itself, not on the game. Ruby watches how Grunt switches sources, uses its quota and refills its pool, and fixes problems in the Grunt repository (`bananaman614305/grunt`). Ruby steps in only when Grunt itself needs debugging. |
| **bananaman614305** | Owns the project and makes the final calls. |

Other agents in this chat: do not write, change or review code in this repository. If you see a problem, report it in the chat and Grunt will handle it.

## How the game is built: in rounds

Grunt builds the game in rounds. Each round leaves a playable game that is deeper than the last one. Grunt decides the exact scope of each round. The outline below is the direction, not a fixed list.

- **Round 1: walk the world.** First-person movement and camera, one small explorable area, lighting, and a few NPCs you can talk to. Simple dialogue. The game runs in the browser.
- **Round 2: people and quests.** More NPCs, each with a name, role, daily routine and memory of the player. The first branching questline. An inventory. Save and load.
- **Round 3: a living world.** Several connected areas. Factions and reputation. NPCs react to what the player has done and talk to each other. Several questlines whose choices affect one another.
- **Round 4 and later: depth and polish.** Longer storylines with lasting consequences, more complex interactions (trading, persuasion, companions, combat or puzzles, whatever fits the story), better graphics and effects, sound, and performance work.

Every round ends with a pull request that Grunt has tested in a real browser, with screenshots.

## Play it on a phone

Open the game on a phone and press **Play**. The touch layer appears by itself on
a device with a coarse pointer and touch points, and stays out of the way on a
desktop.

- **Left thumb**, anywhere on the left: an analog walk stick that appears where
  you press, so you never have to hunt for it.
- **Right thumb drag**: look around. It works *at the same time* as walking.
- **Talk / Use**: appears when something is in reach, labelled for the action.
- **Journal** and **Pause**: bottom right. Pause saves and stops the world.

Desktop controls are unchanged: WASD, mouse look, Shift to run, E to interact,
J journal, Esc pause, P to toggle adaptive resolution.

### A self-contained candidate

The game is static files with no build step. Three.js r160 is **vendored** at
`vendor/three.module.min.js` rather than loaded from a CDN, so the preview works
offline and has no external runtime dependency. `node_modules/` is only needed to
run the browser tests.

## Run it (Round 3)

One command starts the game:

```
npm start
```

Then open http://127.0.0.1:8000 in a browser, click **Click to play**, and use
W A S D to walk, the mouse to look, E to talk or interact, J for the journal,
and R on the bench to rest until the next phase. Esc pauses. Set `PORT` to use a
different port. The server binds loopback only.

No install or build step is needed to play; Three.js is pinned in the import map
and loads from a CDN. The test suites need `npm install` for `puppeteer-core`
(dev-only) and use the host Chrome via `CHROME_PATH`.

```
npm test          # pure logic tests (no browser)
npm run test:browser   # drives the real game in headless Chrome, writes artifacts/
```

## Technical direction

- **Engine:** Three.js, running in the browser.
- **Art:** Grunt chooses. It can use free asset packs (CC0 or other licenses that allow use), free 3D models, generated textures, or a mix. Every outside asset is listed with its source and license in `CREDITS.md`.
- **NPC dialogue and story:** Grunt decides how to make NPCs and quests deep. Story facts, quest state and NPC memory must stay consistent across a playthrough and survive save and load.
- **Architecture:** keep it as simple as the game allows.

## Rules

- Grunt is the only agent that touches the game code.
- Use free model sources only.
- Use one account per free provider. Never make duplicate accounts.
- Every asset must have a license that allows its use, and be credited.
- Each round must leave the game playable.

## Round 3 — a living world

Round 3 gives the plaza memory with consequences and lets its people talk to
each other.

- **Factions and reputation.** The Keepers, the Market and the Watch each track
  standing from -100 to 100 across five tiers (Hostile, Cold, Neutral, Warm,
  Trusted). Your faction standing combines with each NPC's personal opinion of
  you, and NPC greetings change accordingly — a Trusted Mara talks differently
  to a Hostile one.
- **Choices pull two ways.** Delivering the lantern oil pleases the Keepers; if
  you paid with a promise instead of coins, the Market cools until Halden's
  voucher repairs it. Pip's favour earns Market goodwill.
- **The Market Toll.** A fourth quest, gated on returning Halden's key. You
  either pay Oswin's outstanding toll (Watch +20, Market -15) or talk Halden
  into waiving it, which needs Warm standing with the Watch (Market +20,
  Watch -10). The two resolutions are mutually exclusive, and the standing
  panel shows the result.
- **NPCs talk to each other.** Nearby NPCs occasionally strike up an exchange
  drawn from a state-aware script bank: they gossip about an unpaid debt, the
  toll, the lanterns or the hour. Walk close and you overhear it on screen;
  walk away and it fades. The scripts are deterministic from game state, so they
  are testable and never desynchronise a save.

### A second connected area

Returning Halden's key unlocks the **north gate** in the plaza wall, and beyond
it lies **the market lane** — a narrow back street with a trader's stall, crates,
a barrel, a lamp post and a notice board. The gate is a real gate: until the key
is back it is a solid collider and the door is visibly shut, and with the key
returned the collider is removed and the door lifts. Its state is *derived* from
the quest rather than stored, so the unlock can never desynchronise a save.

The notice board is readable and reports back on the systems you have been
playing: faction standing with the Watch changes its wording, and whether you
paid or waived Oswin's toll changes what the traders have pinned up.

**Wren the Toll Clerk** keeps a stall in the lane, and she is the proof that
reputation opens doors. She will not discuss her missing toll ledger until the
Market trusts you (**Warm** standing), which you earn in the plaza by dealing
fairly with Oswin. Once she does, the quest has two endings that pull in
opposite directions: naming the trader who took the arrears page earns the
Watch's approval and 4 coins, while covering for him protects the Market. The
ledger itself is a real object you have to walk to and pick up behind the
barrels, and it only appears once Wren has told you where to look.

### Round 3 files

| File | What it holds |
| --- | --- |
| `src/factions.js` | Faction data, reputation scoring, tiers, NPC standing, rival reactions. Pure. |
| `src/ambient.js` | Pair selection, script bank and exchange building for NPC-to-NPC talk. Pure. |
| `src/areas.js` | The plaza and market lane boxes, the north gate, lane props and notice-board text. Pure. |
| `src/perf.js` | Adaptive resolution rules: clamping, stepping, hysteresis and smoothing. Pure. |

### The journal tells the truth

Quests with more than one ending record which ending you reached, and the journal
(press J) reports that. Pay Oswin's toll and the journal says you paid it; talk
Halden into waiving it and the journal says that instead. The same applies to
Wren's ledger: naming the trader and covering for him produce different entries.

### Running on weak hardware

The game is fill-rate bound, not draw-call bound: measured in this environment,
disabling shadows changed nothing and swapping every material for a cheaper one
gained 0.5fps, but halving the pixel count more than doubled the frame rate. So
the renderer **adapts its own resolution**. It samples real frame times, waits
for the reading to be consistent, and then walks the pixel ratio between 0.5 and
2 until frames are comfortable. On the software rasteriser used for testing this
takes the game from about 3.2fps to **7.1fps** and settles there without
oscillating.

Press **P** to turn it off and pin native resolution; the choice is remembered.

### Testing the phone build

```
npm run test:mobile    # 93 checks x 4 emulated device profiles
```

This drives the touch controls with real multi-touch events rather than synthetic
clicks, and plays the opening of the game on each profile. See `RELEASE.md` for
exactly what was and was not tested — in short, Chrome device emulation, not real
iOS Safari.

### Testing note

Browser tests now write screenshots to a throwaway directory by default, so a
verification run can never dirty the committed `artifacts/` evidence. Pass
`RECORD_ARTIFACTS=1` to refresh the committed screenshots on purpose.

## Round 2 — people and quests

Round 2 makes the plaza a place with people who remember you. Everything below
is in the game now:

- **Five NPCs with roles and routines.** Mara the Keeper, Oswin the Trader, Pip,
  Halden the Guard and Sable the Cartographer. Each has its own spot for day,
  dusk and night and walks there when the phase changes.
- **A day/dusk/night cycle.** A full cycle is 180 seconds. The sky, fog, sun and
  the four lanterns all change with the phase, and the lanterns only light at
  dusk and night.
- **A branching questline with real consequences.** *The Failing Lantern* can be
  paid for with 4 of your starting 6 coins or with a promise to Oswin. The
  promise branch creates a debt he calls in; Mara comments on it, and you can
  settle it later for 4 coins.
- **Two more quests.** *Halden's Missing Key* has a physical key you pick up out
  of the grass once he asks for help, and *Pip's Small Favour* only completes if
  you actually climb the north terrace and watch the lanterns light at dusk.
- **A journal and an inventory.** The tracker shows active and completed quests
  and updates as they change; J opens the full journal and inventory.
- **NPC memory.** Every NPC counts how often you have talked to them, remembers
  the last topic and keeps a small opinion of you that changes how they greet
  you.
- **Save and load.** Progress saves to `localStorage` after every state change
  and when you pause. A save that cannot be read is ignored rather than crashing
  the game, and storage being blocked falls back to memory.
- **A climbable north terrace.** A ramp on the north side rises 1.2m to a
  gallery with a parapet. The terrace side is too tall to walk up; only the ramp
  works, and it is checked in the browser test.

### How it is built

| File | What it holds |
| --- | --- |
| `src/state.js` | Quests, inventory, coins, NPC memory, save format. Pure functions. |
| `src/dialogue.js` | Every NPC's dialogue tree as data, with actions and branches. |
| `src/daynight.js` | Phase maths, wrapping, clock labels. Pure. |
| `src/terrain.js` | Terrace/ramp geometry maths and the walkable-height function. Pure. |
| `src/world.js` | Builds the scene meshes, colliders, lights and the phase looks. |
| `src/npcs.js` | Builds the NPCs and moves them along their routines. |
| `src/player.js` | First-person movement, floor height and step-height blocking. |
| `src/main.js` | Wires state, dialogue, HUD, input and the render loop together. |

The logic files import nothing from Three.js, so `npm test` runs the whole story
and save system in Node without a browser. `scripts/test-round2.mjs` then plays
the game through the real DOM in headless Chrome.
