import { startServer, launchBrowser, waitForBoot } from './browser.mjs';
const server = await startServer();
const { browser, close } = await launchBrowser();
const page = await browser.newPage();
await page.goto(server.base, { waitUntil: 'load' });
await waitForBoot(page);
await page.evaluate(() => window.amazingAdventure.assetsReady());
const out = await page.evaluate(() => {
  const app = window.amazingAdventure;
  const rows = [];
  app.scene.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    if ((o.material.name || '') !== 'SackCloth') return;
    o.updateWorldMatrix(true, false);
    const s = new (o.scale.constructor)();
    o.matrixWorld.decompose(new (o.position.constructor)(), new (o.quaternion.constructor)(), s);
    rows.push({
      mesh: o.name, parent: o.parent?.name, local: [o.scale.x, o.scale.y, o.scale.z],
      world: [s.x, s.y, s.z].map((v) => +v.toFixed(4)),
      path: (() => { const p = []; for (let n = o; n; n = n.parent) p.push(n.name || n.type); return p.join('<'); })()
    });
  });
  return rows;
});
console.log(JSON.stringify(out, null, 1));
await close(); await server.stop();
