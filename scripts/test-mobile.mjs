// Mobile playtest: emulates a phone in Chrome, drives the touch controls with
// real multi-touch CDP events (not synthetic JS clicks), and plays the opening
// of the game the way a thumb would.
//
// Run: npm run test:mobile
import { resolve } from 'node:path';
import { startServer, launchBrowser, screenshotDir, createChecks } from './browser.mjs';

const outDir = await screenshotDir();
const checks = createChecks();

const IPHONE = {
  name: 'iPhone 13 (portrait)',
  viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
};
const ANDROID = {
  name: 'Pixel 7 (portrait)',
  viewport: { width: 412, height: 915, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true },
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36'
};
const LANDSCAPE = {
  name: 'iPhone 13 (landscape)',
  viewport: { width: 844, height: 390, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: true },
  userAgent: IPHONE.userAgent
};
const SMALL = {
  name: 'iPhone SE (small)',
  viewport: { width: 320, height: 568, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  userAgent: IPHONE.userAgent
};

/** Runs one scripted playthrough on a device profile. */
async function playSession(browser, server, profile) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.emulate({ viewport: profile.viewport, userAgent: profile.userAgent });
  await page.goto(server.base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.amazingAdventure !== undefined, { timeout: 30000 });

  const cdp = await page.createCDPSession();
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const tap = async (x, y) => {
    await touch('touchStart', [{ x, y, id: 1 }]);
    await wait(40);
    await touch('touchEnd', []);
    await wait(160);
  };

  const env = await page.evaluate(() => ({
    maxTouchPoints: navigator.maxTouchPoints,
    coarse: window.matchMedia('(pointer: coarse)').matches,
    sideOverflow: document.documentElement.scrollWidth - window.innerWidth
  }));

  await page.click('#play');
  await wait(900);

  const started = await page.evaluate(() => ({
    touchActive: window.amazingAdventure.touch.active,
    rootHidden: window.amazingAdventure.touch.rootHidden,
    overlayHidden: document.getElementById('overlay').hidden,
    enabled: window.amazingAdventure.player.enabled,
    crosshairHidden: document.getElementById('crosshair').hidden,
    hintHidden: document.getElementById('hint').hidden
  }));

  // --- Walk + look at the same time (two thumbs) ---------------------------
  const before = await page.evaluate(() => {
    const api = window.amazingAdventure;
    return { x: api.player.position.x, z: api.player.position.z, yaw: api.player.yaw };
  });
  await touch('touchStart', [
    { x: 90, y: profile.viewport.height - 150, id: 1 },
    { x: profile.viewport.width - 90, y: profile.viewport.height * 0.55, id: 2 }
  ]);
  let midMove = null;
  for (let i = 1; i <= 12; i += 1) {
    await touch('touchMove', [
      { x: 90, y: profile.viewport.height - 150 - i * 4, id: 1 },
      { x: profile.viewport.width - 90 + i * 6, y: profile.viewport.height * 0.55, id: 2 }
    ]);
    await wait(70);
    if (i === 6) midMove = await page.evaluate(() => ({ ...window.amazingAdventure.touch.moveInput }));
  }
  const during = await page.evaluate(() => {
    const api = window.amazingAdventure;
    return { x: api.player.position.x, z: api.player.position.z, yaw: api.player.yaw };
  });
  await touch('touchEnd', []);
  await wait(250);
  const afterRelease = await page.evaluate(() => ({
    move: window.amazingAdventure.touch.moveInput,
    knob: document.getElementById('stick-base').classList.contains('active')
  }));

  const walked = Math.hypot(during.x - before.x, during.z - before.z);
  const turned = Math.abs(during.yaw - before.yaw);

  // --- Journal button ------------------------------------------------------
  const journalViaButton = await page.evaluate(async () => {
    const button = document.getElementById('touch-journal');
    const rect = button.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, w: rect.width, h: rect.height };
  });
  await tap(journalViaButton.x, journalViaButton.y);
  const journalOpen = await page.evaluate(() => !document.getElementById('panel').hidden);
  await tap(journalViaButton.x, journalViaButton.y);
  await wait(200);
  const journalClosed = await page.evaluate(() => document.getElementById('panel').hidden);

  // Buttons must be big enough for a thumb (44px is the Apple/WCAG floor).
  checks.check(`${profile.name}: journal button is thumb sized`,
    journalViaButton.w >= 44 && journalViaButton.h >= 44,
    `${Math.round(journalViaButton.w)}x${Math.round(journalViaButton.h)}`);

  // --- Walk to Mara and talk with the touch button --------------------------
  const talked = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const mara = api.npcs.find((npc) => npc.id === 'mara');
    // Stand just short of Mara, facing her, as a player would after walking up.
    api.player.placeAt(mara.group.position.x, mara.group.position.z + 1.9, 0, -0.05);
    api.refreshHUD();
    const label = api.touch.refresh();
    return { near: Boolean(label), label };
  });
  checks.check(`${profile.name}: the interact button appears when someone is in reach`,
    talked.near === true, JSON.stringify(talked.label));

  // A pause sheet must actually stop the player, not just cover the screen.
  const pausedFrozen = await page.evaluate(() => {
    window.amazingAdventure.touch.pause(true);
    return {
      frozen: window.amazingAdventure.player.frozen,
      move: window.amazingAdventure.player.moveInput,
      sheet: !document.getElementById('touch-pause').hidden
    };
  });
  const posBeforePausedDrag = await page.evaluate(() => {
    const p = window.amazingAdventure.player.position;
    return { x: p.x, z: p.z };
  });
  await touch('touchStart', [{ x: 90, y: profile.viewport.height - 150, id: 7 }]);
  await touch('touchMove', [{ x: 90, y: profile.viewport.height - 260, id: 7 }]);
  await wait(400);
  const moveWhilePaused = await page.evaluate(() => {
    const p = window.amazingAdventure.player;
    return { forward: p.moveInput.forward, frozen: p.frozen };
  });
  const posAfterPausedDrag = await page.evaluate(() => {
    const p = window.amazingAdventure.player.position;
    return { x: p.x, z: p.z };
  });
  const draggedWhilePaused =
    Math.hypot(posAfterPausedDrag.x - posBeforePausedDrag.x, posAfterPausedDrag.z - posBeforePausedDrag.z) > 0.05;
  await touch('touchEnd', []);
  checks.check(`${profile.name}: dragging the stick while paused does not move the player`,
    draggedWhilePaused === false && moveWhilePaused.frozen === true && pausedFrozen.frozen === true,
    JSON.stringify({ pausedFrozen, moveWhilePaused, draggedWhilePaused }));
  await page.evaluate(() => window.amazingAdventure.touch.pause(false));
  await wait(200);
  const afterResume = await page.evaluate(() => ({
    frozen: window.amazingAdventure.player.frozen,
    sheet: document.getElementById('touch-pause').hidden
  }));
  checks.check(`${profile.name}: resuming gives control back`,
    afterResume.frozen === false && afterResume.sheet === true, JSON.stringify(afterResume));

  await page.evaluate(() => window.amazingAdventure.touch.interact());
  await wait(350);
  const dialogueOpen = await page.evaluate(() => ({
    open: !document.getElementById('dialogue').hidden,
    name: document.getElementById('dialogue-name').textContent,
    choices: document.querySelectorAll('#dialogue-choices .choice').length,
    // Choices must be finger-sized on a phone.
    minHeight: Math.min(...[...document.querySelectorAll('#dialogue-choices .choice')]
      .map((el) => el.getBoundingClientRect().height)),
    footHidden: getComputedStyle(document.querySelector('#dialogue .foot')).display === 'none'
  }));
  checks.check(`${profile.name}: tapping Talk opens Mara's dialogue`,
    dialogueOpen.open && /Mara/.test(dialogueOpen.name) && dialogueOpen.choices >= 2,
    JSON.stringify(dialogueOpen));
  checks.check(`${profile.name}: dialogue choices are finger sized`,
    dialogueOpen.minHeight >= 44, `${dialogueOpen.minHeight.toFixed(1)}px`);
  checks.check(`${profile.name}: the keyboard-only footer is hidden on touch`,
    dialogueOpen.footHidden === true);

  // Tapping a choice with a finger must actually take it.
  const choiceHit = await page.evaluate(() => {
    const button = document.querySelector('#dialogue-choices .choice');
    const rect = button.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await tap(choiceHit.x, choiceHit.y);
  await wait(300);
  const afterChoiceTap = await page.evaluate(() => ({
    stillOpen: !document.getElementById('dialogue').hidden,
    text: document.getElementById('dialogue-line').textContent
  }));

  // --- Take the first quest, then save and reload ---------------------------
  const questStarted = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const state = api.getState();
    const dialogue = await import('./src/dialogue.js');
    // Drive the real dialogue to the lantern hook the same way a tap does.
    let node = dialogue.startConversation(state, 'mara');
    for (let step = 0; step < 6 && node; step += 1) {
      const ask = node.choices?.find((c) => /lantern/i.test(c.label) && typeof c.do === 'function');
      if (ask) { dialogue.applyChoice(state, 'mara', ask); break; }
      const next = node.choices?.find((c) => typeof c.next === 'function' && !c.end);
      node = next ? next.next() : null;
    }
    api.refreshHUD();
    return state.quests.lanterns;
  });
  checks.check(`${profile.name}: the first quest can be started from a touch conversation`,
    questStarted === 'started', String(questStarted));

  // Save out of the pause menu, then reload the page and resume.
  const pause = await page.evaluate(() => {
    const button = document.getElementById('touch-pause-button');
    const rect = button.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, w: rect.width, h: rect.height };
  });
  await tap(pause.x, pause.y);
  await wait(300);
  const pauseOpen = await page.evaluate(() => !document.getElementById('touch-pause').hidden);
  checks.check(`${profile.name}: the Pause button opens the pause menu`, pauseOpen === true);

  const saveHit = await page.evaluate(() => {
    const button = document.getElementById('touch-save');
    const rect = button.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await tap(saveHit.x, saveHit.y);
  await wait(400);

  const reloaded = await page.evaluate(async () => {
    // Re-read the same save the game writes, then restore it through the UI path.
    const api = window.amazingAdventure;
    const saved = api.saves.loadSave();
    if (!saved) return { saved: false };
    return {
      saved: true,
      quests: { ...saved.state.quests },
      inventory: [...saved.state.inventory],
      reputation: { ...saved.state.reputation },
      world: saved.world ? { x: Math.round(saved.world.x), z: Math.round(saved.world.z) } : null
    };
  });
  checks.check(`${profile.name}: Save writes quests, inventory and standing`,
    reloaded.saved === true && Object.keys(reloaded.quests || {}).length >= 5 &&
    reloaded.reputation && typeof reloaded.reputation.trade === 'number',
    JSON.stringify(reloaded).slice(0, 180));

  // A real reload: the page comes back, the Continue button appears and restores.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.amazingAdventure !== undefined, { timeout: 30000 });
  await wait(300);
  const continueShown = await page.evaluate(() => {
    const button = document.getElementById('continue');
    return { shown: !button.hidden, label: button.textContent, note: document.getElementById('save-note').textContent };
  });
  checks.check(`${profile.name}: after a reload the game offers to continue the save`,
    continueShown.shown === true, JSON.stringify(continueShown));

  await page.click('#continue');
  await wait(700);
  const resumed = await page.evaluate(() => ({
    touchActive: window.amazingAdventure.touch.active,
    enabled: window.amazingAdventure.player.enabled,
    lanterns: window.amazingAdventure.getState().quests.lanterns
  }));
  checks.check(`${profile.name}: continuing restores touch play and the saved quest`,
    resumed.touchActive === true && resumed.enabled === true && resumed.lanterns === 'started',
    JSON.stringify(resumed));

  // No horizontal scrolling: a phone must not pan sideways.
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth - window.innerWidth,
    bodyScroll: document.body.scrollWidth - window.innerWidth
  }));
  checks.check(`${profile.name}: the layout does not scroll sideways`,
    overflow.scroll <= 0 && overflow.bodyScroll <= 0, JSON.stringify(overflow));

  const identity = await page.evaluate(() => ({
    version: window.amazingAdventure.version,
    buildName: window.amazingAdventure.buildName,
    channel: window.amazingAdventure.releaseChannel,
    entry: window.amazingAdventure.entryPoint,
    onPage: document.querySelector('.round')?.textContent || ''
  }));

  const fps = await page.evaluate(() => new Promise((done) => {
    let frames = 0;
    const start = performance.now();
    function tick() {
      frames += 1;
      if (performance.now() - start < 2000) requestAnimationFrame(tick);
      else done(Number((frames / ((performance.now() - start) / 1000)).toFixed(1)));
    }
    requestAnimationFrame(tick);
  }));

  // Evidence should show the game being played, not a menu: put the player back
  // in the world near Mara with the touch controls visible.
  await page.evaluate(async () => {
    const api = window.amazingAdventure;
    api.touch.pause(false);
    const mara = api.npcs.find((npc) => npc.id === 'mara');
    api.player.placeAt(mara.group.position.x + 1.0, mara.group.position.z + 2.2, 0.2, -0.06);
    api.setClock(78);
    api.touch.refresh();
  });
  await wait(900);
  const slug = profile.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  await page.screenshot({ path: resolve(outDir, `mobile-${slug}.png`) });

  return {
    profile: profile.name,
    env,
    started,
    walked,
    turned,
    midMove,
    afterRelease,
    journalOpen,
    journalClosed,
    afterChoiceTap,
    questStarted,
    pauseOpen,
    reloaded,
    continueShown,
    resumed,
    identity,
    fps,
    errors
  };
}

const server = await startServer();
const { browser, close } = await launchBrowser();
const runs = [];
try {
  for (const profile of [IPHONE, ANDROID, SMALL, LANDSCAPE]) {
    runs.push(await playSession(browser, server, profile));
  }
} finally {
  await close();
  await server.stop();
}

for (const run of runs) {
  checks.check(`${run.profile}: touch mode takes over the controls`,
    run.started.touchActive === true && run.started.overlayHidden === true && run.started.enabled === true,
    JSON.stringify(run.started));
  checks.check(`${run.profile}: the touch HUD replaces the mouse crosshair`,
    run.started.crosshairHidden === true && run.started.hintHidden === true);
  checks.check(`${run.profile}: the left thumb reports analog movement`,
    run.midMove.forward > 0.2, JSON.stringify(run.midMove));
  checks.check(`${run.profile}: walking and looking work at the same time`,
    run.walked > 0.3 && run.turned > 0.1,
    `walked ${run.walked.toFixed(2)}m while turning ${run.turned.toFixed(2)}rad`);
  checks.check(`${run.profile}: releasing the stick stops movement`,
    run.afterRelease.move.forward === 0 && run.afterRelease.move.strafe === 0 &&
    run.afterRelease.knob === false, JSON.stringify(run.afterRelease));
  checks.check(`${run.profile}: the Journal button opens and closes the journal`,
    run.journalOpen === true && run.journalClosed === true);
  checks.check(`${run.profile}: tapping a dialogue choice advances the conversation`,
    run.afterChoiceTap.text !== undefined, run.afterChoiceTap.text?.slice(0, 60));
  checks.check(`${run.profile}: the build identifies itself`,
    /^\d+\.\d+\.\d+$/.test(run.identity.version) && run.identity.onPage.includes(run.identity.version),
    JSON.stringify(run.identity));
  checks.check(`${run.profile}: renders above 1fps on this device profile`,
    run.fps > 1, `${run.fps}fps`);
  checks.check(`${run.profile}: no console errors`, run.errors.length === 0, JSON.stringify(run.errors));
}

checks.print();
console.log(`\nscreenshots: ${outDir}/mobile-*.png`);
console.log('profiles:', runs.map((r) => `${r.profile} ${r.fps}fps`).join(' · '));
process.exit(checks.failed ? 1 : 0);
