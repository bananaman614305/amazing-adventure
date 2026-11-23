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
  const measure = (mesh) => {
    const uv = mesh.geometry.getAttribute('uv');
    const pos = mesh.geometry.getAttribute('position');
    const idx = mesh.geometry.getIndex();
    if (!uv || !pos) return null;
    const triCount = idx ? idx.count / 3 : pos.count / 3;
    const tiles = [];
    let area = 0;
    for (let t = 0; t < triCount; t += 1) {
      const a = idx ? idx.getX(t * 3) : t * 3;
      const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      const p = [pos.getX(a), pos.getY(a), pos.getZ(a)];
      const q = [pos.getX(b), pos.getY(b), pos.getZ(b)];
      const r = [pos.getX(c), pos.getY(c), pos.getZ(c)];
      const e1 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
      const e2 = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
      const cx = e1[1] * e2[2] - e1[2] * e2[1];
      const cy = e1[2] * e2[0] - e1[0] * e2[2];
      const cz = e1[0] * e2[1] - e1[1] * e2[0];
      const nx = Math.abs(cx), ny = Math.abs(cy), nz = Math.abs(cz);
      area += Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
      const pair = nx >= ny && nx >= nz ? [2, 1] : (ny >= nz ? [0, 2] : [0, 1]);
      const planeArea = (a2, b2) => {
        const ux = q[a2] - p[a2], uy = q[b2] - p[b2];
        const vx = r[a2] - p[a2], vy = r[b2] - p[b2];
        return Math.abs(ux * vy - uy * vx) / 2;
      };
      const U = [uv.getX(a), uv.getX(b), uv.getX(c)];
      const V = [uv.getY(a), uv.getY(b), uv.getY(c)];
      const uvArea = Math.abs((U[1] - U[0]) * (V[2] - V[0]) -
        (U[2] - U[0]) * (V[1] - V[0])) / 2;
      if (!(uvArea > 0)) continue;
      tiles.push(Math.sqrt(planeArea(pair[0], pair[1]) / uvArea));
    }
    if (!tiles.length) return null;
    return {
      area: +area.toFixed(2), tris: tiles.length,
      min: +Math.min(...tiles).toFixed(3),
      mean: +(tiles.reduce((s, x) => s + x, 0) / tiles.length).toFixed(3),
      max: +Math.max(...tiles).toFixed(3)
    };
  };
  const rows = [];
  app.scene.traverse((o) => {
    if (!o.isMesh || !o.material || !o.material.name) return;
    if (!/cloth/i.test(o.material.name)) return;
    let npc = null;
    for (let n = o; n; n = n.parent) if (n.userData?.npcId) npc = n.userData.npcId;
    const m = measure(o);
    rows.push({ npc, mat: o.material.name, mesh: o.name, ...m, rough: o.material.roughness, metal: o.material.metalness });
  });
  return rows;
});
console.log(JSON.stringify(out, null, 1));
await close(); await server.stop();
