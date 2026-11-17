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
