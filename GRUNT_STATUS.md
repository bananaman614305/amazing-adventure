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

**Round 119 complete (warm halo around each lit glass pane).** Pure module
`src/glasshalo.js` (seed 0x4e7ab21d), 12 unit cases. `src/world.js` holds two
additive InstancedMesh layers — `glass-halo` (six plaza/window panes) and
`glass-halo-lane` (the lane post's pane) — `GlassHalo` material, sRGB radial
gradient, vertex colors, renderOrder 2. Environment handle exposes
`glassHalo`, `glassHaloLane`, counts, `paintGlassHalo`, `glassHaloOn`;
setQuality repaints; the low tier drops the layer.

Two bugs found and fixed in the desktop suite:
1. Halo descriptors were built at world-build time while `glassPanes` was
   still empty → counts stuck at 0. Descriptors are now built lazily in
   `dressGlassHalos()`, called from `reportGlass()` when the panes are final;
   meshes have capacity 16/4 and counts are set at dress time; counts are
   getters so they track the rebuilt arrays.
2. The round-119 lane-pane anchor used a non-existent `lamp` variable inside
   `upgradeLaneLamp()` (that function's local is `aim`), throwing a
   ReferenceError inside the `Promise.all` and rejecting the entire
   loadAssets chain. The anchor now uses `aim.lanternX`/`aim.lanternZ`.
   A focused headless probe showed zero console errors and a fully dressed
   world (propWood textured, laneLamp model, glass 7 panes / 2 windows /
   5 lamps / 1 lane pane, halo counts 7/1).

Checks: desktop **410/410 checks passed**, mobile **184/184 checks passed**
with no console errors at clean HEAD 52f0d42. Unit 1679/1680 before the dist
rebuild; the lone failure was the expected stale-digest assertion, and the
rebuilt dist is committed. Publication fallback refreshed at 52f0d42.

## Next steps
1. Round 120: pick the next graphics beat (ground fog/mist layering, lamp
   shadow/occlusion, or water surface motion) and implement with the usual
   pure-module → unit → integration → manifest → browser → dist pattern.
2. Keep rounds 101-119 batched for `grunt-release` while the host commit cap
   blocks it; keep `publish.json` current per round.
