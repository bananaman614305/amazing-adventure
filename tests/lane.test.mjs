// Lane dressing must add life without blocking the way to the ledger.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LANE_SACKS, LANE_BUNTING, LANE_CORRIDOR,
  laneDressingClear, laneBuntingOverhead
} from '../src/areas.js';

test('every sack leaves a usable walkway beside it', () => {
  const result = laneDressingClear();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.checked, LANE_SACKS.length);
});

test('the clearance rule actually rejects a wall of props', () => {
  // A guard that can never fail is worthless, so prove it fails.
  //
  // Note what this test is NOT: my first version asserted that a single sack
  // parked at x = 10 (the middle of an 8 m lane) must be rejected. It is not
  // a violation -- it leaves 3.3 m clear on either side, which a player walks
  // round easily. The rule was right and my expectation was wrong. What
  // genuinely blocks the lane is a row of props spanning it with no gap wide
  // enough to pass.
  const blocked = laneDressingClear({
    sacks: [
      { x: 7.2, z: -20, radius: 0.3, height: 0.6 },
      { x: 8.6, z: -20, radius: 0.3, height: 0.6 },
      { x: 10.0, z: -20, radius: 0.3, height: 0.6 },
      { x: 11.4, z: -20, radius: 0.3, height: 0.6 },
      { x: 12.8, z: -20, radius: 0.3, height: 0.6 }
    ]
  });
  assert.equal(blocked.ok, false, 'a row spanning the lane must be rejected');
  assert.ok(blocked.widestGap < 1.2, `widestGap ${blocked.widestGap}`);
});

test('the clearance rule measures the wider side, not both', () => {
  // A prop close to one wall is fine: the player walks round the other side.
  const nearWall = laneDressingClear({
    sacks: [{ x: LANE_CORRIDOR.minX + 0.32, z: -20, radius: 0.3, height: 0.6 }]
  });
  assert.equal(nearWall.ok, true, JSON.stringify(nearWall));
});

test('bunting hangs above head height, so it needs no collider', () => {
  const result = laneBuntingOverhead();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.checked, LANE_BUNTING.length);
});

test('bunting that droops into the walkway is rejected', () => {
  const low = laneBuntingOverhead({
    strands: [{ z: -20, y: 1.5, sag: 0.4, flags: 8 }]
  });
  assert.equal(low.ok, false, 'bunting below head height must be rejected');
  assert.ok(low.lowest <= 2.0, `lowest ${low.lowest}`);
});

test('the dressing stays inside the lane bounds', () => {
  for (const sack of LANE_SACKS) {
    assert.ok(sack.x >= LANE_CORRIDOR.minX && sack.x <= LANE_CORRIDOR.maxX,
      `sack x ${sack.x} inside the corridor`);
  }
  for (const strand of LANE_BUNTING) {
    // Strands span the lane, so only their z has to be inside it.
    assert.ok(strand.z > -26 && strand.z < -17.5, `strand z ${strand.z} inside the lane`);
  }
});

test('sacks sit against the stall rather than in open floor', () => {
  // The stall spans x 6.8..8.0 at z -23.1..-19.9. A sack is "against" it when
  // it is within a metre of the counter's east edge.
  for (const sack of LANE_SACKS) {
    assert.ok(sack.x > 8.0 && sack.x - 8.0 <= 1.0, `sack x ${sack.x} near the counter`);
  }
});

test('a player can actually walk from the gate to the ledger spot', () => {
  // The rule above is geometric, but what matters is the route. Walk a grid
  // from the gate opening to the ledger spot, treating the stall, crates,
  // barrels and sacks as obstacles, and require a path to exist.
  const CELL = 0.25;
  const start = { x: 9.5, z: -18.0 };
  const goal = { x: 7.6, z: -25.0 };
  const obstacles = [];
  // The lane stall: x 6.8..8.0, z -23.1..-19.9.
  obstacles.push({ minX: 6.8, maxX: 8.0, minZ: -23.1, maxZ: -19.9 });
  // Lane crates: x 12.05..13.15, z -21.55..-19.05.
  obstacles.push({ minX: 12.05, maxX: 13.15, minZ: -21.55, maxZ: -19.05 });
  // Lane barrel: x 6.4..7.4, z -24.9..-23.9.
  obstacles.push({ minX: 6.4, maxX: 7.4, minZ: -24.9, maxZ: -23.9 });
  for (const sack of LANE_SACKS) {
    obstacles.push({
      minX: sack.x - 0.32, maxX: sack.x + 0.32,
      minZ: sack.z - 0.32, maxZ: sack.z + 0.32
    });
  }
  const lane = { minX: 6.0, maxX: 14.0, minZ: -26.0, maxZ: -17.5 };
  // The player has width. Without this the search squeezed through a 0.28 m
  // sliver between a sealed wall and the lane edge and reported success -- my
  // first version of this test passed against a completely blocked lane, which
  // made it a rubber stamp. Anything a 0.35 m walker would overlap is blocked.
  const PLAYER_RADIUS = 0.35;
  const blockedCell = (x, z) => obstacles.some((o) =>
    x >= o.minX - PLAYER_RADIUS && x <= o.maxX + PLAYER_RADIUS &&
    z >= o.minZ - PLAYER_RADIUS && z <= o.maxZ + PLAYER_RADIUS);
  const inLane = (x, z) =>
    x >= lane.minX && x <= lane.maxX && z >= lane.minZ && z <= lane.maxZ;

  const visited = new Set();
  const key = (x, z) => `${Math.round(x / CELL)}:${Math.round(z / CELL)}`;
  const queue = [start];
  visited.add(key(start.x, start.z));
  let reached = false;
  while (queue.length) {
    const cur = queue.shift();
    if (Math.hypot(cur.x - goal.x, cur.z - goal.z) < 0.6) { reached = true; break; }
    for (const [dx, dz] of [[CELL, 0], [-CELL, 0], [0, CELL], [0, -CELL]]) {
      const nx = cur.x + dx;
      const nz = cur.z + dz;
      const k = key(nx, nz);
      if (visited.has(k)) continue;
      if (!inLane(nx, nz)) continue;
      if (blockedCell(nx, nz)) continue;
      visited.add(k);
      queue.push({ x: nx, z: nz });
    }
  }
  assert.equal(reached, true, 'the ledger must stay reachable with the dressing in place');
});
