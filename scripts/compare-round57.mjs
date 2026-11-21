// Round 57 before/after: does the camera pipeline actually change the frame?
//
// The evidence script proves the pipeline is configured correctly. That is not
// the same as proving it does anything, so this script measures the *same*
// scene twice: once with tone mapping and IBL forced off (the pre-round-57
// behaviour), once with the real pipeline, and diffs the measured luminance.
//
// Both measurements run in the same page in the same frame position, so the
// only variable is the pipeline. The comparison is against the head commit's
// behaviour reproduced by disabling the feature at runtime, not against a
// different build, which keeps it honest without a second checkout.
//
// Run: RECORD_ARTIFACTS=1 node scripts/compare-round57.mjs
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startServer, launchBrowser, createChecks, screenshotDir } from './browser.mjs';

const checks = createChecks();
const VIEW = { x: 0, z: 10, yaw: Math.PI };
const PHASES = [
  { id: 'day', clock: 20 },
  { id: 'dusk', clock: 80 },
  { id: 'night', clock: 110 }
];

// Same sampler as the evidence harness: draw the presented frame onto a small
// 2D canvas inside the animation frame and read it back.
function measure() {
  return new Promise((done) => {
    requestAnimationFrame(() => {
      const src = document.querySelector('canvas');
      const w = Math.min(src.clientWidth || src.width, 480);
      const h = Math.min(src.clientHeight || src.height, 270);
      const copy = document.createElement('canvas');
      copy.width = w;
      copy.height = h;
      const ctx = copy.getContext('2d', { willReadFrequently: true });
      try {
        ctx.drawImage(src, 0, 0, w, h);
        const { data } = ctx.getImageData(0, 0, w, h);
        let sum = 0, sumSq = 0, n = 0, clipped = 0;
        for (let i = 0; i < data.length; i += 4 * 8) {
          const lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
          sum += lum;
          sumSq += lum * lum;
          n += 1;
          // Pixels at or above 250 are effectively blown out; counting them
          // shows whether the highlight rolloff is doing its job.
          if (data[i] >= 250 || data[i + 1] >= 250 || data[i + 2] >= 250) clipped += 1;
        }
        const mean = sum / n;
        const variance = Math.max(0, sumSq / n - mean * mean);
        done({
          mean: Number(mean.toFixed(4)),
          stdDev: Number(Math.sqrt(variance).toFixed(4)),
          clippedFraction: Number((clipped / n).toFixed(4)),
          samples: n
        });
      } catch (error) {
        done({ error: String(error) });
      }
    });
  });
}

// The pre-round-57 state: no film tone curve (linear passthrough), no sRGB
// output conversion beyond the default, no IBL. This is what the head rendered.
const WITHOUT = `(() => {
  const a = window.amazingAdventure;
  const r = a.renderer;
  a.__saved = {
    toneMapping: r.toneMapping,
    exposure: r.toneMappingExposure,
    outputColorSpace: r.outputColorSpace,
    environment: a.scene.environment,
    environmentIntensity: a.scene.environmentIntensity
  };
  r.toneMapping = 0;               // THREE.NoToneMapping
  r.toneMappingExposure = 1;
  r.outputColorSpace = 'srgb-linear';
  a.scene.environment = null;      // drop image-based lighting
  a.scene.environmentIntensity = 0;
  return true;
})()`;

const WITH = `(() => {
  const a = window.amazingAdventure;
  const s = a.__saved;
  const r = a.renderer;
  r.toneMapping = s.toneMapping;
  r.toneMappingExposure = s.exposure;
  r.outputColorSpace = s.outputColorSpace;
  a.scene.environment = s.environment;
  a.scene.environmentIntensity = s.environmentIntensity;
  return true;
})()`;

const settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));

const outDir = await screenshotDir();
const server = await startServer();
const { browser } = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await page.goto(server.base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.amazingAdventure !== undefined, { timeout: 20000 });
  await page.evaluate(() => window.amazingAdventure.assetsReady());
  await page.evaluate(() => window.amazingAdventure.buildEnvironmentMapNow());
  await page.evaluate((view) => {
    const a = window.amazingAdventure;
    a.player.position.set(view.x, 0, view.z);
    a.player.yaw = view.yaw;
  }, VIEW);

  const rows = [];
  console.log('\nphase   | before (linear)          | after (ACES + IBL)        | delta');
  console.log('--------+--------------------------+---------------------------+-----------------');
  for (const phase of PHASES) {
    await page.evaluate((clock) => window.amazingAdventure.setClock(clock), phase.clock);
    await page.evaluate(() => window.amazingAdventure.buildEnvironmentMapNow());
    await page.evaluate(settle);

    await page.evaluate(WITHOUT);
    await page.evaluate(settle);
    const before = await page.evaluate(measure);
    const beforePng = await page.screenshot();
    await writeFile(join(outDir, `round57-before-${phase.id}.png`), beforePng);

    await page.evaluate(WITH);
    await page.evaluate(settle);
    const after = await page.evaluate(measure);
    const afterPng = await page.screenshot();
    await writeFile(join(outDir, `round57-after-${phase.id}.png`), afterPng);

    const dMean = Number((after.mean - before.mean).toFixed(4));
    const dSpread = Number((after.stdDev - before.stdDev).toFixed(4));
    rows.push({ phase: phase.id, before, after, dMean, dSpread, bytesBefore: beforePng.length, bytesAfter: afterPng.length });
    console.log(
      `${phase.id.padEnd(7)} | mean ${before.mean.toFixed(3)} sd ${before.stdDev.toFixed(3)} clip ${(before.clippedFraction * 100).toFixed(1)}% ` +
      `| mean ${after.mean.toFixed(3)} sd ${after.stdDev.toFixed(3)} clip ${(after.clippedFraction * 100).toFixed(1)}% ` +
      `| dMean ${dMean >= 0 ? '+' : ''}${dMean}`
    );

    checks.check(`${phase.id}: the pipeline changes the rendered frame`,
      Math.abs(dMean) > 0.005 || Math.abs(dSpread) > 0.005,
      `dMean=${dMean} dSpread=${dSpread}`);
    checks.check(`${phase.id}: both variants produced real pixels`,
      before.samples > 1000 && after.samples > 1000 && !before.error && !after.error,
      `${before.samples}/${after.samples} samples`);
  }

  const day = rows.find((r) => r.phase === 'day');
  const night = rows.find((r) => r.phase === 'night');
  checks.check('clipping is not made worse at day (filmic rolloff)',
    day.after.clippedFraction <= day.before.clippedFraction + 0.02,
    `before=${(day.before.clippedFraction * 100).toFixed(1)}% after=${(day.after.clippedFraction * 100).toFixed(1)}%`);
  checks.check('the night frame gains detail under the exposure lift',
    night.after.stdDev >= night.before.stdDev * 0.95,
    `spread before=${night.before.stdDev} after=${night.after.stdDev}`);
  checks.check('night brightens with the exposure lift',
    night.dMean > 0,
    `dMean=${night.dMean}`);

  const summaryPath = join(outDir, 'round57-compare.json');
  await writeFile(summaryPath, JSON.stringify({ view: VIEW, rows }, null, 2));
  console.log(`\nwrote ${summaryPath}`);
} finally {
  await browser.close();
  await server.stop();
}

console.log('\n--- result ---');
checks.print();
const failed = checks.results.filter((r) => !r.ok).length;
console.log(`${checks.results.filter((r) => r.ok).length} PASS, ${failed} FAIL`);
if (failed > 0 || checks.errors.length > 0) process.exit(1);
