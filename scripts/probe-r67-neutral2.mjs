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
  const read = async (url) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let r = 0, gg = 0, b = 0, n = 0, min = 255, max = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i+1]; b += d[i+2]; n += 1; const l = d[i+1]; if (l < min) min = l; if (l > max) max = l; }
    return { w: img.width, h: img.height, mean: [Math.round(r/n), Math.round(gg/n), Math.round(b/n)], range: [min, max] };
  };
  const albedo = await read('assets/textures/cloth_albedo.webp');
  const normal = await read('assets/textures/cloth_normal.webp');
  const rough = await read('assets/textures/cloth_rough.webp');
  return { albedo, normal, rough };
});
console.log(JSON.stringify(out, null, 1));
await close(); await server.stop();
