import { startServer, launchBrowser, waitForBoot } from './browser.mjs';
const server = await startServer();
const { browser, close } = await launchBrowser();
const page = await browser.newPage();
await page.setViewport({ width: 800, height: 600 });
await page.goto(server.base, { waitUntil: 'load' });
await waitForBoot(page);
await page.evaluate(() => window.amazingAdventure.castReady).catch(() => {});
const out = await page.evaluate(() => {
  const { scene } = window.amazingAdventure;
  const rows = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!mat || !/cloth/i.test(mat.name || '')) return;
    let npc = '';
    for (let n = o; n; n = n.parent) if (n.name && /mara|oswin|pip|halden|sable|wren/i.test(n.name)) npc = n.name;
    rows.push({ npc, mesh: o.name, colour: mat.color ? mat.color.getHexString() : '', rough: mat.roughness, hasUv: Boolean(o.geometry.getAttribute('uv')), verts: o.geometry.getAttribute('position').count });
  });
  return rows;
});
console.log(JSON.stringify(out, null, 1));
await close(); await server.close?.();
