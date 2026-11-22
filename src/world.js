import * as THREE from 'three';
import { WORLD_SIZE, HALF, TERRACE, STEP_HEIGHT, KEY_SPOT, KEY_PICKUP_RANGE, BENCH, floorHeightAt } from './terrain.js';
import {
  GATE, LANE, LANE_PROPS, NOTICE_BOARD, NORTH_WALL_SEGMENTS, LEDGER_SPOT, JOB_BOARD,
  LANE_BUNTING, LANE_SACKS, LANE_LANTERNS, LANTERN_HEIGHT, lanternPlacement,
  lampArmFacing, nearestLaneLantern
} from './areas.js';
import {
  FOUNTAIN_SPOT, FOUNTAIN_COLLIDER, canLoadAssets, textureRepeat,
  plazaFloorMaterialParams, loadFountain, loadMaterialTextures,
  BARREL_ASSET, BARREL_MODEL_SIZE, loadBarrel, STALL_ASSET, STALL_MODEL_SIZE, loadStall,
  LAMP_ASSET, LAMP_MODEL_SIZE, loadLamp, MARKET_STALL_ASSET, MARKET_STALL_MODEL_SIZE,
  loadMarketStall, BENCH_ASSET, BENCH_MODEL_SIZE, loadBench,
  NOTICE_ASSET, NOTICE_MODEL_SIZE, loadNotice,
  CRATE_ASSET, CRATE_MODEL_SIZE, loadCrate,
  GATE_DOOR_ASSET, GATE_DOOR_MODEL_SIZE, loadGateDoor,
  HOUSE_ASSET, HOUSE_MODEL_SIZE, loadHouse,
  WOOD_TEXTURE_FILES, STONE_TEXTURE_FILES, BRICK_TEXTURE_FILES, PLASTER_TEXTURE_FILES,
  COBBLE_TEXTURE_FILES, GRASS_TEXTURE_FILES, PLAZA_FLOOR_TEXTURE_FILES, boxProjectUvs,
  TREE_ASSET, TREE_MODEL_SIZE, loadTree, BARK_TEXTURE_FILES, LAMP_TEXTURE_FILES,
  needsOwnMaterial,
  cloneTextureFamily, TERRACE_TEXTURE_TILE_METERS, terraceStoneParts,
  ROOF_TEXTURE_FILES, LEAF_TEXTURE_FILES, PROP_FAMILIES, propFamilyFor
} from './assets.js';
import { loadGlb } from './glb.js';
import {
  shadowSettings,
  skyVertexColor,
  sunDiskIntensity,
  sunDiscPosition,
  SUN_DISTANCE,
  SUN_CORE_RADIUS,
  SUN_GLOW_RADIUS
} from './graphics.js';

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

  // A sky dome so the horizon is a gradient, not a flat colour band. The dome
  // sits outside the fog range and is unlit, so it costs one draw call and no
  // lighting; applyPhase() recolours it with the day/night table.
  //
  // 32 x 24 rather than the original 24 x 12: the vertex colours *are* the sky,
  // so the mesh resolution is the resolution of the gradient. At 12 rings each
  // ring is 15 degrees apart, which is coarser than the horizon haze band itself
  // (~16 degrees) and would quantise it into one hard step. 24 rings halve that
  // to 7.5 degrees for ~800 vertices and one draw call either way.
  const skyGeometry = new THREE.SphereGeometry(120, 32, 24);
  const skyMaterial = new THREE.MeshBasicMaterial({
    side: THREE.BackSide, fog: false, depthWrite: false
  });
  const skyDome = new THREE.Mesh(skyGeometry, skyMaterial);
  skyDome.name = 'sky-dome';
  // Vertex colours: zenith at the top, horizon colour at and below the equator.
  const skyColors = new Float32Array(skyGeometry.attributes.position.count * 3);
  skyGeometry.setAttribute('color', new THREE.BufferAttribute(skyColors, 3));
  skyMaterial.vertexColors = true;
  scene.add(skyDome);
  // The sun: a bright disc with a soft glow around it, both parked on the dome
  // and aimed at its centre. Unlit and unfogged so they read as sky detail
  // rather than geometry, additive so the disc brightens the sky behind it
  // instead of pasting a flat circle over it, and depth-write off so they can
  // never punch a hole in anything drawn afterwards.
  const sunCore = new THREE.Mesh(
    new THREE.CircleGeometry(SUN_CORE_RADIUS, 24),
    new THREE.MeshBasicMaterial({
      fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending
    })
  );
  sunCore.name = 'sky-sun';
  const sunGlow = new THREE.Mesh(
    new THREE.CircleGeometry(SUN_GLOW_RADIUS, 24),
    new THREE.MeshBasicMaterial({
      fog: false, depthWrite: false, transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending
    })
  );
  sunGlow.name = 'sky-sun-glow';
  const sunDisc = new THREE.Group();
  sunDisc.name = 'sky-sun-group';
  sunDisc.renderOrder = -1;
  sunDisc.add(sunGlow, sunCore);
  scene.add(sunDisc);

  const zenithColor = new THREE.Color(0x6fa8dc);
  const horizonColor = new THREE.Color(0x9fc4e8);
  const hazeColor = new THREE.Color(0x9fc4e8);

  function paintSky(zenith, horizon, haze = horizon) {
    zenithColor.setHex(zenith);
    horizonColor.setHex(horizon);
    hazeColor.setHex(haze);
    const pos = skyGeometry.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      const c = skyVertexColor(
        zenithColor, horizonColor, hazeColor, pos.getY(i) / 120
      );
      skyColors[i * 3] = c.r;
      skyColors[i * 3 + 1] = c.g;
      skyColors[i * 3 + 2] = c.b;
    }
    skyGeometry.attributes.color.needsUpdate = true;
  }

  function paintSun(colourHex, intensity, sunPosition) {
    const p = sunDiscPosition(sunPosition, SUN_DISTANCE);
    sunDisc.position.set(p.x, p.y, p.z);
    // The player only ever sees the dome from inside it, so facing the centre
    // is what makes the disc square-on to the camera at every phase.
    sunDisc.lookAt(0, 0, 0);
    sunCore.material.color.setHex(colourHex);
    sunGlow.material.color.setHex(colourHex);
    sunCore.material.opacity = intensity;
    sunGlow.material.opacity = 0.22 * intensity;
    sunDisc.visible = intensity > 0;
  }

  paintSky(0x6fa8dc, 0x9fc4e8);
  paintSun(0xfff1d0, sunDiskIntensity('day'), PHASE_LOOKS.day.sunPosition);

  const colliders = [];

  // --- Ground -------------------------------------------------------------
  const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x8a9c74, roughness: 0.95, metalness: 0 });
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE),
    groundMaterial
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // A paved ring in the middle so the plaza reads differently from the grass.
  // Its material is created from the asset rules so the flat-colour fallback and
  // the textured version differ in exactly one place.
  const plazaBase = plazaFloorMaterialParams(false);
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
  const laneFloorMaterial = new THREE.MeshStandardMaterial({ color: 0x9d9182, roughness: 0.93 });
  const laneFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(LANE.maxX - LANE.minX, LANE.maxZ - LANE.minZ),
    laneFloorMaterial
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
  // The lamp post's own head follows the lamp round too. It used to glow all day
  // and all night, which made the post look lit while the bunting lanterns it is
  // supposed to light were dark -- the fixture was advertising a job it had not
  // done. It gets no point light (that is the per-pixel budget the low tier is
  // protecting); its emissive is a state readout, and applyPhase() drives it.
  let postLamp = null;
  // The lane post keeps its procedural cylinder here and is swapped for the
  // modelled fixture by upgradeLaneLamp() once assets load. Declared before the
  // prop loop on purpose: declaring it further down would put the assignment
  // below in the temporal dead zone and throw on the first build.
  let laneLampModel = null;
  for (const prop of LANE_PROPS) {
    if (prop.kind === 'post') {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.16, prop.height, 10),
        laneWood
      );
      post.position.set(prop.x, prop.height / 2, prop.z);
      post.castShadow = true;
      post.userData = { lanePostStandin: true };
      scene.add(post);
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.24, 14, 10),
        new THREE.MeshStandardMaterial({ color: 0xffd479, emissive: 0xffb43a, emissiveIntensity: 0 })
      );
      lamp.position.set(prop.x, prop.height + 0.1, prop.z);
      lamp.userData = { lanePostLamp: true };
      scene.add(lamp);
      postLamp = lamp;
      laneLampModel = post;
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

  // Bunting: strands across the lane with triangular flags. It hangs above
  // head height (2.6-2.75 m with a sag), so it deliberately registers NO
  // collider -- a player walks under it. laneBuntingOverhead() in areas.js
  // holds that promise to a test rather than to a comment.
  const buntingMat = new THREE.MeshStandardMaterial({ color: 0xc9553f, roughness: 0.85 });
  const buntingMatB = new THREE.MeshStandardMaterial({ color: 0xe0b552, roughness: 0.85 });
  const flagGeometry = new THREE.ConeGeometry(0.09, 0.22, 3);
  for (const strand of LANE_BUNTING) {
    // The rope: a thin box spanning the lane, dipping in the middle.
    const rope = new THREE.Mesh(
      new THREE.BoxGeometry(LANE.maxX - LANE.minX, 0.02, 0.02),
      laneWood
    );
    // Approximate the sag with two angled halves so the rope visually dips.
    rope.position.set((LANE.minX + LANE.maxX) / 2, strand.y - strand.sag / 2, strand.z);
    scene.add(rope);
    const span = LANE.maxX - LANE.minX;
    for (let i = 0; i < strand.flags; i += 1) {
      const t = (i + 0.5) / strand.flags;
      const x = LANE.minX + span * t;
      // Parabola: deepest at the middle of the strand.
      const dip = Math.sin(Math.PI * t) * strand.sag;
      const flag = new THREE.Mesh(flagGeometry, i % 2 === 0 ? buntingMat : buntingMatB);
      flag.position.set(x, strand.y - dip - 0.11, strand.z);
      flag.rotation.x = Math.PI;
      flag.castShadow = false;
      scene.add(flag);
    }
  }

  // Sacks leaning against the stall. These DO get colliders, because they sit
  // on the floor; laneDressingClear() proves each leaves 1.2 m of walkway.
  const sackMat = new THREE.MeshStandardMaterial({ color: 0xa89468, roughness: 0.95 });
  const sackTieMat = new THREE.MeshStandardMaterial({ color: 0x6f5f42, roughness: 0.9 });
  for (const sack of LANE_SACKS) {
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(sack.radius, sack.radius * 0.86, sack.height, 9),
      sackMat
    );
    body.position.set(sack.x, sack.height / 2, sack.z);
    body.castShadow = true;
    body.receiveShadow = true;
    scene.add(body);
    // A pinched neck so it reads as a sack, not a barrel.
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(sack.radius * 0.45, sack.radius * 0.62, 0.12, 9),
      sackTieMat
    );
    neck.position.set(sack.x, sack.height + 0.03, sack.z);
    neck.castShadow = true;
    scene.add(neck);
    colliders.push(boxCollider(
      sack.x - 0.32, sack.z - 0.32, sack.x + 0.32, sack.z + 0.32
    ));
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

  // A row of hanging lights so the lane is not a dark tunnel at dusk. Each
  // point light hangs from a real fixture tied to its bunting strand, which
  // fixes a defect from the round the lights were added: they used to hover in
  // mid-air with no lantern above them, so the lane glowed from nothing. The
  // positions come from lanternPlacement() in areas.js, the same source the
  // laneLanternsHang() test uses, so light and mesh cannot drift apart.
  const laneLamps = [];
  for (const lantern of LANE_LANTERNS) {
    const placed = lanternPlacement(lantern);
    const light = new THREE.PointLight(0xffc46b, 0, 9, 2);
    light.position.set(placed.x, placed.centerY, placed.z);
    scene.add(light);

    // The fixture: a tie loop, a tapered body and an emissive bulb, hung from
    // the strand at exactly the point the light sits. The bulb's emissive
    // intensity is phase-driven in applyPhase() alongside the plaza lamps.
    const lanternY = placed.topY - LANTERN_HEIGHT / 2;
    const fixture = new THREE.Group();
    fixture.name = 'lane-lantern';
    fixture.userData = { laneLantern: true };

    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.008, 6, 12), sackTieMat);
    tie.position.set(placed.x, placed.anchorY, placed.z);
    tie.rotation.x = Math.PI / 2;
    fixture.add(tie);

    const drop = new THREE.Mesh(
      new THREE.CylinderGeometry(0.006, 0.006, placed.anchorY - placed.topY, 6),
      sackTieMat
    );
    drop.position.set(placed.x, (placed.anchorY + placed.topY) / 2, placed.z);
    fixture.add(drop);

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.12, LANTERN_HEIGHT, 8),
      new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.5, metalness: 0.35 })
    );
    body.position.set(placed.x, lanternY, placed.z);
    body.castShadow = true;
    fixture.add(body);

    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xffd479, emissive: 0xffb43a, emissiveIntensity: 0 })
    );
    bulb.position.set(placed.x, placed.topY - LANTERN_HEIGHT * 0.62, placed.z);
    bulb.userData = { laneLanternBulb: true };
    fixture.add(bulb);

    scene.add(fixture);
    laneLamps.push({ light, bulb });
  }

  // --- North terrace + ramp ----------------------------------------------
  // The slab, its ramp deck and the kerb/parapet band are one built structure in
  // one stone, so they share two materials, not five: `stepStone` is the walked
  // tread (slab + ramp deck) and `parapetMaterial` the upright band. Texel density
  // is kept uniform by box-projecting UVs at a metres-per-tile scale in
  // upgradeTerrace(), which is also why the ramp's rotated box does not smear its
  // joints the way a single per-material repeat would.
  const stepStone = new THREE.MeshStandardMaterial({ color: 0x9a9184, roughness: 0.9 });
  // Every mesh the terrace stone pass should dress; collected as the structure is
  // built so upgradeTerrace() never has to guess by geometry type or colour.
  const terraceStoneMeshes = [];
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.75 });
  // The house walls get brick; stalls, crates, bench and lamp posts stay wood.
  // Both are upgraded in place by upgradeWoodBrick() if the maps load.
  const brickMat = new THREE.MeshStandardMaterial({ color: 0x8b4a3a, roughness: 0.9 });

  const terrace = new THREE.Mesh(
    new THREE.BoxGeometry(TERRACE.maxX - TERRACE.minX, TERRACE.height, TERRACE.maxZ - TERRACE.minZ),
    stepStone
  );
  terrace.name = 'terrace-tread';
  terraceStoneMeshes.push(terrace);
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
  ramp.name = 'terrace-ramp';
  terraceStoneMeshes.push(ramp);
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
    kerb.name = 'terrace-kerb';
    terraceStoneMeshes.push(kerb);
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
    const lip = addBox(scene, [], {
      size: [to - from, 0.55, 0.22],
      position: [(from + to) / 2, TERRACE.height + 0.275, TERRACE.maxZ - 0.11],
      material: parapetMaterial,
      castShadow: true
    });
    lip.name = 'terrace-parapet';
    terraceStoneMeshes.push(lip);
    // The collider is a thin line at the lip itself, spanning the open width so the
    // player cannot squeeze past the end of the parapet either.
    colliders.push(boxCollider(from, TERRACE.maxZ - 0.22, to, TERRACE.maxZ));
  }
  for (const x of [TERRACE.minX, TERRACE.maxX]) {
    const sideWall = addBox(scene, [], {
      size: [0.22, 0.55, TERRACE.maxZ - TERRACE.minZ],
      position: [x, TERRACE.height + 0.275, (TERRACE.minZ + TERRACE.maxZ) / 2],
      material: parapetMaterial,
      castShadow: true
    });
    sideWall.name = 'terrace-parapet';
    terraceStoneMeshes.push(sideWall);
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

  // A small house on the north-west side gives the space a landmark. The brick
  // body stays procedural (it wears the Kaggle brick texture); the roof slab and
  // door box are stand-ins that upgradeHouse() replaces with the modelled trim.
  addBox(scene, colliders, { size: [7, 3, 5], position: [-10.5, 1.5, -9], material: brickMat, castShadow: true });
  const houseRoofSlab = addBox(scene, colliders, { size: [8, 0.6, 6], position: [-10.5, 3.3, -9], material: roof, castShadow: true });
  houseRoofSlab.userData = { houseStandin: true };
  const houseDoorBox = addBox(scene, colliders, { size: [1.4, 2.2, 0.3], position: [-10.5, 1.1, -6.35], material: stone });
  houseDoorBox.userData = { houseStandin: true };

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
  const crate0 = addBox(scene, colliders, { size: [1.2, 1.2, 1.2], position: [5, 0.6, 8], material: wood, castShadow: true });
  crate0.userData = { crateStandin: true, crateIndex: 0 };
  const crate1 = addBox(scene, colliders, { size: [1.2, 1.2, 1.2], position: [5, 1.8, 8], material: wood, castShadow: true });
  crate1.userData = { crateStandin: true, crateIndex: 1 };
  const crate2 = addBox(scene, colliders, { size: [1.2, 1.2, 1.2], position: [6.4, 0.6, 8.3], material: wood, castShadow: true });
  crate2.userData = { crateStandin: true, crateIndex: 2 };

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

  // --- Trees --------------------------------------------------------------
  // The plaza had no vegetation at all: stone, grass and props read as a car
  // park. Trees are placed in the quieter south-west and south-east corners,
  // clear of the bench, fountain, stalls and the gate walk, so they dress the
  // skyline without blocking any route. Each is a stand-in (trunk cylinder +
  // canopy sphere) that upgradeTree() replaces with the modelled GLB when it
  // loads. The collider is the trunk only: a player can stand under a canopy.
  const TREE_SPOTS = [
    { x: -13, z: 13, scale: 1.0 },
    { x: 13, z: 12, scale: 0.9 },
    { x: -14, z: 2, scale: 0.85 }
  ];
  const treeGroup = new THREE.Group();
  treeGroup.name = 'trees';
  scene.add(treeGroup);
  const treeStandins = [];
  for (const spot of TREE_SPOTS) {
    const standin = new THREE.Group();
    standin.name = 'tree-standin';
    standin.userData = { treeStandin: true };
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(TREE_MODEL_SIZE.trunkRadius, TREE_MODEL_SIZE.trunkRadius * 1.15, TREE_MODEL_SIZE.trunkHeight, 7),
      new THREE.MeshStandardMaterial({ color: 0x6b4728, roughness: 0.9 })
    );
    trunk.position.y = TREE_MODEL_SIZE.trunkHeight / 2;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    standin.add(trunk);
    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(TREE_MODEL_SIZE.canopyRadius, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x4c8533, roughness: 0.85 })
    );
    canopy.position.y = TREE_MODEL_SIZE.trunkHeight + TREE_MODEL_SIZE.canopyRadius * 0.5;
    canopy.castShadow = true;
    standin.add(canopy);
    standin.position.set(spot.x, 0, spot.z);
    standin.scale.setScalar(spot.scale);
    treeGroup.add(standin);
    treeStandins.push(standin);
    colliders.push(boxCollider(
      spot.x - 0.5, spot.z - 0.5, spot.x + 0.5, spot.z + 0.5
    ));
  }

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
  // A small normal bias removes the acne that a pure depth bias leaves on the
  // sloped roof and octagonal fountain, which is why both are set: the depth
  // bias fixes flat faces, the normal bias fixes grazing angles.
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
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
  // Prop models load before the material families (they are independent fetches,
  // run in parallel). This registry lets upgradePropFamilies() dress the
  // already-built models once the maps arrive, instead of serialising the whole
  // asset pass behind one texture download.
  const propGroups = [];
  // Loaded maps keyed by PROP_FAMILIES id (leaf/roof/bark/wood). One fetch each,
  // shared by every mesh in the family; cloneTextureFamily() gives each mesh its
  // own sampler state.
  const familyTextures = {};
  let lampAssetPromise = null;
  // One fetch of the quarried stone family, shared by the border walls and the
  // terrace. The materials stay separate (each gets cloned textures) because they
  // need different sampler state; only the network request is shared.
  let stoneTexturesPromise = null;

  const assetState = {
    fountain: 'stand-in',
    plazaFloor: 'flat',
    barrels: 'cylinders',
    stalls: 'boxes',
    lamps: 'spheres',
    plaster: 'flat',
    marketStalls: 'boxes',
    bench: 'box',
    notice: 'plane',
    crates: 'boxes',
    gateDoor: 'box',
    house: 'boxes',
    propWood: 'flat',
    propWoodDetail: null,
    roof: 'flat',
    roofDetail: null,
    foliage: 'flat',
    foliageDetail: null,
    cobble: 'flat',
    grass: 'flat',
    walls: 'flat',
    terrace: 'flat',
    sky: 'gradient',
    wood: 'flat',
    brick: 'flat',
    fountainDetail: null,
    plazaFloorDetail: null,
    barrelDetail: null,
    laneLamp: 'stand-in',
    laneLampDetail: null,
    lampMetal: 'flat',
    lampMetalDetail: null,
    trees: 'stand-ins',
    bark: 'flat',
    barkDetail: null,
    terraceDetail: null
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
      // Register for the wood/iron dressing pass: the fountain's carved trim and
      // its flat-coloured rim were a large untouched mass in the plaza centre.
      propGroups.push({ group, tile: 2 });
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
        // 1.2 m staves read best at a crate-scale tile; the audit measured the
        // barrel wood as a large flat surface in the plaza.
        propGroups.push({ group, tile: 1.2 });
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
        propGroups.push({ group, tile: 1.5 });
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
    return loadLampAsset().then((result) => {
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
        // Lamp posts are slender, so a 1.5 m tile keeps the grain from
        // stretching along the shaft.
        propGroups.push({ group, tile: 1.5 });
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

  /**
   * One shared fetch of assets/lamp.glb for both the plaza posts and the lane
   * post. The plaza upgrade used to fetch it on its own; the lane post is the
   * same fixture, so downloading it twice would be a second round trip for a
   * file the browser has already cached -- and, worse, two independent parse
   * results that could disagree about the model.
   */
  function loadLampAsset() {
    if (!lampAssetPromise) lampAssetPromise = loadLamp({ THREE, loadGlb });
    return lampAssetPromise;
  }

  /**
   * Swaps the lane's procedural post + sphere for the modelled lantern (round 55)
   * and dresses its ironwork in the painted-metal texture family.
   *
   * The lane post is the fixture the whole lamp round is walked from, so it was
   * the one lamp still made of a bare cylinder and a floating sphere: the plaza
   * posts were modelled back in round 33 and the lane's bunting lanterns hang
   * from modelled glass, which left the post you actually interact with looking
   * like a placeholder. This upgrade is what makes the fixture match the light.
   *
   * Three things must survive the swap, and each is easy to lose:
   *  - `environment.postLamp` must point at the *new* bulb mesh, because
   *    applyPhase() writes its emissiveIntensity to that handle every frame. If
   *    it kept the hidden stand-in sphere the head would stop reporting the
   *    lit/dark state -- the exact honesty bug round 54 fixed.
   *  - The arm is authored reaching +x, so the group is rotated to hang the
   *    lantern over the lane instead of into the wall; lampArmFacing() owns that
   *    maths so it is testable away from Three.js.
   *  - The model has no UVs and cannot carry embedded textures (see glb.js), so
   *    the iron maps are applied in code with box-projected UVs. Glass and bulb
   *    keep their authored flat materials: a rusty metal map on glass reads as a
   *    mistake.
   *
   * If the model or the maps are unavailable the stand-ins stay exactly as they
   * are and `assetState` says why, so the round keeps working on a bare download.
   */
  function upgradeLaneLamp() {
    if (!laneLampModel) {
      assetState.laneLamp = 'stand-in';
      return Promise.resolve(assetState);
    }
    const post = { x: laneLampModel.position.x, z: laneLampModel.position.z };
    return Promise.all([
      loadLampAsset(),
      loadMaterialTextures({ THREE, files: LAMP_TEXTURE_FILES })
    ]).then(([result, textures]) => {
      if (!result.ok) {
        assetState.laneLamp = 'stand-in';
        assetState.laneLampDetail = result.reason;
        return assetState;
      }
      const aim = lampArmFacing(post, nearestLaneLantern(post));
      // Hide the stand-ins but keep the collider and the prop list untouched:
      // movement, interaction range and the round's reach all key off the prop
      // position, not off what is drawn at it.
      laneLampModel.visible = false;
      if (postLamp && postLamp.userData && postLamp.userData.lanePostLamp) {
        postLamp.visible = false;
      }
      const group = new THREE.Group();
      group.name = 'lane-lamp-model';
      group.position.set(post.x, 0, post.z);
      group.rotation.y = aim.rotationY;
      let bulb = null;
      let dressed = 0;
      for (const { name, geometry, material } of result.meshes) {
        // Clone the material: loadLampAsset() caches one parse and the plaza
        // posts already hold these exact material objects, so mutating one here
        // would drag the plaza bulbs down with the lane. That is not
        // theoretical -- applyPhase() writes the lane head's emissiveIntensity
        // to 0 on every daylight frame, and sharing the material turned the
        // four plaza lanterns dark the moment the lane post was modelled.
        const own = needsOwnMaterial({ mutatesMaterial: true, sharedSource: true });
        const mesh = new THREE.Mesh(geometry, own ? material.clone() : material);
        mesh.name = name;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        // Ironwork only: the housing is glass and the bulb is the light itself.
        if (/iron/i.test(material.name || '') && textures.anyLoaded) {
          if (!geometry.getAttribute('uv')) {
            const position = geometry.getAttribute('position');
            const index = geometry.getIndex();
            geometry.setAttribute('uv', new THREE.BufferAttribute(boxProjectUvs({
              positions: position.array,
              indices: index ? index.array : null,
              // The maps are painted at roughly a 0.6 m tile, so grain and chips
              // stay the size a hand would paint them, not wallpaper.
              tileMeters: 0.6
            }), 2));
          }
          const iron = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.55,
            metalness: 0.55,
            name: 'LampIronPainted'
          });
          for (const [key, texture] of Object.entries(textures)) {
            if (!texture || key === 'anyLoaded') continue;
            const copy = texture.clone();
            copy.needsUpdate = true;
            copy.wrapS = THREE.RepeatWrapping;
            copy.wrapT = THREE.RepeatWrapping;
            copy.repeat.set(1, 1);
            iron[key] = copy;
          }
          mesh.material = iron;
          dressed += 1;
        }
        if (name === 'LampBulb') {
          bulb = mesh;
          mesh.material.emissive = new THREE.Color(0xffb43a);
          mesh.material.emissiveIntensity = 1.6;
        }
        group.add(mesh);
      }
      scene.add(group);
      // Hand the day/night hook to the modelled bulb. environment.postLamp is
      // the handle applyPhase() reads, so it must be reassigned, not just the
      // module-level variable.
      if (bulb) {
        postLamp = bulb;
        environment.postLamp = bulb;
      }
      environment.laneLampGroup = group;
      environment.laneLampAim = {
        rotationY: aim.rotationY,
        lanternX: aim.lanternX,
        lanternZ: aim.lanternZ
      };
      assetState.laneLamp = 'model';
      assetState.laneLampDetail = {
        parts: result.meshes.length,
        rotationY: Number(aim.rotationY.toFixed(4)),
        lanternX: Number(aim.lanternX.toFixed(4)),
        lanternZ: Number(aim.lanternZ.toFixed(4))
      };
      assetState.lampMetal = dressed > 0 ? 'textured' : 'flat';
      assetState.lampMetalDetail = {
        dressed,
        maps: ['map', 'normalMap', 'roughnessMap'].filter((key) => textures[key])
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
        propGroups.push({ group, tile: 1.5 });
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

  function upgradeBark() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.bark = 'unavailable';
      return Promise.resolve(assetState);
    }
    return loadMaterialTextures({ THREE, files: BARK_TEXTURE_FILES }).then((textures) => {
      if (!textures.anyLoaded) {
        assetState.bark = 'flat';
        return assetState;
      }
      // Dress the trunk meshes only. The canopy keeps its flat green.
      let dressed = 0;
      for (const { group } of propGroups) {
        // Only tree groups carry a trunk mesh.
        let isTree = false;
        group.traverse((m) => { if (m.isMesh && m.name === 'TreeTrunk') isTree = true; });
        if (!isTree) continue;
        group.traverse((mesh) => {
          if (!mesh.isMesh || mesh.name !== 'TreeTrunk') return;
          const source = mesh.material;
          if (!mesh.geometry.getAttribute('uv')) {
            const position = mesh.geometry.getAttribute('position');
            const index = mesh.geometry.getIndex();
            const uvs = boxProjectUvs({
              positions: position.array,
              indices: index ? index.array : null,
              tileMeters: 1.2
            });
            mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
          }
          const material = new THREE.MeshStandardMaterial({
            color: 0xffffff, roughness: 0.85, metalness: 0
          });
          for (const [key, texture] of Object.entries(textures)) {
            if (!texture || key === 'anyLoaded') continue;
            const copy = texture.clone();
            copy.needsUpdate = true;
            copy.wrapS = THREE.RepeatWrapping;
            copy.wrapT = THREE.RepeatWrapping;
            copy.repeat.set(1, 1);
            material[key] = copy;
          }
          material.name = 'BarkWood';
          mesh.material = material;
          dressed += 1;
        });
      }
      assetState.bark = dressed > 0 ? 'textured' : 'flat';
      assetState.barkDetail = { dressed };
      // Register for the generic prop pass, which consults this to decide whether
      // a name that matches several families (BarkWood) has a loaded one to use.
      familyTextures.bark = textures;
      return assetState;
    });
  }

  /**
   * Loads the two new families the largest flat masses need: roof shingles (the
   * house, market stall and lane-stall awnings) and canopy leaves (the trees).
   *
   * Kept as its own fetch step rather than folded into the wood/brick one so the
   * reporting is honest: `assetState.roof`/`assetState.foliage` say what actually
   * arrived, and a failed roof download leaves the awnings flat instead of
   * silently borrowing plank grain.
   */
  function upgradePropMaps() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.roof = 'unavailable';
      assetState.foliage = 'unavailable';
      return Promise.resolve(assetState);
    }
    return Promise.all([
      loadMaterialTextures({ THREE, files: ROOF_TEXTURE_FILES }),
      loadMaterialTextures({ THREE, files: LEAF_TEXTURE_FILES })
    ]).then(([roof, foliage]) => {
      assetState.roof = roof.anyLoaded ? 'textured' : 'flat';
      assetState.foliage = foliage.anyLoaded ? 'textured' : 'flat';
      familyTextures.roof = roof;
      familyTextures.leaf = foliage;
      assetState.roofDetail = {
        maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => roof[k])
      };
      assetState.foliageDetail = {
        maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => foliage[k])
      };
      return assetState;
    });
  }

  function upgradeTree() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.trees = 'unavailable';
      return Promise.resolve(assetState);
    }
    return loadTree({ THREE, loadGlb }).then((result) => {
      if (!result.ok) {
        assetState.trees = 'stand-ins';
        assetState.treeDetail = result.reason;
        return assetState;
      }
      // Replace each stand-in group with the model, scaled to its spot.
      for (let i = 0; i < TREE_SPOTS.length; i += 1) {
        const spot = TREE_SPOTS[i];
        const standin = treeStandins[i];
        if (standin) standin.visible = false;
        const group = new THREE.Group();
        group.name = 'tree-model';
        for (const { name, geometry, material } of result.meshes) {
          const mesh = new THREE.Mesh(geometry, material);
          mesh.name = name;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          group.add(mesh);
        }
        group.position.set(spot.x, 0, spot.z);
        group.scale.setScalar(spot.scale);
        treeGroup.add(group);
        propGroups.push({ group, tile: 1.2 });
      }
      assetState.trees = 'model';
      assetState.treeDetail = {
        parts: result.meshes.length,
        bytes: result.bytes,
        instances: TREE_SPOTS.length
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
      propGroups.push({ group, tile: 1.5 });
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
      propGroups.push({ group, tile: 1.5 });
      assetState.notice = 'model';
      assetState.noticeDetail = {
        parts: result.meshes.length,
        bytes: result.bytes,
        instances: 1
      };
      return assetState;
    });
  }

  function upgradeCrates() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.crates = 'unavailable';
      return Promise.resolve(assetState);
    }
    return loadCrate({ THREE, loadGlb }).then((result) => {
      if (!result.ok) {
        assetState.crates = 'boxes';
        assetState.cratesDetail = result.reason;
        return assetState;
      }
      const standins = scene.children.filter((c) => c.userData && c.userData.crateStandin);
      for (const c of standins) c.visible = false;
      // Three instances at the original positions.
      const positions = [
        { x: 5, z: 8, y: 0, rot: 0 },
        { x: 5, z: 8, y: 1.2, rot: 0.4 },
        { x: 6.4, z: 8.3, y: 0, rot: -0.25 }
      ];
      let instances = 0;
      for (const p of positions) {
        const group = new THREE.Group();
        group.name = 'crate-model';
        for (const { name, geometry, material } of result.meshes) {
          const mesh = new THREE.Mesh(geometry, material);
          mesh.name = name;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          group.add(mesh);
        }
        group.position.set(p.x, p.y, p.z);
        group.rotation.y = p.rot;
        scene.add(group);
        propGroups.push({ group, tile: 1.5 });
        instances += 1;
      }
      assetState.crates = 'model';
      assetState.cratesDetail = {
        parts: result.meshes.length,
        bytes: result.bytes,
        instances
      };
      return assetState;
    });
  }

  function upgradeGateDoor() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.gateDoor = 'unavailable';
      return Promise.resolve(assetState);
    }
    return loadGateDoor({ THREE, loadGlb }).then((result) => {
      if (!result.ok) {
        assetState.gateDoor = 'box';
        assetState.gateDoorDetail = result.reason;
        return assetState;
      }
      // Keep the procedural box as the invisible animation carrier: the game
      // moves gateDoor.position/visible on open/shut, so parent the model to
      // it and the lift animation works unchanged.
      const group = new THREE.Group();
      group.name = 'gate-door-model';
      for (const { name, geometry, material } of result.meshes) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = name;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      gateDoor.add(group);
      propGroups.push({ group, tile: 1.5, local: true });
      // Hide the box's own surface but keep it in the scene graph as carrier.
      gateDoor.material.visible = false;
      assetState.gateDoor = 'model';
      assetState.gateDoorDetail = {
        parts: result.meshes.length,
        bytes: result.bytes,
        instances: 1
      };
      return assetState;
    });
  }

  function upgradeCobble() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.cobble = 'unavailable';
      return Promise.resolve(assetState);
    }
    return loadMaterialTextures({ THREE, files: COBBLE_TEXTURE_FILES }).then((textures) => {
      if (!textures.anyLoaded) {
        assetState.cobble = 'flat';
        return assetState;
      }
      // The lane is 8 x 8.5 m; a 2 m tile puts ~30 cobbles across the width,
      // a believable worn-lane scale distinct from the plaza's block paving.
      applyTextureFamily(laneFloorMaterial, textures, 4, 4.25, 2);
      assetState.cobble = 'textured';
      assetState.cobbleDetail = {
        maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => textures[k])
      };
      return assetState;
    });
  }

  function upgradeHouse() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.house = 'unavailable';
      return Promise.resolve(assetState);
    }
    return loadHouse({ THREE, loadGlb }).then((result) => {
      if (!result.ok) {
        assetState.house = 'boxes';
        assetState.houseDetail = result.reason;
        return assetState;
      }
      // Hide the roof slab and door box; their colliders stay (the roof slab
      // collider is above head height anyway, the door box is in the wall).
      for (const c of scene.children) {
        if (c.userData && c.userData.houseStandin) c.visible = false;
      }
      const group = new THREE.Group();
      group.name = 'house-model';
      for (const { name, geometry, material } of result.meshes) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = name;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      // The model's front (+y in Blender) exports to +z, matching the house's
      // south-facing door at z = -6.35.
      group.position.set(-10.5, 0, -9);
      scene.add(group);
      propGroups.push({ group, tile: 2 });
      assetState.house = 'model';
      assetState.houseDetail = {
        parts: result.meshes.length,
        bytes: result.bytes,
        instances: 1
      };
      return assetState;
    });
  }

  /**
   * Dresses the modelled props in the material families that match their names.
   *
   * The prop GLBs are authored from untextured box primitives, so they carry no
   * UVs; boxProjectUvs() generates them in metres and every mesh in a family then
   * shares one tiling. A mesh keeps its own name-based test: only meshes whose
   * material matches a family (Blender names them *Wood, *Roof, Canopy, Trunk)
   * get the maps, so iron bands, glass and stone trim stay flat and read as
   * different materials.
   *
   * The projection is unconditional even though BoxGeometry ships 0..1 UVs. Those
   * authored UVs are per-face, so a map applied to them smears one tile across a
   * whole face instead of tiling in metres -- a crate and a house wall would show
   * the same six pixels-per-tile look. Rewriting them is what makes the 1.5 m
   * crate, the 6 m awning and the 2.6 m trunk agree on texel density.
   *
   * Bark is renamed `BarkWood` by upgradeBark() and would otherwise match the wood
   * family, so it is dressed in its own pass first and skipped here: see the
   * PROP_FAMILIES ordering comment. Everything else falls through to the generic
   * loop, which keeps the trunks out of the plank pass.
   */
  function upgradePropFamilies() {
    const loadedByFamily = new Map();
    for (const family of PROP_FAMILIES) {
      loadedByFamily.set(family.id, familyTextures[family.id] || null);
    }
    const isLoaded = (family) => {
      const textures = loadedByFamily.get(family.id);
      return Boolean(textures && textures.anyLoaded);
    };
    const anyLoaded = PROP_FAMILIES.some(isLoaded);
    if (!anyLoaded) {
      assetState.propWood = 'flat';
      return Promise.resolve(assetState);
    }

    let dressed = 0;
    let projected = 0;
    const byFamily = {};
    for (const family of PROP_FAMILIES) byFamily[family.id] = 0;

    for (const { group, tile } of propGroups) {
      group.traverse((mesh) => {
        if (!mesh.isMesh) return;
        const source = mesh.material;
        const name = source && source.name ? source.name : '';
        // Bark is already dressed by upgradeBark(); dressing it again would
        // replace the bark maps with the wood family (its name contains "Wood").
        if (/bark|trunk/i.test(name)) return;
        const family = propFamilyFor(name, isLoaded);
        if (!family) return;
        const textures = loadedByFamily.get(family.id);
        if (!textures || !textures.anyLoaded) return;

        // Unconditional: authored per-face UVs would smear the map across each
        // face, so every dressed mesh gets metre-space box-projected UVs.
        const position = mesh.geometry.getAttribute('position');
        const index = mesh.geometry.getIndex();
        const uvs = boxProjectUvs({
          positions: position.array,
          indices: index ? index.array : null,
          // The registry tile (per prop) stays the fallback, but a family with an
          // authored metre scale wins so one roof family tiles identically on a
          // 3 m stall awning and a 6 m house roof.
          tileMeters: family.tileMeters || tile
        });
        mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        projected += 1;

        const material = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: family.roughness,
          metalness: 0
        });
        for (const [key, texture] of Object.entries(textures)) {
          if (!texture || key === 'anyLoaded') continue;
          const copy = texture.clone();
          copy.needsUpdate = true;
          copy.wrapS = THREE.RepeatWrapping;
          copy.wrapT = THREE.RepeatWrapping;
          // UVs are already in metres; one repeat keeps the authored tile size.
          copy.repeat.set(1, 1);
          material[key] = copy;
        }
        // Keep the source name so later code and tests can identify the family.
        material.name = name;
        mesh.material = material;
        dressed += 1;
        byFamily[family.id] += 1;
      });
    }
    assetState.propWood = dressed > 0 ? 'textured' : 'flat';
    assetState.propWoodDetail = {
      dressed,
      projected,
      groups: propGroups.length,
      byFamily
    };
    return Promise.resolve(assetState);
  }

  function upgradeGrass() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.grass = 'unavailable';
      return Promise.resolve(assetState);
    }
    return loadMaterialTextures({ THREE, files: GRASS_TEXTURE_FILES }).then((textures) => {
      if (!textures.anyLoaded) {
        assetState.grass = 'flat';
        return assetState;
      }
      // The ground is 34 x 34 m; a 4 m tile keeps clumps at meadow scale rather
      // than carpet scale, and the paving ring still reads as a different surface.
      applyTextureFamily(groundMaterial, textures, 34, 34, 4);
      assetState.grass = 'textured';
      assetState.grassDetail = {
        maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => textures[k])
      };
      return assetState;
    });
  }

  function upgradeWalls() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.walls = 'unavailable';
      return Promise.resolve(assetState);
    }
    // The border walls carry the stone family; the plaza floor in front of them
    // has its own flagstone paving, so the two stone surfaces are not the same
    // map at two scales. Long runs (34 m) at 3.2 m high want a 2 m tile, like
    // the lane plaster, so courses read at wall scale.
    return loadStoneFamily().then((textures) => {
      if (!textures.anyLoaded) {
        assetState.walls = 'flat';
        return assetState;
      }
      // Its own copy of the maps: the terrace also tiles this family, and a shared
      // texture object can only carry one repeat (see cloneTextureFamily).
      applyTextureFamily(wallMaterial, cloneTextureFamily(textures), 34, 3.2, 2);
      assetState.walls = 'textured';
      assetState.wallsDetail = {
        maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => textures[k])
      };
      return assetState;
    });
  }

  /**
   * One fetch of the stone family, shared by the walls and the terrace.
   *
   * Both surfaces are built from the same quarried stone, so downloading the same
   * three maps twice would be waste. The *materials* stay separate (each gets a
   * cloned texture set) because they need different repeats; only the network
   * request is shared.
   */
  function loadStoneFamily() {
    if (!stoneTexturesPromise) {
      stoneTexturesPromise = loadMaterialTextures({ THREE, files: STONE_TEXTURE_FILES });
    }
    return stoneTexturesPromise;
  }

  /**
   * Dresses the north terrace's built stonework in the stone family.
   *
   * Round 61 textured the plaza floor; this is the largest flat-grey thing left in
   * the plaza view. The terrace, its ramp deck, the ramp kerbs and the low parapet
   * were all untextured MeshStandardMaterials, so the whole north end read as one
   * grey mass no matter how good the paving underfoot got.
   *
   * Two materials are upgraded in place rather than one new material per mesh, and
   * the UVs are box-projected in metres (terraceStoneParts() lists which meshes
   * belong to which). That combination is what makes one stone family look right on
   * a 12 m slab, a rotated 4.8 m ramp deck and a 0.18 m kerb face at once: the
   * projection derives UVs from world-scale positions, so texel density is uniform
   * by construction and the ramp's slope cannot shear the courses. A per-material
   * repeat could only match one of those surfaces.
   */
  function upgradeTerrace() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.terrace = 'unavailable';
      return Promise.resolve(assetState);
    }
    return loadStoneFamily().then((textures) => {
      if (!textures.anyLoaded) {
        assetState.terrace = 'flat';
        return assetState;
      }
      const tile = TERRACE_TEXTURE_TILE_METERS;
      // One clone per material: sampler state lives on the texture, so the tread and
      // the parapet cannot share an object and still wrap differently from the wall.
      for (const mesh of terraceStoneMeshes) {
        const position = mesh.geometry.getAttribute('position');
        const index = mesh.geometry.getIndex();
        if (!position) continue;
        // BoxGeometry ships with 0..1 per-face UVs, which would smear one whole map
        // across every face. They have to be replaced, not merely filled in when
        // absent -- that is the difference between coursed ashlar and a stretched
        // blur on a 12 m slab.
        mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(boxProjectUvs({
          positions: position.array,
          indices: index ? index.array : null,
          tileMeters: tile
        }), 2));
      }
      // Box-projected UVs are already in tile units, so repeat stays 1:1 and the
      // clone only carries the sampler state that keeps it off the wall's copies.
      applyTextureFamily(stepStone,
        { ...cloneTextureFamily(textures), anyLoaded: true }, 1, 1, 1);
      applyTextureFamily(parapetMaterial,
        { ...cloneTextureFamily(textures), anyLoaded: true }, 1, 1, 1);
      assetState.terrace = 'textured';
      assetState.terraceDetail = {
        maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => textures[k]),
        tileMeters: tile,
        projected: Object.fromEntries(Object.entries(terraceStoneParts()).map(([part, names]) => [
          part,
          terraceStoneMeshes.filter((m) => names.includes(m.name)).length
        ])),
        parts: terraceStoneParts()
      };
      return assetState;
    });
  }

  function upgradePlazaFloor() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.plazaFloor = 'unavailable';
      return Promise.resolve(assetState);
    }
    return loadMaterialTextures({ THREE, files: PLAZA_FLOOR_TEXTURE_FILES }).then((textures) => {
      if (!textures.anyLoaded) {
        assetState.plazaFloor = 'flat';
        return assetState;
      }
      // The plaza is a 9 m radius disc; the flagstone tile is 3 x 3 m, so a
      // 6 x 6 repeat covers it with slabs a little under a metre across.
      applyTextureFamily(plazaMaterial, textures, 18, 18, 3);
      assetState.plazaFloor = 'textured';
      assetState.plazaFloorDetail = {
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
        familyTextures.wood = wood;
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
    quality: 'full',
    paintSky,
    paintSun,
    sunDisc,
    // The palette for a phase, so the camera pipeline can derive its ambient
    // room from the same numbers the sky dome is painted with.
    phaseLook,
    hemi,
    sun,
    fill,
    lamps,
    laneLamps,
    postLamp,
    gateDoor,
    gateCollider,
    /**
     * Switches between full and low render quality. Low drops the shadow pass
     * and the point lights' per-pixel contribution, which measurement showed are
     * the only remaining levers once adaptive resolution is at its floor.
     *
     * The lamp bulbs keep their emissive glow and applyPhase() keeps driving
     * light.intensity, so night still reads as lit lamps and the day/night cycle
     * is unchanged. `quality` is recorded so a later applyPhase() and the HUD can
     * both tell the truth about what is rendering.
     */
    setQuality(tier) {
      const low = tier === 'low';
      environment.quality = low ? 'low' : 'full';
      for (const lamp of lamps) lamp.light.visible = !low;
      for (const lampLight of laneLamps) lampLight.light.visible = !low;
      // Shadows are toggled on the sun rather than the renderer, so the
      // renderer's own shadowMap setting stays under main.js's control and a
      // manual override cannot be silently undone here.
      sun.castShadow = !low;
      // Keep the map size and bias in step with the budget table rather than
      // leaving stale numbers behind when the tier flips back to full.
      const budget = shadowSettings(tier);
      sun.shadow.mapSize.set(budget.mapSize, budget.mapSize);
      sun.shadow.bias = budget.bias;
      sun.shadow.normalBias = budget.normalBias;
      // A changed map size needs the existing depth target rebuilt.
      sun.shadow.map?.dispose?.();
      sun.shadow.map = null;
      return environment.quality;
    },
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
      return Promise.all([upgradeFountain(), upgradeBarrels(), upgradeStalls(), upgradeLamps(), upgradeMarketStalls(), upgradeBench(), upgradeNotice(), upgradeCrates(), upgradeGateDoor(), upgradeHouse(), upgradeCobble(), upgradeGrass(), upgradeWalls(), upgradeTerrace(), upgradePlazaFloor(), upgradeWoodBrick(), upgradePropMaps(), upgradeTree(), upgradeBark(), upgradeLaneLamp()])
        .then(() => upgradePropFamilies()).then(() => ({ ...assetState }));
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
    zenith: 0x6fa8dc,
    haze: 0xcfe2f5,
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
    zenith: 0x8a5a7a,
    haze: 0xf0a97c,
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
    zenith: 0x050a18,
    haze: 0x1b2b4a,
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
 *
 * `laneLit` says whether the player has walked the lamp round. It defaults to
 * true so a direct call still produces the ordinary lit evening; main.js passes
 * the real answer from areas.js, and the lane stays dark until they do.
 */
export function applyPhase(environment, phaseId, laneLit = true) {
  const look = PHASE_LOOKS[phaseId];
  if (!look) throw new Error(`unknown phase ${phaseId}`);
  const { scene, hemi, sun, fill, lamps } = environment;
  scene.background = new THREE.Color(look.sky);
  if (environment.paintSky) {
    environment.paintSky(look.zenith ?? look.sky, look.sky, look.haze ?? look.sky);
  }
  if (environment.paintSun) {
    environment.paintSun(look.sunColor, sunDiskIntensity(phaseId), look.sunPosition);
  }
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
  // The market lane follows the plaza's darkness, but its bunting lanterns are
  // the player's to light: they stay dark until someone walks the round, then
  // glow with the plaza lamps so the fixture reads as the light source rather
  // than a decoration next to one. At day `lampIntensity` is 0 either way.
  const laneOn = laneLit && look.lampIntensity > 0;
  for (const laneLamp of environment.laneLamps || []) {
    laneLamp.light.intensity = laneOn ? look.lampIntensity * 0.6 : 0;
    if (laneLamp.bulb) {
      laneLamp.bulb.material.emissiveIntensity = laneOn ? look.lampGlow : 0;
    }
  }
  // The post head is the lamp the round is walked from, so it reports the same
  // state rather than glowing through a dark lane.
  if (environment.postLamp) {
    environment.postLamp.material.emissiveIntensity = laneOn ? look.lampGlow * 0.9 : 0;
  }
  environment.phase = phaseId;
}

/**
 * The look table for a phase, or undefined for an unknown id. Exposed so the
 * camera pipeline (src/graphics.js) can build an ambient room from the very
 * colours the sky is about to be painted, rather than duplicating the palette.
 */
export function phaseLook(phaseId) {
  return PHASE_LOOKS[phaseId];
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
