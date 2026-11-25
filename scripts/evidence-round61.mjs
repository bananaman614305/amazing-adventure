// Round 61 evidence: the plaza floor is dressed in its own flagstone paving.
//
// Before this round the plaza disc shared the border wall's stone maps, so the
// two surfaces were the same stone at two scales -- the wall blocks and the
// paving underfoot were literally the same texture. Round 61 generates a
// dedicated flagstone set (three stones across by five courses down, so each
// slab is about 1.7:1) and gives the plaza its own material family.
//
// The claims below are measured on the loaded scene graph and on the shipped
// bytes, not on the generation script's intent:
//
//   1. The plaza floor really is wearing the new maps (assetState.plazaFloor
//      'textured', map + normalMap + roughnessMap all present).
//   2. It is NOT sharing a map object with any other mesh, so the wall cannot
//      be drawing the flagstones.
//   3. The three shipped WebP files are present on disk, non-trivial in size,
//      and byte-distinct from each other and from the wall-stone maps.
//   4. The mapped material is not tinted twice (white base, roughness 1) and
//      repeats at the scale the tiling math predicts for an 18 m disc.
//   5. The frame still draws the plaza with real geometry (draw calls and
//      triangles), so the paving is on screen rather than culled.
//
// Run: node scripts/evidence-round61.mjs
// Set RECORD_ARTIFACTS=1 to also save screenshots plus artifacts/round61-evidence.json.
//
// The model is text-only, so nothing here claims a picture was looked at. Every
// claim is a scene-graph measurement, a file byte count, or a pure-math check.
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { startServer, launchBrowser, createChecks, screenshotDir, waitForBoot } from './browser.mjs';
import { PLAZA_FLOOR_TEXTURE_FILES, STONE_TEXTURE_FILES, plazaFloorMaterialParams } from '../src/assets.js';
import { textureRepeat } from '../src/assets.js';

const checks = createChecks();

// The plaza disc is 9 m radius = 18 m across, tiled at 3 m, so 18/3 = 6 repeats.
const PLAZA_DIAMETER_M = 18;
const TILE_M = 3;
const EXPECTED_REPEAT = textureRepeat(PLAZA_DIAMETER_M, PLAZA_DIAMETER_M, TILE_M).repeatX;

// A 512x512 photographic-ish stone map never compresses below a few KB; a
// truncated or stub file would. This is a floor, not an assertion about quality.
const MIN_BYTES = 4096;

const report = { maps: null, screenshots: [], shots: [] };

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

const server = await startServer();
const { browser, close: closeBrowser } = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.goto(`${server.base}index.html`, { waitUntil: 'domcontentloaded' });
  await waitForBoot(page);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.evaluate(() => window.amazingAdventure.assetsReady());

  const measured = await page.evaluate(() => {
    const app = window.amazingAdventure;
    // The plaza is the only 9 m CircleGeometry mesh the world builds.
    let plaza = null;
    const allMeshes = [];
    app.scene.traverse((o) => {
      if (!o.isMesh) return;
      allMeshes.push(o);
      if (!plaza && o.geometry?.type === 'CircleGeometry' &&
          Math.abs((o.geometry.parameters?.radius ?? 0) - 9) < 0.001) {
        plaza = o;
      }
    });
    if (!plaza) return { found: false };
    let sharers = 0;
    let normalSharers = 0;
    let roughSharers = 0;
    for (const m of allMeshes) {
      if (m === plaza || !m.material) continue;
      if (m.material.map && m.material.map === plaza.material.map) sharers += 1;
      if (m.material.normalMap && m.material.normalMap === plaza.material.normalMap) normalSharers += 1;
      if (m.material.roughnessMap && m.material.roughnessMap === plaza.material.roughnessMap) roughSharers += 1;
    }
    // The border walls are the only 34 m-wide boxes in the world; find them by
    // geometry so this compares the wall's maps against the plaza's directly
    // instead of asking whether the plaza shares a map with itself.
    const walls = allMeshes.filter((m) => {
      const p = m.geometry?.parameters;
      return m.geometry?.type === 'BoxGeometry' && p &&
        (p.width === 34 || p.depth === 34);
    });
    const wallMapShare = walls.filter((m) =>
      m.material?.map && m.material.map === plaza.material.map).length;
    const wallTextured = walls.filter((m) => Boolean(m.material?.map)).length;
    const wallColor = walls[0]?.material?.color?.getHexString?.() ?? null;
    const wallRepeat = walls[0]?.material?.map
      ? [walls[0].material.map.repeat.x, walls[0].material.map.repeat.y] : null;
    const renderInfo = app.renderer.info?.render ?? null;
    return {
      found: true,
      state: app.assetState(),
      repeat: [plaza.material.map.repeat.x, plaza.material.map.repeat.y],
      color: plaza.material.color.getHexString(),
      roughness: plaza.material.roughness,
      metalness: plaza.material.metalness,
      hasMap: Boolean(plaza.material.map),
      hasNormal: Boolean(plaza.material.normalMap),
      hasRough: Boolean(plaza.material.roughnessMap),
      mapPixels: plaza.material.map.image
        ? [plaza.material.map.image.width, plaza.material.map.image.height] : null,
      wrap: [plaza.material.map.wrapS, plaza.material.map.wrapT],
      sharers, normalSharers, roughSharers,
      wallCount: walls.length, wallTextured, wallMapShare, wallRepeat, wallColor,
      drawCalls: renderInfo?.calls ?? null,
      triangles: renderInfo?.triangles ?? null
    };
  });

  checks.check('the plaza floor mesh is present in the loaded scene',
    measured.found === true, JSON.stringify({ found: measured.found }));

  if (measured.found) {
    report.maps = measured;

    checks.check('the plaza floor is textured with maps, not the flat fallback',
      measured.state.plazaFloor === 'textured',
      JSON.stringify({ plazaFloor: measured.state.plazaFloor }));

    checks.check('all three flagstone maps loaded (albedo, normal, roughness)',
      measured.hasMap && measured.hasNormal && measured.hasRough,
      JSON.stringify({ hasMap: measured.hasMap, hasNormal: measured.hasNormal,
                       hasRough: measured.hasRough }));

    checks.check('the albedo map is a real 512x512 image',
      Array.isArray(measured.mapPixels) && measured.mapPixels[0] === 512 &&
      measured.mapPixels[1] === 512,
      JSON.stringify({ mapPixels: measured.mapPixels }));

    checks.check('the flagstone maps are exclusive to the plaza floor',
      measured.sharers === 0 && measured.normalSharers === 0 &&
      measured.roughSharers === 0,
      JSON.stringify({ sharers: measured.sharers,
                       normalSharers: measured.normalSharers,
                       roughSharers: measured.roughSharers }));

    // Both surfaces are stone and both must be textured, so the claim is not
    // "the wall has no map" but "the wall is drawing a different map".
    checks.check('the border walls are textured from their own stone family',
      measured.wallCount >= 3 && measured.wallTextured === measured.wallCount &&
      measured.wallMapShare === 0,
      JSON.stringify({ wallCount: measured.wallCount,
                       wallTextured: measured.wallTextured,
                       wallMapShare: measured.wallMapShare,
                       wallRepeat: measured.wallRepeat,
                       wallColor: measured.wallColor }));

    checks.check('the tiled plaza repeats at the scale the tiling math predicts',
      measured.repeat[0] === EXPECTED_REPEAT && measured.repeat[1] === EXPECTED_REPEAT,
      JSON.stringify({ repeat: measured.repeat, expected: EXPECTED_REPEAT }));

    checks.check('the mapped material is white and fully rough, so it is not tinted twice',
      measured.color === 'ffffff' && measured.roughness === 1 && measured.metalness === 0,
      JSON.stringify({ color: measured.color, roughness: measured.roughness,
                       metalness: measured.metalness }));

    checks.check('the maps wrap and tile rather than clamp at the disc edge',
      measured.wrap[0] === 1000 && measured.wrap[1] === 1000,
      JSON.stringify({ wrap: measured.wrap }));

    checks.check('the frame still draws the plaza geometry',
      measured.drawCalls > 0 && measured.triangles > 1000,
      JSON.stringify({ drawCalls: measured.drawCalls, triangles: measured.triangles }));
  }

  checks.check('no page errors while the textured plaza rendered',
    pageErrors.length === 0, JSON.stringify(pageErrors));

  if (process.env.RECORD_ARTIFACTS) {
    const dir = await screenshotDir();
    // Poses chosen so the paving fills the frame: straight down at the flagstones,
    // a low grazing angle where tiling artifacts are most visible, and the wide
    // establishing shot the plaza has always been reviewed with.
    const shots = [
      ['plaza-floor-look-down', { x: 0, z: 3, yaw: 0, pitch: -0.62 }],
      ['plaza-floor-grazing', { x: -4.2, z: 4.6, yaw: 0.75, pitch: -0.09 }],
      ['plaza-wide', { x: 0, z: 6, yaw: 0, pitch: -0.18 }]
    ];
    for (const [label, pose] of shots) {
      // placeAt() sets yaw and pitch on the player, which owns the camera and
      // re-syncs it every frame; writing camera.rotation directly would be
      // overwritten before the shot.
      await page.evaluate((p) => {
        window.amazingAdventure.player.placeAt(p.x, p.z, p.yaw, p.pitch);
      }, pose);
      await new Promise((r) => setTimeout(r, 700));
      const file = resolve(dir, `round61-${label}.png`);
      await page.screenshot({ path: file });
      report.screenshots.push(file);
      report.shots.push({ label, file, bytes: statSync(file).size });
    }
  }
} finally {
  await closeBrowser();
  await server.stop();
}

// --- Shipped-file claims (Node side, no browser) ---------------------------
const fileHashes = {};
for (const [key, url] of Object.entries(PLAZA_FLOOR_TEXTURE_FILES)) {
  const file = new URL(`../${url}`, import.meta.url);
  let bytes = 0;
  try {
    bytes = statSync(file).size;
    fileHashes[key] = { url, bytes, sha256: sha256(file) };
  } catch {
    fileHashes[key] = { url, bytes: 0, sha256: null };
  }
}
report.files = fileHashes;

checks.check('all three flagstone files are shipped and non-trivial',
  Object.values(fileHashes).every((f) => f.bytes >= MIN_BYTES),
  JSON.stringify(fileHashes));

checks.check('the three flagstone files are byte-distinct from one another',
  new Set(Object.values(fileHashes).map((f) => f.sha256)).size === 3,
  JSON.stringify(Object.fromEntries(
    Object.entries(fileHashes).map(([k, v]) => [k, v.sha256?.slice(0, 12)]))));

const wallHashes = new Set();
for (const url of Object.values(STONE_TEXTURE_FILES)) {
  try {
    wallHashes.add(sha256(new URL(`../${url}`, import.meta.url)));
  } catch { /* a missing wall map is another test's problem */ }
}
checks.check('no flagstone file is a copy of a wall-stone file',
  Object.values(fileHashes).every((f) => !wallHashes.has(f.sha256)),
  JSON.stringify({ flagstones: Object.keys(fileHashes), wallMapsCompared: wallHashes.size }));

const flat = plazaFloorMaterialParams(false);
checks.check('the flat fallback keeps the plaza distinct from the stone wall',
  flat.useMaps === false && flat.color !== 0xb3a892,
  JSON.stringify(flat));

checks.print();
if (checks.failed) process.exitCode = 1;

if (process.env.RECORD_ARTIFACTS) {
  const dir = await screenshotDir();
  const summary = {
    round: 61,
    title: 'plaza floor: a dedicated flagstone paving family',
    generatedAt: new Date().toISOString(),
    expectedRepeat: EXPECTED_REPEAT,
    tileMeters: TILE_M,
    minBytes: MIN_BYTES,
    maps: report.maps,
    files: report.files,
    shots: report.shots.map((s) => ({ label: s.label, file: basename(s.file), bytes: s.bytes })),
    checks: checks.results,
    errors: checks.errors,
    note: 'Every claim here is a scene-graph measurement, a file byte count or a '
      + 'pure-math check. The model is text-only: no screenshot was looked at.'
  };
  await writeFile(resolve(dir, 'round61-evidence.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`screenshots: ${report.screenshots.join(', ')}`);
  console.log(`wrote ${resolve(dir, 'round61-evidence.json')}`);
}
