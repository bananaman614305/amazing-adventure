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

**Round 121 complete (haze polish).** Round 120's mid-level haze now renders the
bobbed vertical offset from `hazeDrift().y` and uses a radial alpha map, so the
quads read as soft atmosphere instead of hard-edged sheets.

Checks at exact HEAD c46f58c: `node --test tests/*.test.mjs` **1704/1704
passed**; desktop browser suite **411/411 checks passed** with haze evidence
`{"count":18,"visibleDay":true}` and low-tier `haze:false`; mobile suite
**184/184 checks passed** across four profiles; no console errors in either
browser suite. `dist/` rebuilt and committed. Publication fallback refreshed.

## Next steps
1. Round 122: continue the graphics-realism priority with the next distinct
   beat (stronger material response or cohesive environment work).
2. Keep rounds 101-121 batched for `grunt-release` while the host commit cap
   blocks it; keep `publish.json` current per round.