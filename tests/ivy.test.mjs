// The ivy module decides where patches cling to the border walls, how wide and
// tall each is, which way it faces, its tint and how it sways; the world turns
// those numbers into one InstancedMesh of textured quads. These tests hold the
// module to its contract: the authored constants and their bands, the frozen
// tint and phase tables, the phase fallback, the descriptor shape, the ring
// radius and inward-facing normals, determinism and seed sensitivity, the
// `faces` override and its tangent placement, the guards on count/seed/options/
// faces, the sway and brightness bounds including the enormous-time guard, the
// quality gate, and a multi-seed sweep proving no NaN.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  IVY_SEED, IVY_COUNT, IVY_MAX_COUNT, IVY_WALL_RADIUS,
  IVY_MIN_BASE_Y, IVY_MAX_BASE_Y,
  IVY_MIN_WIDTH, IVY_MAX_WIDTH,
  IVY_MIN_SPAN, IVY_MAX_SPAN,
  IVY_MIN_SWAY, IVY_MAX_SWAY,
  IVY_TINTS, IVY_PHASE_GLOW,
  ivyGlowLevel, ivySpawns, ivySway, ivyEnabled
} from '../src/ivy.js';

const FIELDS = ['x', 'z', 'yaw', 'width', 'span', 'baseY', 'phase', 'tint', 'sway'];

test('the authored constants are the ones the world relies on', () => {
  assert.equal(IVY_SEED, 0x8b3e52);
  assert.equal(IVY_COUNT, 14);
  assert.equal(IVY_MAX_COUNT, 80);
  assert.equal(IVY_WALL_RADIUS, 16.3);
  assert.equal(IVY_MIN_BASE_Y, 0.15);
  assert.equal(IVY_MAX_BASE_Y, 1.6);
  assert.equal(IVY_MIN_WIDTH, 0.7);
  assert.equal(IVY_MAX_WIDTH, 1.9);
  assert.equal(IVY_MIN_SPAN, 0.9);
  assert.equal(IVY_MAX_SPAN, 2.4);
  assert.equal(IVY_MIN_SWAY, 0.01);
  assert.equal(IVY_MAX_SWAY, 0.035);
});

test('the bands are ordered and the count fits under its cap', () => {
  assert.ok(IVY_MIN_BASE_Y < IVY_MAX_BASE_Y);
  assert.ok(IVY_MIN_WIDTH < IVY_MAX_WIDTH);
  assert.ok(IVY_MIN_SPAN < IVY_MAX_SPAN);
  assert.ok(IVY_MIN_SWAY < IVY_MAX_SWAY);
  assert.ok(IVY_COUNT > 0 && IVY_COUNT <= IVY_MAX_COUNT);
});

test('the wall radius sits just inside the 16.5 m inner face', () => {
  // The play area is a 36 m square, so the inner face is at about 16.5 m. The
  // ring must fall on the visible stone, not in front of it.
  assert.ok(IVY_WALL_RADIUS <= 16.5, 'patches must stay on the wall');
  assert.ok(IVY_WALL_RADIUS >= 16, 'patches must reach the wall');
});

test('the tallest patch still leaves bare stone above it', () => {
  // baseY + span must fit under the 3.2 m wall, and the module's own cap is
  // 3.1 m. The highest possible base plus the tallest span must be at or under
  // that cap, which requires IVY_MAX_SPAN <= 3.1 - IVY_MIN_BASE_Y.
  assert.ok(IVY_MIN_BASE_Y + IVY_MAX_SPAN <= 3.1 + 1e-9, 'tallest patch would reach the coping');
  assert.ok(IVY_MAX_BASE_Y + IVY_MAX_SPAN >= 3.1 - 1e-9, 'cap never binds, baseY band unused');
});

test('the tint table is frozen, four colours and all green-dominant', () => {
  assert.ok(Object.isFrozen(IVY_TINTS));
  assert.equal(IVY_TINTS.length, 4);
  for (const tint of IVY_TINTS) {
    assert.equal(typeof tint, 'number');
    assert.ok(Number.isInteger(tint));
    assert.ok(tint >= 0 && tint <= 0xffffff, `tint ${tint} is not a 24-bit colour`);
    const r = (tint >> 16) & 0xff;
    const g = (tint >> 8) & 0xff;
    const b = tint & 0xff;
    assert.ok(g > r && g > b, `tint ${tint.toString(16)} is not green-dominant`);
  }
});

test('the phase glow table is frozen with the authored values and ordering', () => {
  assert.ok(Object.isFrozen(IVY_PHASE_GLOW));
  assert.equal(IVY_PHASE_GLOW.day, 1);
  assert.equal(IVY_PHASE_GLOW.dusk, 0.8);
  assert.equal(IVY_PHASE_GLOW.night, 0.35);
  // A plant is fully lit by day and a dark silhouette at night.
  assert.ok(IVY_PHASE_GLOW.day > IVY_PHASE_GLOW.dusk);
  assert.ok(IVY_PHASE_GLOW.dusk > IVY_PHASE_GLOW.night);
});

test('ivyGlowLevel is per phase and falls back to day', () => {
  assert.equal(ivyGlowLevel('day'), 1);
  assert.equal(ivyGlowLevel('dusk'), 0.8);
  assert.equal(ivyGlowLevel('night'), 0.35);
  // Unknown phase, and every kind of junk, reads as the day value (1).
  assert.equal(ivyGlowLevel('dawn'), 1);
  for (const junk of [undefined, null, 42, NaN, {}, [], 'DAY', true]) {
    assert.equal(ivyGlowLevel(junk), 1);
  }
  // Own-property lookup only: an inherited name must not leak a value.
  assert.equal(ivyGlowLevel('toString'), 1);
});

test('ivySpawns returns exactly count items with the exact field set', () => {
  const spawns = ivySpawns();
  assert.equal(spawns.length, IVY_COUNT);
  for (const s of spawns) {
    assert.deepEqual(Object.keys(s).sort(), [...FIELDS].sort());
    for (const key of FIELDS) {
      assert.ok(Number.isFinite(s[key]), `${key} is not finite`);
    }
  }
});

test('ivySpawns honours an explicit count', () => {
  assert.equal(ivySpawns({ count: 3 }).length, 3);
  assert.equal(ivySpawns({ count: 1 }).length, 1);
  assert.equal(ivySpawns({ count: IVY_MAX_COUNT }).length, IVY_MAX_COUNT);
  assert.deepEqual(ivySpawns({ count: 0 }), []);
});

test('ivySpawns is deterministic for identical arguments', () => {
  assert.deepEqual(ivySpawns(), ivySpawns());
  assert.deepEqual(ivySpawns({ count: 20, seed: 99 }), ivySpawns({ count: 20, seed: 99 }));
});

test('a different seed gives different ivy', () => {
  assert.notDeepEqual(ivySpawns({ seed: 1 }), ivySpawns({ seed: 2 }));
});

test('every default patch sits on the wall ring within 1e-6', () => {
  for (const s of ivySpawns()) {
    const reach = Math.hypot(s.x, s.z);
    assert.ok(Math.abs(reach - IVY_WALL_RADIUS) <= 1e-6, `reach ${reach} off the ring`);
  }
});

test('every default yaw points its normal at the plaza centre', () => {
  for (const s of ivySpawns()) {
    // The outward normal is (sin yaw, cos yaw); the direction to the centre is
    // (-x, -z). A positive dot product means the patch faces inward.
    const nx = Math.sin(s.yaw);
    const nz = Math.cos(s.yaw);
    const dot = nx * -s.x + nz * -s.z;
    assert.ok(dot > 0, `normal at (${s.x}, ${s.z}) faces away from the centre`);
    // And it is a unit normal, so the check above is not fooled by magnitude.
    assert.ok(Math.abs(Math.hypot(nx, nz) - 1) < 1e-9);
  }
});

test('the patches are spread around the ring, not stacked on one spot', () => {
  const spawns = ivySpawns({ count: IVY_COUNT });
  const angles = new Set(spawns.map((s) => Math.round(Math.atan2(s.z, s.x) * 1000)));
  assert.ok(angles.size > 10, `only ${angles.size} distinct angles`);
});

test('every width lies in the authored band', () => {
  for (const s of ivySpawns({ count: 60 })) {
    assert.ok(s.width >= IVY_MIN_WIDTH - 1e-9, `width ${s.width} below band`);
    assert.ok(s.width <= IVY_MAX_WIDTH + 1e-9, `width ${s.width} above band`);
  }
});

test('every span lies in the authored band', () => {
  for (const s of ivySpawns({ count: 60 })) {
    assert.ok(s.span >= IVY_MIN_SPAN - 1e-9, `span ${s.span} below band`);
    assert.ok(s.span <= IVY_MAX_SPAN + 1e-9, `span ${s.span} above band`);
  }
});

test('every baseY is in band and every patch stays under 3.1 m', () => {
  for (const s of ivySpawns({ count: 200 })) {
    assert.ok(s.baseY >= IVY_MIN_BASE_Y - 1e-9, `baseY ${s.baseY} below the ground band`);
    assert.ok(s.baseY <= IVY_MAX_BASE_Y + 1e-9, `baseY ${s.baseY} above the band`);
    assert.ok(s.baseY + s.span <= 3.1 + 1e-9, `patch reaches ${s.baseY + s.span} m up a 3.2 m wall`);
  }
});

test('phase, tint and sway are valid in every descriptor', () => {
  for (const s of ivySpawns({ count: 200 })) {
    assert.ok(s.phase >= 0 && s.phase < 1, `phase ${s.phase} left [0,1)`);
    assert.ok(Number.isInteger(s.tint), `tint ${s.tint} is not an integer`);
    assert.ok(s.tint >= 0 && s.tint < IVY_TINTS.length, `tint ${s.tint} out of table`);
    assert.ok(s.sway >= IVY_MIN_SWAY - 1e-9, `sway ${s.sway} below band`);
    assert.ok(s.sway <= IVY_MAX_SWAY + 1e-9, `sway ${s.sway} above band`);
  }
});

test('a junk count falls back to the default or clamps and floors', () => {
  for (const junk of [NaN, Infinity, -Infinity, 'x', null, {}, [], undefined]) {
    const spawns = ivySpawns({ count: junk });
    assert.equal(spawns.length, IVY_COUNT, `junk count ${String(junk)} did not default`);
    for (const s of spawns) assert.ok(Number.isFinite(s.x));
  }
  assert.equal(ivySpawns({ count: 1e9 }).length, IVY_MAX_COUNT);
  assert.equal(ivySpawns({ count: -5 }).length, 0);
  assert.equal(ivySpawns({ count: 3.9 }).length, 3);
});

test('a junk seed falls back to the authored seed', () => {
  assert.deepEqual(ivySpawns({ count: 5, seed: NaN }), ivySpawns({ count: 5, seed: IVY_SEED }));
  assert.deepEqual(ivySpawns({ count: 5, seed: Infinity }), ivySpawns({ count: 5 }));
  assert.deepEqual(ivySpawns({ count: 5, seed: 'x' }), ivySpawns({ count: 5, seed: IVY_SEED }));
});

test('a junk options argument reads as the defaults', () => {
  const base = ivySpawns();
  for (const junk of [undefined, null, 42, 'x', true, [], NaN]) {
    assert.deepEqual(ivySpawns(junk), base, `options ${String(junk)} did not default`);
  }
});

test('faces place each patch on its face line, with the face yaw', () => {
  const face = { x: 10, z: 5, yaw: 0.3, length: 4 };
  for (const s of ivySpawns({ count: 30, faces: [face] })) {
    assert.equal(s.yaw, face.yaw);
    const dx = s.x - face.x;
    const dz = s.z - face.z;
    // Perpendicular offset from the face line must be zero.
    const perpendicular = dx * Math.sin(face.yaw) + dz * Math.cos(face.yaw);
    assert.ok(Math.abs(perpendicular) < 1e-9, `patch left the face line by ${perpendicular}`);
    // Tangent offset must lie within +/-length/2.
    const along = dx * Math.cos(face.yaw) - dz * Math.sin(face.yaw);
    assert.ok(Math.abs(along) <= face.length / 2 + 1e-9, `offset ${along} past the face end`);
  }
});

test('a zero-length face pins the patch to the face centre', () => {
  const face = { x: -3, z: 8, yaw: 1.1, length: 0 };
  for (const s of ivySpawns({ count: 10, faces: [face] })) {
    assert.equal(s.x, -3);
    assert.equal(s.z, 8);
    assert.equal(s.yaw, 1.1);
  }
});

test('faces change only position and yaw, never size, tint, phase or sway', () => {
  const faces = [{ x: 16, z: 0, yaw: -Math.PI / 2, length: 30 }];
  const ring = ivySpawns({ count: 14 });
  const sited = ivySpawns({ count: 14, faces });
  assert.equal(sited.length, ring.length);
  for (let i = 0; i < ring.length; i += 1) {
    for (const key of ['width', 'span', 'baseY', 'phase', 'tint', 'sway']) {
      assert.equal(sited[i][key], ring[i][key], `${key} changed at index ${i} when faces were added`);
    }
  }
});

test('malformed face entries are dropped, good ones kept', () => {
  const good = { x: 1, z: 2, yaw: 0.4, length: 3 };
  const faces = [
    null, 42, 'x', [1, 2], {},
    { x: NaN, z: 2, yaw: 0, length: 3 },
    { x: 1, z: Infinity, yaw: 0, length: 3 },
    { x: 1, z: 2, yaw: NaN, length: 3 },
    { x: 1, z: 2, yaw: 0, length: -1 },
    good
  ];
  // Every surviving patch must be on the one good face.
  for (const s of ivySpawns({ count: 20, faces })) {
    assert.equal(s.yaw, good.yaw);
    const perpendicular = (s.x - good.x) * Math.sin(good.yaw) + (s.z - good.z) * Math.cos(good.yaw);
    assert.ok(Math.abs(perpendicular) < 1e-9);
  }
});

test('an empty or junk faces array falls back to the ring', () => {
  const base = ivySpawns({ count: 8 });
  assert.deepEqual(ivySpawns({ count: 8, faces: [] }), base);
  assert.deepEqual(ivySpawns({ count: 8, faces: 'nope' }), base);
  assert.deepEqual(ivySpawns({ count: 8, faces: {} }), base);
  // A list that survives no entries also reads as "no faces known".
  assert.deepEqual(ivySpawns({ count: 8, faces: [{ x: NaN, z: 0, yaw: 0, length: 1 }] }), base);
});

test('ivySway stays finite and inside its bands across a long sweep', () => {
  for (const s of ivySpawns()) {
    for (let t = 0; t < 120; t += 0.37) {
      const out = ivySway(s, t);
      assert.ok(Number.isFinite(out.sway), `sway not finite at t=${t}`);
      assert.ok(Number.isFinite(out.brightness), `brightness not finite at t=${t}`);
      assert.ok(out.sway >= -IVY_MAX_SWAY - 1e-9 && out.sway <= IVY_MAX_SWAY + 1e-9, `sway ${out.sway} out of band`);
      assert.ok(out.brightness >= 0 && out.brightness <= 1, `brightness ${out.brightness} out of [0,1]`);
    }
  }
});

test('brightness breathes in the gentle 0.92..1.0 band for a real patch', () => {
  const s = ivySpawns({ count: 1 })[0];
  let min = Infinity;
  let max = -Infinity;
  for (let t = 0; t < 60; t += 0.1) {
    const { brightness } = ivySway(s, t);
    min = Math.min(min, brightness);
    max = Math.max(max, brightness);
  }
  assert.ok(min >= 0.92 - 1e-9, `brightness dipped to ${min}`);
  assert.ok(max <= 1 + 1e-9, `brightness rose to ${max}`);
  // The breathing is real: it must actually vary over a cycle.
  assert.ok(max - min > 0.05, `brightness barely moved (${max - min})`);
});

test('sway never exceeds the patch amplitude and is scaled by it', () => {
  const s = ivySpawns({ count: 1 })[0];
  let peak = 0;
  for (let t = 0; t < 40; t += 0.05) {
    const { sway } = ivySway(s, t);
    assert.ok(Math.abs(sway) <= s.sway + 1e-9, `sway ${sway} exceeded amplitude ${s.sway}`);
    peak = Math.max(peak, Math.abs(sway));
  }
  // Over a full cycle the sine reaches 1, so the peak approaches the amplitude.
  assert.ok(peak > s.sway * 0.95, `peak ${peak} never approached amplitude ${s.sway}`);
});

test('a junk patch yields a still, fully lit patch rather than throwing', () => {
  for (const junk of [undefined, null, 42, 'x', NaN, [], true]) {
    const out = ivySway(junk, 12.3);
    assert.deepEqual(out, { sway: 0, brightness: 1 });
  }
});

test('a non-finite time reads as time 0', () => {
  const s = ivySpawns({ count: 1 })[0];
  const zero = ivySway(s, 0);
  for (const junk of [NaN, Infinity, -Infinity, undefined, null, 'x', {}]) {
    assert.deepEqual(ivySway(s, junk), zero, `time ${String(junk)} did not read as 0`);
  }
});

test('a patch with non-finite fields still yields finite sway', () => {
  const broken = { sway: NaN, phase: Infinity };
  for (const t of [0, 3.3, 100]) {
    const out = ivySway(broken, t);
    assert.ok(Number.isFinite(out.sway) && Number.isFinite(out.brightness));
    assert.ok(out.sway >= -IVY_MAX_SWAY && out.sway <= IVY_MAX_SWAY);
    assert.ok(out.brightness >= 0 && out.brightness <= 1);
  }
  // A missing sway reads as zero amplitude, a missing phase as phase 0.
  assert.deepEqual(ivySway({}, 5), { sway: 0, brightness: ivySway({ phase: 0 }, 5).brightness });
});

test('an enormous time cannot produce NaN from the trig argument', () => {
  const s = ivySpawns({ count: 1 })[0];
  for (const t of [Number.MAX_VALUE, -Number.MAX_VALUE, 1e308, -1e308]) {
    const out = ivySway(s, t);
    assert.ok(Number.isFinite(out.sway), `sway not finite at t=${t}`);
    assert.ok(Number.isFinite(out.brightness), `brightness not finite at t=${t}`);
    assert.ok(out.sway >= -IVY_MAX_SWAY && out.sway <= IVY_MAX_SWAY);
    assert.ok(out.brightness >= 0 && out.brightness <= 1);
  }
});

test('ivyEnabled is false only for the low tier', () => {
  assert.equal(ivyEnabled('low'), false);
  assert.equal(ivyEnabled('full'), true);
  for (const junk of [undefined, null, 'LOW', 'high', 42, {}, []]) {
    assert.equal(ivyEnabled(junk), true);
  }
});

test('a multi-seed sweep never yields NaN or an out-of-band value', () => {
  for (let seed = 0; seed < 40; seed += 1) {
    const spawns = ivySpawns({ count: 20, seed: seed * 0x9e3779b1 });
    assert.equal(spawns.length, 20);
    for (const s of spawns) {
      for (const key of FIELDS) {
        assert.ok(Number.isFinite(s[key]), `${key} not finite at seed ${seed}`);
      }
      assert.ok(s.tint >= 0 && s.tint < IVY_TINTS.length);
      assert.ok(s.baseY + s.span <= 3.1 + 1e-9);
      assert.ok(Math.abs(Math.hypot(s.x, s.z) - IVY_WALL_RADIUS) <= 1e-6);
    }
  }
});
