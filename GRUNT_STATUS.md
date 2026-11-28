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

**Round 120 implemented, browser verification in flight (mid-level atmospheric
haze).** Pure module `src/haze.js` (seed 0x3c8e1f, 18 descriptors) owns seeded
area-uniform spawn positions, bounded two-sine horizontal drift plus a small
vertical bob, phase opacity (day 0.25, dusk 0.85, night 0.5) and the low-tier
disable. `tests/haze.test.mjs` has 24 unit cases. `src/world.js` builds one
`InstancedMesh` named `ground-haze` with a soft `MeshBasicMaterial` at y=1.2–4
and sizes 6–14; `paintHaze()` follows phase and tier, `updateHaze(dt)` advances
the drift; `src/main.js` calls it per frame. The environment handle exposes
`haze`, `hazeCount`, `paintHaze`, `updateHaze`, `hazeOn`; `setQuality()`
repaints from the current phase. Manifest regenerated (180 files) and `dist/`
rebuilt/committed after the sources.

Unit suite at the exact rebuilt-dist HEAD: **1704/1704 passed**.

The first desktop browser run exposed two harness defects (not game bugs):
the r93 day-haze visibility was sampled after the clock/phase restore, and
the returned low-tier evidence omitted the new haze flag. Both are fixed in
commit 71e7ec6. A full desktop rerun is in progress; mobile follows after it.

## Next steps
1. Finish round-120 verification: confirm the desktop rerun, run the mobile
   suite once, then refresh `publish.json` to the final exact HEAD and record
   the exact check counts here.
2. Keep rounds 101-120 batched for `grunt-release` while the host commit cap
   blocks it; keep `publish.json` current per round.
