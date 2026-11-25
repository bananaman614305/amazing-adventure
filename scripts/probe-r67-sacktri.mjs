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
  let sack = null;
  app.scene.traverse((o) => { if (!sack && o.isMesh && o.material && o.material.name === 'SackCloth') sack = o; });
  if (!sack) return { err: 'no sack' };
  const uv = sack.geometry.getAttribute('uv'); const pos = sack.geometry.getAttribute('position'); const idx = sack.geometry.getIndex();
  const T = 1.2;
  // After the round-67 seam fix a seamed mesh is de-indexed, so every triangle
  // owns three fresh corners: index the position buffer directly in that case.
  const vert = (t, c) => (idx ? idx.getX(t * 3 + c) : t * 3 + c);
  const tc = (idx ? idx.count : pos.count) / 3;
  const rows = [];
  // also record which axis pair each triangle's normals imply, and uv spans
  for (let t = 0; t < tc; t++) {
    const a = vert(t, 0), b = vert(t, 1), c = vert(t, 2);
    const p=[pos.getX(a),pos.getY(a),pos.getZ(a)], q=[pos.getX(b),pos.getY(b),pos.getZ(b)], r=[pos.getX(c),pos.getY(c),pos.getZ(c)];
    const e1=[q[0]-p[0],q[1]-p[1],q[2]-p[2]], e2=[r[0]-p[0],r[1]-p[1],r[2]-p[2]];
    const cx=e1[1]*e2[2]-e1[2]*e2[1], cy=e1[2]*e2[0]-e1[0]*e2[2], cz=e1[0]*e2[1]-e1[1]*e2[0];
    const nx=Math.abs(cx), ny=Math.abs(cy), nz=Math.abs(cz);
    const pair = nx>=ny&&nx>=nz?[2,1]:(ny>=nz?[0,2]:[0,1]);
    const planeArea=(a2,b2)=>{const ux=q[a2]-p[a2],uy=q[b2]-p[b2],vx=r[a2]-p[a2],vy=r[b2]-p[b2];return Math.abs(ux*vy-uy*vx)/2;};
    const U=[uv.getX(a),uv.getX(b),uv.getX(c)], V=[uv.getY(a),uv.getY(b),uv.getY(c)];
    const uvArea=Math.abs((U[1]-U[0])*(V[2]-V[0])-(U[2]-U[0])*(V[1]-V[0]))/2;
    const worldArea = Math.sqrt(cx*cx+cy*cy+cz*cz)/2;
    const pa = planeArea(pair[0],pair[1]);
    rows.push({ t, verts:[a,b,c], pair, plane:Number(pa.toFixed(4)), world:Number(worldArea.toFixed(4)), uvArea:Number(uvArea.toFixed(5)), impliedTile: Number(Math.sqrt(pa/uvArea).toFixed(3)), rigid: Number(((uvArea*T*T)/pa).toFixed(3)), uvSamePair: null });
  }
  // how many triangles each vertex belongs to, and whether all agree on pair
  const owners = new Map();
  for (const row of rows) for (const v of row.verts) { const e = owners.get(v) || { pairs: new Set(), tris: [] }; e.pairs.add(row.pair.join(',')); e.tris.push(row.t); owners.set(v, e); }
  const shared = [...owners.entries()].filter(([, e]) => e.pairs.size > 1);
  return { verts: pos.count, tris: tc, indexed: !!idx, indexType: idx ? idx.array.constructor.name : null,
    sharedConflicts: shared.length,
    nonRigid: rows.filter((r) => Math.abs(Math.log(r.rigid)) > Math.log(1.02)).map((r) => [r.t, r.impliedTile, r.world, r.rigid]),
    rows: rows.slice(0, 8) };
});
console.log(JSON.stringify(out, null, 1));
await close(); await server.stop();
