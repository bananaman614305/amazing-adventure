// Which cottage windows are lit, how warmly, and when they go out, decided
// without a GPU.
//
// A village at night reads as inhabited because of its windows, not its roofs.
// A row of dark houses is scenery; a handful of warm panes, a few that stay
// dark, and one or two that go out late is the whole difference between a model
// and a place where someone lives. This module is the pure schedule behind that
// effect: `world.js` turns each spawn into a small emissive quad on a house
// face, and the brightness of that quad is a number this module computes.
//
// Three decisions are worth the words.
//
// 1. The schedule is seeded, not random. Two identical runs must build the same
//    lit village, and a saved night must look like a fresh boot, so the positions
//    and habits come from mulberry32 rather than Math.random. That is also what
//    lets the unit tests pin the whole thing.
//
// 2. They light on a phase curve, not a clock. `WINDOW_PHASE_GLOW` says a window
//    is dark by day, half-lit through dusk and brightest at night; the caller
//    supplies `nightFraction` for the finer bedtime rule. Keeping the coarse
//    curve in a frozen table means the day-night story lives in one readable
//    place instead of being scattered through world.js.
//
// 3. They flicker, but barely. A dead-steady pane looks like a texture; a
//    strongly pulsing one looks like a failing bulb. A slow sine of a few
//    percent, offset by each spawn's own phase so no two panes breathe together,
//    is enough to suggest a lamp behind glass without ever drawing attention.
//
// Everything here is seeded (mulberry32, copied rather than imported so the
// module stands alone) and pure: no Three.js, no DOM, no clock, no Date, no
// Math.random. Every export is total -- it guards junk input and no call can
// produce NaN or Infinity.

/** Seed for the window generator. Fixed so every run lights the same village. */
export const WINDOW_SEED = 0x2f8c61;

/** How many cottage windows the schedule covers. */
export const WINDOW_COUNT = 12;

/** Hard ceiling on a requested count, so a junk number cannot ask for a
 *  million quads. */
export const WINDOW_MAX_COUNT = 64;

/** Inner edge of the house ring, in metres from the plaza centre. */
export const WINDOW_MIN_RADIUS = 8;

/** Outer edge of the house ring, in metres from the plaza centre. */
export const WINDOW_MAX_RADIUS = 18;

/** Bottom of the upper-storey band, in metres above the ground. */
export const WINDOW_MIN_HEIGHT = 1.6;

/** Top of the upper-storey band, in metres above the ground. */
export const WINDOW_MAX_HEIGHT = 3.4;

/** Warm lamp yellow: the colour a lived-in pane glows at night. */
export const WINDOW_WARM_TINT = 0xffc879;

/** The brightest a pane is ever allowed to glow, before tone mapping. */
export const WINDOW_MAX_GLOW = 0.85;

/** Dimmest warmth factor. Even the coolest pane is still a lamp, not a void. */
export const WINDOW_MIN_WARMTH = 0.82;

/** Warmest warmth factor, for a pane at full cosiness. */
export const WINDOW_MAX_WARMTH = 1;

/** How far the slow flicker swings either side of 1. Kept small on purpose: a
 *  few percent reads as a live lamp, more reads as a fault. */
export const WINDOW_FLICKER_AMPLITUDE = 0.06;

/** How many slow flicker cycles play across one night. */
export const WINDOW_FLICKER_CYCLES = 2;

/** How strongly the schedule shows in each phase. Day is zero: a window is not
 *  lit while the sun is up. Dusk is the warm-up, night is full. */
export const WINDOW_PHASE_GLOW = Object.freeze({ day: 0, dusk: 0.55, night: 1 });

/** A small deterministic PRNG (mulberry32). Copied from the other pure modules
 *  rather than imported, so `windows.js` stays independent of them. */
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6D2B79F5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Clamp to [lo, hi], with a non-finite value replaced by `fallback`. */
function clampNumber(value, lo, hi, fallback = lo) {
  if (!finiteNumber(value)) return fallback;
  return Math.min(hi, Math.max(lo, value));
}

/** The per-phase glow multiplier. Unknown phase, or a non-string, falls back to
 *  the `day` value (0), so a new phase id can never light the village up by
 *  accident. */
export function windowGlowLevel(phaseId) {
  if (typeof phaseId !== 'string') return WINDOW_PHASE_GLOW.day;
  return Object.prototype.hasOwnProperty.call(WINDOW_PHASE_GLOW, phaseId)
    ? WINDOW_PHASE_GLOW[phaseId]
    : WINDOW_PHASE_GLOW.day;
}

/**
 * The spawn descriptors for the whole schedule.
 *
 * Positions are sampled in polar coordinates: a seeded angle in [0, 2pi) and a
 * seeded radius in [WINDOW_MIN_RADIUS, WINDOW_MAX_RADIUS], then x = cos(angle)
 * * radius and z = sin(angle) * radius. That puts every window out among the
 * houses and none in the plaza, without a rejection loop. The height is sampled
 * across the upper-storey band so panes sit above head height and below the
 * eaves.
 *
 * Each returned object is `{ x, z, y, phase, warmth, bedtime }`. `phase` is a
 * seeded [0, 1) offset for the flicker, `warmth` is the pane's steady
 * brightness factor, and `bedtime` is the fraction of the night after which the
 * window goes dark (0 means it stays dark all night, 1 means it never goes out).
 * The bedtime is drawn from four seeded bands so the village gets the intended
 * mix of dark, early, late and all-night windows rather than a uniform spread
 * that would read as a schedule instead of as people.
 *
 * A junk `count` clamps into [0, WINDOW_MAX_COUNT] and floors, a non-finite
 * seed falls back to WINDOW_SEED, and a junk options object falls back to the
 * defaults, so the call never throws and never yields NaN.
 */
export function windowSpawns(options = {}) {
  const opts = options != null && typeof options === 'object' && !Array.isArray(options)
    ? options
    : {};
  const count = opts.count;
  const seed = opts.seed;

  const n = finiteNumber(count) ? Math.min(WINDOW_MAX_COUNT, Math.max(0, Math.floor(count))) : WINDOW_COUNT;
  const base = finiteNumber(seed) ? seed : WINDOW_SEED;

  const rng = mulberry32(base >>> 0);
  const spawns = [];
  for (let i = 0; i < n; i += 1) {
    const angle = rng() * Math.PI * 2;
    const radius = WINDOW_MIN_RADIUS + rng() * (WINDOW_MAX_RADIUS - WINDOW_MIN_RADIUS);
    const y = WINDOW_MIN_HEIGHT + rng() * (WINDOW_MAX_HEIGHT - WINDOW_MIN_HEIGHT);
    const phase = rng();
    const warmth = WINDOW_MIN_WARMTH + rng() * (WINDOW_MAX_WARMTH - WINDOW_MIN_WARMTH);

    // Four seeded habits. A fifth of the windows never light at all (someone is
    // away, or asleep), a sixth go out early in the night, a sixth go out late,
    // and the rest burn until morning. The bands are drawn in this order so the
    // RNG stream stays deterministic without consuming an extra value on the
    // fixed habits.
    const habit = rng();
    let bedtime;
    if (habit < 0.18) {
      bedtime = 0;
    } else if (habit < 0.32) {
      bedtime = 0.2 + rng() * 0.35;
    } else if (habit < 0.5) {
      bedtime = 0.72 + rng() * 0.22;
    } else {
      bedtime = 1;
    }

    spawns.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      y,
      phase,
      warmth,
      bedtime
    });
  }
  return spawns;
}

/** Read the three schedule fields off a spawn, replacing junk with neutral
 *  values. An array is treated as junk too: it has the wrong shape, and reading
 *  `.warmth` off one would silently pick up `Array.prototype` members. */
function sanitizeSpawn(spawn) {
  const valid = spawn != null && typeof spawn === 'object' && !Array.isArray(spawn);
  return {
    warmth: valid
      ? clampNumber(spawn.warmth, WINDOW_MIN_WARMTH, WINDOW_MAX_WARMTH, WINDOW_MAX_WARMTH)
      : WINDOW_MAX_WARMTH,
    phase: valid ? clampNumber(spawn.phase, 0, 1, 0) : 0,
    bedtime: valid ? clampNumber(spawn.bedtime, 0, 1, 1) : 1
  };
}

/**
 * The brightness of one window, in [0, WINDOW_MAX_GLOW].
 *
 * By day it is exactly zero. Through dusk and night it follows the phase curve,
 * scaled by the pane's own warmth and a slow flicker offset by the pane's phase.
 * The bedtime gate is applied before the brightness is computed: once the night
 * has passed the pane's bedtime the result is exactly 0, not a dim value, so a
 * "gone to bed" window reads as truly dark.
 *
 * Junk phase ids read as day (0), junk spawns fall back to a neutral all-night
 * pane, and a junk or out-of-range `nightFraction` clamps into [0, 1], so every
 * call returns a finite value inside the documented range and none throws.
 */
export function windowGlow(phaseId, spawn, nightFraction) {
  const level = windowGlowLevel(phaseId);
  if (level <= 0) return 0;

  const pane = sanitizeSpawn(spawn);
  const night = clampNumber(nightFraction, 0, 1, 0);
  if (night > pane.bedtime) return 0;

  // A slow sine, a couple of cycles a night, offset by the pane's phase so the
  // windows never breathe in lockstep. Its amplitude is deliberately tiny.
  const flicker = 1 + WINDOW_FLICKER_AMPLITUDE
    * Math.sin(night * Math.PI * 2 * WINDOW_FLICKER_CYCLES + pane.phase * Math.PI * 2);

  const glow = WINDOW_MAX_GLOW * level * pane.warmth * flicker;
  // The warmth and flicker can push a very warm pane slightly past the ceiling;
  // clamp so the contract holds without dimming the typical pane.
  return Math.min(WINDOW_MAX_GLOW, Math.max(0, glow));
}

/** Whether the window schedule runs at this quality tier. The low tier drops
 *  the per-frame window pass, consistent with the quality-tier convention; junk
 *  reads as the full tier. */
export function windowsEnabled(tier) {
  return tier !== 'low';
}
