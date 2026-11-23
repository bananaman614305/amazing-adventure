import { startServer, launchBrowser, waitForBoot } from './browser.mjs';
const server = await startServer();
const { browser, close } = await launchBrowser();
const page = await browser.newPage();
await page.goto(server.base, { waitUntil: 'load' });
await waitForBoot(page);
await page.evaluate(() => window.amazingAdventure.assetsReady());
const cast = await page.evaluate(() => window.amazingAdventure.castReady);
const out = await page.evaluate((TILE) => {
  const app = window.amazingAdventure;
  const rows = [];
  app.scene.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const name = o.material.name || '';
    if (!/cloth/i.test(name)) return;
    const uv = o.geometry.getAttribute('uv');
    const pos = o.geometry.getAttribute('position');
    if (!uv || !pos) { rows.push({ name, mesh: o.name, uv: false }); return; }
    let exact = 0, total = 0;
    const worst = [];
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const u = uv.getX(i), v = uv.getY(i);
      const opts = [
        [z / TILE, y / TILE], [x / TILE, z / TILE], [x / TILE, y / TILE]
      ];
      const d = Math.min(...opts.map(([ou, ov]) => Math.max(Math.abs(ou - u), Math.abs(ov - v))));
      if (d <= 1e-6) exact += 1; else worst.push(+d.toFixed(4));
      total += 1;
    }
    rows.push({
      name, mesh: o.name, verts: total, exact,
      colorSpace: o.material.map?.colorSpace, normalSpace: o.material.normalMap?.colorSpace,
      roughSpace: o.material.roughnessMap?.colorSpace,
      rough: o.material.roughness, metal: o.material.metalness,
      repeat: o.material.map ? [o.material.map.repeat.x, o.material.map.repeat.y] : null,
      wrap: [o.material.map?.wrapS, o.material.map?.wrapT],
      firstWorst: worst.slice(0, 3)
    });
  });
  // other cast materials
  const others = [];
  app.scene.traverse((o) => {
    if (!o.isMesh || !o.material || !o.material.name) return;
    let inCast = false;
    for (let n = o; n; n = n.parent) if (n.userData?.npcId) inCast = true;
    if (!inCast || /cloth/i.test(o.material.name)) return;
    others.push({ mat: o.material.name, mesh: o.name, hasMap: Boolean(o.material.map),
      rough: +o.material.roughness.toFixed(3) });
  });
  return { rows, others };
}, 1.2);
console.log(JSON.stringify({ cast, rows: out.rows.map((r) => [r.name, r.mesh, r.verts, r.exact, r.colorSpace, r.normalSpace, r.roughSpace, r.rough, r.repeat, r.wrap, r.firstWorst]), others: [...new Set(out.others.map((o) => o.mat + '|map:' + o.hasMap + '|' + o.rough))] }, null, 1));
await close(); await server.stop();
