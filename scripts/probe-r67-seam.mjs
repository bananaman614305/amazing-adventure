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
    if (!o.isMesh || !o.geometry || !o.material) return;
    if (!/^SackCloth$/i.test(o.material.name || '')) return;
    const g = o.geometry;
    const uv = g.getAttribute('uv');
    const pos = g.getAttribute('position');
    const idx = g.getIndex();
    const triCount = idx ? idx.count / 3 : pos.count / 3;
    const pairOf = (t) => {
      const a = idx ? idx.getX(t*3) : t*3, b = idx ? idx.getX(t*3+1) : t*3+1, c = idx ? idx.getX(t*3+2) : t*3+2;
      const p = [pos.getX(a),pos.getY(a),pos.getZ(a)], q = [pos.getX(b),pos.getY(b),pos.getZ(b)], r = [pos.getX(c),pos.getY(c),pos.getZ(c)];
      const e1 = [q[0]-p[0],q[1]-p[1],q[2]-p[2]], e2 = [r[0]-p[0],r[1]-p[1],r[2]-p[2]];
      const n = [e1[1]*e2[2]-e1[2]*e2[1], e1[2]*e2[0]-e1[0]*e2[2], e1[0]*e2[1]-e1[1]*e2[0]];
      const an = n.map(Math.abs);
      return an[0] >= an[1] && an[0] >= an[2] ? 'zy' : (an[1] >= an[2] ? 'xz' : 'xy');
    };
    // For each vertex: which pairs does it appear in?
    const vpairs = new Map();
    for (let t = 0; t < triCount; t++) {
      const pr = pairOf(t);
      for (let k = 0; k < 3; k++) {
        const v = idx ? idx.getX(t*3+k) : t*3+k;
        if (!vpairs.has(v)) vpairs.set(v, new Set());
        vpairs.get(v).add(pr);
      }
    }
    let conflicts = 0;
    for (const s of vpairs.values()) if (s.size > 1) conflicts += 1;
    rows.push({ indexed: !!idx, verts: pos.count, tris: triCount, sharedConflictVerts: conflicts, uvCount: uv ? uv.count : 0 });
  });
  // and a cast coat for comparison
  app.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.material) return;
    if (!/^Cloth$/i.test(o.material.name || '')) return;
    if (rows.some((r) => r.cast)) return;
    const g = o.geometry;
    rows.push({ cast: o.name, indexed: !!g.getIndex(), verts: g.getAttribute('position').count });
  });
  return rows;
});
console.log(JSON.stringify(out, null, 1));
await close(); await server.stop();
