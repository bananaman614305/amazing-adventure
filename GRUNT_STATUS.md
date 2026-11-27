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

**Round 102 (border-wall trim) is code-complete at HEAD ef84687; the desktop
browser suite is running again after Chrome crashed mid-run.** The five bare
border walls now wear dressed-ashlar trim placed by the pure module
`src/walltrim.js`: a 0.22 m coping on the 3.2 m wall top, a 0.45 m plinth at the
foot, and 32 pilaster strips (south 7, east 9, west 9, north-left 5,
north-right 2). Meshes are named `border-wall-{coping,plinth,pilaster}-<run>[-<i>]`,
share the walls' one stone fetch but use their own cloned textures at a 1.6 m
box projection, and the low tier drops the whole `border-wall-trim` group.

Fixed this cycle (a2a3b88): pilasters now stop at the gate piers' OUTER edges
(7.30 / 11.70) — they project past both wall faces, so clearing only the pier
centre left the first north-right strip inside pier B. Courses correctly stop at
the pier INNER faces (8.00 / 11.00). The browser check for projected UVs was
itself wrong (a 1.56 m pilaster maps to a 0.975 UV span at a 1.6 m tile); it now
reads UV span ÷ longest edge = 1/1.6 for any box-projected piece.

Evidence so far: tests/walltrim.test.mjs 21/21; full unit suite 1472/1473 with
the only failure the stale dist digest, since rebuilt (f1c948f); desktop suite at
f1c948f reached 341/341 including all four trim checks, then Chrome died
("Target closed") before the last ~20 checks — a browser crash, not a check
failure, so run bcyvnqv5j is repeating the full suite. Mobile not yet run.

**Found for the next round (not yet fixed):** the instanced shingle field is
laid on the procedural roof slabs, which `upgradeHouse()` and
`upgradeMarketStalls()` hide once the models load. Measured with
`shingleSpawns()` on the house plane: 44 of 150 strips sit ABOVE the modelled
gable surface (up to 0.543 m), so once assets load the shingles float through
the real roof. The modelled roofs are a gable (eave 3.0 m, ridge 4.6 m) and two
pitched awnings, not flat slabs. A subagent is measuring the exact world-space
planes to retile them.

Round 101 corrected-asset work stands: PR #59 is still open at head 08d4cfa
(Round 100, pre-correction); the served Pages site matches main d237b99. The
trusted channel still owes the Round 101 corrected-head release — do not report
it deployed until the corrected head is merged.

Trusted release: channel configured. The three queued verification ids (tests
846ac85d, browser df7dfd5d, mobile 6f4e134d) ran against the pre-correction head
and are stale. Round 102 has no verification ids yet; they are queued only after
the desktop and mobile suites pass at the same head.

## Next steps
1. Finish the desktop suite (run bcyvnqv5j) and the full unit suite at the same head, then `npm run test:mobile` — one browser suite at a time. Only then queue Round 102 verification ids and prepare the release.
2. Fix the shingles-on-hidden-slabs bug found this cycle: retile the shingle field onto the modelled gable and awning planes (exact world-space planes being measured), and drop shingle strips on the low tier as today. This is the visible artefact in the game right now.
3. Round 101 corrected-head release: re-queue the three verification checks at the corrected head, prepare, review, advance; verify the exact Pages build for PR #59 before reporting it deployed.
