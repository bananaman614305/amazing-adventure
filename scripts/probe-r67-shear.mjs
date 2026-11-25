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
  // Count triangles whose stored UVs disagree with what a per-triangle box
  // projection would have written. Agreement = no shared-vertex overwrite.
  const audit = (mesh, tile) => {
    const uv = mesh.geometry.getAttribute('uv'); const pos = mesh.geometry.getAttribute('position'); const idx = mesh.geometry.getIndex();
    if (!uv || !pos) return { skip: true };
    const tc = idx ? idx.count / 3 : pos.count / 3;
    let sheared = 0;
    for (let t = 0; t < tc; t++) {
      const a = idx?idx.getX(t*3):t*3, b=idx?idx.getX(t*3+1):t*3+1, c=idx?idx.getX(t*3+2):t*3+2;
      const V = [a, b, c];
      const e1=[pos.getX(b)-pos.getX(a),pos.getY(b)-pos.getY(a),pos.getZ(b)-pos.getZ(a)];
      const e2=[pos.getX(c)-pos.getX(a),pos.getY(c)-pos.getY(a),pos.getZ(c)-pos.getZ(a)];
      const nx=Math.abs(e1[1]*e2[2]-e1[2]*e2[1]), ny=Math.abs(e1[2]*e2[0]-e1[0]*e2[2]), nz=Math.abs(e1[0]*e2[1]-e1[1]*e2[0]);
      const axis = nx>=ny&&nx>=nz ? 'x' : (ny>=nz ? 'y' : 'z');
      for (const i of V) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const eu = axis==='x' ? z/tile : x/tile;
        const ev = axis==='y' ? z/tile : y/tile;
        if (Math.abs(uv.getX(i)-eu) > 1e-4 || Math.abs(uv.getY(i)-ev) > 1e-4) { sheared += 1; break; }
      }
    }
    return { tri: tc, indexed: !!idx, sheared };
  };
  const rows = [];
  app.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    let fam = o.userData?.propFamily || null;
    let tile = fam ? TILES[fam] : (o.userData?.clothDressed ? TILES.cloth : null);
    if (!tile) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    rows.push({ fam, mat: m ? m.name : null, mesh: o.name || null, ...audit(o, tile) });
  });
  return rows;
}, tiles);
const byFam = {};
for (const r of out) { const b = byFam[r.fam] || { meshes: 0, shearMeshes: 0, shearTris: 0, tris: 0 }; b.meshes++; b.tris += r.tri||0; if (r.sheared) { b.shearMeshes++; b.shearTris += r.sheared; } byFam[r.fam] = b; }
console.log('byFamily', JSON.stringify(byFam));
console.log('worst:');
for (const r of out.filter(r=>r.sheared).sort((a,b)=>b.sheared-a.sheared).slice(0,12)) console.log(JSON.stringify(r));
console.log('meshes', out.length, 'sheared meshes', out.filter(r=>r.sheared).length);
await close(); await server.stop();
