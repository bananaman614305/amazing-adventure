// The walltrim module decides where the coping course, the plinth course and the
// pilaster strips sit on the five border-wall runs, and the world turns those
// numbers into box meshes. These tests hold the module to its contract: the
// authored spec and its bands, the five runs agreeing with the world's own
// geometry, determinism, totality on junk input, the coping sitting exactly on
// the 3.2 m wall top, the plinth and pilaster inner faces staying inside the
// keep-clear margin, no pilaster landing in the gate opening, every name being
// unique and correctly prefixed, and every size/position carrying finite numbers.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WALL_TRIM, WALL_TRIM_HEIGHT, WALL_TRIM_SEED,
  wallRuns, copingFor, plinthFor, pilastersFor, wallTrimLayout, wallTrimEnabled
} from '../src/walltrim.js';
import { WORLD_SIZE, HALF } from '../src/terrain.js';
import { NORTH_WALL_SEGMENTS, GATE } from '../src/areas.js';

/** Half the wall's 1 m thickness: the boxes straddle the wall line. */
const WALL_HALF_THICK = 0.5;

/** The wall inner faces stand this far from the centre (16.5 m). */
const INNER_FACE = HALF - WALL_HALF_THICK;

/** The window/ivy plane the trim must never reach (HALF - 0.52). */
const WINDOW_PLANE = HALF - 0.52;

const SIZES = ['size', 'position'];

/** Every finite number in a box descriptor, checked without throwing. */
function allFinite(box) {
  for (const field of SIZES) {
    for (const value of box[field]) {
      if (!Number.isFinite(value)) return false;
    }
  }
  return true;
}

/** Index of the dimension perpendicular to a run's axis. An x-run's depth is
 *  along z (size[2]); a z-run's depth is along x (size[0]). The size and
 *  position arrays share this index, so it locates a piece's wall-normal
 *  extent and centre. */
function perpIndex(run) {
  return run.axis === 'x' ? 2 : 0;
}

/** A box's inward projection past the wall's inner face, in metres. Inward is
 *  toward the plaza centre (a smaller absolute coordinate); a piece flush with
 *  the inner face reports 0 and one entirely inside the wall reports negative. */
function inwardProjection(run, box) {
  const i = perpIndex(run);
  const sign = run.fixed >= 0 ? 1 : -1;
  const innerFace = run.fixed - sign * WALL_HALF_THICK;
  const innerEdge = sign >= 0
    ? box.position[i] - box.size[i] / 2
    : box.position[i] + box.size[i] / 2;
  return (innerFace - innerEdge) * sign;
}

/** A box's inner-edge coordinate on the wall-normal axis: the point of the
 *  piece nearest the courtyard. For a piece inside the wall this is a little
 *  under the inner face; the window/ivy plane sits a further 0.02 m in, so a
 *  piece whose inner edge is at or outside that plane cannot touch the glass. */
function innerEdgeCoord(run, box) {
  const i = perpIndex(run);
  return run.fixed >= 0
    ? box.position[i] - box.size[i] / 2
    : box.position[i] + box.size[i] / 2;
}

/** A box's outward overhang past the wall's outer face, in metres. */
function outwardOverhang(run, box) {
  const i = perpIndex(run);
  const sign = run.fixed >= 0 ? 1 : -1;
  const outerFace = run.fixed + sign * WALL_HALF_THICK;
  const outerEdge = sign >= 0
    ? box.position[i] + box.size[i] / 2
    : box.position[i] - box.size[i] / 2;
  return (outerEdge - outerFace) * sign;
}

test('the authored spec is the one the world relies on', () => {
  assert.equal(WALL_TRIM_HEIGHT, 3.2);
  assert.equal(WALL_TRIM.copingHeight, 0.22);
  assert.equal(WALL_TRIM.copingProjection, 0.14);
  assert.equal(WALL_TRIM.plinthHeight, 0.45);
  assert.equal(WALL_TRIM.plinthProjection, 0.12);
  assert.equal(WALL_TRIM.pilasterWidth, 0.5);
  assert.equal(WALL_TRIM.pilasterHeight, 0.32);
  assert.equal(WALL_TRIM.pilasterProjection, 0.28);
  assert.equal(WALL_TRIM.pilasterMinSpacing, 4);
  assert.equal(WALL_TRIM.pilasterMaxSpacing, 6);
  assert.equal(WALL_TRIM.keepClear, 0.3);
  assert.equal(WALL_TRIM.tileMeters, 1.6);
  // The seed is fixed so every run lays out the same trim.
  assert.equal(WALL_TRIM_SEED, 0x5a7d2e);
});

test('the spec bands are ordered and every projection is under the keep-clear margin', () => {
  assert.ok(WALL_TRIM.pilasterMinSpacing < WALL_TRIM.pilasterMaxSpacing);
  assert.ok(WALL_TRIM.copingProjection < WALL_TRIM.keepClear);
  assert.ok(WALL_TRIM.plinthProjection < WALL_TRIM.keepClear);
  // The pilaster is the deepest inward step; it too must stay under the margin.
  assert.ok(WALL_TRIM.pilasterProjection <= WALL_TRIM.keepClear);
  assert.ok(WALL_TRIM.pilasterWidth > 0 && WALL_TRIM.pilasterHeight > 0);
});

test('the five runs agree with the world geometry', () => {
  const runs = wallRuns();
  assert.equal(runs.length, 5);
  // Every run's fixed coordinate sits on a wall line (+-HALF), and every extent
  // spans the plaza edge to edge.
  for (const run of runs) {
    assert.ok(run.fixed === HALF || run.fixed === -HALF, `${run.id} fixed ${run.fixed} is not a wall line`);
    assert.ok(run.from >= -HALF && run.to <= HALF, `${run.id} leaves the plaza`);
    assert.ok(run.from < run.to, `${run.id} is not ordered`);
    assert.ok(Number.isFinite(run.from) && Number.isFinite(run.fixed) && Number.isFinite(run.to));
  }
  // The two north segments match NORTH_WALL_SEGMENTS exactly.
  const [left, right] = NORTH_WALL_SEGMENTS;
  const north = runs.filter((run) => run.side === 'north');
  assert.equal(north.length, 2);
  assert.equal(north[0].from, left.minX);
  assert.equal(north[0].to, left.maxX);
  assert.equal(north[1].from, right.minX);
  assert.equal(north[1].to, right.maxX);
  // The gate-adjacent flag marks exactly the two north segments.
  assert.equal(north.every((run) => run.gateAdjacent), true);
  assert.equal(runs.filter((run) => run.gateAdjacent).length, 2);
  // The gate opening really is the gap between them.
  assert.equal(north[0].to, GATE.minX);
  assert.equal(north[1].from, GATE.maxX);
});

test('wallRuns is deterministic and hands back fresh copies', () => {
  assert.deepEqual(wallRuns(), wallRuns());
  const first = wallRuns();
  first[0].id = 'mutated';
  // The module's own copy is untouched by a caller's mutation.
  assert.equal(wallRuns()[0].id, 'south');
});

test('copingFor and plinthFor are deterministic for identical runs', () => {
  const runs = wallRuns();
  for (const run of runs) {
    assert.deepEqual(copingFor(run), copingFor(run), `${run.id} coping not deterministic`);
    assert.deepEqual(plinthFor(run), plinthFor(run), `${run.id} plinth not deterministic`);
  }
});

test('pilastersFor is deterministic for identical runs', () => {
  const runs = wallRuns();
  for (const run of runs) {
    assert.deepEqual(pilastersFor(run), pilastersFor(run), `${run.id} pilasters not deterministic`);
  }
});

test('wallTrimLayout is deterministic', () => {
  assert.deepEqual(wallTrimLayout(), wallTrimLayout());
});

test('copingFor and plinthFor are total on junk input', () => {
  for (const junk of [null, undefined, 42, 'south', [], {}, { axis: 'q' }, { axis: 'x', from: NaN, to: 1, fixed: 0 }]) {
    // A junk run reads as the south wall: finite numbers, a real name, no throw.
    const coping = copingFor(junk);
    const plinth = plinthFor(junk);
    assert.ok(allFinite(coping), `coping not finite for ${String(junk)}`);
    assert.ok(allFinite(plinth), `plinth not finite for ${String(junk)}`);
    assert.equal(coping.name, 'border-wall-coping-south');
    assert.equal(plinth.name, 'border-wall-plinth-south');
  }
});

test('pilastersFor is total on junk input', () => {
  for (const junk of [null, undefined, 42, 'south', [], {}, { axis: 'q' }, { axis: 'x', from: Infinity, to: 1, fixed: 0 }]) {
    const boxes = pilastersFor(junk);
    assert.ok(Array.isArray(boxes));
    for (const box of boxes) {
      assert.ok(allFinite(box), `pilaster not finite for ${String(junk)}`);
      assert.equal(box.name, `border-wall-pilaster-south-${boxes.indexOf(box)}`);
    }
  }
});

test('negative and reversed runs are clamped to sane extents', () => {
  // A reversed run (from > to) is normalised, and a zero-length run is dropped
  // in favour of the south wall rather than producing a zero-size box.
  const reversed = copingFor({ id: 'south', axis: 'x', from: 17, to: -17, fixed: 17, side: 'south', gateAdjacent: false });
  assert.equal(reversed.name, 'border-wall-coping-south');
  assert.ok(allFinite(reversed));
  const zero = copingFor({ id: 'south', axis: 'x', from: 5, to: 5, fixed: 17, side: 'south', gateAdjacent: false });
  assert.equal(zero.name, 'border-wall-coping-south');
  assert.ok(allFinite(zero));
});

test('the coping sits exactly on the 3.2 m wall top', () => {
  const runs = wallRuns();
  for (const run of runs) {
    const coping = copingFor(run);
    const expectedY = WALL_TRIM_HEIGHT + WALL_TRIM.copingHeight / 2;
    assert.ok(Math.abs(coping.position[1] - expectedY) < 1e-9,
      `${run.id} coping centre ${coping.position[1]} is not on the wall top`);
    // The box is exactly the spec height, so its base meets the wall top.
    assert.equal(coping.size[1], WALL_TRIM.copingHeight);
    assert.ok(Math.abs((coping.position[1] - coping.size[1] / 2) - WALL_TRIM_HEIGHT) < 1e-9,
      `${run.id} coping base is not flush with the wall top`);
  }
});

test('the coping and plinth stop at the wall corners rather than growing past the wall', () => {
  const runs = wallRuns();
  for (const run of runs) {
    const along = run.axis === 'x' ? 0 : 2;
    // The course span is exactly the wall face: the run ends plus one half
    // thickness each way, never more. A course that grew past the corner would
    // overshoot the corner itself. The one exception is a gate-adjacent run's
    // pier end: the pier is not wall, so the course abuts the pier's inner face
    // there instead of extending half a thickness (the pier-face test below
    // pins that end).
    const pierAtLowEnd = run.gateAdjacent && run.from >= GATE.maxX;
    const pierAtHighEnd = run.gateAdjacent && run.to <= GATE.minX;
    for (const kind of ['coping', 'plinth']) {
      const piece = kind === 'coping' ? copingFor(run) : plinthFor(run);
      const lo = piece.position[along] - piece.size[along] / 2;
      const hi = piece.position[along] + piece.size[along] / 2;
      const expectedLo = pierAtLowEnd ? run.from : run.from - WALL_HALF_THICK;
      const expectedHi = pierAtHighEnd ? run.to : run.to + WALL_HALF_THICK;
      assert.ok(Math.abs(lo - expectedLo) < 1e-9,
        `${run.id} ${kind} inner end ${lo} is not ${expectedLo}`);
      assert.ok(Math.abs(hi - expectedHi) < 1e-9,
        `${run.id} ${kind} outer end ${hi} is not ${expectedHi}`);
    }
  }
});

test('the coping overhangs the outer face and never reaches the window plane', () => {
  const runs = wallRuns();
  for (const run of runs) {
    const coping = copingFor(run);
    // The cap's inner edge stops flush with the inner face; it projects nothing
    // into the courtyard, so its inward projection is exactly 0.
    assert.ok(Math.abs(inwardProjection(run, coping)) < 1e-9,
      `${run.id} coping inner edge is not flush with the inner face`);
    // The outer edge overhangs the outer face by exactly the spec projection.
    assert.ok(Math.abs(outwardOverhang(run, coping) - WALL_TRIM.copingProjection) < 1e-9,
      `${run.id} coping does not overhang by ${WALL_TRIM.copingProjection}`);
    // Staying flush with the inner face keeps it clear of the window/ivy plane:
    // the pane sits 0.02 m inside the inner face (at |coord| 16.48, less than
    // the face's 16.5), so an inner edge at the face is short of the glass.
    assert.ok(Math.abs(innerEdgeCoord(run, coping)) >= WINDOW_PLANE - 1e-9,
      `${run.id} coping inner edge reaches the window plane`);
  }
});

test('the plinth projects under the keep-clear margin on the inner face', () => {
  const runs = wallRuns();
  for (const run of runs) {
    const plinth = plinthFor(run);
    const inward = inwardProjection(run, plinth);
    assert.ok(inward > 0, `${run.id} plinth does not step proud of the inner face`);
    assert.ok(inward <= WALL_TRIM.keepClear + 1e-9,
      `${run.id} plinth projects ${inward} in, over the ${WALL_TRIM.keepClear} margin`);
    // The window/ivy plane sits 0.02 m inside the inner face, so a projection
    // under the margin is the rule that keeps the course off the glass.
    assert.ok(INNER_FACE - WINDOW_PLANE < WALL_TRIM.keepClear,
      'the window plane is inside the keep-clear margin');
  }
});

test('every pilaster projects under the keep-clear margin on the inner face', () => {
  const runs = wallRuns();
  for (const run of runs) {
    for (const pilaster of pilastersFor(run)) {
      const inward = inwardProjection(run, pilaster);
      assert.ok(inward > 0, `${run.id} pilaster does not step proud of the inner face`);
      assert.ok(inward <= WALL_TRIM.keepClear + 1e-9,
        `${run.id} pilaster projects ${inward} in, over the ${WALL_TRIM.keepClear} margin`);
    }
  }
});

test('no pilaster lands inside the gate opening or on a gate pier', () => {
  // The gate piers are 0.7 m boxes centred half a pier-width either side of the
  // opening (world.js builds them at GATE.minX - 0.35 and GATE.maxX + 0.35),
  // so pier A spans 7.30..8.00 and pier B 11.00..11.70. A pilaster projects
  // past both faces, so its whole width must clear the pier, not just the
  // opening.
  const PIER_HALF = 0.35;
  const pierA = [GATE.minX - PIER_HALF - PIER_HALF, GATE.minX];
  const pierB = [GATE.maxX, GATE.maxX + PIER_HALF + PIER_HALF];
  const runs = wallRuns();
  for (const run of runs) {
    for (const pilaster of pilastersFor(run)) {
      if (run.fixed !== -HALF) continue;
      const halfWidth = pilaster.size[0] / 2;
      const lo = pilaster.position[0] - halfWidth;
      const hi = pilaster.position[0] + halfWidth;
      const inOpening = lo < GATE.maxX && hi > GATE.minX;
      const onPierA = lo < pierA[1] && hi > pierA[0];
      const onPierB = lo < pierB[1] && hi > pierB[0];
      assert.equal(inOpening, false,
        `${run.id} pilaster spans ${lo}..${hi}, inside the gate opening ${GATE.minX}..${GATE.maxX}`);
      assert.equal(onPierA || onPierB, false,
        `${run.id} pilaster spans ${lo}..${hi}, overlapping a gate pier`);
    }
  }
});

test('courses on a gate-adjacent run stop at the pier inner face, not the opening', () => {
  const runs = wallRuns();
  for (const run of runs) {
    if (!run.gateAdjacent) continue;
    const along = 0;
    for (const kind of ['coping', 'plinth']) {
      const piece = kind === 'coping' ? copingFor(run) : plinthFor(run);
      const lo = piece.position[along] - piece.size[along] / 2;
      const hi = piece.position[along] + piece.size[along] / 2;
      // The pier's courtyard-facing face sits at the opening face (x 8 or 11):
      // the course abuts the pier there rather than growing past it.
      const pierFace = run.to <= GATE.minX ? GATE.minX : GATE.maxX;
      const touches = run.to <= GATE.minX ? hi : lo;
      assert.ok(Math.abs(touches - pierFace) < 1e-9,
        `${run.id} ${kind} ${run.to <= GATE.minX ? 'outer end' : 'inner end'} ${touches} is not at the pier face ${pierFace}`);
      // And it never crosses the opening.
      const spansOpening = lo < GATE.maxX && hi > GATE.minX;
      assert.equal(spansOpening, false, `${run.id} ${kind} crosses the gate opening`);
    }
  }
});

test('every generated name is unique and correctly prefixed', () => {
  const layout = wallTrimLayout();
  const names = layout.map((entry) => entry.name);
  const unique = new Set(names);
  assert.equal(unique.size, names.length, 'duplicate trim name');
  for (const entry of layout) {
    const prefix = `border-wall-${entry.kind}-`;
    assert.ok(entry.name.startsWith(prefix), `${entry.name} does not start with ${prefix}`);
  }
});

test('the layout covers all five runs', () => {
  const layout = wallTrimLayout();
  const runIds = new Set(layout.map((entry) => entry.run));
  const expected = new Set(wallRuns().map((run) => run.id));
  assert.deepEqual([...runIds].sort(), [...expected].sort());
  // Each run contributes exactly one coping and one plinth.
  for (const run of wallRuns()) {
    const copings = layout.filter((entry) => entry.kind === 'coping' && entry.run === run.id);
    const plinths = layout.filter((entry) => entry.kind === 'plinth' && entry.run === run.id);
    assert.equal(copings.length, 1, `${run.id} coping count`);
    assert.equal(plinths.length, 1, `${run.id} plinth count`);
  }
});

test('every layout entry carries finite sizes and positions', () => {
  for (const entry of wallTrimLayout()) {
    assert.ok(allFinite(entry), `${entry.name} has a non-finite size or position`);
    assert.equal(entry.size.length, 3);
    assert.equal(entry.position.length, 3);
    for (const value of entry.size) assert.ok(value > 0, `${entry.name} has a non-positive size`);
  }
});

test('a junk tier reads as the full tier', () => {
  assert.equal(wallTrimEnabled('low'), false);
  assert.equal(wallTrimEnabled('full'), true);
  for (const junk of [undefined, null, 'LOW', 'high', 42, {}, []]) {
    assert.equal(wallTrimEnabled(junk), true);
  }
});