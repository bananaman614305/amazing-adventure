import { startServer, launchBrowser, waitForBoot } from './browser.mjs';
const server = await startServer();
const { browser, close } = await launchBrowser();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(server.base, { waitUntil: 'load' });
await waitForBoot(page);
const cast = await page.evaluate(() => window.amazingAdventure.castReady);
const out = await page.evaluate(() => {
  const { scene, npcs } = window.amazingAdventure;
  const rows = [];
  for (const npc of npcs) {
    const mats = {};
    npc.group.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      if (!m) return;
      const k = m.name || '(unnamed)';
      mats[k] = mats[k] || { colour: m.color ? m.color.getHexString() : '', rough: m.roughness, meshes: 0, uuid: m.uuid.slice(0, 8), hasMap: Boolean(m.map) };
      mats[k].meshes += 1;
    });
    rows.push({ id: npc.id, mode: npc.mode, mats });
  }
  return { rows, groupNames: npcs.map(n => n.group.name) };
});
console.log(JSON.stringify({ cast, ...out, errors }, null, 1));
await close(); await server.close?.();
