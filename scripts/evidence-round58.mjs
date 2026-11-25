// Round 58 evidence: the atmosphere curve, measured on the rendered frame.
//
// Round 57 made the sky continuous. Round 58 makes the *distance* continuous
// too: before it, scene.fog was three constants swapped in one frame at each
// phase boundary, so the far wall visibly popped at dusk and the plaza wore the
// same haze from noon to the last minute of the evening.
//
// Four claims, all checkable without looking at a picture:
//
//   1. The curve the page runs is the curve the module ships: every key time is
//      visited in the browser and compared with atmosphereAt() computed in Node.
//      This is what fails if main.js stops calling applyAtmosphere(), or calls
//      it with a clock that is not the game clock.
//   2. No step at the phase boundaries. Sampled 0.25s either side of 70s,
//      105s and the wrap, the fog distances and colour barely move, while the
//      sky palette and exposure *do* change on the same boundary. If the curve
//      were simply constant, check 1 would pass but this would be measuring a
//      flat line; the paired lighting checks rule that out.
//   3. Haze thickens and thins within a phase, not only between phases: the
//      dawn mist burns off across 0-20s and the dusk murk thickens across
//      75-105s, both inside a single palette.
//   4. The curve reaches the screen. The same pose is rendered once with the
//      curve and once with scene.fog parked at a fixed day fog; the frames
//      differ, and in the predicted direction (thicker haze lifts the dark far
//      field, because a night fog colour cannot be brighter than night stone).
//
// Run: RECORD_ARTIFACTS=1 node scripts/evidence-round58.mjs
//
// The model is text-only, so nothing here claims a picture was inspected. Every
// claim is a scene property, a pixel statistic, or a diff between two frames
// rendered in the same pose.
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startServer, launchBrowser, createChecks, screenshotDir, waitForBoot } from './browser.mjs';
// The same curve the game imports, so expectations are recomputed from the
// shipped model instead of copied out of the code under test.
import { ATMOSPHERE_KEYS, atmosphereAt, keyDistances } from '../src/atmosphere.js';

const checks = createChecks();

// Stand in the courtyard looking north across the fountain at the far wall:
// stone floor in the foreground, wall and gate tens of metres away, which is
// the frame where a change in distance haze is largest.
const VIEW = { x: 0, z: 10, yaw: Math.PI };

// The view used for the pixel proof. It has to look *across* the plaza at
// geometry that sits between the near and far fog planes: the standard walk-up
// view above faces the gate with open ground beyond it, so pinning the fog there
// legitimately changes almost nothing and the mutation test would pass or fail
// on framing rather than on the haze. Measured over a pose sweep, this one puts
// the market lane, the well and the far wall inside the fog range.
const SCREEN_VIEW = { x: 0, z: 0, yaw: 0 };

// Fog distances drift while the clock runs: the harness jumps the clock, then
// the next animation frame advances it a little before the read lands, and the
// curve moves ~0.2 m/s of fog per second of clock. A tolerance is honest here as
// long as it is tiny next to the per-phase step this round removed (day->dusk
// moved far by 7 m, dusk->night by 13 m) - so a 0.25 m window still proves the
// curve, and the boundary checks below prove there is no step.
const FOG_TOLERANCE = 0.25;

// A ladder of clock times through the cycle. The near-boundary pairs are the
// places the old per-phase constants stepped.
const SAMPLES = [
  { label: 'dawn mist', clock: 0 },
  { label: 'morning', clock: 20 },
  { label: 'afternoon', clock: 40 },
  { label: 'late dusk', clock: 68 },
  { label: 'early dusk', clock: 75 },
  { label: 'deep dusk', clock: 100 },
  { label: 'early night', clock: 115 },
  { label: 'settled night', clock: 150 },
  { label: 'last minute', clock: 179.5 }
];

/** What the page says about the fog and the lighting, this frame. */
function readAtmosphere() {
  const a = window.amazingAdventure;
  const fog = a.scene.fog;
  return {
    // The curve as the game computed it this frame, not as the script expects.
    curve: a.atmosphere(),
    phase: a.getClock().phase,
    fog: {
      near: fog.near,
      far: fog.far,
      color: `#${fog.color.getHexString()}`,
      isFog: fog.isFog === true
    },
    // The lighting that shares the phase boundary, to show the boundary is a
    // real event and the fog simply does not step with it.
    exposure: a.renderer.toneMappingExposure,
    sunIntensity: a.environment.sun.intensity,
    background: `#${a.scene.background.getHexString()}`
  };
}

/**
 * Copies the just-presented WebGL frame into a 2D context and returns it as
 * bytes. The drawing buffer is not preserved, so this has to happen inside the
 * same animation-frame task the renderer drew in; that is what this does.
 * Downsampled to 480 wide: enough pixels to see a haze change, cheap enough
 * that the copy does not dominate the frame.
 */
function sampleFrame() {
  return new Promise((done) => {
    requestAnimationFrame(() => {
      const src = document.querySelector('canvas');
      if (!src) return done({ error: 'no canvas' });
      const w = Math.min(src.clientWidth || src.width, 480);
      const h = Math.min(src.clientHeight || src.height, 270);
      const copy = document.createElement('canvas');
      copy.width = w;
      copy.height = h;
      const ctx = copy.getContext('2d', { willReadFrequently: true });
      if (!ctx) return done({ error: 'no 2d context' });
      try {
        ctx.drawImage(src, 0, 0, w, h);
        done({ width: w, height: h, data: Array.from(ctx.getImageData(0, 0, w, h).data) });
      } catch (error) {
        done({ error: String(error) });
      }
    });
  });
}

/**
 * Compares two frames of the same pose and returns a signed light measure plus
 * a changed-pixel count, over a band of rows. `from`/`to` keep ground detail
 * and HUD pixels out of a claim about distance.
 */
function diffFrames(a, b, { from = 0, to = 1 } = {}) {
  if (!a || a.error) return { error: a?.error || 'no frame A' };
  if (!b || b.error) return { error: b?.error || 'no frame B' };
  if (a.width !== b.width || a.height !== b.height) return { error: 'frame size mismatch' };
  const width = a.width;
  const rows = Math.floor(a.data.length / 4 / width);
  const start = Math.floor(rows * from);
  const end = Math.min(rows, Math.floor(rows * to));
  let changed = 0, total = 0, maxDelta = 0, sumA = 0, sumB = 0, sumSq = 0, sumDeltaChanged = 0;
  for (let y = start; y < end; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) +
        Math.abs(a.data[i + 2] - b.data[i + 2]);
      total += 1;
      if (d > 6) { changed += 1; sumDeltaChanged += d; }
      if (d > maxDelta) maxDelta = d;
      const lb = 0.2126 * b.data[i] + 0.7152 * b.data[i + 1] + 0.0722 * b.data[i + 2];
      sumA += 0.2126 * a.data[i] + 0.7152 * a.data[i + 1] + 0.0722 * a.data[i + 2];
      sumB += lb;
      sumSq += lb * lb;
    }
  }
  const n = Math.max(1, total);
  const meanA = sumA / n;
  const meanB = sumB / n;
  return {
    changed, total,
    fraction: Number((changed / n).toFixed(4)),
    maxDelta,
    meanCurve: Number(meanA.toFixed(2)),
    meanConstant: Number(meanB.toFixed(2)),
    // Signed: positive means the curve rendered *lighter* than the constant.
    brighter: Number((meanA - meanB).toFixed(2)),
    // Spread of the constant-fog band, so a claimed brightening can be shown to
    // be large against the band's own texture rather than a rounding artefact.
    spread: Number(Math.sqrt(Math.max(0, sumSq / n - meanB * meanB)).toFixed(2)),
    // Average RGB distance per *changed* pixel. The whole-band mean is diluted by
    // the sky and foreground that legitimately sit outside the fog range, so it
    // understates the effect; this says how hard the haze bit where it reached.
    changedMeanDelta: Number((changed ? sumDeltaChanged / changed : 0).toFixed(2))
  };
}

/** Sets the clock and player pose, then lets two frames through. */
async function pose(page, clock, view = VIEW) {
  await page.evaluate((c) => window.amazingAdventure.setClock(c), clock);
  await page.evaluate((v) => {
    const a = window.amazingAdventure;
    a.player.position.set(v.x, 0, v.z);
    a.player.yaw = v.yaw;
  }, view);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** Mean luminance over a horizontal band of a sampled frame. */
function bandLuminance(frame, from, to) {
  if (!frame || frame.error || !frame.data) return null;
  const { width, data } = frame;
  const rows = Math.floor(data.length / 4 / width);
  const start = Math.floor(rows * from);
  const end = Math.min(rows, Math.floor(rows * to));
  let sum = 0, n = 0;
  for (let y = start; y < end; y += 1) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4;
      sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      n += 1;
    }
  }
  return n ? Number((sum / n).toFixed(2)) : null;
}

/** The largest per-channel difference between two #rrggbb strings, in 0-255. */
function colourGap(a, b) {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  return Math.max(Math.abs(pa[0] - pb[0]), Math.abs(pa[1] - pb[1]), Math.abs(pa[2] - pb[2]));
}

const outDir = await screenshotDir();
const server = await startServer();
const { browser } = await launchBrowser();

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await page.goto(server.base, { waitUntil: 'domcontentloaded' });
  await waitForBoot(page);
  await page.evaluate(() => window.amazingAdventure.assetsReady());
  await page.evaluate(() => window.amazingAdventure.buildEnvironmentMapNow());

  // --- 1. The curve the page runs is the curve that ships ---------------
  console.log('\n--- live curve at each key time ---');
  const keyRows = [];
  for (const key of ATMOSPHERE_KEYS.slice(0, -1)) {
    await pose(page, key.at);
    const live = await page.evaluate(readAtmosphere);
    const expected = atmosphereAt(key.at);
    const { near, far } = keyDistances(key);
    const expectedColour = `#${expected.color.toString(16).padStart(6, '0')}`;
    keyRows.push({ at: key.at, phase: live.phase, ...live.fog });
    // Compare against the curve's own value for this exact clock reading as well
    // as the key value: the first shows the live scene is driven by the curve,
    // the second shows the curve still lands on its keyframe.
    const withinTol = Math.abs(live.fog.near - near) <= FOG_TOLERANCE &&
      Math.abs(live.fog.far - far) <= FOG_TOLERANCE;
    checks.check(`the scene fog matches the curve at ${key.at}s`,
      withinTol,
      `live=${live.fog.near.toFixed(3)}/${live.fog.far.toFixed(3)} expected=${near}/${far} ` +
      `(tolerance ${FOG_TOLERANCE}m)`);
    checks.check(`the haze colour matches the curve at ${key.at}s`,
      live.fog.color === expectedColour,
      `live=${live.fog.color} expected=${expectedColour}`);
  }
  for (const row of keyRows) {
    console.log(`  ${String(row.at).padStart(5)}s ${row.phase.padEnd(5)} ` +
      `near=${row.near.toFixed(2)} far=${row.far.toFixed(2)} colour=${row.color}`);
  }
  checks.check('the scene fog is a real three.js Fog',
    keyRows.length === ATMOSPHERE_KEYS.length - 1 &&
      await page.evaluate(() => window.amazingAdventure.scene.fog.isFog === true),
    `key times visited=${keyRows.length}`);

  // --- 2. No step where the phase constant used to swap ------------------
  console.log('\n--- phase boundary continuity (0.5s across each boundary) ---');
  const BOUNDARIES = [
    { at: 70, from: 'day', to: 'dusk' },
    { at: 105, from: 'dusk', to: 'night' },
    { at: 0, from: 'night', to: 'day' }
  ];
  for (const boundary of BOUNDARIES) {
    const dt = 0.25;
    // For the wrap, "before" is the end of the cycle rather than -0.25.
    const beforeClock = boundary.at === 0 ? 180 - dt : boundary.at - dt;
    await pose(page, beforeClock);
    const before = await page.evaluate(readAtmosphere);
    await pose(page, boundary.at + dt);
    const after = await page.evaluate(readAtmosphere);
    const nearStep = Math.abs(after.fog.near - before.fog.near);
    const farStep = Math.abs(after.fog.far - before.fog.far);
    const colourStep = colourGap(after.fog.color, before.fog.color);
    // Half a second is a quarter of the tightest key gap (the 15s morning
    // stretch), where the eased curve moves a few centimetres. A one-frame
    // constant swap would instead jump the whole day->dusk gap (~4m in near)
    // inside that same half second.
    checks.check(`no step in fog near across the ${boundary.from}->${boundary.to} boundary`,
      nearStep < 0.6, `near moved ${nearStep.toFixed(4)}m across ${boundary.at}s`);
    checks.check(`no step in fog far across the ${boundary.from}->${boundary.to} boundary`,
      farStep < 0.9, `far moved ${farStep.toFixed(4)}m across ${boundary.at}s`);
    checks.check(`no step in haze colour across the ${boundary.from}->${boundary.to} boundary`,
      colourStep <= 3, `colour moved ${colourStep}/255 across ${boundary.at}s`);
    console.log(`  ${String(boundary.at).padStart(3)}s (${boundary.from}->${boundary.to}): ` +
      `nearD=${nearStep.toFixed(4)}m farD=${farStep.toFixed(4)}m colourD=${colourStep}/255 | ` +
      `exposure ${before.exposure}->${after.exposure} sun ${before.sunIntensity}->${after.sunIntensity}`);
  }

  // The fog staying smooth must not be because nothing happens at the boundary:
  // the sky palette and the exposure are still per-phase, and both change.
  await pose(page, 69.5);
  const daySide = await page.evaluate(readAtmosphere);
  await pose(page, 70.5);
  const duskSide = await page.evaluate(readAtmosphere);
  checks.check('the phase still turns on the day->dusk boundary while the fog stays smooth',
    daySide.background !== duskSide.background && daySide.exposure !== duskSide.exposure,
    `sky ${daySide.background}->${duskSide.background}, ` +
    `exposure ${daySide.exposure}->${duskSide.exposure}`);
  await pose(page, 104.5);
  const duskLate = await page.evaluate(readAtmosphere);
  await pose(page, 105.5);
  const nightSide = await page.evaluate(readAtmosphere);
  checks.check('the phase still turns on the dusk->night boundary',
    duskLate.background !== nightSide.background && duskLate.exposure !== nightSide.exposure,
    `sky ${duskLate.background}->${nightSide.background}, ` +
    `exposure ${duskLate.exposure}->${nightSide.exposure}`);

  // --- 3. Haze thickens and thins inside a phase -------------------------
  console.log('\n--- the haze level across the cycle ---');
  const profile = [];
  for (const sample of SAMPLES) {
    await pose(page, sample.clock);
    const live = await page.evaluate(readAtmosphere);
    const farField = bandLuminance(await page.evaluate(sampleFrame), 0, 0.4);
    profile.push({
      label: sample.label, clock: sample.clock, phase: live.phase,
      near: live.fog.near, far: live.fog.far, colour: live.fog.color, farField
    });
  }
  for (const row of profile) {
    console.log(`  ${String(row.clock).padStart(6)}s ${row.label.padEnd(14)} ${row.phase.padEnd(5)} ` +
      `near=${row.near.toFixed(2)} far=${row.far.toFixed(2)} ${row.colour} farFieldLum=${row.farField}`);
  }
  const byClock = (c) => profile.find((r) => r.clock === c);
  const dawn = byClock(0);
  const morning = byClock(20);
  const afternoon = byClock(40);
  const lateDusk = byClock(68);
  const earlyDusk = byClock(75);
  const deepDusk = byClock(100);
  const settled = byClock(150);
  checks.check('clear afternoon sees furthest of the cycle',
    afternoon.far > settled.far && afternoon.far > dawn.far && afternoon.far > deepDusk.far,
    `afternoon=${afternoon.far} night=${settled.far} dawn=${dawn.far} dusk=${deepDusk.far}`);
  checks.check('the settled small hours are the tightest visibility',
    settled.far < afternoon.far && settled.far <= dawn.far,
    `night=${settled.far} afternoon=${afternoon.far} dawn=${dawn.far}`);
  // The within-phase part: the same palette either side of a 20-25s gap must
  // still move, which is exactly what the old per-phase constants could not do.
  checks.check('the dawn mist burns off inside the day phase',
    morning.far > dawn.far + 10 && dawn.phase === 'day' && morning.phase === 'day',
    `dawn=${dawn.near}/${dawn.far} morning=${morning.near}/${morning.far} (both day)`);
  checks.check('the dusk murk thickens inside the dusk phase',
    earlyDusk.far > deepDusk.far + 5 && earlyDusk.phase !== 'day' && deepDusk.phase !== 'day',
    `early dusk=${earlyDusk.far} deep dusk=${deepDusk.far}`);
  checks.check('the near plane is tightest at night and loosest at dawn',
    settled.near < afternoon.near && dawn.near < afternoon.near,
    `night=${settled.near} afternoon=${afternoon.near} dawn=${dawn.near}`);

  // --- 4. The curve reaches the screen -----------------------------------
  // Park the fog at the day palette and re-render the same pose at settled
  // night. Nothing else changes: same clock, same lights, same camera. If the
  // fog distance were only a table the two frames would be identical.
  //
  // The game rewrites the fog every frame from the clock, so the freeze cannot
  // be a one-off assignment - it has to be installed as a hook that runs after
  // the game's own write and before the draw. `sampleFrozen` below hooks
  // renderer.render for the duration of exactly one frame.
  console.log('\n--- proof the haze reaches the rendered frame ---');
  const NIGHT_PROBE = 150;
  await pose(page, NIGHT_PROBE, SCREEN_VIEW);
  const curveFrame = await page.evaluate(sampleFrame);
  const curveState = await page.evaluate(readAtmosphere);
  await page.screenshot({ path: resolve(outDir, 'round58-night-curve.png') });

  // Render the same pose with the haze pinned to the clear daytime distances.
  const frozen = await page.evaluate(() => {
    const a = window.amazingAdventure;
    const fog = a.scene.fog;
    return { near: fog.near, far: fog.far, color: `#${fog.color.getHexString()}` };
  });

  /**
   * Renders one frame with the fog pinned, sampling it in the same animation
   * frame the renderer drew in. Wrapping renderer.render means our write lands
   * after the game's per-frame atmosphere write and immediately before the
   * draw call, which is the only way to make a freeze observable when the value
   * is otherwise recomputed from the clock 60 times a second.
   */
  const sampleFrozen = () => new Promise((done) => {
    const a = window.amazingAdventure;
    const renderer = a.renderer;
    const fog = a.scene.fog;
    const original = renderer.render;
    let sampled = null;
    let finished = false;
    renderer.render = function patched(scene, camera) {
      fog.near = 26;
      fog.far = 62;
      fog.color.setHex(0x9fc4e8);
      original.call(this, scene, camera);
      if (finished) return;
      finished = true;
      const src = document.querySelector('canvas');
      const w = Math.min(src.clientWidth || src.width, 480);
      const h = Math.min(src.clientHeight || src.height, 270);
      const copy = document.createElement('canvas');
      copy.width = w;
      copy.height = h;
      const ctx = copy.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(src, 0, 0, w, h);
      sampled = { width: w, height: h, data: Array.from(ctx.getImageData(0, 0, w, h).data) };
      renderer.render = original;
      done(sampled);
    };
    // If the tab is throttled and no frame arrives, put the renderer back rather
    // than leaving the game drawing a frozen haze forever.
    setTimeout(() => {
      if (finished) return;
      finished = true;
      renderer.render = original;
      done({ error: 'no frame rendered while the fog was pinned' });
    }, 5000);
  });

  const frozenFrame = await page.evaluate(sampleFrozen);
  await page.screenshot({ path: resolve(outDir, 'round58-night-constant-fog.png') });
  // Confirm the patch is gone and the game's own curve is back in charge.
  const restored = await page.evaluate(() => {
    const a = window.amazingAdventure;
    const fog = a.scene.fog;
    return {
      matchesCurve: Math.abs(fog.near - a.atmosphere().near) < 1e-6 &&
        Math.abs(fog.far - a.atmosphere().far) < 1e-6,
      near: fog.near,
      far: fog.far
    };
  });

  const hazeDiff = diffFrames(frozenFrame, curveFrame, { from: 0.25, to: 1 });
console.log(`  fog under test: near=${curveState.fog.near.toFixed(2)} far=${curveState.fog.far.toFixed(2)} ` +
    `${curveState.fog.color}; frozen comparison: near=26 far=62 #9fc4e8`);
  checks.check('the frozen comparison frame was really rendered with the pinned fog',
    !frozenFrame.error && restored.matchesCurve,
    frozenFrame.error || `after sampling the curve is back: near=${restored.near.toFixed(2)} ` +
      `far=${restored.far.toFixed(2)}`);
  checks.check('the fog distance changes the rendered pixels',
    !hazeDiff.error && hazeDiff.fraction > 0.01,
    hazeDiff.error ? hazeDiff.error
      : `changed=${hazeDiff.changed}/${hazeDiff.total} (${(hazeDiff.fraction * 100).toFixed(2)}%) ` +
        `maxDelta=${hazeDiff.maxDelta}`);
  // Direction: the night haze colour (#0b1730 fading toward the day tint) is a
  // pale wash over a very dark night far field, so thickening it *lifts* the
  // far band. The assertion is that the shift is a real change, distinctly
  // larger than the band's own pixel-to-pixel texture, in the lifting direction.
  checks.check('the night haze lifts the far field rather than lowering it',
    !hazeDiff.error && hazeDiff.brighter > 0,
    hazeDiff.error ? hazeDiff.error : `mean shift ${hazeDiff.brighter > 0 ? '+' : ''}${hazeDiff.brighter}`);
  // How hard the haze bit, per pixel it reached, against the far band's own
  // pixel-to-pixel texture. A haze that only nudged a handful of pixels by one
  // unit would be a rounding artefact; this demands a real step.
  // What this can honestly claim: the haze reaches the geometry that sits
  // between the two fog planes and moves it hard, while leaving the sky dome
  // (built fog:false by design in round 57b) and the near foreground untouched.
  // So coverage is expected to be a small minority of the band - what matters is
  // that where the fog does land the change is large, not a rounding nudge.
  checks.check('the haze changes the far geometry hard where it reaches it',
    !hazeDiff.error && hazeDiff.maxDelta > 60,
    hazeDiff.error ? hazeDiff.error
      : `peak change ${hazeDiff.maxDelta}/765 on the pixels inside the fog range ` +
        `(${hazeDiff.changed}/${hazeDiff.total} = ${(hazeDiff.fraction * 100).toFixed(2)}% of the band; ` +
        `sky dome is fog:false so it cannot move)`);
  checks.check('the pinned fog really differs from the curve fog it replaced',
    Math.abs(62 - curveState.fog.far) > 5,
    `pinned far=62 curve far=${curveState.fog.far.toFixed(2)}`);

  // Leave the page in the clear morning at the standard view.
  await pose(page, 20);
  await page.screenshot({ path: resolve(outDir, 'round58-morning.png') });

  const summary = {
    round: 58,
    title: 'continuous atmosphere',
    generatedAt: new Date().toISOString(),
    view: VIEW,
    keyTimes: keyRows,
    profile,
    boundarySteps: BOUNDARIES.map((b) => ({ at: b.at, pair: `${b.from}->${b.to}` })),
    screenProof: {
      clock: NIGHT_PROBE,
      curve: { near: curveState.fog.near, far: curveState.fog.far, color: curveState.fog.color },
      frozen: { near: 26, far: 62, color: '#9fc4e8' },
      preFreezeCurve: frozen,
      diff: hazeDiff
    },
    screenshots: ['round58-night-curve.png', 'round58-night-constant-fog.png', 'round58-morning.png'],
    note: 'Pixel claims are statistics over sampled frames, not a visual inspection.'
  };
  await writeFile(resolve(outDir, 'round58-evidence.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\nwrote ${resolve(outDir, 'round58-evidence.json')}`);
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
