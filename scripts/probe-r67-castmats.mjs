import { startServer, launchBrowser, waitForBoot } from './browser.mjs';
const server = await startServer();
const { browser, close } = await launchBrowser();
const page = await browser.newPage();
await page.goto(server.base, { waitUntil: 'load' });
await waitForBoot(page);
await page.evaluate(() => window.amazingAdventure.assetsReady());
await page.evaluate(() => window.amazingAdventure.castReady);
const out = await page.evaluate(() => {
  const app = window.amazingAdventure;
  const rows = [];
  for (const npc of app.npcs) {
    npc.group.traverse((o) => {
      if (!o.isMesh) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      rows.push({ npc: npc.id, mesh: o.name, mat: m?.name || null,
        color: m?.color ? '#' + m.color.getHexString() : null,
        map: !!m?.map, nrm: !!m?.normalMap, rgh: !!m?.roughnessMap,
        uv: !!o.geometry.getAttribute('uv'), dressed: !!o.userData?.clothDressed });
    });
  }
  return rows;
});
await close(); await server.stop();
const by = new Map();
for (const r of out) {
  const k = r.mat;
  if (!by.has(k)) by.set(k, []);
  by.get(k).push(r);
}
for (const [k, list] of by) {
  const colors = [...new Set(list.map((r) => r.color))];
  console.log(String(k).padEnd(10), 'n=' + String(list.length).padEnd(3),
    'uv=' + list.filter((r) => r.uv).length, 'map=' + list.filter((r) => r.map).length,
    'dressed=' + list.filter((r) => r.dressed).length, 'colors=' + colors.join(','));
}
