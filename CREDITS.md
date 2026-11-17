# Credits

Rounds 1 and 2 use no outside art assets. Every mesh, material, colour and light in
the scene is generated in code from Three.js primitives (`src/world.js`, `src/npcs.js`,
`src/items.js`). The favicon is an inline SVG generated in code (`index.html`). No
models, textures, fonts, sounds or images were downloaded. All names, roles,
dialogue and quest text were written for this game.

## Third-party code

| Package | Version | Source | License |
| --- | --- | --- | --- |
| Three.js | 0.160.0 | https://unpkg.com/three@0.160.0/build/three.module.js | MIT — https://github.com/mrdoob/three.js/blob/master/LICENSE |

Three.js is pinned to exactly 0.160.0 in the import map in `index.html` so the
game loads reproducibly.

The PNGs in `artifacts/` are browser screenshots of this game, taken with
Playwright for the Round 1 and Round 2 pull requests. They are not game assets.
