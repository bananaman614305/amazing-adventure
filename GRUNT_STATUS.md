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
`src/glasshalo.js` (seed 0x4e7ab21d: per-pane descriptor {width, thickness,
tintWarmth, response, wander}, width 1.6 window / 0.55 lamp, thickness 0.62 /
0.35, tintWarmth 0.9 x response, response curve day 0 / dusk 0.9 / night 1,
dark lane pane 0 at every hour, wander seeded by positional hash <= 0.25),
12 unit cases. Integration in `src/world.js`: one additive InstancedMesh quad
per registered pane (`glass-halo`, GlassHalo material, sRGB radial gradient,
vertex colors from tintWarmth, renderOrder 2), anchored at the pane's
registration-time centre; `applyGlass` re-derives the halo opacity from the
same phase and lane state as the pane's own glow; environment handle
(`glassHalo`, `glassHaloCount`, `paintGlassHalo`, `glassHaloOn`); both the
applyPhase and setQuality paint lists re-paint it; the low tier drops the
layer. Browser checks in scripts/test-round2.mjs: 7 quads, one per pane;
opacity follows the hour; a dark lane keeps its halo dark at every hour; the
low tier drops the layer. Manifest + dist rebuilt. Sources committed at
c01918e, dist at b239386.

Checks so far: unit 1680/1680 (incl. 12 glasshalo, preview digest matches).
Desktop browser suite running; mobile suite next.

## Next steps
1. Confirm desktop suite (expect 410/410 with 4 new r119 checks) and then
   run the mobile suite (one browser suite at a time); record both in
   GRUNT_STATUS.md.
2. Refresh `/worker/state/outbox/publish.json` at the clean exact HEAD
   b239386, then commit the GRUNT_STATUS.md checkpoint.
3. Round 120: pick the next highest-impact graphics beat against the r113-119
   night look — candidates: ground-level fog/mist layering, per-lamp
   shadow/occlusion, or water surface motion. Choose whichever reads best in
   the saved screenshots.
4. Keep rounds 101-118 batched for `grunt-release` once the host commit cap is
   lifted; keep `publish.json` current per round until then.
