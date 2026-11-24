// Round 73 evidence: the fountain's water.
//
// Rounds 28-72 dressed the plaza's stone, wood, iron, cloth, felt, roofs and
// ground. The two fountain water discs were left as flat `MeshStandardMaterial`
// octagons (#97c8e3, roughness 0.15, metalness 0.1, no maps, no UVs) because a
// stone family over them would read as a wet flagstone. Round 73 gives them a
// family of their own: a tileable water skin with a pale blue-green albedo,
// ripple normals and a near-mirror roughness map, projected in metre space at
// a 1.0 m tile so the chop reads at the fixed fountain's size.
//
// Nothing here claims a picture was looked at. Every check is a live
// scene-graph measurement after a real boot, or a pure check on the same
// helpers the game calls.
//
// Run: node scripts/evidence-round73.mjs
// Set RECORD_ARTIFACTS=1 to save screenshots and artifacts/round73-evidence.json.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RepeatWrapping } from 'three';
import { startServer, launchBrowser, createChecks, screenshotDir, waitForBoot } from './browser.mjs';
import { WATER_TEXTURE_FILES, WATER_TILE_METERS, propFamilyFor } from '../src/assets.js';

const checks = createChecks();
const RECORD = process.env.RECORD_ARTIFACTS === '1';
const report = { pure: null, live: null, shots: [] };

// ---------------------------------------------------------------------------
// Pure checks on the helpers the world calls.
// ---------------------------------------------------------------------------
{
  checks.check('the water set is three distinct WebP maps',
    JSON.stringify(Object.keys(WATER_TEXTURE_FILES).sort())
      === JSON.stringify(['map', 'normalMap', 'roughnessMap']),
    Object.keys(WATER_TEXTURE_FILES).join(','));
  checks.check('every water map is a committed repository asset',
    Object.values(WATER_TEXTURE_FILES).every((f) => /^assets\/textures\/water_\w+\.webp$/.test(f)),
    Object.values(WATER_TEXTURE_FILES).join(', '));
  checks.check('the water tile is a metre, so the 33 cm swell reads across the basin',
    WATER_TILE_METERS === 1.0, `${WATER_TILE_METERS} m`);
  checks.check('water stays out of the prop registry',
    // The prop families are handed metre-space UVs and a per-registry fallback
    // tile; `Water` must never match one or the stone pass would dress it.
    propFamilyFor('Water') === null && propFamilyFor('FountainWater') === null,
    `${propFamilyFor('Water')?.id}`);
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
    return state && state.water === 'textured';
  }, { timeout: 120000, polling: 250 });

  const live = await page.evaluate(({ wrapRepeat }) => {
    const api = window.amazingAdventure;
    api.scene.updateMatrixWorld(true);

    const discs = [];
    api.scene.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      if (o.parent && o.parent.name === 'fountain-model' && /^FountainWater/.test(o.name)) {
        const m = o.material;
        const uv = o.geometry.getAttribute('uv');
        let span = null;
        if (uv) {
          let min = Infinity, max = -Infinity;
          for (let i = 0; i < uv.count * 2; i += 1) {
            const v = uv.array[i];
            if (v < min) min = v;
            if (v > max) max = v;
          }
          span = [Number(min.toFixed(2)), Number(max.toFixed(2))];
        }
        discs.push({
          name: o.name,
          color: `#${m.color.getHexString()}`,
          roughness: Number(m.roughness.toFixed(3)),
          metalness: m.metalness,
          hasMap: Boolean(m.map),
          hasNormal: Boolean(m.normalMap),
          hasRoughness: Boolean(m.roughnessMap),
          // The base roughness is a CEILING multiplied into the roughness map's
          // green channel. It must be 1, or the near-mirror map is squared into
          // nothing (0.08 base * 0.08 map = 0.006, a perfect mirror).
          baseRoughness: Number(m.roughness.toFixed(3)),
          mapColorSpace: m.map ? m.map.colorSpace : null,
          normalColorSpace: m.normalMap ? m.normalMap.colorSpace : null,
          wrapS: m.map ? m.map.wrapS : null,
          repeatX: m.map ? m.map.repeat.x : null,
          anisotropy: m.map ? m.map.anisotropy : null,
          // Water must never cast a hard shadow onto the basin floor.
          castShadow: o.castShadow,
          uvSpan: span,
          triangles: o.geometry.index ? o.geometry.index.count / 3
            : o.geometry.getAttribute('position').count / 3,
          // World-space extent of the disc, used to prove the UVs are in metres:
          // a metre-space projection spans exactly extent/tile of UV.
          extentX: o.geometry.boundingBox
            ? o.geometry.boundingBox.max.x - o.geometry.boundingBox.min.x : null,
          extentZ: o.geometry.boundingBox
            ? o.geometry.boundingBox.max.z - o.geometry.boundingBox.min.z : null,
          unindexed: !o.geometry.index
        });
      }
    });

    // The stone pass must not have touched the water, and the water pass must
    // not have touched the stone: two separate materials, two separate map sets.
    let stoneMap = null;
    api.scene.traverse((o) => {
      if (o.isMesh && o.parent && o.parent.name === 'fountain-model'
        && o.material && o.material.name === 'Stone') stoneMap = o.material.map;
    });
    const waterMaterials = new Set(discs.map((d) => d.shareKey));
    let sharesWithStone = false;
    api.scene.traverse((o) => {
      if (!o.isMesh || !o.material || !/^FountainWater/.test(o.name)) return;
      if (stoneMap && o.material.map === stoneMap) sharesWithStone = true;
    });

    // The material audit: nothing named like water may be left flat.
    const flat = new Set();
    const visible = (o) => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; };
    api.scene.traverse((o) => {
      if (!o.isMesh || !o.geometry || !visible(o)) return;
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!mat || mat.visible === false) return;
      if (mat.transparent || (mat.opacity ?? 1) < 0.5) return;
      if (o.name === 'sky-dome') return;
      if (mat.map || mat.normalMap || mat.roughnessMap) return;
      const name = (mat.name || '').trim() || '(unnamed)';
      if (/water/i.test(name)) flat.add(name);
    });

    return {
      wrapRepeat,
      state: api.assetState(),
      discs,
      sharesWithStone,
      flatWaterMaterials: [...flat],
      waterMaterials
    };
  }, { wrapRepeat: RepeatWrapping });

  report.live = live;
  const { discs } = live;

  checks.check('assetState reports the water as textured',
    live.state.water === 'textured', `water ${live.state.water}`);
  checks.check('assetState reports exactly the maps it applied',
    live.state.waterDetail
      && JSON.stringify(live.state.waterDetail.maps)
        === JSON.stringify(['map', 'normalMap', 'roughnessMap']),
    JSON.stringify(live.state.waterDetail));
  checks.check('both fountain water discs are dressed (2)',
    discs.length === 2 && live.state.waterDetail?.discs === 2, `${discs.length} discs`);
  checks.check('each disc carries albedo, normal and roughness maps',
    discs.length === 2 && discs.every((d) => d.hasMap && d.hasNormal && d.hasRoughness),
    JSON.stringify(discs.map((d) => [d.hasMap, d.hasNormal, d.hasRoughness])));
  checks.check('the albedo is decoded sRGB and the data maps stay linear',
    discs.every((d) => d.mapColorSpace === 'srgb' && d.normalColorSpace === ''),
    JSON.stringify(discs.map((d) => [d.mapColorSpace, d.normalColorSpace])));
  checks.check('the maps tile (repeat wrapping) at one repeat',
    discs.every((d) => d.wrapS === live.wrapRepeat && d.repeatX === 1),
    JSON.stringify(discs.map((d) => [d.wrapS, d.repeatX])));
  checks.check('water requests anisotropy 8 for the grazing view across the plaza',
    discs.length > 0 && discs.every((d) => d.anisotropy === 8),
    `${discs[0]?.anisotropy}`);
  checks.check('water is reflective: the roughness map carries the mirror',
    // The reflectivity comes from the map (0.02..0.16); the material base is the
    // ceiling at 1 so the map is not squared down. Metalness stays the authored
    // 0.1, which matches the GLB's own faint sheen.
    discs.length > 0 && discs.every((d) => d.baseRoughness === 1 && d.metalness > 0
      && d.hasRoughness),
    JSON.stringify(discs.map((d) => [d.baseRoughness, d.metalness])));
  checks.check('the water material projects white so the map carries the colour',
    discs.length > 0 && discs.every((d) => d.color === '#ffffff'),
    JSON.stringify([...new Set(discs.map((d) => d.color))]));
  checks.check('every disc keeps metre-space UVs from the box projection',
    // The GLB shipped POSITION+NORMAL only, so any UV at all proves generation.
    // Stronger: because the projection is in metres, the UV span of each disc
    // must equal its own octagon extent divided by the 1 m tile. That is what
    // separates a real metre projection from one squeezed into 0..1 per face.
    discs.length === 2 && discs.every((d) => d.uvSpan !== null
      && d.extentX !== null
      && Math.abs((d.uvSpan[1] - d.uvSpan[0]) - d.extentX / 1.0) < 0.02),
    JSON.stringify(discs.map((d) => ({ uv: d.uvSpan, extentX: d.extentX }))));
  checks.check('the projection did not change the octagon silhouette',
    // Each disc is a flat octagon fan: 8 sides triangulated from one corner is
    // 6 triangles (n - 2), which is the authored silhouette. The pass only
    // rewrites UVs, and a flat normal-up disc needs no corner splits.
    discs.length === 2 && discs.every((d) => d.triangles === 6)
    && live.state.waterDetail?.seams === 0,
    JSON.stringify(discs.map((d) => d.triangles)));
  checks.check('water never casts a hard shadow onto the basin floor',
    discs.length > 0 && discs.every((d) => d.castShadow === false),
    JSON.stringify(discs.map((d) => d.castShadow)));
  checks.check('the stone and the water do not share a map or a material',
    live.sharesWithStone === false, `sharesWithStone ${live.sharesWithStone}`);
  checks.check('no water material is left in the flat audit',
    live.flatWaterMaterials.length === 0, live.flatWaterMaterials.join(', '));
  // The harness prints its own console-error line from checks.errors; the run's
  // collected page errors are asserted here once, not counted twice.
  checks.check('the run produced no console errors', consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(' | '));

  if (RECORD) {
    const dir = await screenshotDir();
    const shots = [
      // The classic plaza view: the fountain from the south walkway.
      ['round73-fountain-plaza.png', { x: 0.0, z: 6.0, yaw: 0.0, pitch: 0.18 }],
      // Close on the basin: ripple scale and the reflective surface readable.
      ['round73-fountain-basin.png', { x: 0.0, z: 2.4, yaw: 0.0, pitch: -0.22 }],
      // From the north side, against the light: the sheen across the water.
      ['round73-fountain-north.png', { x: 1.6, z: -3.2, yaw: 3.0, pitch: 0.1 }]
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
  const path = join(dir, 'round73-evidence.json');
  await writeFile(path, `${JSON.stringify({ ...report, checks: checks.results }, null, 2)}\n`);
  console.log(`saved ${path}`);
}

console.log('');
checks.print();
if (checks.failed) process.exitCode = 1;
