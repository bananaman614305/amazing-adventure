// Sound: no audio files exist, everything is synthesised, so the properties that
// matter are the maths and the safety rules -- that it is quiet enough not to
// startle, that it can always be turned off, and that it never breaks the game.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  noteFrequency, pentatonicNote, PENTATONIC, PHASE_TONES, phaseTone, CUES,
  envelope, cueDuration, clampGain, cueGain, ambienceGain, readPreference,
  writePreference, createSoundscape, createStepClock, FOOTSTEP, STEP_RATE,
  footstepGain, STEP_MIN_SPEED,
  AUDIO_KEY, MAX_CUE_GAIN, MAX_AMBIENCE_GAIN
} from '../src/audio.js';

test('note frequencies match equal temperament', () => {
  assert.equal(Math.round(noteFrequency(69)), 440, 'A4 is 440 Hz');
  assert.equal(Math.round(noteFrequency(81)), 880, 'an octave up doubles');
  assert.equal(Math.round(noteFrequency(57)), 220, 'an octave down halves');
});

test('the pentatonic helper walks whole degrees and octaves', () => {
  for (let d = 0; d < 15; d += 1) {
    const note = pentatonicNote(60, d);
    // Every returned note must belong to the pentatonic scale, modulo 12.
    const pc = ((note - 60) % 12 + 12) % 12;
    assert.ok(PENTATONIC.includes(pc), `degree ${d} gave pitch class ${pc}`);
  }
  assert.equal(pentatonicNote(60, 5), 72, 'the sixth degree is an octave up');
  // Negative degrees must stay musical rather than producing nonsense.
  assert.equal(Number.isFinite(pentatonicNote(60, -3)), true);
});

test('the drone is quiet in every phase', () => {
  for (const [phase, tone] of Object.entries(PHASE_TONES)) {
    assert.ok(tone.gain > 0, `${phase} must be audible`);
    assert.ok(tone.gain <= MAX_AMBIENCE_GAIN, `${phase} must never be loud`);
  }
});

test('an unknown phase falls back to day rather than undefined', () => {
  assert.deepEqual(phaseTone('nonsense'), PHASE_TONES.day);
  assert.deepEqual(phaseTone(undefined), PHASE_TONES.day);
});

test('every cue is quiet and short enough not to startle', () => {
  for (const [name, cue] of Object.entries(CUES)) {
    assert.ok(cue.length > 0, `${name} needs a length`);
    assert.ok(cue.length <= 1, `${name} must be brief`);
    assert.ok(cue.partials.length > 0, `${name} needs partials`);
    assert.ok(cueGain(cue) <= MAX_CUE_GAIN, `${name} must be within the gain ceiling`);
  }
});

test('cue durations include the envelope, so nothing is cut off', () => {
  const env = envelope(0.1);
  const total = cueDuration(CUES.talk);
  assert.ok(total > CUES.talk.length, 'the envelope adds time on top of the hold');
  assert.ok(total > env.attack + env.hold, 'attack and hold are accounted for');
});

test('gains are clamped and never negative or NaN', () => {
  assert.equal(clampGain(99), MAX_CUE_GAIN);
  assert.equal(clampGain(-5), 0);
  assert.equal(clampGain(NaN), 0);
  // Non-finite values are treated as silence, not as maximum volume: a broken
  // gain must never be able to make the game loud.
  assert.equal(clampGain(Infinity), 0);
  assert.equal(clampGain(-Infinity), 0);
  assert.equal(clampGain('0.05'), 0.05, 'numeric strings are accepted');
  assert.equal(cueGain(null), 0);
  assert.equal(cueGain({}), 0);
});

test('ambience is silent when muted and scaled by volume', () => {
  assert.equal(ambienceGain('dusk', true), 0, 'muted is truly silent');
  assert.ok(ambienceGain('dusk', false) > 0);
  assert.equal(ambienceGain('dusk', false, 0), 0, 'zero volume is silent');
  assert.ok(ambienceGain('dusk', false, 0.5) < ambienceGain('dusk', false, 1));
  assert.ok(ambienceGain('dusk', false, 99) <= MAX_AMBIENCE_GAIN);
});

test('sound defaults on, because a silent adventure game is the odd case', () => {
  assert.deepEqual(readPreference(() => null), { enabled: true, volume: 0.7 });
});

test('the saved preference is honoured, and a broken reader is survivable', () => {
  assert.equal(readPreference(() => 'off').enabled, false);
  assert.equal(readPreference(() => 'on').enabled, true);
  // Private mode and broken storage throw: that must not break the game.
  assert.equal(readPreference(() => { throw new Error('blocked'); }).enabled, true);
  assert.equal(readPreference(undefined).enabled, true);
});

test('writing the preference reports failure instead of throwing', () => {
  const store = new Map();
  assert.equal(writePreference((k, v) => store.set(k, v), false), true);
  assert.equal(store.get(AUDIO_KEY), 'off');
  assert.equal(writePreference(() => { throw new Error('quota'); }, true), false);
  assert.equal(writePreference(null, true), false);
});

test('without Web Audio every method is a safe no-op', () => {
  // This is the path taken by an old browser or a locked-down environment, and
  // it must never throw or claim to have started.
  const sound = createSoundscape({ AudioContextClass: null, preference: { enabled: true, volume: 0.7 } });
  assert.equal(sound.start(), false, 'cannot start without a context');
  assert.equal(sound.started, false);
  assert.equal(sound.play('talk'), false, 'no context, no sound, no crash');
  assert.equal(sound.play('does-not-exist'), false);
  assert.equal(sound.setEnabled(false), false);
  assert.equal(sound.setEnabled(true), true, 'the preference still tracks');
  assert.equal(sound.setVolume(0.5), 0.5);
  sound.setPhase('night');
  assert.equal(sound.phase, 'night', 'phase still tracks for when audio becomes available');
  sound.stop();
});

test('a context that throws on construction is survivable', () => {
  class Broken { constructor() { throw new Error('no audio device'); } }
  const sound = createSoundscape({ AudioContextClass: Broken, preference: { enabled: true, volume: 0.7 } });
  assert.equal(sound.start(), false);
  assert.equal(sound.play('talk'), false);
});

test('a cue never plays while sound is off', () => {
  // A minimal fake context so the enabled/disabled rule can be checked without
  // any real audio device.
  let started = 0;
  class Fake {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    createGain() { return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} }, connect() {} }; }
    createOscillator() { return { type: '', frequency: { value: 0, setTargetAtTime() {} }, detune: { value: 0, setTargetAtTime() {} }, connect() {}, start() { started += 1; }, stop() {} }; }
    createBiquadFilter() { return { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect() {} }; }
    resume() {}
  }
  const sound = createSoundscape({ AudioContextClass: Fake, preference: { enabled: true, volume: 0.7 } });
  assert.equal(sound.start(), true);
  assert.equal(sound.setEnabled(false), false);
  const before = started;
  assert.equal(sound.play('quest'), false, 'muted means no cue');
  assert.equal(started, before, 'and no oscillators were created');
  sound.setEnabled(true);
  assert.equal(sound.play('quest'), true, 'unmuted, the cue plays');
  assert.ok(started > before, 'oscillators were created for it');
});

// --- The soundscape's own contract, checked with a recording fake --------------
// The pure maths above is well covered; these cover the browser-facing object,
// where the doc comments make promises the code has to keep.
function recordingContext() {
  const made = { oscillators: [], gains: [], filters: [], ramps: [] };
  class Fake {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = { name: 'dest' }; this.sampleRate = 44100; }
    createGain() {
      const node = {
        gain: {
          value: 1,
          setValueAtTime(v, t) { made.ramps.push(['set', v, t]); },
          linearRampToValueAtTime(v, t) { made.ramps.push(['linear', v, t]); },
          exponentialRampToValueAtTime(v, t) { made.ramps.push(['exp', v, t]); },
          cancelScheduledValues(t) { made.ramps.push(['cancel', t]); },
          setTargetAtTime(v, t) { made.ramps.push(['target', v, t]); }
        },
        connect(target) { node.connectedTo = target; }
      };
      made.gains.push(node);
      return node;
    }
    createOscillator() {
      const node = {
        type: '', frequency: { value: 0, setTargetAtTime() {} },
        detune: { value: 0, setTargetAtTime() {} },
        connect(t) { node.connectedTo = t; },
        start(t) { node.startedAt = t; }, stop(t) { node.stoppedAt = t; }
      };
      made.oscillators.push(node);
      return node;
    }
    createBiquadFilter() {
      const node = { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect(t) { node.connectedTo = t; } };
      made.filters.push(node);
      return node;
    }
    createBuffer(channels, length, sampleRate) {
      const data = new Float32Array(length);
      return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate,
        getChannelData() { return data; } };
    }
    createBufferSource() {
      const node = { buffer: null, connect(t) { node.connectedTo = t; }, start() {}, stop() {} };
      made.oscillators.push(node);
      return node;
    }
    resume() {}
  }
  return { Fake, made };
}

test('a cue is silent until start() has been called', () => {
  const { Fake, made } = recordingContext();
  const sound = createSoundscape({ AudioContextClass: Fake, preference: { enabled: true, volume: 0.7 } });
  assert.equal(sound.play('quest'), false, 'nothing is running yet');
  assert.equal(made.oscillators.length, 0, 'and no oscillator was created');
  assert.equal(sound.start(), true);
  assert.equal(sound.play('quest'), true, 'after start it plays');
  assert.ok(made.oscillators.length > 0, 'a real oscillator was scheduled');
});

test('stop() really stops: cues cannot play onto a shut-down output', () => {
  // After stop() the context and master still exist, so checking only those let
  // play() keep scheduling notes onto an output the caller believes is closed.
  const { Fake, made } = recordingContext();
  const sound = createSoundscape({ AudioContextClass: Fake, preference: { enabled: true, volume: 0.7 } });
  sound.start();
  assert.equal(sound.play('quest'), true);
  sound.stop();
  assert.equal(sound.started, false);
  const before = made.oscillators.length;
  assert.equal(sound.play('quest'), false, 'a stopped soundscape must not play');
  assert.equal(made.oscillators.length, before, 'and must not create oscillators either');
});

test('the soundscape can be started again after stopping', () => {
  const { Fake } = recordingContext();
  const sound = createSoundscape({ AudioContextClass: Fake, preference: { enabled: true, volume: 0.7 } });
  sound.start();
  sound.stop();
  assert.equal(sound.start(), true, 'restart is allowed');
  assert.equal(sound.started, true);
  assert.equal(sound.play('quest'), true, 'and it plays again');
});

test('starting twice does not build a second drone', () => {
  const { Fake, made } = recordingContext();
  const sound = createSoundscape({ AudioContextClass: Fake, preference: { enabled: true, volume: 0.7 } });
  sound.start();
  const afterFirst = made.oscillators.length;
  sound.start();
  assert.equal(made.oscillators.length, afterFirst, 'the second start is a no-op');
});

test('muting silences cues and unmuting restores them', () => {
  const { Fake } = recordingContext();
  const sound = createSoundscape({ AudioContextClass: Fake, preference: { enabled: true, volume: 0.7 } });
  sound.start();
  assert.equal(sound.setEnabled(false), false);
  assert.equal(sound.play('quest'), false, 'muted means silent');
  assert.equal(sound.setEnabled(true), true);
  assert.equal(sound.play('quest'), true, 'unmuted plays again');
});

test('the saved preference is written when it is toggled, and failures are reported', () => {
  const { Fake } = recordingContext();
  const written = [];
  const sound = createSoundscape({
    AudioContextClass: Fake,
    preference: { enabled: true, volume: 0.7 },
    persist: (key, value) => written.push([key, value])
  });
  sound.start();
  sound.toggle();
  assert.deepEqual(written, [[AUDIO_KEY, 'off']], 'the choice is remembered');
  sound.toggle();
  assert.deepEqual(written[1], [AUDIO_KEY, 'on']);

  // A writer that throws must not take the game down with it.
  const fragile = createSoundscape({
    AudioContextClass: Fake,
    preference: { enabled: true, volume: 0.7 },
    persist: () => { throw new Error('storage disabled'); }
  });
  fragile.start();
  assert.equal(fragile.toggle(), false, 'still toggles despite a broken writer');
});

test('every cue the game asks for actually exists', () => {
  // A typo in a cue name fails silently at runtime, so check the list directly.
  const used = ['choose', 'close', 'pickup', 'quest', 'refuse', 'talk', 'work'];
  for (const name of used) assert.ok(CUES[name], `cue "${name}" is used by the game but not defined`);
});

test('every phase the game can enter has a tone', () => {
  for (const phase of ['day', 'dusk', 'night']) {
    assert.ok(PHASE_TONES[phase], `phase "${phase}" has no tone`);
  }
});

test('changing phase while stopped is remembered for the next start', () => {
  const { Fake } = recordingContext();
  const sound = createSoundscape({ AudioContextClass: Fake, preference: { enabled: true, volume: 0.7 } });
  sound.setPhase('night');
  assert.equal(sound.phase, 'night', 'the phase tracks even before audio starts');
  sound.start();
  assert.equal(sound.phase, 'night', 'and start() uses it');
});

test('the drone stays quieter than the cues that sit on top of it', () => {
  // A drone that competes with feedback cues makes the game harder to follow, and
  // the two ceilings are the only thing keeping that balance.
  assert.ok(MAX_AMBIENCE_GAIN < MAX_CUE_GAIN, 'ambience must stay under the cue ceiling');
});


// --- Footstep timing: distance-driven, so pushing into a wall is silent -------
test('a step clock accumulates distance and fires on stride boundaries', () => {
  const clock = createStepClock({ stride: 1.0, minSpeed: 0.5 });
  assert.equal(clock.advance(2, 0.4), 0, '0.8 m is short of a stride');
  assert.equal(clock.travelled, 0.8, 'distance is carried forward');
  assert.equal(clock.advance(2, 0.2), 1, 'the next 0.4 m crosses a stride');
  assert.ok(Math.abs(clock.travelled - 0.2) < 1e-9, 'the remainder is kept');
});

test('a step clock is silent below the minimum speed', () => {
  const clock = createStepClock({ stride: 1.0, minSpeed: 0.5 });
  assert.equal(clock.advance(0.3, 10), 0, 'damping tails make no sound');
  assert.equal(clock.travelled, 0, 'and do not accumulate');
});

test('a step clock ignores non-finite or non-positive deltas', () => {
  const clock = createStepClock({ stride: 1.0, minSpeed: 0.5 });
  assert.equal(clock.advance(2, 0), 0);
  assert.equal(clock.advance(2, -1), 0);
  assert.equal(clock.advance(NaN, 0.5), 0);
  assert.equal(clock.advance(2, Infinity), 0);
});

test('a step clock can fire several steps in one frame after a stall', () => {
  const clock = createStepClock({ stride: 1.0, minSpeed: 0.5 });
  assert.equal(clock.advance(4, 1.0), 4, 'a full second of running at 4 m/s');
});

test('resetting a step clock clears the accumulator', () => {
  const clock = createStepClock({ stride: 1.0, minSpeed: 0.5 });
  clock.advance(2, 0.4);
  clock.reset();
  assert.equal(clock.travelled, 0);
});

test('footstep gain scales with speed but never exceeds the cue ceiling', () => {
  assert.equal(footstepGain(0, 4), 0, 'still means silent');
  assert.equal(footstepGain(4, 0), 0, 'no walk speed means no scale');
  assert.ok(footstepGain(1, 4) > 0);
  assert.ok(footstepGain(4, 4) <= MAX_CUE_GAIN);
  assert.ok(footstepGain(4, 4) > footstepGain(1, 4), 'faster is louder');
  assert.equal(footstepGain(NaN, 4), 0);
  assert.equal(footstepGain(4, Infinity), 0);
});

test('the FOOTSTEP cue is quieter than the interaction cues', () => {
  assert.ok(FOOTSTEP.gain < MAX_CUE_GAIN, 'footsteps must stay under the cue ceiling');
  assert.ok(FOOTSTEP.gain > 0);
  assert.ok(FOOTSTEP.length > 0 && FOOTSTEP.length < 0.2);
});

test('the step method is a safe no-op when sound is off or unstarted', () => {
  const { Fake } = recordingContext();
  const sound = createSoundscape({ AudioContextClass: Fake, preference: { enabled: true, volume: 0.7 } });
  assert.equal(sound.step({ speed: 4, walkSpeed: 4 }), false, 'unstarted means no step');
  sound.start();
  sound.setEnabled(false);
  assert.equal(sound.step({ speed: 4, walkSpeed: 4 }), false, 'muted means no step');
  sound.setEnabled(true);
  assert.equal(sound.step({ speed: 4, walkSpeed: 4 }), true, 'unmuted steps play');
});

test('the step method survives a context without createBuffer', () => {
  // An ancient browser or a locked-down environment may not expose createBuffer.
  // Footsteps must then be silent, and nothing else may break.
  class Minimal {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; this.sampleRate = 44100; }
    createGain() { return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} }, connect() {} }; }
    createOscillator() { return { type: '', frequency: { value: 0, setTargetAtTime() {} }, detune: { value: 0, setTargetAtTime() {} }, connect() {}, start() {}, stop() {} }; }
    createBiquadFilter() { return { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect() {} }; }
    resume() {}
  }
  const sound = createSoundscape({ AudioContextClass: Minimal, preference: { enabled: true, volume: 0.7 } });
  sound.start();
  assert.equal(sound.step({ speed: 4, walkSpeed: 4 }), false, 'no buffer source, no step, no crash');
  assert.equal(sound.play('talk'), true, 'cues still work');
});
