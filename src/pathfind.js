// Guided travel: a real route through the world, not a straight line.
//
// Round 14 gave the world a spoken compass, but it only *described* a route --
// "the north gate is ahead and to your right". A blind player then had to walk it
// step by step and could not tell a wall from open ground. This module supplies
// the route itself, so the player can be walked there.
//
// It is A* on a grid built from the game's actual colliders and step heights, kept
// free of Three.js so it can be tested in Node. The grid is coarse on purpose:
// the map is small, and a coarse grid that is provably correct beats a fine one
// that is not.

import { floorHeightAt, STEP_HEIGHT, HALF } from './terrain.js';
import { PLAZA, LANE } from './areas.js';

/**
 * The world the player can actually walk in. The plaza is a square around the
 * origin, but the market lane runs north of the wall and past it, so a grid sized
 * from HALF alone stops short of the lane and every route to the ledger fails --
 * which is exactly the bug this constant exists to prevent.
 */
export const BOUNDS = {
  minX: Math.min(PLAZA.minX, LANE.minX),
  maxX: Math.max(PLAZA.maxX, LANE.maxX),
  minZ: Math.min(PLAZA.minZ, LANE.minZ),
  maxZ: Math.max(PLAZA.maxZ, LANE.maxZ)
};

/** How far apart grid samples are, in world units. */
export const CELL = 0.5;

/** How much clearance a found cell needs beyond the player's radius. */
export const CLEARANCE = 0.42;

/**
 * Build a walkability grid over the world.
 *
 * `colliders` are the game's AABBs, `{minX, minZ, maxX, maxZ}`. A cell is walkable
 * when the player's circle at its centre clears every collider. Step height is
 * checked between neighbours rather than per cell, so the ramp stays usable while
 * the terrace side wall stays a wall.
 */
export function buildGrid(colliders, { bounds = BOUNDS, cell = CELL, clearance = CLEARANCE } = {}) {
  const cols = Math.ceil((bounds.maxX - bounds.minX) / cell);
  const rows = Math.ceil((bounds.maxZ - bounds.minZ) / cell);
  const originX = bounds.minX;
  const originZ = bounds.minZ;
  const origin = originX; // kept for callers that only know the old field
  const cells = cols;
  const walkable = new Uint8Array(cols * rows);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = originX + (col + 0.5) * cell;
      const z = originZ + (row + 0.5) * cell;
      // Keep the player off the very edge of the world.
      if (x > bounds.maxX - clearance || x < bounds.minX + clearance ||
          z > bounds.maxZ - clearance || z < bounds.minZ + clearance) continue;
      let blocked = false;
      for (const box of colliders) {
        if (
          x + clearance > box.minX && x - clearance < box.maxX &&
          z + clearance > box.minZ && z - clearance < box.maxZ
        ) { blocked = true; break; }
      }
      if (!blocked) walkable[row * cells + col] = 1;
    }
  }

  return { cols, rows, originX, originZ, origin, cell, walkable };
}

/** World position of the centre of a grid cell. */
export function cellCentre(grid, col, row) {
  return {
    x: grid.originX + (col + 0.5) * grid.cell,
    z: grid.originZ + (row + 0.5) * grid.cell
  };
}

/** The grid indices nearest a world position, clamped into the grid. */
export function worldToCell(grid, x, z) {
  const col = Math.min(grid.cols - 1, Math.max(0, Math.floor((x - grid.originX) / grid.cell)));
  const row = Math.min(grid.rows - 1, Math.max(0, Math.floor((z - grid.originZ) / grid.cell)));
  return { col, row };
}

/** True when a cell can be walked through, with a step-height check from a neighbour. */
export function isWalkable(grid, col, row, from = null) {
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return false;
  if (!grid.walkable[row * grid.cols + col]) return false;
  if (from) {
    const here = cellCentre(grid, from.col, from.row);
    const there = cellCentre(grid, col, row);
    // A ledge higher than one step is a wall, even when the cell itself is clear.
    if (floorHeightAt(there.x, there.z) - floorHeightAt(here.x, here.z) > STEP_HEIGHT) return false;
  }
  return true;
}

/**
 * If a point sits inside a collider or outside the grid, find the nearest cell that
 * can actually be stood in. Targets like "the key spot" are only approximately on
 * walkable ground, and a player can end up nudged against a wall.
 */
export function nearestOpenCell(grid, x, z, maxRadius = 6) {
  const start = worldToCell(grid, x, z);
  if (isWalkable(grid, start.col, start.row)) return start;
  for (let radius = 1; radius <= maxRadius; radius += 1) {
    for (let dr = -radius; dr <= radius; dr += 1) {
      for (let dc = -radius; dc <= radius; dc += 1) {
        // Only the perimeter of this ring, not its interior, which was covered.
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue;
        const col = start.col + dc;
        const row = start.row + dr;
        if (isWalkable(grid, col, row)) return { col, row };
      }
    }
  }
  return null;
}

/** The eight neighbour offsets, with their step cost. */
const NEIGHBOURS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]
];

/**
 * A* from one world point to another. Returns an array of world positions from
 * start to goal (both included), or null when no route exists.
 *
 * Diagonals are refused when either adjacent straight cell is blocked, so the
 * route never cuts a corner through a wall -- a subtlety that is easy to miss and
 * that would send a player through solid geometry.
 */
export function findPath(grid, from, to, { maxNodes = 20000 } = {}) {
  const start = nearestOpenCell(grid, from.x, from.z);
  const goal = nearestOpenCell(grid, to.x, to.z);
  if (!start || !goal) return null;

  const key = (c) => c.row * grid.cols + c.col;
  const heuristic = (c) => Math.hypot(c.col - goal.col, c.row - goal.row);

  const open = [{ ...start, g: 0, f: heuristic(start), parent: null }];
  const best = new Map([[key(start), 0]]);
  const closed = new Set();
  let expanded = 0;

  while (open.length && expanded < maxNodes) {
    // Small maps: a linear scan is clearer than a heap and fast enough here.
    let bestIndex = 0;
    for (let i = 1; i < open.length; i += 1) if (open[i].f < open[bestIndex].f) bestIndex = i;
    const current = open.splice(bestIndex, 1)[0];
    const currentKey = key(current);
    if (closed.has(currentKey)) continue;
    closed.add(currentKey);
    expanded += 1;

    if (current.col === goal.col && current.row === goal.row) {
      const path = [];
      let node = current;
      while (node) {
        path.push(cellCentre(grid, node.col, node.row));
        node = node.parent;
      }
      path.reverse();
      // Only the START is snapped to the exact point, because the player is
      // standing there and is therefore already somewhere valid. The END is left
      // at the open cell the search actually reached: snapping it back to the
      // requested point would put the final waypoint inside a collider whenever the
      // goal is a solid object (a bench, a stall), and the player would walk into
      // it and stall with no way to understand why.
      path[0] = { x: from.x, z: from.z };
      return path;
    }

    for (const [dc, dr, cost] of NEIGHBOURS) {
      const col = current.col + dc;
      const row = current.row + dr;
      if (!isWalkable(grid, col, row, current)) continue;
      // No corner cutting: a diagonal needs both straight neighbours open.
      if (dc !== 0 && dr !== 0) {
        if (!isWalkable(grid, current.col + dc, current.row, current)) continue;
        if (!isWalkable(grid, current.col, current.row + dr, current)) continue;
      }
      const neighbourKey = row * grid.cols + col;
      if (closed.has(neighbourKey)) continue;
      const g = current.g + cost;
      if (best.has(neighbourKey) && best.get(neighbourKey) <= g) continue;
      best.set(neighbourKey, g);
      open.push({
        col, row, g, f: g + heuristic({ col, row }), parent: current
      });
    }
  }
  return null;
}

/** Total walking distance of a path, for a spoken "how far" figure. */
export function pathLength(path) {
  if (!path || path.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    total += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
  }
  return total;
}

/**
 * The next few waypoints to walk towards, as directions. Long straight runs are
 * collapsed so the guidance reads as "go north, then east" rather than twenty
 * identical instructions.
 */
export function summarisePath(path, yawAt = () => 0, relativeDirection, compassBearing) {
  if (!path || path.length < 2) return [];
  const steps = [];
  // Walk the path looking for a change of concern: a turn, or a significant distance.
  let travelled = 0;
  let lastBearing = null;
  for (let i = 1; i < path.length; i += 1) {
    const previous = path[i - 1];
    const current = path[i];
    const segment = Math.hypot(current.x - previous.x, current.z - previous.z);
    travelled += segment;
    const bearing = compassBearing(current.x - previous.x, current.z - previous.z);
    if (bearing !== lastBearing) {
      if (lastBearing !== null && travelled > 0.4) {
        steps.push({ bearing: lastBearing, distance: travelled });
        travelled = 0;
      }
      lastBearing = bearing;
    }
  }
  if (lastBearing !== null) steps.push({ bearing: lastBearing, distance: travelled });
  return steps.filter((step) => step.distance >= 0.6);
}
