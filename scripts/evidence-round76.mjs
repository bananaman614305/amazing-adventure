// Round 76 evidence: the cast's faces and hair are the last flat mass, and the
// relief on them is real.
//
// Rounds 28-75 dressed the plaza's ground, walls, wood, iron, felt, roofs,
// water, glass and coats. A live materials audit then put `Skin` (1.31 m2 over
// 36 meshes: six heads, noses, hands, thumbs) and `HairC` (0.67 m2 over 8:
// caps, Mara's bun, Wren's tail) at the top of what was still flat, and they are
// the surfaces the player looks at most directly -- the Talk prompt puts the
// camera under 2 m from a 0.31 m head.
//
// Round 76 gives each family a neutral procedural relief tile (0.35 m skin,
// 0.22 m hair) box-projected in metre space, so `map x material.colour` keeps
// every NPC's authored skin tone and hair dye. This script holds that to
// numbers a screenshot alone could not settle:
//
//   1. The pure rules in src/skin.js name exactly the two authored materials and
//      nothing that carries the gaze or the mouth.
//   2. The six shipped WebPs are the files the generator reported, are real
//      WebP containers, and the generator measured no tile seam and detail that
//      survives to mip 3 (where a Talk-range face samples).
//   3. In a real boot, all 44 face/hair meshes are dressed: three maps each,
//      wrapping, finite metre-space UVs, one map set per material (12, not 44),
//      the authored tint and roughness bases intact.
//   4. Every dressed triangle is rigid: uvArea * tile^2 equals its area in its
//      own projection plane, so nothing is stretched or sheared.
//   5. Pip's smaller rig still lands on a 0.35 m physical tile.
//   6. The maps change on-screen pixels: the same frame with the normal maps
//      removed differs, and restoring them reproduces the frame byte-for-byte.
//
// Nothing here claims a picture was looked at. Every check is a live
// scene-graph, geometry or rendered-pixel measurement after a real boot, or a
// pure check on the same helpers the game calls. The screenshots are saved as
// evidence for the human to read.
//
// Run: node scripts/evidence-round76.mjs
// Set RECORD_ARTIFACTS=1 to save screenshots and artifacts/round76-evidence.json.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { startServer, launchBrowser, createChecks, screenshotDir, waitForBoot } from './browser.mjs';
import {
  CAST_SKIN_TILE_METERS, CAST_HAIR_TILE_METERS, CAST_SKIN_FAMILIES,
  castSkinFamilyFor, castSkinParams
} from '../src/skin.js';
import { SKIN_TEXTURE_FILES, HAIR_TEXTURE_FILES } from '../src/assets.js';

const checks = createChecks();
const RECORD = process.env.RECORD_ARTIFACTS === '1';
const report = { assets: null, cast: null, live: null, pixels: null, shots: [] };

// A rigid triangle agrees with its projected area to within float noise. A
// sheared one is off by a factor -- round 67's worst cloth triangle was 3.3x.
const RIGID_TOLERANCE = 0.03;

// ---------------------------------------------------------------------------
// Pure checks: the rules the game calls, and the bytes on disk.
// ---------------------------------------------------------------------------
{
  checks.check('two neutral families, named exactly as the rigs author them',
    CAST_SKIN_FAMILIES.length === 2
      && castSkinFamilyFor('Skin').id === 'skin'
      && castSkinFamilyFor('HairC').id === 'hair',
    CAST_SKIN_FAMILIES.map((f) => f.id).join(','));
  checks.check('both families keep the authored tint',
    CAST_SKIN_FAMILIES.every((f) => castSkinParams(f).keepTint === true),
    JSON.stringify(CAST_SKIN_FAMILIES.map((f) => castSkinParams(f).keepTint)));
  checks.check('the tiles are sized for a face at Talk range',
    CAST_SKIN_TILE_METERS === 0.35 && CAST_HAIR_TILE_METERS === 0.22,
    `${CAST_SKIN_TILE_METERS} m skin, ${CAST_HAIR_TILE_METERS} m hair`);
  checks.check('the gaze and mouth stay out of the pass',
    ['EyeWhite', 'EyeIris', 'Mouth'].every((n) => castSkinFamilyFor(n) === null),
    'EyeWhite/EyeIris/Mouth excluded');

  // The committed files are the ones the generator reported: same byte counts,
  // real WebP containers, three maps per family.
  const sizes = {};
  for (const files of [SKIN_TEXTURE_FILES, HAIR_TEXTURE_FILES]) {
    for (const url of Object.values(files)) {
      const bytes = readFileSync(url);
      sizes[url] = {
        bytes: bytes.length,
        container: `${bytes.toString('ascii', 0, 4)}/${bytes.toString('ascii', 8, 12)}`
      };
    }
  }
  const gen = JSON.parse(readFileSync('artifacts/r76/skin_report.json', 'utf8'));
  checks.check('six committed files are real WebP containers',
    Object.values(sizes).every((s) => s.container === 'RIFF/WEBP'),
    Object.values(sizes).map((s) => s.container).join(','));
  checks.check("the committed bytes are the generator's reported output",
    Object.entries(sizes).every(([url, s]) => gen[url.split('/').pop()]?.bytes === s.bytes),
    Object.entries(sizes).map(([k, v]) => `${k.split('/').pop()} ${v.bytes}`).join(', '));
  checks.check('every map is a substantial 512 px texture, not a stub',
    Object.values(sizes).every((s) => s.bytes > 40000 && s.bytes < 600000),
    Object.entries(sizes).map(([k, v]) => `${k.split('/').pop()} ${(v.bytes / 1024).toFixed(0)} KB`).join(', '));
  report.assets = sizes;

  const seam = Math.max(
    ...[...Object.values(gen.skin_seam_ratio).flat(), ...Object.values(gen.hair_seam_ratio).flat()]
  );
  checks.check('the generator measured no visible seam on any map',
    seam < 3, `worst seam ratio ${seam.toFixed(2)} (gate 3)`);
  checks.check('skin albedo is neutral and narrow so the tint survives',
    gen.skin_stats.albedo[0] >= 0.75 && gen.skin_stats.albedo[1] <= 1.0,
    `range ${gen.skin_stats.albedo[0].toFixed(3)}..${gen.skin_stats.albedo[1].toFixed(3)}`);
  checks.check('skin relief survives to mip 3, where a Talk-range face samples',
    gen.skin_mip_survival.normal['3'] > 0.05 && gen.hair_mip_survival.normal['3'] > 0.15,
    `skin normal std ${gen.skin_mip_survival.normal['3']}, hair ${gen.hair_mip_survival.normal['3']}`);
  checks.check('the job ran on the free GPU, not the CPU fallback',
    gen.backend === 'cupy', String(gen.backend));
}

// ---------------------------------------------------------------------------
// Live checks: a real boot, the real materials, real rendered pixels.
// ---------------------------------------------------------------------------
const server = await startServer();
const { browser, close: closeBrowser } = await launchBrowser();
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});

try {
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(server.base, { waitUntil: 'domcontentloaded' });
  await waitForBoot(page);

  // The cast has to finish: the skin pass is chained after the rigs and the
  // coats on castReady, so awaiting it is the documented settle point.
  const cast = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const summary = await api.castReady;
    return {
      loaded: summary.loaded,
      mode: summary.mode,
      cloth: summary.cloth ? summary.cloth.dressed : null,
      skin: summary.skin ? {
        dressed: summary.skin.dressed,
        perFamily: summary.skin.perFamily,
        seams: summary.skin.seams,
        anyLoaded: summary.skin.anyLoaded
      } : null
    };
  });
  report.cast = cast;
  checks.check('the cast is the six modelled rigs and the skin pass ran',
    cast.loaded === 6 && cast.mode === 'model'
      && cast.skin && cast.skin.dressed === 44 && cast.skin.anyLoaded === true,
    JSON.stringify(cast));
  checks.check('the skin pass dressed 36 skin and 8 hair meshes',
    cast.skin && cast.skin.perFamily.skin === 36 && cast.skin.perFamily.hair === 8,
    JSON.stringify(cast.skin && cast.skin.perFamily));

  const live = await page.evaluate(() => {
    const api = window.amazingAdventure;
    api.scene.updateMatrixWorld(true);
    const rows = [];
    const materialIds = new Set();
    const albedoIds = new Set();
    for (const npc of api.npcs) {
      npc.group.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const name = o.material.name;
        const family = /^skin$/i.test(name) ? 'skin' : /^hairc$/i.test(name) ? 'hair' : null;
        if (!family) return;
        const m = o.material;
        const uv = o.geometry.getAttribute('uv');
        if (!uv) {
          rows.push({ npc: npc.id, mesh: o.name, family, noUv: true });
          return;
        }
        let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
        let badUv = false;
        for (let i = 0; i < uv.array.length; i += 2) {
          const u = uv.array[i], v = uv.array[i + 1];
          if (!Number.isFinite(u) || !Number.isFinite(v)) { badUv = true; break; }
          if (u < uMin) uMin = u;
          if (u > uMax) uMax = u;
          if (v < vMin) vMin = v;
          if (v > vMax) vMax = v;
        }
        materialIds.add(m.uuid);
        if (m.map) albedoIds.add(m.map.uuid);
        // What each downloaded texture actually is: a decoded bitmap, wrapping
        // in both axes, one repeat, at the family's anisotropy.
        const mapInfo = {};
        for (const key of ['map', 'normalMap', 'roughnessMap']) {
          const t = m[key];
          mapInfo[key] = t ? {
            width: t.image ? t.image.width : null,
            height: t.image ? t.image.height : null,
            wrapS: t.wrapS,
            wrapT: t.wrapT,
            repeatX: t.repeat.x,
            repeatY: t.repeat.y,
            anisotropy: t.anisotropy,
            colorSpace: t.colorSpace
          } : null;
        }
        rows.push({
          npc: npc.id, mesh: o.name, family, badUv,
          maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => m[k]).length,
          mapInfo,
          uSpan: Number((uMax - uMin).toFixed(4)),
          vSpan: Number((vMax - vMin).toFixed(4)),
          roughness: Number(m.roughness.toFixed(4)),
          metalness: m.metalness,
          tint: `#${m.color.getHex().toString(16).padStart(6, '0')}`,
          indexed: Boolean(o.geometry.getIndex()),
          verts: uv.count,
          dressedFlag: o.userData.skinDressed === true
        });
      });
    }

    // Rigid-triangle audit: every dressed triangle's UV area times the tile
    // squared must equal its area in its own projection plane.
    let worstRigid = 0;
    let worstKey = '';
    let triangles = 0;
    for (const npc of api.npcs) {
      npc.group.traverse((o) => {
        if (!o.isMesh || !o.userData.skinDressed) return;
        const family = /^hairc$/i.test(o.material.name) ? 'hair' : 'skin';
        // The projection writes UVs in local metres at tile / accumulated
        // scale, so the rigid check has to use that same local tile. Using the
        // world tile makes Pip's every triangle look 0.72^2 too small, which is
        // the pass working exactly as designed, not a shear.
        let scale = 1;
        for (let n = o; n; n = n.parent) if (n.scale) scale *= n.scale.x;
        const tile = (family === 'hair' ? 0.22 : 0.35) / scale;
        const pos = o.geometry.getAttribute('position');
        const uv = o.geometry.getAttribute('uv');
        const index = o.geometry.getIndex();
        const triCount = index ? index.count / 3 : pos.count / 3;
        for (let t = 0; t < triCount; t += 1) {
          const ia = index ? index.getX(t * 3) : t * 3;
          const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
          const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;
          const e1 = [pos.getX(ib) - pos.getX(ia), pos.getY(ib) - pos.getY(ia), pos.getZ(ib) - pos.getZ(ia)];
          const e2 = [pos.getX(ic) - pos.getX(ia), pos.getY(ic) - pos.getY(ia), pos.getZ(ic) - pos.getZ(ia)];
          const nx = Math.abs(e1[1] * e2[2] - e1[2] * e2[1]);
          const ny = Math.abs(e1[2] * e2[0] - e1[0] * e2[2]);
          const nz = Math.abs(e1[0] * e2[1] - e1[1] * e2[0]);
          let area;
          if (nx >= ny && nx >= nz) area = 0.5 * nx;
          else if (ny >= nz) area = 0.5 * ny;
          else area = 0.5 * nz;
          const u1 = [uv.getX(ia), uv.getY(ia)];
          const u2 = [uv.getX(ib), uv.getY(ib)];
          const u3 = [uv.getX(ic), uv.getY(ic)];
          const uvArea = 0.5 * Math.abs(
            (u2[0] - u1[0]) * (u3[1] - u1[1]) - (u3[0] - u1[0]) * (u2[1] - u1[1])
          );
          if (area <= 1e-12) continue;
          const ratio = (uvArea * tile * tile) / area;
          const err = Math.abs(ratio - 1);
          triangles += 1;
          if (err > worstRigid) {
            worstRigid = err;
            worstKey = `${npc.id}/${o.name} tri ${t} ratio ${ratio.toFixed(4)}`;
          }
        }
      });
    }

    // Pip's rig is authored at 0.72 scale. The pass divides the tile by the
    // accumulated scale, so his local UV density is 0.72 of an adult's and one
    // physical tile is still 0.35 m. Measured on the heads as UV units per
    // world metre: UV span across the head divided by its world width.
    const headDensity = {};
    const localDensity = {};
    for (const npc of api.npcs) {
      npc.group.traverse((o) => {
        if (o.isMesh && o.name === 'Head' && /^skin$/i.test(o.material.name)) {
          const uv = o.geometry.getAttribute('uv');
          let uMin = Infinity, uMax = -Infinity;
          for (let i = 0; i < uv.array.length; i += 2) {
            if (uv.array[i] < uMin) uMin = uv.array[i];
            if (uv.array[i] > uMax) uMax = uv.array[i];
          }
          o.geometry.computeBoundingBox();
          const box = o.geometry.boundingBox;
          let scale = 1;
          for (let n = o; n; n = n.parent) if (n.scale) scale *= n.scale.x;
          const localWidth = box.max.x - box.min.x;
          const worldWidth = localWidth * scale;
          // UV per world metre: 1/0.35 for every rig, because the pass divides
          // the tile by the rig's scale. UV per *local* metre: 0.72 of an adult
          // for Pip, because his rig is authored smaller.
          headDensity[npc.id] = Number(((uMax - uMin) / worldWidth).toFixed(4));
          localDensity[npc.id] = Number(((uMax - uMin) / localWidth).toFixed(4));
        }
      });
    }

    // Nothing outside the two families received a skin or hair map. Other
    // families legitimately carry maps from earlier rounds (the coats have the
    // round-67 cloth weave), so identify intrusion by the map's decoded image
    // rather than by "has any map at all".
    const familyImages = new Set();
    for (const npc of api.npcs) {
      npc.group.traverse((o) => {
        if (o.isMesh && o.material && /^skin$|^hairc$/i.test(o.material.name) && o.material.map) {
          familyImages.add(o.material.map.image);
        }
      });
    }
    const otherMapped = [];
    for (const npc of api.npcs) {
      npc.group.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        if (/^skin$|^hairc$/i.test(o.material.name)) return;
        if (o.material.map && familyImages.has(o.material.map.image)) {
          otherMapped.push(`${npc.id}/${o.name}:${o.material.name}`);
        }
      });
    }

    return {
      rows, materials: materialIds.size, albedos: albedoIds.size,
      worstRigid, worstKey, triangles, headDensity, localDensity, otherMapped,
      npcs: api.npcs.length
    };
  });
  report.live = live;
  const { rows } = live;

  checks.check('all 44 cast face and hair meshes are dressed',
    rows.length === 44 && rows.every((r) => r.dressedFlag && !r.noUv),
    `${rows.length} rows, ${rows.filter((r) => r.dressedFlag).length} flagged`);
  checks.check('every dressed mesh carries all three maps',
    rows.every((r) => r.maps === 3),
    JSON.stringify([...new Set(rows.map((r) => r.maps))]));
  checks.check('every dressed mesh has finite, positive projected UVs',
    rows.every((r) => !r.badUv && r.uSpan > 0 && r.vSpan > 0),
    `min u span ${Math.min(...rows.map((r) => r.uSpan))}, min v span ${Math.min(...rows.map((r) => r.vSpan))}`);
  checks.check('the decoded maps are the 512 px files that shipped',
    rows.every((r) => ['map', 'normalMap', 'roughnessMap'].every((k) => {
      const m = r.mapInfo[k];
      return m && m.width === 512 && m.height === 512;
    })),
    JSON.stringify(rows[0].mapInfo.map));
  checks.check('the maps wrap and stay at one repeat (metre UVs carry the tile)',
    rows.every((r) => ['map', 'normalMap', 'roughnessMap'].every((k) => {
      const m = r.mapInfo[k];
      return m.wrapS === 1000 && m.wrapT === 1000 && m.repeatX === 1 && m.repeatY === 1;
    })),
    JSON.stringify({ map: rows[0].mapInfo.map }));
  checks.check('the albedo decodes as sRGB and the data maps stay linear',
    rows.every((r) => r.mapInfo.map.colorSpace === 'srgb'
      && r.mapInfo.normalMap.colorSpace === ''
      && r.mapInfo.roughnessMap.colorSpace === ''),
    JSON.stringify([rows[0].mapInfo.map.colorSpace, rows[0].mapInfo.normalMap.colorSpace]));
  checks.check('the map set is cloned once per rig and family, not per mesh',
    live.materials === 12 && live.albedos === 12,
    `${live.materials} material objects, ${live.albedos} albedo maps for 44 meshes`);
  checks.check('skin and hair keep their authored roughness bases',
    rows.filter((r) => r.family === 'skin').every((r) => Math.abs(r.roughness - 0.7) < 1e-3)
      && rows.filter((r) => r.family === 'hair').every((r) => Math.abs(r.roughness - 0.8) < 1e-3),
    JSON.stringify({
      skin: [...new Set(rows.filter((r) => r.family === 'skin').map((r) => r.roughness))],
      hair: [...new Set(rows.filter((r) => r.family === 'hair').map((r) => r.roughness))]
    }));
  checks.check('every dressed mesh is non-metal',
    rows.every((r) => r.metalness === 0), 'metalness 0');
  checks.check('six characters keep six distinct head tints',
    new Set(rows.filter((r) => r.family === 'skin' && r.mesh === 'Head').map((r) => r.tint)).size === 6,
    JSON.stringify([...new Set(rows.filter((r) => r.family === 'skin' && r.mesh === 'Head').map((r) => r.tint))]));
  checks.check('every dressed triangle is rigid, none stretched or sheared',
    live.worstRigid < RIGID_TOLERANCE,
    `worst ${(live.worstRigid * 100).toFixed(2)}% off over ${live.triangles} triangles (${live.worstKey})`);
  checks.check('every rig lands on the same 0.35 m physical tile',
    Object.values(live.headDensity).every((d) => Math.abs(d - 1 / CAST_SKIN_TILE_METERS) < 0.05),
    JSON.stringify(live.headDensity));
  checks.check('Pip is projected at a smaller local tile, so his features are adult-sized',
    Math.abs(live.localDensity.pip / live.localDensity.mara - 0.72) < 0.02,
    JSON.stringify(live.localDensity));
  checks.check('no other cast material gained a map',
    live.otherMapped.length === 0,
    live.otherMapped.slice(0, 5).join(', '));


  // Rendered-pixel proof: stand at Talk distance in front of Mara, measure where
  // her head lands on screen, then render the same frame three times -- dressed,
  // with the normal maps removed, and dressed again. The pixels over her face
  // must differ in the middle and reproduce exactly at the end, which is the
  // on-screen claim this round makes.
  const pixelProof = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    api.quality.set('full');
    // Adaptive resolution had already halved the canvas by the time this ran, so
    // pin it at native ratio first; otherwise the face rect is measured in a
    // frame whose size depends on how fast the software rasteriser was.
    if (api.resolution && api.resolution.setAdaptive) api.resolution.setAdaptive(false);
    api.setClock(10);
    api.getState().flags.laneLanternsLit = false;

    const mara = api.npcs.find((n) => n.id === 'mara');
    const p = mara.group.position;
    // 1.45 m south of Mara at eye height, looking north and a little down at her
    // head: the distance the Talk prompt opens at.
    api.player.placeAt(p.x, p.z + 1.45, 0, -0.12);
    const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    for (let i = 0; i < 8; i += 1) await raf();
    api.camera.updateMatrixWorld(true);
    api.scene.updateMatrixWorld(true);

    // Project every head vertex to screen space to find the face's pixel rect.
    // Written out rather than using THREE.Vector3: the page's API does not
    // expose the module, and this is exact matrix math either way.
    const mul = (a, b) => {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c += 1) {
        for (let r = 0; r < 4; r += 1) {
          let s = 0;
          for (let k = 0; k < 4; k += 1) s += a[k * 4 + r] * b[c * 4 + k];
          o[c * 4 + r] = s;
        }
      }
      return o;
    };
    const apply = (m, x, y, z) => {
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      return {
        x: (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
        y: (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
        z: (m[2] * x + m[6] * y + m[10] * z + m[14]) / w
      };
    };
    let head = null;
    mara.group.traverse((o) => { if (o.isMesh && o.name === 'Head') head = o; });
    const vp = mul(api.camera.projectionMatrix.elements, api.camera.matrixWorldInverse.elements);
    const pos = head.geometry.getAttribute('position');
    const mw = head.matrixWorld.elements;
    const cw = api.renderer.domElement.width;
    const ch = api.renderer.domElement.height;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < pos.count; i += 1) {
      const wx = mw[0] * pos.getX(i) + mw[4] * pos.getY(i) + mw[8] * pos.getZ(i) + mw[12];
      const wy = mw[1] * pos.getX(i) + mw[5] * pos.getY(i) + mw[9] * pos.getZ(i) + mw[13];
      const wz = mw[2] * pos.getX(i) + mw[6] * pos.getY(i) + mw[10] * pos.getZ(i) + mw[14];
      const q = apply(vp, wx, wy, wz);
      const sx = (q.x * 0.5 + 0.5) * cw;
      const sy = (-q.y * 0.5 + 0.5) * ch;
      minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
    }
    const rect = {
      x: Math.max(0, Math.floor(minX)), y: Math.max(0, Math.floor(minY)),
      w: Math.min(cw, Math.ceil(maxX)) - Math.max(0, Math.floor(minX)),
      h: Math.min(ch, Math.ceil(maxY)) - Math.max(0, Math.floor(minY))
    };

    const faceMaterials = [];
    for (const npc of api.npcs) {
      npc.group.traverse((o) => {
        if (o.isMesh && o.material && /^skin$|^hairc$/i.test(o.material.name)
          && !faceMaterials.includes(o.material)) {
          faceMaterials.push(o.material);
        }
      });
    }

    const snap = () => {
      api.renderer.render(api.scene, api.camera);
      return api.renderer.domElement.toDataURL('image/png');
    };
    const dressedA = snap();
    const saved = faceMaterials.map((m) => m.normalMap);
    for (const m of faceMaterials) { m.normalMap = null; m.needsUpdate = true; }
    const flatB = snap();
    faceMaterials.forEach((m, i) => { m.normalMap = saved[i]; m.needsUpdate = true; });
    const dressedC = snap();

    const load = (url) => new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = url;
    });
    const [ia, ib] = await Promise.all([load(dressedA), load(flatB)]);
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(ia, 0, 0);
    const da = ctx.getImageData(rect.x, rect.y, rect.w, rect.h).data;
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(ib, 0, 0);
    const db = ctx.getImageData(rect.x, rect.y, rect.w, rect.h).data;
    let sum = 0, max = 0, changed = 0, n = 0;
    for (let i = 0; i < da.length; i += 4) {
      let px = 0;
      for (let k = 0; k < 3; k += 1) {
        const d = Math.abs(da[i + k] - db[i + k]);
        sum += d;
        if (d > max) max = d;
        px += d;
        n += 1;
      }
      if (px > 4) changed += 1;
    }
    return {
      rect, canvas: [cw, ch], materials: faceMaterials.length,
      mean: Number((sum / n).toFixed(3)), max, changedPx: changed,
      facePx: rect.w * rect.h,
      sameAB: dressedA === flatB, sameAC: dressedA === dressedC
    };
  });
  report.pixels = pixelProof;
  checks.check('Mara\'s head fills a talk-range patch of the frame',
    pixelProof.rect.w > 60 && pixelProof.rect.h > 60
      && pixelProof.rect.x >= 0 && pixelProof.rect.y >= 0
      && pixelProof.rect.x + pixelProof.rect.w <= pixelProof.canvas[0]
      && pixelProof.rect.y + pixelProof.rect.h <= pixelProof.canvas[1],
    JSON.stringify({ rect: pixelProof.rect, canvas: pixelProof.canvas }));
  checks.check('the cast relief changes the rendered face pixels',
    pixelProof.changedPx > 150 && pixelProof.max > 5,
    `changed ${pixelProof.changedPx} of ${pixelProof.facePx} face px, max delta ${pixelProof.max}, mean ${pixelProof.mean}`);
  checks.check('the same maps reproduce the frame byte-for-byte',
    pixelProof.sameAC === true && pixelProof.sameAB === false,
    `sameAB ${pixelProof.sameAB}, sameAC ${pixelProof.sameAC}`);

  checks.check('the run produced no console errors', consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(' | '));

  if (RECORD) {
    const dir = await screenshotDir();
    const mara = await page.evaluate(() => {
      const npc = window.amazingAdventure.npcs.find((n) => n.id === 'mara');
      return { x: npc.group.position.x, z: npc.group.position.z };
    });
    const shots = [
      // Mara at Talk distance: the surface this round exists to fix.
      ['round76-mara-face.png', { x: mara.x, z: mara.z + 1.45, yaw: 0, pitch: -0.12, clock: 10 }],
      // Sable across the terrace, further out, for the at-range read.
      ['round76-sable-face.png', { x: -5.2, z: 14.3, yaw: 0, pitch: -0.06, clock: 10 }],
      // The plaza wide, six dressed faces in one frame.
      ['round76-plaza-wide.png', { x: 0.0, z: 10.5, yaw: 0.0, pitch: -0.04, clock: 10 }]
    ];
    for (const [name, pose] of shots) {
      await page.evaluate(async (pose) => {
        const api = window.amazingAdventure;
        api.quality.set('full');
        api.getState().flags.laneLanternsLit = false;
        api.setClock(pose.clock);
        api.player.placeAt(pose.x, pose.z, pose.yaw, pose.pitch);
        const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
        for (let i = 0; i < 12; i += 1) await raf();
      }, pose);
      const path = join(dir, name);
      await page.screenshot({ path });
      report.shots.push(path);
      console.log(`saved ${path}`);
    }
  }
} catch (error) {
  checks.recordError(error);
  console.error(`evidence run failed: ${error.message}`);
} finally {
  await closeBrowser();
  await server.stop();
}

if (RECORD) {
  const dir = await screenshotDir();
  const path = join(dir, 'round76-evidence.json');
  await writeFile(path, `${JSON.stringify({ ...report, checks: checks.results }, null, 2)}\n`);
  console.log(`saved ${path}`);
}

console.log('');
checks.print();
if (checks.failed) process.exitCode = 1;
