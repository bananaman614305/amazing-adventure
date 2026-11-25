import { PROP_FAMILIES } from '../src/assets.js';
import { startServer, launchBrowser, waitForBoot } from './browser.mjs';
const tiles = Object.fromEntries(PROP_FAMILIES.map((f) => [f.id, f.tileMeters]));
const server = await startServer();
const { browser, close } = await launchBrowser();
const page = await browser.newPage();
await page.goto(server.base, { waitUntil: 'load' });
await waitForBoot(page);
await page.evaluate(() => window.amazingAdventure.assetsReady());
const out = await page.evaluate(async (TILES) => {
  const app = window.amazingAdventure;
  await app.castReady;
  const audit = (mesh, tile) => {
    const uv = mesh.geometry.getAttribute('uv'); const pos = mesh.geometry.getAttribute('position'); const idx = mesh.geometry.getIndex();
    if (!uv || !pos) return { skip: true };
    const tc = idx ? idx.count / 3 : pos.count / 3;
    let bad = 0, worst = 0, maxTile = 0, minTile = Infinity;
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
      if (!(pa > 1e-9)) continue;
      const world = Math.sqrt(cx*cx+cy*cy+cz*cz)/2;
      const implied = (uvArea > 1e-12) ? Math.sqrt(pa/uvArea) : Infinity;
      if (Number.isFinite(implied)) { maxTile = Math.max(maxTile, implied); minTile = Math.min(minTile, implied); }
      const ratio = (uvArea * tile * tile) / world; // rigid when ~1
      if (!(ratio > 0)) { bad += 1; continue; }
      const err = Math.max(ratio, 1/ratio);
      if (err > 1.15) bad += 1;
      if (err > worst) worst = err;
    }
    return { tri: tc, indexed: !!idx, bad, worst: Number(worst.toFixed(2)),
      tileMin: Number.isFinite(minTile) ? Number(minTile.toFixed(2)) : null,
      tileMax: Number.isFinite(maxTile) ? Number(maxTile.toFixed(2)) : null };
  };
  const rows = [];
  app.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m) return;
    let fam = o.userData?.propFamily || null;
    let tile = fam ? TILES[fam] : (o.userData?.clothDressed ? TILES.cloth : null);
    if (!tile) return;
    rows.push({ fam, mat: m.name, mesh: o.name || null, ...audit(o, tile) });
  });
  return rows;
}, tiles);
const bad = out.filter((r) => r.bad > 0);
const byFam = {};
for (const r of out) { const b = byFam[r.fam] || { meshes: 0, badMeshes: 0, badTris: 0, tris: 0 }; b.meshes++; b.tris += r.tri; b.badTris += r.bad; if (r.bad) b.badMeshes++; byFam[r.fam] = b; }
console.log('families', JSON.stringify(byFam));
console.log('worst meshes:');
for (const r of bad.sort((a,b)=>b.worst-a.worst).slice(0,14)) console.log(JSON.stringify(r));
console.log('total meshes audited', out.length, 'with stretch', bad.length);
await close(); await server.stop();
