// Where the eave fascia, the drip lip and the gable bargeboards sit on every
// roof plane, decided without a GPU.
//
// Round 103 laid the shingle field on the modelled roofs, so the courses now
// climb a real slope and end on a real eave. What the eave ends in, though, is
// the modelled roof's own thin edge: a shingle course stops and the surface
// simply stops with it, which from ground level reads as a painted strip with a
// ruler-straight bottom rather than as a roof. A real roof carries a fascia --
// a board nailed to the rafter ends, running the length of the eave, its top
// edge tucked under the last course -- and along a gable end it carries
// bargeboards that run up the rake from the eave to the ridge. The fascia
// throws the roofline into shadow and gives the silhouette a thickness; the
// bargeboards close the raking edge the eye follows from the ground.
//
// `world.js` turns each descriptor here into an instance of one of three box
// meshes; this module decides only where each board goes and how big it is, so
// it carries no Three.js, no DOM, no clock and no randomness. Two identical
// calls produce identical boards by construction rather than by seed: every
// course is a single board of a fixed section, so there is no generator at all.
//
// The caller supplies the roof planes in the same shape `shingles.js` takes --
// `{ x, z, y, width, depth, yaw, pitch }` -- with (x, z) the plane's centre, y
// the height of its TOP face at that centre, width and depth its horizontal
// footprint and pitch its rise over run. Everything else follows from that
// frame, and the module reproduces `shingles.js`'s reading of it exactly: a
// positive pitch tips the FAR edge (v = +depth/2) down, so that edge is the
// eave, and the rake edges are u = ±width/2. A flat plane (pitch 0) has no eave
// and no rake, so it is banded around all four edges instead -- a lid still
// wants a shadow where it ends -- and a negative or junk pitch is read as flat
// for the same reason `shingles.js` reads one that way: a roof that falls away
// from its own ridge is a bug, not a design.
//
// Four decisions are worth the words.
//
// 1. The boards are described in a LOCAL frame, not in world angles, so the
//    world never has to re-derive which way a board faces. Every descriptor
//    carries `yaw` and `tilt`: `yaw` rotates the board about Y, then `tilt`
//    rotates it about its own local X axis, which is exactly the composition
//    `placeShingles` already applies to a course strip. A fascia is a level
//    board, so its tilt is 0 and its local X is the length along the eave. A
//    bargeboard lies in the roof plane, so its tilt is atan(pitch) and its
//    local Z -- the axis that tilt sends downhill -- is the length up the rake,
//    while its local Y is the roof's own normal. The module therefore carries
//    `size: [x, y, z]` in that local frame, and the world composes the two
//    rotations without a single conditional.
//
// 2. The fascia's top edge stands `fasciaRise` above the roof surface and its
//    outer face `fasciaProud` past the roof edge. The rise is what tucks the
//    board under the last course without z-fighting the modelled surface --
//    2 cm is a shade over the shingle strips' own 1.2 cm lift, so the board's
//    top edge sits just proud of the tiles instead of slicing through them --
//    and the 2 cm of projection is the thickness that makes the eave read as an
//    edge from below. A board flush with the surface would disappear into it.
//
// 3. The drip is a thin sheet hung under the fascia: `lipDrop` tall, `lipGap`
//    below the fascia's bottom, its outer face set `lipSetback` back from the
//    fascia's own outer face. Its job is the shadow line -- 4 cm of sheet under
//    a 17 cm board reads as a hard break rather than as a second board -- and
//    the setback keeps it under the fascia's overhang, so the water that runs
//    off the board still lands clear of the wall below. Hung flush with the
//    fascia's face it z-fights the board; hung further out it reads as a
//    moulding and the eave gets heavy.
//
// 4. The bargeboard's section is one thickness centred ON the rake edge, not
//    pushed outside it. A bargeboard is nailed to the gable wall and its outer
//    face is flush with the roof edge; centring it leaves half the board over
//    the wall's top and half over the tiles, so neither a seam of bare wall nor
//    a plank floating in the air appears at the corner where the barge meets
//    the fascia. The two boards overlap there by their own thickness, which is
//    what a real corner looks like.
//
// Every export is total: junk input is clamped or skipped, and no call can
// yield NaN or Infinity.

/** The spec for the eave trim. world.js applies this unchanged.
 *  - `fasciaHeight` / `fasciaThickness`: the eave board's section, in metres.
 *    17 cm tall reads as a board course at courtyard distance without
 *    dominating a 0.26 m shingle course; 4.5 cm thick is the thinnest plank
 *    that still casts a shadow line of its own.
 *  - `fasciaProud` / `fasciaRise`: how far the board stands past the roof edge
 *    and above its surface, so the eave reads as an edge rather than a painted
 *    line (see the header).
 *  - `lipDrop` / `lipThickness` / `lipGap` / `lipSetback`: the drip sheet's
 *    height and thickness, the gap under the fascia's bottom, and how far it
 *    sits back from the fascia's outer face.
 *  - `bargeHeight` / `bargeThickness` / `bargeRise`: the raking board's section
 *    and how far its top edge stands proud of the roof surface along the roof
 *    normal. It is a shade shallower than the fascia so the fascia reads as the
 *    heavier board where they meet at the eave corner.
 *  - `bargeRun`: whether the raking boards run at all. Off leaves the gable
 *    edges bare; on closes them. It defaults on, because a gable whose rake is
 *    an open edge is the most visible roof defect from the ground. */
export const ROOF_EDGE = Object.freeze({
  fasciaHeight: 0.17,
  fasciaThickness: 0.045,
  fasciaProud: 0.02,
  fasciaRise: 0.02,
  lipDrop: 0.04,
  lipThickness: 0.028,
  lipGap: 0.02,
  lipSetback: 0.01,
  bargeHeight: 0.15,
  bargeThickness: 0.04,
  bargeRise: 0.02,
  bargeRun: true
});

/** The largest pitch the module will honour, matching `shingles.js`: a roof
 *  steeper than 1.2 rise over run is past anything in this world, and clamping
 *  keeps a typo from asking for a vertical board. */
const MAX_PITCH = 1.2;

/** Smallest plane dimension worth banding, in metres. A roof narrower than a
 *  millimetre is junk rather than a roof. */
const MIN_PLANE = 1e-6;

/** Largest plane the module will band, in metres, on any axis, so a typo in
 *  `width` cannot ask for a kilometre of board. */
const MAX_PLANE = 200;

/** Largest dimension any single board may take, in metres. A section thicker
 *  than 1 m is a wall, not a board, and this bounds every clamped field. */
const MAX_SECTION = 1;

/** Smallest section a board may take, in metres. Every size field (height and
 *  thickness) clamps up to this rather than to zero: a board of zero size is
 *  invisible geometry that still costs an instance, and a caller who passes a
 *  negative or tiny override wants a thin board, not a vanished one. The
 *  offsets (`fasciaRise`, `lipGap`, ...) are allowed to reach zero, because a
 *  board flush with the surface is a legitimate design. */
const MIN_SECTION = 0.004;

/** Largest outward projection any board may make past a roof edge, in metres. */
const MAX_PROJECTION = 1;

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Clamp to [lo, hi], with a non-finite value replaced by `fallback`. */
function clampNumber(value, lo, hi, fallback = lo) {
  if (!finiteNumber(value)) return fallback;
  return Math.min(hi, Math.max(lo, value));
}

/**
 * A usable roof plane, or null. Position, height, width and depth must all be
 * finite and the footprint positive: a plane without a real footprint cannot
 * carry a board, and a board placed from one would hang in the air. `yaw` and
 * `pitch` may be junk and default to 0, because an unrotated, flat roof is a
 * sensible reading of a missing angle while a missing centre is not. Width and
 * depth are clamped to the module's maxima so an absurd number cannot ask for
 * unbounded work.
 */
function usablePlane(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!finiteNumber(raw.x) || !finiteNumber(raw.z) || !finiteNumber(raw.y)) return null;
  if (!finiteNumber(raw.width) || !finiteNumber(raw.depth)) return null;
  if (raw.width <= 0 || raw.depth <= 0) return null;

  const width = Math.min(MAX_PLANE, raw.width);
  const depth = Math.min(MAX_PLANE, raw.depth);
  if (width < MIN_PLANE || depth < MIN_PLANE) return null;

  return {
    x: raw.x,
    z: raw.z,
    y: raw.y,
    width,
    depth,
    yaw: finiteNumber(raw.yaw) ? raw.yaw : 0,
    pitch: clampNumber(raw.pitch, 0, MAX_PITCH, 0)
  };
}

/** A stable id for naming, so a board on the house and one on the east stall
 *  never share a name. An explicit non-empty `id` wins; otherwise the plane's
 *  own centre, which is unique for the four real roofs and stable between runs. */
function planeId(raw, plane) {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    // `String()` runs user code: a null-prototype object throws the "Cannot
    // convert object to primitive value" TypeError, and an object with a
    // throwing `toString` throws that. The module's contract is that no export
    // can ever throw, so only a primitive id is trusted -- `String` of a
    // string, number, boolean, bigint or symbol is total -- and everything else
    // falls back to the plane's own centre. (Symbols stringify fine, but a
    // symbol id is a caller mistake rather than a name, so it is not accepted.)
    const rawId = raw.id;
    const idType = typeof rawId;
    if (idType === 'string' || idType === 'number' || idType === 'boolean' || idType === 'bigint') {
      const id = String(rawId);
      if (id.length > 0 && id !== 'null' && id !== 'undefined') return id;
    }
  }
  return `${plane.x}-${plane.z}`;
}

/** Read the spec, clamped field by field with the authored defaults as the
 *  fallbacks. Sections (anything that becomes a box dimension) clamp to
 *  [MIN_SECTION, MAX_SECTION], so a junk or negative override yields a thin
 *  board rather than a zero-size one; offsets clamp from 0, because flush is a
 *  legitimate design. Non-finite values fall back to the authored number. */
function readSpec(raw) {
  const spec = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const pick = (key, lo, hi) =>
    clampNumber(finiteNumber(spec[key]) ? spec[key] : ROOF_EDGE[key], lo, hi, ROOF_EDGE[key]);
  return {
    fasciaHeight: pick('fasciaHeight', MIN_SECTION, MAX_SECTION),
    fasciaThickness: pick('fasciaThickness', MIN_SECTION, MAX_SECTION),
    fasciaProud: pick('fasciaProud', 0, MAX_PROJECTION),
    fasciaRise: pick('fasciaRise', 0, MAX_SECTION),
    lipDrop: pick('lipDrop', MIN_SECTION, MAX_SECTION),
    lipThickness: pick('lipThickness', MIN_SECTION, MAX_SECTION),
    lipGap: pick('lipGap', 0, MAX_SECTION),
    lipSetback: pick('lipSetback', 0, MAX_PROJECTION),
    bargeHeight: pick('bargeHeight', MIN_SECTION, MAX_SECTION),
    bargeThickness: pick('bargeThickness', MIN_SECTION, MAX_SECTION),
    bargeRise: pick('bargeRise', 0, MAX_SECTION),
    bargeRun: typeof spec.bargeRun === 'boolean' ? spec.bargeRun : ROOF_EDGE.bargeRun
  };
}

/** Local (u, v) offset to a world (x, z), using the same frame as the
 *  shingles: local +u along the width, local +v along the depth, yaw about Y. */
function toWorld(plane, u, v) {
  const cos = Math.cos(plane.yaw);
  const sin = Math.sin(plane.yaw);
  return {
    x: plane.x + u * cos + v * sin,
    z: plane.z - u * sin + v * cos
  };
}

/** The roof's own upward normal, after the yaw-then-tilt composition the world
 *  applies: local +Y under Ry(yaw)·Rx(atan(pitch)). Used to stand a
 *  bargeboard's top edge proud of the sloping surface by a fixed distance
 *  measured off the roof rather than off the vertical. The sign matters: for a
 *  roof that falls towards +v the outward normal leans towards +v (a hillside
 *  facing the viewer), so the horizontal part is +sin(theta) along the local
 *  depth axis, not -sin(theta). */
function roofNormal(plane) {
  const theta = Math.atan(plane.pitch);
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const cosY = Math.cos(plane.yaw);
  const sinY = Math.sin(plane.yaw);
  // Ry(yaw) applied to Rx(theta) * (0, 1, 0) = (0, cosT, sinT).
  return { x: sinT * sinY, y: cosT, z: sinT * cosY };
}

/**
 * Every eave fascia, drip lip and gable bargeboard on the supplied roof planes.
 *
 * Options:
 *   - `planes` is the caller's array of `{ x, z, y, width, depth, yaw, pitch }`
 *     with an optional `id`. The default is an empty array: a caller who
 *     forgets gets no trim rather than an invented roof somewhere in the scene.
 *   - `spec` overrides ROOF_EDGE piece by piece; a junk entry falls back to the
 *     authored value (see `readSpec`).
 *
 * Each descriptor is `{ kind, plane, x, y, z, yaw, tilt, size, name }` in world
 * metres, with (x, y, z) the box's centre:
 *   - `kind` is `'fascia'`, `'drip'` or `'barge'`, so the world can share one
 *     material and one draw call per kind;
 *   - `yaw` rotates the box about Y and `tilt` then rotates it about its own
 *     local X, the composition `placeShingles` uses;
 *   - `size` is `[x, y, z]` in that local frame;
 *   - `name` is the stable mesh name, `roof-<kind>-<plane>-<i>`.
 *
 * A pitched plane gets a fascia and a drip along its far (eave) edge and, with
 * `bargeRun` on, a bargeboard along each rake (u = ±width/2). A flat plane gets
 * a fascia and a drip around all four edges and no bargeboard. Malformed planes
 * are skipped. The call never throws and never yields NaN or Infinity.
 */
export function roofEdgeSpans(options = {}) {
  const opts = options !== null && typeof options === 'object' && !Array.isArray(options)
    ? options
    : {};
  const spec = readSpec(opts.spec);
  if (!Array.isArray(opts.planes)) return [];

  const spans = [];

  for (let i = 0; i < opts.planes.length; i += 1) {
    const raw = opts.planes[i];
    const plane = usablePlane(raw);
    if (plane === null) continue;
    const id = planeId(raw, plane);

    // The eave edges as { axis: 'u'|'v', at: -1|1 }. `axis` names the axis the
    // edge runs PARALLEL to: an 'u' edge runs along the width at v = at *
    // depth/2, so the far eave of a pitched roof is { axis: 'u', at: 1 }. A
    // flat roof has no eave, so all four edges are banded.
    const edges = plane.pitch > 0
      ? [{ axis: 'u', at: 1 }]
      : [{ axis: 'u', at: 1 }, { axis: 'u', at: -1 }, { axis: 'v', at: 1 }, { axis: 'v', at: -1 }];

    for (let e = 0; e < edges.length; e += 1) {
      const edge = edges[e];
      const alongU = edge.axis === 'u';
      const runLength = alongU ? plane.width : plane.depth;
      // The half-extent of the axis the edge is offset along: an 'u' edge is
      // offset in v by depth/2, a 'v' edge in u by width/2.
      const half = alongU ? plane.depth / 2 : plane.width / 2;
      // The eave line's local coordinates, plus how far out past it each board
      // sits along the outward normal.
      const edgeU = alongU ? 0 : edge.at * half;
      const edgeV = alongU ? edge.at * half : 0;
      const outU = alongU ? 0 : edge.at;
      const outV = alongU ? edge.at : 0;
      // The roof surface at the eave line: a positive pitch has dropped the far
      // edge by pitch * depth/2, and a rake edge is level along its own length.
      const surfaceY = plane.y - plane.pitch * edgeV;
      // A board on an 'u' edge runs along u (the given yaw); one on a 'v' edge
      // runs along v, which is the same yaw turned a quarter.
      const boardYaw = alongU ? plane.yaw : plane.yaw - Math.PI / 2;

      // The fascia: a level board whose outer face stands `fasciaProud` past
      // the eave and whose top edge rises `fasciaRise` above the surface.
      const fasciaV = edgeV + outV * (spec.fasciaProud - spec.fasciaThickness / 2);
      const fasciaU = edgeU + outU * (spec.fasciaProud - spec.fasciaThickness / 2);
      const fasciaAt = toWorld(plane, fasciaU, fasciaV);
      spans.push({
        kind: 'fascia',
        plane: id,
        x: fasciaAt.x,
        y: surfaceY + spec.fasciaRise - spec.fasciaHeight / 2,
        z: fasciaAt.z,
        yaw: boardYaw,
        tilt: 0,
        size: [runLength, spec.fasciaHeight, spec.fasciaThickness],
        name: `roof-fascia-${id}-${e}`
      });

      // The drip: an apron hung `lipGap` below the fascia's bottom, its outer
      // face set `lipSetback` back from the fascia's, so it reads as a shadow
      // line under the board rather than a second course.
      const lipOffsetOut = spec.fasciaProud - spec.lipSetback - spec.lipThickness / 2;
      const lipU = edgeU + outU * lipOffsetOut;
      const lipV = edgeV + outV * lipOffsetOut;
      const lipAt = toWorld(plane, lipU, lipV);
      spans.push({
        kind: 'drip',
        plane: id,
        x: lipAt.x,
        y: surfaceY + spec.fasciaRise - spec.fasciaHeight - spec.lipGap - spec.lipDrop / 2,
        z: lipAt.z,
        yaw: boardYaw,
        tilt: 0,
        size: [runLength, spec.lipDrop, spec.lipThickness],
        name: `roof-drip-${id}-${e}`
      });
    }

    if (!spec.bargeRun || plane.pitch <= 0) continue;

    // The bargeboards: one along each rake, from the eave to the ridge. The
    // board lies in the roof plane, so its length runs up the slope (local Z
    // after the tilt) and its height stands along the roof normal (local Y).
    const theta = Math.atan(plane.pitch);
    const slopeLength = plane.depth * Math.sqrt(1 + plane.pitch * plane.pitch);
    const normal = roofNormal(plane);
    // The board's centre sits on the rake edge at mid-slope, then is pushed
    // down the roof normal so its top edge stands `bargeRise` proud.
    const along = -spec.bargeHeight / 2 + spec.bargeRise;
    for (let side = 0; side < 2; side += 1) {
      const at = side === 0 ? 1 : -1;
      const centre = toWorld(plane, at * plane.width / 2, 0);
      spans.push({
        kind: 'barge',
        plane: id,
        x: centre.x + normal.x * along,
        y: plane.y + normal.y * along,
        z: centre.z + normal.z * along,
        yaw: plane.yaw,
        tilt: theta,
        size: [spec.bargeThickness, spec.bargeHeight, slopeLength],
        name: `roof-barge-${id}-${side}`
      });
    }
  }

  return spans;
}

/**
 * How many boards `roofEdgeSpans` would lay, without building the descriptors.
 * Same options and same guards, so the count and the array always agree.
 */
export function roofEdgeCount(options = {}) {
  return roofEdgeSpans(options).length;
}

/**
 * Only the boards of one kind, for a caller that wants a single course. `kind`
 * must be `'fascia'`, `'drip'` or `'barge'`; anything else yields an empty
 * array rather than a guess, so a typo shows up as a missing course instead of
 * a course of the wrong one.
 */
export function roofEdgeOfKind(kind, options = {}) {
  if (kind !== 'fascia' && kind !== 'drip' && kind !== 'barge') return [];
  return roofEdgeSpans(options).filter((span) => span.kind === kind);
}

/** Whether the trim runs at this quality tier. The low tier drops the boards,
 *  consistent with the quality-tier convention: each kind is a draw call, which
 *  is exactly the cost the low tier exists to shed, and a roof without its
 *  fascia still reads as a roof because the shingles carry the silhouette. Junk
 *  reads as the full tier, so an unexpected tier never silently strips the
 *  rooflines back to bare edges. */
export function roofEdgeEnabled(tier) {
  return tier !== 'low';
}
