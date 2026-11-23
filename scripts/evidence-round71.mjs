// Round 71 evidence: the modelled terrace banner.
//
// Round 70 closed the painted-iron pass; round 71 replaces the last large flat
// plane on the terrace -- the 5.28 m2 `TerraceBanner` -- with the modelled
// cloth+rod GLB: a subdivided cloth whose fold wave only pushes outward; a hem
// that sags at the centre and lifts toward the rod ends; four hanging tabs; and
// a painted-iron rod with finials. The cloth is dressed by its own procedural
// painted-canvas maps at authored 0..1 UVs (deliberately non-tiling so the
// shield emblem cannot seam), and the rod reuses the lane lantern's painted-iron
// maps so the fixture and the ironwork read as one workshop.
//
// Nothing here claims a picture was looked at. Every check is a live scene-graph
// measurement after a real boot, or a pure check on the same helpers the game
// calls.
//
// Run: node scripts/evidence-round71.mjs
// Set RECORD_ARTIFACTS=1 to save screenshots and artifacts/round71-evidence.json.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ClampToEdgeWrapping, RepeatWrapping } from 'three';
import { startServer, launchBrowser, createChecks, screenshotDir, waitForBoot } from './browser.mjs';
import { BANNER_MODEL_SIZE, BANNER_TEXTURE_FILES, propFamilyFor } from '../src/assets.js';

const checks = createChecks();
const RECORD = process.env.RECORD_ARTIFACTS === '1';
const report = { banner: null, audit: null, shots: [] };

// ---------------------------------------------------------------------------
// Pure checks on the helpers the world calls.
// ---------------------------------------------------------------------------
{
  // The authored size the loader validates against and the world positions with.
  checks.check('the banner is authored 2.4 m wide',
    BANNER_MODEL_SIZE.width === 2.4, `${BANNER_MODEL_SIZE.width}`);
  checks.check('the banner is authored 1.1 m tall',
    BANNER_MODEL_SIZE.height === 1.1, `${BANNER_MODEL_SIZE.height}`);
  checks.check('the rod overhang is recorded',
    BANNER_MODEL_SIZE.rodOverhang === 0.21, `${BANNER_MODEL_SIZE.rodOverhang}`);

  // A painted panel must never be swept into a tiling family: a repeat would cut
  // a seam through the shield. This is the tripwire against that refactor.
  checks.check('the canvas is not dressed by the prop registry',
    propFamilyFor('BannerCanvas') === null, `${propFamilyFor('BannerCanvas')?.id}`);
  for (const name of ['BannerRod', 'BannerFinial', 'BannerStrap']) {
    checks.check(`${name} is not in a prop family`,
      propFamilyFor(name) === null, `${propFamilyFor(name)?.id}`);
  }

  // The maps are one set of three, applied by the banner's own path.
  checks.check('the banner ships albedo, normal and roughness',
    JSON.stringify(Object.keys(BANNER_TEXTURE_FILES).sort())
      === JSON.stringify(['map', 'normalMap', 'roughnessMap']),
    Object.keys(BANNER_TEXTURE_FILES).join(','));
  report.pure = true;
}

// ---------------------------------------------------------------------------
// Live checks: real boot, real materials, real scene graph.
// ---------------------------------------------------------------------------
const server = await startServer();
const { browser, close: closeBrowser } = await launchBrowser();
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});

try {
  await page.goto(server.base, { waitUntil: 'domcontentloaded' });
  await waitForBoot(page);

  await page.waitForFunction(() => {
    const state = window.amazingAdventure?.assetState?.();
    return state && state.banner === 'model';
  }, { timeout: 120000, polling: 250 });

  const live = await page.evaluate(({ wrapRepeat, wrapClamp }) => {
    const api = window.amazingAdventure;
    api.scene.updateMatrixWorld(true);

    const group = api.scene.getObjectByName('banner-model');
    const meshes = [];
    if (group) {
      group.traverse((o) => {
        if (!o.isMesh) return;
        meshes.push({
          name: o.name,
          position: o.position.toArray(),
          worldBox: (() => {
            const box = new o.geometry.boundingBox.constructor();
            box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
            return { minY: box.min.y, maxY: box.max.y, minZ: box.min.z, maxZ: box.max.z,
              minX: box.min.x, maxX: box.max.x };
          })(),
          hasMap: Boolean(o.material?.map),
          hasNormal: Boolean(o.material?.normalMap),
          hasRoughness: Boolean(o.material?.roughnessMap),
          hasUv: Boolean(o.geometry?.getAttribute('uv')),
          wrapS: o.material?.map?.wrapS ?? null,
          wrapT: o.material?.map?.wrapT ?? null,
          repeatX: o.material?.map?.repeat?.x ?? null,
          wrapRepeat: null,
          wrapClamp: null,
          metalness: o.material?.metalness ?? null,
          roughness: o.material?.roughness ?? null,
          castShadow: o.castShadow,
          triangles: o.geometry.index
            ? o.geometry.index.count / 3
            : o.geometry.getAttribute('position').count / 3
        });
      });
    }

    // The stand-in must be gone from the picture, not just hidden from tests:
    // it must still exist for the no-assets fallback, but render nothing once
    // the modelled banner arrives.
    let standinFound = false;
    let standinVisible = false;
    api.scene.traverse((o) => {
      if (o.isMesh && o.userData && o.userData.bannerStandin) {
        standinFound = true;
        if (o.visible) standinVisible = true;
      }
    });

    // Material audit: what is still flat and visible.
    const flatBuckets = new Map();
    const visible = (o) => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; };
    api.scene.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      if (!visible(o)) return;
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!mat || mat.visible === false) return;
      if (mat.transparent || (mat.opacity ?? 1) < 0.5) return;
      if (o.name === 'sky-dome' || (o.parent && o.parent.name === 'sky-dome')) return;
      if (mat.map || mat.normalMap || mat.roughnessMap) return;
      const name = (mat.name || '').trim() || '(unnamed)';
      flatBuckets.set(name, (flatBuckets.get(name) || 0) + 1);
    });

    return {
      wrapRepeat,
      wrapClamp,
      state: api.assetState(),
      groupPresent: Boolean(group),
      groupPosition: group ? group.position.toArray() : null,
      meshNames: meshes.map((m) => m.name),
      meshes,
      standinFound,
      standinVisible,
      flatBuckets: Object.fromEntries(flatBuckets)
    };
  }, { wrapRepeat: RepeatWrapping, wrapClamp: ClampToEdgeWrapping });

  report.banner = live;
  report.audit = { flatBuckets: live.flatBuckets };

  const meshes = live.meshes;
  const canvas = meshes.find((m) => m.name === 'BannerCanvas');
  const iron = meshes.filter((m) => /^Banner(Rod|Finial|Strap)$/.test(m.name));

  checks.check('assetState reports the banner as a model',
    live.state.banner === 'model', `banner ${live.state.banner}`);
  checks.check('the modelled banner group is in the scene',
    live.groupPresent === true, 'group banner-model');
  checks.check('the banner group sits at the terrace back wall',
    live.groupPosition !== null
      && Math.abs(live.groupPosition[0]) < 0.001
      && Math.abs(live.groupPosition[2] + 16.42) < 0.02,
    JSON.stringify(live.groupPosition));
  checks.check('the cloth and the rod family all arrived',
    ['BannerCanvas', 'BannerRod', 'BannerFinial', 'BannerStrap']
      .every((n) => live.meshNames.includes(n)),
    live.meshNames.join(','));

  // The cloth: three maps, clamped (not tiled), UVs authored once.
  checks.check('the cloth is dressed with albedo, normal and roughness',
    Boolean(canvas && canvas.hasMap && canvas.hasNormal && canvas.hasRoughness),
    JSON.stringify(canvas && { map: canvas.hasMap, normal: canvas.hasNormal, rough: canvas.hasRoughness }));
  checks.check('the cloth maps clamp at the edge instead of tiling',
    Boolean(canvas && canvas.wrapS === live.wrapClamp && canvas.wrapT === live.wrapClamp),
    `${canvas?.wrapS}/${canvas?.wrapT} vs clamp ${live.wrapClamp}`);
  checks.check('the cloth repeats exactly once over its authored UVs',
    Boolean(canvas && canvas.repeatX === 1), `${canvas?.repeatX}`);
  checks.check('the cloth keeps the authored non-metal painted surface',
    Boolean(canvas && canvas.metalness === 0 && canvas.roughness === 0.92),
    `metalness ${canvas?.metalness} roughness ${canvas?.roughness}`);
  checks.check('the cloth subdivides its fold wave rather than staying a quad',
    Boolean(canvas && canvas.triangles >= 120), `${canvas?.triangles} tris`);

  // The rod family: painted iron, projected UVs, all three maps.
  checks.check('every rod part is present as iron', iron.length === 3, `${iron.length}`);
  checks.check('every rod part carries the painted-iron maps',
    iron.length > 0 && iron.every((m) => m.hasMap && m.hasNormal && m.hasRoughness),
    JSON.stringify(iron.map((m) => ({ n: m.name, m: [m.hasMap, m.hasNormal, m.hasRoughness] }))));
  checks.check('every rod part has UVs for its maps',
    iron.length > 0 && iron.every((m) => m.hasUv),
    JSON.stringify(iron.map((m) => ({ n: m.name, uv: m.hasUv }))));
  checks.check('the iron maps tile, they do not clamp',
    iron.length > 0 && iron.every((m) => m.wrapS === live.wrapRepeat && m.wrapT === live.wrapRepeat),
    JSON.stringify(iron.map((m) => m.wrapS)));
  checks.check('the rod reads as painted metal, not dielectric',
    iron.length > 0 && iron.every((m) => m.metalness === 0.45 && m.roughness === 0.55),
    JSON.stringify(iron.map((m) => [m.metalness, m.roughness])));

  // Placement: the cloth hangs in front of the wall and above the terrace floor.
  checks.check('the cloth hangs in front of the terrace back wall',
    Boolean(canvas && canvas.worldBox.minZ > -16.5 && canvas.worldBox.maxZ < -16.2),
    JSON.stringify(canvas?.worldBox));
  checks.check('the cloth clears the terrace floor',
    Boolean(canvas && canvas.worldBox.minY > 1.2),
    `${canvas?.worldBox?.minY}`);
  checks.check('the rod rides above the cloth',
    Boolean(iron.length === 3 && canvas && iron.every((m) => m.worldBox.minY >= canvas.worldBox.maxY - 0.06)),
    JSON.stringify(iron.map((m) => m.worldBox.minY)));

  checks.check('the flat stand-in is gone from the picture',
    live.standinFound === true && live.standinVisible === false,
    `found ${live.standinFound} visible ${live.standinVisible}`);
  checks.check('TerraceBanner has left the flat-material audit',
    !Object.prototype.hasOwnProperty.call(live.flatBuckets, 'TerraceBanner'),
    Object.keys(live.flatBuckets).join(', '));
  checks.check('nothing banner-shaped is left flat',
    !Object.keys(live.flatBuckets).some((n) => /banner/i.test(n)),
    Object.keys(live.flatBuckets).join(', '));
  checks.check('every banner mesh casts a shadow',
    meshes.length > 0 && meshes.every((m) => m.castShadow === true),
    JSON.stringify(meshes.map((m) => [m.name, m.castShadow])));

  checks.check('the run produced no console errors', consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(' | '));

  if (RECORD) {
    const dir = await screenshotDir();
    const shots = [
      ['round71-banner-front.png', { x: 0.0, z: -10.5, yaw: 0, pitch: 0.16 }],
      ['round71-banner-across.png', { x: 6.4, z: -12.0, yaw: -0.55, pitch: 0.10 }],
      ['round71-banner-cloth.png', { x: 1.6, z: -14.2, yaw: 0.1, pitch: 0.24 }]
    ];
    for (const [name, pose] of shots) {
      await page.evaluate(async (pose) => {
        const api = window.amazingAdventure;
        api.quality.set('full');
        api.setClock(10);
        api.player.placeAt(pose.x, pose.z, pose.yaw, pose.pitch);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, pose);
      const path = join(dir, name);
      await page.screenshot({ path });
      report.shots.push(path);
      console.log(`saved ${path}`);
    }
  }
} catch (error) {
  checks.recordError(error);
  console.error(`evidence run failed: ${error.message}`);
} finally {
  await closeBrowser();
  await server.stop();
}

if (RECORD) {
  const dir = await screenshotDir();
  const path = join(dir, 'round71-evidence.json');
  await writeFile(path, `${JSON.stringify({ ...report, checks: checks.results }, null, 2)}\n`);
  console.log(`saved ${path}`);
}

console.log('');
checks.print();
if (checks.failed) process.exitCode = 1;
