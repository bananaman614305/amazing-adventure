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

**Round 108 in progress.** Pure module `src/kerb.js` + 16 unit tests + world.js
integration (plaza-kerb torus at y=0.03, four lane-plinth boxes at y=0.02) +
browser checks (presence, tier drop). Manifest updated (160 files). Commit
d286b76. Pending: rebuild dist, run desktop + mobile suites once.

## Next steps
1. Rebuild dist and run unit + desktop + mobile once at new head.
2. Market-stall fascia/barge vs MarketAwning overlaps (2-2.5 cm): re-measure and nudge or document.
3. Flat-surface dressing: Steel pass for the cast, doormat/planter-soil albedo; consider Kaggle steel texture job.
4. Releases 101-105 when the channel unblocks.
