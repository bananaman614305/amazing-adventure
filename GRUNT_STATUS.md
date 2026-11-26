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

**Round 101 in progress: roof shingle tile family.**

Integration landed (uncommitted): src/assets.js adds ROOF_SHINGLE_TEXTURE_FILES;
src/world.js adds upgradeShingles() (loads the family, falls back to the flat
0x6d3a2c material, records assetState.shingle/shingleDetail); the shingle
material is dressed with a 1 m tile; assetState gains shingle/shingleDetail;
upgradeShingles() added to the loadAssets() Promise.all. tests/assets.test.mjs
gains 2 tests (family shape + load/clone); scripts/test-round2.mjs gains the
"the roof shingles wear the new tile family" check; manifest +3 files; CREDITS
updated. Unit suite currently 86 asset tests PASS.

Texture generator: art/kaggle/roof_shingle_textures.py authored (1024x1024,
procedural, seeded, CuPy-capable). Local validation in progress: the height
field has been reworked to a periodic layout so the tile seams cleanly; the
albedo is a value map (joint shadow, grain, nails, damp, valley) so the
authored 0x6d3a2c colour and per-phase glow are not tinted twice. Kaggle
submission v44 ERRORED (root cause under investigation); regenerated locally
once the layout fix lands, then submitted.

## Next steps
1. Finish validating art/kaggle/roof_shingle_textures.py locally (seam ratios < 3, normal green mean > 128, albedo stddev > 0), then submit to Kaggle and download the PNGs.
2. Convert the PNGs to WebP at assets/textures/roof_shingle_{albedo,normal,rough}.webp, verify dimensions/content, commit sources + assets.
3. Run npm test (full unit suite) and npm run test:browser once to confirm the new check passes; update GRUNT_STATUS with evidence and write publish.json.
