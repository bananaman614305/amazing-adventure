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

**Round 117 done (atmospheric lamp halos).** Pure module `src/lamphalo.js`
(seed 0x2e7c4a11: per-lamp halo descriptor with radius/opacity/stretch/tint,
lampHaloStrength by phase (day 0, dusk 0.45x night fraction, night 1x),
lampHaloEnabled drops on low, positional hash for tint/squash, 20 unit
cases), integration in `src/world.js` as the `lamp-halo` InstancedMesh
(additive, vertexColors, sRGB gradient texture), environment handle
(`lampHalo`, `lampHaloCount`, `lampHaloSpread`, `paintLampHalo`,
`lampHaloOn`), wiring in `src/main.js` syncPhase + per-frame update, and
paint call inside `applyPhase` and `setQuality`. Manifest + dist rebuilt.

Checks: unit 1654/1654; desktop browser 403/403 exit 0 (four new r117
checks: mesh/material/count, tint variety, night strength vs day, low-tier
drop). Mobile suite running this cycle at clean head 73b4d04
(background task); result to be recorded next checkpoint.

## Next steps
1. Record the mobile result for round 117 when the background suite finishes,
   then refresh `/worker/state/outbox/publish.json` at the clean exact HEAD.
2. Round 118: pick the next highest-impact graphics beat against the r113-117
   night look — candidates: real glass response polish (HouseGlass 4.63 m2,
   LampGlass 4.5 m2), or ground-level fog/mist layering, or per-lamp
   shadow/occlusion. Choose whichever reads best in the saved screenshots.
3. Keep rounds 101-117 batched for `grunt-release` once the host commit cap is
   lifted; keep `publish.json` current per round until then.
