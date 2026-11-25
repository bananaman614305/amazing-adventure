import { startServer, launchBrowser, waitForBoot } from './browser.mjs';
const server = await startServer();
const { browser, close } = await launchBrowser();
const page = await browser.newPage();
await page.goto(server.base, { waitUntil: 'load' });
await waitForBoot(page);
await page.evaluate(() => window.amazingAdventure.assetsReady());
const out = await page.evaluate(async () => {
  const app = window.amazingAdventure;
  await app.castReady;
  const keys = new Map();
  let total = 0;
  app.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    total++;
    const sig = Object.keys(o.geometry.attributes).sort().join(',');
    const idx = o.geometry.getIndex();
    const k = sig + '|' + (idx ? 'indexed' : 'nonindexed');
    keys.set(k, (keys.get(k) || 0) + 1);
  });
  return { total, keys: [...keys.entries()] };
});
console.log(JSON.stringify(out, null, 1));
await close(); await server.stop();
