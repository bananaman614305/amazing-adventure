// Round 70 evidence: painted-iron prop family + modelled lane lamp.
//
// Round 69 closed the contact-darkening gap on stone/wood props; round 70 takes
// the next largest flat mass -- the ~62 m2 of painted ironwork (barrel hoops,
// crate bands, bench brackets, gate studs, notice frames, plaza lamp posts) --
// and dresses it from the lane lamp's own maps, then replaces the lane's
// procedural post + sphere with the modelled lantern fixture. Both share one
// painted-metal read so the props and the fixture look like one workshop made
// them.
//
// Nothing here claims a picture was looked at. Every check is a live scene-graph
// measurement after a real boot, or a pure check on the same helpers the game
// calls.
//
// Run: node scripts/evidence-round70.mjs
// Set RECORD_ARTIFACTS=1 to save screenshots and artifacts/round70-evidence.json.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startServer, launchBrowser, createChecks, screenshotDir, waitForBoot } from './browser.mjs';
import { propFamilyFor, PROP_FAMILIES, LAMP_TEXTURE_FILES } from '../src/assets.js';

const checks = createChecks();
const RECORD = process.env.RECORD_ARTIFACTS === '1';
const report = { iron: null, laneLamp: null, props: null, audit: null, shots: [] };

// ---------------------------------------------------------------------------
// Pure checks on the helpers the world calls.
// ---------------------------------------------------------------------------
{
  for (const name of ['BarrelIron', 'BenchIron', 'CrateIron', 'DoorIron',
    'LampIron', 'MarketIron', 'NoticeIron', 'StallIron']) {
    checks.check(`propFamilyFor('${name}') is the iron family`,
      propFamilyFor(name)?.id === 'iron', `got ${propFamilyFor(name)?.id}`);
  }
  checks.check('the already-dressed lane lantern is not dressed twice',
    propFamilyFor('LampIronPainted') === null, 'LampIronPainted excluded');
  const iron = PROP_FAMILIES.find((f) => f.id === 'iron');
  // Compare against the lamp family's own constant, not against itself: a
  // tautology here would pass if someone quietly shipped assets/textures/iron_*.
  checks.check('the iron family reuses the lamp maps rather than a second set',
    iron !== undefined && JSON.stringify(iron.files) === JSON.stringify(LAMP_TEXTURE_FILES),
    JSON.stringify(iron?.files));
  checks.check('the iron family tiles at 0.6 m',
    iron?.tileMeters === 0.6, `${iron?.tileMeters}`);
  checks.check('the iron family carries metalness 0.45',
    iron?.metalness === 0.45, `${iron?.metalness}`);
  checks.check('the iron family keeps the authored tint white',
    iron?.keepTint === undefined, 'no keepTint');
  // Every other family stays dielectric.
  for (const family of PROP_FAMILIES) {
    if (family.id === 'iron') continue;
    checks.check(`${family.id} stays dielectric`, family.metalness === undefined,
      `metalness ${family.metalness}`);
  }
  report.iron = { pure: true };
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
    return state && state.plazaFloor === 'textured' && state.propWood === 'textured'
      && state.iron === 'textured' && state.lampMetal === 'textured'
      && state.laneLamp === 'model';
  }, { timeout: 120000, polling: 250 });

  const live = await page.evaluate(() => {
    const api = window.amazingAdventure;
    api.scene.updateMatrixWorld(true);

    // Lane lamp model.
    const laneGroup = api.scene.getObjectByName('lane-lamp-model');
    const meshes = [];
    let ironPainted = 0;
    let ironPaintedWithMaps = 0;
    let bulb = null;
    if (laneGroup) {
      laneGroup.traverse((o) => {
        if (!o.isMesh) return;
        meshes.push({ name: o.name, material: o.material?.name || null,
          hasMap: Boolean(o.material?.map), hasNormal: Boolean(o.material?.normalMap),
          hasRoughness: Boolean(o.material?.roughnessMap), hasUv: Boolean(o.geometry?.getAttribute('uv')) });
        if (o.material?.name === 'LampIronPainted') {
          ironPainted += 1;
          if (o.material.map && o.material.normalMap && o.material.roughnessMap) ironPaintedWithMaps += 1;
        }
        if (o.name === 'LampBulb') bulb = { emissive: o.material?.emissive?.getHexString?.() || null };
      });
    }
    const postLamp = api.environment.postLamp;
    const postLampName = postLamp?.name || null;
    const aim = api.environment.laneLampAim;

    // Iron-dressed props.
    let ironDressed = 0;
    let ironFlat = 0;
    const flatNames = [];
    const propNames = ['bench-model', 'notice-model', 'crate-model', 'gate-door-model', 'house-model'];
    api.scene.traverse((o) => {
      if (!o.isMesh) return;
      let inProp = false;
      for (let p = o; p; p = p.parent) {
        if (propNames.includes(p.name)) { inProp = true; break; }
      }
      if (!inProp) return;
      const name = o.material && o.material.name ? o.material.name : '';
      const hasMap = Boolean(o.material && o.material.map);
      const hasUv = Boolean(o.geometry.getAttribute('uv'));
      if (/Iron/i.test(name)) {
        if (hasMap && hasUv) ironDressed += 1; else ironFlat += 1;
      } else if (!hasMap) {
        flatNames.push(name || '(unnamed)');
      }
    });

    // Material audit: collect flat (unmapped) named materials.
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
      state: api.assetState(),
      lane: {
        groupPresent: Boolean(laneGroup),
        meshCount: meshes.length,
        meshNames: meshes.map((m) => m.name),
        ironPainted,
        ironPaintedWithMaps,
        bulbEmissive: bulb?.emissive || null,
        postLampName,
        aim
      },
      props: { ironDressed, ironFlat, flatNames },
      flatBuckets: Object.fromEntries(flatBuckets),
      hasUnnamedBucket: flatBuckets.has('(unnamed)')
    };
  });

  report.laneLamp = live.lane;
  report.props = live.props;
  report.audit = { flatBuckets: live.flatBuckets, hasUnnamed: live.hasUnnamedBucket };

  checks.check('assetState reports the lane lamp as a model',
    live.state.laneLamp === 'model', `laneLamp ${live.state.laneLamp}`);
  checks.check('assetState reports lamp metal textured',
    live.state.lampMetal === 'textured', `lampMetal ${live.state.lampMetal}`);
  checks.check('assetState reports the iron family textured',
    live.state.iron === 'textured', `iron ${live.state.iron}`);
  checks.check('the modelled lane-lamp group is in the scene',
    live.lane.groupPresent === true, 'group lane-lamp-model');
  checks.check('the lane lamp has at least one LampIronPainted mesh',
    live.lane.ironPainted > 0, `${live.lane.ironPainted}`);
  checks.check('every LampIronPainted mesh carries all three maps',
    live.lane.ironPainted > 0 && live.lane.ironPaintedWithMaps === live.lane.ironPainted,
    `${live.lane.ironPaintedWithMaps}/${live.lane.ironPainted}`);
  checks.check('the modelled bulb keeps the authored emissive colour',
    live.lane.bulbEmissive === 'ffb43a', `${live.lane.bulbEmissive}`);
  checks.check('environment.postLamp points at the modelled bulb',
    live.lane.postLampName === 'LampBulb', `${live.lane.postLampName}`);
  checks.check('the lane lamp aim is finite',
    live.lane.aim && Number.isFinite(live.lane.aim.rotationY) &&
    Number.isFinite(live.lane.aim.lanternX) && Number.isFinite(live.lane.aim.lanternZ),
    JSON.stringify(live.lane.aim));

  checks.check('painted-iron props are dressed with maps and UVs',
    live.props.ironDressed >= 20 && live.props.ironFlat === 0,
    JSON.stringify(live.props));
  checks.check('what stays flat on the props is glass/board, never iron',
    live.props.flatNames.every((n) => !/iron/i.test(n)) &&
    live.props.flatNames.some((n) => /glass/i.test(n)),
    JSON.stringify(live.props.flatNames));

  checks.check('the materials audit has no (unnamed) bucket',
    live.hasUnnamedBucket === false, Object.keys(live.flatBuckets).join(', '));
  checks.check('the named round-70 materials exist in the audit',
    ['LanternHousing', 'TerraceBanner', 'BoardFace', 'BoardPaper', 'NpcMarker',
      'BuntingRed', 'BuntingGold'].every((n) => Object.prototype.hasOwnProperty.call(live.flatBuckets, n)),
    Object.keys(live.flatBuckets).join(', '));
  // The lane notice board's face is named `NoticeFaceLane` but only while its
  // GLB is missing: notice-model hides every `noticeStandin` mesh once the
  // modelled board arrives, so the named stand-in correctly leaves the audit on
  // a healthy boot. Its name still matters for the offline/no-assets path, and
  // the job board's own `NoticeFace` face is what the audit sees here.
  checks.check('the lane notice stand-in is hidden once the modelled board loads',
    Object.prototype.hasOwnProperty.call(live.flatBuckets, 'NoticeFace') &&
    !Object.prototype.hasOwnProperty.call(live.flatBuckets, 'NoticeFaceLane'),
    `NoticeFace present, NoticeFaceLane absent: ${Object.keys(live.flatBuckets).join(', ')}`);

  // Console hygiene.
  checks.check('the run produced no console errors', consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(' | '));

  if (RECORD) {
    const dir = await screenshotDir();
    const shots = [
      ['round70-lane-lamp.png', { x: 13.0, z: 9.0, yaw: -1.2, pitch: -0.15 }],
      ['round70-iron-props.png', { x: 5.0, z: 9.5, yaw: 0.35, pitch: -0.18 }],
      ['round70-plaza.png', { x: 0.5, z: 8.4, yaw: 0, pitch: -0.10 }]
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
  const path = join(dir, 'round70-evidence.json');
  await writeFile(path, `${JSON.stringify({ ...report, checks: checks.results }, null, 2)}\n`);
  console.log(`saved ${path}`);
}

console.log('');
checks.print();
if (checks.failed) process.exitCode = 1;
