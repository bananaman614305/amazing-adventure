// Minimal GLB (binary glTF 2.0) reader for the one asset pipeline this game has.
//
// Why not GLTFLoader: the vendored three.module.min.js is the core build and does
// not include the examples/jsm loaders, and adding a second vendored file for one
// mesh is more surface than the mesh deserves. GLB is a simple container: a JSON
// chunk plus a binary chunk, and the fountain uses only POSITION/NORMAL indices
// and a base-colour factor. This reader handles exactly that subset and refuses
// anything else loudly, so a future asset that needs more cannot silently load
// wrong.
//
// Pure apart from the Three.js geometry constructors, so the parsing half can be
// unit-tested in Node with a fake THREE.

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COUNTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** Parses a GLB ArrayBuffer into { json, bin }. Throws on anything unexpected. */
export function parseGlb(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 12) throw new Error('GLB too short');
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a GLB file');
  const version = view.getUint32(4, true);
  if (version !== 2) throw new Error(`unsupported glTF version ${version}`);
  const total = view.getUint32(8, true);
  if (total > view.byteLength) throw new Error('GLB length exceeds buffer');

  let json = null;
  let bin = null;
  let offset = 12;
  while (offset + 8 <= total) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + length > total) throw new Error('GLB chunk overruns file');
    if (type === CHUNK_JSON) {
      json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, length)));
    } else if (type === CHUNK_BIN) {
      bin = new Uint8Array(buffer, start, length);
    }
    offset = start + length;
  }
  if (!json) throw new Error('GLB has no JSON chunk');
  return { json, bin };
}

/** Reads one accessor into a typed array. Only the component types we emit. */
export function readAccessor(json, bin, index) {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView];
  if (view.buffer !== 0) throw new Error('only the GLB binary chunk is supported');
  const count = accessor.count * TYPE_COUNTS[accessor.type];
  const byteOffset = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const stride = view.byteStride;
  const comp = COMPONENT_BYTES[accessor.componentType];
  if (!comp) throw new Error(`unsupported component type ${accessor.componentType}`);

  const Ctor = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array,
    5121: Uint8Array, 5122: Int16Array, 5120: Int8Array }[accessor.componentType];

  if (!stride || stride === comp * TYPE_COUNTS[accessor.type]) {
    return new Ctor(bin.buffer, bin.byteOffset + byteOffset, count);
  }
  // Interleaved: de-interleave element by element.
  const out = new Ctor(count);
  const per = TYPE_COUNTS[accessor.type];
  const dv = new DataView(bin.buffer, bin.byteOffset);
  const read = { 5126: 'Float32', 5125: 'Uint32', 5123: 'Uint16',
    5121: 'Uint8', 5122: 'Int16', 5120: 'Int8' }[accessor.componentType];
  for (let i = 0; i < accessor.count; i += 1) {
    for (let c = 0; c < per; c += 1) {
      out[i * per + c] = dv[`get${read}`](byteOffset + i * stride + c * comp, true);
    }
  }
  return out;
}

/**
 * Builds Three.js meshes from a parsed GLB. `THREE` is injected so the parser can
 * be tested without a renderer. Returns an array of { name, geometry, material }
 * descriptions; the caller decides what to add to the scene.
 *
 * Supported subset: triangles, POSITION + NORMAL, indices, one primitive per
 * mesh, baseColourFactor materials. Anything else throws.
 */
export function glbToMeshes(parsed, THREE) {
  const { json, bin } = parsed;
  if (json.animations?.length) throw new Error('animations not supported');
  if (json.skins?.length) throw new Error('skins not supported');
  if (json.images?.length || json.textures?.length) throw new Error('embedded textures not supported');

  const materials = (json.materials || []).map((m) => {
    const pbr = m.pbrMetallicRoughness || {};
    const factor = pbr.baseColorFactor || [1, 1, 1, 1];
    const color = new THREE.Color(factor[0], factor[1], factor[2]);
    // glTF factors are linear; Three.js Color setters expect sRGB for hex but
    // direct component assignment is linear, which is what we want here.
    return new THREE.MeshStandardMaterial({
      color,
      roughness: pbr.roughnessFactor ?? 1,
      metalness: pbr.metallicFactor ?? 0,
      name: m.name || ''
    });
  });

  const meshes = [];
  for (const mesh of json.meshes || []) {
    if (mesh.primitives.length !== 1) throw new Error('one primitive per mesh only');
    const prim = mesh.primitives[0];
    if (prim.mode !== undefined && prim.mode !== 4) throw new Error('triangles only');
    const attrs = prim.attributes;
    if (attrs.POSITION === undefined) throw new Error('mesh has no POSITION');
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(readAccessor(json, bin, attrs.POSITION), 3));
    if (attrs.NORMAL !== undefined) {
      geometry.setAttribute('normal', new THREE.BufferAttribute(readAccessor(json, bin, attrs.NORMAL), 3));
    }
    // UVs are optional in this pipeline: Blender only writes TEXCOORD_0 for a
    // mesh that has a UV layer. Models authored without one get box-projected
    // UVs later in assets.js (see ensureUvs), so this must not throw.
    if (attrs.TEXCOORD_0 !== undefined) {
      geometry.setAttribute('uv', new THREE.BufferAttribute(readAccessor(json, bin, attrs.TEXCOORD_0), 2));
    }
    if (prim.indices !== undefined) {
      geometry.setIndex(new THREE.BufferAttribute(readAccessor(json, bin, prim.indices), 1));
    }
    if (attrs.NORMAL === undefined) geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    meshes.push({
      name: mesh.name || '',
      geometry,
      material: materials[prim.material] || materials[0]
    });
  }
  return meshes;
}

/** Convenience: ArrayBuffer -> mesh descriptions. */
export function loadGlb(buffer, THREE) {
  return glbToMeshes(parseGlb(buffer), THREE);
}
