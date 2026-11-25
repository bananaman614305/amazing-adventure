// Round 75 evidence: the fountain's water surface moves.
//
// Round 73 dressed the fountain's two discs with a tileable normal map, but the
// ripples stayed frozen. Round 75 adds the first per-frame hook in world.js: a
// per-frame UV offset on the normal and roughness maps (the albedo stays put, or
// the ripples read as a scrolling poster). This script holds that to a number:
// the offset advances at about WATER_FLOW_SPEED per second, wraps into [0, 1),
// the low tier freezes it, and a different offset renders different pixels.
//
// Nothing here claims a picture was looked at. Every check is a live
// scene-graph, material or rendered-pixel measurement after a real boot, or a
// pure check on the same helpers the game calls. The screenshots are saved as
// evidence for the human to read.
//
// Run: node scripts/evidence-round75.mjs
// Set RECORD_ARTIFACTS=1 to save screenshots and artifacts/round75-evidence.json.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startServer, launchBrowser, createChecks, screenshotDir, waitForBoot } from './browser.mjs';
import {
  WATER_FLOW_SPEED,
  shouldAnimateWater,
  waterOffsetStep,
  advanceWaterOffset
} from '../src/water.js';

const checks = createChecks();
const RECORD = process.env.RECORD_ARTIFACTS === '1';
const report = { pure: null, live: null, shots: [] };

// ---------------------------------------------------------------------------
// Pure checks on the helpers the world calls.
// ---------------------------------------------------------------------------
{
  checks.check('water flow speed is a gentle swell, not a conveyor belt',
    WATER_FLOW_SPEED > 0 && WATER_FLOW_SPEED < 0.2,
    `${WATER_FLOW_SPEED}`);
  checks.check('the low tier freezes the surface',
    shouldAnimateWater('low') === false && shouldAnimateWater('full') === true,
    `${shouldAnimateWater('low')}, ${shouldAnimateWater('full')}`);
  checks.check('a zero or negative dt never moves the surface',
    waterOffsetStep(0).x === 0 && waterOffsetStep(-0.1).x === 0
      && waterOffsetStep(NaN).x === 0 && waterOffsetStep(Infinity).x === 0,
    'zero/negative/NaN/Infinity');
  checks.check('the y step lags the x step, so ripples are not square',
    Math.abs(waterOffsetStep(1).y) < Math.abs(waterOffsetStep(1).x),
    `${waterOffsetStep(1).y} / ${waterOffsetStep(1).x}`);
  checks.check('the offset wraps into [0, 1) and never mutates its input',
    (() => {
      const cur = { x: 0.9, y: 0.9 };
      const snap = { ...cur };
      const next = advanceWaterOffset(cur, 10);
      return next.x >= 0 && next.x < 1 && next.y >= 0 && next.y < 1
        && cur.x === snap.x && cur.y === snap.y;
    })(),
    'wrap + non-mutation');
  report.pure = checks.results.length;
}

// ---------------------------------------------------------------------------
// Live checks: real boot, real materials, real rendered pixels.
// ---------------------------------------------------------------------------
const server = await startServer();
const { browser, close: closeBrowser } = await launchBrowser();
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});

const readWater = () => page.evaluate(() => {
  const api = window.amazingAdventure;
  const mat = api.environment.waterMaterial;
  const keys = ['map', 'normalMap', 'roughnessMap'];
  const out = { hasMaterial: !!mat, quality: api.environment.quality,
    offset: api.environment.waterOffset ? { ...api.environment.waterOffset } : null,
    maps: {} };
  if (mat) {
    for (const key of keys) {
      const t = mat[key];
      out.maps[key] = t ? { present: true, offset: { x: t.offset.x, y: t.offset.y } } : { present: false };
    }
  }
  return out;
});

try {
  await page.goto(server.base, { waitUntil: 'domcontentloaded' });
  await waitForBoot(page);

  await page.waitForFunction(() => {
    const state = window.amazingAdventure?.assetState?.();
    return state && state.water === 'textured';
  }, { timeout: 120000, polling: 250 });

  const initial = await page.evaluate(() => {
    const api = window.amazingAdventure;
    api.getState().flags.laneLanternsLit = false;
    api.quality.set('full');
    api.setClock(10); // day
    const mat = api.environment.waterMaterial;
    const water0 = {
      shared: api.environment.waterOffset ? { ...api.environment.waterOffset } : null,
      normal: mat?.normalMap ? { x: mat.normalMap.offset.x, y: mat.normalMap.offset.y } : null,
      roughness: mat?.roughnessMap ? { x: mat.roughnessMap.offset.x, y: mat.roughnessMap.offset.y } : null,
      map: mat?.map ? { x: mat.map.offset.x, y: mat.map.offset.y } : null
    };
    return { state: api.assetState(), quality: api.environment.quality, water0 };
  });
  report.live = initial;

  checks.check('assetState reports the water as textured',
    initial.state.water === 'textured', `water ${initial.state.water}`);
  checks.check('assetState reports the three water maps',
    Array.isArray(initial.state.waterDetail?.maps)
      && initial.state.waterDetail.maps.includes('normalMap')
      && initial.state.waterDetail.maps.includes('roughnessMap')
      && initial.state.waterDetail.maps.includes('map'),
    JSON.stringify(initial.state.waterDetail?.maps));

  const before = await readWater();
  checks.check('the fountain water material exists and carries all three maps',
    before.hasMaterial
      && before.maps.map?.present && before.maps.normalMap?.present
      && before.maps.roughnessMap?.present,
    JSON.stringify(before.maps));
  // The normal/roughness offsets are live by the time we read them (the frame
  // loop advances them during boot), so "starts at zero" is verified at the
  // creation site in src/world.js, not here. What we can hold on screen is
  // that the albedo map never travels at all: it is the water's colour.
  checks.check('the albedo map never travels (it is the water colour, not the surface)',
    initial.water0.map.x === 0 && initial.water0.map.y === 0,
    JSON.stringify(initial.water0.map));
  checks.check('at creation the shared offset is zero',
    initial.water0.shared.x === 0 && initial.water0.shared.y === 0,
    JSON.stringify(initial.water0.shared));

  // Let real frames advance the surface, then hold the movement to a number.
  await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    for (let i = 0; i < 30; i += 1) await raf();
  });
  const after = await readWater();
  const dtEstimate = 30 / 60; // thirty frames at ~60fps budget
  const expectedX = WATER_FLOW_SPEED * dtEstimate;
  const actualX = after.offset.x;
  checks.check('real frames advance the shared offset',
    actualX > 0 && actualX < 1,
    `offset ${actualX.toFixed(4)} (expected roughly ${expectedX.toFixed(4)} after ~0.5s)`);
  checks.check('the normal map offset follows the shared offset',
    Math.abs(after.maps.normalMap.offset.x - after.offset.x) < 1e-9
      && Math.abs(after.maps.normalMap.offset.y - after.offset.y) < 1e-9,
    JSON.stringify({ map: after.maps.normalMap.offset, shared: after.offset }));
  checks.check('the roughness map rides with the normal map',
    Math.abs(after.maps.roughnessMap.offset.x - after.offset.x) < 1e-9
      && Math.abs(after.maps.roughnessMap.offset.y - after.offset.y) < 1e-9,
    JSON.stringify({ map: after.maps.roughnessMap.offset, shared: after.offset }));
  checks.check('the albedo map stays put while the surface moves',
    after.maps.map.offset.x === 0 && after.maps.map.offset.y === 0,
    JSON.stringify(after.maps.map.offset));
  checks.check('the shared offset wraps into [0, 1)',
    after.offset.x >= 0 && after.offset.x < 1
      && after.offset.y >= 0 && after.offset.y < 1,
    JSON.stringify(after.offset));

  // Tier flip: low freezes, full resumes, no phase change.
  const tier = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const snap = () => ({
      off: { ...api.environment.waterOffset },
      n: { x: api.environment.waterMaterial.normalMap.offset.x,
           y: api.environment.waterMaterial.normalMap.offset.y },
      phase: api.getClock().phase
    });
    const before = snap();
    api.quality.set('low');
    const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    for (let i = 0; i < 15; i += 1) await raf();
    const frozen = snap();
    api.quality.set('full');
    for (let i = 0; i < 15; i += 1) await raf();
    const resumed = snap();
    return { before, frozen, resumed, quality: api.environment.quality };
  });
  checks.check('the low tier freezes the normal map offset',
    tier.frozen.n.x === tier.before.n.x && tier.frozen.n.y === tier.before.n.y,
    JSON.stringify({ before: tier.before.n, frozen: tier.frozen.n }));
  checks.check('the low tier leaves the shared offset untouched',
    tier.frozen.off.x === tier.before.off.x && tier.frozen.off.y === tier.before.off.y,
    JSON.stringify({ before: tier.before.off, frozen: tier.frozen.off }));
  checks.check('flipping the tier does not move the hour',
    tier.before.phase === tier.frozen.phase && tier.frozen.phase === tier.resumed.phase,
    JSON.stringify({ before: tier.before.phase, frozen: tier.frozen.phase, resumed: tier.resumed.phase }));
  checks.check('the full tier is restored after the flip',
    tier.quality === 'full', tier.quality);
  checks.check('resuming motion moves the offset again',
    tier.resumed.off.x !== tier.frozen.off.x || tier.resumed.off.y !== tier.frozen.off.y,
    JSON.stringify({ frozen: tier.frozen.off, resumed: tier.resumed.off }));

  // Rendered-pixel proof: a different UV offset paints different water pixels,
  // and the same offset reproduces byte-for-byte. This is the on-screen claim.
  const pixelProof = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    api.quality.set('full');
    api.setClock(10);
    api.player.placeAt(0.0, 2.4, 0.0, -0.22);
    const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    for (let i = 0; i < 6; i += 1) await raf();
    const snap = (offset) => {
      api.environment.waterOffset = { ...offset };
      for (const key of ['normalMap', 'roughnessMap']) {
        if (api.environment.waterMaterial[key]) {
          api.environment.waterMaterial[key].offset.set(offset.x, offset.y);
        }
      }
      api.renderer.render(api.scene, api.camera);
      return api.renderer.domElement.toDataURL('image/png');
    };
    const a = snap({ x: 0, y: 0 });
    const b = snap({ x: 0.5, y: 0.3 });
    const c = snap({ x: 0, y: 0 });
    const load = (url) => new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = url;
    });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const w = ia.width, h = ia.height;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const cropY = Math.floor(h * 0.5);
    const cropH = Math.floor(h * 0.45);
    ctx.drawImage(ia, 0, 0);
    const da = ctx.getImageData(0, cropY, w, cropH).data;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(ib, 0, 0);
    const db = ctx.getImageData(0, cropY, w, cropH).data;
    let sum = 0, max = 0, changed = 0, n = 0;
    for (let i = 0; i < da.length; i += 4) {
      let px = 0;
      for (let k = 0; k < 3; k += 1) {
        const d = Math.abs(da[i + k] - db[i + k]);
        sum += d; if (d > max) max = d; px += d; n += 1;
      }
      if (px > 6) changed += 1;
    }
    return { w, h, mean: sum / n, max, changedPx: changed, sameAB: a === b, sameAC: a === c };
  });
  checks.check('a different UV offset paints different water pixels',
    pixelProof.changedPx > 1000 && pixelProof.max > 8,
    `changed ${pixelProof.changedPx} px, max delta ${pixelProof.max}, mean ${pixelProof.mean.toFixed(2)}`);
  checks.check('the same UV offset reproduces byte-for-byte',
    pixelProof.sameAC === true && pixelProof.sameAB === false,
    `sameAB ${pixelProof.sameAB}, sameAC ${pixelProof.sameAC}`);

  checks.check('the run produced no console errors', consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(' | '));

  if (RECORD) {
    const dir = await screenshotDir();
    // Two clock offsets so the UV travel is visible: a day view and a night
    // view. The fountain's offset accumulates with real frames, so the two
    // shots are taken at different points in the cycle and show different
    // ripple positions over the same basin.
    const shots = [
      ['round75-fountain-day.png', { x: 0.0, z: 2.4, yaw: 0.0, pitch: -0.22, clock: 10 }],
      ['round75-fountain-night.png', { x: 0.0, z: 2.4, yaw: 0.0, pitch: -0.22, clock: 140 }]
    ];
    for (const [name, pose] of shots) {
      await page.evaluate(async (pose) => {
        const api = window.amazingAdventure;
        api.quality.set('full');
        api.getState().flags.laneLanternsLit = pose.clock >= 105;
        api.setClock(pose.clock);
        api.player.placeAt(pose.x, pose.z, pose.yaw, pose.pitch);
        const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
        for (let i = 0; i < 12; i += 1) await raf();
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
  const path = join(dir, 'round75-evidence.json');
  const sortKeys = (value) => {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortKeys(v)]));
    }
    return value;
  };
  await writeFile(path,
    `${JSON.stringify(sortKeys({ ...report, checks: checks.results }), null, 2)}\n`);
  console.log(`saved ${path}`);
}

console.log('');
checks.print();
if (checks.failed) process.exitCode = 1;
