// A materials audit: find the largest still-flat surfaces in the loaded scene.
//
// Rounds 60-62 dressed the ground planes (grass, cobble, plaza flagstone) and the
// raised terrace in real map families. The remaining "graphics realism" gap is
// whatever large object still renders as a single flat colour, so this probe
// walks the live scene graph, groups meshes by the material they actually end up
// with, and reports the biggest flat-coloured surface area first. It measures the
// scene, not the source, so it cannot be fooled by intent.
//
// Usage: node scripts/audit-materials.mjs
import { startServer, launchBrowser, waitForBoot } from './browser.mjs';

const server = await startServer();
const { browser, close } = await launchBrowser();
const page = await browser.newPage();
await page.setViewport({ width: 800, height: 600 });
try {
  await page.goto(server.base, { waitUntil: 'load' });
  await waitForBoot(page);
  await page.waitForFunction(
    () => {
      if (!window.amazingAdventure || !window.amazingAdventure.assetState) return false;
      const a = window.amazingAdventure.assetState();
      // Wait for the asynchronous prop families to settle, not just the trees.
      return a && a.propWood !== 'pending' && a.bark !== 'pending';
    },
    { timeout: 120000, polling: 250 }
  ).catch(() => {});
  const report = await page.evaluate(() => {
    const { scene } = window.amazingAdventure;
    const flat = [];
    // Every mesh with a mapped material counts as dressed; report the rest.
    const seen = new Map();
    // Only what a player can actually see counts: an invisible stand-in that was
    // swapped for a model is not a graphics gap.
    const visible = (o) => {
      for (let n = o; n; n = n.parent) if (!n.visible) return false;
      return true;
    };
    scene.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      if (!visible(o)) return;
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!mat) return;
      // The sky dome is a gradient by design, and anything see-through is a glow
      // or a window, not a surface that wants a texture.
      if (mat.transparent || mat.opacity < 0.5) return;
      if (o.name === 'sky-dome' || (o.parent && o.parent.name === 'sky-dome')) return;
      const mapped = Boolean(mat.map || mat.normalMap || mat.roughnessMap);
      if (mapped) return;
      // A single map over a 12 m slab is still flat-looking, so weight by area:
      // measure the geometry's own bounding box surface area in world metres.
      // Measure from the position attribute so this needs nothing but the page's
      // own objects -- THREE is not exposed on the debug handle.
      o.geometry.computeBoundingBox();
      const box = o.geometry.boundingBox;
      const wx = o.matrixWorld.elements[0], wy = o.matrixWorld.elements[5];
      const wz = o.matrixWorld.elements[10];
      const sx = (box.max.x - box.min.x) * Math.abs(wx);
      const sy = (box.max.y - box.min.y) * Math.abs(wy);
      const sz = (box.max.z - box.min.z) * Math.abs(wz);
      const area = 2 * (sx * sy + sy * sz + sx * sz);
      const shared = (o.material && o.material.name) || '(unnamed)';
      if (!seen.has(shared)) {
        seen.set(shared, {
          name: shared, meshes: 0, area: 0,
          colour: mat.color ? mat.color.getHexString() : null,
          roughness: mat.roughness
        });
      }
      const row = seen.get(shared);
      row.meshes += 1;
      row.area += area;
    });
    return {
      flat: Array.from(seen.values())
        .map((r) => ({ ...r, area: Math.round(r.area * 100) / 100 }))
        .sort((a, b) => b.area - a.area)
    };
  });
  console.log(JSON.stringify(report, null, 2));
} finally {
  await page.close();
  await close();
  await server.stop();
}
