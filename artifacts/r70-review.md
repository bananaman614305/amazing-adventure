# Round 70 code review (self-reviewed; worker source unavailable)

## Scope
Uncommitted diff on grunt/round67-cloth @ 4609067: src/assets.js (iron family), src/world.js (upgradeLaneLamp + named materials + prop groups), src/npcs.js (NpcMarker), tests/assets.test.mjs, scripts/audit-materials.mjs, scripts/test-round2.mjs.

## Findings

### High
- none blocking commit. `needsOwnMaterial({ mutatesMaterial: true, sharedSource: true })` is called for every mesh including glass/bulb, but the material is only cloned when the helper says so; the code then assigns `mesh.material = iron` (a freshly created material) only inside the iron branch, so glass/bulb keep their cloned-or-shared original. Verified by lane-lamp test: ironPainted meshes carry maps, LampBulb stays flat. OK.
- Per-mesh material clones: `material.clone()` is used for every mesh before any conditional replacement, so cached plaza materials are not mutated. Good.

### Medium
- `upgradeLaneLamp()` runs `loadMaterialTextures(LAMP_TEXTURE_FILES)` independently of the prop-family fetch in `upgradePropMaps()`. Both hit the browser cache; no second network cost, but there are two in-flight promises and the prop-family `iron` detail and `lampMetal` detail can report different map sets if one races. In practice both await the same cached bytes. Acceptable; documented.
- The generic prop pass dresses every mesh whose material name matches `/iron(?!painted)/i`. The lane lamp's material is named `LampIronPainted`, which the negative lookahead excludes. Verified by assets.test. Good.
- `environment.postLamp` reassignment is present and guarded by `if (bulb)`. Good; applyPhase() target preserved.

### Low
- `LanternHousing`, `LanternBulb`, `BoardFace`, `BoardPaper`, `NoticeFaceLane`, `NpcMarker`, `BuntingRed`, `BuntingGold` are named but match no family, so they stay flat by construction. Good for audit attribution. (`TerraceBanner` retired in round 71 — replaced by the modelled banner.)
- audit-materials: keying by name+colour means genuine shared materials still merge. Hidden-material skip and assetsReady() wait are present. Good.
- test-round2 28h block now asserts iron dressed >= 20 with zero flat iron; flat list must contain glass. Verified against live probe (ironDressed count from probe ~59 in propWood byFamily, but prop group traversal in test counts differently; threshold 20 is conservative).

### Verdict
No blocking defects. Proceed to ship: write evidence-round70.mjs, refresh GRUNT_STATUS.md, commit sources, rebuild dist, commit dist stamp.
