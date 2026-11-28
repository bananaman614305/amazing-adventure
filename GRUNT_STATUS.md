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

**Round 120 complete (mid-level atmospheric haze).** Pure module `src/haze.js`
(seed 0x3c8e1f, 18 descriptors) owns seeded area-uniform spawn positions,
bounded two-sine horizontal drift plus a small vertical bob, phase opacity
(day 0.25, dusk 0.85, night 0.5) and the low-tier disable. `tests/haze.test.mjs`
has 24 unit cases. `src/world.js` builds one `InstancedMesh` named
`ground-haze` with a soft `MeshBasicMaterial` at y=1.2–4 and sizes 6–14;
`paintHaze()` follows phase and tier, `updateHaze(dt)` advances the drift;
`src/main.js` calls it per frame. The environment handle exposes `haze`,
`hazeCount`, `paintHaze`, `updateHaze`, `hazeOn`; `setQuality()` repaints from
the current phase. Manifest regenerated (180 files) and `dist/` rebuilt and
committed after the sources.

The first desktop browser run exposed two harness defects (not game bugs):
the r93 day-haze visibility was sampled after the clock/phase restore, and the
returned low-tier evidence omitted the new haze flag. Both are fixed in commit
71e7ec6 and the full suites were rerun.

Checks at verified code HEAD 3f3d771: `node --test tests/*.test.mjs`
**1704/1704 passed**; desktop browser suite **411/411 checks passed** with haze
evidence `{"count":18,"visibleDay":true}` and low tier `haze:false`; mobile
suite **184/184 checks passed** across four device profiles; no console errors
in either browser suite. Trusted exact-head verification receipts also
succeeded for tests (20c994bb), browser (b05641f8) and mobile (ef562c40), all
exit 0. Final HEAD a74ae28 adds only this checkpoint; fresh exact-head checks
were queued (tests 1dea810e completed exit 0, browser 0211af48 and mobile
53f301a4 still in flight at the checkpoint). Publication fallback refreshed to
the final committed HEAD a74ae28.

Known caveats from the round-120 audit (not blockers for play): `placeHaze()`
uses `spawn.y` rather than the bobbed `hazeDrift().y`, so the tiny vertical bob
is computed but not yet rendered; the haze quads are plain planes with no alpha
map (very faint at 0.015 day opacity, but hard-edged if inspected closely); and
the "never throws" claim is true for ordinary junk values but not an adversarial
Proxy whose `get` trap throws. The first two are the natural round-121 polish;
the third matches the older mist module and needs no gameplay change.

## Next steps
1. Round 121: finish the haze layer — render `hazeDrift().y` and give the
   quads a soft alpha falloff, unit-test the contract, rerun the suites.
2. Continue the graphics-realism priority with the next distinct beat after
   the haze polish (stronger material response or cohesive environment work).
3. Keep rounds 101-120 batched for `grunt-release` while the host commit cap
   blocks it; keep `publish.json` current per round.
