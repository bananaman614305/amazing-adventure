import { startServer, launchBrowser, waitForBoot } from './browser.mjs';
const server = await startServer();
const { browser, close } = await launchBrowser();
const page = await browser.newPage();
await page.goto(server.base, { waitUntil: 'load' });
await waitForBoot(page);
await page.evaluate(() => window.amazingAdventure.assetsReady());
const out = await page.evaluate(async () => {
  const app = window.amazingAdventure;
  await app.castReady;
  const THREE = await import('/vendor/three.module.min.js').catch(() => null);
  // per-triangle check: does uvArea*tile^2 equal plane area?
  const audit = (mesh, tile) => {
    const uv = mesh.geometry.getAttribute('uv'); const pos = mesh.geometry.getAttribute('position'); const idx = mesh.geometry.getIndex();
    const tc = idx ? idx.count / 3 : pos.count / 3;
    let bad = 0, worst = 0, total = 0;
    for (let t = 0; t < tc; t++) {
      const a = idx?idx.getX(t*3):t*3, b=idx?idx.getX(t*3+1):t*3+1, c=idx?idx.getX(t*3+2):t*3+2;
      const p=[pos.getX(a),pos.getY(a),pos.getZ(a)], q=[pos.getX(b),pos.getY(b),pos.getZ(b)], r=[pos.getX(c),pos.getY(c),pos.getZ(c)];
      const e1=[q[0]-p[0],q[1]-p[1],q[2]-p[2]], e2=[r[0]-p[0],r[1]-p[1],r[2]-p[2]];
      const cx=e1[1]*e2[2]-e1[2]*e2[1], cy=e1[2]*e2[0]-e1[0]*e2[2], cz=e1[0]*e2[1]-e1[1]*e2[0];
      const nx=Math.abs(cx), ny=Math.abs(cy), nz=Math.abs(cz);
      const pair = nx>=ny&&nx>=nz?[2,1]:(ny>=nz?[0,2]:[0,1]);
      const planeArea=(a2,b2)=>{const ux=q[a2]-p[a2],uy=q[b2]-p[b2],vx=r[a2]-p[a2],vy=r[b2]-p[b2];return Math.abs(ux*vy-uy*vx)/2;};
      const U=[uv.getX(a),uv.getX(b),uv.getX(c)], V=[uv.getY(a),uv.getY(b),uv.getY(c)];
      const uvArea=Math.abs((U[1]-U[0])*(V[2]-V[0])-(U[2]-U[0])*(V[1]-V[0]))/2;
      const pa = planeArea(pair[0],pair[1]);
      const ratio = (uvArea * tile * tile) / pa; // 1 = rigid
      total++;
      const err = Math.max(ratio, 1/ratio);
      if (Math.abs(Math.log(ratio)) > Math.log(1.05)) bad++;
      if (err > worst) worst = err;
    }
    return { tri: tc, indexed: !!idx, verts: pos.count, bad, total, worst: Number(worst.toFixed(3)) };
  };
  const rows = [];
  app.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || !o.userData?.propFamily) return;
    let vis = true; for (let n = o; n; n = n.parent) if (!n.visible) vis = false;
    rows.push({ fam: o.userData.propFamily, mat: m.name, mesh: o.name || null, vis, tile: m.map ? 1 : 1, ...audit(o, o.userData.propFamily === 'cloth' ? 1.2 : 0) });
  });
  return rows.filter((r) => r.bad > 0 || r.vis).slice(0, 40);
});
console.log(out.map(r=>JSON.stringify(r)).join('\n'));
await close(); await server.stop();
