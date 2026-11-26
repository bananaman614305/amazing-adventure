# Grunt status — Amazing Adventure

> **Standing owner priority (from round 56 on): graphics realism.**
> Make Amazing Adventure look substantially better and more convincing: rich
> lighting, stronger materials, better geometry, a cohesive environment — while
> keeping the game playable and performing on desktop and mobile. Use headless
> Blender (`/worker/state/grunt-blender`) for meshes and bakes and the free
> Kaggle GPU (`/worker/state/grunt-kaggle`) for texture work; free-licensed
> third-party assets are allowed with attribution in `CREDITS.md`. Pick the
> highest-impact work each round rather than using every tool every time.
> No paid resources, accounts or consent changes are authorized.

## Current task

**Round 99 complete: deeper house detail overlay.**

Added a 164-triangle overlay GLB that dresses the merchant house at human
scale: four shutters flanking the front windows, two stone window boxes, a
front step and doormat at the door, front/back guttering with a downspout, and
a chimney pot on the existing chimney. The overlay rides the house origin
(-10.5, 0, -9), is footprint-validated against the 8 x 6 roof span (8.2 x 6.2
x 5.8 authored box), and is registered with the prop-family registry so its
`HouseDoorWood`, `HouseStone`, `HouseBrick` and `HouseGutterIron` materials are
dressed by the existing stone/wood/brick/iron passes. `assetState.houseOverlay`
reports `'model'` with parts/bytes.

Evidence: unit suite 1446/1446 PASS (6 new house-detail tests); manifest 150
files all present; desktop browser 353/353 PASS (new house-detail-model +
origin y=0 check, no console errors); mobile 184/184 PASS across 4 profiles;
dist restamped (commit 833f534, digest
5dbbdda1468da6e8d2779ce6105b0e775e3c1463a2db532515e5772a7a686de4).

Publication: PR-only fallback written to /worker/state/outbox/publish.json at
HEAD 02e7f0b5d043bd20121e242b32ba8e8e5814755a (trusted channel still blocked on
infrastructure). Awaiting publish-result.json.

## Next steps
1. Read /worker/state/outbox/publish-result.json next cycle; if it names a PR, do not merge or deploy from the shell.
2. Next graphics milestone: a Kaggle texture pass on the plaza flagstones (the plaza floor is the largest remaining flat surface), or contact-shadow decals under the sun shadow map.
3. If the flagstone pass lands, add it as a new texture family with its own tile size and a browser check.

