// Atmospheric depth.
//
// Before this module the fog was a constant per phase: three numbers in the
// phase table, swapped in one frame the instant the clock crossed a boundary.
// That produced two artefacts that read as "game" rather than "place": a hard
// step in the distance haze at every dusk/night/dawn boundary, and a single
// flat haze level all phase long, so a bright noon and the last minute of dusk
// were murky in exactly the same way.
//
// This turns fog into a continuous curve over the day. It is deliberately pure
// maths with no Three.js dependency, so the shape of the curve - the thing the
// player actually sees - can be pinned by unit tests without a GPU.

import { CYCLE_SECONDS, phaseAt, wrapClock } from './daynight.js';
import { PHASE_LOOKS } from './world.js';

/**
 * Fog keyframes around the cycle. `at` is clock seconds, `phase` names the
 * palette the key draws its colour *and* its default distances from, and
 * `near`/`far` optionally override those distances in metres.
 *
 * A key with no `near`/`far` uses the palette's own `fogNear`/`fogFar`, so the
 * three phase anchors stay in one place: edit the phase table and the fog curve
 * follows it rather than drifting away. Only keys that describe weather the
 * phase table has no field for (dawn mist, the settled small hours) override.
 *
 * The intent of each key:
 *   0    dawn   - mist thickens overnight; the plaza wakes up hazy  (override)
 *   20   morning- the sun burns the mist off and the far wall returns (palette)
 *   70   dusk   - warm evening haze rolls back in, sooner than night's fog (palette)
 *   105  night  - lamps take over; haze is dense but close in        (palette)
 *   150  deep   - settled cold fog, the tightest visibility of the cycle (override)
 *   180  wrap   - must equal the key at 0 or dawn would step
 */
export const ATMOSPHERE_KEYS = [
  { at: 0, phase: 'day', near: 15, far: 44 }, // dawn mist
  { at: 20, phase: 'day' }, // clear morning
  { at: 70, phase: 'dusk' }, // warm haze
  { at: 105, phase: 'night' }, // night
  { at: 150, phase: 'night', near: 12, far: 38 }, // settled night
  { at: CYCLE_SECONDS, phase: 'day', near: 15, far: 44 } // wraps to dawn
];

/** The palette a key draws from, falling back to day so a typo cannot crash. */
function keyLook(key) {
  return PHASE_LOOKS[key.phase] || PHASE_LOOKS.day;
}

/** A key's fog distances: its own override, else its palette's. */
export function keyDistances(key) {
  const look = keyLook(key);
  return {
    near: Number.isFinite(key.near) ? key.near : (look.fogNear ?? 20),
    far: Number.isFinite(key.far) ? key.far : (look.fogFar ?? 60)
  };
}

/**
 * Smoothstep: eased interpolation. Linear fog moves read as a machine sliding a
 * slider; easing the first and last part of each segment makes the haze feel
 * like weather. Clamped so out-of-range input cannot produce a spike.
 */
export function ease(u) {
  if (!Number.isFinite(u)) return 0;
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
}

/**
 * Blends two 0xRRGGBB colours, `t` 0..1 from `a` to `b`, returns an int.
 * Channel maths is done inline rather than via an array helper because this
 * runs every frame on phones too; allocating two arrays per frame for a haze
 * tint is exactly the kind of garbage that shows up as jank later.
 */
export function mixHex(a, b, t) {
  const u = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const r = Math.round(ar + (br - ar) * u) & 255;
  const g = Math.round(ag + (bg - ag) * u) & 255;
  const bl = Math.round(ab + (bb - ab) * u) & 255;
  return (r << 16) | (g << 8) | bl;
}

/** The palette colour a key draws from, falling back to the sky colour. */
function keyColor(key) {
  const look = keyLook(key);
  return (look.fog ?? look.sky) >>> 0;
}

/**
 * The fog curve at a moment in the cycle.
 * Returns `{ near, far, color, phase, keyIndex }`:
 *   - `near`/`far` are eased fog distances,
 *   - `color` is a 0xRRGGBB blend of the two bracketing palettes,
 *   - `phase` is the day/night phase the clock is in (so a HUD reads the same
 *     thing as the lighting), and `keyIndex` identifies the blend segment.
 * Never throws and never returns NaN: a nonsense clock reads as dawn.
 */
export function atmosphereAt(seconds) {
  const t = wrapClock(seconds);
  const keys = ATMOSPHERE_KEYS;
  // The table spans the whole cycle by construction, so the last key is the
  // upper rail; find the segment that contains t.
  let index = keys.length - 2;
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (t >= keys[i].at && t < keys[i + 1].at) { index = i; break; }
  }
  const a = keys[index];
  const b = keys[index + 1];
  const from = keyDistances(a);
  const to = keyDistances(b);
  const span = b.at - a.at;
  const raw = span > 0 ? (t - a.at) / span : 0;
  const u = ease(raw);
  const near = from.near + (to.near - from.near) * u;
  const far = from.far + (to.far - from.far) * u;
  const color = mixHex(keyColor(a), keyColor(b), u);
  // The reported phase is the day/night phase the clock is actually in, not the
  // key the blend happens to sit nearest. The haze starts thickening before dusk
  // arrives (that is the point of a curve), but the label must still agree with
  // the clock so a HUD or bug report cannot contradict the sky.
  const phase = phaseAt(t).id;
  return { near, far, color, phase, keyIndex: index };
}

/**
 * Writes the fog curve onto a built world's scene. Cheap enough to run every
 * frame: it is three property writes plus one colour blend, no allocation.
 *
 * Tolerates a missing environment or fog object so a headless harness (or a
 * unit test with a stub) can call it without a Three.js scene.
 */
export function applyAtmosphere(environment, seconds) {
  const scene = environment?.scene;
  const fog = scene?.fog;
  const value = atmosphereAt(seconds);
  if (fog) {
    fog.near = value.near;
    fog.far = value.far;
    fog.color?.setHex?.(value.color);
  }
  return value;
}
