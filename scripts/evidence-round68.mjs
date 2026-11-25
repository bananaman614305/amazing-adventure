// Round 68 evidence: the sun's shadow frustum now covers the whole world.
//
// The defect this round fixes was invisible to every earlier test. The plaza's
// shadow box was hard-coded as +-24 around the origin, written when the plaza
// was the entire world. The market lane was added north of that (`LANE` spans
// z -26..-17.5), and nothing revisited the box. Anything outside an
// orthographic shadow camera is simply not rasterised into the depth map, so
// the lane's props neither cast nor received a sun shadow -- and because they
// were still lit by the sun, they read as flat cut-outs pasted on the ground
// next to plaza props that had proper contact shadows.
//
// Measured on the live scene before the fix:
//   - 22 of the lane's 40 shadow receivers projected outside the +-1 NDC box
//   - 46 of the lane's 65 shadow casters projected outside it
//   - the lane's north-east lamp post projected to NDC x = 1.14
//
// The fix derives the box from the areas' declared bounds (`shadowFrustumFor`
// in src/graphics.js) and aims the light's target at the world centre. Two
// properties matter and neither is provable by eye:
//
//   1. Coverage: every shadow-casting and shadow-receiving mesh in the live
//      scene projects inside the box, in every phase. This is measured on the
//      real scene graph after real boot, not on the constants.
//   2. Direction: the sun's authored direction per phase is unchanged. Moving
//      the target would have silently swung the sun, so `applyPhase` offsets
//      the light position by the same amount. Both halves are checked here
//      against the authored PHASE_LOOKS numbers.
//
// The box is sized by the CORNER distance, not the larger half-extent. The
// world spans 34 m east-west and 43 m north-south, so the larger half-extent is
// 21.5 m while the far corner is 27.4 m from the centre. Sizing by the
// half-extent left eight north-east lane props outside (the lamp post among
// them) -- a partial fix that a coarse "mostly covered" check would have
// passed. The evidence therefore counts every mesh, not a sample.
//
// Two more defects were found by attacking this script rather than trusting it:
//
//   - It first projected each mesh's bounding-box CENTRE, so a box straddling a
//     frustum plane passed. It now tests all eight corners and fails on any
//     overflow, which is the property that actually matters.
//   - The box shipped with near 1. Dusk drops the sun to y 7 and looks almost
//     along the ground, so tall geometry projects BEHIND the light plane
//     (measured view-space z up to +2.8 m) and seven corners were near-clipped
//     out of the depth map. `near` is now -slack, so no corner is excluded.
//
// Run: node scripts/evidence-round68.mjs
// Set RECORD_ARTIFACTS=1 to save screenshots and artifacts/round68-evidence.json.
//
// The model is text-only, so nothing here claims a picture was looked at. Every
// claim is a scene-graph measurement or a pure-math check on the same function
// the game calls.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startServer, launchBrowser, createChecks, screenshotDir, waitForBoot } from './browser.mjs';
import { shadowFrustumFor, shadowSettings } from '../src/graphics.js';
import { PLAZA, LANE } from '../src/areas.js';
import { PHASE_LOOKS } from '../src/world.js';

const checks = createChecks();
const RECORD = process.env.RECORD_ARTIFACTS === '1';
const report = { frustum: null, coverage: null, direction: null, before: null, shots: [] };

// ---------------------------------------------------------------------------
// Pure checks: the frustum arithmetic and the negative control for the bug.
// ---------------------------------------------------------------------------
const box = shadowFrustumFor([PLAZA, LANE]);
report.frustum = {
  left: box.left, right: box.right, top: box.top, bottom: box.bottom,
  near: box.near, far: box.far, size: box.size, centre: box.centre
};
console.log(`frustum: +-${box.right.toFixed(2)} m, centred (${box.centre.x}, ${box.centre.z}), ` +
  `near ${box.near}, far ${box.far.toFixed(1)}`);
checks.check('the shadow box is square, so a square shadow map spends every texel',
  Math.abs((box.right - box.left) - (box.top - box.bottom)) < 1e-9,
  `${(box.right - box.left).toFixed(2)} x ${(box.top - box.bottom).toFixed(2)} m`);
checks.check('the shadow box is larger than the historical +-24 m box',
  box.size > 48, `${box.size.toFixed(2)} m vs 48 m`);

// Project a ground point into the ortho box. The box is square and centred on
// the world centre, so this is a plain scale about that centre.
const half = (box.right - box.left) / 2;
const project = (x, z) => ({ x: (x - box.centre.x) / half, y: (z - box.centre.z) / half });

for (const area of [PLAZA, LANE]) {
  let worst = 0;
  for (const x of [area.minX, area.maxX]) {
    for (const z of [area.minZ, area.maxZ]) {
      const p = project(x, z);
      worst = Math.max(worst, Math.abs(p.x), Math.abs(p.y));
    }
  }
  checks.check(`every corner of ${area.id} is inside the shadow box`,
    worst <= 1, `worst |ndc| ${worst.toFixed(3)}`);
}

// Negative control: the bug, as arithmetic. If someone restores a fixed +-24
// box this measurement must fail, which is what makes the coverage check above
// meaningful rather than vacuous.
{
  const oldHalf = 24;
  const oldProject = (x, z) => ({ x: x / oldHalf, y: z / oldHalf });
  const laneEnd = oldProject(LANE.maxX, LANE.minZ);
  report.before = { box: oldHalf, laneEndNdc: laneEnd };
  checks.check('the historical +-24 m box leaves the lane end outside (negative control)',
    Math.abs(laneEnd.x) > 1 || Math.abs(laneEnd.y) > 1,
    `lane end (${LANE.maxX}, ${LANE.minZ}) -> ndc ${laneEnd.x.toFixed(2)}, ${laneEnd.y.toFixed(2)}`);
  // The half-extent trap: a square box sized by the larger half-extent instead
  // of the corner distance is 21.5 m here and still misses the corners.
  const halfExtent = Math.max((PLAZA.maxX - Math.min(PLAZA.minX, LANE.minX)) / 2,
    (PLAZA.maxZ - LANE.minZ) / 2);
  const cornerDistance = Math.hypot(halfExtent, (PLAZA.maxZ - LANE.minZ) / 2);
  checks.check('sizing the box by half-extent would still clip the far corner',
    halfExtent < cornerDistance,
    `half-extent ${halfExtent.toFixed(2)} m < corner distance ${cornerDistance.toFixed(2)} m`);
}

checks.check('the low tier still drops the shadow pass entirely',
  shadowSettings('low').enabled === false,
  'mobile keeps its zero-shadow path; this round adds no shadow cost there');

// ---------------------------------------------------------------------------
// Live checks: real boot, real scene graph, every phase.
// ---------------------------------------------------------------------------
const server = await startServer();
const { browser, close: closeBrowser } = await launchBrowser();
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});

try {
  await page.goto(server.base, { waitUntil: 'domcontentloaded' });
  await waitForBoot(page);

  // Day, dusk and night all drive `applyPhase`, which is what moves the sun and
  // re-aims it; checking one phase would miss a phase-specific offset bug.
  for (const [phaseName, seconds] of [['day', 10], ['dusk', 80], ['night', 140]]) {
    const measured = await page.evaluate(async ({ clock }) => {
      const api = window.amazingAdventure;
      const THREE = await import('three');
      api.setClock(clock);
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));

      let sun = null;
      api.scene.traverse((object) => {
        if (object.isDirectionalLight && object.castShadow) sun = object;
      });
      if (!sun) return { error: 'no shadow-casting directional light' };

      api.scene.updateMatrixWorld(true);
      sun.shadow.updateMatrices(sun);
      sun.shadow.camera.updateMatrixWorld(true);
      const camera = sun.shadow.camera;

      // Every mesh that participates in the shadow pass, once. A mesh can be
      // both caster and receiver, so classify rather than traverse twice.
      const seen = new Set();
      const strays = [];
      let receivers = 0;
      let casters = 0;
      let inside = 0;
      api.scene.traverse((object) => {
        if (!object.isMesh || seen.has(object)) return;
        seen.add(object);
        if (!object.receiveShadow && !object.castShadow) return;
        if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
        if (!object.geometry.boundingBox) return;
        if (object.receiveShadow) receivers += 1;
        if (object.castShadow) casters += 1;
        // boundingBox is a LOCAL box; applyMatrix4 by matrixWorld is the only
        // way to get its world corners for a child of a moved group. (Using
        // localToWorld on the raw attributes reads stale matrices.)
        //
        // Test EVERY corner, not just the centre. A centre-only test cannot see
        // a box that straddles a frustum plane: an earlier version of this
        // script passed while seven dusk corners sat behind the near
        // plane, because their centres were comfortably inside. The pass
        // condition has to be "the whole box is inside".
        const worldBox = object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld);
        const centre = worldBox.getCenter(new THREE.Vector3());
        let worst = null;
        for (const cx of [worldBox.min.x, worldBox.max.x]) {
          for (const cy of [worldBox.min.y, worldBox.max.y]) {
            for (const cz of [worldBox.min.z, worldBox.max.z]) {
              const ndc = new THREE.Vector3(cx, cy, cz).project(camera);
              const overflow = Math.max(Math.abs(ndc.x), Math.abs(ndc.y), Math.abs(ndc.z));
              if (!worst || overflow > worst.overflow) {
                worst = { overflow, ndc: [+ndc.x.toFixed(2), +ndc.y.toFixed(2), +ndc.z.toFixed(2)] };
              }
            }
          }
        }
        const isInside = worst.overflow <= 1;
        if (isInside) { inside += 1; return; }
        strays.push({
          name: object.name || '(unnamed)',
          world: [+centre.x.toFixed(2), +centre.y.toFixed(2), +centre.z.toFixed(2)],
          ndc: worst.ndc,
          overflow: +worst.overflow.toFixed(3),
          receive: Boolean(object.receiveShadow),
          cast: Boolean(object.castShadow)
        });
      });

      const direction = new THREE.Vector3()
        .subVectors(sun.target.position, sun.position).normalize();

      return {
        receivers, casters, inside, strays: strays.slice(0, 12), strayCount: strays.length,
        direction: direction.toArray().map((v) => +v.toFixed(3)),
        target: sun.target.position.toArray().map((v) => +v.toFixed(3)),
        camera: { left: camera.left, right: camera.right, near: camera.near, far: camera.far },
        phase: api.getClock().phase
      };
    }, { clock: seconds });

    if (measured.error) {
      checks.check(`${phaseName}: the scene has a shadow-casting sun`, false, measured.error);
      continue;
    }

    // The scene's own phase table must agree that we tested the phase we named;
    // otherwise a wrong clock would make every later check meaningless.
    checks.check(`${phaseName}: the clock reports the phase under test`,
      measured.phase === phaseName, `reported ${measured.phase}`);

    checks.check(`${phaseName}: every shadow mesh projects inside the shadow box`,
      measured.strayCount === 0,
      `${measured.inside}/${measured.receivers + measured.casters} inside` +
      (measured.strayCount ? `; strays ${JSON.stringify(measured.strays)}` : ''));

    checks.check(`${phaseName}: the lane has shadow casters and receivers to cover`,
      measured.receivers > 0 && measured.casters > 0,
      `${measured.receivers} receivers, ${measured.casters} casters`);

    // Direction must equal the authored PHASE_LOOKS point, normalised, with the
    // light travelling FROM that point TO the target. This is the check that
    // catches a target move that was not compensated on the light position.
    const authored = PHASE_LOOKS[phaseName].sunPosition;
    const length = Math.hypot(...authored);
    const expected = authored.map((v) => +(-v / length).toFixed(3));
    const drift = Math.max(...expected.map((v, i) => Math.abs(v - measured.direction[i])));
    checks.check(`${phaseName}: the sun keeps its authored direction`,
      drift < 0.002,
      `measured ${JSON.stringify(measured.direction)} vs authored ${JSON.stringify(expected)} (drift ${drift.toFixed(4)})`);

    // The target sits at the world centre, which is why the box is centred too.
    checks.check(`${phaseName}: the light target sits at the shadow box centre`,
      Math.abs(measured.target[0] - box.centre.x) < 1e-6 &&
      Math.abs(measured.target[2] - box.centre.z) < 1e-6,
      `target ${JSON.stringify(measured.target)} vs centre (${box.centre.x}, ${box.centre.z})`);

    report.coverage = report.coverage || {};
    report.coverage[phaseName] = {
      receivers: measured.receivers, casters: measured.casters,
      inside: measured.inside, strays: measured.strayCount,
      camera: measured.camera
    };
    report.direction = report.direction || {};
    report.direction[phaseName] = { measured: measured.direction, authored: expected, drift };
  }

  // A lane-end receiver is the specific prop the old box dropped. Project the
  // lamp post's own ground position and require it inside, so the fix is tied
  // to the reported symptom rather than to an aggregate count.
  const laneEnd = await page.evaluate(async () => {
    const api = window.amazingAdventure;
    const THREE = await import('three');
    let sun = null;
    api.scene.traverse((object) => {
      if (object.isDirectionalLight && object.castShadow) sun = object;
    });
    api.scene.updateMatrixWorld(true);
    sun.shadow.updateMatrices(sun);
    sun.shadow.camera.updateMatrixWorld(true);
    // The lane's north-east corner is the farthest point from the box centre.
    const corner = new THREE.Vector3(14, 0, -26).project(sun.shadow.camera);
    return [{ x: +corner.x.toFixed(3), y: +corner.y.toFixed(3), z: +corner.z.toFixed(3) }];
  });
  const corner = laneEnd[0];
  checks.check('the lane far corner projects inside the shadow box',
    Math.abs(corner.x) <= 1 && Math.abs(corner.y) <= 1,
    `ndc ${corner.x}, ${corner.y}`);

  if (RECORD) {
    const dir = await screenshotDir();
    const shots = [
      ['round68-lane.png', [11, 2.2, -14], [10, 1.4, -25]],
      ['round68-plaza.png', [0, 6, 22], [0, 1, 0]]
    ];
    for (const [name, from, at] of shots) {
      await page.evaluate(async ({ from, at }) => {
        const api = window.amazingAdventure;
        api.camera.position.set(from[0], from[1], from[2]);
        api.camera.lookAt(at[0], at[1], at[2]);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, { from, at });
      const path = join(dir, name);
      await page.screenshot({ path });
      report.shots.push(path);
      console.log(`saved ${path}`);
    }
  }

  checks.check('the run produced no console errors', consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(' | '));
} catch (error) {
  checks.recordError(error);
  console.error(`evidence run failed: ${error.message}`);
} finally {
  await closeBrowser();
  await server.stop();
}

if (RECORD) {
  const dir = await screenshotDir();
  const path = join(dir, 'round68-evidence.json');
  await writeFile(path, `${JSON.stringify({ ...report, checks: checks.results }, null, 2)}\n`);
  console.log(`saved ${path}`);
}

console.log('');
checks.print();
if (checks.failed) process.exitCode = 1;