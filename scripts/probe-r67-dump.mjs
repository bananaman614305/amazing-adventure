import { startServer, launchBrowser, waitForBoot } from './browser.mjs';
import { writeFileSync } from 'node:fs';
const server = await startServer();
const { browser, close } = await launchBrowser();
const page = await browser.newPage();
await page.goto(server.base, { waitUntil: 'load' });
await waitForBoot(page);
await page.evaluate(() => window.amazingAdventure.assetsReady());
const out = await page.evaluate(async () => {
  const app = window.amazingAdventure;
  await app.castReady;
  const res = [];
  app.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const fam = o.userData?.propFamily || null;
    const name = m ? m.name : null;
    if (!(fam === 'cloth' || fam === 'wood' || (o.userData?.clothDressed))) return;
    const g = o.geometry, pos = g.getAttribute('position'), idx = g.getIndex();
    if (!pos) return;
    res.push({ fam, mat: name, mesh: o.name || null, geometryType: g.type,
      positions: Array.from(pos.array),
      indices: idx ? Array.from(idx.array) : null });
  });
  return res;
});
writeFileSync('/tmp/r67-geom.json', JSON.stringify(out));
console.log('dumped', out.length, 'meshes');
await close(); await server.stop();
