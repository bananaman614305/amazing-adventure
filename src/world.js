import * as THREE from 'three';

// Everything you can see and bump into is built here from plain primitives.
// No outside models or textures, so the whole scene is code.

export const WORLD_SIZE = 34; // square courtyard, in metres
const HALF = WORLD_SIZE / 2;

/**
 * Builds the courtyard: ground, sky, fog, lights and solid props.
 * Returns the scene plus the list of AABB colliders used for movement.
 */
export function buildWorld(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fc4e8);
  scene.fog = new THREE.Fog(0x9fc4e8, 26, 62);

  const colliders = [];

  // --- Ground -------------------------------------------------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE),
    new THREE.MeshStandardMaterial({ color: 0x8a9c74, roughness: 0.95, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // A paved ring in the middle so the plaza reads differently from the grass.
  const plaza = new THREE.Mesh(
    new THREE.CircleGeometry(9, 48),
    new THREE.MeshStandardMaterial({ color: 0xb3a892, roughness: 0.9 })
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = 0.01;
  plaza.receiveShadow = true;
  scene.add(plaza);

  // --- Border walls -------------------------------------------------------
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x6f6455, roughness: 0.85 });
  const wallHeight = 3.2;
  const wallThickness = 1;

  const sides = [
    { x: 0, z: -HALF, w: WORLD_SIZE, d: wallThickness },
    { x: 0, z: HALF, w: WORLD_SIZE, d: wallThickness },
    { x: -HALF, z: 0, w: wallThickness, d: WORLD_SIZE },
    { x: HALF, z: 0, w: wallThickness, d: WORLD_SIZE }
  ];

  for (const side of sides) {
    addBox(scene, colliders, {
      size: [side.w, wallHeight, side.d],
      position: [side.x, wallHeight / 2, side.z],
      material: wallMaterial
    });
  }

  // --- Props --------------------------------------------------------------
  const stone = new THREE.MeshStandardMaterial({ color: 0x8f8577, roughness: 0.8 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.75 });
  const roof = new THREE.MeshStandardMaterial({ color: 0x7d3f2f, roughness: 0.7 });
  const water = new THREE.MeshStandardMaterial({ color: 0x4f93c4, roughness: 0.2, metalness: 0.1 });

  // Fountain in the plaza centre: everyone gathers around it.
  addBox(scene, colliders, { size: [4, 0.7, 4], position: [0, 0.35, 0], material: stone });
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.1, 32), water);
  basin.name = 'fountain-water';
  basin.position.set(0, 0.72, 0);
  basin.receiveShadow = true;
  scene.add(basin);
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 1.8, 12), stone);
  pillar.name = 'fountain-pillar';
  pillar.position.set(0, 1.5, 0);
  pillar.castShadow = true;
  scene.add(pillar);

  // A small house on the north side gives the space a landmark.
  addBox(scene, colliders, { size: [8, 3, 6], position: [-8, 1.5, -13], material: wood, castShadow: true });
  addBox(scene, colliders, { size: [9, 0.6, 7], position: [-8, 3.3, -13], material: roof, castShadow: true });
  addBox(scene, colliders, { size: [1.4, 2.2, 0.3], position: [-8, 1.1, -10.05], material: stone });

  // Market stalls east and west.
  addBox(scene, colliders, { size: [4, 1, 0.4], position: [11, 0.5, -3], material: wood, castShadow: true });
  addBox(scene, colliders, { size: [4.4, 0.3, 2.6], position: [11, 2.2, -3], material: roof, castShadow: true });
  addBox(scene, colliders, { size: [0.2, 2.2, 0.2], position: [9.3, 1.1, -4.1], material: wood });
  addBox(scene, colliders, { size: [0.2, 2.2, 0.2], position: [12.7, 1.1, -4.1], material: wood });

  addBox(scene, colliders, { size: [3, 0.9, 0.4], position: [-11, 0.45, 6], material: wood, castShadow: true });
  addBox(scene, colliders, { size: [3.4, 0.3, 2.2], position: [-11, 1.7, 6], material: roof, castShadow: true });

  // Crates and barrels to break up sightlines.
  addBox(scene, colliders, { size: [1.2, 1.2, 1.2], position: [5, 0.6, 8], material: wood, castShadow: true });
  addBox(scene, colliders, { size: [1.2, 1.2, 1.2], position: [5, 1.8, 8], material: wood, castShadow: true });
  addBox(scene, colliders, { size: [1.2, 1.2, 1.2], position: [6.4, 0.6, 8.3], material: wood, castShadow: true });

  for (const [x, z] of [[-5, 9], [-6.2, 9.4], [3, -7.5]]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.3, 16), wood);
    barrel.position.set(x, 0.65, z);
    barrel.castShadow = true;
    barrel.receiveShadow = true;
    scene.add(barrel);
    colliders.push(boxCollider(x - 0.55, z - 0.55, x + 0.55, z + 0.55));
  }

  // Lantern posts around the plaza, which also throw light where it matters.
  for (const [x, z] of [[7, 7], [-7, 7], [7, -7], [-7, -7]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 3, 10), wood);
    post.position.set(x, 1.5, z);
    post.castShadow = true;
    scene.add(post);

    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xffd479, emissive: 0xffb43a, emissiveIntensity: 1.6 })
    );
    lamp.position.set(x, 3.15, z);
    scene.add(lamp);

    const point = new THREE.PointLight(0xffc46b, 14, 15, 2);
    point.position.set(x, 3.15, z);
    scene.add(point);

    colliders.push(boxCollider(x - 0.2, z - 0.2, x + 0.2, z + 0.2));
  }

  // --- Lighting -----------------------------------------------------------
  scene.add(new THREE.HemisphereLight(0xbcd8ff, 0x5d5340, 0.75));

  const sun = new THREE.DirectionalLight(0xfff1d0, 2.1);
  sun.position.set(16, 22, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -24;
  sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(sun.target);

  const fill = new THREE.DirectionalLight(0x9fb6d8, 0.35);
  fill.position.set(-14, 10, -12);
  scene.add(fill);

  return { scene, colliders };
}

/** Adds a box mesh and registers the matching floor-plane collider. */
function addBox(scene, colliders, { size, position, material, castShadow = false }) {
  const [width, height, depth] = size;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  scene.add(mesh);

  // Only things a person cannot step over block movement.
  if (height > 0.9) {
    colliders.push(
      boxCollider(
        position[0] - width / 2,
        position[2] - depth / 2,
        position[0] + width / 2,
        position[2] + depth / 2
      )
    );
  }
  return mesh;
}

function boxCollider(minX, minZ, maxX, maxZ) {
  return { minX, minZ, maxX, maxZ };
}

export { boxCollider };
