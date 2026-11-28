// Cloud shadows: the ground under a drifting cloud dims, softly.
//
// These tests hold the pure decisions the world would apply: the projection of
// a cloud along the sun, the smooth footprint it casts, how overlapping clouds
// combine, and the authored strength that keeps a shadow a dimming rather than
// an eclipse. Everything here is maths -- no scene, no clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLOUD_SHADOW_STRENGTH,
  DEFAULT_CLOUD_RADIUS,
  cloudShadowFactor,
  nearestCloudDistance,
  applyCloudShadow,
  cloudDapple,
  CLOUD_DAPPLE_MAX,
  CLOUD_DAPPLE_PERIOD_A,
  CLOUD_DAPPLE_PERIOD_B,
  projectCloudToGround,
  raisePointToCloud
} from '../src/cloudshadow.js';

// A high, near-vertical sun for the simple cases: straight down, no offset.
const OVERHEAD = { x: 0, y: 1, z: 0 };
// A cloud on the dome, well above the ground.
const CLOUD = { x: 0, y: 118, z: 0 };

test('no clouds means full sun', () => {
  assert.equal(cloudShadowFactor({ x: 0, y: 0, z: 0 }, [], OVERHEAD), 1);
  assert.equal(cloudShadowFactor({ x: 7, y: 0, z: -3 }, [], OVERHEAD), 1);
});

test('the factor is always within [0, 1]', () => {
  const clouds = [
    CLOUD,
    { x: 10, y: 118, z: 5 },
    { x: -20, y: 90, z: 30 }
  ];
  const sun = { x: 0.5, y: 0.8, z: 0.2 };
  for (let x = -30; x <= 30; x += 3) {
    for (let z = -30; z <= 30; z += 3) {
      const factor = cloudShadowFactor({ x, y: 0, z }, clouds, sun);
      assert.ok(factor >= 0 && factor <= 1, `factor ${factor} at ${x},${z} out of range`);
    }
  }
});

test('a point directly under the cloud is the darkest', () => {
  // With an overhead sun the projected centre is the cloud's own x/z.
  const under = cloudShadowFactor({ x: 0, y: 0, z: 0 }, [CLOUD], OVERHEAD);
  const far = cloudShadowFactor({ x: 200, y: 0, z: 0 }, [CLOUD], OVERHEAD);
  assert.ok(under < far, `under ${under} should be darker than far ${far}`);
  assert.ok(under < 0.5, 'the centre of a cloud should be substantially shaded');
  assert.equal(far, 1, 'far from every cloud is full sun');
});

test('the shadow fades smoothly to nothing at the cloud radius', () => {
  const radius = DEFAULT_CLOUD_RADIUS;
  // At the very centre the shade is full; at the rim it is gone; the middle is
  // strictly between, so the rim is a soft ramp rather than a hard disc.
  const centre = cloudShadowFactor({ x: 0, y: 0, z: 0 }, [CLOUD], OVERHEAD, radius);
  const mid = cloudShadowFactor({ x: radius / 2, y: 0, z: 0 }, [CLOUD], OVERHEAD, radius);
  const rim = cloudShadowFactor({ x: radius, y: 0, z: 0 }, [CLOUD], OVERHEAD, radius);
  assert.ok(centre < mid, `centre ${centre} darker than mid ${mid}`);
  assert.ok(mid < rim, `mid ${mid} darker than rim ${rim}`);
  assert.equal(rim, 1, 'at the radius the shadow has fully faded');
});

test('a tilted sun shifts the shadow off the cloud, not onto it', () => {
  // Sun low in the +x direction throws the shadow towards -x.
  const sun = { x: 1, y: 1, z: 0 };
  const atCloud = cloudShadowFactor({ x: 0, y: 0, z: 0 }, [CLOUD], sun);
  const alongShadow = cloudShadowFactor({ x: -118, y: 0, z: 0 }, [CLOUD], sun);
  assert.ok(alongShadow < atCloud, `shadow at -118 (${alongShadow}) should beat the cloud's own spot (${atCloud})`);
});

test('the sun direction convention does not flip the result', () => {
  // sunDir may point towards the sun or away from it; the projected ground
  // point must be the same either way.
  const towards = { x: 0.4, y: 0.9, z: 0.2 };
  const away = { x: -0.4, y: -0.9, z: -0.2 };
  const point = { x: -50, y: 0, z: -25 };
  assert.equal(
    cloudShadowFactor(point, [CLOUD], towards),
    cloudShadowFactor(point, [CLOUD], away),
    'reversing sunDir must not move the shadow'
  );
});

test('overlapping clouds combine to a darker patch than either alone', () => {
  const a = { x: 0, y: 118, z: 0 };
  const b = { x: 4, y: 118, z: 0 };
  const point = { x: 2, y: 0, z: 0 };
  const singleA = cloudShadowFactor(point, [a], OVERHEAD);
  const singleB = cloudShadowFactor(point, [b], OVERHEAD);
  const both = cloudShadowFactor(point, [a, b], OVERHEAD);
  assert.ok(both < singleA, `both ${both} darker than a ${singleA}`);
  assert.ok(both < singleB, `both ${both} darker than b ${singleB}`);
});

test('the result is deterministic', () => {
  const clouds = [CLOUD, { x: 8, y: 118, z: -4 }];
  const sun = { x: 0.3, y: 0.9, z: 0.1 };
  const point = { x: 3, y: 0, z: -2 };
  const first = cloudShadowFactor(point, clouds, sun);
  for (let i = 0; i < 20; i += 1) {
    assert.equal(cloudShadowFactor(point, clouds, sun), first);
  }
});

test('malformed input reads as full sun rather than throwing', () => {
  assert.equal(cloudShadowFactor(null, [CLOUD], OVERHEAD), 1);
  assert.equal(cloudShadowFactor({ x: 0, y: 0, z: 0 }, null, OVERHEAD), 1);
  assert.equal(cloudShadowFactor({ x: 0, y: 0, z: 0 }, [CLOUD], null), 1);
  assert.equal(cloudShadowFactor({ x: NaN, y: 0, z: 0 }, [CLOUD], OVERHEAD), 1);
  // A horizontal sun has no ground projection; the cloud simply casts nothing.
  assert.equal(cloudShadowFactor({ x: 0, y: 0, z: 0 }, [CLOUD], { x: 1, y: 0, z: 0 }), 1);
});

test('a custom radius widens the shadow footprint', () => {
  const point = { x: 20, y: 0, z: 0 };
  const narrow = cloudShadowFactor(point, [CLOUD], OVERHEAD, 10);
  const wide = cloudShadowFactor(point, [CLOUD], OVERHEAD, 40);
  assert.equal(narrow, 1, 'outside a small radius the ground is lit');
  assert.ok(wide < 1, 'inside a large radius the ground is shaded');
});

test('nearestCloudDistance is Infinity with no clouds', () => {
  assert.equal(nearestCloudDistance({ x: 0, y: 0, z: 0 }, [], OVERHEAD), Infinity);
  assert.equal(nearestCloudDistance({ x: 0, y: 0, z: 0 }, null, OVERHEAD), Infinity);
});

test('nearestCloudDistance measures to the projected centre on the ground', () => {
  // Overhead sun: the projected centre sits at the cloud's own x/z.
  const clouds = [{ x: 3, y: 118, z: 4 }, { x: -10, y: 118, z: 0 }];
  const distance = nearestCloudDistance({ x: 0, y: 0, z: 0 }, clouds, OVERHEAD);
  assert.equal(distance, 5, 'the nearer cloud is at (3, 4), five metres away');
});

test('nearestCloudDistance follows the same projection as the shadow', () => {
  const sun = { x: 1, y: 1, z: 0 };
  const projected = nearestCloudDistance({ x: -118, y: 0, z: 0 }, [CLOUD], sun);
  assert.ok(Math.abs(projected) < 1e-6, `projected centre should land at -118, got ${projected}`);
});

test('a fully shaded point keeps a floor of 1 - strength, not black', () => {
  // Base factor 0 (fully under a cloud) dims by the authored strength only.
  assert.ok(Math.abs(applyCloudShadow(0) - (1 - CLOUD_SHADOW_STRENGTH)) < 1e-9);
  assert.equal(applyCloudShadow(1), 1, 'full sun is unchanged');
});

test('applyCloudShadow stays within [0, 1] for wild input', () => {
  for (const base of [-5, -0.1, 0, 0.3, 0.75, 1, 2, NaN]) {
    for (const strength of [undefined, -1, 0, 0.35, 0.7, 1, 4, NaN]) {
      const result = applyCloudShadow(base, strength);
      assert.ok(result >= 0 && result <= 1, `applyCloudShadow(${base}, ${strength}) = ${result}`);
    }
  }
});

test('a custom strength changes how much a shadow dims', () => {
  assert.equal(applyCloudShadow(0, 0), 1, 'zero strength removes nothing');
  assert.equal(applyCloudShadow(0, 1), 0, 'full strength goes to black');
  const half = applyCloudShadow(0, 0.5);
  assert.ok(Math.abs(half - 0.5) < 1e-9, `half strength should reach 0.5, got ${half}`);
});

// --- The layer's aggregate dapple (round 89) --------------------------------
// The domed clouds cannot project onto the plaza, so the ground effect the world
// applies is the layer's slow aggregate dimming. These pin its shape: bounded,
// smooth, deterministic, and exactly neutral when told to cap nothing.

test('cloudDapple is bounded by the authored cap and never exceeds full sun', () => {
  for (let t = 0; t < 600; t += 0.5) {
    const lit = cloudDapple(t, 0.37);
    assert.ok(lit <= 1 + 1e-12, `dapple ${lit} at ${t}s is brighter than the sun`);
    assert.ok(lit >= 1 - CLOUD_DAPPLE_MAX - 1e-12,
      `dapple ${lit} at ${t}s dips below the cap ${1 - CLOUD_DAPPLE_MAX}`);
  }
});

test('cloudDapple is perfectly smooth: no step between neighbouring instants', () => {
  let worst = 0;
  for (let t = 0; t < 400; t += 0.25) {
    worst = Math.max(worst, Math.abs(cloudDapple(t + 0.25, 0.37) - cloudDapple(t, 0.37)));
  }
  // A quarter-second step must be tiny; the pattern is a 71/113 s pair of waves.
  assert.ok(worst < 0.01, `worst quarter-second step was ${worst}`);
});

test('cloudDapple is deterministic and reaches both clear and shaded spells', () => {
  assert.equal(cloudDapple(123.5, 0.37), cloudDapple(123.5, 0.37));
  let lo = 1;
  let hi = 0;
  for (let t = 0; t < 1200; t += 1) {
    const v = cloudDapple(t, 0.37);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  assert.ok(hi > 0.95, `the cycle never clears (peak ${hi})`);
  assert.ok(lo < 1 - CLOUD_DAPPLE_MAX * 0.6, `the cycle never shades (floor ${lo})`);
});

test('cloudDapple seeds offset the pattern but keep it in range', () => {
  const a = cloudDapple(40, 0);
  const b = cloudDapple(40, 0.37);
  assert.notEqual(a, b, 'a different seed should shift the pattern');
  assert.ok(a <= 1 && a >= 1 - CLOUD_DAPPLE_MAX);
  assert.ok(b <= 1 && b >= 1 - CLOUD_DAPPLE_MAX);
});

test('cloudDapple treats junk as full sun and honours a custom cap', () => {
  assert.equal(cloudDapple(NaN), 1);
  assert.equal(cloudDapple(Infinity), 1);
  assert.equal(cloudDapple(50, 0.37, 0), 1, 'a zero cap is exactly neutral');
  const tiny = cloudDapple(50, 0.37, 0.001);
  assert.ok(tiny >= 1 - 0.001 - 1e-12);
  // A cap above the authored maximum is clamped back to it.
  for (let t = 0; t < 300; t += 3) {
    assert.ok(cloudDapple(t, 0, 5) >= 1 - CLOUD_DAPPLE_MAX - 1e-12);
  }
});

test('cloudDapple constants are the documented pair', () => {
  assert.equal(CLOUD_DAPPLE_MAX, 0.2);
  assert.ok(CLOUD_DAPPLE_MAX < CLOUD_SHADOW_STRENGTH,
    'the whole layer must not dim more than a single authored shadow');
  assert.ok(CLOUD_DAPPLE_PERIOD_A > 30 && CLOUD_DAPPLE_PERIOD_B > 30);
  assert.notEqual(CLOUD_DAPPLE_PERIOD_A, CLOUD_DAPPLE_PERIOD_B);
});

// --- the projection as a public pair -------------------------------------
// Round 98's passer clouds need the map in both directions: the shadow a cloud
// throws, and the height a cloud must hang at for its shadow to land on the
// plaza. These pin the pair as exact inverses, and that neither direction is
// thrown by the sign convention the module documents.

test('an overhead sun drops the cloud straight down', () => {
  assert.deepEqual(projectCloudToGround({ x: 10, y: 40, z: -6 }, OVERHEAD), { x: 10, z: -6 });
});

test('a tilted sun projects along the ray', () => {
  const sun = { x: 1, y: 2, z: -1 };
  const cloud = { x: 0, y: 8, z: 0 };
  // t = 8 / 2 = 4, so ground = (0,0) - (1,2,-1) * 4 = (-4, -8, 4).
  assert.deepEqual(projectCloudToGround(cloud, sun), { x: -4, z: 4 });
});

test('the projection refuses a horizontal sun and junk', () => {
  assert.equal(projectCloudToGround({ x: 1, y: 5, z: 1 }, { x: 1, y: 0, z: 0 }), null);
  assert.equal(projectCloudToGround({ x: 1, y: 5, z: 1 }, { x: 1, y: 1e-9, z: 0 }), null);
  assert.equal(projectCloudToGround({ x: 1, y: 5, z: 1 }, { x: NaN, y: 1, z: 0 }), null);
  assert.equal(projectCloudToGround(null, OVERHEAD), null);
  assert.equal(projectCloudToGround({ x: 1, y: NaN, z: 1 }, OVERHEAD), null);
});

test('the sign convention does not move the projection', () => {
  const cloud = { x: 3, y: 22, z: -9 };
  const sun = { x: 16, y: 22, z: 10 };
  const flipped = { x: -16, y: -22, z: -10 };
  const a = projectCloudToGround(cloud, sun);
  const b = projectCloudToGround(cloud, flipped);
  assert.ok(Math.abs(a.x - b.x) < 1e-12 && Math.abs(a.z - b.z) < 1e-12);
});

test('raisePointToCloud is the exact inverse of the projection', () => {
  const sun = { x: 16, y: 22, z: 10 };
  for (const ground of [{ x: 0, z: 0 }, { x: 6, z: -11 }, { x: -18, z: 14 }]) {
    for (const altitude of [30, 37.5, 44]) {
      const cloud = raisePointToCloud(ground, sun, altitude);
      assert.ok(cloud, 'a valid pair must project');
      assert.ok(Math.abs(cloud.y - altitude) < 1e-9, `altitude ${cloud.y}`);
      const back = projectCloudToGround(cloud, sun);
      assert.ok(Math.abs(back.x - ground.x) < 1e-9 && Math.abs(back.z - ground.z) < 1e-9,
        `round trip moved ${JSON.stringify(ground)} to ${JSON.stringify(back)}`);
    }
  }
});

test('raisePointToCloud only reads the direction of the sun vector', () => {
  const a = raisePointToCloud({ x: 2, z: 2 }, { x: 16, y: 22, z: 10 }, 36);
  const b = raisePointToCloud({ x: 2, z: 2 }, { x: 1.6, y: 2.2, z: 1 }, 36);
  assert.ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9 &&
    Math.abs(a.z - b.z) < 1e-9);
});

test('raisePointToCloud refuses a low sun and junk', () => {
  assert.equal(raisePointToCloud({ x: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 30), null);
  assert.equal(raisePointToCloud({ x: 0, z: 0 }, { x: 1, y: 1e-8, z: 0 }, 30), null);
  assert.equal(raisePointToCloud({ x: 0, z: 0 }, OVERHEAD, 0), null);
  assert.equal(raisePointToCloud({ x: 0, z: 0 }, OVERHEAD, -4), null);
  assert.equal(raisePointToCloud({ x: 0, z: 0 }, OVERHEAD, NaN), null);
  assert.equal(raisePointToCloud({ x: 0, z: 0 }, OVERHEAD, '30'), null);
  assert.equal(raisePointToCloud(null, OVERHEAD, 30), null);
  assert.equal(raisePointToCloud({ x: 0, z: 0 }, null, 30), null);
});
