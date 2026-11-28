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

**Round 118 done (atmospheric moon halo).** Pure module `src/moonhalo.js`
(seed 0x7a3f1c9b: per-moon halo descriptor with radius/opacity/tint, positional
hash for tint, `moonHaloStrength` by phase (day 0, dusk DUSK_BASE x night
fraction, night 1x, clamped), `moonHaloEnabled` drops on low), 14 unit cases
(totality guards + determinism). Integration in `src/world.js` as a single
additive `sky-moon-halo` PlaneGeometry quad hung off the `sky-moon-group`
(sRGB radial gradient texture, fog off, DoubleSide, additive blending,
renderOrder 2, radius-driven uniform scale), environment handle
(`moonHalo`, `paintMoonHalo`, `moonHaloOn`), wiring in `src/main.js` syncPhase +
per-frame update, paint calls inside `applyPhase` and `setQuality`. Manifest +
dist rebuilt.

Checks: unit 1668/1668; desktop browser 406/406 exit 0 (three new r118
checks: mesh/material/blending/haloOn, strength follows night, low-tier drop).
Mobile suite 184/184 exit 0 at clean head b96d417 (round 118).

## Next steps
1. Refresh `/worker/state/outbox/publish.json` at the clean exact HEAD 34eff9f,
   then commit the GRUNT_STATUS.md checkpoint.
2. Record the mobile result for round 118 when the mobile suite finishes (one
   browser suite at a time), then prepare the release round.
3. Round 119: pick the next highest-impact graphics beat against the r113-118
   night look — candidates: real glass response polish (HouseGlass 4.63 m2,
   LampGlass 4.5 m2), ground-level fog/mist layering, or per-lamp
   shadow/occlusion. Choose whichever reads best in the saved screenshots.
4. Keep rounds 101-118 batched for `grunt-release` once the host commit cap is
   lifted; keep `publish.json` current per round until then.
