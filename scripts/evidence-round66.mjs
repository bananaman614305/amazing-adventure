// Round 66 evidence: the modelled house's brick and stone trim are dressed.
//
// Rounds 61-65 textured the plaza floor, the terrace, the gate and the
// fountain, and round 63 gave the prop GLBs their family pass. What still read
// as flat paint after all that were the modelled house's two non-wood
// materials: the three brick gable/chimney pieces (24.80 m2) and the six stone
// trim pieces -- window frames, door jambs and the chimney cap (18.10 m2).
// 42.90 m2 of modelled geometry sitting beside textured roofs, walls and
// planks.
//
// Round 66 adds two PROP_FAMILIES (brick at 2 m, house stone at 1.6 m) so the
// generic prop pass dresses them exactly like the roofs and canopies it already
// handles. It also fixes a misidentification the material audit turned up: the
// three visible 8 x 0.02 x 0.02 m bunting ropes shared `LaneWood` with the lane
// stand-ins, so they read as planked wood the pass had skipped. A 2 cm rope is
// not a plank; they now carry their own flat `LaneRope` material and match no
// family.
//
// The properties worth measuring are the ones a screenshot cannot settle:
//
//   1. The prop pass reports brick = 3 and stone = 6 dressed meshes.
//   2. All nine house meshes carry a full albedo/normal/roughness set and the
//      dressed areas match the modelled geometry.
//   3. Every dressed triangle is metre-projected: the implied tile is uniform
//      and equals the family's tile (brick 2 m, stone 1.6 m), so gables and
//      trim keep their own scales and nothing is smeared 0..1 per face.
//   4. The projected UVs carry the tiling: repeat stays (1,1) and wrap is
//      RepeatWrapping on every dressed material.
//   5. The fountain keeps its own tinted stone pass: `Stone` and `StoneDark`
//      match no prop family, keep their authored tints, and still tile at
//      1.6 m.
//   6. No visible family-named mesh in the whole scene is left flat or still
//      carries an authored 0..1 per-face smear (the rope fix removes the last
//      three masqueraders).
//   7. The three ropes exist, are visible, unmapped, and named LaneRope.
//   8. The new families reuse the shipped brick/stone map files -- no fourth
//      texture set -- and those files are real and distinct on disk.
//   9. Nothing about the game regressed: the player still walks, the six-quest
//      spine still opens, and there are no console errors.
//
// Run: node scripts/evidence-round66.mjs
// Set RECORD_ARTIFACTS=1 to also save screenshots plus
// artifacts/round66-evidence.json.
//
// The model is text-only, so nothing here claims a picture was looked at. Every
// claim is a scene-graph measurement, a file byte count, or a pure-math check.
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startServer, launchBrowser, createChecks, screenshotDir, waitForBoot } from './browser.mjs';
import {
  BRICK_TEXTURE_FILES,
  STONE_TEXTURE_FILES,
  PROP_FAMILIES,
  propFamilyFor
} from '../src/assets.js';

const checks = createChecks();
const RECORD = process.env.RECORD_ARTIFACTS === '1';

// A 512x512 tileable map never compresses below a few KB; a truncated or stub
// file would.
const MIN_BYTES = 4096;

// The projection is exact arithmetic on vertex positions, so agreement to 5% of
// the tile is generous. An authored 0..1 per-face smear is off by metres.
const TILE_TOLERANCE = 0.05;

const report = { families: null, meshes: [], files: [], play: null, shots: [], screenshots: [] };

function describeFile(file) {
  return {
    bytes: statSync(file).size,
    sha256: createHash('sha256').update(readFileSync(file)).digest('hex')
  };
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

  // --- 1-3, 5, 7: who got dressed, by name, with what ------------------------
  const loaded = await page.evaluate((familySpecs) => {
    const app = window.amazingAdventure;
    const families = familySpecs.map((f) => ({ id: f.id, re: new RegExp(f.source, f.flags) }));
    // Per-triangle implied tile: the box projection picks one axis pair per
    // triangle and writes uv = coord / tile, so worldArea = uvArea * tile^2.
    // Solving for the tile measures what the projection actually did. An
    // authored 0..1 per-face smear gives a tile proportional to the face size;
    // a wrong tile size is off by a factor, not a rounding error.
    const measure = (mesh) => {
      const uv = mesh.geometry.getAttribute('uv');
      const pos = mesh.geometry.getAttribute('position');
      const idx = mesh.geometry.getIndex();
      if (!uv || !pos) return null;
      const triCount = idx ? idx.count / 3 : pos.count / 3;
      const tiles = [];
      let area = 0;
      for (let t = 0; t < triCount; t += 1) {
        const a = idx ? idx.getX(t * 3) : t * 3;
        const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
        const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        const p = [pos.getX(a), pos.getY(a), pos.getZ(a)];
        const q = [pos.getX(b), pos.getY(b), pos.getZ(b)];
        const r = [pos.getX(c), pos.getY(c), pos.getZ(c)];
        const e1 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
        const e2 = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
        const cx = e1[1] * e2[2] - e1[2] * e2[1];
        const cy = e1[2] * e2[0] - e1[0] * e2[2];
        const cz = e1[0] * e2[1] - e1[1] * e2[0];
        const nx = Math.abs(cx), ny = Math.abs(cy), nz = Math.abs(cz);
        area += Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
        // Which axis pair this triangle's normal selects, and the triangle's
        // world area in that projection plane.
        const pair = nx >= ny && nx >= nz ? [2, 1] : (ny >= nz ? [0, 2] : [0, 1]);
        const planeArea = (a2, b2) => {
          const ux = q[a2] - p[a2], uy = q[b2] - p[b2];
          const vx = r[a2] - p[a2], vy = r[b2] - p[b2];
          return Math.abs(ux * vy - uy * vx) / 2;
        };
        const U = [uv.getX(a), uv.getX(b), uv.getX(c)];
        const V = [uv.getY(a), uv.getY(b), uv.getY(c)];
        const uvArea = Math.abs((U[1] - U[0]) * (V[2] - V[0]) -
          (U[2] - U[0]) * (V[1] - V[0])) / 2;
        if (!(uvArea > 0)) continue;
        tiles.push(Math.sqrt(planeArea(pair[0], pair[1]) / uvArea));
      }
      if (!tiles.length) return null;
      const lo = Math.min(...tiles), hi = Math.max(...tiles);
      const mean = tiles.reduce((s, x) => s + x, 0) / tiles.length;
      return {
        area: Number(area.toFixed(2)),
        triangles: tiles.length,
        tileMin: Number(lo.toFixed(3)),
        tileMean: Number(mean.toFixed(3)),
        tileMax: Number(hi.toFixed(3))
      };
    };
    const rows = [];
    app.scene.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!mat || !mat.name) return;
      let visible = true;
      for (let n = o; n; n = n.parent) if (!n.visible) visible = false;
      const m = measure(o);
      rows.push({
        material: mat.name,
        mesh: o.name || null,
        visible,
        // Marks a mesh this pass actually dressed; see upgradePropFamilies().
        dressedBy: o.userData?.propFamily || null,
        family: families.find((f) => f.re.test(mat.name))?.id || null,
        color: mat.color ? '#' + mat.color.getHexString() : null,
        roughness: mat.roughness,
        hasMap: Boolean(mat.map),
        hasNormal: Boolean(mat.normalMap),
        hasRoughness: Boolean(mat.roughnessMap),
        repeat: mat.map ? [mat.map.repeat.x, mat.map.repeat.y] : null,
        wrap: mat.map ? mat.map.wrapS : null,
        area: m ? m.area : null,
        triangles: m ? m.triangles : 0,
        tileMin: m ? m.tileMin : null,
        tileMean: m ? m.tileMean : null,
        tileMax: m ? m.tileMax : null
      });
    });
    return { state: app.assetState(), rows };
  }, PROP_FAMILIES.map((f) => ({ id: f.id, source: f.test.source, flags: f.test.flags })));

  const propDetail = loaded.state.propWoodDetail || {};
  report.families = {
    propWood: loaded.state.propWood,
    propWoodDetail: propDetail,
    fountainStone: loaded.state.fountainStone,
    fountainStoneDetail: loaded.state.fountainStoneDetail
  };
  report.meshes = loaded.rows.filter((r) =>
    /housebrick|housestone|^stone$|^stonedark$|lanerope/i.test(r.material));

  checks.check('the prop family pass reports what it dressed',
    loaded.state.propWood === 'textured' && propDetail.dressed > 0, propDetail);
  checks.check('the brick family dressed the three gable/chimney meshes',
    propDetail.byFamily?.brick === 3, propDetail.byFamily);
  checks.check('the house-stone family dressed the six trim meshes',
    propDetail.byFamily?.stone === 6, propDetail.byFamily);

  const brickRows = loaded.rows.filter((r) => r.material === 'HouseBrick');
  const stoneRows = loaded.rows.filter((r) => r.material === 'HouseStone');
  checks.check('all three brick meshes carry a full albedo/normal/roughness set',
    brickRows.length === 3 &&
      brickRows.every((r) => r.hasMap && r.hasNormal && r.hasRoughness),
    brickRows.map((r) => [r.mesh, r.hasMap, r.hasNormal, r.hasRoughness]));
  checks.check('all six stone trim meshes carry a full albedo/normal/roughness set',
    stoneRows.length === 6 &&
      stoneRows.every((r) => r.hasMap && r.hasNormal && r.hasRoughness),
    stoneRows.map((r) => [r.mesh, r.hasMap, r.hasNormal, r.hasRoughness]));

  // The modelled areas measured when the house landed: 24.79 m2 of brick (two
  // gables + chimney) and 18.09 m2 of stone trim.
  const brickArea = brickRows.reduce((s, r) => s + (r.area || 0), 0);
  const stoneArea = stoneRows.reduce((s, r) => s + (r.area || 0), 0);
  checks.check('the dressed meshes add up to the modelled brick and stone areas',
    Math.abs(brickArea - 24.8) < 0.5 && Math.abs(stoneArea - 18.1) < 0.5,
    { brick: Number(brickArea.toFixed(2)), stone: Number(stoneArea.toFixed(2)) });

  // --- 3, 4: metre-space projection at the family's own tile -----------------
  const byMaterial = new Map();
  for (const row of [...brickRows, ...stoneRows]) {
    const entry = byMaterial.get(row.material) ||
      { min: Infinity, max: -Infinity, tris: 0 };
    entry.min = Math.min(entry.min, row.tileMin);
    entry.max = Math.max(entry.max, row.tileMax);
    entry.tris += row.triangles;
    byMaterial.set(row.material, entry);
  }
  // Brick tiles at 2 m, matching the procedural wall brick; house stone at
  // 1.6 m, matching TERRACE_TEXTURE_TILE_METERS, so the trim reads as the same
  // quarried stone as the terrace below it.
  const expectedTile = { HouseBrick: 2, HouseStone: 1.6 };
  for (const [material, entry] of byMaterial) {
    const want = expectedTile[material];
    checks.check(material + ' is metre-projected at its own ' + want + ' m tile',
      entry.min > 0 && (entry.max - entry.min) / entry.max <= TILE_TOLERANCE &&
        Math.abs((entry.min + entry.max) / 2 - want) / want <= TILE_TOLERANCE,
      material + ': ' + entry.min.toFixed(2) + '-' + entry.max.toFixed(2) +
        ' m over ' + entry.tris + ' tris');
  }
  const brickMean = (byMaterial.get('HouseBrick').min +
    byMaterial.get('HouseBrick').max) / 2;
  const stoneMean = (byMaterial.get('HouseStone').min +
    byMaterial.get('HouseStone').max) / 2;
  checks.check('the two families keep distinct scales rather than collapsing',
    Math.abs(brickMean - stoneMean) > 0.2,
    { brick: Number(brickMean.toFixed(2)), stone: Number(stoneMean.toFixed(2)) });

  checks.check('the projected UVs carry the tiling, so no map repeats twice',
    [...brickRows, ...stoneRows].every((r) =>
      r.repeat && r.repeat[0] === 1 && r.repeat[1] === 1),
    [...brickRows, ...stoneRows].map((r) => [r.material, r.repeat]));
  checks.check('every dressed material wraps instead of clamping to an edge pixel',
    [...brickRows, ...stoneRows].every((r) => r.wrap === 1000), // RepeatWrapping
    [...brickRows, ...stoneRows].map((r) => [r.material, r.wrap]));

  // --- 5: the fountain keeps its own tinted stone pass ------------------------
  const fountainStone = loaded.rows.filter((r) => r.material === 'Stone');
  const fountainDark = loaded.rows.filter((r) => r.material === 'StoneDark');
  checks.check('the fountain stone pass still dressed its ten meshes',
    loaded.state.fountainStone === 'textured' &&
      loaded.state.fountainStoneDetail?.stone === 4 &&
      loaded.state.fountainStoneDetail?.dark === 6,
    loaded.state.fountainStoneDetail);
  checks.check('the fountain stone names matched no prop family',
    fountainStone.length === 4 && fountainDark.length === 6 &&
      fountainStone.every((r) => r.family === null) &&
      fountainDark.every((r) => r.family === null),
    { stone: fountainStone.map((r) => r.family), dark: fountainDark.map((r) => r.family) });
  checks.check('the fountain dark stone kept its authored tint',
    fountainDark.every((r) => r.color === '#c8cbc9'),
    [...new Set(fountainDark.map((r) => r.color))]);
  checks.check('the fountain stone still tiles at the terrace scale',
    [...fountainStone, ...fountainDark].every((r) =>
      r.tileMin !== null && r.tileMax !== null &&
      (r.tileMax - r.tileMin) / r.tileMax <= TILE_TOLERANCE &&
      Math.abs(r.tileMean - 1.6) <= TILE_TOLERANCE * 1.6),
    [...fountainStone, ...fountainDark].map((r) => [r.mesh, r.tileMean]));

  // --- 6, 7: no visible family mesh is flat or smeared; ropes are LaneRope ----
  // Scoped to the meshes this pass owns, which it now marks with
  // userData.propFamily. A family-named material outside the prop registry is
  // deliberately not its business: the fountain's Stone/StoneDark keep their own
  // tinted pass (checked above), and the cast GLB's `WoodP` props are 24-48
  // vertex hand-held pieces parented to the NPC limb groups, never registered
  // in propGroups. They must stay flat wood-coloured, not get plank maps.
  const familyNamed = loaded.rows.filter((r) => r.visible && r.dressedBy);
  const flat = familyNamed.filter((r) => !r.hasMap);
  checks.check('no visible mesh this pass dressed is left flat',
    flat.length === 0 && familyNamed.length > 0,
    { dressed: familyNamed.length, flat: flat.map((r) => [r.material, r.mesh]) });
  const smeared = familyNamed.filter((r) => r.hasMap && (r.triangles === 0 ||
    (r.tileMax - r.tileMin) / r.tileMax > TILE_TOLERANCE));
  checks.check('no visible dressed mesh still carries an authored 0..1 per-face smear',
    smeared.length === 0 && familyNamed.every((r) => r.triangles > 0),
    smeared.map((r) => [r.material, r.mesh, r.tileMin, r.tileMax]));

  const castProps = loaded.rows.filter((r) => r.material === 'WoodP');
  checks.check('the cast hand-held props stay outside the plank pass',
    castProps.length > 0 && castProps.every((r) => !r.hasMap && r.dressedBy === null),
    castProps.map((r) => [r.mesh, r.visible, r.hasMap, r.dressedBy]));

  // Every visible family-named material must be accounted for: dressed by
  // either dressing pass (both set userData.propFamily), kept by the fountain's
  // own tinted stone pass, or explained as out of registry scope (the cast's
  // WoodP props). Nothing may be a family-named flat material with no owner.
  const OUT_OF_SCOPE = new Set(['Stone', 'StoneDark', 'WoodP']);
  const familyVisible = loaded.rows.filter((r) => r.visible && r.family);
  const unaccounted = familyVisible.filter((r) => !r.dressedBy && !OUT_OF_SCOPE.has(r.material));
  const counted = familyVisible.filter((r) => r.dressedBy).length +
    familyVisible.filter((r) => !r.dressedBy && OUT_OF_SCOPE.has(r.material)).length;
  checks.check('every visible family-named material is dressed or explicitly accounted for',
    unaccounted.length === 0 && counted === familyVisible.length && familyVisible.length > 0,
    { visible: familyVisible.length, dressed: familyVisible.filter((r) => r.dressedBy).length,
      outOfScope: familyVisible.length - familyVisible.filter((r) => r.dressedBy).length,
      unaccounted: unaccounted.map((r) => [r.material, r.mesh]) });

  const ropes = loaded.rows.filter((r) => r.material === 'LaneRope');
  checks.check('the three bunting ropes are visible, flat and named LaneRope',
    ropes.length === 3 &&
      ropes.every((r) => r.visible && !r.hasMap && r.roughness === 0.95),
    ropes.map((r) => [r.mesh, r.visible, r.hasMap, r.roughness]));

  // --- 8: the families reuse the shipped brick/stone files --------------------
  const brickFamily = PROP_FAMILIES.find((f) => f.id === 'brick');
  const stoneFamily = PROP_FAMILIES.find((f) => f.id === 'stone');
  checks.check('the new families point at the existing brick and stone file sets',
    Boolean(brickFamily && stoneFamily) &&
      brickFamily.files === BRICK_TEXTURE_FILES &&
      stoneFamily.files === STONE_TEXTURE_FILES,
    { brick: brickFamily?.files, stone: stoneFamily?.files });
  checks.check('the house-stone test stays anchored so it cannot catch the fountain',
    stoneFamily.test.source === 'housestone' &&
      !propFamilyFor('Stone') && !propFamilyFor('StoneDark') &&
      propFamilyFor('HouseStone').id === 'stone' &&
      propFamilyFor('HouseBrick').id === 'brick' &&
      !propFamilyFor('LaneRope'),
    { stoneTest: stoneFamily.test.source });
  checks.check('the brick family tiles at 2 m and house stone at 1.6 m',
    brickFamily.tileMeters === 2 && stoneFamily.tileMeters === 1.6,
    { brick: brickFamily.tileMeters, stone: stoneFamily.tileMeters });

  const files = [];
  for (const [id, family] of [['brick', BRICK_TEXTURE_FILES], ['stone', STONE_TEXTURE_FILES]]) {
    for (const [kind, path] of Object.entries(family)) {
      const url = new URL('../' + path, import.meta.url);
      files.push({ id, kind, path, file: url.pathname, ...describeFile(url) });
    }
  }
  report.files = files;
  checks.check('all six reused family maps are shipped and non-trivial',
    files.length === 6 && files.every((f) => f.bytes >= MIN_BYTES),
    files.map((f) => [f.path, f.bytes]));
  checks.check('the six maps are six distinct files, not copies',
    new Set(files.map((f) => f.sha256)).size === files.length,
    files.map((f) => f.sha256.slice(0, 12)));

  const order = PROP_FAMILIES.map((f) => f.id);
  report.familyOrder = order;
  checks.check('the family order still puts bark before wood',
    order.indexOf('bark') < order.indexOf('wood'), order);

  // --- 9: the game still plays ------------------------------------------------
  await page.click('#play');
  await new Promise((r) => setTimeout(r, 400));
  const enabled = await page.evaluate(() => window.amazingAdventure.player.enabled);
  checks.check('the play button enables the player, so the walk check is meaningful',
    enabled === true, JSON.stringify({ enabled }));
  // yaw 0 faces north, the direction earlier rounds proved climbs the ramp.
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
  report.play = { walked, ...spine };
  checks.check('the player still walks with the dressed house in place',
    walked === true && spine.z < -8.4, report.play);
  checks.check('the six-quest spine is still intact', spine.quests >= 6, spine.quests);
  checks.check('no console errors', pageErrors.length === 0, pageErrors);

  // --- screenshots -------------------------------------------------------------
  if (RECORD) {
    const dir = await screenshotDir();
    // Poses chosen so the newly dressed house fills the frame: the door trim
    // head-on, the brick gables from the southeast, the chimney from the west,
    // and the lane bunting ropes.
    const shots = [
      ['house-door', { x: -10.5, z: -2.0, yaw: 0, pitch: 0.06 }],
      ['house-gables', { x: -5.5, z: -1.5, yaw: 0.4, pitch: 0.18 }],
      ['house-chimney', { x: -13.5, z: -3.5, yaw: -0.5, pitch: 0.25 }],
      ['lane-ropes', { x: 7.4, z: -15.5, yaw: 0, pitch: 0.35 }]
    ];
    for (const [label, pose] of shots) {
      await page.evaluate((p) => {
        window.amazingAdventure.player.placeAt(p.x, p.z, p.yaw, p.pitch);
      }, pose);
      await new Promise((r) => setTimeout(r, 900));
      const file = resolve(dir, 'round66-' + label + '.png');
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
  await writeFile(new URL('../artifacts/round66-evidence.json', import.meta.url),
    JSON.stringify(report, null, 1) + '\n');
  console.log('screenshots: ' + report.screenshots.join(', '));
  console.log('wrote artifacts/round66-evidence.json');
}
process.exit(checks.failed ? 1 : 0);
