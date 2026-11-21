import { weightShift, glanceAngle } from './idle.js';
import * as THREE from 'three';
import { floorHeightAt } from './world.js';
import { CAST_ASSETS, loadCast } from './assets.js';

// Round 2 cast. Each NPC has a name, a role, a palette, a routine of spots for
// each phase of the day, and dialogue in dialogue.js (keyed by the same id).

export const NPC_DATA = [
  {
    id: 'mara',
    name: 'Mara the Keeper',
    role: 'Keeper of the plaza',
    colors: { coat: 0x2f5d8a, skin: 0xd9a983, hair: 0x3a2a1e, accent: 0xffd479 },
    routine: {
      day: { x: 3.2, z: 4.4, facing: -2.4 },
      dusk: { x: 6.1, z: 6.1, facing: -2.2 },
      night: { x: 3.2, z: 4.4, facing: -2.4 }
    }
  },
  {
    id: 'oswin',
    name: 'Oswin the Trader',
    role: 'Market trader',
    colors: { coat: 0x7a4b2a, skin: 0xc98f68, hair: 0x1f1a16, accent: 0xc94f3a },
    routine: {
      day: { x: 10.2, z: -1.4, facing: 1.9 },
      dusk: { x: 10.2, z: -0.4, facing: 1.9 },
      night: { x: 9.8, z: -2.4, facing: 1.6 }
    }
  },
  {
    id: 'pip',
    name: 'Pip',
    role: 'Plaza child',
    colors: { coat: 0x4a7a4a, skin: 0xe0b892, hair: 0x8a5a2a, accent: 0x8fd49a },
    routine: {
      day: { x: -4.6, z: -6.2, facing: 0.8 },
      dusk: { x: -2.4, z: -10.8, facing: 0.2 },
      night: { x: -4.6, z: -6.2, facing: 0.8 }
    }
  },
  {
    id: 'halden',
    name: 'Halden the Guard',
    role: 'Gate watch',
    colors: { coat: 0x5a5a62, skin: 0xd2a07c, hair: 0x221c18, accent: 0x8f97a8 },
    routine: {
      day: { x: -9.4, z: 1.2, facing: 1.4 },
      dusk: { x: -0.5, z: -11.2, facing: 0.1 },
      night: { x: -9.4, z: 1.2, facing: 1.4 }
    }
  },
  {
    id: 'sable',
    name: 'Sable the Cartographer',
    role: 'Mapmaker',
    colors: { coat: 0x4b3a63, skin: 0xa87b5a, hair: 0x6b4b2a, accent: 0xc9a6f0 },
    routine: {
      day: { x: -5.2, z: 12.6, facing: 1.1 },
      dusk: { x: -5.2, z: 12.6, facing: 1.1 },
      night: { x: -5.8, z: 11.4, facing: 1.4 }
    }
  },
  {
    // Lives beyond the north gate, so she is only reachable once it is open.
    id: 'wren',
    name: 'Wren the Toll Clerk',
    role: 'Lane clerk',
    colors: { coat: 0x3f5a4a, skin: 0xb98a63, hair: 0x2a2118, accent: 0xf0c46b },
    home: 'lane',
    routine: {
      day: { x: 11.4, z: -22.2, facing: -1.9 },
      dusk: { x: 11.4, z: -22.2, facing: -1.9 },
      night: { x: 9.2, z: -24.0, facing: 0.9 }
    }
  }
];

const TALK_RANGE = 2.6;
const WALK_SPEED = 1.4;
// Joint heights shared by the model rig and the procedural fallback, so
// animateCast() works identically on both.
export const JOINTS = {
  shoulder: { y: 1.32, x: 0.26 },
  hip: { y: 0.78, x: 0.16 },
  neck: { y: 1.32 }
};

/**
 * Builds the procedural fallback figure: the original cylinder body, kept so
 * the plaza stays populated when models are unavailable. Same pivot contract
 * as the modelled rig, so the same animation code drives both.
 */
function buildFallback(data) {
  const group = new THREE.Group();
  const coat = new THREE.MeshStandardMaterial({ color: data.colors.coat, roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: data.colors.skin, roughness: 0.7 });
  const hair = new THREE.MeshStandardMaterial({ color: data.colors.hair, roughness: 0.9 });
  const boots = new THREE.MeshStandardMaterial({ color: 0x2b2622, roughness: 0.9 });
  const accent = new THREE.MeshStandardMaterial({
    color: data.colors.accent, emissive: data.colors.accent,
    emissiveIntensity: 0.15, roughness: 0.6
  });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.26, 1.05, 12), coat);
  body.name = 'Torso';
  body.position.y = 0.85;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 16), skin);
  head.name = 'Head';
  head.position.y = 1.6;
  head.castShadow = true;
  group.add(head);

  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), hair
  );
  cap.name = 'Hair';
  cap.position.y = 1.63;
  cap.castShadow = true;
  group.add(cap);

  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(0.29, 0.29, 0.09, 12, 1, true), accent
  );
  band.name = 'Accent';
  band.position.y = 1.22;
  group.add(band);

  const limbs = {};
  for (const side of ['L', 'R']) {
    const pivot = new THREE.Group();
    pivot.name = `LimbArm${side}`;
    pivot.position.set(side === 'L' ? -JOINTS.shoulder.x : JOINTS.shoulder.x, JOINTS.shoulder.y, 0);
    const limb = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.5, 0.13), coat);
    limb.position.y = -0.25;
    limb.castShadow = true;
    pivot.add(limb);
    group.add(pivot);
    limbs[`arm${side}`] = pivot;

    const legPivot = new THREE.Group();
    legPivot.name = `LimbLeg${side}`;
    legPivot.position.set(side === 'L' ? -JOINTS.hip.x : JOINTS.hip.x, JOINTS.hip.y, 0);
    const legMesh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.78, 0.15), boots);
    legMesh.position.y = -0.39;
    legMesh.castShadow = true;
    legPivot.add(legMesh);
    group.add(legPivot);
    limbs[`leg${side}`] = legPivot;
  }
  return { group, limbs, mode: 'boxes' };
}

/**
 * Builds the modelled rig from a loaded cast GLB. Limb meshes are re-parented
 * under pivot groups at their joints, exactly matching the fallback layout.
 * Carried props (Prop*) are attached to the named hand; other props stay on
 * the body.
 */
function buildModelled(data, result) {
  const group = new THREE.Group();
  const pivots = {};
  for (const side of ['L', 'R']) {
    for (const kind of ['Arm', 'Leg']) {
      const pivot = new THREE.Group();
      const key = `Limb${kind}${side}`;
      pivot.name = key;
      const joint = kind === 'Arm' ? JOINTS.shoulder : JOINTS.hip;
      pivot.position.set(side === 'L' ? -joint.x : joint.x, joint.y, 0);
      group.add(pivot);
      pivots[key] = pivot;
    }
  }

  // Pip is authored at 0.72 scale in Blender via object scale; the loader bakes
  // transforms, so apply the same scale here for the procedural rig parity.
  const scale = data.id === 'pip' ? 0.72 : 1;

  // Neck pivot: the head assembly is authored around it, so the head can turn
  // toward the player without rotating the torso.
  const neck = new THREE.Group();
  neck.name = 'NeckPivot';
  neck.position.set(0, JOINTS.neck.y, 0);
  group.add(neck);
  pivots.NeckPivot = neck;

  // Meshes authored around a joint must ride that joint's pivot. Hands, thumbs
  // and pauldrons belong to the arm; boots to the leg. Getting this wrong puts
  // them at the body root, which renders hands at knee height and boots below
  // the floor -- a bug that shipped in round 44 and is fixed here.
  const jointParent = {
    HandL: 'LimbArmL', ThumbL: 'LimbArmL', PauldronL: 'LimbArmL',
    HandR: 'LimbArmR', ThumbR: 'LimbArmR', PauldronR: 'LimbArmR',
    BootL: 'LimbLegL', BootR: 'LimbLegR',
    Head: 'NeckPivot', Nose: 'NeckPivot', Mouth: 'NeckPivot',
    Hair: 'NeckPivot', HairBun: 'NeckPivot', HairTail: 'NeckPivot',
    EyeWhiteL: 'NeckPivot', EyeWhiteR: 'NeckPivot',
    EyeIrisL: 'NeckPivot', EyeIrisR: 'NeckPivot'
  };

  const hands = { L: pivots.LimbArmL, R: pivots.LimbArmR };
  for (const { name, geometry, material } of result.meshes) {
    if (name.startsWith('Prop')) continue; // handled after pivots exist
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = true;
    const parentKey = jointParent[name] || name;
    if (pivots[parentKey]) {
      pivots[parentKey].add(mesh);
    } else {
      group.add(mesh);
    }
  }
  // Props: attach to a hand pivot so they swing with the arm.
  const propHand = {
    PropPole: 'R', PropSpear: 'R', PropMap: 'L', PropLedger: 'L', PropHoop: 'L'
  };
  for (const { name, geometry, material } of result.meshes) {
    if (!name.startsWith('Prop')) continue;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = true;
    const side = propHand[name];
    if (side) hands[side].add(mesh);
    else group.add(mesh);
  }

  group.scale.setScalar(scale);
  // Expose the iris meshes so animateCast() can blink them.
  let eyeIrisL = null;
  let eyeIrisR = null;
  group.traverse((o) => {
    if (!o.isMesh) return;
    if (o.name === 'EyeIrisL') eyeIrisL = o;
    if (o.name === 'EyeIrisR') eyeIrisR = o;
  });
  return { group, limbs: {
    armL: pivots.LimbArmL, armR: pivots.LimbArmR,
    legL: pivots.LimbLegL, legR: pivots.LimbLegR,
    neck: pivots.NeckPivot, eyeIrisL, eyeIrisR
  }, mode: 'model' };
}

/**
 * Builds every NPC and returns live handles used by the game loop. Figures are
 * the modelled rigs when the cast GLBs are available, else the procedural
 * fallback -- same pivots, so animation and tests are identical either way.
 */
export function createNPCs(scene) {
  return NPC_DATA.map((data) => {
    const built = buildFallback(data);
    const group = built.group;
    group.position.set(data.routine.day.x, 0, data.routine.day.z);
    group.rotation.y = data.routine.day.facing;

    // A soft marker so NPCs are easy to spot in a busy courtyard.
    const marker = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.22, 8),
      new THREE.MeshStandardMaterial({ color: 0xffd479, emissive: 0xffb43a, emissiveIntensity: 0.9 })
    );
    marker.name = 'Marker';
    marker.position.y = 2.15;
    marker.rotation.x = Math.PI;
    group.add(marker);

    scene.add(group);

    const spawn = data.routine.day;
    return {
      id: data.id,
      name: data.name,
      role: data.role,
      colors: data.colors,
      routine: data.routine,
      group,
      marker,
      limbs: built.limbs,
      mode: built.mode,
      target: { x: spawn.x, z: spawn.z },
      facing: spawn.facing,
      walking: false,
      phase: null,
      lineIndex: 0,
      position: group.position
    };
  });
}

/**
 * Upgrades every NPC from the procedural fallback to its modelled rig.
 * Resolves once all six models have been attempted; keeps the fallback when a
 * model fails, so a missing GLB can never empty the plaza.
 */
export async function upgradeNPCs(npcs, { THREE, loadGlb, fetchImpl = fetch } = {}) {
  if (!THREE || !loadGlb) return 'boxes';
  const results = await Promise.all(npcs.map(async (npc) => {
    const url = CAST_ASSETS[npc.id];
    if (!url) return { npc, ok: false };
    const result = await loadCast({ THREE, loadGlb, url, fetchImpl });
    if (!result.ok) return { npc, ok: false, reason: result.reason };
    // Remove the fallback figure but keep the group (position, marker, state).
    const doomed = [];
    npc.group.traverse((o) => {
      if (o.isMesh && o.name !== 'Marker') doomed.push(o);
    });
    for (const mesh of doomed) {
      mesh.parent.remove(mesh);
    }
    const built = buildModelled(npc, result);
    npc.group.add(built.group);
    npc.limbs = built.limbs;
    npc.mode = 'model';
    npc.bytes = result.bytes;
    return { npc, ok: true };
  }));
  const loaded = results.filter((r) => r.ok).length;
  return { loaded, total: npcs.length, mode: loaded === npcs.length ? 'model' : 'mixed' };
}

/**
 * Sends each NPC to its spot for `phaseId` and lets it walk there over time.
 * Only the target changes here; movement happens in updateNPCs.
 */
export function setNPCRoutine(npcs, phaseId) {
  for (const npc of npcs) {
    const spot = npc.routine[phaseId];
    if (!spot) continue;
    npc.phase = phaseId;
    npc.target = { x: spot.x, z: spot.z, facing: spot.facing };
  }
}

/**
 * Walks NPCs toward their targets and turns them to face the player when the
 * player is close. Returns nothing; mutates the groups.
 */
export function updateNPCs(npcs, dt, playerPosition) {
  for (const npc of npcs) {
    const target = npc.target;
    const dx = target.x - npc.group.position.x;
    const dz = target.z - npc.group.position.z;
    const distance = Math.hypot(dx, dz);
    npc.walking = false;

    if (distance > 0.08) {
      const step = Math.min(distance, WALK_SPEED * dt);
      npc.group.position.x += (dx / distance) * step;
      npc.group.position.z += (dz / distance) * step;
      npc.group.position.y = floorHeightAt(npc.group.position.x, npc.group.position.z);
      const heading = Math.atan2(dx, dz);
      npc.group.rotation.y = turnToward(npc.group.rotation.y, heading, dt * 6);
      npc.walking = true;
    } else {
      const towardPlayer = playerPosition
        ? Math.atan2(playerPosition.x - npc.group.position.x, playerPosition.z - npc.group.position.z)
        : target.facing ?? npc.group.rotation.y;
      const playerDistance = playerPosition
        ? Math.hypot(playerPosition.x - npc.group.position.x, playerPosition.z - npc.group.position.z)
        : Infinity;
      const desired = playerDistance < TALK_RANGE + 1.5 ? towardPlayer : (target.facing ?? npc.group.rotation.y);
      npc.group.rotation.y = turnToward(npc.group.rotation.y, desired, dt * 4);
    }

    animateCast(npc, dt, undefined, playerPosition);
  }
}

/**
 * Drives the limb pivots: a walk cycle when moving, a gentle idle sway when
 * standing. Works identically on modelled and fallback rigs because both hang
 * their limbs under pivots at the same joints. Phase comes from world time so
 * the cast does not march in perfect lockstep; each character is offset by its
 * spawn position.
 */
export function animateCast(npc, dt, time = performance.now() / 1000, playerPosition = null) {
  const { limbs } = npc;
  if (!limbs) return;
  const t = time + npc.group.position.x * 1.7;
  if (npc.walking) {
    const swing = Math.sin(t * 6.2) * 0.55;
    // Clear the idle lean so a weight shift does not carry into the stride.
    if (limbs.legL) limbs.legL.rotation.z = 0;
    if (limbs.legR) limbs.legR.rotation.z = 0;
    if (limbs.legL) limbs.legL.rotation.x = swing;
    if (limbs.legR) limbs.legR.rotation.x = -swing;
    if (limbs.armL) limbs.armL.rotation.x = -swing * 0.7;
    if (limbs.armR) limbs.armR.rotation.x = swing * 0.7;
  } else {
    // Idle: a slow breath in the arms, and a lateral weight shift in the legs
    // so the figure rocks from foot to foot rather than standing bolt upright.
    const sway = Math.sin(t * 1.4) * 0.06;
    if (limbs.armL) limbs.armL.rotation.x = sway;
    if (limbs.armR) limbs.armR.rotation.x = -sway;
    const shift = weightShift(time, npc.group.position.z);
    if (limbs.legL) limbs.legL.rotation.z = shift;
    if (limbs.legR) limbs.legR.rotation.z = -shift;
    if (limbs.legL) limbs.legL.rotation.x = 0;
    if (limbs.legR) limbs.legR.rotation.x = 0;
  }
  // Attention: within talking range, turn the head toward the player, with a
  // little overshoot-free easing. Beyond it, ease the head back to centre.
  if (limbs.neck) {
    // With nobody nearby the cast still looks around occasionally, so the
    // plaza is not six statues staring at their routine spot.
    let desired = glanceAngle(time, npc.group.position.z);
    if (playerPosition) {
      const dx = playerPosition.x - npc.group.position.x;
      const dz = playerPosition.z - npc.group.position.z;
      if (Math.hypot(dx, dz) < TALK_RANGE + 1.5) {
        // Angle of the player relative to where the body faces.
        desired = Math.atan2(dx, dz) - npc.group.rotation.y;
        while (desired > Math.PI) desired -= Math.PI * 2;
        while (desired < -Math.PI) desired += Math.PI * 2;
        // The head cannot spin round: clamp to a believable nod range.
        desired = Math.max(-0.9, Math.min(0.9, desired));
      }
    }
    limbs.neck.rotation.y += (desired - limbs.neck.rotation.y) * Math.min(1, dt * 4);
  }
  // Blink: each character blinks on its own phase offset, iris squashed for
  // ~0.12 s. The sclera stays, so the eye reads as closing, not vanishing.
  const blinkPhase = (t * 0.42 + npc.group.position.z * 0.37) % 3.2;
  const blink = blinkPhase < 0.06 ? 0.15 : 1;
  if (limbs.eyeIrisL) limbs.eyeIrisL.scale.y = blink;
  if (limbs.eyeIrisR) limbs.eyeIrisR.scale.y = blink;
}

/** Shortest-path angle interpolation so NPCs do not spin the long way round. */
function turnToward(current, desired, maxStep) {
  let delta = desired - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  if (Math.abs(delta) <= maxStep) return desired;
  return current + Math.sign(delta) * maxStep;
}

/** Returns the nearest NPC within talking range, or null. */
export function findNearestNPC(npcs, playerPosition) {
  let nearest = null;
  let nearestDistance = TALK_RANGE;
  for (const npc of npcs) {
    const dx = npc.group.position.x - playerPosition.x;
    const dz = npc.group.position.z - playerPosition.z;
    const distance = Math.hypot(dx, dz);
    if (distance < nearestDistance) {
      nearest = npc;
      nearestDistance = distance;
    }
  }
  return nearest;
}

export { TALK_RANGE };
