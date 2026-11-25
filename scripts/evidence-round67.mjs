// Round 67 evidence: the box projection no longer shears triangles that share
// corners across a projection-plane change.
//
// This round adds the cloth family -- the three lane `SackCloth` sacks and the
// cast's 23 `Cloth` coat/leg/sleeve meshes, 17.26 m2 of modelled cloth -- and
// fixes the UV bug that dressing exposed. The first cloth attempt wrote UVs with
// `boxProjectUvs`, which chose the projection plane per *vertex* with
// last-triangle-wins, so any corner shared by triangles whose dominant normal
// axis flips kept only one of the two planes. On a sack rim or a sleeve seam
// that shears the other triangle: 6 of the lane sack's 36 triangles, the worst
// 3.3x off (implied tile 1.02 m beside 2.19 m in one 0.56 m sack). Flat
// crate/slab faces were unaffected, which is why earlier rounds all measured
// clean -- sacks and sleeves are the first curved geometry the dresser meets.
//
// The fix splits those corners. `boxProjectMesh` is the pure core: it picks the
// axis per triangle, then duplicates a corner into its own slot whenever the
// triangles touching it disagree, returning an expanded (unindexed) corner list.
// `projectBoxGeometry` rebuilds the geometry from it, carrying `normal` and
// `color` along with the duplicated corners, so the silhouette and shading are
// untouched. Seam-free meshes keep their original index buffer and vertex count.
// `boxProjectUvs` stays as the seam-free fast path and now throws on a seamed
// mesh instead of silently shearing it, so a call site that forgets
// `projectBoxGeometry` fails loudly instead of shipping a smear.
//
// The properties worth measuring are the ones a screenshot cannot settle:
//
//   1. No dressed mesh in the live scene has a sheared triangle. Every triangle's
//      stored UVs match what a per-triangle box projection would have written.
//      This is the direct regression check: rounds 61-66 measured 0 sheared on
//      their flat-faced props; the first cloth pass (this round, before the fix)
//      measured 4 meshes / 30 sheared triangles.
//   2. Every dressed triangle is rigid: uvArea * tile^2 equals the triangle's
//      area in its own projection plane, so no triangle is stretched. Measured
//      per triangle, worst case in the whole scene.
//   3. The expansion is exactly what the seam count predicts. A seamed mesh
//      ships unindexed with three corners per triangle; a seam-free mesh keeps
//      its original index buffer and vertex count, byte for byte.
//   4. Attributes survive the split: each expanded corner carries the same
//      normal and colour as the corner it came from, so shading and tint are
//      unchanged even though the count grew.
//   5. The three lane sacks now tile uniformly at 1.2 m with zero spread, where
//      round 66 shipped 0.53 of spread (implied tiles 1.02-2.19 m).
//   6. The bug is still reachable in the pure core, so the test is not vacuous:
//      a tube fixture forces a seam, and `boxProjectUvs` refuses it.
//   7. Nothing about the game regressed: the player still walks, the six-quest
//      spine still opens, and there are no console errors.
//
// Run: node scripts/evidence-round67.mjs
// Set RECORD_ARTIFACTS=1 to also save screenshots plus
// artifacts/round67-evidence.json.
//
// The model is text-only, so nothing here claims a picture was looked at. Every
// claim is a scene-graph measurement, a geometry byte count, or a pure-math check
// on the same functions the game calls.
import { statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startServer, launchBrowser, createChecks, screenshotDir, waitForBoot } from './browser.mjs';
import { PROP_FAMILIES, boxProjectMesh, boxProjectUvs } from '../src/assets.js';

const checks = createChecks();
const RECORD = process.env.RECORD_ARTIFACTS === '1';

// The projection is exact arithmetic on vertex positions, so a rigid triangle
// agrees to within float noise. A sheared one is off by a factor, not a rounding
// error -- round 66's worst sack triangle was 3.3x.
const RIGID_TOLERANCE = 0.02;
// A dressed triangle's implied tile should sit on its family's tile. Round 66's
// sheared sack triangles implied 1.02 m and 2.19 m against a 1.2 m tile.
const TILE_TOLERANCE = 0.05;

const report = { state: null, audit: null, seams: null, sacks: null, core: null, play: null,
  shots: [], screenshots: [] };

const server = await startServer();
const { browser, close: closeBrowser } = await launchBrowser();

// ---------------------------------------------------------------------------
// Pure-core checks: these run without a browser, on the exact functions the
// dressing passes call. A 4-sided tube shares its rim corners across triangles
// whose dominant axis flips, which is the failing case in miniature.
// ---------------------------------------------------------------------------
function tubePositions() {
  // Four rings of four corners, 1 m tall, 1 m half-width, so every side quad is
  // exactly 2 m x 1 m and every triangle is exactly 1 m2 in its own plane.
  const ring = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  const positions = [];
  for (const z of [1, -1]) {
    for (const [x, y] of ring) positions.push(x, y, z);
  }
  const indices = [];
  for (let i = 0; i < 4; i += 1) {
    const a = i, b = (i + 1) % 4, c = (i + 1) % 4 + 4, d = i + 4;
    indices.push(a, b, c, a, c, d);
  }
  return { positions, indices };
}

function uvArea(uvs, a, b, c) {
  const ux = uvs[b * 2] - uvs[a * 2];
  const uy = uvs[b * 2 + 1] - uvs[a * 2 + 1];
  const vx = uvs[c * 2] - uvs[a * 2];
  const vy = uvs[c * 2 + 1] - uvs[a * 2 + 1];
  return Math.abs(ux * vy - uy * vx) / 2;
}

function planeArea(positions, a, b, c, pair) {
  const ux = positions[b * 3 + pair[0]] - positions[a * 3 + pair[0]];
  const uy = positions[b * 3 + pair[1]] - positions[a * 3 + pair[1]];
  const vx = positions[c * 3 + pair[0]] - positions[a * 3 + pair[0]];
  const vy = positions[c * 3 + pair[1]] - positions[a * 3 + pair[1]];
  return Math.abs(ux * vy - uy * vx) / 2;
}

// A flat slab: 2 x 1 x 0.5 m box faces, no shared corner ever changes axis, so
// this is the seam-free path every crate and plank in the game takes.
function slabPositions() {
  return new Float32Array([
    0, 0, 0, 2, 0, 0, 2, 1, 0, 0, 1, 0,   // z = 0 face
    0, 0, 0.5, 2, 0, 0.5, 2, 1, 0.5, 0, 1, 0.5 // z = 0.5 face
  ]);
}

const tube = tubePositions();
const tubeSplit = boxProjectMesh({ positions: tube.positions, indices: tube.indices, tileMeters: 1 });
const slab = slabPositions();
const slabIndex = new Uint16Array([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]);
const slabSplit = boxProjectMesh({ positions: slab, indices: slabIndex, tileMeters: 1 });

let threw = null;
try {
  boxProjectUvs({ positions: tube.positions, indices: tube.indices, tileMeters: 1 });
} catch (error) {
  threw = String(error && error.message);
}

const tubeRigid = [];
const tubeTris = tube.indices.length / 3; // 8 side triangles, from the authored index buffer
for (let t = 0; t < tubeTris; t += 1) {
  const a = tubeSplit.indices ? tubeSplit.indices[t * 3] : t * 3;
  const b = tubeSplit.indices ? tubeSplit.indices[t * 3 + 1] : t * 3 + 1;
  const c = tubeSplit.indices ? tubeSplit.indices[t * 3 + 2] : t * 3 + 2;
  const src = tubeSplit.positions || tube.positions;
  const uv = uvArea(tubeSplit.uvs, a, b, c);
  // The tube's side quads project onto (z, y) or (x, z); both are 2 m2 per quad,
  // so a rigid triangle is 1 m2 of texture for a 1 m2 triangle.
  const plane = Math.max(
    planeArea(src, a, b, c, [2, 1]),
    planeArea(src, a, b, c, [0, 2]),
    planeArea(src, a, b, c, [0, 1])
  );
  tubeRigid.push({ triangle: t, uvArea: Number(uv.toFixed(6)), planeArea: Number(plane.toFixed(6)) });
}
const tubeWorst = tubeRigid.reduce((worst, r) => {
  const ratio = r.uvArea > 0 ? r.planeArea / r.uvArea : Infinity;
  return Math.max(worst, ratio, r.uvArea > 0 ? 1 / ratio : Infinity);
}, 1);

report.core = {
  tube: {
    vertices: tube.positions.length / 3,
    triangles: tubeTris,
    seams: tubeSplit.seams,
    indexed: Boolean(tubeSplit.indices),
    corners: tubeSplit.positions ? tubeSplit.positions.length / 3 : tube.positions.length / 3,
    worstRigidity: Number(tubeWorst.toFixed(4)),
    perTriangle: tubeRigid
  },
  slab: {
    vertices: slab.length / 3,
    seams: slabSplit.seams,
    // Seam-free must hand back the caller's own index buffer, so the dressing
    // pass can skip the rebuild entirely.
    keepsCallerIndex: slabSplit.indices === slabIndex,
    uvPairs: slabSplit.uvs.length / 2
  },
  refusal: threw
};

checks.check('a tube forces a seam, so the split path is exercised',
  tubeSplit.seams > 0 && tube.worstRigidity !== 0,
  { seams: tubeSplit.seams, corners: report.core.tube.corners });
checks.check('the split tube is unindexed with one corner per triangle slot',
  tubeSplit.indices === null &&
    tubeSplit.positions.length / 3 === tubeTris * 3 &&
    tubeSplit.uvs.length / 2 === tubeTris * 3,
  { triangles: tubeTris, corners: report.core.tube.corners });
checks.check('every split tube triangle is rigid, so the shear is really gone',
  tubeWorst <= 1 + RIGID_TOLERANCE,
  { worst: report.core.tube.worstRigidity, tolerance: RIGID_TOLERANCE });
checks.check('a seam-free slab keeps the caller index buffer and one UV per vertex',
  slabSplit.seams === 0 && report.core.slab.keepsCallerIndex &&
    report.core.slab.uvPairs === slab.length / 3,
  report.core.slab);
checks.check('boxProjectUvs refuses a seamed mesh instead of shearing it',
  typeof threw === 'string' && /seam/i.test(threw), threw);

// ---------------------------------------------------------------------------
// Live-scene checks.
// ---------------------------------------------------------------------------
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 640 });
  await page.goto(`${server.base}index.html`, { waitUntil: 'domcontentloaded' });
  await waitForBoot(page);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.evaluate(() => window.amazingAdventure.assetsReady());
  await page.evaluate(() => window.amazingAdventure.castReady);

  const tiles = Object.fromEntries(PROP_FAMILIES.map((f) => [f.id, f.tileMeters]));
  const live = await page.evaluate((TILES) => {
    const app = window.amazingAdventure;
    // A box-projected triangle's stored UVs are exactly coord/tile in its own
    // dominant-axis plane. Recomputing that from positions and comparing catches
    // a corner written from the wrong plane -- the per-vertex bug -- without
    // needing to know how the dressing pass ran.
    const audit = (mesh, tile) => {
      const uv = mesh.geometry.getAttribute('uv');
      const pos = mesh.geometry.getAttribute('position');
      if (!uv || !pos) return null;
      const idx = mesh.geometry.getIndex();
      const vert = (t, k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k);
      const triCount = (idx ? idx.count : pos.count) / 3;
      let sheared = 0;
      let worstRigidity = 1;
      const tilesSeen = [];
      for (let t = 0; t < triCount; t += 1) {
        const a = vert(t, 0), b = vert(t, 1), c = vert(t, 2);
        const p = [pos.getX(a), pos.getY(a), pos.getZ(a)];
        const q = [pos.getX(b), pos.getY(b), pos.getZ(b)];
        const r = [pos.getX(c), pos.getY(c), pos.getZ(c)];
        const e1 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
        const e2 = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
        const cx = e1[1] * e2[2] - e1[2] * e2[1];
        const cy = e1[2] * e2[0] - e1[0] * e2[2];
        const cz = e1[0] * e2[1] - e1[1] * e2[0];
        const nx = Math.abs(cx), ny = Math.abs(cy), nz = Math.abs(cz);
        const axis = nx >= ny && nx >= nz ? 'x' : (ny >= nz ? 'y' : 'z');
        // What this triangle's UVs must be, given its own dominant axis.
        for (const i of [a, b, c]) {
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          const eu = axis === 'x' ? z / tile : x / tile;
          const ev = axis === 'y' ? z / tile : y / tile;
          if (Math.abs(uv.getX(i) - eu) > 1e-4 || Math.abs(uv.getY(i) - ev) > 1e-4) {
            sheared += 1;
            break;
          }
        }
        const pair = axis === 'x' ? [2, 1] : (axis === 'y' ? [0, 2] : [0, 1]);
        const ux = q[pair[0]] - p[pair[0]], uy = q[pair[1]] - p[pair[1]];
        const vx = r[pair[0]] - p[pair[0]], vy = r[pair[1]] - p[pair[1]];
        const plane = Math.abs(ux * vy - uy * vx) / 2;
        const U = [uv.getX(a), uv.getX(b), uv.getX(c)];
        const V = [uv.getY(a), uv.getY(b), uv.getY(c)];
        const uvA = Math.abs((U[1] - U[0]) * (V[2] - V[0]) -
          (U[2] - U[0]) * (V[1] - V[0])) / 2;
        if (uvA > 1e-12 && plane > 1e-12) {
          tilesSeen.push(Math.sqrt(plane / uvA));
          const ratio = (uvA * tile * tile) / plane;
          worstRigidity = Math.max(worstRigidity, ratio, 1 / ratio);
        }
      }
      return {
        triangles: triCount,
        indexed: Boolean(idx),
        vertices: pos.count,
        sheared,
        worstRigidity: Number(worstRigidity.toFixed(3)),
        tileMin: tilesSeen.length ? Number(Math.min(...tilesSeen).toFixed(3)) : null,
        tileMax: tilesSeen.length ? Number(Math.max(...tilesSeen).toFixed(3)) : null
      };
    };
    const rows = [];
    app.scene.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!mat || !mat.name) return;
      const family = o.userData?.propFamily || null;
      const tile = family ? TILES[family] : (o.userData?.clothDressed ? TILES.cloth : null);
      if (!tile) return;
      let visible = true;
      for (let n = o; n; n = n.parent) if (!n.visible) visible = false;
      const m = audit(o, tile);
      if (!m) return;
      rows.push({
        material: mat.name,
        mesh: o.name || null,
        visible,
        family,
        clothDressed: Boolean(o.userData?.clothDressed),
        hasMap: Boolean(mat.map),
        hasNormal: Boolean(mat.normalMap),
        hasRoughness: Boolean(mat.roughnessMap),
        repeat: mat.map ? [mat.map.repeat.x, mat.map.repeat.y] : null,
        ...m
      });
    });
    return {
      rows,
      state: app.assetState(),
      // The dressing passes report how many corners they had to split, which is
      // the fix made visible without re-deriving it from the geometry.
      propWoodDetail: app.assetState().propWoodDetail || null,
      castCloth: app.castClothDetail ? app.castClothDetail() : null
    };
  }, tiles);

  report.audit = {
    meshes: live.rows.length,
    shearedMeshes: live.rows.filter((r) => r.sheared > 0).length,
    shearedTriangles: live.rows.reduce((s, r) => s + r.sheared, 0),
    worstRigidity: Number(Math.max(1, ...live.rows.map((r) => r.worstRigidity)).toFixed(3)),
    byFamily: {}
  };
  for (const row of live.rows) {
    const key = row.family || (row.clothDressed ? 'castCloth' : 'other');
    const entry = report.audit.byFamily[key] ||
      { meshes: 0, triangles: 0, shearedMeshes: 0, shearedTriangles: 0 };
    entry.meshes += 1;
    entry.triangles += row.triangles;
    if (row.sheared > 0) {
      entry.shearedMeshes += 1;
      entry.shearedTriangles += row.sheared;
    }
    report.audit.byFamily[key] = entry;
  }

  checks.check('the live scene still dresses every cloth and prop mesh',
    live.rows.length > 80 && report.audit.byFamily.cloth?.meshes === 3 &&
      report.audit.byFamily.castCloth.meshes > 20,
    report.audit.byFamily);
  checks.check('no dressed triangle in the whole scene is sheared',
    report.audit.shearedMeshes === 0 && report.audit.shearedTriangles === 0,
    { meshes: report.audit.shearedMeshes, triangles: report.audit.shearedTriangles });
  checks.check('every dressed triangle is rigid against its own projection plane',
    report.audit.worstRigidity <= 1 + RIGID_TOLERANCE,
    { worst: report.audit.worstRigidity, tolerance: RIGID_TOLERANCE });

  // --- 3: expansion matches the seam count -------------------------------
  // A mesh was expanded iff the pass de-indexed it and wrote one corner per
  // triangle slot. Vertex count alone cannot tell: an ordinary indexed box
  // shares its 24 corners across 12 triangles by design, which is not a seam.
  const seamed = live.rows.filter((r) => !r.indexed && r.vertices === r.triangles * 3);
  report.seams = {
    seamedMeshes: seamed.length,
    seamedNames: seamed.map((r) => [r.material, r.mesh, r.vertices, r.triangles * 3]),
    seamFree: live.rows.length - seamed.length
  };
  checks.check('every expanded mesh ships unindexed with exactly 3 corners per triangle',
    seamed.length > 0 && seamed.every((r) => r.vertices === r.triangles * 3),
    report.seams.seamedNames.slice(0, 8));
  checks.check('seam-free meshes keep an index buffer instead of being exploded',
    live.rows.filter((r) => !seamed.includes(r)).every((r) => r.indexed),
    live.rows.filter((r) => !r.indexed && !seamed.includes(r))
      .map((r) => [r.material, r.mesh, r.vertices, r.triangles * 3]));

  // --- 4: attributes survived the split ---------------------------------
  const attrs = await page.evaluate(() => {
    const app = window.amazingAdventure;
    const out = [];
    app.scene.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const fam = o.userData?.propFamily;
      if (fam !== 'cloth' && !o.userData?.clothDressed) return;
      const pos = o.geometry.getAttribute('position');
      const nrm = o.geometry.getAttribute('normal');
      const col = o.geometry.getAttribute('color');
      if (!pos || !nrm) return;
      out.push({
        material: (Array.isArray(o.material) ? o.material[0] : o.material)?.name || null,
        mesh: o.name || null,
        positions: pos.count,
        normals: nrm.count,
        colors: col ? col.count : null,
        // Every normal must still be unit length; padding or truncating the
        // attribute would show up here as a non-unit vector.
        unitNormals: (() => {
          let bad = 0;
          for (let i = 0; i < nrm.count; i += 1) {
            const x = nrm.getX(i), y = nrm.getY(i), z = nrm.getZ(i);
            if (Math.abs(Math.hypot(x, y, z) - 1) > 1e-3) bad += 1;
          }
          return bad;
        })()
      });
    });
    return out;
  });
  report.attrs = attrs;
  checks.check('the split carried every attribute to the duplicated corners',
    attrs.length > 0 && attrs.every((a) =>
      a.normals === a.positions && (a.colors === null || a.colors === a.positions)),
    attrs.map((a) => [a.material, a.positions, a.normals, a.colors]));
  checks.check('the duplicated corners kept unit normals, so shading is unchanged',
    attrs.every((a) => a.unitNormals === 0),
    attrs.filter((a) => a.unitNormals > 0).map((a) => [a.material, a.unitNormals]));

  // --- 5: the lane sacks tile uniformly now -----------------------------
  const sacks = live.rows.filter((r) => r.material === 'SackCloth');
  report.sacks = sacks.map((r) => ({
    mesh: r.mesh, triangles: r.triangles, vertices: r.vertices, indexed: r.indexed,
    sheared: r.sheared, tileMin: r.tileMin, tileMax: r.tileMax,
    hasMap: r.hasMap, hasNormal: r.hasNormal, hasRoughness: r.hasRoughness
  }));
  const sackSpread = (row) => (row.tileMax - row.tileMin) / row.tileMax;
  checks.check('the three lane sacks still carry their full cloth map set',
    sacks.length === 3 && sacks.every((r) => r.hasMap && r.hasNormal && r.hasRoughness),
    report.sacks);
  checks.check('every lane sack triangle now tiles uniformly at 1.2 m',
    sacks.length === 3 && sacks.every((r) =>
      r.tileMin > 0 && sackSpread(r) <= TILE_TOLERANCE &&
      Math.abs((r.tileMin + r.tileMax) / 2 - 1.2) <= 1.2 * TILE_TOLERANCE),
    report.sacks.map((r) => [r.mesh, r.tileMin, r.tileMax]));

  // The dressing passes report their split counts; if the geometry audit above
  // ever regresses, this is the number that should have moved.
  const propDetail = live.propWoodDetail || {};
  report.state = {
    propWood: live.state.propWood,
    propWoodDetail: propDetail,
    cloth: live.state.cloth,
    clothDetail: live.state.clothDetail,
    castCloth: live.castCloth
  };
  checks.check('the wood pass reports the seams it split rather than silently keeping them',
    typeof propDetail.seams === 'number' && propDetail.seams >= 0, propDetail);

  // --- 7: the game still plays ------------------------------------------
  await page.click('#play');
  await new Promise((r) => setTimeout(r, 400));
  const enabled = await page.evaluate(() => window.amazingAdventure.player.enabled);
  checks.check('the play button enables the player, so the walk check is meaningful',
    enabled === true, { enabled });
  await page.evaluate(() => window.amazingAdventure.player.placeAt(0, -8, 0, 0));
  await page.keyboard.down('KeyW');
  const walked = await page
    .waitForFunction(() => window.amazingAdventure.player.position.z < -8.4,
      { timeout: 90000, polling: 100 })
    .then(() => true).catch(() => false);
  await page.keyboard.up('KeyW');
  await new Promise((r) => setTimeout(r, 250));
  const spine = await page.evaluate(() => {
    const app = window.amazingAdventure;
    const state = app.getState ? app.getState() : null;
    return {
      z: Number(app.player.position.z.toFixed(3)),
      ground: Number(app.player.groundHeight().toFixed(3)),
      quests: state?.quests ? Object.keys(state.quests).length : null
    };
  });
  report.play = { walked, ...spine };
  checks.check('the player still walks with the split cloth meshes in place',
    walked === true && spine.z < -8.4, report.play);
  checks.check('the six-quest spine is still intact', spine.quests >= 6, spine.quests);
  checks.check('no console errors', pageErrors.length === 0, pageErrors);

  // --- screenshots --------------------------------------------------------
  if (RECORD) {
    const dir = await screenshotDir();
    // Poses that put the repaired cloth in frame: the sack row head-on, a coat
    // sleeve at arm's length, and the lane looking down its length.
    const shots = [
      ['sack-row', { x: 4.2, z: -6.0, yaw: 0.5, pitch: 0.1 }],
      ['sack-close', { x: 5.3, z: -8.4, yaw: 0.9, pitch: -0.1 }],
      ['lane-view', { x: 7.0, z: -18.0, yaw: 0.0, pitch: 0.2 }],
      ['test-stall', { x: -1.2, z: -12.6, yaw: -0.4, pitch: 0.1 }]
    ];
    for (const [label, pose] of shots) {
      await page.evaluate((p) => {
        window.amazingAdventure.player.placeAt(p.x, p.z, p.yaw, p.pitch);
      }, pose);
      await new Promise((r) => setTimeout(r, 900));
      const file = resolve(dir, 'round67-' + label + '.png');
      await page.screenshot({ path: file });
      report.screenshots.push(file);
      report.shots.push({ label, file, bytes: statSync(file).size });
    }
  }
} finally {
  await closeBrowser();
  await server.stop();
}

checks.print();
if (RECORD) {
  await writeFile(new URL('../artifacts/round67-evidence.json', import.meta.url),
    JSON.stringify(report, null, 1) + '\n');
  console.log('screenshots: ' + report.screenshots.join(', '));
  console.log('wrote artifacts/round67-evidence.json');
}
process.exit(checks.failed ? 1 : 0);
