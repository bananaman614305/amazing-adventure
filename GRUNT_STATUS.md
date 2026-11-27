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

**Round 107 (context-loss robustness) — complete and verified.** The
`getProgramInfoLog` null shim from round 105 was extended to
`getShaderInfoLog` (same `.trim()` crash path in three's WebGLProgram) after
the mobile suite surfaced `TypeError: Cannot read properties of null (reading
'trim')` on iPhone 13 and iPhone SE. Mobile now 184/184 with zero console
errors; desktop 369/369 with zero console errors. Round 106 (gutter clash) is
also verified: gutters lowered to y 2.85..2.97 so eave tiles clear them, new
browser check 0 overlaps, desktop 369/369 + mobile 184/184. Dist rebuilt at
8fcb85e. Releases 101-105 still owed; channel is `blocked_infrastructure`.

## Next steps
1. Next graphics milestone: kerb ring around the plaza disc + lane plinth
   (realism audit gap 5), keeping existing decal heights.
2. Market-stall fascia/barge vs `MarketAwning` overlaps (2-2.5 cm):
   re-measure and nudge or document.
3. Flat-surface dressing: a Steel pass for the cast, doormat/planter-soil
   albedo; consider a Kaggle steel texture job.
4. Releases 101-105 when the channel unblocks.
