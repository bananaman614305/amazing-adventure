import * as THREE from 'three';

// Round 1 NPCs: simple low-poly people built from primitives, each with a name
// and a couple of lines. Anything deeper than that is Round 2 work.

const NPC_DATA = [
  {
    id: 'mara',
    name: 'Mara the Keeper',
    position: [3.2, 0, 4.4],
    facing: -2.4,
    colors: { coat: 0x2f5d8a, skin: 0xd9a983, hair: 0x3a2a1e },
    lines: [
      'You came on foot? Nobody walks the north road this late.',
      'The fountain still runs. Long as it does, the plaza keeps its peace.'
    ]
  },
  {
    id: 'oswin',
    name: 'Oswin the Trader',
    position: [10.2, 0, -1.4],
    facing: 1.9,
    colors: { coat: 0x7a4b2a, skin: 0xc98f68, hair: 0x1f1a16 },
    lines: [
      'Stall is open. Everything worth having is worth haggling for.',
      'Come back in Round 2 and I might actually sell you something.'
    ]
  },
  {
    id: 'pip',
    name: 'Pip',
    position: [-4.6, 0, -6.2],
    facing: 0.8,
    colors: { coat: 0x4a7a4a, skin: 0xe0b892, hair: 0x8a5a2a },
    lines: [
      'Have you seen the lanterns at dusk? That is the whole reason to live here.',
      'Mara says not to pester the visitors. But you do not look busy.'
    ]
  },
  {
    id: 'halden',
    name: 'Halden the Guard',
    position: [-9.4, 0, 1.2],
    facing: 1.4,
    colors: { coat: 0x5a5a62, skin: 0xd2a07c, hair: 0x221c18 },
    lines: [
      'Keep off the walls and we will get along fine.',
      'Walls are for keeping the weather out. Mostly.'
    ]
  }
];

const TALK_RANGE = 2.6;

export function createNPCs(scene) {
  return NPC_DATA.map((data) => {
    const group = new THREE.Group();
    group.position.set(data.position[0], 0, data.position[2]);
    group.rotation.y = data.facing;

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

    // A soft marker so NPCs are easy to spot in a busy courtyard.
    const marker = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.22, 8),
      new THREE.MeshStandardMaterial({ color: 0xffd479, emissive: 0xffb43a, emissiveIntensity: 0.9 })
    );
    marker.position.y = 2.15;
    marker.rotation.x = Math.PI;
    group.add(marker);

    scene.add(group);

    return {
      id: data.id,
      name: data.name,
      lines: data.lines,
      group,
      marker,
      lineIndex: 0
    };
  });
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
