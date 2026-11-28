// The lane props' dressing pass: the lamp's lantern housings (LanternHousing,
// ~0.24 m across, one authored material shared by several meshes) and the
// sacks' pinched ties (SackTie, ~9 small cords at ~0.02 m).
//
// Round 87 reuses existing texture maps for both rather than authoring new
// ones: the housings reuse the LAMP maps, the ties reuse the CLOTH maps. The
// maps are projected in metre space, so the only thing that changes between a
// lamp post and a lantern housing is the tile size -- see src/housing.js and
// src/sacktie.js for why those tiles are what they are. This module is the
// browser-facing half; the pure rules stay in those two files so the unit
// tests can hold them in place without Three.js.
//
// Both functions follow the same contract as the other dressing passes
// (dressCastPaper in src/npcs.js, dressBoardPaper in src/world.js): project
// UVs, clone the textures, force one repeat, and leave everything that does
// not match its family exactly as it was authored. A failed download must
// leave the authored materials untouched rather than half-dressed.
import { projectBoxGeometry } from './assets.js';
import { housingFamilyFor, housingParams, shouldDressHousing } from './housing.js';
import { sackTieFamilyFor, sackTieParams, shouldDressSackTie } from './sacktie.js';

/** The map keys a dressed material carries; `anyLoaded` is a flag, not a map. */
const MAP_KEYS = ['map', 'normalMap', 'roughnessMap'];

/**
 * Copies the map set onto `material`, one clone per map.
 *
 * The clones matter because the source textures are shared with the lamp or
 * cloth pass; a material that wrapped or repeated the originals would change
 * how the lamp post itself renders. UVs are already in metres, so the repeat
 * stays (1, 1) and the tile size lives entirely in the projection.
 */
function applyMaps({ THREE, material, textures }) {
  for (const key of MAP_KEYS) {
    const texture = textures[key];
    if (!texture) continue;
    const copy = texture.clone();
    copy.needsUpdate = true;
    copy.wrapS = THREE.RepeatWrapping;
    copy.wrapT = THREE.RepeatWrapping;
    copy.repeat.set(1, 1);
    material[key] = copy;
  }
}

/**
 * Dresses the lane lantern housings with the lamp maps at the housing tile.
 *
 * `meshes` is an array of THREE.Mesh whose authored material is named
 * 'LanternHousing'. The housing is a tapered 8-sided CylinderGeometry about
 * 0.24 m across, and one material is shared by several meshes, so the new
 * material is cached by source material: the housings keep sharing one
 * material instead of each getting its own.
 *
 * Returns `{ dressed, seams, materials }`, where `materials` counts the
 * distinct MeshStandardMaterial objects created (one per distinct source).
 */
export function dressLanternHousing(meshes, textures, { THREE } = {}) {
  if (!THREE || !Array.isArray(meshes) || !textures) {
    return { dressed: 0, seams: 0, materials: 0 };
  }
  const family = housingFamilyFor('LanternHousing');
  // A failed download must leave the authored materials untouched; dressing
  // some meshes and not others would look worse than flat paint.
  if (!shouldDressHousing(family, textures)) {
    return { dressed: 0, seams: 0, materials: 0 };
  }

  const params = housingParams(family);
  const bySource = new Map();
  let dressed = 0;
  let seams = 0;

  for (const mesh of meshes) {
    if (!mesh || !mesh.isMesh) continue;
    const source = mesh.material;
    if (!source || !housingFamilyFor(source.name)) continue;

    // The 0.25 m tile is what makes the lamp-post paint read as housing paint:
    // the lamp post projects the same maps at a much larger tile, which would
    // smear one chip of paint across a 0.24 m housing.
    const split = projectBoxGeometry({
      THREE, geometry: mesh.geometry, tileMeters: family.tileMeters
    });
    seams += split.seams;

    let material = bySource.get(source);
    if (!material) {
      material = new THREE.MeshStandardMaterial({
        // keepTint is false: the lamp albedo already carries the paint colour,
        // so the tint stays white or the authored colour multiplies it down.
        color: params.keepTint && source.color ? source.color.getHex() : 0xffffff,
        roughness: params.roughness,
        metalness: params.metalness,
        name: source.name,
        side: source.side
      });
      applyMaps({ THREE, material, textures });
      material.needsUpdate = true;
      bySource.set(source, material);
    }

    mesh.material = material;
    mesh.userData.housingDressed = true;
    dressed += 1;
  }

  return { dressed, seams, materials: bySource.size };
}

/**
 * Dresses the lane sacks' ties with the cloth maps at the sack-tie tile.
 *
 * `meshes` is an array of THREE.Mesh whose authored material is named
 * 'SackTie' (~9 small cylinders/torus, ~0.02 m). Same caching and contract as
 * dressLanternHousing, but keepTint is true: the authored dark cord colour
 * must survive as the tint over the reused neutral cloth weave, or the ties
 * turn pale and stop reading as cord.
 *
 * Returns `{ dressed, seams, materials }`.
 */
export function dressSackTie(meshes, textures, { THREE } = {}) {
  if (!THREE || !Array.isArray(meshes) || !textures) {
    return { dressed: 0, seams: 0, materials: 0 };
  }
  const family = sackTieFamilyFor('SackTie');
  if (!shouldDressSackTie(family, textures)) {
    return { dressed: 0, seams: 0, materials: 0 };
  }

  const params = sackTieParams(family);
  const bySource = new Map();
  let dressed = 0;
  let seams = 0;

  for (const mesh of meshes) {
    if (!mesh || !mesh.isMesh) continue;
    const source = mesh.material;
    if (!source || !sackTieFamilyFor(source.name)) continue;

    // A 0.04 m tile puts roughly two tiles across a 2 cm cord, so the weave
    // reads as tight cord rather than one smeared stripe.
    const split = projectBoxGeometry({
      THREE, geometry: mesh.geometry, tileMeters: family.tileMeters
    });
    seams += split.seams;

    let material = bySource.get(source);
    if (!material) {
      material = new THREE.MeshStandardMaterial({
        // keepTint is true: the cloth albedo is a neutral weave, so the
        // authored dark cord colour survives as the tint over the map.
        color: params.keepTint && source.color ? source.color.getHex() : 0xffffff,
        roughness: params.roughness,
        metalness: params.metalness,
        name: source.name,
        side: source.side
      });
      applyMaps({ THREE, material, textures });
      material.needsUpdate = true;
      bySource.set(source, material);
    }

    mesh.material = material;
    mesh.userData.sackTieDressed = true;
    dressed += 1;
  }

  return { dressed, seams, materials: bySource.size };
}
