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

## Graphics rounds 28–33: Blender models and Kaggle-generated textures

All art below was generated for this game by Grunt. Nothing was downloaded from
an asset store, stock site or third-party model repository. The generation
scripts are committed under `art/` so every asset is reproducible.

### Models (headless Blender, `art/blender/`)

| Asset | Script | Contents | Licence |
| --- | --- | --- | --- |
| `assets/fountain.glb` | `art/blender/make_fountain.py` | 332 tris, 12 meshes, 3 materials (Stone/StoneDark/Water), 22.6 KB | Generated for this game; same licence as the game |
| `assets/barrel.glb` | `art/blender/make_barrel.py` | 3 meshes (body + 2 hoops), 15.9 KB | Generated for this game; same licence as the game |
| `assets/stall.glb` | `art/blender/make_stall.py` | 96 tris, 8 meshes, 3 materials, 9.8 KB | Generated for this game; same licence as the game |
| `assets/lamp.glb` | `art/blender/make_lamp.py` | 96 tris, 6 meshes (post/base/arm/housing/cap/bulb), 8.9 KB | Generated for this game; same licence as the game |

Blender runs headless via `/worker/state/grunt-blender`. Meshes are built
explicitly with `bmesh` (no boolean operations), flat-shaded, exported as GLB
with Y-up conversion. Footprints are asserted against the game's colliders in
each script. The GLB loader (`src/glb.js`) was written for this game.

### Textures (Kaggle dual-T4 notebook, `art/kaggle/`)

| Family | Script | Files | GPU / runtime | Licence |
| --- | --- | --- | --- | --- |
| stone | `art/kaggle/stone_textures.py` | `assets/textures/stone_{albedo,normal,rough}.png` | Tesla T4, CuPy, ~11 s | Generated for this game; same licence as the game |
| wood + brick | `art/kaggle/wood_brick_textures.py` | `assets/textures/wood_*.png`, `assets/textures/brick_*.png` | Tesla T4, CuPy | Generated for this game; same licence as the game |
| plaster | `art/kaggle/plaster_textures.py` | `assets/textures/plaster_{albedo,normal,rough}.png` | Tesla T4, CuPy, ~10 s | Generated for this game; same licence as the game |

All textures are fully procedural (tileable value noise, explicit block/plank
patterns, Sobel normals), 512×512, no external inputs. Each job measures
seam ratios (wrap difference ÷ interior neighbour difference) and asserts they
are below 3. The stone job's T4 output was verified byte-identical to a local
NumPy run. PNGs were re-encoded losslessly with PIL (`optimize=True`) in
round 31; pixel content is unchanged.

Every model and texture is an **upgrade, never a dependency**: if a fetch
fails, a decoder is missing, or a model exceeds its collider, the game keeps
its procedural stand-in or flat colour and stays fully playable.
