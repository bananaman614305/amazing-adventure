// Sound: no audio files exist, everything is synthesised, so the properties that
// matter are the maths and the safety rules -- that it is quiet enough not to
// startle, that it can always be turned off, and that it never breaks the game.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  noteFrequency, pentatonicNote, PENTATONIC, PHASE_TONES, phaseTone, CUES,
  envelope, cueDuration, clampGain, cueGain, ambienceGain, readPreference,
  writePreference, createSoundscape, AUDIO_KEY, MAX_CUE_GAIN, MAX_AMBIENCE_GAIN
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
