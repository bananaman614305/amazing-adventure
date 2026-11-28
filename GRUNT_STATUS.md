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

**Round 115 done (wet-pavement reflection streaks).** Pure module
`src/wetstreak.js` (seeded per-lamp streak: position/length/width/angle/opacity,
strength by phase, dropped on `low`), unit tests `tests/wetstreak.test.mjs` (12
cases), integration in `src/world.js` as the `wet-streak` InstancedMesh
(additive, `vertexColors = true`, sRGB gradient texture, `WETSTREAK_LIFT`),
environment handle (`wetStreak`, `wetStreakCount`, `paintWetStreak`,
`wetStreakOn`), wiring in `src/main.js` at both syncPhase and the per-frame
update, and — new this round — all three paint calls from rounds 113/114/115
(`paintWindowBleed`, `paintRoomGlow`, `paintWetStreak`) now also run inside
`applyPhase()`, closing a gap where a phase change relied only on main.js.
`paintWetStreak` is re-derived in `setQuality`. Self-review clean (vertexColors
set before instance colour writes; texture `colorSpace` sRGB).

Checks: unit 1619/1619; desktop browser 396/396 exit 0 (three new r115 checks
green: mesh/material/count, night strength vs zero by day, low-tier drop).
Mobile suite running this cycle as background task `brw64q24f` — result to be
recorded next checkpoint. Dist rebuilt and committed at `913d5d0`; browser
checks committed at `609ee92`.

## Next steps
1. Round 116: interior room-glow colour variation per window (so lit rooms do
   not all glow the same warm tone), or real glass response on the largest flat
   surfaces (HouseGlass 4.63 m², LampGlass 4.5 m²). Pick whichever reads best
   against the r113-115 night look.
2. Record the mobile result for round 115 when `brw64q24f` finishes, then
   refresh `/worker/state/outbox/publish.json` at the clean exact HEAD.
3. Keep rounds 101-115 batched for `grunt-release` once the host commit cap is
   lifted; keep `publish.json` current per round until then.
