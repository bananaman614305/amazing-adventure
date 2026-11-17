// Round 2 browser test: drives the real page in headless Chrome and plays the
// full quest chain through the DOM, then checks save/load and the day cycle.
// Run: npm run test:browser
import { resolve } from 'node:path';
import { startServer, launchBrowser, createChecks, screenshotDir } from './browser.mjs';

// Screenshots go to a throwaway directory unless RECORD_ARTIFACTS=1, so a
// verification run never dirties the committed artifacts/ evidence.
const outDir = await screenshotDir();

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
    .waitForFunction(() => window.amazingAdventure.player.groundHeight() > 1.19, { timeout: 45000, polling: 100 })
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
  await page.screenshot({ path: resolve(outDir, 'round2-dialogue-mara.png') });

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
  // Only these three are driven by this part of the run; the toll and the lane
  // ledger are exercised separately in section 14 and 17.
  const coreDone = ['lanterns', 'key', 'cheer'].every((q) => finalHud.quests[q] === 'done');
  checks.check('all three plaza quests complete', coreDone, JSON.stringify(finalHud.quests));
  checks.check('tracker counts at least three done and nothing active',
    Number(finalHud.data.done) >= 3 && finalHud.data.active === '0', JSON.stringify(finalHud.data));
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
  await page.waitForFunction(() => window.amazingAdventure !== undefined, { timeout: 20000 });
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
    tollFlow.gatedBefore === true && tollFlow.status === 'done' &&
    tollFlow.afterCollect.watch > 0 && tollFlow.afterCollect.trade < 0,
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
  await page.screenshot({ path: resolve(outDir, 'round3-overheard.png') });

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
  await page.waitForFunction(() => window.amazingAdventure !== undefined, { timeout: 20000 });
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
    .waitForFunction(() => window.amazingAdventure.areaAt() === 'lane', { timeout: 20000, polling: 100 })
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
  await page.screenshot({ path: resolve(outDir, 'round3-market-lane.png') });

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
  await page.waitForFunction(() => window.amazingAdventure !== undefined, { timeout: 20000 });
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
  await page.waitForFunction(() => window.amazingAdventure !== undefined, { timeout: 20000 });
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
  await page.screenshot({ path: resolve(outDir, 'round4-wren-lane.png') });

  // --- 18. Final screenshots ----------------------------------------
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

  // Standing panel and reputation, for the record.
  await page.evaluate(() => {
    window.amazingAdventure.setClock(80);
    window.amazingAdventure.player.placeAt(-2, 12, 0.3, -0.03);
    document.getElementById('panel').hidden = false;
    window.amazingAdventure.refreshHUD();
  });
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: resolve(outDir, 'round3-standing.png') });

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
  await page.screenshot({ path: resolve(outDir, 'round3-lane-dusk.png') });

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
  await page.screenshot({ path: resolve(outDir, 'round4-wren-dialogue.png') });
} finally {
  await close();
  await server.stop();
}

checks.print();
console.log(`\nscreenshots: ${outDir}/round2-*.png, round3-*.png`);
if (process.env.RECORD_ARTIFACTS !== '1' && !process.env.SCREENSHOT_DIR) {
  console.log('(temporary directory — set RECORD_ARTIFACTS=1 to refresh artifacts/)');
}
process.exit(checks.failed ? 1 : 0);
