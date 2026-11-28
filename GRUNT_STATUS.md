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

**Round 119 in flight (warm halo around each lit glass pane).** Pure module
`src/glasshalo.js` (seed 0x4e7ab21d), 12 unit cases. Integration in
`src/world.js`: two additive InstancedMesh layers — `glass-halo` (plaza/window
panes) and `glass-halo-lane` (lane post's pane), `GlassHalo` material, sRGB
radial gradient, vertex colors, renderOrder 2. Environment handle
(`glassHalo`, `glassHaloLane`, counts, `paintGlassHalo`, `glassHaloOn`);
setQuality paint list re-paints; low tier drops layer.

Two bugs diagnosed in the desktop suite (run 5, 375/410, 36 FAILs):
(1) halo descriptors were built at world-build time while `glassPanes` was
still empty → counts stayed 0 forever. Fixed: descriptors are now built
lazily in `dressGlassHalos()`, called from `reportGlass()` once the panes
are final; meshes created with capacity 16/4 and counts set at dress time;
`glassHaloCount`/`glassHaloLaneCount` made getters so they track the rebuilt
arrays. Unit suite green (1679/1680, the lone fail is the stale dist digest).

Bug B still open: the sequential `.then` chain after `Promise.all` in
`loadAssets()` aborts, so propWood/rope/housing/sackTie/noticeFace/water/
boardPaper/terrace stay flat, laneLamp stays 'stand-in', and glassDetail is
null in the browser. The round-119 diff touched no asset-chain code, so the
abort must come from something the halo change feeds into the chain (most
likely `reportGlass()` → `environment.applyGlass()` → `paintGlassHalo()`,
which now runs against arrays that were empty before). Need to capture
console errors and bisect.

Checks so far: unit 1679/1680 (preview digest stale). Desktop rerun pending
against the Bug-A fix; mobile suite after.

## Next steps
1. Confirm desktop suite (expect 410/410 with 4 new r119 checks) and then
   run the mobile suite (one browser suite at a time); record both in
   GRUNT_STATUS.md.
2. Refresh `/worker/state/outbox/publish.json` at the clean exact HEAD
   aa6d0f2, then commit the GRUNT_STATUS.md checkpoint.
3. Round 120: pick the next highest-impact graphics beat against the r113-119
   night look — candidates: ground-level fog/mist layering, per-lamp
   shadow/occlusion, or water surface motion. Choose whichever reads best in
   the saved screenshots.
4. Keep rounds 101-118 batched for `grunt-release` once the host commit cap is
   lifted; keep `publish.json` current per round until then.
