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

**Round 111 code is in and the desktop suite is green apart from one stale check
that I fixed.** Evidence: `npm run test:browser` against `f28ce75` ran 382/383
with all three round-111 checks passing — doormat coir family, both planter soil
tops on the bespoke soil family, four cast `WoodP` props dressed at 0.78/0 — and
"no console errors" passed. The only failure was a round-97 assertion
('terrace soil stays flat') that round 111 deliberately invalidated; its own
evidence showed 3 maps on each soil top, so I rewrote that check to assert the
dressed contract (`9699a61`). A desktop re-run against `9699a61` is in flight
(log `/tmp/scratchpad/browser2.log`); the mobile suite has not run yet. Code
review subagent died on a 429 from the free pool; the live-scene material audit
is queued behind the running suite. Release channel still reports
`blocked_infrastructure` (host caps reachable commits at 256, branch is 300+
ahead), so no release ids are pending; the PR-only fallback stays the path.

## Next steps
1. Read the `9699a61` desktop re-run result (relaunch if the process died with
   the cycle), then run `npm run test:mobile` once; fix anything red.
2. Review round 111 myself (the subagent review hit 429) — woodprop totality,
   `dressCastWood` map cloning, main.js playtest chain — then start round 112
   from the audit's ranked flat-surface list.
3. Keep the 101-111 release batched for `grunt-release` once the host commit cap
   is lifted; until then keep `publish.json` current per round.
