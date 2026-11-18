# Credits

Round 1 uses no outside art assets. Every mesh, material, colour and light in the
scene is generated in code from Three.js primitives (`src/world.js`, `src/npcs.js`).
The favicon is an inline SVG generated in code (`index.html`). No models,
textures, fonts, sounds or images were downloaded.

## Third-party code

| Package | Version | Source | License |
| --- | --- | --- | --- |
| Three.js | 0.160.0 | https://unpkg.com/three@0.160.0/build/three.module.js | MIT — https://github.com/mrdoob/three.js/blob/master/LICENSE |

Three.js is pinned to exactly 0.160.0 in the import map in `index.html` so the
game loads reproducibly.

The two PNGs in `artifacts/` are browser screenshots of this game, taken with
Playwright for the Round 1 pull request. They are not game assets.

## Round 3 additions

Round 3 adds no outside assets either. Faction names, reputation tiers, the
toll quest and every line of ambient NPC dialogue were written for this game.
The standing panel and overheard-conversation overlay are plain HTML and CSS in
`index.html`.

## Round 2 additions

Round 2 adds no outside art either. The north terrace, ramp, parapet, banner,
key pickup, bench and the new NPC bodies are all built in code from Three.js
primitives (`src/world.js`, `src/npcs.js`). The sky, fog and light colours for
each phase are plain hex values in `src/world.js`.

The dialogue, quests and all text were written for this game.

### Development dependencies (not shipped with the game)

| Package | Version | Source | License |
| --- | --- | --- | --- |
| puppeteer-core | 23.x | https://registry.npmjs.org/puppeteer-core | Apache-2.0 |

`puppeteer-core` is a dev-only dependency used by `scripts/test-round2.mjs` to
drive the host Chrome. The game itself still needs no install, and the browser
test uses the already-present `/opt/google/chrome/chrome` (override with
`CHROME_PATH`) rather than downloading a browser.

The `round2-*.png` and `round3-*.png` files in `artifacts/` are real screenshots
of this game taken by that test. They are not game assets.

## Vendored dependency

`vendor/three.module.min.js` is the official Three.js r160 browser build (MIT
licence, `vendor/THREE-LICENSE.txt`), included so the game can be served as a
self-contained static preview with no CDN or network dependency. It is
third-party code and is not modified.
