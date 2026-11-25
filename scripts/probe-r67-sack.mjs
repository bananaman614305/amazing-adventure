import { startServer, launchBrowser, waitForBoot } from './browser.mjs';
const server = await startServer();
const { browser, close } = await launchBrowser();
const page = await browser.newPage();
await page.goto(server.base, { waitUntil: 'load' });
await waitForBoot(page);
await page.evaluate(() => window.amazingAdventure.assetsReady());
const out = await page.evaluate(() => {
  const app = window.amazingAdventure;
  let found = null;
  app.scene.traverse((o) => {
    if (found || !o.isMesh || !o.material) return;
    if ((o.material.name || '') !== 'SackCloth') return;
    found = o;
  });
  if (!found) return { none: true };
  const uv = found.geometry.getAttribute('uv');
  const pos = found.geometry.getAttribute('position');
  const idx = found.geometry.getIndex();
  const tris = [];
  for (let t = 0; t < idx.count / 3; t += 1) {
    const a = idx.getX(t * 3), b = idx.getX(t * 3 + 1), c = idx.getX(t * 3 + 2);
    const p = [pos.getX(a), pos.getY(a), pos.getZ(a)];
    const q = [pos.getX(b), pos.getY(b), pos.getZ(b)];
    const r = [pos.getX(c), pos.getY(c), pos.getZ(c)];
    const e1 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const e2 = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const an = n.map(Math.abs);
    const U = [uv.getX(a), uv.getX(b), uv.getX(c)];
    const V = [uv.getY(a), uv.getY(b), uv.getY(c)];
    const uvArea = Math.abs((U[1] - U[0]) * (V[2] - V[0]) - (U[2] - U[0]) * (V[1] - V[0])) / 2;
    const area3 = Math.hypot(...n) / 2;
    tris.push({
      t, n: n.map((v) => +v.toFixed(3)), area3: +area3.toFixed(5), uvArea: +uvArea.toFixed(6),
      u: U.map((v) => +v.toFixed(3)), v: V.map((v) => +v.toFixed(3))
    });
  }
  return { geom: found.geometry.type, count: pos.count, tris: tris.slice(0, 14) };
});
console.log(JSON.stringify(out, null, 1));
await close(); await server.stop();
