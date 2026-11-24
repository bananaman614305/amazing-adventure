// Round 74: the plaza's window and lamp glass follows the hour.
//
// The materials audit put `HouseGlass` (4.63 m2) and `LampGlass` (4.50 m2) at the
// top of what is still flat after round 73. These tests hold the pure decisions
// the world applies: which name is which kind, what each phase writes, and the
// two contracts that keep glass honest -- a lane pane never glows over a dark
// bulb, and a window never follows the lane's round.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GLASS_LOOKS,
  GLASS_AUTHORED,
  GLASS_EMISSIVE,
  glassLook,
  glassKindFor,
  glassStateFor,
  glassCastsShadow
} from '../src/glass.js';

test('glassKindFor names the two glass materials and nothing else', () => {
  assert.equal(glassKindFor('HouseGlass'), 'window');
  assert.equal(glassKindFor('LampGlass'), 'lamp');
  // The shipped GLBs are the only authors of those names, and a loose match
  // would catch surfaces that belong to no lamp (or to no house).
  for (const name of ['Glassware', 'Glass', 'LampBulb', 'LanternHousing',
    'HouseStone', 'LampIron', '', null, undefined]) {
    assert.equal(glassKindFor(name), null, `${name} must not be glass`);
  }
});

test('glassLook falls back to day rather than throwing on a bad phase', () => {
  assert.equal(glassLook('dusk'), GLASS_LOOKS.dusk);
  assert.equal(glassLook('night'), GLASS_LOOKS.night);
  assert.equal(glassLook('dawn'), GLASS_LOOKS.day, 'an unknown hour is daylight');
  assert.equal(glassLook(null), GLASS_LOOKS.day);
});

test('daylight pane is dark, reflective and unlit', () => {
  const state = glassStateFor('window', 'day');
  assert.equal(state.emissiveIntensity, 0, 'a window does not glow at noon');
  // A reflective window reads as glass; a matte one reads as paint.
  assert.ok(state.metalness > 0.2, 'daylight glass keeps a mirror');
  assert.ok(state.roughness < 0.2, 'and a tight reflection');
});

test('the night window and lamp pane both glow behind their light', () => {
  const windowState = glassStateFor('window', 'night');
  const lampState = glassStateFor('lamp', 'night');
  assert.ok(windowState.emissiveIntensity > 0, 'a lit room shows through at night');
  assert.ok(lampState.emissiveIntensity > 0, 'a lamp pane glows over its bulb');
  // The pane's own glow must be the warm interior tint, not the diffuse colour.
  assert.equal(windowState.emissive, GLASS_EMISSIVE);
  assert.equal(lampState.emissive, GLASS_EMISSIVE);
});

test('a window warms monotonically from day through dusk to night', () => {
  // The three authored hours must be strictly ordered, or the dusk pane could
  // read brighter than the midnight one and the plaza would look wrong at 6pm.
  const day = glassStateFor('window', 'day').emissiveIntensity;
  const dusk = glassStateFor('window', 'dusk').emissiveIntensity;
  const night = glassStateFor('window', 'night').emissiveIntensity;
  assert.equal(day, 0, 'no glow by daylight');
  assert.ok(dusk > day, 'dusk lights the window');
  assert.ok(night > dusk, 'and night lights it further');
});

test('a lane lamp pane stays dark until the lane round is walked', () => {
  const lit = glassStateFor('lamp', 'night', { laneLit: true });
  const dark = glassStateFor('lamp', 'night', { laneLit: false });
  assert.ok(lit.emissiveIntensity > 0);
  assert.equal(dark.emissiveIntensity, 0,
    'a dark lantern must not glow through its glass');
  // The dark pane still follows the hour's diffuse tint; only the glow is off.
  assert.equal(dark.color, lit.color);
});

test('the lane round does not touch a window, which has no bulb', () => {
  // A window has no lantern in the game's model of the lane, so the lane's
  // lit/unlit state must leave it exactly on the hour's curve.
  for (const laneLit of [true, false]) {
    for (const phase of ['day', 'dusk', 'night']) {
      const a = glassStateFor('window', phase, { laneLit });
      assert.deepEqual(a, glassStateFor('window', phase, { laneLit: true }),
        `a window is independent of the lane at ${phase}`);
    }
  }
});

test('the low tier dims the glow without putting the pane out', () => {
  const full = glassStateFor('lamp', 'night', { low: false });
  const low = glassStateFor('lamp', 'night', { low: true });
  assert.ok(full.emissiveIntensity > low.emissiveIntensity, 'low blooms less');
  assert.ok(low.emissiveIntensity > 0, 'but a lit pane still reads as lit');
  assert.ok(low.emissiveIntensity <= 0.6, 'and stays under the readability cap');
  // A daytime pane has no glow to dim, so the tier is a no-op there.
  assert.equal(glassStateFor('lamp', 'day', { low: true }).emissiveIntensity, 0);
});

test('no phase leaves a pane invisible: the diffuse tint is always present', () => {
  // A pure-black tint would read as a hole in the wall. Every phase keeps some
  // legible colour on both kinds, and the metalness is always above zero so the
  // pane still catches the sky's reflection.
  for (const phase of ['day', 'dusk', 'night']) {
    for (const kind of ['window', 'lamp']) {
      const state = glassStateFor(kind, phase);
      assert.notEqual(state.color, 0x000000, `${kind} ${phase} is not black`);
      assert.ok(state.metalness > 0, `${kind} ${phase} reflects something`);
      assert.ok(state.roughness > 0 && state.roughness < 0.3,
        `${kind} ${phase} is smooth enough to read as glass`);
    }
  }
});

test('a window casts its frame shadow; a lamp pane does not', () => {
  // A lamp pane is a thin shell: casting would give every lantern a hard
  // quadrilateral shadow the bulb itself does not have.
  assert.equal(glassCastsShadow('window'), true);
  assert.equal(glassCastsShadow('lamp'), false);
  assert.equal(glassCastsShadow('anything else'), false);
});

test('the authored fallback values match the shipped GLB materials', () => {
  // These are the values the panes ship with; the world reads them so an
  // undressed pane degrades toward what Blender authored rather than to black.
  assert.deepEqual(GLASS_AUTHORED.window, { color: 0x616c76, roughness: 0.25, metalness: 0.2 });
  assert.deepEqual(GLASS_AUTHORED.lamp, { color: 0xf9f1ce, roughness: 0.15, metalness: 0 });
});
