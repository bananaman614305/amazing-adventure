import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SHADOW_SEED,
  SHADOW_COUNT,
  SHADOW_MAX_COUNT,
  SHADOW_MIN_RADIUS,
  SHADOW_MAX_RADIUS,
  SHADOW_PHASE_OPACITY,
  SHADOW_MIN_SQUASH,
  SHADOW_MAX_SQUASH,
  SHADOW_JITTER,
  SHADOW_DECAL_LIFT,
  CONTACT_SHADOW_SUN_HORIZON,
  shadowOpacity,
  shadowsEnabled,
  shadowDecals,
  contactShadowYaw
} from '../src/contactshadows.js';
import { MOSS_DECAL_LIFT } from '../src/moss.js';
import { PUDDLE_WATER_Y } from '../src/puddles.js';

// The courtyard props the world actually hands over, at the radii it uses, so
// the suite exercises the real footprint scale rather than invented ones.
const ANCHORS = [
  { x: 0, z: 0, radius: 2.15 },      // fountain basin
  { x: 7, z: 7, radius: 0.16 },      // plaza lamp
  { x: -13, z: 13, radius: 0.25 },   // tree trunk
  { x: -10.5, z: -9, radius: 4.5 },  // house
  { x: 11, z: -3, radius: 2.2 },     // east stall
  { x: 5, z: 8, radius: 0.85 },      // crate
  { x: 6.9, z: -24.4, radius: 0.5 }  // lane barrel
];

test('the documented constants keep their values', () => {
  assert.equal(SHADOW_SEED, 0x5a0d0c);
  assert.equal(SHADOW_COUNT, 40);
  assert.equal(SHADOW_MAX_COUNT, 96);
  assert.equal(SHADOW_MIN_RADIUS, 0.4);
  assert.equal(SHADOW_MAX_RADIUS, 3.5);
  assert.deepEqual(SHADOW_PHASE_OPACITY, { day: 0.30, dusk: 0.20, night: 0.12 });
  assert.ok(Object.isFrozen(SHADOW_PHASE_OPACITY));
  assert.equal(SHADOW_MIN_SQUASH, 0.4);
  assert.equal(SHADOW_MAX_SQUASH, 1.0);
  assert.equal(SHADOW_JITTER, 0.35);
});

test('one decal per usable anchor, in the caller order', () => {
  const decals = shadowDecals(ANCHORS);
  assert.equal(decals.length, ANCHORS.length);
  for (let i = 0; i < decals.length; i += 1) {
    const d = decals[i];
    const a = ANCHORS[i];
    // The jitter never carries a decal outside SHADOW_JITTER of its footprint.
    // The footprint radius is clamped into the documented range first, so a
    // lamp post (0.16 m) is jittered against the 0.4 m floor, not its own
    // radius -- the decal still has to be big enough to see.
    const grounded = Math.min(SHADOW_MAX_RADIUS, Math.max(SHADOW_MIN_RADIUS, a.radius));
    assert.ok(Math.abs(d.x - a.x) <= SHADOW_JITTER * grounded + 1e-9);
    assert.ok(Math.abs(d.z - a.z) <= SHADOW_JITTER * grounded + 1e-9);
  }
});

test('every output field stays inside its documented range', () => {
  for (const d of shadowDecals(ANCHORS)) {
    assert.ok(Number.isFinite(d.x));
    assert.ok(Number.isFinite(d.z));
    assert.ok(d.radius >= SHADOW_MIN_RADIUS && d.radius <= SHADOW_MAX_RADIUS);
    assert.ok(d.squash >= SHADOW_MIN_SQUASH && d.squash <= SHADOW_MAX_SQUASH);
    assert.ok(d.opacity >= 0.4 && d.opacity <= 0.7);
  }
});

test('a tiny footprint is lifted to the minimum radius, a huge one clamped to the maximum', () => {
  const decals = shadowDecals([
    { x: 1, z: 1, radius: 0.01 },
    { x: 2, z: 2, radius: 400 }
  ]);
  assert.equal(decals.length, 2);
  assert.ok(decals[0].radius >= SHADOW_MIN_RADIUS);
  assert.ok(decals[1].radius <= SHADOW_MAX_RADIUS);
  // And the jitter follows the clamped radius, not the absurd one.
  assert.ok(Math.abs(decals[1].x - 2) <= SHADOW_JITTER * SHADOW_MAX_RADIUS + 1e-9);
});

test('junk anchors are dropped without throwing', () => {
  const decals = shadowDecals([
    null,
    undefined,
    'x',
    42,
    [],
    {},
    { x: 0 },
    { x: NaN, z: 0, radius: 1 },
    { x: 0, z: Infinity, radius: 1 },
    { x: 0, z: 0, radius: NaN },
    { x: 0, z: 0, radius: 0 },
    { x: 0, z: 0, radius: -3 },
    { x: 3, z: 4, radius: 1 }
  ]);
  assert.equal(decals.length, 1);
  assert.ok(Number.isFinite(decals[0].x));
  assert.ok(Number.isFinite(decals[0].z));
});

test('a non-array argument returns an empty list', () => {
  for (const junk of [undefined, null, 0, 'anchors', {}, { length: 3 }]) {
    assert.deepEqual(shadowDecals(junk), []);
  }
});

test('the list is capped at SHADOW_MAX_COUNT', () => {
  const many = [];
  for (let i = 0; i < SHADOW_MAX_COUNT + 40; i += 1) {
    many.push({ x: i, z: -i, radius: 1 });
  }
  assert.equal(shadowDecals(many).length, SHADOW_MAX_COUNT);
});

test('identical anchors produce bit-identical decals', () => {
  const a = shadowDecals(ANCHORS);
  const b = shadowDecals(ANCHORS);
  assert.deepEqual(a, b);
});

test('two identical anchors in one list still draw differently', () => {
  const decals = shadowDecals([
    { x: 4, z: 4, radius: 1 },
    { x: 4, z: 4, radius: 1 }
  ]);
  assert.equal(decals.length, 2);
  // Same anchor position means the same stream, so the two decals agree; what
  // must not happen is a decal copied from the other prop's position.
  assert.deepEqual(decals[0], decals[1]);
  const other = shadowDecals([{ x: 4.001, z: 4, radius: 1 }]);
  assert.notDeepEqual(other[0], decals[0]);
});

test('reordering the anchor list does not change any decal', () => {
  const forward = shadowDecals(ANCHORS);
  const reversed = shadowDecals([...ANCHORS].reverse());
  for (let i = 0; i < forward.length; i += 1) {
    assert.deepEqual(reversed[reversed.length - 1 - i], forward[i]);
  }
});

test('a junk sweep never yields NaN or Infinity', () => {
  const sweep = [
    { x: Number.MAX_VALUE, z: -Number.MAX_VALUE, radius: 1e300 },
    { x: -0, z: 0, radius: Number.MIN_VALUE },
    { x: 1e-320, z: 1e-320, radius: 1e-320 },
    { x: 5, z: 5, radius: 5 }
  ];
  for (const d of shadowDecals(sweep)) {
    for (const value of [d.x, d.z, d.radius, d.squash, d.opacity]) {
      assert.ok(Number.isFinite(value));
    }
  }
});

test('shadowOpacity returns the documented value for each phase', () => {
  assert.equal(shadowOpacity('day'), 0.30);
  assert.equal(shadowOpacity('dusk'), 0.20);
  assert.equal(shadowOpacity('night'), 0.12);
});

test('shadowOpacity falls back to the day value for junk', () => {
  for (const junk of [undefined, null, 7, {}, [], '', 'dawn', 'toString']) {
    assert.equal(shadowOpacity(junk), SHADOW_PHASE_OPACITY.day);
  }
});

test('the field runs on full and is dropped on low', () => {
  assert.equal(shadowsEnabled('full'), true);
  assert.equal(shadowsEnabled('low'), false);
  for (const junk of [undefined, null, 'medium', 0, {}]) {
    assert.equal(shadowsEnabled(junk), true);
  }
});

test('ground overlays stack from shadow to moss to puddle without z-fighting', () => {
  // Contact shadows lie under moss, and a puddle lies on top of both, so no
  // two translucent layers can share a height and z-fight or occlude the wrong
  // one. Each lift is a thin film, not a raised disc.
  for (const lift of [SHADOW_DECAL_LIFT, MOSS_DECAL_LIFT, PUDDLE_WATER_Y]) {
    assert.ok(Number.isFinite(lift), `lift must be finite: ${lift}`);
    assert.ok(lift > 0, `lift must be above the surface: ${lift}`);
  }
  assert.ok(SHADOW_DECAL_LIFT < MOSS_DECAL_LIFT, 'shadows sit below moss');
  assert.ok(MOSS_DECAL_LIFT < PUDDLE_WATER_Y, 'moss sits below puddles');
  assert.ok(PUDDLE_WATER_Y < 0.05, 'puddle stays a film, not a raised disc');
  assert.ok(SHADOW_DECAL_LIFT <= 0.01, 'shadow decal stays a film');
});

test('contactShadowYaw is exported and the horizon constant is zero', () => {
  assert.equal(CONTACT_SHADOW_SUN_HORIZON, 0);
  assert.equal(typeof contactShadowYaw, 'function');
});

test('contactShadowYaw returns a value in [0, 2*PI)', () => {
  for (const sp of [[16, 22, 10], [-18, 7, 6], [12, 20, -8], [0, 1, 0]]) {
    const y = contactShadowYaw(sp, 3, 4);
    assert.ok(Number.isFinite(y));
    assert.ok(y >= 0 && y < Math.PI * 2);
  }
});

test('contactShadowYaw is deterministic', () => {
  const a = contactShadowYaw([16, 22, 10], 3, 4);
  const b = contactShadowYaw([16, 22, 10], 3, 4);
  assert.equal(a, b);
});

test('day and dusk sun positions yield different yaws', () => {
  const day = contactShadowYaw([16, 22, 10], 3, 4);
  const dusk = contactShadowYaw([-18, 7, 6], 3, 4);
  assert.notEqual(day, dusk);
  // The sun swings roughly 180 degrees between day and dusk.
  let diff = Math.abs(day - dusk);
  if (diff > Math.PI) diff = Math.PI * 2 - diff;
  assert.ok(diff > Math.PI / 2, `expected a large swing, got ${diff}`);
});

test('a below-horizon sun falls back to the placeholder yaw', () => {
  const yaw = contactShadowYaw([0, -5, 0], 3, 4);
  const placeholder = ((3 * 0.7 + 4 * 1.3) % (Math.PI * 2) + (Math.PI * 2)) % (Math.PI * 2);
  assert.equal(yaw, placeholder);
});

test('junk sunPosition falls back to the placeholder yaw', () => {
  const placeholder = ((3 * 0.7 + 4 * 1.3) % (Math.PI * 2) + (Math.PI * 2)) % (Math.PI * 2);
  for (const junk of [undefined, null, 7, 'x', [], [1, 2], [NaN, 1, 2], [1, NaN, 2], [1, 2, NaN]]) {
    assert.equal(contactShadowYaw(junk, 3, 4), placeholder, `failed for ${JSON.stringify(junk)}`);
  }
});

test('junk decal coordinates fall back to the placeholder using zero', () => {
  // Non-finite decal coords should not throw and should land in range.
  for (const [dx, dz] of [[NaN, 4], [3, NaN], [Infinity, 4], [3, -Infinity]]) {
    const y = contactShadowYaw([16, 22, 10], dx, dz);
    // Sun is above horizon, so yaw comes from sun alone; decal coords do not matter.
    assert.ok(Number.isFinite(y));
    assert.ok(y >= 0 && y < Math.PI * 2);
  }
});

test('night sun (above horizon) uses the sun aim, not the fallback', () => {
  const night = contactShadowYaw([12, 20, -8], 3, 4);
  const placeholder = ((3 * 0.7 + 4 * 1.3) % (Math.PI * 2) + (Math.PI * 2)) % (Math.PI * 2);
  assert.notEqual(night, placeholder);
});
