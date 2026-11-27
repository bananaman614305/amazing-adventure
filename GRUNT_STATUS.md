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

**Round 108 verified green.** Kerb ring (plaza-kerb torus) + lane plinth
(four boxes) integrated; low-tier drop confirmed. Unit 1537/1537, desktop
373/373, mobile 184/184, zero console errors. Dist rebuilt at 67f2279.
Next milestone: market-stall fascia/barge vs MarketAwning overlaps.

## Next steps
1. Re-measure the market-stall fascia/barge vs MarketAwning overlap and apply a minimal, documented fix.
2. Flat-surface dressing: Steel pass for the cast (pure module + world.js integration).
3. Doormat/planter-soil albedo pass.
4. Releases 101-105 when the channel unblocks.
