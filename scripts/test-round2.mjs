// Round 2 browser test: drives the real page in headless Chrome and plays the
// full quest chain through the DOM, then checks save/load and the day cycle.
// Run: npm run test:browser
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startServer, launchBrowser, createChecks } from './browser.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const outDir = resolve(ROOT, 'artifacts');
await mkdir(outDir, { recursive: true });

const checks = createChecks();

// Puppeteer has no textContent helper; $eval is the equivalent.
const text = (page, selector) => page.$eval(selector, (el) => el.textContent);
const server = await startServer();
const { browser, close } = await launchBrowser();

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  page.on('console', (message) => {
    if (message.type() === 'error') checks.recordError(message.text());
  });
  page.on('pageerror', (error) => checks.recordError(error));

  await page.goto(server.base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.amazingAdventure !== undefined, { timeout: 20000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.amazingAdventure !== undefined, { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 600));

  // --- 1. Scene renders and the game starts ------------------------------
  const render = await page.evaluate(() => {
    const { renderer, scene, camera } = window.amazingAdventure;
    return {
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      roots: scene.children.length,
      camera: camera.position.toArray().map((v) => Number(v.toFixed(2))),
      webgl: renderer.getContext().getParameter(renderer.getContext().VERSION)
    };
  });
  checks.check('scene renders', render.drawCalls > 30 && render.triangles > 1000,
    `${render.drawCalls} draw calls, ${render.triangles} triangles, ${render.roots} roots`);
  checks.check('WebGL context', /WebGL/i.test(render.webgl), render.webgl);
  checks.check('camera starts at eye height', Math.abs(render.camera[1] - 1.7) < 0.01, `y=${render.camera[1]}`);

  await page.click('#play');
  await new Promise((r) => setTimeout(r, 500));
  const started = await page.evaluate(() => ({
    locked: document.pointerLockElement === document.body,
    enabled: window.amazingAdventure.player.enabled,
    overlayHidden: document.getElementById('overlay').hidden,
    hudVisible: !document.getElementById('clock').hidden
  }));
  checks.check('click to play locks the pointer and shows the HUD',
    started.locked && started.enabled && started.overlayHidden && started.hudVisible, JSON.stringify(started));

  checks.check('five NPCs in the cast', await page.evaluate(() => window.amazingAdventure.npcs.length) === 5,
    `${await page.evaluate(() => window.amazingAdventure.npcs.length)} NPCs`);

  // --- 2. Walking and the north terrace ---------------------------------
  await page.evaluate(() => {
    window.amazingAdventure.setClock(10);
    // Stand at the foot of the ramp facing north, straight at the terrace.
    window.amazingAdventure.player.placeAt(0, -7.4, 0, 0);
  });
  const rampFoot = await page.evaluate(() => ({
    z: window.amazingAdventure.player.position.z,
    ground: window.amazingAdventure.player.groundHeight()
  }));
  // Software rendering runs at a few fps, so walk until the terrace height is
  // actually reached (or the timeout proves the ramp is broken).
  await page.keyboard.down('KeyW');
  const reachedTerrace = await page
    .waitForFunction(() => window.amazingAdventure.player.groundHeight() > 1.19, { timeout: 20000, polling: 100 })
    .then(() => true)
    .catch(() => false);
  await page.keyboard.up('KeyW');
  await new Promise((r) => setTimeout(r, 200));
  checks.check('the ramp is climbable by walking', reachedTerrace);
  const terraceState = await page.evaluate(() => {
    const { player, camera } = window.amazingAdventure;
    return {
      x: player.position.x,
      z: player.position.z,
      eye: camera.position.y,
      ground: player.groundHeight()
    };
  });
  checks.check('walking up the ramp raises the player onto the terrace',
    terraceState.ground >= 1.19 && terraceState.eye > 2.85 && terraceState.z < -13.2,
    `foot ground=${rampFoot.ground.toFixed(2)} at z=${rampFoot.z.toFixed(2)} -> ground=${terraceState.ground.toFixed(2)} eye=${terraceState.eye.toFixed(2)} at z=${terraceState.z.toFixed(2)}`);

  // The 1.2m terrace side must not be walkable: approach it from the grass.
  await page.evaluate(() => window.amazingAdventure.player.placeAt(-4, -11.5, 0, 0));
  await page.keyboard.down('KeyW');
  // Give it plenty of simulated time: if the wall were climbable, this is long
  // enough to reach the terrace.
  await new Promise((r) => setTimeout(r, 6000));
  await page.keyboard.up('KeyW');
  await new Promise((r) => setTimeout(r, 200));
  const wallClimb = await page.evaluate(() => ({
    z: window.amazingAdventure.player.position.z,
    ground: window.amazingAdventure.player.groundHeight()
  }));
  checks.check('the terrace side wall blocks walking straight up',
    wallClimb.ground < 0.01 && wallClimb.z > -13.4,
    `stopped at z=${wallClimb.z.toFixed(2)} with ground=${wallClimb.ground.toFixed(2)}`);


  // --- 3. Talk to Mara via the proximity hint and the E key --------------
  const maraPos = await page.evaluate(() => {
    const { player, npcs } = window.amazingAdventure;
    const mara = npcs.find((n) => n.id === 'mara');
    player.placeAt(mara.group.position.x, mara.group.position.z + 1.5, Math.PI, 0);
    return [mara.group.position.x, mara.group.position.z];
  });
  await new Promise((r) => setTimeout(r, 300));
  const hintText = await text(page, '#hint');
  checks.check('proximity hint offers Mara', /Mara/.test(hintText || ''), JSON.stringify(hintText));

  await page.keyboard.press('KeyE');
  await new Promise((r) => setTimeout(r, 300));
  const dialogue1 = await page.evaluate(() => window.amazingAdventure.getDialogue());
  checks.check('dialogue opens with choices', Boolean(dialogue1 && dialogue1.choices.length >= 2),
    dialogue1 ? `${dialogue1.speaker}: ${dialogue1.choices.length} choices` : 'no dialogue');
  await page.screenshot({ path: resolve(outDir, 'round2-dialogue-mara.png') });

  // Talking freezes movement: walk for a moment and confirm the player stays put.
  const beforeFreeze = await page.evaluate(() => ({
    x: window.amazingAdventure.player.position.x,
    z: window.amazingAdventure.player.position.z
  }));
  await page.keyboard.down('KeyW');
  await new Promise((r) => setTimeout(r, 1200));
  await page.keyboard.up('KeyW');
  const afterFreeze = await page.evaluate(() => ({
    x: window.amazingAdventure.player.position.x,
    z: window.amazingAdventure.player.position.z
  }));
  checks.check('movement is frozen while dialogue is open',
    Math.hypot(afterFreeze.x - beforeFreeze.x, afterFreeze.z - beforeFreeze.z) < 0.05,
    `moved ${Math.hypot(afterFreeze.x - beforeFreeze.x, afterFreeze.z - beforeFreeze.z).toFixed(3)}m`);

  // Pick the lantern hook, then confirm the quest tracker updates.
  const hookIndex = dialogue1.choices.findIndex((label) => /lanterns look low/i.test(label));
  checks.check('Mara offers the lantern quest hook', hookIndex === 0, `index ${hookIndex}`);
  await page.evaluate((index) => window.amazingAdventure.choose(index), hookIndex);
  await new Promise((r) => setTimeout(r, 250));
  const questStarted = await page.evaluate(() => ({
    status: window.amazingAdventure.getState().quests.lanterns,
    tracker: document.getElementById('quest-list').textContent,
    active: document.getElementById('quest-list').dataset.active
  }));
  checks.check('quest starts and appears in the tracker',
    questStarted.status === 'started' && /Failing Lantern/.test(questStarted.tracker) && questStarted.active === '1',
    JSON.stringify(questStarted));

  // Close the follow-up node with Escape.
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 200));
  checks.check('Escape closes dialogue', await page.evaluate(() => !window.amazingAdventure.isDialogueOpen()));

  // --- 4. Buy oil from Oswin (promise branch) ---------------------------
  await page.evaluate(() => {
    const { player, npcs } = window.amazingAdventure;
    const oswin = npcs.find((n) => n.id === 'oswin');
    player.placeAt(oswin.group.position.x - 1.4, oswin.group.position.z, -Math.PI / 2, 0);
  });
  await new Promise((r) => setTimeout(r, 300));
  await page.keyboard.press('KeyE');
  await new Promise((r) => setTimeout(r, 300));
  const trade = await page.evaluate(() => window.amazingAdventure.getDialogue());
  checks.check('Oswin offers both payment branches',
    trade && trade.choices.some((l) => /Pay 4 coins/.test(l)) && trade.choices.some((l) => /owe you/.test(l)),
    trade ? trade.choices.join(' | ') : 'no dialogue');
  await page.screenshot({ path: resolve(outDir, 'round2-dialogue-oswin.png') });

  const promiseIndex = trade.choices.findIndex((label) => /owe you/.test(label));
  await page.evaluate((index) => window.amazingAdventure.choose(index), promiseIndex);
  await new Promise((r) => setTimeout(r, 300));
  const afterTrade = await page.evaluate(() => {
    const state = window.amazingAdventure.getState();
    return { inventory: state.inventory, debt: state.perks.oswin_debt, status: state.quests.lanterns, coins: state.flags.coins };
  });
  checks.check('promise branch grants oil and creates a debt',
    afterTrade.inventory.includes('lantern_oil') && afterTrade.debt === true && afterTrade.status === 'oil_bought' && afterTrade.coins === 6,
    JSON.stringify(afterTrade));
  await page.keyboard.press('Escape');

  // Inventory panel shows the oil.
  await page.keyboard.press('KeyJ');
  await new Promise((r) => setTimeout(r, 250));
  const panelText = await text(page, '#panel');
  checks.check('J opens the inventory panel with the oil',
    /Inventory/.test(panelText) && /Lantern Oil/.test(panelText), panelText.slice(0, 80));
  await page.screenshot({ path: resolve(outDir, 'round2-journal.png') });
  await page.keyboard.press('KeyJ');

  // --- 5. Deliver the oil to Mara ---------------------------------------
  await page.evaluate(() => {
    const { player, npcs } = window.amazingAdventure;
    const mara = npcs.find((n) => n.id === 'mara');
    player.placeAt(mara.group.position.x, mara.group.position.z + 1.4, Math.PI, 0);
  });
  await new Promise((r) => setTimeout(r, 300));
  await page.keyboard.press('KeyE');
  await new Promise((r) => setTimeout(r, 300));
  const delivery = await page.evaluate(() => window.amazingAdventure.getDialogue());
  checks.check('Mara asks for the oil', Boolean(delivery && /Hand it over/.test(delivery.text || '')), delivery?.text);
  await page.evaluate(() => window.amazingAdventure.choose(0));
  await new Promise((r) => setTimeout(r, 350));
  const delivered = await page.evaluate(() => {
    const state = window.amazingAdventure.getState();
    return {
      status: state.quests.lanterns,
      inventory: state.inventory,
      coins: state.flags.coins,
      tracker: document.getElementById('quest-list').textContent
    };
  });
  checks.check('delivering oil completes the quest, pays coins, grants the promise',
    delivered.status === 'done' && delivered.inventory.includes('keeper_promise') && !delivered.inventory.includes('lantern_oil') && delivered.coins === 9,
    JSON.stringify(delivered));
  checks.check('tracker marks the quest done', /✓/.test(delivered.tracker), delivered.tracker.replace(/\s+/g, ' ').slice(0, 90));
  await page.keyboard.press('Escape');

  // --- 6. Halden's key: world pickup + return ---------------------------
  await page.evaluate(() => {
    const { player, npcs } = window.amazingAdventure;
    const halden = npcs.find((n) => n.id === 'halden');
    player.placeAt(halden.group.position.x, halden.group.position.z + 1.4, Math.PI, 0);
  });
  await new Promise((r) => setTimeout(r, 300));
  await page.keyboard.press('KeyE');
  await new Promise((r) => setTimeout(r, 300));
  const haldenTalk = await page.evaluate(() => window.amazingAdventure.getDialogue());
  const lostIndex = haldenTalk.choices.findIndex((label) => /lost something/.test(label));
  checks.check('Halden offers the key quest', lostIndex >= 0, haldenTalk.choices.join(' | '));
  await page.evaluate((index) => window.amazingAdventure.choose(index), lostIndex);
  await new Promise((r) => setTimeout(r, 300));
  await page.keyboard.press('Escape');

  const keyVisible = await page.evaluate(() => window.amazingAdventure.environment.keyGroup.visible);
  checks.check('the key appears in the world once Halden asks', keyVisible === true);

  const keySpot = await page.evaluate(() => window.amazingAdventure.KEY_SPOT);
  await page.evaluate((spot) => {
    window.amazingAdventure.player.placeAt(spot.x, spot.z + 0.9, Math.PI, -0.5);
  }, keySpot);
  await new Promise((r) => setTimeout(r, 350));
  const keyHint = await text(page, '#hint');
  checks.check('the key is an interactable in the world', /brass key/.test(keyHint || ''), JSON.stringify(keyHint));
  await page.screenshot({ path: resolve(outDir, 'round2-key-pickup.png') });
  await page.keyboard.press('KeyE');
  await new Promise((r) => setTimeout(r, 350));
  const picked = await page.evaluate(() => {
    const state = window.amazingAdventure.getState();
    return {
      status: state.quests.key,
      hasKey: state.inventory.includes('brass_key'),
      visible: window.amazingAdventure.environment.keyGroup.visible
    };
  });
  checks.check('E picks the key up out of the grass',
    picked.status === 'found' && picked.hasKey && picked.visible === false, JSON.stringify(picked));

  await page.evaluate(() => {
    const { player, npcs } = window.amazingAdventure;
    const halden = npcs.find((n) => n.id === 'halden');
    player.placeAt(halden.group.position.x, halden.group.position.z + 1.4, Math.PI, 0);
  });
  await new Promise((r) => setTimeout(r, 300));
  await page.keyboard.press('KeyE');
  await new Promise((r) => setTimeout(r, 300));
  const returnTalk = await page.evaluate(() => window.amazingAdventure.getDialogue());
  checks.check('Halden recognises the key', Boolean(returnTalk && /my key/.test(returnTalk.text || '')), returnTalk?.text);
  await page.evaluate(() => window.amazingAdventure.choose(0));
  await new Promise((r) => setTimeout(r, 350));
  const returned = await page.evaluate(() => {
    const state = window.amazingAdventure.getState();
    return { status: state.quests.key, inv: state.inventory };
  });
  checks.check('returning the key completes the quest and grants the marker',
    returned.status === 'done' && returned.inv.includes('oswin_marker') && !returned.inv.includes('brass_key'),
    JSON.stringify(returned));
  await page.keyboard.press('Escape');

  // --- 7. Pip's dusk quest needs the terrace at dusk --------------------
  await page.evaluate(() => {
    const { player, npcs } = window.amazingAdventure;
    const pip = npcs.find((n) => n.id === 'pip');
    player.placeAt(pip.group.position.x, pip.group.position.z + 1.4, Math.PI, 0);
  });
  await new Promise((r) => setTimeout(r, 300));
  await page.keyboard.press('KeyE');
  await new Promise((r) => setTimeout(r, 300));
  const pipTalk = await page.evaluate(() => window.amazingAdventure.getDialogue());
  const specialIndex = pipTalk.choices.findIndex((label) => /special/.test(label));
  await page.evaluate((index) => window.amazingAdventure.choose(index), specialIndex);
  await new Promise((r) => setTimeout(r, 300));
  await page.keyboard.press('Escape');
  checks.check('Pip gives the dusk watch quest',
    await page.evaluate(() => window.amazingAdventure.getState().quests.cheer === 'started'));

  // Watch from the grass at dusk: must not count.
  await page.evaluate(() => {
    window.amazingAdventure.setClock(75); // dusk
    window.amazingAdventure.player.placeAt(0, -8, Math.PI, 0);
  });
  await new Promise((r) => setTimeout(r, 500));
  checks.check('watching from the grass does not count',
    await page.evaluate(() => window.amazingAdventure.getState().quests.cheer === 'started'));
  await page.screenshot({ path: resolve(outDir, 'round2-dusk.png') });

  // Watch from the terrace at dusk: counts.
  await page.evaluate(() => {
    window.amazingAdventure.setClock(75);
    window.amazingAdventure.player.placeAt(0, -15, Math.PI, 0);
  });
  await new Promise((r) => setTimeout(r, 600));
  const watched = await page.evaluate(() => ({
    status: window.amazingAdventure.getState().quests.cheer,
    phase: window.amazingAdventure.getClock().phase,
    eye: window.amazingAdventure.camera.position.y
  }));
  checks.check('watching from the terrace at dusk advances the quest',
    watched.status === 'watched' && watched.phase === 'dusk', JSON.stringify(watched));

  // --- 8. Day/night cycle changes the scene ----------------------------
  const looks = await page.evaluate(() => {
    const { environment, setClock } = window.amazingAdventure;
    const sample = () => ({
      sky: environment.scene.background.getHexString(),
      sun: Number(environment.sun.intensity.toFixed(2)),
      lamps: Number(environment.lamps[0].light.intensity.toFixed(1)),
      phase: window.amazingAdventure.getClock().phase
    });
    setClock(10);
    const day = sample();
    setClock(80);
    const dusk = sample();
    setClock(150);
    const night = sample();
    return { day, dusk, night };
  });
  checks.check('phases change sky, sun and lantern light',
    looks.day.sky !== looks.dusk.sky && looks.dusk.sky !== looks.night.sky &&
    looks.day.lamps === 0 && looks.dusk.lamps > 0 && looks.night.lamps > looks.dusk.lamps &&
    looks.night.sun < looks.day.sun,
    JSON.stringify(looks));

  // --- 9. NPC routines move people around ------------------------------
  const routine = await page.evaluate(async () => {
    const { npcs, setClock } = window.amazingAdventure;
    const pip = npcs.find((n) => n.id === 'pip');
    setClock(150);
    await new Promise((r) => setTimeout(r, 1600));
    return { x: pip.group.position.x, z: pip.group.position.z, phase: pip.phase };
  });
  checks.check('NPC routine moves Pip for the night phase',
    routine.phase === 'night' && Math.hypot(routine.x + 4.6, routine.z + 6.2) < 0.6,
    `pip at ${routine.x.toFixed(2)},${routine.z.toFixed(2)} phase=${routine.phase}`);

  // --- 10. Save and reload --------------------------------------------
  // Stand somewhere specific at a specific time, then save.
  await page.evaluate(() => {
    window.amazingAdventure.setClock(118);
    window.amazingAdventure.player.placeAt(-5.5, 7.25, 0.75, 0);
  });
  await new Promise((r) => setTimeout(r, 300));
  const beforeSave = await page.evaluate(() => ({
    x: window.amazingAdventure.player.position.x,
    z: window.amazingAdventure.player.position.z,
    clock: window.amazingAdventure.getClock().seconds,
    phase: window.amazingAdventure.getClock().phase
  }));
  await page.evaluate(() => window.amazingAdventure.saves.save(
    window.amazingAdventure.getState(),
    { x: window.amazingAdventure.player.position.x, z: window.amazingAdventure.player.position.z, yaw: window.amazingAdventure.player.yaw, clock: window.amazingAdventure.getClock().seconds }
  ));
  const savedState = await page.evaluate(() => window.amazingAdventure.getState());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.amazingAdventure !== undefined, { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 500));
  const continueVisible = await page.evaluate(() => !document.getElementById('continue').hidden);
  checks.check('reload offers Continue when a save exists', continueVisible === true);

  await page.click('#continue');
  await new Promise((r) => setTimeout(r, 500));
  const restored = await page.evaluate(() => {
    const state = window.amazingAdventure.getState();
    return {
      quests: state.quests,
      inv: state.inventory,
      coins: state.flags.coins,
      locked: document.pointerLockElement === document.body
    };
  });
  checks.check('Continue restores quests, inventory and coins from the save',
    JSON.stringify(restored.quests) === JSON.stringify(savedState.quests) &&
    JSON.stringify(restored.inv.slice().sort()) === JSON.stringify(savedState.inventory.slice().sort()) &&
    restored.coins === savedState.flags.coins,
    JSON.stringify(restored));
  checks.check('Continue re-locks the pointer', restored.locked === true);

  const resumed = await page.evaluate(() => ({
    x: window.amazingAdventure.player.position.x,
    z: window.amazingAdventure.player.position.z,
    clock: window.amazingAdventure.getClock().seconds,
    phase: window.amazingAdventure.getClock().phase
  }));
  checks.check('Continue resumes at the saved spot and time of day',
    Math.abs(resumed.x - beforeSave.x) < 0.05 &&
    Math.abs(resumed.z - beforeSave.z) < 0.05 &&
    Math.abs(resumed.clock - beforeSave.clock) < 1.5 &&
    resumed.phase === beforeSave.phase,
    `saved ${beforeSave.x.toFixed(2)},${beforeSave.z.toFixed(2)} @${beforeSave.clock.toFixed(1)} -> resumed ${resumed.x.toFixed(2)},${resumed.z.toFixed(2)} @${resumed.clock.toFixed(1)} (${resumed.phase})`);

  // --- 11. Finish Pip's quest through the DOM -------------------------
  await page.evaluate(() => {
    const { player, npcs } = window.amazingAdventure;
    const pip = npcs.find((n) => n.id === 'pip');
    player.placeAt(pip.group.position.x, pip.group.position.z + 1.4, Math.PI, 0);
    window.amazingAdventure.setClock(85);
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.keyboard.press('KeyE');
  await new Promise((r) => setTimeout(r, 300));
  const pipBack = await page.evaluate(() => window.amazingAdventure.getDialogue());
  checks.check('Pip asks what the lanterns looked like',
    Boolean(pipBack && /Did you see it/.test(pipBack.text || '')), pipBack?.text);
  const toldIndex = pipBack ? pipBack.choices.findIndex((label) => /I did/.test(label)) : -1;
  await page.evaluate((index) => window.amazingAdventure.choose(index), toldIndex);
  await new Promise((r) => setTimeout(r, 350));
  await page.keyboard.press('Escape');
  await page.keyboard.press('KeyJ');
  await new Promise((r) => setTimeout(r, 300));
  const finalHud = await page.evaluate(() => ({
    quests: window.amazingAdventure.getState().quests,
    data: { ...document.getElementById('quest-list').dataset },
    panel: document.getElementById('panel').textContent,
    coins: document.getElementById('coin-count').textContent
  }));
  checks.check('all three quests complete', Object.values(finalHud.quests).every((v) => v === 'done'),
    JSON.stringify(finalHud.quests));
  checks.check('tracker counts three done, none active',
    finalHud.data.done === '3' && finalHud.data.active === '0', JSON.stringify(finalHud.data));
  checks.check('inventory panel lists every reward',
    /Keeper’s Promise/.test(finalHud.panel) && /Trader’s Marker/.test(finalHud.panel) && /Pip’s Ribbon/.test(finalHud.panel),
    finalHud.panel.replace(/\s+/g, ' ').slice(0, 140));
  await page.screenshot({ path: resolve(outDir, 'round2-journal-final.png') });
  await page.keyboard.press('KeyJ');

  // --- 12. Bench rest skips the clock --------------------------------
  await page.evaluate(() => {
    window.amazingAdventure.setClock(10);
    window.amazingAdventure.player.placeAt(-7, 10.9, Math.PI, 0);
  });
  await new Promise((r) => setTimeout(r, 350));
  const benchHint = await text(page, '#hint');
  checks.check('the bench is an interactable', /rest/.test(benchHint || ''), JSON.stringify(benchHint));
  await page.keyboard.press('KeyE');
  await new Promise((r) => setTimeout(r, 350));
  const rested = await page.evaluate(() => window.amazingAdventure.getClock());
  checks.check('resting on the bench skips to the next phase', rested.phase === 'dusk', JSON.stringify(rested));

  // --- 13. Final screenshots ----------------------------------------
  await page.evaluate(() => {
    window.amazingAdventure.setClock(20);
    window.amazingAdventure.player.placeAt(2, 12, 0.2, -0.04);
  });
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: resolve(outDir, 'round2-plaza-day.png') });
  await page.evaluate(() => {
    window.amazingAdventure.setClock(150);
    window.amazingAdventure.player.placeAt(0, 11, 0, -0.05);
  });
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: resolve(outDir, 'round2-night-plaza.png') });
} finally {
  await close();
  await server.stop();
}

checks.print();
console.log(`\nscreenshots: ${outDir}/round2-*.png`);
process.exit(checks.failed ? 1 : 0);
