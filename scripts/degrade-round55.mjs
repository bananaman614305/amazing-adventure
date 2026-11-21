// Round 55 degradation proof: does the game survive a missing lamp texture or GLB?
//
// upgradeLaneLamp() promises that a missing map leaves a playable post rather
// than a throw or an invisible lamp, and that assetState says why. This asserts
// that in a real browser by blocking the lamp maps (and, separately, the lamp
// GLB), then checking the world still builds, the post is still drawn, the
// stand-ins behave, and the day/night hook still drives the modelled bulb.
//
// Run: node scripts/degrade-round55.mjs
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startServer, launchBrowser, waitForBoot } from './browser.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'artifacts');

const server = await startServer();
const { browser } = await launchBrowser();

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
}

try {
  for (const mode of ['all-maps-blocked', 'normal-map-only-blocked', 'glb-blocked']) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const blocked = [];
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      const isLampMap = /assets\/textures\/lamp_(albedo|normal|rough)\.webp/.test(url);
      const isGlb = /assets\/lamp\.glb/.test(url);
      const hit = mode === 'all-maps-blocked' ? isLampMap
        : mode === 'normal-map-only-blocked' ? /lamp_normal\.webp/.test(url)
        : mode === 'glb-blocked' ? isGlb : false;
      if (hit) blocked.push(url.split('/').pop());
      if (hit) req.respond({ status: 404, body: 'blocked' });
      else req.continue();
    });
    await page.goto(server.base, { waitUntil: 'domcontentloaded' });
    await waitForBoot(page);

    const state = await page.evaluate(() => window.amazingAdventure.assetsReady().then(() => {
      const api = window.amazingAdventure;
      let laneGroup = 0, standinHidden = 0, standinShown = 0;
      api.scene.traverse((o) => {
        if (o.name === 'lane-lamp-model') laneGroup += 1;
        if (o.userData && o.userData.lanePostStandin) {
          if (o.visible) standinShown += 1; else standinHidden += 1;
        }
      });
      return {
        asset: api.assetState(),
        laneGroup, standinHidden, standinShown,
        postLamp: Boolean(api.environment.postLamp),
        aim: Boolean(api.environment.laneLampAim)
      };
    }));

    const glbBlocked = mode === 'glb-blocked';
    check(`[${mode}] the world still builds with the asset missing`, errors.length === 0,
      errors.slice(0, 2));

    if (glbBlocked) {
      check(`[${mode}] the stand-in stays drawn when the GLB is missing`,
        state.asset.laneLamp === 'stand-in' && state.laneGroup === 0 && state.standinShown === 1,
        { laneLamp: state.asset.laneLamp, groups: state.laneGroup, standinShown: state.standinShown });
    } else {
      check(`[${mode}] the modelled post is still drawn`,
        state.asset.laneLamp === 'model' && state.laneGroup === 1,
        { laneLamp: state.asset.laneLamp, groups: state.laneGroup });
      check(`[${mode}] the procedural stand-in stays hidden`,
        state.standinHidden === 1 && state.standinShown === 0,
        { hidden: state.standinHidden, shown: state.standinShown });
    }

    check(`[${mode}] the day/night hook ${glbBlocked ? 'stays on the stand-in bulb' : 'reaches the modelled bulb'}`,
      glbBlocked ? (state.postLamp === true && state.aim === false)
                 : (state.postLamp === true && state.aim === true),
      { postLamp: state.postLamp, aim: state.aim });

    if (mode === 'all-maps-blocked') {
      check(`[${mode}] assetState reports the ironwork as flat, not textured`,
        state.asset.lampMetal === 'flat' && Array.isArray(state.asset.lampMetalDetail.maps) &&
        state.asset.lampMetalDetail.maps.length === 0,
        { lampMetal: state.asset.lampMetal, detail: state.asset.lampMetalDetail });
    } else if (mode === 'normal-map-only-blocked') {
      check(`[${mode}] assetState keeps the maps that loaded and drops only the missing one`,
        state.asset.lampMetal === 'textured' &&
        JSON.stringify([...state.asset.lampMetalDetail.maps].sort()) ===
          JSON.stringify(['map', 'roughnessMap']),
        { lampMetal: state.asset.lampMetal, detail: state.asset.lampMetalDetail });
    }

    const lit = await page.evaluate(() => {
      const api = window.amazingAdventure;
      api.setClock(80);
      const before = api.environment.postLamp
        ? api.environment.postLamp.material.emissiveIntensity : null;
      const result = api.performLaneLighting();
      const after = api.environment.postLamp
        ? api.environment.postLamp.material.emissiveIntensity : null;
      api.getState().flags.laneLanternsLit = false;
      api.setClock(80);
      return { changed: result.changed, before, after };
    });
    if (!glbBlocked) {
      check(`[${mode}] the lamp round still lights the head`,
        lit.changed === true && lit.before === 0 && lit.after > 0,
        { changed: lit.changed, before: lit.before, after: lit.after });
    } else {
      check(`[${mode}] the lane bunting lanterns still light`,
        lit.changed === true, { changed: lit.changed });
    }

    if (mode === 'all-maps-blocked') {
      const png = await page.screenshot();
      await writeFile(join(OUT, 'round55-lane-lamp-no-maps.png'), png);
      console.log(`wrote artifacts/round55-lane-lamp-no-maps.png (${png.length} bytes)`);
    }
    check(`[${mode}] ${blocked.length} requests were blocked`, blocked.length > 0,
      { blocked: blocked.length });
    await page.close();
  }
} finally {
  await browser.close();
  await server.stop();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);