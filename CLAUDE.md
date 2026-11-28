# Amazing Adventure — working notes for Claude Code

A first-person Three.js adventure game, static files, no build step. Read
`README.md` first for the project's purpose and rules; this file covers only how
to work in the repository day to day.

## Ground rules

- Only Grunt (the `grunt` model in the free pool) writes, tests and reviews game
  code. No other agent edits this repository.
- Free model sources only. No paid models, no extra provider accounts, no other
  coding agents outside the free harness.
- `README.md` § Rules and the sandbox rules in the system prompt are binding.
- Work on a `grunt/*` branch. Never overwrite the original PR #2 branch. Never
  force-push, rewrite history or touch `.git/config`.
- Publication goes only through the trusted release channel (`grunt-release`) or,
  when it reports no channel, the PR-only fallback that writes
  `/worker/state/outbox/publish.json`. No shell `gh` merge, no shell deploy.

## The round pattern

Each round is one playable, tested increment:

1. **Pure module.** Decide everything that can be decided without a GPU in a new
   `src/<thing>.js`: no Three.js, no DOM, no `Math.random`, no clock reads.
   Seeded `mulberry32` if randomness is wanted. Every export must be total —
   never throws, never emits `NaN`, guards non-finite input.
2. **Unit tests.** `tests/<thing>.test.mjs` with `node:test` and
   `node:assert/strict`, holding the module to its documented contract,
   including the guard cases and determinism.
3. **Integration.** `src/world.js` turns those numbers into meshes and lights.
   Keep Three.js knowledge in `world.js` (and the asset modules), never in the
   pure modules.
4. **Manifest.** Add new `src/` files to `REQUIRED_FILES` in `src/manifest.js`
   and re-run `npm run release:manifest`. The unit suite fails if you forget.
5. **Browser checks.** `scripts/test-round2.mjs` drives the real booted game and
   each check prints its evidence object. Name things by `mesh.name` so checks
   find them by name, not by structure.
6. **Dist.** `node scripts/build-preview.mjs` refuses a dirty tree, so commit
   sources first, then rebuild and commit `dist/`. The preview test compares the
   two, so a stale `dist/` fails the unit suite.
7. **Checkpoint.** Update `GRUNT_STATUS.md` (`## Current task`, `## Next steps`).

## Commands

```
node --test tests/*.test.mjs      # unit suite (~45 s) — use this, NOT bare `node --test`
npm test                          # same thing via package.json
npm run test:browser              # headless Chrome, ~5-10 min on this host
npm run test:mobile               # 4 phone profiles, ~15-20 min on this host
npm run release:manifest          # regenerate release-manifest.json
node scripts/build-preview.mjs    # rebuild dist/ (needs a clean tree)
npm start                         # serve 127.0.0.1:8000
```

Bare `node --test` also matches `scripts/test-*.mjs` and would start browsers.
Always name `tests/*.test.mjs`.

This host has **no GPU**: Chrome rasterises in software, and the browser suites
are the most expensive thing in the repository. Run at most **one** browser suite
at a time. Run the full desktop and mobile suites **once per round**, not after
every edit; use the focused unit tests for the inner loop. Do not weaken what a
suite proves to make it cheaper.

## Browser testing

- Chrome at `/opt/google/chrome/chrome`; the harness (`scripts/browser.mjs`)
  already passes a private temporary profile, `--no-sandbox` and
  `--disable-dev-shm-usage`, and binds the game server to `127.0.0.1` on a free
  port. Never connect to another project's debug port.
- Model calls are text-only. Never attach an image to a model call and never
  claim a visual inspection. Evidence comes from DOM/JS/WebGL reads and from
  screenshots that are *saved* and inspected by script, not by eye.
- A slow headless run may let adaptive quality drop to the `low` tier mid-suite.
  If a check depends on a full-tier effect, pin it with
  `api.quality.set('full')` and restore the previous tier and adaptive flag
  afterwards.

## Public API surface (`window.amazingAdventure`)

Used by the browser suites, so changing a name breaks them:

- `api.quality.set(tier)` — force `'full' | 'low'` and pin it.
- `api.quality.setAdaptive(bool)` — resume/pause adaptive switching.
- `api.quality.tier`, `api.quality.adaptive` — current state.
- `api.setClock(seconds)`, `api.getClock()` — drive the day/night cycle.
- `api.environment` — the world's handle object: `sun`, `moon`, `hemi`, `fill`,
  `paintHorizon`, `paintClouds`, `updateClouds(dt)`, `updateCloudDapple()`,
  `setSunBase(v)`, `cloudDim`, `phase`, `quality`, `setQuality(tier)`.
- `api.scene`, `api.npcs`, `api.assetsReady()`, `api.state`.

## Conventions

- **Determinism.** Any procedural sky, scatter or silhouette is seeded and
  pure. Two identical runs must produce byte-identical buffers.
- **Comment the why.** Every module opens with a header explaining why it
  exists; every non-obvious decision carries the reason, not a restatement of
  the code. The house style is prose, not bullets-for-their-own-sake.
- **Naming.** Meshes that tests or later rounds must find get a stable
  `mesh.name` (`sky-stars`, `sky-moon`, `sky-clouds`, `sky-horizon`,
  `LampBulb`, `LanternBulb`, `BuntingRed`, `TerraceBanner` …).
- **Quality tiers.** `full` vs `low` (`src/quality.js`). Anything new that costs
  a draw call, a light or a per-frame loop must be dropped on `low`, and
  `setQuality` must re-derive its state from the current phase so a tier flip
  never leaves a light or mesh in the wrong state.
- **Economy.** Any new sink must be `hasItem`-guarded, one-time, no restock, no
  dawn reset.
- **Assets.** Every outside asset is listed in `CREDITS.md` with its source and
  licence. Blender assets are authored by `art/blender/*.py` and exported with
  `/worker/state/grunt-blender --python art/blender/make_<name>.py`; keep the
  scripts in the repo. Kaggle work is a standalone script under `art/kaggle/`.

## Layout

```
index.html            entry point
src/main.js           loop, input, HUD wiring
src/world.js          the scene: meshes, lights, materials, assets
src/*.js              pure decision modules (unit-tested)
scripts/              test harnesses, manifest writer, preview builder
tests/                node:test unit suites
art/blender/*.py      Blender asset scripts (GLB in assets/)
art/kaggle/*.py       Kaggle texture/render jobs
assets/               shipped GLB models and WebP textures
vendor/               vendored three.module.min.js (r160, MIT)
dist/                 built preview, restamped each round (generated)
```

`src/world.js` is large on purpose: it is the one place that knows Three.js, and
splitting it would scatter the lighting and material story across files. Pure
logic belongs in its own module instead.
