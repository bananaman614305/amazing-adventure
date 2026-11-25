import * as THREE from 'three';
import { buildStarField, starFieldOpacity, starTwinkle } from './stars.js';
import { WORLD_SIZE, HALF, TERRACE, STEP_HEIGHT, KEY_SPOT, KEY_PICKUP_RANGE, BENCH, floorHeightAt } from './terrain.js';
import {
  GATE, LANE, AREAS, LANE_PROPS, NOTICE_BOARD, NORTH_WALL_SEGMENTS, LEDGER_SPOT, JOB_BOARD,
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
  BANNER_ASSET, BANNER_MODEL_SIZE, loadBanner, BANNER_TEXTURE_FILES,
  FELT_TEXTURE_FILES, FELT_FAMILY, BUNTING_TILE_METERS,
  WATER_TEXTURE_FILES, WATER_TILE_METERS,
  CRATE_ASSET, CRATE_MODEL_SIZE, loadCrate,
  GATE_DOOR_ASSET, GATE_DOOR_MODEL_SIZE, loadGateDoor,
  HOUSE_ASSET, HOUSE_MODEL_SIZE, loadHouse,
  WOOD_TEXTURE_FILES, STONE_TEXTURE_FILES, BRICK_TEXTURE_FILES, PLASTER_TEXTURE_FILES,
  COBBLE_TEXTURE_FILES, GRASS_TEXTURE_FILES, PLAZA_FLOOR_TEXTURE_FILES, projectBoxGeometry,
  TREE_ASSET, TREE_MODEL_SIZE, loadTree, BARK_TEXTURE_FILES, LAMP_TEXTURE_FILES,
  CLOTH_TEXTURE_FILES,
  PLAZA_AO_MAP_CHANNEL, plazaAoMapIntensity, createPlazaAoTexture,
  applyContactDarkeningGeometry,
  needsOwnMaterial,
  cloneTextureFamily, TERRACE_TEXTURE_TILE_METERS, terraceStoneParts,
  fountainStoneParts, fountainStoneMaterialParams, fountainStoneTint,
  ROOF_TEXTURE_FILES, LEAF_TEXTURE_FILES, PROP_FAMILIES, propFamilyFor,
  PAPER_TEXTURE_FILES, ROPE_TEXTURE_FILES
} from './assets.js';
import {
  boardPaperFamilyFor, boardPaperParams, shouldDressBoardPaper, CAST_PAPER_TILE_METERS
} from './paper.js';
import { ROPE_TILE_METERS, ROPE_FAMILY } from './rope.js';
import { loadGlb } from './glb.js';
import {
  glassKindFor,
  glassStateFor,
  glassCastsShadow
} from './glass.js';
import {
  advanceWaterOffset,
  WATER_FLOW_SPEED
} from './water.js';
import {
  shadowSettings,
  shadowFrustumFor,
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

  // The night sky's star field. A few hundred points on the inside of the dome,
  // additive so they glow, faded in/out per phase by applyPhase(). Built from
  // the pure numbers in src/stars.js so the exact field is unit-testable.
  const starFieldData = buildStarField();
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starFieldData.position, 3));
  starGeometry.setAttribute('color', new THREE.BufferAttribute(starFieldData.color, 3));
  const starMaterial = new THREE.PointsMaterial({
    size: 0.9, vertexColors: true, sizeAttenuation: true,
    fog: false, depthWrite: false, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending
  });
  // Keep the mesh name stable for the browser suite and any future star
  // evidence: the check finds it by name, not by structure.
  const starField = new THREE.Points(starGeometry, starMaterial);
  starField.name = 'sky-stars';
  starField.renderOrder = -1;
  scene.add(starField);

  let starTime = 0;

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
  const gateStoneMeshes = [];
  for (const x of [GATE.minX - 0.35, GATE.maxX + 0.35]) {
    const pier = addBox(scene, colliders, {
      size: [0.7, wallHeight + 0.9, 1.4],
      position: [x, (wallHeight + 0.9) / 2, -HALF],
      material: pierMaterial,
      castShadow: true
    });
    pier.name = 'gate-pier';
    gateStoneMeshes.push(pier);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(GATE.width + 1.4, 0.55, 1.4), pierMaterial);
  lintel.name = 'gate-lintel';
  lintel.position.set(GATE.x, wallHeight + 0.62, -HALF);
  lintel.castShadow = true;
  scene.add(lintel);
  gateStoneMeshes.push(lintel);

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
  // Named so the prop-family dressing pass can match them: upgradePropFamilies()
  // keys off the material name through propFamilyFor(), so an unnamed material is
  // invisible to it no matter how the mesh is registered. `LaneWood` must not
  // contain "Roof", and the awning is named for the roof family on purpose.
  const laneWood = new THREE.MeshStandardMaterial({ color: 0x7a5232, roughness: 0.8 });
  laneWood.name = 'LaneWood';
  const laneRoof = new THREE.MeshStandardMaterial({ color: 0x6d3a2c, roughness: 0.75 });
  laneRoof.name = 'LaneRoof';
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
  // The lane's procedural props were the last large surfaces in the scene that
  // no dressing pass could reach. upgradePropFamilies() walks the `propGroups`
  // registry, and that registry was only ever populated from loaded GLB models --
  // so a run where the lane GLBs do not arrive left the counters, crates, barrel,
  // sacks and notice frame as bare colour. A live scene-graph audit
  // (scripts/audit-materials.mjs) ranked exactly those meshes as the biggest flat
  // area in the world. Collecting them as they are built means the existing
  // family pass dresses them from the same maps as the models would have used,
  // with no second code path and no per-mesh rules to keep in sync.
  const lanePropsGroup = new THREE.Group();
  lanePropsGroup.name = 'lane-props-standin';
  scene.add(lanePropsGroup);
  // The job board's paper surfaces live outside the prop registry (they are
  // added to the scene directly, not lanePropsGroup), so the paper family pass
  // collects them here. See upgradeBoardPaper().
  const boardMeshGroup = new THREE.Group();
  boardMeshGroup.name = 'job-board-paper';
  scene.add(boardMeshGroup);
  const lanePropMeshes = [];

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
      lanePropMeshes.push(post);
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
      barrel.userData = { barrelStandin: true };
      scene.add(barrel);
      lanePropMeshes.push(barrel);
      colliders.push(boxCollider(
        prop.x - prop.width / 2, prop.z - prop.depth / 2,
        prop.x + prop.width / 2, prop.z + prop.depth / 2
      ));
    } else {
      addBox(scene, colliders, {
        size: [prop.width, prop.height, prop.depth],
        position: [prop.x, prop.height / 2, prop.z],
        // The stall counter and the lane crates are planked, not shingled, so
        // they take the wood family. Only the awning above is laneRoof; the
        // crates used to share it, which would have dressed a 1.1 m crate in
        // 1.1 m roof tiles.
        material: laneWood,
        castShadow: true
      });
      // The counter/board box addBox() just appended is the last scene child.
      const boardBox = scene.children[scene.children.length - 1];
      if (boardBox && boardBox.isMesh) lanePropMeshes.push(boardBox);
      if (prop.kind === 'stall') {
        const roofBox = addBox(scene, [], {
          size: [prop.width + 0.5, 0.25, prop.depth + 0.4],
          position: [prop.x, prop.height + 0.15, prop.z],
          material: laneRoof,
          castShadow: true
        });
        roofBox.userData = { stallStandin: true };
        lanePropMeshes.push(roofBox);
        // The counter box added just above is the previous scene child.
        const counterBox = scene.children[scene.children.length - 2];
        if (counterBox && counterBox.isMesh) {
          counterBox.userData = counterBox.userData || {};
          counterBox.userData.stallStandin = true;
        }
      }
    }
  }

  // The lane meshes are reparented into `lanePropsGroup` just below, once every
  // push has happened: an earlier loop here silently left anything collected
  // later -- the sacks and the notice frame -- outside the group, and so
  // outside the family dressing pass. The group registers with that pass
  // beside the `propGroups` declaration further down.

  // Bunting: strands across the lane with triangular flags. It hangs above
  // head height (2.6-2.75 m with a sag), so it deliberately registers NO
  // collider -- a player walks under it. laneBuntingOverhead() in areas.js
  // holds that promise to a test rather than to a comment.
  // The rope is its own material, not `laneWood`. It used to share laneWood,
  // which meant three thin visible BoxGeometry ropes carried a name that the
  // family pass dresses -- and kept the authored 0..1 per-face UVs, so a live
  // audit found exactly three visible mapped meshes whose texel density varied
  // 20x across their own faces. A 2 cm rope should not be planked anyway.
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0x6b5236, roughness: 0.95 });
  ropeMat.name = 'LaneRope';
  const buntingMat = new THREE.MeshStandardMaterial({ color: 0xc9553f, roughness: FELT_FAMILY.roughness });
  const buntingMatB = new THREE.MeshStandardMaterial({ color: 0xe0b552, roughness: FELT_FAMILY.roughness });
  // Named, like the rope, so a live material audit attributes their area to the
  // bunting instead of dumping the pennants into one anonymous bucket, and so
  // the felt pass has something to match on. Rounds 67-71 left them flat on
  // purpose -- a 1.2 m cloth weave is a fraction of a texel across a 0.16 m flag.
  // Round 72 fixes that with flag-scale felt: FELT_TEXTURE_FILES is matted fibre
  // at a 0.18 m tile (one pennant face wide, see BUNTING_TILE_METERS), and its
  // neutral albedo is multiplied by these dyes, so the flags stay red and gold
  // (see upgradeBuntingFelt).
  buntingMat.name = 'BuntingRed';
  buntingMatB.name = 'BuntingGold';
  // The pennants are collected here so the felt pass can reach them without a
  // scene-wide traverse that would also catch every other mesh in the lane.
  const buntingFlags = [];
  // Round 86: the three rope strands are collected the same way, so
  // upgradeLaneRope() dresses exactly the `LaneRope` meshes and nothing else.
  const buntingRopes = [];
  const flagGeometry = new THREE.ConeGeometry(0.09, 0.22, 3);
  for (const strand of LANE_BUNTING) {
    // The rope: a thin box spanning the lane, dipping in the middle.
    const rope = new THREE.Mesh(
      new THREE.BoxGeometry(LANE.maxX - LANE.minX, 0.02, 0.02),
      ropeMat
    );
    // Approximate the sag with two angled halves so the rope visually dips.
    rope.position.set((LANE.minX + LANE.maxX) / 2, strand.y - strand.sag / 2, strand.z);
    scene.add(rope);
    buntingRopes.push(rope);
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
      buntingFlags.push(flag);
    }
  }

  // Sacks leaning against the stall. These DO get colliders, because they sit
  // on the floor; laneDressingClear() proves each leaves 1.2 m of walkway.
  const sackMat = new THREE.MeshStandardMaterial({ color: 0xa89468, roughness: 0.95 });
  const sackTieMat = new THREE.MeshStandardMaterial({ color: 0x6f5f42, roughness: 0.9 });
  // Named so the family pass can tell them apart: the round-67 cloth family's
  // test is /cloth/i, which matches `SackCloth` (woven sack body) and the cast's
  // `Cloth` coats but deliberately NOT `SackTie` (the pinched neck and the
  // lantern ties, 9 small meshes at ~0.02 m). A tie is knotted cord, not woven
  // cloth worth 1.2 m of weave, so it stays its own flat dark leather colour.
  sackMat.name = 'SackCloth';
  sackTieMat.name = 'SackTie';
  for (const sack of LANE_SACKS) {
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(sack.radius, sack.radius * 0.86, sack.height, 9),
      sackMat
    );
    body.position.set(sack.x, sack.height / 2, sack.z);
    body.castShadow = true;
    body.receiveShadow = true;
    scene.add(body);
    lanePropMeshes.push(body);
    // A pinched neck so it reads as a sack, not a barrel.
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(sack.radius * 0.45, sack.radius * 0.62, 0.12, 9),
      sackTieMat
    );
    neck.position.set(sack.x, sack.height + 0.03, sack.z);
    neck.castShadow = true;
    scene.add(neck);
    lanePropMeshes.push(neck);
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
  lanePropMeshes.push(boardFrame);
  const boardFace = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 1.2),
    new THREE.MeshStandardMaterial({ color: 0xd8c9a8, roughness: 0.95 })
  );
  boardFace.position.set(NOTICE_BOARD.x - 0.14, 1.25, NOTICE_BOARD.z);
  boardFace.rotation.y = -Math.PI / 2;
  boardFace.userData = { noticeStandin: true };
  // The lane notice board's face is 1.4 x 1.2 m of painted board -- big enough
  // that leaving it anonymous merged it into a shared (unnamed) audit bucket
  // and hid it behind smaller surfaces. Named, like the job board's face.
  boardFace.material.name = 'NoticeFaceLane';
  scene.add(boardFace);
  colliders.push(boxCollider(
    NOTICE_BOARD.x - 0.3, NOTICE_BOARD.z - 0.9,
    NOTICE_BOARD.x + 0.3, NOTICE_BOARD.z + 0.9
  ));

  // Every lane prop is now collected. Reparent, do not clone: the meshes keep
  // their world transforms and the colliders above keep referencing the same
  // prop data, so gameplay is unchanged; what changes is that the family
  // dressing pass, registered to this group beside the propGroups declaration,
  // can now reach them.
  for (const mesh of lanePropMeshes) {
    if (mesh.parent) mesh.parent.remove(mesh);
    lanePropsGroup.add(mesh);
  }

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

    // Named for the audit, not for a prop family: this housing is 0.24 m across,
    // so a 0.6 m iron tile would smear three chips of paint over the whole thing.
    // It is deliberately left flat like the bunting flags it hangs among, and
    // `LanternHousing` matches no family test so that stays true by construction.
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.12, LANTERN_HEIGHT, 8),
      new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.5, metalness: 0.35 })
    );
    body.material.name = 'LanternHousing';
    body.position.set(placed.x, lanternY, placed.z);
    body.castShadow = true;
    fixture.add(body);

    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xffd479, emissive: 0xffb43a, emissiveIntensity: 0 })
    );
    // Not `LampBulb`: the plaza fixtures keep that name, and these three bulbs
    // are the ones applyPhase() writes through laneLamps[].bulb. Same colour,
    // different owner -- the audit must be able to tell them apart.
    bulb.material.name = 'LanternBulb';
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

  // A painted banner over the terrace marks it as the north wall. This is the
  // stand-in that upgradeBanner() replaces with the modelled cloth+rod GLB when
  // assets load; the collider stays untouched either way.
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 1.1),
    new THREE.MeshStandardMaterial({ color: 0x2f5d8a, roughness: 0.8, side: THREE.DoubleSide })
  );
  // 5.3 m2 of painted banner cloth: the largest flat surface left after the
  // iron family. Named so the audit attributes it instead of folding it into a
  // shared anonymous bucket, and worded so it matches no weave family -- a
  // banner is sized and painted, not woven at a 1.2 m repeat.
  banner.material.name = 'TerraceBanner';
  banner.userData.bannerStandin = true;
  banner.position.set(0, TERRACE.height + 1.5, TERRACE.minZ + 0.08);
  scene.add(banner);
  // Keep a handle so upgradeBanner() can hide it without a scene traversal.
  const bannerStandin = banner;

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
  // The whole stand-in gets the marker, not just the counter: the modelled
  // awning and posts replace the flat roof slab and the stick posts, and
  // leaving any of them visible doubles the stall. Only the counter carries a
  // size, because only it defines where and how big the model instance sits.
  const eastRoofSlab = addBox(scene, colliders, { size: [4.4, 0.3, 2.6], position: [11, 2.2, -3], material: roof, castShadow: true });
  eastRoofSlab.userData = { marketStallStandin: true };
  const eastPostNear = addBox(scene, colliders, { size: [0.2, 2.2, 0.2], position: [9.3, 1.1, -4.1], material: wood });
  eastPostNear.userData = { marketStallStandin: true };
  const eastPostFar = addBox(scene, colliders, { size: [0.2, 2.2, 0.2], position: [12.7, 1.1, -4.1], material: wood });
  eastPostFar.userData = { marketStallStandin: true };

  const westCounter = addBox(scene, colliders, { size: [3, 0.9, 0.4], position: [-11, 0.45, 6], material: wood, castShadow: true });
  westCounter.userData = { marketStallStandin: true, marketStallSize: 'small' };
  const westRoofSlab = addBox(scene, colliders, { size: [3.4, 0.3, 2.2], position: [-11, 1.7, 6], material: roof, castShadow: true });
  westRoofSlab.userData = { marketStallStandin: true };

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
    boardFace.material.name = 'BoardFace';
    boardFace.position.set(JOB_BOARD.x, 1.3, JOB_BOARD.z + 0.13);
    scene.add(boardFace);
    boardMeshGroup.add(boardFace);
    // Pinned slips of paper, so it reads as a job board from a distance.
    for (let i = 0; i < 3; i += 1) {
      const slip = new THREE.Mesh(
        new THREE.PlaneGeometry(0.22, 0.3),
        new THREE.MeshStandardMaterial({ color: 0xf2ead6, roughness: 1 })
      );
      slip.material.name = 'BoardPaper';
      slip.position.set(JOB_BOARD.x - 0.34 + i * 0.34, 1.26 + (i % 2) * 0.14, JOB_BOARD.z + 0.14);
      scene.add(slip);
      boardMeshGroup.add(slip);
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
    // Marked so upgradeBarrels() can find and remove this cylinder when the
    // modelled barrel arrives. It used to look for a mesh named
    // 'barrel-standin', but nothing was ever given that name, so the procedural
    // cylinders stayed drawn underneath the models -- a duplicate every load.
    barrel.userData = { barrelStandin: true };
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
  // The ortho box is derived from the areas' declared bounds, not hard-coded.
  // It used to be a fixed +-24 around the origin, which predated the market
  // lane: every lane prop north of that box was silently dropped from the
  // depth pass, so the lane's barrels, stalls and sacks cast and received no
  // sun shadow at all. shadowFrustumFor also returns the box centre, so the
  // light is aimed at the middle of the whole world rather than the origin.
  const shadowBox = shadowFrustumFor(AREAS);
  sun.shadow.camera.left = shadowBox.left;
  sun.shadow.camera.right = shadowBox.right;
  sun.shadow.camera.top = shadowBox.top;
  sun.shadow.camera.bottom = shadowBox.bottom;
  sun.shadow.camera.near = shadowBox.near;
  sun.shadow.camera.far = shadowBox.far;
  // Aim the light's target at the world centre the box is built around. The
  // light itself keeps its authored direction, so the sun still comes from the
  // same place in the sky; only where the shadow frustum is pointed changes.
  sun.target.position.set(shadowBox.centre.x, 0, shadowBox.centre.z);
  sun.shadow.camera.updateProjectionMatrix();
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
  // The procedural lane props (counters, crates, barrel, sacks, notice frame)
  // were collected into `lanePropsGroup` earlier in the build, before this
  // registry existed. Register them now so upgradePropFamilies() dresses them.
  propGroups.push({ group: lanePropsGroup, tile: 1.5 });
  // Loaded maps keyed by PROP_FAMILIES id (leaf/roof/bark/wood). One fetch each,
  // shared by every mesh in the family; cloneTextureFamily() gives each mesh its
  // own sampler state.
  const familyTextures = {};
  // Every glass pane the models contribute (house windows and lamp housings).
  // Each entry is { mesh, kind, lane }, and applyGlass() writes the pane's
  // colour, reflectivity and glow for the current hour. `lane` is captured at
  // registration: it marks the one fixture whose bulb is the player's to light
  // (the lane post), so its pane stays dark until the round is walked. Windows
  // and the four plaza lamps ignore it. The bunting lanterns are procedural
  // (LanternHousing/LanternBulb), carry no glass and register nothing.
  const glassPanes = [];
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
    cloth: 'flat',
    clothDetail: null,
    bunting: 'flat',
    buntingDetail: null,
    // Round 86: the lane bunting's rope strands (LaneRope), dressed separately
    // from the felt flags because a 2 cm rope wants a fibre map, not a weave.
    rope: 'flat',
    ropeDetail: null,
    iron: 'flat',
    ironDetail: null,
    banner: 'plane',
    bannerDetail: null,
    cobble: 'flat',
    grass: 'flat',
    walls: 'flat',
    gateStone: 'flat',
    fountainStone: 'flat',
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
    terraceDetail: null,
    gateStoneDetail: null,
    fountainStoneDetail: null,
    water: 'flat',
    waterDetail: null,
    // Round 74: window and lamp panes. Glass is dressed per phase, not per
    // texture, so this reports the counts rather than a map list.
    glass: 'flat',
    glassDetail: null
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
      // Remove the procedural cylinders so the model is what you see. Traverse
      // the whole graph: the lane barrel lives in lanePropsGroup now, and
      // scene.remove() cannot detach a child of another group.
      const standins = [];
      scene.traverse((c) => {
        if (c.userData && c.userData.barrelStandin) standins.push(c);
      });
      for (const s of standins) {
        if (s.parent) s.parent.remove(s);
      }
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
   * Builds a dressed stone material for one of the fountain's two stones.
   *
   * The maps are cloned per stone because `applyTextureFamily` (and every other
   * dresser here) writes sampler state onto the texture object: sharing one object
   * between Stone and StoneDark would be harmless while both project at 1.6 m, but
   * it is the kind of sharing that breaks silently the next time one of them wants
   * a different repeat. The colour is white for `Stone`, so the map's own albedo
   * is not tinted twice; `StoneDark` keeps a tint multiplier (see
   * `fountainStoneTint`) because a white map would otherwise make the plinth,
   * finial and corner blocks identical to the basin they sit under.
   */
  function fountainStoneMaterial(source, textures) {
    const params = fountainStoneMaterialParams(true, source.name);
    const material = new THREE.MeshStandardMaterial({
      color: fountainStoneTint(source.name, true),
      roughness: params.roughness,
      metalness: params.metalness,
      side: source.side
    });
    material.name = source.name;
    applyTextureFamily(material, { ...cloneTextureFamily(textures), anyLoaded: true }, 1, 1, 1,
      fountainStoneTint(source.name, true));
    return material;
  }

  /**
   * Applies one loaded texture family to a material. Shared by stone, wood and
   * brick so the tiling/anisotropy rules live in exactly one place.
   * `widthMeters`/`heightMeters` pick the repeat so texel density stays sane.
   *
   * `tint` is the multiplier written into `material.color`, white by default
   * because a map must not be tinted twice. The one caller that passes a
   * non-white tint is the fountain's dark stone, which has to stay visibly
   * darker than the light one while both share a map (see `fountainStoneTint`).
   * This parameter is deliberate rather than the caller resetting `color` after
   * the call: the reset below is the rule, and a caller quietly undoing it
   * afterwards would be invisible to anyone reading this function.
   */
  function applyTextureFamily(material, textures, widthMeters, heightMeters, tileMeters, tint = 0xffffff) {
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
    material.color.setHex(tint);
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
      // Search the whole scene graph, not scene.children: the lane props were
      // reparented into lanePropsGroup so the family dressing pass could reach
      // them, and a direct-children scan silently stopped finding them.
      scene.traverse((c) => {
        if (c.userData && c.userData.stallStandin) c.visible = false;
      });
      // Discover lane stall positions from the lane props data.
      const laneStallPositions = [];
      // We re-derive from the same LANE_PROPS the build loop used; simpler to
      // scan the scene for standin markers' positions.
      scene.traverse((c) => {
        if (c.userData && c.userData.stallStandin && c.position) {
          // counter box centre -> model origin at ground
          laneStallPositions.push({ x: c.position.x, z: c.position.z, height: 1.0 });
        }
      });
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
          // Round 74: a lamp pane follows the hour and its own bulb. Register
          // every housing pane; the four plaza posts share one cached material
          // object and all four should look the same, so writing it four times
          // is idempotent by construction. A pane never casts (see glass.js).
          const glassKind = glassKindFor(material.name || '');
          if (glassKind) {
            mesh.castShadow = glassCastsShadow(glassKind);
            glassPanes.push({ mesh, kind: glassKind, lane: false });
          }
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
            // projectBoxGeometry splits any corner that triangles need to
            // project on different planes; the wrought-iron brackets and rings
            // are full of such corners.
            projectBoxGeometry({
              THREE,
              geometry,
              // The maps are painted at roughly a 0.6 m tile, so grain and chips
              // stay the size a hand would paint them, not wallpaper.
              tileMeters: 0.6
            });
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
        // Round 74: the lane post's pane follows the lantern round, which the
        // plaza panes do not. It shares the cached LampGlass material object
        // with the four plaza lanterns, so it must be cloned before this pass
        // writes a lane-only dark state -- the same trap round 55 hit with the
        // bulb's emissive. A cloned pane keeps its own emissive for the hour.
        const glassKind = glassKindFor(material.name || '');
        if (glassKind) {
          // Clone the mesh's *own* material rather than `material` (the shared
          // cached source): the loop above may already have cloned it, and
          // cloning the source again would throw away that copy's identity.
          const paneMaterial = mesh.material && mesh.material !== material
            ? mesh.material
            : (needsOwnMaterial({ mutatesMaterial: true, sharedSource: true })
              ? material.clone() : material);
          mesh.material = paneMaterial;
          mesh.castShadow = glassCastsShadow(glassKind);
          glassPanes.push({ mesh, kind: glassKind, lane: true });
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

  function upgradeBanner() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.banner = 'unavailable';
      return Promise.resolve(assetState);
    }
    return Promise.all([
      loadBanner({ THREE, loadGlb }),
      loadMaterialTextures({ THREE, files: BANNER_TEXTURE_FILES }),
      loadMaterialTextures({ THREE, files: LAMP_TEXTURE_FILES })
    ]).then(([result, canvasTextures, ironTextures]) => {
      if (!result.ok) {
        assetState.banner = 'plane';
        assetState.bannerDetail = result.reason;
        return assetState;
      }
      // Hide the stand-in (the old flat plane).
      if (bannerStandin) bannerStandin.visible = false;
      scene.traverse((c) => {
        if (c.userData && c.userData.bannerStandin) c.visible = false;
      });
      const group = new THREE.Group();
      group.name = 'banner-model';
      // Authored around the cloth centre facing glTF +Z (the plaza); only position.
      group.position.set(0, TERRACE.height + 1.5, TERRACE.minZ + 0.08);
      let canvasDressed = 0;
      let ironDressed = 0;
      for (const { name, geometry, material } of result.meshes) {
        const own = needsOwnMaterial({ mutatesMaterial: false, sharedSource: true });
        const mesh = new THREE.Mesh(geometry, own ? material.clone() : material);
        mesh.name = name;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const isIron = name === 'BannerRod' || name === 'BannerFinial' || name === 'BannerStrap';
        if (name === 'BannerCanvas') {
          mesh.material = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.92,
            metalness: 0,
            side: THREE.DoubleSide,
            name: 'BannerCanvas'
          });
          if (canvasTextures.anyLoaded) {
            for (const [key, texture] of Object.entries(canvasTextures)) {
              if (!texture || key === 'anyLoaded') continue;
              const copy = texture.clone();
              copy.needsUpdate = true;
              copy.wrapS = THREE.ClampToEdgeWrapping;
              copy.wrapT = THREE.ClampToEdgeWrapping;
              copy.repeat.set(1, 1);
              copy.anisotropy = Math.min(4, renderer.capabilities?.getMaxAnisotropy?.() || 1);
              mesh.material[key] = copy;
            }
            canvasDressed = 1;
          }
        } else if (isIron) {
          if (!geometry.getAttribute('uv')) {
            projectBoxGeometry({ THREE, geometry, tileMeters: 0.6 });
          }
          const iron = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.55,
            metalness: 0.45,
            name: name
          });
          if (ironTextures && ironTextures.anyLoaded) {
            for (const [key, texture] of Object.entries(ironTextures)) {
              if (!texture || key === 'anyLoaded') continue;
              const copy = texture.clone();
              copy.needsUpdate = true;
              copy.wrapS = THREE.RepeatWrapping;
              copy.wrapT = THREE.RepeatWrapping;
              copy.repeat.set(1, 1);
              iron[key] = copy;
            }
            ironDressed += 1;
          }
          mesh.material = iron;
        }
        group.add(mesh);
      }
      scene.add(group);
      propGroups.push({ group, tile: 1.5 });
      assetState.banner = 'model';
      assetState.bannerDetail = {
        parts: result.meshes.length,
        bytes: result.bytes,
        instances: 1,
        canvasDressed,
        ironDressed,
        maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => canvasTextures[k])
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
      // Hide the whole procedural stand-in -- counter, roof slab and posts --
      // but keep its colliders: the modelled awning replaces the flat slab
      // instead of duplicating it, and the modelled posts replace the sticks.
      const standins = scene.children.filter((c) => c.userData && c.userData.marketStallStandin);
      for (const c of standins) c.visible = false;
      // Only counters define an instance. The roof and post stand-ins carry the
      // same hide marker but no size; scaling the model to a roof slab's height
      // would stretch it to 4.4 m tall.
      const instances = [];
      for (const c of standins) {
        if (!c.userData.marketStallSize) continue;
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
            projectBoxGeometry({ THREE, geometry: mesh.geometry, tileMeters: 1.2 });
          }
          // Tree trunks get the same near-ground darkening as dressed props:
          // without it a bark-textured trunk meets the grass with a hard seam.
          applyContactDarkeningGeometry({ THREE, geometry: mesh.geometry });
          const material = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.85,
            metalness: 0,
            vertexColors: environment.quality !== 'low'
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
          // Same marker the generic prop pass sets: this mesh is dressed, so an
          // audit can tell it apart from a bark-named material nothing touched.
          mesh.userData.propFamily = 'bark';
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
      assetState.cloth = 'unavailable';
      assetState.iron = 'unavailable';
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
      // Round 67: the cloth maps are fetched with the other prop families so
      // upgradePropFamilies() can dress the lane `SackCloth` sacks in the same
      // pass as the wood/brick/stone props. The cast's `Cloth` coats are NOT in
      // the prop registry (they live in npcs.js and must keep their authored
      // per-NPC tint), so they are dressed by their own pass there.
      //
      // Round 70: the painted-iron prop family needs the same lamp_* maps the
      // lane lantern already uses. They are fetched here, once, and handed to
      // upgradePropFamilies() through `familyTextures.iron`, so the plaza
      // ironwork and the lane fixture end up with one shared look. `upgradeLaneLamp()`
      // runs its own load for the head it dresses in code; the browser caches
      // the three files, so this is a cache hit rather than a second download.
      return Promise.all([
        loadMaterialTextures({ THREE, files: CLOTH_TEXTURE_FILES }),
        loadMaterialTextures({ THREE, files: LAMP_TEXTURE_FILES })
      ]).then(([cloth, iron]) => {
        if (cloth.anyLoaded) {
          familyTextures.cloth = cloth;
          assetState.cloth = 'textured';
          assetState.clothDetail = {
            maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => cloth[k])
          };
        } else {
          assetState.cloth = 'flat';
        }
        if (iron.anyLoaded) {
          familyTextures.iron = iron;
          assetState.iron = 'textured';
          assetState.ironDetail = {
            maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => iron[k])
          };
        } else {
          assetState.iron = 'flat';
        }
        return assetState;
      });
    });
  }

  function upgradeBuntingFelt() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.bunting = 'unavailable';
      return Promise.resolve(assetState);
    }
    return loadMaterialTextures({ THREE, files: FELT_TEXTURE_FILES }).then((textures) => {
      if (!textures.anyLoaded) {
        assetState.bunting = 'flat';
        return assetState;
      }
      // The flags share one generated geometry and two materials, so a per-mesh
      // copy of each texture would be 28 samplers for one fibre mat. One copy
      // per material keeps the sampler state shared and the flags independent.
      const dressed = new Map();
      let flags = 0;
      let seams = 0;
      for (const flag of buntingFlags) {
        const source = flag.material;
        if (!source || !/bunting/i.test(source.name || '')) continue;
        // Metre-space UVs, not the cone's authored 0..1 pair: a 0..1 map on a
        // 0.16 m face is one texel of nap stretched over the whole flag. The
        // projection also splits the three cone corners that straddle axes, so
        // the diagonal seam of each pennant does not shear.
        const split = projectBoxGeometry({
          THREE,
          geometry: flag.geometry,
          tileMeters: FELT_FAMILY.tileMeters
        });
        seams += split.seams;
        let material = dressed.get(source);
        if (!material) {
          material = new THREE.MeshStandardMaterial({
            // keepTint: the felt albedo is neutral, so the authored red/gold dye
            // is what the flags are coloured with. Forcing white here would turn
            // the whole lane's bunting into unbleached felt.
            color: source.color ? source.color.getHex() : 0xffffff,
            roughness: FELT_FAMILY.roughness,
            metalness: 0,
            // The source name is what the material audit and the tests key on;
            // losing it would merge 28 flags back into an anonymous bucket.
            name: source.name,
            side: source.side
          });
          for (const [key, texture] of Object.entries(textures)) {
            if (!texture || key === 'anyLoaded') continue;
            const copy = texture.clone();
            copy.needsUpdate = true;
            copy.wrapS = THREE.RepeatWrapping;
            copy.wrapT = THREE.RepeatWrapping;
            // UVs are already in metres; one repeat keeps the felt tile size
            // (see BUNTING_TILE_METERS -- one pennant face wide).
            copy.repeat.set(1, 1);
            // Flags are seen edge-on along the whole lane, which is the worst
            // case for a fibre map: at grazing angles a low anisotropy turns
            // the nap into blur. 8 rather than 4 because the flags are small
            // and few, so this is a cheap place to spend a sample.
            copy.anisotropy = Math.min(8, renderer.capabilities?.getMaxAnisotropy?.() || 1);
            material[key] = copy;
          }
          dressed.set(source, material);
        }
        flag.material = material;
        flags += 1;
      }
      assetState.bunting = flags > 0 ? 'textured' : 'flat';
      assetState.buntingDetail = {
        flags,
        materials: dressed.size,
        seams,
        maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => textures[k]),
        tileMeters: FELT_FAMILY.tileMeters
      };
      return assetState;
    });
  }

  /**
   * Dresses the lane bunting's rope strands (Round 86).
   *
   * The three `LaneRope` boxes are 2 cm square and 20+ m long, so the authored
   * 0..1 box UVs would smear one texel along the whole span. A metre-space box
   * projection at ROPE_TILE_METERS (0.08 m) puts a few tiles across the width
   * and hundreds along the length, which is what makes the twisted-fibre map
   * read as lay rather than as a flat brown stripe.
   *
   * All three strands share one source material, so one dressed material is
   * made and handed to all three; the geometries are separate, so each gets its
   * own projection and its own seam count. `keepTint` is true (see rope.js):
   * the rope albedo is near-neutral, so the authored 0x6b5236 brown must stay
   * as the tint over the map.
   */
  function upgradeLaneRope() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.rope = 'unavailable';
      return Promise.resolve(assetState);
    }
    return loadMaterialTextures({ THREE, files: ROPE_TEXTURE_FILES }).then((textures) => {
      if (!textures.anyLoaded) {
        assetState.rope = 'flat';
        return assetState;
      }
      const dressed = new Map();
      let ropes = 0;
      let seams = 0;
      for (const rope of buntingRopes) {
        const source = rope.material;
        if (!source || !/lanerope/i.test(source.name || '')) continue;
        // Metre-space UVs, not the box's authored 0..1 pair: the rope is the
        // longest thin surface in the lane, so a 0..1 map is the worst case in
        // the scene. The projection also splits the box corners that straddle
        // axes so the fibre does not shear along an edge.
        const split = projectBoxGeometry({
          THREE,
          geometry: rope.geometry,
          tileMeters: ROPE_TILE_METERS
        });
        seams += split.seams;
        let material = dressed.get(source);
        if (!material) {
          material = new THREE.MeshStandardMaterial({
            // keepTint: the rope albedo carries no strong hue, so the authored
            // 0x6b5236 brown is what colours the strand. Forcing white would
            // turn the bunting's rope into pale unbleached cord.
            color: source.color ? source.color.getHex() : 0xffffff,
            roughness: ROPE_FAMILY.roughness,
            metalness: ROPE_FAMILY.metalness,
            // The source name is what the material audit and the tests key on;
            // losing it would drop the ropes back into an anonymous bucket.
            name: source.name,
            side: source.side
          });
          for (const [key, texture] of Object.entries(textures)) {
            if (!texture || key === 'anyLoaded') continue;
            const copy = texture.clone();
            copy.needsUpdate = true;
            copy.wrapS = THREE.RepeatWrapping;
            copy.wrapT = THREE.RepeatWrapping;
            // UVs are already in metres; one repeat keeps the rope tile size
            // (see ROPE_TILE_METERS -- 0.08 m of lay fibre).
            copy.repeat.set(1, 1);
            // The strands are seen edge-on down the whole lane, the worst case
            // for a fibre map, so spend the full anisotropy the renderer offers
            // (capped at 8): there are only three ropes, so this is cheap.
            copy.anisotropy = Math.min(8, renderer.capabilities?.getMaxAnisotropy?.() || 1);
            material[key] = copy;
          }
          dressed.set(source, material);
        }
        rope.material = material;
        rope.userData.ropeDressed = true;
        ropes += 1;
      }
      assetState.rope = ropes > 0 ? 'textured' : 'flat';
      assetState.ropeDetail = {
        ropes,
        materials: dressed.size,
        seams,
        maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => textures[k]),
        tileMeters: ROPE_TILE_METERS
      };
      return assetState;
    });
  }

  /**
   * Dresses the fountain's two water discs with the procedural water family.
   *
   * The GLB ships `FountainWaterLower` / `FountainWaterUpper` as flat octagons
   * (colour #97c8e3, roughness 0.15, metalness 0.1, no maps, no UVs). A uniform
   * blue disc is the last obviously plastic surface in the plaza, so this gives
   * each disc a metre-space box projection and the tileable water maps.
   *
   * `keepTint` is deliberately false here: unlike the bunting, whose authored
   * dyes are the whole point, the fountain's authored #97c8e3 is a placeholder
   * flat colour that this family is replacing. The map carries the water colour
   * and the material projects white, the same rule as the stone pass.
   *
   * Water is reflective, so the maps request anisotropy 8 (the discs are seen at
   * a grazing angle from across the plaza) but no per-mesh material copy: both
   * discs share one material because they share one surface treatment.
   */
  function upgradeFountainWater() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.water = 'unavailable';
      return Promise.resolve(assetState);
    }
    return loadMaterialTextures({ THREE, files: WATER_TEXTURE_FILES }).then((textures) => {
      if (!textures.anyLoaded) {
        assetState.water = 'flat';
        return assetState;
      }
      const model = fountainGroup.getObjectByName('fountain-model');
      const discs = [];
      model?.traverse?.((mesh) => {
        if (mesh.isMesh && /water/i.test(mesh.material?.name || '')) discs.push(mesh);
      });
      if (!discs.length) {
        // The stand-in fountain is still in place (or the model failed to load);
        // there is nothing to dress, and the flat fallback is already showing.
        assetState.water = 'stand-in';
        return assetState;
      }
      let seams = 0;
      for (const disc of discs) {
        const split = projectBoxGeometry({
          THREE,
          geometry: disc.geometry,
          tileMeters: WATER_TILE_METERS
        });
        seams += split.seams;
      }
      // Partial loads degrade toward the authored look rather than to a worse
      // one. With every map present the material projects white and a roughness
      // ceiling of 1: Three multiplies `roughness` into the sampled green
      // channel, so a low base would square the map down to a perfect mirror
      // and erase the crest variation (0.08 * 0.08 = 0.006). If a map is missing
      // (one file 404s, a decoder is gone) the authored GLB values are kept
      // instead -- white matte water would be worse than the flat disc it
      // replaced.
      const authored = discs[0].material;
      const material = new THREE.MeshStandardMaterial({
        color: textures.map ? 0xffffff : (authored?.color?.getHex?.() ?? 0x97c8e3),
        roughness: textures.roughnessMap ? 1 : (authored?.roughness ?? 0.15),
        metalness: authored?.metalness ?? 0.1,
        side: authored?.side,
        name: 'FountainWater'
      });
      for (const [key, texture] of Object.entries(textures)) {
        if (!texture || key === 'anyLoaded') continue;
        const copy = texture.clone();
        copy.needsUpdate = true;
        copy.wrapS = THREE.RepeatWrapping;
        copy.wrapT = THREE.RepeatWrapping;
        copy.repeat.set(1, 1);
        copy.anisotropy = Math.min(8, renderer.capabilities?.getMaxAnisotropy?.() || 1);
        material[key] = copy;
      }
      material.needsUpdate = true;
      for (const disc of discs) {
        disc.material = material;
        // Water never casts a hard shadow onto the basin floor (see upgradeFountain).
        disc.castShadow = false;
      }
      // Round 75: the moving surface needs a per-frame hook. Keep the material
      // and the shared offset on the environment so main.js can advance them
      // without reaching into this closure, and start from a zero offset so the
      // first frame is a no-op rather than a jump.
      environment.waterMaterial = material;
      environment.waterOffset = { x: 0, y: 0 };
      // The normal map is the only map that should travel; the albedo is the
      // water's colour and stays put, and the roughness map is the mirror
      // pattern that should ride with the highlight.
      for (const key of ['normalMap', 'roughnessMap']) {
        if (material[key]) material[key].offset.set(0, 0);
      }
      assetState.water = 'textured';
      assetState.waterDetail = {
        discs: discs.length,
        seams,
        maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => textures[k]),
        tileMeters: WATER_TILE_METERS
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
      // Hide the procedural frame and face; the collider stays. Traverse the
      // whole graph: the frame was reparented into lanePropsGroup for the family
      // pass, so a scene.children scan would leave it drawn under the model.
      scene.traverse((c) => {
        if (c.userData && c.userData.noticeStandin) c.visible = false;
      });
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
        // Round 74: the two window panes follow the hour. They are not a lamp
        // pane (no bulb sits behind them), so they glow from dusk even before
        // the lane's lanterns are lit. Keeping castShadow is the window frame's
        // silhouette; see glass.js.
        const glassKind = glassKindFor(material.name || '');
        if (glassKind) {
          mesh.castShadow = glassCastsShadow(glassKind);
          glassPanes.push({ mesh, kind: glassKind, lane: false });
        }
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
   * Reports what the glass pass found.
   *
   * Glass has no maps, so there is no load to fail: the panes either came in
   * with the models or they did not. This runs last so `glassPanes` is final,
   * and it also applies the current hour once so the panes are never left at
   * their authored flat colour between the asset load and the next phase pass
   * (applyPhase has already run by the time the models finish downloading).
   */
  function reportGlass() {
    const windows = glassPanes.filter((p) => p.kind === 'window').length;
    const lamps = glassPanes.filter((p) => p.kind === 'lamp').length;
    const lanes = glassPanes.filter((p) => p.lane).length;
    assetState.glass = glassPanes.length ? 'phase-lit' : 'flat';
    assetState.glassDetail = {
      panes: glassPanes.length,
      windows,
      lamps,
      lanePanes: lanes
    };
    if (glassPanes.length && environment.phase) {
      environment.applyGlass(environment.phase, {
        laneLit: environment.laneOn,
        low: environment.quality === 'low'
      });
    }
    return assetState;
  }

  /**
   * Dresses the modelled props in the material families that match their names.
   *
   * The prop GLBs are authored from untextured box primitives, so they carry no
   * UVs; boxProjectUvs() generates them in metres and every mesh in a family then
   * shares one tiling. A mesh keeps its own name-based test: only meshes whose
   * material matches a family (Blender names them *Wood, *Roof, *Brick,
   * HouseStone, Canopy, Trunk) get the maps, so iron bands and glass panes stay
   * flat and read as different materials.
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
    let seams = 0;
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
        // face, so every dressed mesh gets metre-space box-projected UVs. The
        // projection also splits corners that straddle an axis change (a barrel
        // rim, a sack shoulder); without that the last writer wins and those
        // triangles shear.
        const split = projectBoxGeometry({
          THREE,
          geometry: mesh.geometry,
          // The registry tile (per prop) stays the fallback, but a family with an
          // authored metre scale wins so one roof family tiles identically on a
          // 3 m stall awning and a 6 m house roof.
          tileMeters: family.tileMeters || tile
        });
        projected += 1;
        if (split.seams > 0) seams += split.seams;

        // Cheap contact darkening: darken vertices near the ground plane so
        // dressed props read as grounded. Stays in the standard material
        // pipeline (vertex colours) and degrades to nothing on the low tier.
        applyContactDarkeningGeometry({ THREE, geometry: mesh.geometry });

        const material = new THREE.MeshStandardMaterial({
          // A family whose map has no colour of its own (cloth) must keep the
          // tint its source material authored, or a burlap sack and a painted
          // coat both come out flat white. Every other family ships a coloured
          // albedo, so white is the correct neutral multiplier there.
          color: family.keepTint && source.color ? source.color.getHex() : 0xffffff,
          roughness: family.roughness,
          // Painted metal reads as metal: it needs to catch the sky. A family
          // that leaves this unset stays fully dielectric, which is right for
          // timber, brick and cloth. The iron family asks for 0.45 so its bands
          // and hoops share the lane lantern's sheen; the roughness map still
          // governs where the chips are dull.
          metalness: family.metalness ?? 0,
          // Dressing runs late, after several fetches, so it can finish after the
          // adaptive loop has already dropped to the low tier. Reading the
          // current tier here keeps the cue off instead of switching it back on.
          vertexColors: environment.quality !== 'low'
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
        // Marks the mesh as dressed by this pass, so an audit can tell a mesh
        // this pass owns from a family-named material that lives outside the
        // prop registry (the cast's WoodP props and the fountain's own stone
        // pass) and is deliberately left alone here.
        mesh.userData.propFamily = family.id;
        dressed += 1;
        byFamily[family.id] += 1;
      });
    }
    assetState.propWood = dressed > 0 ? 'textured' : 'flat';
    assetState.propWoodDetail = {
      dressed,
      projected,
      seams,
      groups: propGroups.length,
      byFamily
    };
    return Promise.resolve(assetState);
  }

  function upgradeBoardPaper() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.boardPaper = 'unavailable';
      return Promise.resolve(assetState);
    }
    return loadMaterialTextures({ THREE, files: PAPER_TEXTURE_FILES }).then((textures) => {
      if (!textures.anyLoaded) {
        assetState.boardPaper = 'flat';
        return assetState;
      }
      const result = dressBoardPaper(boardMeshGroup, textures, { THREE });
      assetState.boardPaper = result.dressed > 0 ? 'textured' : 'flat';
      assetState.boardPaperDetail = {
        dressed: result.dressed,
        seams: result.seams,
        maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => textures[k]),
        tileMeters: CAST_PAPER_TILE_METERS
      };
      return assetState;
    });
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
      stoneTexturesPromise = loadMaterialTextures({ THREE, files: STONE_TEXTURE_FILES })
        .then((textures) => {
          // The prop pass dresses the house trim (HouseStone) from this shared
          // fetch, so walls, terrace, gate and house all download the stone
          // family exactly once.
          if (textures.anyLoaded) familyTextures.stone = textures;
          return textures;
        });
    }
    return stoneTexturesPromise;
  }

  /**
   * Dresses the north gate's piers and lintel in the quarried stone family.
   *
   * The gate piers and lintel are large flat stone masses sitting dead ahead of
   * the plaza spawn, but they were still a bare 0x7b7163 material while the walls
   * beside them were dressed. They are the same quarried stone, so this shares
   * the walls' one stone request and clones its own texture set (propFamilyFor
   * deliberately resolves null for stone, so STONE_TEXTURE_FILES is used here
   * directly).
   */
  function upgradeGateStone() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.gateStone = 'unavailable';
      return Promise.resolve(assetState);
    }
    return loadStoneFamily().then((textures) => {
      if (!textures.anyLoaded) {
        assetState.gateStone = 'flat';
        return assetState;
      }
      // Unconditional: BoxGeometry ships 0..1 per-face UVs, which would smear one
      // whole map across every face. Replacing them with metre-space projection
      // is what keeps the ashlar courses at eye-level wall scale on the piers.
      for (const mesh of gateStoneMeshes) {
        projectBoxGeometry({ THREE, geometry: mesh.geometry,
          tileMeters: TERRACE_TEXTURE_TILE_METERS });
      }
      // Box-projected UVs already carry the tiling, so repeat stays 1:1; the
      // clone keeps this sampler state off the walls' and terrace's copies.
      applyTextureFamily(pierMaterial,
        { ...cloneTextureFamily(textures), anyLoaded: true }, 1, 1, 1);
      assetState.gateStone = 'textured';
      assetState.gateStoneDetail = {
        meshes: gateStoneMeshes.length,
        maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => textures[k]),
        tileMeters: TERRACE_TEXTURE_TILE_METERS
      };
      return assetState;
    });
  }

  /**
   * Dresses the modelled fountain's carved stone in the quarried stone family.
   *
   * The GLB gives its stone two flat-coloured materials, Stone and StoneDark, and
   * no UVs at all, so the bowl, column, basin and plinth read as smooth sculpted
   * plastic while the walls and terrace beside them are coursed ashlar. Both stone
   * materials share the walls' one stone request; each gets its own cloned texture
   * set because their authored base colours differ -- StoneDark has to stay the
   * darker stone (see `fountainStoneParts`), so its material keeps the authored
   * roughness while the shared maps carry the surface fabric.
   *
   * Water is deliberately left alone: `propFamilyFor` resolves null for it, and a
   * rippled stone albedo over a reflective surface would read as a wet flagstone.
   */
  function upgradeFountainStone() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.fountainStone = 'unavailable';
      return Promise.resolve(assetState);
    }
    return loadStoneFamily().then((textures) => {
      if (!textures.anyLoaded) {
        assetState.fountainStone = 'flat';
        return assetState;
      }
      const model = fountainGroup.getObjectByName('fountain-model');
      if (!model) {
        // The procedural stand-in is still in place; there is nothing projected to
        // dress yet, and upgradeFountain may still swap the model in behind us.
        assetState.fountainStone = 'stand-in';
        return assetState;
      }
      const parts = fountainStoneParts();
      const byPart = { stone: 0, dark: 0 };
      model.traverse((mesh) => {
        if (!mesh.isMesh) return;
        const material = mesh.material;
        const name = material && material.name ? material.name : '';
        if (name !== 'Stone' && name !== 'StoneDark') return;
        // The GLB ships POSITION+NORMAL only, so every stone mesh needs projected
        // UVs before a map can be attached at all -- there is no authored UV set
        // to preserve.
        projectBoxGeometry({ THREE, geometry: mesh.geometry,
          tileMeters: TERRACE_TEXTURE_TILE_METERS });
        // The same maps, cloned once per material, because the two stone colours
        // differ: a shared sampler would force one tint on both.
        mesh.material = fountainStoneMaterial(material, textures);
        if (name === 'Stone') byPart.stone += 1;
        else byPart.dark += 1;
      });
      assetState.fountainStone = 'textured';
      assetState.fountainStoneDetail = {
        meshes: byPart.stone + byPart.dark,
        stone: byPart.stone,
        dark: byPart.dark,
        parts: parts.stone.length + parts.dark.length,
        maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => textures[k]),
        tileMeters: TERRACE_TEXTURE_TILE_METERS
      };
      return assetState;
    });
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
        // BoxGeometry ships with 0..1 per-face UVs, which would smear one whole map
        // across every face. They have to be replaced, not merely filled in when
        // absent -- that is the difference between coursed ashlar and a stretched
        // blur on a 12 m slab.
        projectBoxGeometry({ THREE, geometry: mesh.geometry, tileMeters: tile });
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
      // Cheap baked AO for grazing angles: a single channel-0 texture on the
      // same UVs as the flagstone map. Only indirect light is multiplied, so
      // this is a grounding cue, not a shadow.
      const aoTexture = createPlazaAoTexture({ THREE });
      if (aoTexture) {
        plazaMaterial.aoMap = aoTexture;
        // The plaza upgrade can land after the adaptive loop has already dropped
        // to the low tier, so the intensity follows the tier that is current now
        // rather than assuming full quality.
        plazaMaterial.aoMapIntensity = plazaAoMapIntensity({ low: environment.quality === 'low' });
        plazaMaterial.aoMap.channel = PLAZA_AO_MAP_CHANNEL;
      }
      assetState.plazaFloor = 'textured';
      assetState.plazaFloorDetail = {
        maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => textures[k]),
        aoMap: Boolean(aoTexture)
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
        // The prop pass dresses the modelled house's HouseBrick meshes from this
        // same set; its per-mesh clones reset repeat to 1:1 metre-space UVs.
        familyTextures.brick = brick;
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
    starField,
    // Round 85: the field breathes. One cheap per-frame call nudges the whole
    // material's size with the pure twinkle maths from src/stars.js; the
    // per-phase opacity stays with applyPhase().
    updateStars(dt) {
      starTime += dt;
      starField.material.size = 0.9 * starTwinkle(0, starTime);
    },
    // The palette for a phase, so the camera pipeline can derive its ambient
    // room from the same numbers the sky dome is painted with.
    phaseLook,
    hemi,
    sun,
    fill,
    // The centre the shadow box was built around. applyPhase offsets the sun's
    // position by this so the light keeps its authored direction while the
    // frustum stays pointed at the middle of the whole world, lane included.
    shadowCentre: shadowBox.centre,
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
      // Plaza AO only multiplies indirect light; drop it on the low tier so the
      // grounding cue costs nothing when the budget is tight.
      if (plazaMaterial) {
        plazaMaterial.aoMapIntensity = low ? 0 : plazaAoMapIntensity({ low: false });
      }
      // Contact darkening rides on vertex colours; disable it on the low tier by
      // turning the attribute off on every dressed prop mesh.
      for (const { group } of propGroups) {
        group.traverse((mesh) => {
          // Only meshes that actually carry a `color` attribute are toggled.
          // `propFamily` alone is not enough: the bark pass marks its meshes the
          // same way but never writes vertex colours, and switching
          // `vertexColors` on there would have the shader read a missing
          // attribute (black or a warning depending on the driver).
          if (!mesh.isMesh || !mesh.material) return;
          if (!mesh.geometry?.attributes?.color) return;
          mesh.material.vertexColors = !low;
          mesh.material.needsUpdate = true;
          mesh.geometry.attributes.color.needsUpdate = true;
        });
      }
      // Keep the map size and bias in step with the budget table rather than
      // leaving stale numbers behind when the tier flips back to full.
      const budget = shadowSettings(tier);
      sun.shadow.mapSize.set(budget.mapSize, budget.mapSize);
      sun.shadow.bias = budget.bias;
      sun.shadow.normalBias = budget.normalBias;
      // A changed map size needs the existing depth target rebuilt.
      sun.shadow.map?.dispose?.();
      sun.shadow.map = null;
      // Round 74: the glass glow is tier-dependent (a full night bloom over the
      // low tier's dark lamps reads as a bug), so re-write the panes now rather
      // than waiting for the next phase change -- which could be many minutes.
      // applyPhase() records the phase AND the lane state it last applied, so
      // this reuses both rather than re-deriving them here.
      if (environment.applyGlass && environment.glassPhase) {
        environment.applyGlass(environment.glassPhase,
          { laneLit: environment.laneOn, low });
      }
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
    glassPanes,
    waterMaterial: null,
    waterOffset: { x: 0, y: 0 },
    /**
     * Advances the fountain's water surface by one frame.
     *
     * A pure accumulator (src/water.js) decides the UV step; this only writes
     * it to the material's normal and roughness maps. Returns the new offset so
     * tests can hold the movement to a number rather than a feeling. The low
     * tier freezes the surface, so a struggling phone is not asked to chase a
     * moving highlight.
     */
    updateWater(dt) {
      if (!environment.waterMaterial) return environment.waterOffset;
      const low = environment.quality === 'low';
      const next = advanceWaterOffset(environment.waterOffset, dt, { low, tier: environment.quality });
      environment.waterOffset = next;
      const mat = environment.waterMaterial;
      for (const key of ['normalMap', 'roughnessMap']) {
        if (mat[key]) mat[key].offset.set(next.x, next.y);
      }
      return next;
    },
    /**
     * Writes the current hour to every registered pane.
     *
     * Called from applyPhase() (and from setQuality() when the tier flips) so
     * the glass can never disagree with the lighting it is reflecting. The
     * numbers come from `glass.js`, which is pure and unit-tested; this only
     * writes them to the materials. `kind` decides the curve: a window follows
     * the hour alone, a lamp pane follows its own bulb too, so the lane post
     * stays dark until its round is walked.
     *
     * `low` dims the glow to a constant because the low tier turns the point
     * lights off; a full night bloom over a dark lamp would read as a bug.
     * Returns what it wrote, for the evidence scripts to hold to the curve.
     */
    applyGlass(phaseId, { laneLit = true, low = environment.quality === 'low' } = {}) {
      const applied = { window: 0, lamp: 0, lit: 0, dark: 0 };
      for (const pane of glassPanes) {
        // Only a lane pane cares whether the lane's bulbs are lit; every other
        // lamp pane sits under a plaza lamp that is on with the phase. A window
        // has no bulb at all, so glassStateFor ignores the flag for it.
        const effectiveLit = pane.kind === 'lamp' && pane.lane ? Boolean(laneLit) : true;
        const state = glassStateFor(pane.kind, phaseId, { laneLit: effectiveLit, low });
        const material = pane.mesh.material;
        if (!material) continue;
        if (material.color) material.color.setHex(state.color);
        material.metalness = state.metalness;
        material.roughness = state.roughness;
        if (material.emissive) material.emissive.setHex(state.emissive);
        material.emissiveIntensity = state.emissiveIntensity;
        // The pane's glow must not be doubled by the lamp bulb sitting inside
        // it: a bulb mesh keeps its own emissive (applyPhase writes it through
        // environment.lamps). This pass never touches a bulb.
        applied[pane.kind] += 1;
        if (state.emissiveIntensity > 0) applied.lit += 1; else applied.dark += 1;
      }
      environment.glassPhase = phaseId;
      return applied;
    },
    /**
     * Starts the asset upgrade. Returns a promise that settles when both assets
     * have been attempted, so tests can await it and get a truthful report rather
     * than a guess about timing.
     */
    loadAssets() {
      return Promise.all([upgradeFountain().then(() => upgradeFountainStone()), upgradeBarrels(), upgradeStalls(), upgradeLamps(), upgradeMarketStalls(), upgradeBench(), upgradeNotice(), upgradeCrates(), upgradeGateDoor(), upgradeHouse(), upgradeCobble(), upgradeGrass(), upgradeWalls(), upgradeGateStone(), upgradeTerrace(), upgradePlazaFloor(), upgradeWoodBrick(), upgradePropMaps(), upgradeTree(), upgradeBark(), upgradeLaneLamp(), upgradeBanner()])
        .then(() => upgradePropFamilies()).then(() => upgradeBuntingFelt()).then(() => upgradeLaneRope()).then(() => upgradeBoardPaper())
        // Water runs last and after the prop pass on purpose: the water discs
        // must not pick up the stone/iron families, and it needs the modelled
        // fountain to be in the scene before it has anything to dress.
        .then(() => upgradeFountainWater())
        // Glass has no fetch of its own -- it reports the panes the model passes
        // registered and paints them for the current hour. It runs after the
        // models so nothing can register a pane after the count is taken.
        .then(() => reportGlass()).then(() => ({ ...assetState }));
    },
    /** What actually loaded: 'model' | 'stand-in' | 'unavailable', etc. */
    get assetState() {
      return { ...assetState };
    }
  };

  return { scene, colliders, environment, floorHeight: floorHeightAt, terrace: TERRACE };
}

/**
 * Dress the job board's paper surfaces (Round 83).
 *
 * The board face (BoardFace) and its pinned slips (BoardPaper) are plain
 * meshes that live outside the prop registry, so they get their own pass.
 * This is the exported core: `upgradeBoardPaper()` inside buildWorld loads the
 * maps and calls this on the collected `boardMeshGroup`, and the unit tests
 * call it directly on a hand-built group to check the real geometry pass.
 */
export function dressBoardPaper(group, textures, { THREE } = {}) {
  let dressed = 0;
  let seams = 0;
  group.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const source = mesh.material;
    const name = source && source.name ? source.name : '';
    const family = boardPaperFamilyFor(name);
    if (!family || !shouldDressBoardPaper(family, textures)) return;
    // The board face is 1.2 x 0.9 m and the slips 0.22 x 0.3 m: a 0.3 m tile
    // puts roughly four tiles across the face so the fibre tooth reads as
    // paper rather than one smeared sheet. The face is a plane, but projecting
    // keeps the metre-space UVs consistent with the other families' pass and
    // splits any corner cleanly.
    const split = projectBoxGeometry({
      THREE,
      geometry: mesh.geometry,
      tileMeters: family.tileMeters || CAST_PAPER_TILE_METERS
    });
    seams += split.seams;
    const params = boardPaperParams(family);
    const material = new THREE.MeshStandardMaterial({
      // keepTint is false: the paper albedo is already cream, so the material
      // tint stays white or the cream would multiply down to brown.
      color: params.keepTint && source.color ? source.color.getHex() : 0xffffff,
      roughness: params.roughness,
      metalness: params.metalness,
      name,
      side: source.side
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
    mesh.material = material;
    mesh.userData.boardPaperDressed = true;
    dressed += 1;
  });
  return { dressed, seams };
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
  // The star field's opacity follows the phase: day hides it, dusk hints,
  // night shows it full. The mesh itself keeps rendering (one draw call) so
  // applyPhase() is the only place the field's visibility is set.
  if (environment.starField) {
    environment.starField.material.opacity = starFieldOpacity(phaseId);
    environment.starField.visible = starFieldOpacity(phaseId) > 0;
  }
  scene.fog.near = look.fogNear;
  scene.fog.far = look.fogFar;
  hemi.color.setHex(look.hemiSky);
  hemi.groundColor.setHex(look.hemiGround);
  hemi.intensity = look.hemiIntensity;
  sun.color.setHex(look.sunColor);
  sun.intensity = look.sunIntensity;
  // The light is positioned relative to its target, so once the target sits at
  // the world centre (for the shadow box) the light has to carry the same
  // offset. PHASE_LOOKS.sunPosition is authored as a point around the origin;
  // adding the target offset back keeps every phase's sun DIRECTION exactly as
  // authored while the frustum follows the target. Without this the sun would
  // visibly swing away from its authored azimuth at dusk and night.
  const aim = environment.shadowCentre || { x: 0, z: 0 };
  sun.position.set(
    look.sunPosition[0] + aim.x,
    look.sunPosition[1],
    look.sunPosition[2] + aim.z
  );
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
  // Round 74: the glass follows the same phase and the same lane state as the
  // lights behind it, so a lit lamp always has a lit pane and a dark lane never
  // glows. One call, after the lights are settled.
  environment.laneOn = laneOn;
  if (environment.applyGlass) {
    environment.applyGlass(phaseId, { laneLit: laneOn, low: environment.quality === 'low' });
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
