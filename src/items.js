import * as THREE from 'three';
import { ITEM_LABELS } from './state.js';

const ITEM_DATA = [
  { id: 'brass-lantern', position: [5.6, 0, 8.3], color: 0xffd479 },
  { id: 'herb-bundle', position: [-10.6, 0, 6.4], color: 0x8ce0a5 }
];

const PICKUP_RANGE = 2.4;

export function createItems(scene) {
  return ITEM_DATA.map((data) => {
    const group = new THREE.Group();
    group.position.set(data.position[0], 0, data.position[1]);

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 16, 12),
      new THREE.MeshStandardMaterial({
        color: data.color,
        emissive: data.color,
        emissiveIntensity: 1.4,
        roughness: 0.35
      })
    );
    glow.position.y = 0.7;
    glow.castShadow = true;
    group.add(glow);

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.2, 0.12, 12),
      new THREE.MeshStandardMaterial({ color: 0x5b4632, roughness: 0.8 })
    );
    base.position.y = 0.58;
    group.add(base);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.16, 0.025, 8, 16),
      new THREE.MeshStandardMaterial({ color: data.color, metalness: 0.4, roughness: 0.4 })
    );
    ring.position.y = 0.96;
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    scene.add(group);

    return { id: data.id, label: ITEM_LABELS[data.id], group, glow };
  });
}

export function syncItems(items, state, dt) {
  const t = performance.now() / 600;
  for (const item of items) {
    item.group.visible = !state.pickedUp.includes(item.id);
    if (!item.group.visible) continue;
    item.glow.position.y = 0.7 + Math.sin(t + item.group.position.x) * 0.08;
    item.glow.rotation.y += dt * 0.8;
  }
}

export function findNearestItem(items, playerPosition, state) {
  let nearest = null;
  let nearestDistance = PICKUP_RANGE;
  for (const item of items) {
    if (state.pickedUp.includes(item.id)) continue;
    const dx = item.group.position.x - playerPosition.x;
    const dz = item.group.position.z - playerPosition.z;
    const distance = Math.hypot(dx, dz);
    if (distance < nearestDistance) {
      nearest = item;
      nearestDistance = distance;
    }
  }
  return nearest;
}
