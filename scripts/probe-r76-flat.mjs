// Round 76 probe: which meshes own the biggest still-flat materials?
//
// scripts/audit-materials.mjs ranks flat material *families* by surface area but
// says nothing about where they are. This probe takes the materials at the top
// of that list and reports every mesh that uses one: mesh name, its ancestors,
// world-space centre and size, and whether it belongs to a loaded GLB. That is
// what decides whether "Accent" is a house trim (worth a texture family) or a
// quest marker (intentionally flat).
//
// Usage: node scripts/probe-r76-flat.mjs [MaterialName,...]
import { startServer, launchBrowser, waitForBoot } from './browser.mjs';

const WANTED = (process.argv[2] || 'Accent,BoardFace,LaneRope,BoardPaper,Skin,Boot')
  .split(',').map((s) => s.trim()).filter(Boolean);

const server = await startServer();
const { browser, close } = await launchBrowser();
const page = await browser.newPage();
await page.setViewport({ width: 800, height: 600 });
try {
  await page.goto(server.base, { waitUntil: 'load' });
  await waitForBoot(page);
  await page.evaluate(() => window.amazingAdventure.assetsReady()).catch(() => {});
  const rows = await page.evaluate((wanted) => {
    const { scene } = window.amazingAdventure;
    const out = [];
    const visible = (o) => {
      for (let n = o; n; n = n.parent) if (!n.visible) return false;
      return true;
    };
    scene.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      if (!visible(o)) return;
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!mat || mat.visible === false) return;
      const name = mat.name || '(unnamed)';
      if (!wanted.includes(name)) return;
      if (o.name === 'sky-dome' || (o.parent && o.parent.name === 'sky-dome')) return;
      o.geometry.computeBoundingBox();
      const box = o.geometry.boundingBox;
      const p = new o.matrixWorld.constructor();
      // world centre via matrixWorld * centre
      const cx = (box.min.x + box.max.x) / 2;
      const cy = (box.min.y + box.max.y) / 2;
      const cz = (box.min.z + box.max.z) / 2;
      const e = o.matrixWorld.elements;
      const wx = e[0] * cx + e[4] * cy + e[8] * cz + e[12];
      const wy = e[1] * cx + e[5] * cy + e[9] * cz + e[13];
      const wz = e[2] * cx + e[6] * cy + e[10] * cz + e[14];
      const sx = (box.max.x - box.min.x) * Math.hypot(e[0], e[1], e[2]);
      const sy = (box.max.y - box.min.y) * Math.hypot(e[4], e[5], e[6]);
      const sz = (box.max.z - box.min.z) * Math.hypot(e[8], e[9], e[10]);
      const chain = [];
      for (let n = o; n && chain.length < 5; n = n.parent) chain.push(n.name || '(anon)');
      out.push({
        material: name,
        mesh: o.name || '(anon)',
        chain: chain.join(' < '),
        centre: [Number(wx.toFixed(2)), Number(wy.toFixed(2)), Number(wz.toFixed(2))],
        size: [Number(sx.toFixed(2)), Number(sy.toFixed(2)), Number(sz.toFixed(2))]
      });
    });
    return out;
  }, WANTED);
  rows.sort((a, b) => a.material.localeCompare(b.material) || a.mesh.localeCompare(b.mesh));
  console.log(JSON.stringify({ wanted: WANTED, count: rows.length, rows }, null, 2));
} finally {
  await close();
  await server.stop();
}
