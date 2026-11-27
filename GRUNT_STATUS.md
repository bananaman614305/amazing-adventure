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

**Round 105 is code-complete at HEAD dad5bd7 (working tree + one pending main.js fix).** New pure module `src/paving.js` exports `surfaceHeightAt`; contact-shadow decals, moss patches and puddles now place at `surfaceHeightAt(x, z) + lift` (SHADOW_DECAL_LIFT 0.002 < MOSS_DECAL_LIFT 0.003 < PUDDLE_WATER_Y 0.012); the nine lane/terrace decals that were buried are visible. Plaza AO and prop vertex-colour contact darkening stay on at every tier; only the sun shadow pass and the per-frame decal fields drop on low; `plazaAoMapIntensity()` returns a constant 0.85. Round 96 browser check rewritten for per-surface decal heights; new checks for static cues on low and env-map scheduling. `src/main.js` env-map scheduler uses a 1 s idle deadline plus `ensureFirstEnvironmentMap()` first-frame fallback; `roofEdgeOn` requires a non-empty span list; roof-edge meshes castShadow. `src/roofedge.js` planeId guard and ivy/walltrim doc fixes carried through. r104 browser checks hardened: drip and barge position assertions, tier restore in a finally block. Mobile run found a context-loss bug: `getProgramInfoLog` returns null after a context restore and three's `WebGLProgram` does `.trim()` on it, killing the render loop; fixed in `src/main.js` by returning '' for a null log. Desktop browser suite not yet rerun after this fix; mobile suite still owed. Unit suite 1521/1521 green at dad5bd7; focused context-loss probe 0 page errors after the fix.

## Current task (prior) — see git history

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
1. Commit the context-loss fix in `src/main.js` (shim `getProgramInfoLog` to return '' for null) together with this checkpoint, rebuild `dist/` (`node scripts/build-preview.mjs`), and rerun the unit suite. The mobile suite (183/184, the only failure was the null-trim TypeError) must be rerun once to confirm 0 console errors after the fix; then rerun the desktop suite once.
2. Geometry follow-ups from `gutter-clash-report.md`: clip the plane 0/1 eave courses so the 11 strips per house no longer poke ~7 cm through the `HouseGutter` boxes, raise/extend the fascia so it covers the gutter's full 0.12 m height and depth, and resolve the market-stall fascia/barge overlaps (2-2.5 cm). Add a browser check that no shingle AABB intersects a gutter AABB.
3. Kerb ring around the plaza disc and a matching plinth edge on the lane (realism audit gap 5) so the 1-2 cm float reads as paving on a bed; keep the existing decal heights.
4. Flat-surface dressing (realism audit gap 4): extend `PROP_FAMILIES` in `src/assets.js` to catch `WoodP` and `Steel` (reusing the wood and iron maps), and give the doormat and planter soil a bespoke albedo. Order by player proximity.
5. Release channel: re-check `needs-supervision.json` (last `blocked_infrastructure`, 256-commit rev-list limit); releases owed oldest-first 101-105. Run `grunt-release verify release tests|browser|mobile` at the clean head, poll, prepare, review, advance; report deployed only after the exact Pages build is verified.
