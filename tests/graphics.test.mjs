// The camera pipeline: exposure tables, ambient room colours, shadow budget
// and the renderer configuration contract.
//
// These tests deliberately avoid a GPU. Everything decision-shaped is a pure
// function in src/graphics.js, so the values that used to be invisible magic
// numbers (exposure per phase, ambient intensity, shadow map size) are pinned
// here and a regression in the look shows up as a failing assertion rather than
// as "the game looks flat now" months later.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TONE_MAPPING_NAME, PHASE_EXPOSURE, phaseExposure,
  PHASE_ENV_INTENSITY, phaseEnvIntensity,
  ambientRoomFor, shadowSettings, configureRenderer, applyPhaseLook,
  buildEnvironmentMap, skyBlend, skyHazeBlend, skyVertexColor,
  HAZE_HEIGHT, PHASE_SUN_DISK, sunDiskIntensity, SUN_DISTANCE,
  SUN_CORE_RADIUS, SUN_GLOW_RADIUS, sunDiscPosition, shadowFrustumFor
} from '../src/graphics.js';
import { PHASE_LOOKS } from '../src/world.js';
import { PLAZA, LANE } from '../src/areas.js';

test('the tone curve is the filmic one, not the default linear pass-through', () => {
  assert.equal(TONE_MAPPING_NAME, 'ACESFilmic');
});

test('every phase the day/night cycle can report has an exposure', () => {
  for (const phase of Object.keys(PHASE_LOOKS)) {
    const value = phaseExposure(phase);
    assert.equal(typeof value, 'number', `no exposure for ${phase}`);
    assert.ok(value > 0, `${phase} exposure must be positive`);
  }
  assert.deepEqual(Object.keys(PHASE_EXPOSURE).sort(), Object.keys(PHASE_LOOKS).sort());
});

test('night is exposed up and day is the reference', () => {
  assert.equal(phaseExposure('day'), 1);
  assert.ok(phaseExposure('dusk') > phaseExposure('day'), 'dusk should lift over day');
  assert.ok(phaseExposure('night') > phaseExposure('dusk'), 'night should lift over dusk');
  // A sanity ceiling: exposing night so far that it reads as day defeats the
  // cycle, and this catches someone cranking the number to "fix" a dark frame.
  assert.ok(phaseExposure('night') <= 2, 'night exposure is too high to read as night');
});

test('an unknown phase falls back to the day reference instead of NaN', () => {
  assert.equal(phaseExposure('midnight-ish'), 1);
  assert.equal(phaseExposure(undefined), 1);
  assert.equal(phaseEnvIntensity('nope'), PHASE_ENV_INTENSITY.day);
});

test('ambient intensity is dimmer at night so IBL does not fake daylight', () => {
  assert.ok(phaseEnvIntensity('day') > phaseEnvIntensity('dusk'));
  assert.ok(phaseEnvIntensity('dusk') >= phaseEnvIntensity('night'));
  for (const phase of Object.keys(PHASE_LOOKS)) {
    const value = phaseEnvIntensity(phase);
    assert.ok(value > 0 && value <= 1, `${phase} ambient intensity out of range: ${value}`);
  }
});

test('the ambient room is built from real phase colours, not a fixed grey', () => {
  const day = PHASE_LOOKS.day;
  const room = ambientRoomFor(day.zenith, day.sky, day.hemiGround);
  assert.equal(room.zenith, day.zenith >>> 0);
  assert.equal(room.horizon, day.sky >>> 0);
  assert.equal(room.ground, day.hemiGround >>> 0);

  // Night must produce a materially different room, or the ambient light would
  // stay day-blue while the sky goes black.
  const night = PHASE_LOOKS.night;
  const nightRoom = ambientRoomFor(night.zenith, night.sky, night.hemiGround);
  assert.notDeepEqual(room, nightRoom);
  const luminance = (hex) => (((hex >> 16) & 255) * 0.2126 + ((hex >> 8) & 255) * 0.7152 + (hex & 255) * 0.0722) / 255;
  assert.ok(luminance(nightRoom.horizon) < luminance(room.horizon),
    'the night ambient room must be darker than the day one');
});

test('ambient room colours are coerced to unsigned ints', () => {
  const room = ambientRoomFor(-1, 0xffffff, 0x102030);
  assert.equal(room.zenith, 0xffffffff);
  assert.equal(room.horizon, 0xffffff);
  assert.equal(room.ground, 0x102030);
});

test('the low tier drops the shadow pass and the map shrinks with it', () => {
  const full = shadowSettings('full');
  const low = shadowSettings('low');
  assert.equal(full.enabled, true);
  assert.equal(low.enabled, false);
  assert.ok(low.mapSize < full.mapSize, 'low tier should not keep the full shadow map');
  assert.ok(full.mapSize >= 2048, 'full tier keeps a sharp plaza shadow');
});

test('shadow settings are stable across calls so tier flips are idempotent', () => {
  assert.deepEqual(shadowSettings('full'), shadowSettings('full'));
  assert.deepEqual(shadowSettings('low'), shadowSettings('low'));
  assert.deepEqual(shadowSettings(undefined), shadowSettings('full'));
});

// --- Shadow frustum coverage -------------------------------------------
// The plaza's shadow box was hard-coded +-24 when the plaza was the whole
// world. The market lane was later added north of it and the box was never
// revisited, so lane props fell outside the depth pass and cast no shadow.
// These tests pin the property that made the bug possible: every declared
// point of every area must land inside the box.

/** Projects a world point onto the shadow box, returning normalised coords. */
function projectIntoBox(box, x, z) {
  // The ortho box is square and centred on the world centre in the ground
  // plane, so the mapping is a plain scale about that centre.
  const half = (box.right - box.left) / 2;
  return {
    x: (x - box.centre.x) / half,
    y: (z - box.centre.z) / half
  };
}

const WORLD_AREAS = [PLAZA, LANE];

test('the shadow box is square so the square shadow map spends every texel', () => {
  const box = shadowFrustumFor(WORLD_AREAS);
  assert.equal(box.right - box.left, box.top - box.bottom);
  assert.equal(box.left, -box.right);
  assert.equal(box.bottom, -box.top);
});

test('every corner of every area falls inside the shadow box', () => {
  const box = shadowFrustumFor(WORLD_AREAS);
  for (const area of WORLD_AREAS) {
    for (const x of [area.minX, area.maxX]) {
      for (const z of [area.minZ, area.maxZ]) {
        const p = projectIntoBox(box, x, z);
        assert.ok(Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1,
          `${area.id} corner (${x}, ${z}) projects to ${p.x.toFixed(2)}, ${p.y.toFixed(2)} - outside the shadow box`);
      }
    }
  }
});

test('the old +-24 box would have failed the lane coverage check', () => {
  // A negative control: this is the bug, reproduced as arithmetic. If someone
  // reintroduces a fixed small box, the coverage expectation above still holds
  // but this test documents exactly why the box must be derived.
  const old = { left: -24, right: 24, top: 24, bottom: -24, centre: { x: 0, z: 0 } };
  const laneEnd = projectIntoBox(old, LANE.maxX, LANE.minZ);
  assert.ok(Math.abs(laneEnd.x) > 1 || Math.abs(laneEnd.y) > 1,
    'the lane end should fall outside the historical +-24 box');
});

test('the box is centred on the world rather than on the origin', () => {
  const box = shadowFrustumFor(WORLD_AREAS);
  const minZ = Math.min(PLAZA.minZ, LANE.minZ);
  const maxZ = Math.max(PLAZA.maxZ, LANE.maxZ);
  assert.equal(box.centre.z, (minZ + maxZ) / 2);
});

test('the shadow box grows when an area is added further out', () => {
  const before = shadowFrustumFor(WORLD_AREAS);
  const extended = shadowFrustumFor([...WORLD_AREAS, { id: 'far', minX: -40, maxX: -38, minZ: 30, maxZ: 32 }]);
  assert.ok(extended.size > before.size, 'a new distant area must widen the frustum');
  const p = projectIntoBox(extended, -40, 32);
  assert.ok(Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1, 'the new area corner must be covered');
});

test('the shadow box is larger than the plane it covers, so edges are not clipped', () => {
  const box = shadowFrustumFor(WORLD_AREAS);
  assert.ok(box.size > 48, 'box must exceed the old +-24 extent');
  assert.ok(box.near >= 1, 'near plane stays in front of the light');
  assert.ok(box.far > box.size, 'far plane must clear the whole box');
});

test('an empty or malformed area list falls back to the historical box', () => {
  for (const input of [[], undefined, null, [null], [{}]]) {
    const box = shadowFrustumFor(input);
    assert.equal(box.left, -24);
    assert.equal(box.right, 24);
    assert.ok(Number.isFinite(box.near) && Number.isFinite(box.far));
  }
});

test('configureRenderer sets tone mapping, exposure and colour space together', () => {
  const THREE = {
    ACESFilmicToneMapping: 4,
    SRGBColorSpace: 'srgb'
  };
  const renderer = {};
  configureRenderer(renderer, THREE);
  assert.equal(renderer.toneMapping, THREE.ACESFilmicToneMapping);
  assert.equal(renderer.toneMappingExposure, 1);
  assert.equal(renderer.outputColorSpace, 'srgb');
});

test('applyPhaseLook drives exposure and ambient intensity from one phase id', () => {
  const renderer = {};
  const scene = {};
  const applied = applyPhaseLook(renderer, scene, 'night');
  assert.equal(renderer.toneMappingExposure, phaseExposure('night'));
  assert.equal(scene.environmentIntensity, phaseEnvIntensity('night'));
  assert.equal(applied.exposure, phaseExposure('night'));
  assert.equal(applied.environmentIntensity, phaseEnvIntensity('night'));
});

test('applyPhaseLook tolerates a missing renderer or scene', () => {
  assert.doesNotThrow(() => applyPhaseLook(null, null, 'dusk'));
  const renderer = {};
  applyPhaseLook(renderer, null, 'dusk');
  assert.equal(renderer.toneMappingExposure, phaseExposure('dusk'));
});

test('the environment map builder returns null instead of throwing when it cannot build one', () => {
  // No renderer, and a THREE stub with no PMREMGenerator: this is the "GPU is
  // gone" path, and the contract is that the caller keeps its old ambient.
  assert.equal(buildEnvironmentMap(null, {}, { zenith: 1, horizon: 2, ground: 3 }), null);
  assert.equal(buildEnvironmentMap({}, {}, { zenith: 1, horizon: 2, ground: 3 }), null);
});

test('a throwing PMREM generator is contained rather than taking the frame down', () => {
  const THREE = {
    PMREMGenerator: function PMREMGenerator() {
      throw new Error('context lost');
    }
  };
  assert.equal(buildEnvironmentMap({}, THREE, { zenith: 1, horizon: 2, ground: 3 }), null);
});

// Minimal colour holder: the sky functions only read .r/.g/.b, so hex objects
// from Three.js are not needed and the test stays GPU- and import-light.
function THREE_COLOR(hex) {
  return {
    r: ((hex >> 16) & 255) / 255,
    g: ((hex >> 8) & 255) / 255,
    b: (hex & 255) / 255
  };
}

// --- Sky dome ------------------------------------------------------------
//
// The dome is painted with vertex colours, so the shape of the sky is decided
// entirely by these three functions. They are pinned here because a sky is the
// one thing every screenshot contains: if the horizon stops being the hazy end,
// or the haze band grows to swallow the whole dome, the game looks wrong in a
// way no other test would catch.

test('skyBlend eases from the horizon to the zenith and clamps outside the dome', () => {
  assert.equal(skyBlend(0), 0);
  assert.equal(skyBlend(1), 1);
  // Below the equator the dome stays horizon-coloured rather than going darker.
  assert.equal(skyBlend(-0.5), 0);
  assert.equal(skyBlend(-1), 0);
  assert.equal(skyBlend(2), 1);
  // Monotonic, so no vertex is painted brighter than a vertex above it.
  let previous = -1;
  for (let y = 0; y <= 1; y += 0.05) {
    const v = skyBlend(y);
    assert.ok(v >= previous, `skyBlend dipped at y=${y}`);
    previous = v;
  }
  // Still the round-56 midpoint, so earlier measurements keep their meaning.
  assert.ok(Math.abs(skyBlend(0.5) - 0.896) < 0.01, `midpoint ${skyBlend(0.5)}`);
});

test('skyHazeBlend is strongest at the horizon and gone above the band', () => {
  assert.equal(skyHazeBlend(0), 1);
  assert.equal(skyHazeBlend(HAZE_HEIGHT), 0);
  assert.equal(skyHazeBlend(HAZE_HEIGHT + 0.1), 0);
  assert.equal(skyHazeBlend(1), 0);
  // Below the horizon the haze stays at full strength, so the horizon line
  // itself does not show a seam.
  assert.equal(skyHazeBlend(-0.3), 1);
  let previous = 2;
  for (let y = 0; y <= HAZE_HEIGHT; y += HAZE_HEIGHT / 20) {
    const v = skyHazeBlend(y);
    assert.ok(v <= previous, `skyHazeBlend rose at y=${y}`);
    previous = v;
  }
});

test('skyVertexColor with the horizon colour as haze reproduces the plain gradient', () => {
  // Regression guard: passing haze === horizon must give exactly the round-56
  // two-stop dome, so the haze band is genuinely an addition, not a redefinition.
  const zenith = { r: 0.2, g: 0.4, b: 0.8 };
  const horizon = { r: 0.5, g: 0.7, b: 0.9 };
  for (const y of [-1, -0.2, 0, 0.3, 0.6, 1]) {
    const c = skyVertexColor(zenith, horizon, horizon, y);
    const s = skyBlend(y);
    assert.ok(Math.abs(c.r - (horizon.r + (zenith.r - horizon.r) * s)) < 1e-9);
    assert.ok(Math.abs(c.g - (horizon.g + (zenith.g - horizon.g) * s)) < 1e-9);
    assert.ok(Math.abs(c.b - (horizon.b + (zenith.b - horizon.b) * s)) < 1e-9);
  }
});

test('every phase palette keeps the horizon the bright end of the sky', () => {
  // The horizon is the hazy, scattered end and the zenith is the clean end. If
  // a palette inverted that, the sky would read upside down; this is the check
  // that would fail first.
  for (const [phase, look] of Object.entries(PHASE_LOOKS)) {
    const zenith = new THREE_COLOR(look.zenith ?? look.sky);
    const horizon = new THREE_COLOR(look.sky);
    const haze = new THREE_COLOR(look.haze ?? look.sky);
    const low = skyVertexColor(zenith, horizon, haze, 0);
    const high = skyVertexColor(zenith, horizon, haze, 1);
    const lowLum = 0.2126 * low.r + 0.7152 * low.g + 0.0722 * low.b;
    const highLum = 0.2126 * high.r + 0.7152 * high.g + 0.0722 * high.b;
    assert.ok(lowLum > highLum,
      `${phase}: horizon luminance ${lowLum} is not above zenith ${highLum}`);
  }
});

test('the haze band lifts the horizon above the plain horizon colour', () => {
  // The point of the band: the horizon should be a paler, hazier colour than
  // the flat sky hex the phase table gives it.
  for (const [phase, look] of Object.entries(PHASE_LOOKS)) {
    const zenith = new THREE_COLOR(look.zenith ?? look.sky);
    const horizon = new THREE_COLOR(look.sky);
    const haze = new THREE_COLOR(look.haze ?? look.sky);
    const withHaze = skyVertexColor(zenith, horizon, haze, 0);
    const noHaze = skyVertexColor(zenith, horizon, horizon, 0);
    const a = 0.2126 * withHaze.r + 0.7152 * withHaze.g + 0.0722 * withHaze.b;
    const b = 0.2126 * noHaze.r + 0.7152 * noHaze.g + 0.0722 * noHaze.b;
    assert.ok(a >= b, `${phase}: haze made the horizon darker (${a} < ${b})`);
  }
});

test('the sun disc brightens across day, dusk and night without disappearing', () => {
  assert.deepEqual({ ...PHASE_SUN_DISK }, { day: 1, dusk: 0.85, night: 0.16 });
  assert.equal(sunDiskIntensity('day'), 1);
  assert.equal(sunDiskIntensity('dusk'), 0.85);
  assert.ok(sunDiskIntensity('night') > 0, 'the night sky lost its moon');
  assert.equal(sunDiskIntensity('noon'), 0);
  // Day must not be outshone by dusk, and night must be the faintest.
  assert.ok(sunDiskIntensity('day') > sunDiskIntensity('dusk'));
  assert.ok(sunDiskIntensity('dusk') > sunDiskIntensity('night'));
});

test('every phase sun position lands the disc on the dome at full radius', () => {
  for (const [phase, look] of Object.entries(PHASE_LOOKS)) {
    const p = sunDiscPosition(look.sunPosition, SUN_DISTANCE);
    const len = Math.hypot(p.x, p.y, p.z);
    assert.ok(Math.abs(len - SUN_DISTANCE) < 1e-9,
      `${phase}: disc sits at ${len}, not ${SUN_DISTANCE}`);
    // Same direction as the light, so the visible sun agrees with the shadows.
    const [sx, sy, sz] = look.sunPosition;
    const dot = (p.x * sx + p.y * sy + p.z * sz) /
      (SUN_DISTANCE * Math.hypot(sx, sy, sz));
    assert.ok(Math.abs(dot - 1) < 1e-9, `${phase}: disc drifted off the sun direction`);
  }
  // The disc and its glow must fit inside the dome, or they would be clipped
  // and the glow would leave a hard edge where the sphere ends.
  assert.ok(SUN_CORE_RADIUS < SUN_GLOW_RADIUS);
  assert.ok(SUN_DISTANCE + SUN_GLOW_RADIUS < 120);
});
