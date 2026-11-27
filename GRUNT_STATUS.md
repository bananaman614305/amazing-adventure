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

**Round 102 (border-wall trim) committed; browser suite running.**
No release is pending for Round 102 yet; release ids are recorded when the
browser/mobile verification passes.
The five bare border-wall boxes now wear dressed-ashlar trim: a 0.22 m coping
course on the 3.2 m wall top, a 0.45 m plinth course stepping out at the foot,
and 32 pilaster strips (5 runs: south 7, east 9, west 9, north-left 5,
north-right 2), all placed by the new pure module `src/walltrim.js` (seeded,
total, keep-clear of the window/ivy plane) and boxed by `src/world.js`. The trim
shares the walls' one stone fetch but keeps its own cloned texture set and a
1.6 m box projection, so the walls' 34 m repeat is untouched. One group
(`border-wall-trim`) drops the whole band on the low tier. Meshes are named
`border-wall-{coping,plinth,pilaster}-<run>-<i>` plus the base walls
(`border-wall-south/east/west/north-left/north-right`). Committed: dd9ad94 (7
files), b410d20 (dist rebuild). tests/walltrim.test.mjs 19/19 pass. Browser
checks for the named pieces, projected stone maps and the tier flag are in
scripts/test-round2.mjs (28k-i block). Full unit suite re-running in the
background; browser + mobile suites run once after it passes.

The Round 101 corrected-asset work stands as before: generator fix committed
(6fa7f02), corrected normal regenerated on Tesla T4 (Kaggle v46), WebP
re-verified (seams pass; G channel changed, max diff 0.1922), dist rebuilt
(62aea49), release ed44bd6 published as PR #59. Pages check this cycle: the
served site matches main at d237b99 exactly (src/manifest.js 200, the 40
manifest files present, dist/preview.json 404 as on main, vendor three 200).
PR #59 is still open (merge_commit_sha bd6d2ed exists but merged_at null) and
carries head 08d4cfa (Round 100, no walltrim.js), i.e. the pre-correction
head; the correction is only on grunt/round72-bunting-felt. The trusted
channel still owes the Round 101 corrected-head release; do not report it
deployed until the corrected head is merged and the served site carries
src/walltrim.js's sibling state.
357/357 desktop and 184/184 mobile ran against the INVERTED normal, so both
browser suites must be re-run at HEAD 62aea49 before release. Release
verification ids from the pre-fix head are stale and must be re-queued.

Trusted release: channel is configured. Verification ids queued (plan
`release`): tests 846ac85d-95f9-43f3-b90c-aacadae655b6, browser
df7dfd5d-20fd-47b3-8a81-af7f98b2f80b, mobile
6f4e134d-3521-475c-af63-be1cf53f103b. Review agents running.

## Next steps
1. Full unit suite passes -> run `npm run test:browser`, then `npm run test:mobile` (one at a time).
2. Poll the release verification ids for the Round 101 corrected-asset release, then `grunt-release prepare` at the corrected HEAD and record the review; verify the exact Pages build for PR #59 before reporting it deployed.
3. Round 102 release: once the browser and mobile suites pass, `grunt-release verify release tests|browser|mobile`, `prepare` at b410d20 on grunt/round72-bunting-felt, review, advance.
4. Next round candidate: remaining geometry/silhouette gaps — e.g. roof edge coping/bargeboards on the house and terrace, or the barn walls mentioned earlier. Flat-colour backlog is nearly exhausted.
