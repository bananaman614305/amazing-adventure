import { startServer, launchBrowser, waitForBoot } from './browser.mjs';
const server = await startServer();
const { browser, close } = await launchBrowser();
const page = await browser.newPage();
await page.goto(server.base, { waitUntil: 'load' });
await waitForBoot(page);
await page.evaluate(() => window.amazingAdventure.assetsReady());
const out = await page.evaluate(() => {
  const app = window.amazingAdventure;
  const res = [];
  app.scene.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    if ((o.material.name || '') !== 'SackCloth') return;
    const uv = o.geometry.getAttribute('uv');
    const pos = o.geometry.getAttribute('position');
    const idx = o.geometry.getIndex();
    const tiles = [];
    let area = 0;
    const tris = idx ? idx.count / 3 : pos.count / 3;
    for (let t = 0; t < tris; t += 1) {
      const a = idx ? idx.getX(t * 3) : t * 3;
      const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      const p = [pos.getX(a), pos.getY(a), pos.getZ(a)];
      const q = [pos.getX(b), pos.getY(b), pos.getZ(b)];
      const r = [pos.getX(c), pos.getY(c), pos.getZ(c)];
      const e1 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
      const e2 = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const an = n.map(Math.abs);
      const a3 = Math.hypot(n[0], n[1], n[2]) / 2;
      area += a3;
      const pair = an[0] >= an[1] && an[0] >= an[2] ? [2, 1] : (an[1] >= an[2] ? [0, 2] : [0, 1]);
      const ux = q[pair[0]] - p[pair[0]], uy = q[pair[1]] - p[pair[1]];
      const vx = r[pair[0]] - p[pair[0]], vy = r[pair[1]] - p[pair[1]];
      const plane = Math.abs(ux * vy - uy * vx) / 2;
      const U = [uv.getX(a), uv.getX(b), uv.getX(c)];
      const V = [uv.getY(a), uv.getY(b), uv.getY(c)];
      const uvA = Math.abs((U[1] - U[0]) * (V[2] - V[0]) - (U[2] - U[0]) * (V[1] - V[0])) / 2;
      if (!(uvA > 1e-12) || !(plane > 1e-9)) { tiles.push(null); continue; }
      tiles.push(Math.sqrt(plane / uvA));
    }
    const good = tiles.filter((x) => x !== null).sort((x, y) => x - y);
    const med = good[Math.floor(good.length / 2)];
    res.push({
      mesh: o.name, tris: tiles.length, degenerate: tiles.filter((x) => x === null).length,
      area: +area.toFixed(3),
      median: +med.toFixed(3),
      within5: +(good.filter((x) => Math.abs(x - 1.2) / 1.2 <= 0.05).length / good.length).toFixed(3),
      p10: +good[Math.floor(good.length * 0.1)].toFixed(3),
      p90: +good[Math.floor(good.length * 0.9)].toFixed(3),
      min: +good[0].toFixed(3), max: +good[good.length - 1].toFixed(3)
    });
  });
  return res;
});
console.log(JSON.stringify(out, null, 1));
await close(); await server.stop();
