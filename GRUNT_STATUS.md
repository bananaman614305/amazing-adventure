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

Integration code landed (uncommitted): src/assets.js adds ROOF_SHINGLE_TEXTURE_FILES;
src/world.js adds upgradeShingles() (loads the family, falls back to the flat
0x6d3a2c material, records assetState.shingle/shingleDetail); the shingle
material is dressed with a 1 m tile; assetState gains shingle/shingleDetail;
upgradeShingles() added to the loadAssets() Promise.all. tests/assets.test.mjs
gains 2 tests (family shape + load/clone); scripts/test-round2.mjs gains the
"the roof shingles wear the new tile family" check; manifest +3 files; CREDITS
updated. Unit suite: 86 asset tests PASS (last run).

Texture generator: art/kaggle/roof_shingle_textures.py authored (1024x1024,
procedural, seeded, CuPy-capable). The height field has been reworked to a
periodic layout (constant shingle count and parity stagger) so the tile seams
vertically as well as horizontally. The albedo is a value map (joint shadow,
grain, nails, damp, valley) so the authored 0x6d3a2c colour and per-phase glow
are not tinted twice. Local validation is blocked on the host venv disappearing
between commands; the next step is to run the generator in a single compound
command and inspect seam ratios. Kaggle submission v44 ERRORED; the script will
be resubmitted once local validation passes.

## Next steps
1. Run the generator in one compound command (venv + run + report), fix any seam-ratio failure, then submit to Kaggle and download the PNGs.
2. Convert the PNGs to WebP at assets/textures/roof_shingle_{albedo,normal,rough}.webp, verify dimensions/content, commit sources + assets.
3. Run npm test and npm run test:browser once to confirm the new check passes; update GRUNT_STATUS with evidence and write publish.json.
