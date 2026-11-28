// Where the night moths gather, how each one circles its lantern, and how its
// wings beat, decided without a GPU.
//
// At night the plaza lanterns and the lane lamp are the only warm points in a
// dark courtyard, but nothing is drawn to them. A lamp that lights nothing reads
// as a coloured bulb rather than as a real flame, and the fix that costs least is
// the honest one: a few pale moths orbiting each lit head. `world.js` turns these
// numbers into a single InstancedMesh of small quads, so the whole effect is one
// draw call no matter how many lanterns are lit.
//
// Four decisions are worth the words.
//
// 1. Moths belong to a light, not to the meadow. The fireflies drift through the
//    open grass and the butterflies wander the ring, but a moth is only ever
//    where a lamp is. So the field is built around MOTH_SITES -- the four plaza
//    lantern heads and the lane post -- and every spawn names one site by index.
//    Sites are spread round-robin rather than sampled at random, because a random
//    draw of thirty across five lamps can leave one lamp bare, and a bare lamp
//    beside a busy one reads as a bug. Round-robin gives each head the same
//    handful, which is exactly the "several around every lantern" look wanted.
//
// 2. Thirty moths, six per head, is the density that reads right. At the 8.4 m
//    lantern spacing of the plaza a single head is small in frame; two or three
//    moths vanish, ten looks like a swarm settling on the glass, and six gives a
//    living flutter you notice without it becoming the subject. Thirty also
//    keeps the instance buffer trivial on the low tier and leaves room under
//    MOTH_MAX_COUNT for a caller that wants a denser scene without a new module.
//
// 3. The orbit is tight and the flutter is faster than it. A moth circles the
//    head it is drawn to at MOTH_MIN_ORBIT..MOTH_MAX_ORBIT (18-55 cm), well
//    inside arm's reach, so it never reads as a bird crossing the courtyard. On
//    top of that slow circle sits a small vertical wobble at
//    MOTH_FLUTTER_PERIOD, much quicker than the orbit and only a few centimetres
//    tall: the orbit is the path, the flutter is the wingbeat, and keeping the
//    two on different clocks is what stops the motion looking like a machine.
//
// 4. They are a night thing and only a night thing. MOTH_PHASE_GLOW is exactly 0
//    by day, so the world can hide the mesh outright rather than draw a faint
//    speck in full sun, and dusk keeps 0.45 so the field fades in with the lamps
//    instead of snapping on.
//
// Everything here is seeded (mulberry32, copied rather than imported so the
// module stands alone) and pure: no Three.js, no DOM, no clock, no Math.random.
// Two identical calls produce bit-identical numbers, and every export is total --
// it guards junk input, and no call can produce NaN or Infinity.

/** Seed for the moth generator. Fixed so every run gathers the same moths. */
export const MOTH_SEED = 0x5e2a47;

/** How many moths the field holds by default: six around each of five lights.
 *  One instanced draw call regardless. */
export const MOTH_COUNT = 30;

/** Upper clamp on a requested count, so no absurd argument allocates wildly. */
export const MOTH_MAX_COUNT = 200;

/**
 * The lantern heads the moths orbit, in world metres. The four plaza lanterns
 * sit at the corners of the terrace and the lane post stands north of the plaza;
 * all five are inside the 34 m world (half-extent 17). Frozen, each entry and the
 * array alike, so a caller cannot move a lantern out from under the field.
 */
export const MOTH_SITES = Object.freeze([
  Object.freeze({ x: 7, z: 7, y: 3.15 }),
  Object.freeze({ x: -7, z: 7, y: 3.15 }),
  Object.freeze({ x: 7, z: -7, y: 3.15 }),
  Object.freeze({ x: -7, z: -7, y: 3.15 }),
  Object.freeze({ x: 8.3, z: -21.6, y: 2.227 })
]);

/** Nearest a moth circles its lantern head, in metres. */
export const MOTH_MIN_ORBIT = 0.18;

/** Farthest a moth circles its lantern head, in metres: still within arm's reach. */
export const MOTH_MAX_ORBIT = 0.55;

/** Lowest vertical offset from the lantern head, in metres (just below the glass). */
export const MOTH_MIN_HEIGHT = -0.25;

/** Highest vertical offset from the lantern head, in metres (just above it). */
export const MOTH_MAX_HEIGHT = 0.35;

/** Smallest quad scale multiplier; distant moths read smaller. */
export const MOTH_MIN_SIZE = 0.7;

/** Largest quad scale multiplier; near moths read bigger. */
export const MOTH_MAX_SIZE = 1.3;

/** Slowest orbital speed in radians per second; no moth hangs dead still. */
export const MOTH_MIN_SPEED = 1.1;

/** Fastest orbital speed in radians per second; none races round the head. */
export const MOTH_MAX_SPEED = 2.4;

/** Seconds for one wingbeat and one vertical flutter. Fast, because a moth beats
 *  several times a second. */
export const MOTH_FLUTTER_PERIOD = 0.16;

/** Peak vertical flutter in metres. Small on purpose: the orbit is the path and
 *  this is only the wobble the wingbeat adds to it. */
export const MOTH_FLUTTER_AMPLITUDE = 0.03;

/** How strongly the field shows in each phase. Day is zero: moths are a night
 *  thing. Frozen so the table cannot be mutated by a caller. */
export const MOTH_PHASE_GLOW = Object.freeze({ day: 0, dusk: 0.45, night: 1 });

/** A small deterministic PRNG (mulberry32). Copied from the other pure modules
 *  rather than imported, so `moths.js` stays independent of them. */
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

/** Replace a non-finite sine argument with 0, so an absurd time cannot turn a
 *  bounded orbit or flutter into NaN. */
function safeAngle(value) {
  return Number.isFinite(value) ? value : 0;
}

/** The per-phase glow multiplier. Unknown phase, or a non-string, falls back to
 *  the `day` value (0), so a phase id the code has not learned yet can never
 *  light the field by accident. */
export function mothGlowLevel(phaseId) {
  if (typeof phaseId !== 'string') return MOTH_PHASE_GLOW.day;
  return Object.prototype.hasOwnProperty.call(MOTH_PHASE_GLOW, phaseId)
    ? MOTH_PHASE_GLOW[phaseId]
    : MOTH_PHASE_GLOW.day;
}

/**
 * The spawn descriptors for the whole field.
 *
 * The site is assigned round-robin (`i % MOTH_SITES.length`) so every lantern
 * gets the same handful rather than a random draw that can leave one bare. The
 * remaining fields are seeded draws from their bands: an angle in [0, 2pi) for
 * where on the orbit it starts, an orbit radius, a vertical offset, a quad size,
 * an orbital speed, and a flutter phase in [0, 1) that offsets the wingbeat so
 * two moths at one lantern never beat in lockstep.
 *
 * The return is an array of exactly `count` objects, each
 * `{ site, angle, orbit, height, size, speed, flutter }`, where `site` is an
 * index into MOTH_SITES. A junk `count` falls back to MOTH_COUNT, a finite count
 * clamps into [0, MOTH_MAX_COUNT] and floors, a non-finite seed falls back to
 * MOTH_SEED, and junk options collapse to the defaults, so the call never throws
 * and never yields NaN.
 */
export function mothSpawns(options = {}) {
  // A null, array or non-object options argument must not throw before the field
  // is built, so junk collapses to the empty object and every field defaults.
  const opts = options == null || typeof options !== 'object' || Array.isArray(options)
    ? {}
    : options;
  const { count = MOTH_COUNT, seed = MOTH_SEED } = opts;

  // A non-finite count is junk, not a clamp target: NaN and Infinity fall back to
  // the authored count, while a finite but absurd value clamps to the ceiling.
  const n = finiteNumber(count)
    ? Math.min(MOTH_MAX_COUNT, Math.max(0, Math.floor(count)))
    : MOTH_COUNT;
  const base = finiteNumber(seed) ? seed : MOTH_SEED;

  const rng = mulberry32(base >>> 0);
  const spawns = [];
  for (let i = 0; i < n; i += 1) {
    const site = i % MOTH_SITES.length;
    const angle = rng() * Math.PI * 2;
    const orbit = MOTH_MIN_ORBIT + rng() * (MOTH_MAX_ORBIT - MOTH_MIN_ORBIT);
    const height = MOTH_MIN_HEIGHT + rng() * (MOTH_MAX_HEIGHT - MOTH_MIN_HEIGHT);
    const size = MOTH_MIN_SIZE + rng() * (MOTH_MAX_SIZE - MOTH_MIN_SIZE);
    const speed = MOTH_MIN_SPEED + rng() * (MOTH_MAX_SPEED - MOTH_MIN_SPEED);
    const flutter = rng();
    spawns.push({ site, angle, orbit, height, size, speed, flutter });
  }
  return spawns;
}

/**
 * One moth's position and wing state at `time`, as `{ x, y, z, flap }`.
 *
 * The moth circles its site's lantern head at a constant orbit radius: the angle
 * is the spawn angle plus `time * speed`, and x and z are that angle's cosine and
 * sine times the orbit. The vertical is the site height plus the spawn offset
 * plus a small sine at MOTH_FLUTTER_PERIOD, and the same oscillator drives `flap`
 * through [0, 1] so the wing angle and the wobble stay in step.
 *
 * A non-finite time reads as 0. A missing, junk or array spawn returns the origin
 * with a level wing. A spawn with junk numeric fields is read with its fields
 * clamped into their bands, and any sine argument that would overflow (an absurd
 * time multiplied by a speed) is detected and read as 0, so every returned number
 * is finite.
 */
export function mothFlight(spawn, time) {
  const t = finiteNumber(time) ? time : 0;
  if (spawn == null || typeof spawn !== 'object' || Array.isArray(spawn)) {
    return { x: 0, y: 0, z: 0, flap: 0 };
  }

  // The site index is clamped into range rather than allowed to fall off the end
  // of MOTH_SITES; a non-finite index reads as the first site.
  const rawSite = finiteNumber(spawn.site) ? Math.floor(spawn.site) : 0;
  const siteIndex = Math.min(MOTH_SITES.length - 1, Math.max(0, rawSite));
  const site = MOTH_SITES[siteIndex];

  const angleBase = finiteNumber(spawn.angle) ? spawn.angle : 0;
  const orbit = clampNumber(spawn.orbit, MOTH_MIN_ORBIT, MOTH_MAX_ORBIT, MOTH_MIN_ORBIT);
  const height = clampNumber(spawn.height, MOTH_MIN_HEIGHT, MOTH_MAX_HEIGHT, 0);
  const speed = clampNumber(spawn.speed, 0, MOTH_MAX_SPEED, MOTH_MIN_SPEED);
  const flutterPhase = finiteNumber(spawn.flutter) ? spawn.flutter : 0;

  // The orbit angle grows with time; an absurd time can overflow the sum to
  // Infinity, and cos/sin of Infinity is NaN, so a non-finite angle reads as 0.
  const angle = safeAngle(angleBase + t * speed);
  const x = site.x + Math.cos(angle) * orbit;
  const z = site.z + Math.sin(angle) * orbit;

  // One oscillator for both the vertical wobble and the wingbeat. Its argument is
  // guarded the same way, for the same overflow reason.
  const flutterArg = safeAngle((t / MOTH_FLUTTER_PERIOD) * Math.PI * 2 + flutterPhase * Math.PI * 2);
  const wave = Math.sin(flutterArg);
  const y = site.y + height + wave * MOTH_FLUTTER_AMPLITUDE;
  const flap = Math.min(1, Math.max(0, (wave + 1) / 2));

  return { x, y, z, flap };
}

/** Whether the moth field runs at this quality tier. The low tier drops the
 *  per-frame moth pass, consistent with the quality-tier convention; junk reads
 *  as the full tier. */
export function mothsEnabled(tier) {
  return tier !== 'low';
}
