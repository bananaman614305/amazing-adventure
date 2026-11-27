// The roofedge module decides where every eave fascia, drip lip and gable
// bargeboard sits on the caller's roof planes, and how big each board is; the
// world turns those descriptors into box instances. These tests hold the module
// to its contract: the authored constants and their ordering, the frozen spec,
// the empty and junk-plane guards, totality on junk options/spec/planes, the
// determinism, the per-shape counts (a pitched plane gets one eave and two
// rakes, a flat plane is banded on all four edges), the fascia sitting at the
// eave with its documented rise, the drip hanging under it by the gap and back
// by the setback, the barge lying in the roof plane with its top a fixed
// distance proud of the surface along the roof normal, the local size frame,
// the exact field set and unique names, and the count/kind/quality helpers.
//
// The four planes below are the production roofs, copied verbatim so the
// integration and this suite describe the same roofs.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ROOF_EDGE, roofEdgeSpans, roofEdgeCount, roofEdgeOfKind, roofEdgeEnabled
} from '../src/roofedge.js';

const S = ROOF_EDGE;

const FIELDS = ['kind', 'plane', 'x', 'y', 'z', 'yaw', 'tilt', 'size', 'name'];
const KINDS = new Set(['fascia', 'drip', 'barge']);

/** The production roofs, exactly as world.js supplies them. */
const REAL_PLANES = [
  { x: -10.5, z: -7.467059, y: 3.861765, width: 8, depth: 3.132353, yaw: 0, pitch: 0.533333, id: 'house-south' },
  { x: -10.5, z: -10.532941, y: 3.861765, width: 8, depth: 3.132353, yaw: Math.PI, pitch: 0.533333, id: 'house-north' },
  { x: 11, z: -3.1, y: 0.94, width: 4.3, depth: 1, yaw: 0, pitch: 0.2, id: 'east' },
  { x: -11, z: 5.925, y: 0.846, width: 3.225, depth: 0.75, yaw: 0, pitch: 0.24, id: 'west' }
];

/** A pitched, yawed plane used by the geometric tests. */
const PLANE = { x: 4, z: -2, y: 5, width: 6, depth: 2, yaw: 0.7, pitch: 0.4, id: 'test' };

/** A flat, yawed plane: four banded edges, no bargeboards. */
const FLAT = { x: 0, z: 0, y: 1, width: 3, depth: 2, yaw: 0.3, pitch: 0, id: 'flat' };

/** Rotate a world (x, z) back into the plane's local (u, v) frame, the exact
 *  inverse of the module's toWorld. */
function toLocal(plane, x, z) {
  const cos = Math.cos(plane.yaw);
  const sin = Math.sin(plane.yaw);
  const dx = x - plane.x;
  const dz = z - plane.z;
  return { u: dx * cos - dz * sin, v: dx * sin + dz * cos };
}

/** The module's own local-to-world map, for comparing expected centres. */
function toWorld(plane, u, v) {
  const cos = Math.cos(plane.yaw);
  const sin = Math.sin(plane.yaw);
  return {
    x: plane.x + u * cos + v * sin,
    z: plane.z - u * sin + v * cos
  };
}

/** The roof's upward normal under Ry(yaw)·Rx(atan(pitch)), the composition the
 *  module documents for the bargeboard's local Y. */
function roofNormal(plane) {
  const theta = Math.atan(plane.pitch);
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  return { x: sinT * Math.sin(plane.yaw), y: cosT, z: sinT * Math.cos(plane.yaw) };
}

function countKind(spans, kind) {
  return spans.filter((span) => span.kind === kind).length;
}

test('the authored constants are the ones the world relies on', () => {
  assert.equal(S.fasciaHeight, 0.17);
  assert.equal(S.fasciaThickness, 0.045);
  assert.equal(S.fasciaProud, 0.02);
  assert.equal(S.fasciaRise, 0.02);
  assert.equal(S.lipDrop, 0.04);
  assert.equal(S.lipThickness, 0.028);
  assert.equal(S.lipGap, 0.02);
  assert.equal(S.lipSetback, 0.01);
  assert.equal(S.bargeHeight, 0.15);
  assert.equal(S.bargeThickness, 0.04);
  assert.equal(S.bargeRise, 0.02);
  assert.equal(S.bargeRun, true);
});

test('the spec is frozen so world.js can apply it unchanged', () => {
  assert.ok(Object.isFrozen(ROOF_EDGE));
});

test('the header ordering claims hold', () => {
  // The fascia is the heavier board where the two meet at the eave corner.
  assert.ok(S.fasciaHeight > S.bargeHeight,
    `fascia ${S.fasciaHeight} is not taller than barge ${S.bargeHeight}`);
  // The drip is a shadow line under a board, not a second board.
  assert.ok(S.lipDrop < S.fasciaHeight * 0.5,
    `lipDrop ${S.lipDrop} is not well under fasciaHeight ${S.fasciaHeight}`);
  // The drip sits back from the fascia's face, keeping it under the overhang.
  assert.ok(S.lipSetback < S.fasciaProud,
    `lipSetback ${S.lipSetback} is not behind fasciaProud ${S.fasciaProud}`);
  // Section thicknesses are real, positive boards.
  for (const key of ['fasciaThickness', 'lipThickness', 'bargeThickness', 'fasciaHeight', 'lipDrop', 'bargeHeight']) {
    assert.ok(S[key] > 0, `${key} is not a positive size`);
  }
});

test('empty and junk planes yield an empty array and never throw', () => {
  assert.deepEqual(roofEdgeSpans(), []);
  assert.deepEqual(roofEdgeSpans({}), []);
  assert.deepEqual(roofEdgeSpans({ planes: [] }), []);
  assert.deepEqual(roofEdgeSpans({ planes: undefined }), []);
  assert.deepEqual(roofEdgeSpans({ planes: null }), []);
  assert.deepEqual(roofEdgeSpans({ planes: 42 }), []);
  assert.deepEqual(roofEdgeSpans({ planes: 'nope' }), []);

  const junkPlanes = [
    null, undefined, 42, 'x', true, [], {},
    { x: 0, z: 0, y: 0, width: 0, depth: 2 },
    { x: 0, z: 0, y: 0, width: 2, depth: 0 },
    { x: 0, z: 0, y: 0, width: -2, depth: 2 },
    { x: 0, z: 0, y: 0, width: 2, depth: -2 },
    { x: NaN, z: 0, y: 0, width: 2, depth: 2 },
    { x: 0, z: 0, y: NaN, width: 2, depth: 2 },
    { x: 0, z: 0, y: 0, width: NaN, depth: 2 },
    { x: 0, z: 0, y: 0, width: 2, depth: Infinity }
  ];
  assert.deepEqual(roofEdgeSpans({ planes: junkPlanes }), []);
  // A junk entry beside a real plane is skipped, not fatal.
  assert.equal(roofEdgeSpans({ planes: [null, 42, PLANE, 'x'] }).length, 4);
});

test('junk options read as empty and never throw', () => {
  for (const junk of [null, 42, 'x', true, [], NaN, undefined]) {
    assert.deepEqual(roofEdgeSpans(junk), [], `options ${String(junk)} was not empty`);
    assert.equal(roofEdgeCount(junk), 0);
  }
});

test('a junk spec is tolerated and clamped to finite sizes', () => {
  const spans = roofEdgeSpans({
    planes: [PLANE],
    spec: { fasciaHeight: -5, lipDrop: 'x' }
  });
  assert.ok(spans.length > 0);
  for (const span of spans) {
    for (const value of span.size) assert.ok(Number.isFinite(value), `${span.name} size is not finite`);
    for (const key of ['x', 'y', 'z', 'yaw', 'tilt']) {
      assert.ok(Number.isFinite(span[key]), `${span.name}.${key} is not finite`);
    }
  }
  // A non-finite override falls back to the authored value: the drip keeps its
  // authored height rather than collapsing.
  const drip = spans.find((span) => span.kind === 'drip');
  assert.equal(drip.size[1], S.lipDrop);

  // Junk spec containers and absurd-but-finite overrides stay finite and
  // non-negative. (A negative override clamping to 0 rather than to a positive
  // minimum is a known module bug pinned by the todo test at the foot of this
  // file, so positivity is not asserted here.)
  for (const spec of [null, 42, 'x', [], {}, { fasciaHeight: Infinity },
    { fasciaHeight: 1e9, bargeThickness: -1, lipGap: NaN }]) {
    for (const span of roofEdgeSpans({ planes: [PLANE], spec })) {
      for (const value of span.size) {
        assert.ok(Number.isFinite(value), `${span.name} size is not finite`);
        assert.ok(value >= 0, `${span.name} size is negative`);
      }
    }
  }
});

test('no descriptor ever contains NaN or Infinity across a junk sweep', () => {
  const planes = [
    PLANE,
    FLAT,
    { x: 0, z: 0, y: 0, width: 1e9, depth: 1e9, yaw: NaN, pitch: 1e9, id: 'huge' },
    { x: -1e9, z: 1e9, y: 1e9, width: 1e-3, depth: 1e-3, yaw: Infinity, pitch: -1, id: 'tiny' },
    { x: 1, z: 2, y: 3, width: 2, depth: 2 },
    null, 42, 'x'
  ];
  const specs = [
    undefined,
    {},
    { fasciaHeight: -5, lipDrop: 'x' },
    { bargeHeight: NaN, bargeThickness: Infinity, lipSetback: -1 },
    { fasciaRise: 1e9, lipGap: -1e9, bargeRise: 'x', bargeRun: 'yes' }
  ];
  for (const plane of planes) {
    for (const spec of specs) {
      const spans = roofEdgeSpans({ planes: [plane], spec });
      for (const span of spans) {
        for (const key of ['x', 'y', 'z', 'yaw', 'tilt']) {
          assert.ok(Number.isFinite(span[key]), `${span.name}.${key} is not finite`);
        }
        for (const value of span.size) {
          assert.ok(Number.isFinite(value), `${span.name} size entry is not finite`);
        }
      }
    }
  }
});

test('roofEdgeSpans is deterministic for identical arguments', () => {
  assert.deepEqual(roofEdgeSpans({ planes: [PLANE] }), roofEdgeSpans({ planes: [PLANE] }));
  assert.deepEqual(
    roofEdgeSpans({ planes: REAL_PLANES }),
    roofEdgeSpans({ planes: REAL_PLANES })
  );
});

test('a pitched plane gets one fascia, one drip and two bargeboards', () => {
  const spans = roofEdgeSpans({ planes: [PLANE] });
  assert.equal(countKind(spans, 'fascia'), 1);
  assert.equal(countKind(spans, 'drip'), 1);
  assert.equal(countKind(spans, 'barge'), 2);
  assert.equal(spans.length, 4);
});

test('a flat plane is banded on all four edges and carries no bargeboard', () => {
  const spans = roofEdgeSpans({ planes: [FLAT] });
  assert.equal(countKind(spans, 'fascia'), 4);
  assert.equal(countKind(spans, 'drip'), 4);
  assert.equal(countKind(spans, 'barge'), 0);
  assert.equal(spans.length, 8);
});

test('a junk pitch reads as flat', () => {
  for (const pitch of [-1, NaN, Infinity, -Infinity, 'x', undefined, null]) {
    const spans = roofEdgeSpans({ planes: [{ ...FLAT, pitch }] });
    assert.equal(countKind(spans, 'fascia'), 4, `pitch ${String(pitch)} did not read as flat`);
    assert.equal(countKind(spans, 'drip'), 4, `pitch ${String(pitch)} did not read as flat`);
    assert.equal(countKind(spans, 'barge'), 0, `pitch ${String(pitch)} grew a bargeboard`);
    assert.equal(spans.length, 8);
  }
});

test('bargeRun off drops the raking boards but keeps the eave trim', () => {
  const spans = roofEdgeSpans({ planes: [PLANE], spec: { bargeRun: false } });
  assert.equal(countKind(spans, 'barge'), 0);
  assert.equal(countKind(spans, 'fascia'), 1);
  assert.equal(countKind(spans, 'drip'), 1);
  // A non-boolean bargeRun falls back to the authored on.
  assert.equal(countKind(roofEdgeSpans({ planes: [PLANE], spec: { bargeRun: 'yes' } }), 'barge'), 2);
});

test('the fascia sits at the eave, risen above the surface', () => {
  const fascia = roofEdgeSpans({ planes: [PLANE] }).find((span) => span.kind === 'fascia');
  const local = toLocal(PLANE, fascia.x, fascia.z);

  // The board's section is centred just inside the eave line so its outer face
  // stands fasciaProud past the edge and the eave lies within the board.
  const expectedV = PLANE.depth / 2 + S.fasciaProud - S.fasciaThickness / 2;
  assert.ok(Math.abs(local.v - expectedV) < 1e-9, `fascia v ${local.v} is not ${expectedV}`);
  assert.ok(Math.abs(local.u) < 1e-9, `fascia u ${local.u} is not on the eave's centre`);
  assert.ok(local.v - S.fasciaThickness / 2 <= PLANE.depth / 2 + 1e-9,
    'fascia inner face is outside the eave line');
  assert.ok(local.v + S.fasciaThickness / 2 >= PLANE.depth / 2 - 1e-9,
    'fascia outer face does not reach the eave line');
  assert.ok(Math.abs((local.v + S.fasciaThickness / 2) - (PLANE.depth / 2 + S.fasciaProud)) < 1e-9,
    'fascia outer face is not fasciaProud past the eave');

  // Its top edge stands fasciaRise above the roof surface at the eave.
  const surfaceY = PLANE.y - PLANE.pitch * (PLANE.depth / 2);
  const expectedY = surfaceY + S.fasciaRise - S.fasciaHeight / 2;
  assert.ok(Math.abs(fascia.y - expectedY) < 1e-9, `fascia y ${fascia.y} is not ${expectedY}`);
  assert.equal(fascia.tilt, 0);
  assert.equal(fascia.yaw, PLANE.yaw);
});

test('the fascia sits at the eave on the north roof, pinning the yaw sign', () => {
  const north = REAL_PLANES.find((plane) => plane.id === 'house-north');
  const fascia = roofEdgeSpans({ planes: [north] }).find((span) => span.kind === 'fascia');
  const expectedV = north.depth / 2 + S.fasciaProud - S.fasciaThickness / 2;

  // With yaw = PI, local +v maps to world -z, so the eave is at z = plane.z - v.
  // The expected world centre is the module's own toWorld applied to (0, v).
  const expected = toWorld(north, 0, expectedV);
  assert.ok(Math.abs(fascia.x - expected.x) < 1e-9, `north fascia x ${fascia.x} is not ${expected.x}`);
  assert.ok(Math.abs(fascia.z - expected.z) < 1e-9, `north fascia z ${fascia.z} is not ${expected.z}`);
  assert.ok(Math.abs(fascia.z - (north.z - expectedV)) < 1e-9,
    `north fascia z ${fascia.z} is not the far edge z ${north.z - expectedV}`);

  const surfaceY = north.y - north.pitch * (north.depth / 2);
  const expectedY = surfaceY + S.fasciaRise - S.fasciaHeight / 2;
  assert.ok(Math.abs(fascia.y - expectedY) < 1e-9, `north fascia y ${fascia.y} is not ${expectedY}`);
});

test('the drip hangs below the fascia and set back from its face', () => {
  const spans = roofEdgeSpans({ planes: [PLANE] });
  const fascia = spans.find((span) => span.kind === 'fascia');
  const drip = spans.find((span) => span.kind === 'drip');

  // Top of the drip is lipGap below the bottom of the fascia.
  const fasciaBottom = fascia.y - S.fasciaHeight / 2;
  const dripTop = drip.y + S.lipDrop / 2;
  assert.ok(Math.abs(dripTop - (fasciaBottom - S.lipGap)) < 1e-9,
    `drip top ${dripTop} is not lipGap under the fascia bottom ${fasciaBottom}`);

  // The drip's outer face is lipSetback behind the fascia's outer face.
  const fasciaLocal = toLocal(PLANE, fascia.x, fascia.z);
  const dripLocal = toLocal(PLANE, drip.x, drip.z);
  const fasciaOuter = fasciaLocal.v + S.fasciaThickness / 2;
  const dripOuter = dripLocal.v + S.lipThickness / 2;
  assert.ok(Math.abs((fasciaOuter - dripOuter) - S.lipSetback) < 1e-9,
    `drip outer face is ${fasciaOuter - dripOuter} behind the fascia, not ${S.lipSetback}`);

  assert.equal(drip.tilt, 0);
  assert.equal(drip.yaw, PLANE.yaw);
  assert.equal(drip.size[1], S.lipDrop);
  assert.equal(drip.size[2], S.lipThickness);
});

test('the barge lies in the roof plane and stands bargeRise proud', () => {
  const barges = roofEdgeSpans({ planes: [PLANE] }).filter((span) => span.kind === 'barge');
  assert.equal(barges.length, 2);
  const theta = Math.atan(PLANE.pitch);
  const normal = roofNormal(PLANE);
  const slopeLength = PLANE.depth * Math.sqrt(1 + PLANE.pitch * PLANE.pitch);

  const us = [];
  for (const barge of barges) {
    assert.ok(Math.abs(barge.tilt - theta) < 1e-12, `barge tilt ${barge.tilt} is not atan(pitch) ${theta}`);
    assert.equal(barge.yaw, PLANE.yaw);
    assert.ok(Math.abs(barge.size[2] - slopeLength) < 1e-9,
      `barge length ${barge.size[2]} is not ${slopeLength}`);
    assert.equal(barge.size[0], S.bargeThickness);
    assert.equal(barge.size[1], S.bargeHeight);

    // The centre stays on a rake edge: its local u is +-width/2.
    const local = toLocal(PLANE, barge.x, barge.z);
    assert.ok(Math.abs(Math.abs(local.u) - PLANE.width / 2) < 1e-9,
      `barge u ${local.u} is not on a rake edge`);
    us.push(local.u);

    // The top face centre stands bargeRise above the roof surface, measured
    // along the roof normal from the rake point at the same side.
    const at = local.u > 0 ? 1 : -1;
    const rake = toWorld(PLANE, at * PLANE.width / 2, 0);
    const topX = barge.x + normal.x * (barge.size[1] / 2);
    const topY = barge.y + normal.y * (barge.size[1] / 2);
    const topZ = barge.z + normal.z * (barge.size[1] / 2);
    const dx = topX - rake.x;
    const dy = topY - PLANE.y;
    const dz = topZ - rake.z;
    const rise = dx * normal.x + dy * normal.y + dz * normal.z;
    assert.ok(Math.abs(rise - S.bargeRise) < 1e-9,
      `barge top stands ${rise} above the roof, not ${S.bargeRise}`);
  }

  // The two barges sit at the two opposite rake edges.
  assert.ok(Math.abs(us[0] - PLANE.width / 2) < 1e-9, `first barge u ${us[0]} is not +width/2`);
  assert.ok(Math.abs(us[1] + PLANE.width / 2) < 1e-9, `second barge u ${us[1]} is not -width/2`);
});

test('size is [length, height, thickness] in the local frame', () => {
  // On a pitched plane the single eave edge runs along the width.
  const fascia = roofEdgeSpans({ planes: [PLANE] }).find((span) => span.kind === 'fascia');
  assert.deepEqual(fascia.size, [PLANE.width, S.fasciaHeight, S.fasciaThickness]);

  // On a flat plane, the two u-edges run along the width and the two v-edges
  // along the depth; the v-edges are yawed a quarter turn.
  const flat = roofEdgeSpans({ planes: [FLAT] });
  for (const span of flat) {
    const alongV = Math.abs(span.yaw - (FLAT.yaw - Math.PI / 2)) < 1e-9;
    const alongU = Math.abs(span.yaw - FLAT.yaw) < 1e-9;
    assert.ok(alongU || alongV, `${span.name} has an unexpected yaw`);
    const expectedLength = alongU ? FLAT.width : FLAT.depth;
    const expectedHeight = span.kind === 'fascia' ? S.fasciaHeight : S.lipDrop;
    const expectedThickness = span.kind === 'fascia' ? S.fasciaThickness : S.lipThickness;
    assert.equal(span.size.length, 3);
    assert.ok(Math.abs(span.size[0] - expectedLength) < 1e-9,
      `${span.name} length ${span.size[0]} is not ${expectedLength}`);
    assert.equal(span.size[1], expectedHeight);
    assert.equal(span.size[2], expectedThickness);
  }
});

test('every descriptor carries the exact field set, a valid kind and a name', () => {
  const spans = roofEdgeSpans({ planes: REAL_PLANES });
  assert.ok(spans.length > 0);
  for (const span of spans) {
    assert.deepEqual(Object.keys(span).sort(), [...FIELDS].sort(), `${span.name} field set differs`);
    assert.ok(KINDS.has(span.kind), `${span.name} has kind ${span.kind}`);
    assert.equal(typeof span.plane, 'string');
    assert.ok(span.name.startsWith('roof-'), `${span.name} is not roof-prefixed`);
    assert.ok(span.name.includes(span.plane), `${span.name} does not contain its plane id ${span.plane}`);
  }
});

test('a plane without an id still names its boards by its centre', () => {
  const plane = { x: 2.5, z: -3.5, y: 1, width: 2, depth: 2, yaw: 0, pitch: 0.2 };
  const spans = roofEdgeSpans({ planes: [plane] });
  assert.ok(spans.length > 0);
  for (const span of spans) {
    assert.equal(span.plane, '2.5--3.5');
    assert.ok(span.name.includes('2.5--3.5'), `${span.name} lost the centre id`);
  }
});

test('names are unique across a four-plane call', () => {
  const spans = roofEdgeSpans({ planes: REAL_PLANES });
  const names = spans.map((span) => span.name);
  assert.equal(new Set(names).size, names.length, 'duplicate board name');
});

test('the four production roofs lay sixteen boards', () => {
  const spans = roofEdgeSpans({ planes: REAL_PLANES });
  assert.equal(spans.length, 16, `total ${spans.length}`);
  assert.equal(countKind(spans, 'fascia'), 4);
  assert.equal(countKind(spans, 'drip'), 4);
  assert.equal(countKind(spans, 'barge'), 8);
  // Each real roof is pitched, so each contributes one fascia, one drip and two
  // bargeboards.
  for (const plane of REAL_PLANES) {
    const onPlane = spans.filter((span) => span.plane === plane.id);
    assert.equal(onPlane.length, 4, `${plane.id} laid ${onPlane.length} boards`);
    assert.equal(countKind(onPlane, 'fascia'), 1, `${plane.id} fascia count`);
    assert.equal(countKind(onPlane, 'drip'), 1, `${plane.id} drip count`);
    assert.equal(countKind(onPlane, 'barge'), 2, `${plane.id} barge count`);
  }
});

test('roofEdgeCount agrees with roofEdgeSpans length for several inputs', () => {
  const cases = [
    undefined,
    {},
    { planes: [] },
    { planes: null },
    { planes: 42 },
    { planes: 'nope' },
    { planes: [PLANE] },
    { planes: [FLAT] },
    { planes: REAL_PLANES },
    { planes: [null, 42, PLANE, 'x'] },
    { planes: [PLANE], spec: { bargeRun: false } },
    { planes: [PLANE], spec: { fasciaHeight: -5 } }
  ];
  for (const options of cases) {
    assert.equal(
      roofEdgeCount(options),
      roofEdgeSpans(options).length,
      `count disagreed for ${JSON.stringify(options)}`
    );
  }
});

test('roofEdgeOfKind returns only the requested kind and [] for a junk kind', () => {
  const options = { planes: REAL_PLANES };
  for (const kind of ['fascia', 'drip', 'barge']) {
    const ofKind = roofEdgeOfKind(kind, options);
    assert.ok(ofKind.length > 0, `${kind} came back empty`);
    for (const span of ofKind) assert.equal(span.kind, kind);
    assert.equal(ofKind.length, countKind(roofEdgeSpans(options), kind));
  }
  for (const junk of [undefined, null, 'Fascia', 'bargeboard', 42, {}, []]) {
    assert.deepEqual(roofEdgeOfKind(junk, options), [], `junk kind ${String(junk)} was not empty`);
  }
});

test('roofEdgeEnabled is false only for the low tier', () => {
  assert.equal(roofEdgeEnabled('low'), false);
  assert.equal(roofEdgeEnabled('full'), true);
  for (const junk of [undefined, null, 'LOW', 'high', 42, {}, []]) {
    assert.equal(roofEdgeEnabled(junk), true, `tier ${String(junk)} should read as full`);
  }
});

// A section field is a box dimension, so a negative or tiny override must clamp
// up to a positive minimum rather than to zero: a zero-size board is invisible
// geometry that still costs an instance, and readSpec's contract says a junk
// override can never ask for a board of zero size.
test('a negative section override still yields a positive-size board', () => {
  const specs = [
    { fasciaHeight: -5 },
    { fasciaThickness: -1 },
    { lipDrop: -2 },
    { lipThickness: 0 },
    { bargeHeight: -0.5 },
    { bargeThickness: 0 },
    { fasciaHeight: 0, bargeHeight: 0, lipDrop: 0, lipThickness: 0, fasciaThickness: 0, bargeThickness: 0 }
  ];
  for (const spec of specs) {
    const spans = roofEdgeSpans({ planes: [PLANE], spec });
    assert.ok(spans.length > 0, `spec ${JSON.stringify(spec)} produced no boards`);
    for (const span of spans) {
      for (const value of span.size) {
        assert.ok(value > 0, `${span.name} has a non-positive size entry ${value} for ${JSON.stringify(spec)}`);
      }
    }
  }
});
