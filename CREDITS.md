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
| `assets/banner.glb` | `art/blender/make_banner.py` | 4 meshes (BannerCanvas/BannerRod/BannerFinial/BannerStrap), 17.6 KB | Generated for this game; same licence as the game |

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

### Round 34 addition

- `assets/market_stall.glb` — `art/blender/make_market_stall.py`. 72 tris,
  6 meshes, 3 materials (MarketWood/MarketRoof/MarketIron), 7.4 KB. Built from
  the same tapered-post + pitched-awning pattern as the lane stall, authored at
  the larger (4.0 m) counter size and scaled down for the 3.0 m one. Same
  licence as the game (generated, not downloaded).

### Round 37 addition

- `assets/bench.glb` — `art/blender/make_bench.py`. 96 tris, 8 meshes, 2
  materials (BenchWood/BenchIron), 9.4 KB. Built from the same box primitives
  as the previous models: four legs, a slatted seat slab, a backrest slab, and
  two iron brackets. Same licence as the game (generated, not downloaded).

### Round 38 addition

- `assets/notice.glb` — `art/blender/make_notice.py`. 108 tris, 9 meshes, 3
  materials (NoticeWood/NoticeFace/NoticeIron), 10.7 KB. A post, a framed
  board face with rails, a rain cap and two iron bolts. Authored with the long
  side along x and rotated a quarter turn by the game to face west, so the
  loader checks the wider extent against the depth collider. Same licence as
  the game (generated, not downloaded).

### Round 39 addition

- `assets/crates.glb` — `art/blender/make_crates.py`. 120 tris, 10 meshes, 2
  materials (CrateWood/CrateIron), 11.6 KB. One crate: a body, a lid, four
  iron bands on each of two rings. The game places three instances at the
  original positions (two stacked, one offset), matching the market-stall
  pattern of one GLB, many instances. Same licence as the game (generated,
  not downloaded).

### Round 40 additions

- `assets/gate_door.glb` — `art/blender/make_gate_door.py`. 132 tris, 11 meshes,
  2 materials (DoorWood/DoorIron), 12.7 KB. Four planks, two hinge straps, a
  handle and four studs. Parented to the existing door mesh so the open/shut
  lift animation is unchanged. Same licence as the game (generated).
- `assets/textures/cobble_*.png` — `art/kaggle/cobble_textures.py`, run on the
  private Kaggle notebook (Tesla T4, CuPy backend, 12.2 s). Periodic-Voronoi
  cobblestone: albedo/normal/roughness 512x512, seam ratios albedo [0.517, 0.26],
  normal [1.369, 0.518], rough [0.199, 0.115] (all < 3 = no visible seam).
  Fully procedural; no outside images or datasets, so no third-party licence.

### Round 41 addition

- `assets/house.glb` — `art/blender/make_house.py`. 172 tris, 15 meshes, 5
  materials (HouseRoof/HouseBrick/HouseStone/HouseGlass/HouseDoorWood), 17.6 KB.
  Gable roof (two slopes + ridge cap + brick gable infills), chimney with stone
  cap, two framed windows with dark panes, stone door surround with plank door.
  Overlays the procedural brick body, which keeps its Kaggle brick texture.
  Same licence as the game (generated, not downloaded).

### Round 44 additions

- `assets/npc_{mara,oswin,pip,halden,sable,wren}.glb` — `art/blender/make_cast.py`.
  Six humanoid figures, 256 / 288 / 244 / 332 / 352 / 264 tris (1.74 K total),
  20-26 KB each. Built entirely from the script's own box and prism helpers:
  head + nose + hairstyle, torso in role clothing, two arms and two legs authored
  around their joint origins, boots, and a role prop (lantern pole, coin pouch,
  hoop, spear, map, ledger). Pip is exported at 0.72 scale.
  No third-party meshes, textures, rigs or motion data — nothing to license
  beyond the game's own terms. Colours mirror `NPC_DATA` in `src/npcs.js`, so
  the Blender source and the game cannot drift apart silently.


### Round 45 additions

- `assets/textures/grass_*.png` — `art/kaggle/grass_textures.py`, run on the
  private Kaggle notebook (Tesla T4, CuPy backend, 10.7 s). Procedural meadow:
  clumps, blade strokes and dry patches; albedo/normal/roughness 512x512, seam
  ratios albedo [1.183, 0.692], normal [1.096, 0.838], rough [1.258, 0.685]
  (all < 3 = no visible seam). Fully procedural; no outside images or datasets.
- The sky dome and wall texturing are code, not assets: a vertex-colour gradient
  sphere recoloured by the existing day/night table, and the border walls reuse
  the plaza's stone texture family at wall scale.

### Round 46 updates

- `assets/npc_*.glb` re-exported from the same `art/blender/make_cast.py`, now
  with faces and mitten hands. Per character: two eye whites + two irises + a
  mouth (8 boxes, 96 tris) and palm + thumb per hand. Triangle budgets raised to
  560 per character; all six still well under (328-436). Still fully procedural,
  no third-party assets.

### Round 47 updates

- `assets/npc_*.glb` re-exported from the same script: the head assembly (head,
  nose, eyes, mouth, hair) is now authored around a NECK pivot at the origin
  instead of body space, so the game can turn the head toward the player. The
  joint-space set in the bounds check gained the head meshes. Still fully
  procedural, no third-party assets.

### Round 55 updates

- `assets/textures/lamp_*.webp` — generated by `art/kaggle/lamp_metal_textures.py`
  on the private Kaggle notebook (NumPy backend; CuPy unavailable in that
  environment). Procedural painted iron: dark blue-grey paint, mottled rust,
  hammered grain, chipped edges; 512x512 albedo/normal/roughness, seam ratios
  albedo [0.652, 0.624], normal [1.278, 1.156], rough [0.681, 0.626] (all < 3 =
  no visible seam). Shipped as lossless WebP, pixel-identical to the source
  PNGs (verified with Pillow). The lane post also swaps its procedural
  cylinder+sphere stand-in for the round-46-authored `assets/lamp.glb`. Fully
  procedural; no outside images or datasets.

### Round 61 additions

- `assets/textures/plaza_floor_*.webp` — `art/kaggle/plaza_floor_textures.py`,
  run on the private Kaggle notebook (Tesla T4, CuPy backend, 16.6 s including
  the lit preview). Procedural anisotropic periodic-Voronoi flagstone paving:
  three stones across by five courses down, so each slab is about 1.7:1 and
  reads as dressed rectangular paving rather than the lane's round cobbles.
  Albedo/normal/roughness 512x512, seam ratios albedo [0.129, 0.117], normal
  [0.188, 0.138], rough [0.168, 0.149] (all well under 3 = no visible seam).
  Shipped as high-quality lossy WebP (Pillow quality 88, method 6) from the
  Kaggle PNGs: 8.8 KB / 18.2 KB / 11.7 KB against 160 KB / 174 KB / 109 KB for
  the source PNGs. This replaces the plaza floor's reuse of the wall-stone
  maps, so the plaza and the border walls are now visually distinct surfaces.
  Fully procedural; no outside images, datasets or models to license.

### Round 71 additions

- `assets/banner.glb` — `art/blender/make_banner.py`. 4 meshes, 17.6 KB: a subdivided cloth panel (BannerCanvas, 384 tris, fold wave + sagging hem), a painted-iron rod, finials, and hanging straps. Authored around the cloth centre with front facing glTF +Z, so the game sets position only. Footprint measured off the cloth only (rod span is finial overhang). Same licence as the game (generated, not downloaded).
- `assets/textures/banner_{albedo,normal,rough}.webp` — `art/kaggle/banner_textures.py`, run on the private Kaggle notebook (Tesla T4, CuPy backend). Procedural painted canvas: blue ground, gold border band, shield and star device, authored 0..1 UVs, shipped as lossless WebP. Applied by `upgradeBanner()` with `ClampToEdgeWrapping` (deliberately non-tiling so the shield emblem cannot seam); albedo carries its own paint colour so the material tint stays white. Fully procedural; no outside images, datasets or models to license.

### Round 72 additions

- `assets/textures/felt_{albedo,normal,rough}.webp` — `art/kaggle/felt_textures.py`
  (`artifacts/r72/felt_report.json`). Procedural flag-scale felt: short matted
  fibres with no weave grid, generated at 512 x 512 and shipped as lossless WebP
  (albedo 64.4 KB, normal 424.4 KB, rough 56.4 KB). Seam ratios albedo
  [0.004, 0.005], normal [0.048, 0.137], rough [0.002, 0.003] — all far under
  the 3x "no visible seam" threshold. The albedo is neutral-white (mean 0.768,
  range 0.53–0.97) so the authored red/gold dyes survive tinting; the roughness
  map is near-flat (mean 0.810, 0.68–0.95) so felt never catches a sun glint.
  It survives minification to mip 5 (albedo std 0.060 vs 0.070 at mip 0) and only
  collapses at mip 7, which is why the dressing tile is one pennant face wide
  (`BUNTING_TILE_METERS = 0.18`). Dressed by `upgradeBuntingFelt()` on the lane's
  28 `BuntingRed` / `BuntingGold` pennants (0.16 x 0.22 m cones) at a 0.18 m
  tile, metre-space box-projected UVs (9 tris per flag, unindexed, silhouette
  unchanged), anisotropy 8, one cloned material per dye (2, not 28). Fully
  procedural; no outside images, datasets or models to license.

### Round 67 additions

- `assets/textures/cloth_*.webp` — `art/kaggle/cloth_textures.py`, run on the
  private Kaggle notebook (Tesla T4, CuPy backend). Procedural plain-woven
  burlap: two warp threads per unit cell with sin^2 thread crowns, per-thread
  value-noise slack via a lattice-periodic domain warp, albedo from thread
  shading plus fibre speckle, roughness from the same height field, tangent-space
  normal from a Sobel derive of the height. 512x512 albedo/normal/roughness,
  seam ratios albedo [0.058, 0.066], normal [0.164, 0.328], rough [0.012, 0.013]
  (all far under 3 = no visible seam). Shipped as lossless WebP, pixel-identical
  to the source PNGs. Dressed by the round's new `cloth` PROP_FAMILY
  (`keepTint: true` — the map is a neutral grey weave, so the sacks keep their
  burlap brown and the coats keep their authored palette colours) at a 1.2 m
  tile: the three lane `SackCloth` sacks and the modelled cast's 23 `Cloth`
  coat/leg/sleeve meshes, 17.26 m2 of modelled cloth that was flat colour
  before. Fully procedural; no outside images, datasets or models to license.

### Round 67 fixes

- **Box-projection UV seams** — the first curved geometry the prop dresser met
  (the sacks' rims, the coats' sleeves and hems) exposed a latent bug in
  `boxProjectUvs`: it chose the projection plane per *vertex* with
  last-triangle-wins, so a corner shared by triangles whose dominant normal axis
  flips kept only one of the two planes, shearing the triangle on the other side
  (6 of a sack's 36 triangles; worst 3.3x off — implied tile 1.02 m beside
  2.19 m on a 0.56 m sack). The new `boxProjectMesh` core picks the axis per
  *triangle* and splits shared corners into their own slots (returning an
  expanded, unindexed corner list plus a `remap`); `projectBoxGeometry` rebuilds
  the geometry from it, carrying `normal` and `color` along so silhouette and
  shading are untouched, while seam-free meshes keep their original index buffer
  byte for byte. `boxProjectUvs` stays as the seam-free fast path and now throws
  on a seamed mesh instead of shearing it silently. Live scene after the fix:
  0 sheared triangles of 2532 across all dressed families, every triangle rigid
  to within 2% of its own projection plane, all four split meshes unindexed with
  exactly one corner per triangle slot, and the lane sacks tiling uniformly at
  1.2 m with zero spread (was 0.53).
