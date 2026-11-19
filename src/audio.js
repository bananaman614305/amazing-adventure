// Sound. There are no audio files: everything here is synthesised with the Web
// Audio API, so the game stays fully self-contained with no downloads and no
// licensing questions.
//
// The module is split in two on purpose:
//   - the pure half below (frequencies, envelopes, mix rules, preference
//     handling) holds no browser objects and is unit-tested in Node;
//   - createSoundscape() binds that to a real AudioContext and is only touched
//     in a browser, behind a user gesture, because browsers block audio that
//     starts on its own.

/** Equal-temperament frequency for a MIDI note number. */
export function noteFrequency(midi) {
  return 440 * Math.pow(2, (Number(midi) - 69) / 12);
}

// A small pentatonic set. Pentatonic because every interval in it sounds
// consonant, so randomly chosen interaction blips never clash with each other
// or with the drone underneath.
export const PENTATONIC = [0, 2, 4, 7, 9];

/** A pentatonic note at or above a base MIDI note, for the nth degree step. */
export function pentatonicNote(base, degree) {
  const octave = Math.floor(degree / PENTATONIC.length);
  const index = ((degree % PENTATONIC.length) + PENTATONIC.length) % PENTATONIC.length;
  return base + octave * 12 + PENTATONIC[index];
}

/**
 * Day phase -> the drone's root note and how present it is. Dusk is the warmest
 * moment in the game, so it sits highest; night is low and sparse.
 */
export const PHASE_TONES = {
  day: { root: 48, gain: 0.05, detune: 0 },
  dusk: { root: 53, gain: 0.065, detune: 4 },
  night: { root: 43, gain: 0.04, detune: -3 }
};

export function phaseTone(phase) {
  return PHASE_TONES[phase] || PHASE_TONES.day;
}

/**
 * The short sounds the game makes. `partials` are [multipleOfRoot, gain] pairs,
 * which is what makes a blip sound like a small struck thing rather than a sine
 * beep. `length` is in seconds.
 */
export const CUES = {
  talk: { degree: 2, length: 0.16, gain: 0.10, partials: [[1, 1], [2, 0.3]] },
  choose: { degree: 3, length: 0.12, gain: 0.09, partials: [[1, 1], [2, 0.2]] },
  close: { degree: 0, length: 0.14, gain: 0.07, partials: [[1, 1], [3, 0.15]] },
  pickup: { degree: 4, length: 0.30, gain: 0.11, partials: [[1, 1], [2, 0.45], [3, 0.2]] },
  quest: { degree: 5, length: 0.55, gain: 0.10, partials: [[1, 1], [2, 0.5], [4, 0.25]] },
  refuse: { degree: -3, length: 0.22, gain: 0.08, partials: [[1, 1], [1.5, 0.2]] },
  work: { degree: 1, length: 0.26, gain: 0.09, partials: [[1, 1], [2, 0.25]] }
};

/**
 * An envelope that starts and ends at silence, so a cue can never click. Uses a
 * short attack, a decay to a sustain, then a release.
 */
export function envelope(peak, attack = 0.008, hold = 0.02, release = 0.12) {
  return { peak: Math.max(0.0001, Number(peak) || 0), attack, hold, release };
}

/** Total time an enveloped cue occupies. */
export function cueDuration(cue) {
  const env = envelope(cue.gain);
  return env.attack + env.hold + cue.length + env.release;
}

/**
 * Gain for a cue, clamped to a safe maximum. The whole game is quiet on purpose:
 * a first-person ambient scene should never be startling when the dialogue opens.
 */
export const MAX_CUE_GAIN = 0.14;
export const MAX_AMBIENCE_GAIN = 0.08;

export function clampGain(value, max = MAX_CUE_GAIN) {
  const n = Number(value);
  // NaN and Infinity are treated as silence rather than as maximum volume: a
  // broken value must never be able to make the game loud.
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, n));
}

export function cueGain(cue) {
  return clampGain(cue?.gain ?? 0, MAX_CUE_GAIN);
}

export function ambienceGain(phase, muted, volume = 1) {
  if (muted) return 0;
  const tone = phaseTone(phase);
  return clampGain(tone.gain * clampGain(volume, 1), MAX_AMBIENCE_GAIN);
}

// --- Lane market ambience ---------------------------------------------------
// A second, optional bed that plays only while the player is in the lane. It is
// synthesised (filtered noise + a slow LFO) so there are no files to download,
// and it sits well under the drone so feedback cues stay on top.
export const LANE_BED_GAIN = 0.03;
export const LANE_BED_CUTOFF = 260;

export function laneBedGain(area, muted, volume = 1) {
  if (muted || area !== 'lane') return 0;
  return clampGain(LANE_BED_GAIN * clampGain(volume, 1), MAX_AMBIENCE_GAIN);
}

// --- Footsteps ------------------------------------------------------------

/**
 * A footstep is a short filtered noise burst, not a pitched cue: shoes on stone
 * read as a thud with a scrape, and keeping them out of the pentatonic set means
 * walking never sounds like playing an instrument.
 */
export const FOOTSTEP = {
  length: 0.09,
  attack: 0.004,
  release: 0.07,
  gain: 0.05,
  cutoff: 750,
  cutoffJitter: 180,
  q: 0.8
};

/** Walk cadence in steps per second; running is quicker, not just faster. */
export const STEP_RATE = { walk: 1.9, run: 2.7 };

/** Speeds under this are the damping tail, not walking: no steps for them. */
export const STEP_MIN_SPEED = 0.6;

/** Above this fraction of walk speed the cadence switches to the run rate. */
export const RUN_SPEED_FRACTION = 0.75;

/**
 * Pure step timing. Accumulates *distance*, not time, so the cadence follows
 * actual ground covered: pushing into a wall makes no sound, and a half-pushed
 * stick walks with half the steps. Returns how many steps fell due this frame.
 */
export function createStepClock({ stride = 1.35, minSpeed = STEP_MIN_SPEED } = {}) {
  let travelled = 0;
  return {
    get travelled() { return travelled; },
    /** speed in m/s, dt in seconds. 0 unless a stride boundary was crossed. */
    advance(speed, dt) {
      const s = Number(speed);
      const d = Number(dt);
      if (!Number.isFinite(s) || !Number.isFinite(d) || s < minSpeed || d <= 0) return 0;
      travelled += s * d;
      const steps = Math.floor(travelled / stride);
      travelled -= steps * stride;
      return steps;
    },
    reset() { travelled = 0; }
  };
}

/** Footstep loudness scales gently with speed but never exceeds the ceiling. */
export function footstepGain(speed, walkSpeed) {
  const s = Number(speed);
  const w = Number(walkSpeed);
  if (!Number.isFinite(s) || !Number.isFinite(w) || w <= 0 || s <= 0) return 0;
  const ratio = Math.min(1, s / w);
  return clampGain(FOOTSTEP.gain * (0.6 + 0.4 * ratio), MAX_CUE_GAIN);
}

// --- Preferences ----------------------------------------------------------

export const AUDIO_KEY = 'amazing-adventure:audio';

/**
 * Reads the saved preference. Sound defaults ON, because a silent adventure game
 * is the surprising case, but the choice is remembered once made.
 */
export function readPreference(getItem) {
  try {
    const raw = getItem?.(AUDIO_KEY);
    if (raw === 'off') return { enabled: false, volume: 0.7 };
    if (raw === 'on') return { enabled: true, volume: 0.7 };
  } catch {
    // Private mode can throw on read; fall through to the default.
  }
  return { enabled: true, volume: 0.7 };
}

export function writePreference(setItem, enabled) {
  // No writer means nothing was stored, so this must report failure rather than
  // claim the preference was saved.
  if (typeof setItem !== 'function') return false;
  try {
    setItem(AUDIO_KEY, enabled ? 'on' : 'off');
    return true;
  } catch {
    return false;
  }
}

// --- Browser binding ------------------------------------------------------

/**
 * Creates the soundscape. Nothing is started until `start()` is called from a
 * real user gesture, and every method is a no-op when sound is off or when the
 * platform has no Web Audio at all, so audio can never break the game.
 */
export function createSoundscape({ AudioContextClass, preference, persist = null } = {}) {
  let ctx = null;
  let master = null;
  let drone = null;
  let bed = null;
  let enabled = preference?.enabled ?? true;
  let volume = preference?.volume ?? 0.7;
  let currentPhase = 'day';
  let currentArea = 'plaza';
  let started = false;

  function ensureContext() {
    if (ctx || !AudioContextClass) return ctx;
    try {
      ctx = new AudioContextClass();
      master = ctx.createGain();
      master.gain.value = enabled ? clampGain(volume, 1) : 0;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
    }
    return ctx;
  }

  /** Two detuned oscillators plus a lowpass: a soft, warm pad. */
  function buildDrone(phase) {
    const tone = phaseTone(phase);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.6;
    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    oscA.type = 'sine';
    oscB.type = 'triangle';
    oscA.frequency.value = noteFrequency(tone.root);
    oscB.frequency.value = noteFrequency(tone.root + 12);
    oscA.detune.value = tone.detune;
    oscB.detune.value = -tone.detune;
    const bGain = ctx.createGain();
    bGain.gain.value = 0.18;
    oscA.connect(filter);
    oscB.connect(bGain);
    bGain.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    oscA.start();
    oscB.start();
    return { gain, oscA, oscB, filter, phase };
  }

  /** A low, filtered noise bed for the market lane: chatter and clatter. */
  function buildBed() {
    if (!ctx || typeof ctx.createBufferSource !== 'function') return null;
    const buffer = getNoiseBuffer();
    if (!buffer) return null;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = LANE_BED_CUTOFF;
    filter.Q.value = 0.7;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    try { source.start(); } catch { return null; }
    return { gain, source, filter };
  }

  function fade(node, to, seconds = 1.2) {
    if (!ctx) return;
    const now = ctx.currentTime;
    node.gain.cancelScheduledValues(now);
    node.gain.setValueAtTime(Math.max(0.0001, node.gain.value), now);
    node.gain.linearRampToValueAtTime(Math.max(0.0001, to), now + seconds);
  }

  /**
   * One second of white noise, built once and reused by every footstep. A
   * context without createBuffer (a fake, an ancient browser) simply gets no
   * footsteps; nothing else in the soundscape depends on it.
   */
  let noiseBuffer = null;
  function getNoiseBuffer() {
    if (noiseBuffer || !ctx || typeof ctx.createBuffer !== 'function') return noiseBuffer;
    try {
      const length = Math.floor(ctx.sampleRate || 44100);
      noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate || 44100);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      noiseBuffer = null;
    }
    return noiseBuffer;
  }

  return {
    get enabled() { return enabled; },
    get started() { return started; },
    get phase() { return currentPhase; },
    get area() { return currentArea; },

    /** Must be called from a user gesture. Safe to call repeatedly. */
    start() {
      if (started) return true;
      if (!ensureContext()) return false;
      if (ctx.state === 'suspended') ctx.resume?.();
      drone = buildDrone(currentPhase);
      fade(drone.gain, enabled ? phaseTone(currentPhase).gain : 0, 1.6);
      bed = buildBed();
      if (bed) fade(bed.gain, enabled ? laneBedGain(currentArea, false, volume) : 0, 1.6);
      started = true;
      return true;
    },

    stop() {
      if (!ctx) return;
      if (drone) {
        try { drone.oscA.stop(); drone.oscB.stop(); } catch { /* already stopped */ }
      }
      if (bed) {
        try { bed.source.stop(); } catch { /* already stopped */ }
      }
      drone = null;
      bed = null;
      started = false;
    },

    setEnabled(on) {
      enabled = Boolean(on);
      // Persisting is the caller's business: this module must not reach into
      // storage itself, so it takes a writer or nothing.
      if (persist) writePreference(persist, enabled);
      if (!ctx || !master) return enabled;
      master.gain.setTargetAtTime(enabled ? clampGain(volume, 1) : 0, ctx.currentTime, 0.08);
      if (bed) fade(bed.gain, enabled ? laneBedGain(currentArea, false, volume) : 0, 0.3);
      return enabled;
    },

    toggle() { return this.setEnabled(!enabled); },

    setVolume(next) {
      volume = clampGain(next, 1);
      if (ctx && master && enabled) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.08);
      if (ctx && bed && enabled) fade(bed.gain, laneBedGain(currentArea, false, volume), 0.3);
      return volume;
    },

    /** Follows the day cycle: the drone shifts root and level with the phase. */
    setPhase(phase) {
      if (phase === currentPhase) return;
      currentPhase = phase;
      if (!ctx || !drone) return;
      const tone = phaseTone(phase);
      setTimeout(() => {
        if (!ctx || !drone) return;
        try {
          drone.oscA.frequency.setTargetAtTime(noteFrequency(tone.root), ctx.currentTime, 0.4);
          drone.oscB.frequency.setTargetAtTime(noteFrequency(tone.root + 12), ctx.currentTime, 0.4);
          drone.oscA.detune.setTargetAtTime(tone.detune, ctx.currentTime, 0.4);
          drone.oscB.detune.setTargetAtTime(-tone.detune, ctx.currentTime, 0.4);
          fade(drone.gain, enabled ? tone.gain : 0, 0.9);
        } catch { /* context closed mid-fade */ }
      }, 0);
    },

    /** Follows the player's location: the market bed plays only in the lane. */
    setArea(area) {
      currentArea = area || currentArea;
      if (!ctx || !bed || !started) return currentArea;
      fade(bed.gain, enabled ? laneBedGain(currentArea, false, volume) : 0, 1.0);
      return currentArea;
    },

    /**
     * One footstep: a filtered noise thud. Same safety contract as play() --
     * silent when off, unstarted, or when the platform cannot make noise.
     * `speed`/`walkSpeed` set the loudness; `variant` (0/1) alternates the
     * filter so left and right feet do not sound identical.
     */
    step({ speed = 0, walkSpeed = 1, variant = 0 } = {}) {
      if (!enabled || !ctx || !master || !started) return false;
      if (typeof ctx.createBufferSource !== 'function') return false;
      const buffer = getNoiseBuffer();
      if (!buffer) return false;
      const gainValue = footstepGain(speed, walkSpeed);
      if (gainValue <= 0) return false;
      if (ctx.state === 'suspended') ctx.resume?.();
      const now = ctx.currentTime;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = FOOTSTEP.cutoff + (variant ? FOOTSTEP.cutoffJitter : -FOOTSTEP.cutoffJitter);
      filter.Q.value = FOOTSTEP.q;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(gainValue, now + FOOTSTEP.attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + FOOTSTEP.attack + FOOTSTEP.length + FOOTSTEP.release);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      // Start at a random offset so consecutive steps never reuse the same
      // slice of noise; the buffer is a full second, the step is ~0.16 s.
      const offset = Math.random() * Math.max(0, (buffer.duration || 1) - 0.3);
      source.start(now, offset);
      source.stop(now + FOOTSTEP.attack + FOOTSTEP.length + FOOTSTEP.release + 0.02);
      return true;
    },

    /** Plays one of CUES. Silently does nothing if sound is off or unstarted. */
    play(name) {
      const cue = CUES[name];
      // `started` is part of this contract, not just a convenience flag: after
      // stop() the drone is gone but the context and master still exist, so
      // without this check a cue would keep scheduling notes onto an output the
      // caller believes is shut down.
      if (!cue || !enabled || !ctx || !master || !started) return false;
      if (ctx.state === 'suspended') ctx.resume?.();
      const tone = phaseTone(currentPhase);
      const midi = pentatonicNote(tone.root + 24, cue.degree);
      const freq = noteFrequency(midi);
      const env = envelope(cueGain(cue));
      const now = ctx.currentTime;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(env.peak, now + env.attack);
      gain.gain.linearRampToValueAtTime(env.peak * 0.6, now + env.attack + env.hold);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + env.attack + env.hold + cue.length + env.release);
      gain.connect(master);
      const oscs = [];
      for (const [multiple, level] of cue.partials) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq * multiple;
        const partialGain = ctx.createGain();
        partialGain.gain.value = level;
        osc.connect(partialGain);
        partialGain.connect(gain);
        osc.start(now);
        osc.stop(now + cueDuration(cue) + 0.05);
        oscs.push(osc);
      }
      return true;
    }
  };
}
