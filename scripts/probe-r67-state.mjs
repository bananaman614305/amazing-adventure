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
  const st = app.assetState();
  const sacks = [];
  app.scene.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    if ((o.material.name || '') !== 'SackCloth') return;
    sacks.push({
      mesh: o.name, color: '#' + o.material.color.getHexString(),
      dressedBy: o.userData?.propFamily || null,
      hasMap: Boolean(o.material.map), rough: o.material.roughness,
      repeat: o.material.map ? [o.material.map.repeat.x, o.material.map.repeat.y] : null,
      wrap: o.material.map?.wrapS,
      spaces: [o.material.map?.colorSpace, o.material.normalMap?.colorSpace, o.material.roughnessMap?.colorSpace]
    });
  });
  return { cloth: st.cloth, clothDetail: st.clothDetail, propWood: st.propWood, propDetail: st.propWoodDetail, sacks };
});
console.log(JSON.stringify(out, null, 1));
await close(); await server.stop();
