import { weightShift, glanceAngle } from './idle.js';
import * as THREE from 'three';
import { floorHeightAt } from './world.js';
import {
  CAST_ASSETS, projectBoxGeometry, loadCast, loadMaterialTextures,
  CLOTH_TEXTURE_FILES, SKIN_TEXTURE_FILES, HAIR_TEXTURE_FILES, FELT_TEXTURE_FILES,
  LEATHER_TEXTURE_FILES, PAPER_TEXTURE_FILES, WOOD_TEXTURE_FILES
} from './assets.js';
import {
  CAST_SKIN_FAMILIES, castSkinFamilyFor, castSkinParams, shouldDressCastSkin
} from './skin.js';
import {
  CAST_ACCENT_FAMILIES, castAccentFamilyFor, castAccentParams, shouldDressCastAccent,
  CAST_ACCENT_TILE_METERS
} from './accent.js';
export { CAST_ACCENT_TILE_METERS } from './accent.js';

import {
  CAST_BOOT_FAMILIES, castBootFamilyFor, castBootParams, shouldDressCastBoot,
  CAST_BOOT_TILE_METERS
} from './boot.js';
export { CAST_BOOT_TILE_METERS } from './boot.js';
import {
  CAST_PAPER_FAMILIES, castPaperFamilyFor, castPaperParams, shouldDressCastPaper,
  CAST_PAPER_TILE_METERS
} from './paper.js';
export { CAST_PAPER_TILE_METERS } from './paper.js';
import {
  CAST_STEEL_FAMILIES, castSteelFamilyFor, castSteelParams, shouldDressCastSteel,
  CAST_STEEL_TILE_METERS
} from './steel.js';
export { CAST_STEEL_TILE_METERS } from './steel.js';
import {
  CAST_WOOD_FAMILIES, castWoodFamilyFor, castWoodParams, shouldDressCastWood,
  CAST_WOOD_TILE_METERS
} from './woodprop.js';
export { CAST_WOOD_TILE_METERS } from './woodprop.js';

// Round 67: the metre scale the cast coats are box-projected at. It is the
// cloth PROP_FAMILY's tile (see assets.js), so a cast coat, a lane sack and any
// future cloth prop show the same weave density; the projection is what carries
// the tiling, so the texture repeat stays (1, 1).
export const CAST_CLOTH_TILE_METERS = 1.2;

/**
 * Dresses the modelled cast's `Cloth` coats with the neutral cloth maps.
 *
 * Why the cast needs its own pass: the world's prop dressing loop builds fresh
 * white materials (`color: 0xffffff`), which is exactly right for the props but
 * would erase every NPC's authored coat colour. The coat tint is the whole
 * point of the cast palette -- mara's blue coat, oswin's brown, sable's violet
 * -- so this pass keeps each mesh's own material and only attaches maps to it.
 *
 * The cloth albedo is deliberately neutral (a mid-grey weave, see
 * CLOTH_TEXTURE_FILES in assets.js), so `map x tint` reproduces the authored
 * colour and adds only the weave, the normal relief and the roughness break-up.
 *
 * The cast GLBs carry no UVs (Blender only writes TEXCOORD_0 for a mesh with a
 * UV layer), so metre-space box-projected UVs are generated here, exactly as the
 * prop pass does. Returns a small summary so a test or the HUD can tell what
 * actually happened instead of trusting a promise.
 */
export function dressCastCloth(npcs, clothTextures, {
  tileMeters = CAST_CLOTH_TILE_METERS
} = {}) {
  const dressed = [];
  let seams = 0;
  if (!clothTextures || !clothTextures.anyLoaded) {
    return { dressed: 0, meshes: dressed, seams: 0, anyLoaded: false };
  }
  for (const npc of npcs) {
    if (!npc.group) continue;
    npc.group.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const material = mesh.material;
      const name = material && material.name ? material.name : '';
      // Only the authored `Cloth` material is a coat; Skin/Hair/Accent/Boot/
      // Marker and the carried props keep their own materials untouched.
      if (!/^cloth$/i.test(name)) return;
      // A coat sleeve is a tube: its rim corners are shared by triangles whose
      // dominant normal axis flips, so the projection has to be allowed to split
      // them. Doing it per vertex instead sheared six sleeve/hem triangles.
      const split = projectBoxGeometry({ THREE, geometry: mesh.geometry, tileMeters });
      if (split.seams > 0) seams += split.seams;

      // Attach the maps to the mesh's *own* material so the authored
      // `material.color` (the per-NPC coat tint) survives as the multiplier.
      // A new white material would throw that colour away.
      for (const key of ['map', 'normalMap', 'roughnessMap']) {
        const texture = clothTextures[key];
        if (!texture) continue;
        const copy = texture.clone();
        copy.needsUpdate = true;
        copy.wrapS = THREE.RepeatWrapping;
        copy.wrapT = THREE.RepeatWrapping;
        // UVs are already in metres; one repeat keeps the authored tile size.
        copy.repeat.set(1, 1);
        material[key] = copy;
      }
      // The cloth is a matte textile; keep the coat from reading polished.
      material.roughness = 0.95;
      material.metalness = 0;
      material.needsUpdate = true;
      mesh.userData.clothDressed = true;
      dressed.push({ npc: npc.id, name: mesh.name, tint: material.color.getHex() });
    });
  }
  return { dressed: dressed.length, meshes: dressed, seams, anyLoaded: true };
}

/**
 * Loads the neutral cloth maps and dresses every cast coat with them.
 *
 * Split out from upgradeNPCs() so the load and the dressing are testable in
 * isolation and so a failed download degrades to flat painted coats instead of
 * blocking the modelled rigs. Never throws.
 */
export async function upgradeCastCloth(npcs, { THREE, fetchImpl = fetch, tileMeters = CAST_CLOTH_TILE_METERS } = {}) {
  if (!THREE || !npcs || !npcs.length) return { dressed: 0, meshes: [], anyLoaded: false };
  let clothTextures = null;
  try {
    clothTextures = await loadMaterialTextures({ THREE, files: CLOTH_TEXTURE_FILES, fetchImpl });
  } catch {
    clothTextures = null;
  }
  return dressCastCloth(npcs, clothTextures, { tileMeters });
}

// ---------------------------------------------------------------------------
// Round 76: the cast's skin and hair.
//
// The cloth pass above attaches one neutral map set to every coat. Skin and hair
// need the same treatment but at a much smaller tile (0.35 m and 0.22 m vs the
// coat's 1.2 m), because the player stands about 2 m from a 0.31 m head when the
// Talk prompt opens. The rules live in src/skin.js so the browser pass and the
// tests cannot drift apart; this file only does the geometry work.
// ---------------------------------------------------------------------------

/** The downloaded map sets, keyed by the family id in src/skin.js. */
export const CAST_SKIN_TEXTURE_FILES = {
  skin: SKIN_TEXTURE_FILES,
  hair: HAIR_TEXTURE_FILES
};

/**
 * Accumulated scale from a mesh up to the scene root.
 *
 * Pip is authored at 0.72 scale (buildModelled applies it), so his head is
 * smaller than an adult's. Projecting his skin at the same metre tile would put
 * 28% larger pores and creases on a child than on Mara; dividing the tile by the
 * rig's scale keeps one physical tile size across the whole cast. The walk stops
 * at the top rather than trusting one parent, because meshes sit under limb and
 * neck pivots as well as the rig root.
 */
function accumulatedScale(mesh) {
  let scale = 1;
  for (let node = mesh; node; node = node.parent) {
    const sx = node.scale ? node.scale.x : 1;
    if (Number.isFinite(sx) && sx > 0) scale *= sx;
  }
  return scale;
}

/**
 * Dresses every mesh whose authored material belongs to a cast skin family.
 *
 * `texturesByFamily` is `{ skin, hair }` of loadMaterialTextures() results, so a
 * family whose download failed simply drops out and its meshes stay flat in
 * their authored colour instead of being half-dressed.
 *
 * Maps are cloned once per *material*, not once per mesh: all Skin meshes in one
 * rig share the material object the GLB reader built (src/glb.js indexes into
 * one materials array), so a per-mesh clone would allocate 36 map sets to draw
 * with one. The first mesh through a material sets it up; later meshes only get
 * their own projected UVs.
 */
export function dressCastSkin(npcs, texturesByFamily, { THREE } = {}) {
  const dressed = [];
  const perFamily = { skin: 0, hair: 0 };
  let seams = 0;
  let anyLoaded = false;
  if (!THREE || !texturesByFamily) {
    return { dressed: 0, meshes: dressed, seams: 0, perFamily, anyLoaded: false };
  }
  for (const family of CAST_SKIN_FAMILIES) {
    if (shouldDressCastSkin(family, texturesByFamily[family.id])) anyLoaded = true;
  }
  if (!anyLoaded) {
    return { dressed: 0, meshes: dressed, seams: 0, perFamily, anyLoaded: false };
  }

  // Material object -> the family it was dressed as. A rig's Skin material is
  // shared by head, nose, hands and thumbs, so this both avoids duplicate clones
  // and makes "dress each material once" provable.
  const materialFamilies = new Map();

  for (const npc of npcs) {
    if (!npc.group) continue;
    npc.group.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const material = mesh.material;
      const family = castSkinFamilyFor(material && material.name);
      if (!family) return;
      const textures = texturesByFamily[family.id];
      if (!shouldDressCastSkin(family, textures)) return;

      // The projection works in the mesh's local space, which the rig may scale
      // (Pip is 0.72). Dividing the world tile by that scale gives the local
      // tile that lands at one physical 0.35 m tile on every character.
      const scale = accumulatedScale(mesh);
      const split = projectBoxGeometry({
        THREE, geometry: mesh.geometry, tileMeters: family.tileMeters / scale
      });
      if (split.seams > 0) seams += split.seams;

      if (materialFamilies.get(material) !== family) {
        const params = castSkinParams(family);
        for (const key of ['map', 'normalMap', 'roughnessMap']) {
          const texture = textures[key];
          if (!texture) continue;
          const copy = texture.clone();
          copy.needsUpdate = true;
          copy.wrapS = THREE.RepeatWrapping;
          copy.wrapT = THREE.RepeatWrapping;
          // The metre projection carries the tile; the texture stays at one
          // repeat so density does not depend on how large a mesh happens to be.
          copy.repeat.set(1, 1);
          material[key] = copy;
        }
        material.roughness = params.roughness;
        material.metalness = params.metalness;
        material.needsUpdate = true;
        materialFamilies.set(material, family);
      }

      mesh.userData.skinDressed = true;
      perFamily[family.id] += 1;
      dressed.push({ npc: npc.id, name: mesh.name, family: family.id, tint: material.color.getHex() });
    });
  }
  return { dressed: dressed.length, meshes: dressed, seams, perFamily, anyLoaded: true };
}

/**
 * Loads the skin and hair map sets and dresses the cast with them.
 *
 * Each family is loaded independently, so a missing hair download still leaves
 * the faces dressed (and vice versa) and a network failure leaves the cast flat
 * rather than blocking the rigs. Never throws.
 */
export async function upgradeCastSkin(npcs, { THREE, fetchImpl = fetch, textures = null } = {}) {
  if (!THREE || !npcs || !npcs.length) {
    return { dressed: 0, meshes: [], anyLoaded: false, perFamily: { skin: 0, hair: 0 } };
  }
  let texturesByFamily = textures;
  if (!texturesByFamily) {
    const ids = CAST_SKIN_FAMILIES.map((family) => family.id);
    const loaded = await Promise.all(ids.map(async (id) => {
      try {
        return [id, await loadMaterialTextures({ THREE, files: CAST_SKIN_TEXTURE_FILES[id], fetchImpl })];
      } catch {
        return [id, null];
      }
    }));
    texturesByFamily = Object.fromEntries(loaded);
  }
  return dressCastSkin(npcs, texturesByFamily, { THREE });
}

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
// Joint heights shared by the model rig and the procedural fallback, so
// animateCast() works identically on both.
export const JOINTS = {
  shoulder: { y: 1.32, x: 0.26 },
  hip: { y: 0.78, x: 0.16 },
  neck: { y: 1.32 }
};

/**
 * Builds the procedural fallback figure: the original cylinder body, kept so
 * the plaza stays populated when models are unavailable. Same pivot contract
 * as the modelled rig, so the same animation code drives both.
 */
function buildFallback(data) {
  const group = new THREE.Group();
  const coat = new THREE.MeshStandardMaterial({ color: data.colors.coat, roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: data.colors.skin, roughness: 0.7 });
  const hair = new THREE.MeshStandardMaterial({ color: data.colors.hair, roughness: 0.9 });
  const boots = new THREE.MeshStandardMaterial({ color: 0x2b2622, roughness: 0.9 });
  const accent = new THREE.MeshStandardMaterial({
    color: data.colors.accent, emissive: data.colors.accent,
    emissiveIntensity: 0.15, roughness: 0.6
  });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.26, 1.05, 12), coat);
  body.name = 'Torso';
  body.position.y = 0.85;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 16), skin);
  head.name = 'Head';
  head.position.y = 1.6;
  head.castShadow = true;
  group.add(head);

  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), hair
  );
  cap.name = 'Hair';
  cap.position.y = 1.63;
  cap.castShadow = true;
  group.add(cap);

  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(0.29, 0.29, 0.09, 12, 1, true), accent
  );
  band.name = 'Accent';
  band.position.y = 1.22;
  group.add(band);

  const limbs = {};
  for (const side of ['L', 'R']) {
    const pivot = new THREE.Group();
    pivot.name = `LimbArm${side}`;
    pivot.position.set(side === 'L' ? -JOINTS.shoulder.x : JOINTS.shoulder.x, JOINTS.shoulder.y, 0);
    const limb = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.5, 0.13), coat);
    limb.position.y = -0.25;
    limb.castShadow = true;
    pivot.add(limb);
    group.add(pivot);
    limbs[`arm${side}`] = pivot;

    const legPivot = new THREE.Group();
    legPivot.name = `LimbLeg${side}`;
    legPivot.position.set(side === 'L' ? -JOINTS.hip.x : JOINTS.hip.x, JOINTS.hip.y, 0);
    const legMesh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.78, 0.15), boots);
    legMesh.position.y = -0.39;
    legMesh.castShadow = true;
    legPivot.add(legMesh);
    group.add(legPivot);
    limbs[`leg${side}`] = legPivot;
  }
  return { group, limbs, mode: 'boxes' };
}

/**
 * Builds the modelled rig from a loaded cast GLB. Limb meshes are re-parented
 * under pivot groups at their joints, exactly matching the fallback layout.
 * Carried props (Prop*) are attached to the named hand; other props stay on
 * the body.
 */
function buildModelled(data, result) {
  const group = new THREE.Group();
  const pivots = {};
  for (const side of ['L', 'R']) {
    for (const kind of ['Arm', 'Leg']) {
      const pivot = new THREE.Group();
      const key = `Limb${kind}${side}`;
      pivot.name = key;
      const joint = kind === 'Arm' ? JOINTS.shoulder : JOINTS.hip;
      pivot.position.set(side === 'L' ? -joint.x : joint.x, joint.y, 0);
      group.add(pivot);
      pivots[key] = pivot;
    }
  }

  // Pip is authored at 0.72 scale in Blender via object scale; the loader bakes
  // transforms, so apply the same scale here for the procedural rig parity.
  const scale = data.id === 'pip' ? 0.72 : 1;

  // Neck pivot: the head assembly is authored around it, so the head can turn
  // toward the player without rotating the torso.
  const neck = new THREE.Group();
  neck.name = 'NeckPivot';
  neck.position.set(0, JOINTS.neck.y, 0);
  group.add(neck);
  pivots.NeckPivot = neck;

  // Meshes authored around a joint must ride that joint's pivot. Hands, thumbs
  // and pauldrons belong to the arm; boots to the leg. Getting this wrong puts
  // them at the body root, which renders hands at knee height and boots below
  // the floor -- a bug that shipped in round 44 and is fixed here.
  const jointParent = {
    HandL: 'LimbArmL', ThumbL: 'LimbArmL', PauldronL: 'LimbArmL',
    HandR: 'LimbArmR', ThumbR: 'LimbArmR', PauldronR: 'LimbArmR',
    BootL: 'LimbLegL', BootR: 'LimbLegR',
    Head: 'NeckPivot', Nose: 'NeckPivot', Mouth: 'NeckPivot',
    Hair: 'NeckPivot', HairBun: 'NeckPivot', HairTail: 'NeckPivot',
    EyeWhiteL: 'NeckPivot', EyeWhiteR: 'NeckPivot',
    EyeIrisL: 'NeckPivot', EyeIrisR: 'NeckPivot'
  };

  const hands = { L: pivots.LimbArmL, R: pivots.LimbArmR };
  for (const { name, geometry, material } of result.meshes) {
    if (name.startsWith('Prop')) continue; // handled after pivots exist
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = true;
    const parentKey = jointParent[name] || name;
    if (pivots[parentKey]) {
      pivots[parentKey].add(mesh);
    } else {
      group.add(mesh);
    }
  }
  // Props: attach to a hand pivot so they swing with the arm. Companion props
  // (lantern on the pole, spear point on the shaft, ledger pages on the board)
  // are authored already in place next to their parent, so they must ride the
  // SAME pivot -- putting them on the body root would leave them behind while
  // the arm swings.
  const propHand = {
    PropPole: 'R', PropSpear: 'R', PropMap: 'L', PropLedger: 'L', PropHoop: 'L',
    PropLantern: 'R', PropSpearTip: 'R', PropLedgerPages: 'L'
  };
  for (const { name, geometry, material } of result.meshes) {
    if (!name.startsWith('Prop')) continue;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = true;
    const side = propHand[name];
    if (side) hands[side].add(mesh);
    else group.add(mesh);
  }

  group.scale.setScalar(scale);
  // Expose the iris meshes so animateCast() can blink them.
  let eyeIrisL = null;
  let eyeIrisR = null;
  group.traverse((o) => {
    if (!o.isMesh) return;
    if (o.name === 'EyeIrisL') eyeIrisL = o;
    if (o.name === 'EyeIrisR') eyeIrisR = o;
  });
  return { group, limbs: {
    armL: pivots.LimbArmL, armR: pivots.LimbArmR,
    legL: pivots.LimbLegL, legR: pivots.LimbLegR,
    neck: pivots.NeckPivot, eyeIrisL, eyeIrisR
  }, mode: 'model' };
}

/**
 * Builds every NPC and returns live handles used by the game loop. Figures are
 * the modelled rigs when the cast GLBs are available, else the procedural
 * fallback -- same pivots, so animation and tests are identical either way.
 */
export function createNPCs(scene) {
  return NPC_DATA.map((data) => {
    const built = buildFallback(data);
    const group = built.group;
    group.position.set(data.routine.day.x, 0, data.routine.day.z);
    group.rotation.y = data.routine.day.facing;
    // Which character this rig is, so a scene-graph pass (or a browser check)
    // can attribute a mesh to its authored palette. The coats are dressed per
    // rig and each rig must keep its own coat colour, so "whose coat is this"
    // has to be answerable from the graph rather than from traversal order.
    group.userData.npcId = data.id;

    // A soft marker so NPCs are easy to spot in a busy courtyard.
    const marker = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.22, 8),
      new THREE.MeshStandardMaterial({ color: 0xffd479, emissive: 0xffb43a, emissiveIntensity: 0.9 })
    );
    marker.name = 'Marker';
    // The marker's own material is named so the materials audit attributes its
    // area; `Marker` as a *material* matches no family test either, so this is a
    // label and not a dressing trigger. (The mesh name is what npcs.js checks
    // when it swaps in the GLB cast, so the two namespaces never collide.)
    marker.material.name = 'NpcMarker';
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
      limbs: built.limbs,
      mode: built.mode,
      target: { x: spawn.x, z: spawn.z },
      facing: spawn.facing,
      walking: false,
      phase: null,
      lineIndex: 0,
      position: group.position
    };
  });
}

/**
 * Upgrades every NPC from the procedural fallback to its modelled rig.
 * Resolves once all six models have been attempted; keeps the fallback when a
 * model fails, so a missing GLB can never empty the plaza.
 */
export async function upgradeNPCs(npcs, { THREE, loadGlb, fetchImpl = fetch } = {}) {
  if (!THREE || !loadGlb) return 'boxes';
  const results = await Promise.all(npcs.map(async (npc) => {
    const url = CAST_ASSETS[npc.id];
    if (!url) return { npc, ok: false };
    const result = await loadCast({ THREE, loadGlb, url, fetchImpl });
    if (!result.ok) return { npc, ok: false, reason: result.reason };
    // Remove the fallback figure but keep the group (position, marker, state).
    const doomed = [];
    npc.group.traverse((o) => {
      if (o.isMesh && o.name !== 'Marker') doomed.push(o);
    });
    for (const mesh of doomed) {
      mesh.parent.remove(mesh);
    }
    const built = buildModelled(npc, result);
    npc.group.add(built.group);
    npc.limbs = built.limbs;
    npc.mode = 'model';
    npc.bytes = result.bytes;
    return { npc, ok: true };
  }));
  const loaded = results.filter((r) => r.ok).length;
  return { loaded, total: npcs.length, mode: loaded === npcs.length ? 'model' : 'mixed' };
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

    animateCast(npc, dt, undefined, playerPosition);
  }
}

/**
 * Drives the limb pivots: a walk cycle when moving, a gentle idle sway when
 * standing. Works identically on modelled and fallback rigs because both hang
 * their limbs under pivots at the same joints. Phase comes from world time so
 * the cast does not march in perfect lockstep; each character is offset by its
 * spawn position.
 */
export function animateCast(npc, dt, time = performance.now() / 1000, playerPosition = null) {
  const { limbs } = npc;
  if (!limbs) return;
  const t = time + npc.group.position.x * 1.7;
  if (npc.walking) {
    const swing = Math.sin(t * 6.2) * 0.55;
    // Clear the idle lean so a weight shift does not carry into the stride.
    if (limbs.legL) limbs.legL.rotation.z = 0;
    if (limbs.legR) limbs.legR.rotation.z = 0;
    if (limbs.legL) limbs.legL.rotation.x = swing;
    if (limbs.legR) limbs.legR.rotation.x = -swing;
    if (limbs.armL) limbs.armL.rotation.x = -swing * 0.7;
    if (limbs.armR) limbs.armR.rotation.x = swing * 0.7;
  } else {
    // Idle: a slow breath in the arms, and a lateral weight shift in the legs
    // so the figure rocks from foot to foot rather than standing bolt upright.
    const sway = Math.sin(t * 1.4) * 0.06;
    if (limbs.armL) limbs.armL.rotation.x = sway;
    if (limbs.armR) limbs.armR.rotation.x = -sway;
    const shift = weightShift(time, npc.group.position.z);
    if (limbs.legL) limbs.legL.rotation.z = shift;
    if (limbs.legR) limbs.legR.rotation.z = -shift;
    if (limbs.legL) limbs.legL.rotation.x = 0;
    if (limbs.legR) limbs.legR.rotation.x = 0;
  }
  // Attention: within talking range, turn the head toward the player, with a
  // little overshoot-free easing. Beyond it, ease the head back to centre.
  if (limbs.neck) {
    // With nobody nearby the cast still looks around occasionally, so the
    // plaza is not six statues staring at their routine spot.
    let desired = glanceAngle(time, npc.group.position.z);
    if (playerPosition) {
      const dx = playerPosition.x - npc.group.position.x;
      const dz = playerPosition.z - npc.group.position.z;
      if (Math.hypot(dx, dz) < TALK_RANGE + 1.5) {
        // Angle of the player relative to where the body faces.
        desired = Math.atan2(dx, dz) - npc.group.rotation.y;
        while (desired > Math.PI) desired -= Math.PI * 2;
        while (desired < -Math.PI) desired += Math.PI * 2;
        // The head cannot spin round: clamp to a believable nod range.
        desired = Math.max(-0.9, Math.min(0.9, desired));
      }
    }
    limbs.neck.rotation.y += (desired - limbs.neck.rotation.y) * Math.min(1, dt * 4);
  }
  // Blink: each character blinks on its own phase offset, iris squashed for
  // ~0.12 s. The sclera stays, so the eye reads as closing, not vanishing.
  const blinkPhase = (t * 0.42 + npc.group.position.z * 0.37) % 3.2;
  const blink = blinkPhase < 0.06 ? 0.15 : 1;
  if (limbs.eyeIrisL) limbs.eyeIrisL.scale.y = blink;
  if (limbs.eyeIrisR) limbs.eyeIrisR.scale.y = blink;
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

// ---------------------------------------------------------------------------
// Round 81: the cast's accent bands.
//
// The accent material is the per-NPC dye (mara's gold sash, oswin's red scarf,
// pip's green leg wraps, halden's grey tabard, sable's violet cloak, wren's
// amber collar) -- 2.38 m2 across 9 meshes. It is the largest still-flat cast
// surface the materials audit finds, and it is the same kind of surface as the
// lane bunting (felted fabric at 0.1-0.2 m) so it reuses the neutral felt maps
// rather than a new set. The rules live in src/accent.js.
// ---------------------------------------------------------------------------

/** The downloaded map set, keyed by the family id in src/accent.js. */
export const CAST_ACCENT_TEXTURE_FILES = FELT_TEXTURE_FILES;

/**
 * Dresses every mesh whose authored material belongs to a cast accent family.
 *
 * Maps are cloned once per *material*, not once per mesh: all Accent meshes in
 * one rig share the material object the GLB reader built, so a per-mesh clone
 * would allocate duplicate map sets for one draw. The first mesh through a
 * material sets it up; later meshes only get their own projected UVs.
 */
export function dressCastAccent(npcs, textures, { THREE } = {}) {
  const dressed = [];
  const perFamily = { accent: 0 };
  let seams = 0;
  let anyLoaded = false;
  if (!THREE || !textures) {
    return { dressed: 0, meshes: dressed, seams: 0, perFamily, anyLoaded: false };
  }
  const family = CAST_ACCENT_FAMILIES[0];
  if (!shouldDressCastAccent(family, textures)) {
    return { dressed: 0, meshes: dressed, seams: 0, perFamily, anyLoaded: false };
  }
  anyLoaded = true;

  const materialFamilies = new Map();

  for (const npc of npcs) {
    if (!npc.group) continue;
    npc.group.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const material = mesh.material;
      const fam = castAccentFamilyFor(material && material.name);
      if (!fam) return;
      if (!shouldDressCastAccent(fam, textures)) return;

      const scale = accumulatedScale(mesh);
      const split = projectBoxGeometry({
        THREE, geometry: mesh.geometry, tileMeters: fam.tileMeters / scale
      });
      if (split.seams > 0) seams += split.seams;

      if (materialFamilies.get(material) !== fam) {
        const params = castAccentParams(fam);
        for (const key of ['map', 'normalMap', 'roughnessMap']) {
          const texture = textures[key];
          if (!texture) continue;
          const copy = texture.clone();
          copy.needsUpdate = true;
          copy.wrapS = THREE.RepeatWrapping;
          copy.wrapT = THREE.RepeatWrapping;
          copy.repeat.set(1, 1);
          material[key] = copy;
        }
        material.roughness = params.roughness;
        material.metalness = params.metalness;
        material.needsUpdate = true;
        materialFamilies.set(material, fam);
      }

      mesh.userData.accentDressed = true;
      perFamily.accent += 1;
      dressed.push({ npc: npc.id, name: mesh.name, family: 'accent', tint: material.color.getHex() });
    });
  }
  return { dressed: dressed.length, meshes: dressed, seams, perFamily, anyLoaded };
}

/**
 * Loads the felt maps and dresses the cast's accent bands with them.
 * Never throws.
 */
export async function upgradeCastAccent(npcs, { THREE, fetchImpl = fetch, textures = null } = {}) {
  if (!THREE || !npcs || !npcs.length) {
    return { dressed: 0, meshes: [], anyLoaded: false, perFamily: { accent: 0 } };
  }
  let loadedTextures = textures;
  if (!loadedTextures) {
    try {
      loadedTextures = await loadMaterialTextures({ THREE, files: CAST_ACCENT_TEXTURE_FILES, fetchImpl });
    } catch {
      loadedTextures = null;
    }
  }
  return dressCastAccent(npcs, loadedTextures, { THREE });
}

// ---------------------------------------------------------------------------
// Round 82: the cast's boots.
//
// The boot material is the per-NPC leather (1.49 m2 across 18 meshes on five
// of the six rigs; mara is robed to the ground and has none). It reuses the
// generated leather maps rather than a new set. The rules live in src/boot.js.
// ---------------------------------------------------------------------------

/** The downloaded map set, keyed by the family id in src/boot.js. */
export const CAST_BOOT_TEXTURE_FILES = LEATHER_TEXTURE_FILES;

/**
 * Dresses every mesh whose authored material belongs to a cast boot family.
 *
 * Maps are cloned once per *material*, not once per mesh: all Boot meshes in
 * one rig share the material object the GLB reader built, so a per-mesh clone
 * would allocate duplicate map sets for one draw. The first mesh through a
 * material sets it up; later meshes only get their own projected UVs.
 */
export function dressCastBoot(npcs, textures, { THREE } = {}) {
  const dressed = [];
  const perFamily = { boot: 0 };
  let seams = 0;
  let anyLoaded = false;
  if (!THREE || !textures) {
    return { dressed: 0, meshes: dressed, seams: 0, perFamily, anyLoaded: false };
  }
  const family = CAST_BOOT_FAMILIES[0];
  if (!shouldDressCastBoot(family, textures)) {
    return { dressed: 0, meshes: dressed, seams: 0, perFamily, anyLoaded: false };
  }
  anyLoaded = true;

  const materialFamilies = new Map();

  for (const npc of npcs) {
    if (!npc.group) continue;
    npc.group.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const material = mesh.material;
      const fam = castBootFamilyFor(material && material.name);
      if (!fam) return;
      if (!shouldDressCastBoot(fam, textures)) return;

      const scale = accumulatedScale(mesh);
      const split = projectBoxGeometry({
        THREE, geometry: mesh.geometry, tileMeters: fam.tileMeters / scale
      });
      if (split.seams > 0) seams += split.seams;

      if (materialFamilies.get(material) !== fam) {
        const params = castBootParams(fam);
        for (const key of ['map', 'normalMap', 'roughnessMap']) {
          const texture = textures[key];
          if (!texture) continue;
          const copy = texture.clone();
          copy.needsUpdate = true;
          copy.wrapS = THREE.RepeatWrapping;
          copy.wrapT = THREE.RepeatWrapping;
          copy.repeat.set(1, 1);
          material[key] = copy;
        }
        material.roughness = params.roughness;
        material.metalness = params.metalness;
        material.needsUpdate = true;
        materialFamilies.set(material, fam);
      }

      mesh.userData.bootDressed = true;
      perFamily.boot += 1;
      dressed.push({ npc: npc.id, name: mesh.name, family: 'boot', tint: material.color.getHex() });
    });
  }
  return { dressed: dressed.length, meshes: dressed, seams, perFamily, anyLoaded };
}

/**
 * Loads the leather maps and dresses the cast's boots with them.
 * Never throws.
 */
export async function upgradeCastBoot(npcs, { THREE, fetchImpl = fetch, textures = null } = {}) {
  if (!THREE || !npcs || !npcs.length) {
    return { dressed: 0, meshes: [], anyLoaded: false, perFamily: { boot: 0 } };
  }
  let loadedTextures = textures;
  if (!loadedTextures) {
    try {
      loadedTextures = await loadMaterialTextures({ THREE, files: CAST_BOOT_TEXTURE_FILES, fetchImpl });
    } catch {
      loadedTextures = null;
    }
  }
  return dressCastBoot(npcs, loadedTextures, { THREE });
}

// ---------------------------------------------------------------------------
// Round 84: the cast's paper props.
//
// Oswin's apron and Wren's ledger pages are authored with a material named
// `Paper` -- the same word as the job board, but a different surface scale, so
// it is its own family (CAST_PAPER_FAMILIES in src/paper.js). It reuses the
// generated paper maps rather than a new set.
// ---------------------------------------------------------------------------

/** The downloaded map set, keyed by the family id in src/paper.js. */
export const CAST_PAPER_TEXTURE_FILES = PAPER_TEXTURE_FILES;

/**
 * Dresses every mesh whose authored material belongs to a cast paper family.
 *
 * Maps are cloned once per *material*, not once per mesh: all Paper meshes in
 * one rig share the material object the GLB reader built, so a per-mesh clone
 * would allocate duplicate map sets for one draw. The first mesh through a
 * material sets it up; later meshes only get their own projected UVs. The
 * paper albedo is already cream, so the tint stays white (keepTint is false in
 * src/paper.js) or the cream would multiply down to brown.
 */
export function dressCastPaper(npcs, textures, { THREE } = {}) {
  const dressed = [];
  const perFamily = { castPaper: 0 };
  let seams = 0;
  let anyLoaded = false;
  if (!THREE || !textures) {
    return { dressed: 0, meshes: dressed, seams: 0, perFamily, anyLoaded: false };
  }
  const family = CAST_PAPER_FAMILIES[0];
  if (!shouldDressCastPaper(family, textures)) {
    return { dressed: 0, meshes: dressed, seams: 0, perFamily, anyLoaded: false };
  }
  anyLoaded = true;

  const materialFamilies = new Map();

  for (const npc of npcs) {
    if (!npc.group) continue;
    npc.group.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const material = mesh.material;
      const fam = castPaperFamilyFor(material && material.name);
      if (!fam) return;
      if (!shouldDressCastPaper(fam, textures)) return;

      const scale = accumulatedScale(mesh);
      const split = projectBoxGeometry({
        THREE, geometry: mesh.geometry, tileMeters: fam.tileMeters / scale
      });
      if (split.seams > 0) seams += split.seams;

      if (materialFamilies.get(material) !== fam) {
        const params = castPaperParams(fam);
        for (const key of ['map', 'normalMap', 'roughnessMap']) {
          const texture = textures[key];
          if (!texture) continue;
          const copy = texture.clone();
          copy.needsUpdate = true;
          copy.wrapS = THREE.RepeatWrapping;
          copy.wrapT = THREE.RepeatWrapping;
          copy.repeat.set(1, 1);
          material[key] = copy;
        }
        material.roughness = params.roughness;
        material.metalness = params.metalness;
        if (params.keepTint === false) {
          // The paper albedo is already cream: force the tint white or the
          // authored cream multiplies down to brown.
          material.color.set(0xffffff);
        }
        material.needsUpdate = true;
        materialFamilies.set(material, fam);
      }

      mesh.userData.paperDressed = true;
      perFamily.castPaper += 1;
      dressed.push({ npc: npc.id, name: mesh.name, family: 'castPaper', tint: material.color.getHex() });
    });
  }
  return { dressed: dressed.length, meshes: dressed, seams, perFamily, anyLoaded };
}

/**
 * Loads the paper maps and dresses the cast's paper props with them.
 * Never throws.
 */
export async function upgradeCastPaper(npcs, { THREE, fetchImpl = fetch, textures = null } = {}) {
  if (!THREE || !npcs || !npcs.length) {
    return { dressed: 0, meshes: [], anyLoaded: false, perFamily: { castPaper: 0 } };
  }
  let loadedTextures = textures;
  if (!loadedTextures) {
    try {
      loadedTextures = await loadMaterialTextures({ THREE, files: CAST_PAPER_TEXTURE_FILES, fetchImpl });
    } catch {
      loadedTextures = null;
    }
  }
  return dressCastPaper(npcs, loadedTextures, { THREE });
}

// ---------------------------------------------------------------------------
// Round 110: the cast's armour. Halden's helmet, nasal, pauldrons and spear tip
// are authored with a material named `Steel` at roughness 0.4 / metalness 0.7 and
// previously matched no family, so they stayed flat (0.86 m2 of untextured
// armour, the worst flat metal in the scene). The rules live in src/steel.js.
// It reuses the generated lamp metal normal + roughness maps rather than a new
// set: the lamp albedo is painted iron and would contaminate the authored
// blue-grey tint, so the albedo is deliberately omitted (keepTint stays true).
// ---------------------------------------------------------------------------

/** The downloaded map set, keyed by the family id in src/steel.js. */
export const CAST_STEEL_TEXTURE_FILES = {
  normalMap: 'assets/textures/lamp_normal.webp',
  roughnessMap: 'assets/textures/lamp_rough.webp'
};

/**
 * Dresses every mesh whose authored material belongs to a cast steel family.
 *
 * Maps are cloned once per *material*, not once per mesh: all Steel meshes in
 * one rig share the material object the GLB reader built, so a per-mesh clone
 * would allocate duplicate map sets for one draw. The first mesh through a
 * material sets it up; later meshes only get their own projected UVs. Only the
 * normal and roughness maps are attached (no albedo), so the authored blue-grey
 * tint survives untouched.
 */
export function dressCastSteel(npcs, textures, { THREE } = {}) {
  const dressed = [];
  const perFamily = { steel: 0 };
  let seams = 0;
  let anyLoaded = false;
  if (!THREE || !textures) {
    return { dressed: 0, meshes: dressed, seams: 0, perFamily, anyLoaded: false };
  }
  const family = CAST_STEEL_FAMILIES[0];
  if (!shouldDressCastSteel(family, textures)) {
    return { dressed: 0, meshes: dressed, seams: 0, perFamily, anyLoaded: false };
  }
  anyLoaded = true;

  const materialFamilies = new Map();

  for (const npc of npcs) {
    if (!npc.group) continue;
    npc.group.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const material = mesh.material;
      const fam = castSteelFamilyFor(material && material.name);
      if (!fam) return;
      if (!shouldDressCastSteel(fam, textures)) return;

      const scale = accumulatedScale(mesh);
      const split = projectBoxGeometry({
        THREE, geometry: mesh.geometry, tileMeters: fam.tileMeters / scale
      });
      if (split.seams > 0) seams += split.seams;

      if (materialFamilies.get(material) !== fam) {
        const params = castSteelParams(fam);
        for (const key of ['normalMap', 'roughnessMap']) {
          const texture = textures[key];
          if (!texture) continue;
          const copy = texture.clone();
          copy.needsUpdate = true;
          copy.wrapS = THREE.RepeatWrapping;
          copy.wrapT = THREE.RepeatWrapping;
          copy.repeat.set(1, 1);
          material[key] = copy;
        }
        material.roughness = params.roughness;
        material.metalness = params.metalness;
        material.needsUpdate = true;
        materialFamilies.set(material, fam);
      }

      mesh.userData.steelDressed = true;
      perFamily.steel += 1;
      dressed.push({ npc: npc.id, name: mesh.name, family: 'steel', tint: material.color.getHex() });
    });
  }
  return { dressed: dressed.length, meshes: dressed, seams, perFamily, anyLoaded };
}

/**
 * Loads the lamp metal maps and dresses the cast's armour with them.
 * Never throws.
 */
export async function upgradeCastSteel(npcs, { THREE, fetchImpl = fetch, textures = null } = {}) {
  if (!THREE || !npcs || !npcs.length) {
    return { dressed: 0, meshes: [], anyLoaded: false, perFamily: { steel: 0 } };
  }
  let loadedTextures = textures;
  if (!loadedTextures) {
    try {
      loadedTextures = await loadMaterialTextures({ THREE, files: CAST_STEEL_TEXTURE_FILES, fetchImpl });
    } catch {
      loadedTextures = null;
    }
  }
  return dressCastSteel(npcs, loadedTextures, { THREE });
}

// Round 111: the cast's carried timber (mara's lantern pole, pip's hoop, halden's
// spear shaft, wren's ledger board). The rules live in src/woodprop.js. It reuses
// the crate/barrel plank maps (WOOD_TEXTURE_FILES) so the cast props read as the
// same workshop timber as the plaza crates; the albedo carries the wood colour so
// the tint is replaced rather than multiplied (keepTint false).
// ---------------------------------------------------------------------------
export const CAST_WOOD_TEXTURE_FILES = WOOD_TEXTURE_FILES;

export function dressCastWood(npcs, textures, { THREE } = {}) {
  const dressed = [];
  const perFamily = { wood: 0 };
  let seams = 0;
  let anyLoaded = false;
  if (!THREE || !textures) {
    return { dressed: 0, meshes: dressed, seams: 0, perFamily, anyLoaded: false };
  }
  const family = CAST_WOOD_FAMILIES[0];
  if (!shouldDressCastWood(family, textures)) {
    return { dressed: 0, meshes: dressed, seams: 0, perFamily, anyLoaded: false };
  }
  anyLoaded = true;

  const materialFamilies = new Map();

  for (const npc of npcs) {
    if (!npc.group) continue;
    npc.group.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const material = mesh.material;
      const fam = castWoodFamilyFor(material && material.name);
      if (!fam) return;
      if (!shouldDressCastWood(fam, textures)) return;

      const scale = accumulatedScale(mesh);
      const split = projectBoxGeometry({
        THREE, geometry: mesh.geometry, tileMeters: fam.tileMeters / scale
      });
      if (split.seams > 0) seams += split.seams;

      if (materialFamilies.get(material) !== fam) {
        const params = castWoodParams(fam);
        for (const key of ['map', 'normalMap', 'roughnessMap']) {
          const texture = textures[key];
          if (!texture) continue;
          const copy = texture.clone();
          copy.needsUpdate = true;
          copy.wrapS = THREE.RepeatWrapping;
          copy.wrapT = THREE.RepeatWrapping;
          copy.repeat.set(1, 1);
          material[key] = copy;
        }
        // keepTint is false for wood: the reused albedo carries the colour, so
        // the material tint must be white or the grain is double-tinted.
        material.color.setHex(0xffffff);
        material.roughness = params.roughness;
        material.metalness = params.metalness;
        material.needsUpdate = true;
        materialFamilies.set(material, fam);
      }

      mesh.userData.woodDressed = true;
      perFamily.wood += 1;
      dressed.push({ npc: npc.id, name: mesh.name, family: 'wood', tint: material.color.getHex() });
    });
  }
  return { dressed: dressed.length, meshes: dressed, seams, perFamily, anyLoaded };
}

export async function upgradeCastWood(npcs, { THREE, fetchImpl = fetch, textures = null } = {}) {
  if (!THREE || !npcs || !npcs.length) {
    return { dressed: 0, meshes: [], anyLoaded: false, perFamily: { wood: 0 } };
  }
  let loadedTextures = textures;
  if (!loadedTextures) {
    try {
      loadedTextures = await loadMaterialTextures({ THREE, files: CAST_WOOD_TEXTURE_FILES, fetchImpl });
    } catch {
      loadedTextures = null;
    }
  }
  return dressCastWood(npcs, loadedTextures, { THREE });
}

