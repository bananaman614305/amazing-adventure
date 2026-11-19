import * as THREE from 'three';
import { WORLD_SIZE, HALF, TERRACE, STEP_HEIGHT, KEY_SPOT, KEY_PICKUP_RANGE, BENCH, floorHeightAt } from './terrain.js';
import {
  GATE, LANE, LANE_PROPS, NOTICE_BOARD, NORTH_WALL_SEGMENTS, LEDGER_SPOT, JOB_BOARD
} from './areas.js';
import {
  FOUNTAIN_SPOT, FOUNTAIN_COLLIDER, canLoadAssets, textureRepeat,
  stoneMaterialParams, loadFountain, loadMaterialTextures,
  BARREL_ASSET, BARREL_MODEL_SIZE, loadBarrel, STALL_ASSET, STALL_MODEL_SIZE, loadStall,
  LAMP_ASSET, LAMP_MODEL_SIZE, loadLamp, MARKET_STALL_ASSET, MARKET_STALL_MODEL_SIZE,
  loadMarketStall, BENCH_ASSET, BENCH_MODEL_SIZE, loadBench,
  NOTICE_ASSET, NOTICE_MODEL_SIZE, loadNotice,
  WOOD_TEXTURE_FILES, STONE_TEXTURE_FILES, BRICK_TEXTURE_FILES, PLASTER_TEXTURE_FILES
} from './assets.js';
import { loadGlb } from './glb.js';

// Almost everything you can see and bump into is built here from plain
// primitives, so the scene has no runtime dependency on a binary asset. The
// exception is the plaza fountain, which is a modelled GLB loaded in the
// background: it is an upgrade over the procedural stand-in below, never a
// requirement. The walkable geometry maths lives in terrain.js so it can be
// tested without Three.js.
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
  // Its material is created from the asset rules so the flat-colour fallback and
  // the textured version differ in exactly one place.
  const plazaBase = stoneMaterialParams(false);
  const plazaMaterial = new THREE.MeshStandardMaterial({
    color: plazaBase.color, roughness: plazaBase.roughness, metalness: plazaBase.metalness
  });
  const plaza = new THREE.Mesh(
    new THREE.CircleGeometry(9, 48),
    plazaMaterial
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = 0.01;
  plaza.receiveShadow = true;
  scene.add(plaza);

  // --- Border walls -------------------------------------------------------
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x6f6455, roughness: 0.85 });
  const wallHeight = 3.2;
  const wallThickness = 1;

  // The north wall is split either side of the gate so the gate opening can be
  // opened and closed by its own collider (see the gate block below).
  const sides = [
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

  for (const segment of NORTH_WALL_SEGMENTS) {
    const width = segment.maxX - segment.minX;
    addBox(scene, colliders, {
      size: [width, wallHeight, wallThickness],
      position: [(segment.minX + segment.maxX) / 2, wallHeight / 2, -HALF],
      material: wallMaterial
    });
  }

  // --- The north gate ----------------------------------------------------
  // Two stone piers frame the opening; the door itself is a slab that lifts
  // when the gate is unlocked.
  const pierMaterial = new THREE.MeshStandardMaterial({ color: 0x7b7163, roughness: 0.82 });
  for (const x of [GATE.minX - 0.35, GATE.maxX + 0.35]) {
    addBox(scene, colliders, {
      size: [0.7, wallHeight + 0.9, 1.4],
      position: [x, (wallHeight + 0.9) / 2, -HALF],
      material: pierMaterial,
      castShadow: true
    });
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(GATE.width + 1.4, 0.55, 1.4), pierMaterial);
  lintel.position.set(GATE.x, wallHeight + 0.62, -HALF);
  lintel.castShadow = true;
  scene.add(lintel);

  const gateDoor = new THREE.Mesh(
    new THREE.BoxGeometry(GATE.width, wallHeight - 0.3, 0.28),
    new THREE.MeshStandardMaterial({ color: 0x5e4a33, roughness: 0.7, metalness: 0.1 })
  );
  gateDoor.position.set(GATE.x, (wallHeight - 0.3) / 2, -HALF);
  gateDoor.castShadow = true;
  scene.add(gateDoor);

  // The gate collider is separate from the walls so it can be removed.
  const gateCollider = boxCollider(GATE.minX, -HALF - 0.5, GATE.maxX, -HALF + 0.5);
  colliders.push(gateCollider);

  // --- The market lane, north of the gate --------------------------------
  const laneFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(LANE.maxX - LANE.minX, LANE.maxZ - LANE.minZ),
    new THREE.MeshStandardMaterial({ color: 0x9d9182, roughness: 0.93 })
  );
  laneFloor.rotation.x = -Math.PI / 2;
  laneFloor.position.set(
    (LANE.minX + LANE.maxX) / 2,
    0.02,
    (LANE.minZ + LANE.maxZ) / 2
  );
  laneFloor.receiveShadow = true;
  scene.add(laneFloor);

  // Lane walls: two long sides and a far end, leaving the gate end open.
  const laneWall = new THREE.MeshStandardMaterial({ color: 0x6a6053, roughness: 0.88 });
  const laneWallHeight = 3.0;
  for (const x of [LANE.minX, LANE.maxX]) {
    addBox(scene, colliders, {
      size: [0.8, laneWallHeight, LANE.maxZ - LANE.minZ],
      position: [x, laneWallHeight / 2, (LANE.minZ + LANE.maxZ) / 2],
      material: laneWall
    });
  }
  addBox(scene, colliders, {
    size: [LANE.maxX - LANE.minX + 1.6, laneWallHeight, 0.8],
    position: [(LANE.minX + LANE.maxX) / 2, laneWallHeight / 2, LANE.minZ],
    material: laneWall
  });
  // Short returns to the plaza wall, closing the gap beside the gate.
  for (const [x, toX] of [[LANE.minX, GATE.minX], [GATE.maxX, LANE.maxX]]) {
    if (toX <= x) continue;
    addBox(scene, colliders, {
      size: [toX - x, laneWallHeight, 0.8],
      position: [(x + toX) / 2, laneWallHeight / 2, LANE.maxZ],
      material: laneWall
    });
  }

  // Props make the lane read as a working back street.
  const laneWood = new THREE.MeshStandardMaterial({ color: 0x7a5232, roughness: 0.8 });
  const laneRoof = new THREE.MeshStandardMaterial({ color: 0x6d3a2c, roughness: 0.75 });
  for (const prop of LANE_PROPS) {
    if (prop.kind === 'post') {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.16, prop.height, 10),
        laneWood
      );
      post.position.set(prop.x, prop.height / 2, prop.z);
      post.castShadow = true;
      scene.add(post);
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.24, 14, 10),
        new THREE.MeshStandardMaterial({ color: 0xffd479, emissive: 0xffb43a, emissiveIntensity: 0.9 })
      );
      lamp.position.set(prop.x, prop.height + 0.1, prop.z);
      scene.add(lamp);
      colliders.push(boxCollider(prop.x - 0.25, prop.z - 0.25, prop.x + 0.25, prop.z + 0.25));
    } else if (prop.kind === 'barrel') {
      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.5, prop.height, 16),
        laneWood
      );
      barrel.position.set(prop.x, prop.height / 2, prop.z);
      barrel.castShadow = true;
      barrel.receiveShadow = true;
      scene.add(barrel);
      colliders.push(boxCollider(
        prop.x - prop.width / 2, prop.z - prop.depth / 2,
        prop.x + prop.width / 2, prop.z + prop.depth / 2
      ));
    } else {
      addBox(scene, colliders, {
        size: [prop.width, prop.height, prop.depth],
        position: [prop.x, prop.height / 2, prop.z],
        material: prop.kind === 'stall' ? laneWood : laneRoof,
        castShadow: true
      });
      if (prop.kind === 'stall') {
        const roofBox = addBox(scene, [], {
          size: [prop.width + 0.5, 0.25, prop.depth + 0.4],
          position: [prop.x, prop.height + 0.15, prop.z],
          material: laneRoof,
          castShadow: true
        });
        roofBox.userData = { stallStandin: true };
        // The counter box added just above is the previous scene child.
        const counterBox = scene.children[scene.children.length - 2];
        if (counterBox && counterBox.isMesh) {
          counterBox.userData = counterBox.userData || {};
          counterBox.userData.stallStandin = true;
        }
      }
    }
  }

  // The notice board: readable, and the only thing in the lane that talks back.
  const boardFrame = addBox(scene, [], {
    size: [0.24, NOTICE_BOARD.height, 1.5],
    position: [NOTICE_BOARD.x, NOTICE_BOARD.height / 2, NOTICE_BOARD.z],
    material: laneWood,
    castShadow: true
  });
  boardFrame.rotation.y = Math.PI / 2;
  boardFrame.userData = { noticeStandin: true };
  const boardFace = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 1.2),
    new THREE.MeshStandardMaterial({ color: 0xd8c9a8, roughness: 0.95 })
  );
  boardFace.position.set(NOTICE_BOARD.x - 0.14, 1.25, NOTICE_BOARD.z);
  boardFace.rotation.y = -Math.PI / 2;
  boardFace.userData = { noticeStandin: true };
  scene.add(boardFace);
  colliders.push(boxCollider(
    NOTICE_BOARD.x - 0.3, NOTICE_BOARD.z - 0.9,
    NOTICE_BOARD.x + 0.3, NOTICE_BOARD.z + 0.9
  ));

  // A row of hanging lights so the lane is not a dark tunnel at dusk.
  const laneLamps = [];
  for (const z of [-19.5, -22.5, -25.2]) {
    const light = new THREE.PointLight(0xffc46b, 0, 9, 2);
    light.position.set(LANE.minX + 3.2, 2.6, z);
    scene.add(light);
    laneLamps.push(light);
  }

  // --- North terrace + ramp ----------------------------------------------
  const stepStone = new THREE.MeshStandardMaterial({ color: 0x9a9184, roughness: 0.9 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.75 });
  // The house walls get brick; stalls, crates, bench and lamp posts stay wood.
  // Both are upgraded in place by upgradeWoodBrick() if the maps load.
  const brickMat = new THREE.MeshStandardMaterial({ color: 0x8b4a3a, roughness: 0.9 });

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
  // It is only 0.55m tall, so addBox's "can a person step over it" rule would leave
  // it walk-through -- and behind it is a 1.2m drop, which is exactly the edge the
  // wall exists to mark. These get colliders explicitly for that reason: walking off
  // the terrace should take the ramp, not the shortest line over the lip.
  for (const [from, to] of [[TERRACE.minX, TERRACE.ramp.minX], [TERRACE.ramp.maxX, TERRACE.maxX]]) {
    addBox(scene, [], {
      size: [to - from, 0.55, 0.22],
      position: [(from + to) / 2, TERRACE.height + 0.275, TERRACE.maxZ - 0.11],
      material: parapetMaterial,
      castShadow: true
    });
    // The collider is a thin line at the lip itself, spanning the open width so the
    // player cannot squeeze past the end of the parapet either.
    colliders.push(boxCollider(from, TERRACE.maxZ - 0.22, to, TERRACE.maxZ));
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
  //
  // A simple stand-in is built synchronously so the plaza is never empty, and the
  // modelled fountain replaces it when (and only if) it loads. The collider is
  // registered once, sized for the real model, so gameplay does not change when
  // the upgrade arrives.
  const fountainGroup = new THREE.Group();
  fountainGroup.name = 'fountain';
  scene.add(fountainGroup);

  const standIn = new THREE.Group();
  standIn.name = 'fountain-standin';
  addBox(standIn, [], { size: [4, 0.7, 4], position: [0, 0.35, 0], material: stone });
  const standInBasin = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.1, 32), water);
  standInBasin.position.set(0, 0.72, 0);
  standInBasin.receiveShadow = true;
  standIn.add(standInBasin);
  const standInPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 1.8, 12), stone);
  standInPillar.position.set(0, 1.5, 0);
  standInPillar.castShadow = true;
  standIn.add(standInPillar);
  fountainGroup.add(standIn);

  colliders.push(boxCollider(
    FOUNTAIN_SPOT.x - FOUNTAIN_COLLIDER, FOUNTAIN_SPOT.z - FOUNTAIN_COLLIDER,
    FOUNTAIN_SPOT.x + FOUNTAIN_COLLIDER, FOUNTAIN_SPOT.z + FOUNTAIN_COLLIDER
  ));

  // A small house on the north-west side gives the space a landmark.
  addBox(scene, colliders, { size: [7, 3, 5], position: [-10.5, 1.5, -9], material: brickMat, castShadow: true });
  addBox(scene, colliders, { size: [8, 0.6, 6], position: [-10.5, 3.3, -9], material: roof, castShadow: true });
  addBox(scene, colliders, { size: [1.4, 2.2, 0.3], position: [-10.5, 1.1, -6.35], material: stone });

  // Market stalls east and west.
  const eastCounter = addBox(scene, colliders, { size: [4, 1, 0.4], position: [11, 0.5, -3], material: wood, castShadow: true });
  eastCounter.userData = { marketStallStandin: true, marketStallSize: 'large' };
  addBox(scene, colliders, { size: [4.4, 0.3, 2.6], position: [11, 2.2, -3], material: roof, castShadow: true });
  addBox(scene, colliders, { size: [0.2, 2.2, 0.2], position: [9.3, 1.1, -4.1], material: wood });
  addBox(scene, colliders, { size: [0.2, 2.2, 0.2], position: [12.7, 1.1, -4.1], material: wood });

  const westCounter = addBox(scene, colliders, { size: [3, 0.9, 0.4], position: [-11, 0.45, 6], material: wood, castShadow: true });
  westCounter.userData = { marketStallStandin: true, marketStallSize: 'small' };
  addBox(scene, colliders, { size: [3.4, 0.3, 2.2], position: [-11, 1.7, 6], material: roof, castShadow: true });

  // Crates south-east break up sightlines and hide the brass key nearby.
  addBox(scene, colliders, { size: [1.2, 1.2, 1.2], position: [5, 0.6, 8], material: wood, castShadow: true });
  addBox(scene, colliders, { size: [1.2, 1.2, 1.2], position: [5, 1.8, 8], material: wood, castShadow: true });
  addBox(scene, colliders, { size: [1.2, 1.2, 1.2], position: [6.4, 0.6, 8.3], material: wood, castShadow: true });

  // The plaza work board: a post with a pinned list of odd jobs. Placed on the
  // walk between the gate and Mara so it is hard to miss, and usable at any
  // standing -- it is the one way to build goodwill before you need it.
  {
    const postHeight = JOB_BOARD.height;
    addBox(scene, colliders, {
      size: [0.22, postHeight, 0.22],
      position: [JOB_BOARD.x - 0.55, postHeight / 2, JOB_BOARD.z],
      material: wood,
      castShadow: true
    });
    addBox(scene, colliders, {
      size: [0.22, postHeight, 0.22],
      position: [JOB_BOARD.x + 0.55, postHeight / 2, JOB_BOARD.z],
      material: wood,
      castShadow: true
    });
    // The pinned face itself, angled to look down the plaza.
    const boardFace = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 0.9),
      new THREE.MeshStandardMaterial({ color: 0xd8c9a8, roughness: 0.95 })
    );
    boardFace.position.set(JOB_BOARD.x, 1.3, JOB_BOARD.z + 0.13);
    scene.add(boardFace);
    // Pinned slips of paper, so it reads as a job board from a distance.
    for (let i = 0; i < 3; i += 1) {
      const slip = new THREE.Mesh(
        new THREE.PlaneGeometry(0.22, 0.3),
        new THREE.MeshStandardMaterial({ color: 0xf2ead6, roughness: 1 })
      );
      slip.position.set(JOB_BOARD.x - 0.34 + i * 0.34, 1.26 + (i % 2) * 0.14, JOB_BOARD.z + 0.14);
      scene.add(slip);
    }
  }

  // A bench on the west side: resting here skips to the next phase.
  const benchSeat = addBox(scene, colliders, { size: [2.2, 0.5, 0.7], position: [BENCH.x, 0.25, BENCH.z], material: wood, castShadow: true });
  benchSeat.userData = { benchStandin: true };
  const benchBack = addBox(scene, [], { size: [2.2, 0.6, 0.15], position: [BENCH.x, 0.8, BENCH.z + 0.3], material: wood, castShadow: true });
  benchBack.userData = { benchStandin: true };

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
  // Where the model's lantern actually ends up, in metres from the post origin.
  // Derived from art/blender/make_lamp.py: arm at post_height-0.15, lantern
  // centred half a lantern below that. Kept as constants so the PointLight and
  // the emissive bulb stay together if the model is ever re-proportioned.
  const LAMP_LANTERN_OFFSET = 0.6;
  const LAMP_LANTERN_Y = LAMP_MODEL_SIZE.postHeight - 0.15 - LAMP_MODEL_SIZE.lanternHeight / 2 + 0.05;
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
    lamp.userData = { lampStandin: true };
    scene.add(lamp);

    const point = new THREE.PointLight(0xffc46b, 0, 16, 2);
    point.position.set(x, 3.15, z);
    scene.add(point);
    lamps.push({ light: point, mesh: lamp, standinPost: post });

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

  // --- The toll ledger, hidden behind the barrels in the lane ------------
  const ledgerGroup = new THREE.Group();
  ledgerGroup.position.set(LEDGER_SPOT.x, 0.95, LEDGER_SPOT.z);
  const ledgerBook = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.1, 0.32),
    new THREE.MeshStandardMaterial({ color: 0x7d2f2a, roughness: 0.7 })
  );
  ledgerBook.rotation.y = 0.4;
  ledgerBook.castShadow = true;
  ledgerGroup.add(ledgerBook);
  const ledgerPages = new THREE.Mesh(
    new THREE.BoxGeometry(0.38, 0.07, 0.29),
    new THREE.MeshStandardMaterial({ color: 0xe6dcc4, roughness: 0.95 })
  );
  ledgerPages.position.y = 0.055;
  ledgerPages.rotation.y = 0.4;
  ledgerGroup.add(ledgerPages);
  const ledgerGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.4, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xffe6a8, transparent: true, opacity: 0.14 })
  );
  ledgerGroup.add(ledgerGlow);
  ledgerGroup.visible = false;
  scene.add(ledgerGroup);

  // --- Asset upgrade (asynchronous, never required) ------------------------
  // The plaza and fountain work without any download. When the files are
  // available they replace the stand-ins; when they are not, nothing breaks and
  // `assetState` records why, so a bug report can tell "no textures" apart from
  // "textures failed to load".
  const assetState = {
    fountain: 'stand-in',
    stone: 'flat',
    barrels: 'cylinders',
    stalls: 'boxes',
    lamps: 'spheres',
    plaster: 'flat',
    marketStalls: 'boxes',
    bench: 'box',
    notice: 'plane',
    wood: 'flat',
    brick: 'flat',
    fountainDetail: null,
    stoneDetail: null,
    barrelDetail: null
  };

  function upgradeFountain() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.fountain = 'unavailable';
      return Promise.resolve(assetState);
    }
    return loadFountain({ THREE, loadGlb }).then((result) => {
      if (!result.ok) {
        assetState.fountain = 'stand-in';
        assetState.fountainDetail = result.reason;
        return assetState;
      }
      const group = new THREE.Group();
      group.name = 'fountain-model';
      for (const { name, geometry, material } of result.meshes) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = name;
        // The plinth sits on the ground; the model is already authored at y=0.
        mesh.position.set(FOUNTAIN_SPOT.x, 0, FOUNTAIN_SPOT.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        // Water surfaces should not cast hard shadows onto the basin floor.
        if (name.includes('Water')) mesh.castShadow = false;
        group.add(mesh);
      }
      fountainGroup.remove(standIn);
      fountainGroup.add(group);
      assetState.fountain = 'model';
      assetState.fountainDetail = {
        parts: result.meshes.length,
        bytes: result.bytes,
        height: Number(result.footprint.height.toFixed(2)),
        width: Number(result.footprint.width.toFixed(2))
      };
      return assetState;
    });
  }

  // --- Barrel upgrade (asynchronous, never required) -----------------------
  // The plaza and lane barrels are plain cylinders today. The modelled barrel
  // replaces each one when it loads; the procedural cylinder stays otherwise.
  const barrelInstances = [
    // plaza barrels
    { x: -5, z: 9, height: 1.3, radius: 0.55, collider: true },
    { x: -6.2, z: 9.4, height: 1.3, radius: 0.55, collider: true },
    { x: 3, z: -7.5, height: 1.3, radius: 0.55, collider: true },
    // lane barrels
    { x: 6.9, z: -24.4, height: 1.2, radius: 0.5, collider: true },
  ];
  const barrelGroup = new THREE.Group();
  barrelGroup.name = 'barrels';
  scene.add(barrelGroup);

  function upgradeBarrels() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.barrels = 'unavailable';
      return Promise.resolve(assetState);
    }
    return loadBarrel({ THREE, loadGlb }).then((result) => {
      if (!result.ok) {
        assetState.barrels = 'cylinders';
        assetState.barrelDetail = result.reason;
        return assetState;
      }
      // Remove the procedural cylinders so the model is what you see.
      const standins = scene.children.filter((c) => c.name === 'barrel-standin');
      for (const s of standins) scene.remove(s);
      for (const inst of barrelInstances) {
        const group = new THREE.Group();
        group.name = 'barrel-model';
        const scale = inst.radius / BARREL_MODEL_SIZE.radius;
        for (const { name, geometry, material } of result.meshes) {
          const mesh = new THREE.Mesh(geometry, material);
          mesh.name = name;
          mesh.scale.set(scale, inst.height / BARREL_MODEL_SIZE.height, scale);
          mesh.position.set(0, 0, 0);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          group.add(mesh);
        }
        group.position.set(inst.x, 0, inst.z);
        barrelGroup.add(group);
      }
      assetState.barrels = 'model';
      assetState.barrelDetail = {
        parts: result.meshes.length,
        bytes: result.bytes,
        instances: barrelInstances.length
      };
      return assetState;
    });
  }

  /**
   * Applies one loaded texture family to a material. Shared by stone, wood and
   * brick so the tiling/anisotropy rules live in exactly one place.
   * `widthMeters`/`heightMeters` pick the repeat so texel density stays sane.
   */
  function applyTextureFamily(material, textures, widthMeters, heightMeters, tileMeters) {
    let applied = 0;
    for (const [key, texture] of Object.entries(textures)) {
      if (!texture || key === 'anyLoaded') continue;
      const repeat = textureRepeat(widthMeters, heightMeters, tileMeters);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(repeat.repeatX, repeat.repeatY);
      texture.anisotropy = Math.min(4, renderer.capabilities?.getMaxAnisotropy?.() ?? 1);
      applied += 1;
    }
    // A textured map must not be tinted twice: white base, and the maps carry
    // the roughness/metalness detail.
    material.color.setHex(0xffffff);
    material.roughness = 1;
    material.metalness = 0;
    if (textures.map) material.map = textures.map;
    if (textures.normalMap) material.normalMap = textures.normalMap;
    if (textures.roughnessMap) material.roughnessMap = textures.roughnessMap;
    material.needsUpdate = true;
    return applied;
  }

  function upgradeStalls() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.stalls = 'unavailable';
      return Promise.resolve(assetState);
    }
    return loadStall({ THREE, loadGlb }).then((result) => {
      if (!result.ok) {
        assetState.stalls = 'boxes';
        assetState.stallDetail = result.reason;
        return assetState;
      }
      // Hide the procedural lane stall boxes so only the model shows.
      for (const c of scene.children) {
        if (c.userData && c.userData.stallStandin) c.visible = false;
      }
      // Discover lane stall positions from the lane props data.
      const laneStallPositions = [];
      // We re-derive from the same LANE_PROPS the build loop used; simpler to
      // scan the scene for standin markers' positions.
      for (const c of scene.children) {
        if (c.userData && c.userData.stallStandin && c.position) {
          // counter box centre -> model origin at ground
          laneStallPositions.push({ x: c.position.x, z: c.position.z, height: 1.0 });
        }
      }
      // Deduplicate (counter + roof both marked) by rounding.
      const seen = new Set();
      const unique = [];
      for (const p of laneStallPositions) {
        const key = `${p.x.toFixed(2)},${p.z.toFixed(2)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(p);
      }
      const positions = unique.length ? unique : [{ x: 7.4, z: -21.5, height: 1.0 }];
      for (const inst of positions) {
        const group = new THREE.Group();
        group.name = 'stall-model';
        const scale = 1;
        for (const { name, geometry, material } of result.meshes) {
          const mesh = new THREE.Mesh(geometry, material);
          mesh.name = name;
          mesh.scale.set(scale, inst.height / STALL_MODEL_SIZE.height, scale);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          group.add(mesh);
        }
        group.position.set(inst.x, 0, inst.z);
        scene.add(group);
      }
      assetState.stalls = 'model';
      assetState.stallDetail = {
        parts: result.meshes.length,
        bytes: result.bytes,
        instances: positions.length
      };
      return assetState;
    });
  }

  function upgradeLamps() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.lamps = 'unavailable';
      return Promise.resolve(assetState);
    }
    return loadLamp({ THREE, loadGlb }).then((result) => {
      if (!result.ok) {
        assetState.lamps = 'spheres';
        assetState.lampDetail = result.reason;
        return assetState;
      }
      // Swap each procedural post+sphere for the model. The PointLight and the
      // day/night emissive hook stay exactly where they are: the model provides
      // a LampBulb mesh whose material emissiveIntensity we drive instead.
      for (const lamp of lamps) {
        if (lamp.standinPost) {
          lamp.standinPost.visible = false;
          lamp.standinPost = null;
        }
        if (lamp.mesh && lamp.mesh.userData && lamp.mesh.userData.lampStandin) {
          lamp.mesh.visible = false;
        }
        const group = new THREE.Group();
        group.name = 'lamp-model';
        let bulb = null;
        for (const { name, geometry, material } of result.meshes) {
          const mesh = new THREE.Mesh(geometry, material);
          mesh.name = name;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          group.add(mesh);
          if (name === 'LampBulb') bulb = mesh;
        }
        // The model's arm reaches +0.6 m in local x and the lantern hangs at
        // 2.625 m, so the group sits on the post and the light moves under the
        // lantern rather than staying on top of the (now hidden) post.
        group.position.set(lamp.light.position.x, 0, lamp.light.position.z);
        lamp.light.position.set(lamp.light.position.x + LAMP_LANTERN_OFFSET, LAMP_LANTERN_Y,
                                lamp.light.position.z);
        // Drive the bulb's emissive instead of the old sphere's; applyPhase()
        // writes emissiveIntensity to whatever mesh we store here. The GLB's
        // bulb material arrives with a black emissive (the exporter does not
        // carry Blender's emission factor through), so set the lantern tint
        // explicitly or the day/night glow would silently do nothing.
        if (bulb) {
          lamp.mesh = bulb;
          bulb.material.emissive = new THREE.Color(0xffb43a);
          bulb.material.emissiveIntensity = 1.6;
        }
        lamp.modelGroup = group;
        scene.add(group);
      }
      assetState.lamps = 'model';
      assetState.lampDetail = {
        parts: result.meshes.length,
        bytes: result.bytes,
        instances: lamps.length
      };
      return assetState;
    });
  }

  function upgradeMarketStalls() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.marketStalls = 'unavailable';
      return Promise.resolve(assetState);
    }
    return loadMarketStall({ THREE, loadGlb }).then((result) => {
      if (!result.ok) {
        assetState.marketStalls = 'boxes';
        assetState.marketStallDetail = result.reason;
        return assetState;
      }
      // Hide the procedural counters; keep their colliders.
      const standins = scene.children.filter((c) => c.userData && c.userData.marketStallStandin);
      for (const c of standins) c.visible = false;
      // Place the model at each standin's position, scaled to fit that counter.
      const instances = [];
      for (const c of standins) {
        instances.push({
          x: c.position.x,
          z: c.position.z,
          height: c.position.y * 2,
          size: c.userData.marketStallSize
        });
      }
      for (const inst of instances) {
        const group = new THREE.Group();
        group.name = 'market-stall-model';
        const sx = inst.size === 'small'
          ? 3.0 / MARKET_STALL_MODEL_SIZE.width
          : 4.0 / MARKET_STALL_MODEL_SIZE.width;
        const sy = inst.height / MARKET_STALL_MODEL_SIZE.height;
        for (const { name, geometry, material } of result.meshes) {
          const mesh = new THREE.Mesh(geometry, material);
          mesh.name = name;
          mesh.scale.set(sx, sy, sx);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          group.add(mesh);
        }
        group.position.set(inst.x, 0, inst.z);
        scene.add(group);
      }
      assetState.marketStalls = 'model';
      assetState.marketStallDetail = {
        parts: result.meshes.length,
        bytes: result.bytes,
        instances: instances.length
      };
      return assetState;
    });
  }

  function upgradeBench() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.bench = 'unavailable';
      return Promise.resolve(assetState);
    }
    return loadBench({ THREE, loadGlb }).then((result) => {
      if (!result.ok) {
        assetState.bench = 'box';
        assetState.benchDetail = result.reason;
        return assetState;
      }
      const standins = scene.children.filter((c) => c.userData && c.userData.benchStandin);
      for (const c of standins) c.visible = false;
      const group = new THREE.Group();
      group.name = 'bench-model';
      for (const { name, geometry, material } of result.meshes) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = name;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      group.position.set(BENCH.x, 0, BENCH.z);
      scene.add(group);
      assetState.bench = 'model';
      assetState.benchDetail = {
        parts: result.meshes.length,
        bytes: result.bytes,
        instances: 1
      };
      return assetState;
    });
  }

  function upgradeNotice() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.notice = 'unavailable';
      return Promise.resolve(assetState);
    }
    return loadNotice({ THREE, loadGlb }).then((result) => {
      if (!result.ok) {
        assetState.notice = 'plane';
        assetState.noticeDetail = result.reason;
        return assetState;
      }
      // Hide the procedural frame and face; the collider stays.
      for (const c of scene.children) {
        if (c.userData && c.userData.noticeStandin) c.visible = false;
      }
      const group = new THREE.Group();
      group.name = 'notice-model';
      // The model is authored long-side-along-x; the game wants it facing
      // west, so rotate a quarter turn like the procedural frame did.
      group.rotation.y = Math.PI / 2;
      for (const { name, geometry, material } of result.meshes) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = name;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      group.position.set(NOTICE_BOARD.x, 0, NOTICE_BOARD.z);
      scene.add(group);
      assetState.notice = 'model';
      assetState.noticeDetail = {
        parts: result.meshes.length,
        bytes: result.bytes,
        instances: 1
      };
      return assetState;
    });
  }

  function upgradeStone() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.stone = 'unavailable';
      return Promise.resolve(assetState);
    }
    return loadMaterialTextures({ THREE, files: STONE_TEXTURE_FILES }).then((textures) => {
      if (!textures.anyLoaded) {
        assetState.stone = 'flat';
        return assetState;
      }
      // The plaza is a 9 m radius disc; a ~3 m tile keeps the blocks a
      // believable size underfoot rather than stretched or miniaturised.
      applyTextureFamily(plazaMaterial, textures, 18, 18, 3);
      assetState.stone = 'textured';
      assetState.stoneDetail = {
        maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => textures[k])
      };
      return assetState;
    });
  }

  function upgradeWoodBrick() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.wood = 'unavailable';
      assetState.brick = 'unavailable';
      assetState.plaster = 'unavailable';
      return Promise.resolve(assetState);
    }
    // Wood dresses the stalls, crates, bench and lamp posts; brick the house
    // walls. A 1.2 m crate and a 7 m wall want very different repeats, but they
    // share one material each, so the tile size is a compromise: 1.5 m for wood
    // (planks read at crate scale) and 2 m for brick (courses read at wall scale).
    return Promise.all([
      loadMaterialTextures({ THREE, files: WOOD_TEXTURE_FILES }),
      loadMaterialTextures({ THREE, files: BRICK_TEXTURE_FILES }),
      loadMaterialTextures({ THREE, files: PLASTER_TEXTURE_FILES })
    ]).then(([wood, brick, plaster]) => {
      assetState.wood = wood.anyLoaded ? 'textured' : 'flat';
      assetState.brick = brick.anyLoaded ? 'textured' : 'flat';
      assetState.plaster = plaster.anyLoaded ? 'textured' : 'flat';
      if (wood.anyLoaded) {
        applyTextureFamily(woodMat, wood, 1.5, 1.5, 1.5);
        assetState.woodDetail = {
          maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => wood[k])
        };
      }
      if (brick.anyLoaded) {
        applyTextureFamily(brickMat, brick, 7, 3, 2);
        assetState.brickDetail = {
          maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => brick[k])
        };
      }
      if (plaster.anyLoaded) {
        // Lane walls are long runs (up to ~14 m) at 2.6 m high; a 2 m tile keeps
        // the trowel sweeps and chips at a believable plaster scale.
        applyTextureFamily(laneWall, plaster, 14, 2.6, 2);
        assetState.plasterDetail = {
          maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => plaster[k])
        };
      }
      return assetState;
    });
  }

  const environment = {
    scene,
    hemi,
    sun,
    fill,
    lamps,
    laneLamps,
    gateDoor,
    gateCollider,
    /** Opens or shuts the north gate: the door lifts and its collider goes. */
    setGateOpen(open) {
      gateDoor.visible = !open;
      gateDoor.position.y = open ? wallHeight + 2 : (wallHeight - 0.3) / 2;
      const index = colliders.indexOf(gateCollider);
      if (open && index !== -1) colliders.splice(index, 1);
      if (!open && index === -1) colliders.push(gateCollider);
    },
    keyGroup,
    /** Shows or hides the key pickup. */
    setKeyVisible(visible) {
      keyGroup.visible = Boolean(visible);
    },
    ledgerGroup,
    setLedgerVisible(visible) {
      ledgerGroup.visible = Boolean(visible);
    },
    fountainGroup,
    /**
     * Starts the asset upgrade. Returns a promise that settles when both assets
     * have been attempted, so tests can await it and get a truthful report rather
     * than a guess about timing.
     */
    loadAssets() {
      return Promise.all([upgradeFountain(), upgradeBarrels(), upgradeStalls(), upgradeLamps(), upgradeMarketStalls(), upgradeBench(), upgradeNotice(), upgradeStone(), upgradeWoodBrick()]).then(() => ({ ...assetState }));
    },
    /** What actually loaded: 'model' | 'stand-in' | 'unavailable', etc. */
    get assetState() {
      return { ...assetState };
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
  // The market lane keeps the same lighting rhythm as the plaza.
  for (const light of environment.laneLamps || []) {
    light.intensity = look.lampIntensity * 0.6;
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
