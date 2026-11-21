// Round 55 degradation proof: does the game survive a missing lamp texture?
//
// upgradeLaneLamp() promises that a missing map leaves a playable post rather
// than a throw or an invisible lamp, and that assetState says why. This asserts
// that in a real browser by aborting every request for the lamp maps, then
// checking the world still builds, the post is still drawn, the stand-ins are
// hidden, and the day/night hook still drives the modelled bulb.
//
// Run: node scripts/degrade-round55.mjs
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startServer, launchBrowser } from './browser.mjs';

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
  for (const mode of ['all-maps-blocked', 'normal-map-only-blocked']) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const blocked = [];
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      const isLampMap = /assets\/textures\/lamp_(albedo|normal|rough)\.webp/.test(url);
      const hit = mode === 'all-maps-blocked' ? isLampMap
        : mode === 'normal-map-only-blocked' ? /lamp_normal\.webp/.test(url) : false;
      if (hit) blocked.push(url.split('/').pop());
      if (hit) req.abort('blockedbyclient');
      else req.continue();
    });
    await page.goto(server.base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.amazingAdventure !== undefined, { timeout: 20000 });

    const state = await page.evaluate(() => window.amazingAdventure.assetsReady().then(() => {
      const api = window.amazingAdventure;
      let laneGroup = 0;
      let standinHidden = 0;
      let standinShown = 0;
      api.scene.traverse((o) => {
        if (o.name === 'lane-lamp-model') laneGroup += 1;
        if (o.userData && o.userData.lanePostStandin) {
          if (o.visible) standinShown += 1; else standinHidden += 1;
        }
      });
      return {
        asset: api.assetState(),
        laneGroup,
        standinHidden,
        standinShown,
        postLamp: Boolean(api.environment.postLamp),
        aim: Boolean(api.environment.laneLampAim)
      };
    }));

    check(`[${mode}] the world still builds with the maps missing`, errors.length === 0,
      errors.slice(0, 2));
    check(`[${mode}] the modelled post is still drawn`, state.asset.laneLamp === 'model' &&
      state.laneGroup === 1, { laneLamp: state.asset.laneLamp, groups: state.laneGroup });
    check(`[${mode}] the procedural stand-in stays hidden`,
      state.standinHidden === 1 && state.standinShown === 0,
      { hidden: state.standinHidden, shown: state.standinShown });
    check(`[${mode}] the day/night hook still reaches the modelled bulb`,
      state.postLamp === true && state.aim === true,
      { postLamp: state.postLamp, aim: state.aim });
    // Degradation is per map: with every map gone the iron is flat, but losing
    // only the normal map must still leave a painted, textured post using the
    // albedo and roughness that did arrive.
    if (mode === 'all-maps-blocked') {
      check(`[${mode}] assetState reports the ironwork as flat, not textured`,
        state.asset.lampMetal === 'flat' && Array.isArray(state.asset.lampMetalDetail.maps) &&
        state.asset.lampMetalDetail.maps.length === 0,
        { lampMetal: state.asset.lampMetal, detail: state.asset.lampMetalDetail });
    } else {
      check(`[${mode}] assetState keeps the maps that loaded and drops only the missing one`,
        state.asset.lampMetal === 'textured' &&
        JSON.stringify([...state.asset.lampMetalDetail.maps].sort()) ===
          JSON.stringify(['map', 'roughnessMap']),
        { lampMetal: state.asset.lampMetal, detail: state.asset.lampMetalDetail });
    }

    // The round itself must survive: light it at dusk and the head must glow.
    const lit = await page.evaluate(async () => {
      const api = window.amazingAdventure;
      const frames = async (n) => {
        for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
      };
      api.setClock(80);
      await frames(3);
      const dark = api.environment.postLamp.material.emissiveIntensity;
      api.getState().flags.laneLanternsLit = true;
      // setClock() is what re-applies the phase; flipping the flag alone does
      // not re-run applyPhase().
      api.setClock(80);
      await frames(3);
      const litGlow = api.environment.postLamp.material.emissiveIntensity;
      api.getState().flags.laneLanternsLit = false;
      return { dark, litGlow };
    });
    check(`[${mode}] the lamp round still lights the head`,
      lit.dark === 0 && lit.litGlow > 0, lit);

    if (mode === 'all-maps-blocked') {
      const png = await page.screenshot();
      await writeFile(join(OUT, 'round55-lane-lamp-no-maps.png'), png);
      console.log(`wrote artifacts/round55-lane-lamp-no-maps.png (${png.length} bytes)`);
    }
    check(`[${mode}] ${blocked.length} map requests were blocked`, blocked.length > 0,
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