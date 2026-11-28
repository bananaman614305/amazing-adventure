// The lane's notice board face: the 1.4 x 1.2 m painted panel the lane board
// carries. There are two of them in the scene, and only one is visible:
//   - `NoticeFaceLane`, the procedural stand-in (a PlaneGeometry, color
//     0xd8c9a8, roughness 0.95, no authored UVs) that src/world.js builds and
//     upgradeNotice() hides when the modelled board loads;
//   - `NoticeFace`, the modelled panel from assets/notice.glb (1.4 x 1.2 x
//     0.03 m, no TEXCOORD_0), which is what the player actually sees.
// Round 87 dresses both with the existing board-paper maps at one tile size,
// because a board read up close from 1-2 m should show paper tooth rather than
// flat cream paint -- and the family must cover the modelled name too, or the
// visible face would be the one surface left flat.
//
// This module is the pure, testable half: it names the family, its tile size
// and the material settings the dressed mesh must end up with, so the browser
// pass and the unit tests agree instead of each re-deriving a regex. The rules
// import nothing, so a test can hold them in place without Three.js; only the
// dressing pass at the bottom needs Three.js and the box projector.
//
// Why its own family rather than the board-paper family in src/paper.js? The
// job board's paper is a 1.2 x 0.9 m sheet of pinned slips; the lane board is
// a 1.4 x 1.2 m painted face read up close, so its tooth is a different size.
// The exact-name test also keeps it from catching the job board's own
// BoardFace/BoardPaper materials.
//
// Why keepTint is false: the reused paper albedo is already cream, so the
// material tint must stay white or the authored 0xd8c9a8 multiplies the map
// down to brown.
import { projectBoxGeometry } from './assets.js';

/**
 * Metres per notice-face tile.
 *
 * A 0.4 m tile puts about 3.5 tiles across the 1.4 m face. The lane board is
 * read up close from 1-2 m, so the paper tooth should be coarser than the job
 * board's 0.3 m slips -- at that distance a finer tile would blur into a
 * single smeared sheet.
 */
export const NOTICE_FACE_TILE_METERS = 0.4;

/**
 * The lane notice board's face family (Round 72).
 *
 * The test accepts exactly `NoticeFace` (the modelled panel) and
 * `NoticeFaceLane` (the procedural stand-in). It never catches a future
 * `NoticeFrame`, `NoticeFace2` or `LaneNotice`; those get their own family or
 * none at all.
 */
export const NOTICE_FACE_FAMILY = {
  id: 'noticeFace',
  test: /^noticeface(lane)?$/i,
  tileMeters: NOTICE_FACE_TILE_METERS,
  roughness: 0.9,
  metalness: 0,
  keepTint: false
};

/** The notice-face families, in the shape the other dressers' arrays take. */
export const NOTICE_FACE_FAMILIES = [NOTICE_FACE_FAMILY];

/** The family an authored notice-face material belongs to, or null when left alone. */
export function noticeFaceFamilyFor(materialName) {
  if (!materialName) return null;
  for (const family of NOTICE_FACE_FAMILIES) {
    if (family.test.test(materialName)) return family;
  }
  return null;
}

/** The material settings a dressed notice-face mesh must end up with. */
export function noticeFaceParams(family) {
  if (!family) return null;
  return {
    roughness: family.roughness,
    metalness: family.metalness,
    keepTint: family.keepTint === true
  };
}

/** Whether the notice-face family's maps should be projected at all. */
export function shouldDressNoticeFace(family, textures) {
  if (!family || !textures) return false;
  return Boolean(textures.anyLoaded);
}

/** The map keys a dressed material carries; `anyLoaded` is a flag, not a map. */
const MAP_KEYS = ['map', 'normalMap', 'roughnessMap'];

/**
 * Copies the map set onto `material`, one clone per map.
 *
 * The clones matter because the source textures are shared with the board-paper
 * pass; a material that wrapped or repeated the originals would change how the
 * job board itself renders. UVs are already in metres, so the repeat stays
 * (1, 1) and the tile size lives entirely in the projection.
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
 * Dresses the lane notice board's face with the board-paper maps at the
 * notice-face tile.
 *
 * `meshes` is an array of THREE.Mesh whose authored material is named
 * 'NoticeFace' (the modelled panel) or 'NoticeFaceLane' (the stand-in). The new material is cached by source material, so meshes
 * that shared one authored material keep sharing one dressed material. A failed
 * download must leave the authored materials untouched rather than
 * half-dressed, so nothing is projected unless shouldDressNoticeFace passes.
 *
 * Returns `{ dressed, seams, materials }`, where `materials` counts the
 * distinct MeshStandardMaterial objects created (one per distinct source).
 */
export function dressNoticeFace(meshes, textures, { THREE } = {}) {
  if (!THREE || !Array.isArray(meshes) || !textures) {
    return { dressed: 0, seams: 0, materials: 0 };
  }
  const family = NOTICE_FACE_FAMILY;
  // A failed download must leave the authored materials untouched; dressing
  // some meshes and not others would look worse than flat paint.
  if (!shouldDressNoticeFace(family, textures)) {
    return { dressed: 0, seams: 0, materials: 0 };
  }

  const params = noticeFaceParams(family);
  const bySource = new Map();
  let dressed = 0;
  let seams = 0;

  for (const mesh of meshes) {
    if (!mesh || !mesh.isMesh) continue;
    const source = mesh.material;
    if (!source || !noticeFaceFamilyFor(source.name)) continue;

    // A 0.4 m tile puts about 3.5 tiles across the 1.4 m face, so the paper
    // tooth reads at the distance the board is actually read from.
    const split = projectBoxGeometry({
      THREE, geometry: mesh.geometry, tileMeters: family.tileMeters
    });
    seams += split.seams;

    let material = bySource.get(source);
    if (!material) {
      material = new THREE.MeshStandardMaterial({
        // keepTint is false: the paper albedo already carries the cream, so
        // the tint stays white or the authored 0xd8c9a8 multiplies it down to
        // brown.
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
    mesh.userData.noticeFaceDressed = true;
    dressed += 1;
  }

  return { dressed, seams, materials: bySource.size };
}
