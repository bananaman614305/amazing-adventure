// Round 2 browser smoke test: drives the real page in Chromium and proves the
// new user paths (routines, memory, inventory, branching quest, save/load) plus
// the Round 1 controls. Run: node scripts/smoke.mjs [baseUrl]
import { chromium } from '/home/lunchbox/gstack/node_modules/playwright-core/index.mjs';
import { mkdir } from 'node:fs/promises';

const base = process.argv[2] || 'http://localhost:8123';
const outDir = new URL('../artifacts/', import.meta.url).pathname;
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/home/lunchbox/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
});

const results = {};
const check = (name, ok, detail) => {
  results[name] = `${ok ? 'PASS' : 'FAIL'} ${detail}`;
};

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push(String(err)));

const stateOf = () => page.evaluate(() => JSON.parse(JSON.stringify(window.amazingAdventure.state)));

async function ensureLocked() {
  const enabled = await page.evaluate(() => window.amazingAdventure.player.enabled);
  if (!enabled) {
    await page.click('#play');
    await page.waitForTimeout(250);
  }
}

async function goToNPC(id) {
  await ensureLocked();
  await page.evaluate((npcId) => {
    const { player, npcs } = window.amazingAdventure;
    const npc = npcs.find((n) => n.id === npcId);
    player.position.set(npc.group.position.x, 0, npc.group.position.z + 1.6);
    player.yaw = Math.PI;
    player.velocity.set(0, 0, 0);
  }, id);
  await page.waitForTimeout(220);
}

async function talk(id) {
  await goToNPC(id);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(220);
}

async function closeTalk() {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(180);
}

await page.goto(base, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.removeItem('amazing-adventure-round2'));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.amazingAdventure !== undefined, { timeout: 15000 });
await page.waitForTimeout(600);

// 1. Scene renders and WebGL is live.
const renderInfo = await page.evaluate(() => {
  const { renderer, scene, camera } = window.amazingAdventure;
  return {
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    children: scene.children.length,
    cameraPos: [camera.position.x, camera.position.y, camera.position.z]
  };
});
check('scene', renderInfo.drawCalls > 20 && renderInfo.triangles > 1000,
  `${renderInfo.drawCalls} draw calls, ${renderInfo.triangles} triangles, ${renderInfo.children} scene roots`);
await page.screenshot({ path: `${outDir}round2-scene.png` });

const glVersion = await page.evaluate(() => {
  const canvas = document.querySelector('#game canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  return gl ? gl.getParameter(gl.VERSION) : 'no gl';
});
check('webgl', glVersion !== 'no gl', glVersion);

// 2. Round 1 controls still work: pointer lock, walk, strafe, look, collide.
await page.click('#play');
await page.waitForTimeout(350);
const lock = await page.evaluate(() => ({
  pointerLock: document.pointerLockElement === document.body,
  enabled: window.amazingAdventure.player.enabled,
  overlayHidden: document.getElementById('overlay').hidden
}));
check('pointerLock', lock.pointerLock && lock.enabled && lock.overlayHidden, JSON.stringify(lock));

const before = await page.evaluate(() => {
  const p = window.amazingAdventure.player.position;
  return [p.x, p.z];
});
await page.keyboard.down('KeyW');
await page.waitForTimeout(900);
await page.keyboard.up('KeyW');
await page.waitForTimeout(180);
const afterW = await page.evaluate(() => {
  const p = window.amazingAdventure.player.position;
  return [p.x, p.z];
});
const walked = Math.hypot(afterW[0] - before[0], afterW[1] - before[1]);
check('walkForward', walked > 1.5, `moved ${walked.toFixed(2)}m forward`);

await page.keyboard.down('KeyA');
await page.waitForTimeout(600);
await page.keyboard.up('KeyA');
await page.waitForTimeout(180);
const afterA = await page.evaluate(() => {
  const p = window.amazingAdventure.player.position;
  return [p.x, p.z];
});
const strafed = Math.hypot(afterA[0] - afterW[0], afterA[1] - afterW[1]);
check('strafe', strafed > 0.8, `strafed ${strafed.toFixed(2)}m`);

const yawBefore = await page.evaluate(() => window.amazingAdventure.player.yaw);
await page.mouse.move(900, 400);
await page.mouse.move(1100, 380);
await page.waitForTimeout(180);
const yawAfter = await page.evaluate(() => window.amazingAdventure.player.yaw);
check('mouseLook', Math.abs(yawAfter - yawBefore) > 0.05,
  `yaw ${yawBefore.toFixed(2)} -> ${yawAfter.toFixed(2)}`);

await page.evaluate(() => {
  const p = window.amazingAdventure.player;
  p.position.set(0, 0, -14.5);
  p.yaw = 0;
  p.velocity.set(0, 0, 0);
});
await page.keyboard.down('KeyW');
await page.waitForTimeout(1800);
await page.keyboard.up('KeyW');
await page.waitForTimeout(180);
const wall = await page.evaluate(() => {
  const p = window.amazingAdventure.player.position;
  return { x: p.x, z: p.z, y: window.amazingAdventure.camera.position.y };
});
check('wallCollision', wall.z > -16.5 && wall.z < -15.4, `stopped at z=${wall.z.toFixed(2)}`);
check('groundSolid', Math.abs(wall.y - 1.7) < 0.01, `eye height ${wall.y.toFixed(2)}m`);

// 3. Eight named NPCs with roles and routines that move them on the clock.
const npcInfo = await page.evaluate(() => window.amazingAdventure.npcs.map((n) => ({
  id: n.id,
  name: n.name,
  role: n.role,
  stops: n.routine.length
})));
check('npcCount', npcInfo.length >= 8, `${npcInfo.length} NPCs`);
check('npcIdentity', npcInfo.every((n) => n.name && n.role && n.stops >= 2),
  npcInfo.map((n) => `${n.id}:${n.role}`).join(', '));

await page.evaluate(() => { window.amazingAdventure.state.clockMinutes = 8 * 60 + 20; });
await page.waitForTimeout(1400);
const posMorning = await page.evaluate(() =>
  window.amazingAdventure.npcs.map((n) => [n.group.position.x, n.group.position.z]));
await page.evaluate(() => { window.amazingAdventure.state.clockMinutes = 13 * 60; });
await page.waitForTimeout(1600);
const posAfternoon = await page.evaluate(() =>
  window.amazingAdventure.npcs.map((n) => [n.group.position.x, n.group.position.z]));
const moved = posMorning.filter((p, i) =>
  Math.hypot(posAfternoon[i][0] - p[0], posAfternoon[i][1] - p[1]) > 0.5).length;
check('routineMovement', moved >= 6, `${moved}/${posMorning.length} NPCs moved between 8:20 AM and 1:00 PM`);
await page.evaluate(() => { window.amazingAdventure.state.clockMinutes = 8 * 60 + 20; });
await page.waitForTimeout(1300);

// 4. Dialogue names the NPC, and a second talk recalls the first.
await talk('mara');
const dialogueState = await page.evaluate(() => ({
  hidden: document.getElementById('dialogue').hidden,
  name: document.getElementById('dialogue-name').textContent,
  context: document.getElementById('dialogue-context').textContent,
  line: document.getElementById('dialogue-line').textContent
}));
check('dialogueOpen',
  !dialogueState.hidden && dialogueState.name === 'Mara the Keeper' && dialogueState.line.length > 10,
  `${dialogueState.name} — ${dialogueState.context}`);
await page.screenshot({ path: `${outDir}round2-dialogue.png` });

await page.keyboard.press('KeyE');
await page.waitForTimeout(160);
const firstMemory = await page.textContent('#dialogue-line');
await closeTalk();

await talk('mara');
await page.keyboard.press('KeyE');
await page.waitForTimeout(160);
const secondMemory = await page.textContent('#dialogue-line');
check('npcMemory', firstMemory !== secondMemory && secondMemory.includes('Last time'),
  `first "${firstMemory}" / second "${secondMemory}"`);
await closeTalk();

// 5. Pick up an item and see it in the inventory readout.
await ensureLocked();
await page.evaluate(() => {
  const { player, items } = window.amazingAdventure;
  const lantern = items.find((i) => i.id === 'brass-lantern');
  player.position.set(lantern.group.position.x, 0, lantern.group.position.z + 1.6);
  player.yaw = Math.PI;
  player.velocity.set(0, 0, 0);
});
await page.waitForTimeout(220);
const itemHint = await page.textContent('#hint');
check('itemHint', itemHint && itemHint.includes('pick up') && itemHint.includes('Brass Lantern'),
  `"${itemHint.trim()}"`);
await page.keyboard.press('KeyE');
await page.waitForTimeout(220);
const picked = await stateOf();
check('inventoryPickup',
  picked.inventory.includes('brass-lantern') && picked.pickedUp.includes('brass-lantern'),
  `inventory=${picked.inventory.join(',')}`);
const hudInventory = await page.textContent('#inventory');
check('inventoryHud', hudInventory.includes('Brass Lantern'), `"${hudInventory}"`);
await page.screenshot({ path: `${outDir}round2-inventory.png` });

// 6. Choices are only offered by Mara, not by any NPC while carrying the lantern.
await talk('pip');
await page.keyboard.press('1');
await page.waitForTimeout(180);
const guarded = await stateOf();
check('choiceGuard', guarded.quest.status === 'active' && guarded.inventory.includes('brass-lantern'),
  `quest=${guarded.quest.status}, inventory=${guarded.inventory.join(',')}`);
await closeTalk();

await talk('mara');
const choiceCount = await page.evaluate(() => document.querySelectorAll('#dialogue-choices button').length);
check('questChoices', choiceCount === 2, `${choiceCount} choices offered by Mara`);
await page.keyboard.press('1');
await page.waitForTimeout(250);
const outcome = await stateOf();
check('questBranch', outcome.quest.outcome === 'restored' && outcome.quest.status === 'complete',
  `outcome=${outcome.quest.outcome}, status=${outcome.quest.status}`);
check('branchReward', outcome.inventory.includes('fountain-token') && !outcome.inventory.includes('brass-lantern'),
  `inventory=${outcome.inventory.join(',')}`);
const questHud = await page.textContent('#quest');
check('questHud', questHud.includes('fountain restored'), `"${questHud}"`);
await page.keyboard.press('KeyE');
await page.keyboard.press('KeyE');
await page.waitForTimeout(180);
const outcomeLine = await page.textContent('#dialogue-line');
check('outcomeDialogue', outcomeLine.includes('fountain burns bright'), `"${outcomeLine}"`);
await page.screenshot({ path: `${outDir}round2-quest-outcome.png` });
await closeTalk();

// 7. A reload restores quest, inventory, memories and the world visual.
const snapshot = await stateOf();
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.amazingAdventure !== undefined, { timeout: 15000 });
await page.waitForTimeout(500);
const loaded = await stateOf();
const same = (field) => JSON.stringify(snapshot[field]) === JSON.stringify(loaded[field]);
check('saveLoadQuest', same('quest'), `quest=${JSON.stringify(loaded.quest)}`);
check('saveLoadInventory', same('inventory') && same('pickedUp'),
  `inventory=${loaded.inventory.join(',')}, pickedUp=${loaded.pickedUp.join(',')}`);
check('saveLoadMemory',
  JSON.stringify(snapshot.memories.mara?.topics) === JSON.stringify(loaded.memories.mara?.topics),
  `mara topics=${JSON.stringify(loaded.memories.mara?.topics)}`);
check('saveLoadFacts', same('facts'), `facts=${JSON.stringify(loaded.facts)}`);

const persisted = await page.evaluate(() => {
  const { items, scene } = window.amazingAdventure;
  return {
    lanternVisible: items.find((i) => i.id === 'brass-lantern').group.visible,
    waterColor: scene.getObjectByName('fountain-water').material.color.getHex(),
    quest: document.getElementById('quest').textContent,
    inventory: document.getElementById('inventory').textContent,
    memory: document.getElementById('memory').textContent
  };
});
check('persistedItem', persisted.lanternVisible === false, `lantern visible=${persisted.lanternVisible}`);
check('persistedVisual', persisted.waterColor === 0x69d8c7, `water=0x${persisted.waterColor.toString(16)}`);
check('persistedHud',
  persisted.quest.includes('fountain restored') && persisted.inventory.includes('Fountain Token'),
  `${persisted.quest} | ${persisted.inventory}`);
check('memoryCount', /[1-8]\/8 people know you/.test(persisted.memory), `"${persisted.memory}"`);

await talk('mara');
await page.keyboard.press('KeyE');
await page.waitForTimeout(160);
const persistedMemoryLine = await page.textContent('#dialogue-line');
check('persistedDialogueMemory', persistedMemoryLine.includes('you restored the fountain'),
  `"${persistedMemoryLine}"`);
await closeTalk();

// 8. The other branch records a different outcome, reward and world visual.
const other = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const otherErrors = [];
other.on('pageerror', (err) => otherErrors.push(String(err)));
await other.goto(base, { waitUntil: 'networkidle' });
await other.waitForFunction(() => window.amazingAdventure !== undefined, { timeout: 15000 });
await other.evaluate(() => {
  const a = window.amazingAdventure;
  a.state.quest.status = 'active';
  a.state.quest.stage = 'carrying';
  a.state.inventory = ['brass-lantern'];
  a.state.pickedUp.push('brass-lantern');
  a.openConversation(a.npcs.find((n) => n.id === 'mara'));
  a.choose('sell');
});
await other.waitForTimeout(200);
const sold = await other.evaluate(() => ({
  outcome: window.amazingAdventure.state.quest.outcome,
  inventory: window.amazingAdventure.state.inventory,
  quest: document.getElementById('quest').textContent,
  water: window.amazingAdventure.scene.getObjectByName('fountain-water').material.color.getHex()
}));
check('otherBranch',
  sold.outcome === 'sold' && sold.inventory.includes('coin-pouch') &&
  sold.quest.includes('lantern sold') && sold.water === 0x2d5670,
  JSON.stringify(sold));
await other.close();

check('consoleErrors', errors.length === 0 && otherErrors.length === 0,
  JSON.stringify([...errors, ...otherErrors]));

await browser.close();

let failed = false;
for (const [name, value] of Object.entries(results)) {
  if (String(value).startsWith('FAIL')) failed = true;
  console.log(`${name}: ${value}`);
}
console.log(`\nscreenshots: ${outDir}round2-scene.png, ${outDir}round2-dialogue.png, ` +
  `${outDir}round2-inventory.png, ${outDir}round2-quest-outcome.png`);
process.exit(failed ? 1 : 0);
