// The spoken compass. Getting a direction backwards would send a blind player the
// wrong way and they would have no way to notice, so the axis conventions are
// asserted against the real map rather than assumed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIRECTIONS, bearingDegrees, compassBearing, facingDegrees, relativeDirection,
  distanceTo, distancePhrase, describeTarget, nearbyTargets, routeHint, sentenceCase
} from '../src/compass.js';
import { GATE, LEDGER_SPOT, JOB_BOARD, NOTICE_BOARD, PLAZA, LANE } from '../src/areas.js';

const at = (x, z) => ({ x, z });

test('the cardinal axes match the map: north is -Z, east is +X', () => {
  assert.equal(compassBearing(0, -10), 'north');
  assert.equal(compassBearing(10, 0), 'east');
  assert.equal(compassBearing(0, 10), 'south');
  assert.equal(compassBearing(-10, 0), 'west');
});

test('the four diagonals are named correctly', () => {
  assert.equal(compassBearing(10, -10), 'north-east');
  assert.equal(compassBearing(10, 10), 'south-east');
  assert.equal(compassBearing(-10, 10), 'south-west');
  assert.equal(compassBearing(-10, -10), 'north-west');
});

test('the gate really is north of the plaza centre, by the map data', () => {
  // This is the assertion that catches a flipped Z axis. The gate sits in the north
  // wall but off to the east side (x = 9.5), so it reads north-east, not due north.
  // What matters is that it is in the northern half; a flipped axis would put it
  // south and no test would notice without this.
  const centre = at(0, 0);
  assert.ok(GATE.z < centre.z, 'the gate must be at more negative z than the centre');
  const bearing = compassBearing(GATE.x - centre.x, GATE.z - centre.z);
  assert.equal(['north', 'north-east', 'north-west'].includes(bearing), true,
    `the north gate must read north-ish, got ${bearing}`);
});

test('the market lane really is north of the plaza, by the map data', () => {
  const plazaCentreZ = (PLAZA.minZ + PLAZA.maxZ) / 2;
  const laneCentreZ = (LANE.minZ + LANE.maxZ) / 2;
  assert.ok(laneCentreZ < plazaCentreZ, 'the lane sits at more negative z than the plaza');
  const bearing = compassBearing(10.2 - 0, laneCentreZ - plazaCentreZ);
  assert.equal(['north', 'north-east', 'north-west'].includes(bearing), true,
    `the lane must read north-ish from the plaza, got ${bearing}`);
});

test('a bearing is always a real degree value', () => {
  for (const [dx, dz] of [[0, -1], [1, -1], [1, 0], [0, 0], [-3, 7]]) {
    const degrees = bearingDegrees(dx, dz);
    assert.ok(degrees >= 0 && degrees < 360, `${dx},${dz} -> ${degrees}`);
  }
});

test('standing exactly on a target has no bearing to give', () => {
  assert.equal(compassBearing(0, 0), null);
  assert.equal(relativeDirection(0, at(5, 5), at(5, 5)), 'right where you are');
});

test('facing north puts north ahead and east to the right', () => {
  assert.equal(facingDegrees(0), 0, 'yaw 0 faces north');
  assert.equal(relativeDirection(0, at(0, 0), at(0, -5)), 'straight ahead');
  assert.equal(relativeDirection(0, at(0, 0), at(5, 0)), 'to your right');
  assert.equal(relativeDirection(0, at(0, 0), at(-5, 0)), 'to your left');
  assert.equal(relativeDirection(0, at(0, 0), at(0, 5)), 'behind you');
});

test('turning changes the relative direction but not the world bearing', () => {
  const from = at(0, 0);
  const target = at(0, -5); // due north
  const facingNorth = relativeDirection(0, from, target);
  const facingEast = relativeDirection(-Math.PI / 2, from, target);
  assert.equal(facingNorth, 'straight ahead');
  assert.equal(facingEast, 'to your left', 'north is on your left when facing east');
  // The world bearing must not move as the player turns.
  assert.equal(compassBearing(target.x - from.x, target.z - from.z), 'north');
});

test('facing east is yaw -90 degrees, and north lands on the left', () => {
  assert.equal(Math.round(facingDegrees(-Math.PI / 2)), 90, 'yaw -90 faces east');
  assert.equal(relativeDirection(-Math.PI / 2, at(0, 0), at(0, -5)), 'to your left');
  assert.equal(relativeDirection(-Math.PI / 2, at(0, 0), at(5, 0)), 'straight ahead');
});

test('every one of the eight directions is reachable', () => {
  const seen = new Set();
  for (let degrees = 0; degrees < 360; degrees += 45) {
    const radians = (degrees * Math.PI) / 180;
    const dx = Math.sin(radians);
    const dz = -Math.cos(radians);
    seen.add(compassBearing(dx, dz));
  }
  assert.deepEqual([...seen].sort(), [...DIRECTIONS].sort());
});

test('distances are spoken, not read out as decimals', () => {
  assert.equal(distancePhrase(1), 'within reach');
  assert.equal(distancePhrase(4), 'a few steps away');
  assert.equal(distancePhrase(10), 'a short walk away');
  assert.equal(distancePhrase(20), 'across the plaza');
  assert.equal(distancePhrase(50), 'far off');
  for (const d of [0, 1, 5, 13, 29, 100]) {
    assert.equal(/[0-9]/.test(distancePhrase(d)), false, `${d} must not produce a numeral`);
  }
});

test('a target description names the thing, a direction, a distance and a bearing', () => {
  const described = describeTarget(0, at(0, 0), { id: 'bench', label: 'a bench', x: 0, z: -4 });
  assert.equal(described.id, 'bench');
  assert.match(described.phrase, /A bench is straight ahead/);
  assert.match(described.phrase, /a few steps away/);
  assert.match(described.phrase, /north of you/);
  assert.equal(described.bearing, 'north');
});

test('nearby targets come back nearest first', () => {
  const targets = [
    { id: 'far', label: 'the far stall', x: 0, z: -30 },
    { id: 'near', label: 'the near stall', x: 0, z: -3 },
    { id: 'mid', label: 'the mid stall', x: 0, z: -12 }
  ];
  const list = nearbyTargets(0, at(0, 0), targets);
  assert.deepEqual(list.map((t) => t.id), ['near', 'mid', 'far']);
});

test('nothing is reported for a target the player is standing inside', () => {
  // Otherwise the player is told to walk 0.1 units to a place they already are.
  const list = nearbyTargets(0, at(0, 0), [{ id: 'here', label: 'this spot', x: 0.1, z: 0 }]);
  assert.deepEqual(list, []);
});

test('the nearby list is capped so it stays speakable', () => {
  const targets = Array.from({ length: 20 }, (_, i) => ({
    id: `t${i}`, label: `thing ${i}`, x: 0, z: -(i + 5)
  }));
  assert.equal(nearbyTargets(0, at(0, 0), targets, 3).length, 3);
  assert.ok(nearbyTargets(0, at(0, 0), targets).length <= 5, 'default stays short');
});

test('a route hint names the destination and its direction', () => {
  // Facing north, a destination to the south is behind you. The hint must name the
  // place, say it is behind, and give the world bearing so it survives turning.
  const hint = routeHint(0, at(0, 0), { label: 'the job board', x: -3, z: 9 });
  assert.match(hint, /^The job board is behind you/);
  assert.match(hint, /south/, 'the world bearing belongs in the hint');
  assert.equal(/[0-9]/.test(hint), false, 'no numerals in a spoken hint');
});

test('a route hint is withheld when the destination is already reached', () => {
  assert.equal(routeHint(0, at(0, 0), { label: 'here', x: 0.5, z: 0.5 }), null);
  assert.equal(routeHint(0, at(0, 0), null), null, 'no destination, nothing to say');
});

test('board and landmark coordinates produce sane directions from the plaza centre', () => {
  const centre = at(0, 0);
  // The job board is south-west-ish, the notice board north-east in the lane.
  const job = compassBearing(JOB_BOARD.x - centre.x, JOB_BOARD.z - centre.z);
  assert.ok(['south', 'south-west', 'west', 'south-east'].includes(job), `job board read ${job}`);
  const notice = compassBearing(NOTICE_BOARD.x - centre.x, NOTICE_BOARD.z - centre.z);
  assert.ok(['north', 'north-east', 'east', 'north-west'].includes(notice), `notice board read ${notice}`);
  // The ledger is in the lane, so it must be north of the plaza centre.
  assert.equal(compassBearing(LEDGER_SPOT.x - centre.x, LEDGER_SPOT.z - centre.z), 'north');
});

test('distance is measured on the ground plane, ignoring height', () => {
  assert.equal(distanceTo(at(0, 0), { x: 3, z: 4, y: 100 }), 5);
});

test('a spoken phrase starts with a capital letter', () => {
  // These are read aloud as whole sentences, and a lower-case "the job board"
  // reads as a fragment.
  const described = describeTarget(0, at(0, 0), { id: 'jb', label: 'the job board', x: -3, z: 9 });
  assert.match(described.phrase, /^The job board is /);
});

test('sentence case does not mangle a name already capitalised', () => {
  assert.equal(sentenceCase('Mara the Keeper is here.'), 'Mara the Keeper is here.');
  assert.equal(sentenceCase('the fountain'), 'The fountain');
  assert.equal(sentenceCase(''), '');
});

test('a route hint is capitalised like every other spoken sentence', () => {
  // Two different phrases are spoken aloud for the same thing; both must read as
  // sentences, or one sounds like a fragment.
  const hint = routeHint(0, at(0, 0), { label: 'the bench', x: -7, z: 12 });
  assert.match(hint, /^The bench is /);
  assert.equal(sentenceCase(hint), hint, 'already capitalised, so unchanged');
});
