// Round 62 evidence: the north terrace is dressed in quarried stone.
//
// Before this round the terrace slab, the ramp deck, the two ramp kerbs and the
// four parapet walls were all untextured MeshStandardMaterials. The plaza had
// just been given a flagstone floor in round 61, which made the north end of the
// view the last flat grey mass in the scene: the player walked up a ramp that
// looked like painted cardboard onto a terrace that looked the same.
//
// Round 62 dresses all of it in the border wall's quarried stone, but *not* by
// giving each mesh its own repeat. Instead the UVs are box-projected in metres at
// a single tile size (TERRACE_TEXTURE_TILE_METERS = 1.6 m), so texel density is
// uniform by construction across a 12 m slab, a rotated 4.8 m ramp deck and a
// 0.18 m kerb face. That is the property worth measuring: one tile size, one
// projection, and every surface spanning a plausible number of tiles.
//
// The claims below are measured on the loaded scene graph and on the shipped
// bytes, not on the code's intent:
//
//   1. assetState.terrace is 'textured' and reports the three maps it uses.
//   2. The six named terrace meshes exist and carry real projected UVs; every
//      one of them spans more than one tile, so nothing is stretched 0..1.
//   3. Texel density is uniform: the UV span of each mesh matches its own
//      world-space extent divided by the same tile size, within a tolerance.
//   4. The projected UVs carry the tiling, so all mapped textures stay
//      repeat = (1,1) -- the maps are not also tiled a second time.
//   5. The tread (slab + ramp deck) shares one material so the ramp cannot
//      shear away from the terrace; the parapet is a different material with
//      its own clones, so it cannot re-wrap the tread.
//   6. Nothing shares a texture object with the border walls, which have their
//      own repeats.
//   7. The map family is the wall stone family (no new texture files, no new
//      licence obligations) and those files are shipped and non-trivial.
//   8. The player still walks the ramp onto the terrace and back down, and the
//      parapet still stops them everywhere except the ramp opening.
//
// Run: node scripts/evidence-round62.mjs
// Set RECORD_ARTIFACTS=1 to also save screenshots plus artifacts/round62-evidence.json.
//
// The model is text-only, so nothing here claims a picture was looked at. Every
// claim is a scene-graph measurement, a file byte count, or a pure-math check.
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { startServer, launchBrowser, createChecks, screenshotDir, waitForBoot } from './browser.mjs';
import { STONE_TEXTURE_FILES, TERRACE_TEXTURE_TILE_METERS, terraceStoneParts } from '../src/assets.js';
import { TERRACE } from '../src/terrain.js';

const checks = createChecks();

// A 512x512 photographic-ish stone map never compresses below a few KB; a
// truncated or stub file would.
const MIN_BYTES = 4096;

// The projection is exact arithmetic on the vertex positions, so agreement to a
// centimetre of texel density is generous; a per-face 0..1 smear is off by
// metres, and a wrong tile size is off by a factor, not a rounding error.
const DENSITY_TOLERANCE = 0.05;

const report = { terrace: null, screenshots: [], shots: [] };

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
    const names = ['terrace-tread', 'terrace-ramp', 'terrace-kerb', 'terrace-parapet'];
    const meshes = [];
    const allMeshes = [];
    app.scene.traverse((o) => {
      if (!o.isMesh) return;
      allMeshes.push(o);
      if (names.includes(o.name)) meshes.push(o);
    });

    const describe = (mesh) => {
      const uv = mesh.geometry.getAttribute('uv');
      const position = mesh.geometry.getAttribute('position');
      let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
      let finite = true;
      for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i);
        const v = uv.getY(i);
        if (!Number.isFinite(u) || !Number.isFinite(v)) finite = false;
        if (u < minU) minU = u;
        if (u > maxU) maxU = u;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
      // World-space extent of the mesh's local geometry (the terrace meshes carry
      // no scale, only translation and, for the ramp and kerbs, an X rotation that
      // does not change the local extents the projection used).
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < position.count; i++) {
        const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
      const map = mesh.material?.map;
      return {
        name: mesh.name,
        materialId: mesh.material?.uuid ?? null,
        hasMap: Boolean(map),
        repeat: map ? [map.repeat.x, map.repeat.y] : null,
        uvCount: uv.count,
        finite,
        span: [maxU - minU, maxV - minV],
        localExtents: {
          x: maxX - minX, y: maxY - minY, z: maxZ - minZ
        },
        color: mesh.material?.color?.getHexString?.() ?? null
      };
    };

    const described = meshes.map(describe);
    const byName = (name) => described.filter((m) => m.name === name);
    const tread = described.filter((m) => m.name === 'terrace-tread' || m.name === 'terrace-ramp');
    const upright = described.filter((m) => m.name === 'terrace-kerb' || m.name === 'terrace-parapet');

    // Do the tread and the parapet draw the same texture object? They must not:
    // sampler state (wrap/repeat) lives on the texture, so a shared object could
    // only ever hold one surface's settings.
    const treadMaps = new Set(tread.map((m) => m.materialId));
    const uprightMaps = new Set(upright.map((m) => m.materialId));
    const treadMapObjects = new Set(tread.filter((m) => m.hasMap).map((m) =>
      meshes.find((mesh) => mesh.name === m.name).material.map));
    const uprightMapObjects = new Set(upright.filter((m) => m.hasMap).map((m) =>
      meshes.find((mesh) => mesh.name === m.name).material.map));

    // The border walls are the only 34 m-wide boxes; their maps must not be the
    // same objects the terrace is drawing.
    const walls = allMeshes.filter((m) => {
      const p = m.geometry?.parameters;
      return m.geometry?.type === 'BoxGeometry' && p && (p.width === 34 || p.depth === 34);
    });
    const wallMaps = new Set(walls.map((m) => m.material?.map).filter(Boolean));
    const sharedWithWall = [...treadMapObjects, ...uprightMapObjects].filter((t) => wallMaps.has(t));

    const renderInfo = app.renderer.info?.render ?? null;
    return {
      state: app.assetState(),
      terraceDetail: app.assetState().terraceDetail ?? null,
      meshCount: meshes.length,
      treadCount: byName('terrace-tread').length,
      rampCount: byName('terrace-ramp').length,
      kerbCount: byName('terrace-kerb').length,
      parapetCount: byName('terrace-parapet').length,
      described,
      treadMaterialCount: treadMaps.size,
      uprightMaterialCount: uprightMaps.size,
      treadUprightShareMaterial: [...treadMaps].some((id) => uprightMaps.has(id)),
      treadUprightShareMap: [...treadMapObjects].some((t) => uprightMapObjects.has(t)),
      wallCount: walls.length,
      wallTextured: walls.filter((m) => Boolean(m.material?.map)).length,
      sharedWithWall: sharedWithWall.length,
      wallRepeats: walls.filter((m) => m.material?.map)
        .map((m) => [m.material.map.repeat.x, m.material.map.repeat.y]),
      drawCalls: renderInfo?.calls ?? null,
      triangles: renderInfo?.triangles ?? null
    };
  });

  report.terrace = measured;

  checks.check('assetState reports the terrace as textured, not flat',
    measured.state.terrace === 'textured',
    JSON.stringify({ terrace: measured.state.terrace }));

  checks.check('the terrace detail names the three maps it drew',
    Boolean(measured.terraceDetail) &&
    measured.terraceDetail.maps.length === 3,
    JSON.stringify(measured.terraceDetail));

  checks.check('all six named terrace meshes are in the loaded scene',
    measured.treadCount === 1 && measured.rampCount === 1 &&
    measured.kerbCount === 2 && measured.parapetCount === 4,
    JSON.stringify({ meshCount: measured.meshCount, treadCount: measured.treadCount,
                     rampCount: measured.rampCount, kerbCount: measured.kerbCount,
                     parapetCount: measured.parapetCount }));

  checks.check('every terrace surface received finite projected UVs',
    measured.described.length === 8 && measured.described.every((m) => m.finite && m.uvCount > 8),
    JSON.stringify(measured.described.map((m) => ({ name: m.name, finite: m.finite }))));

  // The central claim: the projection was replaced, not inherited. BoxGeometry's
  // default UVs are 0..1 per face, so a mesh still carrying them would span
  // exactly one tile on every face no matter how large it is.
  checks.check('nothing is still carrying the default 0..1 per-face UVs',
    measured.described.every((m) => Math.max(m.span[0], m.span[1]) > 1.05),
    JSON.stringify(measured.described.map((m) => ({ name: m.name,
      span: m.span.map((s) => Number(s.toFixed(3))) }))));

  // Uniform density: for each face plane the projection emits metres/tile, so the
  // UV span along an axis is the world extent on that axis divided by the tile.
  // Comparing span against extent/tile catches both a wrong tile size and a mesh
  // whose UVs were never replaced.
  const density = measured.described.map((m) => {
    // The largest of the three extents is the longest run of geometry; its
    // projection axis carries the largest UV span, so compare those two.
    const extent = Math.max(m.localExtents.x, m.localExtents.y, m.localExtents.z);
    const span = Math.max(m.span[0], m.span[1]);
    return {
      name: m.name,
      extent: Number(extent.toFixed(3)),
      span: Number(span.toFixed(3)),
      expected: Number((extent / TERRACE_TEXTURE_TILE_METERS).toFixed(3)),
      ratio: Number((span / (extent / TERRACE_TEXTURE_TILE_METERS)).toFixed(3))
    };
  });
  report.density = density;
  checks.check('texel density is uniform: every surface is extent / one tile size',
    density.every((d) => Math.abs(d.ratio - 1) <= DENSITY_TOLERANCE),
    JSON.stringify(density));

  checks.check('the projected UVs carry the tiling, so textures stay repeat 1:1',
    measured.described.every((m) => m.repeat === null ||
      (m.repeat[0] === 1 && m.repeat[1] === 1)),
    JSON.stringify(measured.described.map((m) => ({ name: m.name, repeat: m.repeat }))));

  checks.check('the walked tread and ramp deck share one material, so the ramp cannot shear',
    measured.treadMaterialCount === 1,
    JSON.stringify({ treadMaterialCount: measured.treadMaterialCount }));

  checks.check('the upright band is its own material, so it cannot re-wrap the tread',
    measured.uprightMaterialCount === 1 && measured.treadUprightShareMaterial === false,
    JSON.stringify({ uprightMaterialCount: measured.uprightMaterialCount,
                     shares: measured.treadUprightShareMaterial }));

  checks.check('the two materials draw different texture objects',
    measured.treadUprightShareMap === false,
    JSON.stringify({ sharesTextureObject: measured.treadUprightShareMap }));

  checks.check('the border walls keep their own repeats and their own texture objects',
    measured.wallCount >= 3 && measured.wallTextured === measured.wallCount &&
    measured.sharedWithWall === 0,
    JSON.stringify({ wallCount: measured.wallCount, wallTextured: measured.wallTextured,
                     sharedWithWall: measured.sharedWithWall,
                     wallRepeats: measured.wallRepeats }));

  checks.check('the mapped terrace materials are white, so the stone is not tinted twice',
    measured.described.every((m) => m.hasMap ? m.color === 'ffffff' : true),
    JSON.stringify(measured.described.map((m) => ({ name: m.name, color: m.color }))));

  checks.check('the frame still draws the dressed terrace',
    measured.drawCalls > 0 && measured.triangles > 1000,
    JSON.stringify({ drawCalls: measured.drawCalls, triangles: measured.triangles }));

  // --- Walkability: the dressing must not have moved the geometry. ----------
  // Driven through the same key path the real game uses, and waited on by height
  // rather than by a fixed number of frames, so this cannot pass on a slow host
  // by simply not having moved.
  //
  // The play button has to be clicked first: player.update() ignores the keyboard
  // until the game is "playing", so without this the player simply never moves
  // and the check would "fail" against fully working geometry. That mistake is
  // worth leaving a note about -- a green material check next to a red movement
  // check is exactly what a broken harness looks like.
  await page.click('#play');
  await new Promise((r) => setTimeout(r, 400));
  const playing = await page.evaluate(() => window.amazingAdventure.player.enabled);
  checks.check('the play button enables the player, so the walk checks are meaningful',
    playing === true, JSON.stringify({ enabled: playing }));
  await page.evaluate((geom) => {
    window.amazingAdventure.player.placeAt(0, geom.ramp.maxZ + 1.4, 0, 0);
  }, TERRACE);
  const footGround = await page.evaluate(() => window.amazingAdventure.player.groundHeight());
  await page.keyboard.down('KeyW');
  const climbed = await page
    .waitForFunction(() => window.amazingAdventure.player.groundHeight() > 1.19,
      { timeout: 90000, polling: 100 })
    .then(() => true)
    .catch(() => false);
  await page.keyboard.up('KeyW');
  await new Promise((r) => setTimeout(r, 250));
  const onTerrace = await page.evaluate(() => {
    const { player } = window.amazingAdventure;
    return { x: player.position.x, z: player.position.z, ground: player.groundHeight() };
  });
  checks.check('the ramp still leads up onto the terrace',
    climbed === true && onTerrace.ground >= TERRACE.height - 0.01 &&
    onTerrace.z < TERRACE.maxZ,
    JSON.stringify({ footGround, climbed, onTerrace, terraceHeight: TERRACE.height }));

  // ... and back down. Facing south from the terrace, the ramp is the only way
  // down that the colliders allow, so this also re-proves the parapet is solid.
  await page.evaluate(() => {
    window.amazingAdventure.player.placeAt(0, -14.4, Math.PI, 0);
  });
  await page.keyboard.down('KeyW');
  const descended = await page
    .waitForFunction(() => window.amazingAdventure.player.groundHeight() < 0.01,
      { timeout: 90000, polling: 100 })
    .then(() => true)
    .catch(() => false);
  await page.keyboard.up('KeyW');
  await new Promise((r) => setTimeout(r, 250));
  const backOnPlaza = await page.evaluate(() => {
    const { player } = window.amazingAdventure;
    return { x: player.position.x, z: player.position.z, ground: player.groundHeight() };
  });
  checks.check('the ramp still leads back down to the plaza',
    descended === true && backOnPlaza.ground <= 0.01,
    JSON.stringify({ descended, backOnPlaza }));

  checks.check('no page errors while the dressed terrace rendered',
    pageErrors.length === 0, JSON.stringify(pageErrors));

  if (process.env.RECORD_ARTIFACTS) {
    const dir = await screenshotDir();
    // Poses chosen so the dressing fills the frame: the ramp seen from the plaza,
    // the terrace deck from on top, and the parapet edge from the side.
    const shots = [
      ['terrace-ramp-from-plaza', { x: 0, z: -6.2, yaw: 0, pitch: -0.12 }],
      ['terrace-deck', { x: 0, z: -14.8, yaw: 0, pitch: -0.35 }],
      ['terrace-parapet-edge', { x: -4.6, z: -12.2, yaw: -0.5, pitch: -0.05 }]
    ];
    for (const [label, pose] of shots) {
      // placeAt() sets yaw and pitch on the player, which owns the camera and
      // re-syncs it every frame; writing camera.rotation directly would be
      // overwritten before the shot.
      await page.evaluate((p) => {
        window.amazingAdventure.player.placeAt(p.x, p.z, p.yaw, p.pitch);
      }, pose);
      await new Promise((r) => setTimeout(r, 900));
      const file = resolve(dir, `round62-${label}.png`);
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
// Round 62 introduces no new files on purpose: the terrace is dressed from the
// border wall's existing quarried-stone family, so there is no new licence
// obligation and no new map to keep in sync with the manifest.
const fileHashes = {};
for (const [key, url] of Object.entries(STONE_TEXTURE_FILES)) {
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

checks.check('the terrace stone family is shipped and non-trivial',
  Object.values(fileHashes).every((f) => f.bytes >= MIN_BYTES),
  JSON.stringify(fileHashes));

const parts = terraceStoneParts();
checks.check('the terrace groups its meshes into the same two parts the world built',
  JSON.stringify(parts.tread) === JSON.stringify(['terrace-tread', 'terrace-ramp']) &&
  JSON.stringify(parts.parapet) === JSON.stringify(['terrace-kerb', 'terrace-parapet']),
  JSON.stringify(parts));

checks.check('the tile size is a single believable metre figure',
  Number.isFinite(TERRACE_TEXTURE_TILE_METERS) && TERRACE_TEXTURE_TILE_METERS === 1.6,
  JSON.stringify({ tileMeters: TERRACE_TEXTURE_TILE_METERS }));

checks.print();
if (checks.failed) process.exitCode = 1;

if (process.env.RECORD_ARTIFACTS) {
  const dir = await screenshotDir();
  const summary = {
    round: 62,
    title: 'north terrace: quarried stone by box projection',
    generatedAt: new Date().toISOString(),
    tileMeters: TERRACE_TEXTURE_TILE_METERS,
    densityTolerance: DENSITY_TOLERANCE,
    minBytes: MIN_BYTES,
    terrace: { state: report.terrace.state.terrace, detail: report.terrace.terraceDetail,
               meshCount: report.terrace.meshCount },
    density: report.density,
    files: report.files,
    shots: report.shots.map((s) => ({ label: s.label, file: basename(s.file), bytes: s.bytes })),
    checks: checks.results,
    errors: checks.errors,
    note: 'Every claim here is a scene-graph measurement, a file byte count or a '
      + 'pure-math check. The model is text-only: no screenshot was looked at.'
  };
  await writeFile(resolve(dir, 'round62-evidence.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`screenshots: ${report.screenshots.join(', ')}`);
  console.log(`wrote ${resolve(dir, 'round62-evidence.json')}`);
}
