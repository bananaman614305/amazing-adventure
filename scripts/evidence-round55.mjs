// Round 55 evidence capture: the two things the round claims, photographed.
//
// The main suite already asserts these; this script exists so a reviewer can
// look at the frames without reading a PASS line. It writes PNGs into
// artifacts/ on purpose, so it is the one script that dirties the tree.
//
// Run: node scripts/evidence-round55.mjs
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startServer, launchBrowser } from './browser.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'artifacts');

// Stand in the lane a little short of the post (13.4, -24.8) and face it, so
// the arm and lantern read against the wall rather than the sky. yaw follows
// the game's third-person convention: 0 looks down -z.
const LANE_VIEW = { x: 10.6, z: -21.6, yaw: Math.PI };

async function shoot(page, api, file) {
  const png = await page.screenshot();
  await writeFile(join(OUT, file), png);
  console.log(`wrote artifacts/${file} (${png.length} bytes)`);
}

const server = await startServer();
const { browser } = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await page.goto(server.base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.amazingAdventure !== undefined, { timeout: 20000 });
  const api = await page.evaluateHandle(() => window.amazingAdventure);
  await page.evaluate(() => window.amazingAdventure.assetsReady());
  // Let the first frames run: the world is built synchronously but the camera
  // follows the player on the next tick.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  const aim = await page.evaluate(() => {
    const a = window.amazingAdventure.environment.laneLampAim;
    return a ? { rotationY: a.rotationY, lanternX: a.lanternX, lanternZ: a.lanternZ } : null;
  });
  console.log('lane lamp aim', JSON.stringify(aim));
  if (!aim) throw new Error('the lane lamp aim was not reported: the post is not modelled');

  // Dusk with the round walked: the state the fixture exists to show.
  await page.evaluate(() => {
    const a = window.amazingAdventure;
    a.setClock(80);
    a.getState().flags.laneLanternsLit = true;
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate((view) => {
    const a = window.amazingAdventure;
    a.player.position.set(view.x, 0, view.z);
    a.player.yaw = view.yaw;
  }, LANE_VIEW);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await shoot(page, null, 'round55-lane-lamp-lit.png');

  // Same frame in daylight, so the head's dark state is visible evidence and not
  // only an assertion about emissiveIntensity.
  await page.evaluate(() => {
    const a = window.amazingAdventure;
    a.getState().flags.laneLanternsLit = false;
    a.setClock(30);
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await shoot(page, null, 'round55-lane-lamp-day.png');

  // The plaza posts, from the spot the regression darkened them.
  await page.evaluate(() => {
    const a = window.amazingAdventure;
    a.setClock(80);
    a.player.position.set(0, 0, 6);
    a.player.yaw = Math.PI;
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await shoot(page, null, 'round55-plaza-lamps-intact.png');
} finally {
  await browser.close();
  await server.stop();
}
