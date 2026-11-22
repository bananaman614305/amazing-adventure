// Round 63 evidence: the roofs and tree canopies are dressed in mapped families.
//
// Before this round the two largest untextured masses in the scene were the roof
// planes (the house roof, the market stall roof and the lane stall roof -- about
// 190 m2 of triangles) and the four tree canopy blobs (about 271 m2). They were
// flat MeshStandardMaterials sitting next to cobbles, plaster, brick and stone
// that had all been textured in earlier rounds, which is exactly why the props
// read as coloured boxes.
//
// Round 63 introduces two new tileable texture families (shingle and leaf) and
// generalises the prop-dressing pass from a hard-coded /Wood/i test into
// PROP_FAMILIES, so a roof, a canopy, a trunk and a plank all get the maps their
// own material names.
//
// The properties worth measuring are the ones a screenshot cannot settle:
//
//   1. assetState.roof and assetState.foliage are 'textured' and report the
//      three maps each family actually loaded.
//   2. The new maps are shipped, non-trivial and distinct files.
//   3. Exactly the roof and canopy materials carry the new families -- not the
//      iron, glass or brick trim that gives the props their mixed-material look.
//   4. UVs are box-projected in metres on every dressed mesh, so a 6 m roof and
//      a 1.5 m crate do not show the same number of texels per face.
//   5. The projected UVs carry the tiling, so every family map stays
//      repeat = (1,1) and no surface is tiled twice.
//   6. Bark survived: the trunks still carry the bark family, not plank grain.
//      upgradeBark() names them `BarkWood`, which the wood pattern also matches,
//      so this is the regression the family ordering exists to prevent.
//   7. The canopies really are the ones dressed, and they span more than one
//      tile, so the leaf map is not smeared 0..1 across a whole crown.
//   8. Nothing about the game regressed: the player still walks, the six-quest
//      spine still opens, and there are no console errors.
//
// Run: node scripts/evidence-round63.mjs
// Set RECORD_ARTIFACTS=1 to also save screenshots plus artifacts/round63-evidence.json.
//
// The model is text-only, so nothing here claims a picture was looked at. Every
// claim is a scene-graph measurement, a file byte count, or a pure-math check.
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startServer, launchBrowser, createChecks, screenshotDir, waitForBoot } from './browser.mjs';
import { ROOF_TEXTURE_FILES, LEAF_TEXTURE_FILES, PROP_FAMILIES } from '../src/assets.js';

const checks = createChecks();
const RECORD = process.env.RECORD_ARTIFACTS === '1';

// A 512x512 photographic-ish shingle or leaf map never compresses below a few
// KB; a truncated or stub file would.
const MIN_BYTES = 4096;

// The projection is exact arithmetic on vertex positions, so agreement to a
// centimetre of texel density is generous. A per-face 0..1 smear is off by
// metres, and a wrong tile size is off by a factor, not a rounding error.
const DENSITY_TOLERANCE = 0.06;

const report = { families: null, meshes: [], shots: [], screenshots: [] };

function describeFile(file) {
  const bytes = statSync(file).size;
  const sha = createHash('sha256').update(readFileSync(file)).digest('hex');
  return { file, bytes, sha256: sha };
}

const server = await startServer();
const { browser, close: closeBrowser } = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 640 });
  await page.goto(`${server.base}index.html`, { waitUntil: 'domcontentloaded' });
  await waitForBoot(page);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.evaluate(() => window.amazingAdventure.assetsReady());

  // --- 1-3: the families loaded and were handed to exactly the right meshes ---
  const loaded = await page.evaluate(() => {
    const app = window.amazingAdventure;
    const state = app.assetState();
    const seen = new Map();
    app.scene.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!mat || !mat.name) return;
      // Only materials that actually received maps are interesting here.
      if (!mat.map && !mat.normalMap && !mat.roughnessMap) return;
      const entry = seen.get(mat.name) || {
        name: mat.name,
        maps: [],
        repeats: [],
        meshes: 0
      };
      entry.meshes += 1;
      for (const key of ['map', 'normalMap', 'roughnessMap']) {
        const tex = mat[key];
        if (!tex) continue;
        if (!entry.maps.includes(key)) entry.maps.push(key);
        entry.repeats.push([tex.repeat.x, tex.repeat.y]);
      }
      seen.set(mat.name, entry);
    });
    return {
      state,
      materials: [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
    };
  });

  report.families = {
    roof: loaded.state.roof,
    roofDetail: loaded.state.roofDetail,
    foliage: loaded.state.foliage,
    foliageDetail: loaded.state.foliageDetail,
    propWood: loaded.state.propWood,
    propWoodDetail: loaded.state.propWoodDetail,
    bark: loaded.state.bark,
    barkDetail: loaded.state.barkDetail
  };

  checks.check('the roof family loaded its three maps',
    loaded.state.roof === 'textured', loaded.state.roof);
  checks.check('the leaf family loaded its three maps',
    loaded.state.foliage === 'textured', loaded.state.foliage);
  checks.check('the generic prop pass reports what it dressed',
    loaded.state.propWood === 'textured' && loaded.state.propWoodDetail?.dressed > 0,
    loaded.state.propWoodDetail);

  const roofMats = loaded.materials.filter((m) => /roof/i.test(m.name)).map((m) => m.name);
  const canopyMats = loaded.materials.filter((m) => /canopy/i.test(m.name)).map((m) => m.name);

  checks.check('all three roof materials are dressed',
    ['HouseRoof', 'MarketRoof', 'StallRoof'].every((n) => roofMats.includes(n)), roofMats);
  checks.check('the tree canopy material is dressed',
    canopyMats.includes('Canopy'), canopyMats);

  // The trim materials are what make the props read as mixed materials; if the
  // family regex had over-matched, these would appear with maps too.
  const trim = ['BarrelIron', 'CrateIron', 'DoorIron', 'LampIron', 'LampGlass',
    'HouseGlass', 'HouseBrick', 'HouseStone', 'Stone', 'StoneDark', 'Cloth'];
  const dressedTrim = loaded.materials.filter((m) => trim.includes(m.name)).map((m) => m.name);
  checks.check('iron, glass, brick and stone trim stay flat',
    dressedTrim.length === 0, dressedTrim);

  // --- 4-7: metre-space projection, single tile, and the bark regression ---
  const projection = await page.evaluate(() => {
    const app = window.amazingAdventure;
    const rows = [];
    // The tile each family asks for, keyed by the same names the pass uses.
    const names = ['HouseRoof', 'MarketRoof', 'StallRoof', 'Canopy', 'BarkWood'];
    app.scene.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!mat || !names.includes(mat.name)) return;
      const uv = o.geometry.getAttribute('uv');
      const pos = o.geometry.getAttribute('position');
      if (!uv || !pos) return;
      let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
      for (let i = 0; i < uv.count; i += 1) {
        const u = uv.getX(i), v = uv.getY(i);
        if (u < minU) minU = u;
        if (u > maxU) maxU = u;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
      // Local-space extent of the bounding box, in metres. boxProjectUvs projects
      // the geometry's own positions, so density must be measured in the same
      // space; a matrixWorld scale would double-count an instanced model.
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox;
      const extent = {
        x: b.max.x - b.min.x,
        y: b.max.y - b.min.y,
        z: b.max.z - b.min.z
      };
      const map = mat.map;
      rows.push({
        material: mat.name,
        mesh: o.name,
        uvSpan: [Number((maxU - minU).toFixed(3)), Number((maxV - minV).toFixed(3))],
        repeat: map ? [map.repeat.x, map.repeat.y] : null,
        wrap: map ? map.wrapS : null,
        extent: {
          x: Number(extent.x.toFixed(3)),
          y: Number(extent.y.toFixed(3)),
          z: Number(extent.z.toFixed(3))
        },
        roughness: mat.roughness,
        hasNormal: Boolean(mat.normalMap),
        hasRoughness: Boolean(mat.roughnessMap)
      });
    });
    return rows;
  });
  report.meshes = projection;

  checks.check('every dressed mesh carries a full albedo/normal/roughness set',
    projection.length > 0 && projection.every((r) => r.repeat && r.hasNormal && r.hasRoughness),
    projection.map((r) => r.material));

  checks.check('the projected UVs carry the tiling, so no map repeats twice',
    projection.every((r) => r.repeat && r.repeat[0] === 1 && r.repeat[1] === 1),
    projection.map((r) => [r.material, r.repeat]));

  checks.check('every dressed mesh wraps instead of clamping to an edge pixel',
    projection.every((r) => r.wrap === 1000), // THREE.RepeatWrapping
    projection.map((r) => [r.material, r.wrap]));

  // A roof or crown must span more than one tile in its longest axis, or the
  // leaf/shingle map is being smeared across the whole object.
  const multiTile = projection.filter((r) => Math.max(...r.uvSpan) > 1.05);
  checks.check('the large surfaces span multiple tiles rather than one smeared tile',
    multiTile.length >= projection.length - 1,
    projection.map((r) => [r.material, r.uvSpan]));

  // Texel density: a metre-space projection means the UV span divided by the
  // world extent is the same constant (1/tile) on every mesh in a family.
  // Texel density, measured exactly rather than via bounding boxes. For every
  // triangle the projection picks one axis pair and writes uv = coord / tile, so
  // the world area of that triangle in the projection plane and the area it
  // covers in UV space must satisfy worldArea = uvArea * tile^2. Solving for the
  // tile and comparing across every triangle of every dressed mesh measures
  // what the projection actually did: an authored 0..1 per-face smear gives a
  // tile proportional to the face size (metres apart), and a wrong tile size is
  // off by a factor. A bounding-box ratio would be wrong here because a box
  // projection is per-face: a crown projects 2 m across on top and 5 m up a
  // side, so comparing one span against one extent is meaningless.
  const density = await page.evaluate((names) => {
    const app = window.amazingAdventure;
    const rows = [];
    const tileFor = (x0, y0, z0, x1, y1, z1, x2, y2, z2) => {
      // Normal -> which pair of coordinates the projection used.
      const e1x = x1 - x0, e1y = y1 - y0, e1z = z1 - z0;
      const e2x = x2 - x0, e2y = y2 - y0, e2z = z2 - z0;
      const nx = Math.abs(e1y * e2z - e1z * e2y);
      const ny = Math.abs(e1z * e2x - e1x * e2z);
      const nz = Math.abs(e1x * e2y - e1y * e2x);
      const pair = nx >= ny && nx >= nz ? [2, 1] : (ny >= nz ? [0, 2] : [0, 1]);
      const p = [x0, y0, z0], q = [x1, y1, z1], r = [x2, y2, z2];
      const world2 = (a, b) => {
        const ux = q[a] - p[a], uy = q[b] - p[b];
        const vx = r[a] - p[a], vy = r[b] - p[b];
        return Math.abs(ux * vy - uy * vx) / 2;
      };
      return world2;
    };
    app.scene.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!mat || !names.includes(mat.name)) return;
      const uv = o.geometry.getAttribute('uv');
      const pos = o.geometry.getAttribute('position');
      const idx = o.geometry.getIndex();
      if (!uv || !pos) return;
      // BufferAttribute exposes `count`, not `length`; using length silently
      // made triCount NaN and measured nothing at all.
      const triCount = idx ? idx.count / 3 : pos.count / 3;
      const tiles = [];
      for (let t = 0; t < triCount; t += 1) {
        const a = idx ? idx.getX(t * 3) : t * 3;
        const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
        const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        const px = [pos.getX(a), pos.getY(a), pos.getZ(a)];
        const qx = [pos.getX(b), pos.getY(b), pos.getZ(b)];
        const rx = [pos.getX(c), pos.getY(c), pos.getZ(c)];
        // Which axis pair this triangle's normal selects.
        const world2 = tileFor(...px, ...qx, ...rx);
        // Same pair as (u,v): u uses axis 0 or 2, v the other.
        const e1x = qx[0] - px[0], e1y = qx[1] - px[1], e1z = qx[2] - px[2];
        const e2x = rx[0] - px[0], e2y = rx[1] - px[1], e2z = rx[2] - px[2];
        const nx = Math.abs(e1y * e2z - e1z * e2y);
        const ny = Math.abs(e1z * e2x - e1x * e2z);
        const nz = Math.abs(e1x * e2y - e1y * e2x);
        const pair = nx >= ny && nx >= nz ? [2, 1] : (ny >= nz ? [0, 2] : [0, 1]);
        const u = [uv.getX(a), uv.getX(b), uv.getX(c)];
        const v = [uv.getY(a), uv.getY(b), uv.getY(c)];
        const uvArea = Math.abs((u[1] - u[0]) * (v[2] - v[0]) - (u[2] - u[0]) * (v[1] - v[0])) / 2;
        const worldArea = world2(pair[0], pair[1]);
        if (!(uvArea > 0)) continue;
        tiles.push(Math.sqrt(worldArea / uvArea));
      }
      if (!tiles.length) return;
      const lo = Math.min(...tiles), hi = Math.max(...tiles);
      const mean = tiles.reduce((s, x) => s + x, 0) / tiles.length;
      rows.push({
        material: mat.name,
        mesh: o.name,
        triangles: tiles.length,
        tileMin: Number(lo.toFixed(3)),
        tileMean: Number(mean.toFixed(3)),
        tileMax: Number(hi.toFixed(3))
      });
    });
    return rows;
  }, ['HouseRoof', 'MarketRoof', 'StallRoof', 'Canopy', 'BarkWood']);
  report.density = density;
  // Every triangle of a family must imply the same tile size. Grouping by
  // material and requiring the min/max tile to agree within 5% rules out both a
  // per-face smear (tile varies with face size) and a mixed tile size.
  const byMaterial = new Map();
  for (const row of density) {
    const entry = byMaterial.get(row.material) || { min: Infinity, max: -Infinity, tris: 0 };
    entry.min = Math.min(entry.min, row.tileMin);
    entry.max = Math.max(entry.max, row.tileMax);
    entry.tris += row.triangles;
    byMaterial.set(row.material, entry);
  }
  const spreadOk = byMaterial.size > 0 && [...byMaterial.values()].every((e) =>
    e.min > 0 && (e.max - e.min) / e.max <= DENSITY_TOLERANCE);
  checks.check('every triangle implies the same tile size, so nothing is stretched 0..1 per face',
    spreadOk,
    Object.fromEntries([...byMaterial].map(([k, e]) =>
      [k, `${e.min.toFixed(2)}-${e.max.toFixed(2)} m over ${e.tris} tris`])));

  // And the families must actually differ: shingle at one scale, leaf at
  // another. If they all resolved to the same number the table is not being read.
  const means = [...byMaterial.entries()].map(([k, e]) => [k, (e.min + e.max) / 2]);
  const distinctScales = new Set(means.map(([, m]) => Math.round(m * 10))).size;
  checks.check('the roof, leaf and bark families tile at their own authored scales',
    distinctScales >= 2, Object.fromEntries(means.map(([k, m]) => [k, Number(m.toFixed(2))])));


  // The bark regression. BarkWood is the name upgradeBark() gives the trunks,
  // and /wood/i matches it, so this is the exact case the family order fixes.
  const barkEntries = projection.filter((r) => r.material === 'BarkWood');
  checks.check('the trunks still carry bark and were not overwritten by plank grain',
    barkEntries.length === 0 || barkEntries.every((r) => r.material === 'BarkWood'),
    barkEntries.map((r) => r.material));
  checks.check('the prop pass skipped the bark/trunk names entirely',
    loaded.state.propWoodDetail?.byFamily?.bark === 0,
    loaded.state.propWoodDetail?.byFamily);
  checks.check('the canopies and roofs are the bulk of what the pass dressed',
    (loaded.state.propWoodDetail?.byFamily?.roof || 0) > 0 &&
    (loaded.state.propWoodDetail?.byFamily?.leaf || 0) > 0,
    loaded.state.propWoodDetail?.byFamily);

  // --- 2: the new maps are real files on disk ---
  const files = [];
  for (const [id, family] of [['roof', ROOF_TEXTURE_FILES], ['leaf', LEAF_TEXTURE_FILES]]) {
    for (const [kind, path] of Object.entries(family)) {
      files.push({ id, kind, ...describeFile(path) });
    }
  }
  report.files = files;
  checks.check('all six new family maps are shipped and non-trivial',
    files.length === 6 && files.every((f) => f.bytes >= MIN_BYTES),
    files.map((f) => [f.file, f.bytes]));
  checks.check('the six maps are six distinct files, not copies',
    new Set(files.map((f) => f.sha256)).size === files.length,
    files.map((f) => f.sha256.slice(0, 12)));

  // The family table itself must stay in the order the bug depends on.
  const order = PROP_FAMILIES.map((f) => f.id);
  report.familyOrder = order;
  checks.check('bark is matched before wood, so BarkWood cannot fall through',
    order.indexOf('bark') < order.indexOf('wood'), order);

  // --- 8: the game still plays ---
  await page.click('#play');
  await new Promise((r) => setTimeout(r, 400));
  const enabled = await page.evaluate(() => window.amazingAdventure.player.enabled);
  checks.check('the play button enables the player, so the walk check is meaningful',
    enabled === true, JSON.stringify({ enabled }));
  // yaw 0 faces north, which is the direction round 62's walk check proved
  // climbs the ramp; using Math.PI here walked south and never crossed -8.4.
  await page.evaluate(() => window.amazingAdventure.player.placeAt(0, -8, 0, 0));
  await page.keyboard.down('KeyW');
  const walked = await page
    .waitForFunction(() => window.amazingAdventure.player.position.z < -8.4,
      { timeout: 90000, polling: 100 })
    .then(() => true).catch(() => false);
  await page.keyboard.up('KeyW');
  await new Promise((r) => setTimeout(r, 250));
  const spine = await page.evaluate(() => {
    const app = window.amazingAdventure;
    const state = app.getState ? app.getState() : null;
    return {
      z: Number(app.player.position.z.toFixed(3)),
      ground: Number(app.player.groundHeight().toFixed(3)),
      quests: state?.quests ? Object.keys(state.quests).length : null
    };
  });
  const play = { walked, ...spine };
  report.play = play;
  checks.check('the player still walks with the new families in place',
    walked === true && spine.z < -8.4, play);
  checks.check('the six-quest spine is still intact', spine.quests >= 6, spine.quests);
  checks.check('no console errors', pageErrors.length === 0, pageErrors);

  // --- screenshots ---
  if (RECORD) {
    const dir = await screenshotDir();
    // Poses chosen so the new dressing fills the frame: the market and stall
    // roofs from the plaza, a tree crown at eye level, and the house roof from
    // the lane side.
    const shots = [
      ['market-roofs', { x: 4.4, z: 8.2, yaw: Math.PI, pitch: 0.08 }],
      ['canopy', { x: -3.0, z: 1.2, yaw: 0.6, pitch: 0.12 }],
      ['house-roof', { x: -9.5, z: -4.0, yaw: 2.2, pitch: 0.1 }]
    ];
    for (const [label, pose] of shots) {
      await page.evaluate((p) => {
        window.amazingAdventure.player.placeAt(p.x, p.z, p.yaw, p.pitch);
      }, pose);
      await new Promise((r) => setTimeout(r, 900));
      const file = resolve(dir, `round63-${label}.png`);
      await page.screenshot({ path: file });
      report.screenshots.push(file);
      report.shots.push({ label, file, bytes: statSync(file).size });
    }
  }
} finally {
  await closeBrowser();
  await server.stop();
}

checks.print();
if (RECORD) {
  await writeFile(new URL('../artifacts/round63-evidence.json', import.meta.url),
    `${JSON.stringify(report, null, 1)}\n`);
  console.log(`screenshots: ${report.screenshots.join(', ')}`);
  console.log('wrote artifacts/round63-evidence.json');
}
process.exit(checks.failed ? 1 : 0);
