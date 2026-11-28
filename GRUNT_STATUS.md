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

**Round 111 is closed out and self-review found a real deployment bug, now
fixed.** Desktop suite passed 383/383 at `9699a61` (all three round-111 checks
green, no console errors). Reviewing the round myself (the review subagent had
silently died) turned up something no test could see: the doormat and soil
texture maps added in round 111 — and the boot leather maps referenced since
round 82 — were in `assets/` and named by `src/`, but missing from
`REQUIRED_FILES`, so `dist/` shipped without them. The boot-time load 404s, the
family reports `flat`, and the game still plays: a silent fidelity loss.
Fixed in `9b7d8e2` (nine paths added to `src/manifest.js`) plus a new
non-vacuous guard in `tests/manifest.test.mjs` that derives every
`assets/`/`vendor/` reference from `src/*.js` and fails if `REQUIRED_FILES` omits
it, and `b971cea` (dist rebuilt with the maps). Unit suite 1557/1557 on the new
head. The mobile suite passed 184/184 at `b971cea` (exit 0, four phone profiles,
no console errors: iPhone 13 portrait 9.1fps, Pixel 7 1.2, iPhone SE 1.9, iPhone
13 landscape 1.3). Round 111 is closed across both device classes.
Release channel is still `blocked_infrastructure` (host caps reachable commits
at 256; branch is 300+ ahead), no release ids pending; PR-only fallback path.
**Round 112 (night light depth) is implemented and committed; desktop browser
suite running after r112 clock fix.** Both pure halves are in: `src/lightspill.js` (warm ground
pools under lit panes, seeded, per-phase strength via `spillStrength`) and
`contactShadowYaw` in `src/contactshadows.js` (ellipse aims away from the
phase sun). Integration in `src/world.js` builds `window-spill`
(InstancedMesh, additive, `vertexColors` for per-pool opacity, low-tier drop,
per-phase opacity) placed from the projected window faces, and re-aims the
contact decals from `PHASE_LOOKS.sunPosition` on phase change. `src/main.js`
paints the spill per frame alongside `updateWindows`. Browser checks
(`r112` block in `scripts/test-round2.mjs`) cover: spill decals exist and
match window count, strength follows night (day hidden), low-tier drop, and
contact yaw day vs dusk differ. Unit suite 1580/1580 on `f0e7437`; dist
rebuilt. The first desktop run exposed that `api.setClock(22)` is still day
phase; corrected to `api.setClock(120)` (night) and `api.setClock(30)` (day)
in `scripts/test-round2.mjs`. Desktop suite rerun in progress (PID 73).
Release channel still `blocked_infrastructure`, PR-only fallback.
Pending: desktop + mobile suites, self-review, publish.json update.

## Next steps
1. Read the desktop browser result (background `bhgw98l9v`), fix any r112
   failure, then run `npm run test:mobile`; self-review the round and update
   `publish.json`.
2. Keep the 101-111 release batched for `grunt-release` once the host commit cap
   is lifted; until then keep `publish.json` current per round.
