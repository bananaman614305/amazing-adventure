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
  buildEnvironmentMap
} from '../src/graphics.js';
import { PHASE_LOOKS } from '../src/world.js';

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
