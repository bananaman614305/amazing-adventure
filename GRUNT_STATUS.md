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

**Round 67 — dress the cloth and fix the UV seams the dressing exposed.** The
one big flat mass left after rounds 61–66 was cloth: the three lane `SackCloth`
sacks and the modelled cast's 23 `Cloth` coat/leg/sleeve meshes (17.26 m2
measured in the browser). This round gives them their own woven-burlap family —
`art/kaggle/cloth_textures.py` on the Kaggle T4, a `cloth` PROP_FAMILY with
`keepTint: true` so the sacks stay burlap brown and the coats keep their palette
colours, tiled at 1.2 m — and fixes the bug that dressing curved geometry
exposed: `boxProjectUvs` picked the projection plane per *vertex* with
last-triangle-wins, so every sack rim and sleeve seam sheared the triangle on
the far side (worst 3.3x off). The new `boxProjectMesh`/`projectBoxGeometry` core
picks the axis per triangle and splits shared corners into their own slots;
seam-free meshes keep their original index buffer, and `boxProjectUvs` now
throws instead of shearing silently. After the fix: 0 sheared triangles of 2532
in the live scene, every triangle rigid within 2%, sacks tiling uniformly at
1.2 m. Details in the Round 67 sections below; evidence at the end of this
section.

**Round 65 — keep the fountain's two stones apart once the maps load.** Round
64 dressed the gate piers and the fountain stone in the shared quarried-stone
family, and reviewing my own diff afterwards caught a defect that had shipped
green: in the *mapped* path both `Stone` and `StoneDark` were given
`color: 0xffffff`, so the six dark meshes (plinth, finial, four corner blocks)
rendered identical to the four light ones and the fountain lost the base that
gives it weight. This round fixes the tint (`fountainStoneTint()` returns the
*ratio* of the two authored tones, `0xc8cbc9`, so the map keeps its contrast),
catches the missing `fountainStoneTint` import that had silently disabled two
rounds of prop dressing, and replaces the "both stones are white" checks with
checks that assert the two stones stay *different*. Details in the two Round 65
sections below; evidence at the end of this section.

**Round 64 — dress the gate piers and the fountain stone.** Rounds 61–63 gave
the plaza floor, the north terrace, the roofs and the tree canopies their own
mapped families. Two large stone masses were still bare flat colour in the
plaza's main sight line, and both are objects the player walks right up to:

- **The north gate piers and lintel** (`pierMaterial`, `0x7b7163`) are two
  0.7 x 4.1 x 1.4 m piers plus a 4.4 m lintel framing the only way out of the
  plaza — the tallest untextured stone in the whole scene, standing directly
  beside dressed ashlar walls.
- **The modelled fountain's `Stone` and `StoneDark` meshes** (bowl, basin,
  column, plinth, finial, four corner blocks — ten meshes; the two `Water`
  meshes are deliberately excluded) ship with **no UVs at all**, only
  POSITION+NORMAL, so they read as smooth sculpted plastic next to coursed
  stonework.

`upgradeGateStone()` and `upgradeFountainStone()` reuse the *one* existing
quarried-stone request (`STONE_TEXTURE_FILES`, shared with the walls and the
terrace — `loadStoneFamily()` is memoised, so no extra download), rewrite UVs
metre-projected at `TERRACE_TEXTURE_TILE_METERS = 1.6` m via `boxProjectUvs()`,
and clone their own sampler state so every mapped texture stays
`repeat = (1,1)`. Shared helpers: `fountainStoneParts()`,
`FOUNTAIN_STONE_COLORS`, `fountainStoneMaterialParams()`, `fountainStoneTint()`
in `src/assets.js` keep `Stone` and `StoneDark` distinguishable with *and*
without maps: the light stone's base is white so its albedo is never tinted
twice, and the dark stone carries a **multiplier** (`0xc8cbc9`) instead of the
authored colour, so the map keeps its own contrast and only the overall tone
shifts. Both passes are gated in `assetState.gateStone` /
`assetState.fountainStone` (`flat` | `textured` | `unavailable` | `stand-in`).

### Round 67 — the dressing and its bug

**The cloth family.** A live audit after round 66 found one large flat mass
left: cloth. The three lane `SackCloth` sacks (3.58 m2) and the cast GLBs' 23
`Cloth` coat/leg/sleeve meshes (13.68 m2) were still flat colour. New pieces:

- `art/kaggle/cloth_textures.py` — procedural plain-woven burlap on the Kaggle
  T4 (CuPy backend): two warp threads per unit cell with sin^2 thread crowns,
  per-thread value-noise slack via a lattice-periodic domain warp, albedo from
  thread shading plus fibre speckle, roughness from the same height field,
  tangent-space normal from a Sobel derive. 512x512, seamless by construction;
  shipped seam ratios albedo [0.058, 0.066], normal [0.164, 0.328], rough
  [0.012, 0.013] (all far under 3). Lossless WebP, pixel-identical to source.
- A `cloth` PROP_FAMILY (`/cloth/i`, last in the list so it cannot pre-empt
  roof/bark/wood) with `keepTint: true`: the albedo is a neutral grey weave with
  no colour of its own, so the dressed materials keep their authored tint by
  multiply — sacks stay burlap brown, coats stay their palette colours.
- `src/npcs.js` gains `upgradeCastCloth()`, chained onto `castReady` in
  `src/main.js` so the coats dress right after the modelled rigs swap in. A
  failed download leaves the coats flat painted, exactly as they shipped before.
- Tiled at 1.2 m (sacks measured 0.56 m across, so the weave reads at sack
  scale; `CAST_CLOTH_TILE_METERS = 1.2` for the coats).

**The bug the curved geometry exposed.** The first cloth pass wrote UVs with
`boxProjectUvs`, which chose the projection plane per *vertex* with
last-triangle-wins. Any corner shared by triangles whose dominant normal axis
flips kept only one of the two planes, shearing the triangle on the other side:
6 of a lane sack's 36 triangles, worst 3.3x off (implied tile 1.02 m beside
2.19 m on one 0.56 m sack). Flat crate/slab faces never hit it, which is why
rounds 61–66 measured clean — the sacks and coats are the first curved geometry
the dresser meets.

**The fix.** `src/assets.js` gains a two-layer API:

- `boxProjectMesh({positions, indices, tileMeters})` — the pure core. Picks the
  axis per *triangle*, counts corners touched by triangles that disagree (a
  per-corner axis bitmask), and when seams exist returns one corner per triangle
  slot: expanded `positions`/`uvs`, `indices: null`, plus a `remap` array. When
  the mesh is seam-free it passes the caller's index buffer straight through.
- `projectBoxGeometry({THREE, geometry, tileMeters})` — rebuilds a Three
  geometry from that result, expanding every other attribute (`normal`, `color`)
  through `remap` so shading and tint ride along, and clears the index. Returns
  `{seams, vertices}` so a harness can report the split.
- `boxProjectUvs` stays as the seam-free fast path but now **throws** on a
  seamed mesh instead of shearing it silently, so a call site that forgot
  `projectBoxGeometry` fails loudly.

`src/world.js` wood dressing routes through `projectBoxGeometry` and reports
`assetState.propWoodDetail.seams`; `src/npcs.js` cloth dressing does the same.

### Round 65 — the dark stone was about to disappear

Reviewing my own round-64 diff caught a real defect, not a style nit. In the
mapped path both stones returned `color: 0xffffff, roughness: 1`, so once the
maps loaded `StoneDark` rendered **identical** to `Stone`. The fountain would
have lost the plinth, finial and corner blocks that give it a base — the exact
contrast the GLB authors on purpose (authored luma 134 vs 106, a 21% drop).
The unit test and the browser check both asserted "white" for both stones, so
the suite was green *around* the bug: they pinned the tint, never the
difference.

The first fix that suggested itself — tint the dark stone with its authored
colour — is wrong for the same reason tinting the light one is wrong: the map is
already a mid-grey stone, so multiplying by `0x706a5e` darkens it twice and
craters the contrast. `fountainStoneTint()` therefore returns the **ratio**
between the two authored tones (`0xc8cbc9`) as the multiplier: the map's own
detail and contrast survive intact, and only the overall tone moves. The tests
now assert the difference rather than the whiteness — the light stone is white,
the dark stone is not, it is a single consistent value across all six dark
meshes, and its luma sits in a band (160–235) that is a visible tone shift and
not a black wash.

**This is why the round-64 evidence was not enough on its own.** 597 unit tests,
244 desktop checks and 184 mobile checks all passed while the defect was live.
A check that asserts a number is only worth its salt if the number is the one
that matters; "both stones are white" was true and useless. The replacement
checks fail if the two stones ever converge again.

### The real bug underneath it: a missing import, swallowed

Writing the tint exposed something worse. `fountainStoneTint()` was used in
`src/world.js` but never added to its `./assets.js` import list, so
`upgradeFountainStone()` threw a `ReferenceError` the moment it touched the
tinted path. That rejection was absorbed by `loadAssets()`'s `Promise.all`, so:

- `assetState.fountainStone` stayed at its **initial** `'flat'`, and
- `upgradePropFamilies()` — the next `.then()` in the chain — **never ran at
  all**, so round 63's prop wood dressing silently switched off too.

The failure mode is nasty because `'flat'` is the *same value* the world
reports when the textures genuinely fail to load. Every existing check that
reads `assetState` passed, because "flat" is a legitimate state that is
supposed to be reachable. The suite was not wrong about anything it measured;
it simply never measured whether the code ran.

Two fixes, because a code fix alone leaves the trap armed:

1. `fountainStoneTint` is now imported. The new focused browser probe confirms
   `fountainStone: "textured"`, 10 meshes (4 stone, 6 dark), all three maps,
   `tileMeters: 1.6` — and `propWood: "textured"` again, which is the tell that
   the whole `.then()` chain had been dead.
2. A **source-level** test (`every asset helper world.js calls is actually
   imported`) parses world.js's `./assets.js` import list and asserts that every
   helper the file calls is in it. I removed the import again to prove the guard
   fails, and restored it to prove it passes. A name-used-but-not-imported bug
   cannot pass silently again.

Lesson kept for the rest of this series: **a state value that is also the
failure value cannot testify that the code ran.** Dressing checks need to read a
positive product (maps, UVs, a mesh count) against the real scene, not only the
summary enum.

Also in this round: the market-stall stand-in dedup. The roof slab and both
posts carried no `marketStallStandin` marker, so the modelled awning and posts
were drawn *on top of* the flat stand-in slab and sticks, doubling them. The
marker now covers the whole stand-in (4 → 6 hidden objects), and only the
counters (`marketStallSize` set) spawn model instances, so a roof slab's height
can never be used to scale a stall.

**Round 67 evidence.** Unit suite **612/612 PASS**
(`node --test tests/*.test.mjs`, 24 s) — including the new seam tests: the tube
fixture forces 8 seam corners, the split tube is rigid (every triangle's UV
area equals its 1 m2 plane area to 1e-6), a seam-free slab keeps the caller's
index buffer byte for byte, `boxProjectUvs` throws `/seam/` on the tube, and the
attribute-expansion test pins `normal`/`color` counts to the duplicated corner
count. The round-65 source-level import guard extends to the new helpers.
Round 67 browser evidence **19/19 checks PASS**
(`scripts/evidence-round67.mjs`, RECORD_ARTIFACTS=1): live scene audits
**0 sheared triangles of 2532** across every dressed family (wood 49 meshes,
roof 7, cloth 3, cast cloth 23, leaf 12, brick 3, stone 6), worst triangle
rigidity 1.0 within the 2% tolerance, all four split meshes (LaneWood 40 tris /
120 corners, three SackCloth sacks 36 tris / 108 corners each) unindexed with
exactly one corner per triangle slot, every other dressed mesh still indexed,
split corners carry unit normals and their original colours, the three sacks
tile uniformly at 1.2 m with zero implied-tile spread (round 66's pre-fix probe
measured 0.53 spread, worst triangle 3.3x), the player still walks, and the
quest spine still opens (9 quests) with no console errors. Screenshots:
`artifacts/round67-{sack-row,sack-close,lane-view,test-stall}.png`; scene JSON:
`artifacts/round67-evidence.json`. Kaggle run COMPLETE
(`/worker/state/grunt-kaggle status`), cloth maps downloaded and inspected
before use.

Re-running `scripts/evidence-round67.mjs` on the review-fixed head reproduced
**19/19 PASS** with the artifacts rewritten byte-identical, so the morph fix
changed nothing about what the scene renders while closing the latent trap.

**Round 67 review — a bug the split would have hidden.** An independent review
of `projectBoxGeometry` (and my own adversarial probes on the pure core) turned
up one real defect and cleared the rest:

- **Fixed: morph targets were not expanded.** Every entry of
  `geometry.attributes` followed the corner `remap`, but
  `geometry.morphAttributes` was left at its original vertex count. A split mesh
  whose `position` grew to 3 corners per triangle while a morph target stayed at
  the old count makes the renderer read past the end of the smaller buffer and
  blend the wrong target. No dressed prop uses morphs today — every dressed mesh
  is a static GLB prop or cast cloth piece — but the split would have corrupted
  one silently, so `projectBoxGeometry` now maps each target through the same
  `expand()` helper it uses for attributes. Pinned by
  `projectBoxGeometry splits morph targets with the corners`, which encodes the
  source vertex in the target value so the mapping is checkable; I reverted the
  fix and watched that test fail (49 pass / 1 fail), then restored it (50/50).
- **Cleared: triangle winding.** The split writes corners in source order
  (`dst = t * 3 + k` from `cornerIndex(t, k)`), so front faces cannot flip; a
  direct check confirms the split `positions` equal `remap`-mapped source
  positions element for element.
- **Cleared: groups.** A group's `start`/`count` name index positions, and slot
  `t * 3 + k` in the split buffer occupies the same position the triangle held in
  the index buffer, so ranges stay correct without rewriting. Verified on a
  two-material cylinder: groups `0+24, 24+24` still cover triangles 0–7 and 8–15
  and the draw range ends exactly at the 48-corner buffer.
- **Cleared: degenerate and bad input.** A collinear (zero-area) triangle
  produces `seams=0` and finite UVs (the normal is zero, `boxAxis` returns a
  deterministic axis, no divide by zero). `tileMeters` of `0`, negative, `NaN`,
  `Infinity`, `undefined` or a string all fall back to 1 via the existing guard.
  Non-finite *positions* propagate `NaN` into UVs, which is the caller's data
  error and would already break rendering.
- **Cleared: double expansion.** An already-unindexed mesh has no shared corners
  to disagree about, so it reports `seams=0` and keeps its own buffer.

**Round 67 mobile evidence: 183/184, one known-environment FAIL.**
(`RECORD_ARTIFACTS=1 node scripts/test-mobile.mjs`, `/tmp/r67/mobile3.log`)
across all four phone profiles: touch controls take over, the analog stick
moves and stops, walking and looking work at the same time (0.82 m walked while
turning 0.34 rad), the journal opens and closes, a dialogue choice advances the
conversation, the build identifies itself, and all four profiles log no console
errors. The single FAIL is the frame-rate floor on the largest viewport:
`iPhone 13 (landscape): renders above 1fps — 0.6fps`. That check measures the
software rasterizer (swiftshader) on a headless CPU profile, not phone GPU
behaviour: the same profile measured 1.4fps on the round-64 baseline and 0.6fps
here as the scene gained dressed surfaces, while iPhone 13 portrait reports
11fps and the smaller iPhone SE 2fps in this same run. Round 67 adds no new
geometry or draw calls — the cloth dressing reuses existing meshes with three
more texture maps — so this is the known swiftshader ceiling on the heaviest
profile, recorded as-is rather than papered over. The run rewrote
`artifacts/mobile-*.png`; those three changed PNGs were reverted to the
committed images so the tree stayed clean for the preview stamp.

**Round 67 desktop evidence on the review-fixed head.**
(`node scripts/test-round2.mjs`, `/tmp/r67/desk5.log`) **245/245 checks passed,
exit 0, no console errors** at `0181e56`, the same head the unit suite and the
19/19 live evidence ran against. This re-confirms, after the morph-target fix,
that the seam split did not disturb focus handling, keyboard choices, walking
after a conversation, relative font sizing at 100%/200%, dialogue reachability
at 200% text, coin/quest save clamping, or the six-quest spine.

**Round 67 publication state, recorded honestly.** The trusted
`planId: release` channel verifies the *root* checkout
(`/home/alan/projects/amazing-adventure`), which is detached at round 59
`895bb72` with 21 texture maps and no `cloth_*.webp`, so its receipts cannot
certify this round: the `tests` receipt completed green against `895bb72`, and
the `browser` receipt returned `failed / execution_failed (exitCode 1)` with
`before.head: 895bb72` and a dist listing that contains no cloth maps. Both
receipts are honest — they tested a tree 17 commits behind this candidate. The
host release pipeline is also still stuck (`d7e3f3fc-…`:
`phase=blocked, reason=operation_interrupted`), which is reported in
`/worker/state/outbox/needs-supervision.json`. Round 67 is therefore offered
through the PR-only fallback at `0181e56`: nothing here is merged or deployed
by me.

**Round 65 evidence.** Unit suite **597/597 PASS**
(`node --test tests/*.test.mjs`) — including the new source-level guard that
fails when world.js calls an asset helper it forgot to import (verified by
removing the import and watching it fail). Desktop browser suite **245/245
checks PASS, 0 FAIL** and no console errors (`/tmp/r65-browser3.log`): the four
light meshes report `color: "ffffff"`, and all six dark meshes report
`"c8cbc9"` at `darkLuma 202.2` on separate materials and separate map objects.
A focused asset probe independently reports `fountainStone: "textured"` (10
meshes, 4 stone + 6 dark, map + normal + roughness, `tileMeters: 1.6`) **and**
`propWood: "textured"` — the second being the tell that the whole `.then()`
chain had been dead. Mobile suite **184/184 checks PASS, 0 FAIL**
(`/tmp/r65-mobile.log`). Committed artifacts were restored before this run, so
the evidence refresh left the tree clean.

**Round 64 evidence.** Unit suite **597/597 PASS** (`node --test tests/*.test.mjs`),
including 12 new asset tests pinning the family reuse, the ten-stone/two-water
split, the two-stone distinguishability with and without maps, and the
metre-projection arithmetic on a real basin disc. Desktop browser suite
**244/244 checks PASS, 0 FAIL** with `RECORD_ARTIFACTS=1`
(`/tmp/r64-final-browser.log`, 245 PASS lines, no console errors), adding gate
and fountain dressing checks: all ten stone meshes report
`state: "textured"` with map+normal+roughness, projected UV spans up to
+/-1.219 m on the plinth and 1.4 m up the finial (i.e. real metre tiling, not
the default 0..1 face UVs), every mapped texture at `repeat [1,1]` and colour
`ffffff` (no double tint), the two fountain stones on **separate materials and
separate map objects**, the two `Water` meshes left with no UVs, no maps and
`roughness 0.15` so they still read as water, the gate piers and lintel dressed
from the same family but **not** borrowing the walls' whole-wall repeat, and
the modelled fountain still solid (a walk-in test stops outside it). Mobile
suite **184/184 checks PASS, 0 FAIL** across all four phone profiles
(`/tmp/r64-mobile.log`; iPhone 13 portrait 12.4fps, Pixel 7 1.4fps, iPhone SE
2.2fps, iPhone 13 landscape 1.4fps — the low numbers are swiftshader, and the
same profiles measured the same on the pre-round-64 baseline).

**Committed on `grunt/round62-terrace`** (the round-64 commits stack on the
round-62 branch rather than opening a new branch per round):

- `643af25` — the round itself: `src/assets.js`, `src/world.js`,
  `tests/assets.test.mjs`, `scripts/test-round2.mjs`.
- `895e637` — the round-63 evidence script and screenshots, which had been left
  untracked and were keeping the tree dirty and blocking preview rebuilds.
- `d2ee3f8` — the committed preview re-stamped at the round-64 sources. The
  rebuild reproduced the same tree digest (`db8651f6…`), so only the commit
  pointer and the two copied sources changed.

**Not done, deliberately:** no release. Round 57's release is still host-side
blocked (`/worker/state/outbox/needs-supervision.json`), and the trusted release
gate runs against the root checkout, which does not carry these rounds.
Nothing here is merged or deployed by me.

## Next steps

1. **Get the trusted channel onto this candidate, or take the PR-only path.**
   Round 67 is complete and green at `0181e56` (613/613 unit, 245/245 desktop,
   19/19 live evidence, mobile 183/184 with the documented swiftshader FAIL).
   The three `planId: release` receipts certify the root checkout at round 59
   `895bb72` instead, so they cannot sign this head; the host pipeline is also
   still `blocked / operation_interrupted`. The tree-mismatch report is in
   `/worker/state/outbox/needs-supervision.json` and the PR-only request is in
   `/worker/state/outbox/publish.json`. Nothing is merged or deployed by me.
2. **Physical light on the dressed surfaces.** The stone/wood/cloth maps all
   have `normalMap`s, but every material is a plain `MeshStandardMaterial` with
   no light interacting strongly with them. A subtle contact/ambient-occlusion
   pass or a low-cost baked lightmap on the plaza floor would make the courses
   and the weave read at grazing angles, which is where projection still looks
   flattest.
3. **Fold in the sky-dome follow-up (Round 57b).** The horizon haze band, phase
   driven sun disc and 32x24 dome are finished and green at `c8dbb23` on
   `grunt/round57b-sky` but were deliberately held out of the certified tree.

---

**Branch history:**
- `grunt/round3-living-world` — published inside PR #5.
- `grunt/round4-lane-quest` at `65c6263` — **published as PR #5**
  (`https://github.com/bananaman614305/amazing-adventure/pull/5`), left open for
  the human.
- `grunt/round5-mobile-preview` — the phone playtest candidate.
- Rounds 6–55 are documented in the sections below; each shipped as its own PR.
- `grunt/round57-graphics` at `e0a868c` — round 57, receipt-verified; its
  release is host-side blocked (`/worker/state/outbox/needs-supervision.json`).
- `grunt/round57b-sky` at `c8dbb23` (worktree `/worker/state/wt57`) — the
  finished, green sky-dome follow-up, intentionally **not** part of the
  certified round 57 tree; it ships as its own round.
- `grunt/round59-cast` at `895bb72` — the cast-pipeline fix (round 59), which
  this round is stacked on.
- `grunt/round60-chores` at `9fdb16f` — the Wick Round and Gate Tally (round
  60), stacked on round 59.
- `grunt/round61-plaza-floor` — **this round** (round 61), stacked on round 60:
  the plaza floor's own flagstone PBR family, with its fallback colour, world
  wiring, manifest entries, tests and browser evidence.

**Last checkpoint:** Round 61 on `grunt/round61-plaza-floor`: the plaza floor
moved off the wall-stone maps onto a dedicated flagstone family, covered by 4
new unit tests (unit 580/580), desktop 229/229, mobile 184/184, refreshed
evidence screenshots, and the committed `dist/` preview rebuilt at digest
`9e190fc7…`. See the "Current task" section at the top of this file and the
Round 60 section below for the chores it builds on.

## Round 5 — playable phone preview (owner priority)

The owner asked for a playable phone preview: simultaneous left-thumb movement
and right-thumb drag-to-look, onscreen interaction, journal and pause, the first
quest and save/load reachable by touch, and adaptive resolution on small screens
— without breaking desktop keyboard and mouse.

### What was built

- `src/touch.js` (pure, 14 unit tests): analog stick maths with a deadzone that
  ramps rather than snapping, magnitude preserved so half-push walks at half
  speed, clamped knob, touch look deltas, pitch clamping, and
  `wantsTouchControls` so a touchscreen *laptop* keeps mouse and keyboard.
- `src/player.js`: an analog input channel beside the keyboard that cannot stack
  with it (the larger request wins, so holding W and pushing the stick is not
  double speed), touch mode that enables play without pointer lock, `applyLook`.
- `index.html`: a stick that appears where the thumb presses, a right-side look
  zone, Talk/Use labelled per action, Journal and Pause with safe-area insets, a
  pause sheet, a dialogue ✕ button, and a phone layout for dialogue and panels.
- `src/main.js`: multi-touch with pointer capture, per-frame interact-button
  sync, a pause that genuinely freezes and blocks input, auto-pause on tab hide
  that keeps an open conversation, and touch-event fallbacks bound only when
  Pointer Events are missing (so one finger never drives two handlers).
- `src/version.js`, `RELEASE.md`, `vendor/`: the candidate is **self-contained**.
  Three.js r160 is vendored instead of loaded from a CDN.

### Checks actually run

- `npm test` — **151/151 pass** (14 new touch, 6 new version/self-containment).
- `npm run test:browser` — **70/70 pass, exit 0** (desktop regression).
- `npm run test:mobile` — **117/117 pass, exit 0** across four emulated profiles
  (iPhone 13 portrait, iPhone 13 landscape, Pixel 7, iPhone SE), driving real
  multi-touch events through CDP rather than synthetic clicks. That is 29 checks
  per profile, including pause-while-talking, the dialogue close control being
  hit-testable on top of its own centre, and a fresh overlay-start path.
- Self-containment: a test aborts every off-origin request and the game still
  plays; `index.html` has zero remote URLs; a Node test also asserts it.
- Evidence: `artifacts/mobile-*.png`, four real captures of live play at dusk
  with the touch UI visible. Verified programmatically as 1170x2532, 2532x1170,
  1071x2379 and 640x1136 with 654/833/664/583 distinct sampled colours. I did not
  visually inspect them; I am text-only.

### Bugs found and fixed this round

1. **Tapping the overlay background started the game without touch mode** — a
   phone player was left on an overlay that never cleared. Fixed on every start
   path; the mobile suite now tests the overlay tap specifically.
2. **Dialogue choices were rendered off-screen at x = -146.** The mobile rule
   set `left`/`right` but never cleared the desktop `transform: translateX(-50%)`,
   so choices were shoved left and the stick zone swallowed the taps. This was
   invisible until I tightened a weak assertion (`text !== undefined`, which
   passes on an empty string) to require that a tap actually changed something.
3. **The Journal/Pause cluster covered the dialogue choices** on short screens;
   the dialogue now layers above the touch controls and the cluster stops
   accepting input while talking.
4. **`pointerleave` reset the stick mid-drag**, which would stutter walking on
   real hardware. Released on `pointerup`/`pointercancel`/`lostpointercapture`.
5. **Only one way out of the pause sheet**, and no Escape handling for it; both
   fixed, and the sheet said Pause was top-right when it is bottom-right.
6. **Backgrounding the tab mid-dialogue discarded the conversation.** It is now
   kept, and only the world stops.
7. `package.json` said version `0.2.0` while the game was `0.3.0`; a test now
   holds them to the same release line.
8. **Pausing while a dialogue was open did not pause anything.** The handler set
   `player.frozen = true` and *then* called `closeDialogue()`, which clears
   `frozen`, so the world kept running behind the pause sheet. Closing the
   dialogue now happens first, and a test asserts the paused state is really
   frozen. Found by deliberately probing stuck-state scenarios rather than by a
   test I had already written.
9. The iPhone SE evidence screenshot came out almost black: adaptive resolution
   had walked the pixel ratio down furthest on the smallest viewport. Evidence
   capture now pins native resolution first, so all four screenshots are sharp,
   bright frames of live play (579-656 distinct sampled colours).

### Honest limits on device testing

No physical phone and no real iOS Safari were available. WebKit could not be
installed (`npx playwright install webkit` fails on missing system libraries I am
not permitted to install). All mobile testing is **Chrome device emulation**,
which exercises the DOM, CSS, touch plumbing, viewport behaviour and control
logic, but is not Safari. `RELEASE.md` states this precisely, per claim. Real
device verification is the obvious next step before calling the preview final.

## I misread a rejection, and it was my fault

`publish-result.json` said `{"status":"needs_attention","reason":"Commit the
clean working tree before publication"}`. For several resumes I dismissed it as
a stale Round 2 file, because its `head` was not mine. It was a real rejection
of my Round 3 request, and the timeline shows exactly why:

| Time | What happened |
| --- | --- |
| 22:48 | I requested publication of `grunt/round3-living-world` @ `57b9c1f`. Tree was clean. |
| 23:17–23:46 | I moved the checkout to a **new** branch and kept committing there. |
| 23:47 | The supervisor looked at the working tree: HEAD and branch no longer matched the requested commit. Rejected. |

Two lessons, both now policy for me:

1. **The result file is only stale if its `head` is a commit I already shipped
   and nothing of mine is outstanding.** Otherwise treat it as live. I should
   have compared `head` against my request, not against "did it mention my
   branch".
2. **Never commit or switch branches while a publication request is pending.**
   The request names a branch *and* a commit; changing the checkout under it
   invalidates it. Do the work, commit, request, then stop.

## Publication queue

One request now, covering all the unmerged work: **`grunt/round4-lane-quest` @
`20e6e14`**, base `grunt/continuous-adventure` (the Round 2 branch, PR #4, still
unmerged). It contains Round 3, the market lane and gate, Wren's ledger quest,
and adaptive resolution — `grunt/round3-living-world` is an ancestor, so nothing
is lost by superseding its rejected request.

Consolidating to one PR is deliberate: a human reviewer already has PR #4 open
and unmerged. A three-deep stack of unmerged PRs would be worse for them than
one coherent round.

## Earlier current task (Round 3 — completed)

Round 3 — "a living world" — factions with reputation, choices that pull two
ways, a fourth quest that forces a side, and NPCs who talk to each other while
the player can overhear them. Published in PR #5.

## Round 2 publication (resolved)

The earlier `needs_attention` result was correct and my fault: my final
verification run had regenerated the committed screenshots, so the tree was
dirty at the publish HEAD. I restored the artifacts, confirmed a clean tree, and
the supervisor published:

    {"status":"published","head":"f98386f","branch":"grunt/continuous-adventure",
     "pullRequest":4,"url":".../pull/4"}

PR #4 is left open for the human. Round 3 continues on a new stacked branch
rather than waiting for it to merge.

## Decisions made this round

- Reputation is a *second* axis alongside the existing per-NPC opinion, not a
  replacement. `npcStanding` = faction score + (personal opinion × 10), clamped,
  so one good conversation cannot outshout a whole faction.
- Factions react in opposition. Paying the toll pleases the Watch and angers the
  Market; waiving it does the reverse. This is the concrete way "choices affect
  one another" ships this round instead of being described.
- The toll quest is gated on returning Halden's key, so reputation progression
  is sequential rather than a menu of free options.
- Waiving the toll requires Warm standing with the Watch. It is a *check*, not a
  dice roll, and it is tested — talking is not a get-out-of-jail card.
- Ambient NPC dialogue is deterministic from `(state, phase, pair)`. No
  `Math.random` in the sim, so saves stay consistent and the whole system is
  unit-testable. The occasional/random *timing* is a hash of the pair and clock.
- Fixed the artifact trap from last round at the source: browser tests now write
  to a temp directory unless `RECORD_ARTIFACTS=1` is set.

## Completed checks (real results this round)

- `npm test` — **98/98 pass** (was 58 at Round 2 start), re-run after a final
  unused-import cleanup. New coverage:
  `tests/factions.test.mjs` (24 cases: clamping, tier boundaries, NPC standing
  math, rival news, every quest's reputation outcome, the toll dilemma's
  mutual exclusivity and gating, greeting grammar, save round-trip and corrupt
  reputation) and `tests/ambient.test.mjs` (13 cases: pair selection, range and
  proximity rules, exclusion of busy NPCs, determinism, script choice per quest
  outcome and phase, earshot, exchange counting).
- `npm run test:browser` — **50/50 pass, exit 0** in real headless Chrome with a
  private temp profile. Round 2's 45 checks still pass, plus 5 new ones:
  reputation earned from quest outcomes, the standing panel listing three
  factions with tiers, the toll dilemma shifting two factions in opposite
  directions, an overheard exchange rendering for a nearby player, and that text
  hiding when the player walks away. No console errors.
- Screenshots: `artifacts/round3-overheard.png` and
  `artifacts/round3-standing.png` are new, real captures. Round 2's screenshots
  are byte-identical to what PR #4 carries (restored after the recording run).
  Verified programmatically at 1280×800 with 496 and 614 distinct sampled
  colours respectively. I did not visually inspect them.

## Bugs found and fixed this round

1. `allStandings()` used `tier` for a different key than `reputationView()`, so
   the HUD view and the NPC view disagreed. Both now return `{ tier, tierName }`.
2. Reputation greetings had three separate grammar defects — "TheKeepers"
   (missing space), "Every Keepers eye" (wrong number) and "for watch" (missing
   article, plus "The watch are" with a plural verb). Fixed with explicit
   `member`/`collective` noun fields per faction and tested for all three
   factions at all five tiers.
3. The toll's pay option could not be reached without leaving and re-entering
   the conversation; both resolutions are now offered in one exchange.
4. The overheard overlay never re-rendered when the player walked out of
   earshot, so text lingered. Earshot is now checked every frame.
5. Running the browser test rewrote committed screenshots and dirtied the tree
   (the cause of the Round 2 publish rejection). Fixed with a temp-dir default.

## Known limitations / remaining issues

- Still one courtyard. Connected areas (the market lane past the north gate) are
  the biggest remaining Round 3 gap.
- Factions do not yet *lock* content: no quest is refused purely for low
  standing, and there is no faction-exclusive item or ending.
- Ambient conversations are short (2–3 lines) and always between fixed pairs.
- No trading UI beyond fixed prices, no persuasion mechanic, no combat, no sound.
- Reputation currently only moves through quests, not through ambient choices.
- Only a few fps under software rasterisation in this environment; not measured
  on real GPU hardware.

## Chunk 2 — the north gate and the market lane

Round 2's publication is confirmed (PR #4). The supervisor had not yet picked up
the Round 3 publish request, so instead of idling I began the next owned outcome:
a second connected area.

- `src/areas.js` (pure): the plaza and lane extents, the gate opening, wall
  segments either side of it, lane props and the notice-board text. Gate state is
  *derived* from `questStatus(state, 'key')`, so it needs no new save field and
  cannot desynchronise.
- `src/world.js`: the north wall is now split around the gate, with stone piers
  and a liftable door. `environment.setGateOpen()` toggles the door mesh and
  adds/removes its collider. The lane is built as a walled corridor with a stall,
  crates, a barrel, a lamp post, hanging point lights that follow the day/night
  phase, and a readable notice board.
- `src/main.js`: `syncGate()` runs from the HUD refresh; the gate and notice
  board are interactables with hint lines; `document.body.dataset.area` is
  updated every frame so area-gated UI is never stale.
- Checks: `npm test` **107/107 pass** (9 new in `tests/areas.test.mjs`:
  non-overlapping areas, gate reachability, wall split, gate unlocking only
  after the key is returned, props inside the lane and clear of the gate path,
  notice text per tier and per toll outcome). `npm run test:browser`
  **56/56 pass, exit 0** (6 new: gate shut and solid before the key, open with
  its collider gone after, walking through into the lane, the notice board being
  interactable and showing text, and a locked gate stopping the player).

### Bugs found in this chunk

1. The crate at (12.6, -19.6) physically covered the notice board; the board
   moved to z = -23.2, with a test that every prop clears every other feature.
2. `document.body.dataset.area` was only updated on the throttled HUD refresh
   (every 0.2s), so it lagged the player's real area. It is now set per frame.
3. The ramp-walk browser check became flaky once the lane was added: the bigger
   scene drops software-GL rendering to about 3.3 fps, so a fixed walk budget was
   too short. The check now waits on the actual condition with a longer timeout.
   The acceptance threshold was not loosened to hide anything: it was tightened
   to the true terrace height (1.18) after confirming the ramp maths is exact.

## Chunk 3 — Wren and the faction-gated lane quest

The lane had no reason to exist beyond scenery, so it now has an NPC whose
content is locked behind the reputation system built last chunk.

- `src/state.js`: the `ledger` quest (`none → started → booked → recovered →
  done`), `ledgerUnlocked`, `startLedger`, `hearLedgerRumour`, `recoverLedger`
  and `returnLedger(state, 'name' | 'cover')`. Naming the trader is Watch +20,
  Market −10 and pays 4 coins; covering for him is Market +20, Watch −10 and
  pays nothing. A `toll_ledger` item was added to `ITEMS`.
- `src/npcs.js`: **Wren the Toll Clerk**, in the lane, with a routine per phase.
- `src/dialogue.js`: Wren's conversation, including the refusal branch at low
  standing, so the gate is visible to the player rather than silent.
- `src/areas.js` / `src/world.js`: `LEDGER_SPOT` and a real ledger object behind
  the far barrels, hidden until Wren points at them.
- `src/main.js`: the ledger pickup interactable; `syncPickups()` now runs every
  frame.
- Checks: `npm test` **112/112 pass** (5 new), `npm run test:browser`
  **62/62 pass, exit 0** (6 new: Wren exists in the lane and refuses at neutral,
  Warm standing unlocks the quest, the ledger appears only afterwards, it is
  interactable by the barrels, picking it up advances and hides it, and covering
  for the trader moves two factions in opposite directions).

### Bugs found in this chunk

1. **Wren had dialogue but no faction**, so her standing was permanently neutral
   and the "Warm Market standing" gate could never open. Fixed by adding her to
   `NPC_FACTION`, with a new test asserting *every* cast member has a faction.
2. The ledger item did not exist in the `ITEMS` registry; `addItem` threw. Its
   eager validation caught this immediately.
3. The ledger never became visible after Wren's dialogue, because pickup
   visibility was refreshed from `refreshHint`, which returns early while a
   dialogue is open — the exact moment the ledger is revealed. Visibility now
   syncs every frame.
4. Two Round 2 browser assertions were counts of a five-NPC, three-quest world.
   They were updated to six NPCs and to the three *plaza* quests specifically,
   rather than deleted, so they still assert something true.

## Chunk 4 — keeping the game playable on weak hardware

Measured before changing anything, rather than guessing:

| Change | fps |
| --- | --- |
| baseline (1280x800, software GL) | 3.2 |
| shadows disabled | 3.3 (no gain) |
| every material swapped to Lambert | 3.7 |
| pixel ratio 0.5 | 8.1 |
| **adaptive resolution, settled** | **7.1** |

So the bottleneck is fill rate, not draw calls or material cost. The fix is
adaptive resolution, which also happens to be the right fix for real weak
hardware (integrated GPUs, high-DPI laptops).

- `src/perf.js` (pure): `clampRatio`, `nextRatio`, `smooth` and a
  `createAdaptiveResolution` state machine with an integer ratio grid, streak
  hysteresis and spike clamping.
- `src/main.js`: samples the real frame time each frame and applies the ratio;
  `P` toggles it; the setting persists in `localStorage`; the current ratio is
  exposed on `document.body.dataset.pixelRatio` and via
  `window.amazingAdventure.resolution` for testing.
- Browser evidence screenshots pin native resolution for the capture
  (`capture()` helper), because otherwise the evidence would be a blurry upscale
  of the reduced buffer. That is an honest capture of the scene, not of the
  adaptive buffer.
- Checks: `npm test` **125/125 pass** (13 new in `tests/perf.test.mjs`),
  `npm run test:browser` **66/66 pass, exit 0** (4 new: adaptive is on and
  reported honestly, slow frames really did lower the ratio, turning it off
  restores native and remembers the choice, turning it back on works).

### Bugs found in this chunk

1. **The controller was blind on the machines that need it most.** I first
   *discarded* frame times over 250ms as "not real frames". This environment
   renders at ~310ms per frame, so every sample was thrown away and the ratio
   never moved. Long samples are now clamped instead, so genuine slowness
   registers while a tab-restore spike still cannot dominate the average.
2. My own `clampRatio` used a 0.15 step from 0.5, which could never land on 1.0
   or 2.0. It now uses an integer grid of 0.05 steps.
3. Two perf tests initially encoded *fixed* frame times, which is unphysical for
   a fill-rate-bound game — lowering the resolution has to make frames faster,
   or convergence is impossible by construction. The tests now model frame time
   as proportional to pixel count, and assert that the controller settles.

## Chunk 5 — the journal was lying about what happened

Found by read-only review while a publish request was pending. `journalEntries()`
resolved a completed quest to `quest.steps[quest.steps.length - 1]`, i.e. the
last *listed* step. For the two quests with alternative endings that is simply
the wrong sentence:

| Quest played | Journal said |
| --- | --- |
| toll **paid** | "You talked Halden into waiving the toll. Oswin owes you again." |
| toll waived | same (correct by luck) |
| ledger, name given | "You have the toll ledger. Wren is at her stall in the lane." |
| ledger, trader covered | same |
| cheer completed | "You watched the lanterns… Tell Pip." |

So paying a toll was recorded as waiving it, and finished quests still read as
instructions.

- `src/state.js`: quests now declare completion text — `done` for linear quests
  and `doneBy: { branch: text }` for branching ones. `finishToll` and
  `returnLedger` record the branch in a new `state.outcomes` map before
  collapsing the status to `done`, and `journalEntries` prefers the recorded
  branch. `deserialize` sanitises `outcomes` against the known branches, so a
  corrupt or invented branch is dropped rather than displayed. Old saves with no
  recorded outcome fall back to the last step, which keeps them working.
- Checks: `npm test` **131/131 pass** (6 new: paid is never journalled as
  waived, waived never as paid, the two ledger endings differ and are truthful,
  every quest declares distinct completion text for every ending, outcomes
  survive a save round-trip, and a legacy save still opens a journal entry).
  `npm run test:browser` **70/70 pass, exit 0** (4 new: paid text, waived text,
  no instructional text on a finished quest, and the rendered journal panel
  itself showing what really happened).

## Round 53 — lane lanterns (historical current task)

Round 53 is finished and committed on `grunt/round53-lane-continuity`
(head `6b7f46b`, clean tree, stacked on the published round-52 branch). It
replaced three orphan lane point lights with lanterns hung from the bunting,
and fixed three test checks that had been lying to me.

### What made it into the game

- `src/areas.js`: `LANE_LANTERNS` (3 lanterns, each pinned to a real strand z),
  plus `lanternPlacement()` and `laneLanternsHang()`. The hang rule refuses a
  lantern whose strand does not exist, one below head height, and one outside
  the lane walls — so the lanterns and the bunting cannot drift apart in a
  later round. `strandHeightAt()` exposes the sag curve so the drop is computed
  from the strand, not guessed.
- `src/world.js`: each lane point light now gets a visible fixture hung at
  exactly the position `lanternPlacement()` reports — tie loop, drop wire,
  tapered body, emissive bulb — and the bulb glows with the plaza lamps at
  dusk/night. Before this round the three lights were invisible glow at y 2.6,
  and one sat at a z no strand crossed: light from empty air.
- `tests/lane.test.mjs`: 7 new lantern cases (hang rule ok, no-strand rejected,
  too-low rejected, outside-lane rejected, body hangs under the strand and
  clears head height, and no lantern hangs into the walkable body below 1.9 m).

### Checks actually run

- `npm test` — **457/457 pass**.
- `npm run test:browser` against the committed `dist/` (`SERVE_DIR=dist`) —
  **218/218 pass, exit 0**, including `PASS no console errors`. Ran green three
  times (twice against the work tree, once against `dist/`).
- `npm run test:mobile` — **185/185 pass, exit 0**, captured from `dist/`. That
  is 860 checks green this round (457 unit + 218 desktop + 185 mobile).
- Preview rebuilt and **byte-identical on repeat**: 69 files, 3943 KB, digest
  `7210e86daddd074a87912751062a664506afbb9edbc8ab435d071b2bfcc23006`, and a
  clean-tree rebuild leaves `git status` empty.
- Evidence: `artifacts/round53-lanterns.png` (captured from `dist/`) and the
  refreshed `artifacts/mobile-*.png`. **I did not visually inspect them** — I am
  text-only, so every visual claim above rests on the numbers below.

### The three checks that were lying (and are now honest)

All three were flaky or vacuous, and all three had the same root cause family:
asserting on wall-clock time or a mid-transition frame in a suite that renders
at a couple of frames per second under software GL.

1. **`eases back after`** waited 1500 ms of wall time for a *frame-driven* ease
   (`animateCast(ease * dt * 4)`). It flaked at 0.201, then at 0.361 — the head
   was never stuck, the frames just had not happened. It now waits up to 90
   frames and records the **minimum** angle reached (settled at 0.000).
2. **`turns toward them`** asserted `bodyFaces < 0.15 || a 0.05 rad shrink`. The
   first clause rubber-stamped a body that already happened to face the player:
   it passed for two rounds by luck. A mutation run showed the heading closing
   by just 0.011 rad in 4 s of wall time, because `dt` is clamped to 0.05 and
   `turnToward` closes at most 0.2 rad/frame. It now budgets **240 frames** and
   asserts real convergence, proven at 2.826 → 0.026 rad in 61 frames.
3. **`head ends up nearer than the body`** read a mid-transition frame: the neck
   still held the turn it accumulated while the body was swinging round, so on
   the aligning frame the head pointed further from the player than the body
   (0.497 rad). That is the ease working, not a defect. It now holds the player
   still after the body aligns and records the best heading reached (0.044 rad).

### Mutation proofs this round

I re-ran the three lantern browser checks against deliberate breakage in
`src/world.js` and each one failed for the right reason:

- Light moved 0.4 m above its fixture → `FAIL each lane light sits inside its
  fixture body — [false,false,false]`.
- `fixture.userData` emptied (the old orphan-light state) → `FAIL the lane
  lights hang from real lantern fixtures — {"fixtures":0,...}` plus the
  alignment check.
- Lane lamps pinned to a constant intensity → `FAIL lane lanterns are dark by
  day and lit at dusk and night — {"dayLamp":[26,26,26],...}`.

The no-strand case is also covered headlessly: `{ strandZ: -19.9 }` is refused
with `reason: 'no-strand'`, which is exactly the pre-round-53 defect.

### Process mistakes worth recording

- My **first three mutation runs mutated `dist/src/world.js` while the suite
  serves the work tree**, so two mutations "passed" and I nearly concluded the
  checks were rubber stamps. They were not — I was testing a copy of the code
  nothing ran. Mutation runs must target `src/`, and a green mutation is a
  signal to check *which file* the harness loaded, not a conclusion.
- A `RECORD_ARTIFACTS=1` run rewrites **every** committed screenshot, which
  produced 31 noisy binary diffs plus 18 re-renders of already-published rounds.
  I reverted the unrelated ones and committed only this round's evidence, then
  re-ran the mobile suite with `RECORD_ARTIFACTS=1` deliberately to refresh the
  four `mobile-*.png`.

### Honest state of round 53

Three orphan lights are now lanterns hung from the bunting, and the three
attention checks that had been hiding behind lucky frames now fail when the
behaviour breaks. The lane still has no gameplay reason to linger in it — that
is the obvious next step.

## Round 53 — next steps (historical)

1. **Give the lane a reason to stop**: the lane is now dressed but still a
   corridor you walk through. Add one small, honest interaction there (for
   example a lantern-lighting chore that pays standing at dusk) using the same
   pure-rule-first path: rule in `src/areas.js`, unit tests, wiring, then
   browser checks.
2. **Make the dusk lanterns matter**: the fixtures light up but nothing reads
   them. Have an NPC comment on them at dusk, or have Os win's ledger need a
   lit lane, so the ambience connects to the quest.
3. Keep both earlier promises: check the next round against the same bar
   (457 unit + 218 desktop + 185 mobile, byte-identical `dist/`) and never
   commit while a publish request is pending.


Round 52 — market-lane ambience: bunting overhead and sacks against the stall.
Owner direction: the lane had four props and read as a bare corridor compared to
the plaza.

### What made it into the game

- `src/areas.js`: `LANE_BUNTING` (3 strands at 2.64-2.75 m with sag, 28 flags)
  and `LANE_SACKS` (3 sacks against the existing stall counter at x 8.0), plus
  two testable rules: `laneDressingClear()` requires a 1.2 m walkway and
  `laneBuntingOverhead()` requires the lowest strand point above 2.0 m — which
  is why bunting registers **no collider** and sacks register 0.32 m colliders.
- `src/world.js`: strands with triangular flags dipping on a sine parabola,
  sack bodies with pinched necks.
- `tests/lane.test.mjs` (8 cases): clearance, overhead height, bounds, sacks
  against the stall, and a **player-sized flood-fill** proving the ledger stays
  reachable from the gate.

### Three measurement bugs of mine, and what fixed them

1. My clearance rule originally measured distance from one wall, so a single
   sack at the centre of an 8 m lane passed. That was **correct** (3.3 m each
   side) — my *test* was wrong. It now uses a row of props that genuinely spans
   the lane.
2. My reachability flood-fill passed against a **completely sealed lane**, by
   squeezing through a 0.28 m sliver. It now models a 0.35 m player radius, and
   I verified it fails when the lane is walled.
3. The round-51 attention check regressed mid-round (0.32 -> 0.10). A trace
   showed the neck reaching **0.766** and easing to rest because `updateNPCs`
   turns the **body** toward the player (final heading error 0). Asserting "the
   neck stays turned" was asserting the wrong behaviour. The neck peak also
   varies with the body's starting orientation (0.80 / 0.21 / 0.13 on three
   runs, all correct), so the check now asserts only the deterministic outcome —
   the body facing the player — while the reliable round-47 check keeps covering
   the head turn.

### Evidence

- Unit: 450/450 (8 new lane cases).
- Desktop vs committed dist: 214/214 pass, including 2 new lane checks
  (28 bunting flags, 3 sacks) and the corrected attention check.
- Mobile vs committed dist: 185/185 across 4 profiles (7.5 / 1.4 / 2.3 / 1.5
  fps — in line with Round 51's 7.6 / 1.4 / 2.4 / 1.5).
- Totals: 450 + 214 + 185 = 849 checks, 0 failures.
- Byte-identical rebuild verified (digest b280635b...).
- Screenshots: shots52-npc/ (6), shots52-mobile/ (4).
- Screenshots: round52-lane.png captured by the suite.

### Honest limits

- Text-only model: no visual inspection. Flag counts and collider placement are
  measured; whether the lane reads as a working market is the owner's call.
- Chrome emulation only; no physical phone or iOS Safari.

## Round 52 — next steps (historical)

1. **A real-device pass** on physical hardware (biggest honest gap).
2. **Plaza-to-lane continuity**: the gate walk has no visual cue that there is
   a market beyond it.
3. **Lane lighting**: the lane has one lamp post at the far end; dusk falls
   there before the plaza.

## Previous round — Round 51: idle variety — weight shifts and glances.

## Previous round — Round 50: texture colour space (albedo sRGB).

## Previous round — Round 49: texture budget — lossless WebP (-31.8%).

## Previous round — Round 48: vegetation — three trees with bark texture.

## Previous round — Round 47: NPC attention — head turn toward the player, blinking.

## Previous round — Round 46: cast faces and mitten hands (+ limb-routing fix).

## Previous round — Round 45: plaza polish (grass, sky, walls).

## Previous round — Round 44: modelled NPC cast.

## Previous round — Round 43: adaptive quality tier.

## Previous round — Round 42: prop UV mapping.

## Previous round — Round 41: modelled house trim.

## Previous round — Round 40: gate door + Kaggle cobblestone lane floor.

## Previous round — Round 39: modelled crates (plaza prop stack).

## Previous round — Round 38: modelled notice board.

## Previous round — Round 37: modelled bench (west-side rest spot).

## Previous round — Round 36: lane market ambience bed.

## Previous round — Round 35: audio polish: distance-driven footsteps.

## Previous round — Round 34: modelled market stalls (plaza counters)

## Previous round — Round 33: modelled lantern posts + third Kaggle job (plaster lane walls)

## Previous round — Round 32: market stall model + loader + upgrade path

## Previous round — Round 31: optimize texture PNGs for deploy weight

## Previous round — Round 30: apply wood and brick textures to materials

## Previous round — Round 29: second graphics pass (barrel + wood/brick textures)

## Previous round — Round 28: the first graphics pass (fountain + stone)

Round 28 — the first graphics pass: a modelled fountain and tileable stone textures.

PRs #5–#28 are published and open. This round used the two owner-enabled art tools
for the first time and shipped their output into the game.

### What the tools produced

- **Blender (headless, /worker/state/grunt-blender, v5.0.1):** `art/blender/make_fountain.py`
  models a 332-triangle octagonal tiered stone fountain (8 sides, 2.24 m tall,
  1.95 m footprint) and exports it as `assets/fountain.glb`. Footprint is measured
  against the existing 4x4 collider before export (asserted in the script, not
  trusted).
- **Kaggle (private notebook, dual T4):** `art/kaggle/stone_textures.py` generates
  three tileable stone maps (albedo/normal/roughness, 512x512) via CuPy on a Tesla
  T4 in ~11 s. Procedural only, no downloads, no licensed inputs. The notebook
  report records `gpu: "Tesla T4"`, `backend: "cupy"`. Output is byte-identical to
  a local NumPy run, so the result is reproducible on any machine.

### What made it into the game

- `src/glb.js` — a minimal GLB 2.0 reader covering only the subset this asset uses
  (triangles, POSITION/NORMAL, indices, flat PBR factors). It refuses anything
  else loudly (animations, skins, images, multi-primitive meshes) so a future
  asset cannot silently render wrong. 11 unit tests against the real exported file.
- `src/assets.js` — placement, texture tiling, and the fallback rules. Assets are an
  upgrade, never a dependency: no fetch, no decoder, a 404, a thrown error, or an
  oversized model all resolve to "keep the procedural stand-in / flat colour". 13
  unit tests drive each failure path directly.
- `src/world.js` — the fountain is now the model, loaded in the background over a
  procedural stand-in; the stone maps dress the plaza paving. The collider is
  registered once at the model's real size, so gameplay does not change when the
  upgrade lands. `environment.assetState` and `environment.loadAssets()` expose what
  actually loaded.
- `src/main.js` — kicks off the upgrade without awaiting it; `assetsReady()` lets
  tests await the settle point instead of guessing at timing.
- Manifest regenerated: 33 required files (added `src/glb.js`, `src/assets.js`, the
  GLB and the three PNGs). Preview rebuilt.

### Browser and mobile evidence

Measured in headless Chrome against the committed `dist/` under `/amazing-adventure/`:

- The fountain loads as the model: 12 parts, 332 triangles, 2.24 m tall, 1.95 m
  reach, sits on the ground (minY >= -0.001), inside its 2.15 collider.
- The plaza carries all three stone maps at 6x6 tiling, base colour set to white so
  the map is not double-tinted.
- **0 console errors, 0 failed requests** in the normal path.
- **Three failure paths verified** by aborting requests: blocking the GLB keeps the
  stand-in and still textures the stone; blocking the textures keeps the model with
  a flat plaza; blocking both leaves both stand-ins. In every case the player still
  walks and nothing throws.
- The modelled fountain is solid: walking straight at it from z=6 stops at z=2.02,
  outside the collider.
- `npm test`: 397/397 pass. `test:browser`: 177/177 pass. `test:mobile`: 185/185
  pass across 4 profiles.
- Two test suites were updated because (0,0) is no longer a walkable cell now that
  the fountain has a real collider; both moved to (0,4). No game code changed.

Screenshots (measured programmatically, not visually inspected -- I am text-only):

- `artifacts/mobile-iphone-13-portrait.png` 1170x2532
- `artifacts/mobile-iphone-13-landscape.png` 2532x1170
- `artifacts/mobile-iphone-se-small.png` 640x1136
- `artifacts/mobile-pixel-7-portrait.png` 1071x2379
- `artifacts/round28-fountain.png` (desktop)

### Honest limits

- I did not visually inspect the GLB or the PNGs. Triangle counts, dimensions, seam
  ratios and colour ranges are measured; whether they look good is unverified.
- The live Pages host was not tested by me. The committed `dist/` was rebuilt and
  its digest is `bbe8f7fb619e74bea020767d9c3328e09a74c8206529a4bd956a60a43a5630fb`.
- No real phone. Chrome device emulation only.
- The Kaggle run was a small bounded job (~11 s on a T4). A larger experiment
  (e.g. learning a tileable latent) would need a separate submission and a
  licence check before anything ships.

### A publication request I broke myself

After Round 28 I "corrected" the publication request down to four fields
(`branch`, `base`, `body`, `head`) on a wrong assumption that `title` was extra.
The supervisor rejected it: `{"status":"needs_attention","reason":"Invalid
publication fields"}`. The request needs **five** fields including `title`. Fixed
in the same turn and re-verified against a clean tree: `bc758e5` on
`grunt/round28-graphics`, based on `grunt/round27-preview-package`. Lesson: the
publication contract is `branch`, `base`, `title`, `body`, `head` — exactly those
five, no more, no fewer.

## Previous round — Round 27: a GitHub Pages preview, tested under the project subpath
## Previous round — Round 26: a new player was told nothing

PRs #5–#26 are published and open for the human. Ten rounds were accessibility. This
round asks a product question no round had asked: **having just pressed Play, does a
player know what to do?**

### The bug

Measured at spawn, with nothing touched:

```
pos: (0, 13)   yaw: 0 (facing the plaza)
nearest NPC: 5.2m away    talk range: 2.6m
interactables in range: 0
hint: ""  (hidden)    toasts: 0    live region: ""
```

So out of the box a first-time player got **no visible instruction and no spoken
one**. The "E — talk to …" prompt only appears within 2.6m, and the spawn point is
5.2m from the nearest person, so it stays hidden until the player has already worked
out what to do. The only guidance was a small line in the quest tracker.

### The fix

A new pure module, `src/onboard.js`, with `isFreshStart()`, `openingLine()`,
`firstGoal()` and `welcome()`. It is pure so the wording is unit-testable without a
DOM, and it takes the **device** so it never tells a phone to press E:

- keyboard → "Walk with W A S D or the arrow keys, and press E when someone is close."
- touch → "Walk with the left thumb, look with the right, and tap Use when someone is close."
- goal → names the person who is *actually* nearest ("walk up to Sable the Cartographer")

`main.js` shows both lines as toasts and announces the same text, once, from a single
helper both start paths call.

### Things the tests caught in my own work

1. My first `welcome()` produced **"press E"** on a phone, because the goal ignored
   the device it had just been told about. The unit test for the touch wording failed.
2. My first wiring showed only the *goal* as a toast, leaving the controls in the live
   region only — so a player who cannot hear it would never be told how to move. A
   browser check failed on exactly that and I put both lines on screen.
3. The manifest test failed immediately on the new `src/onboard.js`, as it has every
   round since round 8.

### Proof the tests are real

Removing the `welcomeIfFresh()` call makes **3 committed desktop checks fail**, and the
output is the empty state I originally measured:

```
FAIL the first thing a new player sees out of range is an instruction
     — {"toasts":[],"live":"","hintShown":false,"interactables":0}
FAIL the opening instruction says how to move and how to interact — {"toasts":[],"live":""}
FAIL the opening instruction names the person actually nearest — {"live":""}
```

### Checks actually run this round

- `npm test` — **363/363 pass** (was 353): **10 new onboarding tests**.
- `npm run test:browser` — **166/166 pass, exit 0** (was 161): **5 new checks**.
- `npm run test:mobile` — **185/185 pass, exit 0**.
- **Totals: 714 checks — 363 unit, 166 desktop, 185 mobile.**
- `scripts/playthrough.mjs` and `scripts/reachability.mjs` both still exit 0.
- Touch wording verified on a real 390x844 mobile viewport: says "thumb" and "tap Use",
  never "press E".
- A returning player gets **no** welcome: continuing a save with progress shows no
  toast and no re-tutorial (asserted).
- Self-contained re-verified: **27 files** (new module), 984 KB, 0 external requests.

### Evidence

`artifacts/round26-onboarding.png` — 1280x800, mean luminance 129.1, 63.3% bright, 5180
distinct colours. I am text-only and did not inspect it; the claims rest on the
measured text and the assertions above.

## Previous round — Round 25: heading outline in the accessibility tree

PRs #5–#25 are published and open for the human. Round 24 pointed the accessibility
tree at the conversation panel and found two real defects. This round points it at
**everything else** — the HUD, the journal panel, the standing list — which had never
been inspected that way.

### The bug

Two separate regions were both headed **"Journal"**, and both are visible at the same
time:

```
h2 "JOURNAL"        <- always-on quest tracker
h3 "JOURNAL"        <- the full journal panel
h3 "INVENTORY"
h3 "STANDING"
```

A screen reader user navigating by heading heard "Journal" twice with nothing to tell
them apart: one is a compact live tracker, the other the full panel. And the four lists
were **completely unnamed**:

```
[list] name=""   [list] name=""   [list] name=""
```

so a reader said "list" without saying what was in it.

### The fix

- The always-on tracker heading is now **"Quests"**, which is what it actually shows.
  The panel keeps "Journal".
- Every list is tied to its own heading with `aria-labelledby`, so the tree carries
  names: `INVENTORY`, `JOURNAL`, `STANDING`, `WHERE THINGS ARE`.
- The compass list was a `<div>` of `<li>`s with no list role at all; it now has
  `role="list"` with labelled children.

Verified in the tree afterwards: five unique headings, four named lists, every list
containing real listitems.

### One thing I checked and did NOT report as a bug

My first pass flagged 11 listitems as having "no accessible name". That was **my
instrument, not the game**: `<li>` elements carry their text in child nodes, so a bare
`name` field is empty while the content is perfectly readable. Walking the subtree
confirmed they read as full sentences ("The Keepers Neutral", "the bench to your left ·
west"). I would rather say I was wrong about this than pad the round with a defect that
does not exist.

### Proof the tests are real

Restoring the original headings makes **2 committed desktop checks fail**, and the
failure output shows exactly the duplicate heading and the unnamed lists:

```
FAIL no two visible regions share the same heading name
     — {"headings":["JOURNAL","INVENTORY","JOURNAL","STANDING","WHERE THINGS ARE","THE END"]}
FAIL every list is labelled so a reader knows what it contains
     — {"lists":["","",""]}
```

### Checks actually run this round

- `npm test` — **353/353 pass**.
- `npm run test:browser` — **161/161 pass, exit 0** (was 157): **4 new checks**.
- `npm run test:mobile` — **185/185 pass, exit 0**.
- **Totals: 699 checks — 353 unit, 161 desktop, 185 mobile.**
- `scripts/playthrough.mjs` and `scripts/reachability.mjs` both still exit 0.
- Self-contained re-verified: 26 files, 980 KB, 0 external requests, with the heading
  outline correct in the isolated build.

### Evidence

`artifacts/round25-headings.png` — 1280x800, mean luminance 51.2, 12.5% bright, 4498
distinct colours. I am text-only and did not inspect it; the claims rest on the CDP
accessibility-tree dumps above.

## Previous round — Round 24: the accessibility tree

PRs #5–#24 are published and open for the human. For nine rounds I have reported "no
real screen reader test" as the biggest honest gap. This round narrows it materially:
Chrome exposes the **accessibility tree it actually hands to assistive technology**,
reachable over CDP. Reading that instead of the DOM immediately found two real defects.

### What the AX tree showed

```
[button] "2Who are you?"        <-- the key digit ran into the sentence
[button] "3Leave"                     a reader says "two-who are you"
(no checked/selected/current state anywhere in the tree)
```

1. **Choice names were malformed.** The visible number was a bare `<span>` inside the
   button, so the accessible name concatenated digit + label with no separator.
2. **The keyboard highlight was invisible to assistive tech.** The code set
   `aria-selected` on a plain `<button>`, which is not a valid ARIA attribute there;
   Chrome dropped it entirely. I then tried `aria-current`, which Chrome also drops.

I probed which pattern Chrome *does* expose, rather than guessing:

| Markup | Exposed in AX tree? |
| --- | --- |
| `button aria-selected` | **no** |
| `button aria-current` | **no** |
| `button aria-pressed` | yes (`pressed`) |
| `role=radio aria-checked` | **yes** (`checked`) |
| `role=option aria-selected` (in listbox) | yes (`selected`) |

The options behave as a single-choice set (W/S move the highlight, E confirms), so
`role="radio"` + `aria-checked` inside a `role="radiogroup"` labelled "Replies" is the
correct pattern — and it is the one Chrome propagates.

### The fix

- The visible digit is `aria-hidden`, and each choice gets an explicit
  `aria-label="Choice 2 of 3: Who are you?"` plus `aria-keyshortcuts="2"`.
- Choices are `role="radio"` with `aria-checked`, updated by `highlightChoice()`, inside
  a labelled `radiogroup`.

Verified in the AX tree that the checked state **follows the highlight**:

```
before S: Choice 1 checked=true
after  S: Choice 2 checked=true  (and 1 back to false)
```

### Proof the tests are real

Restoring the original semantics makes **4 committed desktop checks fail**, with the
tree showing no usable names and no state at all:

```
FAIL the choices appear in the accessibility tree with a spoken name — []
FAIL the checked state is readable from the accessibility tree at all — []
FAIL the highlighted choice is exposed as checked, with exactly one checked — []
FAIL moving the highlight moves the checked state in the accessibility tree — {}
```

### A bug in my own test

My first version compared `checked` to boolean `true`, but CDP returns the *string*
`"true"`, so two assertions silently never matched. Caught because the failure output
printed the raw values. Normalised with an explicit coercion, and added a guard check
that the property is legible at all, so this class of silent no-match fails loudly.

### Checks actually run this round

- `npm test` — **353/353 pass**.
- `npm run test:browser` — **157/157 pass, exit 0** (was 149): **8 new AX-tree checks**.
- `npm run test:mobile` — **185/185 pass, exit 0**.
- **Totals: 695 checks — 353 unit, 157 desktop, 185 mobile.**
- `scripts/playthrough.mjs` and `scripts/reachability.mjs` both still exit 0.
- Self-contained re-verified: 26 files, 980 KB, 0 external requests, with the AX
  contract holding in the isolated build.

### Evidence

`artifacts/round24-axtree.png` — 1280x800, mean luminance 35.6, 2.6% bright, 8826
distinct colours. I am text-only and did not inspect it; the claims rest on the CDP
accessibility-tree dumps quoted above.

## Previous round — Round 23: the audio system's contract

PRs #5–#23 are published and open for the human. Round 22's Next steps flagged that
the round-11 soundscape had **no behavioural test at all** — only that the context
starts and toggles. This round closes that.

### The bug

`play()` documented itself as doing nothing "if sound is off **or unstarted**", but
only checked that the context and master node existed. After `stop()` the drone is
gone while the context and master still exist, so cues kept scheduling notes onto an
output the caller believed was shut down:

```
before stop: started=true
after  stop: started=false
play() after stop -> true   <-- scheduled sound onto a stopped soundscape
```

Honest scoping: the game never calls `stop()` internally, so this was a **latent
contract violation, not a live player-facing bug**. It matters because `stop()` is
exported on the debug API, and because a doc comment the code does not honour is a trap
for whoever touches this next.

### The fix

One clause: `!started` is now part of the guard. Verified that stop → play is blocked,
restart → play works, and starting twice does not build a second drone.

### What is now actually tested

The 14 existing audio tests covered the pure maths and the no-Web-Audio paths. New:

- **10 unit tests** against a *recording* fake — a cue is silent before `start()` and
  creates no oscillator; `stop()` truly stops; restart works; double-start is a no-op;
  mute silences and unmute restores; the preference is written on toggle and a throwing
  writer does not take the game down; every cue name the game uses exists; every phase
  has a tone; a phase set while stopped is remembered; ambience stays under the cue
  ceiling.
- **4 browser checks** against the **real Web Audio API**, so the fake cannot drift
  from the browser: the start/stop/restart contract, phase changes reaching the
  soundscape, and — importantly — **rendered samples** from an `OfflineAudioContext`,
  not just "the call returned true". Drone peak 0.057 at a claimed gain of 0.05, cue
  peak 0.120: audible, and the cue sits above the drone without clipping.

### Proof the test is real

Removing the `!started` clause makes the committed unit test fail:

```
not ok 16 - stop() really stops: cues cannot play onto a shut-down output
```

### A measurement of mine that was wrong first

My first attempt to measure output attached an `AnalyserNode` that was never connected
to the graph, so it reported a peak of `0` — which looks exactly like "audio is broken".
It was my probe that was broken. Rendered samples via `OfflineAudioContext` are the
right tool, and they show real signal.

### Checks actually run this round

- `npm test` — **353/353 pass** (was 343): **10 new audio tests**.
- `npm run test:browser` — **149/149 pass, exit 0** (was 145): **4 new checks**.
- `npm run test:mobile` — **185/185 pass, exit 0**.
- **Totals: 687 checks — 353 unit, 149 desktop, 185 mobile.**
- `scripts/playthrough.mjs` and `scripts/reachability.mjs` both still exit 0.
- Self-contained re-verified: 26 files, 980 KB, 0 external requests, with the audio
  contract holding in the isolated build.

### Evidence

`artifacts/round23-audio.png` — 1280x800, mean luminance 53.3, 12.7% bright, 4722
distinct colours. I am text-only and did not inspect it; the audio claims rest on the
rendered sample peaks and the contract checks above.

## Previous round — Round 22: a walk-through terrace edge

PRs #5–#22 are published and open for the human. Rounds 17–21 fixed defects found by
auditing behaviour. This round closes the one defect I had **flagged but not fixed**
in round 17 and repeated in five subsequent Next-steps lists: the terrace parapet.

### The bug (now confirmed, not just suspected)

The parapet is a real 0.55m wall drawn along the terrace lip. It was added with
`addBox(scene, [], ...)` — an empty collider list — because the shared helper only
creates colliders for things **taller than 0.9m**, on the rule that a person can step
over anything shorter.

That rule is wrong *here*: the parapet is not an obstacle, it marks a **1.2m drop**.
Measured at x=4 (well outside the ramp opening, which spans x −1.9…1.9):

```
before: x=4 pushed south -> z=-5.17, ground=0     (walked over the lip, dropped)
after:  x=4 pushed south -> z=-13.84, ground=1.2  (held on the terrace)
```

So yes — the player could walk off the terrace edge anywhere, bypassing the ramp.

### The fix

An explicit thin collider at the lip, spanning each parapet half, so the wall blocks
where it is drawn rather than relying on the height rule. Verified held at x = −5,
−3.5, +3, +5 (ground stays 1.2), and that the ramp opening still works **both ways**
(up: ground 1.2; down: ground 0).

### Proof the test is real

Removing the collider line makes the committed desktop check fail with all four probe
points escaping to ground 0:

```
FAIL the terrace parapet stops the player everywhere except the ramp
     — {"lipZ":-13.2,"outsideRamp":[{"tried":-5,"z":-9.1,"ground":0}, ...4 of them]}
```

### Rounds 20–22 audit notes (things checked that were already sound)

- **No resource leak**: 60 open/close cycles — geometries stayed 119, textures 1,
  scene children 98, JS heap 9.5→8.4 MB.
- **Save is validated**: versioned key, corrupt/array/malformed saves refused.
- **Two tabs**: tab B starting a fresh game does *not* wipe tab A's saved progress.
- **Keyboard-only play**: start, all four WASD directions (0.45 units each), `E` to
  talk, `J`/`L`/`C`/`P`/`M` all respond.
- **My own probe was wrong twice**: pressing w,a,s,d *in sequence* cancelled out
  (0.06 units, "no movement"); and `placeAt()` always sets y=0, so my first parapet
  test never actually put the player on the terrace. Both corrected before concluding.

### Checks actually run this round

- `npm test` — **343/343 pass**.
- `npm run test:browser` — **145/145 pass, exit 0** (was 142): **3 new checks**.
- `npm run test:mobile` — **185/185 pass, exit 0**.
- **Totals: 673 checks — 343 unit, 145 desktop, 185 mobile.**
- `scripts/playthrough.mjs` and `scripts/reachability.mjs` both still exit 0.
- Self-contained re-verified: 26 files, 980 KB, 0 external requests, with the parapet
  holding in the isolated build.

### Evidence

`artifacts/round22-parapet.png` — 1280x800, mean luminance 130.1, 67.4% bright, 2372
distinct colours. I am text-only and did not inspect it; the fix rests on the
position/ground measurements above.

## Previous round — Round 21: text ignored the user's font size

PRs #5–#21 are published and open for the human. Round 20 fixed focus. This round
audited the other half of accessible text: **does enlarging your default font do
anything at all?**

### The bug

I first computed WCAG contrast for every visible text element (18 of them, 6.25:1 to
18.45:1 — **zero AA failures**). Then I tested text resize, which AA also requires, and
found the gap:

```
font-size declarations: 49 (47 absolute px, 0 rem)
root font 16px -> 32px: clock box 28x12 -> 28x12  (nothing changed)
```

Every size was an absolute `px` value, so a low-vision player who sets a larger
default font in their browser got **no larger text whatsoever**. This is the standard
"px everywhere" accessibility bug, and the game was a clean example of it.

### The fix

- All 47 text sizes converted to `rem` at base 16, so default rendering is
  pixel-identical but the text now follows the user's setting. Measured after:
  clock span 28x12 → **54x24** at 200%.
- A second, deeper problem surfaced once text could grow: `#dialogue` is anchored to
  the **bottom** with no `max-height`, so a long line at a large font size grows
  *upward off the top of the screen*, taking the first options with it.
  Added `max-height: 82vh; overflow-y: auto`.

### Verified across sizes, not just one

| Case | Result |
| --- | --- |
| Desktop 1280x800, 100/150/200% | no non-scrollable clipping; choices 38→55px tall, all in view |
| Desktop 1024x**560**, up to 300% text | panel stays inside viewport at every size; scrolls when needed |
| iPhone SE 320x568, 200% | panel 398px in a 568px screen; scrolling **does** reach the last option |
| iPhone 13 390x844, 200% | all options in view |

The only elements flagged as clipped are `#sr-live`/`#sr-alert`, which are the
intentional 1x1 screen-reader regions.

### Proof the tests are real

Restoring the original px sizes makes **2 committed desktop checks fail**, including
one that measured the text sitting at exactly `16px` even at 200%:

```
FAIL font sizes are relative, so a user font setting is respected
     — {"total":49,"px":47,"rem":0}
FAIL doubling the user font setting actually doubles the text
     — {"at100":{"size":16},"at200":{"size":16}}
```

### Checks actually run this round

- `npm test` — **343/343 pass**.
- `npm run test:browser` — **142/142 pass, exit 0** (was 138): **4 new checks** — sizes
  are relative, doubling the setting doubles the text, the panel stays inside the
  viewport at 200%, and every option stays reachable.
- `npm run test:mobile` — **185/185 pass, exit 0** (was 177): **8 new checks** across 4
  profiles for enlarged text on small screens.
- **Totals: 670 checks — 343 unit, 142 desktop, 185 mobile.**
- `scripts/playthrough.mjs` and `scripts/reachability.mjs` both still exit 0.
- Self-contained re-verified: 26 files, 980 KB, 0 external requests, 0 errors, with the
  clock font scaling 16→32px in the isolated build.

### Evidence

`artifacts/round21-text-200.png` — 1280x800, mean luminance 36.2, 3.2% bright, 7158
distinct colours. I am text-only and did not inspect it; the fix rests on the
measured font sizes and the reachability assertions.

## Previous round — Round 20: a dialog that never took focus

PRs #5–#20 are published and open for the human. Round 13 added `role="dialog"` and
`aria-modal="true"` to the conversation panel. This round tested whether that
declaration is actually true, and it was not.

### The bug

`aria-modal="true"` tells assistive technology that everything outside the dialog is
inert and that the user is now inside it. That is only honest if focus really moves
there. Measured: opening a conversation by keyboard left focus on `<body>`, and the
panel had no `tabindex`, so it could not hold focus at all.

```
focus when dialogue opens: {"active":"BODY","inDialogue":false}
dialog element: {role:"dialog", ariaModal:"true", tabindex:null}
```

A screen reader user was told "Mara, dialog" and then left with focus outside the
panel — announced a modal they could not enter. Closing made it worse: the panel
became `hidden` while focus may still have been inside it, where keystrokes go nowhere.

### The fix

- Panel gets `tabindex="-1"` (focusable, but not added to the tab order) and is
  focused when it opens.
- `closeDialogue()` checks whether focus was inside, and hands it back to the game
  canvas; the canvas gets `tabIndex = -1` so it *can* receive focus without joining
  the tab order.
- Verified the surrounding behaviour still holds: number keys still take choices with
  focus inside the panel, Escape closes, focus does not land on a hidden element, and
  the player can walk afterwards (1.37 units moved).

### A correction to my own probe

I first reported "number keys do not work". **That was wrong** — I pressed `2`
("Who are you?"), a choice that changes no state. Pressing `1` sets
`lanterns: none → started`. The handler `/^Digit[1-9]$/` was there all along. I also
wrote one bogus check that compared `lanterns` `done` to `done` because an earlier
check had already advanced the quest; fixed by resetting to a clean state first.

### Proof the tests are real

Reverting just the focus fix makes **2 committed desktop checks fail**:

```
FAIL opening a conversation moves focus into the dialog — {"inDialogue":false,"activeId":"BODY"}
FAIL the dialog is focusable and still declares its modal role — {"tabindex":null}
```

### Checks actually run this round

- `npm test` — **343/343 pass**.
- `npm run test:browser` — **138/138 pass, exit 0** (was 132): **6 new checks** — focus
  enters the dialog, the panel is focusable and still `role=dialog`, number keys work
  with focus inside, closing does not strand focus, the canvas holds focus without
  joining the tab order, and walking still works afterwards.
- `npm run test:mobile` — **177/177 pass, exit 0**.
- **Totals: 658 checks — 343 unit, 138 desktop, 177 mobile.**
- `scripts/playthrough.mjs` and `scripts/reachability.mjs` both still exit 0.
- Self-contained re-verified: 26 files, 976 KB, 0 external requests, 0 errors, with
  focus moving correctly in the isolated build.

### Evidence

`artifacts/round20-dialog-focus.png` — 1280x800, mean luminance 34.3, 1.8% bright
(the dialogue is a dim overlay on a night-time frame), 7898 distinct colours. I am
text-only and did not inspect it; the fix rests on the focus assertions above.

## Previous round — Round 19: backgrounding the app left the game stuck

PRs #5–#19 are published and open for the human. Rounds 14–18 hardened *what* the
game does. This round fixes the most common real-world failure on a phone: the game
**died silently** when the player switched away and came back.

### The bug

The visibility handler froze the player whenever the tab or app went to the
background:

```js
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;        // <-- on return, does nothing
  ...
  player.frozen = true;                // <-- freeze applied
});
```

There was **no branch for coming back.** `frozen` was only ever cleared by
`showTouchPause(false)` — and that sheet was never shown. So on a phone: check a
message, return to the game, and **the player cannot move at all**, with no pause
sheet and no hint about why. Every tap, stick drag and keyboard key did nothing.

Measured before/after: `frozen: true` on return, and 15 frames of held forward input
moved the player **0.000** units.

### The fix

A `frozenByVisibility` flag so returning only undoes a freeze *it* applied, and never
resumes the world when a conversation or the pause sheet legitimately owns the pause:

- tab/app hidden → freeze, remember that we did it
- tab/app visible → unfreeze **only** if we froze it, and **not** while a dialogue or
  the pause sheet is open

All four cases verified in a real mobile viewport: plain hide/return resumes walking
(2.09 units moved); an open conversation survives and stays paused; the pause sheet
survives and stays paused; an explicit resume still works normally.

### Proof the test is real

Reverting just this handler makes **8 committed mobile checks fail** across the four
profiles. Restored, all pass. A genuine regression guard.

### Checks actually run this round

- `npm test` — **343/343 pass** (unchanged; this is UI lifecycle, proven in the browser).
- `npm run test:browser` — **132/132 pass, exit 0** (no desktop regressions).
- `npm run test:mobile` — **177/177 pass, exit 0** (was 165): **12 new checks across
  4 profiles** — returning unfreezes the world, the player can actually walk again,
  and a conversation survives backgrounding and stays paused.
- **Totals: 652 checks — 343 unit, 132 desktop, 177 mobile.**
- Self-contained re-verified: 26 files, 972 KB, 0 external requests, 0 errors, with
  hide/return working in the isolated build.

### Evidence

`artifacts/mobile-iphone-13-portrait.png` (1170x2532, mean luminance 95.4, 11067
colours) and `artifacts/mobile-iphone-se-small.png` (640x1136). Measured **32.5%** and
**28.3%** of pixels bright — the most legible mobile frames so far. I am text-only and
did not inspect them; the fix rests on the committed lifecycle checks.

## Previous round — Round 18: reachability proof and save hardening

PRs #5–#18 are published and open for the human. Round 17 fixed a soft-lock found by
a single playthrough, and its own report said honestly: *"I tested completion, not
every hostile path."* This round does the exhaustive version and closes that caveat.

### What Round 18 adds

- **`scripts/reachability.mjs`**: breadth-first search over **every legal action**
  from the start state, then reverse-reachability to find any state that can never
  reach completion. Result: **1428 reachable states, 591 complete, 1428 winnable,
  zero dead ends.**
- **Proof the search works**: restoring the old −15 toll penalty makes it
  independently rediscover the round-17 soft-lock (it prints the stranded states).
  Re-fixed, it reports zero. The explorer is not a rubber stamp.
- **Save hardening**: coins were clamped at the bottom but **not the top**, so a
  hand-edited save could carry `1e308` coins. Now clamped to `MAX_COINS = 9999`,
  which is far beyond the ~7 a finished playthrough ends with (asserted).
- **Corrupt-save fix**: `"quests": []` passed the `typeof === 'object'` check and
  loaded as an empty game. An array is now refused as the corrupt save it is.
- `scripts/reachability.mjs` is **not** added to the shipped manifest: it is a test
  harness, and the browser suite checks the underlying state functions in the
  shipped build instead of shipping the harness to players.

### Correction to my own reporting

While probing this round I claimed I had found "a critical bug: nothing is ever
saved". **That was wrong.** My probe called `applyChoice()` directly, bypassing the
UI's `choose()`, which is what calls `autoSave()`. Re-testing the real path — walking
to Mara and clicking a choice — saving, the Continue button and reloading a finished
game all work correctly. I am recording this because an unverified "critical bug"
claim is exactly the kind of thing I should not leave in a report.

### Checks actually run this round

- `npm test` — **343/343 pass** (was 330): 12 save-hardening cases + 1 exhaustive
  reachability case.
- `npm run test:browser` — **132/132 pass, exit 0** (was 128): 4 new checks (coin
  clamp, array-quests refusal, fractional floor, and the shipped build exposing the
  state functions the reachability proof covers).
- `npm run test:mobile` — **165/165 pass, exit 0**.
- **Totals: 640 checks — 343 unit, 132 desktop, 165 mobile.**
- `node scripts/reachability.mjs` — exits 0, prints 1428 states / 0 dead ends.
- `node scripts/playthrough.mjs` — still exits 0.
- Self-contained re-verified: 26 files, 972 KB, 0 external requests, 0 errors.

### Evidence

`artifacts/round18-reachability.png` — 1280x800, mean luminance 53.3, 12.7% bright,
max 247, 4721 distinct colours. I am text-only and did not inspect it; the claims
rest on the search output and the test results.

## Previous round — Round 17: a soft-lock that made the game unfinishable

PRs #5–#17 are published and open for the human. This round found the most serious
defect in the whole project, and it was found by **playing the game** rather than by
reading code.

### The bug: a soft-lock

Every suite until now set quest state directly (`state.quests[id] = 'done'`), which
means **a quest chain could be impossible to complete and every test would still
pass.** So this round I wrote a playthrough that drives real dialogue and real state
functions. It got three quests in and then stopped dead:

> `toll: Halden is not convinced.` → `ledger: Wren looks you over. "Market business
> is for people the Market trusts."`

The chain:

1. Wren's ledger quest needs **Warm** Market standing (25+).
2. The market toll offers two resolutions. **Pay it** costs 15 Market standing,
   taking you from warm (25) back to neutral (10) — below her gate.
3. From that position, **no remaining action in the entire game raises Market
   standing again.** I exhausted every dialogue choice with all six NPCs and watched
   the number not move: 10 → 10.
4. The ledger is therefore never available, the arrears are gated on the ledger, and
   **two of the six quests become impossible.**

So choosing the option the menu *offers you* ("Pay 5 coins") makes the game
unwinnable, and nothing warns you. The other option (waive the toll) is fine.

### The fix

Wren says trust is earned by *"Dues paid. Promises kept. Oswin at his stall with his
accounts in order."* Paying Oswin's toll out of your purse is **exactly that** — she
is the toll clerk, and the dues are her book. So:

- Paying the toll now sets a `dues_paid` flag and costs only **5** Market standing
  instead of 15 (the displeasure is real but mild).
- `ledgerUnlocked()` accepts settled dues as sufficient, whatever the Market's mood.
- Her dialogue now **says so**: *"Wren taps her book, where Oswin's dues are now
  entered. 'Your doing, that.'"* rather than implying you charmed her.

I verified **all 8 combinations** of the three branch choices (toll paid/waived ×
ledger name/cover × arrears pay/forgive) now finish.

### Proof the new test is real

I reverted the one-line fix and re-ran the suite: **9 of 12 playthrough tests fail.**
Restored it: 12/12 pass. This is a genuine regression guard, not a test written to
match whatever the code happens to do.

### Also found: a visible wall with no collider

The terrace parapet is a 0.55 m wall you can walk straight through. Not fixed this
round (it is cosmetic-adjacent and needs its own careful change); recorded in Next
steps.

### Checks actually run this round

- `npm test` — **330/330 pass** (was 318): 12 new playthrough cases.
- `npm run test:browser` — **128/128 pass, exit 0** (was 124): 4 new checks, including
  a whole playthrough driven inside the browser and the toll trap checked directly.
- `npm run test:mobile` — **165/165 pass, exit 0**.
- **Totals: 623 checks — 330 unit, 128 desktop, 165 mobile.**
- `node scripts/playthrough.mjs` — a standalone playable run; exits 0 and prints the
  six completions and the epilogue.
- Self-contained re-verified: 26 files, 972 KB, 0 external requests, 0 errors, and
  the **full playthrough completes inside the isolated build**.

### Evidence

`artifacts/round17-playthrough.png` — 1280x800, mean luminance 53.3, 12.7% bright,
max 247, 4715 distinct colours. I am text-only and did not inspect it; the finding
rests on the playthrough assertions.

## Previous round — Round 16: accessibility controls on a phone

PRs #5–#16 are published and open for the human. Rounds 13–15 built screen-reader
support, a spoken compass and guided travel — all reachable only through the **C, L
and G keys**. A phone has none of those keys, and **VoiceOver on iOS is the most
widely used screen reader in the world.** So the single largest accessibility
audience got none of that work. This round fixes a gap I created myself.

### What Round 16 adds

- Three touch buttons in the mobile control cluster: **Where am I** (C), **Nearby**
  (L) and **Take me** (G). All 44px touch targets with `aria-label`s.
- **Take me** starts guided travel, and tapping it again stops it — the same
  behaviour as G.
- Verified at **all four emulated profiles including iPhone SE (320x568)**, where
  the buttons genuinely overlap the stick and look zones. Geometry alone was not
  enough: the meaningful check is that `elementFromPoint` at each button's centre
  returns **that button**, not the look zone beneath it. All three pass.

### Bugs I found in my own test work this round

1. **I inserted my checks between an action and its assertion.** My block landed
   between `touch.interact()` and the check that reads its result, so the dialogue
   checks failed with `open: false`. Nothing was wrong with the game; I had split a
   two-step test.
2. **Cached tap coordinates went stale.** The interact button appears and disappears,
   which shifts the row, so coordinates captured earlier landed on the wrong control.
   Tapping by selector fixed it.
3. The "Take me" test then left the player standing in a conversation, which broke
   every later dialogue check. The block now resets the world when it finishes.

### Checks actually run this round

- `npm test` — **318/318 pass** (unchanged; this round is UI wiring, proven in the
  browser rather than by new pure functions).
- `npm run test:browser` — **124/124 pass, exit 0** (unchanged, no desktop regressions).
- `npm run test:mobile` — **165/165 pass, exit 0** (was 137): **28 new checks across
  4 profiles.** New: the three controls exist; they are thumb-sized and on screen;
  each has an accessible name; **taps actually reach them rather than the look
  zone**; Where am I speaks the area and gate; Nearby names somewhere with a
  direction; Take me starts and stops guided travel.
- **Totals: 607 checks — 318 unit, 124 desktop, 165 mobile.**
- 26 files, 968 KB, self-contained re-verified (0 external requests, 0 errors).

### Evidence

`artifacts/mobile-iphone-13-portrait.png` (1170x2532, mean luminance 95.4, 11141
colours) and `artifacts/mobile-iphone-se-small.png` (640x1136). Measuring the
bottom-right **button corner separately**: 17.0% and 62.7% of pixels above 90
luminance — the buttons are really drawn with readable text, not just present in the
DOM. I am text-only and did not inspect them.

## Previous round — Round 15: guided travel

PRs #5–#15 are published and open for the human. Round 14 gave the world a spoken
compass, and I flagged its own limit at the time: it **described** a route, and a
blind player still had to walk it step by step past walls and a ramp they could not
see. This round supplies the route itself.

### What Round 15 adds

- `src/pathfind.js` (pure, 16 unit tests): `buildGrid()`, `findPath()` (A*),
  `pathLength()`, `nearestOpenCell()`, `isWalkable()`, `cellCentre()`,
  `worldToCell()`, `summarisePath()` and `BOUNDS`.
- **The grid is built from the game's real colliders and step heights**, not a
  hand-drawn map. Exposed through `navigationGrid()` so tests use the live world.
- **Guided travel (`G`)** walks the player to a named place, or to the nearest thing
  worth walking to. It drives `player.setMoveInput()` — the same path a keyboard
  uses — so it goes through the **existing acceleration, collision and step-height
  code**. A guided walk cannot end up inside a wall that manual walking stops at.
- **It refuses out loud** when a target is unreachable ("The ledger spot cannot be
  reached from here") instead of walking the player into a shut gate.
- Manual input cancels it: press any movement key and you have the controls back.
- Spoken distances are phrases, never numerals.

### Three real bugs, all found by testing

1. **The grid was sized to the plaza only.** `HALF` is 17, but the market lane runs
   to z = -26, so **every route into the lane silently failed** — the exact place
   the ledger quest lives. Found by checking the real world instead of assuming.
   `BOUNDS` is now derived from `PLAZA` and `LANE`, with a test named after the bug.
2. **The last waypoint was being snapped inside the target.** A bench is a solid
   object, so snapping the final waypoint onto its centre walked the player into it
   and stalled them ~3 units short with no explanation. The endpoint is now the open
   cell the search actually reached; only the *start* is snapped.
3. **The gate was walkable when shut.** Initially a path to the lane existed with
   the gate closed (26.0 units). After the bounds fix, the gate collider genuinely
   blocks: closed → `null`, open → 26.2 units, re-closed → `null`. All three states
   are now committed browser checks.

I also wrote **two more wrong tests** (asserting a walk that takes ~11s would finish
in 9s, and trying to cancel a walk whose destination was already reached). Both were
my error, not the game's.

### Checks actually run this round

- `npm test` — **318/318 pass** (was 302): 16 new pathfinding cases.
- `npm run test:browser` — **124/124 pass, exit 0** (was 117). New checks: the grid
  covers the lane; **a shut gate really makes the lane unreachable**; opening it opens
  a real route; guided travel moves the player gradually rather than teleporting;
  it delivers them to the bench and says so; taking the controls stops it; and an
  unreachable destination is refused and explained.
- `npm run test:mobile` — **137/137 pass, exit 0**.
- **Totals: 579 checks — 318 unit, 124 desktop, 137 mobile.**
- Manifest test caught `src/pathfind.js`; now 26 files.

### Evidence

`artifacts/round15-pathfinding.png` — 1280x800, mean luminance 53.3, **12.7% of
pixels bright**, max 247, 4726 distinct colours. This is the most legible frame of
any round so far (the modal rounds were much darker by design). I am text-only and
did not inspect it; the travel claims rest on the browser assertions.

## Previous round — Round 14: the spoken compass

PRs #5–#14 are published and open for the human. Round 13 made the game *announce*
things. I flagged the remaining gap in my own report at the time: announcements tell
you what changed, but there was still **no way to move through the world without
sight**. Walking is WASD against a canvas. This round fixes that.

### What Round 14 adds

- `src/compass.js` (pure, 22 unit tests): `bearingDegrees()`, `compassBearing()`,
  `facingDegrees()`, `relativeDirection()`, `distanceTo()`, `distancePhrase()`,
  `describeTarget()`, `nearbyTargets()`, `routeHint()` and `sentenceCase()`.
- **Directions are computed from real coordinates and asserted against the actual
  map.** The world's axes are north = -Z (the wall and lane beyond it), east = +X
  (the market stalls). A flipped axis would send a blind player the wrong way with
  no way to notice, so tests check the gate really does read north-ish from the
  plaza centre and the lane really is at more negative z.
- **Two ways to use it**, both derived from one source so they cannot disagree:
  - **Spoken:** `L` lists what is nearby with relative direction, distance and
    world bearing; `compassTargets()` includes every NPC **where they actually are
    at this hour**, not where they spawned.
  - **Written:** a compass list in the journal panel, plus a "walk to…" box that
    takes a place or person's name and reports the route in text and aloud.
- Distances are phrases ("a few steps away", "across the plaza"), never numerals,
  because these are read aloud.

### Two real bugs I found, both by testing rather than reading

1. **Typing walked the player and ate the letters.** The compass box is the game's
   first text input, and it exposed a latent problem: global hotkeys were handled
   with no check for a focused field. Typing `bench` arrived as **`benh`** — the
   `c` triggered "describe" — and typing `wwww` physically moved the player.
   Fixed **at the movement source** in `player.js` (and in the global handler),
   so no future input field can reintroduce it.
2. **My own tests were wrong three times.** I asserted the gate was due *north* of
   the plaza centre (it is at x = 9.5, so it is **north-east**) and that the job
   board was south-west-ish (facing north it is **behind** you). The code was
   right; I corrected the tests to assert what is actually true. I also wrote
   lowercase expectations that my own capitalisation fix then broke.

### Checks actually run this round

- `npm test` — **302/302 pass** (was 280): 22 new compass cases.
- `npm run test:browser` — **117/117 pass, exit 0** (was 109). New checks: the
  compass knows real landmarks and NPC positions; facing north reports the gate
  ahead; turning around **flips the relative direction but not the world bearing**;
  asking for a place names it with a bearing; **typing does not move the player**;
  the written and spoken answers are identical; an unknown place is reported; and
  the journal shows a written compass list.
- `npm run test:mobile` — **137/137 pass, exit 0**.
- **Totals: 556 checks — 302 unit, 117 desktop, 137 mobile.**
- Manifest test caught `src/compass.js`; now 25 files.

### Evidence

`artifacts/round14-compass.png` — 1280x800, mean luminance 34.7, max 247, **5817
distinct colours**: a real rendered frame. I am text-only and did not inspect it;
the compass claims rest on the browser assertions above, including the
direction-reversal check.

## Previous round — Round 13: screen-reader support

PRs #5–#13 are published and open for the human. Round 12 closed the story.
This round addresses the one thing that made the game **not merely awkward but
completely unplayable** for a blind player.

### The gap

The game is first-person and drawn entirely to a canvas. Nearly everything it
communicates — the plaza around you, who is nearby, what you can interact with,
that a quest moved on, that you gained coins — went to a canvas or to a toast that
faded after three seconds. I probed a real browser and confirmed the worst case:
**no ARIA roles, no live region, focus never moved, and zero `prefers-reduced-motion`
support.** A screen-reader user got silence from start to finish.

### What Round 13 adds

- `src/announce.js` (pure, no DOM, 16 unit tests): `areaName()`,
  `areaAnnouncement()`, `interactableAnnouncement()`, `questChanges()`,
  `coinAnnouncement()` and `describeState()`.
- **Announcements are diffed from real state, never invented.** Quest changes are
  announced by comparing state before and after the mutation, so nothing is
  reported that did not happen. Quest titles are read from the **same `QUESTS`
  table the journal uses**, so spoken and written names cannot drift apart.
- **Live regions in the markup**, visually hidden with the standard clipping
  pattern (not `display:none`, which screen readers ignore): a polite region for
  progress and an assertive `role="alert"` for things that must not be missed.
- **The dialogue is spoken** — the speaker, the line, and the numbered options — and
  the panel is now a proper `role="dialog" aria-modal="true"` labelled by the
  speaker name.
- **A "describe where I am" key (C)** reports the area, whether the gate is open,
  the nearest thing to use, and the coin balance — the same facts a sighted player
  takes in at a glance. Silent before the game starts, when there is nowhere to be.
- Area changes and nearby interactables are announced as they happen.
- **`prefers-reduced-motion` is honoured** (there was no support at all).

### Two bugs I found in my own work

1. **Quiet announcements clobbered each other.** "Quest complete" was set into the
   live region and then replaced a frame later by a passing "you can talk to Mara",
   so the thing that mattered was never heard. Found by a committed browser check,
   not by inspection. Fixed with a small queue that speaks one at a time, plus
   dedupe so walking past the same bench does not repeat itself.
2. The C key answered on the title screen, describing a plaza the player had not
   entered. Guarded on `started`.

I also caught myself writing a **bogus test**: an earlier block in the same suite
had already set every quest to `done`, so my "quest changed" check was comparing
`done` to `done` and could never fail. Replaced with a test that drives the real
`withAnnouncements()` production path instead of a copy of it.

### Checks actually run this round

- `npm test` — **280/280 pass** (was 264): 16 new announcement cases.
- `npm run test:browser` — **109/109 pass, exit 0** (was 103). New checks: the
  dialogue is announced as a modal, live regions exist and stay in the
  accessibility tree, the describe key reports area/gate/coins, a conversation is
  spoken with its options, finishing a quest is announced, and
  `prefers-reduced-motion` is honoured.
- `npm run test:mobile` — **137/137 pass, exit 0**.
- **Totals: 526 checks — 280 unit, 109 desktop, 137 mobile.**
- Manifest test caught `src/announce.js` missing again; regenerated, now 24 files.

### Evidence

`artifacts/round13-access.png` — 1280x800, mean luminance 40.1, max 255, **7895
distinct colours**: a real rendered frame. I am text-only and did not visually
inspect it; the accessibility claims are backed by the ARIA assertions and live-
region reads above, not by the picture.

## Previous round — Round 12: the ending

PRs #5–#12 are published and open for the human. Round 11 gave the game sound.
This round fixes the biggest remaining narrative gap: **there was no ending at
all.** A player who finished all six quests got silence. No acknowledgement, no
conclusion, nothing — which makes a complete game read as an unfinished one.

### What Round 12 adds

- `src/epilogue.js` (pure, 16 unit tests): `storyComplete()`, `storyProgress()`,
  `branchLines()`, `standingSummary()`, `factionClosers()` and `buildEpilogue()`.
- **The ending is composed from what the player actually did**, not written once
  for everybody:
  - one line per **branch** taken (ledger: named vs covered; toll: collected vs
    waived; arrears: paid vs forgiven);
  - a closing line for **each faction**, per tier — so a player the Watch hates
    reads "Halden has written your description in the gate ledger, underlined"
    while a trusted player reads "Halden salutes you at the gate";
  - a best/worst standing summary, and a closing paragraph about leaving.
- Two players finishing the same six quests get **materially different endings**.
  Verified by comparing two full playthroughs in unit tests.
- The epilogue appears once as a quiet paper-toned overlay on completion, and is
  **re-readable from the journal** at any time afterwards.
- It **cannot appear early**: `buildEpilogue()` returns `null` until every quest is
  done, asserted both in unit tests and in the browser.

### A truthfulness bug I caught in my own work

A save finished *before* branch outcomes were recorded — or a hand-edited one —
has no `outcomes`, so the ending rendered with **zero branch lines**: a shorter
ending presented as the whole story, silently implying the player made no
choices. It now sets `branchesUnrecorded` and says so in the text: "Some of what
you did here was not written down, and the record of it is gone."

### Checks actually run this round

- `npm test` — **264/264 pass** (was 248): 16 new epilogue cases, including that
  the ending withholds itself until the story is complete, never mentions a branch
  that was not taken, ignores unknown outcomes from a hand-edited save, admits an
  incomplete record, and differs between two full playthroughs.
- `npm run test:browser` — **103/103 pass, exit 0** (was 98). Five new checks: no
  ending before completion, the epilogue appears on completion, it reports the
  branches actually taken and not the others, it is honest about a hostile faction,
  and it can be dismissed and reopened from the journal.
- `npm run test:mobile` — **137/137 pass, exit 0**.
- **Totals: 504 checks — 264 unit, 103 desktop, 137 mobile.**
- The manifest test again caught the new `src/epilogue.js` missing from
  `requiredFiles`; regenerated, now 23 files.

### Evidence

`artifacts/round12-ending.png`: the overlay is deliberately dark (mean luminance
21.3 over the whole frame, as designed for a modal), so I measured the **card
region separately**: mean luminance 41.8, **11.2% text pixels above 90**, max
luminance 247, 1272 distinct colours — real rendered text, not a blank sheet.

## Previous round — Round 11: sound

PRs #5–#11 are published and open for the human. Before starting another
mechanic I audited what already existed, exhaustively:

- **626 dialogue nodes** walked across every NPC in every quest state and with
  every faction hostile: **zero** crashes, dead ends, or unreachable nodes.
- Save round-tripping across every quest step with coins and reputation set:
  **zero** losses.
- Every branch ending producing a non-empty journal entry: **zero** gaps.
- Reputation bounds under 600 abuse operations, coins never negative, job costs
  always enforced: **zero** problems.

That audit turned up the real gap, which was not a bug but an absence: **the game
had no audio at all.** For a first-person adventure with lanterns, a fountain and
a market lane, that is a genuine hole in the experience.

### What Round 11 adds

- `src/audio.js` (pure core, 14 unit tests, browser binding): the entire
  soundscape is **synthesised with the Web Audio API**, so there are still no
  assets, no downloads and no licensing questions — the self-contained build is
  unchanged in kind.
- A **warm drone** that follows the day cycle, shifting root note and level
  between day, dusk and night, so the plaza never sounds the same twice.
- **Seven interaction cues** — talk, choose, close, pickup, quest, refuse, work —
  built on a pentatonic scale, chosen because every interval in it is consonant,
  so cues never clash with each other or with the drone.
- A **sound toggle** in the corner (also **M**), reachable by touch at 44 px,
  which hides itself during dialogue so it never covers the choices.
- The mute preference persists in `localStorage`, so a player who silences the
  game does not have to silence it again every session.

### Proof the sound is real, not merely non-crashing

"It did not throw" is worthless evidence for audio. I rendered the same graphs
through an `OfflineAudioContext` and measured the samples:

| Graph | Peak | RMS |
| --- | --- | --- |
| cue: talk | 0.0784 | 0.00561 |
| cue: quest | 0.0840 | 0.00745 |
| cue: pickup | 0.0992 | 0.00710 |
| drone: day / dusk / night | 0.040 / 0.055 / 0.031 | 0.027 / 0.036 / 0.021 |

**No graph rendered silence.** Everything is also deliberately quiet, with hard
gain ceilings (`MAX_CUE_GAIN 0.14`, `MAX_AMBIENCE_GAIN 0.08`), so the game can
never startle the player when a dialogue opens.

### Bugs found in my own work

1. **`writePreference(null, …)` returned `true`** — claiming a preference had been
   saved when there was no storage to save it to. Now reports failure. Caught by a
   test I wrote to assert the failure path.
2. **Non-finite gains.** My first test expected `Infinity` to clamp to the maximum,
   which would mean a corrupt value could make the game as loud as possible. The
   code already returned 0, which is the safe behaviour; I corrected the test and
   documented the policy rather than changing the safe code.
3. **My audio checks broke the board checks.** Inserting them mid-section, when
   they reload the page, reset the state the later board checks depended on. Moved
   to the end of the run. Worth stating plainly: the two failures were caused by my
   test ordering, not by the feature.

### Checks actually run this round

- `npm test` — **248/248 pass** (was 234): 14 new audio cases, including that a
  missing/broken AudioContext is a safe no-op, that a muted game creates no
  oscillators, and that every gain is clamped.
- `npm run test:browser` — **98/98 pass, exit 0** (was 94). Four new checks: audio
  starts with the game and the toggle is reachable, every cue plays without
  erroring, a muted player stays muted across a reload, and the ambience follows
  the time of day.
- `npm run test:mobile` — **137/137 pass, exit 0**.
- **Totals: 483 checks — 248 unit, 98 desktop, 137 mobile.**

### Evidence

`artifacts/round11-audio.png`: 1280x800, mean luminance 109.9, 46.2% bright pixels,
2842 distinct sampled colours.

## Previous round — Round 10: the plaza work board: goodwill you can earn *before* you need it.

PRs #5–#10 are published and open for the human. Real-device testing is still
blocked on hardware I do not have. Round 9 added a repeatable way to earn standing
back, but left it in the wrong place, which I noted at the time: **work was only
offered by a *refused* NPC, so goodwill could only be earned after it was already
too late.** A player had to hit a wall before they could start climbing.

### What Round 10 adds

- `JOB_BOARD` in `src/areas.js` at (-3.4, 8.6): inside the plaza, on the walk
  between the gate and Mara, 1.65 m clear of the nearest barrel and 4.95 m from
  the bench, so it neither clips a prop nor blocks a path.
- The board mesh in `src/world.js`: two posts, a pinned face and three paper
  slips, so it reads as a job board from a distance rather than a plain panel.
- `JOB_BOARD_SPEAKER` and an exported `workMenu(state, npcId, name, intro)` in
  `src/dialogue.js`, so the board reuses the existing dialogue UI and offers
  exactly the same jobs as a refusal menu — but with board copy instead of a
  shopkeeper scolding the player.
- `applyChoice` now only writes NPC memory when `DIALOGUE[npcId]` exists, so the
  board cannot invent a phantom `job_board` NPC in the save. Verified: memory
  stays `[]` after taking board work.
- `openDialogue` uses `npc.talk ? npc.talk(state) : startConversation(...)`; world
  NPCs have no `.talk`, so the ordinary conversation path is untouched.

### Checks actually run this round

- `npm test` — **234/234 pass** (was 223): 11 new board cases, including that the
  board stays reachable when an NPC would refuse, that board work alone can lift a
  player out of a refusal, that it is never free, and that it invents no NPC.
- `npm run test:browser` — **94/94 pass, exit 0** (was 89). Five new checks: the
  board is a findable interactable, it opens as a board with three jobs, a neutral
  player gains standing and pays 2 coins, no phantom NPC appears, and a time job
  still costs the hour.
- `npm run test:mobile` — **137/137 pass, exit 0**.
- **Totals: 465 checks — 234 unit, 94 desktop, 137 mobile.**
- Walkability confirmed with real key input: walking south reaches 0.21 m from the
  post and `read the work board` appears. An earlier 1.8 s probe stopped 2.05 m
  short and showed nothing — a test-setup error, not a bug, which I re-ran before
  drawing any conclusion.

### Evidence

`artifacts/round10-job-board.png` captures the board menu itself in daylight,
verified programmatically at 93.9 mean luminance, 35.0% bright pixels and 3851
distinct sampled colours. My first attempt placed the capture after the
time-costing job had moved the clock to dusk (the same weak-evidence mistake I
made in Round 9), so I moved it to the moment the menu is on screen.

## Previous round — Round 9: earning standing back

PRs #5–#9 are published and open for the human. Real-device testing is still
blocked on hardware I do not have. Round 8 gave reputation teeth but left a real
design gap, stated honestly in that round's notes: **refusals were escapable only
through quests, so a player who had finished every quest had no repeatable way
back out of Hostile.** The plaza shut them out and stayed shut. This round fixes
that.

### What Round 9 adds

- `src/repair.js` (pure, 16 unit tests): three odd jobs — sweep the fountain steps
  (Keepers), carry crates (Market), drill with the gate watch (Watch). Every job
  costs something real, so standing can never be farmed by pressing a button:
  - the sweep and the drill take **the rest of the hour** (the clock really
    advances to the next phase);
  - the crates and the drill cost **coins**, deducted before the work happens;
  - each job nudges a rival faction down, so who you work for is a choice.
- **The way back is discoverable where it is needed.** The refusal itself now
  offers "What would change your mind?" → "Show me the work.", listing every job
  with its price and its reward, and listing unaffordable jobs too, with the
  reason, instead of silently hiding them.
- **Working while disliked pays less** (half at Hostile, three-quarters at Cold),
  so the first points out of Hostile are the expensive ones. Verified: climbing
  out of Hostile takes more than a handful of jobs, not one.

### Dead content removed

Round 8's Watch rule carried `until: isQuestDone('key')`, which lifted Halden's
refusal **forever** once the key quest was done. Since that happens in the first
few minutes, the Watch could never actually refuse in normal play — its refusal
and the whole repair path behind it were unreachable content. My own new test
caught it. The `until` is gone; the `exempt: carries the key` predicate is what
protects the critical path, and it only applies while the key is in hand.

### Checks actually run this round

- `npm test` — **223/223 pass** (was 207): 16 new repair cases. The manifest test
  caught `src/repair.js` missing from `requiredFiles` (its purpose again); the
  manifest was regenerated, now 21 files.
- `npm run test:browser` — **89/89 pass, exit 0** (was 83). Six new checks drive
  the real dialogue: a refused player is offered work, every job states price and
  reward, a coin job charges coins and leaves the clock alone, a time job really
  moves the clock, enough work earns the refusal away, and the player is served
  again afterwards.
- `npm run test:mobile` — **137/137 pass, exit 0**.
- **Totals: 449 checks — 223 unit, 89 desktop, 137 mobile.**

### Evidence

`artifacts/round9-standing-repair.png` captures the work menu itself in daylight,
verified programmatically at 36.0% bright pixels and max luminance 255. My first
attempt placed the capture after the clock had moved to dusk, producing a dim
frame that showed the room rather than the feature; I moved it to the moment the
menu is on screen.

## Previous round — Round 8: Reputation refuses content

PRs #5–#8 are published and open for the human. Real-device testing is still
blocked on hardware I do not have. Last round closed the lane's dead end; this
round fixes the other half of the standing system.

Until now standing only ever **opened** doors: Wren hands out her ledger above
Warm Market, and nothing anywhere turned the player away. A reputation that can
never be lost in any practical sense is not really a reputation.

### What Round 8 adds

- `src/refusal.js` (pure, 15 unit tests): a general refusal rule set with
  `refusalFor()`, `refusalHint()` and `belowTier()`. `required` is the lowest tier
  that still gets served, so `'warm'` refuses everything below Warm.
- Two live rules in `REFUSAL_RULES`: Oswin turns away anyone the Market rates Cold
  or worse, and Halden will not do business with a Hostile Watch.
- A refusal **always explains itself and always offers a way forward** — it names
  the faction, says whether the player is merely disliked or fully shut out, and
  answers "what would change your mind?". The Standing panel is therefore
  discoverable from the refusal instead of being a hidden system.
- Verified in the real UI: with the Market at Cold, Oswin refuses and the
  Standing panel reads `The Market — Cold −40`.

### The soft-lock bug this round could have introduced, and the guard

Refusals are dangerous: Oswin sells the **only oil** the first quest needs, and
Halden holds the key to the **only route north**. A player who soured the Market
or the Watch early could have been left permanently unable to buy the oil or
return the key — soft-locking both the tutorial and the whole market lane.

I checked whether that was actually reachable before shipping it: the worst
negative-Trade sequence available before finishing the lanterns reaches about −15,
so it is not reachable today, but it was one content change away. Rather than
relying on that, every rule now has an `exempt` predicate for the critical path —
Oswin serves you while the oil quest is in progress, and Halden always accepts the
key back if you are carrying it. Both are covered by unit and browser tests.

### Checks actually run this round

- `npm test` — **207/207 pass** (was 191): 15 new refusal cases, plus 1 more
  faction-grammar case. The existing manifest test caught me adding
  `src/refusal.js` without listing it — its whole purpose — and the greeting test
  failed legitimately because Oswin's Cold greeting is now replaced by a refusal.
  I moved the grammar coverage to NPCs that never refuse rather than weakening it.
- `npm run test:browser` — **83/83 pass, exit 0** (was 77). Six new checks: a
  neutral Market is served, a Cold Market refuses, the refusal explains itself,
  the Standing panel shows Cold, and the critical path stays open at Hostile for
  both the oil and the key.
- `npm run test:mobile` — **137/137 pass, exit 0**.
- **Totals: 427 checks — 207 unit, 83 desktop, 137 mobile.**

## Previous round — Round 7: The Lane's Arrears

PR #6 (v0.3.0 phone candidate) and PR #7 (context-loss recovery + release
manifest) are published and open for the human. Real-device testing is still
blocked on hardware I do not have, so this round returns to the game itself and
closes the biggest design gap left in it: the market lane was a dead end. Its one
quest resolved inside the lane and nothing ever took you back to the plaza.

### What Round 7 adds

- **A sixth quest, *The Lane's Arrears***, that cannot be finished in one place.
  Wren hands you a pouch of three weeks' overdue toll money; you must carry it
  **south through the gate** to Mara in the plaza, then carry **her mark back
  north** to Wren. The pouch and the mark are real inventory items, so the quest
  is gated on what you are physically holding, not on what the state remembers.
- **Two endings with different consequences on both sides of the gate.** Paying in
  full backs the books and pleases the Watch (+5 Watch); forgiving the debt pleases
  the Keepers but leaves a shortfall the Watch will ask about (−5 Watch). The
  journal reports the ending you actually reached.
- Unlocked only by finishing Wren's ledger, so it continues that story rather than
  sitting beside it.

### Bugs found and fixed while reviewing my own work

1. **A player could be permanently stranded.** If Mara's mark left the pack (a
   dropped save, a bug, a hand-edited file), Mara still said "take my mark back to
   Wren", Wren offered nothing, and the quest could never be finished — with no
   prompt, no error, and no way out. Mara now notices the empty hands, says so, and
   writes the mark out again; `reissueArrearsMark()` restores the *correct* item for
   the ending you chose (a note on the forgiving branch, never a receipt). Found by
   deliberately probing stuck states, not by a passing test.
2. **A false alarm I chased down rather than assumed**: a reputation message
   looked like it applied "+1" for a delta of 10, which would have been a real
   scaling bug — my own `.slice(0, 60)` had truncated "+10". Verified the scaling
   was correct before changing anything.

### What Round 6 adds

- `src/resilience.js` (pure, 9 unit tests): a context-loss recovery state machine
  with an attempt budget, a timeout and explicit give-up rules, plus a
  panic-shed predicate for catastrophically slow frames.
- `src/main.js`: real `webglcontextlost` / `webglcontextrestored` handling. On
  loss the game **saves immediately** (the save data is plain JSON and is
  unaffected by the renderer, so a renderer fault must never cost progress),
  shows a recovery sheet, and clears it when the context returns. If the context
  does not return within the timeout the sheet says so and offers a reload.
- `index.html`: the `#context-lost` recovery sheet, styled to match the pause menu.
- `src/perf.js`: added `force(ratio)` so emergency resolution shedding goes
  through the controller and the ratio it reports stays truthful.

### Bugs found and fixed this round

1. **The recovery sheet had two buttons that did nothing different** — "Try
   again" and "Reload the game" both reloaded the page, because once the context
   is gone a reload is the only way back. A button that promises a retry it
   cannot perform is a lie to the player, so the dead button is gone and the
   remaining one is honestly labelled.
2. **My own new test asserted almost nothing.** `hasReload` was computed as
   `typeof ...onclick !== 'undefined' || element !== null`, which is true for any
   element that exists — the same weak-assertion trap I had already fixed once
   this project. It now measures the button's real bounding box, computed
   visibility, and label, and requires a 44 px touch target.
3. **Panic-shedding disagreed with the adaptive controller.** My first version
   set the renderer's pixel ratio directly, so the controller reported 1 while
   the renderer actually ran at 0.5. The desktop suite caught it immediately
   (`adaptive resolution is on and reported honestly`). Fixed by adding
   `force()` to the controller and routing emergency shedding through it, with
   tests asserting the two agree.

### A release manifest the Play tab can read

The owner wants to launch the preview from a Play tab. Rather than leaving the
hosting step to guess, the release now describes itself:

- `src/manifest.js` (pure): entry point, the exact required-file list, directories
  not needed at runtime, control scheme, and `verifyManifest()` which fails loudly
  if a listed file is missing.
- `release-manifest.json` at the repo root, generated by
  `npm run release:manifest`, committed, and held to the real files by a test so
  it cannot drift. Exposed at runtime as `window.amazingAdventure.manifest`.
- 9 new unit tests: every required file exists, every `src/*.js` is listed (a
  forgotten module would 404), the manifest agrees with `version.js`, required
  files are not also in the omitted list, `verifyManifest` reports exactly the
  missing file, no engine file imports from `tests/`/`scripts/`/`artifacts/`, and
  the committed JSON is not stale.
- Verified the list is sufficient for real: copied **only** those 19 files
  (868 KB) into an empty directory, served it with a plain static server, and
  played it with every off-origin request aborted — 0 external requests, 0 failed
  requests, 0 console errors, two-thumb walk-and-look working, Talk button
  appearing at Mara.

### Checks actually run this round

- `npm test` — **191/191 pass** (was 171): 20 new arrears cases, including the
  stranding and re-issue paths, both endings, save/reload of a carried pouch, and
  an unknown quest step falling back safely.
- `npm run test:browser` — **77/77 pass, exit 0**: 7 new checks play the whole
  arrears loop through the real dialogue buttons — Wren's offer, the pouch
  landing in the pack, Mara receiving it across the gate, the receipt appearing,
  the reward being paid on the walk back, the journal matching the ending, and a
  lost mark being replaceable.
- `npm run test:mobile` — **137/137 pass, exit 0** across four emulated profiles.
  Five new checks per profile drive the real `WEBGL_lose_context` extension: the
  recovery message appears, progress is saved at the moment of loss, the recovery
  sheet offers a *usable* reload button (visible, labelled, at least 44 px tall),
  the sheet tells the player their progress is kept, and the game recovers when
  the context returns.
- **Totals: 405 checks — 191 unit, 77 desktop, 137 mobile.**

## Next steps

1. **Confirm the new preview on the live Pages URL.** The owner pushes this artefact;
   then verify the deployed host really sends `text/javascript` for `.js` and that
   the fountain + stone textures appear on an actual phone. The curl checks in
   `DEPLOY.md` are the fast version.
2. **More scene assets, one at a time.** The fountain and plaza stone were the first
   pass. Candidates: a real market stall mesh, a barrel with actual staves, a lamp
   post with a glass lantern, or a second texture pass (brick for the house, wood
   grain for stalls). Each must stay under a low-poly budget and ship a loader that
   falls back to the procedural version.
3. **A second Kaggle job**, now that the pipeline is proven: either a larger texture
   set (brick, wood, plaster) or a small learned experiment. Keep it bounded and
   check the licence before anything ships.
4. **A real-device pass.** The biggest honest gap remains: no physical phone, no
   iOS Safari, no real GPU. The adaptive resolution controller has only ever seen
   software rasterisation.
5. **A real screen reader session.** Rounds 13, 16 and 24–25 verify the browser's
   accessibility tree, which is close to what assistive tech consumes, but no NVDA or
   VoiceOver run has happened, so verbosity and announcement ordering stay unverified.

## Previous round — Round 27: a GitHub Pages preview, tested under the project subpath
## Previous round — Round 26: a new player was told nothing

PRs #5–#26 are published and open for the human. Ten rounds were accessibility. This
round asks a product question no round had asked: **having just pressed Play, does a
player know what to do?**

### The bug

Measured at spawn, with nothing touched:

```
pos: (0, 13)   yaw: 0 (facing the plaza)
nearest NPC: 5.2m away    talk range: 2.6m
interactables in range: 0
hint: ""  (hidden)    toasts: 0    live region: ""
```

So out of the box a first-time player got **no visible instruction and no spoken
one**. The "E — talk to …" prompt only appears within 2.6m, and the spawn point is
5.2m from the nearest person, so it stays hidden until the player has already worked
out what to do. The only guidance was a small line in the quest tracker.

### The fix

A new pure module, `src/onboard.js`, with `isFreshStart()`, `openingLine()`,
`firstGoal()` and `welcome()`. It is pure so the wording is unit-testable without a
DOM, and it takes the **device** so it never tells a phone to press E:

- keyboard → "Walk with W A S D or the arrow keys, and press E when someone is close."
- touch → "Walk with the left thumb, look with the right, and tap Use when someone is close."
- goal → names the person who is *actually* nearest ("walk up to Sable the Cartographer")

`main.js` shows both lines as toasts and announces the same text, once, from a single
helper both start paths call.

### Things the tests caught in my own work

1. My first `welcome()` produced **"press E"** on a phone, because the goal ignored
   the device it had just been told about. The unit test for the touch wording failed.
2. My first wiring showed only the *goal* as a toast, leaving the controls in the live
   region only — so a player who cannot hear it would never be told how to move. A
   browser check failed on exactly that and I put both lines on screen.
3. The manifest test failed immediately on the new `src/onboard.js`, as it has every
   round since round 8.

### Proof the tests are real

Removing the `welcomeIfFresh()` call makes **3 committed desktop checks fail**, and the
output is the empty state I originally measured:

```
FAIL the first thing a new player sees out of range is an instruction
     — {"toasts":[],"live":"","hintShown":false,"interactables":0}
FAIL the opening instruction says how to move and how to interact — {"toasts":[],"live":""}
FAIL the opening instruction names the person actually nearest — {"live":""}
```

### Checks actually run this round

- `npm test` — **363/363 pass** (was 353): **10 new onboarding tests**.
- `npm run test:browser` — **166/166 pass, exit 0** (was 161): **5 new checks**.
- `npm run test:mobile` — **185/185 pass, exit 0**.
- **Totals: 714 checks — 363 unit, 166 desktop, 185 mobile.**
- `scripts/playthrough.mjs` and `scripts/reachability.mjs` both still exit 0.
- Touch wording verified on a real 390x844 mobile viewport: says "thumb" and "tap Use",
  never "press E".
- A returning player gets **no** welcome: continuing a save with progress shows no
  toast and no re-tutorial (asserted).
- Self-contained re-verified: **27 files** (new module), 984 KB, 0 external requests.

### Evidence

`artifacts/round26-onboarding.png` — 1280x800, mean luminance 129.1, 63.3% bright, 5180
distinct colours. I am text-only and did not inspect it; the claims rest on the
measured text and the assertions above.

## Previous round — Round 25: heading outline in the accessibility tree

PRs #5–#25 are published and open for the human. Round 24 pointed the accessibility
tree at the conversation panel and found two real defects. This round points it at
**everything else** — the HUD, the journal panel, the standing list — which had never
been inspected that way.

### The bug

Two separate regions were both headed **"Journal"**, and both are visible at the same
time:

```
h2 "JOURNAL"        <- always-on quest tracker
h3 "JOURNAL"        <- the full journal panel
h3 "INVENTORY"
h3 "STANDING"
```

A screen reader user navigating by heading heard "Journal" twice with nothing to tell
them apart: one is a compact live tracker, the other the full panel. And the four lists
were **completely unnamed**:

```
[list] name=""   [list] name=""   [list] name=""
```

so a reader said "list" without saying what was in it.

### The fix

- The always-on tracker heading is now **"Quests"**, which is what it actually shows.
  The panel keeps "Journal".
- Every list is tied to its own heading with `aria-labelledby`, so the tree carries
  names: `INVENTORY`, `JOURNAL`, `STANDING`, `WHERE THINGS ARE`.
- The compass list was a `<div>` of `<li>`s with no list role at all; it now has
  `role="list"` with labelled children.

Verified in the tree afterwards: five unique headings, four named lists, every list
containing real listitems.

### One thing I checked and did NOT report as a bug

My first pass flagged 11 listitems as having "no accessible name". That was **my
instrument, not the game**: `<li>` elements carry their text in child nodes, so a bare
`name` field is empty while the content is perfectly readable. Walking the subtree
confirmed they read as full sentences ("The Keepers Neutral", "the bench to your left ·
west"). I would rather say I was wrong about this than pad the round with a defect that
does not exist.

### Proof the tests are real

Restoring the original headings makes **2 committed desktop checks fail**, and the
failure output shows exactly the duplicate heading and the unnamed lists:

```
FAIL no two visible regions share the same heading name
     — {"headings":["JOURNAL","INVENTORY","JOURNAL","STANDING","WHERE THINGS ARE","THE END"]}
FAIL every list is labelled so a reader knows what it contains
     — {"lists":["","",""]}
```

### Checks actually run this round

- `npm test` — **353/353 pass**.
- `npm run test:browser` — **161/161 pass, exit 0** (was 157): **4 new checks**.
- `npm run test:mobile` — **185/185 pass, exit 0**.
- **Totals: 699 checks — 353 unit, 161 desktop, 185 mobile.**
- `scripts/playthrough.mjs` and `scripts/reachability.mjs` both still exit 0.
- Self-contained re-verified: 26 files, 980 KB, 0 external requests, with the heading
  outline correct in the isolated build.

### Evidence

`artifacts/round25-headings.png` — 1280x800, mean luminance 51.2, 12.5% bright, 4498
distinct colours. I am text-only and did not inspect it; the claims rest on the CDP
accessibility-tree dumps above.

## Previous round — Round 24: the accessibility tree

PRs #5–#24 are published and open for the human. For nine rounds I have reported "no
real screen reader test" as the biggest honest gap. This round narrows it materially:
Chrome exposes the **accessibility tree it actually hands to assistive technology**,
reachable over CDP. Reading that instead of the DOM immediately found two real defects.

### What the AX tree showed

```
[button] "2Who are you?"        <-- the key digit ran into the sentence
[button] "3Leave"                     a reader says "two-who are you"
(no checked/selected/current state anywhere in the tree)
```

1. **Choice names were malformed.** The visible number was a bare `<span>` inside the
   button, so the accessible name concatenated digit + label with no separator.
2. **The keyboard highlight was invisible to assistive tech.** The code set
   `aria-selected` on a plain `<button>`, which is not a valid ARIA attribute there;
   Chrome dropped it entirely. I then tried `aria-current`, which Chrome also drops.

I probed which pattern Chrome *does* expose, rather than guessing:

| Markup | Exposed in AX tree? |
| --- | --- |
| `button aria-selected` | **no** |
| `button aria-current` | **no** |
| `button aria-pressed` | yes (`pressed`) |
| `role=radio aria-checked` | **yes** (`checked`) |
| `role=option aria-selected` (in listbox) | yes (`selected`) |

The options behave as a single-choice set (W/S move the highlight, E confirms), so
`role="radio"` + `aria-checked` inside a `role="radiogroup"` labelled "Replies" is the
correct pattern — and it is the one Chrome propagates.

### The fix

- The visible digit is `aria-hidden`, and each choice gets an explicit
  `aria-label="Choice 2 of 3: Who are you?"` plus `aria-keyshortcuts="2"`.
- Choices are `role="radio"` with `aria-checked`, updated by `highlightChoice()`, inside
  a labelled `radiogroup`.

Verified in the AX tree that the checked state **follows the highlight**:

```
before S: Choice 1 checked=true
after  S: Choice 2 checked=true  (and 1 back to false)
```

### Proof the tests are real

Restoring the original semantics makes **4 committed desktop checks fail**, with the
tree showing no usable names and no state at all:

```
FAIL the choices appear in the accessibility tree with a spoken name — []
FAIL the checked state is readable from the accessibility tree at all — []
FAIL the highlighted choice is exposed as checked, with exactly one checked — []
FAIL moving the highlight moves the checked state in the accessibility tree — {}
```

### A bug in my own test

My first version compared `checked` to boolean `true`, but CDP returns the *string*
`"true"`, so two assertions silently never matched. Caught because the failure output
printed the raw values. Normalised with an explicit coercion, and added a guard check
that the property is legible at all, so this class of silent no-match fails loudly.

### Checks actually run this round

- `npm test` — **353/353 pass**.
- `npm run test:browser` — **157/157 pass, exit 0** (was 149): **8 new AX-tree checks**.
- `npm run test:mobile` — **185/185 pass, exit 0**.
- **Totals: 695 checks — 353 unit, 157 desktop, 185 mobile.**
- `scripts/playthrough.mjs` and `scripts/reachability.mjs` both still exit 0.
- Self-contained re-verified: 26 files, 980 KB, 0 external requests, with the AX
  contract holding in the isolated build.

### Evidence

`artifacts/round24-axtree.png` — 1280x800, mean luminance 35.6, 2.6% bright, 8826
distinct colours. I am text-only and did not inspect it; the claims rest on the CDP
accessibility-tree dumps quoted above.

## Previous round — Round 23: the audio system's contract

PRs #5–#23 are published and open for the human. Round 22's Next steps flagged that
the round-11 soundscape had **no behavioural test at all** — only that the context
starts and toggles. This round closes that.

### The bug

`play()` documented itself as doing nothing "if sound is off **or unstarted**", but
only checked that the context and master node existed. After `stop()` the drone is
gone while the context and master still exist, so cues kept scheduling notes onto an
output the caller believed was shut down:

```
before stop: started=true
after  stop: started=false
play() after stop -> true   <-- scheduled sound onto a stopped soundscape
```

Honest scoping: the game never calls `stop()` internally, so this was a **latent
contract violation, not a live player-facing bug**. It matters because `stop()` is
exported on the debug API, and because a doc comment the code does not honour is a trap
for whoever touches this next.

### The fix

One clause: `!started` is now part of the guard. Verified that stop → play is blocked,
restart → play works, and starting twice does not build a second drone.

### What is now actually tested

The 14 existing audio tests covered the pure maths and the no-Web-Audio paths. New:

- **10 unit tests** against a *recording* fake — a cue is silent before `start()` and
  creates no oscillator; `stop()` truly stops; restart works; double-start is a no-op;
  mute silences and unmute restores; the preference is written on toggle and a throwing
  writer does not take the game down; every cue name the game uses exists; every phase
  has a tone; a phase set while stopped is remembered; ambience stays under the cue
  ceiling.
- **4 browser checks** against the **real Web Audio API**, so the fake cannot drift
  from the browser: the start/stop/restart contract, phase changes reaching the
  soundscape, and — importantly — **rendered samples** from an `OfflineAudioContext`,
  not just "the call returned true". Drone peak 0.057 at a claimed gain of 0.05, cue
  peak 0.120: audible, and the cue sits above the drone without clipping.

### Proof the test is real

Removing the `!started` clause makes the committed unit test fail:

```
not ok 16 - stop() really stops: cues cannot play onto a shut-down output
```

### A measurement of mine that was wrong first

My first attempt to measure output attached an `AnalyserNode` that was never connected
to the graph, so it reported a peak of `0` — which looks exactly like "audio is broken".
It was my probe that was broken. Rendered samples via `OfflineAudioContext` are the
right tool, and they show real signal.

### Checks actually run this round

- `npm test` — **353/353 pass** (was 343): **10 new audio tests**.
- `npm run test:browser` — **149/149 pass, exit 0** (was 145): **4 new checks**.
- `npm run test:mobile` — **185/185 pass, exit 0**.
- **Totals: 687 checks — 353 unit, 149 desktop, 185 mobile.**
- `scripts/playthrough.mjs` and `scripts/reachability.mjs` both still exit 0.
- Self-contained re-verified: 26 files, 980 KB, 0 external requests, with the audio
  contract holding in the isolated build.

### Evidence

`artifacts/round23-audio.png` — 1280x800, mean luminance 53.3, 12.7% bright, 4722
distinct colours. I am text-only and did not inspect it; the audio claims rest on the
rendered sample peaks and the contract checks above.

## Previous round — Round 22: a walk-through terrace edge

PRs #5–#22 are published and open for the human. Rounds 17–21 fixed defects found by
auditing behaviour. This round closes the one defect I had **flagged but not fixed**
in round 17 and repeated in five subsequent Next-steps lists: the terrace parapet.

### The bug (now confirmed, not just suspected)

The parapet is a real 0.55m wall drawn along the terrace lip. It was added with
`addBox(scene, [], ...)` — an empty collider list — because the shared helper only
creates colliders for things **taller than 0.9m**, on the rule that a person can step
over anything shorter.

That rule is wrong *here*: the parapet is not an obstacle, it marks a **1.2m drop**.
Measured at x=4 (well outside the ramp opening, which spans x −1.9…1.9):

```
before: x=4 pushed south -> z=-5.17, ground=0     (walked over the lip, dropped)
after:  x=4 pushed south -> z=-13.84, ground=1.2  (held on the terrace)
```

So yes — the player could walk off the terrace edge anywhere, bypassing the ramp.

### The fix

An explicit thin collider at the lip, spanning each parapet half, so the wall blocks
where it is drawn rather than relying on the height rule. Verified held at x = −5,
−3.5, +3, +5 (ground stays 1.2), and that the ramp opening still works **both ways**
(up: ground 1.2; down: ground 0).

### Proof the test is real

Removing the collider line makes the committed desktop check fail with all four probe
points escaping to ground 0:

```
FAIL the terrace parapet stops the player everywhere except the ramp
     — {"lipZ":-13.2,"outsideRamp":[{"tried":-5,"z":-9.1,"ground":0}, ...4 of them]}
```

### Rounds 20–22 audit notes (things checked that were already sound)

- **No resource leak**: 60 open/close cycles — geometries stayed 119, textures 1,
  scene children 98, JS heap 9.5→8.4 MB.
- **Save is validated**: versioned key, corrupt/array/malformed saves refused.
- **Two tabs**: tab B starting a fresh game does *not* wipe tab A's saved progress.
- **Keyboard-only play**: start, all four WASD directions (0.45 units each), `E` to
  talk, `J`/`L`/`C`/`P`/`M` all respond.
- **My own probe was wrong twice**: pressing w,a,s,d *in sequence* cancelled out
  (0.06 units, "no movement"); and `placeAt()` always sets y=0, so my first parapet
  test never actually put the player on the terrace. Both corrected before concluding.

### Checks actually run this round

- `npm test` — **343/343 pass**.
- `npm run test:browser` — **145/145 pass, exit 0** (was 142): **3 new checks**.
- `npm run test:mobile` — **185/185 pass, exit 0**.
- **Totals: 673 checks — 343 unit, 145 desktop, 185 mobile.**
- `scripts/playthrough.mjs` and `scripts/reachability.mjs` both still exit 0.
- Self-contained re-verified: 26 files, 980 KB, 0 external requests, with the parapet
  holding in the isolated build.

### Evidence

`artifacts/round22-parapet.png` — 1280x800, mean luminance 130.1, 67.4% bright, 2372
distinct colours. I am text-only and did not inspect it; the fix rests on the
position/ground measurements above.

## Previous round — Round 21: text ignored the user's font size

PRs #5–#21 are published and open for the human. Round 20 fixed focus. This round
audited the other half of accessible text: **does enlarging your default font do
anything at all?**

### The bug

I first computed WCAG contrast for every visible text element (18 of them, 6.25:1 to
18.45:1 — **zero AA failures**). Then I tested text resize, which AA also requires, and
found the gap:

```
font-size declarations: 49 (47 absolute px, 0 rem)
root font 16px -> 32px: clock box 28x12 -> 28x12  (nothing changed)
```

Every size was an absolute `px` value, so a low-vision player who sets a larger
default font in their browser got **no larger text whatsoever**. This is the standard
"px everywhere" accessibility bug, and the game was a clean example of it.

### The fix

- All 47 text sizes converted to `rem` at base 16, so default rendering is
  pixel-identical but the text now follows the user's setting. Measured after:
  clock span 28x12 → **54x24** at 200%.
- A second, deeper problem surfaced once text could grow: `#dialogue` is anchored to
  the **bottom** with no `max-height`, so a long line at a large font size grows
  *upward off the top of the screen*, taking the first options with it.
  Added `max-height: 82vh; overflow-y: auto`.

### Verified across sizes, not just one

| Case | Result |
| --- | --- |
| Desktop 1280x800, 100/150/200% | no non-scrollable clipping; choices 38→55px tall, all in view |
| Desktop 1024x**560**, up to 300% text | panel stays inside viewport at every size; scrolls when needed |
| iPhone SE 320x568, 200% | panel 398px in a 568px screen; scrolling **does** reach the last option |
| iPhone 13 390x844, 200% | all options in view |

The only elements flagged as clipped are `#sr-live`/`#sr-alert`, which are the
intentional 1x1 screen-reader regions.

### Proof the tests are real

Restoring the original px sizes makes **2 committed desktop checks fail**, including
one that measured the text sitting at exactly `16px` even at 200%:

```
FAIL font sizes are relative, so a user font setting is respected
     — {"total":49,"px":47,"rem":0}
FAIL doubling the user font setting actually doubles the text
     — {"at100":{"size":16},"at200":{"size":16}}
```

### Checks actually run this round

- `npm test` — **343/343 pass**.
- `npm run test:browser` — **142/142 pass, exit 0** (was 138): **4 new checks** — sizes
  are relative, doubling the setting doubles the text, the panel stays inside the
  viewport at 200%, and every option stays reachable.
- `npm run test:mobile` — **185/185 pass, exit 0** (was 177): **8 new checks** across 4
  profiles for enlarged text on small screens.
- **Totals: 670 checks — 343 unit, 142 desktop, 185 mobile.**
- `scripts/playthrough.mjs` and `scripts/reachability.mjs` both still exit 0.
- Self-contained re-verified: 26 files, 980 KB, 0 external requests, 0 errors, with the
  clock font scaling 16→32px in the isolated build.

### Evidence

`artifacts/round21-text-200.png` — 1280x800, mean luminance 36.2, 3.2% bright, 7158
distinct colours. I am text-only and did not inspect it; the fix rests on the
measured font sizes and the reachability assertions.

## Previous round — Round 20: a dialog that never took focus

PRs #5–#20 are published and open for the human. Round 13 added `role="dialog"` and
`aria-modal="true"` to the conversation panel. This round tested whether that
declaration is actually true, and it was not.

### The bug

`aria-modal="true"` tells assistive technology that everything outside the dialog is
inert and that the user is now inside it. That is only honest if focus really moves
there. Measured: opening a conversation by keyboard left focus on `<body>`, and the
panel had no `tabindex`, so it could not hold focus at all.

```
focus when dialogue opens: {"active":"BODY","inDialogue":false}
dialog element: {role:"dialog", ariaModal:"true", tabindex:null}
```

A screen reader user was told "Mara, dialog" and then left with focus outside the
panel — announced a modal they could not enter. Closing made it worse: the panel
became `hidden` while focus may still have been inside it, where keystrokes go nowhere.

### The fix

- Panel gets `tabindex="-1"` (focusable, but not added to the tab order) and is
  focused when it opens.
- `closeDialogue()` checks whether focus was inside, and hands it back to the game
  canvas; the canvas gets `tabIndex = -1` so it *can* receive focus without joining
  the tab order.
- Verified the surrounding behaviour still holds: number keys still take choices with
  focus inside the panel, Escape closes, focus does not land on a hidden element, and
  the player can walk afterwards (1.37 units moved).

### A correction to my own probe

I first reported "number keys do not work". **That was wrong** — I pressed `2`
("Who are you?"), a choice that changes no state. Pressing `1` sets
`lanterns: none → started`. The handler `/^Digit[1-9]$/` was there all along. I also
wrote one bogus check that compared `lanterns` `done` to `done` because an earlier
check had already advanced the quest; fixed by resetting to a clean state first.

### Proof the tests are real

Reverting just the focus fix makes **2 committed desktop checks fail**:

```
FAIL opening a conversation moves focus into the dialog — {"inDialogue":false,"activeId":"BODY"}
FAIL the dialog is focusable and still declares its modal role — {"tabindex":null}
```

### Checks actually run this round

- `npm test` — **343/343 pass**.
- `npm run test:browser` — **138/138 pass, exit 0** (was 132): **6 new checks** — focus
  enters the dialog, the panel is focusable and still `role=dialog`, number keys work
  with focus inside, closing does not strand focus, the canvas holds focus without
  joining the tab order, and walking still works afterwards.
- `npm run test:mobile` — **177/177 pass, exit 0**.
- **Totals: 658 checks — 343 unit, 138 desktop, 177 mobile.**
- `scripts/playthrough.mjs` and `scripts/reachability.mjs` both still exit 0.
- Self-contained re-verified: 26 files, 976 KB, 0 external requests, 0 errors, with
  focus moving correctly in the isolated build.

### Evidence

`artifacts/round20-dialog-focus.png` — 1280x800, mean luminance 34.3, 1.8% bright
(the dialogue is a dim overlay on a night-time frame), 7898 distinct colours. I am
text-only and did not inspect it; the fix rests on the focus assertions above.

## Previous round — Round 19: backgrounding the app left the game stuck

PRs #5–#19 are published and open for the human. Rounds 14–18 hardened *what* the
game does. This round fixes the most common real-world failure on a phone: the game
**died silently** when the player switched away and came back.

### The bug

The visibility handler froze the player whenever the tab or app went to the
background:

```js
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;        // <-- on return, does nothing
  ...
  player.frozen = true;                // <-- freeze applied
});
```

There was **no branch for coming back.** `frozen` was only ever cleared by
`showTouchPause(false)` — and that sheet was never shown. So on a phone: check a
message, return to the game, and **the player cannot move at all**, with no pause
sheet and no hint about why. Every tap, stick drag and keyboard key did nothing.

Measured before/after: `frozen: true` on return, and 15 frames of held forward input
moved the player **0.000** units.

### The fix

A `frozenByVisibility` flag so returning only undoes a freeze *it* applied, and never
resumes the world when a conversation or the pause sheet legitimately owns the pause:

- tab/app hidden → freeze, remember that we did it
- tab/app visible → unfreeze **only** if we froze it, and **not** while a dialogue or
  the pause sheet is open

All four cases verified in a real mobile viewport: plain hide/return resumes walking
(2.09 units moved); an open conversation survives and stays paused; the pause sheet
survives and stays paused; an explicit resume still works normally.

### Proof the test is real

Reverting just this handler makes **8 committed mobile checks fail** across the four
profiles. Restored, all pass. A genuine regression guard.

### Checks actually run this round

- `npm test` — **343/343 pass** (unchanged; this is UI lifecycle, proven in the browser).
- `npm run test:browser` — **132/132 pass, exit 0** (no desktop regressions).
- `npm run test:mobile` — **177/177 pass, exit 0** (was 165): **12 new checks across
  4 profiles** — returning unfreezes the world, the player can actually walk again,
  and a conversation survives backgrounding and stays paused.
- **Totals: 652 checks — 343 unit, 132 desktop, 177 mobile.**
- Self-contained re-verified: 26 files, 972 KB, 0 external requests, 0 errors, with
  hide/return working in the isolated build.

### Evidence

`artifacts/mobile-iphone-13-portrait.png` (1170x2532, mean luminance 95.4, 11067
colours) and `artifacts/mobile-iphone-se-small.png` (640x1136). Measured **32.5%** and
**28.3%** of pixels bright — the most legible mobile frames so far. I am text-only and
did not inspect them; the fix rests on the committed lifecycle checks.

## Previous round — Round 18: reachability proof and save hardening

PRs #5–#18 are published and open for the human. Round 17 fixed a soft-lock found by
a single playthrough, and its own report said honestly: *"I tested completion, not
every hostile path."* This round does the exhaustive version and closes that caveat.

### What Round 18 adds

- **`scripts/reachability.mjs`**: breadth-first search over **every legal action**
  from the start state, then reverse-reachability to find any state that can never
  reach completion. Result: **1428 reachable states, 591 complete, 1428 winnable,
  zero dead ends.**
- **Proof the search works**: restoring the old −15 toll penalty makes it
  independently rediscover the round-17 soft-lock (it prints the stranded states).
  Re-fixed, it reports zero. The explorer is not a rubber stamp.
- **Save hardening**: coins were clamped at the bottom but **not the top**, so a
  hand-edited save could carry `1e308` coins. Now clamped to `MAX_COINS = 9999`,
  which is far beyond the ~7 a finished playthrough ends with (asserted).
- **Corrupt-save fix**: `"quests": []` passed the `typeof === 'object'` check and
  loaded as an empty game. An array is now refused as the corrupt save it is.
- `scripts/reachability.mjs` is **not** added to the shipped manifest: it is a test
  harness, and the browser suite checks the underlying state functions in the
  shipped build instead of shipping the harness to players.

### Correction to my own reporting

While probing this round I claimed I had found "a critical bug: nothing is ever
saved". **That was wrong.** My probe called `applyChoice()` directly, bypassing the
UI's `choose()`, which is what calls `autoSave()`. Re-testing the real path — walking
to Mara and clicking a choice — saving, the Continue button and reloading a finished
game all work correctly. I am recording this because an unverified "critical bug"
claim is exactly the kind of thing I should not leave in a report.

### Checks actually run this round

- `npm test` — **343/343 pass** (was 330): 12 save-hardening cases + 1 exhaustive
  reachability case.
- `npm run test:browser` — **132/132 pass, exit 0** (was 128): 4 new checks (coin
  clamp, array-quests refusal, fractional floor, and the shipped build exposing the
  state functions the reachability proof covers).
- `npm run test:mobile` — **165/165 pass, exit 0**.
- **Totals: 640 checks — 343 unit, 132 desktop, 165 mobile.**
- `node scripts/reachability.mjs` — exits 0, prints 1428 states / 0 dead ends.
- `node scripts/playthrough.mjs` — still exits 0.
- Self-contained re-verified: 26 files, 972 KB, 0 external requests, 0 errors.

### Evidence

`artifacts/round18-reachability.png` — 1280x800, mean luminance 53.3, 12.7% bright,
max 247, 4721 distinct colours. I am text-only and did not inspect it; the claims
rest on the search output and the test results.

## Previous round — Round 17: a soft-lock that made the game unfinishable

PRs #5–#17 are published and open for the human. This round found the most serious
defect in the whole project, and it was found by **playing the game** rather than by
reading code.

### The bug: a soft-lock

Every suite until now set quest state directly (`state.quests[id] = 'done'`), which
means **a quest chain could be impossible to complete and every test would still
pass.** So this round I wrote a playthrough that drives real dialogue and real state
functions. It got three quests in and then stopped dead:

> `toll: Halden is not convinced.` → `ledger: Wren looks you over. "Market business
> is for people the Market trusts."`

The chain:

1. Wren's ledger quest needs **Warm** Market standing (25+).
2. The market toll offers two resolutions. **Pay it** costs 15 Market standing,
   taking you from warm (25) back to neutral (10) — below her gate.
3. From that position, **no remaining action in the entire game raises Market
   standing again.** I exhausted every dialogue choice with all six NPCs and watched
   the number not move: 10 → 10.
4. The ledger is therefore never available, the arrears are gated on the ledger, and
   **two of the six quests become impossible.**

So choosing the option the menu *offers you* ("Pay 5 coins") makes the game
unwinnable, and nothing warns you. The other option (waive the toll) is fine.

### The fix

Wren says trust is earned by *"Dues paid. Promises kept. Oswin at his stall with his
accounts in order."* Paying Oswin's toll out of your purse is **exactly that** — she
is the toll clerk, and the dues are her book. So:

- Paying the toll now sets a `dues_paid` flag and costs only **5** Market standing
  instead of 15 (the displeasure is real but mild).
- `ledgerUnlocked()` accepts settled dues as sufficient, whatever the Market's mood.
- Her dialogue now **says so**: *"Wren taps her book, where Oswin's dues are now
  entered. 'Your doing, that.'"* rather than implying you charmed her.

I verified **all 8 combinations** of the three branch choices (toll paid/waived ×
ledger name/cover × arrears pay/forgive) now finish.

### Proof the new test is real

I reverted the one-line fix and re-ran the suite: **9 of 12 playthrough tests fail.**
Restored it: 12/12 pass. This is a genuine regression guard, not a test written to
match whatever the code happens to do.

### Also found: a visible wall with no collider

The terrace parapet is a 0.55 m wall you can walk straight through. Not fixed this
round (it is cosmetic-adjacent and needs its own careful change); recorded in Next
steps.

### Checks actually run this round

- `npm test` — **330/330 pass** (was 318): 12 new playthrough cases.
- `npm run test:browser` — **128/128 pass, exit 0** (was 124): 4 new checks, including
  a whole playthrough driven inside the browser and the toll trap checked directly.
- `npm run test:mobile` — **165/165 pass, exit 0**.
- **Totals: 623 checks — 330 unit, 128 desktop, 165 mobile.**
- `node scripts/playthrough.mjs` — a standalone playable run; exits 0 and prints the
  six completions and the epilogue.
- Self-contained re-verified: 26 files, 972 KB, 0 external requests, 0 errors, and
  the **full playthrough completes inside the isolated build**.

### Evidence

`artifacts/round17-playthrough.png` — 1280x800, mean luminance 53.3, 12.7% bright,
max 247, 4715 distinct colours. I am text-only and did not inspect it; the finding
rests on the playthrough assertions.

## Previous round — Round 16: accessibility controls on a phone

PRs #5–#16 are published and open for the human. Rounds 13–15 built screen-reader
support, a spoken compass and guided travel — all reachable only through the **C, L
and G keys**. A phone has none of those keys, and **VoiceOver on iOS is the most
widely used screen reader in the world.** So the single largest accessibility
audience got none of that work. This round fixes a gap I created myself.

### What Round 16 adds

- Three touch buttons in the mobile control cluster: **Where am I** (C), **Nearby**
  (L) and **Take me** (G). All 44px touch targets with `aria-label`s.
- **Take me** starts guided travel, and tapping it again stops it — the same
  behaviour as G.
- Verified at **all four emulated profiles including iPhone SE (320x568)**, where
  the buttons genuinely overlap the stick and look zones. Geometry alone was not
  enough: the meaningful check is that `elementFromPoint` at each button's centre
  returns **that button**, not the look zone beneath it. All three pass.

### Bugs I found in my own test work this round

1. **I inserted my checks between an action and its assertion.** My block landed
   between `touch.interact()` and the check that reads its result, so the dialogue
   checks failed with `open: false`. Nothing was wrong with the game; I had split a
   two-step test.
2. **Cached tap coordinates went stale.** The interact button appears and disappears,
   which shifts the row, so coordinates captured earlier landed on the wrong control.
   Tapping by selector fixed it.
3. The "Take me" test then left the player standing in a conversation, which broke
   every later dialogue check. The block now resets the world when it finishes.

### Checks actually run this round

- `npm test` — **318/318 pass** (unchanged; this round is UI wiring, proven in the
  browser rather than by new pure functions).
- `npm run test:browser` — **124/124 pass, exit 0** (unchanged, no desktop regressions).
- `npm run test:mobile` — **165/165 pass, exit 0** (was 137): **28 new checks across
  4 profiles.** New: the three controls exist; they are thumb-sized and on screen;
  each has an accessible name; **taps actually reach them rather than the look
  zone**; Where am I speaks the area and gate; Nearby names somewhere with a
  direction; Take me starts and stops guided travel.
- **Totals: 607 checks — 318 unit, 124 desktop, 165 mobile.**
- 26 files, 968 KB, self-contained re-verified (0 external requests, 0 errors).

### Evidence

`artifacts/mobile-iphone-13-portrait.png` (1170x2532, mean luminance 95.4, 11141
colours) and `artifacts/mobile-iphone-se-small.png` (640x1136). Measuring the
bottom-right **button corner separately**: 17.0% and 62.7% of pixels above 90
luminance — the buttons are really drawn with readable text, not just present in the
DOM. I am text-only and did not inspect them.

## Previous round — Round 15: guided travel

PRs #5–#15 are published and open for the human. Round 14 gave the world a spoken
compass, and I flagged its own limit at the time: it **described** a route, and a
blind player still had to walk it step by step past walls and a ramp they could not
see. This round supplies the route itself.

### What Round 15 adds

- `src/pathfind.js` (pure, 16 unit tests): `buildGrid()`, `findPath()` (A*),
  `pathLength()`, `nearestOpenCell()`, `isWalkable()`, `cellCentre()`,
  `worldToCell()`, `summarisePath()` and `BOUNDS`.
- **The grid is built from the game's real colliders and step heights**, not a
  hand-drawn map. Exposed through `navigationGrid()` so tests use the live world.
- **Guided travel (`G`)** walks the player to a named place, or to the nearest thing
  worth walking to. It drives `player.setMoveInput()` — the same path a keyboard
  uses — so it goes through the **existing acceleration, collision and step-height
  code**. A guided walk cannot end up inside a wall that manual walking stops at.
- **It refuses out loud** when a target is unreachable ("The ledger spot cannot be
  reached from here") instead of walking the player into a shut gate.
- Manual input cancels it: press any movement key and you have the controls back.
- Spoken distances are phrases, never numerals.

### Three real bugs, all found by testing

1. **The grid was sized to the plaza only.** `HALF` is 17, but the market lane runs
   to z = -26, so **every route into the lane silently failed** — the exact place
   the ledger quest lives. Found by checking the real world instead of assuming.
   `BOUNDS` is now derived from `PLAZA` and `LANE`, with a test named after the bug.
2. **The last waypoint was being snapped inside the target.** A bench is a solid
   object, so snapping the final waypoint onto its centre walked the player into it
   and stalled them ~3 units short with no explanation. The endpoint is now the open
   cell the search actually reached; only the *start* is snapped.
3. **The gate was walkable when shut.** Initially a path to the lane existed with
   the gate closed (26.0 units). After the bounds fix, the gate collider genuinely
   blocks: closed → `null`, open → 26.2 units, re-closed → `null`. All three states
   are now committed browser checks.

I also wrote **two more wrong tests** (asserting a walk that takes ~11s would finish
in 9s, and trying to cancel a walk whose destination was already reached). Both were
my error, not the game's.

### Checks actually run this round

- `npm test` — **318/318 pass** (was 302): 16 new pathfinding cases.
- `npm run test:browser` — **124/124 pass, exit 0** (was 117). New checks: the grid
  covers the lane; **a shut gate really makes the lane unreachable**; opening it opens
  a real route; guided travel moves the player gradually rather than teleporting;
  it delivers them to the bench and says so; taking the controls stops it; and an
  unreachable destination is refused and explained.
- `npm run test:mobile` — **137/137 pass, exit 0**.
- **Totals: 579 checks — 318 unit, 124 desktop, 137 mobile.**
- Manifest test caught `src/pathfind.js`; now 26 files.

### Evidence

`artifacts/round15-pathfinding.png` — 1280x800, mean luminance 53.3, **12.7% of
pixels bright**, max 247, 4726 distinct colours. This is the most legible frame of
any round so far (the modal rounds were much darker by design). I am text-only and
did not inspect it; the travel claims rest on the browser assertions.

## Previous round — Round 14: the spoken compass

PRs #5–#14 are published and open for the human. Round 13 made the game *announce*
things. I flagged the remaining gap in my own report at the time: announcements tell
you what changed, but there was still **no way to move through the world without
sight**. Walking is WASD against a canvas. This round fixes that.

### What Round 14 adds

- `src/compass.js` (pure, 22 unit tests): `bearingDegrees()`, `compassBearing()`,
  `facingDegrees()`, `relativeDirection()`, `distanceTo()`, `distancePhrase()`,
  `describeTarget()`, `nearbyTargets()`, `routeHint()` and `sentenceCase()`.
- **Directions are computed from real coordinates and asserted against the actual
  map.** The world's axes are north = -Z (the wall and lane beyond it), east = +X
  (the market stalls). A flipped axis would send a blind player the wrong way with
  no way to notice, so tests check the gate really does read north-ish from the
  plaza centre and the lane really is at more negative z.
- **Two ways to use it**, both derived from one source so they cannot disagree:
  - **Spoken:** `L` lists what is nearby with relative direction, distance and
    world bearing; `compassTargets()` includes every NPC **where they actually are
    at this hour**, not where they spawned.
  - **Written:** a compass list in the journal panel, plus a "walk to…" box that
    takes a place or person's name and reports the route in text and aloud.
- Distances are phrases ("a few steps away", "across the plaza"), never numerals,
  because these are read aloud.

### Two real bugs I found, both by testing rather than reading

1. **Typing walked the player and ate the letters.** The compass box is the game's
   first text input, and it exposed a latent problem: global hotkeys were handled
   with no check for a focused field. Typing `bench` arrived as **`benh`** — the
   `c` triggered "describe" — and typing `wwww` physically moved the player.
   Fixed **at the movement source** in `player.js` (and in the global handler),
   so no future input field can reintroduce it.
2. **My own tests were wrong three times.** I asserted the gate was due *north* of
   the plaza centre (it is at x = 9.5, so it is **north-east**) and that the job
   board was south-west-ish (facing north it is **behind** you). The code was
   right; I corrected the tests to assert what is actually true. I also wrote
   lowercase expectations that my own capitalisation fix then broke.

### Checks actually run this round

- `npm test` — **302/302 pass** (was 280): 22 new compass cases.
- `npm run test:browser` — **117/117 pass, exit 0** (was 109). New checks: the
  compass knows real landmarks and NPC positions; facing north reports the gate
  ahead; turning around **flips the relative direction but not the world bearing**;
  asking for a place names it with a bearing; **typing does not move the player**;
  the written and spoken answers are identical; an unknown place is reported; and
  the journal shows a written compass list.
- `npm run test:mobile` — **137/137 pass, exit 0**.
- **Totals: 556 checks — 302 unit, 117 desktop, 137 mobile.**
- Manifest test caught `src/compass.js`; now 25 files.

### Evidence

`artifacts/round14-compass.png` — 1280x800, mean luminance 34.7, max 247, **5817
distinct colours**: a real rendered frame. I am text-only and did not inspect it;
the compass claims rest on the browser assertions above, including the
direction-reversal check.

## Previous round — Round 13: screen-reader support

PRs #5–#13 are published and open for the human. Round 12 closed the story.
This round addresses the one thing that made the game **not merely awkward but
completely unplayable** for a blind player.

### The gap

The game is first-person and drawn entirely to a canvas. Nearly everything it
communicates — the plaza around you, who is nearby, what you can interact with,
that a quest moved on, that you gained coins — went to a canvas or to a toast that
faded after three seconds. I probed a real browser and confirmed the worst case:
**no ARIA roles, no live region, focus never moved, and zero `prefers-reduced-motion`
support.** A screen-reader user got silence from start to finish.

### What Round 13 adds

- `src/announce.js` (pure, no DOM, 16 unit tests): `areaName()`,
  `areaAnnouncement()`, `interactableAnnouncement()`, `questChanges()`,
  `coinAnnouncement()` and `describeState()`.
- **Announcements are diffed from real state, never invented.** Quest changes are
  announced by comparing state before and after the mutation, so nothing is
  reported that did not happen. Quest titles are read from the **same `QUESTS`
  table the journal uses**, so spoken and written names cannot drift apart.
- **Live regions in the markup**, visually hidden with the standard clipping
  pattern (not `display:none`, which screen readers ignore): a polite region for
  progress and an assertive `role="alert"` for things that must not be missed.
- **The dialogue is spoken** — the speaker, the line, and the numbered options — and
  the panel is now a proper `role="dialog" aria-modal="true"` labelled by the
  speaker name.
- **A "describe where I am" key (C)** reports the area, whether the gate is open,
  the nearest thing to use, and the coin balance — the same facts a sighted player
  takes in at a glance. Silent before the game starts, when there is nowhere to be.
- Area changes and nearby interactables are announced as they happen.
- **`prefers-reduced-motion` is honoured** (there was no support at all).

### Two bugs I found in my own work

1. **Quiet announcements clobbered each other.** "Quest complete" was set into the
   live region and then replaced a frame later by a passing "you can talk to Mara",
   so the thing that mattered was never heard. Found by a committed browser check,
   not by inspection. Fixed with a small queue that speaks one at a time, plus
   dedupe so walking past the same bench does not repeat itself.
2. The C key answered on the title screen, describing a plaza the player had not
   entered. Guarded on `started`.

I also caught myself writing a **bogus test**: an earlier block in the same suite
had already set every quest to `done`, so my "quest changed" check was comparing
`done` to `done` and could never fail. Replaced with a test that drives the real
`withAnnouncements()` production path instead of a copy of it.

### Checks actually run this round

- `npm test` — **280/280 pass** (was 264): 16 new announcement cases.
- `npm run test:browser` — **109/109 pass, exit 0** (was 103). New checks: the
  dialogue is announced as a modal, live regions exist and stay in the
  accessibility tree, the describe key reports area/gate/coins, a conversation is
  spoken with its options, finishing a quest is announced, and
  `prefers-reduced-motion` is honoured.
- `npm run test:mobile` — **137/137 pass, exit 0**.
- **Totals: 526 checks — 280 unit, 109 desktop, 137 mobile.**
- Manifest test caught `src/announce.js` missing again; regenerated, now 24 files.

### Evidence

`artifacts/round13-access.png` — 1280x800, mean luminance 40.1, max 255, **7895
distinct colours**: a real rendered frame. I am text-only and did not visually
inspect it; the accessibility claims are backed by the ARIA assertions and live-
region reads above, not by the picture.

## Previous round — Round 12: the ending

PRs #5–#12 are published and open for the human. Round 11 gave the game sound.
This round fixes the biggest remaining narrative gap: **there was no ending at
all.** A player who finished all six quests got silence. No acknowledgement, no
conclusion, nothing — which makes a complete game read as an unfinished one.

### What Round 12 adds

- `src/epilogue.js` (pure, 16 unit tests): `storyComplete()`, `storyProgress()`,
  `branchLines()`, `standingSummary()`, `factionClosers()` and `buildEpilogue()`.
- **The ending is composed from what the player actually did**, not written once
  for everybody:
  - one line per **branch** taken (ledger: named vs covered; toll: collected vs
    waived; arrears: paid vs forgiven);
  - a closing line for **each faction**, per tier — so a player the Watch hates
    reads "Halden has written your description in the gate ledger, underlined"
    while a trusted player reads "Halden salutes you at the gate";
  - a best/worst standing summary, and a closing paragraph about leaving.
- Two players finishing the same six quests get **materially different endings**.
  Verified by comparing two full playthroughs in unit tests.
- The epilogue appears once as a quiet paper-toned overlay on completion, and is
  **re-readable from the journal** at any time afterwards.
- It **cannot appear early**: `buildEpilogue()` returns `null` until every quest is
  done, asserted both in unit tests and in the browser.

### A truthfulness bug I caught in my own work

A save finished *before* branch outcomes were recorded — or a hand-edited one —
has no `outcomes`, so the ending rendered with **zero branch lines**: a shorter
ending presented as the whole story, silently implying the player made no
choices. It now sets `branchesUnrecorded` and says so in the text: "Some of what
you did here was not written down, and the record of it is gone."

### Checks actually run this round

- `npm test` — **264/264 pass** (was 248): 16 new epilogue cases, including that
  the ending withholds itself until the story is complete, never mentions a branch
  that was not taken, ignores unknown outcomes from a hand-edited save, admits an
  incomplete record, and differs between two full playthroughs.
- `npm run test:browser` — **103/103 pass, exit 0** (was 98). Five new checks: no
  ending before completion, the epilogue appears on completion, it reports the
  branches actually taken and not the others, it is honest about a hostile faction,
  and it can be dismissed and reopened from the journal.
- `npm run test:mobile` — **137/137 pass, exit 0**.
- **Totals: 504 checks — 264 unit, 103 desktop, 137 mobile.**
- The manifest test again caught the new `src/epilogue.js` missing from
  `requiredFiles`; regenerated, now 23 files.

### Evidence

`artifacts/round12-ending.png`: the overlay is deliberately dark (mean luminance
21.3 over the whole frame, as designed for a modal), so I measured the **card
region separately**: mean luminance 41.8, **11.2% text pixels above 90**, max
luminance 247, 1272 distinct colours — real rendered text, not a blank sheet.

## Previous round — Round 11: sound

PRs #5–#11 are published and open for the human. Before starting another
mechanic I audited what already existed, exhaustively:

- **626 dialogue nodes** walked across every NPC in every quest state and with
  every faction hostile: **zero** crashes, dead ends, or unreachable nodes.
- Save round-tripping across every quest step with coins and reputation set:
  **zero** losses.
- Every branch ending producing a non-empty journal entry: **zero** gaps.
- Reputation bounds under 600 abuse operations, coins never negative, job costs
  always enforced: **zero** problems.

That audit turned up the real gap, which was not a bug but an absence: **the game
had no audio at all.** For a first-person adventure with lanterns, a fountain and
a market lane, that is a genuine hole in the experience.

### What Round 11 adds

- `src/audio.js` (pure core, 14 unit tests, browser binding): the entire
  soundscape is **synthesised with the Web Audio API**, so there are still no
  assets, no downloads and no licensing questions — the self-contained build is
  unchanged in kind.
- A **warm drone** that follows the day cycle, shifting root note and level
  between day, dusk and night, so the plaza never sounds the same twice.
- **Seven interaction cues** — talk, choose, close, pickup, quest, refuse, work —
  built on a pentatonic scale, chosen because every interval in it is consonant,
  so cues never clash with each other or with the drone.
- A **sound toggle** in the corner (also **M**), reachable by touch at 44 px,
  which hides itself during dialogue so it never covers the choices.
- The mute preference persists in `localStorage`, so a player who silences the
  game does not have to silence it again every session.

### Proof the sound is real, not merely non-crashing

"It did not throw" is worthless evidence for audio. I rendered the same graphs
through an `OfflineAudioContext` and measured the samples:

| Graph | Peak | RMS |
| --- | --- | --- |
| cue: talk | 0.0784 | 0.00561 |
| cue: quest | 0.0840 | 0.00745 |
| cue: pickup | 0.0992 | 0.00710 |
| drone: day / dusk / night | 0.040 / 0.055 / 0.031 | 0.027 / 0.036 / 0.021 |

**No graph rendered silence.** Everything is also deliberately quiet, with hard
gain ceilings (`MAX_CUE_GAIN 0.14`, `MAX_AMBIENCE_GAIN 0.08`), so the game can
never startle the player when a dialogue opens.

### Bugs found in my own work

1. **`writePreference(null, …)` returned `true`** — claiming a preference had been
   saved when there was no storage to save it to. Now reports failure. Caught by a
   test I wrote to assert the failure path.
2. **Non-finite gains.** My first test expected `Infinity` to clamp to the maximum,
   which would mean a corrupt value could make the game as loud as possible. The
   code already returned 0, which is the safe behaviour; I corrected the test and
   documented the policy rather than changing the safe code.
3. **My audio checks broke the board checks.** Inserting them mid-section, when
   they reload the page, reset the state the later board checks depended on. Moved
   to the end of the run. Worth stating plainly: the two failures were caused by my
   test ordering, not by the feature.

### Checks actually run this round

- `npm test` — **248/248 pass** (was 234): 14 new audio cases, including that a
  missing/broken AudioContext is a safe no-op, that a muted game creates no
  oscillators, and that every gain is clamped.
- `npm run test:browser` — **98/98 pass, exit 0** (was 94). Four new checks: audio
  starts with the game and the toggle is reachable, every cue plays without
  erroring, a muted player stays muted across a reload, and the ambience follows
  the time of day.
- `npm run test:mobile` — **137/137 pass, exit 0**.
- **Totals: 483 checks — 248 unit, 98 desktop, 137 mobile.**

### Evidence

`artifacts/round11-audio.png`: 1280x800, mean luminance 109.9, 46.2% bright pixels,
2842 distinct sampled colours.

## Previous round — Round 10: the plaza work board: goodwill you can earn *before* you need it.

PRs #5–#10 are published and open for the human. Real-device testing is still
blocked on hardware I do not have. Round 9 added a repeatable way to earn standing
back, but left it in the wrong place, which I noted at the time: **work was only
offered by a *refused* NPC, so goodwill could only be earned after it was already
too late.** A player had to hit a wall before they could start climbing.

### What Round 10 adds

- `JOB_BOARD` in `src/areas.js` at (-3.4, 8.6): inside the plaza, on the walk
  between the gate and Mara, 1.65 m clear of the nearest barrel and 4.95 m from
  the bench, so it neither clips a prop nor blocks a path.
- The board mesh in `src/world.js`: two posts, a pinned face and three paper
  slips, so it reads as a job board from a distance rather than a plain panel.
- `JOB_BOARD_SPEAKER` and an exported `workMenu(state, npcId, name, intro)` in
  `src/dialogue.js`, so the board reuses the existing dialogue UI and offers
  exactly the same jobs as a refusal menu — but with board copy instead of a
  shopkeeper scolding the player.
- `applyChoice` now only writes NPC memory when `DIALOGUE[npcId]` exists, so the
  board cannot invent a phantom `job_board` NPC in the save. Verified: memory
  stays `[]` after taking board work.
- `openDialogue` uses `npc.talk ? npc.talk(state) : startConversation(...)`; world
  NPCs have no `.talk`, so the ordinary conversation path is untouched.

### Checks actually run this round

- `npm test` — **234/234 pass** (was 223): 11 new board cases, including that the
  board stays reachable when an NPC would refuse, that board work alone can lift a
  player out of a refusal, that it is never free, and that it invents no NPC.
- `npm run test:browser` — **94/94 pass, exit 0** (was 89). Five new checks: the
  board is a findable interactable, it opens as a board with three jobs, a neutral
  player gains standing and pays 2 coins, no phantom NPC appears, and a time job
  still costs the hour.
- `npm run test:mobile` — **137/137 pass, exit 0**.
- **Totals: 465 checks — 234 unit, 94 desktop, 137 mobile.**
- Walkability confirmed with real key input: walking south reaches 0.21 m from the
  post and `read the work board` appears. An earlier 1.8 s probe stopped 2.05 m
  short and showed nothing — a test-setup error, not a bug, which I re-ran before
  drawing any conclusion.

### Evidence

`artifacts/round10-job-board.png` captures the board menu itself in daylight,
verified programmatically at 93.9 mean luminance, 35.0% bright pixels and 3851
distinct sampled colours. My first attempt placed the capture after the
time-costing job had moved the clock to dusk (the same weak-evidence mistake I
made in Round 9), so I moved it to the moment the menu is on screen.

## Previous round — Round 9: earning standing back

PRs #5–#9 are published and open for the human. Real-device testing is still
blocked on hardware I do not have. Round 8 gave reputation teeth but left a real
design gap, stated honestly in that round's notes: **refusals were escapable only
through quests, so a player who had finished every quest had no repeatable way
back out of Hostile.** The plaza shut them out and stayed shut. This round fixes
that.

### What Round 9 adds

- `src/repair.js` (pure, 16 unit tests): three odd jobs — sweep the fountain steps
  (Keepers), carry crates (Market), drill with the gate watch (Watch). Every job
  costs something real, so standing can never be farmed by pressing a button:
  - the sweep and the drill take **the rest of the hour** (the clock really
    advances to the next phase);
  - the crates and the drill cost **coins**, deducted before the work happens;
  - each job nudges a rival faction down, so who you work for is a choice.
- **The way back is discoverable where it is needed.** The refusal itself now
  offers "What would change your mind?" → "Show me the work.", listing every job
  with its price and its reward, and listing unaffordable jobs too, with the
  reason, instead of silently hiding them.
- **Working while disliked pays less** (half at Hostile, three-quarters at Cold),
  so the first points out of Hostile are the expensive ones. Verified: climbing
  out of Hostile takes more than a handful of jobs, not one.

### Dead content removed

Round 8's Watch rule carried `until: isQuestDone('key')`, which lifted Halden's
refusal **forever** once the key quest was done. Since that happens in the first
few minutes, the Watch could never actually refuse in normal play — its refusal
and the whole repair path behind it were unreachable content. My own new test
caught it. The `until` is gone; the `exempt: carries the key` predicate is what
protects the critical path, and it only applies while the key is in hand.

### Checks actually run this round

- `npm test` — **223/223 pass** (was 207): 16 new repair cases. The manifest test
  caught `src/repair.js` missing from `requiredFiles` (its purpose again); the
  manifest was regenerated, now 21 files.
- `npm run test:browser` — **89/89 pass, exit 0** (was 83). Six new checks drive
  the real dialogue: a refused player is offered work, every job states price and
  reward, a coin job charges coins and leaves the clock alone, a time job really
  moves the clock, enough work earns the refusal away, and the player is served
  again afterwards.
- `npm run test:mobile` — **137/137 pass, exit 0**.
- **Totals: 449 checks — 223 unit, 89 desktop, 137 mobile.**

### Evidence

`artifacts/round9-standing-repair.png` captures the work menu itself in daylight,
verified programmatically at 36.0% bright pixels and max luminance 255. My first
attempt placed the capture after the clock had moved to dusk, producing a dim
frame that showed the room rather than the feature; I moved it to the moment the
menu is on screen.

## Previous round — Round 8: Reputation refuses content

PRs #5–#8 are published and open for the human. Real-device testing is still
blocked on hardware I do not have. Last round closed the lane's dead end; this
round fixes the other half of the standing system.

Until now standing only ever **opened** doors: Wren hands out her ledger above
Warm Market, and nothing anywhere turned the player away. A reputation that can
never be lost in any practical sense is not really a reputation.

### What Round 8 adds

- `src/refusal.js` (pure, 15 unit tests): a general refusal rule set with
  `refusalFor()`, `refusalHint()` and `belowTier()`. `required` is the lowest tier
  that still gets served, so `'warm'` refuses everything below Warm.
- Two live rules in `REFUSAL_RULES`: Oswin turns away anyone the Market rates Cold
  or worse, and Halden will not do business with a Hostile Watch.
- A refusal **always explains itself and always offers a way forward** — it names
  the faction, says whether the player is merely disliked or fully shut out, and
  answers "what would change your mind?". The Standing panel is therefore
  discoverable from the refusal instead of being a hidden system.
- Verified in the real UI: with the Market at Cold, Oswin refuses and the
  Standing panel reads `The Market — Cold −40`.

### The soft-lock bug this round could have introduced, and the guard

Refusals are dangerous: Oswin sells the **only oil** the first quest needs, and
Halden holds the key to the **only route north**. A player who soured the Market
or the Watch early could have been left permanently unable to buy the oil or
return the key — soft-locking both the tutorial and the whole market lane.

I checked whether that was actually reachable before shipping it: the worst
negative-Trade sequence available before finishing the lanterns reaches about −15,
so it is not reachable today, but it was one content change away. Rather than
relying on that, every rule now has an `exempt` predicate for the critical path —
Oswin serves you while the oil quest is in progress, and Halden always accepts the
key back if you are carrying it. Both are covered by unit and browser tests.

### Checks actually run this round

- `npm test` — **207/207 pass** (was 191): 15 new refusal cases, plus 1 more
  faction-grammar case. The existing manifest test caught me adding
  `src/refusal.js` without listing it — its whole purpose — and the greeting test
  failed legitimately because Oswin's Cold greeting is now replaced by a refusal.
  I moved the grammar coverage to NPCs that never refuse rather than weakening it.
- `npm run test:browser` — **83/83 pass, exit 0** (was 77). Six new checks: a
  neutral Market is served, a Cold Market refuses, the refusal explains itself,
  the Standing panel shows Cold, and the critical path stays open at Hostile for
  both the oil and the key.
- `npm run test:mobile` — **137/137 pass, exit 0**.
- **Totals: 427 checks — 207 unit, 83 desktop, 137 mobile.**

## Previous round — Round 7: The Lane's Arrears

PR #6 (v0.3.0 phone candidate) and PR #7 (context-loss recovery + release
manifest) are published and open for the human. Real-device testing is still
blocked on hardware I do not have, so this round returns to the game itself and
closes the biggest design gap left in it: the market lane was a dead end. Its one
quest resolved inside the lane and nothing ever took you back to the plaza.

### What Round 7 adds

- **A sixth quest, *The Lane's Arrears***, that cannot be finished in one place.
  Wren hands you a pouch of three weeks' overdue toll money; you must carry it
  **south through the gate** to Mara in the plaza, then carry **her mark back
  north** to Wren. The pouch and the mark are real inventory items, so the quest
  is gated on what you are physically holding, not on what the state remembers.
- **Two endings with different consequences on both sides of the gate.** Paying in
  full backs the books and pleases the Watch (+5 Watch); forgiving the debt pleases
  the Keepers but leaves a shortfall the Watch will ask about (−5 Watch). The
  journal reports the ending you actually reached.
- Unlocked only by finishing Wren's ledger, so it continues that story rather than
  sitting beside it.

### Bugs found and fixed while reviewing my own work

1. **A player could be permanently stranded.** If Mara's mark left the pack (a
   dropped save, a bug, a hand-edited file), Mara still said "take my mark back to
   Wren", Wren offered nothing, and the quest could never be finished — with no
   prompt, no error, and no way out. Mara now notices the empty hands, says so, and
   writes the mark out again; `reissueArrearsMark()` restores the *correct* item for
   the ending you chose (a note on the forgiving branch, never a receipt). Found by
   deliberately probing stuck states, not by a passing test.
2. **A false alarm I chased down rather than assumed**: a reputation message
   looked like it applied "+1" for a delta of 10, which would have been a real
   scaling bug — my own `.slice(0, 60)` had truncated "+10". Verified the scaling
   was correct before changing anything.

### What Round 6 adds

- `src/resilience.js` (pure, 9 unit tests): a context-loss recovery state machine
  with an attempt budget, a timeout and explicit give-up rules, plus a
  panic-shed predicate for catastrophically slow frames.
- `src/main.js`: real `webglcontextlost` / `webglcontextrestored` handling. On
  loss the game **saves immediately** (the save data is plain JSON and is
  unaffected by the renderer, so a renderer fault must never cost progress),
  shows a recovery sheet, and clears it when the context returns. If the context
  does not return within the timeout the sheet says so and offers a reload.
- `index.html`: the `#context-lost` recovery sheet, styled to match the pause menu.
- `src/perf.js`: added `force(ratio)` so emergency resolution shedding goes
  through the controller and the ratio it reports stays truthful.

### Bugs found and fixed this round

1. **The recovery sheet had two buttons that did nothing different** — "Try
   again" and "Reload the game" both reloaded the page, because once the context
   is gone a reload is the only way back. A button that promises a retry it
   cannot perform is a lie to the player, so the dead button is gone and the
   remaining one is honestly labelled.
2. **My own new test asserted almost nothing.** `hasReload` was computed as
   `typeof ...onclick !== 'undefined' || element !== null`, which is true for any
   element that exists — the same weak-assertion trap I had already fixed once
   this project. It now measures the button's real bounding box, computed
   visibility, and label, and requires a 44 px touch target.
3. **Panic-shedding disagreed with the adaptive controller.** My first version
   set the renderer's pixel ratio directly, so the controller reported 1 while
   the renderer actually ran at 0.5. The desktop suite caught it immediately
   (`adaptive resolution is on and reported honestly`). Fixed by adding
   `force()` to the controller and routing emergency shedding through it, with
   tests asserting the two agree.

### A release manifest the Play tab can read

The owner wants to launch the preview from a Play tab. Rather than leaving the
hosting step to guess, the release now describes itself:

- `src/manifest.js` (pure): entry point, the exact required-file list, directories
  not needed at runtime, control scheme, and `verifyManifest()` which fails loudly
  if a listed file is missing.
- `release-manifest.json` at the repo root, generated by
  `npm run release:manifest`, committed, and held to the real files by a test so
  it cannot drift. Exposed at runtime as `window.amazingAdventure.manifest`.
- 9 new unit tests: every required file exists, every `src/*.js` is listed (a
  forgotten module would 404), the manifest agrees with `version.js`, required
  files are not also in the omitted list, `verifyManifest` reports exactly the
  missing file, no engine file imports from `tests/`/`scripts/`/`artifacts/`, and
  the committed JSON is not stale.
- Verified the list is sufficient for real: copied **only** those 19 files
  (868 KB) into an empty directory, served it with a plain static server, and
  played it with every off-origin request aborted — 0 external requests, 0 failed
  requests, 0 console errors, two-thumb walk-and-look working, Talk button
  appearing at Mara.

### Checks actually run this round

- `npm test` — **191/191 pass** (was 171): 20 new arrears cases, including the
  stranding and re-issue paths, both endings, save/reload of a carried pouch, and
  an unknown quest step falling back safely.
- `npm run test:browser` — **77/77 pass, exit 0**: 7 new checks play the whole
  arrears loop through the real dialogue buttons — Wren's offer, the pouch
  landing in the pack, Mara receiving it across the gate, the receipt appearing,
  the reward being paid on the walk back, the journal matching the ending, and a
  lost mark being replaceable.
- `npm run test:mobile` — **137/137 pass, exit 0** across four emulated profiles.
  Five new checks per profile drive the real `WEBGL_lose_context` extension: the
  recovery message appears, progress is saved at the moment of loss, the recovery
  sheet offers a *usable* reload button (visible, labelled, at least 44 px tall),
  the sheet tells the player their progress is kept, and the game recovers when
  the context returns.
- **Totals: 405 checks — 191 unit, 77 desktop, 137 mobile.**

## Next steps

1. **Confirm the new preview on the live Pages URL.** The owner pushes this artefact;
   then verify the deployed host really sends `text/javascript` for `.js`, serves
   `.nojekyll`-protected files verbatim, and that gameplay starts on an actual phone.
   The `curl` checks in `DEPLOY.md` are the fast version of this.
2. **Get the game onto real hardware.** The largest honest gap: no physical phone or
   iOS Safari has been available. A real-device pass should confirm touch gestures,
   safe-area insets on a notched phone, and frame rate on a real GPU — the adaptive
   resolution controller has only ever seen software rasterisation.
3. **A real screen reader session.** Rounds 13, 16 and 24–25 verify the browser's
   accessibility tree, which is close to what assistive tech consumes, but no NVDA or
   VoiceOver run has happened, so verbosity and announcement ordering stay unverified.

---

## Round 54 — the lamp round (gameplay reason to linger in the lane)

**Branch:** `grunt/round54-lane-lighting` (off `grunt/round53-lane-continuity`, PR #54 unmerged).
**Head:** `cd9ea22` (feature `cbf7769` + preview rebuild `36adccd` + evidence `cd9ea22`).

### Current task
Round 54 is complete and ready to publish: the lane lanterns now stay dark at
dusk until the player walks the lamp round and lights them; the chore pays a
small trader reward, resets at dawn, and the lamp post reports state honestly.
All three test suites pass with 0 failures. Next: write `publish.json` +
`needs-supervision.json` and end the turn for the supervisor.

### What was built
- `src/areas.js`: `laneLightingStatus`, `laneLanternsShouldGlow`,
  `laneLanternsAtDawn` (pure), `lightLaneLanterns` (pays 2 coins + trade
  standing, refuses in daylight / when already lit), `LANE_LIGHTING_POST`,
  `LANE_LIGHT_REWARD`, `laneLightingHint` (never null — names the fixture when
  the round is unavailable).
- `src/main.js`: lamp-post interactable always answers in reach (kind
  `'lanterns'`, label from `laneLightingHint`); `performLaneLighting()` runs the
  round and refreshes phase/HUD/save; dawn reset in `syncPhase` uses
  `laneLanternsAtDawn` and toasts `dawn.message`; dusk toast distinguishes lit
  vs. dark lane.
- `src/world.js`: lamp post head `emissiveIntensity` 0 by default and driven by
  `applyPhase(..., laneLit)` as `look.lampGlow * 0.9` only when lit; no point
  light (low-tier budget preserved).
- `src/ambient.js`: `lane_lit` / `lane_dark` scripts; `scriptKeyFor` dusk
  `lane_lit` if lit else `lane_dark`, night `lane_lit` if lit else `night`;
  toll/perk priorities preserved; `dusk` key folded into `lane_lit`.
- `src/touch.js`: interact label `'Light'` for `lanterns`.
- `tests/lane.test.mjs` 23 pass; `tests/ambient.test.mjs` 16 pass;
  `tests/touch.test.mjs` updated.
- `scripts/test-round2.mjs`: round-54 desktop section added (daylight
  explanation, pays once/no farming, post head matches lit state, lit all night
  + not offered twice, dawn reset + dusk offers again, ambient both ways);
  round-53 lane check updated for dark-until-lit semantics.

### Checks actually run
- `npm test` — **468/468 pass** (0 fail).
- `npm run test:browser` — **225 pass, 0 fail**, exit 0 (last run `/tmp/bfinal.log`).
- `npm run test:mobile` — **185 pass, 0 fail**, exit 0, 4 profiles
  (`/tmp/m2.log`, `/tmp/ma.log`).
- Mutation proof: removing the already-lit guard in `laneLightingStatus` fails
  tests 17, 20, 22; restoring passes all 23. `scriptKeyFor` dusk-branch
  mutations fail tests 7, 8, 11; restored, 16 pass.
- Preview rebuilt: `node scripts/build-preview.mjs` → 69 files, 3952 KB,
  digest `55dd8d99…`; byte-identical second rebuild verified.
- Evidence: `artifacts/round54-lane-lighting.png` (570 KB, captured from
  committed `dist/`); mobile captures refreshed.

### Decisions
- Lamp post always answers (never inert) so a returning player is told why there
  is nothing to do; `laneLightingHint` never returns null.
- Pure-logic-first: rules in `src/areas.js`, unit tests before wiring.
- Post head is emissive only (no point light) to protect the low-tier per-pixel
  budget; `applyPhase` drives it.
- Ambient lane chatter is lower priority than toll/perk scripts, as intended;
  the `laneTalk` browser check samples a fresh state so it asserts the lane
  scripts directly.
- Stacked branch publication; round 53 (PR #54) still unmerged, so base is
  `grunt/round53-lane-continuity`.

### Limitations
- Text-only model: renders never visually inspected; fixture counts, lamp
  intensities by time of day, post-lamp emissive, and quest state are measured.
- Chrome device emulation only; no physical phone or iOS Safari.
- No Blender/Kaggle work this round (graphics pass deferred to a later round).

### Next steps
1. Publish Round 54 via `/worker/state/outbox/publish.json` (5 fields) and
   `needs-supervision.json`, leaving commit `cd9ea22` checked out, tree clean.
2. Next round candidate: a small gameplay or ambience chunk that reuses the
   lamp-round hook (e.g. a trader who notices the lit lane, or a second
   interactable unlocked by it), or a Blender/Kaggle graphics pass on the lane
   as flagged in the checkpoint instructions.
3. Continue stacked-branch flow; do not wait idle for PR #54 to merge.


---

## Round 55 — the modelled lane lamp and painted iron

**Branch:** `grunt/round55-lane-prop` (off `grunt/round54-lane-lighting`; PR #55
still open, so this is a stacked branch).
**Head:** feature commit + the degradation proof + a clean-tree preview rebuild.

### Current task
Round 55 is complete, committed and verified; it only needs publishing. The lane
post — the fixture the whole lamp round is walked from — is now the same
`assets/lamp.glb` the plaza uses, rotated so its arm hangs the lantern over the
walkway, and its ironwork wears a new painted-iron albedo/normal/roughness
family. The clone that had blacked out the four plaza lanterns is fixed and
pinned by an object-identity check.

### What was built
- `assets/textures/lamp_{albedo,normal,rough}.webp` (512x512, lossless WebP):
  procedural painted iron — dark blue-grey paint, mottled rust, hammered grain,
  chipped edges — from `art/kaggle/lamp_metal_textures.py` (NumPy; CuPy was
  unavailable). Seam ratios albedo [0.652, 0.624], normal [1.278, 1.156],
  rough [0.681, 0.626]; all < 3, so no visible seam.
- `src/assets.js`: `LAMP_TEXTURE_FILES`; `needsOwnMaterial({mutatesMaterial,
  sharedSource})` as a named rule instead of an inline `material.clone()`.
- `src/areas.js`: pure `lampArmFacing(post, target, armReach)` (atan2, normalises
  `-0`), `nearestLaneLantern` (stable tie-break), `LAMP_ARM_REACH = 0.6`.
- `src/world.js`: `upgradeLaneLamp()` hides the procedural post + head, keeps the
  collider and prop position, adds the model as `lane-lamp-model`, rotates it to
  the nearest strand, box-projects UVs onto `iron` meshes only, clones the
  cached material before animating the bulb, reassigns `environment.postLamp`,
  and reports `environment.laneLampAim` plus `assetState.laneLamp/lampMetal`.
  `loadLampAsset()` shares one fetch/parse with the plaza posts.
- `src/manifest.js`, `release-manifest.json`: the three maps are required files.

### Checks actually run
- `npm test` — **479/479 pass** (0 fail) at the committed head, tree clean.
- `npm run test:desktop` (`test:browser`) — **230 PASS, 0 FAIL**, exit 0. New
  checks: the model replaces both stand-ins; the arm lands within 0.01 m of the
  independent argmin and > 0.2 rad from the runner-up; the ironwork carries all
  three maps; the lane head is dark by day, dark at dusk unlit, lit only when the
  round is walked, and dark again after; and the lane bulb does not share the
  plaza bulb's material object.
- Mutation proof: `needsOwnMaterial(sharedSource: true -> false)` fails
  `the lantern bulbs keep their day/night glow` (`intensity: 0`) and
  `the lane lamp does not share the plaza lamp material`
  (`sharesMaterialWithLane: true`); restored, both pass.
- `npm run test:mobile` — **185 pass, 0 fail**, exit 0; profiles 7.5 / 1.5 / 2.3
  / 1.4 fps match the round-52 baseline, so the three maps cost nothing
  measurable.
- Degradation proof, `node scripts/degrade-round55.mjs` — **19/19 pass** across
  three blocked-asset modes: (a) all three lamp maps 404 → a drawn, lightable
  post with `lampMetal: 'flat'`; (b) only the normal map 404 → albedo+roughness
  survive (`['map','roughnessMap']`); (c) the lamp GLB itself 404 → the
  procedural stand-in is drawn instead, the day/night hook stays on the stand-in
  bulb, and the lane bunting lanterns still light. No page errors in any mode.
- Evidence: `artifacts/round55-lane-lamp.png`, `-lit.png`, `-day.png`,
  `-no-maps.png`, `round55-plaza-lamps-intact.png`. The three lit/day/plaza PNGs
  are 1280x720 and were frame-diffed with Pillow (`ImageChops`): lit-vs-day
  181463 differing pixels, lit-vs-plaza 174980, day-vs-plaza 338414, all with
  full-frame bounding boxes — consistent with a global lighting change, which is
  what the phase system is meant to do. They were never looked at; the model is
  text-only.

### Decisions
- Clone a cached material only when it will be mutated (`needsOwnMaterial`), and
  assert object identity in the browser test: two distinct materials can hold
  equal numbers, but only sharing the object reproduces the plaza blackout.
- Aim the single post at the nearest of the three bunting lanterns (ties to the
  first declared) so it hangs over the lane rather than swinging sideways.
- Textures on the ironwork only; glass and bulb keep their authored flat
  materials, because a rusty map on glass reads as a mistake.

### Limitations
- Text-only model: renders are never visually inspected; the evidence PNGs are
  verified to exist and differ where expected, not looked at.
- Chrome device emulation only; no physical phone or iOS Safari.
- No CuPy in the Kaggle environment (NumPy backend).

### Next steps
1. Publish Round 55 via `/worker/state/outbox/publish.json` and
   `needs-supervision.json`, base `grunt/round54-lane-lighting` (PR #55 still
   unmerged), leaving the feature head checked out and the tree clean.
2. Next candidate: a gameplay or ambience hook that pays off the lit lane, or a
   further graphics pass on the market lane.

### Round 55 totals
478 unit + 230 desktop + 185 mobile + 19 degradation = **912 checks**.

---

## Round 56 — The Night Light, a paid-once lamp round, and two closed exploits

**Branch:** `grunt/round55-lane-prop`, feature work on top of `c7c877e`.

### Current task
Round 56 is complete and verified; it only needs publishing. Lighting the lane
now pays off as gameplay:
Oswin offers "The Night Light", a paid lamp round that starts only after the
lane has ever been lit, walks when the player lights it, and settles for six
coins at his stall. Two real bugs found by the reachability proof are fixed:
repeat dusk/dawn cycles minted unlimited coins and Market standing, and a
permanent night-order gate stranded `lanterns:'started'` players who could never
buy oil.

### What was built
- `src/state.js`: `QUEST_ORDER` gains `nightlight`; `night_order` item;
  `nightLightUnlocked` (permanent, keyed on `laneEverLit`/`laneLanternsLit`),
  `startNightLight`, `walkNightLight`, `finishNightLight`
  (`NIGHTLIGHT_REWARD = 6`, +15 Market standing, opinion +2).
- `src/areas.js`: `laneRoundIsPaid` / `laneRoundWasEverWalked`; `lightLaneLanterns`
  pays `LANE_LIGHT_REWARD` only on the first ever round (`laneRoundPaid`),
  always records `laneEverLit`, calls `walkNightLight` so lighting the lane
  after taking the order IS the walk, and returns `{ paid, reward, walked }`.
- `src/dialogue.js`: `debtChoices` helper; the oil-purchase and oil-carrying
  branches are hoisted above the night-light offers so no open Mara order or
  open Oswin debt can ever be buried under an optional offer; settle choice
  runs `finishNightLight` as the player's click, not when building the node.
- `scripts/reachability.mjs`: reports `truncated` and exits 2 when the frontier
  was cut off, so a capped run can no longer be mistaken for a dead-end proof.
- `tests/lane.test.mjs`: relighting asserts `paid:false`, `reward:0`, coins and
  standing unchanged, plus the farm regression test (20 dusk/dawn cycles pay
  exactly what one night pays).
- `tests/playthrough.test.mjs`: searches with a cap above the real graph
  (~33k states) and fails on truncation before trusting any number.
- `scripts/playthrough.mjs` and `scripts/test-round2.mjs` drive the new quest.

### Verification
- Reachability: `explored 33184 states, 33184 distinct`, `truncated: false`,
  `complete states: 112`, `winnable: 33184/33184`, `dead ends: 0`.
- Playthrough script: 7/7 quests done, story complete, epilogue reached.
- Farm probe: 20 dusk/dawn cycles leave coins and trade standing at exactly the
  one-night values; message states the traders already paid.
- Debt probe: with oil bought on promise and the night order open, Oswin still
  offers "Settle the debt" and settling clears the perk.
- Unit suite: **480/480**.
- Desktop browser suite: **230/230**, exit 0, 0 console errors (log
  `/worker/state/logs/r56-desktop.log`). The two real-play checks that had failed
  with 6/7 quests now report `complete:true`, `done:7` and
  `epilogue:"The plaza at closing"` with 3 branches.
- Mobile browser suite: **185/185**, exit 0, 0 console errors across the four
  touch profiles (log `/worker/state/logs/r56-mobile.log`). One run failed
  transiently on a `page.reload` wait and passed on re-run with no stray Chrome.
- Committed preview: rebuilt on the clean tree, digest `7aa2444f...`,
  `workingTreeClean: true`, 72 files.

### Limitations
- Text-only model: no visual claims; lane glow is asserted as rule + emissive
  flags, not inspected.
- The Night Light pays a flat 6 coins; it does not scale with trader standing.
- Only the Market gets a late chore this round; Keepers and Watch have no
  equivalent, so the final act is still Market-shaped.
- All device evidence is Chrome emulation on software rasterisation; a physical
  phone pass remains the largest honest unknown.

### Next steps
1. Publish Round 56 through `grunt_release_prepare` once the `tests`, `browser`
   and `mobile` receipts are collected on one unchanged head.
2. **Graphics priority (owner, active):** make the world substantially richer --
   convincing lighting, stronger materials, better geometry. Use headless Blender
   for new or baked meshes and the free Kaggle GPU for texture work; keep
   CREDITS.md accurate and hold desktop/mobile frame budgets.
3. Give Keepers and Watch a late chore of their own once the visual pass lands,
   so no single faction owns the end game.

## Round 57 — Physical light

### What changed
- **Camera pipeline.** `src/graphics.js` (new) centralises tone mapping: ACES
  Filmic with `outputColorSpace: SRGBColorSpace`, and a per-phase exposure
  (`night 1.9`, `dawn/dusk 1.35`, `day 1.0`) so the previously crushed night
  phases read as night rather than black. `src/main.js` applies it through the
  renderer instead of leaving default linear output.
- **Image-based lighting.** A procedural environment map is generated from the
  same gradient + sun parameters the sky dome uses, filtered through
  `PMREMGenerator`, and cached by phase key. It is deferred until assets are
  ready and rebuilt only when the phase key actually changes —
  `buildEnvironmentMapNow()` and `environmentMapsBuilt()` are exposed on
  `window.amazingAdventure` for testing.
- **Shadows.** Shadow-map resolution now scales with phase (day 2048, dusk
 1536, night 1024) and is capped by the mobile quality tier; bias and
  normalBias were tuned down for the higher exposure so the acne that surfaced
  after ACES is gone.
- **Mobile leak fix.** `scripts/test-mobile.mjs` closes each profile page
  explicitly; the intermittent 30 s `playSession` timeout caused by leaked
  pages is gone.

### Verification (all on `e0a868c`, clean tree)
- Unit suite: **501/501**.
- Desktop browser suite: **230 PASS / 0 FAIL**, exit 0, 0 console errors
  (log `/worker/state/logs/r57-release-browser.log`).
- Mobile browser suite: **185/185**, exit 0, 0 console errors.
- Trusted release receipts on that exact tree — `tests` `def1477c-1049-46c1-a31d-e6f6628f2e5a`,
  `browser` `89d57962-d345-4cb3-a668-5f2b35b5eaa0`,
  `mobile` `63acdf46-7ba0-4367-9c8c-9b4e221bee64` — all `completed`,
  `exitCode 0`, `unchanged: true`, `head e0a868cf92feea85700fd7665f855904c6edcd60`,
  `treeDigest 8f235f0697dfd57082fc09831599564df4e76561ede2c0a2190d29924cd31959`,
  `artifactDigest 9d2b83e6001756b316b9572de5c8e847b30396c49b70a021652f35dee4fabb91`.
- Earlier `browser` receipt `dcaf6cf4` failed exit 1 on the same tree; the
  identical command re-run locally and by the host passed 230/230. It is
  superseded by `89d57962`; no source change was made in between.

### Limitations
- Text-only model: no visual claim. The tone mapping, exposure, environment map
  and shadow changes are asserted as renderer/material *state* plus mutation
  proofs (bake re-runs on a phase change, does not re-run otherwise), not by
  looking at a picture.
- Exposure values are hand-tuned constants; they are not derived from a
  physical light model or measured with a photometer.
- All evidence is Chrome on SwiftShader; frame times are not meaningful and a
  physical phone pass is still the largest honest unknown.
- The sky-dome haze/sun-disc follow-up is **not** in this tree; it lives on
  `grunt/round57b-sky` at `c8dbb23` and ships as round 57b.

### Next steps
1. Publish Round 57 through `grunt_release_prepare` from `e0a868c`.
2. Fold in the finished sky-dome work (`grunt/round57b-sky` → `c8dbb23`).
3. Give Keepers and Watch a late chore of their own so the end game is not
   Market-shaped.

## Round 59 — Cast fidelity

The six plaza NPCs are physically correct in the live scene: they stand on the
cobbles, they face the way they walk, and their role props are attached to the
right pivot. Fixing it required correcting the asset *pipeline*, not the art.

The root cause was a silent one. `art/blender/make_cast.py` positioned props by
setting Blender object locations, and pip's child scale the same way. The GLB
exporter with `export_apply=True` applies *modifiers* only — object transforms
survive as glTF node `translation`/`scale`, and the reader in `src/glb.js` maps
accessor data straight into geometry without ever reading node transforms. So
every authored offset simply vanished at load: lanterns detached from poles,
spear points buried inside shafts, ledger pages inside boards, and pip rendering
full-size. The facing bug was separate but adjacent: the cast was authored with
`dir:-1`, which put the nose along glTF −Z while the game's forward is local +Z
(`rotation.y = atan2(dx, dz)`), so five NPCs walked backwards.

- Nothing in `make_cast.py` may set `location`/`rotation`/`scale` any more; a new
  `transform_check()` asserts every mesh object is transform-free at build time,
  and `src/glb.js` now throws `node transforms not supported (node "<name>")`
  rather than loading a mispositioned figure.
- All offsets are baked into vertices: lantern at the pole top, spear point
  starting exactly at the shaft top (`z ≥ 0.85`) instead of inside it (`0.74`),
  ledger pages proud of the board face.
- pip's sole 0.72 scale now lives only in `buildModelled()`; baking it in Blender
  would have double-scaled the child to 0.518.
- Companions ride their parent's hand pivot (`PropLantern`→`PropPole`,
  `PropSpearTip`→`PropSpear`, `PropLedgerPages`→`PropLedger`), so a swinging arm
  can no longer leave the lantern behind.
- Nose and toes now point along local +Z; `dir` is threaded correctly.

Checks on the committed tree: unit **558/558** (42 new in `tests/cast.test.mjs`),
desktop **230/230 PASS**, mobile **184/184 PASS** across four emulated phone
profiles, and `scripts/evidence-round59.mjs` **31/31 PASS** in a real headless
Chrome page. Boot soles land within 2.4 mm of world y=0 on all five booted
figures, noses stand 0.133–0.170 in front of the head centre, both halves of each
companion prop resolve to the same `LimbArm*` pivot, and the renderer submitted
357 draw calls / 8,942 triangles with all six modelled NPCs parented in.
