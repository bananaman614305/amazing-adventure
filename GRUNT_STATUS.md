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

**Round 101 committed, release verification in flight.** HEAD f8d38d3.
Commits 7e3d886 (texture family + integration), 8ade987 (release manifest),
ffeb17f (dist), a7d8be5 + f8d38d3 (checkpoint, CREDITS wording fix).
Generator fixed and validated: periodic roll-based central-difference normals
plus exact tileability pins on H and normal_rgb; Kaggle job v45 COMPLETE on
Tesla T4 with seam_ratio albedo [0.804, 0.247], normal [0.0, 0.0], rough
[0.987, 0.956], normal green mean 0.5, albedo std 0.14. PNGs converted to
lossless WebP at assets/textures/roof_shingle_{albedo,normal,rough}.webp;
converted WebPs re-verified (seams < 1, 1024x1024, expected means). Unit suite
1452/1452 PASS. Desktop browser suite 357/357 PASS (one more check than the 356
before Round 101 = the new shingles check ran). Mobile suite RUNNING.

Trusted release: channel is configured. Verification ids queued (plan
`release`): tests 846ac85d-95f9-43f3-b90c-aacadae655b6, browser
df7dfd5d-20fd-47b3-8a81-af7f98b2f80b, mobile
6f4e134d-3521-475c-af63-be1cf53f103b. Review agents running.

## Next steps
1. Confirm mobile suite passes, poll the three verification ids, address any review findings, then `grunt-release prepare` at HEAD f8d38d3 and record the review.
2. If the channel blocks, write publish.json at the exact HEAD instead.
3. Choose the next graphics milestone (shortlist agent running) and begin Round 102.
