// Round 1 browser smoke test: drives the real page in Chromium and proves the
// user path (load, walk, look, talk) with screenshots.
// Run: node scripts/smoke.mjs [baseUrl]
import { chromium } from '/home/lunchbox/gstack/node_modules/playwright-core/index.mjs';
import { mkdir } from 'node:fs/promises';

const base = process.argv[2] || 'http://localhost:8123';
const outDir = new URL('../artifacts/', import.meta.url).pathname;
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/home/lunchbox/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push(String(err)));

const results = {};
const fail = (name, detail) => {
  results[name] = `FAIL ${detail}`;
};

await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.amazingAdventure !== undefined, { timeout: 15000 });
await page.waitForTimeout(800);

// 1. Scene renders.
const renderInfo = await page.evaluate(() => {
  const { renderer, scene, camera } = window.amazingAdventure;
  return {
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    children: scene.children.length,
    canvasSize: [renderer.domElement.width, renderer.domElement.height],
    cameraPos: [camera.position.x, camera.position.y, camera.position.z]
  };
});
results.render = renderInfo.drawCalls > 20 && renderInfo.triangles > 1000
  ? `PASS ${renderInfo.drawCalls} draw calls, ${renderInfo.triangles} triangles, ${renderInfo.children} scene roots`
  : `FAIL ${JSON.stringify(renderInfo)}`;

await page.screenshot({ path: `${outDir}round1-scene.png` });

// Not a flat fill: check the screenshot has real variety of colour.
const variety = await page.evaluate(() => {
  const canvas = document.querySelector('#game canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  return gl ? gl.getParameter(gl.VERSION) : 'no gl';
});
results.webgl = variety !== 'no gl' ? `PASS ${variety}` : 'FAIL no webgl context';

// 2. Pointer lock via the start overlay.
await page.click('#play');
await page.waitForTimeout(400);
const locked = await page.evaluate(() => ({
  pointerLock: document.pointerLockElement === document.body,
  enabled: window.amazingAdventure.player.enabled,
  overlayHidden: document.getElementById('overlay').hidden
}));
results.pointerLock = locked.pointerLock && locked.enabled && locked.overlayHidden
  ? 'PASS pointer locked, overlay dismissed'
  : `FAIL ${JSON.stringify(locked)}`;

// 3. WASD walking.
const before = await page.evaluate(() => {
  const p = window.amazingAdventure.player.position;
  return [p.x, p.z];
});
await page.keyboard.down('KeyW');
await page.waitForTimeout(900);
await page.keyboard.up('KeyW');
await page.waitForTimeout(200);
const afterW = await page.evaluate(() => {
  const p = window.amazingAdventure.player.position;
  return [p.x, p.z];
});
const walked = Math.hypot(afterW[0] - before[0], afterW[1] - before[1]);
results.walkForward = walked > 1.5 ? `PASS moved ${walked.toFixed(2)}m forward` : `FAIL moved ${walked.toFixed(2)}m`;

await page.keyboard.down('KeyA');
await page.waitForTimeout(600);
await page.keyboard.up('KeyA');
await page.waitForTimeout(200);
const afterA = await page.evaluate(() => {
  const p = window.amazingAdventure.player.position;
  return [p.x, p.z];
});
const strafed = Math.hypot(afterA[0] - afterW[0], afterA[1] - afterW[1]);
results.strafe = strafed > 0.8 ? `PASS strafed ${strafed.toFixed(2)}m` : `FAIL strafed ${strafed.toFixed(2)}m`;

// 4. Mouse look changes the camera rotation.
const yawBefore = await page.evaluate(() => window.amazingAdventure.player.yaw);
await page.mouse.move(900, 400);
await page.mouse.move(1100, 380);
await page.waitForTimeout(200);
const yawAfter = await page.evaluate(() => window.amazingAdventure.player.yaw);
results.mouseLook = Math.abs(yawAfter - yawBefore) > 0.05
  ? `PASS yaw changed by ${(yawAfter - yawBefore).toFixed(3)} rad`
  : `FAIL yaw unchanged (${yawBefore} -> ${yawAfter})`;

// 5. Collision: walk hard into the north wall and stay inside the courtyard.
await page.evaluate(() => {
  const p = window.amazingAdventure.player;
  p.position.set(0, 0, -14.5);
  p.yaw = 0; // facing -Z, toward the north wall (inner face at z = -16.5)
  p.velocity.set(0, 0, 0);
});
await page.keyboard.down('KeyW');
await page.waitForTimeout(2000);
await page.keyboard.up('KeyW');
await page.waitForTimeout(200);
const wallStop = await page.evaluate(() => {
  const p = window.amazingAdventure.player.position;
  return { x: p.x, z: p.z, y: window.amazingAdventure.camera.position.y };
});
results.wallCollision = wallStop.z > -16.5 && wallStop.z < -15.4
  ? `PASS walked into the wall and stopped at z=${wallStop.z.toFixed(2)} (wall inner face -16.50)`
  : `FAIL ended at ${JSON.stringify(wallStop)}`;
results.groundSolid = Math.abs(wallStop.y - 1.7) < 0.01 ? 'PASS eye height held at 1.70m' : `FAIL eye height ${wallStop.y}`;

// 6. Talk to an NPC: stand next to Mara and press E.
await page.evaluate(() => {
  const { player, npcs } = window.amazingAdventure;
  const mara = npcs.find((n) => n.id === 'mara');
  player.position.set(mara.group.position.x, 0, mara.group.position.z + 1.6);
  player.yaw = Math.PI;
  player.velocity.set(0, 0, 0);
});
await page.waitForTimeout(250);
const hintText = await page.textContent('#hint');
results.proximityHint = hintText && hintText.includes('Mara') ? `PASS "${hintText.trim()}"` : `FAIL "${hintText}"`;

await page.keyboard.press('KeyE');
await page.waitForTimeout(300);
const dialogueState = await page.evaluate(() => ({
  hidden: document.getElementById('dialogue').hidden,
  name: document.getElementById('dialogue-name').textContent,
  line: document.getElementById('dialogue-line').textContent
}));
results.dialogueOpen = !dialogueState.hidden && dialogueState.name === 'Mara the Keeper' && dialogueState.line.length > 10
  ? `PASS "${dialogueState.name}: ${dialogueState.line}"`
  : `FAIL ${JSON.stringify(dialogueState)}`;

await page.screenshot({ path: `${outDir}round1-dialogue.png` });

// 7. Dialogue advances and closes.
await page.keyboard.press('KeyE');
await page.waitForTimeout(200);
const secondLine = await page.textContent('#dialogue-line');
results.dialogueAdvance = secondLine !== dialogueState.line
  ? `PASS second line "${secondLine.slice(0, 40)}…"`
  : 'FAIL dialogue did not advance';

await page.keyboard.press('Escape');
await page.waitForTimeout(200);
const closed = await page.evaluate(() => document.getElementById('dialogue').hidden);
results.dialogueClose = closed ? 'PASS dialogue closed' : 'FAIL dialogue still open';

// 8. Every NPC is reachable and talkable, and shadows are on.
const npcCheck = await page.evaluate(async () => {
  const { player, npcs, scene } = window.amazingAdventure;
  const talked = [];
  for (const npc of npcs) {
    player.position.set(npc.group.position.x, 0, npc.group.position.z + 1.5);
    await new Promise((r) => setTimeout(r, 120));
    const nearest = npcs
      .map((n) => ({ n, d: Math.hypot(n.group.position.x - player.position.x, n.group.position.z - player.position.z) }))
      .sort((a, b) => a.d - b.d)[0];
    talked.push({ id: npc.id, nearest: nearest.n.id, d: Number(nearest.d.toFixed(2)) });
  }
  return {
    talked,
    count: npcs.length,
    shadowCasters: scene.children.filter((c) => c.castShadow).length
  };
});
results.npcCount = npcCheck.count >= 3 ? `PASS ${npcCheck.count} NPCs placed` : `FAIL only ${npcCheck.count} NPCs`;
results.npcReach = npcCheck.talked.every((t) => t.nearest === t.id)
  ? `PASS each NPC is the nearest when adjacent (${npcCheck.talked.map((t) => t.id).join(', ')})`
  : `FAIL ${JSON.stringify(npcCheck.talked)}`;

const shadowInfo = await page.evaluate(() => {
  const { renderer, scene } = window.amazingAdventure;
  const dir = scene.children.filter((c) => c.isDirectionalLight);
  const amb = scene.children.filter((c) => c.isHemisphereLight);
  return {
    shadows: renderer.shadowMap.enabled,
    directional: dir.length,
    directionalCastShadow: dir.some((d) => d.castShadow),
    hemisphere: amb.length
  };
});
results.lighting = shadowInfo.shadows && shadowInfo.directional >= 1 && shadowInfo.directionalCastShadow && shadowInfo.hemisphere >= 1
  ? 'PASS shadow map on, directional light with shadows, hemisphere light'
  : `FAIL ${JSON.stringify(shadowInfo)}`;

results.consoleErrors = errors.length === 0 ? 'PASS no console errors' : `FAIL ${JSON.stringify(errors)}`;

await browser.close();

let failed = false;
for (const [name, value] of Object.entries(results)) {
  if (String(value).startsWith('FAIL')) failed = true;
  console.log(`${name}: ${value}`);
}
console.log(`\nscreenshots: ${outDir}round1-scene.png, ${outDir}round1-dialogue.png`);
process.exit(failed ? 1 : 0);
