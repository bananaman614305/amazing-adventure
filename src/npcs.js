import * as THREE from 'three';

const NPC_DATA = [
  {
    id: 'mara',
    name: 'Mara the Keeper',
    role: 'Fountain keeper',
    colors: { coat: 0x2f5d8a, skin: 0xd9a983, hair: 0x3a2a1e, marker: 0xffd479 },
    routine: [
      { start: 0, end: 360, activity: 'resting beside the old house', position: [-6, -10], facing: 0.4 },
      { start: 360, end: 720, activity: 'checking the fountain water', position: [3.2, 4.4], facing: -2.4 },
      { start: 720, end: 1080, activity: 'watching the plaza', position: [1.8, 3.2], facing: -1.4 },
      { start: 1080, end: 1440, activity: 'closing the fountain for the night', position: [3.2, 4.4], facing: -2.4 }
    ]
  },
  {
    id: 'oswin',
    name: 'Oswin the Trader',
    role: 'Market trader',
    colors: { coat: 0x7a4b2a, skin: 0xc98f68, hair: 0x1f1a16, marker: 0xf0a850 },
    routine: [
      { start: 0, end: 360, activity: 'counting stock in the house', position: [-6, -10], facing: 0.8 },
      { start: 360, end: 720, activity: 'opening the east stall', position: [10.2, -1.4], facing: 1.9 },
      { start: 720, end: 1080, activity: 'haggling at the east stall', position: [10.2, -1.4], facing: 1.9 },
      { start: 1080, end: 1440, activity: 'locking the stall', position: [10.8, -3], facing: 2.4 }
    ]
  },
  {
    id: 'pip',
    name: 'Pip',
    role: 'Lamp lighter',
    colors: { coat: 0x4a7a4a, skin: 0xe0b892, hair: 0x8a5a2a, marker: 0xffe27a },
    routine: [
      { start: 0, end: 360, activity: 'sleeping under a market awning', position: [-6.5, -10], facing: 0.2 },
      { start: 360, end: 720, activity: 'trimming wicks near the west stall', position: [-4.6, -6.2], facing: 0.8 },
      { start: 720, end: 1080, activity: 'watching the lantern posts', position: [-7, 7], facing: 1.2 },
      { start: 1080, end: 1440, activity: 'lighting the lantern posts', position: [-7, 7], facing: 1.2 }
    ]
  },
  {
    id: 'halden',
    name: 'Halden the Guard',
    role: 'Courtyard guard',
    colors: { coat: 0x5a5a62, skin: 0xd2a07c, hair: 0x221c18, marker: 0xa8c8ff },
    routine: [
      { start: 0, end: 360, activity: 'guarding the west gate', position: [-9.4, 1.2], facing: 1.4 },
      { start: 360, end: 720, activity: 'walking the north wall', position: [-12, 6], facing: 0.2 },
      { start: 720, end: 1080, activity: 'watching the crates', position: [-9.4, 1.2], facing: 1.4 },
      { start: 1080, end: 1440, activity: 'checking the south lantern', position: [-7, 7], facing: 1.1 }
    ]
  },
  {
    id: 'nessa',
    name: 'Nessa the Herald',
    role: 'Town herald',
    colors: { coat: 0x8a3f61, skin: 0xb87852, hair: 0x211716, marker: 0xffb8d4 },
    routine: [
      { start: 0, end: 360, activity: 'writing notices in the house', position: [-7.5, -9], facing: 0.5 },
      { start: 360, end: 720, activity: 'announcing the day near the fountain', position: [-2, 3], facing: -0.6 },
      { start: 720, end: 1080, activity: 'reading news by the plaza', position: [2, 6], facing: 2.8 },
      { start: 1080, end: 1440, activity: 'ringing the evening bell', position: [0, 8], facing: 2.5 }
    ]
  },
  {
    id: 'bram',
    name: 'Bram the Mender',
    role: 'Handyman and mender',
    colors: { coat: 0x6a5137, skin: 0xc99269, hair: 0x302019, marker: 0xd8b58a },
    routine: [
      { start: 0, end: 360, activity: 'sleeping in the workshop corner', position: [-6, -11], facing: 0.3 },
      { start: 360, end: 720, activity: 'inspecting the crate stack', position: [6, 8], facing: 2.1 },
      { start: 720, end: 1080, activity: 'mending a barrel hoop', position: [5, 8], facing: 2.1 },
      { start: 1080, end: 1440, activity: 'putting tools away', position: [6, 8], facing: 2.1 }
    ]
  },
  {
    id: 'iria',
    name: 'Iria the Herbalist',
    role: 'Herbalist',
    colors: { coat: 0x3f7a63, skin: 0xe0b08a, hair: 0x4a2a1c, marker: 0xa8ffcd },
    routine: [
      { start: 0, end: 360, activity: 'sorting dried leaves in the house', position: [-7, -10], facing: 0.6 },
      { start: 360, end: 720, activity: 'laying out herbs at the west stall', position: [-11, 6], facing: -1.1 },
      { start: 720, end: 1080, activity: 'talking with travellers at the stall', position: [-10, 5], facing: -0.8 },
      { start: 1080, end: 1440, activity: 'packing the herb bundles', position: [-11, 6], facing: -1.1 }
    ]
  },
  {
    id: 'tallow',
    name: 'Tallow the Innkeep',
    role: 'Innkeeper',
    colors: { coat: 0x6b3f4a, skin: 0xd8a078, hair: 0x2b1e18, marker: 0xffc08a },
    routine: [
      { start: 0, end: 360, activity: 'closing the inn', position: [-8, -9], facing: 0.1 },
      { start: 360, end: 720, activity: 'airing the inn steps', position: [-8, -9], facing: 0.1 },
      { start: 720, end: 1080, activity: 'serving visitors at the steps', position: [-5, -8], facing: 0.6 },
      { start: 1080, end: 1440, activity: 'lighting the inn sign', position: [-8, -9], facing: 0.1 }
    ]
  }
];

const TALK_RANGE = 2.6;

export function routineAt(npc, minutes) {
  const time = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  return npc.routine.find((part) => time >= part.start && time < part.end) || npc.routine[0];
}

export function createNPCs(scene) {
  return NPC_DATA.map((data) => {
    const group = new THREE.Group();
    const start = data.routine[1];
    group.position.set(start.position[0], 0, start.position[1]);
    group.rotation.y = start.facing;

    const coat = new THREE.MeshStandardMaterial({ color: data.colors.coat, roughness: 0.85 });
    const skin = new THREE.MeshStandardMaterial({ color: data.colors.skin, roughness: 0.7 });
    const hair = new THREE.MeshStandardMaterial({ color: data.colors.hair, roughness: 0.9 });
    const boots = new THREE.MeshStandardMaterial({ color: 0x2b2622, roughness: 0.9 });

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

    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.28, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), hair);
    cap.position.y = 1.63;
    cap.castShadow = true;
    group.add(cap);

    const arms = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.16, 0.16), coat);
    arms.position.y = 1.15;
    arms.castShadow = true;
    group.add(arms);

    const marker = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.22, 8),
      new THREE.MeshStandardMaterial({
        color: data.colors.marker,
        emissive: data.colors.marker,
        emissiveIntensity: 0.9
      })
    );
    marker.position.y = 2.15;
    marker.rotation.x = Math.PI;
    group.add(marker);

    scene.add(group);

    return {
      id: data.id,
      name: data.name,
      role: data.role,
      routine: data.routine,
      group,
      marker
    };
  });
}

export function syncNPCs(npcs, state, dt) {
  const blend = Math.min(1, dt * 1.5);
  for (const npc of npcs) {
    const part = routineAt(npc, state.clockMinutes);
    npc.group.position.x += (part.position[0] - npc.group.position.x) * blend;
    npc.group.position.z += (part.position[1] - npc.group.position.z) * blend;
    npc.group.rotation.y = part.facing;
  }
}

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
