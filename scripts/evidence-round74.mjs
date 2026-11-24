// Round 74 evidence: the plaza's window and lamp glass follows the hour.
//
// Round 73 dressed the fountain's water and left two glass materials at the top
// of the flat list: HouseGlass (a window) and LampGlass (a lantern pane). Round
// 74 gives each pane a per-hour colour, reflectivity and glow from the pure
// table in src/glass.js, with the lane post's pane held dark until the player
// has walked the lane's lantern round.
//
// Nothing here claims a picture was looked at. Every check is a live
// scene-graph or material measurement after a real boot, or a pure check on the
// same helpers the game calls. The screenshots are saved as evidence for the
// human to read.
//
// Run: node scripts/evidence-round74.mjs
// Set RECORD_ARTIFACTS=1 to save screenshots and artifacts/round74-evidence.json.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startServer, launchBrowser, createChecks, screenshotDir, waitForBoot } from './browser.mjs';
import {
  GLASS_AUTHORED,
  GLASS_EMISSIVE,
  GLASS_LOOKS,
  glassCastsShadow,
  glassKindFor,
  glassLook,
  glassStateFor
} from '../src/glass.js';

const checks = createChecks();
const RECORD = process.env.RECORD_ARTIFACTS === '1';
const report = { pure: null, live: null, shots: [] };

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const colourOf = (kind) => hex(kind === 'window' ? GLASS_LOOKS.day.windowColor : GLASS_LOOKS.day.lampColor);

// ---------------------------------------------------------------------------
// Pure checks on the helpers the world calls.
// ---------------------------------------------------------------------------
{
  checks.check('the glass set is two kinds: windows and lamp panes',
    glassKindFor('HouseGlass') === 'window' && glassKindFor('LampGlass') === 'lamp',
    `${glassKindFor('HouseGlass')}, ${glassKindFor('LampGlass')}`);
  checks.check('a name that is not a shipped glass material is left alone',
    glassKindFor('Glassware') === null && glassKindFor('') === null
      && glassKindFor('Water') === null,
    `${glassKindFor('Glassware')}`);
  checks.check('an unknown hour falls back to the daylight look',
    glassLook('nonsense') === GLASS_LOOKS.day && glassLook(undefined) === GLASS_LOOKS.day,
    Object.keys(GLASS_LOOKS).join(','));
  checks.check('the authored fallback colour is what the audit named',
    GLASS_AUTHORED.window.color === 0x616c76 && GLASS_AUTHORED.lamp.color === 0xf9f1ce,
    `${hex(GLASS_AUTHORED.window.color)} ${hex(GLASS_AUTHORED.lamp.color)}`);
  checks.check('the glow is one warm tint, kept apart from the diffuse tint',
    GLASS_EMISSIVE === 0xffb45a
      && glassStateFor('window', 'night').color !== GLASS_EMISSIVE,
    hex(GLASS_EMISSIVE));

  const dayWindow = glassStateFor('window', 'day');
  const nightWindow = glassStateFor('window', 'night');
  const dayLamp = glassStateFor('lamp', 'day');
  const nightLamp = glassStateFor('lamp', 'night');
  checks.check('a window is dark, reflective and unlit by day',
    dayWindow.emissiveIntensity === 0 && dayWindow.metalness > 0.2
      && dayWindow.color === GLASS_LOOKS.day.windowColor,
    JSON.stringify(dayWindow));
  checks.check('the same window is warm and lit at night',
    nightWindow.emissiveIntensity > 1 && nightWindow.color !== dayWindow.color,
    `${dayWindow.color.toString(16)} -> ${nightWindow.color.toString(16)}`);
  checks.check('a lamp pane glows over its own bulb and not before',
    dayLamp.emissiveIntensity === 0 && nightLamp.emissiveIntensity > 1,
    `${dayLamp.emissiveIntensity} / ${nightLamp.emissiveIntensity}`);
  checks.check('a lamp pane keeps a faint authored reflection at every hour',
    // Its metalness is constant; what changes for a lamp is tint and glow. The
    // day mirror that swings with the hour belongs to the windows.
    dayLamp.metalness > 0 && dayLamp.metalness === nightLamp.metalness,
    `${dayLamp.metalness}`);
  checks.check('a dark lantern never glows through its glass',
    glassStateFor('lamp', 'night', { laneLit: false }).emissiveIntensity === 0,
    `${glassStateFor('lamp', 'night', { laneLit: false }).emissiveIntensity}`);
  checks.check('but the dark pane still keeps the hour\'s diffuse tint',
    glassStateFor('lamp', 'night', { laneLit: false }).color === GLASS_LOOKS.night.lampColor,
    hex(glassStateFor('lamp', 'night', { laneLit: false }).color));
  checks.check('a window ignores the lane round entirely',
    // The lane flag is for lamp panes; a window has no bulb, so passing it must
    // not change what a window does.
    JSON.stringify(glassStateFor('window', 'night', { laneLit: false }))
      === JSON.stringify(glassStateFor('window', 'night', { laneLit: true })),
    'night window ignores laneLit');
  const lowNight = glassStateFor('lamp', 'night', { low: true });
  checks.check('the low tier dims a lit pane but keeps it lit',
    lowNight.emissiveIntensity > 0 && lowNight.emissiveIntensity < nightLamp.emissiveIntensity
      && lowNight.emissiveIntensity <= 0.6,
    `${lowNight.emissiveIntensity}`);
  checks.check('the low tier is a no-op by daylight',
    glassStateFor('lamp', 'day', { low: true }).emissiveIntensity === 0,
    `${glassStateFor('lamp', 'day', { low: true }).emissiveIntensity}`);
  checks.check('only a window pane casts a shadow',
    glassCastsShadow('window') === true && glassCastsShadow('lamp') === false,
    `${glassCastsShadow('window')}, ${glassCastsShadow('lamp')}`);
  report.pure = checks.results.length;
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

/** Reads every registered pane the way applyGlass sees it, in scene order. */
const readPanes = () => page.evaluate(() => {
  const api = window.amazingAdventure;
  const out = [];
  api.scene.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    if (!/Glass/.test(o.material.name || '')) return;
    const m = o.material;
    out.push({
      mesh: o.name,
      material: m.name,
      color: `#${m.color.getHexString()}`,
      glow: Number(m.emissiveIntensity.toFixed(3)),
      metalness: Number(Number(m.metalness).toFixed(3)),
      castShadow: o.castShadow
    });
  });
  return {
    phase: api.getClock().phase,
    laneOn: api.environment.laneOn,
    quality: api.environment.quality,
    glassPhase: api.environment.glassPhase,
    panes: out
  };
});

try {
  await page.goto(server.base, { waitUntil: 'domcontentloaded' });
  await waitForBoot(page);

  await page.waitForFunction(() => {
    const state = window.amazingAdventure?.assetState?.();
    return state && state.glass === 'phase-lit';
  }, { timeout: 120000, polling: 250 });

  const initial = await page.evaluate(() => {
    const api = window.amazingAdventure;
    const state = api.assetState();
    api.getState().flags.laneLanternsLit = false;
    api.quality.set('full');
    api.setClock(30); // day, lane dark
    return { state };
  });
  report.live = initial;

  checks.check('assetState reports the glass as phase-lit',
    initial.state.glass === 'phase-lit', `glass ${initial.state.glass}`);
  checks.check('assetState reports exactly the seven panes it applied',
    initial.state.glassDetail
      && initial.state.glassDetail.panes === 7
      && initial.state.glassDetail.windows === 2
      && initial.state.glassDetail.lamps === 5
      && initial.state.glassDetail.lanePanes === 1,
    JSON.stringify(initial.state.glassDetail));

  const day = await readPanes();
  checks.check('two house windows and five lantern panes are registered',
    day.panes.filter((p) => p.material === 'HouseGlass').length === 2
      && day.panes.filter((p) => p.material === 'LampGlass').length === 5,
    JSON.stringify(day.panes.map((p) => p.material)));
  checks.check('by day no pane glows and the windows are the reflective ones',
    day.panes.every((p) => p.glow === 0)
      && day.panes.filter((p) => p.material === 'HouseGlass').every((p) => p.metalness > 0.2),
    JSON.stringify(day.panes.map((p) => [p.material, p.glow, p.metalness])));
  checks.check('by day every pane sits on its authored daylight colour',
    day.panes.every((p) => p.color === colourOf(p.material === 'HouseGlass' ? 'window' : 'lamp')),
    JSON.stringify([...new Set(day.panes.map((p) => p.color))]));

  // Dusk, lane still dark: the windows glow, the lane's own pane stays dark.
  await page.evaluate(() => {
    const api = window.amazingAdventure;
    api.getState().flags.laneLanternsLit = false;
    api.setClock(80);
  });
  const duskDark = await readPanes();
  checks.check('at dusk the windows glow while the lane is still unlit',
    duskDark.phase === 'dusk' && duskDark.laneOn === false
      && duskDark.panes.filter((p) => p.material === 'HouseGlass').every((p) => p.glow > 0),
    JSON.stringify({ phase: duskDark.phase, laneOn: duskDark.laneOn,
      glows: duskDark.panes.map((p) => [p.mesh, p.glow]) }));
  checks.check('at dusk the lane pane is the one pane left dark',
    duskDark.panes.filter((p) => p.glow === 0).length === 1,
    JSON.stringify(duskDark.panes.map((p) => [p.mesh, p.glow])));

  // Night, lane lit by the player: everything glows, the lane pane included.
  const nightLit = await page.evaluate(() => {
    const api = window.amazingAdventure;
    api.getState().flags.laneLanternsLit = true;
    api.setClock(140);
    return {
      phase: api.getClock().phase,
      laneOn: api.environment.laneOn,
      shouldGlow: api.laneLanternsShouldGlow()
    };
  });
  const lit = await readPanes();
  checks.check('at night the plaza lamps are on and the lane lanterns are the player\'s',
    nightLit.phase === 'night' && nightLit.laneOn === true && nightLit.shouldGlow === true,
    JSON.stringify(nightLit));
  checks.check('a lit lane gives every pane a glow, windows and lantern alike',
    lit.panes.every((p) => p.glow > 0),
    JSON.stringify(lit.panes.map((p) => [p.mesh, p.glow])));
  checks.check('the lane pane and the plaza panes share the night glow',
    // The lane pane was cloned off the shared LampGlass so a dark lane cannot
    // drag the plaza dark with it; lit, both read the same 2.6, and the
    // windows their own 2.2.
    lit.panes.filter((p) => p.material === 'LampGlass').every((p) => p.glow === 2.6)
      && lit.panes.filter((p) => p.material === 'HouseGlass').every((p) => p.glow === 2.2),
    JSON.stringify(lit.panes.map((p) => [p.material, p.glow])));

  // Night, lane dark again: only the lane pane goes out.
  const nightDark = await page.evaluate(() => {
    const api = window.amazingAdventure;
    api.getState().flags.laneLanternsLit = false;
    api.setClock(140);
    return { phase: api.getClock().phase, laneOn: api.environment.laneOn };
  });
  const dark = await readPanes();
  checks.check('darkening the lane puts out exactly one pane',
    nightDark.laneOn === false && dark.panes.filter((p) => p.glow === 0).length === 1,
    JSON.stringify(dark.panes.map((p) => [p.mesh, p.glow])));
  checks.check('the four plaza panes stay lit when only the lane is dark',
    dark.panes.filter((p) => p.material === 'LampGlass' && p.glow > 0).length === 4,
    JSON.stringify(dark.panes.map((p) => [p.mesh, p.glow])));
  checks.check('the dark pane is a lantern pane, never a window',
    dark.panes.filter((p) => p.glow === 0).every((p) => p.material === 'LampGlass'),
    JSON.stringify(dark.panes.filter((p) => p.glow === 0).map((p) => p.material)));

  // Tier flip: dimmed, not extinguished, and no phase change.
  const tier = await page.evaluate(() => {
    const api = window.amazingAdventure;
    api.getState().flags.laneLanternsLit = true;
    api.setClock(140);
    api.quality.set('full');
    const read = () => {
      const out = [];
      api.scene.traverse((o) => {
        if (o.isMesh && o.material && /Glass/.test(o.material.name || '')) {
          out.push(Number(o.material.emissiveIntensity.toFixed(3)));
        }
      });
      return out;
    };
    const full = read();
    const phaseBefore = api.getClock().phase;
    api.quality.set('low');
    const low = read();
    const lowPhase = api.getClock().phase;
    const lowLane = api.environment.laneOn;
    api.quality.set('full');
    return { full, low, phaseBefore, lowPhase, lowLane, q: api.environment.quality };
  });
  checks.check('the low tier dims every pane and keeps it lit',
    tier.low.every((g) => g > 0 && g <= 0.6) && tier.full.every((g) => g > 0.6),
    JSON.stringify({ full: tier.full, low: tier.low }));
  checks.check('flipping the tier does not move the hour or the lane state',
    tier.phaseBefore === tier.lowPhase && tier.lowPhase === 'night' && tier.lowLane === true,
    JSON.stringify({ before: tier.phaseBefore, low: tier.lowPhase, lane: tier.lowLane }));
  checks.check('the full tier is restored after the flip', tier.q === 'full', tier.q);

  // No pane casts a hard shadow except the window frame.
  checks.check('no lamp pane casts a shadow, the window frame keeps its own',
    lit.panes.every((p) => p.material !== 'LampGlass' || p.castShadow === false)
      && lit.panes.filter((p) => p.material === 'HouseGlass').every((p) => p.castShadow === true),
    JSON.stringify(lit.panes.map((p) => [p.material, p.castShadow])));
  checks.check('the run produced no console errors', consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(' | '));

  if (RECORD) {
    const dir = await screenshotDir();
    // Night is the point of the round, so the shots are night poses: the plaza
    // from the south walk with the lane lit, a lantern close up, and the lane
    // post itself with the lane dark so the unlit pane is visible beside the
    // four lit plaza panes.
    const shots = [
      ['round74-plaza-night-lit.png', { x: 0, z: 6, yaw: 0, pitch: 0.16, clock: 140, lane: true }],
      ['round74-lantern-close.png', { x: 7, z: 4.6, yaw: 0, pitch: -0.1, clock: 140, lane: true }],
      ['round74-lane-post-dark.png', { x: 13.4, z: -21.6, yaw: 0, pitch: 0.05, clock: 140, lane: false }]
    ];
    for (const [name, pose] of shots) {
      await page.evaluate(async (pose) => {
        const api = window.amazingAdventure;
        api.quality.set('full');
        api.getState().flags.laneLanternsLit = pose.lane;
        api.setClock(pose.clock);
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
  const path = join(dir, 'round74-evidence.json');
  // Sorted keys: the live assetState object is built by scene traversal whose
  // insertion order varies run to run, and an unstable artifact makes every
  // re-record look like a change. Sorting is a presentation fix only.
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
