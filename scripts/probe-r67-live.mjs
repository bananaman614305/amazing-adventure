import { startServer, launchBrowser, waitForBoot } from './browser.mjs';
const server = await startServer();
const { browser, close } = await launchBrowser();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(server.base, { waitUntil: 'load' });
await waitForBoot(page);
await page.evaluate(() => window.amazingAdventure.assetsReady());
const cast = await page.evaluate(() => window.amazingAdventure.castReady);
const out = await page.evaluate(() => {
  const app = window.amazingAdventure;
  const rows = [];
  app.scene.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    if (!m || !m.name) return;
    if (!/cloth/i.test(m.name)) return;
    let visible = true;
    for (let n = o; n; n = n.parent) if (!n.visible) visible = false;
    const uv = o.geometry.getAttribute('uv');
    rows.push({
      name: m.name, mesh: o.name || null, visible,
      colour: m.color ? m.color.getHexString() : null,
      rough: m.roughness,
      hasMap: Boolean(m.map), hasNormal: Boolean(m.normalMap), hasRough: Boolean(m.roughnessMap),
      repeat: m.map ? [m.map.repeat.x, m.map.repeat.y] : null,
      wrap: m.map ? m.map.wrapS : null,
      uvs: uv ? uv.count : 0,
      verts: o.geometry.getAttribute('position').count,
      dressed: o.userData.clothDressed || null,
      propFamily: o.userData.propFamily || null
    });
  });
  return { state: app.assetState(), rows };
});
console.log(JSON.stringify({ cast, ...out, errors }, null, 1));
await close(); await server.stop();
