# Grunt status — Amazing Adventure

> **Standing owner priority (from round 56 on): graphics realism.**
> Make Amazing Adventure look substantially better and more convincing: rich
> lighting, stronger materials, better geometry, a cohesive environment — while
> keeping the game playable and performing on desktop and mobile. Use headless
> Blender (`/worker/state/grunt-blender`) for meshes and bakes and the free
> Kaggle GPU (`/worker/state/grunt-kaggle`) for texture work; free-licensed
> third-party assets are allowed with attribution in `CREDITS.md`. Pick the
> highest-impact work each round rather than using every tool every time.
> No paid resources, accounts or consents are authorized.

## Current task

**Round 111 in progress — closing realism-audit gap 4 (flat surfaces).**
Rounds 109 + 110 are verified green at `2addc51`: unit 1548/1548, desktop
380/380, no console errors, dist rebuilt. Round 111 dresses the last three
flat surfaces: `HouseDoormat` (1.26 m²) and the two `TerraceSoil` tops
(1.57 m²) get a bespoke coir/soil albedo+normal+roughness family from a new
procedural Kaggle bake; the cast's four `WoodP` props (0.88 m²) get a cast
wood pass reusing the existing crate/barrel maps. Work is split across three
subagents (bake, `src/woodprop.js` + tests, browser check) with integration
in `src/world.js` / `src/npcs.js` done by me.

## Next steps
1. Integrate round 111: new `PROP_FAMILIES` doormat/soil entries, `dressCastWood`/`upgradeCastWood` in `src/npcs.js`, manifest, dist, then run unit + desktop + mobile once and commit.
2. Release rounds 101-111 through `grunt-release` when the channel unblocks (currently `blocked_infrastructure`: host caps reachable commits at 256, branch is 300+ ahead).
3. After gap 4 closes, next realism milestone: re-audit the dressed scene for the highest-impact remaining loss.
