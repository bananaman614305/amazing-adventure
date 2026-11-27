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

**Round 106 (gutter clash) — in flight.** Round 105 fully verified green
(unit 1521/1521, mobile 184/184, desktop 367/367, no console errors). The
env-map browser check is in the working tree (uncommitted). The gutter clash
fix lowers `HouseGutter_front`/`HouseGutter_back` in
`art/blender/make_house_detail.py` (gutter z 3.05 -> 2.95, downspout height
3.0 -> 2.89, centre 1.5 -> 1.445) and re-exports `assets/house-detail.glb`
(15852 bytes, HOUSE_DETAIL_OK, 164 tris, bounds unchanged). A new browser
check reads every `roof-shingles` instance matrix and each gutter's world AABB
and requires zero overlaps. The desktop suite is running (PID 1572) to
exercise both new checks; unit suite currently 1520/1521 with the only fail
being the stale-dist preview check (dist not yet rebuilt). Releases 101-105
still owed; channel is `blocked_infrastructure`.

## Next steps
1. Wait for the desktop suite; fix any failures; rebuild dist after the tree is
   clean; rerun the unit suite (must be 1521/1521).
2. Market-stall fascia/barge vs `MarketAwning` overlaps (2-2.5 cm): re-measure
   after the gutter move and nudge or document.
3. Barge/gutter-end overlaps (0.04 m) and the fascia's top strip still
   visible: raise/extend the fascia in `src/roofedge.js` to cover the
   gutter's full 0.12 m height and z-depth.
4. Kerb ring around the plaza disc + lane plinth (realism audit gap 5).
5. Flat-surface dressing: a Steel pass for the cast, doormat/planter-soil
   albedo; consider a Kaggle steel texture job.
6. Releases 101-105 when the channel unblocks.
