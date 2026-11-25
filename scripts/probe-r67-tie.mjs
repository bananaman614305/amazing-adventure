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
  app.scene.traverse((o) => {
    if (!o.isMesh) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const name = m && m.name ? m.name : null;
    if (name !== 'SackTie' && name !== null) return;
    let vis = true;
    for (let n = o; n; n = n.parent) if (!n.visible) vis = false;
    rows.push({ name, geo: o.geometry.type, mesh: o.name || null, vis,
      color: m && m.color ? '#' + m.color.getHexString() : null,
      map: !!m?.map, uv: !!o.geometry.getAttribute('uv'),
      parent: o.parent?.name || null });
  });
  return rows;
});
await close(); await server.stop();
const ties = out.filter((r) => r.name === 'SackTie');
const nulls = out.filter((r) => r.name === null);
console.log('SackTie', ties.length, JSON.stringify(ties.map((r) => [r.geo, r.vis, r.color, r.map, r.uv, r.parent])));
console.log('nullMat', nulls.length, JSON.stringify(nulls.map((r) => [r.geo, r.mesh, r.vis, r.uv])));
