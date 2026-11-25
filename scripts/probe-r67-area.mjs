import { startServer, launchBrowser, waitForBoot } from './browser.mjs';
const server = await startServer();
const { browser, close } = await launchBrowser();
const page = await browser.newPage();
await page.goto(server.base, { waitUntil: 'load' });
await waitForBoot(page);
await page.evaluate(() => window.amazingAdventure.assetsReady());
const cast = await page.evaluate(() => window.amazingAdventure.castReady);
const rows = await page.evaluate(() => {
  const app = window.amazingAdventure;
  const out = [];
  const area = (o) => {
    const pos = o.geometry.getAttribute('position');
    const idx = o.geometry.getIndex();
    const n = idx ? idx.count / 3 : pos.count / 3;
    let a = 0;
    for (let t = 0; t < n; t++) {
      const i0 = idx ? idx.getX(t*3) : t*3, i1 = idx ? idx.getX(t*3+1) : t*3+1, i2 = idx ? idx.getX(t*3+2) : t*3+2;
      const p = [pos.getX(i0),pos.getY(i0),pos.getZ(i0)];
      const q = [pos.getX(i1),pos.getY(i1),pos.getZ(i1)];
      const r = [pos.getX(i2),pos.getY(i2),pos.getZ(i2)];
      const e1 = [q[0]-p[0],q[1]-p[1],q[2]-p[2]], e2 = [r[0]-p[0],r[1]-p[1],r[2]-p[2]];
      const c = [e1[1]*e2[2]-e1[2]*e2[1], e1[2]*e2[0]-e1[0]*e2[2], e1[0]*e2[1]-e1[1]*e2[0]];
      a += Math.hypot(c[0],c[1],c[2])/2;
    }
    return a;
  };
  app.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.material) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!/cloth/i.test(m.name || '')) return;
    let vis = true;
    for (let n = o; n; n = n.parent) if (!n.visible) vis = false;
    let npc = null;
    for (let n = o; n; n = n.parent) if (n.userData?.npcId) npc = n.userData.npcId;
    out.push({ mat: m.name, mesh: o.name, npc, vis, color: '#' + m.color.getHexString(),
      rough: m.roughness, metal: m.metalness, map: !!m.map, nrm: !!m.normalMap, rgh: !!m.roughnessMap,
      fam: o.userData?.propFamily || null, area: +area(o).toFixed(3),
      rep: m.map ? [m.map.repeat.x, m.map.repeat.y] : null, wrap: m.map ? m.map.wrapS : null });
  });
  return { state: app.assetState(), rows: out };
});
await close(); await server.stop();
const castRows = rows.rows.filter((r) => r.mat === 'Cloth');
const sackRows = rows.rows.filter((r) => r.mat === 'SackCloth');
const tieRows = rows.rows.filter((r) => r.mat === 'SackTie');
console.log('castReady.cloth', JSON.stringify({ dressed: cast.cloth?.dressed, anyLoaded: cast.cloth?.anyLoaded, n: cast.cloth?.meshes?.length }));
console.log('assetState.cloth', rows.state.cloth, JSON.stringify(rows.state.clothDetail));
console.log('Cloth meshes', castRows.length, 'area', castRows.reduce((s, r) => s + r.area, 0).toFixed(2));
console.log('SackCloth', sackRows.length, 'area', sackRows.reduce((s, r) => s + r.area, 0).toFixed(2));
console.log('SackTie', tieRows.length, JSON.stringify(tieRows.map((r) => [r.mesh, r.vis, r.map, r.color, r.rough])));
console.log('sack rows', JSON.stringify(sackRows, null, 1));
console.log('propWoodDetail', JSON.stringify(rows.state.propWoodDetail));
