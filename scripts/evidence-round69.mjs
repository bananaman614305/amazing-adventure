// Round 69 evidence: baked plaza ambient occlusion + prop contact darkening.
//
// The graphics-realism priority asked for grounding, and the world had no
// ambient-occlusion machinery at all (confirmed by grep across src/, tests/ and
// scripts/). This round adds two cheap, standard-material-pipeline cues:
//
//   1. A baked `aoMap` on the plaza floor. Three.js reads only the R channel of
//      an aoMap and multiplies INDIRECT light only (aomap_fragment.glsl.js), so
//      this is a grazing-angle grounding hint, not a shadow. CircleGeometry has
//      only `uv`, so the map must be bound to channel 0.
//   2. Per-vertex contact darkening on dressed stone/wood props: vertices below
//      a short ramp above the ground are darkened, upper geometry untouched.
//
// Both must degrade to nothing on the low tier, because the low tier exists to
// keep mobile frames cheap and neither cue is worth a shadow-pass-sized cost.
//
// Nothing here claims a picture was looked at. Every check is a live
// scene-graph measurement after a real boot, or a pure check on the same
// helpers the game calls.
//
// Run: node scripts/evidence-round69.mjs
// Set RECORD_ARTIFACTS=1 to save screenshots and artifacts/round69-evidence.json.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startServer, launchBrowser, createChecks, screenshotDir, waitForBoot } from './browser.mjs';
import {
  PLAZA_AO_MAP_CHANNEL, plazaAoMapIntensity, contactDarkeningColors
} from '../src/assets.js';

const checks = createChecks();
const RECORD = process.env.RECORD_ARTIFACTS === '1';
const report = { ao: null, props: null, lowTier: null, shots: [] };

// ---------------------------------------------------------------------------
// Pure checks on the helpers the world calls.
// ---------------------------------------------------------------------------
checks.check('the plaza AO map is bound to UV channel 0, not uv1',
  PLAZA_AO_MAP_CHANNEL === 0, `channel ${PLAZA_AO_MAP_CHANNEL}`);

const fullIntensity = plazaAoMapIntensity({ low: false });
checks.check('the plaza AO intensity is a visible but modest fraction of indirect light',
  fullIntensity > 0 && fullIntensity <= 1, `${fullIntensity}`);
checks.check('the low tier disables plaza AO entirely',
  plazaAoMapIntensity({ low: true }) === 0, 'zero intensity, no extra sampling cost worth keeping');

{
  // A 1.2 m prop: base dark, mid partial, top full.
  const positions = new Float32Array([0, 0, 0, 0, 0.2, 0, 0, 1.2, 0]);
  const colors = contactDarkeningColors(positions, { groundY: 0, height: 0.45, intensity: 0.4 });
  checks.check('contact darkening darkens the ground vertex', colors[0] < 1, `r ${colors[0].toFixed(3)}`);
  checks.check('contact darkening fades with height',
    colors[0] < colors[3] && colors[3] <= colors[6],
    `${colors[0].toFixed(2)} < ${colors[3].toFixed(2)} <= ${colors[6].toFixed(2)}`);
  checks.check('contact darkening leaves the top of the prop at full light',
    colors[6] === 1, `r ${colors[6]}`);
  report.props = { pure: { base: colors[0], mid: colors[3], top: colors[6] } };
}

// ---------------------------------------------------------------------------
// Live checks: real boot, real materials, real quality switch.
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

  // Wait for the dresser and the plaza upgrade to actually finish, rather than
  // sampling a frame where the AO texture has not been built yet.
  await page.waitForFunction(() => {
    const state = window.amazingAdventure?.assetState?.();
    return state && state.plazaFloor === 'textured' && state.propWood === 'textured'
      && state.bark === 'textured';
  }, { timeout: 120000, polling: 250 });

  const live = await page.evaluate(() => {
    const api = window.amazingAdventure;
    api.scene.updateMatrixWorld(true);
    // The sun core and glow discs are CircleGeometry too, so identify the paved
    // ring by radius (9 m) rather than by geometry kind alone.
    const plaza = [];
    api.scene.traverse((object) => {
      if (!object.isMesh || !object.material) return;
      if (object.geometry?.type !== 'CircleGeometry') return;
      const radius = object.geometry.parameters?.radius;
      if (Math.abs((radius ?? 0) - 9) > 0.01) return;
      plaza.push(Array.isArray(object.material) ? object.material[0] : object.material);
    });
    const material = plaza[0] || null;

    // Props dressed by upgradePropFamilies() carry `userData.propFamily`.
    const props = [];
    api.scene.traverse((object) => {
      if (!object.isMesh || !object.userData?.propFamily) return;
      props.push({
        family: object.userData.propFamily,
        hasColor: Boolean(object.geometry?.attributes?.color),
        vertexColors: Boolean(object.material?.vertexColors)
      });
    });
    return {
      plaza: material ? {
        hasAoMap: Boolean(material.aoMap),
        aoMapIntensity: material.aoMapIntensity,
        aoMapChannel: material.aoMap?.channel,
        aoMapSamplerLinear: material.aoMap?.colorSpace === '',
        aoMapIsTexture: Boolean(material.aoMap?.isTexture)
      } : null,
      props: {
        count: props.length,
        withColor: props.filter((p) => p.hasColor).length,
        withVertexColors: props.filter((p) => p.vertexColors).length,
        families: [...new Set(props.map((p) => p.family))]
      },
      assetState: api.assetState()
    };
  });

  report.ao = live.plaza;
  report.props = { ...report.props, live: live.props };

  checks.check('the live plaza floor has an aoMap', live.plaza?.hasAoMap === true,
    JSON.stringify(live.plaza));
  checks.check('the live plaza aoMap is on channel 0',
    live.plaza?.aoMapChannel === 0, `channel ${live.plaza?.aoMapChannel}`);
  checks.check('the live plaza aoMap actually dims indirect light',
    (live.plaza?.aoMapIntensity || 0) > 0, `intensity ${live.plaza?.aoMapIntensity}`);
  checks.check('the live plaza aoMap is built from a real decoded texture',
    live.plaza?.aoMapIsTexture === true, 'CanvasTexture present');
  checks.check('the asset report tells the truth about the AO map',
    live.assetState?.plazaFloorDetail?.aoMap === true,
    JSON.stringify(live.assetState?.plazaFloorDetail));

  const props = live.props;
  checks.check('dressed props were found in the live scene', props.count > 0, `${props.count} meshes`);
  checks.check('the generic prop pass wrote contact-darkening colour attributes',
    props.withColor > 0, `${props.withColor} of ${props.count} dressed meshes`);
  checks.check('exactly the meshes with a colour attribute read vertex colours',
    props.withColor > 0 && props.withVertexColors === props.withColor,
    `${props.withVertexColors} reads / ${props.withColor} written (of ${props.count} dressed)`);

  // Sanity: the colour attribute must actually vary with height, otherwise it is
  // a white attribute that costs a vertex stream and does nothing.
  const variation = await page.evaluate(() => {
    const api = window.amazingAdventure;
    let dark = 0;
    let lit = 0;
    let sampled = 0;
    api.scene.traverse((object) => {
      if (!object.isMesh || !object.userData?.propFamily || !object.geometry?.attributes?.color) return;
      if (sampled >= 40) return;
      sampled += 1;
      const colors = object.geometry.attributes.color.array;
      let min = 1;
      let max = 0;
      for (let i = 0; i < colors.length; i += 3) {
        min = Math.min(min, colors[i]);
        max = Math.max(max, colors[i]);
      }
      if (min < 0.99) dark += 1;
      if (max > 0.99) lit += 1;
    });
    return { sampled, dark, lit };
  });
  report.props.variation = variation;
  checks.check('contact darkening varies across the sampled props',
    variation.dark > 0 && variation.lit > 0,
    `${variation.dark} darkened / ${variation.lit} full-lit of ${variation.sampled}`);

  if (RECORD) {
    const dir = await screenshotDir();
    // The player owns the camera and syncCamera() re-derives it from the player
    // pose every frame, so a shot has to move the player rather than poke the
    // camera. yaw 0 faces north (toward the fountain and the terrace).
    const shots = [
      ['round69-plaza-grazing.png', { x: 0.5, z: 8.4, yaw: 0, pitch: -0.10 }],
      ['round69-plaza-look-down.png', { x: 0, z: 3.2, yaw: 0, pitch: -0.62 }],
      ['round69-props-grounded.png', { x: 5.0, z: 9.5, yaw: 0.35, pitch: -0.18 }]
    ];
    for (const [name, pose] of shots) {
      await page.evaluate(async (pose) => {
        const api = window.amazingAdventure;
        // Software rendering is slow enough that the adaptive loop would drop to
        // the low tier mid-shoot, which would silently remove shadows and the
        // two cues from the evidence. Pin the full tier for every shot.
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

    // Same pose, AO on vs off, with nothing else changed. The tier switch
    // cannot be used as the toggle here because it also drops the shadow pass,
    // which would swamp the AO contribution and make the check meaningless.
    const compare = await page.evaluate(async () => {
      const api = window.amazingAdventure;
      // The adaptive loop drops tiers when the frame time spikes (software
      // rendering does), which zeroes the AO intensity, so pin full quality
      // before comparing and stop the loop from undoing it.
      api.quality.set('full');
      let plaza = null;
      api.scene.traverse((object) => {
        if (plaza || !object.isMesh) return;
        if (object.geometry?.type !== 'CircleGeometry') return;
        if (Math.abs((object.geometry.parameters?.radius ?? 0) - 9) > 0.01) return;
        plaza = Array.isArray(object.material) ? object.material[0] : object.material;
      });
      if (!plaza?.aoMap) return { debug: 'no aoMap' };
      const full = plaza.aoMapIntensity;
      const debug = { full, channel: plaza.aoMap.channel, name: plaza.name,
        type: plaza.type, uuid: plaza.uuid };
      // Mean luminance of the frame's lower half at a pose that looks along the
      // paving toward the wall band, where sky occlusion should be strongest.
      const sample = async (clock) => {
        api.setClock(clock);
        api.player.placeAt(0.5, 7.6, 0.9, -0.34);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        api.renderer.render(api.scene, api.camera);
        const gl = api.renderer.getContext();
        const w = gl.drawingBufferWidth;
        const h = gl.drawingBufferHeight;
        const pixels = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let sum = 0;
        let count = 0;
        for (let y = 0; y < Math.floor(h * 0.55); y += 2) {
          for (let x = 0; x < w; x += 2) {
            const o = (y * w + x) * 4;
            sum += 0.2126 * pixels[o] + 0.7152 * pixels[o + 1] + 0.0722 * pixels[o + 2];
            count += 1;
          }
        }
        return sum / Math.max(1, count);
      };
      const out = {};
      for (const [label, clock] of [['day', 10], ['dusk', 80], ['night', 140]]) {
        plaza.aoMapIntensity = full;
        const on = await sample(clock);
        plaza.aoMapIntensity = 0;
        const off = await sample(clock);
        plaza.aoMapIntensity = full;
        out[label] = { on: +on.toFixed(2), off: +off.toFixed(2), delta: +(on - off).toFixed(2) };
      }
      out.debug = debug;
      return out;
    });
    report.aoLuminance = compare;
    if (compare) {
      const { day, dusk, night } = compare;
      console.log(`plaza luminance delta (AO on - off): day ${day.delta}, dusk ${dusk.delta}, night ${night.delta}`);
      console.log(`aoMap intensity under test ${compare.debug.full}, channel ${compare.debug.channel}`);
    }
  }

  // --- Low tier: both cues must switch off, not merely get cheaper ----------
  const low = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    api.quality.set('low');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    let plaza = null;
    api.scene.traverse((object) => {
      if (plaza || !object.isMesh || !object.material) return;
      if (object.geometry?.type !== 'CircleGeometry') return;
      if (Math.abs((object.geometry.parameters?.radius ?? 0) - 9) > 0.01) return;
      plaza = Array.isArray(object.material) ? object.material[0] : object.material;
    });
    let withVertexColors = 0;
    let withColorAttr = 0;
    let props = 0;
    api.scene.traverse((object) => {
      if (!object.isMesh || !object.userData?.propFamily) return;
      if (!object.geometry?.attributes?.color) return;
      props += 1;
      if (object.material?.vertexColors) withVertexColors += 1;
      withColorAttr += 1;
    });
    return {
      tierTag: document.body.dataset.quality,
      aoMapIntensity: plaza?.aoMapIntensity ?? null,
      props,
      withVertexColors,
      withColorAttr
    };
  });
  report.lowTier = low;
  checks.check('low tier sets the body quality tag', low.tierTag === 'low', `dataset.quality=${low.tierTag}`);
  checks.check('low tier zeroes the plaza AO intensity',
    low.aoMapIntensity === 0, `intensity ${low.aoMapIntensity}`);
  checks.check('low tier turns prop vertex colours off',
    low.props > 0 && low.withVertexColors === 0,
    `${low.withVertexColors}/${low.props} still on`);

  // Restore the full tier and prove the cues come back, so the switch is a
  // switch and not a one-way teardown.
  const restored = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    api.quality.set('full');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    let plaza = null;
    api.scene.traverse((object) => {
      if (plaza || !object.isMesh || !object.material) return;
      if (object.geometry?.type !== 'CircleGeometry') return;
      if (Math.abs((object.geometry.parameters?.radius ?? 0) - 9) > 0.01) return;
      plaza = Array.isArray(object.material) ? object.material[0] : object.material;
    });
    let on = 0;
    let props = 0;
    api.scene.traverse((object) => {
      if (!object.isMesh || !object.userData?.propFamily) return;
      if (!object.geometry?.attributes?.color) return;
      props += 1;
      if (object.material?.vertexColors) on += 1;
    });
    return { aoMapIntensity: plaza?.aoMapIntensity ?? null, props, on };
  });
  report.restored = restored;
  checks.check('returning to the full tier restores plaza AO',
    (restored.aoMapIntensity || 0) > 0, `intensity ${restored.aoMapIntensity}`);
  checks.check('returning to the full tier restores prop vertex colours',
    restored.props > 0 && restored.on === restored.props, `${restored.on}/${restored.props}`);

  // A real pixel measurement: the plaza band under the player must be measurably
  // darker with the AO map on than with it off, and must come back. This runs only
  // when artifacts are recorded, because readPixels forces a synchronous flush.
  if (RECORD && report.aoLuminance) {
    const { day, dusk, night } = report.aoLuminance;
    // Measured with only aoMapIntensity toggled, so the delta is the AO map's
    // own contribution. It multiplies indirect light only, so it should bite in
    // daylight and dusk and correctly do nothing under the point-lit night.
    checks.check('the plaza AO map measurably darkens the paving in daylight',
      day.on < day.off - 1, `with AO ${day.on} vs without ${day.off} (delta ${day.delta})`);
    checks.check('the plaza AO map also darkens the paving at dusk',
      dusk.on < dusk.off - 1, `with AO ${dusk.on} vs without ${dusk.off} (delta ${dusk.delta})`);
    checks.check('plaza AO correctly does nothing once lamps, not sky, light the floor',
      Math.abs(night.delta) <= 0.35, `night delta ${night.delta}`);
  }

  checks.check('the run produced no console errors', consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(' | '));
} catch (error) {
  checks.recordError(error);
  console.error(`evidence run failed: ${error.message}`);
} finally {
  await closeBrowser();
  await server.stop();
}

if (RECORD) {
  const dir = await screenshotDir();
  const path = join(dir, 'round69-evidence.json');
  await writeFile(path, `${JSON.stringify({ ...report, checks: checks.results }, null, 2)}\n`);
  console.log(`saved ${path}`);
}

console.log('');
checks.print();
if (checks.failed) process.exitCode = 1;
