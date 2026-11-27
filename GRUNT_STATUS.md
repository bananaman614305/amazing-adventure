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

**Round 104 (eave trim) is code-complete at HEAD bf72c2b; the desktop browser
suite is running (background shell bb0sx5x66).** The four modelled roofs now end
in a real roofline: `src/roofedge.js` (new pure module, 25 unit tests) decides a
fascia board along each eave, a lead drip apron hung under it, and a bargeboard
along each gable rake, in the same local yaw-then-tilt frame `placeShingles`
uses. `world.js` turns them into two InstancedMeshes on one unit BoxGeometry
(`roof-edge-boards` 12 instances, `roof-edge-drips` 4) inside the group
`roof-edge-trim`; 16 descriptors total (4 fascia + 4 drip + 8 barge), verified
offline against the measured eave lines (worst deviation 0). The low tier drops
the group and both tier-flip paths re-derive it; `api.environment` gained
`roofEdge`, `roofEdgeBoards`, `roofEdgeDrips`, `roofEdgeCount`, `roofEdgeSpans`,
`paintRoofEdge()`, `roofEdgeOn`. Three new r104 browser checks read the instance
matrices and pin 12/4/4/8, the eave and rake placement, and the tier flip.

`readSpec` now clamps every section up to a 4 mm minimum instead of 0, so a
negative override yields a thin board rather than a zero-size one (a subagent's
contract finding, fixed and pinned).

Also fixed this round: the ivy-vs-trim clash quantified by a subagent (6 of 14
patches were sliced by the border wall's plinth/pilaster band up to 0.22 m deep).
`IVY_MIN_BASE_Y` 0.15 -> 0.82 and `IVY_MAX_SPAN` 2.4 -> 2.28; a new unit test
pins the invariant against `walltrim.js`'s own numbers, so a future trim change
cannot silently reintroduce the clash.

Checks done: focused ivy (36/36) and roofedge (25/25) suites; full unit suite
1503/1504 with the only failure the expected stale-dist preview test, then dist
rebuilt and preview.test.mjs 10/10 at bf72c2b. Manifest regenerated (158 files).
Not yet done: the desktop suite result, the mobile suite, and the Round 104
release.

## Next steps
1. Read the desktop suite result (shell bb0sx5x66); expect the three r104 checks
   green. Then `npm run test:mobile` once, and fix anything either suite finds.
2. Read the two subagent reports due this cycle — `/worker/state/claude-tmp/r104-review.md`
   (code review of this round) and `/worker/state/claude-tmp/gutter-clash-report.md`
   (do the modelled HouseGutter/Downspout boxes clash with the new boards or the
   shingles, and is the gutter hidden from the ground?). Fix real findings in a
   follow-up commit, rerunning the affected checks.
3. Releases still owed, oldest first: Round 101, 102, 103 and now 104 corrected
   heads. The trusted channel was last reported `blocked_infrastructure`
   (256-commit rev-list limit) in needs-supervision.json; re-check that file
   first, then `grunt-release verify release tests|browser|mobile` at the clean
   head, poll, prepare, review, advance. Report deployed only after the exact
   Pages build is verified.
