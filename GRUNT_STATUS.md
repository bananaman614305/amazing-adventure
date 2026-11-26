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

**Round 101 committed, browser verification in flight.** Commits ffeb17f
(texture family + integration), 8ade987 (release manifest), ffeb17f (dist).
Generator fixed and validated: periodic roll-based central-difference normals
plus exact tileability pins on H and normal_rgb; Kaggle job v45 COMPLETE on
Tesla T4 with seam_ratio albedo [0.804, 0.247], normal [0.0, 0.0], rough
[0.987, 0.956], normal green mean 0.5, albedo std 0.14. PNGs converted to
lossless WebP at assets/textures/roof_shingle_{albedo,normal,rough}.webp;
converted WebPs re-verified (seams < 1, 1024x1024, expected means). Unit suite
1452/1452 PASS. Desktop browser suite RUNNING in background; mobile suite and
publish.json pending its result.

## Next steps
1. Confirm desktop browser suite passes (incl. the new shingles check), then run the mobile suite once.
2. Update GRUNT_STATUS with evidence and write publish.json at exact HEAD.
