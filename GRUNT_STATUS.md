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
reports `'model'` and the detail counts parts/bytes.

Evidence: unit suite 1446/1446 PASS (6 new house-detail tests); manifest 150
files all present; dist restamped (commit 833f534, digest
5dbbdda1468da6e8d2779ce6105b0e775e3c1463a2db532515e5772a7a686de4).
Browser checks added (house-detail-model presence, origin y=0, assetState).

## Next steps
1. Run `npm run test:browser` and `npm run test:mobile` once for this round (desktop ~5-10 min, mobile ~15-20 min on this host).
2. Publish Round 99 via /worker/state/outbox/publish.json with exact HEAD (the trusted channel is blocked on infrastructure; PR-only fallback is operative).
3. Next graphics milestone: contact-shadow decals under the existing sun shadow map, or a Kaggle texture pass on the plaza flagstones.

