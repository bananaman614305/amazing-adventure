import { startServer, launchBrowser, waitForBoot } from './browser.mjs';
const server = await startServer();
const { browser, close } = await launchBrowser();
const page = await browser.newPage();
await page.goto(server.base, { waitUntil: 'load' });
await waitForBoot(page);
await page.evaluate(() => window.amazingAdventure.assetsReady());
const out = await page.evaluate(async () => {
  const app = window.amazingAdventure;
  const cast = await app.castReady;
  const st = app.assetState();
  const rows = [];
  app.scene.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || !/cloth/i.test(m.name || '')) return;
    let vis = true;
    for (let n = o; n; n = n.parent) if (!n.visible) vis = false;
    let uva = o.geometry.getAttribute('uv');
    rows.push({ material: m.name, mesh: o.name || null, visible: vis, dressedBy: o.userData?.propFamily || (o.userData?.clothDressed ? 'castCloth' : null), color: '#'+m.color.getHexString(), rough: m.roughness, map: !!m.map, nrm: !!m.normalMap, rgh: !!m.roughnessMap, repeat: m.map ? [m.map.repeat.x, m.map.repeat.y] : null, wrap: m.map ? m.map.wrapS : null, uv: !!uva });
  });
  return { propWood: st.propWood, byFamily: st.propWoodDetail?.byFamily, cloth: st.cloth, clothDetail: st.clothDetail, castCloth: cast.cloth, rows };
});
console.log(JSON.stringify(out, null, 1).slice(0, 4000));
await close(); await server.stop();
