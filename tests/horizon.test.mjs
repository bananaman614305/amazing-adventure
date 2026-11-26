// The distant ridge on the skyline. The pure numbers live in src/horizon.js;
// this file holds them to their contract so the exact ring the GPU gets is
// pinned: how tall the ridge is around the circle, where each point sits, the
// triangles a renderer should build, and what colour and opacity it takes per
// phase -- and that the whole thing is deterministic, so a screenshot taken
// twice looks the same.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HORIZON_RADIUS, HORIZON_SEGMENTS, HORIZON_BASE_Y, HORIZON_BASE_HEIGHT,
  HORIZON_HEIGHT_VARIATION, HORIZON_SEED, HORIZON_DAY_TINT, HORIZON_DAY_HAZE,
  horizonHeights, horizonPoint, horizonRibbonVertices, horizonRibbonArray,
  horizonRibbonColors, horizonTint, horizonOpacity, horizonFootTint
} from '../src/horizon.js';

const EPS = 1e-9;

function approx(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < EPS,
    `${message ?? 'value'}: expected ${expected}, got ${actual}`);
}

const MIN_HEIGHT = HORIZON_BASE_HEIGHT - HORIZON_HEIGHT_VARIATION;
const MAX_HEIGHT = HORIZON_BASE_HEIGHT + HORIZON_HEIGHT_VARIATION;

test('constants are numbers and sensible', () => {
  assert.equal(HORIZON_RADIUS, 112);
  assert.equal(HORIZON_SEGMENTS, 96);
  // The foot is dropped far below the ground disc so its lower edge can never be
  // seen against the dome; the ridge line is tall enough to clear the 3.2 m wall.
  assert.equal(HORIZON_BASE_Y, -30);
  assert.equal(HORIZON_BASE_HEIGHT, 44);
  assert.equal(HORIZON_HEIGHT_VARIATION, 6);
  assert.equal(HORIZON_SEED, 0x5eed1a7);
  assert.ok(HORIZON_RADIUS > 0);
  assert.ok(HORIZON_RADIUS < 120, 'the ridge sits inside the 120 m sky dome');
  assert.ok(HORIZON_SEGMENTS > 0);
  assert.ok(HORIZON_BASE_HEIGHT > 0);
  assert.ok(HORIZON_HEIGHT_VARIATION > 0);
  assert.ok(HORIZON_BASE_Y < -5, 'the foot sits far below ground so no cut edge shows');
  // Hilltops are measured from the foot, so the lowest crest above ground is
  // BASE_Y + MIN_HEIGHT. That has to clear the wall or the whole ridge is hidden.
  assert.ok(HORIZON_BASE_Y + MIN_HEIGHT > 3.2,
    'the lowest hilltop must clear the 3.2 m border wall to be visible');
  assert.ok(HORIZON_BASE_Y + MAX_HEIGHT > HORIZON_BASE_Y + MIN_HEIGHT);
});

test('horizonHeights returns one height per segment', () => {
  const heights = horizonHeights();
  assert.equal(heights.length, HORIZON_SEGMENTS);
  assert.equal(horizonHeights(7).length, 7);
  assert.equal(horizonHeights(1).length, 1);
});

test('horizonHeights guards a non-positive or non-finite count', () => {
  assert.equal(horizonHeights(0).length, 0);
  assert.equal(horizonHeights(-3).length, 0);
  assert.equal(horizonHeights(NaN).length, 0);
  assert.equal(horizonHeights(Infinity).length, 0);
});

test('every height sits inside the authored band', () => {
  const heights = horizonHeights();
  for (let i = 0; i < heights.length; i += 1) {
    const h = heights[i];
    assert.ok(Number.isFinite(h), `height ${i} is finite`);
    assert.ok(h >= MIN_HEIGHT - EPS && h <= MAX_HEIGHT + EPS,
      `height ${i} = ${h} is inside [${MIN_HEIGHT}, ${MAX_HEIGHT}]`);
  }
});

test('the ridge is smooth: adjacent heights differ little, wrap seam included', () => {
  const heights = horizonHeights();
  let maxDiff = 0;
  for (let i = 0; i < heights.length; i += 1) {
    const next = heights[(i + 1) % heights.length]; // wraps last -> first
    const diff = Math.abs(next - heights[i]);
    if (diff > maxDiff) maxDiff = diff;
    assert.ok(diff < 0.5, `step ${i} -> ${(i + 1) % heights.length} is ${diff}, too sharp`);
  }
  // Prove the check can fail: a white-noise ring would blow past 0.5.
  assert.ok(maxDiff < 0.5);
});

test('the silhouette is broad hills, not white noise', () => {
  // A few sign changes around the loop, not dozens: the ridge should have a
  // couple of crests, not one per segment.
  const heights = horizonHeights();
  let crossings = 0;
  const mean = (MIN_HEIGHT + MAX_HEIGHT) / 2;
  for (let i = 0; i < heights.length; i += 1) {
    const a = heights[i] - mean;
    const b = heights[(i + 1) % heights.length] - mean;
    if ((a < 0 && b >= 0) || (a >= 0 && b < 0)) crossings += 1;
  }
  assert.ok(crossings >= 2 && crossings <= 12,
    `expected a couple of broad hills, saw ${crossings} crossings`);
});

test('horizonHeights is deterministic and differs across seeds', () => {
  const a = horizonHeights();
  const b = horizonHeights();
  assert.deepEqual([...a], [...b], 'two default calls are identical');

  const fixed1 = horizonHeights(HORIZON_SEGMENTS, 0x1234);
  const fixed2 = horizonHeights(HORIZON_SEGMENTS, 0x1234);
  assert.deepEqual([...fixed1], [...fixed2], 'a fixed seed repeats exactly');

  const other = horizonHeights(HORIZON_SEGMENTS, 0x4321);
  assert.notDeepEqual([...a], [...other], 'a different seed gives a different ridge');
});

test('horizonPoint places index 0 on +x at the field radius', () => {
  const p = horizonPoint(0, HORIZON_SEGMENTS, HORIZON_BASE_HEIGHT);
  approx(p.x, HORIZON_RADIUS, 'x at index 0');
  approx(p.z, 0, 'z at index 0');
  approx(p.y, HORIZON_BASE_Y + HORIZON_BASE_HEIGHT, 'y is foot + height');
});

test('horizonPoint walks the ring and sits at the given radius', () => {
  const count = 8;
  const radius = 50;
  for (let i = 0; i < count; i += 1) {
    const p = horizonPoint(i, count, 2, radius);
    approx(Math.hypot(p.x, p.z), radius, `radius at index ${i}`);
    approx(p.y, HORIZON_BASE_Y + 2, `y at index ${i}`);
    const angle = (i / count) * Math.PI * 2;
    approx(p.x, radius * Math.cos(angle), `x at index ${i}`);
    approx(p.z, radius * Math.sin(angle), `z at index ${i}`);
  }
});

test('horizonPoint guards count <= 0 without producing NaN', () => {
  for (const count of [0, -1, NaN]) {
    const p = horizonPoint(0, count, 2);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z),
      `count ${count} yields finite coordinates`);
    approx(p.x, 0, `x collapses at count ${count}`);
    approx(p.z, 0, `z collapses at count ${count}`);
    approx(p.y, HORIZON_BASE_Y + 2, `y still carries the height at count ${count}`);
  }
});

test('horizonRibbonVertices builds two triangles (six verts) per segment', () => {
  const verts = horizonRibbonVertices();
  // 2 triangles * 3 verts per segment = 6 verts, i.e. count * 2 * 3.
  assert.equal(verts.length, HORIZON_SEGMENTS * 2 * 3);
  assert.equal(verts.length, HORIZON_SEGMENTS * 6);
  for (const p of verts) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z),
      'every vertex is finite');
    const onFoot = Math.abs(p.y - HORIZON_BASE_Y) < EPS;
    const onRidge = p.y > HORIZON_BASE_Y + EPS;
    assert.ok(onFoot || onRidge, `vertex y ${p.y} is either foot or ridge`);
  }
});

test('horizonRibbonVertices honours a custom count and guards zero', () => {
  assert.equal(horizonRibbonVertices(4).length, 4 * 6);
  assert.equal(horizonRibbonVertices(0).length, 0);
  assert.equal(horizonRibbonVertices(-2).length, 0);
  assert.equal(horizonRibbonVertices(NaN).length, 0);
});

test('the ribbon foot sits at BASE_Y and the ridge carries the heights', () => {
  const count = HORIZON_SEGMENTS;
  const heights = horizonHeights();
  const verts = horizonRibbonVertices();
  // Six vertices per segment: [foot i, foot i+1, ridge i, foot i+1, ridge i+1, ridge i].
  for (let i = 0; i < count; i += 1) {
    const base = i * 6;
    const next = (i + 1) % count;
    approx(verts[base].y, HORIZON_BASE_Y, `foot i y at segment ${i}`);
    approx(verts[base + 1].y, HORIZON_BASE_Y, `foot i+1 y at segment ${i}`);
    approx(verts[base + 2].y, HORIZON_BASE_Y + heights[i], `ridge i y at segment ${i}`);
    approx(verts[base + 4].y, HORIZON_BASE_Y + heights[next], `ridge i+1 y at segment ${i}`);
  }
});

test('horizonRibbonArray is a flat Float32Array of x, y, z triples', () => {
  const arr = horizonRibbonArray();
  assert.ok(arr instanceof Float32Array, 'a Float32Array');
  assert.equal(arr.length, HORIZON_SEGMENTS * 2 * 3 * 3);
  assert.equal(arr.length, HORIZON_SEGMENTS * 18);
  // It is the same data as the object form, just flattened. The buffer is
  // Float32, so compare with a tolerance the narrower type can actually meet.
  const verts = horizonRibbonVertices();
  const near32 = (actual, expected, message) => assert.ok(
    Math.abs(actual - expected) < 1e-5, `${message}: expected ${expected}, got ${actual}`);
  for (let i = 0; i < verts.length; i += 1) {
    near32(arr[i * 3], verts[i].x, `x of vertex ${i}`);
    near32(arr[i * 3 + 1], verts[i].y, `y of vertex ${i}`);
    near32(arr[i * 3 + 2], verts[i].z, `z of vertex ${i}`);
  }
  // Every y in the flat buffer is foot or ridge too.
  for (let i = 1; i < arr.length; i += 3) {
    const onFoot = Math.abs(arr[i] - HORIZON_BASE_Y) < 1e-6;
    const onRidge = arr[i] > HORIZON_BASE_Y;
    assert.ok(onFoot || onRidge, `flat y ${arr[i]} is foot or ridge`);
  }
  assert.equal(horizonRibbonArray(0).length, 0);
});

test('horizonRibbonVertices winds every triangle the same way', () => {
  // Both triangles of every segment must face the same direction, or half the
  // ridge would be culled from inside the ring. The cross product of each
  // triangle's edges, dotted with the radial direction, must keep one sign.
  const verts = horizonRibbonVertices(12, 99);
  const signs = [];
  for (let t = 0; t < verts.length; t += 3) {
    const a = verts[t];
    const b = verts[t + 1];
    const c = verts[t + 2];
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    const nx = uy * vz - uz * vy;
    const nz = ux * vy - uy * vx;
    const cx = (a.x + b.x + c.x) / 3;
    const cz = (a.z + b.z + c.z) / 3;
    signs.push(Math.sign(nx * cx + nz * cz));
  }
  assert.ok(signs.every((s) => s === signs[0]),
    `all ${signs.length} triangles must share a winding`);
  assert.notEqual(signs[0], 0, 'the winding is not degenerate');
});

test('the ribbon closes: the last segment wraps to the first ridge height', () => {
  const count = HORIZON_SEGMENTS;
  const heights = horizonHeights();
  const verts = horizonRibbonVertices();
  const last = count - 1;
  const base = last * 6;
  // Order per segment: [footI, footNext, ridgeI, footNext, ridgeNext, ridgeI].
  // For the last segment footNext/ridgeNext wrap to index 0.
  approx(verts[base + 1].y, HORIZON_BASE_Y, 'wrap foot y');
  approx(verts[base + 4].y, HORIZON_BASE_Y + heights[0], 'wrap ridge y (next corner)');
  approx(verts[base + 5].y, HORIZON_BASE_Y + heights[last], 'last ridge corner stays on the last hill');
});

test('horizonTint tints per phase and falls back to the day haze', () => {
  assert.equal(horizonTint('day'), 0x8fa6b8);
  assert.equal(horizonTint('dusk'), 0x6b5a72);
  assert.equal(horizonTint('night'), 0x111a2b);
  assert.equal(horizonTint('nope'), 0x8fa6b8, 'an unknown phase reads as day');
  assert.equal(horizonTint(undefined), 0x8fa6b8);
  assert.equal(horizonTint(null), 0x8fa6b8);
});

test('horizonOpacity is per phase, always below opaque, and falls back to day', () => {
  assert.equal(horizonOpacity('day'), 0.85);
  assert.equal(horizonOpacity('dusk'), 0.9);
  assert.equal(horizonOpacity('night'), 0.75);
  assert.equal(horizonOpacity('midnight'), 0.85, 'an unknown phase reads as day');
  assert.equal(horizonOpacity(undefined), 0.85);
  for (const phase of ['day', 'dusk', 'night', 'nope']) {
    const o = horizonOpacity(phase);
    assert.ok(o > 0 && o < 1, `opacity ${o} for ${phase} leaves the fog showing through`);
  }
});

test('nothing here is random: two full builds match byte for byte', () => {
  const a = horizonRibbonArray();
  const b = horizonRibbonArray();
  assert.deepEqual([...a], [...b]);
});

test('horizonFootTint is per phase and falls back to the day haze', () => {
  assert.equal(horizonFootTint('day'), HORIZON_DAY_HAZE);
  assert.equal(horizonFootTint('dusk'), 0xf0a97c);
  assert.equal(horizonFootTint('night'), 0x0b1730);
  assert.equal(horizonFootTint('nope'), HORIZON_DAY_HAZE, 'an unknown phase reads as day');
  assert.equal(horizonFootTint(undefined), HORIZON_DAY_HAZE);
  // The foot is always a lighter/hazier colour than the ridge line by day, so the
  // gradient runs the right way: solid hills fading into air.
  const foot = horizonFootTint('day');
  const lum = (hex) => ((hex >> 16) & 0xff) + ((hex >> 8) & 0xff) + (hex & 0xff);
  assert.ok(lum(foot) > lum(HORIZON_DAY_TINT), 'the foot haze is lighter than the ridge');
});

test('horizonRibbonColors matches the ribbon vertex order and count', () => {
  const count = 6;
  const ridge = HORIZON_DAY_TINT;
  const foot = HORIZON_DAY_HAZE;
  const colors = horizonRibbonColors(ridge, foot, count);
  assert.ok(colors instanceof Float32Array, 'a Float32Array for the vertex attribute');
  assert.equal(colors.length, count * 6 * 3, 'one rgb triple per vertex');
  // Same length as the position buffer, so the two upload side by side.
  assert.equal(colors.length, horizonRibbonArray(count).length);

  const channels = (hex) => [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
  const ridgeC = channels(ridge);
  const footC = channels(foot);
  // Vertex order: foot(i), foot(i+1), ridge(i), foot(i+1), ridge(i+1), ridge(i).
  const expected = [footC, footC, ridgeC, footC, ridgeC, ridgeC];
  // The buffer is Float32, so compare at the precision the narrower type meets.
  const near32 = (actual, want, message) => assert.ok(
    Math.abs(actual - want) < 1e-5, `${message}: expected ${want}, got ${actual}`);
  for (let i = 0; i < count; i += 1) {
    for (let v = 0; v < 6; v += 1) {
      const at = (i * 6 + v) * 3;
      for (let ch = 0; ch < 3; ch += 1) {
        near32(colors[at + ch], expected[v][ch], `segment ${i} vertex ${v} channel ${ch}`);
      }
    }
  }
});

test('horizonRibbonColors guards a bad count and bad hex', () => {
  assert.equal(horizonRibbonColors(HORIZON_DAY_TINT, HORIZON_DAY_HAZE, 0).length, 0);
  assert.equal(horizonRibbonColors(HORIZON_DAY_TINT, HORIZON_DAY_HAZE, -4).length, 0);
  assert.equal(horizonRibbonColors(HORIZON_DAY_TINT, HORIZON_DAY_HAZE, NaN).length, 0);
  // Invalid hex falls back to the day pair rather than emitting NaN.
  const fallback = horizonRibbonColors(undefined, null, 2);
  assert.equal(fallback.length, 2 * 6 * 3);
  for (const v of fallback) {
    assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, `channel ${v} is a valid colour`);
  }
  const ref = horizonRibbonColors(HORIZON_DAY_TINT, HORIZON_DAY_HAZE, 2);
  assert.deepEqual([...fallback], [...ref], 'bad input equals the day default');
});