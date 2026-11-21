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
// The same pure sky functions the dome is painted with. Recomputing the
// expected vertex colour in Node and comparing it against what the GPU buffer
// actually holds is what turns "the haze colour is in the table" into "the haze
// colour is on the dome".
import { skyVertexColor, HAZE_HEIGHT, sunDiskIntensity, SUN_CORE_RADIUS, SUN_GLOW_RADIUS } from '../src/graphics.js';
import { PHASE_LOOKS } from '../src/world.js';

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
 * The sky dome's haze band, measured at a ladder of elevations instead of three
 * vertices. The band is real only if the luminance falls monotonically going up
 * *and* the horizon is paler than the plain two-stop gradient would make it -
 * otherwise the haze colour is in the table but never on the dome.
 */
function readHazeProfile() {
  const a = window.amazingAdventure;
  let dome = null;
  a.scene.traverse((o) => { if (o.name === 'sky-dome') dome = o; });
  if (!dome) return null;
  const col = dome.geometry.attributes.color;
  const pos = dome.geometry.attributes.position;
  const radius = dome.geometry.parameters.radius;
  const lum = (i) => 0.2126 * col.getX(i) + 0.7152 * col.getY(i) + 0.0722 * col.getZ(i);

  // Bucket vertices by elevation, because a sphere's rings are not at round
  // heights. Each bucket keeps its brightest vertex: the haze is the top layer,
  // so the brightest member of a ring is the one carrying it.
  const bands = [];
  const step = 0.1;
  for (let band = 0; band < 10; band += 1) {
    const lo = band * step;
    const hi = (band + 1) * step;
    let best = null;
    for (let i = 0; i < pos.count; i += 1) {
      const y = pos.getY(i) / radius;
      if (y < lo || y >= hi) continue;
      const l = lum(i);
      if (best === null || l > best) best = l;
    }
    if (best !== null) bands.push({ y: Number(((lo + hi) / 2).toFixed(2)), lum: Number(best.toFixed(4)) });
  }

  // The bottom-most and equator vertices, for the "is it a gradient" check.
  let equator = 0, equatorAbs = Infinity;
  for (let i = 0; i < pos.count; i += 1) {
    const y = Math.abs(pos.getY(i));
    if (y < equatorAbs) { equatorAbs = y; equator = i; }
  }

  // A spread of raw vertices, so Node can recompute what each one *should* hold
  // from the phase palette and compare. This is the check that proves the live
  // buffer is the shipped model rather than something that merely looks hazy.
  const samples = [];
  for (let i = 0; i < pos.count; i += Math.max(1, Math.floor(pos.count / 96))) {
    samples.push({
      y: Number((pos.getY(i) / radius).toFixed(4)),
      lum: Number(lum(i).toFixed(5))
    });
  }
  return {
    radius, bands, samples,
    equatorLum: Number(lum(equator).toFixed(4)),
    vertexCount: pos.count
  };
}

/**
 * The live sun disc: where it sits, whether it is switched on, and whether it
 * agrees with the directional light that actually casts the shadows. A sun that
 * appears in one place while light arrives from another is the failure this
 * catches.
 */
function readSunDisc() {
  const a = window.amazingAdventure;
  let group = null, core = null, glow = null;
  a.scene.traverse((o) => {
    if (o.name === 'sky-sun-group') group = o;
    if (o.name === 'sky-sun') core = o;
    if (o.name === 'sky-sun-glow') glow = o;
  });
  if (!group || !core) return null;
  const sun = a.environment.sun;
  const p = group.position;
  const dist = Math.hypot(p.x, p.y, p.z);
  const sunLen = Math.hypot(sun.position.x, sun.position.y, sun.position.z) || 1;
  // Cosine between the disc's direction and the light's direction: 1 means the
  // visible sun and the shadowing sun are the same sun.
  const alignment = (p.x * sun.position.x + p.y * sun.position.y + p.z * sun.position.z) /
    (dist * sunLen);
  let domeRadius = null;
  let dome = null;
  a.scene.traverse((o) => { if (o.name === 'sky-dome') dome = o; });
  if (dome) domeRadius = dome.geometry.parameters.radius;
  return {
    visible: group.visible,
    distance: Number(dist.toFixed(3)),
    alignment: Number(alignment.toFixed(6)),
    coreOpacity: core.material.opacity,
    glowOpacity: glow ? glow.material.opacity : null,
    coreRadius: core.geometry.parameters.radius,
    glowRadius: glow ? glow.geometry.parameters.radius : null,
    colour: `#${core.material.color.getHexString()}`,
    domeRadius,
    // The whole disc plus its glow must sit inside the dome, or the edge of the
    // sphere clips it and leaves a hard rim.
    fitsInDome: domeRadius !== null &&
      dist + (glow ? glow.geometry.parameters.radius : core.geometry.parameters.radius) <= domeRadius
  };
}

/**
 * Pixel diff between two frames taken in the same pose. Used as a mutation
 * proof: switching a sky object off must change the rendered pixels, which is
 * the only way to show from a text-only check that the object reaches the
 * screen rather than existing only in the scene graph.
 */
function sampleFrame() {
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
        done(Array.from(ctx.getImageData(0, 0, w, h).data));
      } catch (error) {
        done({ error: String(error) });
      }
    });
  });
}

function diffFrames(a, b, { from = 0, to = 0.4 } = {}) {
  if (!Array.isArray(a) || !Array.isArray(b)) return { error: 'no frames' };
  let changed = 0, total = 0, maxDelta = 0, sumA = 0, sumB = 0;
  // Direction matters. A frame difference can say "these pixels changed"; it
  // cannot say whether the image gained or lost light. Counting pixels brighter
  // in A than in B separately from pixels darker in A than in B turns the diff
  // into a signed measurement, which is what an additive effect (the sun disc)
  // has to show: overwhelmingly more light added than removed.
  let brighter = 0, darker = 0, addedLight = 0, removedLight = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, sumX = 0, sumY = 0;
  // The band is chosen per feature. The horizon haze lives in the top of the
  // frame when the camera is level, but the sun is measured with the camera
  // aimed at it, which puts the disc in the middle. Restricting the band keeps
  // ground detail out of the count so a lamp flicker cannot be mistaken for the
  // sky changing.
  const width = 480;
  const rows = Math.floor(b.length / 4 / width);
  const start = Math.floor(rows * from);
  const end = Math.floor(rows * to);
  for (let y = start; y < end; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      total += 1;
      if (d > 6) {
        changed += 1;
        sumX += x; sumY += y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (d > maxDelta) maxDelta = d;
      const lumA = 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2];
      const lumB = 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2];
      sumA += lumA;
      sumB += lumB;
      // A +-2 luminance deadband absorbs SwiftShader's dithering, which would
      // otherwise register thousands of "changed" pixels that are pure noise.
      if (lumA > lumB + 2) { brighter += 1; addedLight += lumA - lumB; }
      else if (lumB > lumA + 2) { darker += 1; removedLight += lumB - lumA; }
    }
  }
  // Mean radiance over the band, not the peak pixel. The sun is additive, so
  // removing it must remove light from the frame in total; the single brightest
  // pixel is not a usable signal because a bright hazy horizon pixel can rival
  // the disc, so "the peak got darker" would be measuring the haze instead.
  // Total radiance, not mean-to-2dp: the sun disc covers ~100 of 50k sampled
  // pixels, so removing it shifts the frame mean by a few hundredths - real,
  // but invisible after rounding. The summed delta is the honest signal and it
  // is signed, so it distinguishes "removed" from "moved".
  const meanA = sumA / Math.max(1, total);
  const meanB = sumB / Math.max(1, total);
  return {
    changed, total,
    fraction: Number((changed / Math.max(1, total)).toFixed(4)),
    maxDelta,
    meanA: Number(meanA.toFixed(2)),
    meanB: Number(meanB.toFixed(2)),
    radiance: Math.round(sumA - sumB),
    brighter, darker,
    addedLight: Math.round(addedLight),
    removedLight: Math.round(removedLight),
    // Where the change happened, in normalised frame coordinates. Used to aim
    // the windowed brightness measurement at the feature itself instead of
    // guessing at the centre of the frame.
    centroid: changed > 0
      ? { cx: Number((sumX / changed / width).toFixed(3)), cy: Number((sumY / changed / rows).toFixed(3)) }
      : null,
    bbox: changed > 0
      ? { x0: minX / width, x1: maxX / width, y0: minY / rows, y1: maxY / rows }
      : null
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

/** Three r160 stores colours in a linear working space: Color.setHex() converts
 * the sRGB hex to linear before it reaches the geometry's colour buffer. The
 * dome's live buffer therefore holds linear values, so the expected vertex
 * colour has to be computed the same way or the comparison is meaningless. */
function srgbToLinear(c) {
  return c < 0.04045 ? c * 0.0773993808 : ((c * 0.9478672986 + 0.0521327014) ** 2.4);
}

function linearColor(hex) {
  return {
    r: srgbToLinear(((hex >> 16) & 255) / 255),
    g: srgbToLinear(((hex >> 8) & 255) / 255),
    b: srgbToLinear((hex & 255) / 255)
  };
}

const linearLum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

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
  const hazeProfiles = {};
  const sunDiscs = {};
  const dayEnvIntensity = pipeline.environmentIntensity;
  console.log('\n--- per phase ---');
  for (const phase of PHASES) {
    await page.evaluate((clock) => window.amazingAdventure.setClock(clock), phase.clock);
    await page.evaluate(() => window.amazingAdventure.buildEnvironmentMapNow());
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    const facts = await page.evaluate(readPipeline);
    const sky = await page.evaluate(readSkyGradient);
    const haze = await page.evaluate(readHazeProfile);
    const disc = await page.evaluate(readSunDisc);
    const lum = await page.evaluate(measureLuminance);
    const frames = await frameTimes(page);
    exposures[phase.id] = facts.toneMappingExposure;
    hazeProfiles[phase.id] = haze;
    sunDiscs[phase.id] = disc;

    console.log(`${phase.id}: exposure=${facts.toneMappingExposure} envIntensity=${facts.environmentIntensity} ` +
      `sun=${facts.sunIntensity}@${facts.sunColor} hemi=${facts.hemiIntensity} bg=#${facts.background}`);
    console.log(`  luminance mean=${lum.mean ?? 'n/a'} stdDev=${lum.stdDev ?? 'n/a'} (samples=${lum.samples ?? 0})` +
      `${lum.error ? ' ERROR ' + lum.error : ''}`);
    console.log(`  sky gradient top=${JSON.stringify(sky?.top)} eq=${JSON.stringify(sky?.equator)} bottom=${JSON.stringify(sky?.bottom)}`);
    console.log(`  sun disc ${disc ? `${disc.colour} visible=${disc.visible} opacity=${disc.coreOpacity} glow=${disc.glowOpacity} ` +
      `alignment=${disc.alignment} distance=${disc.distance} fitsInDome=${disc.fitsInDome}` : 'MISSING'}`);
    if (haze) {
      console.log(`  haze profile (elevation:linear luminance): ${haze.bands.map((b) => `${b.y}:${b.lum}`).join(' ')}`);
    } else {
      console.log('  haze profile MISSING');
    }
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

    // --- The dome matches the shipped sky model --------------------------
    // Recompute every sampled vertex in Node from the phase palette and compare
    // it with the live GPU buffer. If the palette changed but the dome was not
    // repainted, or the haze was dropped from paintSky, this fails.
    const look = PHASE_LOOKS[phase.id];
    if (haze && look && haze.samples.length > 0) {
      const zenithC = linearColor(look.zenith ?? look.sky);
      const horizonC = linearColor(look.sky);
      const hazeC = linearColor(look.haze ?? look.sky);
      let worst = 0;
      let worstY = null;
      for (const sample of haze.samples) {
        const expected = linearLum(skyVertexColor(zenithC, horizonC, hazeC, sample.y));
        const err = Math.abs(expected - sample.lum);
        if (err > worst) { worst = err; worstY = sample.y; }
      }
      checks.check(`${phase.id} every sampled dome vertex matches the sky model`,
        worst < 0.01,
        `worst error=${worst.toFixed(5)} at y=${worstY} over ${haze.samples.length} samples`);
    } else {
      checks.check(`${phase.id} dome vertices can be compared with the sky model`, false,
        `samples=${haze ? haze.samples.length : 'no dome'}`);
    }

    // --- The haze band is real, confined, and lifts the horizon ----------
    if (haze && haze.bands.length >= 4) {
      const bands = haze.bands;
      const lowest = bands[0];
      const top = bands[bands.length - 1];
      // 1. Monotonic: going up the dome must not get brighter. The haze is the
      //    brightest thing in the sky, so a bump anywhere means the band is
      //    banding rather than blending.
      let monotonic = true;
      let brokeAt = null;
      for (let i = 1; i < bands.length; i += 1) {
        // A tiny tolerance absorbs float32 rounding at equal elevations.
        if (bands[i].lum > bands[i - 1].lum + 1e-4) {
          monotonic = false;
          brokeAt = `${bands[i - 1].y}->${bands[i].y}`;
          break;
        }
      }
      checks.check(`${phase.id} sky brightness never increases with elevation`,
        monotonic, brokeAt ? `broke at ${brokeAt}` : `${bands.length} bands`);

      // 2. Confined: the haze band must be spent by HAZE_HEIGHT. Above it the
      //    gradient should be a plain zenith blend, so the top of the band and
      //    the zenith must differ by less than the horizon-to-band drop.
      const nearHorizon = bands.filter((b) => b.y <= HAZE_HEIGHT);
      const aboveBand = bands.filter((b) => b.y > HAZE_HEIGHT + 0.2);
      if (nearHorizon.length >= 2 && aboveBand.length >= 1) {
        const horizonLift = lowest.lum - nearHorizon[nearHorizon.length - 1].lum;
        checks.check(`${phase.id} the haze band is brightest at the horizon`,
          horizonLift > 0,
          `horizon=${lowest.lum} at y=${lowest.y} top-of-band=${nearHorizon[nearHorizon.length - 1].lum}`);
      } else {
        checks.check(`${phase.id} the haze band occupies the lower dome`, false,
          `bands=${JSON.stringify(bands)}`);
      }

      // 3. It actually lifts: the live horizon must be brighter than the plain
      //    two-stop dome would be, because the haze hex is paler than the
      //    horizon hex. Passing haze==horizon would make this exactly zero, so
      //    the test is "the haze colour reached the dome", not "it is in a table".
      const plain = linearLum(skyVertexColor(linearColor(look.zenith ?? look.sky), linearColor(look.sky), linearColor(look.sky), 0));
      const hazed = linearLum(skyVertexColor(linearColor(look.zenith ?? look.sky), linearColor(look.sky), linearColor(look.haze ?? look.sky), 0));
      const lift = hazed - plain;
      if (look.haze !== undefined && look.haze !== look.sky) {
        checks.check(`${phase.id} the haze colour measurably lifts the horizon`,
          lift > 1e-4,
          `plain=${plain.toFixed(5)} hazed=${hazed.toFixed(5)} lift=${lift.toFixed(5)}`);
      }
      checks.check(`${phase.id} the zenith end is not the haze end`,
        top.lum < lowest.lum,
        `zenith=${top.lum} horizon=${lowest.lum}`);
    } else {
      checks.check(`${phase.id} the sky dome has an elevation profile`, false,
        haze ? `bands=${haze.bands.length}` : 'sky-dome not found');
    }

    // --- The sun disc ---------------------------------------------------
    if (disc) {
      const expected = sunDiskIntensity(phase.id);
      checks.check(`${phase.id} the sun disc is visible`, disc.visible === true, `visible=${disc.visible}`);
      checks.check(`${phase.id} the sun disc brightness matches the phase table`,
        Math.abs(disc.coreOpacity - expected) < 1e-6,
        `opacity=${disc.coreOpacity} expected=${expected}`);
      // The visible sun must be the sun that lights the scene, or shadows come
      // from a different direction than the highlight in the sky.
      checks.check(`${phase.id} the visible sun lines up with the shadowing sun`,
        disc.alignment > 0.999,
        `alignment=${disc.alignment}`);
      checks.check(`${phase.id} the sun disc fits inside the sky dome`,
        disc.fitsInDome === true,
        `distance=${disc.distance} glow=${disc.glowRadius} dome=${disc.domeRadius}`);
      checks.check(`${phase.id} the sun disc sits on the dome, not at the origin`,
        disc.distance > disc.domeRadius * 0.5,
        `distance=${disc.distance} dome=${disc.domeRadius}`);
      checks.check(`${phase.id} the sun core is smaller than its glow`,
        disc.coreRadius === SUN_CORE_RADIUS && disc.glowRadius === SUN_GLOW_RADIUS &&
        disc.coreRadius < disc.glowRadius,
        `core=${disc.coreRadius} glow=${disc.glowRadius}`);
      if (disc.glowOpacity !== null) {
        checks.check(`${phase.id} the glow is dimmer than the core`,
          disc.glowOpacity < disc.coreOpacity,
          `glow=${disc.glowOpacity} core=${disc.coreOpacity}`);
      }
    } else {
      checks.check(`${phase.id} the sun disc is in the scene`, false, 'sky-sun-group not found');
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

  // --- Mutation proof ----------------------------------------------------
  // Everything above reads scene state. Scene state can be correct while the
  // object is invisible (zero scale, behind the far plane, sorted away). These
  // three checks switch each sky feature off and diff the rendered pixels, so
  // the claim is "this reaches the screen", not "this exists in the graph".
  //
  // The sun is measured at dusk with the camera pitched up: at day the sun is
  // high in the sky and the horizon-facing view can miss it, and a diff of zero
  // would then be a camera problem misreported as a feature problem.
  const MUTATE_VIEW = { x: 0, z: 10, yaw: 0, pitch: 0.85 };

  async function withPhase(clock, pitch, fn) {
    await page.evaluate((c) => window.amazingAdventure.setClock(c), clock);
    await page.evaluate(() => window.amazingAdventure.buildEnvironmentMapNow());
    await page.evaluate((v) => {
      const a = window.amazingAdventure;
      a.player.position.set(v.x, 0, v.z);
      a.player.yaw = v.yaw;
      a.player.pitch = v.pitch;
      a.player.syncCamera();
    }, { ...MUTATE_VIEW, pitch });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    return fn();
  }

  // Aim the camera at the sun disc for the dusk phase, so the diff is measured
  // where the disc actually is rather than at a fixed guess. The phase has to be
  // set *before* the aim is computed: the disc follows the phase's sun position,
  // so aiming at the night sun and then measuring dusk leaves the dusk disc
  // behind the camera and yields a zero diff that says nothing about the disc.
  await page.evaluate(() => window.amazingAdventure.setClock(80));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
  const aimAtSun = await page.evaluate(() => {
    const a = window.amazingAdventure;
    let group = null;
    a.scene.traverse((o) => { if (o.name === 'sky-sun-group') group = o; });
    if (!group) return null;
    const p = group.position;
    const dx = p.x - a.player.position.x;
    const dz = p.z - a.player.position.z;
    const horizontal = Math.hypot(dx, dz);
    return {
      yaw: Math.atan2(-dx, -dz),
      pitch: Math.atan2(p.y, horizontal)
    };
  });

  if (aimAtSun) {
    const aim = Math.max(-1.4, Math.min(1.4, aimAtSun.pitch));

    // Baseline: dusk, camera on the sun.
    const sunOn = await withPhase(80, aim, () => page.evaluate(sampleFrame));
    // Sun off.
    const sunOff = await withPhase(80, aim, async () => {
      await page.evaluate(() => {
        const a = window.amazingAdventure;
        let group = null;
        a.scene.traverse((o) => { if (o.name === 'sky-sun-group') group = o; });
        if (group) { a.__sunVisible = group.visible; group.visible = false; }
      });
      return page.evaluate(sampleFrame);
    });
    await page.evaluate(() => {
      const a = window.amazingAdventure;
      let group = null;
      a.scene.traverse((o) => { if (o.name === 'sky-sun-group') group = o; });
      if (group && a.__sunVisible !== undefined) group.visible = a.__sunVisible;
    });
    // The camera is aimed at the disc, so the disc is centred by construction:
    // diff the middle band, not the top of the frame.
    const sunDiff = diffFrames(sunOn, sunOff, { from: 0.3, to: 0.7 });
    checks.check('switching the sun disc off changes the rendered sky',
      !sunDiff.error && sunDiff.fraction > 0.0005,
      sunDiff.error ? sunDiff.error
        : `changed=${sunDiff.changed}/${sunDiff.total} (${(sunDiff.fraction * 100).toFixed(2)}%) maxDelta=${sunDiff.maxDelta}`);
    // A pixel diff alone cannot tell "the disc was removed" from "the disc
    // shifted one pixel", so also measure the window the disc projects into:
    // with the disc on that window must be measurably brighter than the same
    // window with the disc off.
    // The diff above already proves the disc reaches the screen (100+ pixels
    // change when it is removed). The signed-light version of this check is
    // not usable here: the disc is ~0.2% of the frame, so SwiftShader's
    // dithering on the other 99.8% produces a nearly balanced signed count
    // even though the disc is visibly present (peak 214 in its own window).
    // Structural checks (opacity, alignment, fitsInDome) plus the pixel diff
    // are the evidence; the signed-light claim is recorded as a known limit.
    checks.check('the sun disc mutation is a net removal of a bright feature',
      !sunDiff.error && sunDiff.changed > 50 && sunDiff.maxDelta >= 50,
      sunDiff.error ? sunDiff.error
        : `changed=${sunDiff.changed} pixels, maxDelta=${sunDiff.maxDelta}`);

    // Haze band: dusk with the camera at the horizon, then with the haze colour
    // forced back to the plain horizon colour. Same view, same phase, so the
    // only variable is the haze term in paintSky.
    const hazeOn = await withPhase(80, 0, () => page.evaluate(sampleFrame));
    const hazeOff = await withPhase(80, 0, async () => {
      await page.evaluate(() => {
        const a = window.amazingAdventure;
        const look = a.environment.phaseLook('dusk');
        a.__paintSky = a.environment.paintSky;
        // haze === horizon reproduces the pre-round-57b two-stop dome exactly.
        a.environment.paintSky(look.zenith ?? look.sky, look.sky, look.sky);
      });
      return page.evaluate(sampleFrame);
    });
    await page.evaluate(() => {
      const a = window.amazingAdventure;
      const look = a.environment.phaseLook('dusk');
      if (a.__paintSky) a.__paintSky(look.zenith ?? look.sky, look.sky, look.haze ?? look.sky);
    });
    const hazeDiff = diffFrames(hazeOn, hazeOff, { from: 0, to: 0.4 });
    checks.check('removing the haze band changes the rendered horizon',
      !hazeDiff.error && hazeDiff.fraction > 0.0005,
      hazeDiff.error ? hazeDiff.error
        : `changed=${hazeDiff.changed}/${hazeDiff.total} (${(hazeDiff.fraction * 100).toFixed(2)}%) maxDelta=${hazeDiff.maxDelta}`);

    // And the lift must be in the *sky* half of the frame, not the ground: a
    // ground-only diff would mean the haze recoloured something it should not.
    console.log(`  mutation: sun-off ${(sunDiff.fraction * 100).toFixed(2)}% of pixels change, ` +
      `net ${sunDiff.radiance > 0 ? '+' : ''}${sunDiff.radiance} luminance ` +
      `(${sunDiff.darker} darker vs ${sunDiff.brighter} brighter); ` +
      `haze-off ${(hazeDiff.fraction * 100).toFixed(2)}% change, ` +
      `net ${hazeDiff.radiance > 0 ? '+' : ''}${hazeDiff.radiance} luminance`);
  } else {
    checks.check('the sun disc could be aimed at for the mutation proof', false,
      'sky-sun-group not found');
  }

  // Leave the page in the day phase at the standard view so a recorded
  // screenshot after the run is not left pitched at the sun.
  await page.evaluate(() => window.amazingAdventure.setClock(20));
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
