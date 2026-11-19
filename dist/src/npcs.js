import * as THREE from 'three';
import { floorHeightAt } from './world.js';

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

/** Builds every NPC mesh and returns live handles used by the game loop. */
export function createNPCs(scene) {
  return NPC_DATA.map((data) => {
    const group = new THREE.Group();
    group.position.set(data.routine.day.x, 0, data.routine.day.z);
    group.rotation.y = data.routine.day.facing;

    const coat = new THREE.MeshStandardMaterial({ color: data.colors.coat, roughness: 0.85 });
    const skin = new THREE.MeshStandardMaterial({ color: data.colors.skin, roughness: 0.7 });
    const hair = new THREE.MeshStandardMaterial({ color: data.colors.hair, roughness: 0.9 });
    const boots = new THREE.MeshStandardMaterial({ color: 0x2b2622, roughness: 0.9 });
    const accent = new THREE.MeshStandardMaterial({
      color: data.colors.accent,
      emissive: data.colors.accent,
      emissiveIntensity: 0.15,
      roughness: 0.6
    });

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.26, 1.05, 12), coat);
    body.position.y = 0.85;
    body.castShadow = true;
    group.add(body);

    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.7, 12), boots);
    legs.position.y = 0.35;
    legs.castShadow = true;
    group.add(legs);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 16), skin);
    head.position.y = 1.6;
    head.castShadow = true;
    group.add(head);

    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      hair
    );
    cap.position.y = 1.63;
    cap.castShadow = true;
    group.add(cap);

    const arms = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.16, 0.16), coat);
    arms.position.y = 1.15;
    arms.castShadow = true;
    group.add(arms);

    // A coloured band on the coat so NPCs are told apart at a glance.
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.09, 12, 1, true), accent);
    band.position.y = 1.22;
    group.add(band);

    // A soft marker so NPCs are easy to spot in a busy courtyard.
    const marker = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.22, 8),
      new THREE.MeshStandardMaterial({ color: 0xffd479, emissive: 0xffb43a, emissiveIntensity: 0.9 })
    );
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
      // Where the NPC is heading and when it last changed phase.
      target: { x: spawn.x, z: spawn.z },
      facing: spawn.facing,
      walking: false,
      phase: null,
      lineIndex: 0,
      // Stable talk anchor updated by the game loop (used by tests and hints).
      position: group.position
    };
  });
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

    const bob = npc.walking ? Math.sin(performance.now() / 90 + npc.group.position.x) * 0.05 : 0;
    npc.group.children[0].position.y = 0.85 + bob;
  }
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
