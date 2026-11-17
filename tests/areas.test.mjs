// Area, gate and notice-board tests. Pure logic only.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PLAZA, LANE, AREAS, GATE, NORTH_WALL_SEGMENTS, LANE_PROPS, NOTICE_BOARD,
  isGateOpen, gateHint, areaAt, insideGate, noticeText
} from '../src/areas.js';
import {
  createInitialState, startKey, pickUpKey, returnKey,
  startToll, collectToll, waiveToll
} from '../src/state.js';

test('the plaza and the lane are separate, non-overlapping areas', () => {
  assert.notEqual(PLAZA.id, LANE.id);
  // No point may belong to both areas.
  for (let x = -20; x <= 20; x += 1) {
    for (let z = -28; z <= 20; z += 1) {
      const inPlaza = x >= PLAZA.minX && x <= PLAZA.maxX && z >= PLAZA.minZ && z <= PLAZA.maxZ;
      const inLane = x >= LANE.minX && x <= LANE.maxX && z >= LANE.minZ && z <= LANE.maxZ;
      assert.equal(inPlaza && inLane, false, `overlap at ${x},${z}`);
    }
  }
});

test('areaAt identifies the plaza, the lane, and the void', () => {
  assert.equal(areaAt(0, 0), 'plaza');
  assert.equal(areaAt(10, -20), 'lane');
  assert.equal(areaAt(0, -40), null);
  assert.equal(areaAt(100, 100), null);
  assert.equal(AREAS.length, 2);
});

test('the lane is only reachable through the gate opening', () => {
  // The lane's x range must sit within the gate's x span widened by the piers,
  // so there is no way around the wall into the lane.
  assert.ok(LANE.minX >= 0, 'lane sits on the gate side of the plaza');
  assert.ok(GATE.x > LANE.minX && GATE.x < LANE.maxX, 'the gate leads into the lane');
  assert.ok(insideGate(GATE.x, GATE.z), 'the gate centre is inside the opening');
  assert.equal(insideGate(GATE.minX - 1, GATE.z), false);
  assert.equal(insideGate(GATE.maxX + 1, GATE.z), false);
});

test('the wall is split around the gate with no gap outside the opening', () => {
  const [left, right] = NORTH_WALL_SEGMENTS;
  assert.equal(left.minX, PLAZA.minX);
  assert.equal(left.maxX, GATE.minX);
  assert.equal(right.minX, GATE.maxX);
  assert.equal(right.maxX, PLAZA.maxX);
  assert.ok(right.minX > left.maxX, 'the segments leave exactly the gate opening');
});

test('the gate opens only once Halden has his key back', () => {
  const state = createInitialState();
  assert.equal(isGateOpen(state), false);
  assert.match(gateHint(state), /locked/);
  startKey(state);
  assert.equal(isGateOpen(state), false, 'asked for the key is not enough');
  pickUpKey(state);
  assert.equal(isGateOpen(state), false, 'finding it is not enough');
  returnKey(state);
  assert.equal(isGateOpen(state), true);
  assert.match(gateHint(state), /pass through/);
});

test('lane props stay inside the lane and away from the gate approach', () => {
  for (const prop of LANE_PROPS) {
    const minX = prop.x - prop.width / 2;
    const maxX = prop.x + prop.width / 2;
    const minZ = prop.z - prop.depth / 2;
    const maxZ = prop.z + prop.depth / 2;
    assert.ok(minX >= LANE.minX, `${prop.kind} clears the west wall`);
    assert.ok(maxX <= LANE.maxX, `${prop.kind} clears the east wall`);
    assert.ok(minZ >= LANE.minZ, `${prop.kind} clears the far wall`);
    assert.ok(maxZ <= LANE.maxZ, `${prop.kind} stays inside the lane`);
    // Keep the middle of the lane walkable next to the gate.
    const blocksGatePath = minX < GATE.x + 0.8 && maxX > GATE.x - 0.8 && maxZ > -19.5;
    assert.equal(blocksGatePath, false, `${prop.kind} does not block the way in`);
  }
});

test('the notice board is inside the lane and reachable', () => {
  assert.equal(areaAt(NOTICE_BOARD.x, NOTICE_BOARD.z), 'lane');
  for (const prop of LANE_PROPS) {
    const tooClose = Math.abs(prop.x - NOTICE_BOARD.x) < 0.8 && Math.abs(prop.z - NOTICE_BOARD.z) < 1.0;
    assert.equal(tooClose, false, `${prop.kind} does not cover the board`);
  }
});

test('the notice board reports faction standing and toll outcomes', () => {
  const state = createInitialState();
  assert.match(noticeText(state, 'neutral'), /Stalls open at dawn/);
  assert.match(noticeText(state, 'hostile'), /escorted/);
  assert.match(noticeText(state, 'cold'), /gate closes at dusk/);
  assert.match(noticeText(state, 'trusted'), /friends of the Watch/);

  const paid = createInitialState();
  startKey(paid); pickUpKey(paid); returnKey(paid);
  startToll(paid); collectToll(paid);
  assert.match(noticeText(paid, 'warm'), /collected in full/);

  const waived = createInitialState();
  startKey(waived); pickUpKey(waived); returnKey(waived);
  startToll(waived); waiveToll(waived, 'warm');
  assert.match(noticeText(waived, 'warm'), /Toll waived/);
});

test('every notice text is a complete sentence', () => {
  const state = createInitialState();
  for (const tier of ['hostile', 'cold', 'neutral', 'warm', 'trusted']) {
    const line = noticeText(state, tier);
    assert.ok(line.length > 20, `${tier} notice has substance`);
    assert.match(line, /[.!”]$/, `${tier} notice ends cleanly`);
  }
});
