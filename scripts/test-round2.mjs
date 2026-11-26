// Round 2 browser test: drives the real page in headless Chrome and plays the
// full quest chain through the DOM, then checks save/load and the day cycle.
// Run: npm run test:browser
import { resolve } from 'node:path';
import { startServer, launchBrowser, createChecks, screenshotDir, waitForBoot } from './browser.mjs';

// Screenshots go to a throwaway directory unless RECORD_ARTIFACTS=1, so a
// verification run never dirties the committed artifacts/ evidence.
const outDir = await screenshotDir();

const checks = createChecks();

/**
 * Evidence screenshots should be sharp, but the game deliberately lowers its
 * internal resolution on slow machines — which this environment is. Pin it to
 * native for the capture, then hand control back so the adaptive checks still
 * see the real behaviour.
 */
async function capture(page, name) {
  const restore = await page.evaluate(() => {
    const api = window.amazingAdventure;
    const wasAdaptive = api ? api.resolution.adaptive : false;
    if (api) api.resolution.setAdaptive(false);
    return wasAdaptive;
  });
  await new Promise((r) => setTimeout(r, 350));
  await page.screenshot({ path: resolve(outDir, name) });
  if (restore) {
    await page.evaluate(() => window.amazingAdventure.resolution.setAdaptive(true));
  }
}

// Puppeteer has no textContent helper; $eval is the equivalent.
const text = (page, selector) => page.$eval(selector, (el) => el.textContent);
const server = await startServer();
const { browser, close } = await launchBrowser();

// A thrown wait (a stalled boot, a dead page) must not swallow the PASS/FAIL
// lines collected so far — they are the only way to see where a long run died.
let runError = null;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  page.on('console', (message) => {
    if (message.type() === 'error') checks.recordError(message.text());
  });
  page.on('pageerror', (error) => checks.recordError(error));

  await page.goto(server.base, { waitUntil: 'domcontentloaded' });
  await waitForBoot(page);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForBoot(page);
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

  const castCount = await page.evaluate(() => window.amazingAdventure.npcs.length);
  checks.check('six NPCs in the cast, one of them in the lane', castCount === 6,
    `${castCount} NPCs`);

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
    .waitForFunction(() => window.amazingAdventure.player.groundHeight() > 1.19, { timeout: 90000, polling: 100 })
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
    terraceState.ground >= 1.18 && terraceState.eye > 2.85 && terraceState.z < -13.1,
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
  await capture(page, 'round2-dialogue-mara.png');

  // Keyboard navigation: S moves the highlight, E confirms the highlighted one.
  const highlight = () => page.evaluate(() =>
    [...document.querySelectorAll('#dialogue-choices .choice')].findIndex((el) => el.classList.contains('selected')));
  checks.check('first dialogue choice starts highlighted', (await highlight()) === 0,
    `highlighted index ${await highlight()}`);
  await page.keyboard.press('KeyS');
  await new Promise((r) => setTimeout(r, 150));
  checks.check('S moves the dialogue highlight down', (await highlight()) === 1,
    `highlighted index ${await highlight()}`);
  await page.keyboard.press('KeyW');
  await new Promise((r) => setTimeout(r, 150));
  checks.check('W moves the dialogue highlight back up', (await highlight()) === 0,
    `highlighted index ${await highlight()}`);

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
  await capture(page, 'round2-dialogue-oswin.png');

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
  await capture(page, 'round2-journal.png');
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
  await capture(page, 'round2-key-pickup.png');
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
  await capture(page, 'round2-dusk.png');

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
  await waitForBoot(page);
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
  // Only these three are driven by this part of the run; the toll and the lane
  // ledger are exercised separately in section 14 and 17.
  const coreDone = ['lanterns', 'key', 'cheer'].every((q) => finalHud.quests[q] === 'done');
  checks.check('all three plaza quests complete', coreDone, JSON.stringify(finalHud.quests));
  checks.check('tracker counts at least three done and nothing active',
    Number(finalHud.data.done) >= 3 && finalHud.data.active === '0', JSON.stringify(finalHud.data));
  checks.check('inventory panel lists every reward',
    /Keeper’s Promise/.test(finalHud.panel) && /Trader’s Marker/.test(finalHud.panel) && /Pip’s Ribbon/.test(finalHud.panel),
    finalHud.panel.replace(/\s+/g, ' ').slice(0, 140));
  await capture(page, 'round2-journal-final.png');
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

  // --- 13. Reputation from quest outcomes ---------------------------
  const repAfterQuests = await page.evaluate(() => {
    const state = window.amazingAdventure.getState();
    return {
      reputation: state.reputation,
      standingText: document.getElementById('standing-list').textContent,
      tiers: document.getElementById('standing-list').dataset.tiers
    };
  });
  checks.check('completing quests earned faction reputation',
    repAfterQuests.reputation.keepers > 0 && repAfterQuests.reputation.trade > 0,
    JSON.stringify(repAfterQuests.reputation));
  checks.check('the standing panel lists all three factions with tiers',
    /Keepers/.test(repAfterQuests.standingText) && /Market/.test(repAfterQuests.standingText) &&
    /Watch/.test(repAfterQuests.standingText) &&
    repAfterQuests.tiers.split(',').length === 3,
    JSON.stringify(repAfterQuests.tiers));

  // --- 14. The Market Toll dilemma ----------------------------------
  // Start from a clean save-free state so the toll gating is testable.
  await page.evaluate(() => {
    localStorage.clear();
    window.amazingAdventure.saves.clear();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForBoot(page);
  await page.click('#play');
  await new Promise((r) => setTimeout(r, 400));

  // Returning the key is the gate for the toll quest.
  const tollFlow = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const state = api.getState();
    // Drive the same state functions the dialogue uses, through the UI layer.
    const { startKey, pickUpKey, returnKey, startToll, collectToll, finishToll } = await import('./src/state.js');
    startKey(state); pickUpKey(state); returnKey(state);
    const gatedBefore = startToll(state).changed;
    collectToll(state);
    const afterCollect = { ...state.reputation };
    finishToll(state);
    api.refreshHUD();
    return { gatedBefore, afterCollect, status: state.quests.toll };
  });
  checks.check('the toll quest is gated and its outcome shifts two factions',
    // The Market's penalty is deliberately mild now: a heavier one dropped it below
    // Wren's trust gate with nothing left in the game to raise it again, which made
    // the story impossible to finish after paying the toll.
    tollFlow.gatedBefore === true && tollFlow.status === 'done' &&
    tollFlow.afterCollect.watch > 0 && tollFlow.afterCollect.trade <= 0,
    JSON.stringify(tollFlow));

  // --- 15. Overheard NPC conversation -------------------------------
  const ambient = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const { buildExchange, scriptKeyFor } = await import('./src/ambient.js');
    const state = api.getState();
    api.resetAmbient();
    // Force a specific pair through the same code the game uses.
    const mara = api.npcs.find((n) => n.id === 'mara');
    const halden = api.npcs.find((n) => n.id === 'halden');
    const names = Object.fromEntries(api.npcs.map((n) => [n.id, n.name]));
    const lines = buildExchange({
      state,
      phase: api.getClock().phase,
      a: { id: mara.id },
      b: { id: halden.id },
      names
    });
    // Play it into the live ambient state so the UI renders it.
    api.ambient.lines = lines;
    api.ambient.speakerIds = [mara.id, halden.id];
    api.ambient.index = 0;
    // Put the player near enough to overhear.
    api.player.placeAt(mara.group.position.x + 1.2, mara.group.position.z + 1.2, 0, 0);
    // Render the exchange exactly as the game does when a conversation starts.
    api.renderAmbient();
    return { lines: lines.length, key: scriptKeyFor(state, api.getClock().phase), text: lines[0].text };
  });
  // Render by waiting a frame with the player nearby.
  await new Promise((r) => setTimeout(r, 900));
  const overheardShown = await page.evaluate(() => ({
    hidden: document.getElementById('overheard').hidden,
    text: document.getElementById('overheard-lines').textContent
  }));
  checks.check('an overheard NPC exchange renders for a nearby player',
    ambient.lines >= 2 && !overheardShown.hidden && overheardShown.text.length > 10,
    `${ambient.lines} lines, key=${ambient.key}, shown=${JSON.stringify(overheardShown.text.slice(0, 70))}`);
  await capture(page, 'round3-overheard.png');

  // Walking away hides the text but does not crash.
  await page.evaluate(() => window.amazingAdventure.player.placeAt(14, 14, 0, 0));
  await new Promise((r) => setTimeout(r, 700));
  const farAway = await page.evaluate(() => document.getElementById('overheard').hidden);
  checks.check('overheard text hides when the player walks away', farAway === true);

  // --- 16. The market lane behind the north gate --------------------
  await page.evaluate(() => {
    localStorage.clear();
    window.amazingAdventure.saves.clear();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForBoot(page);
  await page.click('#play');
  await new Promise((r) => setTimeout(r, 400));

  // With the key back, the gate opens and its collider is removed.
  const gateState = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const { startKey, pickUpKey, returnKey } = await import('./src/state.js');
    const state = api.getState();
    const shutBefore = !api.isGateOpen();
    const gateCollider = api.environment.gateCollider;
    const blockerBefore = api.player.colliders.includes(gateCollider);
    startKey(state); pickUpKey(state); returnKey(state);
    api.refreshHUD();
    return {
      shutBefore,
      blockerBefore,
      openAfter: api.isGateOpen(),
      blockerAfter: api.player.colliders.includes(gateCollider),
      doorHidden: api.environment.gateDoor.visible === false
    };
  });
  checks.check('the north gate is shut until Halden has his key back',
    gateState.shutBefore === true && gateState.blockerBefore === true,
    JSON.stringify(gateState));
  checks.check('returning the key opens the gate and removes its collider',
    gateState.openAfter === true && gateState.blockerAfter === false && gateState.doorHidden === true,
    JSON.stringify(gateState));

  // Walk from the plaza through the gate into the lane.
  await page.evaluate(() => window.amazingAdventure.player.placeAt(9.5, -14.5, 0, 0));
  await page.keyboard.down('KeyW');
  const reachedLane = await page
    .waitForFunction(() => window.amazingAdventure.areaAt() === 'lane', { timeout: 45000, polling: 100 })
    .then(() => true)
    .catch(() => false);
  await page.keyboard.up('KeyW');
  const lanePos = await page.evaluate(() => ({
    area: window.amazingAdventure.areaAt(),
    x: window.amazingAdventure.player.position.x,
    z: window.amazingAdventure.player.position.z,
    bodyArea: document.body.dataset.area
  }));
  checks.check('the player can walk through the gate into the market lane',
    reachedLane && lanePos.area === 'lane' && lanePos.bodyArea === 'lane',
    JSON.stringify(lanePos));
  await capture(page, 'round3-market-lane.png');

  // The notice board in the lane is readable.
  const board = await page.evaluate(() => ({
    x: window.amazingAdventure.player.position.x,
    z: window.amazingAdventure.player.position.z
  }));
  await page.evaluate(() => {
    // Stand in front of the notice board.
    window.amazingAdventure.player.placeAt(12.2, -23.2, -Math.PI / 2, 0);
  });
  await new Promise((r) => setTimeout(r, 400));
  const boardHint = await text(page, '#hint');
  checks.check('the notice board is an interactable in the lane',
    /notice board/.test(boardHint || ''), JSON.stringify(boardHint));
  await page.keyboard.press('KeyE');
  await new Promise((r) => setTimeout(r, 400));
  const toastText = await page.$eval('#toast-stack', (el) => el.textContent);
  checks.check('reading the notice board shows its text', (toastText || '').length > 15,
    JSON.stringify((toastText || '').slice(0, 60)));

  // The gate is a solid wall again when the key has not been returned.
  await page.evaluate(() => {
    window.amazingAdventure.saves.clear();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForBoot(page);
  await page.click('#play');
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => window.amazingAdventure.player.placeAt(9.5, -15.6, 0, 0));
  await page.keyboard.down('KeyW');
  await new Promise((r) => setTimeout(r, 5000));
  await page.keyboard.up('KeyW');
  const blocked = await page.evaluate(() => ({
    z: window.amazingAdventure.player.position.z,
    area: window.amazingAdventure.areaAt()
  }));
  checks.check('a locked gate stops the player entering the lane',
    blocked.area === 'plaza' && blocked.z > -17.6,
    `stopped at z=${blocked.z.toFixed(2)} in ${blocked.area}`);

  // --- 17. Wren and the faction-gated lane quest --------------------
  await page.evaluate(() => {
    localStorage.clear();
    window.amazingAdventure.saves.clear();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForBoot(page);
  await page.click('#play');
  await new Promise((r) => setTimeout(r, 400));

  // Wren exists, sits in the lane, and refuses her quest at neutral standing.
  const wrenRefusal = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const wren = api.npcs.find((n) => n.id === 'wren');
    const dialogue = await import('./src/dialogue.js');
    const open = dialogue.startConversation(api.getState(), 'wren');
    return {
      exists: Boolean(wren),
      area: wren ? (wren.group.position.z < -17.5 ? 'lane' : 'plaza') : null,
      text: open.text,
      offers: open.choices.map((c) => c.label)
    };
  });
  checks.check('Wren is in the lane and refuses her quest at neutral standing',
    wrenRefusal.exists && wrenRefusal.area === 'lane' &&
    /Market trusts/.test(wrenRefusal.text) &&
    !wrenRefusal.offers.some((l) => /look for it/i.test(l)),
    JSON.stringify(wrenRefusal).slice(0, 200));

  // With Warm Market standing the offer appears, and the quest can be finished.
  const ledgerRun = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const state = api.getState();
    const s = await import('./src/state.js');
    const dialogue = await import('./src/dialogue.js');
    // Earn Warm Market standing honestly through the toll-waive path.
    s.startKey(state); s.pickUpKey(state); s.returnKey(state);
    s.startToll(state); s.waiveToll(state, 'warm');
    const tier = (await import('./src/factions.js')).npcTier(state, 'wren').id;
    const open = dialogue.startConversation(state, 'wren');
    const offer = open.choices.find((c) => /look for it/i.test(c.label));
    if (!offer) return { error: 'no offer', tier };
    dialogue.applyChoice(state, 'wren', offer);
    const started = state.quests.ledger;
    // Ask the rumour, then take the ledger from the lane.
    const step2 = dialogue.startConversation(state, 'wren');
    const rumour = step2.choices.find((c) => /who took it/i.test(c.label));
    dialogue.applyChoice(state, 'wren', rumour);
    const booked = state.quests.ledger;
    api.refreshHUD();
    api.syncPickups();
    const ledgerVisible = api.environment.ledgerGroup.visible;
    return { tier, started, booked, ledgerVisible };
  });
  checks.check('Warm Market standing unlocks Wren\'s ledger quest',
    ledgerRun.tier === 'warm' && ledgerRun.started === 'started' && ledgerRun.booked === 'booked',
    JSON.stringify(ledgerRun));
  checks.check('the ledger appears in the lane only once Wren points at the barrels',
    ledgerRun.ledgerVisible === true, JSON.stringify(ledgerRun));

  // Walk to the barrels and pick it up through the real interaction path.
  await page.evaluate(() => window.amazingAdventure.player.placeAt(7.6, -23.6, Math.PI, 0));
  await new Promise((r) => setTimeout(r, 500));
  const ledgerHint = await text(page, '#hint');
  checks.check('the ledger is an interactable by the barrels',
    /toll ledger/.test(ledgerHint || ''), JSON.stringify(ledgerHint));
  await page.keyboard.press('KeyE');
  await new Promise((r) => setTimeout(r, 500));
  const afterPickup = await page.evaluate(() => ({
    status: window.amazingAdventure.getState().quests.ledger,
    hasItem: window.amazingAdventure.getState().inventory.includes('toll_ledger'),
    hidden: window.amazingAdventure.environment.ledgerGroup.visible === false
  }));
  checks.check('picking up the ledger advances the quest and hides it',
    afterPickup.status === 'recovered' && afterPickup.hasItem && afterPickup.hidden,
    JSON.stringify(afterPickup));

  // Covering for the trader is the Market-friendly ending.
  const ending = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const state = api.getState();
    const dialogue = await import('./src/dialogue.js');
    const before = { ...state.reputation };
    const open = dialogue.startConversation(state, 'wren');
    const cover = open.choices.find((c) => /Cover for the trader/i.test(c.label));
    const result = dialogue.applyChoice(state, 'wren', cover);
    api.refreshHUD();
    return {
      status: state.quests.ledger,
      before, after: { ...state.reputation },
      message: result.message,
      stillHasItem: state.inventory.includes('toll_ledger')
    };
  });
  checks.check('covering for the trader ends the quest and moves two factions',
    ending.status === 'done' && ending.after.trade > ending.before.trade &&
    ending.after.watch < ending.before.watch && ending.stillHasItem === false,
    JSON.stringify(ending).slice(0, 220));
  await capture(page, 'round4-wren-lane.png');

  // --- 18. Adaptive resolution on weak hardware ---------------------
  const adaptive = await page.evaluate(() => ({
    adaptive: window.amazingAdventure.resolution.adaptive,
    ratio: window.amazingAdventure.resolution.ratio,
    dataset: document.body.dataset.pixelRatio,
    actual: window.amazingAdventure.renderer.getPixelRatio(),
    base: window.amazingAdventure.basePixelRatio
  }));
  checks.check('adaptive resolution is on and reported honestly',
    adaptive.adaptive === true && adaptive.actual === adaptive.ratio &&
    adaptive.dataset === String(adaptive.ratio),
    JSON.stringify(adaptive));

  // This environment renders at roughly 3fps, so the controller must have
  // noticed and reduced the pixel ratio during the earlier checks.
  checks.check('slow frames actually lowered the render resolution',
    adaptive.ratio < adaptive.base,
    `ratio=${adaptive.ratio} base=${adaptive.base}`);

  // The manual override must restore native sharpness and persist the choice.
  // It must also leave the controller's *reported* ratio agreeing with the renderer:
  // a pin that bypasses the controller made `resolution.ratio` go stale, which is a
  // lie about what is on screen rather than a cosmetic detail.
  const fixed = await page.evaluate(() => {
    const api = window.amazingAdventure;
    const on = api.resolution.setAdaptive(false);
    return {
      on,
      reported: api.resolution.ratio,
      ratio: api.renderer.getPixelRatio(),
      dataset: document.body.dataset.pixelRatio,
      base: api.basePixelRatio,
      stored: localStorage.getItem('amazing-adventure:resolution')
    };
  });
  checks.check('turning adaptive off restores native resolution and remembers it',
    fixed.on === false && fixed.ratio === fixed.base && fixed.stored === 'fixed',
    JSON.stringify(fixed));
  checks.check('a pinned resolution is reported honestly, not stale',
    fixed.reported === fixed.ratio &&
    Number(fixed.dataset) === fixed.ratio,
    JSON.stringify(fixed));

  // And the pin has to survive being pinned from an already-reduced ratio, which is
  // the state the capture helper leaves the page in.
  await page.evaluate(() => window.amazingAdventure.resolution.setAdaptive(true));
  const pinnedAgain = await page.evaluate(() => {
    const api = window.amazingAdventure;
    api.resolution.setAdaptive(false);
    return {
      reported: api.resolution.ratio,
      actual: api.renderer.getPixelRatio(),
      base: api.basePixelRatio
    };
  });
  checks.check('pinning from any state lands on the base ratio and says so',
    pinnedAgain.reported === pinnedAgain.base && pinnedAgain.actual === pinnedAgain.base,
    JSON.stringify(pinnedAgain));

  const reEnabled = await page.evaluate(() => {
    const on = window.amazingAdventure.resolution.setAdaptive(true);
    return { on, stored: localStorage.getItem('amazing-adventure:resolution') };
  });
  checks.check('adaptive resolution can be turned back on',
    reEnabled.on === true && reEnabled.stored === 'auto', JSON.stringify(reEnabled));

  // --- 19. Journal text matches the branch actually played ----------
  const journalTruth = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const s = await import('./src/state.js');
    localStorage.clear();
    api.saves.clear();
    const state = s.createInitialState();
    s.startKey(state); s.pickUpKey(state); s.returnKey(state);
    s.startToll(state); s.collectToll(state); s.finishToll(state);
    const paidText = s.journalEntries(state).find((e) => e.id === 'toll').text;

    const waived = s.createInitialState();
    s.startKey(waived); s.pickUpKey(waived); s.returnKey(waived);
    s.startToll(waived); s.waiveToll(waived, 'warm'); s.finishToll(waived);
    const waivedText = s.journalEntries(waived).find((e) => e.id === 'toll').text;

    const cheer = s.createInitialState();
    s.startCheer(cheer); s.watchLanterns(cheer, 'dusk'); s.tellPipAboutLanterns(cheer);
    const cheerText = s.journalEntries(cheer).find((e) => e.id === 'cheer').text;
    return { paidText, waivedText, cheerText };
  });
  checks.check('a paid toll is journalled as paid, not as waived',
    /paid/i.test(journalTruth.paidText) && !/waiv/i.test(journalTruth.paidText),
    JSON.stringify(journalTruth.paidText));
  checks.check('a waived toll is journalled as waived, not as paid',
    /waiv/i.test(journalTruth.waivedText) && !/purse/i.test(journalTruth.waivedText),
    JSON.stringify(journalTruth.waivedText));
  checks.check('a finished quest is not journalled as an instruction',
    !/tell Pip/i.test(journalTruth.cheerText), JSON.stringify(journalTruth.cheerText));

  // The panel itself must render that truthful text, not just the helper.
  const journalPanelText = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const s = await import('./src/state.js');
    const state = api.getState();
    state.quests.toll = 'done';
    state.outcomes.toll = 'collected';
    api.refreshHUD();
    document.getElementById('panel').hidden = false;
    api.refreshHUD();
    return document.getElementById('journal-list').textContent;
  });
  checks.check('the journal panel shows what really happened',
    /paid Oswin/i.test(journalPanelText || '') && !/talked Halden into waiving/i.test(journalPanelText || ''),
    JSON.stringify((journalPanelText || '').replace(/\s+/g, ' ').slice(0, 120)));

  // --- 20. Final screenshots ----------------------------------------
  await page.evaluate(() => {
    window.amazingAdventure.setClock(20);
    window.amazingAdventure.player.placeAt(2, 12, 0.2, -0.04);
  });
  await new Promise((r) => setTimeout(r, 900));
  await capture(page, 'round2-plaza-day.png');
  await page.evaluate(() => {
    window.amazingAdventure.setClock(150);
    window.amazingAdventure.player.placeAt(0, 11, 0, -0.05);
  });
  await new Promise((r) => setTimeout(r, 900));
  await capture(page, 'round2-night-plaza.png');

  // Standing panel and reputation, for the record.
  await page.evaluate(() => {
    window.amazingAdventure.setClock(80);
    window.amazingAdventure.player.placeAt(-2, 12, 0.3, -0.03);
    document.getElementById('panel').hidden = false;
    window.amazingAdventure.refreshHUD();
  });
  await new Promise((r) => setTimeout(r, 700));
  await capture(page, 'round3-standing.png');

  // The market lane at dusk, with the gate open.
  await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const { startKey, pickUpKey, returnKey } = await import('./src/state.js');
    const state = api.getState();
    startKey(state); pickUpKey(state); returnKey(state);
    api.refreshHUD();
    api.setClock(85);
    api.player.placeAt(9.8, -19.5, 0.15, 0.02);
  });
  await new Promise((r) => setTimeout(r, 1200));
  await capture(page, 'round3-lane-dusk.png');

  // Wren at her stall in the lane, mid-conversation.
  await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const state = api.getState();
    const s = await import('./src/state.js');
    s.startKey(state); s.pickUpKey(state); s.returnKey(state);
    s.startToll(state); s.waiveToll(state, 'warm');
    s.startLedger(state, 'warm'); s.hearLedgerRumour(state); s.recoverLedger(state);
    api.refreshHUD();
    api.setClock(85);
    api.player.placeAt(11.4, -20.6, Math.PI, 0);
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const wren = api.npcs.find((n) => n.id === 'wren');
    api.player.placeAt(wren.group.position.x, wren.group.position.z + 1.6, Math.PI, 0);
  });
  await new Promise((r) => setTimeout(r, 900));
  await page.keyboard.press('KeyE');
  await new Promise((r) => setTimeout(r, 900));
  await capture(page, 'round4-wren-dialogue.png');

  // --- 20. The lane's arrears: a quest that crosses both areas ---------
  // This is the first objective that cannot be finished in one place. The
  // player must carry the pouch south to Mara, then carry her mark back north
  // to Wren, so the two areas depend on each other instead of the lane being a
  // dead end. Driven through the real dialogue buttons, not by calling state.
  const clickChoice = async (pattern) => {
    const index = await page.evaluate((p) => [...document.querySelectorAll('#dialogue-choices button')]
      .findIndex((b) => new RegExp(p, 'i').test(b.textContent)), pattern);
    if (index < 0) return { ok: false, labels: await page.evaluate(() => [...document.querySelectorAll('#dialogue-choices button')].map((b) => b.textContent.trim())) };
    await page.evaluate((i) => document.querySelectorAll('#dialogue-choices button')[i].click(), index);
    await new Promise((r) => setTimeout(r, 250));
    return { ok: true };
  };
  const talkToNpc = async (npcId) => {
    await page.evaluate((id) => {
      const api = window.amazingAdventure;
      const npc = api.npcs.find((n) => n.id === id);
      api.player.placeAt(npc.group.position.x, npc.group.position.z + 1.7, 0, -0.05);
    }, npcId);
    await new Promise((r) => setTimeout(r, 300));
    await page.evaluate(() => window.amazingAdventure.touch.interact());
    await new Promise((r) => setTimeout(r, 300));
    return page.evaluate(() => ({
      name: document.getElementById('dialogue-name').textContent,
      line: document.getElementById('dialogue-line').textContent,
      visible: !document.getElementById('dialogue').hidden
    }));
  };
  const closeDialogue = async () => {
    await page.evaluate(() => document.getElementById('dialogue-close')?.click() ?? null);
    await new Promise((r) => setTimeout(r, 200));
  };

  // Close Wren's own ledger first, which is what unlocks the arrears.
  await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const s = await import('./src/state.js');
    const state = api.getState();
    s.startLedger(state, 'warm'); s.hearLedgerRumour(state); s.recoverLedger(state);
    s.returnLedger(state, 'cover');
    api.refreshHUD();
  });
  await closeDialogue();

  const wrenOffer = await talkToNpc('wren');
  checks.check('Wren offers to send the lane’s arrears to Mara once her ledger is closed',
    wrenOffer.visible && /arrears|behind to Mara|three weeks/i.test(wrenOffer.line),
    wrenOffer.line.slice(0, 90));

  const arrearsAccepted = await clickChoice('carry it');
  const carried = await page.evaluate(() => ({
    status: window.amazingAdventure.getState().quests.arrears,
    pouch: window.amazingAdventure.getState().inventory.includes('arrears_pouch')
  }));
  checks.check('accepting the arrears puts the pouch in the pack',
    arrearsAccepted.ok && carried.status === 'started' && carried.pouch === true, JSON.stringify(carried));
  await closeDialogue();

  const maraDelivery = await talkToNpc('mara');
  checks.check('Mara receives the arrears in the plaza, across the gate from the lane',
    maraDelivery.visible && /lane’s money|pouch|Wren send you/i.test(maraDelivery.line),
    maraDelivery.line.slice(0, 90));

  const paid = await clickChoice('full amount');
  const afterPay = await page.evaluate(() => ({
    status: window.amazingAdventure.getState().quests.arrears,
    pouch: window.amazingAdventure.getState().inventory.includes('arrears_pouch'),
    receipt: window.amazingAdventure.getState().inventory.includes('keeper_receipt')
  }));
  checks.check('paying in full hands over the pouch and gives a receipt',
    paid.ok && afterPay.status === 'delivered' && afterPay.pouch === false && afterPay.receipt === true,
    JSON.stringify(afterPay));
  await closeDialogue();

  const coinBefore = await page.evaluate(() => window.amazingAdventure.getState().flags.coins);
  const wrenBack = await talkToNpc('wren');
  const handedOver = await clickChoice('Hand over');
  const afterFinish = await page.evaluate(() => ({
    status: window.amazingAdventure.getState().quests.arrears,
    receipt: window.amazingAdventure.getState().inventory.includes('keeper_receipt'),
    coins: window.amazingAdventure.getState().flags.coins,
    journal: [...document.querySelectorAll('#journal-list li')]
      .map((li) => li.textContent).find((t) => /Arrears/i.test(t)) || ''
  }));
  checks.check('carrying Mara’s mark back north finishes the quest and pays the reward',
    handedOver.ok && afterFinish.status === 'done' &&
    afterFinish.receipt === false && afterFinish.coins === coinBefore + 3,
    JSON.stringify(afterFinish));
  checks.check('the journal describes the arrears ending that actually happened',
    /balance|signed|in full/i.test(afterFinish.journal), afterFinish.journal.slice(0, 100));
  await closeDialogue();

  // A player who loses Mara's mark must never be stuck with a quest they cannot
  // finish, so the plaza side offers to write it out again.
  await page.evaluate(() => {
    const api = window.amazingAdventure;
    const state = api.getState();
    state.inventory = state.inventory.filter((id) => id !== 'keeper_receipt');
    state.quests.arrears = 'delivered';
    api.refreshHUD();
  });
  const reissued = await talkToNpc('mara');
  const tookFresh = await clickChoice('fresh mark');
  const afterReissue = await page.evaluate(() => ({
    receipt: window.amazingAdventure.getState().inventory.includes('keeper_receipt'),
    status: window.amazingAdventure.getState().quests.arrears
  }));
  checks.check('a player who loses Mara’s mark can get a replacement instead of being stuck',
    /lost my mark|write it out again/i.test(reissued.line) &&
    tookFresh.ok && afterReissue.receipt === true,
    JSON.stringify(afterReissue));
  await closeDialogue();

  await capture(page, 'round6-lane-arrears.png');

  // --- 21. Reputation refuses content, not only unlocking it --------------
  // Standing previously only ever opened doors. These checks prove it can close
  // one too, that the refusal is explained, and that the critical path stays
  // open so a disliked player can still finish the game and earn their way back.
  const setFaction = async (factionId, score) => page.evaluate(async (id, value) => {
    const api = window.amazingAdventure;
    const { changeReputation } = await import('./src/factions.js');
    const state = api.getState();
    state.reputation[id] = 0;
    changeReputation(state, id, value);
    api.refreshHUD();
  }, factionId, score);

  await page.evaluate(() => {
    const api = window.amazingAdventure;
    // Clear both the oil quest and Oswin's marker: each is an intentional
    // exemption from his refusal, so leaving either in place would (correctly)
    // mean he keeps serving the player.
    const state = api.getState();
    state.quests.lanterns = 'none';
    state.inventory = state.inventory.filter((id) => id !== 'oswin_marker');
    api.refreshHUD();
  });
  await closeDialogue();

  await setFaction('trade', 0);
  const neutralOswin = await talkToNpc('oswin');
  checks.check('a neutral Market is served normally',
    /Stall is open|oil|haggl/i.test(neutralOswin.line) &&
    !/nothing for you/i.test(neutralOswin.line), neutralOswin.line.slice(0, 80));
  await closeDialogue();

  await setFaction('trade', -40);
  const coldOswin = await talkToNpc('oswin');
  checks.check('a Cold Market makes Oswin refuse to deal with the player',
    /nothing for you|goes back to folding/i.test(coldOswin.line), coldOswin.line.slice(0, 90));

  const explained = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('#dialogue-choices button')];
    const index = buttons.findIndex((b) => /change your mind/i.test(b.textContent));
    if (index < 0) return { ok: false };
    buttons[index].click();
    return { ok: true };
  });
  await new Promise((r) => setTimeout(r, 250));
  const explanation = await page.evaluate(() => document.getElementById('dialogue-line').textContent);
  checks.check('the refusal explains what would earn the NPC round',
    explained.ok && /good turn|help|change your mind/i.test(explanation), explanation.slice(0, 90));

  const marketStanding = await page.evaluate(() => document.getElementById('standing-list').textContent);
  checks.check('the Standing panel shows the Market has gone Cold',
    /Market/i.test(marketStanding) && /Cold/i.test(marketStanding), marketStanding.replace(/\s+/g, ' ').slice(0, 90));
  await capture(page, 'round8-refusal.png');
  await closeDialogue();

  // The critical path must survive a hostile plaza: the oil and the key both
  // have to stay obtainable or the game cannot be finished at all.
  await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const s = await import('./src/state.js');
    api.getState().reputation.trade = -90;
    s.startLanterns(api.getState());
    s.startKey(api.getState());
    s.pickUpKey(api.getState());
    api.refreshHUD();
  });
  const hostileOswin = await talkToNpc('oswin');
  checks.check('hostile standing still lets the player buy the oil the first quest needs',
    /oil|4 coins|owe you/i.test(hostileOswin.line) && !/nothing for you/i.test(hostileOswin.line),
    hostileOswin.line.slice(0, 90));
  await closeDialogue();

  const hostileHalden = await talkToNpc('halden');
  checks.check('hostile standing still lets the player hand back the gate key',
    /That is my key/i.test(hostileHalden.line), hostileHalden.line.slice(0, 90));
  await closeDialogue();

  // --- 22. Earning standing back is possible, and costs something ----------
  // A refusal must never be a dead end. The work menu is the repeatable way out,
  // so these checks prove it is reachable, that it charges a real price, that a
  // time-costing job moves the clock, and that standing actually recovers.
  const clickChoiceRegex = async (pattern) => {
    const index = await page.evaluate((p) => [...document.querySelectorAll('#dialogue-choices button')]
      .findIndex((b) => new RegExp(p, 'i').test(b.textContent)), pattern);
    if (index < 0) return { ok: false, labels: await page.evaluate(() => [...document.querySelectorAll('#dialogue-choices button')].map((b) => b.textContent.trim())) };
    await page.evaluate((i) => document.querySelectorAll('#dialogue-choices button')[i].click(), index);
    await new Promise((r) => setTimeout(r, 250));
    return { ok: true };
  };

  // Put the market back into a refusal, then walk the repair path for real.
  await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const { changeReputation } = await import('./src/factions.js');
    const state = api.getState();
    state.quests.lanterns = 'none';
    state.inventory = state.inventory.filter((id) => id !== 'oswin_marker');
    state.reputation.trade = 0;
    changeReputation(state, 'trade', -40);
    state.flags.coins = 20;
    api.refreshHUD();
  });
  await closeDialogue();

  const refusedAgain = await talkToNpc('oswin');
  await clickChoiceRegex('change your mind');
  const offeredWork = await clickChoiceRegex('show me the work');
  const jobLabels = await page.evaluate(() => [...document.querySelectorAll('#dialogue-choices button')].map((b) => b.textContent.trim()));
  checks.check('a refused player is offered repeatable work instead of a dead end',
    refusedAgain.visible && /nothing for you/i.test(refusedAgain.line) && offeredWork.ok &&
    jobLabels.some((l) => /Sweep|Carry|Drill/.test(l)), JSON.stringify(jobLabels.slice(0, 3)));

  checks.check('every job states its price and its reward',
    jobLabels.filter((l) => /Sweep|Carry|Drill/.test(l)).every((l) => /coins|hour/.test(l) && /\+\d+/.test(l)) &&
    !jobLabels.some((l) => /1 coins/.test(l)), JSON.stringify(jobLabels.slice(0, 3)));

  // Capture the repair UI itself, in daylight, while it is on screen: this is
  // the evidence for the feature, not a dark frame after the dialogue closed.
  await page.evaluate(() => window.amazingAdventure.setClock(20));
  await new Promise((r) => setTimeout(r, 600));
  await capture(page, 'round9-standing-repair.png');
  await page.evaluate(() => window.amazingAdventure.setClock(20));
  await new Promise((r) => setTimeout(r, 250));

  const beforeWork = await page.evaluate(() => ({
    trade: window.amazingAdventure.getState().reputation.trade,
    coins: window.amazingAdventure.getState().flags.coins,
    phase: window.amazingAdventure.getClock().phase
  }));

  // A coin job must cost coins and leave the clock alone.
  await clickChoiceRegex('Carry crates');
  const afterCoinJob = await page.evaluate(() => ({
    trade: window.amazingAdventure.getState().reputation.trade,
    coins: window.amazingAdventure.getState().flags.coins,
    phase: window.amazingAdventure.getClock().phase
  }));
  checks.check('a coin job charges its price and does not move the clock',
    afterCoinJob.coins === beforeWork.coins - 2 &&
    afterCoinJob.phase === beforeWork.phase &&
    afterCoinJob.trade > beforeWork.trade,
    JSON.stringify({ beforeWork, afterCoinJob }));

  // A time job must move the clock on, which proves the cost is real.
  await clickChoiceRegex('anything else');
  await clickChoiceRegex('Sweep');
  const afterTimeJob = await page.evaluate(() => ({
    keepers: window.amazingAdventure.getState().reputation.keepers,
    phase: window.amazingAdventure.getClock().phase
  }));
  checks.check('a time job really passes the hour instead of being free reputation',
    afterTimeJob.phase !== afterCoinJob.phase && afterTimeJob.keepers > 0,
    JSON.stringify({ afterCoinJob, afterTimeJob }));

  // Repeat until the refusal lifts, proving the loop is not decorative.
  const recovered = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const { work } = await import('./src/repair.js');
    const { refusalFor } = await import('./src/refusal.js');
    const { REFUSAL_RULES } = await import('./src/state.js');
    const state = api.getState();
    state.flags.coins = 200;
    let jobs = 0;
    while (refusalFor(state, 'oswin', REFUSAL_RULES) !== null && jobs < 60) {
      work(state, 'carry');
      jobs += 1;
    }
    api.refreshHUD();
    return { jobs, trade: state.reputation.trade, stillRefused: refusalFor(state, 'oswin', REFUSAL_RULES) !== null };
  });
  checks.check('enough honest work actually earns the refusal away',
    recovered.stillRefused === false && recovered.jobs > 1,
    JSON.stringify(recovered));

  const served = await talkToNpc('oswin');
  checks.check('the player Oswin refused is served again after working',
    !/nothing for you/i.test(served.line) && served.visible, served.line.slice(0, 90));
  await closeDialogue();

  // --- 23. The plaza work board: goodwill before it is needed --------------
  // Standing work was previously reachable only through a refused NPC, which
  // meant goodwill could only be earned after it was already too late. The board
  // is open to everyone, so a neutral player can build standing up early.
  await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const state = api.getState();
    // Neutral on every front, with nothing that exempts a refusal in the pack.
    state.reputation = { keepers: 0, trade: 0, watch: 0 };
    state.inventory = state.inventory.filter((id) => id !== 'oswin_marker');
    state.flags.coins = 30;
    api.refreshHUD();
    api.player.placeAt(-3.4, 10.4, 0, 0);
  });
  await new Promise((r) => setTimeout(r, 400));
  const boardSeen = await page.evaluate(() => window.amazingAdventure.interactables().map((i) => i.label));
  checks.check('the work board is a findable interactable in the plaza',
    boardSeen.includes('read the work board'), JSON.stringify(boardSeen));

  await page.evaluate(() => window.amazingAdventure.touch.interact());
  await new Promise((r) => setTimeout(r, 350));
  const boardNode = await page.evaluate(() => ({
    name: document.getElementById('dialogue-name').textContent,
    line: document.getElementById('dialogue-line').textContent,
    choices: [...document.querySelectorAll('#dialogue-choices button')].map((b) => b.textContent.trim())
  }));
  checks.check('the board opens as a board, not as a person',
    /Work Board/i.test(boardNode.name) &&
    boardNode.choices.filter((c) => /Sweep|Carry|Drill/.test(c)).length === 3,
    JSON.stringify({ name: boardNode.name, choices: boardNode.choices.slice(0, 3) }));

  // Capture the board menu itself, in daylight, while it is on screen. Taking
  // the shot later would land after the time-costing job has moved the clock to
  // dusk, producing a dim frame that shows the room rather than the feature.
  await page.evaluate(() => window.amazingAdventure.setClock(20));
  await new Promise((r) => setTimeout(r, 600));
  await capture(page, 'round10-job-board.png');

  await page.evaluate(() => window.amazingAdventure.setClock(20));
  await new Promise((r) => setTimeout(r, 250));

  const neutralBefore = await page.evaluate(() => ({
    trade: window.amazingAdventure.getState().reputation.trade,
    coins: window.amazingAdventure.getState().flags.coins,
    memory: Object.keys(window.amazingAdventure.getState().memory)
  }));
  await clickChoiceRegex('Carry crates');
  const neutralAfter = await page.evaluate(() => ({
    trade: window.amazingAdventure.getState().reputation.trade,
    coins: window.amazingAdventure.getState().flags.coins,
    memory: Object.keys(window.amazingAdventure.getState().memory)
  }));
  checks.check('a neutral player can build standing at the board before they need it',
    neutralAfter.trade > neutralBefore.trade &&
    neutralAfter.coins === neutralBefore.coins - 2,
    JSON.stringify({ neutralBefore, neutralAfter }));
  checks.check('taking board work invents no phantom NPC in the save',
    JSON.stringify(neutralAfter.memory) === JSON.stringify(neutralBefore.memory) &&
    !neutralAfter.memory.includes('job_board'),
    JSON.stringify(neutralAfter.memory));
  await closeDialogue();

  // A time job must still cost the hour when taken from the board.
  const phaseBefore = await page.evaluate(() => window.amazingAdventure.getClock().phase);
  await page.evaluate(() => window.amazingAdventure.touch.interact());
  await new Promise((r) => setTimeout(r, 350));
  await clickChoiceRegex('Sweep');
  const phaseAfter = await page.evaluate(() => window.amazingAdventure.getClock().phase);
  checks.check('a time job taken from the board still costs the hour',
    phaseAfter !== phaseBefore, JSON.stringify({ phaseBefore, phaseAfter }));
  await closeDialogue();
  // --- 24. Sound: synthesised, quiet, and always defeatable ----------------
  // There are no audio files, so these checks verify that the graph really is
  // wired and that the player can always silence it -- not that it is pretty.
  // Capture the game with the sound control visible, in daylight.
  await page.evaluate(() => window.amazingAdventure.setClock(25));
  await new Promise((r) => setTimeout(r, 500));
  await capture(page, 'round11-audio.png');

  const audioState = await page.evaluate(() => ({
    started: window.amazingAdventure.audio.started,
    enabled: window.amazingAdventure.audio.enabled,
    toggleVisible: (() => {
      const el = document.getElementById('sound-toggle');
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    })()
  }));
  checks.check('audio starts with the game and the mute control is reachable',
    audioState.started === true && audioState.toggleVisible === true,
    JSON.stringify(audioState));

  const cueResults = await page.evaluate(() => {
    const names = ['talk', 'choose', 'close', 'pickup', 'quest', 'refuse', 'work'];
    return names.map((n) => {
      try { return { name: n, ok: window.amazingAdventure.audio.play(n) !== false }; }
      catch (e) { return { name: n, ok: false, error: String(e) }; }
    });
  });
  checks.check('every interaction cue plays without erroring',
    cueResults.every((r) => r.ok), JSON.stringify(cueResults.filter((r) => !r.ok)));

  // Muting must survive a reload, or a player who hates the sound has to
  // silence it every single session.
  await page.evaluate(() => window.amazingAdventure.audio.setEnabled(false));
  const mutedStored = await page.evaluate(() => localStorage.getItem('amazing-adventure:audio'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForBoot(page);
  const afterReload = await page.evaluate(() => ({
    enabled: window.amazingAdventure.audio.enabled,
    stored: localStorage.getItem('amazing-adventure:audio')
  }));
  checks.check('a muted player stays muted across a reload',
    mutedStored === 'off' && afterReload.enabled === false && afterReload.stored === 'off',
    JSON.stringify({ mutedStored, afterReload }));

  // Restore sound and reopen the game for the remaining checks.
  await page.evaluate(() => window.amazingAdventure.audio.setEnabled(true));
  await page.click('#play');
  await new Promise((r) => setTimeout(r, 600));

  const droneFollows = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const seen = [];
    for (const t of [20, 85, 140]) {
      api.setClock(t);
      await new Promise((r) => setTimeout(r, 100));
      seen.push(api.audio.phase);
    }
    return seen;
  });
  checks.check('the ambience follows the time of day',
    droneFollows.length === 3 && new Set(droneFollows).size === 3,
    JSON.stringify(droneFollows));

  // --- 25. The ending -----------------------------------------------------
  // Six quests used to just stop. A player who finished everything got silence,
  // which reads as unfinished rather than complete.
  const endingBefore = await page.evaluate(() => ({
    section: document.getElementById('ending-section').hidden,
    overlay: document.getElementById('epilogue').hidden
  }));
  checks.check('there is no ending before the story is finished',
    endingBefore.section === true && endingBefore.overlay === true, JSON.stringify(endingBefore));

  // Finish every quest with specific branches, as real play would.
  await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const s = await import('./src/state.js');
    const state = api.getState();
    for (const id of s.QUEST_ORDER) state.quests[id] = 'done';
    state.outcomes = { ledger: 'cover', toll: 'waived', arrears: 'forgive' };
    state.reputation = { keepers: 25, trade: 65, watch: -45 };
    api.refreshHUD();
  });
  await new Promise((r) => setTimeout(r, 400));

  const epilogueShot = await page.evaluate(async () => {
    const s = await import('./src/state.js');
    return {
      overlay: !document.getElementById('epilogue').hidden,
      section: !document.getElementById('ending-section').hidden,
      title: document.getElementById('epilogue-title').textContent,
      opening: document.getElementById('epilogue-opening').textContent,
      questTotal: s.QUEST_ORDER.length,
      branches: [...document.querySelectorAll('#epilogue-branches .epilogue-line')].map((e) => e.textContent),
      closers: [...document.querySelectorAll('#epilogue-closers .epilogue-standing')].map((e) => e.textContent)
    };
  });
  checks.check('finishing the story shows the epilogue',
    epilogueShot.overlay === true && epilogueShot.section === true && epilogueShot.title.length > 0 && epilogueShot.branches.length === 3,
    JSON.stringify({ overlay: epilogueShot.overlay, branches: epilogueShot.branches.length }));

  // The rendered opening used to say "Six errands" while the game had seven
  // quests. Check the page's own text against the live QUEST_ORDER length, so a
  // stale count cannot ship even if the pure test is skipped.
  const numberWords = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
  checks.check('the rendered ending counts the quests the game has',
    epilogueShot.opening.startsWith(`${numberWords[epilogueShot.questTotal - 1]} errands,`),
    `opening "${epilogueShot.opening.slice(0, 22)}" vs ${epilogueShot.questTotal} quests`);

  checks.check('the epilogue reports the branches actually taken, not the others',
    epilogueShot.branches.some((b) => /kept the trader’s name out/i.test(b)) &&
    epilogueShot.branches.some((b) => /waiving the toll/i.test(b)) &&
    epilogueShot.branches.some((b) => /wrote them off/i.test(b)) &&
    !epilogueShot.branches.some((b) => /wrote the trader’s name/i.test(b)),
    JSON.stringify(epilogueShot.branches.map((b) => b.slice(0, 40))));

  checks.check('the epilogue is honest about a faction that dislikes you',
    epilogueShot.closers.some((c) => /Watch/.test(c) && /searches you|written your description|will not/i.test(c)),
    JSON.stringify(epilogueShot.closers.map((c) => c.slice(0, 45))));

  await capture(page, 'round12-ending.png');

  // The late chores (wicks, tally) are outside QUEST_ORDER, so the ending only
  // mentions them when they were walked. Check both halves in the real overlay:
  // silent when not taken, one honest line when done, and the main branch list
  // unchanged either way.
  const sideworkEmpty = await page.evaluate(() =>
    document.querySelectorAll('#epilogue-sidework .epilogue-line').length);
  await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const s = await import('./src/state.js');
    api.getState().quests.wicks = 'done';
    // Re-render the overlay from the journal button, since endingSeen is sticky.
    document.getElementById('epilogue').hidden = true;
    document.getElementById('ending-open').click();
    return s.CHORE_ORDER;
  });
  await new Promise((r) => setTimeout(r, 300));
  const sideworkWalked = await page.evaluate(() => ({
    lines: [...document.querySelectorAll('#epilogue-sidework .epilogue-line')].map((e) => e.textContent),
    branches: document.querySelectorAll('#epilogue-branches .epilogue-line').length
  }));
  checks.check('the ending stays quiet about side work that was never walked',
    sideworkEmpty === 0, `${sideworkEmpty} lines`);
  checks.check('the ending remembers a walked wick round without disturbing the branches',
    sideworkWalked.lines.length === 1 && /wick round/i.test(sideworkWalked.lines[0]) &&
    sideworkWalked.branches === 3,
    JSON.stringify({ lines: sideworkWalked.lines.length, branches: sideworkWalked.branches }));
  await capture(page, 'round80-ending-sidework.png');
  await page.evaluate(async () => {
    const api = window.amazingAdventure;
    api.getState().quests.wicks = 'none';
    document.getElementById('epilogue').hidden = true;
    document.getElementById('ending-open').click();
  });
  await new Promise((r) => setTimeout(r, 250));

  // The ending can be dismissed and reopened from the journal.
  await page.evaluate(() => document.getElementById('epilogue-close').click());
  await new Promise((r) => setTimeout(r, 250));
  const closed = await page.evaluate(() => document.getElementById('epilogue').hidden);
  await page.evaluate(() => document.getElementById('ending-open').click());
  await new Promise((r) => setTimeout(r, 250));
  const reopened = await page.evaluate(() => !document.getElementById('epilogue').hidden);
  checks.check('the epilogue can be dismissed and read again from the journal',
    closed === true && reopened === true, JSON.stringify({ closed, reopened }));
  await page.evaluate(() => document.getElementById('epilogue-close')?.click() ?? null);

  // --- 26. Screen-reader support ------------------------------------------
  // The game is first-person and drawn to a canvas, so without live regions a
  // blind player gets nothing at all: not the area, not who is nearby, not that a
  // quest moved on.
  const aria = await page.evaluate(() => {
    const d = document.getElementById('dialogue');
    const live = document.getElementById('sr-live');
    const alert = document.getElementById('sr-alert');
    return {
      dialogueRole: d.getAttribute('role'),
      ariaModal: d.getAttribute('aria-modal'),
      labelledBy: d.getAttribute('aria-labelledby'),
      live: live?.getAttribute('aria-live'),
      alert: alert?.getAttribute('role'),
      // A live region only works if it is in the tree; display:none silences it.
      liveInTree: live ? live.offsetParent !== null || getComputedStyle(live).position === 'absolute' : false,
      hintRole: document.getElementById('hint').getAttribute('role')
    };
  });
  checks.check('the dialogue panel is announced as a modal dialog',
    aria.dialogueRole === 'dialog' && aria.ariaModal === 'true' && aria.labelledBy === 'dialogue-name',
    JSON.stringify(aria));
  checks.check('there are live regions for spoken progress, and they stay in the accessibility tree',
    aria.live === 'polite' && aria.alert === 'alert' && aria.liveInTree === true,
    JSON.stringify({ live: aria.live, alert: aria.alert, inTree: aria.liveInTree }));

  // The "describe where I am" key must report real state, not atmosphere.
  await page.evaluate(() => document.getElementById('epilogue')?.setAttribute('hidden', ''));
  await page.keyboard.press('KeyC');
  await new Promise((r) => setTimeout(r, 350));
  const described = await page.evaluate(() => window.amazingAdventure.srAlertText());
  checks.check('the describe key reports the area, the gate and the player’s coins',
    /Plaza|Lane/.test(described) && /gate is (open|locked)/.test(described) && /coins/.test(described),
    JSON.stringify(described?.slice(0, 90)));

  // A dialogue must be spoken: the line and its numbered options.
  await page.evaluate(() => {
    const api = window.amazingAdventure;
    const mara = api.npcs.find((n) => n.id === 'mara');
    api.player.position.x = mara.group.position.x;
    api.player.position.z = mara.group.position.z + 1.2;
  });
  await new Promise((r) => setTimeout(r, 350));
  await page.keyboard.press('KeyE');
  await new Promise((r) => setTimeout(r, 500));
  const spoken = await page.evaluate(() => ({
    text: window.amazingAdventure.srAlertText(),
    open: !document.getElementById('dialogue').hidden
  }));
  checks.check('a conversation is spoken aloud, with its options',
    spoken.open === true && /Mara/.test(spoken.text || '') && /1\./.test(spoken.text || ''),
    JSON.stringify(spoken.text?.slice(0, 80)));
  await page.evaluate(() => document.getElementById('dialogue-close').click());
  await new Promise((r) => setTimeout(r, 250));

  // Quest progression used to be entirely silent. Drive the real announcement
  // path (the same function the dialogue uses), not a re-implementation of it.
  const questAnnounce = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const st = api.getState();
    st.quests.lanterns = 'none';
    api.srLiveText();
    api.withAnnouncements(() => { st.quests.lanterns = 'done'; });
    return st.quests.lanterns;
  });
  await new Promise((r) => setTimeout(r, 350));
  // Completion is urgent by design, so it lands in the assertive region.
  const announced = await page.evaluate(() => window.amazingAdventure.srAlertText());
  checks.check('finishing a quest is announced to a screen reader',
    questAnnounce === 'done' && /Quest complete/i.test(announced || ''),
    JSON.stringify({ questAnnounce, announced: announced?.slice(0, 60) }));

  // Reduced motion must be honoured, not ignored.
  const reduced = await page.evaluate(() => {
    const found = [];
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.conditionText && /prefers-reduced-motion/.test(rule.conditionText)) found.push(rule.conditionText);
        }
      } catch { /* cross-origin sheet, not ours */ }
    }
    return found;
  });
  checks.check('the interface honours prefers-reduced-motion',
    reduced.some((c) => /prefers-reduced-motion: reduce/.test(c)), JSON.stringify(reduced));

  await capture(page, 'round13-access.png');

  // --- 27. The spoken compass ---------------------------------------------
  // Announcing what changed is not enough to move through the world. These checks
  // assert the directions are actually right, because a blind player has no way to
  // notice a compass that points the wrong way.
  await page.evaluate(() => { const a = window.amazingAdventure; a.player.placeAt(0, 0, 0, 0); });
  await new Promise((r) => setTimeout(r, 400));

  const compass = await page.evaluate(() => {
    const a = window.amazingAdventure;
    const targets = a.compassTargets();
    const gate = targets.find((t) => t.id === 'gate');
    return { count: targets.length, gate: { x: gate.x, z: gate.z }, hasMara: targets.some((t) => t.id === 'mara') };
  });
  checks.check('the compass knows the real landmarks and where people actually are',
    compass.count >= 10 && compass.gate.z < 0 && compass.hasMara === true,
    JSON.stringify(compass));

  // Query the gate directly: the nearby list only holds the closest few, which at
  // the plaza centre are people, and that is the correct behaviour.
  const gateNorth = await page.evaluate(() => window.amazingAdventure.announceRouteTo('gate'));
  await new Promise((r) => setTimeout(r, 350));
  const facingNorth = await page.evaluate(() => window.amazingAdventure.srAlertText());
  checks.check('standing at the plaza centre facing north puts the north gate ahead, not behind',
    gateNorth?.id === 'gate' &&
    /gate is (straight ahead|ahead and to your (left|right))/i.test(facingNorth || '') &&
    /north/.test(facingNorth || ''),
    JSON.stringify(facingNorth));

  // Turning around must flip the relative direction while the world bearing stays.
  await page.evaluate(() => { const a = window.amazingAdventure; a.player.placeAt(0, 0, Math.PI, 0); });
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => window.amazingAdventure.announceRouteTo('gate'));
  await new Promise((r) => setTimeout(r, 350));
  const facingSouth = await page.evaluate(() => window.amazingAdventure.srAlertText());
  checks.check('turning around flips the relative direction but not the world bearing',
    /gate is (behind you|behind you and to your (left|right))/i.test(facingSouth || '') &&
    /north/.test(facingSouth || ''),
    JSON.stringify(facingSouth));

  // Asking for one place must name it and give a direction.
  await page.evaluate(() => { window.amazingAdventure.player.placeAt(0, 0, 0, 0); });
  await new Promise((r) => setTimeout(r, 300));
  const route = await page.evaluate(() => window.amazingAdventure.announceRouteTo('bench'));
  await new Promise((r) => setTimeout(r, 350));
  const routeText = await page.evaluate(() => window.amazingAdventure.srAlertText());
  checks.check('asking the way to a place names it and gives a direction and bearing',
    route?.id === 'bench' && /bench is/i.test(routeText || '') && /west|left|ahead|behind/i.test(routeText || ''),
    JSON.stringify(routeText));

  // The compass box lives in the journal panel, which starts hidden.
  await page.keyboard.press('KeyJ');
  await new Promise((r) => setTimeout(r, 450));

  // Typing must not drive the game: the compass box is a text field.
  await page.click('#compass-input');
  await page.evaluate(() => { const p = window.amazingAdventure.player; p.velocity.x = 0; p.velocity.z = 0; });
  const posBefore = await page.evaluate(() => {
    const p = window.amazingAdventure.player;
    p.velocity.x = 0; p.velocity.z = 0;
    return { x: p.position.x, z: p.position.z };
  });
  await page.type('#compass-input', 'wwwwww');
  await new Promise((r) => setTimeout(r, 600));
  const typing = await page.evaluate(() => {
    const p = window.amazingAdventure.player;
    return { value: document.getElementById('compass-input').value, x: p.position.x, z: p.position.z };
  });
  const typingMoved = Math.hypot(typing.x - posBefore.x, typing.z - posBefore.z);
  checks.check('typing a place does not walk the player or fire movement hotkeys',
    typing.value === 'wwwwww' && typingMoved < 0.02,
    JSON.stringify({ value: typing.value, moved: Number(typingMoved.toFixed(4)) }));

  // A written query gives the same answer as the spoken one.
  await page.evaluate(() => { document.getElementById('compass-input').value = ''; });
  await page.type('#compass-input', 'bench');
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 400));
  const written = await page.evaluate(() => ({
    panel: document.getElementById('compass-results').textContent,
    spoken: window.amazingAdventure.srAlertText()
  }));
  checks.check('typing a place in the journal gives the same answer aloud and in text',
    /bench is/i.test(written.panel) && written.panel === written.spoken,
    JSON.stringify(written));

  // An unknown place must say so rather than fail silently.
  await page.evaluate(() => { document.getElementById('compass-input').value = ''; });
  await page.type('#compass-input', 'dragon');
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 400));
  const unknown = await page.evaluate(() => document.getElementById('compass-results').textContent);
  checks.check('an unknown place is reported, not ignored',
    /nothing called/i.test(unknown || ''), JSON.stringify(unknown));

  // The written panel and the spoken list must agree, since both come from one source.
  const panelRows = await page.evaluate(() =>
    [...document.querySelectorAll('#compass-list li')].map((li) => li.textContent.trim()));
  checks.check('the journal shows a written compass list, not only speech',
    panelRows.length > 0 && panelRows.some((r) => /(ahead|behind|left|right)/.test(r)),
    JSON.stringify(panelRows.slice(0, 3)));

  await capture(page, 'round14-compass.png');

  // --- 28. Guided travel --------------------------------------------------
  // Round 14 described routes; a blind player still had to walk them. These checks
  // assert the route is real, goes around the world's geometry, and actually
  // delivers the player somewhere useful.
  await page.evaluate(() => { const a = window.amazingAdventure; a.player.placeAt(0, 0, 0, 0); });
  await new Promise((r) => setTimeout(r, 400));

  const navGrid = await page.evaluate(() => {
    const g = window.amazingAdventure.navigationGrid();
    const walkable = g.walkable.reduce((n, v) => n + v, 0);
    return { cols: g.cols, rows: g.rows, walkable };
  });
  checks.check('the navigation grid is built from the live world and covers the market lane',
    navGrid.walkable > 1000 && navGrid.rows >= 60,
    JSON.stringify(navGrid));

  // With the gate shut, the lane must be unreachable rather than faked.
  const shutGate = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const pf = await import('./src/pathfind.js');
    api.getState().quests.key = 'none';
    api.syncGate();
    const grid = api.navigationGrid();
    return {
      ledger: pf.findPath(grid, { x: 0, z: 0 }, { x: 7.6, z: -25 }) ? 'reachable' : 'blocked',
      bench: pf.findPath(grid, { x: 0, z: 0 }, { x: -7, z: 12 }) ? 'reachable' : 'blocked'
    };
  });
  checks.check('a shut gate really does make the lane unreachable',
    shutGate.ledger === 'blocked' && shutGate.bench === 'reachable',
    JSON.stringify(shutGate));

  // Open it: the same route must now exist.
  const openGate = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const pf = await import('./src/pathfind.js');
    api.getState().quests.key = 'done';
    api.syncGate();
    const grid = api.navigationGrid();
    const path = pf.findPath(grid, { x: 0, z: 0 }, { x: 7.6, z: -25 });
    return { reachable: Boolean(path), length: path ? Number(pf.pathLength(path).toFixed(1)) : null };
  });
  checks.check('opening the gate opens a real route into the lane',
    openGate.reachable === true && openGate.length > 20,
    JSON.stringify(openGate));

  // Guided travel must walk the player, not teleport them, and must deliver them.
  // Place just south of the fountain: the fountain now has a real collider, so
  // (0,0) is inside it. The check measures distance *travelled*, so the start
  // point only has to be a walkable cell.
  await page.evaluate(() => { const a = window.amazingAdventure; a.player.placeAt(0, 4, 0, 0); });
  await new Promise((r) => setTimeout(r, 300));
  const began = await page.evaluate(() => window.amazingAdventure.startGuidedTravel('bench'));
  await new Promise((r) => setTimeout(r, 1400));
  const midway = await page.evaluate(() => {
    const a = window.amazingAdventure;
    return { state: a.guidedState(), x: a.player.position.x, z: a.player.position.z };
  });
  checks.check('guided travel starts and moves the player gradually rather than instantly',
    began?.path?.length > 2 && midway.state !== null &&
    Math.hypot(midway.x - 0, midway.z - 4) > 0.5 && Math.hypot(midway.x, midway.z - 4) < 12,
    JSON.stringify({ waypoints: began?.path?.length, moved: Number(Math.hypot(midway.x - 0, midway.z - 4).toFixed(2)) }));

  // The walk is about 16 world units and takes roughly eleven seconds; poll rather
  // than guess a fixed wait, so a slower frame rate cannot make this flaky.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const stillWalking = await page.evaluate(() => window.amazingAdventure.guidedState() !== null);
    if (!stillWalking) break;
    await new Promise((r) => setTimeout(r, 700));
  }
  const finished = await page.evaluate(() => {
    const a = window.amazingAdventure;
    return {
      state: a.guidedState(),
      distanceToBench: Math.hypot(a.player.position.x - (-7), a.player.position.z - 12),
      spoken: a.srAlertText(),
      canUseBench: document.getElementById('hint').innerHTML.includes('rest')
    };
  });
  checks.check('guided travel delivers the player to the bench and says so',
    finished.state === null && finished.distanceToBench < 2.2 && /arrived at the bench/i.test(finished.spoken || ''),
    JSON.stringify({ distance: Number(finished.distanceToBench.toFixed(2)), spoken: finished.spoken }));

  // Taking the controls must stop the autopilot. Start from somewhere that is not
  // already the destination, or there is nothing to cancel. Close the journal first:
  // an earlier block leaves the "walk to" box focused, and typing there is correctly
  // suppressed -- pressing W in a text field should type, not walk.
  await page.evaluate(() => { document.getElementById('compass-input')?.blur(); document.activeElement?.blur?.(); });
  await page.keyboard.press('KeyJ');
  await new Promise((r) => setTimeout(r, 350));
  await page.evaluate(() => { const a = window.amazingAdventure; a.player.placeAt(-10, 10, 0, 0); a.startGuidedTravel('fountain'); });
  await new Promise((r) => setTimeout(r, 900));
  await page.keyboard.down('KeyW');
  await new Promise((r) => setTimeout(r, 250));
  const tookOver = await page.evaluate(() => window.amazingAdventure.guidedState());
  await page.keyboard.up('KeyW');
  checks.check('taking the controls stops guided travel', tookOver === null, JSON.stringify(tookOver));

  // An unreachable destination must be refused out loud, not walked into.
  const refused = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    api.getState().quests.key = 'none';
    api.syncGate();
    api.player.placeAt(0, 0, 0, 0);
    await new Promise((r) => setTimeout(r, 300));
    const result = api.startGuidedTravel('ledger');
    return { path: result?.path ?? null };
  });
  await new Promise((r) => setTimeout(r, 400));
  const refusalText = await page.evaluate(() => window.amazingAdventure.srAlertText());
  checks.check('walking into a shut gate is refused and explained',
    refused.path === null && /cannot be reached/i.test(refusalText || ''),
    JSON.stringify({ path: refused.path, spoken: refusalText }));

  await page.evaluate(() => { const a = window.amazingAdventure; a.getState().quests.key = 'done'; a.syncGate(); });
  await capture(page, 'round15-pathfinding.png');

  // --- 29. The game can actually be finished -------------------------------
  // Every other check in this file sets quest state directly, so a chain could be
  // impossible to complete and all of them would still pass. This drives the real
  // dialogue and state functions through a whole playthrough in the browser. It is
  // the check that caught a soft-lock: paying the market toll used to drop Market
  // standing below Wren's gate with no remaining action able to raise it.
  const finishedRun = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const S = await import('./src/state.js');
    const F = await import('./src/factions.js');
    const D = await import('./src/dialogue.js');
    const E = await import('./src/epilogue.js');

    const state = S.createInitialState();
    const steps = [];
    const talk = (npc, matcher) => {
      const node = D.startConversation(state, npc);
      const index = node.choices.findIndex((c) => matcher.test(c.label));
      if (index === -1) throw new Error(`${npc}: no match for ${matcher}`);
      const result = D.applyChoice(state, npc, node.choices[index]);
      steps.push(`${npc}: ${result.message.slice(0, 40)}`);
      return result;
    };
    talk('mara', /lanterns look low/i);
    talk('oswin', /lantern oil|Pay \d+ coins/i);
    talk('mara', /oil/i);
    talk('halden', /lost something/i);
    S.pickUpKey(state);
    S.returnKey(state);
    talk('pip', /special about the lanterns/i);
    S.watchLanterns(state, 'dusk');
    S.tellPipAboutLanterns(state);
    // Pay the toll: this is the path that used to make the game impossible.
    S.startToll(state);
    S.collectToll(state);
    S.finishToll(state);
    const ledgerOpened = S.startLedger(state, F.tierFor(F.reputation(state, 'trade')).id);
    steps.push(`ledger gate: ${ledgerOpened.changed}`);
    if (!ledgerOpened.changed) {
      return { stuckAt: 'ledger', message: ledgerOpened.message, steps };
    }
    S.hearLedgerRumour(state);
    S.recoverLedger(state);
    S.returnLedger(state, 'name');
    S.startArrears(state);
    S.deliverArrears(state, 'pay');
    S.finishArrears(state);
    // The Night Light: light the lane once so Oswin will offer the round, take
    // his order, let dawn put the lanterns out, then walk the round for real and
    // settle it at his stall. This is the round-56 quest, driven through the
    // same rules and dialogue the player's clicks run.
    const A = await import('./src/areas.js');
    const firstLight = A.lightLaneLanterns(state, 'dusk');
    steps.push(`lane: ${firstLight.message.slice(0, 40)}`);
    talk('oswin', /What kind of work/i);
    A.laneLanternsAtDawn(state, 'day');
    const walkLight = A.lightLaneLanterns(state, 'dusk');
    steps.push(`lane: ${walkLight.message.slice(0, 40)}`);
    talk('oswin', /night order/i);
    return {
      counts: S.questCounts(state),
      complete: E.storyComplete(state),
      epilogue: E.buildEpilogue(state)?.title ?? null,
      branches: E.buildEpilogue(state)?.branches?.length ?? 0,
      coins: state.flags.coins,
      steps
    };
  });
  checks.check('a whole playthrough finishes the story, having paid the toll',
    finishedRun.complete === true && finishedRun.counts?.done === 7,
    JSON.stringify({ complete: finishedRun.complete, counts: finishedRun.counts, stuckAt: finishedRun.stuckAt, message: finishedRun.message }));
  checks.check('finishing by real play reaches the ending with all branches recorded',
    finishedRun.epilogue !== null && finishedRun.branches === 3,
    JSON.stringify({ epilogue: finishedRun.epilogue, branches: finishedRun.branches }));
  checks.check('real play never leaves the player in debt',
    typeof finishedRun.coins === 'number' && finishedRun.coins >= 0,
    JSON.stringify({ coins: finishedRun.coins }));

  // Paying the toll is the specific trap, so it is checked on its own too.
  const tollTrap = await page.evaluate(async () => {
    const S = await import('./src/state.js');
    const F = await import('./src/factions.js');
    const D = await import('./src/dialogue.js');
    const state = S.createInitialState();
    const talk = (npc, matcher) => {
      const node = D.startConversation(state, npc);
      const i = node.choices.findIndex((c) => matcher.test(c.label));
      return D.applyChoice(state, npc, node.choices[i]);
    };
    talk('mara', /lanterns look low/i);
    talk('oswin', /Pay \d+ coins/i);
    talk('mara', /oil/i);
    talk('halden', /lost something/i);
    S.pickUpKey(state); S.returnKey(state);
    talk('pip', /special/i);
    S.watchLanterns(state, 'dusk'); S.tellPipAboutLanterns(state);
    S.startToll(state); S.collectToll(state); S.finishToll(state);
    const tier = F.tierFor(F.reputation(state, 'trade')).id;
    return { tier, market: F.reputation(state, 'trade'), unlocked: S.ledgerUnlocked(state, tier) };
  });
  checks.check('paying the toll leaves Wren still willing to deal with you',
    tollTrap.unlocked === true,
    JSON.stringify(tollTrap));

  await capture(page, 'round17-playthrough.png');

  // --- 28b. The audio contract, against the browser's real Web Audio ---------
  // The unit tests use a recording fake; this uses the actual AudioContext so a
  // disagreement between the fake and the browser cannot hide.
  const audioLive = await page.evaluate(async () => {
    const a = await import('./src/audio.js');
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return { noWebAudio: true };
    const sound = a.createSoundscape({
      AudioContextClass: Ctx,
      preference: { enabled: true, volume: 0.7 }
    });
    const beforeStart = sound.play('quest');
    const started = sound.start();
    const afterStart = sound.play('quest');
    const phases = [];
    for (const p of ['dusk', 'night', 'day']) { sound.setPhase(p); phases.push(sound.phase); }
    sound.stop();
    const afterStop = sound.play('quest');
    const restarted = sound.start();
    const afterRestart = sound.play('quest');
    sound.stop();
    return { beforeStart, started, afterStart, phases, afterStop, restarted, afterRestart };
  });
  checks.check('the real Web Audio graph plays cues only while started',
    audioLive.beforeStart === false && audioLive.started === true &&
    audioLive.afterStart === true && audioLive.afterStop === false &&
    audioLive.afterRestart === true,
    JSON.stringify(audioLive));
  checks.check('phase changes reach the soundscape',
    Array.isArray(audioLive.phases) && audioLive.phases.join(',') === 'dusk,night,day',
    JSON.stringify({ phases: audioLive.phases }));

  // Rendered offline, so this measures real samples rather than "the call returned".
  const audioSamples = await page.evaluate(async () => {
    const a = await import('./src/audio.js');
    const render = async (fn, seconds = 1.1) => {
      const ctx = new OfflineAudioContext(1, Math.ceil(44100 * seconds), 44100);
      fn(ctx);
      const buf = await ctx.startRendering();
      const d = buf.getChannelData(0);
      let peak = 0;
      for (const v of d) { const m = Math.abs(v); if (m > peak) peak = m; }
      return +peak.toFixed(5);
    };
    const tone = a.phaseTone('day');
    const dronePeak = await render((ctx) => {
      const g = ctx.createGain(); g.gain.value = tone.gain;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420; f.Q.value = 0.6;
      const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = a.noteFrequency(tone.root); o1.detune.value = tone.detune;
      const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = a.noteFrequency(tone.root + 12);
      const bg = ctx.createGain(); bg.gain.value = 0.18;
      o1.connect(f); o2.connect(bg); bg.connect(f); f.connect(g); g.connect(ctx.destination);
      o1.start(); o2.start();
    });
    const cue = a.CUES.quest;
    const env = a.envelope(a.cueGain(cue));
    const cuePeak = await render((ctx) => {
      const freq = a.noteFrequency(a.pentatonicNote(tone.root + 24, cue.degree));
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, 0);
      g.gain.linearRampToValueAtTime(env.peak, env.attack);
      g.gain.linearRampToValueAtTime(env.peak * 0.6, env.attack + env.hold);
      g.gain.exponentialRampToValueAtTime(0.0001, env.attack + env.hold + cue.length + env.release);
      g.connect(ctx.destination);
      for (const [multiple, level] of cue.partials) {
        const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = freq * multiple;
        const pg = ctx.createGain(); pg.gain.value = level;
        osc.connect(pg); pg.connect(g); osc.start(0); osc.stop(a.cueDuration(cue) + 0.05);
      }
    });
    return { dronePeak, cuePeak, droneGain: tone.gain, cueGain: +env.peak.toFixed(5) };
  });
  checks.check('the drone renders audible signal at the level it claims',
    audioSamples.dronePeak > 0.005 && audioSamples.dronePeak < 0.25,
    JSON.stringify(audioSamples));
  await capture(page, 'round23-audio.png');
  // --- 23b. Footsteps: the step method renders real signal ------------------
  // The step clock maths is unit-tested; here we check the browser-facing
  // step() actually produces audible samples through a real OfflineAudioContext,
  // and that it obeys the same off/unstarted contract as play().
  const stepSamples = await page.evaluate(async () => {
    const a = await import('./src/audio.js');
    const render = async (fn, seconds = 0.5) => {
      const ctx = new OfflineAudioContext(1, Math.ceil(44100 * seconds), 44100);
      fn(ctx);
      const buf = await ctx.startRendering();
      const d = buf.getChannelData(0);
      let peak = 0;
      for (const v of d) { const m = Math.abs(v); if (m > peak) peak = m; }
      return +peak.toFixed(5);
    };
    // Render one footstep directly: noise -> lowpass -> enveloped gain.
    const stepPeak = await render((ctx) => {
      const length = ctx.sampleRate;
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
      const source = ctx.createBufferSource(); source.buffer = buffer;
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass';
      filter.frequency.value = a.FOOTSTEP.cutoff; filter.Q.value = a.FOOTSTEP.q;
      const gain = ctx.createGain();
      const peakGain = a.footstepGain(4.2, 4.2);
      gain.gain.setValueAtTime(0.0001, 0);
      gain.gain.linearRampToValueAtTime(peakGain, a.FOOTSTEP.attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, a.FOOTSTEP.attack + a.FOOTSTEP.length + a.FOOTSTEP.release);
      source.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
      source.start(0); source.stop(a.FOOTSTEP.attack + a.FOOTSTEP.length + a.FOOTSTEP.release + 0.02);
    });
    // The live soundscape's step() contract via the debug API.
    const api = window.amazingAdventure;
    const beforeStart = api.audio.step({ speed: 4.2, walkSpeed: 4.2 });
    return { stepPeak, footstepGain: a.footstepGain(4.2, 4.2), beforeStart };
  });
  // --- 23c. The lane ambience bed ------------------------------------------
  // The bed is only audible in the market lane, and it must be demonstrably
  // quieter than the drone it sits under.
  const bed = await page.evaluate(async () => {
    const a = await import('./src/audio.js');
    const api = window.amazingAdventure;
    const render = async (seconds = 0.6) => {
      const ctx = new OfflineAudioContext(1, Math.ceil(44100 * seconds), 44100);
      const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      const source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true;
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass';
      filter.frequency.value = a.LANE_BED_CUTOFF; filter.Q.value = 0.7;
      const gain = ctx.createGain(); gain.gain.value = a.laneBedGain('lane', false, 0.7);
      source.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
      source.start(0);
      const buf = await ctx.startRendering();
      const d = buf.getChannelData(0);
      let peak = 0;
      for (const v of d) { const m = Math.abs(v); if (m > peak) peak = m; }
      return +peak.toFixed(5);
    };
    const bedPeak = await render();
    return {
      bedPeak,
      lane: a.laneBedGain('lane', false, 0.7),
      plaza: a.laneBedGain('plaza', false, 0.7),
      muted: a.laneBedGain('lane', true, 0.7),
      droneGain: a.phaseTone('day').gain,
      apiArea: api.audio.area
    };
  });
  checks.check('the lane ambience bed only sounds in the lane, and stays under the drone',
    bed.lane > 0 && bed.plaza === 0 && bed.muted === 0 &&
    bed.lane < bed.droneGain && bed.bedPeak > 0.0005 && bed.bedPeak < 0.2,
    JSON.stringify(bed));

  checks.check('the running game tracks the player\'s area for the ambience bed',
    typeof bed.apiArea === 'string' && bed.apiArea.length > 0,
    JSON.stringify({ area: bed.apiArea }));

  checks.check('a footstep renders audible signal below the cue ceiling',
    stepSamples.stepPeak > 0.001 && stepSamples.stepPeak < 1 &&
    stepSamples.footstepGain <= 0.14,
    JSON.stringify(stepSamples));

  checks.check('a cue renders above the drone without clipping',
    audioSamples.cuePeak > audioSamples.dronePeak && audioSamples.cuePeak < 1,
    JSON.stringify(audioSamples));

  // --- 28. The modelled fountain and stone textures --------------------------
  // Await the settle point rather than sleeping: assets are an upgrade loaded in
  // the background, so timing is not something a test should guess at.
  const assets = await page.evaluate(() => window.amazingAdventure.assetsReady().then(() => {
    const api = window.amazingAdventure;
    const model = api.scene.getObjectByName('fountain-model');
    const standin = api.scene.getObjectByName('fountain-standin');
    let parts = 0;
    let tris = 0;
    let minY = Infinity;
    let maxY = -Infinity;
    let reach = 0;
    if (model) {
      model.traverse((o) => {
        if (!o.isMesh) return;
        parts += 1;
        tris += o.geometry.index.count / 3;
        o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox;
        minY = Math.min(minY, b.min.y);
        maxY = Math.max(maxY, b.max.y);
        reach = Math.max(reach, Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z));
      });
    }
    const plaza = api.scene.children.find((o) => o.isMesh && o.geometry.type === 'CircleGeometry');
    // The terrace stone: named in world.js so this check does not have to guess
    // which grey box is which. Two treads (slab + ramp deck) and the upright
    // kerb/parapet band.
    const named = (name) => api.scene.children.find((o) => o.isMesh && o.name === name) || null;
    const describe = (mesh) => {
      if (!mesh || !mesh.material) return null;
      const m = mesh.material;
      return {
        map: Boolean(m.map),
        normal: Boolean(m.normalMap),
        rough: Boolean(m.roughnessMap),
        repeat: m.map ? [m.map.repeat.x, m.map.repeat.y] : null,
        color: m.color.getHexString(),
        metalness: m.metalness
      };
    };
    // A projected surface is recognisable from its UV attribute alone: real metres
    // divided by a ~1.6 m tile means spans well past 1.0, while untouched
    // BoxGeometry UVs sit pinned inside 0..1 on every face.
    const uvSpan = (mesh) => {
      const uv = mesh && mesh.geometry && mesh.geometry.getAttribute && mesh.geometry.getAttribute('uv');
      if (!uv) return null;
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < uv.count * 2; i += 1) {
        const v = uv.array[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      return [Number(min.toFixed(3)), Number(max.toFixed(3))];
    };
    const kerbs = api.scene.children.filter((o) => o.isMesh && o.name === 'terrace-kerb');
    const parapets = api.scene.children.filter((o) => o.isMesh && o.name === 'terrace-parapet');
    return {
      state: api.assetState(),
      modelPresent: Boolean(model),
      standinPresent: Boolean(standin),
      parts,
      tris,
      height: Number((maxY - minY).toFixed(3)),
      minY: Number(minY.toFixed(3)),
      reach: Number(reach.toFixed(3)),
      plazaMaps: plaza ? {
        map: Boolean(plaza.material.map),
        normal: Boolean(plaza.material.normalMap),
        rough: Boolean(plaza.material.roughnessMap),
        repeat: plaza.material.map ? [plaza.material.map.repeat.x, plaza.material.map.repeat.y] : null,
        color: plaza.material.color.getHexString()
      } : null,
      terrace: {
        tread: describe(named('terrace-tread')),
        ramp: describe(named('terrace-ramp')),
        kerbs: kerbs.map(describe),
        parapets: parapets.map(describe),
        // The tread and the ramp deck are one walked material by design, so they
        // legitimately share a material object. What must differ is the *UV range*:
        // it is box-projected in metres, so each surface spans its own real size.
        treadRampSharesMaterial: Boolean(
          named('terrace-tread')?.material &&
          named('terrace-tread')?.material === named('terrace-ramp')?.material),
        // The upright band is a separate material and must not share the tread's
        // texture object, or sampler state would be shared too.
        treadParapetSharesMap: Boolean(
          named('terrace-tread')?.material?.map &&
          named('terrace-tread')?.material?.map === parapets[0]?.material?.map),
        treadUvSpan: uvSpan(named('terrace-tread')),
        rampUvSpan: uvSpan(named('terrace-ramp')),
        kerbUvSpan: uvSpan(kerbs[0]),
        parapetUvSpan: uvSpan(parapets[0])
      }
    };
  }));

  checks.check('the modelled fountain replaces the procedural stand-in',
    assets.state.fountain === 'model' && assets.modelPresent && !assets.standinPresent,
    JSON.stringify(assets.state));

  checks.check('the fountain is the reviewed low-poly model, not a placeholder',
    assets.parts === 12 && assets.tris === 332,
    JSON.stringify({ parts: assets.parts, tris: assets.tris }));

  checks.check('the fountain stands on the ground and stays inside its collider',
    assets.minY >= -0.001 && assets.height > 2 && assets.reach <= 2.15,
    JSON.stringify({ minY: assets.minY, height: assets.height, reach: assets.reach }));

  checks.check('the plaza floor is dressed with all three flagstone maps',
    assets.state.plazaFloor === 'textured' && assets.plazaMaps &&
    assets.plazaMaps.map && assets.plazaMaps.normal && assets.plazaMaps.rough,
    JSON.stringify(assets.plazaMaps));

  checks.check('the flagstone tiles at a believable scale and is not double-tinted',
    assets.plazaMaps && assets.plazaMaps.repeat[0] === 6 &&
    assets.plazaMaps.repeat[1] === 6 && assets.plazaMaps.color === 'ffffff',
    JSON.stringify({ repeat: assets.plazaMaps && assets.plazaMaps.repeat, color: assets.plazaMaps && assets.plazaMaps.color }));

  // Round 62: the north terrace is the largest untextured grey mass left in the
  // plaza view. Tread, ramp deck and parapet share the wall stone family but must
  // not share a texture object, because repeat/wrap live on the texture.
  checks.check('the terrace tread and ramp deck are dressed from the stone family',
    assets.state.terrace === 'textured' &&
    assets.terrace.tread && assets.terrace.tread.map &&
    assets.terrace.tread.normal && assets.terrace.tread.rough &&
    assets.terrace.ramp && assets.terrace.ramp.map &&
    assets.terrace.ramp.normal && assets.terrace.ramp.rough,
    JSON.stringify({ terrace: assets.state.terrace, tread: assets.terrace.tread, ramp: assets.terrace.ramp }));

  checks.check('the terrace stone is box-projected in metres, not stretched 0..1 per face',
    assets.terrace.tread &&
    assets.terrace.treadUvSpan && assets.terrace.treadUvSpan[1] > 2 &&
    assets.terrace.rampUvSpan && assets.terrace.rampUvSpan[1] > 1.2 &&
    assets.terrace.kerbUvSpan && assets.terrace.kerbUvSpan[1] > 1.2,
    JSON.stringify({ tread: assets.terrace.treadUvSpan, ramp: assets.terrace.rampUvSpan,
                     kerb: assets.terrace.kerbUvSpan, parapet: assets.terrace.parapetUvSpan }));

  checks.check('projected UVs carry the tiling, so the texture repeat stays 1:1',
    [assets.terrace.tread, assets.terrace.ramp, ...assets.terrace.parapets]
      .every((m) => m && m.repeat && m.repeat[0] === 1 && m.repeat[1] === 1),
    JSON.stringify({ tread: assets.terrace.tread && assets.terrace.tread.repeat,
                     ramp: assets.terrace.ramp && assets.terrace.ramp.repeat,
                     parapet: assets.terrace.parapets[0] && assets.terrace.parapets[0].repeat }));

  checks.check('the upright band is a separate material with its own stone maps',
    assets.terrace.kerbs.length === 2 && assets.terrace.parapets.length === 4 &&
    assets.terrace.kerbs.every((m) => m && m.map && m.normal && m.rough) &&
    assets.terrace.parapets.every((m) => m && m.map && m.normal && m.rough) &&
    assets.terrace.treadParapetSharesMap === false,
    JSON.stringify({ kerbs: assets.terrace.kerbs.length, parapets: assets.terrace.parapets.length,
                     firstKerb: assets.terrace.kerbs[0], firstParapet: assets.terrace.parapets[0],
                     sharesMap: assets.terrace.treadParapetSharesMap }));

  checks.check('the terrace stone is white and not double-tinted',
    [assets.terrace.tread, assets.terrace.ramp, ...assets.terrace.kerbs, ...assets.terrace.parapets]
      .every((m) => m && m.color === 'ffffff' && m.metalness === 0),
    JSON.stringify({ tread: assets.terrace.tread && assets.terrace.tread.color,
                     parapet: assets.terrace.parapets[0] && assets.terrace.parapets[0].color }));

  checks.check('the tread and ramp deck share one walked material, so the ramp cannot shear',
    assets.terrace.treadRampSharesMaterial === true &&
    JSON.stringify(assets.terrace.treadUvSpan) !== JSON.stringify(assets.terrace.rampUvSpan),
    JSON.stringify({ sharesMaterial: assets.terrace.treadRampSharesMaterial,
                     treadUv: assets.terrace.treadUvSpan, rampUv: assets.terrace.rampUvSpan }));

  // Round 64: the fountain's carved stone was the last smooth flat-coloured mass
  // in the plaza centre while the walls, terrace and gate beside it are coursed
  // ashlar. The GLB ships no UVs at all, so the dressing pass has to generate
  // them; a surface with no uv attribute is proof the pass did not run.
  const fountainStone = await page.evaluate(() => {
    const api = window.amazingAdventure;
    const found = {};
    api.scene.traverse((o) => {
      if (o.isMesh && o.parent && o.parent.name === 'fountain-model') found[o.name] = o;
    });
    const describe = (mesh) => {
      if (!mesh || !mesh.material) return null;
      const m = mesh.material;
      const uv = mesh.geometry.getAttribute && mesh.geometry.getAttribute('uv');
      let span = null;
      if (uv) {
        let min = Infinity;
        let max = -Infinity;
        for (let i = 0; i < uv.count * 2; i += 1) {
          const v = uv.array[i];
          if (v < min) min = v;
          if (v > max) max = v;
        }
        span = [Number(min.toFixed(3)), Number(max.toFixed(3))];
      }
      return {
        uv: Boolean(uv),
        uvSpan: span,
        map: Boolean(m.map),
        normal: Boolean(m.normalMap),
        rough: Boolean(m.roughnessMap),
        repeat: m.map ? [m.map.repeat.x, m.map.repeat.y] : null,
        color: m.color.getHexString(),
        metalness: m.metalness,
        roughness: Number(m.roughness.toFixed(3))
      };
    };
    const stone = ['FountainPlinthUpper', 'FountainBasin', 'FountainColumn', 'FountainUpperBowl'];
    const dark = ['FountainPlinthLower', 'FountainFinial',
      'FountainCornerBlock0', 'FountainCornerBlock1', 'FountainCornerBlock2', 'FountainCornerBlock3'];
    const water = ['FountainWaterLower', 'FountainWaterUpper'];
    return {
      state: api.assetState(),
      stone: stone.map((n) => ({ name: n, ...describe(found[n]) })),
      dark: dark.map((n) => ({ name: n, ...describe(found[n]) })),
      water: water.map((n) => ({ name: n, ...describe(found[n]) })),
      // One map object per material, not one shared by all ten: Stone and
      // StoneDark project at the same scale but must stay separable.
      sharesMap: Boolean(
        found.FountainBasin?.material?.map &&
        (found.FountainBasin.material.map === found.FountainPlinthUpper?.material?.map ||
         found.FountainBasin.material.map === found.FountainPlinthLower?.material?.map)),
      sharesMaterial: Boolean(
        found.FountainBasin?.material &&
        found.FountainBasin.material === found.FountainUpperBowl?.material),
      basinMaterialEqPlinth: Boolean(
        found.FountainBasin?.material &&
        found.FountainBasin.material === found.FountainPlinthLower?.material),
      // Luma of the dark stone's tint multiplier. The authored tones differ by
      // ~21% luma, so a multiplier in this band is a visible tone shift without
      // washing the map out; 255 would mean the two stones render identically.
      darkColorLuma: (() => {
        const hex = found.FountainPlinthLower?.material?.color?.getHexString();
        if (!hex) return null;
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return Number((0.2126 * r + 0.7152 * g + 0.0722 * b).toFixed(1));
      })()
    };
  });

  checks.check('the fountain stone is dressed from the quarried stone family',
    fountainStone.state.fountainStone === 'textured' &&
    [...fountainStone.stone, ...fountainStone.dark]
      .every((m) => m && m.map && m.normal && m.rough),
    JSON.stringify({ state: fountainStone.state.fountainStone,
                     stone: fountainStone.stone, dark: fountainStone.dark }));

  checks.check('the UV-less fountain stone gets projected UVs in metres',
    // The authored meshes had no uv attribute at all, so any UV range at all
    // proves generation; a range past 1.0 proves it is projected in metres and
    // not squeezed into 0..1 per face.
    [...fountainStone.stone, ...fountainStone.dark].every((m) => m && m.uv) &&
    [...fountainStone.stone, ...fountainStone.dark].some((m) => m && m.uvSpan &&
      (m.uvSpan[1] - m.uvSpan[0]) > 1),
    JSON.stringify([...fountainStone.stone, ...fountainStone.dark]
      .map((m) => ({ name: m.name, uv: m.uv, span: m.uvSpan }))));

  checks.check('the fountain stone is white where the map carries the albedo',
    // The light Stone must stay white so its map is not tinted twice. The dark
    // stone is deliberately *not* white: see the next check.
    fountainStone.stone.every((m) => m && m.color === 'ffffff' && m.metalness === 0),
    JSON.stringify(fountainStone.stone.map((m) => ({ name: m.name, color: m.color }))));

  checks.check('the two fountain stones still look different once mapped',
    // A white multiplier on both stones would render StoneDark byte-identical to
    // Stone, and the fountain would lose its plinth, finial and corner blocks --
    // the base that makes it read as a built fountain rather than a bowl. The dark
    // stone therefore carries the ratio of the two authored tones as a multiplier,
    // which keeps the map's own contrast and only shifts the overall tone.
    fountainStone.dark.every((m) => m && m.color !== 'ffffff') &&
    fountainStone.dark.every((m) => m && m.color === fountainStone.dark[0].color) &&
    fountainStone.darkColorLuma < 235 &&
    fountainStone.darkColorLuma > 160,
    JSON.stringify({ dark: fountainStone.dark.map((m) => ({ name: m.name, color: m.color })),
                     darkLuma: fountainStone.darkColorLuma }));

  checks.check('the two fountain stones keep separate materials and maps',
    // Stone and StoneDark differ in the model; merging them would erase the
    // plinth/finial/corner blocks that give the fountain its base.
    fountainStone.sharesMaterial === false &&
    fountainStone.basinMaterialEqPlinth === false &&
    fountainStone.sharesMap === false,
    JSON.stringify({ sharesMaterial: fountainStone.sharesMaterial,
                     basinEqPlinth: fountainStone.basinMaterialEqPlinth,
                     sharesMap: fountainStone.sharesMap }));

  checks.check('the fountain water is dressed with its own water family (round 73)',
    // Round 73 gives the two water discs their own tileable water family. The
    // stone pass must still never touch them (that would read as wet flagstone),
    // and the water material must stay reflective: a near-mirror roughness and
    // a normal map, never the stone albedo.
    // The reflectivity lives in the roughness map (0.02..0.16); the material's
    // base roughness is the ceiling at 1 so the map is not squared away. What
    // this check can see at material level is the faint authored sheen.
    fountainStone.water.every((m) => m && m.map === true && m.normal === true &&
      m.rough === true && m.uv === true &&
      m.roughness === 1 && m.metalness > 0),
    JSON.stringify(fountainStone.water));

  checks.check('the two water discs share one water material and map set',
    // Both discs are the same surface treatment, so they share one material
    // rather than cloning two samplers for a 2.8 m and a 1.3 m disc.
    fountainStone.water.every((m) => m && m.color === fountainStone.water[0].color) &&
    fountainStone.water.every((m) => m && m.repeat && m.repeat[0] === 1 && m.repeat[1] === 1),
    JSON.stringify(fountainStone.water));

  checks.check('projected fountain UVs carry the tiling, so repeat stays 1:1',
    [...fountainStone.stone, ...fountainStone.dark]
      .every((m) => m && m.repeat && m.repeat[0] === 1 && m.repeat[1] === 1),
    JSON.stringify([...fountainStone.stone, ...fountainStone.dark]
      .map((m) => ({ name: m.name, repeat: m.repeat }))));

  // --- 28b2. Glass follows the hour (round 74) -----------------------------
  // The two window panes and the five lantern housings were the last flat,
  // unlit surfaces in the plaza. They stay unmapped on purpose (a 512 px map on
  // a 0.8 m pane is finer than the pane), but their colour, reflection and
  // glow now follow the hour and, for the lane post, the lantern round.
  const glass = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    await api.assetsReady();
    api.quality.set('full');
    const read = () => {
      const panes = [];
      api.scene.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const name = o.material.name || '';
        if (name !== 'HouseGlass' && name !== 'LampGlass') return;
        panes.push({
          mesh: o.name,
          material: name,
          color: o.material.color.getHexString(),
          emissive: o.material.emissive.getHexString(),
          glow: Number(Number(o.material.emissiveIntensity).toFixed(3)),
          metalness: Number(Number(o.material.metalness).toFixed(3)),
          roughness: Number(Number(o.material.roughness).toFixed(3)),
          castShadow: o.castShadow,
          // Material identity: the four plaza lanterns were built from one cached
          // parse and must keep one material; the lane post must be a clone.
          matId: o.material.uuid,
          lane: (() => {
            for (let n = o; n; n = n.parent) if (n.name === 'lane-lamp-model') return true;
            return false;
          })()
        });
      });
      return panes;
    };
    // The lane flag is the player's own state, so set it explicitly rather than
    // relying on what earlier checks in this suite happened to leave behind.
    const night = (lit) => {
      api.getState().flags.laneLanternsLit = lit;
      api.setClock(140);
      return read();
    };
    const state = api.assetState();
    const day = (() => { api.getState().flags.laneLanternsLit = false; api.setClock(20); return read(); })();
    const duskDark = (() => { api.getState().flags.laneLanternsLit = false; api.setClock(85); return read(); })();
    const duskLit = (() => { api.getState().flags.laneLanternsLit = true; api.setClock(85); return read(); })();
    const nightDark = night(false);
    const nightLit = night(true);
    // The tier must re-write the glow without waiting for a phase change: the
    // low tier turns the point lights off, so an un-dimmed bloom would glow
    // with nothing behind it.
    api.quality.set('low');
    const nightLow = read();
    api.quality.set('full');
    const nightRestored = read();
    // Leave the world where the suite found it: daylight, lane dark, full tier.
    api.getState().flags.laneLanternsLit = false;
    api.setClock(20);
    return { state, day, duskDark, duskLit, nightDark, nightLit, nightLow, nightRestored };
  });

  checks.check('the glass pass finds two windows and five lantern panes (round 74)',
    glass.state.glass === 'phase-lit' && glass.state.glassDetail
    && glass.state.glassDetail.panes === 7
    && glass.state.glassDetail.windows === 2
    && glass.state.glassDetail.lamps === 5
    && glass.state.glassDetail.lanePanes === 1,
    JSON.stringify(glass.state.glassDetail));

  checks.check('each hour gives the panes its own colour and reflection',
    // Day is dark, reflective and unlit; night is warm and lit. Comparing whole
    // phase reads catches a pass that writes one number but forgets another.
    // The window carries the day mirror (metalness 0.35) and the lamp pane a
    // faint authored one (0.15, constant across hours -- what changes for it is
    // its tint and its glow), so the "reflective by day" clause is asserted on
    // the windows only.
    glass.day.every((p) => p.glow === 0)
    && glass.day.filter((p) => p.material === 'HouseGlass').every((p) => p.metalness > 0.2)
    && glass.day.filter((p) => p.material === 'LampGlass').every((p) => p.metalness > 0)
    && glass.nightDark.every((p) => p.metalness > 0 && p.metalness <= 0.35)
    && glass.day.every((p) => p.color !== glass.nightLit.find((n) => n.mesh === p.mesh).color),
    JSON.stringify({ day: glass.day[0], night: glass.nightDark[0] }));

  // The window's own curve, read off the window panes only (the plaza lanterns
  // are phase-lit too, but at a different rate; mixing them would hide a window
  // that failed to warm).
  const windowCurve = {
    day: glass.day.find((p) => p.material === 'HouseGlass'),
    dusk: glass.duskLit.find((p) => p.material === 'HouseGlass'),
    night: glass.nightLit.find((p) => p.material === 'HouseGlass')
  };
  checks.check('a lit window warms strictly from day through dusk to night',
    windowCurve.day.glow === 0
    && windowCurve.dusk.glow > 0
    && windowCurve.night.glow > windowCurve.dusk.glow,
    JSON.stringify({ day: windowCurve.day.glow, dusk: windowCurve.dusk.glow,
                     night: windowCurve.night.glow }));

  checks.check('the lane pane stays dark until the lantern round is walked',
    // The lane post is the one fixture the player lights, so its pane must not
    // glow over a dark bulb -- and must glow once the round is walked, over the
    // same hour. The plaza panes are the control: they follow the hour alone.
    glass.nightDark.filter((p) => p.lane).every((p) => p.glow === 0)
    && glass.nightDark.filter((p) => !p.lane).every((p) => p.glow > 0)
    && glass.nightLit.filter((p) => p.lane).every((p) => p.glow > 0)
    && glass.nightLit.filter((p) => p.lane).every((p) =>
      p.glow === glass.nightLit.find((n) => n.material === 'LampGlass' && !n.lane).glow),
    JSON.stringify({ dark: glass.nightDark.map((p) => [p.mesh, p.glow, p.lane]),
                     lit: glass.nightLit.map((p) => [p.mesh, p.glow, p.lane]) }));

  checks.check('a dark lane leaves a window alone: the two are independent',
    // A window has no bulb in the game's model of the lane. Both lane states must
    // give the windows identical states at the same hour, pane for pane and
    // field for field.
    (() => {
      const windows = (phase) => glass[phase]
        .filter((p) => p.material === 'HouseGlass')
        .map((p) => [p.mesh, p.color, p.emissive, p.glow, p.metalness, p.roughness]);
      return JSON.stringify(windows('duskDark')) === JSON.stringify(windows('duskLit'))
        && JSON.stringify(windows('nightDark')) === JSON.stringify(windows('nightLit'))
        && windows('nightDark').length === 2;
    })(),
    JSON.stringify({
      dusk: [glass.duskDark.filter((p) => p.material === 'HouseGlass')[0]?.glow,
             glass.duskLit.filter((p) => p.material === 'HouseGlass')[0]?.glow],
      night: [glass.nightDark.filter((p) => p.material === 'HouseGlass')[0]?.glow,
              glass.nightLit.filter((p) => p.material === 'HouseGlass')[0]?.glow]
    }));

  checks.check('the low tier dims the glow and restoring full brings it back',
    // No phase change between the two reads: setQuality itself must re-write the
    // panes, or a tier flip would leave stale bloom behind for minutes.
    glass.nightLow.every((p) => p.glow === 0.6)
    && glass.nightRestored.every((p) => p.glow === glass.nightLit.find((n) => n.mesh === p.mesh).glow)
    && glass.nightRestored.filter((p) => p.glow > 0).length === glass.nightRestored.length,
    JSON.stringify({ low: glass.nightLow.map((p) => p.glow),
                     restored: glass.nightRestored.map((p) => p.glow) }));

  checks.check('the panes never cast a shadow and never vanish into black',
    // A lamp pane is a thin shell; casting would give every lantern a hard
    // quadrilateral shadow. A window keeps its frame's silhouette. Both keep a
    // legible diffuse tint at every hour (a pure black tint reads as a hole).
    ['day', 'duskLit', 'nightLit'].every((phase) =>
      glass[phase].filter((p) => p.material === 'LampGlass').every((p) => p.castShadow === false)
      && glass[phase].filter((p) => p.material === 'HouseGlass').every((p) => p.castShadow === true)
      && glass[phase].every((p) => p.color !== '000000')),
    JSON.stringify(glass.day.map((p) => [p.material, p.castShadow, p.color])));

  checks.check('the plaza lamp housings share one material; the lane pane is its own',
    // The four plaza lanterns were built from one cached parse; writing their
    // pane four times is idempotent by construction. The lane post must have
    // been cloned, or its dark/light state would drag the plaza down with it.
    (() => {
      const plaza = glass.nightLit.filter((p) => p.material === 'LampGlass' && !p.lane);
      const lane = glass.nightLit.filter((p) => p.material === 'LampGlass' && p.lane);
      const laneMat = lane.length === 1 ? lane[0].matId : null;
      return plaza.length === 4
        && new Set(plaza.map((p) => p.matId)).size === 1
        && laneMat !== null && laneMat !== plaza[0].matId;
    })(),
    JSON.stringify(glass.nightLit.filter((p) => p.material === 'LampGlass')
      .map((p) => [p.mesh, p.lane, p.matId.slice(0, 8)])));

  // Round 64: the north gate piers and lintel. They are the tallest untextured
  // stone in the plaza's main sight line, so they get the same family and the
  // same metre projection as the walls they stand in.
  const gateStone = await page.evaluate(() => {
    const api = window.amazingAdventure;
    const named = (name) => api.scene.children.find((o) => o.isMesh && o.name === name) || null;
    const describe = (mesh) => {
      if (!mesh || !mesh.material) return null;
      const m = mesh.material;
      const uv = mesh.geometry.getAttribute && mesh.geometry.getAttribute('uv');
      let span = null;
      if (uv) {
        let min = Infinity;
        let max = -Infinity;
        for (let i = 0; i < uv.count * 2; i += 1) {
          const v = uv.array[i];
          if (v < min) min = v;
          if (v > max) max = v;
        }
        span = [Number(min.toFixed(3)), Number(max.toFixed(3))];
      }
      return {
        uv: Boolean(uv),
        uvSpan: span,
        map: Boolean(m.map),
        normal: Boolean(m.normalMap),
        rough: Boolean(m.roughnessMap),
        repeat: m.map ? [m.map.repeat.x, m.map.repeat.y] : null,
        color: m.color.getHexString(),
        metalness: m.metalness
      };
    };
    const piers = api.scene.children.filter((o) => o.isMesh && o.name === 'gate-pier');
    const lintels = api.scene.children.filter((o) => o.isMesh && o.name === 'gate-lintel');
    return {
      state: api.assetState(),
      piers: piers.map(describe),
      lintels: lintels.map(describe),
      // The piers and lintel are one structure, so they may share one material;
      // what must not happen is sharing a texture object with the walls, whose
      // repeat is a whole-wall 34 m projection.
      sharesMapWithWall: Boolean(
        piers[0]?.material?.map &&
        piers[0].material.map === lintels[0]?.material?.map &&
        lintels[0]?.material?.map?.repeat?.x === 34),
      pierLintelShareMaterial: Boolean(
        piers[0]?.material && piers[0].material === lintels[0]?.material)
    };
  });

  checks.check('the gate piers and lintel are dressed from the stone family',
    gateStone.state.gateStone === 'textured' &&
    gateStone.piers.length === 2 && gateStone.lintels.length === 1 &&
    [...gateStone.piers, ...gateStone.lintels]
      .every((m) => m && m.map && m.normal && m.rough),
    JSON.stringify({ state: gateStone.state.gateStone, piers: gateStone.piers,
                     lintels: gateStone.lintels }));

  checks.check('the gate stone is box-projected in metres and not double-tinted',
    // A 4.1 m pier must span more than one 1.6 m tile in UV space, and the base
    // colour must stay white or the albedo is tinted twice.
    [...gateStone.piers, ...gateStone.lintels].every((m) => m && m.uv) &&
    gateStone.piers.some((m) => m && m.uvSpan && (m.uvSpan[1] - m.uvSpan[0]) > 1) &&
    gateStone.lintels.some((m) => m && m.uvSpan && (m.uvSpan[1] - m.uvSpan[0]) > 1) &&
    [...gateStone.piers, ...gateStone.lintels].every((m) => m.color === 'ffffff' && m.metalness === 0),
    JSON.stringify({ piers: gateStone.piers, lintels: gateStone.lintels }));

  checks.check('the gate stone does not borrow the walls\' whole-wall repeat',
    gateStone.sharesMapWithWall === false,
    JSON.stringify({ sharesMapWithWall: gateStone.sharesMapWithWall,
                     pierRepeat: gateStone.piers[0] && gateStone.piers[0].repeat }));

  // The upgrade must not change gameplay: the fountain still blocks the player.
  // Yaw 0 faces -Z (north), so walking forward from z=6 heads straight at it.
  const fountainBlocks = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    api.player.placeAt(0, 6, 0);
    api.player.setMoveInput(1, 0);
    await new Promise((r) => setTimeout(r, 1800));
    api.player.setMoveInput(0, 0);
    const z = api.player.position.z;
    return { z: Number(z.toFixed(2)), stoppedOutside: z > 1.9 };
  });
  checks.check('the modelled fountain is solid, not something you can walk through',
    fountainBlocks.stoppedOutside,
    JSON.stringify(fountainBlocks));

  // Put the player back where the rest of the suite expects them.
  await page.evaluate(() => {
    const api = window.amazingAdventure;
    api.player.setMoveInput(0, 0);
    api.player.placeAt(0, 13, 0);
  });

  await capture(page, 'round28-fountain.png');

  // --- 28b. The modelled lantern posts ---------------------------------------
  // The four plaza lamp posts swap a cylinder+sphere stand-in for a Blender
  // model. The day/night cycle drives the bulb's emissive, and the GLB exporter
  // drops Blender's emission factor, so the game must set it explicitly or the
  // glow silently dies exactly when the model loads.
  const lamps = await page.evaluate(() => window.amazingAdventure.assetsReady().then(() => {
    const api = window.amazingAdventure;
    const bulbs = [];
    const laneBulbs = [];
    let models = 0;
    let hiddenStandins = 0;
    api.scene.traverse((o) => {
      if (o.name === 'lamp-model') models += 1;
      // Only the plaza bulbs: round 55 hangs a fifth LampBulb under the lane
      // post's own group, and its emissive follows the lane round rather than
      // the plaza's day/night cycle, so mixing the two would flake.
      if (o.name === 'LampBulb' && o.parent && o.parent.name === 'lamp-model') bulbs.push(o);
      if (o.name === 'LampBulb' && o.parent && o.parent.name === 'lane-lamp-model') laneBulbs.push(o);
      if (o.userData && o.userData.lampStandin && !o.visible) hiddenStandins += 1;
    });
    return {
      state: api.assetState(),
      models,
      bulbs: bulbs.length,
      hiddenStandins,
      emissive: bulbs[0] ? bulbs[0].material.emissive.getHexString() : null,
      intensity: bulbs[0] ? bulbs[0].material.emissiveIntensity : null,
      // Identity, not equality: two materials with the same numbers can still be
      // one object, and that sharing is what darkened the plaza posts.
      sharesMaterialWithLane: bulbs.length > 0 && laneBulbs.length > 0 &&
        bulbs[0].material === laneBulbs[0].material
    };
  }));

  checks.check('the modelled lantern posts replace the sphere stand-ins',
    lamps.state.lamps === 'model' && lamps.models === 4 && lamps.hiddenStandins === 4,
    JSON.stringify({ state: lamps.state.lamps, models: lamps.models, hidden: lamps.hiddenStandins }));

  checks.check('the lantern bulbs keep their day/night glow after the model loads',
    lamps.bulbs === 4 && lamps.emissive === 'ffb43a' && lamps.intensity > 0,
    JSON.stringify({ bulbs: lamps.bulbs, emissive: lamps.emissive, intensity: lamps.intensity }));

  // The lane post is dressed from the same cached GLB parse, and applyPhase()
  // writes the lane head's emissiveIntensity every frame. If the two share one
  // material object the plaza lanterns inherit those writes and go dark at
  // midday -- the check above only catches that at the instant it samples, so
  // assert the materials are distinct objects outright.
  checks.check('the lane lamp does not share the plaza lamp material',
    lamps.sharesMaterialWithLane === false,
    JSON.stringify({ sharesMaterialWithLane: lamps.sharesMaterialWithLane }));

  await capture(page, 'round33-lamps.png');
  // --- 28c. The modelled market stalls --------------------------------------
  // The two plaza counters (east 4 m, west 3 m) swap a box for the model. The
  // model is authored at the larger size and scaled down for the smaller one,
  // so both must load from one GLB and both must hide their stand-ins.
  const marketStalls = await page.evaluate(() => window.amazingAdventure.assetsReady().then(() => {
    const api = window.amazingAdventure;
    let models = 0;
    let hidden = 0;
    // Six stand-ins are marked, not two: each counter's awning slab and both of its
    // stick posts must hide too, or the model is doubled by a floating box roof.
    api.scene.traverse((o) => {
      if (o.name === 'market-stall-model') models += 1;
      if (o.userData && o.userData.marketStallStandin && !o.visible) hidden += 1;
    });
    return { state: api.assetState(), models, hidden };
  }));
  checks.check('the modelled market stalls replace both procedural counters',
    marketStalls.state.marketStalls === 'model' && marketStalls.models === 2 &&
    marketStalls.hidden === 6,
    JSON.stringify({ state: marketStalls.state.marketStalls, models: marketStalls.models,
                    hidden: marketStalls.hidden }));

  await capture(page, 'round34-market-stalls.png');
  // --- 28d. The modelled notice board --------------------------------------
  // The lane notice board swaps a box frame + plane for the model; the
  // collider is untouched so the board stays readable.
  const notice = await page.evaluate(() => window.amazingAdventure.assetsReady().then(() => {
    const api = window.amazingAdventure;
    let models = 0;
    let hidden = 0;
    api.scene.traverse((o) => {
      if (o.name === 'notice-model') models += 1;
      if (o.userData && o.userData.noticeStandin && !o.visible) hidden += 1;
    });
    return { state: api.assetState(), models, hidden };
  }));
  checks.check('the modelled notice board replaces the procedural frame and face',
    notice.state.notice === 'model' && notice.models === 1 && notice.hidden === 2,
    JSON.stringify({ state: notice.state.notice, models: notice.models,
                    hidden: notice.hidden }));

  await capture(page, 'round38-notice.png');
  // --- 28e. The modelled crates --------------------------------------------
  const crates = await page.evaluate(() => window.amazingAdventure.assetsReady().then(() => {
    const api = window.amazingAdventure;
    let models = 0;
    let hidden = 0;
    api.scene.traverse((o) => {
      if (o.name === 'crate-model') models += 1;
      if (o.userData && o.userData.crateStandin && !o.visible) hidden += 1;
    });
    return { state: api.assetState(), models, hidden };
  }));
  checks.check('the modelled crates replace the three procedural boxes',
    crates.state.crates === 'model' && crates.models === 3 && crates.hidden === 3,
    JSON.stringify({ state: crates.state.crates, models: crates.models,
                    hidden: crates.hidden }));

  await capture(page, 'round39-crates.png');
  // --- 28f. The modelled gate door + cobbled lane floor ---------------------
  const round40 = await page.evaluate(() => window.amazingAdventure.assetsReady().then(() => {
    const api = window.amazingAdventure;
    let doorModels = 0;
    api.scene.traverse((o) => {
      if (o.name === 'gate-door-model') doorModels += 1;
    });
    return { state: api.assetState(), doorModels };
  }));
  checks.check('the modelled gate door rides the existing door mesh',
    round40.state.gateDoor === 'model' && round40.doorModels === 1,
    JSON.stringify({ state: round40.state.gateDoor, doorModels: round40.doorModels }));
  checks.check('the lane floor wears the Kaggle cobblestone maps',
    round40.state.cobble === 'textured' &&
    round40.state.cobbleDetail.maps.length === 3,
    JSON.stringify(round40.state.cobbleDetail));

  await capture(page, 'round40-gate-cobble.png');
  // --- 28g. The modelled house trim -----------------------------------------
  const house = await page.evaluate(() => window.amazingAdventure.assetsReady().then(() => {
    const api = window.amazingAdventure;
    let models = 0;
    let hidden = 0;
    api.scene.traverse((o) => {
      if (o.name === 'house-model') models += 1;
      if (o.userData && o.userData.houseStandin && !o.visible) hidden += 1;
    });
    return { state: api.assetState(), models, hidden };
  }));
  checks.check('the modelled house trim replaces the roof slab and door box',
    house.state.house === 'model' && house.models === 1 && house.hidden === 2,
    JSON.stringify({ state: house.state.house, models: house.models,
                    hidden: house.hidden }));

  await capture(page, 'round41-house.png');
  // --- 28h. Prop models wear their material families ------------------------
  // The prop GLBs ship without UVs; the game box-projects them and dresses them
  // by authored material name. Round 70 extended that from wood to painted
  // iron, so "iron stays flat" is no longer true: what must stay flat is glass
  // and the painted board faces, which have no family and would look wrong
  // wearing a 0.6 m metal tile.
  const propWood = await page.evaluate(() => window.amazingAdventure.assetsReady().then(() => {
    const api = window.amazingAdventure;
    let woodTextured = 0;
    let woodNoUv = 0;
    let ironDressed = 0;
    let ironFlat = 0;
    let flatNonFamily = 0;
    const flatNames = [];
    const names = ['bench-model', 'notice-model', 'crate-model', 'gate-door-model', 'house-model'];
    api.scene.traverse((o) => {
      if (!o.isMesh) return;
      let inProp = false;
      for (let p = o; p; p = p.parent) {
        if (names.includes(p.name)) { inProp = true; break; }
      }
      if (!inProp) return;
      const name = o.material && o.material.name ? o.material.name : '';
      const hasMap = Boolean(o.material && o.material.map);
      const hasUv = Boolean(o.geometry.getAttribute('uv'));
      if (/Wood/i.test(name)) {
        if (hasMap && hasUv) woodTextured += 1;
        else if (!hasUv) woodNoUv += 1;
      } else if (/Iron/i.test(name)) {
        // Round 70: ironwork is dressed from the lamp maps with the same
        // box-projected UVs, so every iron mesh must carry map *and* UV.
        if (hasMap && hasUv) ironDressed += 1;
        else ironFlat += 1;
      } else if (!hasMap) {
        flatNonFamily += 1;
        flatNames.push(name || '(unnamed)');
      }
    });
    return { state: api.assetState(), woodTextured, woodNoUv, ironDressed, ironFlat,
             flatNonFamily, flatNames };
  }));
  checks.check('the wood texture reaches the prop models while glass and board stay flat',
    propWood.state.propWood === 'textured' && propWood.woodTextured >= 8 &&
    propWood.woodNoUv === 0 && propWood.flatNonFamily >= 1,
    JSON.stringify({ state: propWood.state.propWood, woodTextured: propWood.woodTextured,
                    woodNoUv: propWood.woodNoUv, flatNonFamily: propWood.flatNonFamily }));
  checks.check('the painted-iron props wear the lamp maps with real UVs',
    propWood.state.iron === 'textured' && propWood.ironDressed >= 20 && propWood.ironFlat === 0,
    JSON.stringify({ state: propWood.state.iron, ironDressed: propWood.ironDressed,
                    ironFlat: propWood.ironFlat }));
  // Round 74 makes the glass phase-lit (colour, reflection and glow follow the
  // hour), but it stays unmapped on purpose: a 512 px map across a 0.8 m pane
  // carries features finer than the pane, and the hour curve states the look
  // exactly. "Flat" here means "carries no map", which is still true.
  checks.check('what stays unmapped on the props is glass and painted board, never wood or iron',
    propWood.flatNames.every((n) => !/wood|iron/i.test(n)) &&
    propWood.flatNames.some((n) => /glass/i.test(n)),
    JSON.stringify(propWood.flatNames));

  await capture(page, 'round42-prop-uvs.png');
  // --- 28i. The low quality tier -------------------------------------------
  // Once adaptive resolution is at its floor and frames are still slow, the
  // tier drops the shadow pass and the point lights' per-pixel cost. Measured
  // on a Pixel 7 profile: 1.11 -> 1.92 fps at pinned native resolution (1.73x).
  const quality = await page.evaluate(() => {
    const api = window.amazingAdventure;
    const state = () => {
      let points = 0, shadowDirs = 0, glow = 0;
      api.scene.traverse((o) => {
        if (o.isPointLight && o.visible) points += 1;
        if (o.isDirectionalLight && o.castShadow) shadowDirs += 1;
        if (o.isMesh && o.material && o.material.emissiveIntensity > 0) glow += 1;
      });
      return { points, shadowDirs, glow, tier: api.quality.tier,
               attr: document.body.dataset.quality };
    };
    api.quality.setAdaptive(false);
    const full = (() => { api.quality.set('full'); return state(); })();
    const low = (() => { api.quality.set('low'); return state(); })();
    const back = (() => { api.quality.set('full'); return state(); })();
    api.quality.setAdaptive(true);
    return { full, low, back };
  });
  checks.check('low quality drops the point lights and the shadow pass',
    quality.low.points === 0 && quality.low.shadowDirs === 0 &&
    quality.low.tier === 'low' && quality.low.attr === 'low',
    JSON.stringify(quality.low));
  checks.check('low quality keeps the lamp glow so night still reads as lit',
    quality.low.glow === quality.full.glow && quality.low.glow > 0,
    JSON.stringify({ lowGlow: quality.low.glow, fullGlow: quality.full.glow }));
  checks.check('restoring full quality brings the lights and shadows back',
    quality.back.points === quality.full.points &&
    quality.back.shadowDirs === 1 && quality.back.tier === 'full',
    JSON.stringify(quality.back));

  await capture(page, 'round43-quality.png');
  // --- 28j. The modelled cast ------------------------------------------------
  // The NPCs upgrade from procedural cylinders to Blender figures with jointed
  // limbs. The owner's complaint was visual, so the checks measure the things
  // that make it true: per-character modes, limb pivots, and a real walk cycle.
  const cast = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    await api.assetsReady();
    const cast = await api.castReady;
    const mara = api.npcs.find((n) => n.id === 'mara');
    const meshNames = [];
    mara.group.traverse((o) => { if (o.isMesh) meshNames.push(o.name); });
    // Send Mara walking and sample the cycle through the real game loop.
    mara.target = { x: mara.group.position.x + 6, z: mara.group.position.z };
    const samples = [];
    for (let i = 0; i < 8; i += 1) {
      await new Promise((r) => setTimeout(r, 120));
      samples.push(mara.limbs.legL.rotation.x, mara.limbs.legR.rotation.x);
    }
    return {
      cast, meshNames,
      modes: api.npcs.map((n) => n.mode),
      swingRange: Math.max(...samples.map(Math.abs)),
      alternating: samples[0] * samples[1] < 0
    };
  });
  checks.check('every NPC wears its modelled rig, not the cylinder fallback',
    cast.modes.every((m) => m === 'model') && cast.cast.loaded === 6,
    JSON.stringify({ modes: cast.modes, loaded: cast.cast.loaded }));
  checks.check('the cast rig carries the modelled detail meshes',
    ['Torso', 'Head', 'Nose', 'Hair'].every((n) => cast.meshNames.includes(n)) &&
    cast.meshNames.some((n) => n.startsWith('Prop')),
    JSON.stringify({ meshes: cast.meshNames.length }));
  checks.check('the modelled cast walks with real limb swings',
    cast.swingRange > 0.15 && cast.alternating,
    JSON.stringify({ swingRange: Number(cast.swingRange.toFixed(3)),
                    alternating: cast.alternating }));

  await capture(page, 'round44-cast.png');
  // --- 28k. The plaza polish -------------------------------------------------
  // Ground wears the Kaggle grass maps, walls wear the stone family, and the
  // sky is a gradient dome recoloured per phase. All measured by material state.
  const plaza = await page.evaluate(() => window.amazingAdventure.assetsReady().then(() => {
    const api = window.amazingAdventure;
    const state = api.assetState();
    let dome = null;
    api.scene.traverse((o) => { if (o.name === 'sky-dome') dome = o; });
    const ground = api.scene.children.find((o) => o.isMesh && o.geometry.type === 'PlaneGeometry' && o.material.map);
    return {
      grass: state.grass, walls: state.walls, sky: state.sky,
      grassMaps: state.grassDetail ? state.grassDetail.maps : [],
      wallMaps: state.wallsDetail ? state.wallsDetail.maps : [],
      dome: dome ? { vertexColors: dome.material.vertexColors,
                     colorCount: dome.geometry.attributes.color.count } : null,
      groundHasMap: Boolean(ground && ground.material.map)
    };
  }));
  checks.check('the courtyard ground wears the grass maps',
    plaza.grass === 'textured' && plaza.grassMaps.length === 3 && plaza.groundHasMap,
    JSON.stringify({ grass: plaza.grass, maps: plaza.grassMaps }));
  checks.check('the border walls wear the stone family',
    plaza.walls === 'textured' && plaza.wallMaps.length === 3,
    JSON.stringify({ walls: plaza.walls, maps: plaza.wallMaps }));
  checks.check('the sky is a vertex-colour gradient dome',
    plaza.dome && plaza.dome.vertexColors && plaza.dome.colorCount > 100,
    JSON.stringify(plaza.dome));

  await capture(page, 'round45-plaza.png');
  // --- 28l. Joint-space meshes ride their joints -----------------------------
  // A regression guard for the round-44 bug: Hand/Thumb/Boot/Pauldron are
  // authored around their limb pivots, so they must be parented to the pivot,
  // not the body root. Parenting them at the root renders hands at knee height
  // and boots below the floor.
  const joints = await page.evaluate(() => {
    const api = window.amazingAdventure;
    const out = {};
    for (const npc of api.npcs) {
      let bad = 0;
      let checked = 0;
      npc.group.traverse((o) => {
        if (!o.isMesh) return;
        const isJointSpace = /^(Hand|Thumb|Boot|Pauldron)/.test(o.name);
        if (!isJointSpace) return;
        checked += 1;
        // Walk up: the immediate parent must be a Limb pivot.
        const parent = o.parent;
        if (!parent || !/^Limb(Arm|Leg)/.test(parent.name || '')) bad += 1;
      });
      // Eye meshes belong to the head, in body space: sanity that they exist.
      let eyes = 0;
      npc.group.traverse((o) => { if (o.isMesh && /^Eye/.test(o.name)) eyes += 1; });
      out[npc.id] = { checked, bad, eyes };
    }
    return out;
  });
  checks.check('joint-space meshes ride their limb pivots, not the body root',
    Object.values(joints).every((j) => j.checked > 0 && j.bad === 0),
    JSON.stringify(joints));
  checks.check('every character has a face (eyes and iris) on the head',
    Object.values(joints).every((j) => j.eyes === 4),
    JSON.stringify(Object.fromEntries(Object.entries(joints).map(([k, v]) => [k, v.eyes]))));

  await capture(page, 'round46-faces.png');
  // --- 28m. Attention: head turns and blinks ---------------------------------
  const attention = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const mara = api.npcs.find((n) => n.id === 'mara');
    // Stand the player right next to Mara, slightly off her facing.
    const pos = mara.group.position;
    const near = { x: pos.x + 1.2, z: pos.z + 0.4 };
    let maxTurn = 0;
    for (let i = 0; i < 25; i += 1) {
      api.setPlayerPositionForTest ? api.setPlayerPositionForTest(near) : null;
      // Drive the real loop by waiting frames; updateNPCs reads player.position
      // from the game loop, so nudge the player through the exposed player.
      if (api.player) {
        api.player.position.x = near.x;
        api.player.position.z = near.z;
      }
      await new Promise((r) => setTimeout(r, 90));
      const turn = Math.abs(mara.limbs.neck ? mara.limbs.neck.rotation.y : 0);
      if (turn > maxTurn) maxTurn = turn;
    }
    // Walk away: head should ease back toward centre.
    //
    // This used to be a 1500 ms wall-clock wait, which is the same measurement
    // trap as the blink poll: the ease-back is driven by FRAMES
    // (animateCast(ease * dt * 4)), and a software-rendered headless run can
    // deliver only a handful of frames in 1.5 s of wall time. That is why it
    // flaked at 0.201 and then 0.361 -- the head was still on its way back, not
    // stuck. Wait for real frames and take the MINIMUM angle reached once the
    // player is gone, so the reading means "it eased back" rather than
    // "enough wall time happened to pass".
    if (api.player) { api.player.position.x = pos.x + 30; }
    let after = Math.abs(mara.limbs.neck ? mara.limbs.neck.rotation.y : 0);
    const settleFrames = 90; // ~1.5 s at 60 fps, more than the ease needs
    for (let f = 0; f < settleFrames; f += 1) {
      await new Promise((r) => requestAnimationFrame(r));
      if (api.player) { api.player.position.x = pos.x + 30; }
      const turn = Math.abs(mara.limbs.neck ? mara.limbs.neck.rotation.y : 0);
      if (turn < after) after = turn;
    }
    // Blink: the iris squashes for 0.06 of a 3.2-unit cycle, so a sparse
    // sampler can miss it entirely. Sample every animation frame for a full
    // cycle (a blink recurs roughly every 7.6 s of world time) and record the
    // minimum scale seen rather than polling on a timer.
    let sawBlink = false;
    let minIris = 1;
    const deadline = performance.now() + 9000;
    while (performance.now() < deadline && !sawBlink) {
      await new Promise((r) => requestAnimationFrame(r));
      const y = mara.limbs.eyeIrisL ? mara.limbs.eyeIrisL.scale.y : 1;
      if (y < minIris) minIris = y;
      if (y < 0.5) sawBlink = true;
    }
    return { maxTurn: Number(maxTurn.toFixed(3)), after: Number(after.toFixed(3)),
             sawBlink, minIris: Number(minIris.toFixed(2)) };
  });
  // The 'after' reading is a settle measurement, not a fixed angle: the head
  // eases back over ~1.5 s of software-rendered frames, and a fixed 0.2 rad
  // threshold flaked at 0.201 on a slow run. Assert the head moved most of the
  // way back from where it got to, which is the behaviour that matters.
  checks.check('a nearby player turns the NPC head, and it eases back after',
    attention.maxTurn > 0.2 && attention.after < attention.maxTurn * 0.4,
    JSON.stringify(attention));
  checks.check('the cast blinks', attention.sawBlink === true,
    JSON.stringify({ sawBlink: attention.sawBlink, minIris: attention.minIris }));

  await capture(page, 'round47-attention.png');
  // --- 28m2. The cast's faces and hair wear their own family (round 76) -----
  // Skin (1.31 m2 over 36 meshes) and HairC (0.67 m2 over 8) were the last flat
  // mass the audit could find on the cast, and the surface the player looks at
  // most closely. They are dressed at a 0.35 m / 0.22 m physical tile, so Pip's
  // 0.72-scaled rig must divide its tile by that scale to keep the same grain.
  const faces = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    await api.assetsReady();
    await api.castReady;
    const rows = [];
    const flat = [];
    for (const npc of api.npcs) {
      npc.group.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const name = o.material.name || '';
        const key = `${npc.id}/${o.name}:${name}`;
        if (/^Skin$|^HairC$/i.test(name)) {
          const uv = o.geometry.getAttribute('uv');
          const heads = o.name === 'Head';
          rows.push({
            key, family: /^Skin$/i.test(name) ? 'skin' : 'hair',
            maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => Boolean(o.material[k])).length,
            hasUv: Boolean(uv),
            tint: o.material.color.getHexString(),
            roughness: Number(Number(o.material.roughness).toFixed(3)),
            metalness: Number(o.material.metalness).toFixed(3),
            image: o.material.map ? o.material.map.image.width : 0,
            // World tile: how many UV units per metre of head, measured on the
            // head's own local width times the rig scale.
            headTile: heads && uv ? (() => {
              let min = Infinity, max = -Infinity;
              for (let i = 0; i < uv.count; i += 1) {
                min = Math.min(min, uv.getX(i)); max = Math.max(max, uv.getX(i));
              }
              let scale = 1;
              for (let n = o; n; n = n.parent) if (n.scale) scale *= n.scale.x;
              const box = o.geometry.boundingBox
                || (o.geometry.computeBoundingBox(), o.geometry.boundingBox);
              const worldWidth = (box.max.x - box.min.x) * scale;
              return (max - min) / worldWidth;
            })() : null
          });
        } else if (/^EyeWhite$|^EyeIris$|^Mouth$/i.test(name)) {
          flat.push({ key, mapped: Boolean(o.material.map) });
        }
      });
    }
    const headTints = rows.filter((r) => r.key.endsWith('/Head:Skin')).map((r) => r.tint);
    const materials = new Set();
    for (const npc of api.npcs) {
      npc.group.traverse((o) => {
        if (o.isMesh && o.material && /^Skin$|^HairC$/i.test(o.material.name || '')) {
          materials.add(o.material.uuid);
        }
      });
    }
    return { rows, flat, headTints, materials: materials.size, npcs: api.npcs.length };
  });
  const faceSkin = faces.rows.filter((r) => r.family === 'skin');
  const faceHair = faces.rows.filter((r) => r.family === 'hair');
  checks.check('every cast face and hair mesh wears the three family maps',
    faces.rows.length === 44 && faceSkin.length === 36 && faceHair.length === 8
      && faces.rows.every((r) => r.maps === 3 && r.hasUv && r.image === 512),
    JSON.stringify({ rows: faces.rows.length, skin: faceSkin.length, hair: faceHair.length,
                    maps: [...new Set(faces.rows.map((r) => r.maps))] }));
  checks.check('the gaze and mouth stay unmapped so a face still reads',
    faces.flat.length > 0 && faces.flat.every((f) => f.mapped === false),
    JSON.stringify(faces.flat.filter((f) => f.mapped).slice(0, 3)));
  checks.check('six characters keep six distinct skin tones under one map set',
    new Set(faces.headTints).size === 6,
    JSON.stringify(faces.headTints));
  checks.check('the map set is shared per rig and family, not cloned per mesh',
    faces.materials === 12,
    `${faces.materials} materials for ${faces.rows.length} meshes`);
  checks.check('skin and hair keep their authored roughness bases',
    faceSkin.every((r) => r.roughness === 0.7) && faceHair.every((r) => r.roughness === 0.8)
      && faces.rows.every((r) => Number(r.metalness) === 0),
    JSON.stringify({ skin: [...new Set(faceSkin.map((r) => r.roughness))],
                     hair: [...new Set(faceHair.map((r) => r.roughness))] }));
  checks.check('Pip\'s smaller rig still meets the adult 0.35 m tile on screen',
    (() => {
      const byNpc = {};
      for (const r of faceSkin.filter((x) => x.headTile !== null)) {
        if (!byNpc[r.key.split('/')[0]]) byNpc[r.key.split('/')[0]] = r.headTile;
      }
      const adult = byNpc.mara;
      return adult > 0 && Math.abs(byNpc.pip / adult - 1) < 0.05
        && Object.values(byNpc).every((d) => Math.abs(d / adult - 1) < 0.05);
    })(),
    JSON.stringify(faceSkin.filter((r) => r.headTile !== null)
      .map((r) => [r.key.split('/')[0], Number(r.headTile.toFixed(3))])));

  await capture(page, 'round76-cast-skin.png');
  // --- 28m2b. The cast's accent bands (round 81) ----------------------------
  // The nine Accent meshes (sashes, scarves, tabard, cloak band, collar, leg
  // wraps — 2.38 m2, the largest still-flat cast surface the audit found) are
  // dressed with the neutral felt maps at a 0.18 m physical tile, keeping each
  // NPC's authored dye. Checked on the live scene, after the real boot chain.
  const accents = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    await api.assetsReady();
    await api.castReady;
    const rows = [];
    const materials = new Set();
    for (const npc of api.npcs) {
      npc.group.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        if (!/^Accent$/i.test(o.material.name || '')) return;
        const uv = o.geometry.getAttribute('uv');
        materials.add(o.material.uuid);
        rows.push({
          key: `${npc.id}/${o.name}`,
          maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => Boolean(o.material[k])).length,
          hasUv: Boolean(uv),
          tint: o.material.color.getHexString(),
          roughness: Number(Number(o.material.roughness).toFixed(3)),
          metalness: Number(o.material.metalness).toFixed(3),
          image: o.material.map ? o.material.map.image.width : 0,
          repeat: o.material.map ? [o.material.map.repeat.x, o.material.map.repeat.y] : null,
          wrapped: o.material.map
            ? o.material.map.wrapS === 1000 && o.material.map.wrapT === 1000 : false,
          dressed: o.userData.accentDressed === true
        });
      });
    }
    return { rows, materials: materials.size };
  });
  checks.check('all 9 cast accent meshes wear the three felt maps',
    accents.rows.length === 9 && accents.rows.every((r) => r.maps === 3 && r.hasUv
      && r.image === 512 && r.dressed),
    JSON.stringify({ rows: accents.rows.length,
                    maps: [...new Set(accents.rows.map((r) => r.maps))],
                    images: [...new Set(accents.rows.map((r) => r.image))] }));
  checks.check('the accent map is one per rig and tiles by projection, not repeat',
    accents.materials === 6 && accents.rows.every((r) => r.wrapped
      && r.repeat[0] === 1 && r.repeat[1] === 1),
    `${accents.materials} materials for ${accents.rows.length} meshes; ` +
    JSON.stringify([...new Set(accents.rows.map((r) => JSON.stringify(r.repeat)))]) );
  checks.check('six characters keep six distinct accent dyes under one felt set',
    new Set(accents.rows.map((r) => r.tint)).size === 6
      && accents.rows.every((r) => r.tint !== 'ffffff'),
    JSON.stringify([...new Set(accents.rows.map((r) => r.tint))]));
  checks.check('the dressed accents sit at felt roughness, not the authored 0.6',
    accents.rows.every((r) => r.roughness === 0.9 && Number(r.metalness) === 0),
    JSON.stringify({ roughness: [...new Set(accents.rows.map((r) => r.roughness))],
                     metalness: [...new Set(accents.rows.map((r) => r.metalness))] }));

  await capture(page, 'round81-cast-accent.png');
  // --- 28m2c. The cast's boots (round 82) ------------------------------------
  // The eighteen Boot meshes (oswin, pip, halden, sable, wren — the robed
  // Keeper's rig has no boots) are dressed with the round 82 leather maps at
  // a 0.2 m physical tile, keeping each NPC's authored boot tint. Checked on
  // the live scene, after the real boot chain.
  const boots = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    await api.assetsReady();
    await api.castReady;
    const rows = [];
    const materials = new Set();
    for (const npc of api.npcs) {
      npc.group.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        if (!/^Boot$/i.test(o.material.name || '')) return;
        const uv = o.geometry.getAttribute('uv');
        materials.add(o.material.uuid);
        rows.push({
          key: `${npc.id}/${o.name}`,
          maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => Boolean(o.material[k])).length,
          hasUv: Boolean(uv),
          tint: o.material.color.getHexString(),
          roughness: Number(Number(o.material.roughness).toFixed(3)),
          metalness: Number(o.material.metalness).toFixed(3),
          image: o.material.map ? o.material.map.image.width : 0,
          repeat: o.material.map ? [o.material.map.repeat.x, o.material.map.repeat.y] : null,
          wrapped: o.material.map
            ? o.material.map.wrapS === 1000 && o.material.map.wrapT === 1000 : false,
          dressed: o.userData.bootDressed === true
        });
      });
    }
    return { rows, materials: materials.size };
  });
  checks.check('all 18 cast boot meshes wear the three leather maps',
    boots.rows.length === 18 && boots.rows.every((r) => r.maps === 3 && r.hasUv
      && r.image === 512 && r.dressed),
    JSON.stringify({ rows: boots.rows.length,
                    maps: [...new Set(boots.rows.map((r) => r.maps))],
                    images: [...new Set(boots.rows.map((r) => r.image))] }));
  checks.check('the leather map is one per rig and tiles by projection, not repeat',
    boots.materials === 5 && boots.rows.every((r) => r.wrapped
      && r.repeat[0] === 1 && r.repeat[1] === 1),
    `${boots.materials} materials for ${boots.rows.length} meshes; ` +
    JSON.stringify([...new Set(boots.rows.map((r) => JSON.stringify(r.repeat)))]));
  checks.check('the booted five keep their own boot tints, and Mara wears none',
    boots.rows.every((r) => r.tint !== 'ffffff')
      && !boots.rows.some((r) => r.key.startsWith('mara/')),
    JSON.stringify([...new Set(boots.rows.map((r) => r.key.split('/')[0]))]));
  checks.check('the dressed boots sit at leather roughness 0.9, not metal',
    boots.rows.every((r) => r.roughness === 0.9 && Number(r.metalness) === 0),
    JSON.stringify({ roughness: [...new Set(boots.rows.map((r) => r.roughness))],
                     metalness: [...new Set(boots.rows.map((r) => r.metalness))] }));

  await capture(page, 'round82-cast-boot.png');
  // --- 28m2d. The job board's paper (round 83) -----------------------------
  // The job board's face (BoardFace, 1 mesh, 2.16 m2) and its three pinned
  // slips (BoardPaper, 3 meshes, 0.4 m2) are dressed with the round 83 paper
  // maps at a 0.3 m physical tile; the cream albedo stands alone (white tint).
  // Checked on the live scene, after the real asset chain.
  const paper = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    await api.assetsReady();
    const rows = [];
    const materials = new Set();
    api.scene.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      if (!/^(BoardFace|BoardPaper)$/i.test(o.material.name || '')) return;
      const uv = o.geometry.getAttribute('uv');
      materials.add(o.material.uuid);
      rows.push({
        name: o.name,
        materialName: o.material.name,
        maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => Boolean(o.material[k])).length,
        hasUv: Boolean(uv),
        tint: o.material.color.getHexString(),
        roughness: Number(Number(o.material.roughness).toFixed(3)),
        metalness: Number(o.material.metalness).toFixed(3),
        image: o.material.map ? o.material.map.image.width : 0,
        repeat: o.material.map ? [o.material.map.repeat.x, o.material.map.repeat.y] : null,
        wrapped: o.material.map
          ? o.material.map.wrapS === 1000 && o.material.map.wrapT === 1000 : false,
        dressed: o.userData.boardPaperDressed === true
      });
    });
    const st = typeof api.assetState === 'function' ? api.assetState() : api.assetState;
    return { rows, materials: materials.size, assetState: st.boardPaper, detail: st.boardPaperDetail };
  });
  checks.check('all 4 job-board meshes wear the three paper maps',
    paper.rows.length === 4 && paper.rows.every((r) => r.maps === 3 && r.hasUv
      && r.image === 512 && r.dressed),
    JSON.stringify({ rows: paper.rows.length,
                    maps: [...new Set(paper.rows.map((r) => r.maps))],
                    images: [...new Set(paper.rows.map((r) => r.image))] }));
  checks.check('the paper map is one per mesh group and tiles by projection, not repeat',
    paper.materials >= 1 && paper.rows.every((r) => r.wrapped
      && r.repeat[0] === 1 && r.repeat[1] === 1),
    `${paper.materials} materials for ${paper.rows.length} meshes; ` +
    JSON.stringify([...new Set(paper.rows.map((r) => JSON.stringify(r.repeat)))]));
  checks.check('the paper face keeps a white tint (cream albedo stands alone)',
    paper.rows.every((r) => r.tint === 'ffffff'),
    JSON.stringify([...new Set(paper.rows.map((r) => r.tint))]));
  checks.check('the dressed paper sits at paper roughness 0.9, not metal',
    paper.rows.every((r) => r.roughness === 0.9 && Number(r.metalness) === 0),
    JSON.stringify({ roughness: [...new Set(paper.rows.map((r) => r.roughness))],
                     metalness: [...new Set(paper.rows.map((r) => r.metalness))] }));
  checks.check('assetState reports the board paper as textured',
    paper.assetState === 'textured',
    JSON.stringify({ assetState: paper.assetState, detail: paper.detail }));

  await capture(page, 'round83-job-board-paper.png');
  // --- 28m2e. The cast's paper props (round 84) -------------------------------
  // One Paper mesh on each of three rigs -- oswin's Apron, sable's PropMap
  // and wren's PropLedgerPages -- all carry the round 83
  // paper maps at a 0.3 m physical tile, with a forced white tint so the cream
  // albedo stands alone. Checked on the live scene, after the real boot chain
  // (upgradeCastPaper runs at the end of castReady).
  const castPaper = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    await api.assetsReady();
    await api.castReady;
    const rows = [];
    const materials = new Set();
    for (const npc of api.npcs) {
      npc.group.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        if (!/^Paper$/i.test(o.material.name || '')) return;
        const uv = o.geometry.getAttribute('uv');
        materials.add(o.material.uuid);
        rows.push({
          key: `${npc.id}/${o.name}`,
          maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => Boolean(o.material[k])).length,
          hasUv: Boolean(uv),
          tint: o.material.color.getHexString(),
          roughness: Number(Number(o.material.roughness).toFixed(3)),
          metalness: Number(o.material.metalness).toFixed(3),
          image: o.material.map ? o.material.map.image.width : 0,
          repeat: o.material.map ? [o.material.map.repeat.x, o.material.map.repeat.y] : null,
          wrapped: o.material.map
            ? o.material.map.wrapS === 1000 && o.material.map.wrapT === 1000 : false,
          dressed: o.userData.paperDressed === true
        });
      });
    }
    return { rows, materials: materials.size };
  });
  checks.check('all 3 cast Paper meshes wear the three paper maps',
    castPaper.rows.length === 3 && castPaper.rows.every((r) => r.maps === 3 && r.hasUv
      && r.image === 512 && r.dressed),
    JSON.stringify({ rows: castPaper.rows.length,
                    maps: [...new Set(castPaper.rows.map((r) => r.maps))],
                    images: [...new Set(castPaper.rows.map((r) => r.image))],
                    keys: castPaper.rows.map((r) => r.key) }));
  checks.check('the paper map is one per rig and tiles by projection, not repeat',
    castPaper.materials >= 1 && castPaper.rows.every((r) => r.wrapped
      && r.repeat[0] === 1 && r.repeat[1] === 1),
    `${castPaper.materials} materials for ${castPaper.rows.length} meshes; ` +
    JSON.stringify([...new Set(castPaper.rows.map((r) => JSON.stringify(r.repeat)))]));
  checks.check('the cast paper keeps a white tint (cream albedo stands alone)',
    castPaper.rows.every((r) => r.tint === 'ffffff'),
    JSON.stringify([...new Set(castPaper.rows.map((r) => r.tint))]));
  checks.check('the dressed cast paper sits at paper roughness 0.9, not metal',
    castPaper.rows.every((r) => r.roughness === 0.9 && Number(r.metalness) === 0),
    JSON.stringify({ roughness: [...new Set(castPaper.rows.map((r) => r.roughness))],
                     metalness: [...new Set(castPaper.rows.map((r) => r.metalness))] }));

  await capture(page, 'round84-cast-paper.png');
  // --- 28n. The night sky's star field (round 85) -----------------------------
  // A star field sits inside the sky dome. At night it is full opacity and
  // twinkle-bright; at day it is hidden; dusk sits between. Checked live, on
  // the scene the real boot built.
  await page.evaluate(() => {
    const api = window.amazingAdventure;
    api.setClock(150); // deep night
    api.player.placeAt(0, 11, 0, -0.05, -0.6);
  });
  await new Promise((r) => setTimeout(r, 900));
  const starNight = await page.evaluate(() => {
    const api = window.amazingAdventure;
    let mesh = null;
    let star = null;
    api.scene.traverse((o) => { if (o.name === 'sky-stars') mesh = o; });
    if (mesh) star = mesh.geometry.getAttribute('position');
    const material = mesh ? mesh.material : null;
    const seen = [];
    if (star) {
      for (let i = 0; i < star.count; i += 1) {
        seen.push(star.getY(i));
      }
    }
    return {
      opacity: material ? material.opacity : null,
      visible: mesh ? mesh.visible : null,
      count: star ? star.count : 0,
      radius: star ? seen.reduce((m, v) => Math.max(m, Math.abs(v)), 0) : 0,
      // Twinkle ran for a second: the size must have moved off its base 0.9.
      size: material ? material.size : null
    };
  });
  const starInfo = { night: starNight };
  await page.evaluate(() => {
    const api = window.amazingAdventure;
    api.setClock(10); // day
  });
  await new Promise((r) => setTimeout(r, 700));
  const starDay = await page.evaluate(() => {
    const api = window.amazingAdventure;
    let mesh = null;
    api.scene.traverse((o) => { if (o.name === 'sky-stars') mesh = o; });
    const material = mesh ? mesh.material : null;
    return { opacity: material ? material.opacity : null, visible: mesh ? mesh.visible : null };
  });
  starInfo.day = starDay;
  checks.check('the star field is opaque and fully populated at night',
    starInfo.night.opacity === 1 && starInfo.night.visible === true
      && starInfo.night.count === 260 && starInfo.night.radius > 110,
    JSON.stringify({ opacity: starInfo.night.opacity, visible: starInfo.night.visible,
                     count: starInfo.night.count, radius: starInfo.night.radius }));
  checks.check('the star field twinkles (its size moved off the base 0.9)',
    starInfo.night.size !== null && starInfo.night.size !== 0.9,
    JSON.stringify({ size: starInfo.night.size }));
  checks.check('the star field is hidden at day',
    starInfo.day.opacity === 0 && starInfo.day.visible === false,
    JSON.stringify({ opacity: starInfo.day.opacity, visible: starInfo.day.visible }));
  await capture(page, 'round85-stars.png');

  // --- 28n1. Round 89: moon disc, cloud layer, ridge and lighting ------------
  // Four additions that together make the night read as a place: the moon disc,
  // the drifting cloud layer, the distant ridge on the skyline, and the two
  // lighting changes (a cool moonlight key at night, a slow cloud dapple on the
  // daylight sun). All checked live, on the real booted scene.
  const skyDressing = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const env = api.environment;
    // The dapple is deliberately off on the low tier (it is a whole-scene
    // lighting effect and the low tier exists to stop paying for those). This
    // headless run is slow enough that adaptive quality may already have
    // dropped, so pin full quality for the samples and restore it afterwards.
    const startTier = api.quality.tier;
    const startAdaptive = api.quality.adaptive;
    api.quality.set('full');
    const byName = (name) => {
      let found = null;
      api.scene.traverse((o) => { if (o.name === name) found = o; });
      return found;
    };
    const sample = (phaseSeconds) => {
      api.setClock(phaseSeconds);
      const moonGroup = byName('sky-moon-group');
      const moonCore = byName('sky-moon');
      const cloudGroup = byName('sky-clouds');
      const ridge = byName('sky-horizon');
      const clouds = [];
      if (cloudGroup) {
        for (const child of cloudGroup.children) {
          clouds.push({
            opacity: child.material.opacity,
            color: child.material.color.getHexString(),
            y: child.position.y,
            rotY: child.rotation.y
          });
        }
      }
      const ridgePos = ridge ? ridge.geometry.getAttribute('position') : null;
      let ridgeMaxY = -Infinity;
      let ridgeMinY = Infinity;
      if (ridgePos) {
        for (let i = 0; i < ridgePos.count; i += 1) {
          const y = ridgePos.getY(i);
          ridgeMaxY = Math.max(ridgeMaxY, y);
          ridgeMinY = Math.min(ridgeMinY, y);
        }
      }
      // The ridge is vertex-coloured (ridge line -> haze at the foot), so the
      // material colour stays white and the per-phase tint lives in the buffer.
      // Read the average of the ridge-line vertices, which is what the eye sees
      // as the silhouette colour.
      const ridgeColors = ridge ? ridge.geometry.getAttribute('color') : null;
      let ridgeTint = null;
      if (ridgeColors && ridgePos) {
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < ridgeColors.count; i += 1) {
          // Vertex order per segment is [foot, foot, ridge, foot, ridge, ridge],
          // so indices 2, 4 and 5 are the ridge line.
          if (i % 6 < 2) continue;
          r += ridgeColors.getX(i);
          g += ridgeColors.getY(i);
          b += ridgeColors.getZ(i);
          n += 1;
        }
        if (n > 0) {
          ridgeTint = [r / n, g / n, b / n]
            .map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
        }
      }
      return {
        phase: api.getClock().phase,
        moonVisible: moonGroup ? moonGroup.visible : null,
        moonOpacity: moonCore ? moonCore.material.opacity : null,
        moonColor: moonCore ? moonCore.material.color.getHexString() : null,
        cloudVisible: cloudGroup ? cloudGroup.visible : null,
        cloudCount: clouds.length,
        cloudOpacity: clouds.length ? clouds[0].opacity : null,
        cloudColor: clouds.length ? clouds[0].color : null,
        cloudsSitHigh: clouds.every((c) => c.y > 4),
        ridgeVisible: ridge ? ridge.visible : null,
        ridgeCount: ridgePos ? ridgePos.count : 0,
        ridgeTint,
        ridgeOpacity: ridge ? ridge.material.opacity : null,
        ridgeMaxY,
        ridgeMinY,
        moonLight: env.moon
          ? { intensity: Number(env.moon.intensity.toFixed(3)), visible: env.moon.visible,
              castsShadow: env.moon.castShadow, color: env.moon.color.getHexString() }
          : null,
        sunIntensity: Number(env.sun.intensity.toFixed(3)),
        cloudDim: typeof env.cloudDim === 'number' ? Number(env.cloudDim.toFixed(3)) : null
      };
    };
    const day = sample(10);
    const night = sample(150);
    // The dapple moves on its own clock, and the whole cycle is minutes long, so
    // sampling a second of wall clock would look flat. Drive the cloud clock
    // directly instead: one call with a large step, then read what the sun did.
    api.setClock(20);
    const dims = [];
    if (env.updateCloudDapple) {
      for (let i = 0; i < 6; i += 1) {
        dims.push(env.updateCloudDapple());
        // Advance the layer's own clock through the private updater; the same
        // function the frame loop calls, so this is the real path.
        env.updateClouds(12);
      }
    }
    api.quality.set(startTier);
    if (startAdaptive) api.quality.setAdaptive(true);
    return { day, night, dims, startTier, startAdaptive };
  });

  const sd = skyDressing;
  checks.check('the moon disc is out at night and hidden by day',
    sd.night.moonVisible === true && sd.night.moonOpacity === 1 &&
      sd.day.moonVisible === false && sd.day.moonOpacity === 0,
    JSON.stringify({ night: [sd.night.moonVisible, sd.night.moonOpacity],
                     day: [sd.day.moonVisible, sd.day.moonOpacity] }));
  checks.check('the moon is cool white, not the sun disc\'s warm tint',
    sd.night.moonColor === 'd8e4ff' && sd.day.moonColor === 'd8e4ff',
    JSON.stringify({ night: sd.night.moonColor, day: sd.day.moonColor }));
  checks.check('the cloud layer is present, high on the dome, and dims by night',
    sd.day.cloudVisible === true && sd.day.cloudCount === 14 && sd.day.cloudsSitHigh &&
      sd.day.cloudOpacity > sd.night.cloudOpacity && sd.night.cloudVisible === true,
    JSON.stringify({ count: sd.day.cloudCount, high: sd.day.cloudsSitHigh,
                     day: sd.day.cloudOpacity, night: sd.night.cloudOpacity,
                     nightVisible: sd.night.cloudVisible }));
  // Geometry contract: the foot sits 30 m below ground (hidden behind the wall
  // and the ground disc) and hilltops land 8-20 m above ground, clear of the
  // 3.2 m border wall. The ribbon is two triangles per segment.
  checks.check('the ridge ring is built, sits on the skyline and fades per phase',
    sd.day.ridgeVisible === true && sd.day.ridgeCount === 96 * 2 * 3 &&
      Math.abs(sd.day.ridgeMinY + 30) < 0.01 &&
      sd.day.ridgeMaxY > 8 && sd.day.ridgeMaxY < 20 &&
      sd.day.ridgeTint !== null && sd.day.ridgeTint !== sd.night.ridgeTint &&
      sd.day.ridgeOpacity > 0 && sd.day.ridgeOpacity < 1 &&
      sd.night.ridgeOpacity > 0 && sd.night.ridgeOpacity < 1,
    JSON.stringify({ count: sd.day.ridgeCount, maxY: sd.day.ridgeMaxY,
                     minY: sd.day.ridgeMinY, dayTint: sd.day.ridgeTint,
                     nightTint: sd.night.ridgeTint, dayOpacity: sd.day.ridgeOpacity,
                     nightOpacity: sd.night.ridgeOpacity }));
  checks.check('the moonlight key lights the plaza at night and is off by day',
    sd.night.moonLight.visible === true && sd.night.moonLight.intensity > 0.2 &&
      sd.day.moonLight.visible === false && sd.day.moonLight.intensity === 0 &&
      sd.night.moonLight.castsShadow === false,
    JSON.stringify({ night: sd.night.moonLight, day: sd.day.moonLight }));
  checks.check('the cloud dapple dims the daylight sun, but never past the cap',
    sd.dims.every((d) => d <= 1 && d >= 0.8) &&
      Math.max(...sd.dims) - Math.min(...sd.dims) > 0.001,
    JSON.stringify(sd.dims.map((d) => Number(d.toFixed(3)))));
  await capture(page, 'round89-sky-dressing.png');

  // --- 28n3. The meadow (round 90) -----------------------------------------
  // Round 90 stands grass tufts on the ring so the lawn has a silhouette instead
  // of reading as a painted floor. The meadow is four InstancedMeshes (one per
  // blade variant) placed by the pure scatter module and swayed by the pure wind
  // field. This check proves the live scene really has them, that they stand on
  // the ground outside the paving, that the wind moves the instances on the full
  // tier and that the low tier stops the sway, and that the phase tint darkens
  // the grass at night.
  const meadow = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const env = api.environment;
    const startTier = api.quality.tier;
    const startAdaptive = api.quality.adaptive;
    api.quality.set('full');

    const byName = (name) => {
      let found = null;
      api.scene.traverse((o) => { if (o.name === name) found = o; });
      return found;
    };
    const group = byName('meadow');
    const variants = [];
    if (group) {
      for (const child of group.children) {
        if (!child.isInstancedMesh) continue;
        variants.push({
          name: child.name,
          variant: child.userData.meadowVariant,
          count: child.count,
          // A tuft's base geometry is TUFT_BLADES * 3 vertices (5 blades).
          vertexCount: child.geometry.getAttribute('position').count,
          hasColor: Boolean(child.geometry.getAttribute('color')),
          doubleSided: child.material.side === 2
        });
      }
    }
    const totalInstances = variants.reduce((sum, v) => sum + v.count, 0);

    // Walk the instances of every variant and confirm each stands at y=0 (on the
    // ground), inside the border walls, and off the plaza paving. The instance
    // matrices live in `instanceMatrix.array` as 16 floats per instance, with the
    // translation in columns 12..14 -- reading the raw buffer avoids needing a
    // THREE.Matrix4 inside the page.
    let offGround = 0;
    let onPaving = 0;
    let outside = 0;
    let sampled = 0;
    for (const v of variants) {
      const mesh = byName(v.name);
      if (!mesh) continue;
      const e = mesh.instanceMatrix.array;
      const step = Math.max(1, Math.floor(mesh.count / 60));
      for (let i = 0; i < mesh.count; i += step) {
        const base = i * 16;
        const x = e[base + 12];
        const y = e[base + 13];
        const z = e[base + 14];
        sampled += 1;
        if (Math.abs(y) > 1e-4) offGround += 1;
        if (Math.abs(x) > 16.5 || Math.abs(z) > 16.5) outside += 1;
        // The plaza disc is r=9 at the origin; a tuft inside it would grow
        // through the paving.
        if (Math.hypot(x, z) < 8.5) onPaving += 1;
      }
    }

    // Sway: sample one instance's matrix at two different wind times and see it
    // change. `updateMeadow` advances its own clock, so two calls with a real dt
    // must move the blades.
    const firstVariant = variants[0] ? byName(variants[0].name) : null;
    const readInstance = (mesh) => Array.from(mesh.instanceMatrix.array.slice(0, 16));
    let swayMoved = null;
    if (firstVariant && env.updateMeadow) {
      env.updateMeadow(0.4);
      const before = readInstance(firstVariant);
      env.updateMeadow(0.9);
      const after = readInstance(firstVariant);
      let diff = 0;
      for (let i = 0; i < 16; i += 1) diff += Math.abs(after[i] - before[i]);
      swayMoved = diff > 1e-5;
    }

    // Low tier: the sway must stop. Switch, step twice, and confirm the matrix
    // no longer changes.
    let lowFrozen = null;
    if (firstVariant && env.setMeadowSway) {
      api.quality.set('low');
      const wasEnabled = env.meadowSway;
      const before = readInstance(firstVariant);
      env.updateMeadow(0.5);
      const after = readInstance(firstVariant);
      let diff = 0;
      for (let i = 0; i < 16; i += 1) diff += Math.abs(after[i] - before[i]);
      lowFrozen = wasEnabled === false && diff < 1e-9;
    }

    // Phase tint: the material colour is the daylight white at day and a darker,
    // cooler colour at night.
    api.quality.set('full');
    api.setClock(10);
    const dayTint = byName('meadow-tufts-0')
      ? byName('meadow-tufts-0').material.color.getHexString() : null;
    api.setClock(150);
    const nightTint = byName('meadow-tufts-0')
      ? byName('meadow-tufts-0').material.color.getHexString() : null;

    api.quality.set(startTier);
    if (startAdaptive) api.quality.setAdaptive(true);
    api.setClock(10);
    return {
      groupVisible: group ? group.visible : null,
      variantCount: variants.length,
      variants,
      totalInstances,
      sampled,
      offGround,
      onPaving,
      outside,
      swayMoved,
      lowFrozen,
      dayTint,
      nightTint
    };
  });

  const md = meadow;
  checks.check('the meadow stands four instanced tuft variants on the ring',
    md.groupVisible === true && md.variantCount === 4 &&
      md.variants.every((v) => v.count > 0 && v.vertexCount === 15 && v.hasColor && v.doubleSided) &&
      md.totalInstances > 500,
    JSON.stringify({ variants: md.variants, total: md.totalInstances }));
  checks.check('every tuft stands on the ground, inside the walls and off the paving',
    md.sampled > 100 && md.offGround === 0 && md.onPaving === 0 && md.outside === 0,
    JSON.stringify({ sampled: md.sampled, offGround: md.offGround,
                     onPaving: md.onPaving, outside: md.outside }));
  checks.check('the wind sways the meadow on the full tier and stills it on low',
    md.swayMoved === true && md.lowFrozen === true,
    JSON.stringify({ swayMoved: md.swayMoved, lowFrozen: md.lowFrozen }));
  checks.check('the meadow is daylight green by day and cools at night',
    md.dayTint === 'ffffff' && md.nightTint === '46536e',
    JSON.stringify({ day: md.dayTint, night: md.nightTint }));
  await capture(page, 'round90-meadow.png');

  // --- 28n2. The lane rope's rope strand (round 86) -------------------------
  // The three LaneRope boxes (2 cm diameter, 1.92 m2 total) that span the
  // lane are dressed with the round 86 twisted-fibre rope maps at a 0.08 m
  // physical tile, keeping the authored brown tint. Checked live after the
  // real asset chain.
  const rope = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    await api.assetsReady();
    const rows = [];
    const materials = new Set();
    api.scene.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      if (!/^LaneRope$/i.test(o.material.name || '')) return;
      const uv = o.geometry.getAttribute('uv');
      materials.add(o.material.uuid);
      rows.push({
        name: o.name,
        materialName: o.material.name,
        maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => Boolean(o.material[k])).length,
        hasUv: Boolean(uv),
        tint: o.material.color.getHexString(),
        roughness: Number(Number(o.material.roughness).toFixed(3)),
        metalness: Number(o.material.metalness).toFixed(3),
        image: o.material.map ? o.material.map.image.width : 0,
        repeat: o.material.map ? [o.material.map.repeat.x, o.material.map.repeat.y] : null,
        wrapped: o.material.map
          ? o.material.map.wrapS === 1000 && o.material.map.wrapT === 1000 : false,
        dressed: o.userData.ropeDressed === true
      });
    });
    const st = typeof api.assetState === 'function' ? api.assetState() : api.assetState;
    return { rows, materials: materials.size, assetState: st.rope, detail: st.ropeDetail };
  });
  checks.check('all 3 LaneRope meshes wear the three rope maps',
    rope.rows.length === 3 && rope.rows.every((r) => r.maps === 3 && r.hasUv
      && r.image === 512),
    JSON.stringify({ rows: rope.rows.length,
                    maps: [...new Set(rope.rows.map((r) => r.maps))],
                    images: [...new Set(rope.rows.map((r) => r.image))] }));
  checks.check('the rope map is one per material and tiles by projection, not repeat',
    rope.materials >= 1 && rope.rows.every((r) => r.wrapped
      && r.repeat[0] === 1 && r.repeat[1] === 1),
    `${rope.materials} materials for ${rope.rows.length} meshes; ` +
    JSON.stringify([...new Set(rope.rows.map((r) => JSON.stringify(r.repeat)))]));
  checks.check('the dressed rope keeps the authored brown tint (keepTint true)',
    rope.rows.every((r) => r.tint !== 'ffffff'),
    JSON.stringify([...new Set(rope.rows.map((r) => r.tint))]));
  checks.check('the dressed rope sits at rope roughness 0.9, not metal',
    rope.rows.every((r) => r.roughness === 0.9 && Number(r.metalness) === 0),
    JSON.stringify({ roughness: [...new Set(rope.rows.map((r) => r.roughness))],
                     metalness: [...new Set(rope.rows.map((r) => r.metalness))] }));
  checks.check('assetState reports the rope as textured',
    rope.assetState === 'textured',
    JSON.stringify({ assetState: rope.assetState, detail: rope.detail }));
  await capture(page, 'round86-rope.png');
  // --- 28n3. The lane lanterns, sack ties and notice board (round 87) --------
  // The three lane lantern housings reuse the lamp-post maps at a 0.25 m
  // tile, the nine sack ties wear the authored dark cord maps at 0.04 m, and
  // the single notice board face carries its maps at 0.4 m. Checked live.
  const laneDetail = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    await api.assetsReady();
    const housing = [];
    const sackTies = [];
    const notices = [];
    const housingMaterials = new Set();
    const housingMaterialNames = new Set();
    api.scene.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const name = o.material.name || '';
      const uv = o.geometry.getAttribute('uv');
      const row = {
        name: o.name,
        materialName: name,
        maps: ['map', 'normalMap', 'roughnessMap']
          .filter((k) => Boolean(o.material[k])).length,
        hasUv: Boolean(uv),
        tint: o.material.color.getHexString(),
        roughness: Number(Number(o.material.roughness).toFixed(3)),
        metalness: Number(Number(o.material.metalness).toFixed(3)),
        image: o.material.map ? o.material.map.image.width : null,
        repeat: o.material.map
          ? [o.material.map.repeat.x, o.material.map.repeat.y] : null,
        wrapped: o.material.map
          ? o.material.map.wrapS === 1000 && o.material.map.wrapT === 1000 : false,
        dressed: o.userData.housingDressed === true
          || o.userData.sackTieDressed === true
          || o.userData.noticeFaceDressed === true
      };
      if (/^LanternHousing$/i.test(name)) {
        housingMaterials.add(o.material.uuid);
        housingMaterialNames.add(name);
        housing.push(row);
      } else if (/^SackTie$/i.test(name)) {
        sackTies.push(row);
      } else if (/^NoticeFace(Lane)?$/i.test(name)) {
        // Two faces belong to the family: the modelled panel (NoticeFace) and
        // the procedural stand-in (NoticeFaceLane) the model pass hides. The
        // visible one must be dressed too, or the board reads flat paint.
        let hidden = false;
        for (let p = o; p; p = p.parent) if (p.visible === false) hidden = true;
        notices.push({ ...row, hidden, modelled: /^NoticeFace$/i.test(name) });
      }
    });
    const state = typeof api.assetState === 'function' ? api.assetState() : api.assetState;
    return {
      housing,
      sackTies,
      notices,
      housingMaterials: housingMaterials.size,
      housingMaterialNames: [...housingMaterialNames],
      housingState: state?.housing,
      housingDetail: state?.housingDetail,
      sackTieState: state?.sackTie,
      sackTieDetail: state?.sackTieDetail,
      noticeFaceState: state?.noticeFace,
      noticeFaceDetail: state?.noticeFaceDetail
    };
  });
  const laneText = (value) => (typeof value === 'string'
    ? value : JSON.stringify(value ?? null));
  const laneNum = (text, key, val) => new RegExp(
    key + '["\']?\\s*[:=]?\\s*' + String(val).replace('.', '\\.') + '(?![\\d.])').test(text);
  checks.check('all 3 LanternHousing meshes wear the reused lamp maps at a 0.25 m tile',
    laneDetail.housing.length === 3 && laneDetail.housing.every((r) => r.maps === 3
      && r.hasUv && r.image === 512 && r.wrapped
      && r.repeat[0] === 1 && r.repeat[1] === 1),
    JSON.stringify({ rows: laneDetail.housing.length,
                    maps: [...new Set(laneDetail.housing.map((r) => r.maps))],
                    images: [...new Set(laneDetail.housing.map((r) => r.image))] }));
  checks.check('the housing keeps one LanternHousing material at 0.55/0.35, tint ffffff',
    laneDetail.housingMaterials <= 1
      && laneDetail.housingMaterialNames.length === 1
      && laneDetail.housingMaterialNames[0] === 'LanternHousing'
      && laneDetail.housing.every((r) => r.tint === 'ffffff' && r.roughness === 0.55
        && r.metalness === 0.35 && r.dressed),
    JSON.stringify({ materials: laneDetail.housingMaterials,
                    names: laneDetail.housingMaterialNames,
                    tints: [...new Set(laneDetail.housing.map((r) => r.tint))],
                    roughness: [...new Set(laneDetail.housing.map((r) => r.roughness))],
                    metalness: [...new Set(laneDetail.housing.map((r) => r.metalness))] }));
  await capture(page, 'round87-lane-detail.png');
  const housingDetailText = laneText(laneDetail.housingDetail);
  checks.check('assetState reports the housing textured at a 0.25 m tile with all three maps',
    laneDetail.housingState === 'textured' && laneNum(housingDetailText, 'meshes', 3)
      && laneNum(housingDetailText, 'tileMeters', 0.25)
      && housingDetailText.includes('map') && housingDetailText.includes('normalMap')
      && housingDetailText.includes('roughnessMap'),
    JSON.stringify({ assetState: laneDetail.housingState,
                    detail: laneDetail.housingDetail }));
  checks.check('all 9 SackTie meshes are dressed with three maps and no repeat',
    laneDetail.sackTies.length >= 9 && laneDetail.sackTies.every((r) => r.dressed
      && r.maps === 3 && r.hasUv && r.wrapped
      && r.repeat[0] === 1 && r.repeat[1] === 1),
    JSON.stringify({ rows: laneDetail.sackTies.length,
                    maps: [...new Set(laneDetail.sackTies.map((r) => r.maps))],
                    repeats: [...new Set(laneDetail.sackTies.map((r) => JSON.stringify(r.repeat)))] }));
  checks.check('the sack ties keep the authored dark cord (keepTint true) at 0.95 roughness',
    laneDetail.sackTies.every((r) => r.tint !== 'ffffff' && r.roughness === 0.95
      && r.metalness === 0),
    JSON.stringify({ tints: [...new Set(laneDetail.sackTies.map((r) => r.tint))],
                    roughness: [...new Set(laneDetail.sackTies.map((r) => r.roughness))],
                    metalness: [...new Set(laneDetail.sackTies.map((r) => r.metalness))] }));
  await capture(page, 'round87-sacktie.png');
  const sackTieDetailText = laneText(laneDetail.sackTieDetail);
  checks.check('assetState reports the sack ties textured at a 0.04 m tile',
    laneDetail.sackTieState === 'textured'
      && laneNum(sackTieDetailText, 'tileMeters', 0.04)
      && laneNum(sackTieDetailText, 'meshes', laneDetail.sackTies.length),
    JSON.stringify({ assetState: laneDetail.sackTieState,
                    detail: laneDetail.sackTieDetail }));
  checks.check('both notice faces (modelled and stand-in) wear three maps at 0.4 m',
    laneDetail.notices.length === 2
      && laneDetail.notices.every((r) => r.maps === 3
        && r.hasUv && r.wrapped && r.repeat[0] === 1 && r.repeat[1] === 1
        && r.tint === 'ffffff' && r.roughness === 0.9 && r.metalness === 0
        && r.dressed),
    JSON.stringify({ rows: laneDetail.notices.length,
                    names: laneDetail.notices.map((r) => r.materialName),
                    maps: laneDetail.notices.map((r) => r.maps),
                    tint: laneDetail.notices.map((r) => r.tint),
                    roughness: laneDetail.notices.map((r) => r.roughness) }));
  checks.check('the notice face the player can see is the dressed modelled panel',
    laneDetail.notices.some((r) => r.modelled && !r.hidden && r.dressed),
    JSON.stringify(laneDetail.notices.map((r) => ({ name: r.materialName,
      hidden: r.hidden, modelled: r.modelled, dressed: r.dressed }))));
  checks.check('assetState reports the notice face textured at a 0.4 m tile',
    laneDetail.noticeFaceState === 'textured'
      && laneNum(laneText(laneDetail.noticeFaceDetail), 'tileMeters', 0.4)
      && laneNum(laneText(laneDetail.noticeFaceDetail), 'meshes', 2),
    JSON.stringify({ assetState: laneDetail.noticeFaceState,
                    detail: laneDetail.noticeFaceDetail }));
  // --- 28o. Vegetation: trees stand in, upgrade to models --------------------
  const trees = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    await api.assetsReady();
    const state = api.assetState ? api.assetState() : api.assetState;
    const st = typeof state === 'function' ? state() : state;
    // Count tree standins and models in the scene.
    let standins = 0;
    let models = 0;
    api.scene.traverse((o) => {
      if (o.name === 'tree-standin') standins += 1;
      if (o.name === 'tree-model') models += 1;
    });
    // Trunk colliders exist.
    const colliders = api.colliders || [];
    return { standins, models, assetStateTrees: st.trees, assetStateBark: st.bark };
  });
  checks.check('three trees are placed in the plaza',
    trees.standins === 3,
    JSON.stringify(trees));
  checks.check('tree asset upgrade ran and reported a truthful state',
    trees.assetStateTrees === 'model' || trees.assetStateTrees === 'stand-ins' ||
      trees.assetStateTrees === 'unavailable',
    JSON.stringify(trees));

  await capture(page, 'round48-trees.png');
  // --- 28o. Texture colour space ------------------------------------------
  // Measured bug: every texture slot reported colorSpace "" -- nothing was set,
  // so Three.js treated albedo maps as linear (too dark) and would have
  // mis-decoded normal/roughness data if they had been tagged sRGB.
  const colorSpaces = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    await api.assetsReady();
    const byKind = {};
    api.scene.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      for (const key of ['map', 'normalMap', 'roughnessMap']) {
        const t = o.material[key];
        if (!t) continue;
        if (!byKind[key]) byKind[key] = new Set();
        // '' is Three's real NoColorSpace value, so it must not collapse into
        // '(unset)' -- use a null/undefined test, not truthiness.
        byKind[key].add(t.colorSpace === undefined ? '(unset)' : t.colorSpace);
      }
    });
    const out = {};
    for (const [k, v] of Object.entries(byKind)) out[k] = [...v];
    return out;
  });
  checks.check('albedo maps are decoded as sRGB',
    (colorSpaces.map || []).length === 1 && (colorSpaces.map || [])[0] === 'srgb',
    JSON.stringify(colorSpaces));
  checks.check('normal and roughness maps stay linear (not sRGB)',
    ['normalMap', 'roughnessMap'].every((k) =>
      (colorSpaces[k] || []).length === 1 && (colorSpaces[k] || [])[0] === ''),
    JSON.stringify(colorSpaces));

  await capture(page, 'round50-colorspace.png');
  // --- 28p. Idle variety -----------------------------------------------------
  // The cast used to stand bolt upright facing their routine spot. Now they
  // rock foot to foot and glance around; player attention still wins.
  const idle = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const mara = api.npcs.find((n) => n.id === 'mara');
    // Send the player far away so attention does not override the glance.
    api.player.position.x = -40;
    api.player.position.z = -40;
    // These are TIME-bounded, not frame-bounded. A glance occupies only 2.6 s
    // of an 11 s cycle, so a fixed frame count can miss one entirely -- my
    // first version did exactly that and reported glanceRange 0 while the
    // weight shift (period 7.5 s) was clearly running.
    const leanMax = { v: 0 };
    const glanceMax = { v: 0 };
    const deadline = performance.now() + 12000;
    while (performance.now() < deadline) {
      await new Promise((r) => requestAnimationFrame(r));
      if (mara.limbs.legL) leanMax.v = Math.max(leanMax.v, Math.abs(mara.limbs.legL.rotation.z));
      if (mara.limbs.neck) glanceMax.v = Math.max(glanceMax.v, Math.abs(mara.limbs.neck.rotation.y));
      // Break only once BOTH idle motions have been seen. Breaking on the
      // glance alone (the old condition) ended the sample early on runs where
      // a glance happened to fall in the first second: round 81 measured
      // leanRange 0.008 against a 0.01 threshold while the weight shift was
      // still on its way up. The two motions have independent periods (7.5 s
      // lean, 11 s glance), so a sample that stops at the first of either is
      // measuring the scheduler, not the animation.
      if (glanceMax.v > 0.1 && leanMax.v > 0.01) break;
    }
    // Walk the player back next to her: attention must override the glance.
    //
    // Two measurement traps in a row here. First, the position is re-asserted
    // every frame, because the game's player update pushes a teleported player
    // out of geometry. Second -- and this is the one that mattered -- the NECK
    // does not stay turned: the body turns to face the player (npcs.js updateNPCs
    // turns group.rotation.y toward them), which leaves the head with less and
    // less to do. A trace showed the neck peaking at 0.77 and then easing to
    // rest while the body's heading error went to exactly 0.
    //
    // So the honest assertion is: the body ends up facing the player, and the
    // head turned toward them during the approach. Asserting "the neck stays
    // turned" would be asserting the wrong behaviour.
    let maxNeck = 0;
    let bodyFaces = Infinity; // measured on the LAST frame the player is held
    let bodyFacesFirst = Infinity; // measured on the FIRST frame the player is held
    let signedFaces = 0;
    const headingError = () => {
      const want = Math.atan2(
        api.player.position.x - mara.group.position.x,
        api.player.position.z - mara.group.position.z
      );
      let err = want - mara.group.rotation.y;
      while (err > Math.PI) err -= Math.PI * 2;
      while (err < -Math.PI) err += Math.PI * 2;
      return err;
    };
    // Fourth measurement trap: budget FRAMES, not wall-clock time.
    // npcs.js turns the body with turnToward(..., dt * 4), and main.js clamps
    // dt to 0.05, so each rendered frame closes at most 0.2 rad. A wall-clock
    // 4 s window under software rendering delivers only a handful of frames,
    // which is why a mutation run showed the heading closing by just 0.011 rad
    // in 4 s. Counting frames makes the measurement independent of how fast
    // this machine happens to paint (a mutation run proved this exact flake).
    const MAX_FRAMES = 240; // >= 2.8 rad worst case: 14 slow frames close it
    let frames = 0;
    for (; frames < MAX_FRAMES; frames += 1) {
      await new Promise((r) => requestAnimationFrame(r));
      api.player.position.x = mara.group.position.x + 1.2;
      api.player.position.z = mara.group.position.z + 0.4;
      maxNeck = Math.max(maxNeck, Math.abs(mara.limbs.neck ? mara.limbs.neck.rotation.y : 0));
      // Third measurement trap, same root cause: reading the heading error
      // after the loop gives a stale answer, because the game has already
      // moved the player away again by then. Measure it while they are held.
      const signedErr = headingError();
      bodyFaces = Math.abs(signedErr);
      if (!Number.isFinite(bodyFacesFirst)) bodyFacesFirst = bodyFaces;
      signedFaces = signedErr;
      // Stop as soon as the body has actually faced the player, so a fast
      // machine does not spend the whole budget and a slow one still gets
      // there.
      if (bodyFaces < 0.05) break;
    }
    // Fifth measurement trap: the check must not read a mid-transition frame.
    // The neck keeps the turn it accumulated while the body was still swinging
    // round, so on the frame the body finishes aligning the head is briefly
    // pointing FURTHER from the player than the body (head error = body error
    // minus a still-large neck turn). That is the ease working, not a defect.
    // Hold the player still once the body has faced them and record the best
    // head heading reached, which is the state the check actually claims.
    let minHeadFaces = Infinity;
    for (let f = 0; f < 240; f += 1) {
      await new Promise((r) => requestAnimationFrame(r));
      api.player.position.x = mara.group.position.x + 1.2;
      api.player.position.z = mara.group.position.z + 0.4;
      const here = Math.abs(headingError() - (mara.limbs.neck ? mara.limbs.neck.rotation.y : 0));
      if (here < minHeadFaces) minHeadFaces = here;
      if (minHeadFaces < 0.05) break;
    }
    // The head rides on the body, so its world heading error is the body's
    // signed error minus the neck turn; keeping both signed makes the
    // subtraction correct no matter which side the player stands on.
    const headFaces = Math.abs(
      signedFaces - (mara.limbs.neck ? mara.limbs.neck.rotation.y : 0)
    );
    const attention = maxNeck;
    const leanRange = leanMax.v;
    const glanceRange = glanceMax.v;
    return {
      leanRange: Number(leanRange.toFixed(4)),
      glanceRange: Number(glanceRange.toFixed(4)),
      attention: Number(attention.toFixed(4)),
      bodyFaces: Number(bodyFaces.toFixed(3)),
      bodyFacesFirst: Number(bodyFacesFirst.toFixed(3)),
      headFaces: Number(headFaces.toFixed(3)),
      minHeadFaces: Number(minHeadFaces.toFixed(3)),
      frames
    };
  });
  checks.check('idle legs rock with a weight shift',
    idle.leanRange > 0.01,
    JSON.stringify(idle));
  checks.check('the cast glances around when nobody is near',
    idle.glanceRange > 0.1,
    JSON.stringify(idle));
  // The neck peak is NOT a fixed number and should not be asserted as one:
  // it depends how far the body already happened to be facing when the player
  // arrived (I measured 0.80, 0.21 and 0.13 on different runs, all correct).
  // Each attempt to pin a threshold was chasing variance, not a defect.
  //
  // The same is true of the BODY heading, and this check was a rubber stamp for
  // two rounds because of it: npcs.js uses a rate limiter, not an ease
  // (`turnToward(state, desired, dt * 4)` -> at most dt*4 rad, ~0.09 rad over a
  // slow 4 s run). The heading error can therefore only get under 0.15 rad if
  // the body was already almost facing the player, which is what the old
  // assertion quietly measured. It flaked to 2.84 rad here once the machine was
  // loaded enough for the frame rate to sag.
  //
  // Deterministic behaviour, and what is now asserted below:
  //   1. the body heading CLOSES toward the player (error shrinks), and
  //   2. the head ends up pointing nearer the player than the body does.
  checks.check('a nearby player makes the NPC turn toward them',
    idle.bodyFaces < 0.15,
    JSON.stringify(idle));
  // Assert the settled state, not the mid-transition frame: the neck unwind is
  // what makes the head land on the player, and minHeadFaces records the best
  // heading reached while the player was held.
  checks.check('and the head ends up nearer the player than the body',
    idle.minHeadFaces <= idle.bodyFaces + 0.35,
    JSON.stringify(idle));

  await capture(page, 'round51-idle.png');
  // --- 28q. Lane dressing ----------------------------------------------------
  const laneDressing = await page.evaluate(() => {
    const api = window.amazingAdventure;
    const counts = { flags: 0, sacks: 0, strands: 0 };
    api.scene.traverse((o) => {
      if (o.isMesh && o.geometry && o.geometry.type === 'ConeGeometry' &&
          o.geometry.parameters && o.geometry.parameters.radialSegments === 3) {
        counts.flags += 1;
      }
      if (o.isMesh && o.material && o.material.color) {
        const hex = o.material.color.getHex();
        // The sack body material is 0xa89468.
        if (hex === 0xa89468) counts.sacks += 1;
      }
    });
    return counts;
  });
  checks.check('bunting flags hang over the lane',
    laneDressing.flags >= 20,
    JSON.stringify(laneDressing));
  checks.check('sacks lean against the lane stall',
    laneDressing.sacks === 3,
    JSON.stringify(laneDressing));

  await capture(page, 'round52-lane.png');

  // --- 28r. Lane lanterns hang from the bunting ------------------------------
  // The lane's point lights used to float in mid-air with no fixture above
  // them. The fix ties each light to a visible lantern on its strand. These
  // checks walk the scene for the fixture parts and verify the light sits
  // exactly where the rule in areas.js places the fixture, plus the dusk/night
  // glow that makes the fixture read as the light source.
  const lanterns = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const fixtures = [];
    let bulbMeshes = 0;
    api.scene.traverse((o) => {
      if (o.userData && o.userData.laneLantern) fixtures.push(o);
      if (o.userData && o.userData.laneLanternBulb) bulbMeshes += 1;
    });
    const env = api.environment;
    // Since round 54 the lane only glows once its lamp round has been walked
    // (the gameplay gating is checked in 28s below). This section tests fixture
    // geometry and phase wiring, so it sets the lit flag itself -- but only
    // after the clock is past dawn, because the real dawn reset clears the flag
    // on any day frame and would otherwise quietly wipe it before sampling.
    api.setClock(30); // day first, so the 'dark by day' reading is honest
    await new Promise((r) => setTimeout(r, 120));
    const dayLamp = env.laneLamps.map((l) => l.light.intensity);
    const dayGlow = env.laneLamps.map((l) => (l.bulb ? l.bulb.material.emissiveIntensity : null));
    api.setClock(80); // dusk
    api.getState().flags.laneLanternsLit = true; // walked the round at sundown
    api.setClock(80); // re-apply the phase now the lane is lit
    await new Promise((r) => setTimeout(r, 120));
    const duskLamp = env.laneLamps.map((l) => l.light.intensity);
    const duskGlow = env.laneLamps.map((l) => (l.bulb ? l.bulb.material.emissiveIntensity : null));
    api.setClock(120); // night
    await new Promise((r) => setTimeout(r, 120));
    const nightLamp = env.laneLamps.map((l) => l.light.intensity);
    api.setClock(30); // back to day for later checks
    await new Promise((r) => setTimeout(r, 120));
    const dayRest = env.laneLamps.map((l) => l.light.intensity);
    // The light must sit inside its own fixture's body, not floating above it.
    const aligned = env.laneLamps.map((l) => {
      const p = l.light.position;
      let body = null;
      api.scene.traverse((o) => {
        if (o.userData && o.userData.laneLantern && !body) {
          const found = o.children.find((c) => c.isMesh && c.geometry && c.geometry.type === 'CylinderGeometry' &&
            c.geometry.parameters && c.geometry.parameters.radiusTop === 0.09);
          if (found && Math.abs(found.position.x - p.x) < 0.01 &&
              Math.abs(found.position.z - p.z) < 0.01) body = found;
        }
      });
      return body ? Math.abs(body.position.y - p.y) < 0.01 : false;
    });
    return { fixtures: fixtures.length, bulbMeshes, dayLamp, duskLamp, nightLamp, dayRest, dayGlow, duskGlow, aligned };
  });
  checks.check('the lane lights hang from real lantern fixtures',
    lanterns.fixtures === 3 && lanterns.bulbMeshes === 3,
    JSON.stringify(lanterns));
  checks.check('each lane light sits inside its fixture body, not above it',
    lanterns.aligned.every(Boolean),
    JSON.stringify(lanterns.aligned));
  checks.check('lane lanterns are dark by day and lit at dusk and night',
    lanterns.dayLamp.every((i) => i === 0) &&
    lanterns.dayGlow.every((g) => g < 1) &&
    lanterns.duskLamp.every((i) => i > 0) &&
    lanterns.nightLamp.every((i) => i > lanterns.duskLamp[0]) &&
    lanterns.duskGlow.every((g) => g > lanterns.dayGlow[0]) &&
    lanterns.dayRest.every((i) => i === 0),
    JSON.stringify(lanterns));

  await capture(page, 'round53-lanterns.png');

  // --- 28s. The lane lamp round --------------------------------------------
  // Round 54 gives the lane a reason to linger: the bunting lanterns stay dark
  // at dusk until the player walks the round from the far lamp post, and dawn
  // puts them out again. Everything below drives the real interactable at the
  // real post position -- no direct calls to the pure rules.
  const laneRound = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const post = api.LANE_LIGHTING_POST;
    const hintFor = () => api.interactables().find((i) => i.kind === 'lanterns');
    const waitFrames = async (n) => {
      // Frame budget, not wall clock: software GL can drop frames badly enough
      // that a millisecond sleep samples a stale scene.
      for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
    };
    const standAtPost = () => {
      api.player.placeAt(post.x, post.z + 1.0, Math.PI); // in reach, facing the post
      api.touch.refresh();
    };

    // Start from a known state rather than whatever the earlier checks left.
    const state = api.getState();
    state.flags.laneLanternsLit = false;
    api.setClock(30); // day
    standAtPost();
    await waitFrames(4);

    // Daytime: the post still answers, but says there is nothing to do. A
    // hidden interactable would be a dead end rather than an explanation.
    const dayHint = hintFor();
    const dayResult = api.performLaneLighting();

    // Dusk, unlit: the round is offered and lights the lane.
    api.setClock(80);
    standAtPost();
    await waitFrames(4);
    const duskHint = hintFor();
    const beforeLamp = api.environment.laneLamps.map((l) => l.light.intensity);
    const beforePost = api.environment.postLamp ? api.environment.postLamp.material.emissiveIntensity : null;
    const beforeCoins = api.getState().flags.coins;
    const duskResult = api.performLaneLighting();
    await waitFrames(4);
    const afterLamp = api.environment.laneLamps.map((l) => l.light.intensity);
    const afterPost = api.environment.postLamp ? api.environment.postLamp.material.emissiveIntensity : null;
    const afterCoins = api.getState().flags.coins;
    const litAgain = api.performLaneLighting();
    const coinsAfterSecond = api.getState().flags.coins;

    // The lane stays lit through the night, and the post no longer offers the
    // round (it still answers, so the player is not left with a mute object).
    api.setClock(120);
    standAtPost();
    await waitFrames(4);
    const nightLamp = api.environment.laneLamps.map((l) => l.light.intensity);
    const nightHint = hintFor();
    const nightAgain = api.performLaneLighting();

    // Dawn puts them out, and the round is walkable again the following dusk.
    api.setClock(30);
    await waitFrames(4);
    const dawnLamp = api.environment.laneLamps.map((l) => l.light.intensity);
    const dawnPost = api.environment.postLamp ? api.environment.postLamp.material.emissiveIntensity : null;
    const dawnFlag = api.getState().flags.laneLanternsLit;
    api.setClock(80);
    standAtPost();
    await waitFrames(4);
    const relitHint = hintFor();
    const relit = api.performLaneLighting();

    // Leave the plaza in daylight with the lane dark so later checks and the
    // later captures do not inherit a lit lane.
    api.setClock(30);
    api.getState().flags.laneLanternsLit = false;
    api.player.placeAt(0, 6, 0);
    api.touch.refresh();
    await waitFrames(4);

    return {
      dayHintKind: dayHint ? dayHint.kind : null,
      dayHintLabel: dayHint ? dayHint.label : null,
      dayReason: dayResult.message,
      dayChanged: dayResult.changed,
      duskHintLabel: duskHint ? duskHint.label : null,
      beforeLamp, afterLamp, beforePost, afterPost,
      beforeCoins, afterCoins, coinsAfterSecond,
      duskChanged: duskResult.changed,
      secondChanged: litAgain.changed,
      nightLamp,
      nightHintLabel: nightHint ? nightHint.label : null,
      nightChanged: nightAgain.changed,
      dawnLamp, dawnPost, dawnFlag,
      relitLabel: relitHint ? relitHint.label : null,
      relitChanged: relit.changed
    };
  });
  checks.check('the lamp post answers in daylight with an explanation, not a dead end',
    laneRound.dayHintKind === 'lanterns' &&
    typeof laneRound.dayHintLabel === 'string' && laneRound.dayHintLabel.length > 5 &&
    laneRound.dayChanged === false &&
    laneRound.dayReason.toLowerCase().includes('sundown'),
    JSON.stringify({ kind: laneRound.dayHintKind, label: laneRound.dayHintLabel, reason: laneRound.dayReason }));
  checks.check('dusk offers the lamp round and walking it lights the bunting',
    typeof laneRound.duskHintLabel === 'string' &&
    laneRound.duskHintLabel.toLowerCase().includes('light') &&
    laneRound.duskChanged === true &&
    laneRound.afterLamp.every((i, n) => laneRound.beforeLamp[n] === 0 && i > 0),
    JSON.stringify({ label: laneRound.duskHintLabel, before: laneRound.beforeLamp, after: laneRound.afterLamp }));
  checks.check('lighting the lane pays once and cannot be farmed in place',
    laneRound.afterCoins > laneRound.beforeCoins &&
    laneRound.secondChanged === false &&
    laneRound.coinsAfterSecond === laneRound.afterCoins,
    JSON.stringify({ before: laneRound.beforeCoins, after: laneRound.afterCoins, second: laneRound.coinsAfterSecond }));
  checks.check('the lamp post head reports the same lit state as the bunting',
    laneRound.beforePost === 0 && laneRound.afterPost > 0,
    JSON.stringify({ before: laneRound.beforePost, after: laneRound.afterPost }));
  checks.check('the lane stays lit all night and the round is not offered twice',
    laneRound.nightLamp.every((i) => i > 0) &&
    laneRound.nightHintLabel !== laneRound.duskHintLabel &&
    laneRound.nightChanged === false,
    JSON.stringify({ night: laneRound.nightLamp, label: laneRound.nightHintLabel, changed: laneRound.nightChanged }));
  checks.check('dawn puts the lane out and dusk offers the round again',
    laneRound.dawnLamp.every((i) => i === 0) &&
    laneRound.dawnPost === 0 &&
    laneRound.dawnFlag === false &&
    typeof laneRound.relitLabel === 'string' &&
    laneRound.relitLabel.toLowerCase().includes('light') &&
    laneRound.relitChanged === true,
    JSON.stringify({ dawn: laneRound.dawnLamp, post: laneRound.dawnPost, flag: laneRound.dawnFlag, relit: laneRound.relitChanged }));

  await capture(page, 'round54-lane-lighting.png');

  // --- 28t. The modelled lane lamp post (round 55) ---------------------------
  // The lane's procedural cylinder+sphere post swaps for the same lamp.glb the
  // plaza posts use, rotated so its arm hangs the lantern over the walkway and
  // dressed in the painted-iron maps. Three things must survive the swap: the
  // stand-ins hide, the bulb keeps the day/night emissive handoff, and the
  // lantern lands inside the lane corridor (the post stands at the wall edge).
  const laneLamp = await page.evaluate(() => window.amazingAdventure.assetsReady().then(async () => {
    const api = window.amazingAdventure;
    const { LANE_LANTERNS, LAMP_ARM_REACH, lampArmFacing, nearestLaneLantern, LANE_LIGHTING_POST } =
      await import('./src/areas.js');
    const frames = async (n) => {
      for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
    };
    let models = 0, hiddenPosts = 0, hiddenHeads = 0, ironPainted = 0, laneBulbs = 0;
    const textured = [];
    api.scene.traverse((o) => {
      if (o.name === 'lane-lamp-model') models += 1;
      if (o.userData && o.userData.lanePostStandin && !o.visible) hiddenPosts += 1;
      if (o.userData && o.userData.lanePostLamp && !o.visible) hiddenHeads += 1;
      if (o.isMesh && o.material && o.material.name === 'LampIronPainted') {
        ironPainted += 1;
        if (o.material.map && o.material.normalMap && o.material.roughnessMap) textured.push(o.name);
      }
      if (o.name === 'LampBulb' && o.parent && o.parent.name === 'lane-lamp-model') laneBulbs += 1;
    });
    // Work out where the arm *should* point without asking the rule under test,
    // or a broken rule would supply its own expected answer and agree with
    // itself. This is an independent argmin over the declared strands.
    const aims = LANE_LANTERNS.map((s) => ({
      strand: { x: s.x, z: s.strandZ },
      d2: (s.x - LANE_LIGHTING_POST.x) ** 2 + (s.strandZ - LANE_LIGHTING_POST.z) ** 2,
      aim: lampArmFacing(LANE_LIGHTING_POST, { x: s.x, z: s.strandZ }, LAMP_ARM_REACH)
    }));
    const sorted = [...aims].sort((a, b) => a.d2 - b.d2);
    const expected = sorted[0].aim;
    const bulb = api.environment.postLamp;
    const aim = api.environment.laneLampAim;
    // Where the bulb actually hangs, not where the aim arithmetic says it
    // should: a group that never rotates still returns a plausible
    // lanternX/lanternZ from lampArmFacing(), so only the world position can
    // tell whether the arm is really pointing down the walkway. The GLB bakes
    // every offset into the vertices (mesh.position is the origin), so the
    // measure has to be the geometry's bounding-box centre in world space,
    // not getWorldPosition().
    let bulbWorld = null;
    if (bulb) {
      if (!bulb.geometry.boundingBox) bulb.geometry.computeBoundingBox();
      const centre = bulb.geometry.boundingBox.getCenter(new (bulb.position.constructor)());
      bulb.localToWorld(centre);
      bulbWorld = { x: Number(centre.x.toFixed(4)), y: Number(centre.y.toFixed(4)), z: Number(centre.z.toFixed(4)) };
    }
    const emissive = bulb ? bulb.material.emissive.getHexString() : null;
    // The head is a state readout, not a lamp that burns all night: it must be
    // dark in daylight, dark at dusk before the round is walked, and lit only
    // once the lane is lit -- otherwise it advertises a job it has not done.
    api.setClock(30);
    await frames(3);
    const dayIntensity = bulb ? bulb.material.emissiveIntensity : null;
    api.setClock(80);
    await frames(3);
    const duskDark = bulb ? bulb.material.emissiveIntensity : null;
    api.getState().flags.laneLanternsLit = true;
    api.setClock(80);
    await frames(3);
    const duskLit = bulb ? bulb.material.emissiveIntensity : null;
    api.getState().flags.laneLanternsLit = false;
    api.setClock(30);
    await frames(3);
    const restIntensity = bulb ? bulb.material.emissiveIntensity : null;
    return { state: api.assetState(), models, hiddenPosts, hiddenHeads, ironPainted, textured,
             laneBulbs, emissive, bulbWorld, dayIntensity, duskDark, duskLit, restIntensity, aim,
             expected, runnerUp: sorted[1] ? sorted[1].aim : null };
  }));
  checks.check('the modelled lane lamp replaces the procedural post and head',
    laneLamp.state.laneLamp === 'model' && laneLamp.models === 1 &&
    laneLamp.hiddenPosts === 1 && laneLamp.hiddenHeads === 1,
    JSON.stringify({ state: laneLamp.state.laneLamp, models: laneLamp.models,
                     hiddenPosts: laneLamp.hiddenPosts, hiddenHeads: laneLamp.hiddenHeads }));
  checks.check('the lane lamp arm hangs its lantern over the walkway, not the wall',
    laneLamp.aim && Number.isFinite(laneLamp.aim.rotationY) &&
    laneLamp.bulbWorld &&
    // The model must actually put the bulb where the aim rule says.
    Math.abs(laneLamp.bulbWorld.x - laneLamp.aim.lanternX) < 0.01 &&
    Math.abs(laneLamp.bulbWorld.z - laneLamp.aim.lanternZ) < 0.01 &&
    // And the aim must be the *nearest* strand's, matched to a millimetre, so
    // pointing at the wrong lantern cannot pass on being vaguely in the lane.
    Math.abs(laneLamp.aim.rotationY - laneLamp.expected.rotationY) < 0.001 &&
    Math.abs(laneLamp.aim.lanternX - laneLamp.expected.lanternX) < 0.001 &&
    Math.abs(laneLamp.aim.lanternZ - laneLamp.expected.lanternZ) < 0.001 &&
    // The strands really are distinguishable, or the assertion above would be
    // satisfied by luck. They differ by only ~7 cm in x, so rotation is what
    // actually separates them (nearest -2.863 rad vs runner-up -2.581 rad).
    Math.abs(laneLamp.expected.rotationY - laneLamp.runnerUp.rotationY) > 0.2 &&
    // Off the wall (the post is at the wall edge, x 13.4) and over the lane.
    laneLamp.aim.lanternX < 13.4,
    JSON.stringify({ aim: laneLamp.aim, bulb: laneLamp.bulbWorld,
                     expected: laneLamp.expected, runnerUp: laneLamp.runnerUp }));
  checks.check('the lane lamp ironwork wears all three painted maps',
    laneLamp.state.lampMetal === 'textured' && laneLamp.ironPainted > 0 &&
    laneLamp.textured.length === laneLamp.ironPainted,
    JSON.stringify({ metal: laneLamp.state.lampMetal, iron: laneLamp.ironPainted,
                     textured: laneLamp.textured }));
  checks.check('the modelled lane head reports the lane round instead of glowing all night',
    laneLamp.laneBulbs === 1 && laneLamp.emissive === 'ffb43a' &&
    laneLamp.dayIntensity === 0 && laneLamp.duskDark === 0 &&
    laneLamp.duskLit > 0 && laneLamp.restIntensity === 0,
    JSON.stringify({ bulbs: laneLamp.laneBulbs, emissive: laneLamp.emissive,
                     day: laneLamp.dayIntensity, duskDark: laneLamp.duskDark,
                     duskLit: laneLamp.duskLit, rest: laneLamp.restIntensity }));

  await capture(page, 'round55-lane-lamp.png');

  // The cast has to notice the difference, or the chore is invisible outside the
  // lane's own light. Dusk is when the pair look at the sky, so the script key
  // is checked in both states rather than only the pretty one.
  const laneTalk = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const { scriptKeyFor } = await import('./src/ambient.js');
    // A fresh state, not api.getState(): by this point the suite has finished
    // quests, and toll_done legitimately outranks the lane chatter. Asserting
    // lane talk against a post-quest state would be asserting a priority the
    // script is not supposed to have.
    const { createInitialState } = await import('./src/state.js');
    const state = createInitialState();
    state.flags.laneLanternsLit = false;
    const dark = scriptKeyFor(state, 'dusk');
    state.flags.laneLanternsLit = true;
    const lit = scriptKeyFor(state, 'dusk');
    state.flags.laneLanternsLit = false;
    // And confirm the live state is not one where the lane would ever be the
    // topic, so this check explains itself if the priority ever changes.
    return { dark, lit, live: scriptKeyFor(api.getState(), 'dusk') };
  });
  checks.check('the plaza cast talks about the lane lanterns at dusk, both ways',
    laneTalk.dark === 'lane_dark' && laneTalk.lit === 'lane_lit',
    JSON.stringify(laneTalk));














  // The upgrade must not change gameplay: the modelled counter still blocks.
  // Yaw -PI/2 faces +X (east); walking from (8,-3) heads at the counter whose
  // collider spans x 9..13, so the player must stop short of x 8.9.
  const stallBlocks = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    await api.assetsReady();
    api.player.placeAt(8, -3, -Math.PI / 2);
    api.player.setMoveInput(1, 0);
    await new Promise((r) => setTimeout(r, 1800));
    api.player.setMoveInput(0, 0);
    return { x: Number(api.player.position.x.toFixed(2)), stoppedOutside: api.player.position.x < 8.9 };
  });
  checks.check('the modelled market stall is solid, not something you can walk through',
    stallBlocks.stoppedOutside, JSON.stringify(stallBlocks));
  await page.evaluate(() => {
    const api = window.amazingAdventure;
    api.player.setMoveInput(0, 0);
    api.player.placeAt(0, 13, 0);
  });


  // The lane walls carry the third Kaggle family (plaster). Same contract as
  // the other families: three maps, white base so nothing is double-tinted.
  const plaster = await page.evaluate(() => window.amazingAdventure.assetsReady().then(() => {
    const api = window.amazingAdventure;
    let wall = null;
    api.scene.traverse((o) => {
      if (o.isMesh && o.geometry.type === 'BoxGeometry' && o.material.map &&
          o.position.y === 1.5 && !wall) {
        wall = {
          map: true,
          normal: Boolean(o.material.normalMap),
          rough: Boolean(o.material.roughnessMap),
          color: o.material.color.getHexString(),
          repeat: [o.material.map.repeat.x, o.material.map.repeat.y]
        };
      }
    });
    return { state: api.assetState(), wall };
  }));
  checks.check('the lane walls are dressed with all three plaster maps',
    plaster.state.plaster === 'textured' && plaster.wall &&
    plaster.wall.map && plaster.wall.normal && plaster.wall.rough,
    JSON.stringify({ state: plaster.state.plaster, wall: plaster.wall }));
  checks.check('the plaster tiles at wall scale and is not double-tinted',
    plaster.wall && plaster.wall.repeat[0] === 7 && plaster.wall.color === 'ffffff',
    JSON.stringify({ repeat: plaster.wall && plaster.wall.repeat, color: plaster.wall && plaster.wall.color }));


  // --- 27x. The deployable package is the game --------------------------------
  // The preview is built from the manifest, so this asserts the packaged artefact
  // against the manifest rather than trusting the build script.
  const pkg = await page.evaluate(async () => {
    const m = await import('./src/manifest.js');
    const manifest = m.buildManifest();
    return {
      files: manifest.requiredFiles.length,
      entry: manifest.entryPoint,
      version: manifest.version
    };
  });
  checks.check('the running build reports a served manifest with a real entry point',
    pkg.files >= 27 && typeof pkg.entry === 'string' && pkg.version === '0.3.0',
    JSON.stringify(pkg));

  // Everything the page actually loaded must be same-origin and must have succeeded.
  const loaded = await page.evaluate(() => {
    const entries = performance.getEntriesByType('resource').map((e) => e.name);
    return {
      total: entries.length,
      offOrigin: entries.filter((u) => !u.startsWith(location.origin) && !u.startsWith('data:')),
      failed: entries.filter((e) => e.transferSize === 0 && !e.name.startsWith('data:'))
    };
  });
  checks.check('every resource the game loads is same-origin',
    loaded.total > 0 && loaded.offOrigin.length === 0,
    JSON.stringify({ total: loaded.total, offOrigin: loaded.offOrigin.slice(0, 4) }));

  // The static host has to send correct JavaScript MIME types or module loading
  // fails on a phone with a bare "Failed to fetch dynamically imported module".
  const mime = await page.evaluate(async () => {
    const res = await fetch('./src/main.js');
    const mod = await fetch('./src/manifest.js');
    return { js: res.headers.get('content-type'), manifest: mod.headers.get('content-type'), status: res.status };
  });
  checks.check('the server sends JavaScript modules with a JavaScript content type',
    mime.status === 200 && /javascript/.test(mime.js || ''),
    JSON.stringify(mime));

  await capture(page, 'round27-package.png');

  // --- 27y. A new player is told what to do --------------------------------
  // The plaza puts you a few metres from anyone, so the interaction hint is hidden
  // at spawn and a first-time player used to get no instruction at all.
  await page.evaluate(() => {
    localStorage.removeItem('amazing-adventure:save:v2');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForBoot(page);
  await page.click('#play');
  await new Promise((r) => setTimeout(r, 1400));

  const arrival = await page.evaluate(() => {
    const api = window.amazingAdventure;
    const p = api.player.position;
    const nearest = api.npcs
      .map((n) => ({ name: n.name, d: Math.hypot(n.group.position.x - p.x, n.group.position.z - p.z) }))
      .sort((a, b) => a.d - b.d)[0];
    return {
      toasts: [...document.querySelectorAll('#toast-stack > *')].map((t) => t.textContent.trim()),
      live: (document.getElementById('sr-live')?.textContent || '').trim(),
      hintShown: !document.getElementById('hint')?.hidden,
      nearest,
      interactables: api.interactables().length
    };
  });
  checks.check('the first thing a new player sees out of range is an instruction',
    arrival.interactables === 0 && arrival.toasts.length > 0,
    JSON.stringify(arrival));
  checks.check('the opening instruction says how to move and how to interact',
    arrival.toasts.some((t) => /W A S D/.test(t)) &&
    arrival.live.length > 0 && /press E|tap Use/.test(arrival.live),
    JSON.stringify({ toasts: arrival.toasts, live: arrival.live.slice(0, 90) }));
  checks.check('the opening instruction names the person actually nearest',
    arrival.nearest && arrival.live.includes(arrival.nearest.name),
    JSON.stringify({ nearest: arrival.nearest.name, live: arrival.live.slice(0, 110) }));

  // The welcome must not repeat itself later in the same session.
  await page.evaluate(() => {
    const api = window.amazingAdventure;
    const m = api.npcs.find((n) => n.id === 'mara');
    api.player.placeAt(m.group.position.x, m.group.position.z + 1.4, 0, 0);
  });
  await new Promise((r) => setTimeout(r, 350));
  await page.keyboard.press('e');
  await new Promise((r) => setTimeout(r, 500));
  await page.keyboard.press('1');
  await new Promise((r) => setTimeout(r, 500));
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 400));
  const laterToasts = await page.evaluate(() => [...document.querySelectorAll('#toast-stack > *')].map((t) => t.textContent.trim()));
  checks.check('the opening instruction does not repeat once play is underway',
    !laterToasts.some((t) => /You are in the plaza/.test(t)),
    JSON.stringify(laterToasts));

  await capture(page, 'round26-onboarding.png');

  // A returning player must not be re-tutorialised.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForBoot(page);
  const continueShown = await page.evaluate(() => !document.getElementById('continue').hidden);
  await page.click('#continue');
  await new Promise((r) => setTimeout(r, 1200));
  const afterContinue = await page.evaluate(() => ({
    toasts: [...document.querySelectorAll('#toast-stack > *')].map((t) => t.textContent.trim()),
    lanterns: window.amazingAdventure.getState().quests.lanterns
  }));
  checks.check('continuing a saved game does not show the welcome again',
    continueShown === true && afterContinue.lanterns !== 'none' &&
    !afterContinue.toasts.some((t) => /You are in the plaza/.test(t)),
    JSON.stringify(afterContinue));

  // --- 27z. The whole interface in the accessibility tree --------------------
  // Round 24 checked the conversation; this checks the rest of the UI the same way,
  // by reading the tree rather than the markup. Two regions were both headed
  // "Journal" and visible at the same time, so navigating by heading gave the same
  // name twice with nothing to tell them apart.
  await page.evaluate(() => {
    const api = window.amazingAdventure;
    document.getElementById('dialogue')?.setAttribute('hidden', '');
    api.player.frozen = false;
  });
  await new Promise((r) => setTimeout(r, 250));
  await page.keyboard.press('j');
  await new Promise((r) => setTimeout(r, 600));

  const uiCdp = await page.createCDPSession();
  await uiCdp.send('Accessibility.enable');
  let uiNodes = (await uiCdp.send('Accessibility.getFullAXTree')).nodes;
  const axList = (nodes) => nodes.filter((n) => n.role?.value === 'list');
  const axHeadings = (nodes) => nodes.filter((n) => n.role?.value === 'heading');

  const headingNames = axHeadings(uiNodes).map((n) => n.name?.value || '');
  const duplicates = headingNames.filter((name, i) => name && headingNames.indexOf(name) !== i);
  checks.check('no two visible regions share the same heading name',
    duplicates.length === 0,
    JSON.stringify({ headings: headingNames }));

  checks.check('the heading outline is coherent rather than flat or out of order',
    headingNames.length >= 4 && headingNames.every((n) => n.length > 0),
    JSON.stringify(headingNames));

  const listNames = axList(uiNodes).map((n) => n.name?.value || '');
  checks.check('every list is labelled so a reader knows what it contains',
    axList(uiNodes).length >= 3 && listNames.every((n) => n.length > 0),
    JSON.stringify({ lists: listNames }));

  // A list whose children are not listitems is announced as nothing useful.
  const byId = new Map(uiNodes.map((n) => [n.nodeId, n]));
  const childRoles = (id) => (byId.get(id)?.childIds || []).map((c) => byId.get(c)).filter(Boolean).map((c) => c.role?.value);
  const badLists = axList(uiNodes).filter((l) => {
    const roles = childRoles(l.nodeId);
    return roles.length > 0 && !roles.includes('listitem');
  });
  checks.check('every list contains real list items',
    badLists.length === 0,
    JSON.stringify({ bad: badLists.map((l) => l.name?.value) }));

  await capture(page, 'round25-headings.png');
  await page.keyboard.press('j');
  await new Promise((r) => setTimeout(r, 400));

  // --- 28a. The real accessibility tree, not just the DOM -------------------
  // Every earlier accessibility round verified attributes in the DOM. This reads
  // the accessibility tree the browser actually hands to assistive technology, via
  // CDP, which is much closer to what a screen reader consumes.
  await page.evaluate(() => {
    const api = window.amazingAdventure;
    document.getElementById('dialogue')?.setAttribute('hidden', '');
    api.player.frozen = false;
    const mara = api.npcs.find((n) => n.id === 'mara');
    api.player.placeAt(mara.group.position.x, mara.group.position.z + 1.4, 0, 0);
  });
  await new Promise((r) => setTimeout(r, 350));
  await page.keyboard.press('e');
  await new Promise((r) => setTimeout(r, 700));

  const cdp = await page.createCDPSession();
  await cdp.send('Accessibility.enable');
  const axTree = async () => (await cdp.send('Accessibility.getFullAXTree')).nodes;
  let axNodes = await axTree();

  const choiceNodes = () => axNodes.filter((n) => /^Choice \d/.test(n.name?.value || ''));
  // CDP reports some AX property values as the string "true" rather than boolean
  // true, so normalise before comparing or the assertions silently never match.
  const rawProp = (node, key) => (node.properties || []).find((p) => p.name === key)?.value?.value;
  const propOf = (node, key) => {
    const v = rawProp(node, key);
    if (v === 'true') return true;
    if (v === 'false') return false;
    return v;
  };

  checks.check('the choices appear in the accessibility tree with a spoken name',
    choiceNodes().length >= 2 && choiceNodes().every((n) => /^Choice \d of \d: .+/.test(n.name.value)),
    JSON.stringify(choiceNodes().map((n) => n.name.value)));

  checks.check('a choice name does not run the key digit into the sentence',
    choiceNodes().every((n) => !/^\d/.test(n.name.value) && !/^Choice \d of \d: ?\d/.test(n.name.value)),
    JSON.stringify({ names: choiceNodes().map((n) => n.name.value) }));

  checks.check('each choice exposes its shortcut key to assistive tech',
    choiceNodes().every((n) => typeof propOf(n, 'keyshortcuts') === 'string'),
    JSON.stringify(choiceNodes().map((n) => propOf(n, 'keyshortcuts'))));

  // The keyboard highlight must be visible as STATE, not only as a CSS class.
  const checkedChoices = () => choiceNodes().filter((n) => propOf(n, 'checked') === true);
  checks.check('the checked state is readable from the accessibility tree at all',
    choiceNodes().some((n) => propOf(n, 'checked') !== undefined),
    JSON.stringify(choiceNodes().map((n) => rawProp(n, 'checked'))));
  const firstChecked = checkedChoices();
  checks.check('the highlighted choice is exposed as checked, with exactly one checked',
    firstChecked.length === 1 && propOf(firstChecked[0], 'checked') === true,
    JSON.stringify(choiceNodes().map((n) => ({ name: n.name.value.slice(0, 24), checked: propOf(n, 'checked') }))));

  await page.keyboard.press('s');
  await new Promise((r) => setTimeout(r, 350));
  axNodes = await axTree();
  const movedChecked = checkedChoices();
  const groupNode = axNodes.find((n) => n.role?.value === 'radiogroup');
  checks.check('moving the highlight moves the checked state in the accessibility tree',
    movedChecked.length === 1 && movedChecked[0].name.value !== firstChecked[0].name.value,
    JSON.stringify({ before: firstChecked[0]?.name?.value?.slice(0, 24), after: movedChecked[0]?.name?.value?.slice(0, 24) }));

  checks.check('the choices are grouped so the set is announced with its context',
    !!groupNode && (groupNode.name?.value || '').length > 0,
    JSON.stringify({ group: groupNode?.name?.value, role: groupNode?.role?.value }));

  // The conversation panel itself must be a dialog in the tree, with a name.
  const dialogNode = axNodes.find((n) => n.role?.value === 'dialog');
  checks.check('the conversation is a named dialog in the accessibility tree',
    !!dialogNode && (dialogNode.name?.value || '').length > 0,
    JSON.stringify({ name: dialogNode?.name?.value, role: dialogNode?.role?.value }));

  await capture(page, 'round24-axtree.png');
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 400));

  // --- 29a. The terrace parapet is a real edge ------------------------------
  // The parapet is only 0.55m tall, so the shared "can a person step over it" rule
  // gave it no collider -- but behind it is a 1.2m drop, which is exactly the edge
  // the wall exists to mark. The player used to walk straight over the lip anywhere
  // along the terrace instead of taking the ramp.
  const terraceInfo = await page.evaluate(async () => {
    const t = await import('./src/terrain.js');
    return { TERRACE: t.TERRACE };
  });
  const rampMinX = terraceInfo.TERRACE.ramp.minX;
  const rampMaxX = terraceInfo.TERRACE.ramp.maxX;
  const lipZ = terraceInfo.TERRACE.maxZ;

  const pushOffLip = async (x) => {
    await page.evaluate(async (probe) => {
      const api = window.amazingAdventure;
      api.player.position.set(probe.x, 0, probe.z);
      api.player.velocity.set(0, 0, 0);
      api.player.yaw = Math.PI; // face south, toward the lip
      api.player.syncCamera();
      api.player.frozen = false;
      api.player.enabled = true;
    }, { x, z: -16.0 });
    await new Promise((r) => setTimeout(r, 250));
    for (let i = 0; i < 60; i += 1) {
      await page.evaluate(() => window.amazingAdventure.player.setMoveInput(1, 0));
      await new Promise((r) => setTimeout(r, 30));
    }
    await page.evaluate(() => window.amazingAdventure.player.setMoveInput(0, 0));
    await new Promise((r) => setTimeout(r, 250));
    return page.evaluate(() => {
      const p = window.amazingAdventure.player.position;
      return { x: +p.x.toFixed(2), z: +p.z.toFixed(2), ground: +window.amazingAdventure.player.groundHeight().toFixed(2) };
    });
  };

  // Points outside the ramp opening must be held back on the terrace.
  const outsideRamp = [];
  for (const x of [rampMinX - 3.1, rampMinX - 1.6, rampMaxX + 1.1, rampMaxX + 3.1]) {
    outsideRamp.push({ tried: x, ...(await pushOffLip(x)) });
  }
  const escaped = outsideRamp.filter((r) => r.z > lipZ + 0.05 || r.ground < 1.0);
  checks.check('the terrace parapet stops the player everywhere except the ramp',
    escaped.length === 0, JSON.stringify({ lipZ, outsideRamp }));

  // ...and the ramp opening must still be passable in both directions.
  await page.evaluate(() => window.amazingAdventure.player.placeAt(0, -7.5, 0, 0));
  await new Promise((r) => setTimeout(r, 300));
  for (let i = 0; i < 90; i += 1) {
    await page.evaluate(() => window.amazingAdventure.player.setMoveInput(1, 0));
    await new Promise((r) => setTimeout(r, 30));
  }
  await page.evaluate(() => window.amazingAdventure.player.setMoveInput(0, 0));
  await new Promise((r) => setTimeout(r, 300));
  const upRamp = await page.evaluate(() => {
    const p = window.amazingAdventure.player.position;
    return { z: +p.z.toFixed(2), ground: +window.amazingAdventure.player.groundHeight().toFixed(2) };
  });
  checks.check('the ramp still leads onto the terrace',
    upRamp.ground > 1.0 && upRamp.z < lipZ,
    JSON.stringify({ upRamp, lipZ }));

  await page.evaluate(() => { window.amazingAdventure.player.yaw = Math.PI; });
  for (let i = 0; i < 90; i += 1) {
    await page.evaluate(() => window.amazingAdventure.player.setMoveInput(1, 0));
    await new Promise((r) => setTimeout(r, 30));
  }
  await page.evaluate(() => window.amazingAdventure.player.setMoveInput(0, 0));
  await new Promise((r) => setTimeout(r, 300));
  const downRamp = await page.evaluate(() => ({
    z: +window.amazingAdventure.player.position.z.toFixed(2),
    ground: +window.amazingAdventure.player.groundHeight().toFixed(2)
  }));
  checks.check('the ramp still leads back down to the plaza',
    downRamp.ground < 0.1 && downRamp.z > lipZ,
    JSON.stringify({ downRamp, lipZ }));

  await capture(page, 'round22-parapet.png');

  // --- 29b. Dialog focus management -----------------------------------------
  // The dialogue panel declares role=dialog and aria-modal=true, which tells
  // assistive tech that everything outside is inert. That is only honest if focus
  // is genuinely inside it: it used to stay on <body>, so a screen reader user was
  // told the dialog existed and then left unable to reach its choices.
  // Earlier checks leave the world in whatever state they finished in, so reset to a
  // clean game before testing focus: assuming a pristine `lanterns` step made this
  // check compare 'done' to 'done' and prove nothing.
  await page.evaluate(async () => {
    const S = await import('./src/state.js');
    const api = window.amazingAdventure;
    document.getElementById('dialogue')?.setAttribute('hidden', '');
    api.setState(S.createInitialState());
    api.player.placeAt(0, 0, 0, 0);
    api.player.frozen = false;
    api.refreshHUD();
  });
  await new Promise((r) => setTimeout(r, 250));
  await page.evaluate(() => {
    const api = window.amazingAdventure;
    const mara = api.npcs.find((n) => n.id === 'mara');
    api.player.placeAt(mara.group.position.x, mara.group.position.z + 1.4, 0, 0);
  });
  await new Promise((r) => setTimeout(r, 300));
  await page.keyboard.press('e');
  await new Promise((r) => setTimeout(r, 600));

  const focusOnOpen = await page.evaluate(() => ({
    open: !document.getElementById('dialogue').hidden,
    inDialogue: !!document.activeElement?.closest('#dialogue'),
    activeId: document.activeElement?.id || document.activeElement?.tagName
  }));
  checks.check('opening a conversation moves focus into the dialog',
    focusOnOpen.open === true && focusOnOpen.inDialogue === true,
    JSON.stringify(focusOnOpen));

  const canHoldFocus = await page.evaluate(() => {
    const el = document.getElementById('dialogue');
    return { tabindex: el.getAttribute('tabindex'), role: el.getAttribute('role') };
  });
  checks.check('the dialog is focusable and still declares its modal role',
    canHoldFocus.tabindex === '-1' && canHoldFocus.role === 'dialog',
    JSON.stringify(canHoldFocus));

  await capture(page, 'round20-dialog-focus.png');

  // Keyboard choice selection must still reach the game with focus inside the panel.
  const lanternsBefore = await page.evaluate(() => window.amazingAdventure.getState().quests.lanterns);
  await page.keyboard.press('1');
  await new Promise((r) => setTimeout(r, 600));
  const lanternsAfter = await page.evaluate(() => window.amazingAdventure.getState().quests.lanterns);
  checks.check('number keys still take a choice while focus is inside the dialog',
    lanternsBefore === 'none' && lanternsAfter !== 'none',
    JSON.stringify({ before: lanternsBefore, after: lanternsAfter }));

  // Closing must not strand focus on a hidden element, where keystrokes go nowhere.
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 500));
  const focusOnClose = await page.evaluate(() => {
    const active = document.activeElement;
    return {
      tag: active?.tagName,
      onHiddenElement: !!active?.closest('[hidden]'),
      dialogueHidden: document.getElementById('dialogue').hidden
    };
  });
  checks.check('closing a conversation hands focus back instead of stranding it',
    focusOnClose.dialogueHidden === true && focusOnClose.onHiddenElement === false,
    JSON.stringify(focusOnClose));

  // The canvas is the fallback focus target, so it must not have entered the tab order.
  const canvasTabIndex = await page.evaluate(() => {
    const canvas = document.querySelector('#game canvas');
    return canvas ? canvas.tabIndex : null;
  });
  checks.check('the canvas can hold focus without joining the tab order',
    canvasTabIndex === -1, JSON.stringify({ tabIndex: canvasTabIndex }));

  // And play continues normally afterwards.
  const walkBefore = await page.evaluate(() => {
    const p = window.amazingAdventure.player.position;
    return { x: p.x, z: p.z };
  });
  for (let i = 0; i < 12; i += 1) {
    await page.evaluate(() => window.amazingAdventure.player.setMoveInput(1, 0));
    await new Promise((r) => setTimeout(r, 50));
  }
  await page.evaluate(() => window.amazingAdventure.player.setMoveInput(0, 0));
  await new Promise((r) => setTimeout(r, 200));
  const walkAfter = await page.evaluate(() => {
    const p = window.amazingAdventure.player.position;
    return { x: p.x, z: p.z };
  });
  checks.check('the player can walk after a conversation closed',
    Math.hypot(walkAfter.x - walkBefore.x, walkAfter.z - walkBefore.z) > 0.2,
    JSON.stringify({ from: walkBefore, to: walkAfter }));

  // --- 29c. Text must honour the user's font size ---------------------------
  // Every font size used to be an absolute px value, so a low-vision player who
  // enlarges their browser's default font got no larger text at all: 48 declarations
  // and zero rem/em. These checks assert the text really scales, and that growing it
  // does not push the conversation's options out of reach.
  const remReport = await page.evaluate(() => {
    const sheet = [...document.styleSheets].flatMap((s) => {
      try { return [...s.cssRules]; } catch { return []; }
    });
    const walk = (rules, out) => {
      for (const rule of rules) {
        if (rule.cssRules) walk([...rule.cssRules], out);
        if (rule.style && rule.style.fontSize) out.push(rule.style.fontSize);
      }
      return out;
    };
    const sizes = walk(sheet, []);
    return {
      total: sizes.length,
      px: sizes.filter((v) => v.endsWith('px')).length,
      rem: sizes.filter((v) => v.endsWith('rem')).length
    };
  });
  checks.check('font sizes are relative, so a user font setting is respected',
    remReport.px === 0 && remReport.rem > 40,
    JSON.stringify(remReport));

  const measureText = () => page.evaluate(() => {
    const el = document.getElementById('clock-time');
    const r = el.getBoundingClientRect();
    return { h: Math.round(r.height), w: Math.round(r.width), size: parseFloat(getComputedStyle(el).fontSize) };
  });
  await page.evaluate(() => { document.documentElement.style.fontSize = '16px'; });
  await new Promise((r) => setTimeout(r, 400));
  const textAt100 = await measureText();
  await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
  await new Promise((r) => setTimeout(r, 500));
  const textAt200 = await measureText();
  checks.check('doubling the user font setting actually doubles the text',
    textAt200.size >= textAt100.size * 1.9 && textAt200.h > textAt100.h,
    JSON.stringify({ at100: textAt100, at200: textAt200 }));

  // With the text still enlarged, open a conversation and prove every option can be
  // reached -- scrolled into view if necessary -- rather than being pushed off screen.
  await page.evaluate(() => {
    const api = window.amazingAdventure;
    const mara = api.npcs.find((n) => n.id === 'mara');
    api.player.placeAt(mara.group.position.x, mara.group.position.z + 1.4, 0, 0);
    api.player.frozen = false;
  });
  await new Promise((r) => setTimeout(r, 350));
  await page.keyboard.press('e');
  await new Promise((r) => setTimeout(r, 700));

  const enlargedPanel = await page.evaluate(() => {
    const panel = document.getElementById('dialogue');
    const pr = panel.getBoundingClientRect();
    const scrollEl = panel.scrollHeight > panel.clientHeight ? panel : null;
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    const choices = [...document.querySelectorAll('#dialogue .choice')];
    const last = choices[choices.length - 1]?.getBoundingClientRect();
    const first = choices[0]?.getBoundingClientRect();
    return {
      open: !panel.hidden,
      panelInside: pr.top >= -1 && pr.bottom <= window.innerHeight + 1,
      panelTop: Math.round(pr.top),
      panelBottom: Math.round(pr.bottom),
      vh: window.innerHeight,
      lastReachable: last ? last.bottom <= window.innerHeight + 1 : null,
      firstReachable: first ? first.top >= -1 : null,
      count: choices.length
    };
  });
  checks.check('a conversation opened at 200% text stays inside the viewport',
    enlargedPanel.open === true && enlargedPanel.panelInside === true,
    JSON.stringify(enlargedPanel));
  checks.check('every conversation option is reachable at 200% text',
    enlargedPanel.count >= 2 && enlargedPanel.firstReachable === true && enlargedPanel.lastReachable === true,
    JSON.stringify(enlargedPanel));

  await capture(page, 'round21-text-200.png');
  await page.evaluate(() => { document.documentElement.style.fontSize = '16px'; });
  await new Promise((r) => setTimeout(r, 400));
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 400));

  // --- 29d. The stall actually sells its rope (round 78) --------------------
  // The four "What do you sell?" branches used to be dead ends. Drive the real
  // page: walk up to Oswin, open the stall, buy the rope, and reopen it.
  const ropeSale = await page.evaluate(async () => {
    const S = await import('./src/state.js');
    const api = window.amazingAdventure;
    const before = api.getState();
    api.setState(S.createInitialState());
    api.refreshHUD();
    return { coins: S.coins(api.getState()), rope: S.hasItem(api.getState(), 'rope'), keep: before };
  });
  const stallOpen = await talkToNpc('oswin');
  const stallChoice = await clickChoiceRegex('What do you sell');
  const wares = await page.evaluate(() => window.amazingAdventure.getDialogue());
  checks.check('Oswin\u2019s stall opens a priced ware instead of a dead end',
    stallOpen.visible && stallChoice.ok && Boolean(wares) && wares.choices.some((l) => /Buy Coil of Rope/.test(l)),
    JSON.stringify({ line: stallOpen.line.slice(0, 60), choices: wares?.choices }));
  const bought = await clickChoiceRegex('Buy Coil of Rope');
  const afterSale = await page.evaluate(async () => {
    const S = await import('./src/state.js');
    const state = window.amazingAdventure.getState();
    return {
      coins: S.coins(state), rope: S.hasItem(state, 'rope'),
      line: document.getElementById('dialogue-line').textContent,
      inventory: document.getElementById('inventory-list')?.textContent ?? ''
    };
  });
  checks.check('buying the rope spends 3 coins and puts it in the pack',
    bought.ok && afterSale.coins === ropeSale.coins - 3 && afterSale.rope === true,
    JSON.stringify(afterSale));
  await capture(page, 'round78-rope-sale.png');
  const reopen = await clickChoiceRegex('already yours|Leave');
  await page.evaluate(() => document.getElementById('dialogue-close')?.click() ?? null);
  await new Promise((r) => setTimeout(r, 200));
  const reoffer = await talkToNpc('oswin');
  const reofferSell = await clickChoiceRegex('What do you sell');
  const owned = await page.evaluate(() => window.amazingAdventure.getDialogue());
  checks.check('the rope cannot be bought twice',
    reoffer.visible && reofferSell.ok && Boolean(owned) &&
    owned.choices.some((l) => /already yours/.test(l)) &&
    !owned.choices.some((l) => /Buy Coil of Rope/.test(l)),
    JSON.stringify({ choices: owned?.choices }));
  await page.evaluate((keep) => { window.amazingAdventure.setState(keep); }, ropeSale.keep);
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 200));

  // --- 30. Save hardening and exhaustive reachability ----------------------
  // Save loading is the only place untrusted data enters the game, and a coin
  // balance that is finite but absurd slipped through the floor-only clamp.
  const hardening = await page.evaluate(async () => {
    const S = await import('./src/state.js');
    const mk = (coins) => S.deserialize(JSON.stringify({ state: { quests: {}, flags: { coins } } }));
    return {
      max: S.MAX_COINS,
      huge: S.coins(mk(1e308)),
      negative: S.coins(mk(-50)),
      ordinary: S.coins(mk(7)),
      arrayQuests: S.deserialize(JSON.stringify({ state: { quests: [] } })),
      fractional: S.coins(mk(2.9))
    };
  });
  checks.check('an absurd coin balance is clamped instead of trusted',
    hardening.huge === hardening.max && hardening.negative === 0 && hardening.ordinary === 7,
    JSON.stringify(hardening));
  checks.check('a corrupt save with an array of quests is refused, not half-loaded',
    hardening.arrayQuests === null, JSON.stringify({ loaded: hardening.arrayQuests !== null }));
  checks.check('a fractional balance is floored rather than rounded up',
    hardening.fractional === 2, JSON.stringify({ fractional: hardening.fractional }));

  // The exhaustive search itself runs under Node (see the playthrough suite), because
  // scripts/ is deliberately not part of the shipped build -- the release manifest
  // contains only src/ and index.html, so importing it from the page would mean
  // serving the test harness to players. What is checked here is that the same
  // state functions the search relies on are present and behave in the shipped build.
  const reachableApi = await page.evaluate(async () => {
    const S = await import('./src/state.js');
    return {
      hasCreate: typeof S.createInitialState === 'function',
      hasCounts: typeof S.questCounts === 'function',
      hasDeliver: typeof S.deliverArrears === 'function',
      hasLedger: typeof S.ledgerUnlocked === 'function',
      quests: S.QUEST_ORDER.length
    };
  });
  checks.check('the shipped build exposes the state functions the reachability proof covers',
    reachableApi.hasCreate && reachableApi.hasCounts && reachableApi.hasDeliver &&
    reachableApi.hasLedger && reachableApi.quests === 7,
    JSON.stringify(reachableApi));

  await capture(page, 'round18-reachability.png');
} catch (error) {
  runError = error;
} finally {
  await close();
  await server.stop();
}

checks.print();
if (runError) {
  console.log(`FAIL run aborted: ${runError.message}`);
  process.exit(1);
}
console.log(`\nscreenshots: ${outDir}/round2-*.png, round3-*.png`);
if (process.env.RECORD_ARTIFACTS !== '1' && !process.env.SCREENSHOT_DIR) {
  console.log('(temporary directory — set RECORD_ARTIFACTS=1 to refresh artifacts/)');
}
process.exit(checks.failed ? 1 : 0);
