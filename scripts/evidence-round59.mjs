// Round 59 evidence: the six plaza NPCs are physically placed in the real page.
//
// Before this round the cast had three defects that only a live scene shows:
// figures hovered a few centimetres above the cobbles, several walked backwards
// (nose pointing away from the direction of travel), and role props were either
// detached from their handles or buried inside them. All three came from the
// same root cause: Blender object transforms were exported as glTF node
// translation/scale, and the reader in src/glb.js maps accessor data straight
// into geometry without ever reading node transforms. So the offsets silently
// vanished at load time.
//
// The claims below are measured on the loaded scene graph, not on the files:
//
//   1. Every NPC really is running its Blender model (mode 'model'), not the
//      procedural box fallback.
//   2. Ground contact: each booted NPC's boot sole sits at world y ~ 0, so the
//      figures stand on the cobbles instead of floating.
//   3. Facing: the nose is in front of the head along the NPC's own facing
//      direction, which is local +Z (the game turns bodies with
//      rotation.y = atan2(dx, dz)). A backwards rig fails this.
//   4. Prop attachment: companion props ride the same pivot as the prop they
//      belong to, so a swinging arm cannot leave the lantern behind.
//   5. pip is scaled exactly once, by the game's child factor.
//
// Run: node scripts/evidence-round59.mjs
// Set RECORD_ARTIFACTS=1 to also save screenshots plus artifacts/round59-evidence.json.
//
// The model is text-only, so nothing here claims a picture was looked at. Every
// claim is a scene-graph measurement or a numeric comparison.
import { statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { startServer, launchBrowser, createChecks, screenshotDir, waitForBoot } from './browser.mjs';

const checks = createChecks();

// Measured in Node from the shipped GLBs (tests/cast.test.mjs pins the same
// numbers at asset level): boot soles are authored at hip-relative -0.78 and
// JOINTS.hip.y is 0.78, so a correct rig lands the sole at world 0.
const SOLE_TARGET = 0;
const SOLE_TOLERANCE = 0.03;

// Nose forward offset in body space. The nose sits 0.133-0.170 in front of the
// head centre depending on head size, so anything comfortably positive proves
// the face points along local +Z.
const NOSE_MIN_FORWARD = 0.05;

const IDS = ['mara', 'oswin', 'pip', 'halden', 'sable', 'wren'];
const BOOTED = ['oswin', 'pip', 'halden', 'sable', 'wren'];

// Companion prop -> the prop it must ride alongside. These pairs are attached to
// the same hand pivot by src/npcs.js, so they must share a parent object.
const COMPANIONS = [
  ['mara', 'PropLantern', 'PropPole'],
  ['halden', 'PropSpearTip', 'PropSpear'],
  ['wren', 'PropLedgerPages', 'PropLedger']
];

/**
 * Measures the whole cast inside the page. Runs in the browser.
 *
 * Everything is computed in each NPC's OWN local frame by inverting its world
 * matrix, because the NPC group is rotated to its facing and placed on the
 * ground: world coordinates would mix in that placement and hide a rig bug.
 */
function measureCast() {
  const npcs = window.amazingAdventure.npcs;
  // The page does not expose THREE itself, but every geometry in the scene is a
  // real THREE.BufferGeometry, so its own matrix/box helpers and the
  // constructors on a live material give us what we need.
  const Vector3 = npcs[0].group.position.constructor;
  const out = {};

  for (const npc of npcs) {
    const root = npc.group;
    root.updateWorldMatrix(true, true);
    // npc.group.matrixWorld maps the NPC's own local space to the world, so its
    // inverse takes world-space points back into that local frame.
    const toLocal = root.matrixWorld.clone().invert();

    // Body root: the inner group buildModelled() adds. It carries the child
    // scale for pip and the bob animation.
    let body = null;
    for (const child of root.children) {
      if (child.isGroup && child.name === '') { body = child; break; }
    }

    // Mesh origins all sit at 0 (the build bakes offsets into the vertices), so
    // a mesh's position says nothing about where it is. Its geometry bounding
    // box does. Transform the eight corners by mesh.matrixWorld then toLocal and
    // keep the extremes: that is the mesh's extent in the NPC's own frame.
    const localBox = (mesh) => {
      mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox;
      const corner = new Vector3();
      const min = { x: Infinity, y: Infinity, z: Infinity };
      const max = { x: -Infinity, y: -Infinity, z: -Infinity };
      for (let i = 0; i < 8; i += 1) {
        corner.set(
          i & 1 ? bb.max.x : bb.min.x,
          i & 2 ? bb.max.y : bb.min.y,
          i & 4 ? bb.max.z : bb.min.z
        );
        corner.applyMatrix4(mesh.matrixWorld).applyMatrix4(toLocal);
        min.x = Math.min(min.x, corner.x); max.x = Math.max(max.x, corner.x);
        min.y = Math.min(min.y, corner.y); max.y = Math.max(max.y, corner.y);
        min.z = Math.min(min.z, corner.z); max.z = Math.max(max.z, corner.z);
      }
      return {
        min,
        max,
        center: { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 }
      };
    };

    const record = {
      id: npc.id,
      mode: npc.mode,
      bodyScale: body ? body.scale.x : null,
      meshes: 0,
      noseForward: null,
      soleY: null,
      toeForward: null,
      props: {}
    };

    let noseCenter = null;
    let headCenter = null;

    root.traverse((object) => {
      if (!object.isMesh) return;
      record.meshes += 1;
      const name = object.name;
      if (name === 'Nose' || name === 'Head' || name === 'BootL' || name.startsWith('Prop')) {
        const box = localBox(object);
        if (name === 'Nose') noseCenter = box.center;
        if (name === 'Head') headCenter = box.center;
        if (name === 'BootL') {
          record.soleY = Number(box.min.y.toFixed(4));
          record.toeForward = Number(box.max.z.toFixed(4));
        }
        if (name.startsWith('Prop')) {
          record.props[name] = {
            minY: Number(box.min.y.toFixed(3)),
            maxY: Number(box.max.y.toFixed(3)),
            maxZ: Number(box.max.z.toFixed(3)),
            // The body-root parent proves which pivot the mesh swings with.
            parent: object.parent.name || (object.parent.isGroup ? 'group' : 'other')
          };
        }
      }
    });

    if (noseCenter && headCenter) {
      record.noseForward = Number((noseCenter.z - headCenter.z).toFixed(4));
    }

    // Which pivot each prop actually hangs under, walked up to the nearest named
    // group. Two companion props must resolve to the same pivot.
    const pivotOf = {};
    for (const name of Object.keys(record.props)) {
      let node = root.getObjectByName(name);
      const chain = [];
      while (node && node !== root) {
        if (node.isGroup) chain.push(node.name || '(body)');
        node = node.parent;
      }
      pivotOf[name] = chain[0] || null;
    }
    record.pivots = pivotOf;

    out[npc.id] = record;
  }

  return out;
}

const server = await startServer();
const { browser, close: closeBrowser } = await launchBrowser();
const report = { measurements: null, screenshots: [], shots: [] };

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await page.goto(server.base, { waitUntil: 'domcontentloaded' });
  await waitForBoot(page);
  // The cast loads asynchronously and must never block play, so wait for the
  // game's own readiness signal rather than assuming a fixed delay.
  await page.waitForFunction(() => window.amazingAdventure?.castReady?.then
    ? true
    : Boolean(window.amazingAdventure?.scene), { timeout: 30000 });
  await page.evaluate(() => window.amazingAdventure.castReady);
  await page.waitForFunction(
    () => window.amazingAdventure.npcs.every((n) => n.mode === 'model'),
    { timeout: 30000 }
  );

  const cast = await page.evaluate(measureCast);
  report.measurements = cast;

  // 1. Every NPC is running its modelled body.
  for (const id of IDS) {
    const record = cast[id];
    checks.check(`${id} runs its Blender body, not the box fallback`,
      record && record.mode === 'model' && record.meshes >= 12,
      JSON.stringify({ mode: record?.mode, meshes: record?.meshes }));
  }

  // 2. Ground contact.
  for (const id of BOOTED) {
    const record = cast[id];
    checks.check(`${id} stands on the cobbles (boot sole at world 0)`,
      record && record.soleY !== null &&
        Math.abs(record.soleY - SOLE_TARGET) <= SOLE_TOLERANCE,
      JSON.stringify({ soleY: record?.soleY, target: SOLE_TARGET, tol: SOLE_TOLERANCE }));
  }

  // 3. Facing along the walk direction.
  for (const id of IDS) {
    const record = cast[id];
    checks.check(`${id} faces its walk direction (nose forward on local +Z)`,
      record && record.noseForward !== null && record.noseForward > NOSE_MIN_FORWARD,
      JSON.stringify({ noseForward: record?.noseForward, min: NOSE_MIN_FORWARD }));
  }

  // Toes point the same way as the face: a rig could pass the nose check and
  // still have mirrored boots.
  for (const id of BOOTED) {
    const record = cast[id];
    checks.check(`${id} has toes pointing forward (+Z)`,
      record && record.toeForward !== null && record.toeForward > 0.05,
      JSON.stringify({ toeForward: record?.toeForward }));
  }

  // 4. Companion props ride the same pivot as their parent.
  for (const [id, child, parent] of COMPANIONS) {
    const record = cast[id];
    const childPivot = record?.pivots?.[child];
    const parentPivot = record?.pivots?.[parent];
    checks.check(`${id}: ${child} rides the same pivot as ${parent}`,
      Boolean(childPivot) && childPivot === parentPivot,
      JSON.stringify({ child, childPivot, parent, parentPivot }));
  }

  // The companion geometry itself must still meet its parent, in body space.
  const mara = cast.mara;
  checks.check('mara: the lantern sits at the top of the pole',
    mara && mara.props.PropLantern && mara.props.PropPole &&
      Math.abs(mara.props.PropLantern.maxY - mara.props.PropPole.maxY) < 0.15,
    JSON.stringify({ lanternTop: mara?.props.PropLantern?.maxY, poleTop: mara?.props.PropPole?.maxY }));

  const halden = cast.halden;
  checks.check('halden: the spear point sits on the shaft, not inside it',
    halden && halden.props.PropSpearTip && halden.props.PropSpear &&
      halden.props.PropSpearTip.minY >= halden.props.PropSpear.maxY - 0.02,
    JSON.stringify({ tipMin: halden?.props.PropSpearTip?.minY, shaftMax: halden?.props.PropSpear?.maxY }));

  // 5. pip is scaled exactly once.
  const pip = cast.pip;
  checks.check('pip is scaled exactly once, by the child factor',
    pip && Math.abs(pip.bodyScale - 0.72) < 0.001,
    JSON.stringify({ bodyScale: pip?.bodyScale, expected: 0.72 }));
  checks.check('pip is not double-scaled (boot still reaches the ground)',
    pip && Math.abs(pip.soleY) <= SOLE_TOLERANCE,
    JSON.stringify({ soleY: pip?.soleY }));

  // 6. The cast is still an upgrade, not a dependency: the game's own readiness
  // promise resolved with all six models loaded, and the fallback rig would
  // have left mode 'boxes' on any failure.
  const ready = await page.evaluate(() => window.amazingAdventure.castReady);
  checks.check('the game resolved its cast-ready promise with all six models',
    ready && ready.loaded === IDS.length && ready.mode === 'model',
    JSON.stringify(ready));

  // 7. The plaza actually renders figures in view, not an empty frame. Counting
  // draw calls and visible cast meshes is a numeric stand-in for "something was
  // drawn"; the model is text-only and must not claim to have seen the image.
  const draw = await page.evaluate(() => {
    const app = window.amazingAdventure;
    return {
      calls: app.renderer.info.render.calls,
      triangles: app.renderer.info.render.triangles,
      sceneChildren: app.scene.children.length,
      castInScene: app.npcs.filter((n) => n.group.parent === app.scene).length
    };
  });
  checks.check('the frame draws the plaza with the full cast in the scene',
    draw.calls > 0 && draw.triangles > 1000 && draw.castInScene === IDS.length,
    JSON.stringify(draw));

  if (process.env.RECORD_ARTIFACTS) {
    const dir = await screenshotDir();
    const shots = [
      ['plaza-wide', { x: 0, z: 6, yaw: 0 }],
      ['cast-close', { x: 0, z: 3, yaw: 0 }],
      ['pip-child', { x: -3, z: 2, yaw: 0.6 }]
    ];
    for (const [label, pose] of shots) {
      // The player rig owns the camera. placeAt() is the same primitive the
      // guided-travel code uses, so the screenshots frame the plaza the way a
      // player walking there would see it.
      await page.evaluate((p) => {
        window.amazingAdventure.player.placeAt(p.x, p.z, p.yaw);
      }, pose);
      await new Promise((r) => setTimeout(r, 700));
      const file = resolve(dir, `round59-${label}.png`);
      await page.screenshot({ path: file });
      report.screenshots.push(file);
      // Size is real bytes on disk; it proves the capture wrote pixels, and
      // together with the draw-call count above it is the whole visual claim.
      report.shots.push({ label, file, bytes: statSync(file).size });
    }
  }
} finally {
  await closeBrowser();
  await server.stop();
}

checks.print();
if (checks.failed) process.exitCode = 1;

if (process.env.RECORD_ARTIFACTS) {
  const dir = await screenshotDir();
  const summary = {
    round: 59,
    title: 'cast fidelity: grounding, facing and prop attachment',
    generatedAt: new Date().toISOString(),
    soleTarget: SOLE_TARGET,
    soleTolerance: SOLE_TOLERANCE,
    noseMinForward: NOSE_MIN_FORWARD,
    measurements: report.measurements,
    shots: report.shots.map((s) => ({ label: s.label, file: basename(s.file), bytes: s.bytes })),
    checks: checks.results,
    errors: checks.errors,
    note: 'Every claim here is a scene-graph measurement or a byte count. '
      + 'The model is text-only: no screenshot was looked at.'
  };
  await writeFile(resolve(dir, 'round59-evidence.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`screenshots: ${report.screenshots.join(', ')}`);
  console.log(`wrote ${resolve(dir, 'round59-evidence.json')}`);
}
