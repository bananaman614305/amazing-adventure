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

**Rounds 113 and 114 closed out.** Round 113 (warm light bleed on walls) and
round 114 (warm interior glow behind panes) are complete and verified: pure
modules `src/windowbleed.js` and `src/roomglow.js`, integration in `src/world.js`
(`window-bleed` and `room-glow` InstancedMeshes), wired through `src/main.js`
and the environment handle, browser checks r113 and r114. Self-review caught a
real bug in round 113 (`bleedMaterial` missing `vertexColors = true`) fixed
before release. Unit suite 1607/1607. Desktop browser 393/393 (all r113 + r114
checks green). Mobile 184/184 (iPhone 13 portrait 9.5fps, Pixel 7 1.4, iPhone SE
2.1, iPhone 13 landscape 1.4; no console errors). Dist rebuilt at `37b234f`.
publish.json refreshed at `37b234f`. Release channel still `blocked_infrastructure`,
PR-only fallback, no release ids pending.

## Next steps
1. Choose round 115: next highest-impact visual depth. Candidates: wet-pavement
   reflection streaks at night (lamp light streaking on damp cobble), or
   interior room glow colour variation per window.
2. Keep the 101-114 release batched for `grunt-release` once the host commit cap
   is lifted; until then keep `publish.json` current per round.
