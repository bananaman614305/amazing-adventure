import * as THREE from 'three';
import { buildStarField, starFieldOpacity, starTwinkle } from './stars.js';
import { MOON_DISTANCE, MOON_CORE_RADIUS, MOON_GLOW_RADIUS, MOON_COLOR,
  MOON_PHASE_VISIBILITY, moonVisibility, MOON_POSITION, moonDiscPosition,
  MOON_GLOW_OPACITY } from './moon.js';
import { CLOUD_COUNT, CLOUD_FIELD_RADIUS, CLOUD_SEED, cloudPositions,
  CLOUD_PHASE_OPACITY, cloudOpacity, CLOUD_BASE_COLOR, cloudColor,
  cloudSize, cloudDrift } from './clouds.js';
import { MOONLIGHT_COLOR, moonlightIntensity, moonlightDirection } from './moonlight.js';
import { cloudDapple, raisePointToCloud, CLOUD_SHADOW_STRENGTH } from './cloudshadow.js';
import { passerFootprints, passerAltitude, passerDrift, passerOpacity }
  from './cloudpassers.js';
import { horizonRibbonArray, horizonRibbonColors, horizonTint, horizonOpacity,
  horizonFootTint } from './horizon.js';
import { scatterPoints, SCATTER_SEED } from './scatter.js';
import { windDirection, windPhase, windSway, windStrength } from './wind.js';
import { tuftGeometry, tuftPhaseTint, tuftLeanAngle, tuftLeanAxis,
  TUFT_VARIANTS } from './tuft.js';
import { flutterAmount, flutterPhase, flutterMotion, flutterEnabled,
  FLUTTER_SEED, FLUTTER_MAX_YAW, FLUTTER_MAX_ROLL, FLUTTER_MAX_BILLOW } from './flutter.js';
import { fireflySpawns, fireflyGlowLevel, fireflyBlink, fireflyDrift,
  fireflyEnabled, FIREFLY_TINT, FIREFLY_COUNT, FIREFLY_MIN_RADIUS, FIREFLY_MAX_RADIUS } from './fireflies.js';
import { birdFlock, birdFlight, birdHeading, birdGlowLevel, birdsEnabled,
  BIRD_COUNT, BIRD_WING_AMPLITUDE } from './birds.js';
import { chimneySpawns, smokePuff, smokeGlowLevel, chimneyEnabled,
  CHIMNEY_PUFFS, CHIMNEY_MAX_OPACITY, CHIMNEY_SEED } from './chimney.js';
import { butterflySpawns, butterflyFlight, butterflyGlowLevel, butterfliesEnabled,
  BUTTERFLY_COUNT, BUTTERFLY_TINTS, BUTTERFLY_WING_AMPLITUDE } from './butterflies.js';
import { litterSpawns, litterGlowLevel, litterEnabled,
  LITTER_COUNT, LITTER_TINTS, LITTER_VARIANTS } from './litter.js';
import { moteSpawns, motePosition, moteGlowLevel, motesEnabled, MOTE_COUNT } from './motes.js';
import { windowSpawns, windowGlow, windowGlowLevel, windowsEnabled,
  WINDOW_COUNT, WINDOW_WARM_TINT, WINDOW_MAX_GLOW } from './windows.js';
import { ivySpawns, ivyGlowLevel, ivySway, ivyEnabled, IVY_COUNT, IVY_TINTS } from './ivy.js';
import { spraySpawns, sprayGlowLevel, sprayDrop, sprayEnabled, SPRAY_COUNT,
  SPRAY_MAX_OPACITY } from './spray.js';
import { mistSpawns, mistOpacity, mistDrift, mistEnabled, MIST_COUNT,
  MIST_MAX_OPACITY } from './mist.js';
import { rippleSpawns, rippleRing, rippleGlowLevel, ripplesEnabled,
  RIPPLE_COUNT, RIPPLE_RINGS_PER_SITE, RIPPLE_WATER_Y, RIPPLE_MAX_OPACITY } from './ripples.js';
import { mothSpawns, mothFlight, mothGlowLevel, mothsEnabled, MOTH_COUNT } from './moths.js';
import { puddleSpawns, puddleGloss, puddleDarkness, puddleShimmer, puddlesEnabled,
  PUDDLE_COUNT, PUDDLE_WATER_Y, PUDDLE_CLEAR_RADIUS } from './puddles.js';
import { shingleSpawns, shingleGlowLevel, shinglesEnabled } from './shingles.js';
import { roofEdgeSpans, roofEdgeEnabled } from './roofedge.js';
import { wildflowerSpawns, wildflowerSway, wildflowerGlowLevel, wildflowersEnabled,
  WILDFLOWER_COUNT } from './wildflowers.js';
import { reedSpawns, reedStemSway, reedGlowLevel, reedsEnabled, REED_COUNT } from './reeds.js';
import { mossSpawns, mossDarkness, mossGlowLevel, mossEnabled,
  MOSS_SEAM_WIDTH } from './moss.js';
import { shadowDecals, shadowOpacity, shadowsEnabled } from './contactshadows.js';
import { WALL_TRIM, wallTrimLayout, wallTrimEnabled } from './walltrim.js';
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
  TERRACE_DETAIL_ASSET, TERRACE_DETAIL_MODEL_SIZE, loadTerraceDetail,
  FELT_TEXTURE_FILES, FELT_FAMILY, BUNTING_TILE_METERS,
  WATER_TEXTURE_FILES, WATER_TILE_METERS,
  CRATE_ASSET, CRATE_MODEL_SIZE, loadCrate,
  GATE_DOOR_ASSET, GATE_DOOR_MODEL_SIZE, loadGateDoor,
  HOUSE_ASSET, HOUSE_MODEL_SIZE, loadHouse, HOUSE_DETAIL_ASSET, HOUSE_DETAIL_MODEL_SIZE, loadHouseDetail,
  WOOD_TEXTURE_FILES, STONE_TEXTURE_FILES, BRICK_TEXTURE_FILES, PLASTER_TEXTURE_FILES,
  COBBLE_TEXTURE_FILES, GRASS_TEXTURE_FILES, PLAZA_FLOOR_TEXTURE_FILES,
  PLAZA_FLOOR_V2_TEXTURE_FILES, plazaFloorRepeat,
  PLAZA_TEXTURE_SPAN_METERS, PLAZA_TEXTURE_TILE_METERS, projectBoxGeometry,
  TREE_ASSET, TREE_MODEL_SIZE, loadTree, BARK_TEXTURE_FILES, LAMP_TEXTURE_FILES,
  CLOTH_TEXTURE_FILES,
  PLAZA_AO_MAP_CHANNEL, plazaAoMapIntensity, createPlazaAoTexture,
  applyContactDarkeningGeometry,
  needsOwnMaterial,
  cloneTextureFamily, TERRACE_TEXTURE_TILE_METERS, terraceStoneParts,
  fountainStoneParts, fountainStoneMaterialParams, fountainStoneTint,
  ROOF_TEXTURE_FILES, LEAF_TEXTURE_FILES, PROP_FAMILIES, propFamilyFor,
  PAPER_TEXTURE_FILES, ROPE_TEXTURE_FILES, ROOF_SHINGLE_TEXTURE_FILES
} from './assets.js';
import {
  boardPaperFamilyFor, boardPaperParams, shouldDressBoardPaper, CAST_PAPER_TILE_METERS
} from './paper.js';
import { ROPE_TILE_METERS, ROPE_FAMILY } from './rope.js';
import { HOUSING_TILE_METERS } from './housing.js';
import { SACKTIE_TILE_METERS } from './sacktie.js';
import { NOTICE_FACE_TILE_METERS, dressNoticeFace } from './noticeface.js';
import { dressLanternHousing, dressSackTie } from './lanedress.js';
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

  // The moon: a separate disc from the sun (which keeps its dim night anchor).
  const moonCore = new THREE.Mesh(
    new THREE.CircleGeometry(MOON_CORE_RADIUS, 24),
    new THREE.MeshBasicMaterial({
      fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending
    })
  );
  moonCore.name = 'sky-moon';
  const moonGlow = new THREE.Mesh(
    new THREE.CircleGeometry(MOON_GLOW_RADIUS, 24),
    new THREE.MeshBasicMaterial({
      fog: false, depthWrite: false, transparent: true, opacity: MOON_GLOW_OPACITY,
      blending: THREE.AdditiveBlending
    })
  );
  moonGlow.name = 'sky-moon-glow';
  const moonDisc = new THREE.Group();
  moonDisc.name = 'sky-moon-group';
  moonDisc.renderOrder = -1;
  moonDisc.add(moonGlow, moonCore);
  scene.add(moonDisc);

  // The cloud layer: soft discs on the inside of the dome, drifting slowly.
  const cloudGroup = new THREE.Group();
  cloudGroup.name = 'sky-clouds';
  cloudGroup.renderOrder = -1;
  const cloudMeshes = [];
  const cloudData = cloudPositions();
  for (let i = 0; i < cloudData.length; i += 1) {
    const d = cloudData[i];
    const r = cloudSize(i);
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(r, 16),
      new THREE.MeshBasicMaterial({
        color: CLOUD_BASE_COLOR, fog: false, depthWrite: false,
        transparent: true, opacity: 0.5, side: THREE.DoubleSide
      })
    );
    mesh.name = 'sky-cloud';
    mesh.position.set(d.x, d.y, d.z);
    mesh.lookAt(0, 0, 0);
    cloudGroup.add(mesh);
    cloudMeshes.push(mesh);
  }
  scene.add(cloudGroup);

  // Round 98: the clouds that pass overhead. The dome layer above sits on a
  // 118 m ring, so its true shadows land far outside a 34 m world -- that is
  // why Round 89 could only dim the whole daylight by the layer's aggregate.
  // These five clouds are nearer and smaller, so their shadows really do cross
  // the plaza and the meadow. Each is drawn twice: a soft dark footprint on the
  // ground, and a disc in the sky derived from that footprint by inverse
  // projection (raisePointToCloud), so the sky cloud and its shadow are one
  // object and can never disagree about where the cloud is.
  const passerGroup = new THREE.Group();
  passerGroup.name = 'sky-cloud-passers';
  passerGroup.renderOrder = -1;
  const passerData = [];
  const passerFootprintList = passerFootprints();
  for (let i = 0; i < passerFootprintList.length; i += 1) {
    const footprint = passerFootprintList[i];
    // The disc is a little broader than the footprint: a cloud's body is wider
    // than the solid core of its shadow, and the extra width is what the soft
    // rim of the ground decal fades into.
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(footprint.r * 1.3, 16),
      new THREE.MeshBasicMaterial({
        color: CLOUD_BASE_COLOR, fog: false, depthWrite: false,
        transparent: true, opacity: 0, side: THREE.DoubleSide
      })
    );
    disc.name = 'sky-cloud-passer';
    disc.visible = false;
    passerGroup.add(disc);
    passerData.push({ footprint, altitude: passerAltitude(i), disc });
  }
  scene.add(passerGroup);

  // The footprints are soft radial decals, the same texture and the same flat
  // disc as the contact shadows, so the two kinds of ground darkening are the
  // same material story. They sit a touch higher than the contact decals so a
  // cloud's shade falls over a barrel's smudge rather than fighting it.
  const passerShadowMaterial = new THREE.MeshBasicMaterial({
    color: 0x1b2432, map: createContactShadowTexture(), transparent: true,
    opacity: 0, depthWrite: false, fog: true
  });
  const passerShadowMesh = new THREE.InstancedMesh(
    new THREE.CircleGeometry(0.5, 16), passerShadowMaterial,
    Math.max(1, passerData.length)
  );
  passerShadowMesh.name = 'ground-cloud-shadows';
  passerShadowMesh.count = passerData.length;
  passerShadowMesh.frustumCulled = false;
  passerShadowMesh.renderOrder = 2;
  passerShadowMesh.visible = false;
  scene.add(passerShadowMesh);

  const _passerMatrix = new THREE.Matrix4();
  const _passerPos = new THREE.Vector3();
  const _passerScale = new THREE.Vector3();
  const _passerQuat = new THREE.Quaternion();
  _passerQuat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  let passerTime = 0;

  // PHASE_LOOKS authors the sun as a plain [x, y, z] triple (it is a table the
  // unit suite reads, not a vector), while the cloud-shadow maths takes a
  // point-shaped direction. This is the one conversion, so the array/object
  // mismatch cannot quietly leave every sky disc unplaced.
  function sunDirectionOf(position) {
    if (!Array.isArray(position) || position.length < 3) return null;
    const [x, y, z] = position;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return { x, y, z };
  }

  // Where the field stands at a given instant: footprints drifted from their
  // starting centres, and the sky disc raised from each footprint along the
  // sun's rays so the disc is exactly the cloud that casts that shadow.
  function layoutPassers(sunPosition) {
    const sunDir = sunDirectionOf(sunPosition);
    for (let i = 0; i < passerData.length; i += 1) {
      const entry = passerData[i];
      const drift = passerDrift(i, passerTime);
      const x = entry.footprint.x + drift.dx;
      const z = entry.footprint.z + drift.dz;
      _passerPos.set(x, 0.03, z);
      _passerScale.set(entry.footprint.r * 2, entry.footprint.r * 2, 1);
      _passerMatrix.compose(_passerPos, _passerQuat, _passerScale);
      passerShadowMesh.setMatrixAt(i, _passerMatrix);
      const raised = sunDir ? raisePointToCloud({ x, z }, sunDir, entry.altitude) : null;
      // At dusk the sun is low, so the cloud that would cast this shadow is
      // thrown a hundred metres sideways and would poke through the 118 m dome.
      // Hide it rather than draw a disc on the wrong side of the sky; the
      // shadow itself stays, which is the part the player is looking at.
      if (!raised || Math.hypot(raised.x, raised.y, raised.z) > 112) {
        entry.disc.visible = false;
      } else {
        entry.disc.position.set(raised.x, raised.y, raised.z);
        entry.disc.lookAt(0, 0, 0);
        entry.disc.visible = passerGroup.visible;
      }
    }
    passerShadowMesh.instanceMatrix.needsUpdate = true;
  }

  // Place the field once at build time from the day's sun, so a scene that is
  // photographed before its frame loop ticks still has its shadows down.
  layoutPassers(PHASE_LOOKS.day.sunPosition);

  function paintPassers(phaseId, tier = environment.quality) {
    const opacity = passerOpacity(phaseId);
    const on = opacity > 0 && tier !== 'low' && passerData.length > 0;
    const colour = cloudColor(phaseId);
    for (const entry of passerData) {
      entry.disc.material.opacity = opacity;
      entry.disc.material.color.setHex(colour);
      entry.disc.visible = on;
    }
    passerGroup.visible = on;
    passerShadowMaterial.opacity = opacity * CLOUD_SHADOW_STRENGTH;
    passerShadowMesh.visible = on;
  }
  paintPassers('day', 'full');

  function updatePassers(dt) {
    // No per-frame work when the layer is off: on the low tier the draw calls
    // are gone and at night the layer is transparent, so the loop is skipped
    // rather than writing matrices nobody sees.
    if (environment.quality === 'low' || passerOpacity(environment.phase) <= 0) return;
    if (typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0) return;
    // Same cap as the other drifting fields: a tab that was backgrounded for a
    // minute must not teleport the shadows across the plaza in one frame.
    passerTime += Math.min(dt, 0.1);
    const look = PHASE_LOOKS[environment.phase];
    if (!look || !look.sunPosition) {
      passerGroup.visible = false;
      return;
    }
    layoutPassers(look.sunPosition);
  }

  let starTime = 0;
  let cloudTime = 0;

  // Round 89: the distant ridge. Looking over the border wall, the world used to
  // end where the haze began, with nothing between, which read as the inside of
  // a box. A ring of low hills just inside the dome gives the eye a horizon.
  // One unlit, unfogged mesh from the pure ribbon in src/horizon.js at a fixed
  // vertex count, so the whole skyline is a single draw call with no lighting
  // and no texture -- cheap enough to keep at every quality tier.
  //
  // Drawn after the other sky elements (renderOrder 1) so it occludes the stars
  // and any low cloud behind it: the hills really are nearer than the dome. Its
  // geometry is a ring whose object origin is the world centre, so the
  // transparent sort cannot place it by distance; the explicit order is what
  // keeps the layering right. The ridge crests 8-20 m above ground at 112 m out,
  // i.e. roughly 4-10 degrees of elevation, so the sun and moon (which sit well
  // above that) are never lost behind it except when they are setting into it,
  // which is what should happen. Depth testing still stops it drawing over the
  // wall and props.
  const horizonGeometry = new THREE.BufferGeometry();
  horizonGeometry.setAttribute(
    'position', new THREE.BufferAttribute(horizonRibbonArray(), 3)
  );
  // Vertex colours carry the haze gradient (ridge line -> foot). With them the
  // material's own colour stays white, so the gradient is the whole look.
  const horizonColors = new THREE.BufferAttribute(horizonRibbonColors(), 3);
  horizonGeometry.setAttribute('color', horizonColors);
  const horizonMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff, vertexColors: true, fog: false, side: THREE.DoubleSide,
    transparent: true, opacity: horizonOpacity('day'), depthWrite: false
  });
  const horizonRidge = new THREE.Mesh(horizonGeometry, horizonMaterial);
  horizonRidge.name = 'sky-horizon';
  horizonRidge.renderOrder = 1;
  scene.add(horizonRidge);

  function paintHorizon(phaseId) {
    horizonMaterial.opacity = horizonOpacity(phaseId);
    const colors = horizonRibbonColors(horizonTint(phaseId), horizonFootTint(phaseId));
    horizonColors.array.set(colors);
    horizonColors.needsUpdate = true;
  }
  paintHorizon('day');

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

  function paintMoon(intensity) {
    const p = moonDiscPosition(MOON_POSITION, MOON_DISTANCE);
    moonDisc.position.set(p.x, p.y, p.z);
    moonDisc.lookAt(0, 0, 0);
    moonCore.material.color.setHex(MOON_COLOR);
    moonGlow.material.color.setHex(MOON_COLOR);
    moonCore.material.opacity = intensity;
    moonGlow.material.opacity = MOON_GLOW_OPACITY * intensity;
    moonDisc.visible = intensity > 0;
  }

  function paintClouds(phaseId) {
    const op = cloudOpacity(phaseId);
    const col = cloudColor(phaseId);
    for (const m of cloudMeshes) {
      m.material.color.setHex(col);
      m.material.opacity = op;
    }
    cloudGroup.visible = op > 0;
  }

  // Round 89: the cloud layer's shadow on the daylight. The domed clouds never
  // project onto the plaza (they are 100+ m out), so what the ground sees is the
  // layer's aggregate dimming: a slow, smooth dapple driven by cloudDapple().
  // This re-writes the sun's intensity from the phase's own base each time, so
  // the dapple is a fraction of the authored light and never accumulates.
  // Disabled on the low tier and at night, where the sun is already a night
  // anchor and a drifting dim would read as a flickering bug.
  const CLOUD_SHADOW_SEED = 0.37;
  let cloudDim = 1;
  function applyCloudDapple() {
    // `environment` is declared further down; the first call arrives from the
    // frame loop, long after it exists.
    const allow = environment.quality !== 'low' && environment.phase !== 'night';
    cloudDim = allow ? cloudDapple(cloudTime, CLOUD_SHADOW_SEED) : 1;
    sun.intensity = sunBaseIntensity * cloudDim;
    return cloudDim;
  }

  paintSky(0x6fa8dc, 0x9fc4e8);
  paintSun(0xfff1d0, sunDiskIntensity('day'), PHASE_LOOKS.day.sunPosition);
  paintMoon(moonVisibility('day'));
  paintClouds('day');

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
  plaza.name = 'plaza-floor';
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = 0.01;
  plaza.receiveShadow = true;
  scene.add(plaza);

  // --- Border walls -------------------------------------------------------
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x6f6455, roughness: 0.85 });
  // The trim courses share the wall's base stone colour until upgradeWallsTrim()
  // dresses them from the stone family; the material stays a separate instance so
  // the walls' 34 m repeat cannot be overwritten by the courses' 1.6 m projection.
  const trimMaterial = new THREE.MeshStandardMaterial({ color: 0x6f6455, roughness: 0.85 });
  const wallHeight = 3.2;
  const wallThickness = 1;

  // The north wall is split either side of the gate so the gate opening can be
  // opened and closed by its own collider (see the gate block below).
  const sides = [
    { id: 'south', axis: 'x', from: -HALF, to: HALF, fixed: HALF },
    { id: 'east', axis: 'z', from: -HALF, to: HALF, fixed: HALF },
    { id: 'west', axis: 'z', from: -HALF, to: HALF, fixed: -HALF }
  ];

  for (const side of sides) {
    addBox(scene, colliders, {
      size: side.axis === 'x' ? [side.to - side.from, wallHeight, wallThickness]
        : [wallThickness, wallHeight, side.to - side.from],
      position: side.axis === 'x'
        ? [(side.from + side.to) / 2, wallHeight / 2, side.fixed]
        : [side.fixed, wallHeight / 2, (side.from + side.to) / 2],
      material: wallMaterial
    });
    // Named so the browser suite reads the wall by name rather than by guessing
    // which grey box is which.
    scene.children[scene.children.length - 1].name = `border-wall-${side.id}`;
  }

  NORTH_WALL_SEGMENTS.forEach((segment, i) => {
    const width = segment.maxX - segment.minX;
    const mesh = addBox(scene, colliders, {
      size: [width, wallHeight, wallThickness],
      position: [(segment.minX + segment.maxX) / 2, wallHeight / 2, -HALF],
      material: wallMaterial
    });
    mesh.name = `border-wall-${i === 0 ? 'north-left' : 'north-right'}`;
  });

  // --- Border-wall trim ----------------------------------------------------
  // A bare 3.2 m box reads as a modern retaining wall. src/walltrim.js decides
  // where a coping course, a plinth course and the pilaster strips sit on each of
  // the five runs; this block only turns those descriptors into boxes and keeps
  // them in one group so the low tier can drop the whole band for the cost of a
  // single visibility flag. Every piece is shorter than addBox's 0.9 m collider
  // threshold, so none of them changes where the player can walk.
  const wallTrimGroup = new THREE.Group();
  wallTrimGroup.name = 'border-wall-trim';
  const wallTrimMeshes = [];
  for (const piece of wallTrimLayout()) {
    const mesh = addBox(wallTrimGroup, null, {
      size: piece.size,
      position: piece.position,
      material: trimMaterial
    });
    mesh.name = piece.name;
    wallTrimMeshes.push(mesh);
  }
  scene.add(wallTrimGroup);

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
  // Round 87 collections. The sack ties, the lantern housings and the lane
  // notice board's face are all built by hand here rather than by a GLB, so
  // their dressing passes (upgradeSackTie/upgradeLanternHousing/
  // upgradeNoticeFace) reach them through these arrays instead of a
  // scene-wide traverse that would also catch the plaza's fixtures.
  const sackTieMeshes = [];
  const lanternHousings = [];
  const noticeFaceMeshes = [];

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
  // Collected so the per-frame flutter pass can reach them without a scene
  // traversal (and so it still works after upgradeBuntingFelt swaps materials).
  const buntingFlutter = [];
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
      // Named so the browser check can find the pennants by name instead of
      // guessing at the lane's structure, and so the flutter pass has something
      // reportable.
      flag.name = 'BuntingFlag';
      scene.add(flag);
      buntingFlags.push(flag);
      buntingFlutter.push({ mesh: flag, phase: flutterPhase(buntingFlutter.length) });
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
    sackTieMeshes.push(neck);
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
  noticeFaceMeshes.push(boardFace);
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
  // One material for all three housings: they are identical 0.24 m tapered
  // bodies, and round 87 dresses them as one, so sharing the authored material
  // (as the plaza posts do) keeps the dressed result one material too.
  const lanternHousingMat = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.5, metalness: 0.35 });
  lanternHousingMat.name = 'LanternHousing';
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
    sackTieMeshes.push(tie);

    const drop = new THREE.Mesh(
      new THREE.CylinderGeometry(0.006, 0.006, placed.anchorY - placed.topY, 6),
      sackTieMat
    );
    drop.position.set(placed.x, (placed.anchorY + placed.topY) / 2, placed.z);
    fixture.add(drop);
    sackTieMeshes.push(drop);

    // Named for the audit, not for the iron family: this housing is 0.24 m
    // across, so the ironwork's 0.6 m tile would smear three chips of paint
    // over the whole thing. Round 87 dresses it from its own family
    // (src/housing.js) at a 0.25 m tile, reusing the lamp maps, and the
    // `LanternHousing` name is what keeps it out of the ironwork pass.
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.12, LANTERN_HEIGHT, 8),
      lanternHousingMat
    );
    body.position.set(placed.x, lanternY, placed.z);
    body.castShadow = true;
    fixture.add(body);
    lanternHousings.push(body);

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
  // The banner cloth flutters too; recorded here so the pass has a handle even
  // before upgradeBanner() swaps in the GLB.
  const bannerFlutter = [{ mesh: banner, phase: flutterPhase(0, FLUTTER_SEED ^ 0x11) }];

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
  // Round 89: the sun's authored intensity, re-read by applyCloudDapple() so the
  // dapple is always a fraction of the phase's own sun rather than a standing
  // number that would drift if a phase were retuned.
  let sunBaseIntensity = 2.1;
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

  // Round 89: moonlight. A cool, weak directional light from the moon's side of
  // the sky, switched on only once the sun has set. The existing `fill` is a
  // constant cool rim at every phase; this one is phase-driven, so night gains a
  // believable blue key on the roofs and the plaza stone rather than the sun's
  // warm dusk colour left running at low intensity. It casts no shadow: the
  // shadow-look of night comes from the sun's own shadow pass still running at
  // its low night intensity, and a second shadow map would double the depth-pass
  // cost for a light nobody can see the edge of.
  const moon = new THREE.DirectionalLight(MOONLIGHT_COLOR, 0);
  const moonDir = moonlightDirection();
  moon.position.set(moonDir.x * 22, moonDir.y * 22, moonDir.z * 22);
  moon.castShadow = false;
  moon.visible = false;
  scene.add(moon);

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
    // Round 87: the lane's small hand-built metal and cord surfaces, each with
    // its own tile size (see src/housing.js, src/sacktie.js, src/noticeface.js).
    housing: 'flat',
    housingDetail: null,
    sackTie: 'flat',
    sackTieDetail: null,
    noticeFace: 'flat',
    noticeFaceDetail: null,
    iron: 'flat',
    ironDetail: null,
    banner: 'plane',
    bannerDetail: null,
    cobble: 'flat',
    grass: 'flat',
    walls: 'flat',
    wallsTrim: 'flat',
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
    terraceFurniture: 'stand-in',
    terraceFurnitureDetail: null,
    houseOverlay: 'stand-in',
    houseOverlayDetail: null,
    gateStoneDetail: null,
    fountainStoneDetail: null,
    water: 'flat',
    waterDetail: null,
    // Round 74: window and lamp panes. Glass is dressed per phase, not per
    // texture, so this reports the counts rather than a map list.
    glass: 'flat',
    glassDetail: null,
    // Round 101: the roof shingles' own tile family (see upgradeShingles).
    // 'flat' until the family is fetched and dressed.
    shingle: 'flat',
    shingleDetail: null,
    wallsTrimDetail: null
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
      // The cloth flutter followed the flat stand-in; once the modelled canvas
      // exists the stand-in is hidden, so the flutter has to follow the real
      // BannerCanvas or the banner would hang perfectly still. The base rotation
      // captured for the stand-in is dropped with it.
      const canvasMesh = group.getObjectByName('BannerCanvas');
      if (canvasMesh) {
        flutterBase.delete(bannerFlutter[0].mesh);
        bannerFlutter[0] = { mesh: canvasMesh, phase: bannerFlutter[0].phase };
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

  function upgradeTerraceDetail() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.terraceFurniture = 'unavailable';
      return Promise.resolve(assetState);
    }
    return loadTerraceDetail({ THREE, loadGlb }).then((result) => {
      if (!result.ok) {
        assetState.terraceFurniture = 'stand-in';
        assetState.terraceFurnitureDetail = result.reason;
        return assetState;
      }
      const group = new THREE.Group();
      group.name = 'terrace-furniture-model';
      // Authored centred at origin on z=0; the terrace slab top sits at
      // TERRACE.height, so lift the whole model onto it.
      group.position.set(0, TERRACE.height, TERRACE.minZ + (TERRACE.maxZ - TERRACE.minZ) / 2);
      for (const { name, geometry, material } of result.meshes) {
        const mesh = new THREE.Mesh(geometry, material.clone());
        mesh.name = name;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      scene.add(group);
      propGroups.push({ group, tile: 1.5 });
      // The pergola posts stand on the slab, so they ground the terrace; register
      // them as contact-shadow anchors is left to the existing list (pergola is a
      // new prop) -- add a wide anchor for the pergola centre.
      assetState.terraceFurniture = 'model';
      assetState.terraceFurnitureDetail = {
        parts: result.meshes.length,
        bytes: result.bytes,
        instances: 1
      };
      return assetState;
    });
  }

  function upgradeHouseDetail() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.houseOverlay = 'unavailable';
      return Promise.resolve(assetState);
    }
    return loadHouseDetail({ THREE, loadGlb }).then((result) => {
      if (!result.ok) {
        assetState.houseOverlay = 'stand-in';
        assetState.houseOverlayDetail = result.reason;
        return assetState;
      }
      const group = new THREE.Group();
      group.name = 'house-detail-model';
      // Authored at the house origin (house centre at origin, ground z=0 in
      // Blender). The house itself sits at (-10.5, 0, -9), so the overlay
      // rides the same spot and its shutters/gutters line up with the trim.
      group.position.set(-10.5, 0, -9);
      for (const { name, geometry, material } of result.meshes) {
        const mesh = new THREE.Mesh(geometry, material.clone());
        mesh.name = name;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        // Glass panes: the window boxes and shutters have no glass, but the
        // material names are scanned so a future pane still gets registered.
        const glassKind = glassKindFor(material.name || '');
        if (glassKind) {
          mesh.castShadow = glassCastsShadow(glassKind);
          glassPanes.push({ mesh, kind: glassKind, lane: false });
        }
        group.add(mesh);
      }
      scene.add(group);
      propGroups.push({ group, tile: 2 });
      assetState.houseOverlay = 'model';
      assetState.houseOverlayDetail = {
        parts: result.meshes.length,
        bytes: result.bytes,
        instances: 1
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
   * Round 87: dresses the lane lanterns' metal housings (LanternHousing).
   *
   * The three tapered 8-sided bodies are 0.24 m across and were left flat on
   * purpose until now (see the comment where they are built). They reuse the
   * lamp post's maps at HOUSING_TILE_METERS (0.25 m) rather than the ironwork's
   * 0.6 m, because a 0.6 m tile across a 0.24 m housing smears three chips of
   * paint over the whole thing. One source material is shared by all three
   * housings, so dressLanternHousing() hands them one dressed material.
   */
  function upgradeLanternHousing() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.housing = 'unavailable';
      return Promise.resolve(assetState);
    }
    return loadMaterialTextures({ THREE, files: LAMP_TEXTURE_FILES }).then((textures) => {
      if (!textures.anyLoaded) {
        assetState.housing = 'flat';
        return assetState;
      }
      const result = dressLanternHousing(lanternHousings, textures, { THREE });
      assetState.housing = result.dressed > 0 ? 'textured' : 'flat';
      assetState.housingDetail = {
        meshes: result.dressed,
        materials: result.materials,
        seams: result.seams,
        maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => textures[k]),
        tileMeters: HOUSING_TILE_METERS
      };
      return assetState;
    });
  }

  /**
   * Round 87: dresses the lane sacks' pinched necks and the lantern ties
   * (SackTie, nine small meshes) with the cloth weave at SACKTIE_TILE_METERS
   * (0.04 m). A 2 cm cord needs a tile far below the sack body's, or the weave
   * smears into a single stripe; keepTint is true so the authored dark cord
   * colour survives over the near-neutral weave (see src/sacktie.js).
   */
  function upgradeSackTie() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.sackTie = 'unavailable';
      return Promise.resolve(assetState);
    }
    return loadMaterialTextures({ THREE, files: CLOTH_TEXTURE_FILES }).then((textures) => {
      if (!textures.anyLoaded) {
        assetState.sackTie = 'flat';
        return assetState;
      }
      const result = dressSackTie(sackTieMeshes, textures, { THREE });
      assetState.sackTie = result.dressed > 0 ? 'textured' : 'flat';
      assetState.sackTieDetail = {
        meshes: result.dressed,
        materials: result.materials,
        seams: result.seams,
        maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => textures[k]),
        tileMeters: SACKTIE_TILE_METERS
      };
      return assetState;
    });
  }

  /**
   * Round 87: dresses the lane notice board's painted face (NoticeFaceLane,
   * one 1.4 x 1.2 m plane) with the paper family at NOTICE_FACE_TILE_METERS
   * (0.4 m). The job board's slips use 0.3 m; this face is read from 1-2 m in
   * the lane, so its paper tooth is deliberately coarser.
   */
  function upgradeNoticeFace() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.noticeFace = 'unavailable';
      return Promise.resolve(assetState);
    }
    return loadMaterialTextures({ THREE, files: PAPER_TEXTURE_FILES }).then((textures) => {
      if (!textures.anyLoaded) {
        assetState.noticeFace = 'flat';
        return assetState;
      }
      const result = dressNoticeFace(noticeFaceMeshes, textures, { THREE });
      assetState.noticeFace = result.dressed > 0 ? 'textured' : 'flat';
      assetState.noticeFaceDetail = {
        meshes: result.dressed,
        materials: result.materials,
        seams: result.seams,
        maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => textures[k]),
        tileMeters: NOTICE_FACE_TILE_METERS
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
        // The modelled board's painted panel is the face the player actually
        // sees; the procedural `NoticeFaceLane` above is hidden from here on.
        // Both belong to the round 87 notice-face family, so both are
        // collected and dressed at the same tile.
        if (mesh.material && /^noticeface$/i.test(mesh.material.name || '')) {
          noticeFaceMeshes.push(mesh);
        }
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
  /**
   * Dresses the border-wall trim (coping, plinth and pilaster courses) from the
   * stone family. The walls use a 34 m repeat, so the trim gets its own cloned
   * texture set and a 1.6 m box projection, matching the terrace stone.
   */
  function upgradeWallsTrim() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      assetState.wallsTrim = 'unavailable';
      return Promise.resolve(assetState);
    }
    return loadStoneFamily().then((textures) => {
      if (!textures.anyLoaded) {
        assetState.wallsTrim = 'flat';
        return assetState;
      }
      for (const mesh of wallTrimMeshes) {
        projectBoxGeometry({ THREE, geometry: mesh.geometry,
          tileMeters: WALL_TRIM.tileMeters });
      }
      applyTextureFamily(trimMaterial,
        { ...cloneTextureFamily(textures), anyLoaded: true }, 1, 1, 1);
      assetState.wallsTrim = 'textured';
      assetState.wallsTrimDetail = {
        meshes: wallTrimMeshes.length,
        maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => textures[k]),
        tileMeters: WALL_TRIM.tileMeters
      };
      return assetState;
    });
  }

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
    return loadMaterialTextures({ THREE, files: PLAZA_FLOOR_V2_TEXTURE_FILES }).then((textures) => {
      if (!textures.anyLoaded) {
        // The second-generation set is the plaza's now; the round-61 set is kept
        // only as a documented fallback so a missing v2 file degrades to the old
        // flagstones rather than to a flat colour.
        return loadMaterialTextures({ THREE, files: PLAZA_FLOOR_TEXTURE_FILES }).then((fallback) => {
          if (!fallback.anyLoaded) {
            assetState.plazaFloor = 'flat';
            return assetState;
          }
          dressPlaza(fallback, 'v1');
          return assetState;
        });
      }
      dressPlaza(textures, 'v2');
      return assetState;
    });
  }

  // Shared dressing for both flagstone generations. Kept as a closure so the
  // repeat, the AO cue and the assetState record cannot drift between the v2 path
  // and its fallback.
  function dressPlaza(textures, set) {
    // The plaza is a 9 m radius disc; plazaFloorRepeat() is the single source of
    // truth for the span/tile split, so the browser check and this call agree.
    // applyTextureFamily takes metres rather than a repeat object, so the same
    // split is spelled out with the two named constants.
    const repeat = plazaFloorRepeat();
    applyTextureFamily(plazaMaterial, textures,
      PLAZA_TEXTURE_SPAN_METERS, PLAZA_TEXTURE_SPAN_METERS, PLAZA_TEXTURE_TILE_METERS);
    // Cheap baked AO for grazing angles: a single channel-0 texture on the
    // same UVs as the flagstone map. Only indirect light is multiplied, so
    // this is a grounding cue, not a shadow.
    const aoTexture = createPlazaAoTexture({ THREE });
    if (aoTexture) {
      plazaMaterial.aoMap = aoTexture;
      // The AO map is a full-tier effect: the low tier drops the intensity to
      // 0 so the grounding cue costs nothing when the budget is tight. The
      // upgrade must therefore only bind a NON-ZERO intensity on full, or a
      // slow headless run that has already dropped to low would leave the
      // material in a "bound but off" state that a browser check could read as
      // a missing cue. The low-tier-zero path lives in setQuality so a flip
      // restores exactly what a fresh full-tier boot would have set.
      plazaMaterial.aoMapIntensity = environment.quality === 'low' ? 0 : 0.85;
      plazaMaterial.aoMap.channel = PLAZA_AO_MAP_CHANNEL;
    }
    assetState.plazaFloor = 'textured';
    assetState.plazaFloorDetail = {
      maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => textures[k]),
      aoMap: Boolean(aoTexture),
      set,
      tileMeters: PLAZA_TEXTURE_TILE_METERS,
      repeat: [repeat.repeatX, repeat.repeatY]
    };
    return assetState;
  }

  /**
   * Dresses the roof shingles (the `roof-shingles` InstancedMesh) with their
   * own tile family.
   *
   * The upgrade follows the plaza floor's shape: try the new family, record
   * what actually arrived, and degrade honestly. The difference is the fallback:
   * the plaza keeps a documented v1 set on disk, while the shingles have only
   * ever had their authored flat material (colour 0x6d3a2c, roughness 0.85).
   * So a missing family falls back to that existing flat material rather than to
   * a second texture set -- which is exactly what the material already is.
   *
   * The 1 m box means one tile across every instance: applyTextureFamily is
   * called with a 1 x 1 m span and a 1 m tile, and the authored 0..1 UVs carry
   * the map once per metre. There is no AO map for the roof -- the roof plane is
   * a single pitched face with no occluder beneath it to bake from -- so this
   * family binds only map/normalMap/roughnessMap.
   */
  function upgradeShingles() {
    if (!canLoadAssets({
      hasFetch: typeof fetch === 'function',
      protocol: typeof location !== 'undefined' ? location.protocol : '',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : undefined
    })) {
      // No fetch, no upgrade: the flat material stands as-is. Recording
      // 'unavailable' (rather than 'flat') is what lets a bug report tell
      // "could not fetch" apart from "fetched and 404'd".
      assetState.shingle = 'unavailable';
      return Promise.resolve(assetState);
    }
    return loadMaterialTextures({ THREE, files: ROOF_SHINGLE_TEXTURE_FILES }).then((textures) => {
      if (!textures.anyLoaded) {
        // No v1 shingle set exists to fall back to: the material is already the
        // flat 0x6d3a2c it has always been, so leaving it untouched is the
        // fallback. 'flat' here means "fetched, nothing arrived", distinct from
        // the 'unavailable' above that means "fetch itself was blocked".
        assetState.shingle = 'flat';
        return assetState;
      }
      // The shared box means the texture family itself is shared by every
      // instance, and applyTextureFamily writes the sampler state onto the
      // texture object -- not the material -- so there is nothing per-instance
      // to clone. The family is applied once.
      applyTextureFamily(shingleMaterial,
        { ...cloneTextureFamily(textures), anyLoaded: true }, 1, 1, 1,
        // 0x6d3a2c, the shingle base colour: the family is a value map (joint
        // shadow, grain, nails) and carries no hue of its own, so the base
        // colour still supplies the roof's tone and the existing per-instance
        // instanceColor and paintShingles() glow multiplication keep working
        // over it. paintShingles rewrites this colour on every phase flip, so
        // an albedo that baked in a hue would be tinted twice and drift dark.
        0x6d3a2c);
      assetState.shingle = 'textured';
      assetState.shingleDetail = {
        maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => textures[k]),
        tileMeters: 1,
        instances: shingleSpawnsList.length
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

  // --- Meadow -------------------------------------------------------------
  // The grass ring was a textured plane with nothing standing on it, which read
  // as a painted floor: the ground met every prop in one clean line and never
  // broke it. Round 90 stands ~900 grass tufts on the ring so the lawn has a
  // silhouette -- a dark, ragged edge where the eye meets the ground, blades
  // catching the light at a different angle from the texture beneath them.
  //
  // Placement is decided by the pure scatter module (seeded rejection sampling
  // against the zones that own their ground) and the shape of a clump by the
  // pure tuft module. This block only turns those numbers into one InstancedMesh:
  // one draw call for the whole meadow, four blade variants baked into one
  // geometry buffer, every tuft an instance.
  //
  // The tufts sway in the shared wind field (src/wind.js) on the full tier. The
  // sway is a per-instance matrix update once per frame; on the low tier the
  // meadow still stands, it simply holds still, because a per-frame loop over
  // 900 instances is exactly the kind of cost the low tier exists to drop.
  const MEADOW_COUNT = 900;
  const MEADOW_MARGIN = 0.55;
  // Ground the tufts must not grow through. Circles are things that own a disc
  // of ground (the fountain, the trees, the lamp posts, the barrels); rects are
  // things that own a footprint (the plaza and lane paving, the house, the
  // terrace steps, the bench, the stalls and the walls' own thickness).
  //
  // The plaza disc and the lane floor are already paved, so the ring is
  // everything inside the border walls that is neither. The margin then keeps
  // blades a hand's width off every edge, so nothing kisses the paving.
  const meadowCircles = [
    // The paved plaza disc: a circle, not a rect, so the ring's corners are
    // still planted. A rect would have left four bare wedges.
    { x: 0, z: 0, radius: 9 },
    { x: FOUNTAIN_SPOT.x, z: FOUNTAIN_SPOT.z, radius: FOUNTAIN_COLLIDER },
    ...TREE_SPOTS.map((spot) => ({ x: spot.x, z: spot.z, radius: 1.1 * spot.scale })),
    ...[[7, 7], [-7, 7], [7, -7], [-7, -7]].map(([x, z]) => ({ x, z, radius: 0.45 })),
    ...[[-5, 9], [-6.2, 9.4], [3, -7.5]].map(([x, z]) => ({ x, z, radius: 0.7 }))
  ];
  // Footprints for the market stalls and the crates are read off the stand-in
  // boxes the world already built, not copied by hand. The first version of this
  // list was a hand-written copy, and it had drifted twice: the west stall's
  // keep-out sat at the east stall's mirrored z (-5 instead of +6), so grass grew
  // through the west stall while a patch of empty lawn was kept bare, and the
  // three crates were missing entirely. Deriving the rects from the meshes means
  // a stall or crate that moves takes its keep-out with it.
  const propFootprints = [];
  scene.traverse((node) => {
    const data = node.userData;
    if (!data || !node.geometry || !node.geometry.parameters) return;
    if (!data.marketStallStandin && !data.crateStandin) return;
    const { width, depth } = node.geometry.parameters;
    if (!(width > 0) || !(depth > 0)) return;
    propFootprints.push({
      minX: node.position.x - width / 2,
      maxX: node.position.x + width / 2,
      minZ: node.position.z - depth / 2,
      maxZ: node.position.z + depth / 2
    });
  });

  const meadowRects = [
    // The lane floor, the house, the bench, the terrace and the boards are all
    // rectangles of owned ground.
    { minX: LANE.minX - 0.4, maxX: LANE.maxX + 0.4, minZ: LANE.minZ - 0.4, maxZ: LANE.maxZ + 0.4 },
    { minX: -14.5, maxX: -6.5, minZ: -12, maxZ: -6 },
    { minX: BENCH.x - 1.3, maxX: BENCH.x + 1.3, minZ: BENCH.z - 0.7, maxZ: BENCH.z + 0.7 },
    { minX: TERRACE.minX - 0.3, maxX: TERRACE.maxX + 0.3, minZ: TERRACE.minZ - 0.3, maxZ: TERRACE.maxZ + 0.3 },
    // The job board and the notice board own a strip each.
    { minX: JOB_BOARD.x - 0.9, maxX: JOB_BOARD.x + 0.9, minZ: JOB_BOARD.z - 0.5, maxZ: JOB_BOARD.z + 0.5 },
    { minX: NOTICE_BOARD.x - 0.9, maxX: NOTICE_BOARD.x + 0.9, minZ: NOTICE_BOARD.z - 0.5, maxZ: NOTICE_BOARD.z + 0.5 },
    ...propFootprints
  ];

  // One InstancedMesh per variant, not one mesh of mixed shapes: an InstancedMesh
  // draws the whole base geometry for every instance, so a single mesh could
  // only ever draw one tuft shape. Four variants therefore mean four draw calls
  // -- still trivial -- and each mesh draws only the instances the scatter
  // assigned to it. The alternative, a custom shader that picks a vertex range
  // per instance, buys three draw calls and costs a shader this project does not
  // otherwise need.
  const meadowGroup = new THREE.Group();
  meadowGroup.name = 'meadow';
  meadowGroup.userData = { meadow: true };
  scene.add(meadowGroup);

  const meadowArea = { minX: -HALF + 0.8, maxX: HALF - 0.8, minZ: -HALF + 0.8, maxZ: HALF - 0.8 };
  const meadowScatter = scatterPoints({
    count: MEADOW_COUNT,
    seed: SCATTER_SEED,
    area: meadowArea,
    circles: meadowCircles,
    rects: meadowRects,
    margin: MEADOW_MARGIN,
    minScale: 0.75,
    maxScale: 1.35
  });

  // Bucket the scattered points by variant so each variant mesh knows its own
  // instance count up front (an InstancedMesh's capacity is fixed at build).
  const meadowByVariant = [[], [], [], []];
  for (const point of meadowScatter.points) {
    meadowByVariant[point.variant].push(point);
  }

  const meadowMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.9,
    metalness: 0,
    // Double-sided: a blade is one triangle and is seen from both faces as the
    // player circles a clump. The up-facing normals (see tuft.js) keep the back
    // face lit exactly like the front.
    side: THREE.DoubleSide
  });
  meadowMaterial.name = 'MeadowGrass';

  const meadowVariants = [];
  const meadowPhaseTint = new THREE.Color(0xffffff);
  for (let variant = 0; variant < TUFT_VARIANTS; variant += 1) {
    const points = meadowByVariant[variant];
    const shape = tuftGeometry(variant);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(shape.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(shape.colours, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(shape.normals, 3));
    geometry.computeBoundingSphere();

    const mesh = new THREE.InstancedMesh(geometry, meadowMaterial, Math.max(1, points.length));
    mesh.name = `meadow-tufts-${variant}`;
    mesh.userData = { meadowVariant: variant, tuftCount: points.length };
    mesh.castShadow = false; // A blade's shadow is finer than the shadow map.
    mesh.receiveShadow = true;
    // Instances are placed below; until then nothing is drawn for an empty
    // bucket, so the mesh is hidden rather than left at the identity matrix.
    mesh.count = points.length;
    mesh.visible = points.length > 0;

    const instances = [];
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const yaw = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < points.length; i += 1) {
      const point = points[i];
      position.set(point.x, 0, point.z);
      // The scatter rotation turns the clump about its own vertical axis so two
      // instances of the same variant do not share a silhouette.
      yaw.setFromAxisAngle(up, point.rotation);
      scale.setScalar(point.scale);
      matrix.compose(position, yaw, scale);
      mesh.setMatrixAt(i, matrix);
      instances.push({
        x: point.x,
        z: point.z,
        scale: point.scale,
        rotation: point.rotation,
        // Precomputed per-tuft wind phase, so the sway loop is a couple of
        // multiplies rather than a position hash every frame.
        phase: windPhase(point.x, point.z)
      });
    }
    mesh.instanceMatrix.needsUpdate = true;
    meadowGroup.add(mesh);
    meadowVariants.push({ mesh, instances });
  }

  // The wind direction is fixed, so the lean axis (the horizontal axis a tuft
  // rotates about to tip downwind) is computed once, not per instance.
  const meadowWind = windDirection();
  const meadowAxis = tuftLeanAxis(meadowWind);
  const meadowLeanAxis = new THREE.Vector3(meadowAxis.x, meadowAxis.y, meadowAxis.z);
  let meadowWindTime = 0;

  // --- Night fireflies -----------------------------------------------------
  // A single InstancedMesh of tiny glowing quads in the meadow ring. One draw
  // call regardless of count; the per-frame pass only updates instance matrices
  // and opacity, so the cost is a handful of trig operations on the full tier.
  const fireflySpawnsList = fireflyEnabled('full') ? fireflySpawns({ count: FIREFLY_COUNT }) : [];
  const fireflyGeometry = new THREE.PlaneGeometry(0.18, 0.18);
  const fireflyMaterial = new THREE.MeshBasicMaterial({
    color: FIREFLY_TINT,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: false
  });
  fireflyMaterial.name = 'Firefly';
  const fireflyMesh = new THREE.InstancedMesh(
    fireflyGeometry,
    fireflyMaterial,
    Math.max(1, fireflySpawnsList.length)
  );
  fireflyMesh.name = 'fireflies';
  fireflyMesh.count = fireflySpawnsList.length;
  fireflyMesh.visible = fireflySpawnsList.length > 0;
  fireflyMesh.renderOrder = 2;
  scene.add(fireflyMesh);

  // Per-instance base data carried for the drift + blink pass.
  const fireflyInstances = fireflySpawnsList.map((spawn, i) => ({
    spawn,
    baseX: spawn.x,
    baseY: spawn.height,
    baseZ: spawn.z,
    phase: spawn.phase
  }));

  // Place instances once at rest; the per-frame pass overwrites them.
  const _ffMatrix = new THREE.Matrix4();
  const _ffPos = new THREE.Vector3();
  const _ffScale = new THREE.Vector3(1, 1, 1);
  const _ffQuat = new THREE.Quaternion();
  for (let i = 0; i < fireflyInstances.length; i += 1) {
    const inst = fireflyInstances[i];
    _ffPos.set(inst.baseX, inst.baseY, inst.baseZ);
    _ffMatrix.compose(_ffPos, _ffQuat, _ffScale);
    fireflyMesh.setMatrixAt(i, _ffMatrix);
  }
  fireflyMesh.instanceMatrix.needsUpdate = true;

  let fireflyTime = 0;
  function updateFireflies(dt) {
    if (!fireflyEnabled(environment.quality)) return;
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    if (step === 0 && fireflyTime === 0 && fireflyInstances.length === 0) return;
    fireflyTime += step;
    const glow = fireflyGlowLevel(environment.phase);
    // One pass, one setMatrixAt per instance: the drift moves the quad and the
    // blink shrinks it toward nothing. Scaling is the cheap per-instance fade an
    // InstancedMesh gives us without a custom shader — a firefly at scale ~0 is
    // sub-pixel, so the eye reads it as dark while the GPU still draws a quad.
    for (let i = 0; i < fireflyInstances.length; i += 1) {
      const inst = fireflyInstances[i];
      const drift = fireflyDrift(fireflyTime, inst.spawn);
      const blink = fireflyBlink(fireflyTime, inst.phase);
      const s = Math.max(0.05, blink) * glow;
      _ffScale.setScalar(s);
      _ffPos.set(inst.baseX + drift.x, inst.baseY + drift.y, inst.baseZ + drift.z);
      _ffMatrix.compose(_ffPos, _ffQuat, _ffScale);
      fireflyMesh.setMatrixAt(i, _ffMatrix);
    }
    fireflyMesh.instanceMatrix.needsUpdate = true;
    fireflyMaterial.opacity = Math.max(0.05, glow);
  }

  function paintFireflies(phaseId) {
    const glow = fireflyGlowLevel(phaseId);
    fireflyMesh.visible = glow > 0 && fireflyInstances.length > 0;
    fireflyMaterial.opacity = Math.max(0.05, glow);
  }

  // --- Birds over the plaza ------------------------------------------------
  // The daytime counterpart to the fireflies: a flock that circles overhead so
  // an upward glance finds something moving. Two InstancedMeshes (left wing,
  // right wing) draw the whole flock, and the flap is the instance matrix's own
  // rotation rather than a morph target, so the per-frame pass is a few dozen
  // trig calls and there is no second geometry to keep in step.
  const birdSpawnsList = birdsEnabled('full') ? birdFlock({ count: BIRD_COUNT }) : [];
  const birdMaterial = new THREE.MeshBasicMaterial({
    // An unlit silhouette: at 15-23 m a bird is a dark shape against the sky,
    // and lighting it would cost a shader branch for something no one can see.
    color: 0x2b2f36,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 1,
    fog: true
  });
  birdMaterial.name = 'BirdSilhouette';

  // One swept triangle, pivot at the body. A second, mirrored instance mesh
  // gives the other wing, so a flapping bird is still two draw calls; a body
  // would be a third for a shape a few pixels wide, so the two triangles meet
  // at the body and read as one bird.
  const birdWingGeometry = new THREE.BufferGeometry();
  birdWingGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, 0,
    0.34, 0, 0.09,
    0.30, 0, -0.19
  ]), 3));
  birdWingGeometry.computeBoundingSphere();
  const birdLeftMesh = new THREE.InstancedMesh(
    birdWingGeometry, birdMaterial, Math.max(1, birdSpawnsList.length)
  );
  birdLeftMesh.name = 'bird-wings-left';
  birdLeftMesh.count = birdSpawnsList.length;
  birdLeftMesh.frustumCulled = false; // the flock is always overhead
  const birdRightMesh = new THREE.InstancedMesh(
    birdWingGeometry, birdMaterial, Math.max(1, birdSpawnsList.length)
  );
  birdRightMesh.name = 'bird-wings-right';
  birdRightMesh.count = birdSpawnsList.length;
  birdRightMesh.frustumCulled = false;
  scene.add(birdLeftMesh, birdRightMesh);

  const _birdMatrix = new THREE.Matrix4();
  const _birdPos = new THREE.Vector3();
  const _birdScale = new THREE.Vector3();
  const _birdYaw = new THREE.Quaternion();
  const _birdFlap = new THREE.Quaternion();
  const _birdQuat = new THREE.Quaternion();
  const _birdUp = new THREE.Vector3(0, 1, 0);
  const _birdForward = new THREE.Vector3(0, 0, 1);
  // A wingspan of ~0.7 m at 15-23 m: big enough to read as a bird, small
  // enough that a flock of eight does not look like bats.
  const BIRD_WING_SCALE = 1.05;

  function paintBirds(phaseId) {
    const glow = birdGlowLevel(phaseId);
    birdMaterial.opacity = glow;
    const show = glow > 0 && birdSpawnsList.length > 0;
    birdLeftMesh.visible = show;
    birdRightMesh.visible = show;
  }

  let birdTime = 0;
  /** Places both wing instances for every bird at `time`. */
  function placeBirds(time) {
    for (let i = 0; i < birdSpawnsList.length; i += 1) {
      const spawn = birdSpawnsList[i];
      const flight = birdFlight(time, spawn);
      const yaw = birdHeading(time, spawn);
      _birdPos.set(flight.x, flight.y, flight.z);
      _birdYaw.setFromAxisAngle(_birdUp, yaw);
      // The flap is a rotation about the body's own forward axis, composed
      // after the yaw so a bird on the far side of its circle still flaps
      // about its own spine rather than about the world's z.
      _birdFlap.setFromAxisAngle(_birdForward, flight.wing);
      _birdQuat.copy(_birdYaw).multiply(_birdFlap);
      // The right wing runs along local +x; the left is the same triangle with
      // x mirrored, which also flips the sense of the flap, so it takes -wing.
      _birdScale.set(BIRD_WING_SCALE, BIRD_WING_SCALE, BIRD_WING_SCALE);
      _birdMatrix.compose(_birdPos, _birdQuat, _birdScale);
      birdRightMesh.setMatrixAt(i, _birdMatrix);
      _birdFlap.setFromAxisAngle(_birdForward, -flight.wing);
      _birdQuat.copy(_birdYaw).multiply(_birdFlap);
      _birdScale.set(-BIRD_WING_SCALE, BIRD_WING_SCALE, BIRD_WING_SCALE);
      _birdMatrix.compose(_birdPos, _birdQuat, _birdScale);
      birdLeftMesh.setMatrixAt(i, _birdMatrix);
    }
    birdRightMesh.instanceMatrix.needsUpdate = true;
    birdLeftMesh.instanceMatrix.needsUpdate = true;
  }

  function updateBirds(dt) {
    if (!birdsEnabled(environment.quality)) return;
    if (!birdSpawnsList.length) return;
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    birdTime += step;
    if (!birdLeftMesh.visible) return;
    placeBirds(birdTime);
  }
  // Place the flock once at time 0 so the first frame (and any check that reads
  // the matrices before stepping) sees birds on their orbits, not identity
  // matrices stacked at the world origin.
  placeBirds(0);

  // --- Chimney smoke -------------------------------------------------------
  // Thin columns from the roof lines: the house's own chimney, plus three that
  // read as the village continuing past the border walls. Smoke is one of the
  // cheapest ways to say "people live here", and the pure module in
  // src/chimney.js decides where each puff sits, how it leans and how it fades.
  //
  // The sites are passed in rather than sampled, because the module cannot know
  // where this world's roofs are. The first is the modelled house chimney
  // (house-model at -10.5,-9 plus the model's own chimney at +2.2,+1.0, cap at
  // 5.25 m). The other three stand outside the walls: the player's eye is at
  // 1.6 m and the wall is 3.2 m, so a plume based at ~4.5 m 20 m out shows only
  // its column above the wall line, which is exactly the depth cue wanted and
  // costs no new geometry.
  const smokeSites = [
    { x: -8.3, z: -8.0, baseY: 5.3 },
    { x: -22.0, z: -9.0, baseY: 4.6 },
    { x: 20.5, z: -15.5, baseY: 4.2 },
    { x: -4.0, z: 22.0, baseY: 4.8 }
  ];
  const smokeSpawnsList = chimneyEnabled('full')
    ? chimneySpawns({ count: smokeSites.length, sites: smokeSites, seed: CHIMNEY_SEED })
    : [];

  // A soft radial puff, generated once. A canvas gradient is the cheapest way to
  // get a soft edge without a texture fetch, and the same helper pattern as the
  // plaza AO map in assets.js; a null canvas (no DOM) simply leaves the smoke
  // with hard edges rather than throwing.
  function createSmokeTexture(size = 64) {
    if (typeof document === 'undefined' || !document.createElement) return null;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.8, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    // The puff is an albedo-style map, so it must be tagged sRGB or the
    // browser suite's colour-space check sees two distinct values and the
    // whole albedo family fails. Three does not default a CanvasTexture.
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  // Two quads crossed at 90 degrees rather than one camera-facing billboard.
  // A crossed pair looks the same from every direction, so the smoke needs no
  // camera and no per-frame rotation -- it is one geometry that can be turned
  // into an InstancedMesh like any other.
  function createCrossedQuadGeometry() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
      0, -0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0, 0.5, -0.5
    ]), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
      0, 0, 1, 0, 1, 1, 0, 1,
      0, 0, 1, 0, 1, 1, 0, 1
    ]), 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    geometry.computeBoundingSphere();
    return geometry;
  }

  const smokeMaterial = new THREE.MeshBasicMaterial({
    color: 0xcfd2d6,
    map: createSmokeTexture(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true
  });
  smokeMaterial.name = 'ChimneySmoke';
  const smokeMesh = new THREE.InstancedMesh(
    createCrossedQuadGeometry(),
    smokeMaterial,
    Math.max(1, smokeSpawnsList.length * CHIMNEY_PUFFS)
  );
  smokeMesh.name = 'chimney-smoke';
  smokeMesh.count = smokeSpawnsList.length * CHIMNEY_PUFFS;
  smokeMesh.visible = false;
  smokeMesh.frustumCulled = false; // the columns are taller than the quad
  smokeMesh.renderOrder = 2;
  scene.add(smokeMesh);

  // One flat list of (plume, slot) so the per-frame pass is a single loop with
  // no nested arrays to chase; slot order is preserved so instance i of a plume
  // always draws the same puff.
  const smokeInstances = [];
  for (let p = 0; p < smokeSpawnsList.length; p += 1) {
    for (let slot = 0; slot < CHIMNEY_PUFFS; slot += 1) {
      smokeInstances.push({ spawn: smokeSpawnsList[p], slot });
    }
  }

  const _smokeMatrix = new THREE.Matrix4();
  const _smokePos = new THREE.Vector3();
  const _smokeScale = new THREE.Vector3();
  const _smokeQuat = new THREE.Quaternion();

  function paintSmoke(phaseId) {
    const glow = smokeGlowLevel(phaseId);
    smokeMaterial.opacity = CHIMNEY_MAX_OPACITY * glow;
    smokeMesh.visible = glow > 0 && smokeInstances.length > 0;
  }

  let smokeTime = 0;
  /** Writes every puff's transform for `time`. Returns the number placed. */
  function placeSmoke(time) {
    for (let i = 0; i < smokeInstances.length; i += 1) {
      const { spawn, slot } = smokeInstances[i];
      const puff = smokePuff(spawn, slot, time);
      // The module's opacity is expressed as scale. An InstancedMesh shares one
      // material, so a per-puff alpha would need a shader this project does not
      // otherwise carry; scaling the quad instead is the same trick the
      // fireflies use, and for smoke it reads as the column thinning out as it
      // climbs. The square root keeps the visible thickness from collapsing
      // too fast in the middle of the plume.
      const fade = CHIMNEY_MAX_OPACITY > 0
        ? Math.min(1, Math.max(0, puff.opacity / CHIMNEY_MAX_OPACITY))
        : 0;
      const s = puff.size * Math.sqrt(fade);
      _smokePos.set(puff.x, puff.y, puff.z);
      _smokeScale.set(s, s, s);
      _smokeMatrix.compose(_smokePos, _smokeQuat, _smokeScale);
      smokeMesh.setMatrixAt(i, _smokeMatrix);
    }
    smokeMesh.instanceMatrix.needsUpdate = true;
    return smokeInstances.length;
  }
  placeSmoke(0);

  function updateSmoke(dt) {
    if (!chimneyEnabled(environment.quality)) return;
    if (!smokeInstances.length) return;
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    smokeTime += step;
    if (!smokeMesh.visible) return;
    placeSmoke(smokeTime);
  }

  // --- Daytime butterflies -------------------------------------------------
  // The daylight counterpart to the fireflies, at the height a player actually
  // looks: just above the grass beyond the plaza edge. Two InstancedMeshes, one
  // per wing, so the whole field is two draw calls and the flap is the instance
  // matrix's own rotation rather than a morph. src/butterflies.js decides where
  // each one wanders and how far its wings swing.
  const butterflySpawnsList = butterfliesEnabled('full')
    ? butterflySpawns({ count: BUTTERFLY_COUNT })
    : [];
  // A wing is a small rounded quad hinged at the body, so a mirrored copy on the
  // other side reads as a butterfly rather than as two loose scraps. The tint is
  // per instance, so one material serves all three colourways.
  const butterflyWingGeometry = new THREE.BufferGeometry();
  butterflyWingGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, -0.05,
    0.17, 0, -0.07,
    0.15, 0, 0.07,
    0, 0, 0.05
  ]), 3));
  butterflyWingGeometry.setIndex([0, 1, 2, 0, 2, 3]);
  butterflyWingGeometry.computeVertexNormals();
  butterflyWingGeometry.computeBoundingSphere();
  const butterflyMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0,
    // Wings are thin and lit from above; an unlit tinted quad at this size reads
    // better than a shaded one, and the tint comes from the instance colour.
    fog: true
  });
  butterflyMaterial.name = 'ButterflyWing';
  const butterflyLeftMesh = new THREE.InstancedMesh(
    butterflyWingGeometry, butterflyMaterial, Math.max(1, butterflySpawnsList.length)
  );
  butterflyLeftMesh.name = 'butterfly-wings-left';
  butterflyLeftMesh.count = butterflySpawnsList.length;
  butterflyLeftMesh.frustumCulled = false;
  const butterflyRightMesh = new THREE.InstancedMesh(
    butterflyWingGeometry, butterflyMaterial, Math.max(1, butterflySpawnsList.length)
  );
  butterflyRightMesh.name = 'butterfly-wings-right';
  butterflyRightMesh.count = butterflySpawnsList.length;
  butterflyRightMesh.frustumCulled = false;
  scene.add(butterflyLeftMesh, butterflyRightMesh);

  // The instance colour carries the colourway; it is written once because a
  // butterfly never changes its pattern, only its position and wing angle.
  const _bColor = new THREE.Color();
  for (let i = 0; i < butterflySpawnsList.length; i += 1) {
    const tint = BUTTERFLY_TINTS[butterflySpawnsList[i].tintIndex % BUTTERFLY_TINTS.length];
    _bColor.setHex(tint);
    butterflyLeftMesh.setColorAt(i, _bColor);
    butterflyRightMesh.setColorAt(i, _bColor);
  }
  if (butterflyLeftMesh.instanceColor) butterflyLeftMesh.instanceColor.needsUpdate = true;
  if (butterflyRightMesh.instanceColor) butterflyRightMesh.instanceColor.needsUpdate = true;

  const _bMatrix = new THREE.Matrix4();
  const _bPos = new THREE.Vector3();
  const _bScale = new THREE.Vector3();
  const _bYaw = new THREE.Quaternion();
  const _bFlap = new THREE.Quaternion();
  const _bQuat = new THREE.Quaternion();
  const _bUp = new THREE.Vector3(0, 1, 0);
  const _bForward = new THREE.Vector3(0, 0, 1);

  /** Writes both wings for every butterfly at `time`. */
  function placeButterflies(time) {
    // The heading is taken from the wander's own motion: sampling the flight a
    // hundredth of a second ahead and behind gives the travel direction, so a
    // butterfly always faces the way it is going. A fixed yaw would make it look
    // like a sticker sliding across the meadow.
    const ahead = time + 0.01;
    const behind = time - 0.01;
    for (let i = 0; i < butterflySpawnsList.length; i += 1) {
      const spawn = butterflySpawnsList[i];
      const flight = butterflyFlight(time, spawn);
      const next = butterflyFlight(ahead, spawn);
      const prev = butterflyFlight(behind, spawn);
      const dx = next.x - prev.x;
      const dz = next.z - prev.z;
      const scale = spawn.scale;
      _bPos.set(flight.x, flight.y, flight.z);
      const heading = (Math.abs(dx) + Math.abs(dz)) > 1e-9 ? Math.atan2(dx, dz) : 0;
      _bYaw.setFromAxisAngle(_bUp, heading);
      // The wing rotation is about the body's forward axis, composed after the
      // yaw so the flap always hinges along the butterfly's own spine.
      _bFlap.setFromAxisAngle(_bForward, flight.wing);
      _bQuat.copy(_bYaw).multiply(_bFlap);
      _bScale.set(scale, scale, scale);
      _bMatrix.compose(_bPos, _bQuat, _bScale);
      butterflyRightMesh.setMatrixAt(i, _bMatrix);
      _bFlap.setFromAxisAngle(_bForward, -flight.wing);
      _bQuat.copy(_bYaw).multiply(_bFlap);
      _bScale.set(-scale, scale, scale);
      _bMatrix.compose(_bPos, _bQuat, _bScale);
      butterflyLeftMesh.setMatrixAt(i, _bMatrix);
    }
    butterflyRightMesh.instanceMatrix.needsUpdate = true;
    butterflyLeftMesh.instanceMatrix.needsUpdate = true;
  }
  placeButterflies(0);

  function paintButterflies(phaseId) {
    const glow = butterflyGlowLevel(phaseId);
    butterflyMaterial.opacity = glow;
    // The tier gate belongs here, not only in updateButterflies: a low tier that
    // merely froze the field would leave two wing meshes on screen flapping
    // never, which is more conspicuous than their absence and still costs the
    // draw calls the tier exists to save. Hiding them keeps the quality contract
    // (every per-frame pass and its meshes are dropped together).
    const show = glow > 0 && butterflySpawnsList.length > 0
      && butterfliesEnabled(environment.quality);
    butterflyLeftMesh.visible = show;
    butterflyRightMesh.visible = show;
  }

  let butterflyTime = 0;
  function updateButterflies(dt) {
    if (!butterfliesEnabled(environment.quality)) return;
    if (!butterflySpawnsList.length) return;
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    butterflyTime += step;
    if (!butterflyLeftMesh.visible) return;
    placeButterflies(butterflyTime);
  }

  // --- Fallen leaves in the meadow ----------------------------------------
  // Static dressing, one InstancedMesh per leaf shape, tinted per instance from
  // src/litter.js's palette. Four draw calls for the whole field, no per-frame
  // pass at all: the leaves lie still, which is also what makes them read as
  // litter rather than as another animated effect.
  const litterSpawnsList = litterEnabled('full') ? litterSpawns({ count: LITTER_COUNT }) : [];
  const litterMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0,
    side: THREE.DoubleSide,
    // Litter is a ground detail; letting it write depth keeps it from sorting
    // oddly against the grass blades standing through it.
    depthWrite: true
  });
  litterMaterial.name = 'MeadowLitter';

  // Four leaf silhouettes, each a flat fan of quads lying in the ground plane.
  // The shapes differ only in outline, so a handful of vertices each.
  function litterLeafGeometry(variant) {
    const shapes = [
      // 0: a simple pointed oval
      [[-0.09, 0, -0.02], [0, 0, -0.12], [0.09, 0, -0.02], [0, 0, 0.09]],
      // 1: a broader, rounder leaf
      [[-0.11, 0, 0], [0, 0, -0.1], [0.11, 0, 0], [0, 0, 0.1]],
      // 2: a long narrow leaf (willow-ish)
      [[-0.05, 0, -0.06], [0, 0, -0.16], [0.05, 0, -0.06], [0, 0, 0.1]],
      // 3: a lobed leaf, read as a sycamore
      [[-0.12, 0, -0.03], [0, 0, -0.13], [0.12, 0, -0.03], [0, 0, 0.11]]
    ];
    const pts = shapes[variant % shapes.length];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      pts[0][0], 0, pts[0][2],
      pts[1][0], 0, pts[1][2],
      pts[2][0], 0, pts[2][2],
      pts[3][0], 0, pts[3][2]
    ]), 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  const litterMeshes = [];
  for (let v = 0; v < LITTER_VARIANTS; v += 1) {
    const ofVariant = litterSpawnsList.filter((leaf) => leaf.variant === v);
    const mesh = new THREE.InstancedMesh(
      litterLeafGeometry(v), litterMaterial, Math.max(1, ofVariant.length)
    );
    mesh.name = `meadow-litter-${v}`;
    mesh.count = ofVariant.length;
    mesh.visible = ofVariant.length > 0;
    mesh.receiveShadow = true;
    const _lMatrix = new THREE.Matrix4();
    const _lPos = new THREE.Vector3();
    const _lQuat = new THREE.Quaternion();
    const _lScale = new THREE.Vector3();
    const _lColor = new THREE.Color();
    const _lUp = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < ofVariant.length; i += 1) {
      const leaf = ofVariant[i];
      // A hand's width above the ground: lying exactly on the plane would z-fight
      // with the meadow floor and vanish at grazing angles.
      _lPos.set(leaf.x, 0.02, leaf.z);
      _lQuat.setFromAxisAngle(_lUp, leaf.yaw);
      _lScale.set(leaf.scale, leaf.scale, leaf.scale);
      _lMatrix.compose(_lPos, _lQuat, _lScale);
      mesh.setMatrixAt(i, _lMatrix);
      _lColor.setHex(LITTER_TINTS[leaf.tint % LITTER_TINTS.length]);
      mesh.setColorAt(i, _lColor);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
    litterMeshes.push({ mesh, count: ofVariant.length });
  }

  function paintLitter(phaseId) {
    const glow = litterGlowLevel(phaseId);
    // Litter is not a light: the phase multiplier only dims its tint, which is
    // done by the scene lighting itself. Visibility is the only thing the phase
    // needs to own, and it never goes to zero, so the field simply stays.
    litterMaterial.opacity = 1;
    const on = glow > 0 && litterEnabled(environment.quality);
    for (const { mesh, count } of litterMeshes) mesh.visible = on && count > 0;
  }

  // --- Sunlit dust motes ---------------------------------------------------
  // Tiny bright specks drifting in the daylight, the low-cost way to put depth
  // in the air between the player and the wall. src/motes.js bounds every mote's
  // wander so none can drift out of its own small box, and the phase table is
  // exactly 0 at night so the mesh is simply hidden then.
  const moteSpawnsList = motesEnabled('full') ? moteSpawns({ count: MOTE_COUNT }) : [];
  const moteGeometry = new THREE.PlaneGeometry(1, 1);
  const moteMaterial = new THREE.MeshBasicMaterial({
    color: 0xfff3d6,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false
  });
  moteMaterial.name = 'DustMote';
  const moteMesh = new THREE.InstancedMesh(
    moteGeometry, moteMaterial, Math.max(1, moteSpawnsList.length)
  );
  moteMesh.name = 'dust-motes';
  moteMesh.count = moteSpawnsList.length;
  moteMesh.visible = false;
  moteMesh.renderOrder = 2;
  scene.add(moteMesh);

  const _mMatrix = new THREE.Matrix4();
  const _mPos = new THREE.Vector3();
  const _mScale = new THREE.Vector3();
  const _mQuat = new THREE.Quaternion();

  function placeMotes(time) {
    for (let i = 0; i < moteSpawnsList.length; i += 1) {
      const spawn = moteSpawnsList[i];
      const p = motePosition(spawn, time);
      _mPos.set(p.x, p.y, p.z);
      _mScale.setScalar(spawn.size);
      _mMatrix.compose(_mPos, _mQuat, _mScale);
      moteMesh.setMatrixAt(i, _mMatrix);
    }
    moteMesh.instanceMatrix.needsUpdate = true;
  }
  placeMotes(0);

  function paintMotes(phaseId) {
    const glow = moteGlowLevel(phaseId);
    moteMaterial.opacity = 0.55 * glow;
    moteMesh.visible = glow > 0 && moteSpawnsList.length > 0
      && motesEnabled(environment.quality);
  }

  let moteTime = 0;
  function updateMotes(dt) {
    if (!motesEnabled(environment.quality)) return;
    if (!moteSpawnsList.length) return;
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    moteTime += step;
    if (!moteMesh.visible) return;
    placeMotes(moteTime);
  }

  // --- Lit cottage windows -------------------------------------------------
  // The village's life at night. src/windows.js owns the whole schedule -- where
  // each pane sits, how warm it is and when its owner goes to bed -- and this
  // block only turns each spawn into one small emissive quad on a wall face.
  //
  // The panes go on the border wall's inner faces rather than on the modelled
  // house alone. There is exactly one house model in the world, and a single lit
  // building would read as a set piece; a scatter of panes at different heights
  // along all four walls is what makes the plaza feel enclosed by a village. The
  // schedule's own ring (8-18 m) already sits out among the walls, so the quads
  // are simply projected onto the nearest face, which also guarantees every pane
  // is square to the wall it is on and none floats in mid-air.
  const windowSpawnsList = windowsEnabled('full') ? windowSpawns({ count: WINDOW_COUNT }) : [];
  const windowMaterial = new THREE.MeshBasicMaterial({
    color: WINDOW_WARM_TINT,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true
  });
  windowMaterial.name = 'CottageWindow';
  const windowGeometry = new THREE.PlaneGeometry(0.62, 0.78);
  const windowMesh = new THREE.InstancedMesh(
    windowGeometry, windowMaterial, Math.max(1, windowSpawnsList.length)
  );
  windowMesh.name = 'cottage-windows';
  windowMesh.count = windowSpawnsList.length;
  windowMesh.visible = false;
  windowMesh.frustumCulled = false;
  scene.add(windowMesh);

  // Project a schedule position onto the nearest of the four wall inner faces.
  // The world is a 34 m square, so the inner faces are at +/-HALF on x and z; the
  // wall thickness is 1 m, so a pane sits half a metre proud of the face to keep
  // it out of the stonework's z-fighting range.
  const WALL_INNER = HALF - 0.52;
  function faceForWindow(x, z) {
    // Whichever axis the point is furthest out on is the wall it is nearest.
    if (Math.abs(x) >= Math.abs(z)) {
      return x >= 0
        ? { nx: -1, nz: 0, px: WALL_INNER, pz: Math.max(-WALL_INNER, Math.min(WALL_INNER, z)) }
        : { nx: 1, nz: 0, px: -WALL_INNER, pz: Math.max(-WALL_INNER, Math.min(WALL_INNER, z)) };
    }
    return z >= 0
      ? { nx: 0, nz: -1, px: Math.max(-WALL_INNER, Math.min(WALL_INNER, x)), pz: WALL_INNER }
      : { nx: 0, nz: 1, px: Math.max(-WALL_INNER, Math.min(WALL_INNER, x)), pz: -WALL_INNER };
  }

  const windowFaces = windowSpawnsList.map((spawn) => faceForWindow(spawn.x, spawn.z));
  const _wMatrix = new THREE.Matrix4();
  const _wPos = new THREE.Vector3();
  const _wScale = new THREE.Vector3(1, 1, 1);
  const _wQuat = new THREE.Quaternion();
  const _wUp = new THREE.Vector3(0, 1, 0);

  /** Writes every pane's transform and per-instance colour for `night`. */
  let windowNight = 0;

  // The tier is a parameter with a build-time default, not a direct read of
  // `environment.quality`: paintWindows runs once during construction, before
  // the environment handle is initialised, and reading it there throws a TDZ
  // ReferenceError that stops the whole game booting (caught by the headless
  // smoke run). Later calls arrive from applyPhase/setQuality with the handle
  // live, so the default applies only at build time.
  function paintWindows(phaseId, night, tier = 'full') {
    const coarse = (phaseId === 'dusk' ? 0.18 : phaseId === 'night' ? 0.62 : 0);
    if (!Number.isFinite(night)) night = coarse;
    windowNight = Number.isFinite(night) ? Math.min(1, Math.max(0, night)) : 0;
    const level = windowGlowLevel(phaseId);
    const enabled = windowsEnabled(tier);
    let anyLit = false;
    const colour = new THREE.Color();
    for (let i = 0; i < windowSpawnsList.length; i += 1) {
      const spawn = windowSpawnsList[i];
      const face = windowFaces[i];
      const glow = enabled ? windowGlow(phaseId, spawn, night) : 0;
      const lit = glow > 0;
      if (lit) anyLit = true;
      _wPos.set(face.px, spawn.y, face.pz);
      // The plane's own normal is +z, so a yaw of atan2(nx, nz) turns it to face
      // out of the wall into the plaza.
      _wQuat.setFromAxisAngle(_wUp, Math.atan2(face.nx, face.nz));
      _wMatrix.compose(_wPos, _wQuat, _wScale);
      windowMesh.setMatrixAt(i, _wMatrix);
      // Brightness is carried as instance colour rather than per-instance alpha:
      // an InstancedMesh shares one material, and scaling a lit pane to nothing
      // would also shrink its frame. Dimming the emissive tint is the honest
      // analogue of a lamp behind glass, and it leaves the quad's size stable.
      const k = glow > 0 ? Math.max(0.12, glow / WINDOW_MAX_GLOW) : 0;
      colour.setHex(WINDOW_WARM_TINT).multiplyScalar(k);
      windowMesh.setColorAt(i, colour);
    }
    windowMesh.instanceMatrix.needsUpdate = true;
    if (windowMesh.instanceColor) windowMesh.instanceColor.needsUpdate = true;
    windowMaterial.opacity = level > 0 ? 0.92 : 0;
    windowMesh.visible = enabled && anyLit;
  }
  paintWindows('day', 0);

  // --- Ivy on the border walls ---------------------------------------------
  const ivySpawnsList = ivyEnabled('full')
    ? ivySpawns({
        count: IVY_COUNT,
        faces: [
          { x: 0, z: HALF - 0.5, yaw: Math.PI, length: WORLD_SIZE },
          { x: 0, z: -(HALF - 0.5), yaw: 0, length: WORLD_SIZE },
          { x: HALF - 0.5, z: 0, yaw: -Math.PI / 2, length: WORLD_SIZE },
          { x: -(HALF - 0.5), z: 0, yaw: Math.PI / 2, length: WORLD_SIZE }
        ]
      })
    : [];
  const ivyMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 1,
    roughness: 0.85, metalness: 0
  });
  ivyMaterial.name = 'IvyPatch';
  const ivyPatches = ivySpawnsList.map((spawn) => {
    const geometry = new THREE.PlaneGeometry(spawn.width, spawn.span);
    const mesh = new THREE.Mesh(geometry, ivyMaterial.clone());
    mesh.name = 'ivy-patch';
    mesh.position.set(
      spawn.x + Math.sin(spawn.yaw) * 0.06,
      spawn.baseY + spawn.span / 2,
      spawn.z + Math.cos(spawn.yaw) * 0.06
    );
    mesh.rotation.y = spawn.yaw;
    const tint = IVY_TINTS[spawn.tint % IVY_TINTS.length];
    mesh.material.color.setHex(tint);
    mesh.material.name = 'IvyPatch';
    scene.add(mesh);
    return { mesh, spawn };
  });

  let ivyTime = 0;
  function placeIvy() {
    for (let i = 0; i < ivyPatches.length; i += 1) {
      const entry = ivyPatches[i];
      const { sway, brightness } = ivySway(entry.spawn, ivyTime);
      entry.mesh.rotation.z = sway;
      entry.mesh.material.opacity = brightness * ivyGlowLevel(environment.phase);
    }
  }
  // placeIvy is not called at build time: it reads environment.phase, which does
  // not exist yet inside buildWorld. paintIvy('day') below sets the initial look.

  // `tier` defaults to full so the build-time call is safe before the handle
  // exists; every later call passes environment.quality explicitly.
  function paintIvy(phaseId, tier = 'full') {
    const glow = ivyGlowLevel(phaseId);
    const on = glow > 0 && ivyEnabled(tier);
    for (const entry of ivyPatches) {
      entry.mesh.visible = on;
      if (on) entry.mesh.material.opacity = glow;
    }
  }
  paintIvy('day');

  function updateIvy(dt) {
    if (!ivyEnabled(environment.quality)) return;
    if (!ivyPatches.length) return;
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    ivyTime += step;
    if (ivyPatches.every((entry) => !entry.mesh.visible)) return;
    placeIvy();
  }

  // --- Fountain spray ------------------------------------------------------
  const spraySpawnsList = sprayEnabled('full')
    ? spraySpawns({ count: SPRAY_COUNT })
    : [];
  const sprayGeometry = new THREE.PlaneGeometry(1, 1);
  const sprayMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 1, depthWrite: false,
    side: THREE.DoubleSide, fog: true
  });
  sprayMaterial.name = 'FountainSpray';
  const sprayMesh = new THREE.InstancedMesh(
    sprayGeometry, sprayMaterial, Math.max(1, spraySpawnsList.length)
  );
  sprayMesh.name = 'fountain-spray';
  sprayMesh.count = spraySpawnsList.length;
  sprayMesh.frustumCulled = false;
  sprayMesh.position.set(FOUNTAIN_SPOT.x, 0, FOUNTAIN_SPOT.z);
  scene.add(sprayMesh);

  const _sMatrix = new THREE.Matrix4();
  const _sPos = new THREE.Vector3();
  const _sScale = new THREE.Vector3();
  const _sQuat = new THREE.Quaternion();
  const _sColor = new THREE.Color();

  function placeSpray(time) {
    for (let i = 0; i < spraySpawnsList.length; i += 1) {
      const spawn = spraySpawnsList[i];
      const drop = sprayDrop(spawn, time);
      _sPos.set(drop.x, drop.y, drop.z);
      _sScale.setScalar(drop.size);
      _sMatrix.compose(_sPos, _sQuat, _sScale);
      sprayMesh.setMatrixAt(i, _sMatrix);
      const k = drop.opacity > 0 ? drop.opacity / SPRAY_MAX_OPACITY : 0;
      _sColor.setRGB(k, k, k);
      sprayMesh.setColorAt(i, _sColor);
    }
    sprayMesh.instanceMatrix.needsUpdate = true;
    if (sprayMesh.instanceColor) sprayMesh.instanceColor.needsUpdate = true;
  }
  placeSpray(0);

  function paintSpray(phaseId, tier = 'full') {
    const glow = sprayGlowLevel(phaseId);
    sprayMaterial.opacity = glow;
    sprayMesh.visible = glow > 0 && spraySpawnsList.length > 0
      && sprayEnabled(tier);
  }
  paintSpray('day');

  let sprayTime = 0;
  function updateSpray(dt) {
    if (!sprayEnabled(environment.quality)) return;
    if (!spraySpawnsList.length) return;
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    sprayTime += step;
    if (!sprayMesh.visible) return;
    placeSpray(sprayTime);
  }

  // --- Ground mist ---------------------------------------------------------
  const mistSpawnsList = mistEnabled('full')
    ? mistSpawns({ count: MIST_COUNT })
    : [];
  const mistGeometry = new THREE.PlaneGeometry(1, 1);
  const mistMaterial = new THREE.MeshBasicMaterial({
    color: 0xdfe7f0, transparent: true, opacity: MIST_MAX_OPACITY,
    depthWrite: false, side: THREE.DoubleSide, fog: true
  });
  mistMaterial.name = 'GroundMist';
  const mistMesh = new THREE.InstancedMesh(
    mistGeometry, mistMaterial, Math.max(1, mistSpawnsList.length)
  );
  mistMesh.name = 'ground-mist';
  mistMesh.count = mistSpawnsList.length;
  mistMesh.frustumCulled = false;
  scene.add(mistMesh);

  const _gMatrix = new THREE.Matrix4();
  const _gPos = new THREE.Vector3();
  const _gScale = new THREE.Vector3();
  const _gQuat = new THREE.Quaternion();

  function placeMist(time) {
    for (let i = 0; i < mistSpawnsList.length; i += 1) {
      const spawn = mistSpawnsList[i];
      const p = mistDrift(spawn, time);
      _gPos.set(p.x, spawn.y, p.z);
      _gScale.setScalar(spawn.size);
      _gMatrix.compose(_gPos, _gQuat, _gScale);
      mistMesh.setMatrixAt(i, _gMatrix);
    }
    mistMesh.instanceMatrix.needsUpdate = true;
  }
  placeMist(0);

  function paintMist(phaseId, tier = 'full') {
    const glow = mistOpacity(phaseId);
    mistMaterial.opacity = MIST_MAX_OPACITY * glow;
    mistMesh.visible = glow > 0 && mistSpawnsList.length > 0
      && mistEnabled(tier);
  }
  paintMist('day');

  let mistTime = 0;
  function updateMist(dt) {
    if (!mistEnabled(environment.quality)) return;
    if (!mistSpawnsList.length) return;
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    mistTime += step;
    if (!mistMesh.visible) return;
    placeMist(mistTime);
  }

  // --- Fountain ripples -----------------------------------------------
  // One InstancedMesh of flat rings lying RIPPLE_WATER_Y above the water disc,
  // clustered around the jet (RIPPLE_SITE_RADIUS). Each site carries
  // RIPPLE_RINGS_PER_SITE rings staggered through the life.
  //
  // The ring is drawn by a tiny fragment shader on a unit quad rather than by
  // scaling a RingGeometry. A scaled ring would keep its *relative* band width,
  // so a ring at the rim would be four times as thick as a newborn one and the
  // basin would read as concentric hoops rather than ripples. A shader can put
  // the band at a constant world thickness while the radius grows, and it also
  // gives each instance its own alpha, so `rippleRing`'s exact-zero fade tail
  // survives instead of being averaged away by one global material opacity.
  const rippleSpawnsList = ripplesEnabled('full')
    ? rippleSpawns({ count: RIPPLE_COUNT })
    : [];
  const rippleInstanceCount = rippleSpawnsList.length * RIPPLE_RINGS_PER_SITE;
  const rippleGeometry = new THREE.PlaneGeometry(1, 1);
  // Per-instance band width (uv units, so it follows the instance scale) and
  // per-instance alpha (0..1, normalised by RIPPLE_MAX_OPACITY).
  const rippleBandArray = new Float32Array(Math.max(1, rippleInstanceCount));
  const rippleAlphaArray = new Float32Array(Math.max(1, rippleInstanceCount));
  const rippleBandAttr = new THREE.InstancedBufferAttribute(rippleBandArray, 1);
  const rippleAlphaAttr = new THREE.InstancedBufferAttribute(rippleAlphaArray, 1);
  rippleBandAttr.setUsage(THREE.DynamicDrawUsage);
  rippleAlphaAttr.setUsage(THREE.DynamicDrawUsage);
  rippleGeometry.setAttribute('aBand', rippleBandAttr);
  rippleGeometry.setAttribute('aAlpha', rippleAlphaAttr);

  // The ring sits at this fraction of the quad, so the outer edge of the band is
  // not clipped by the quad's own boundary; the instance scale divides by it so
  // the visible ring still lands exactly on `radius`.
  const RIPPLE_RING_AT = 0.85;

  const rippleMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0xffffff) },
      uGlow: { value: 1 },
      uRingAt: { value: RIPPLE_RING_AT }
    },
    vertexShader: [
      'attribute float aBand;',
      'attribute float aAlpha;',
      'varying vec2 vUv;',
      'varying float vBand;',
      'varying float vAlpha;',
      'void main() {',
      '  vUv = uv;',
      '  vBand = aBand;',
      '  vAlpha = aAlpha;',
      '  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);',
      '  gl_Position = projectionMatrix * mvPosition;',
      '}'
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 uColor;',
      'uniform float uGlow;',
      'uniform float uRingAt;',
      'varying vec2 vUv;',
      'varying float vBand;',
      'varying float vAlpha;',
      'void main() {',
      '  float d = length(vUv - vec2(0.5)) * 2.0;',
      '  float band = max(vBand, 0.0005);',
      '  float a = 1.0 - smoothstep(band * 0.5, band, abs(d - uRingAt));',
      '  a *= vAlpha * uGlow;',
      '  if (a <= 0.002) discard;',
      '  gl_FragColor = vec4(uColor, a);',
      '}'
    ].join('\n'),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  rippleMaterial.name = 'FountainRipple';
  const rippleMesh = new THREE.InstancedMesh(
    rippleGeometry, rippleMaterial, Math.max(1, rippleInstanceCount)
  );
  rippleMesh.name = 'fountain-ripples';
  rippleMesh.count = rippleInstanceCount;
  rippleMesh.frustumCulled = false;
  rippleMesh.position.set(0, 0, 0);
  scene.add(rippleMesh);

  const _rMatrix = new THREE.Matrix4();
  const _rPos = new THREE.Vector3();
  const _rScale = new THREE.Vector3();
  const _rQuat = new THREE.Quaternion();
  _rQuat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

  // Flat list of (spawn, ringIndex) pairs so the instance buffer is contiguous.
  const rippleInstances = [];
  for (let i = 0; i < rippleSpawnsList.length; i += 1) {
    for (let k = 0; k < RIPPLE_RINGS_PER_SITE; k += 1) {
      rippleInstances.push({ spawn: rippleSpawnsList[i], ring: k });
    }
  }

  function placeRipples(time) {
    for (let i = 0; i < rippleInstances.length; i += 1) {
      const { spawn, ring } = rippleInstances[i];
      const r = rippleRing(spawn, ring, time);
      _rPos.set(FOUNTAIN_SPOT.x + r.x, RIPPLE_WATER_Y + 0.001, FOUNTAIN_SPOT.z + r.z);
      // Scale so the visible ring lands on `radius`; the quad itself is larger so
      // the band's outer edge stays inside the geometry.
      const radius = r.radius > 0.0001 ? r.radius : 0.0001;
      const half = radius / RIPPLE_RING_AT;
      _rScale.setScalar(half * 2);
      _rMatrix.compose(_rPos, _rQuat, _rScale);
      rippleMesh.setMatrixAt(i, _rMatrix);
      // The module hands over the band as a world thickness in metres that
      // narrows over the ring's life (RIPPLE_MIN_BAND floor). The shader measures
      // in `d` units, where one d unit spans radius/RIPPLE_RING_AT metres, and
      // its smoothstep takes a *half* width (it feathers from half the band out
      // to the full band), so half the thickness is divided by that span.
      const span = radius / RIPPLE_RING_AT;
      const band = r.band > 0 ? r.band : 0;
      rippleBandArray[i] = Math.min(0.5, span > 0 ? (band * 0.5) / span : 0);
      // `alpha` already carries the exact-zero fade tail and the per-instance
      // strength; it only needs normalising against the material's own maximum.
      rippleAlphaArray[i] = r.alpha > 0 ? Math.min(1, r.alpha / RIPPLE_MAX_OPACITY) : 0;
    }
    rippleMesh.instanceMatrix.needsUpdate = true;
    rippleBandAttr.needsUpdate = true;
    rippleAlphaAttr.needsUpdate = true;
  }
  placeRipples(0);

  // The tier is a parameter, not a direct read of `environment.quality`: this
  // paint runs once during the build, before the environment handle exists, and
  // reading it there throws a TDZ ReferenceError that kills the whole boot
  // (found by the headless smoke run). Construction passes 'full' explicitly;
  // every applyPhase/setQuality call arrives with environment already live.
  function paintRipples(phaseId, tier = environment.quality) {
    const glow = rippleGlowLevel(phaseId);
    rippleMaterial.uniforms.uGlow.value = glow;
    rippleMesh.visible = glow > 0 && rippleInstances.length > 0
      && ripplesEnabled(tier);
  }
  paintRipples('day', 'full');

  let rippleTime = 0;
  function updateRipples(dt) {
    if (!ripplesEnabled(environment.quality)) return;
    if (!rippleInstances.length) return;
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    rippleTime += step;
    if (!rippleMesh.visible) return;
    placeRipples(rippleTime);
  }

  // --- Night moths around the lantern heads ----------------------------
  const mothSpawnsList = mothsEnabled('full')
    ? mothSpawns({ count: MOTH_COUNT })
    : [];
  // A small quad per wing; two wings per moth would double the draw call, so
  // instead one quad whose x-scale is flipped per instance by the flap sign.
  const mothGeometry = new THREE.PlaneGeometry(0.06, 0.04);
  const mothMaterial = new THREE.MeshBasicMaterial({
    color: 0xf2e8c8, transparent: true, opacity: 0, side: THREE.DoubleSide, fog: true
  });
  mothMaterial.name = 'MothWing';
  const mothMesh = new THREE.InstancedMesh(
    mothGeometry, mothMaterial, Math.max(1, mothSpawnsList.length)
  );
  mothMesh.name = 'night-moths';
  mothMesh.count = mothSpawnsList.length;
  mothMesh.frustumCulled = false;
  scene.add(mothMesh);

  const _mtMatrix = new THREE.Matrix4();
  const _mtPos = new THREE.Vector3();
  const _mtScale = new THREE.Vector3();
  const _mtQuat = new THREE.Quaternion();
  const _mtUp = new THREE.Vector3(0, 1, 0);

  function placeMoths(time) {
    for (let i = 0; i < mothSpawnsList.length; i += 1) {
      const spawn = mothSpawnsList[i];
      const f = mothFlight(spawn, time);
      const angle = spawn.angle + time * spawn.speed;
      _mtPos.set(f.x, f.y, f.z);
      // Face along the tangent of the orbit so the moth leads with its head.
      _mtQuat.setFromAxisAngle(_mtUp, angle + Math.PI / 2);
      // Flap: squish the vertical scale with the wingbeat so a still moth reads
      // as resting and a flying one as beating.
      const flapScale = 0.6 + 0.4 * f.flap;
      _mtScale.set(spawn.size, spawn.size * flapScale, spawn.size);
      _mtMatrix.compose(_mtPos, _mtQuat, _mtScale);
      mothMesh.setMatrixAt(i, _mtMatrix);
    }
    mothMesh.instanceMatrix.needsUpdate = true;
  }
  placeMoths(0);

  // Same tier-as-parameter pattern as paintRipples: the build-time call comes
  // before the environment handle is initialised.
  function paintMoths(phaseId, tier = environment.quality) {
    const glow = mothGlowLevel(phaseId);
    mothMaterial.opacity = glow;
    mothMesh.visible = glow > 0 && mothSpawnsList.length > 0
      && mothsEnabled(tier);
  }
  paintMoths('day', 'full');

  let mothTime = 0;
  function updateMoths(dt) {
    if (!mothsEnabled(environment.quality)) return;
    if (!mothSpawnsList.length) return;
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    mothTime += step;
    if (!mothMesh.visible) return;
    placeMoths(mothTime);
  }

  // --- Meadow puddles after rain ---------------------------------------
  const puddleKeepOuts = [
    { x: FOUNTAIN_SPOT.x, z: FOUNTAIN_SPOT.z, radius: PUDDLE_CLEAR_RADIUS },
    ...LANE_PROPS.map((prop) => ({ x: prop.x, z: prop.z, radius: Math.max(prop.width, prop.depth) / 2 + 0.6 }))
  ];
  const puddleSpawnsList = puddlesEnabled('full')
    ? puddleSpawns({ count: PUDDLE_COUNT, circles: puddleKeepOuts })
    : [];
  const puddleGeometry = new THREE.PlaneGeometry(1, 1);
  const puddleMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, transparent: true, opacity: 1, roughness: 0.05, metalness: 0.6,
    side: THREE.DoubleSide, fog: true
  });
  puddleMaterial.name = 'Puddle';
  const puddleMesh = new THREE.InstancedMesh(
    puddleGeometry, puddleMaterial, Math.max(1, puddleSpawnsList.length)
  );
  puddleMesh.name = 'meadow-puddles';
  puddleMesh.count = puddleSpawnsList.length;
  puddleMesh.frustumCulled = false;
  scene.add(puddleMesh);

  const _pMatrix = new THREE.Matrix4();
  const _pPos = new THREE.Vector3();
  const _pScale = new THREE.Vector3();
  const _pQuat = new THREE.Quaternion();
  const _pFlat = new THREE.Quaternion();
  _pFlat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

  function placePuddles(time) {
    for (let i = 0; i < puddleSpawnsList.length; i += 1) {
      const spawn = puddleSpawnsList[i];
      const { wobble } = puddleShimmer(spawn, time);
      _pPos.set(spawn.x, PUDDLE_WATER_Y, spawn.z);
      const sc = spawn.size * (1 + wobble * 0.05);
      _pScale.set(sc, 1, sc);
      _pMatrix.compose(_pPos, _pFlat, _pScale);
      puddleMesh.setMatrixAt(i, _pMatrix);
    }
    puddleMesh.instanceMatrix.needsUpdate = true;
  }
  placePuddles(0);

  // Same tier-as-parameter pattern as paintRipples: the build-time call comes
  // before the environment handle is initialised.
  function paintPuddles(phaseId, tier = environment.quality) {
    const gloss = puddleGloss(phaseId);
    const dark = puddleDarkness(phaseId);
    puddleMaterial.roughness = 1 - gloss * 0.9;
    puddleMaterial.color.setRGB(dark, dark, dark + 0.05);
    puddleMesh.visible = puddleSpawnsList.length > 0 && puddlesEnabled(tier);
  }
  paintPuddles('day', 'full');

  let puddleTime = 0;
  function updatePuddles(dt) {
    if (!puddlesEnabled(environment.quality)) return;
    if (!puddleSpawnsList.length) return;
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    puddleTime += step;
    if (!puddleMesh.visible) return;
    placePuddles(puddleTime);
  }

  // --- Round 95: meadow wildflowers, reeds and courtyard moss ------------
  //
  // Three instanced fields, each one draw call (or two where a bloom needs a
  // separate stem), all decided by a pure module and all dropped on the low
  // tier because their quads are translucent and cover real screen area.
  //
  // A crossQuad helper first: a single quad seen edge-on vanishes, so every
  // blade-like instance is two quads crossed at right angles. Both quads share
  // one geometry and one instance, so the cost is twelve triangles rather than a
  // second draw call.
  //
  // The normals all point straight up, which is the same trick src/tuft.js uses
  // for grass blades and for the same reason: a paper-thin quad lit by its true
  // normal turns black the moment it faces away from the sun, so a stem or a
  // bloom would strobe as the camera circles it. An up-facing normal makes the
  // quad catch the sky and sun exactly as the ground beneath it does, which is
  // what reads as a lit plant rather than a dark cut-out.
  //
  // Both windings are emitted and the material is single-sided on purpose. With
  // `DoubleSide` three flips the normal on a back face (`normal *= gl_FrontFacing
  // ? 1 : -1`), so a vertical quad seen from behind would be lit by a normal
  // pointing at the ground and render near-black -- which is exactly what the
  // pixel probe caught on the reeds. Emitting each triangle twice, the second
  // copy wound the other way, gives both faces a front face and leaves the up
  // normal alone; six extra triangles are cheaper than a foliage material that
  // strobes.
  function crossQuadGeometry(width, height) {
    const hw = width / 2;
    const hh = height / 2;
    const quads = [
      // The z = 0 quad, then the x = 0 quad.
      [[-hw, -hh, 0], [hw, -hh, 0], [hw, hh, 0], [-hw, hh, 0]],
      [[0, -hh, -hw], [0, -hh, hw], [0, hh, hw], [0, hh, -hw]]
    ];
    const positions = [];
    for (const [a, b, c, d] of quads) {
      positions.push(...a, ...b, ...c, ...a, ...c, ...d);
      // The reverse winding, so the face is front-facing from behind too.
      positions.push(...a, ...c, ...b, ...a, ...d, ...c);
    }
    const count = positions.length / 3;
    const normals = new Float32Array(count * 3);
    for (let v = 0; v < count; v += 1) normals[v * 3 + 1] = 1;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.computeBoundingSphere();
    return geometry;
  }

  // The meadow keep-outs are the same discs the grass scatter uses, plus a
  // bounding circle for every rectangle (the lane floor, the house, the stalls),
  // because the pure samplers take circles only. Deriving them from the grass
  // lists means a stall that moves takes its flower keep-out with it.
  const meadowKeepOutCircles = meadowCircles.concat(meadowRects.map((rect) => ({
    x: (rect.minX + rect.maxX) / 2,
    z: (rect.minZ + rect.maxZ) / 2,
    radius: Math.hypot(rect.maxX - rect.minX, rect.maxZ - rect.minZ) / 2
  })));

  // --- Wildflowers -------------------------------------------------------
  const wildflowerSpawnsList = wildflowersEnabled('full')
    ? wildflowerSpawns({ count: WILDFLOWER_COUNT, circles: meadowKeepOutCircles })
    : [];
  const wildflowerBloomGeometry = crossQuadGeometry(0.16, 0.16);
  const wildflowerStemGeometry = crossQuadGeometry(0.022, 1);
  // The stem geometry's origin is its centre, so a unit-height stem scaled by
  // `height` must also be lifted by half that to put its foot on the ground.
  wildflowerStemGeometry.translate(0, 0.5, 0);
  // FrontSide, not DoubleSide: crossQuadGeometry already emits both windings so
  // every face is front-facing and the up normal is never flipped (see its
  // comment). DoubleSide here would flip the normal back to -y on half the
  // triangles and undo that.
  const wildflowerMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.85, metalness: 0, side: THREE.FrontSide
  });
  wildflowerMaterial.name = 'WildflowerBloom';
  const wildflowerStemMaterial = new THREE.MeshStandardMaterial({
    color: 0x4c6a32, roughness: 0.9, metalness: 0, side: THREE.FrontSide
  });
  wildflowerStemMaterial.name = 'WildflowerStem';
  const wildflowerMesh = new THREE.InstancedMesh(
    wildflowerBloomGeometry, wildflowerMaterial, Math.max(1, wildflowerSpawnsList.length)
  );
  wildflowerMesh.name = 'meadow-wildflowers';
  wildflowerMesh.count = wildflowerSpawnsList.length;
  wildflowerMesh.frustumCulled = false;
  scene.add(wildflowerMesh);
  const wildflowerStemMesh = new THREE.InstancedMesh(
    wildflowerStemGeometry, wildflowerStemMaterial, Math.max(1, wildflowerSpawnsList.length)
  );
  wildflowerStemMesh.name = 'meadow-wildflower-stems';
  wildflowerStemMesh.count = wildflowerSpawnsList.length;
  wildflowerStemMesh.frustumCulled = false;
  scene.add(wildflowerStemMesh);

  const _wfMatrix = new THREE.Matrix4();
  const _wfStemMatrix = new THREE.Matrix4();
  const _wfPos = new THREE.Vector3();
  const _wfStemPos = new THREE.Vector3();
  const _wfScale = new THREE.Vector3();
  const _wfStemScale = new THREE.Vector3();
  const _wfQuat = new THREE.Quaternion();
  const _wfEuler = new THREE.Euler();
  const _wfTip = new THREE.Vector3();
  const _wfColor = new THREE.Color();
  for (let i = 0; i < wildflowerSpawnsList.length; i += 1) {
    _wfColor.setHex(wildflowerSpawnsList[i].tint);
    wildflowerMesh.setColorAt(i, _wfColor);
  }
  if (wildflowerMesh.instanceColor) wildflowerMesh.instanceColor.needsUpdate = true;

  function placeWildflowers(time) {
    for (let i = 0; i < wildflowerSpawnsList.length; i += 1) {
      const spawn = wildflowerSpawnsList[i];
      const { lean, tilt } = wildflowerSway(spawn, time);
      _wfEuler.set(tilt, 0, lean, 'XYZ');
      _wfQuat.setFromEuler(_wfEuler);
      // The bloom rides the stem's tip, not its own authored height: the stem is
      // rotated about its foot, so a bloom left at (x, height, z) would float
      // free of a leaning stalk. Rotating the tip vector the same way and adding
      // it to the foot keeps the flower on the flower.
      _wfTip.set(0, spawn.height, 0).applyQuaternion(_wfQuat);
      _wfPos.set(spawn.x + _wfTip.x, _wfTip.y, spawn.z + _wfTip.z);
      _wfScale.setScalar(spawn.size);
      _wfMatrix.compose(_wfPos, _wfQuat, _wfScale);
      wildflowerMesh.setMatrixAt(i, _wfMatrix);
      // The stem geometry was translated so its foot sits at the origin, so
      // scaling it by `height` grows it upward from the ground and the shared
      // quaternion bends it about its foot rather than about its middle.
      _wfStemPos.set(spawn.x, 0, spawn.z);
      _wfStemScale.set(spawn.size, spawn.height, spawn.size);
      _wfStemMatrix.compose(_wfStemPos, _wfQuat, _wfStemScale);
      wildflowerStemMesh.setMatrixAt(i, _wfStemMatrix);
    }
    wildflowerMesh.instanceMatrix.needsUpdate = true;
    wildflowerStemMesh.instanceMatrix.needsUpdate = true;
  }
  placeWildflowers(0);

  // Same tier-as-parameter pattern as paintRipples: the build-time call runs
  // before the environment handle exists.
  function paintWildflowers(phaseId, tier = environment.quality) {
    const glow = wildflowerGlowLevel(phaseId);
    wildflowerMaterial.color.setScalar(glow);
    wildflowerStemMaterial.color.setHex(0x4c6a32).multiplyScalar(glow);
    const on = wildflowerSpawnsList.length > 0 && wildflowersEnabled(tier);
    wildflowerMesh.visible = on;
    wildflowerStemMesh.visible = on;
  }
  paintWildflowers('day', 'full');

  let wildflowerTime = 0;
  function updateWildflowers(dt) {
    if (!wildflowersEnabled(environment.quality)) return;
    if (!wildflowerSpawnsList.length) return;
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    wildflowerTime += step;
    if (!wildflowerMesh.visible) return;
    placeWildflowers(wildflowerTime);
  }

  // --- Reeds -------------------------------------------------------------
  const reedSpawnsList = reedsEnabled('full')
    ? reedSpawns({ count: REED_COUNT, circles: meadowKeepOutCircles })
    : [];
  // One instance per stem, not per clump, so each stem can carry its own sway.
  const reedStemTotal = reedSpawnsList.reduce((sum, clump) => sum + clump.stems, 0);
  // 4 cm wide rather than a botanically truer 2 cm: at the far end of the meadow
  // a 2 cm quad is well under a pixel and the software rasteriser resolves it as
  // a broken line of speckles. Four centimetres keeps the stem a continuous
  // stroke at every distance the player sees it from.
  const reedStemGeometry = crossQuadGeometry(0.04, 1);
  reedStemGeometry.translate(0, 0.5, 0);
  const reedHeadGeometry = new THREE.BoxGeometry(0.07, 0.18, 0.07);
  const reedMaterial = new THREE.MeshStandardMaterial({
    // FrontSide for the same reason as the wildflowers: the cross-quad geometry
    // emits both windings, so DoubleSide would only flip the up normal on back
    // faces and turn half of every stem toward the ground.
    color: 0xffffff, roughness: 0.9, metalness: 0, side: THREE.FrontSide
  });
  reedMaterial.name = 'ReedStem';
  const reedHeadMaterial = new THREE.MeshStandardMaterial({
    // A cattail head is a dark brown spike, but a genuinely dark brown (0x4a3a22)
    // renders near-black once it is multiplied by the phase glow and lit from
    // behind, which reads as a hole punched in the meadow rather than a plant.
    // This warmer brown plus a small self-lit term keeps the head legible as
    // brown at every angle, which is what the silhouette needs it to be.
    color: 0x7a5c34, emissive: 0x2a1d0d, emissiveIntensity: 0.6,
    roughness: 0.95, metalness: 0
  });
  reedHeadMaterial.name = 'ReedHead';
  const reedMesh = new THREE.InstancedMesh(
    reedStemGeometry, reedMaterial, Math.max(1, reedStemTotal)
  );
  reedMesh.name = 'meadow-reeds';
  reedMesh.count = reedStemTotal;
  reedMesh.frustumCulled = false;
  scene.add(reedMesh);
  const reedHeadMesh = new THREE.InstancedMesh(
    reedHeadGeometry, reedHeadMaterial, Math.max(1, reedStemTotal)
  );
  reedHeadMesh.name = 'meadow-reed-heads';
  reedHeadMesh.count = reedStemTotal;
  reedHeadMesh.frustumCulled = false;
  scene.add(reedHeadMesh);

  // Flatten the clumps into one list of stems, each remembering its clump and
  // its index within it, so the sway pass is a single loop.
  const reedStems = [];
  for (const clump of reedSpawnsList) {
    for (let s = 0; s < clump.stems; s += 1) {
      // Stems fan out around the clump centre on a small circle, so a clump
      // reads as one plant with several shoots rather than a single line.
      const fan = (s / clump.stems) * Math.PI * 2;
      reedStems.push({
        clump,
        stem: s,
        x: clump.x + Math.cos(fan) * 0.13,
        z: clump.z + Math.sin(fan) * 0.13,
        yaw: fan
      });
    }
  }
  const _rdMatrix = new THREE.Matrix4();
  const _rdPos = new THREE.Vector3();
  const _rdScale = new THREE.Vector3();
  const _rdQuat = new THREE.Quaternion();
  const _rdYaw = new THREE.Quaternion();
  const _rdLean = new THREE.Quaternion();
  const _rdTip = new THREE.Vector3();
  const _rdUp = new THREE.Vector3(0, 1, 0);
  const _rdAxis = new THREE.Vector3(1, 0, 0);
  const _rdColor = new THREE.Color();
  for (let i = 0; i < reedStems.length; i += 1) {
    _rdColor.setHex(reedStems[i].clump.tint);
    reedMesh.setColorAt(i, _rdColor);
  }
  if (reedMesh.instanceColor) reedMesh.instanceColor.needsUpdate = true;

  function placeReeds(time) {
    for (let i = 0; i < reedStems.length; i += 1) {
      const stem = reedStems[i];
      const clump = stem.clump;
      const { lean } = reedStemSway(clump, stem.stem, time);
      // The clump's own fixed lean plus the wind's sway, both about the same
      // world-horizontal axis, so the whole bed bends with the gust.
      _rdLean.setFromAxisAngle(_rdAxis, clump.lean + lean);
      _rdYaw.setFromAxisAngle(_rdUp, stem.yaw);
      _rdQuat.copy(_rdLean).multiply(_rdYaw);
      _rdPos.set(stem.x, 0, stem.z);
      _rdScale.set(clump.size, clump.height, clump.size);
      _rdMatrix.compose(_rdPos, _rdQuat, _rdScale);
      reedMesh.setMatrixAt(i, _rdMatrix);
      // The head rides the tip of its stem: the same rotation applied to a
      // point one stem-height up, added to the stem's foot.
      _rdTip.set(0, clump.height, 0).applyQuaternion(_rdQuat);
      _rdPos.set(stem.x + _rdTip.x, _rdTip.y, stem.z + _rdTip.z);
      _rdScale.setScalar(clump.size);
      _rdMatrix.compose(_rdPos, _rdQuat, _rdScale);
      reedHeadMesh.setMatrixAt(i, _rdMatrix);
    }
    reedMesh.instanceMatrix.needsUpdate = true;
    reedHeadMesh.instanceMatrix.needsUpdate = true;
  }
  placeReeds(0);

  function paintReeds(phaseId, tier = environment.quality) {
    const glow = reedGlowLevel(phaseId);
    reedMaterial.color.setScalar(glow);
    reedHeadMaterial.color.setHex(0x7a5c34).multiplyScalar(glow);
    const on = reedStems.length > 0 && reedsEnabled(tier);
    reedMesh.visible = on;
    reedHeadMesh.visible = on;
  }
  paintReeds('day', 'full');

  let reedTime = 0;
  function updateReeds(dt) {
    if (!reedsEnabled(environment.quality)) return;
    if (!reedStems.length) return;
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    reedTime += step;
    if (!reedMesh.visible) return;
    placeReeds(reedTime);
  }

  // --- Courtyard moss ----------------------------------------------------
  //
  // The moss belongs on stone, and the only stone the player walks is the paved
  // plaza disc. The pure sampler scatters in a square, so it is asked for enough
  // patches to survive the disc filter and the world keeps only the ones whose
  // whole footprint falls inside the disc -- the disc edge is a curve the
  // module's straight wall segments cannot express, so the filter is the honest
  // place to draw it. A disc of radius 8.6 inside the module's 16.7 m half-square
  // keeps about a fifth of the candidates, so the request is five times the
  // module's authored count to land near forty patches on the paving. The
  // fountain and the four lamp posts are keep-outs. The request is the module's
  // own ceiling (160), because anything larger clamps anyway; about thirty
  // patches survive the disc, which is one per eight square metres of paving and
  // reads as damp neglect rather than a lawn.
  const MOSS_PLAZA_RADIUS = 8.6;
  const MOSS_PLAZA_COUNT = 160;
  const mossKeepOuts = [
    { x: FOUNTAIN_SPOT.x, z: FOUNTAIN_SPOT.z, radius: FOUNTAIN_COLLIDER },
    ...[[7, 7], [-7, 7], [7, -7], [-7, -7]].map(([x, z]) => ({ x, z, radius: 0.5 }))
  ];
  const mossSpawnsList = mossEnabled('full')
    ? mossSpawns({ count: MOSS_PLAZA_COUNT, circles: mossKeepOuts })
      .filter((patch) => Math.hypot(patch.x, patch.z) + patch.radius <= MOSS_PLAZA_RADIUS)
    : [];
  // A ten-sided disc is enough: a moss patch has no readable silhouette, and the
  // low polygon count keeps the software rasteriser's fill cost down.
  const mossGeometry = new THREE.CircleGeometry(0.5, 10);
  const mossMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, metalness: 0, transparent: true, opacity: 0.85,
    side: THREE.DoubleSide, depthWrite: false, fog: true
  });
  mossMaterial.name = 'CourtyardMoss';
  const mossMesh = new THREE.InstancedMesh(
    mossGeometry, mossMaterial, Math.max(1, mossSpawnsList.length)
  );
  mossMesh.name = 'courtyard-moss';
  mossMesh.count = mossSpawnsList.length;
  mossMesh.frustumCulled = false;
  // Above the plaza surface (y 0.01) but below the puddles, so a puddle still
  // reads as sitting on top of the moss rather than being cut by it.
  mossMesh.renderOrder = 1;
  scene.add(mossMesh);

  const _msMatrix = new THREE.Matrix4();
  const _msPos = new THREE.Vector3();
  const _msScale = new THREE.Vector3();
  const _msQuat = new THREE.Quaternion();
  const _msSpin = new THREE.Quaternion();
  const _msFlat = new THREE.Quaternion();
  const _msNormal = new THREE.Vector3(0, 0, 1);
  _msFlat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  const _msColor = new THREE.Color();
  for (let i = 0; i < mossSpawnsList.length; i += 1) {
    const patch = mossSpawnsList[i];
    _msColor.setHex(patch.tint);
    mossMesh.setColorAt(i, _msColor);
    _msPos.set(patch.x, 0.014, patch.z);
    // A seam strip is long and thin along its own axis; a round patch is a
    // squashed disc. Both are the same unit circle scaled differently, so the
    // renderer branches once, here, and not per frame. The units differ: a
    // round patch's `radius` is a half-extent (so the scale doubles it), while a
    // seam's `length` and MOSS_SEAM_WIDTH are full dimensions (so the scale is
    // those numbers as they stand, since the geometry's radius is 0.5).
    if (patch.seam) {
      _msScale.set(patch.length, MOSS_SEAM_WIDTH, 1);
    } else {
      _msScale.set(patch.radius * patch.stretch * 2, patch.radius * 2, 1);
    }
    // Spin about the circle's own normal (local Z) first, then lay it flat.
    // The spin is negated because the module measures the angle from +x toward
    // +z, while a rotation about the local normal carries +x toward -z.
    _msSpin.setFromAxisAngle(_msNormal, -patch.angle);
    _msQuat.copy(_msFlat).multiply(_msSpin);
    _msMatrix.compose(_msPos, _msQuat, _msScale);
    mossMesh.setMatrixAt(i, _msMatrix);
  }
  mossMesh.instanceMatrix.needsUpdate = true;
  if (mossMesh.instanceColor) mossMesh.instanceColor.needsUpdate = true;

  // Moss does not sway: it is a stain on the stone, not a plant in the wind.
  function paintMoss(phaseId, tier = environment.quality) {
    const dark = mossDarkness(phaseId);
    const glow = mossGlowLevel(phaseId);
    mossMaterial.color.setScalar(glow);
    // The darkness reading is a colour multiplier, so it is folded into the
    // material tint rather than the per-instance colour: one write per phase.
    mossMaterial.color.multiplyScalar(1 - dark * 0.45);
    mossMesh.visible = mossSpawnsList.length > 0 && mossEnabled(tier);
  }
  paintMoss('day', 'full');

  // --- Contact shadow decals -------------------------------------------
  //
  // The sun's shadow map resolves a prop's cast shadow down to its own texel
  // size, and the last hand's width around a barrel's foot or a lamp post's
  // base is exactly where that resolution runs out: the prop meets the paving
  // with a bright, hard seam and reads as pasted on. A soft dark smudge under
  // every footprint is the cheapest fix -- one InstancedMesh of flat discs, no
  // lights, no extra passes -- and it is the strongest grounding cue available
  // for that price.
  //
  // The anchors are the props that actually touch the ground, read from the same
  // tables the world built them from (the lamp loop, the barrel cylinders, the
  // crate stand-ins, the bench, the job and notice boards) so a prop that moves
  // takes its smudge with it. The lane's bunting and the hanging lanterns are
  // deliberately absent: they hang overhead and touch nothing. The sacks are
  // included -- they are soft props sitting on the flagstones and they are the
  // worst offenders for the pasted-on look.
  const contactAnchors = [
    { x: FOUNTAIN_SPOT.x, z: FOUNTAIN_SPOT.z, radius: FOUNTAIN_COLLIDER },
    ...[[7, 7], [-7, 7], [7, -7], [-7, -7]].map(([x, z]) => ({ x, z, radius: 0.22 })),
    ...TREE_SPOTS.map((spot) => ({ x: spot.x, z: spot.z, radius: TREE_MODEL_SIZE.trunkRadius * 1.6 })),
    { x: -10.5, z: -9, radius: 4.5 },
    { x: 11, z: -3, radius: 2.2 },
    { x: -11, z: 6, radius: 1.8 },
    { x: 5, z: 8, radius: 0.85 },
    { x: 6.4, z: 8.3, radius: 0.85 },
    { x: -5, z: 9, radius: 0.55 },
    { x: -6.2, z: 9.4, radius: 0.55 },
    { x: 3, z: -7.5, radius: 0.55 },
    { x: BENCH.x, z: BENCH.z, radius: 1.2 },
    { x: JOB_BOARD.x, z: JOB_BOARD.z, radius: 0.8 },
    { x: NOTICE_BOARD.x, z: NOTICE_BOARD.z, radius: 0.9 },
    ...LANE_PROPS.map((prop) => ({
      x: prop.x,
      z: prop.z,
      radius: Math.max(prop.width, prop.depth) * 0.65
    })),
    ...LANE_SACKS.map((sack) => ({ x: sack.x, z: sack.z, radius: sack.radius * 1.6 })),
    { x: 0, z: (TERRACE.minZ + TERRACE.maxZ) / 2, radius: 1.7 }
  ];
  const contactSpawnsList = shadowsEnabled('full')
    ? shadowDecals(contactAnchors)
    : [];

  // A soft round falloff, generated once on a canvas, so a decal has no visible
  // rim. The same helper shape as the smoke puff and the plaza AO map; a null
  // canvas (no DOM) leaves the decals with hard edges rather than throwing.
  function createContactShadowTexture(size = 64) {
    if (typeof document === 'undefined' || !document.createElement) return null;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.45)');
    g.addColorStop(0.85, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    // The map is an alpha falloff, not albedo, so it is deliberately left in the
    // default (linear) colour space: tagging it sRGB would bend the gradient.
    texture.needsUpdate = true;
    return texture;
  }

  // A twelve-sided disc is enough for a soft smudge with no readable silhouette,
  // and the low polygon count keeps the software rasteriser's fill cost down.
  const contactGeometry = new THREE.CircleGeometry(0.5, 12);
  const contactMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    map: createContactShadowTexture(),
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    fog: true
  });
  contactMaterial.name = 'ContactShadow';
  const contactMesh = new THREE.InstancedMesh(
    contactGeometry, contactMaterial, Math.max(1, contactSpawnsList.length)
  );
  contactMesh.name = 'contact-shadows';
  contactMesh.count = contactSpawnsList.length;
  contactMesh.frustumCulled = false;
  // Above the plaza surface and the moss (y 0.01/0.014) but below the puddles and
  // the ripple decals, so a puddle still reads as sitting on top of the ground.
  contactMesh.renderOrder = 1;
  scene.add(contactMesh);

  const _csMatrix = new THREE.Matrix4();
  const _csPos = new THREE.Vector3();
  const _csScale = new THREE.Vector3();
  const _csQuat = new THREE.Quaternion();
  const _csFlat = new THREE.Quaternion();
  const _csNormal = new THREE.Vector3(0, 0, 1);
  const _csYaw = new THREE.Quaternion();
  const _csUp = new THREE.Vector3(0, 1, 0);
  _csFlat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  for (let i = 0; i < contactSpawnsList.length; i += 1) {
    const decal = contactSpawnsList[i];
    // The squash is applied to the disc's local Y (which the flat rotation maps
    // onto world Z), so the ellipse is free to point anywhere; the yaw is a
    // stable per-decal choice derived from the position, not from the frame.
    _csYaw.setFromAxisAngle(_csUp, (decal.x * 0.7 + decal.z * 1.3) % (Math.PI * 2));
    _csQuat.copy(_csFlat).multiply(_csYaw);
    _csPos.set(decal.x, 0.012, decal.z);
    _csScale.set(decal.radius * 2, decal.radius * 2 * decal.squash, 1);
    _csMatrix.compose(_csPos, _csQuat, _csScale);
    contactMesh.setMatrixAt(i, _csMatrix);
  }
  contactMesh.instanceMatrix.needsUpdate = true;

  // Contact decals do not move: the ground under a prop does not change with the
  // hour. Only their strength follows the phase.
  function paintContactShadows(phaseId, tier = environment.quality) {
    contactMaterial.opacity = shadowOpacity(phaseId);
    contactMesh.visible = contactSpawnsList.length > 0 && shadowsEnabled(tier);
  }
  paintContactShadows('day', 'full');

  // --- Roof shingles ---------------------------------------------------
  // The shingle field dresses the MODELLED roofs, not the procedural slabs the
  // stand-ins use: upgradeHouse() and upgradeMarketStalls() hide those slabs
  // once the GLBs load, so courses laid on them would float through the real
  // roof (measured: 44 of 150 strips up to 0.543 m above the gable). These four
  // planes were measured from assets/house.glb and assets/market_stall.glb --
  // the house is a gable with its ridge along X at z = -9, each stall a
  // mono-pitch awning whose high edge is at the back. `y` is the TOP face's
  // centre height, so a strip lifted SHINGLE_LIFT lands on the roof surface,
  // and `depth` is the slope's horizontal run (the modelled slope length is
  // sqrt(depth^2 + (pitch*depth)^2)). The back slope needs yaw = PI so its eave
  // maps to the module's far edge at v = +depth/2, the edge a positive pitch
  // tips down; with yaw 0 its eave would land at the ridge.
  const roofPlanes = [
    { x: -10.5, z: -7.467059, y: 3.861765, width: 8, depth: 3.132353, yaw: 0, pitch: 0.533333 },
    { x: -10.5, z: -10.532941, y: 3.861765, width: 8, depth: 3.132353, yaw: Math.PI, pitch: 0.533333 },
    { x: 11, z: -3.1, y: 0.94, width: 4.3, depth: 1, yaw: 0, pitch: 0.2 },
    { x: -11, z: 5.925, y: 0.846, width: 3.225, depth: 0.75, yaw: 0, pitch: 0.24 }
  ];
  const shingleSpawnsList = shinglesEnabled('full')
    ? shingleSpawns({ planes: roofPlanes })
    : [];
  const shingleGeometry = new THREE.BoxGeometry(1, 0.012, 1);
  const shingleMaterial = new THREE.MeshStandardMaterial({
    color: 0x6d3a2c, roughness: 0.85, metalness: 0, fog: true
  });
  shingleMaterial.name = 'RoofShingle';
  const shingleMesh = new THREE.InstancedMesh(
    shingleGeometry, shingleMaterial, Math.max(1, shingleSpawnsList.length)
  );
  shingleMesh.name = 'roof-shingles';
  shingleMesh.count = shingleSpawnsList.length;
  shingleMesh.frustumCulled = false;
  scene.add(shingleMesh);

  const _shMatrix = new THREE.Matrix4();
  const _shPos = new THREE.Vector3();
  const _shScale = new THREE.Vector3();
  const _shQuat = new THREE.Quaternion();
  const _shYawQuat = new THREE.Quaternion();
  const _shTiltQuat = new THREE.Quaternion();
  const _shUp = new THREE.Vector3(0, 1, 0);
  const _shXAxis = new THREE.Vector3(1, 0, 0);

  // Per-instance tone via instance colour.
  const _shColor = new THREE.Color();
  for (let i = 0; i < shingleSpawnsList.length; i += 1) {
    _shColor.setHex(0x6d3a2c);
    _shColor.multiplyScalar(shingleSpawnsList[i].tone);
    shingleMesh.setColorAt(i, _shColor);
  }
  if (shingleMesh.instanceColor) shingleMesh.instanceColor.needsUpdate = true;

  function placeShingles() {
    for (let i = 0; i < shingleSpawnsList.length; i += 1) {
      const sp = shingleSpawnsList[i];
      _shPos.set(sp.x, sp.y, sp.z);
      // Yaw the strip along its course, then tilt it about its own cross-course
      // axis so it lies flush with the slope. A rotation about local +X by
      // atan(pitch) sends local +Z (the strip's far edge, i.e. the eave side)
      // downward by sin of that angle -- the same direction a positive pitch
      // means -- and leaves its centre where shingles.js put it, on the
      // surface. Yaw is applied first (rightmost), so the tilt axis stays the
      // strip's own long axis whatever the plane's yaw.
      _shYawQuat.setFromAxisAngle(_shUp, sp.yaw);
      _shTiltQuat.setFromAxisAngle(_shXAxis, Math.atan(sp.pitch || 0));
      _shQuat.copy(_shYawQuat).multiply(_shTiltQuat);
      _shScale.set(sp.width, 1, sp.depth);
      _shMatrix.compose(_shPos, _shQuat, _shScale);
      shingleMesh.setMatrixAt(i, _shMatrix);
    }
    shingleMesh.instanceMatrix.needsUpdate = true;
  }
  placeShingles();

  // Same tier-as-parameter pattern as paintRipples: the build-time call comes
  // before the environment handle is initialised.
  function paintShingles(phaseId, tier = environment.quality) {
    const glow = shingleGlowLevel(phaseId);
    shingleMaterial.color.setHex(0x6d3a2c);
    shingleMaterial.color.multiplyScalar(glow);
    shingleMesh.visible = shingleSpawnsList.length > 0 && shinglesEnabled(tier);
  }
  paintShingles('day', 'full');

  // --- Roof edge trim ---------------------------------------------------
  // The shingles climb a real slope and end on a real eave, but the modelled
  // roof's own edge is a thin line: from the ground the courses read as strips
  // stopping in mid-air. src/roofedge.js decides where a fascia, a drip apron
  // and the gable bargeboards sit on each of the four roof planes; this block
  // turns them into two instanced boxes -- one for the wooden boards (fascia
  // and barge share a section and a material) and one for the lead drip -- so
  // the whole roofline costs two draw calls and the low tier drops it with one
  // visibility flag. Per-instance scale gives each board its own length, so the
  // geometry is a single unit box and the boards still vary from 1 m to 8 m.
  //
  // The boards carry a flat stained-wood / lead colour rather than a texture
  // family. They are 4-17 cm wide strips viewed at courtyard distance, so a
  // per-board UV would stretch one tile down an 8 m fascia and read as a smear;
  // the shadow the boards cast under the eave is what sells them, and the
  // colour only has to sit in the roof's palette.
  const roofEdgeSpawnsList = roofEdgeEnabled('full')
    ? roofEdgeSpans({ planes: roofPlanes })
    : [];
  const roofEdgeGroup = new THREE.Group();
  roofEdgeGroup.name = 'roof-edge-trim';
  const roofEdgeWood = roofEdgeSpawnsList.filter((span) => span.kind !== 'drip');
  const roofEdgeDrips = roofEdgeSpawnsList.filter((span) => span.kind === 'drip');
  const roofEdgeWoodMat = new THREE.MeshStandardMaterial({
    color: 0x4a3524, roughness: 0.78, metalness: 0
  });
  roofEdgeWoodMat.name = 'RoofEdgeWood';
  const roofEdgeDripMat = new THREE.MeshStandardMaterial({
    color: 0x585a56, roughness: 0.5, metalness: 0.3
  });
  roofEdgeDripMat.name = 'RoofEdgeDrip';
  const roofEdgeGeometry = new THREE.BoxGeometry(1, 1, 1);
  const roofEdgeBoardsMesh = new THREE.InstancedMesh(
    roofEdgeGeometry, roofEdgeWoodMat, Math.max(1, roofEdgeWood.length)
  );
  roofEdgeBoardsMesh.name = 'roof-edge-boards';
  roofEdgeBoardsMesh.count = roofEdgeWood.length;
  roofEdgeBoardsMesh.frustumCulled = false;
  const roofEdgeDripsMesh = new THREE.InstancedMesh(
    roofEdgeGeometry, roofEdgeDripMat, Math.max(1, roofEdgeDrips.length)
  );
  roofEdgeDripsMesh.name = 'roof-edge-drips';
  roofEdgeDripsMesh.count = roofEdgeDrips.length;
  roofEdgeDripsMesh.frustumCulled = false;
  roofEdgeGroup.add(roofEdgeBoardsMesh, roofEdgeDripsMesh);
  scene.add(roofEdgeGroup);

  // The same yaw-then-tilt composition the shingle strips use: yaw about world
  // Y, then tilt about the box's own local X. A fascia has tilt 0 and runs
  // level; a bargeboard has tilt atan(pitch) so its local Z climbs the rake and
  // its local Y is the roof's normal.
  const _reMatrix = new THREE.Matrix4();
  const _rePos = new THREE.Vector3();
  const _reScale = new THREE.Vector3();
  const _reQuat = new THREE.Quaternion();
  const _reYawQuat = new THREE.Quaternion();
  const _reTiltQuat = new THREE.Quaternion();
  const _reUp = new THREE.Vector3(0, 1, 0);
  const _reXAxis = new THREE.Vector3(1, 0, 0);

  function placeRoofEdge(mesh, spans) {
    for (let i = 0; i < spans.length; i += 1) {
      const span = spans[i];
      _rePos.set(span.x, span.y, span.z);
      _reYawQuat.setFromAxisAngle(_reUp, span.yaw);
      _reTiltQuat.setFromAxisAngle(_reXAxis, span.tilt || 0);
      _reQuat.copy(_reYawQuat).multiply(_reTiltQuat);
      _reScale.set(span.size[0], span.size[1], span.size[2]);
      _reMatrix.compose(_rePos, _reQuat, _reScale);
      mesh.setMatrixAt(i, _reMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  placeRoofEdge(roofEdgeBoardsMesh, roofEdgeWood);
  placeRoofEdge(roofEdgeDripsMesh, roofEdgeDrips);

  function paintRoofEdge(tier = environment.quality) {
    const on = roofEdgeSpawnsList.length > 0 && roofEdgeEnabled(tier);
    roofEdgeGroup.visible = on;
  }
  paintRoofEdge('full');

  function paintWallsTrim(tier = environment.quality) {
    wallTrimGroup.visible = wallTrimEnabled(tier);
  }
  paintWallsTrim('full');

  // The per-instance scratch objects for the sway pass, allocated once so the
  // frame loop does no allocation.
  const swayMatrix = new THREE.Matrix4();
  const swayQuaternion = new THREE.Quaternion();
  const swayPosition = new THREE.Vector3();
  const swayScale = new THREE.Vector3();
  const swayYaw = new THREE.Quaternion();
  const swayLean = new THREE.Quaternion();
  const swayUp = new THREE.Vector3(0, 1, 0);
  let meadowSwayEnabled = true;

  /**
   * One frame of wind through the meadow. Every instance leans about the shared
   * lean axis by its own phase-shifted sway, so a gust crosses the ring as a
   * wave rather than landing everywhere at once.
   *
   * The lean is composed *after* the instance's own yaw, so the rotation axis
   * stays world-horizontal: leaning in the tuft's local frame would tip each
   * clump in a different direction, which is the opposite of one wind field.
   * Allocation-free; skipped entirely on the low tier and when no tuft exists.
   */
  function updateMeadow(dt) {
    if (!meadowSwayEnabled) return;
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    if (step === 0) return;
    meadowWindTime += step;
    for (const { mesh, instances } of meadowVariants) {
      if (!instances.length) continue;
      for (let i = 0; i < instances.length; i += 1) {
        const instance = instances[i];
        const sway = windSway(meadowWindTime, instance.phase);
        const lean = tuftLeanAngle(sway);
        swayYaw.setFromAxisAngle(swayUp, instance.rotation);
        swayLean.setFromAxisAngle(meadowLeanAxis, lean);
        // yaw * lean: the clump turns to its own heading, then the whole thing
        // tips about the world-horizontal lean axis.
        swayQuaternion.copy(swayLean).multiply(swayYaw);
        swayPosition.set(instance.x, 0, instance.z);
        swayScale.setScalar(instance.scale);
        swayMatrix.compose(swayPosition, swayQuaternion, swayScale);
        mesh.setMatrixAt(i, swayMatrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  let flutterTime = 0;
  // Authored base rotations, captured lazily on first frame so the flutter pass
  // never clobbers the authored hang of a flag or the banner.
  const flutterBase = new Map();
  function updateFlutter(dt) {
    if (!flutterEnabled(environment.quality)) return;
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    flutterTime += step;
    const phaseId = (environment.phase === 'night' || environment.phase === 'dusk' || environment.phase === 'day')
      ? environment.phase : 'day';
    const phaseAmount = flutterAmount(phaseId);
    const wind = windStrength(flutterTime, 0);
    const amount = phaseAmount * wind;
    const targets = buntingFlutter.concat(bannerFlutter || []);
    for (let i = 0; i < targets.length; i += 1) {
      const target = targets[i];
      const m = target.mesh;
      if (!m) continue;
      if (!flutterBase.has(m)) {
        flutterBase.set(m, { x: m.rotation.x, y: m.rotation.y, z: m.rotation.z });
      }
      const base = flutterBase.get(m);
      const motion = flutterMotion(flutterTime, target.phase, amount);
      m.rotation.x = base.x;
      m.rotation.y = base.y + motion.yaw;
      m.rotation.z = base.z + motion.roll;
    }
  }

  /** Paints the meadow for a phase. The baked colours are daylight; the phase
   *  tint is a material colour multiplier, so a phase change is one write. */
  function paintMeadow(phaseId) {
    meadowPhaseTint.setHex(tuftPhaseTint(phaseId));
    meadowMaterial.color.copy(meadowPhaseTint);
  }
  paintMeadow('day');

  const environment = {
    scene,
    quality: 'full',
    paintSky,
    paintSun,
    paintMoon,
    paintClouds,
    paintHorizon,
    horizonRidge,
    sunDisc,
    starField,
    moonDisc,
    cloudGroup,
    cloudMeshes,
    // Round 85: the field breathes. One cheap per-frame call nudges the whole
    // material's size with the pure twinkle maths from src/stars.js; the
    // per-phase opacity stays with applyPhase().
    updateStars(dt) {
      starTime += dt;
      starField.material.size = 0.9 * starTwinkle(0, starTime);
    },
    updateClouds(dt) {
      cloudTime += dt;
      for (let i = 0; i < cloudMeshes.length; i += 1) {
        const m = cloudMeshes[i];
        const d = cloudDrift(i, cloudTime);
        // rotate around Y axis by drift
        m.rotation.y = d;
      }
      // Round 89: the same clock drives the ground dapple, so the dimming and
      // the drift cannot disagree about how much time has passed.
      applyCloudDapple();
    },
    // The palette for a phase, so the camera pipeline can derive its ambient
    // room from the same numbers the sky dome is painted with.
    phaseLook,
    hemi,
    sun,
    fill,
    moon,
    // Round 89: cloud dapple. The frame loop calls this once per frame so the
    // sun dims and recovers smoothly with the drifting layer; the value is a
    // fraction of the phase's authored sun, never a standing number.
    updateCloudDapple() {
      return applyCloudDapple();
    },
    setSunBase(value) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        sunBaseIntensity = value;
      }
    },
    get cloudDim() {
      return cloudDim;
    },
    // Round 98: the near passer clouds. `passerGroup` holds the sky discs and
    // `passerShadowMesh` the ground footprints, both findable by name;
    // `paintPassers` is called from applyPhase and setQuality; `updatePassers`
    // is the per-frame drift, skipped entirely when the layer is off.
    passerGroup,
    passerShadowMesh,
    paintPassers(phaseId, tier) {
      return paintPassers(phaseId, tier);
    },
    updatePassers(dt) {
      return updatePassers(dt);
    },
    // Round 90: the meadow. `meadow` is the group of four variant InstancedMeshes
    // so a browser check can count them and their instances; `paintMeadow` is
    // called from applyPhase; `updateMeadow` is the per-frame wind sway.
    meadow: meadowGroup,
    meadowVariants,
    meadowScatter,
    paintMeadow,
    updateMeadow(dt) {
      updateMeadow(dt);
    },
    setMeadowSway(enabled) {
      meadowSwayEnabled = Boolean(enabled);
      return meadowSwayEnabled;
    },
    get meadowSway() {
      return meadowSwayEnabled;
    },
    // Round 91: the firefly field. `fireflies` is the InstancedMesh so a browser
    // check can count it by name; `paintFireflies` is called from applyPhase;
    // `updateFireflies` is the per-frame drift + blink.
    fireflies: fireflyMesh,
    fireflyCount: fireflyInstances.length,
    paintFireflies(phaseId) {
      paintFireflies(phaseId);
    },
    updateFireflies(dt) {
      updateFireflies(dt);
    },
    // Round 91: cloth flutter on the bunting and the banner. `flutterTime` is the
    // running clock; `updateFlutter` is the per-frame pass; `flutterOn` reports
    // whether the tier animates cloth at all.
    updateFlutter(dt) {
      updateFlutter(dt);
    },
    get flutterOn() {
      return flutterEnabled(environment.quality);
    },
    // Round 92: the daytime bird flock. Two InstancedMeshes (one per wing) so a
    // browser check can count the flock by name; `paintBirds` is called from
    // applyPhase; `updateBirds` is the per-frame orbit + flap.
    birdWings: [birdLeftMesh, birdRightMesh],
    birdCount: birdSpawnsList.length,
    paintBirds(phaseId) {
      paintBirds(phaseId);
    },
    updateBirds(dt) {
      updateBirds(dt);
    },
    get birdsOn() {
      return birdsEnabled(environment.quality);
    },
    // Round 92: the chimney smoke. `smoke` is the InstancedMesh, `smokeCount` is
    // the number of puffs, `smokeSites` records where the plumes are based so a
    // check can hold the columns to the roofs. `paintSmoke` is called from
    // applyPhase; `updateSmoke` is the per-frame climb.
    smoke: smokeMesh,
    smokeCount: smokeInstances.length,
    smokeSites,
    paintSmoke(phaseId) {
      paintSmoke(phaseId);
    },
    updateSmoke(dt) {
      updateSmoke(dt);
    },
    get smokeOn() {
      return chimneyEnabled(environment.quality);
    },
    // Round 93: ivy, fountain spray, ground mist.
    ivy: ivyPatches.map((entry) => entry.mesh),
    ivyCount: ivyPatches.length,
    paintIvy(phaseId) {
      paintIvy(phaseId, environment.quality);
    },
    updateIvy(dt) {
      updateIvy(dt);
    },
    get ivyOn() {
      return ivyEnabled(environment.quality);
    },
    spray: sprayMesh,
    sprayCount: spraySpawnsList.length,
    paintSpray(phaseId) {
      paintSpray(phaseId, environment.quality);
    },
    updateSpray(dt) {
      updateSpray(dt);
    },
    get sprayOn() {
      return sprayEnabled(environment.quality);
    },
    mist: mistMesh,
    mistCount: mistSpawnsList.length,
    paintMist(phaseId) {
      paintMist(phaseId, environment.quality);
    },
    updateMist(dt) {
      updateMist(dt);
    },
    get mistOn() {
      return mistEnabled(environment.quality);
    },
    // Round 94: fountain ripples.
    ripples: rippleMesh,
    rippleCount: rippleInstances.length,
    paintRipples(phaseId) {
      paintRipples(phaseId, environment.quality);
    },
    updateRipples(dt) {
      updateRipples(dt);
    },
    get ripplesOn() {
      return ripplesEnabled(environment.quality);
    },
    // Round 94: night moths around the lantern heads.
    moths: mothMesh,
    mothCount: mothSpawnsList.length,
    paintMoths(phaseId) {
      paintMoths(phaseId, environment.quality);
    },
    updateMoths(dt) {
      updateMoths(dt);
    },
    get mothsOn() {
      return mothsEnabled(environment.quality);
    },
    // Round 94: meadow puddles.
    puddles: puddleMesh,
    puddleCount: puddleSpawnsList.length,
    paintPuddles(phaseId) {
      paintPuddles(phaseId, environment.quality);
    },
    updatePuddles(dt) {
      updatePuddles(dt);
    },
    get puddlesOn() {
      return puddlesEnabled(environment.quality);
    },
    // Round 94: roof shingles.
    shingles: shingleMesh,
    shingleCount: shingleSpawnsList.length,
    paintShingles(phaseId) {
      paintShingles(phaseId, environment.quality);
    },
    // Round 104: the eave fascia, drip apron and gable bargeboards.
    roofEdge: roofEdgeGroup,
    roofEdgeBoards: roofEdgeBoardsMesh,
    roofEdgeDrips: roofEdgeDripsMesh,
    roofEdgeCount: roofEdgeSpawnsList.length,
    roofEdgeSpans: roofEdgeSpawnsList,
    paintRoofEdge() {
      paintRoofEdge(environment.quality);
    },
    get roofEdgeOn() {
      return roofEdgeEnabled(environment.quality);
    },
    paintWallsTrim() {
      paintWallsTrim(environment.quality);
    },
    get shinglesOn() {
      return shinglesEnabled(environment.quality);
    },
    // Round 95: meadow wildflowers, reeds and courtyard moss.
    wildflowers: wildflowerMesh,
    wildflowerStems: wildflowerStemMesh,
    wildflowerCount: wildflowerSpawnsList.length,
    paintWildflowers(phaseId) {
      paintWildflowers(phaseId, environment.quality);
    },
    updateWildflowers(dt) {
      updateWildflowers(dt);
    },
    get wildflowersOn() {
      return wildflowersEnabled(environment.quality);
    },
    reeds: reedMesh,
    reedHeads: reedHeadMesh,
    reedCount: reedStems.length,
    paintReeds(phaseId) {
      paintReeds(phaseId, environment.quality);
    },
    updateReeds(dt) {
      updateReeds(dt);
    },
    get reedsOn() {
      return reedsEnabled(environment.quality);
    },
    moss: mossMesh,
    mossCount: mossSpawnsList.length,
    paintMoss(phaseId) {
      paintMoss(phaseId, environment.quality);
    },
    get mossOn() {
      return mossEnabled(environment.quality);
    },
    // Round 96: contact shadow decals under the ground props.
    contactShadows: contactMesh,
    contactCount: contactSpawnsList.length,
    paintContactShadows(phaseId) {
      paintContactShadows(phaseId, environment.quality);
    },
    get contactShadowsOn() {
      return shadowsEnabled(environment.quality);
    },
    // Round 93: the daytime butterfly field.
    butterflyWings: [butterflyLeftMesh, butterflyRightMesh],
    butterflyCount: butterflySpawnsList.length,
    paintButterflies(phaseId) {
      paintButterflies(phaseId);
    },
    updateButterflies(dt) {
      updateButterflies(dt);
    },
    get butterfliesOn() {
      return butterfliesEnabled(environment.quality);
    },
    // Round 93: the fallen-leaf scatter.
    litter: litterMeshes.map((entry) => entry.mesh),
    litterCount: litterSpawnsList.length,
    paintLitter(phaseId) {
      paintLitter(phaseId);
    },
    get litterOn() {
      return litterEnabled(environment.quality);
    },
    // Round 93: the sunlit dust motes.
    motes: moteMesh,
    moteCount: moteSpawnsList.length,
    paintMotes(phaseId) {
      paintMotes(phaseId);
    },
    updateMotes(dt) {
      updateMotes(dt);
    },
    get motesOn() {
      return motesEnabled(environment.quality);
    },
    // Round 93: the lit cottage windows.
    windows: windowMesh,
    windowCount: windowSpawnsList.length,
    paintWindows(phaseId, night) {
      paintWindows(phaseId, night, environment.quality);
    },
    updateWindows(night) {
      const next = Number.isFinite(night) ? Math.min(1, Math.max(0, night)) : 0;
      if (Math.abs(next - windowNight) < 0.01) return;
      paintWindows(environment.phase, next, environment.quality);
    },
    get windowsOn() {
      return windowsEnabled(environment.quality);
    },
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
      // Round 89: the moonlight key is a whole extra light in the shader loop,
      // so it goes with the point lights on the low tier. Its phase visibility
      // is re-derived here rather than remembered, so flipping back to full
      // restores exactly what applyPhase() would have set.
      if (environment.moon) {
        const moonLevel = moonlightIntensity(environment.phase);
        environment.moon.intensity = low ? 0 : moonLevel;
        environment.moon.visible = !low && moonLevel > 0;
      }
      // Plaza AO only multiplies indirect light; drop it on the low tier so the
      // grounding cue costs nothing when the budget is tight.
      if (plazaMaterial) {
        plazaMaterial.aoMapIntensity = low ? 0 : plazaAoMapIntensity({ low: false });
      }
      // Round 90: the meadow keeps standing on the low tier -- it is the ground's
      // silhouette, and hiding it would put the painted floor back -- but it
      // stops swaying, because the sway is a per-frame loop over ~900 instances
      // and that is exactly the cost the low tier exists to drop. A still meadow
      // still reads as grass.
      meadowSwayEnabled = !low;
      // Round 91: the firefly field drops its per-frame drift+blink on low, but
      // keeps its visibility decision in applyPhase (paintFireflies). Re-derive
      // visibility from the current phase so a tier flip never leaves a stale field.
      if (environment.paintFireflies) environment.paintFireflies(environment.phase);
      // Round 92: the bird flock and the chimney smoke are per-frame passes over
      // instanced quads, so both stop on the low tier. Like the fireflies they
      // re-derive their visibility from the current phase, so a flip can never
      // leave a frozen bird or a still column on screen. Hiding them entirely
      // rather than freezing them is deliberate: a bird stopped mid-flap in the
      // sky is far more noticeable than one that is simply not there.
      if (environment.paintBirds) {
        const birdGlow = low ? 0 : birdGlowLevel(environment.phase);
        birdMaterial.opacity = birdGlow;
        birdLeftMesh.visible = birdGlow > 0 && birdSpawnsList.length > 0;
        birdRightMesh.visible = birdLeftMesh.visible;
      }
      if (environment.paintSmoke) {
        const smokeGlow = low ? 0 : smokeGlowLevel(environment.phase);
        smokeMaterial.opacity = CHIMNEY_MAX_OPACITY * smokeGlow;
        smokeMesh.visible = smokeGlow > 0 && smokeInstances.length > 0;
      }
      // Round 93: the new dressing fields re-derive through their own paint
      // functions, each of which already consults environment.quality.
      if (environment.paintButterflies) environment.paintButterflies(environment.phase);
      if (environment.paintLitter) environment.paintLitter(environment.phase);
      if (environment.paintMotes) environment.paintMotes(environment.phase);
      if (environment.paintWindows) environment.paintWindows(environment.phase);
      if (environment.paintIvy) environment.paintIvy(environment.phase);
      if (environment.paintSpray) environment.paintSpray(environment.phase);
      if (environment.paintMist) environment.paintMist(environment.phase);
      if (environment.paintRipples) environment.paintRipples(environment.phase);
      if (environment.paintMoths) environment.paintMoths(environment.phase);
      if (environment.paintPuddles) environment.paintPuddles(environment.phase);
      if (environment.paintShingles) environment.paintShingles(environment.phase);
      if (environment.paintRoofEdge) environment.paintRoofEdge();
      if (environment.paintWallsTrim) environment.paintWallsTrim();
      if (environment.paintWildflowers) environment.paintWildflowers(environment.phase);
      if (environment.paintReeds) environment.paintReeds(environment.phase);
      if (environment.paintMoss) environment.paintMoss(environment.phase);
      if (environment.paintContactShadows) environment.paintContactShadows(environment.phase);
      // Round 98: the passers are translucent quads plus a per-frame loop,
      // both dropped on low; a tier flip must re-derive their visibility
      // rather than leave the last tier's answer standing.
      if (environment.paintPassers) environment.paintPassers(environment.phase);
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
      return Promise.all([upgradeFountain().then(() => upgradeFountainStone()), upgradeBarrels(), upgradeStalls(), upgradeLamps(), upgradeMarketStalls(), upgradeBench(), upgradeNotice(), upgradeCrates(), upgradeGateDoor(), upgradeHouse(), upgradeCobble(), upgradeGrass(), upgradeWalls(), upgradeGateStone(), upgradeWallsTrim(), upgradeTerrace(), upgradePlazaFloor(), upgradeShingles(), upgradeWoodBrick(), upgradePropMaps(), upgradeTree(), upgradeBark(), upgradeLaneLamp(), upgradeBanner(), upgradeTerraceDetail(), upgradeHouseDetail()])
        .then(() => upgradePropFamilies()).then(() => upgradeBuntingFelt()).then(() => upgradeLaneRope()).then(() => upgradeBoardPaper())
        .then(() => upgradeLanternHousing()).then(() => upgradeSackTie()).then(() => upgradeNoticeFace())
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
  if (environment.paintMoon) {
    environment.paintMoon(moonVisibility(phaseId));
  }
  if (environment.paintClouds) {
    environment.paintClouds(phaseId);
  }
  if (environment.paintHorizon) {
    environment.paintHorizon(phaseId);
  }
  if (environment.paintMeadow) {
    environment.paintMeadow(phaseId);
  }
  if (environment.paintFireflies) {
    environment.paintFireflies(phaseId);
  }
  if (environment.paintBirds) {
    environment.paintBirds(phaseId);
  }
  if (environment.paintSmoke) {
    environment.paintSmoke(phaseId);
  }
  if (environment.paintButterflies) environment.paintButterflies(phaseId);
  if (environment.paintLitter) environment.paintLitter(phaseId);
  if (environment.paintMotes) environment.paintMotes(phaseId);
  if (environment.paintWindows) environment.paintWindows(phaseId);
  if (environment.paintIvy) environment.paintIvy(phaseId);
  if (environment.paintSpray) environment.paintSpray(phaseId);
  if (environment.paintMist) environment.paintMist(phaseId);
  if (environment.paintRipples) environment.paintRipples(phaseId);
  if (environment.paintMoths) environment.paintMoths(phaseId);
  if (environment.paintPuddles) environment.paintPuddles(phaseId);
  if (environment.paintShingles) environment.paintShingles(phaseId);
  if (environment.paintRoofEdge) environment.paintRoofEdge();
  if (environment.paintWallsTrim) environment.paintWallsTrim();
  if (environment.paintWildflowers) environment.paintWildflowers(phaseId);
  if (environment.paintReeds) environment.paintReeds(phaseId);
  if (environment.paintMoss) environment.paintMoss(phaseId);
  if (environment.paintContactShadows) environment.paintContactShadows(phaseId);
  if (environment.paintPassers) environment.paintPassers(phaseId);
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
  // The dapple is a fraction of this, re-applied every frame from this base.
  if (environment.setSunBase) environment.setSunBase(look.sunIntensity);
  // Round 89: the moon is a cool key only once the sun is down. It is switched
  // off (not merely dimmed) in daylight so it costs nothing at day.
  if (environment.moon) {
    const moonLevel = moonlightIntensity(phaseId);
    environment.moon.intensity = moonLevel;
    environment.moon.visible = moonLevel > 0;
  }
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
