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

test('the manifest lists every texture, model and vendor file assets.js references', async () => {
  // Rounds 101-111 each added a texture family and listed it by hand. Round 111
  // added doormat_* and soil_* to assets.js but not to REQUIRED_FILES, so dist/
  // shipped without them: the boot-time load 404s, every family degrades to
  // 'flat', and the game still plays -- a silent fidelity loss that no existing
  // test could see, because the manifest test only walked src/*.js. The cast's
  // leather maps had the same gap since round 82. So the guard now reads the
  // asset references out of the source itself and fails on any that the preview
  // would not contain. Anything under assets/ or vendor/ that a src module names
  // as a quoted string is treated as a shipped file.
  const refs = new Set();
  for (const file of allFiles.filter((f) => f.startsWith('src/') && f.endsWith('.js'))) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    for (const match of text.matchAll(/['"`]((?:assets|vendor)\/[A-Za-z0-9_./-]+\.(?:webp|glb|png|jpg|js|txt))['"`]/g)) {
      refs.add(match[1]);
    }
  }
  // The guard must be non-vacuous: if the regex ever stops matching (a refactor
  // to template strings with a directory variable, say), this test would pass
  // while checking nothing.
  assert.ok(refs.size > 80, `only ${refs.size} asset references found; the scan is broken`);
  const listed = new Set(REQUIRED_FILES);
  const unlisted = [...refs].filter((r) => !listed.has(r)).sort();
  assert.deepEqual(unlisted, [],
    `assets referenced by src/ but missing from REQUIRED_FILES (dist/ would 404 them): ${unlisted.join(', ')}`);
  // Every referenced file must also exist, or the manifest-and-disk check above
  // would pass on a name the build copies into a hole.
  for (const ref of refs) {
    assert.ok(allFiles.includes(ref), `${ref} is referenced but does not exist`);
  }
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
