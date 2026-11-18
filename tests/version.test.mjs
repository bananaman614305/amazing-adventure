// The build identity is read by the page, the game object and the release
// notes, so hold it to an obvious, comparable shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERSION, BUILD_NAME, RELEASE_CHANNEL, ENTRY_POINT } from '../src/version.js';

test('the version is semantic and matches the release document', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/, `version ${VERSION}`);
  const release = readFileSync(new URL('../RELEASE.md', import.meta.url), 'utf8');
  assert.ok(release.includes(`\`${VERSION}\``), 'RELEASE.md names this version');
  assert.ok(release.includes(BUILD_NAME), 'RELEASE.md names this build');
  assert.ok(release.includes(ENTRY_POINT), 'RELEASE.md names the entry point');
});

test('the package version tracks the game version', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  // The package may lag a patch but must not point at a different release line.
  const [major, minor] = pkg.version.split('.');
  const [vMajor, vMinor] = VERSION.split('.');
  assert.equal(`${major}.${minor}`, `${vMajor}.${vMinor}`,
    `package ${pkg.version} vs game ${VERSION}`);
});

test('the entry point exists and is the page that loads the game', () => {
  const html = readFileSync(new URL(`../${ENTRY_POINT}`, import.meta.url), 'utf8');
  assert.match(html, /src\/main\.js/, 'entry point loads the game module');
});

test('the candidate has no external runtime dependencies', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const urls = [...html.matchAll(/https?:\/\/[^\s"')]+/g)].map((m) => m[0]);
  const external = urls.filter((u) => !u.includes('www.w3.org'));
  assert.deepEqual(external, [], `index.html must not fetch remote code: ${external.join(', ')}`);
  assert.match(html, /vendor\/three\.module\.min\.js/, 'Three.js is vendored locally');
  const vendor = readFileSync(new URL('../vendor/three.module.min.js', import.meta.url), 'utf8');
  assert.ok(vendor.length > 100000, 'the vendored build is a real bundle');
  assert.match(vendor, /Three\.js Authors/, 'the vendored build keeps its licence header');
});

test('the release licence file credits Three.js', () => {
  const licence = readFileSync(new URL('../vendor/THREE-LICENSE.txt', import.meta.url), 'utf8');
  assert.match(licence, /MIT/, 'vendored code is MIT licensed');
  assert.match(licence, /Three\.js/i);
});

test('the page shows the version the code reports', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(html.includes(VERSION), `index.html shows ${VERSION}`);
});
