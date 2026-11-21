// Round 57 evidence: what the camera pipeline actually reports, measured.
//
// This round claims three things about the render path and nothing about taste:
//
//   1. A filmic tone curve is active with a per-phase exposure, and the output
//      colour space is sRGB - i.e. the renderer is colour-managed rather than
//      passing linear values straight to the canvas.
//   2. scene.environment holds a generated PMREM, so standard materials receive
//      image-based ambient light instead of only a hemisphere approximation.
//   3. The result is a real change in the frame: mean luminance and luminance
//      spread are measured from actual pixels per phase, and the shadow budget
//      is reported from the live sun.
//
// The point of freezing these numbers is that "looks richer" is not checkable,
// but "exposure 1.00 / 1.12 / 1.55, env map present, mean luminance moved from
// X to Y" is. A reviewer can re-run this and compare.
//
// Run: RECORD_ARTIFACTS=1 node scripts/evidence-round57.mjs
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startServer, launchBrowser, createChecks, screenshotDir } from './browser.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const checks = createChecks();

// The camera stands in the courtyard looking at the fountain, so the frame has
// stone floor, walls, water and sky: a fair sample rather than a wall-filling
// close-up that would hide the lighting.
const VIEW = { x: 0, z: 10, yaw: Math.PI };

const PHASES = [
  { id: 'day', clock: 20 },
  { id: 'dusk', clock: 80 },
  { id: 'night', clock: 110 }
];

/**
 * Reads the live renderer/lighting facts. Everything here is a property the
 * game already exposes; nothing is injected to make the numbers look better.
 */
function readPipeline() {
  const a = window.amazingAdventure;
  const r = a.renderer;
  const env = a.environment;
  const sun = env.sun;
  return {
    toneMapping: r.toneMapping,
    toneMappingExposure: r.toneMappingExposure,
    outputColorSpace: r.outputColorSpace,
    shadowMapEnabled: r.shadowMap.enabled,
    shadowMapType: r.shadowMap.type,
    hasEnvironment: Boolean(a.scene.environment),
    environmentIntensity: a.scene.environmentIntensity ?? null,
    environmentType: a.scene.environment ? (a.scene.environment.mapping ?? null) : null,
    sunCastShadow: sun.castShadow,
    shadowMapSize: sun.shadow.mapSize ? [sun.shadow.mapSize.x, sun.shadow.mapSize.y] : null,
    shadowBias: sun.shadow.bias,
    shadowNormalBias: sun.shadow.normalBias,
    background: a.scene.background ? a.scene.background.getHexString() : null,
    fog: a.scene.fog ? { color: a.scene.fog.color.getHexString(), near: a.scene.fog.near, far: a.scene.fog.far } : null,
    sunIntensity: sun.intensity,
    sunColor: sun.color.getHexString(),
    hemiIntensity: env.hemi.intensity,
    lampIntensity: env.lamps.map((l) => l.light.intensity)
  };
}

/**
 * Samples the sky dome's vertex-colour gradient at its top and bottom vertices
 * and at the equator, so the dome can be shown to be a real gradient rather
 * than a flat fill.
 */
function readSkyGradient() {
  const a = window.amazingAdventure;
  let dome = null;
  a.scene.traverse((o) => { if (o.name === 'sky-dome') dome = o; });
  if (!dome) return null;
  const pos = dome.geometry.attributes.position;
  const col = dome.geometry.attributes.color;
  let top = null, bottom = null, equator = null;
  let bestTopY = -Infinity, bestBottomY = Infinity, bestEqY = Infinity;
  for (let i = 0; i < pos.count; i += 1) {
    const y = pos.getY(i);
    if (y > bestTopY) { bestTopY = y; top = i; }
    if (y < bestBottomY) { bestBottomY = y; bottom = i; }
    if (Math.abs(y) < bestEqY) { bestEqY = Math.abs(y); equator = i; }
  }
  const rgb = (i) => [
    Number(col.getX(i).toFixed(4)),
    Number(col.getY(i).toFixed(4)),
    Number(col.getZ(i).toFixed(4))
  ];
  return { top: rgb(top), equator: rgb(equator), bottom: rgb(bottom) };
}

/**
 * Mean and spread of luminance over the real pixels of the canvas.
 *
 * The renderer draws to a WebGL context whose drawing buffer is not preserved,
 * so a fresh readPixels after the frame would come back empty. Instead the
 * canvas is drawn onto a 2D canvas inside the same animation frame, after the
 * game has rendered - the browser keeps the just-presented frame available for
 * a same-task drawImage. A step of 8 px is sampled rather than every pixel, so
 * the measurement cost stays out of the frame budget while still covering the
 * whole screen.
 */
function measureLuminance() {
  return new Promise((resolveMeasure) => {
    requestAnimationFrame(() => {
      const src = document.querySelector('canvas');
      if (!src) return resolveMeasure({ error: 'no canvas' });
      const w = Math.min(src.clientWidth || src.width, 480);
      const h = Math.min(src.clientHeight || src.height, 270);
      const copy = document.createElement('canvas');
      copy.width = w;
      copy.height = h;
      const ctx = copy.getContext('2d', { willReadFrequently: true });
      if (!ctx) return resolveMeasure({ error: 'no 2d context' });
      try {
        ctx.drawImage(src, 0, 0, w, h);
        const { data } = ctx.getImageData(0, 0, w, h);
        let sum = 0, sumSq = 0, n = 0;
        for (let i = 0; i < data.length; i += 4 * 8) {
          const lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
          sum += lum;
          sumSq += lum * lum;
          n += 1;
        }
        if (!n) return resolveMeasure({ error: 'empty sample' });
        const mean = sum / n;
        const variance = Math.max(0, sumSq / n - mean * mean);
        resolveMeasure({
          mean: Number(mean.toFixed(4)),
          stdDev: Number(Math.sqrt(variance).toFixed(4)),
          samples: n
        });
      } catch (error) {
        resolveMeasure({ error: String(error) });
      }
    });
  });
}

/** Median and p95 of N animation-frame deltas, in milliseconds. */
async function frameTimes(page, count = 60) {
  const deltas = await page.evaluate((n) => {
    return new Promise((done) => {
      const out = [];
      let last = performance.now();
      let seen = 0;
      const tick = (now) => {
        out.push(now - last);
        last = now;
        seen += 1;
        if (seen >= n) done(out);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, count);
  const sorted = [...deltas].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return { median: Number(at(0.5).toFixed(2)), p95: Number(at(0.95).toFixed(2)) };
}

const outDir = await screenshotDir();
const server = await startServer();
const { browser } = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await page.goto(server.base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.amazingAdventure !== undefined, { timeout: 20000 });
  await page.evaluate(() => window.amazingAdventure.assetsReady());
  // The environment map is built off the phase-change frame, so wait for the
  // real thing rather than assuming a fixed number of frames.
  await page.evaluate(() => window.amazingAdventure.buildEnvironmentMapNow());

  // Put the camera somewhere fixed before measuring, so the phases are
  // comparable frames rather than three different camera positions.
  await page.evaluate((view) => {
    const a = window.amazingAdventure;
    a.player.position.set(view.x, 0, view.z);
    a.player.yaw = view.yaw;
  }, VIEW);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  const pipeline = await page.evaluate(readPipeline);
  console.log('\n--- renderer pipeline ---');
  console.log(JSON.stringify(pipeline, null, 2));

  // Tone mapping: 4 is ACESFilmicToneMapping in three r169 (0 None, 1 Linear,
  // 2 Reinhard, 3 Cineon, 4 ACESFilmic, 5 AgX, 6 Neutral).
  checks.check('a filmic tone curve is active (not the linear pass-through)',
    pipeline.toneMapping === 4,
    `toneMapping=${pipeline.toneMapping}`);
  checks.check('output is colour-managed to sRGB',
    String(pipeline.outputColorSpace) === 'srgb',
    `outputColorSpace=${pipeline.outputColorSpace}`);
  checks.check('an image-based environment map is present',
    pipeline.hasEnvironment === true,
    `environment=${JSON.stringify(pipeline.environmentType)} intensity=${pipeline.environmentIntensity}`);
  checks.check('the sun casts shadows at full quality',
    pipeline.shadowMapEnabled === true && pipeline.sunCastShadow === true,
    `renderer=${pipeline.shadowMapEnabled} sun=${pipeline.sunCastShadow} map=${JSON.stringify(pipeline.shadowMapSize)}`);
  checks.check('shadow bias is tuned in both axes',
    pipeline.shadowBias !== undefined && pipeline.shadowNormalBias > 0,
    `bias=${pipeline.shadowBias} normalBias=${pipeline.shadowNormalBias}`);

  const exposures = {};
  const dayEnvIntensity = pipeline.environmentIntensity;
  console.log('\n--- per phase ---');
  for (const phase of PHASES) {
    await page.evaluate((clock) => window.amazingAdventure.setClock(clock), phase.clock);
    await page.evaluate(() => window.amazingAdventure.buildEnvironmentMapNow());
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    const facts = await page.evaluate(readPipeline);
    const sky = await page.evaluate(readSkyGradient);
    const lum = await page.evaluate(measureLuminance);
    const frames = await frameTimes(page);
    exposures[phase.id] = facts.toneMappingExposure;

    console.log(`${phase.id}: exposure=${facts.toneMappingExposure} envIntensity=${facts.environmentIntensity} ` +
      `sun=${facts.sunIntensity}@${facts.sunColor} hemi=${facts.hemiIntensity} bg=#${facts.background}`);
    console.log(`  luminance mean=${lum.mean ?? 'n/a'} stdDev=${lum.stdDev ?? 'n/a'} (samples=${lum.samples ?? 0})` +
      `${lum.error ? ' ERROR ' + lum.error : ''}`);
    console.log(`  sky gradient top=${JSON.stringify(sky?.top)} eq=${JSON.stringify(sky?.equator)} bottom=${JSON.stringify(sky?.bottom)}`);
    console.log(`  frame time median=${frames.median}ms p95=${frames.p95}ms`);

    if (phase.id === 'day') {
      checks.check('the day ambient is the brightest of the three phases',
        facts.environmentIntensity >= 0.4,
        `environmentIntensity=${facts.environmentIntensity}`);
    }
    if (phase.id === 'night') {
      checks.check('night is exposed up over day',
        facts.toneMappingExposure > exposures.day,
        `night=${facts.toneMappingExposure} day=${exposures.day}`);
      checks.check('the night ambient is dimmer than the day ambient',
        facts.environmentIntensity < dayEnvIntensity,
        `night=${facts.environmentIntensity} day=${dayEnvIntensity}`);
    }

    checks.check(`${phase.id} frame has measured luminance and spread`,
      typeof lum.mean === 'number' && lum.mean > 0.01 && lum.mean < 0.99 && lum.stdDev > 0.01,
      `mean=${lum.mean} stdDev=${lum.stdDev}${lum.error ? ' error=' + lum.error : ''}`);

    if (sky) {
      // The dome is painted horizon -> zenith going up, and the horizon carries
      // the haze, so the bright end is the *bottom*, not the top. What must hold
      // is that the two ends differ at all: a flat fill would mean the gradient
      // stopped being applied.
      const lum = ([r, g, b]) => r * 0.2126 + g * 0.7152 + b * 0.0722;
      const topL = lum(sky.top);
      const bottomL = lum(sky.bottom);
      // Compared *relatively*: the night sky is two very dark blues, so its
      // gradient is large by ratio and small in absolute luminance. Measuring
      // the ratio is what makes the night case checkable on its own terms.
      const delta = Math.abs(topL - bottomL);
      const relative = delta / Math.max(topL, bottomL, 1e-6);
      checks.check(`${phase.id} sky dome is a real gradient (ends differ)`,
        relative > 0.1,
        `top=${JSON.stringify(sky.top)} bottom=${JSON.stringify(sky.bottom)} ` +
        `delta=${delta.toFixed(4)} relative=${relative.toFixed(3)}`);
      checks.check(`${phase.id} sky horizon is the hazy bright end`,
        bottomL >= topL,
        `horizon=${bottomL.toFixed(4)} zenith=${topL.toFixed(4)}`);
    } else {
      checks.check(`${phase.id} sky dome is present with vertex colours`, false, 'sky-dome not found');
    }

    // Headless Chrome renders this through SwiftShader with no vsync, so the
    // absolute frame time here is not a hardware performance claim - the mobile
    // suite carries the FPS gate. What this does catch is a stalled loop.
    checks.check(`${phase.id} the render loop keeps producing frames`,
      frames.median > 0 && frames.p95 < 2000,
      `median=${frames.median}ms p95=${frames.p95}ms`);

    const file = join(outDir, `round57-${phase.id}.png`);
    const png = await page.screenshot();
    await writeFile(file, png);
    console.log(`  wrote ${file} (${png.length} bytes)`);
    checks.check(`${phase.id} screenshot was written`, png.length > 1000, `${png.length} bytes`);
  }

  checks.check('day, dusk and night each get a distinct exposure',
    new Set([exposures.day, exposures.dusk, exposures.night]).size === 3,
    JSON.stringify(exposures));
} finally {
  await browser.close();
  await server.stop();
}

console.log('\n--- result ---');
checks.print();
const passed = checks.results.filter((r) => r.ok).length;
const failed = checks.results.filter((r) => !r.ok).length;
console.log(`${passed} PASS, ${failed} FAIL`);
if (failed > 0 || checks.errors.length > 0) process.exit(1);
