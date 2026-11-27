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

**Round 111 is closed out and self-review found a real deployment bug, now
fixed.** Desktop suite passed 383/383 at `9699a61` (all three round-111 checks
green, no console errors). Reviewing the round myself (the review subagent had
silently died) turned up something no test could see: the doormat and soil
texture maps added in round 111 — and the boot leather maps referenced since
round 82 — were in `assets/` and named by `src/`, but missing from
`REQUIRED_FILES`, so `dist/` shipped without them. The boot-time load 404s, the
family reports `flat`, and the game still plays: a silent fidelity loss.
Fixed in `9b7d8e2` (nine paths added to `src/manifest.js`) plus a new
non-vacuous guard in `tests/manifest.test.mjs` that derives every
`assets/`/`vendor/` reference from `src/*.js` and fails if `REQUIRED_FILES` omits
it, and `b971cea` (dist rebuilt with the maps). Unit suite 1557/1557 on the new
head. The mobile suite is running against `b971cea` now (log
`/tmp/scratchpad/mobile.log`, pid confirmed alive) — result not yet read.
Release channel is still `blocked_infrastructure` (host caps reachable commits
at 256; branch is 300+ ahead), no release ids pending; PR-only fallback path.

## Next steps
1. Read the `b971cea` mobile result and fix anything red; that closes round 111
   across both device classes.
2. Start round 112. The audit (`/tmp/scratchpad/audit-r112/ranked.md`) shows the
   flat-surface axis is exhausted — only 9 flat materials remain (~12.9 m²) and
   all but the 1.66 m² MeadowGrass tufts are flat by design (glass response,
   emissive bulbs/markers, eyes/mouth). Two design agents are working the
   alternatives: one ranking non-flat realism axes (lighting, geometry, material
   quality, atmosphere), one auditing real render-budget headroom at full vs
   `low` tier. That picks the round-112 direction.
3. Keep the 101-111 release batched for `grunt-release` once the host commit cap
   is lifted; until then keep `publish.json` current per round.
