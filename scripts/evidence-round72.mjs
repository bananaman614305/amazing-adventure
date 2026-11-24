// Round 72 evidence: the felt bunting.
//
// Rounds 67-71 left the lane's pennants flat on purpose: a 1.2 m cloth weave is
// a fraction of a texel across a 0.16 x 0.22 m cone flag, so the choice was
// honesty (stay flat) rather than oversight. Round 72 replaces that with a
// flag-scale procedural felt set: neutral-white matted fibre multiplied by the
// authored red/gold dyes, a near-flat roughness map (0.85-0.93) so the flags
// never catch a sun glint, and metre-space box-projection UVs so the three
// corners that straddle the cone's axes cannot shear the diagonal seam.
//
// Nothing here claims a picture was looked at. Every check is a live
// scene-graph measurement after a real boot, or a pure check on the same
// helpers the game calls.
//
// Run: node scripts/evidence-round72.mjs
// Set RECORD_ARTIFACTS=1 to save screenshots and artifacts/round72-evidence.json.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RepeatWrapping } from 'three';
import { startServer, launchBrowser, createChecks, screenshotDir, waitForBoot } from './browser.mjs';
import { FELT_TEXTURE_FILES, FELT_FAMILY, BUNTING_TILE_METERS, propFamilyFor } from '../src/assets.js';

const checks = createChecks();
const RECORD = process.env.RECORD_ARTIFACTS === '1';
const report = { pure: null, live: null, shots: [] };

// ---------------------------------------------------------------------------
// Pure checks on the helpers the world calls.
// ---------------------------------------------------------------------------
{
  // The felt family is deliberately outside the prop registry: the flags are
  // generated cones with authored 0..1 UVs, so the metre-space projection is
  // done by the felt pass, not by propFamilyFor.
  checks.check('the felt family matches the bunting materials',
    FELT_FAMILY.test.test('BuntingRed') && FELT_FAMILY.test.test('BuntingGold'),
    FELT_FAMILY.test.toString());
  checks.check('the felt family never matches the rope or another family',
    ['LaneRope', 'SackCloth', 'Cloth', 'BarkWood', 'LampIron'].every((n) => !FELT_FAMILY.test.test(n)),
    'rope/cloth/bark/iron stay in their own families');
  checks.check('bunting materials are not in the prop registry',
    propFamilyFor('BuntingRed') === null && propFamilyFor('BuntingGold') === null,
    `${propFamilyFor('BuntingRed')?.id}`);
  checks.check('the felt set is three distinct WebP maps',
    JSON.stringify(Object.keys(FELT_TEXTURE_FILES).sort())
      === JSON.stringify(['map', 'normalMap', 'roughnessMap']),
    Object.keys(FELT_TEXTURE_FILES).join(','));
  checks.check('the felt tile is one pennant face wide (<= flag width)',
    BUNTING_TILE_METERS === FELT_FAMILY.tileMeters
      && FELT_FAMILY.tileMeters > 0
      && BUNTING_TILE_METERS <= 0.22,
    `${FELT_FAMILY.tileMeters} m`);
  checks.check('felt is matte and keeps the authored dye',
    FELT_FAMILY.roughness === 0.95 && FELT_FAMILY.keepTint === true,
    `roughness ${FELT_FAMILY.roughness}, keepTint ${FELT_FAMILY.keepTint}`);
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
    return state && state.bunting === 'textured';
  }, { timeout: 120000, polling: 250 });

  const live = await page.evaluate(({ wrapRepeat }) => {
    const api = window.amazingAdventure;
    api.scene.updateMatrixWorld(true);

    // Collect every flag mesh through the material names, not a hardcoded list.
    const flags = [];
    api.scene.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const name = Array.isArray(o.material) ? o.material[0]?.name : o.material.name;
      if (!/^Bunting(Red|Gold)$/.test(name || '')) return;
      flags.push({
        materialName: name,
        position: o.position.toArray(),
        // The dressing must keep the authored dye through the material copy.
        color: `#${o.material.color.getHexString()}`,
        roughness: o.material.roughness,
        metalness: o.material.metalness,
        hasMap: Boolean(o.material.map),
        hasNormal: Boolean(o.material.normalMap),
        hasRoughness: Boolean(o.material.roughnessMap),
        mapName: o.material.map ? o.material.map.name || o.material.map.image?.src || '(image)' : null,
        wrapS: o.material.map ? o.material.map.wrapS : null,
        wrapT: o.material.map ? o.material.map.wrapT : null,
        repeatX: o.material.map ? o.material.map.repeat.x : null,
        anisotropy: o.material.map ? o.material.map.anisotropy : null,
        // Metre-space projection: every flag shares one generated geometry, so
        // the projected geometry is measured per flag. projectBoxGeometry
        // unindexes and splits corners whose triangles disagree on the
        // dominant axis (the round-67 seam fix), so the flag's own triangle
        // count may rise while the silhouette stays identical.
        hasUv: Boolean(o.geometry.getAttribute('uv')),
        unindexed: !o.geometry.index,
        uvCount: o.geometry.getAttribute('uv') ? o.geometry.getAttribute('uv').count : 0,
        triangles: o.geometry.index
          ? o.geometry.index.count / 3
          : o.geometry.getAttribute('position').count / 3
      });
    });

    // The rope must still be flat: it shares no dressing with the flags.
    let ropeFlat = null;
    api.scene.traverse((o) => {
      if (!o.isMesh || !o.material || o.material.name !== 'LaneRope') return;
      ropeFlat = {
        hasMap: Boolean(o.material.map),
        hasNormal: Boolean(o.material.normalMap),
        roughness: o.material.roughness
      };
    });

    // Flat-material audit: what is still flat and visible in the lane.
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
      state: api.assetState(),
      flags,
      ropeFlat,
      flatBuckets: Object.fromEntries(flatBuckets)
    };
  }, { wrapRepeat: RepeatWrapping });

  report.live = live;
  const { flags } = live;

  checks.check('assetState reports the bunting as textured',
    live.state.bunting === 'textured', `bunting ${live.state.bunting}`);
  checks.check('assetState reports exactly the felt maps it applied',
    live.state.buntingDetail
      && JSON.stringify(live.state.buntingDetail.maps)
        === JSON.stringify(['map', 'normalMap', 'roughnessMap']),
    JSON.stringify(live.state.buntingDetail));
  checks.check('every lane flag is dressed (28 pennants)',
    flags.length === 28, `${flags.length} flags`);
  checks.check('the felt pass reports no dropped flags',
    live.state.buntingDetail && live.state.buntingDetail.flags === 28,
    JSON.stringify(live.state.buntingDetail));
  checks.check('one cloned material per source dye (2, not 28)',
    live.state.buntingDetail && live.state.buntingDetail.materials === 2,
    JSON.stringify(live.state.buntingDetail && live.state.buntingDetail.materials));

  checks.check('every flag carries albedo, normal and roughness maps',
    flags.length > 0 && flags.every((f) => f.hasMap && f.hasNormal && f.hasRoughness),
    JSON.stringify(flags.map((f) => [f.hasMap, f.hasNormal, f.hasRoughness]).filter((v, i, a) => a.indexOf(v) === i)));
  checks.check('the maps tile (repeat wrapping) for metre-space projection',
    flags.length > 0 && flags.every((f) => f.wrapS === live.wrapRepeat && f.wrapT === live.wrapRepeat),
    JSON.stringify(flags.map((f) => f.wrapS).filter((v, i, a) => a.indexOf(v) === i)));
  checks.check('one repeat keeps the felt tile (metre-space UVs carry the scale)',
    flags.length > 0 && flags.every((f) => f.repeatX === 1), `${flags[0]?.repeatX}`);
  checks.check('the maps request limited anisotropy (8), not the maximum',
    flags.length > 0 && flags.every((f) => f.anisotropy === 8), `${flags[0]?.anisotropy}`);

  checks.check('the authored red dye survives the material copy',
    flags.filter((f) => f.materialName === 'BuntingRed').every((f) => f.color === '#c9553f'),
    JSON.stringify([...new Set(flags.filter((f) => f.materialName === 'BuntingRed').map((f) => f.color))]));
  checks.check('the authored gold dye survives the material copy',
    flags.filter((f) => f.materialName === 'BuntingGold').every((f) => f.color === '#e0b552'),
    JSON.stringify([...new Set(flags.filter((f) => f.materialName === 'BuntingGold').map((f) => f.color))]));
  checks.check('felt is matte: roughness 0.95, metalness 0',
    flags.length > 0 && flags.every((f) => f.roughness === 0.95 && f.metalness === 0),
    `roughness ${flags[0]?.roughness}, metalness ${flags[0]?.metalness}`);

  checks.check('every flag keeps metre-space UVs from the box projection',
    flags.length > 0 && flags.every((f) => f.hasUv), `uv ${flags[0]?.hasUv}`);
  checks.check('the projection did not change the flag silhouette',
    flags.length > 0 && flags.every((f) => f.triangles === flags[0].triangles && f.unindexed === true),
    `${flags[0]?.triangles} tris, unindexed ${flags[0]?.unindexed}`);

  // Geometry sanity: the flags hang below their strands (inverted cones) and
  // inside the lane bounds.
  checks.check('the flags hang below the strands in the lane',
    flags.length > 0 && flags.every((f) => f.position[1] > 1.5 && f.position[1] < 2.75
      && f.position[2] < -18 && f.position[2] > -25),
    JSON.stringify(flags[0]?.position));
  checks.check('the rope stays flat (its own material, no felt maps)',
    live.ropeFlat !== null && !live.ropeFlat.hasMap && !live.ropeFlat.hasNormal,
    JSON.stringify(live.ropeFlat));
  checks.check('no bunting material is left in the flat audit',
    !Object.keys(live.flatBuckets).some((n) => /bunting/i.test(n)),
    Object.keys(live.flatBuckets).join(', '));

  checks.check('the run produced no console errors', consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(' | '));

  if (RECORD) {
    const dir = await screenshotDir();
    const shots = [
      // Across the lane, both strands and the stall: the classic bunting view.
      ['round72-bunting-lane.png', { x: 0.0, z: -14.0, yaw: 0, pitch: 0.22 }],
      // Up close under a strand: fibre scale and dye colour readable.
      ['round72-bunting-close.png', { x: 1.2, z: -18.2, yaw: 0.05, pitch: 0.42 }],
      // Along the lane: all three strands receding over the stalls.
      ['round72-bunting-strands.png', { x: -5.5, z: -18.6, yaw: -1.1, pitch: 0.3 }]
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
  const path = join(dir, 'round72-evidence.json');
  await writeFile(path, `${JSON.stringify({ ...report, checks: checks.results }, null, 2)}\n`);
  console.log(`saved ${path}`);
}

console.log('');
checks.print();
if (checks.failed) process.exitCode = 1;
