import { startServer, launchBrowser, waitForBoot } from './browser.mjs';
import { NPC_DATA } from '../src/npcs.js';

// glTF baseColorFactor is linear; glb.js does new THREE.Color(f0,f1,f2) with
// those linear components, so getHex() re-encodes to sRGB. Reproduce exactly.
const srgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const expected = (hex) =>
  [16, 8, 0]
    .map((s) => Math.round(srgb(((hex >> s) & 255) / 255) * 255))
    .reduce((acc, v) => (acc << 8) | v, 0);

const server = await startServer();
const { browser, close } = await launchBrowser();
const page = await browser.newPage();
await page.goto(server.base, { waitUntil: 'load' });
await waitForBoot(page);
await page.evaluate(() => window.amazingAdventure.assetsReady());
await page.evaluate(() => window.amazingAdventure.castReady);
const out = await page.evaluate(async () => {
  const app = window.amazingAdventure;
  const tints = [];
  app.scene.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    if (!/^cloth$/i.test(o.material.name || '')) return;
    let npc = null;
    for (let n = o; n; n = n.parent) if (n.userData?.npcId) npc = n.userData.npcId;
    tints.push({ npc, mesh: o.name, tint: o.material.color.getHex() });
  });
  const res = await fetch('assets/textures/cloth_albedo.webp');
  const bmp = await createImageBitmap(await res.blob());
  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = cv.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  let sr = 0, sg = 0, sb = 0, worst = 0, n = 0, lo = 255, hi = 0;
  for (let i = 0; i < px.length; i += 4) {
    sr += px[i]; sg += px[i + 1]; sb += px[i + 2]; n += 1;
    worst = Math.max(worst, Math.abs(px[i] - px[i + 1]), Math.abs(px[i + 1] - px[i + 2]));
    lo = Math.min(lo, px[i]); hi = Math.max(hi, px[i]);
  }
  return {
    tints,
    albedo: { size: [bmp.width, bmp.height], mean: [sr / n, sg / n, sb / n].map((v) => +v.toFixed(1)), worstChannelSpread: worst, lo, hi }
  };
});
await close();
await server.stop();

console.log(JSON.stringify(out.albedo, null, 1));
const byNpc = new Map();
for (const t of out.tints) {
  if (!byNpc.has(t.npc)) byNpc.set(t.npc, new Set());
  byNpc.get(t.npc).add(t.tint);
}
let bad = 0;
for (const npc of NPC_DATA) {
  const seen = byNpc.get(npc.id);
  const want = expected(npc.colors.coat);
  const got = seen ? [...seen] : [];
  const ok = got.length === 1 && got[0] === want;
  if (!ok) bad += 1;
  console.log(
    (ok ? 'OK  ' : 'BAD ') + npc.id.padEnd(7),
    'authored 0x' + npc.colors.coat.toString(16).padStart(6, '0'),
    'expect 0x' + want.toString(16).padStart(6, '0'),
    'got ' + got.map((g) => '0x' + g.toString(16).padStart(6, '0')).join(',')
  );
}
console.log('mismatches', bad);
