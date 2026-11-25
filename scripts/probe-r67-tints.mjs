import { startServer, launchBrowser, waitForBoot } from './browser.mjs';
const server = await startServer();
const { browser, close } = await launchBrowser();
const page = await browser.newPage();
await page.goto(server.base, { waitUntil: 'load' });
await waitForBoot(page);
await page.evaluate(() => window.amazingAdventure.assetsReady());
const out = await page.evaluate(async () => {
  const app = window.amazingAdventure;
  const cast = await app.castReady;
  const al = await new Promise((res) => { const i = new Image(); i.onload = () => res({ w: i.width, h: i.height }); i.src = 'assets/textures/cloth_albedo.webp'; });
  const rows = [];
  app.scene.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const m = o.material;
    if (!/cloth/i.test(m.name || '')) return;
    rows.push({ mat: m.name, mesh: o.name || null, tint: '#' + m.color.getHexString(), rough: m.roughness, clothDressed: !!o.userData.clothDressed, parent: o.parent?.name || null });
  });
  const by = {};
  for (const r of rows) { by[r.mat] = by[r.mat] || { n: 0, tints: {} }; by[r.mat].n += 1; by[r.mat].tints[r.tint] = (by[r.mat].tints[r.tint] || 0) + 1; }
  return { img: al, cloth: cast.cloth, total: rows.length, by, rows };
});
console.log(JSON.stringify({ img: out.img, cloth: { dressed: out.cloth?.dressed, anyLoaded: out.cloth?.anyLoaded }, total: out.total, by: out.by, sample: out.rows.slice(0, 6) }, null, 1));
await close(); await server.stop();
