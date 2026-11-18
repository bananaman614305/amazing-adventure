// The release manifest is what a dashboard Play tab would read to know how to
// serve the preview, so it must agree with the repository: a file list that
// names something that does not exist would ship a 404.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { buildManifest, verifyManifest, REQUIRED_FILES } from '../src/manifest.js';
import { VERSION, ENTRY_POINT } from '../src/version.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Every file in the repo, relative to the root, ignoring heavy directories. */
function walk(dir, out = [], skip = new Set(['node_modules', '.git'])) {
  for (const entry of readdirSync(dir)) {
    if (skip.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out, skip);
    else out.push(relative(ROOT, full));
  }
  return out;
}

const allFiles = walk(ROOT);

test('every file the manifest requires actually exists', () => {
  const { ok, missing } = verifyManifest(buildManifest(), allFiles);
  assert.equal(ok, true, `manifest names missing files: ${missing.join(', ')}`);
});

test('the manifest lists the real game source, not just some of it', () => {
  // Every .js under src/ must be listed: a forgotten module 404s at runtime.
  const sourceFiles = allFiles.filter((f) => f.startsWith('src/') && f.endsWith('.js'));
  const listed = new Set(REQUIRED_FILES);
  const unlisted = sourceFiles.filter((f) => !listed.has(f));
  assert.deepEqual(unlisted, [], `src files missing from the manifest: ${unlisted.join(', ')}`);
});

test('the manifest agrees with version.js', () => {
  const m = buildManifest();
  assert.equal(m.version, VERSION);
  assert.equal(m.entryPoint, ENTRY_POINT);
});

test('the manifest names no file it also says to omit', () => {
  const m = buildManifest();
  for (const file of m.requiredFiles) {
    for (const prefix of m.omittedPrefixes) {
      assert.equal(file.startsWith(prefix), false,
        `${file} is required but also matched by omitted prefix ${prefix}`);
    }
  }
});

test('verifyManifest reports exactly what is missing', () => {
  const m = buildManifest();
  const partial = allFiles.filter((f) => f !== 'vendor/three.module.min.js');
  const result = verifyManifest(m, partial);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['vendor/three.module.min.js']);
});

test('nothing outside the required list is needed at runtime', () => {
  // The engine files must not import anything from tests/, scripts/ or the docs.
  for (const file of REQUIRED_FILES.filter((f) => f.endsWith('.js'))) {
    const source = readFileSync(join(ROOT, file), 'utf8');
    const imports = [...source.matchAll(/from\s+['"]\.\.\/([a-z]+)\//gi)].map((m) => m[1]);
    for (const dir of imports) {
      assert.equal(['tests', 'scripts', 'artifacts'].includes(dir), false,
        `${file} imports from ../${dir}/`);
    }
  }
});

test('the entry point is at the top of the required list and is html', () => {
  assert.equal(REQUIRED_FILES[0], ENTRY_POINT);
  assert.ok(REQUIRED_FILES[0].endsWith('.html'));
});

test('the manifest declares no build step and a root serve path', () => {
  const m = buildManifest();
  assert.equal(m.buildStep, null, 'statically served, so no build step');
  assert.equal(m.serveRoot, '.');
  assert.ok(m.notes.length >= 2, 'the notes explain how to serve it');
});

test('the committed release-manifest.json matches the code', () => {
  // The JSON exists so a hosting step need not parse the game source, so it must
  // be regenerated whenever the manifest changes, not left to drift.
  const committed = JSON.parse(readFileSync(join(ROOT, 'release-manifest.json'), 'utf8'));
  assert.deepEqual(committed, buildManifest(),
    'release-manifest.json is stale; run `npm run release:manifest`');
});
