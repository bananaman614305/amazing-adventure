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

  // --- The accessibility controls must exist on a phone ---------------------
  // Start clean: no conversation, nobody guided, and somewhere with space around.
  await page.evaluate(() => {
    const api = window.amazingAdventure;
    api.stopGuidedTravel?.({ announceIt: false });
    document.getElementById('dialogue')?.setAttribute('hidden', '');
    api.player.frozen = false;
    api.player.placeAt(0, 6, 0, 0);
  });
  await wait(400);

  // Rounds 13-15 added C, L and G as keyboard shortcuts. A phone has none of those
  // keys, and VoiceOver on iOS is the most widely used screen reader, so without
  // these buttons the whole accessibility feature was desktop-only.
  const a11yButtons = await page.evaluate(() => {
    const ids = ['touch-describe', 'touch-nearby', 'touch-travel'];
    return ids.map((id) => {
      const el = document.getElementById(id);
      if (!el) return { id, missing: true };
      const rect = el.getBoundingClientRect();
      return {
        id,
        visible: rect.width > 0 && rect.height > 0 && !el.hidden,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        // A control that is off screen cannot be tapped, however good its size.
        onScreen: rect.top >= 0 && rect.bottom <= window.innerHeight &&
          rect.left >= 0 && rect.right <= window.innerWidth,
        labelled: Boolean(el.getAttribute('aria-label') || el.textContent.trim())
      };
    });
  });
  checks.check(`${profile.name}: the describe, nearby and travel controls exist on a phone`,
    a11yButtons.length === 3 && a11yButtons.every((b) => b.visible && !b.missing),
    JSON.stringify(a11yButtons));
  checks.check(`${profile.name}: the accessibility controls are thumb sized and on screen`,
    a11yButtons.every((b) => b.height >= 44 && b.width >= 44 && b.onScreen),
    JSON.stringify(a11yButtons.map((b) => `${b.id} ${b.width}x${b.height} on=${b.onScreen}`)));
  checks.check(`${profile.name}: every accessibility control has an accessible name`,
    a11yButtons.every((b) => b.labelled), JSON.stringify(a11yButtons.map((b) => b.id)));

  // Geometry alone is not enough: the buttons sit over the stick and look zones on a
  // small screen, so what matters is that a tap at their centre actually arrives.
  const tappable = await page.evaluate(() => {
    return ['touch-describe', 'touch-nearby', 'touch-travel'].map((id) => {
      const rect = document.getElementById(id).getBoundingClientRect();
      const top = document.elementFromPoint(
        rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { id, reaches: top?.id === id, top: top?.id || top?.tagName };
    });
  });
  checks.check(`${profile.name}: taps reach the accessibility controls, not the look zone`,
    tappable.every((t) => t.reaches), JSON.stringify(tappable));

  // Tapping "Where am I" must speak real state, not nothing. Tap by selector: the
  // interact button comes and goes, which shifts the row, so cached coordinates can
  // land on the wrong control.
  await page.tap('#touch-describe');
  await wait(400);
  const spokenDescribe = await page.evaluate(() => window.amazingAdventure.srAlertText());
  checks.check(`${profile.name}: tapping Where am I speaks the area and the gate`,
    /Plaza|Lane/.test(spokenDescribe || '') && /gate is (open|locked)/.test(spokenDescribe || ''),
    JSON.stringify(spokenDescribe?.slice(0, 80)));

  // Tapping "Nearby" must name something with a direction.
  await page.tap('#touch-nearby');
  await wait(600);
  const spokenNearby = await page.evaluate(() => window.amazingAdventure.srLiveText());
  checks.check(`${profile.name}: tapping Nearby names somewhere with a direction`,
    /(ahead|behind|left|right|within reach)/.test(spokenNearby || ''),
    JSON.stringify(spokenNearby?.slice(0, 80)));

  // Tapping "Take me" must start walking, and tapping again must stop. Check the
  // second tap happens while the first walk is still running, or it is a new walk,
  // not a stop.
  await page.tap('#touch-travel');
  await wait(500);
  const travelling = await page.evaluate(() => window.amazingAdventure.guidedState());
  await page.tap('#touch-travel');
  await wait(500);
  const stopped = await page.evaluate(() => window.amazingAdventure.guidedState());
  checks.check(`${profile.name}: tapping Take me starts guided travel and tapping again stops it`,
    travelling !== null && stopped === null,
    JSON.stringify({ travelling, stopped }));

  // Reset the world before the rest of the suite: guided travel may have walked the
  // player into a conversation, and the later checks expect a clean plaza.
  await page.evaluate(() => {
    const api = window.amazingAdventure;
    api.stopGuidedTravel({ announceIt: false });
    document.getElementById('dialogue')?.setAttribute('hidden', '');
    api.player.placeAt(0, 0, 0, 0);
    api.player.frozen = false;
  });
  await wait(400);

  // --- Backgrounding the app must not leave the game stuck ------------------
  // A phone user checks a message, comes back, and the game must still work. The
  // handler that froze the world on hide had no matching branch on return, so the
  // player stayed frozen forever with no pause sheet to resume from.
  const hide = () => page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const show = () => page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  await page.evaluate(() => {
    const api = window.amazingAdventure;
    document.getElementById('dialogue')?.setAttribute('hidden', '');
    api.touch.pause(false);
    api.player.placeAt(0, 0, 0, 0);
  });
  await wait(300);
  await hide();
  await wait(250);
  const whileHidden = await page.evaluate(() => window.amazingAdventure.player.frozen);
  await show();
  await wait(350);
  const afterReturn = await page.evaluate(() => window.amazingAdventure.player.frozen);
  checks.check(`${profile.name}: returning from the background unfreezes the world`,
    whileHidden === true && afterReturn === false,
    JSON.stringify({ whileHidden, afterReturn }));

  // And the player can actually move, not merely be unfrozen on paper.
  const posBeforeReturn = await page.evaluate(() => {
    const p = window.amazingAdventure.player.position;
    return { x: p.x, z: p.z };
  });
  for (let i = 0; i < 12; i += 1) {
    await page.evaluate(() => window.amazingAdventure.player.setMoveInput(1, 0));
    await wait(50);
  }
  await page.evaluate(() => window.amazingAdventure.player.setMoveInput(0, 0));
  await wait(200);
  const movedAfterReturn = await page.evaluate(() => {
    const p = window.amazingAdventure.player.position;
    return { x: p.x, z: p.z };
  });
  checks.check(`${profile.name}: the player can walk again after returning`,
    Math.hypot(movedAfterReturn.x - posBeforeReturn.x, movedAfterReturn.z - posBeforeReturn.z) > 0.2,
    JSON.stringify({ from: posBeforeReturn, to: movedAfterReturn }));

  // A conversation must survive backgrounding and stay paused, rather than being
  // torn down or leaving the world running behind the sheet.
  await page.evaluate(() => {
    const api = window.amazingAdventure;
    const mara = api.npcs.find((n) => n.id === 'mara');
    api.player.placeAt(mara.group.position.x, mara.group.position.z + 1.4, 0, 0);
  });
  await wait(300);
  await page.evaluate(() => window.amazingAdventure.touch.interact());
  await wait(500);
  const dialogueBefore = await page.evaluate(() => !document.getElementById('dialogue').hidden);
  await hide();
  await wait(250);
  await show();
  await wait(350);
  const dialogueAfter = await page.evaluate(() => ({
    open: !document.getElementById('dialogue').hidden,
    frozen: window.amazingAdventure.player.frozen
  }));
  checks.check(`${profile.name}: a conversation survives backgrounding and stays paused`,
    dialogueBefore === true && dialogueAfter.open === true && dialogueAfter.frozen === true,
    JSON.stringify(dialogueAfter));
  await page.evaluate(() => document.getElementById('dialogue-close')?.click());
  await wait(350);

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
  const lineBeforeTap = await page.evaluate(() => document.getElementById('dialogue-line').textContent);
  await tap(choiceHit.x, choiceHit.y);
  await wait(300);
  const afterChoiceTap = await page.evaluate(() => ({
    stillOpen: !document.getElementById('dialogue').hidden,
    text: document.getElementById('dialogue-line').textContent,
    memory: window.amazingAdventure.getState().memory.mara || null
  }));
  afterChoiceTap.lineBeforeTap = lineBeforeTap;

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

  // Close the conversation with the on-screen control, as a phone player must:
  // there is no Esc key, and a sub-menu may offer no "Leave" choice at all.
  const reopen = async () => {
    await page.evaluate(() => {
      const api = window.amazingAdventure;
      const mara = api.npcs.find((npc) => npc.id === 'mara');
      api.player.placeAt(mara.group.position.x, mara.group.position.z + 1.9, 0, -0.05);
      api.touch.refresh();
      api.touch.interact();
    });
    await wait(250);
  };

  await reopen();
  const closeReach = await page.evaluate(() => {
    const button = document.getElementById('dialogue-close');
    const rect = button.getBoundingClientRect();
    const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return {
      onTop: top === button, display: getComputedStyle(button).display,
      w: rect.width, h: rect.height, x: rect.x, y: rect.y
    };
  });
  checks.check(`${profile.name}: the close control is visible and on top of the dialogue`,
    closeReach.onTop === true && closeReach.display !== 'none' &&
    closeReach.w >= 40 && closeReach.h >= 40, JSON.stringify(closeReach));

  await tap(closeReach.x + closeReach.w / 2, closeReach.y + closeReach.h / 2);
  await wait(300);
  const dialogueClosed = await page.evaluate(() => ({
    hidden: document.getElementById('dialogue').hidden,
    frozen: window.amazingAdventure.player.frozen,
    zonesLive: getComputedStyle(document.getElementById('stick-zone')).pointerEvents !== 'none'
  }));
  checks.check(`${profile.name}: tapping the close control ends the conversation and frees the controls`,
    dialogueClosed.hidden === true && dialogueClosed.frozen === false && dialogueClosed.zonesLive === true,
    JSON.stringify(dialogueClosed));

  // Pausing while a conversation is open must actually stop the world. This
  // regressed once because closeDialogue() clears `frozen` after pause sets it.
  await reopen();
  const pauseOverDialogue = await page.evaluate(() => {
    const api = window.amazingAdventure;
    api.touch.pause(true);
    const paused = {
      sheet: !document.getElementById('touch-pause').hidden,
      dialogueClosed: document.getElementById('dialogue').hidden,
      frozen: api.player.frozen
    };
    api.touch.pause(false);
    return { paused, resumedFrozen: api.player.frozen, sheetHidden: document.getElementById('touch-pause').hidden };
  });
  checks.check(`${profile.name}: pausing mid-conversation really stops the world`,
    pauseOverDialogue.paused.sheet === true &&
    pauseOverDialogue.paused.dialogueClosed === true &&
    pauseOverDialogue.paused.frozen === true,
    JSON.stringify(pauseOverDialogue.paused));
  checks.check(`${profile.name}: resuming after a mid-conversation pause restores control`,
    pauseOverDialogue.resumedFrozen === false && pauseOverDialogue.sheetHidden === true,
    JSON.stringify(pauseOverDialogue));

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

  const identity = await page.evaluate(async () => {
    const module = await import('./src/version.js');
    return {
      version: window.amazingAdventure.version,
      buildName: window.amazingAdventure.buildName,
      channel: window.amazingAdventure.releaseChannel,
      entry: window.amazingAdventure.entryPoint,
      moduleVersion: module.VERSION,
      moduleEntry: module.ENTRY_POINT,
      onPage: document.querySelector('.round')?.textContent || ''
    };
  });

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

  // Starting by tapping the overlay background (not the button) must also work.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.amazingAdventure !== undefined, { timeout: 30000 });
  const overlayRect = await page.evaluate(() => {
    const card = document.querySelector('#overlay .card').getBoundingClientRect();
    return { x: card.x + card.width / 2, y: card.y - 30 };
  });
  await tap(overlayRect.x, overlayRect.y);
  await wait(700);
  const overlayStart = await page.evaluate(() => ({
    started: !document.getElementById('overlay').hidden ? false : true,
    touchActive: window.amazingAdventure.touch.active,
    enabled: window.amazingAdventure.player.enabled,
    rootVisible: !document.getElementById('touch').hidden
  }));
  checks.check(`${profile.name}: tapping the overlay background also starts in touch mode`,
    overlayStart.started && overlayStart.touchActive && overlayStart.enabled && overlayStart.rootVisible,
    JSON.stringify(overlayStart));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.amazingAdventure !== undefined, { timeout: 30000 });

  // --- Recovering from a dropped graphics context -----------------------
  // Phones drop the WebGL context under memory pressure. Without handling it
  // the canvas stays blank with no explanation, so this is a real phone risk.
  const contextLoss = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const ext = api.renderer.getContext().getExtension('WEBGL_lose_context');
    if (!ext) return { supported: false };
    const overlay = document.getElementById('context-lost');
    ext.loseContext();
    await new Promise((r) => setTimeout(r, 400));
    const reloadButton = document.getElementById('context-lost-reload');
    const reloadBox = reloadButton.getBoundingClientRect();
    const during = {
      shown: !overlay.hidden,
      message: document.getElementById('context-lost-message').textContent,
      saved: api.saves.loadSave() !== null,
      hint: (overlay.querySelector('.hint-line') || {}).textContent || '',
      // An element that exists but is unlabelled, zero-sized or hidden is not a
      // usable way out, so check the things a player actually needs.
      reload: {
        label: (reloadButton.textContent || '').trim(),
        width: Math.round(reloadBox.width),
        height: Math.round(reloadBox.height),
        visible: reloadBox.width > 0 && reloadBox.height > 0 &&
          getComputedStyle(reloadButton).visibility !== 'hidden' &&
          getComputedStyle(reloadButton).display !== 'none'
      }
    };
    ext.restoreContext();
    await new Promise((r) => setTimeout(r, 1000));
    return { supported: true, during, after: { hidden: overlay.hidden } };
  });
  checks.check(`${profile.name}: losing the graphics context shows a recovery message`,
    contextLoss.supported === false ||
    (contextLoss.during.shown === true && /lost|restor/i.test(contextLoss.during.message)),
    JSON.stringify(contextLoss.during || contextLoss));
  checks.check(`${profile.name}: progress is saved when the context is lost`,
    contextLoss.supported === false || contextLoss.during.saved === true,
    JSON.stringify(contextLoss.during || contextLoss));
  checks.check(`${profile.name}: the recovery sheet offers a usable reload`,
    contextLoss.supported === false ||
    (contextLoss.during.reload.visible === true &&
      contextLoss.during.reload.height >= 44 &&
      /reload/i.test(contextLoss.during.reload.label)),
    JSON.stringify(contextLoss.during?.reload));
  checks.check(`${profile.name}: the recovery sheet tells the player their progress is kept`,
    contextLoss.supported === false || /saved|continue/i.test(contextLoss.during.hint),
    JSON.stringify(contextLoss.during?.hint));
  checks.check(`${profile.name}: the game recovers when the context comes back`,
    contextLoss.supported === false || contextLoss.after.hidden === true,
    JSON.stringify(contextLoss.after || contextLoss));

  // Evidence should show the game being played, not a menu. The reload above
  // left the game on the title overlay, so start it again and stand by Mara
  // with the touch controls on screen.
  await page.click('#play');
  await wait(900);
  await page.evaluate(async () => {
    const api = window.amazingAdventure;
    api.touch.pause(false);
    const mara = api.npcs.find((npc) => npc.id === 'mara');
    api.player.placeAt(mara.group.position.x + 1.0, mara.group.position.z + 2.2, 0.2, -0.06);
    api.setClock(78);
    api.touch.refresh();
  });
  await wait(1200);
  // Evidence must be a sharp, full-resolution frame: the adaptive controller
  // has been lowering the pixel ratio on this GPU-less machine all session, and
  // the smallest viewport drops furthest, which made the SE capture look almost
  // black. Pin native resolution just for the screenshot.
  await page.evaluate(() => window.amazingAdventure.resolution.setAdaptive(false));
  await wait(600);
  const evidenceState = await page.evaluate(() => ({
    pixelRatio: window.amazingAdventure.renderer.getPixelRatio(),
    pauseSheet: !document.getElementById('touch-pause').hidden,
    dialogue: !document.getElementById('dialogue').hidden,
    panel: !document.getElementById('panel').hidden,
    touchClass: document.getElementById('touch').className,
    overlayHidden: document.getElementById('overlay').hidden,
    touchVisible: !document.getElementById('touch').hidden,
    interact: document.getElementById('touch-interact').hidden
      ? null : document.getElementById('touch-interact').textContent
  }));
  checks.check(`${profile.name}: the evidence frame shows live play with touch UI`,
    evidenceState.overlayHidden === true && evidenceState.touchVisible === true,
    JSON.stringify(evidenceState));
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
  // A real tap must do something observable: either the line changes, the
  // conversation closes, or Mara records the topic. Asserting `text !== undefined`
  // would have passed even if the tap did nothing at all.
  const tapDidSomething =
    run.afterChoiceTap.stillOpen === false ||
    run.afterChoiceTap.text !== run.afterChoiceTap.lineBeforeTap ||
    Boolean(run.afterChoiceTap.memory && run.afterChoiceTap.memory.talks > 0);
  checks.check(`${run.profile}: tapping a dialogue choice advances the conversation`,
    tapDidSomething,
    JSON.stringify({ before: run.afterChoiceTap.lineBeforeTap?.slice(0, 40),
                     after: run.afterChoiceTap.text?.slice(0, 40),
                     open: run.afterChoiceTap.stillOpen, memory: run.afterChoiceTap.memory }));
  checks.check(`${run.profile}: the build identifies itself consistently`,
    /^\d+\.\d+\.\d+$/.test(run.identity.version) &&
    run.identity.version === run.identity.moduleVersion &&
    run.identity.entry === run.identity.moduleEntry &&
    run.identity.onPage.includes(run.identity.version),
    JSON.stringify(run.identity));
  checks.check(`${run.profile}: renders above 1fps on this device profile`,
    run.fps > 1, `${run.fps}fps`);
  checks.check(`${run.profile}: no console errors`, run.errors.length === 0, JSON.stringify(run.errors));
}

checks.print();
console.log(`\nscreenshots: ${outDir}/mobile-*.png`);
console.log('profiles:', runs.map((r) => `${r.profile} ${r.fps}fps`).join(' · '));
process.exit(checks.failed ? 1 : 0);
