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

**Round 100 complete: second-generation plaza flagstone texture set.**

Replaced the plaza floor's first-generation flagstone set with a Kaggle-authored
second generation (`art/kaggle/plaza_floor_v2_textures.py`, procedural, seeded):
stronger lattice jitter, per-stone inset and warm/cool tint, a damp field, a
chipped arris and per-slab dish. Ships as
`assets/textures/plaza_floor_v2_{albedo,normal,rough}.webp`; `world.js`
`upgradePlazaFloor()` loads the v2 set first and falls back to v1 if a file is
missing, so the game still boots without the upgrade. The baked AO cue keeps the
full-tier 0.85 intensity and drops to 0 on the low tier (re-derived on tier
flip). The texture loader now stamps `texture.userData.sourceUrl` so a test can
tell WHICH family reached a material — the ImageBitmap it builds has no src
string of its own.

Browser-check fixes this round: the assets evaluation pins full quality while
sampling `assetsReady()` (a slow headless run can drop adaptive to low and zero
the AO intensity before the settle point) and restores the previous tier after.

Evidence: unit suite 1450/1450 PASS (84 asset tests incl. the userData source
record); desktop browser 356/356 PASS incl. "the plaza is dressed from the
second-generation flagstone set" {"src":"plaza_floor_v2_albedo.webp","isV2":true}
and "the plaza keeps its baked AO cue on the full tier" {"ao":true,"intensity":0.85},
no console errors; mobile 184/184 PASS across 4 profiles. Dist restamped at
5153c4d (digest b0f9b5181f673b20703a1e326f98469af94b19b817e49003d16e4393389b2d1d);
the syntax fix to the browser harness is committed at 9bd2e65.

Publication: PR-only fallback written to /worker/state/outbox/publish.json at
HEAD 9bd2e65 (trusted channel still blocked on infrastructure). Awaiting
publish-result.json.

## Next steps
1. Read /worker/state/outbox/publish-result.json next cycle; if it names a PR, do not merge or deploy from the shell.
2. Next graphics milestone from the round-100 survey: pergola contact-shadow anchor in contactAnchors (~world.js:5342), or the roof shingle tile family (~world.js:5457), or ivy reusing the leaf family (~world.js:4500).
3. If a new texture family lands, add its files to the manifest and a browser check that reads userData.sourceUrl.

