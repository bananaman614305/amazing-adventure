import * as THREE from 'three';
import { WORLD_SIZE, HALF, TERRACE, STEP_HEIGHT, KEY_SPOT, KEY_PICKUP_RANGE, BENCH, floorHeightAt } from './terrain.js';

// Everything you can see and bump into is built here from plain primitives.
// No outside models or textures, so the whole scene is code. The walkable
// geometry maths lives in terrain.js so it can be tested without Three.js.
export { WORLD_SIZE, TERRACE, STEP_HEIGHT, KEY_SPOT, KEY_PICKUP_RANGE, BENCH, floorHeightAt } from './terrain.js';

/**
 * Builds the courtyard: ground, sky, fog, lights and solid props.
 * Returns the scene, AABB colliders for movement, the day/night handles and a
 * floorHeight(x, z) function for the terrace and ramp.
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

  // --- North terrace + ramp ----------------------------------------------
  const stepStone = new THREE.MeshStandardMaterial({ color: 0x9a9184, roughness: 0.9 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.75 });

  const terrace = new THREE.Mesh(
    new THREE.BoxGeometry(TERRACE.maxX - TERRACE.minX, TERRACE.height, TERRACE.maxZ - TERRACE.minZ),
    stepStone
  );
  terrace.position.set(
    (TERRACE.minX + TERRACE.maxX) / 2,
    TERRACE.height / 2,
    (TERRACE.minZ + TERRACE.maxZ) / 2
  );
  terrace.castShadow = true;
  terrace.receiveShadow = true;
  scene.add(terrace);

  // The ramp rises northward from the plaza to the terrace lip.
  const rampWidth = TERRACE.ramp.maxX - TERRACE.ramp.minX;
  const rampRun = TERRACE.ramp.maxZ - TERRACE.ramp.minZ;
  const rampLength = Math.hypot(TERRACE.height, rampRun);
  const rampSlope = Math.atan2(TERRACE.height, rampRun);
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(rampWidth, 0.24, rampLength), stepStone);
  ramp.position.set(
    (TERRACE.ramp.minX + TERRACE.ramp.maxX) / 2,
    TERRACE.height / 2,
    (TERRACE.ramp.minZ + TERRACE.ramp.maxZ) / 2
  );
  ramp.rotation.x = rampSlope;
  ramp.castShadow = true;
  ramp.receiveShadow = true;
  scene.add(ramp);

  const parapetMaterial = new THREE.MeshStandardMaterial({ color: 0x7f7567, roughness: 0.85 });

  // Side kerbs and rail posts make the ramp read as a built stair, not a wedge.
  for (const x of [TERRACE.ramp.minX - 0.1, TERRACE.ramp.maxX + 0.1]) {
    const kerb = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.45, rampLength), parapetMaterial);
    kerb.position.set(x, TERRACE.height / 2 + 0.22, (TERRACE.ramp.minZ + TERRACE.ramp.maxZ) / 2);
    kerb.rotation.x = rampSlope;
    kerb.castShadow = true;
    scene.add(kerb);

    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.75, 8), woodMat);
      post.position.set(
        x,
        TERRACE.height * t + 0.65,
        TERRACE.ramp.maxZ - rampRun * t
      );
      post.castShadow = true;
      scene.add(post);
    }
  }

  // Low parapet along the terrace lip, split either side of the ramp opening.
  for (const [from, to] of [[TERRACE.minX, TERRACE.ramp.minX], [TERRACE.ramp.maxX, TERRACE.maxX]]) {
    addBox(scene, [], {
      size: [to - from, 0.55, 0.22],
      position: [(from + to) / 2, TERRACE.height + 0.275, TERRACE.maxZ - 0.11],
      material: parapetMaterial,
      castShadow: true
    });
  }
  for (const x of [TERRACE.minX, TERRACE.maxX]) {
    addBox(scene, [], {
      size: [0.22, 0.55, TERRACE.maxZ - TERRACE.minZ],
      position: [x, TERRACE.height + 0.275, (TERRACE.minZ + TERRACE.maxZ) / 2],
      material: parapetMaterial,
      castShadow: true
    });
  }

  // A painted banner over the terrace marks it as the north wall.
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 1.1),
    new THREE.MeshStandardMaterial({ color: 0x2f5d8a, roughness: 0.8, side: THREE.DoubleSide })
  );
  banner.position.set(0, TERRACE.height + 1.5, TERRACE.minZ + 0.08);
  scene.add(banner);

  // --- Props --------------------------------------------------------------
  const stone = new THREE.MeshStandardMaterial({ color: 0x8f8577, roughness: 0.8 });
  const wood = woodMat;
  const roof = new THREE.MeshStandardMaterial({ color: 0x7d3f2f, roughness: 0.7 });
  const water = new THREE.MeshStandardMaterial({ color: 0x4f93c4, roughness: 0.2, metalness: 0.1 });

  // Fountain in the plaza centre: everyone gathers around it.
  addBox(scene, colliders, { size: [4, 0.7, 4], position: [0, 0.35, 0], material: stone });
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.1, 32), water);
  basin.position.set(0, 0.72, 0);
  basin.receiveShadow = true;
  scene.add(basin);
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 1.8, 12), stone);
  pillar.position.set(0, 1.5, 0);
  pillar.castShadow = true;
  scene.add(pillar);

  // A small house on the north-west side gives the space a landmark.
  addBox(scene, colliders, { size: [7, 3, 5], position: [-10.5, 1.5, -9], material: wood, castShadow: true });
  addBox(scene, colliders, { size: [8, 0.6, 6], position: [-10.5, 3.3, -9], material: roof, castShadow: true });
  addBox(scene, colliders, { size: [1.4, 2.2, 0.3], position: [-10.5, 1.1, -6.35], material: stone });

  // Market stalls east and west.
  addBox(scene, colliders, { size: [4, 1, 0.4], position: [11, 0.5, -3], material: wood, castShadow: true });
  addBox(scene, colliders, { size: [4.4, 0.3, 2.6], position: [11, 2.2, -3], material: roof, castShadow: true });
  addBox(scene, colliders, { size: [0.2, 2.2, 0.2], position: [9.3, 1.1, -4.1], material: wood });
  addBox(scene, colliders, { size: [0.2, 2.2, 0.2], position: [12.7, 1.1, -4.1], material: wood });

  addBox(scene, colliders, { size: [3, 0.9, 0.4], position: [-11, 0.45, 6], material: wood, castShadow: true });
  addBox(scene, colliders, { size: [3.4, 0.3, 2.2], position: [-11, 1.7, 6], material: roof, castShadow: true });

  // Crates south-east break up sightlines and hide the brass key nearby.
  addBox(scene, colliders, { size: [1.2, 1.2, 1.2], position: [5, 0.6, 8], material: wood, castShadow: true });
  addBox(scene, colliders, { size: [1.2, 1.2, 1.2], position: [5, 1.8, 8], material: wood, castShadow: true });
  addBox(scene, colliders, { size: [1.2, 1.2, 1.2], position: [6.4, 0.6, 8.3], material: wood, castShadow: true });

  // A bench on the west side: resting here skips to the next phase.
  addBox(scene, colliders, { size: [2.2, 0.5, 0.7], position: [BENCH.x, 0.25, BENCH.z], material: wood, castShadow: true });
  addBox(scene, [], { size: [2.2, 0.6, 0.15], position: [BENCH.x, 0.8, BENCH.z + 0.3], material: wood, castShadow: true });

  for (const [x, z] of [[-5, 9], [-6.2, 9.4], [3, -7.5]]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.3, 16), wood);
    barrel.position.set(x, 0.65, z);
    barrel.castShadow = true;
    barrel.receiveShadow = true;
    scene.add(barrel);
    colliders.push(boxCollider(x - 0.55, z - 0.55, x + 0.55, z + 0.55));
  }

  // Lantern posts around the plaza. Their lights are stored so the day/night
  // cycle can turn them up at dusk.
  const lamps = [];
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

    const point = new THREE.PointLight(0xffc46b, 0, 16, 2);
    point.position.set(x, 3.15, z);
    scene.add(point);
    lamps.push({ light: point, mesh: lamp });

    colliders.push(boxCollider(x - 0.2, z - 0.2, x + 0.2, z + 0.2));
  }

  // --- Lighting -----------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0xbcd8ff, 0x5d5340, 0.75);
  scene.add(hemi);

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

  // --- Key pickup (hidden until Halden sets the quest) --------------------
  const keyGroup = new THREE.Group();
  keyGroup.position.set(KEY_SPOT.x, 0, KEY_SPOT.z);
  const keyMesh = new THREE.Mesh(
    new THREE.TorusGeometry(0.14, 0.045, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0xd9b44a, metalness: 0.85, roughness: 0.3, emissive: 0x3a2a08 })
  );
  keyMesh.rotation.x = Math.PI / 2;
  keyMesh.position.y = 0.22;
  keyMesh.castShadow = true;
  keyGroup.add(keyMesh);
  const keyGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xffd479, transparent: true, opacity: 0.16 })
  );
  keyGlow.position.y = 0.22;
  keyGroup.add(keyGlow);
  keyGroup.visible = false;
  scene.add(keyGroup);

  const environment = {
    scene,
    hemi,
    sun,
    fill,
    lamps,
    keyGroup,
    /** Shows or hides the key pickup. */
    setKeyVisible(visible) {
      keyGroup.visible = Boolean(visible);
    }
  };

  return { scene, colliders, environment, floorHeight: floorHeightAt, terrace: TERRACE };
}

// Sky, sun, fog and lamp settings per phase. Colours are plain values so the
// same table can be unit-tested (tests/daynight.test.mjs).
export const PHASE_LOOKS = {
  day: {
    sky: 0x9fc4e8,
    fog: 0x9fc4e8,
    fogNear: 26,
    fogFar: 62,
    hemiSky: 0xbcd8ff,
    hemiGround: 0x5d5340,
    hemiIntensity: 0.75,
    sunColor: 0xfff1d0,
    sunIntensity: 2.1,
    sunPosition: [16, 22, 10],
    lampIntensity: 0,
    lampGlow: 0.25,
    fillIntensity: 0.35
  },
  dusk: {
    sky: 0xe08a5a,
    fog: 0xd98e63,
    fogNear: 22,
    fogFar: 55,
    hemiSky: 0xffb98a,
    hemiGround: 0x4a3b33,
    hemiIntensity: 0.6,
    sunColor: 0xff9a52,
    sunIntensity: 1.7,
    sunPosition: [-18, 7, 6],
    lampIntensity: 26,
    lampGlow: 2.2,
    fillIntensity: 0.2
  },
  night: {
    sky: 0x0b1730,
    fog: 0x0b1730,
    fogNear: 14,
    fogFar: 42,
    hemiSky: 0x2b3f66,
    hemiGround: 0x14161c,
    hemiIntensity: 0.35,
    sunColor: 0x8fa8d8,
    sunIntensity: 0.35,
    sunPosition: [12, 20, -8],
    lampIntensity: 34,
    lampGlow: 2.8,
    fillIntensity: 0.1
  }
};

/**
 * Applies a phase's look to the environment. Called once per phase change, not
 * every frame, so the change is cheap.
 */
export function applyPhase(environment, phaseId) {
  const look = PHASE_LOOKS[phaseId];
  if (!look) throw new Error(`unknown phase ${phaseId}`);
  const { scene, hemi, sun, fill, lamps } = environment;
  scene.background = new THREE.Color(look.sky);
  scene.fog.color.setHex(look.fog);
  scene.fog.near = look.fogNear;
  scene.fog.far = look.fogFar;
  hemi.color.setHex(look.hemiSky);
  hemi.groundColor.setHex(look.hemiGround);
  hemi.intensity = look.hemiIntensity;
  sun.color.setHex(look.sunColor);
  sun.intensity = look.sunIntensity;
  sun.position.set(look.sunPosition[0], look.sunPosition[1], look.sunPosition[2]);
  fill.intensity = look.fillIntensity;
  for (const lamp of lamps) {
    lamp.light.intensity = look.lampIntensity;
    lamp.mesh.material.emissiveIntensity = look.lampGlow;
  }
  environment.phase = phaseId;
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
  if (height > 0.9 && colliders) {
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
