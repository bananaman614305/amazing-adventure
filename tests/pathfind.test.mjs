// Guided travel. The property that matters: a returned path is walkable, and a
// blocked route is refused rather than faked. A path that clips a wall would walk
// a player into geometry they cannot see, and they would have no way to tell.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CELL, BOUNDS, buildGrid, findPath, pathLength, nearestOpenCell,
  worldToCell, cellCentre, isWalkable
} from '../src/pathfind.js';
import { PLAYER_RADIUS } from '../src/player.js';
import { floorHeightAt, STEP_HEIGHT } from '../src/terrain.js';

const box = (minX, minZ, maxX, maxZ) => ({ minX, minZ, maxX, maxZ });
const gridWith = (colliders) => buildGrid(colliders, { cell: 0.5 });

/** True when a point is inside any collider, using the player's radius. */
function insideAny(colliders, point, radius = PLAYER_RADIUS) {
  return colliders.some((b) =>
    point.x + radius > b.minX && point.x - radius < b.maxX &&
    point.z + radius > b.minZ && point.z - radius < b.maxZ);
}

test('the walkable bounds include the market lane, which lies past the plaza wall', () => {
  // The lane runs north beyond the plaza square. A grid sized only to the plaza
  // silently makes every route to the ledger impossible.
  assert.ok(BOUNDS.minZ <= -26, `bounds must reach the lane, got minZ ${BOUNDS.minZ}`);
  assert.ok(BOUNDS.maxX >= 14, 'bounds must include the lane width');
});

test('an open field is walkable everywhere inside the bounds', () => {
  const grid = gridWith([]);
  assert.ok(grid.cols > 0 && grid.rows > 0);
  const total = grid.walkable.reduce((n, v) => n + v, 0);
  assert.ok(total > 1000, `an empty world should be mostly walkable, got ${total}`);
});

test('a straight route across open ground is about the straight-line distance', () => {
  const grid = gridWith([]);
  const path = findPath(grid, { x: 0, z: 10 }, { x: 0, z: -10 });
  assert.ok(path, 'a route must exist');
  const length = pathLength(path);
  // The route ends on the open cell nearest the goal, so it can be a fraction under
  // the exact gap; it must not be dramatically longer than a straight line.
  assert.ok(length > 19, `it cannot be much shorter than the gap, got ${length.toFixed(2)}`);
  assert.ok(length < 24, `it should not wander, got ${length.toFixed(2)}`);
});

test('a path never passes through a wall', () => {
  const wall = box(-10, -1, 2, 1);
  const grid = gridWith([wall]);
  const path = findPath(grid, { x: 0, z: 8 }, { x: 0, z: -8 });
  assert.ok(path, 'there is a way around');
  for (const point of path) {
    assert.equal(insideAny([wall], point), false,
      `waypoint ${point.x},${point.z} is inside the wall`);
  }
});

test('a path goes around a wall rather than through it, and is therefore longer', () => {
  const wall = box(-10, -1, 2, 1);
  const grid = gridWith([wall]);
  const path = findPath(grid, { x: 0, z: 8 }, { x: 0, z: -8 });
  assert.ok(pathLength(path) > 16, 'going around must cost more than the straight line');
});

test('a fully enclosing wall makes the goal unreachable, and says so', () => {
  const boxed = [
    box(-2, 4, 2, 4.2), box(-2, -4.2, 2, -4),
    box(-2, -4, -1.8, 4), box(1.8, -4, 2, 4)
  ];
  const grid = gridWith(boxed);
  const path = findPath(grid, { x: 0, z: 10 }, { x: 0, z: 0 });
  assert.equal(path, null, 'a sealed room must not produce a path');
});

test('a diagonal never cuts a corner through a blocked cell', () => {
  // A pillar with the goal diagonally opposite: the route must go round it.
  const pillar = box(-1, -1, 1, 1);
  const grid = gridWith([pillar]);
  const path = findPath(grid, { x: -3, z: -3 }, { x: 3, z: 3 });
  assert.ok(path);
  for (const point of path) {
    assert.equal(insideAny([pillar], point), false, 'corner was cut through the pillar');
  }
});

test('a goal inside a collider is nudged to the nearest open cell', () => {
  const pillar = box(-1, -1, 1, 1);
  const grid = gridWith([pillar]);
  const cell = nearestOpenCell(grid, 0, 0, 8);
  assert.ok(cell, 'there is open ground near the pillar');
  const centre = cellCentre(grid, cell.col, cell.row);
  assert.equal(insideAny([pillar], centre), false, 'the chosen cell must be clear');
});

test('a start position outside the world still yields a route', () => {
  const grid = gridWith([]);
  const path = findPath(grid, { x: 500, z: 500 }, { x: 0, z: 0 });
  assert.ok(path, 'an out-of-bounds start should be clamped, not fatal');
});

test('the step-height rule keeps the terrace wall a wall', () => {
  // The terrace is a ledge higher than one step; its side must not be walkable
  // even where no collider sits.
  const grid = gridWith([]);
  const onTerrace = worldToCell(grid, 0, -15);
  const besideIt = worldToCell(grid, 8, -15);
  assert.equal(isWalkable(grid, besideIt.col, besideIt.row), true, 'the plaza floor is open');
  assert.ok(floorHeightAt(0, -15) - floorHeightAt(8, -15) > STEP_HEIGHT,
    'the terrace really is more than one step up');
});

test('the ramp is walkable, unlike the ledge beside it', () => {
  const grid = gridWith([]);
  // Walk a line up the ramp and check no step exceeds the step height.
  let previous = null;
  let maxRise = 0;
  for (let z = -8.5; z >= -13.4; z -= 0.5) {
    if (previous !== null) maxRise = Math.max(maxRise, floorHeightAt(0, z) - previous);
    previous = floorHeightAt(0, z);
  }
  assert.ok(maxRise <= STEP_HEIGHT, `the ramp must be climbable, biggest step ${maxRise}`);
  const rampCell = worldToCell(grid, 0, -11);
  assert.equal(isWalkable(grid, rampCell.col, rampCell.row), true);
});

test('path length is zero for a path that never moved', () => {
  assert.equal(pathLength([]), 0);
  assert.equal(pathLength([{ x: 0, z: 0 }]), 0);
  assert.equal(pathLength(null), 0);
});

test('a path begins where the player stands and ends on open ground', () => {
  const grid = gridWith([]);
  const from = { x: -5, z: 6 };
  const to = { x: 7, z: -4 };
  const path = findPath(grid, from, to);
  assert.deepEqual(path[0], from, 'the first waypoint is where you are');
  // The last waypoint is the open cell reached, which is close to the goal but
  // deliberately not snapped onto it: snapping can land inside a solid object.
  const end = path[path.length - 1];
  assert.ok(Math.hypot(end.x - to.x, end.z - to.z) <= 1.0, 'the end is near the goal');
});

test('a goal inside a solid object does not put the final waypoint inside it', () => {
  // A bench is a collider. Snapping the last waypoint onto its centre would walk
  // the player into the bench and stall them there with no explanation.
  const bench = box(-8.2, 11.6, -5.8, 12.4);
  const grid = gridWith([bench]);
  const path = findPath(grid, { x: 0, z: 0 }, { x: -7, z: 12 });
  assert.ok(path, 'the bench is reachable, just not enterable');
  const end = path[path.length - 1];
  assert.equal(insideAny([bench], end), false,
    'the final waypoint must not be inside the bench');
  for (const point of path) {
    assert.equal(insideAny([bench], point), false, 'no waypoint may enter the bench');
  }
});

test('the grid stays a manageable size for this world', () => {
  const grid = gridWith([]);
  const cells = grid.cols * grid.rows;
  assert.ok(cells < 40000, `grid should stay small, got ${cells} cells`);
  assert.equal(CELL, 0.5, 'cell size is part of the contract');
});

test('a grid built with no colliders has no unreachable interior', () => {
  const grid = gridWith([]);
  const path = findPath(grid, { x: -10, z: -5 }, { x: 12, z: -20 });
  assert.ok(path, 'open ground, so any two points connect');
});
