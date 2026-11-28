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

**Round 114 is implemented (pure + integration + browser checks) but not yet
verified.** Warm interior glow behind lit windows: pure module
`src/roomglow.js` (seeded mulberry32; `roomGlowStrength`, `roomGlowEnabled`,
`roomGlowDecals` — one glow per lit pane, sized from pane warmth, jittered
centre, wider-than-tall rectangle, per-glow opacity) plus integration in
`src/world.js` (`room-glow` InstancedMesh, normal blend, recessed behind the
pane, low-tier drop, per-phase opacity) wired through `src/main.js` and the
environment handle. Browser checks (r114 block in `scripts/test-round2.mjs`)
cover: halos exist count=12, strength follows night, drops on low tier. Unit
suite 1607/1607 (tests 1607, pass 1607) on the pre-dist head. Dist not yet
rebuilt for round 114.

## Next steps
1. Rebuild dist for round 114 and commit it (tree must be clean for the build).
2. Run desktop browser suite on the round-114 head; confirm all three r114 checks
   pass and accept the known adaptive-resolution timing flake if it recurs.
3. Run mobile suite once on the round-114 head.
4. Self-review round 114 (especially vertexColors on the room-glow material and
   the recess direction vs the pane's face normal).
5. Refresh publish.json for round 114 at the committed HEAD and checkpoint.
