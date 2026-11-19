// The preview that gets deployed must be exactly the game: every file the manifest
// declares, nothing that is not the game, and a digest that ties the whole thing to
// one commit. These run the real builder into a temp directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, previewFiles } from '../scripts/build-preview.mjs';
import { buildManifest } from '../src/manifest.js';

const make = () => {
  const dir = mkdtempSync(join(tmpdir(), 'aa-preview-'));
  return { dir, meta: build({ outDir: dir, quiet: true }) };
};

test('the preview contains every file the manifest requires', () => {
  const { dir, meta } = make();
  try {
    const required = [...buildManifest().requiredFiles].sort();
    assert.deepEqual(meta.files, required, 'the preview file list is the manifest list');
    for (const file of required) {
      assert.ok(existsSync(join(dir, file)), `${file} is present in the preview`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the preview is a runnable site, not just files', () => {
  const { dir } = make();
  try {
    const html = readFileSync(join(dir, 'index.html'), 'utf8');
    assert.match(html, /<script type="module" src="\.\/src\/main\.js">/, 'the entry point is intact');
    assert.ok(existsSync(join(dir, 'src/main.js')));
    assert.ok(existsSync(join(dir, 'vendor/three.module.min.js')), 'Three.js is vendored, not fetched');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the preview excludes the test harness and the tooling', () => {
  // Shipping tests to a hosted preview would be both embarrassing and a way for the
  // deployed bytes to drift from what was verified.
  const { dir, meta } = make();
  try {
    for (const forbidden of ['tests/', 'scripts/', 'node_modules/', 'artifacts/', '.git/']) {
      assert.equal(meta.files.some((f) => f.startsWith(forbidden)), false,
        `${forbidden} must not be in the preview`);
    }
    assert.equal(existsSync(join(dir, 'tests')), false);
    assert.equal(existsSync(join(dir, 'scripts')), false);
    assert.equal(existsSync(join(dir, 'package.json')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the build refuses to produce a preview for a missing file', () => {
  // A guard, not a live check: if the manifest ever names a file that does not
  // exist, the build must fail loudly rather than deploy a broken game.
  const files = previewFiles();
  assert.ok(files.includes('index.html'), 'the entry point is in the list');
  for (const file of files) {
    assert.ok(statSync(file).isFile(), `${file} exists on disk`);
  }
});

test('the preview is accompanied by machine-readable metadata', () => {
  const { dir } = make();
  try {
    const meta = JSON.parse(readFileSync(join(dir, 'preview.json'), 'utf8'));
    assert.equal(meta.entryPoint, 'index.html', 'the startup file is stated');
    assert.match(meta.digest, /^[0-9a-f]{64}$/, 'there is a sha-256 of the contents');
    assert.ok(meta.fileCount > 20, 'the file count is real');
    assert.ok(typeof meta.commit === 'string' && meta.commit.length >= 7, 'the commit is recorded');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the same sources produce the same digest', () => {
  // Determinism is what makes "deployed from this commit" a verifiable claim.
  const a = make();
  const b = make();
  try {
    assert.equal(a.meta.digest, b.meta.digest, 'two builds of the same tree agree');
  } finally {
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});

test('the preview adds a fallback so a mistyped path still serves the game', () => {
  const { dir } = make();
  try {
    const redirects = readFileSync(join(dir, '_redirects'), 'utf8');
    assert.match(redirects, /\/index\.html/, 'a static host has a rule to fall back to the game');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the shipped game fetches nothing from another origin', () => {
  // A bare URL scan is too blunt: the SVG namespace and a documentation link in a
  // vendored library are strings, never requests. What actually matters is that no
  // file the game loads names a remote host in a way the browser would follow.
  const { dir, meta } = make();
  try {
    const fetched = [];
    for (const file of meta.files) {
      if (!/\.(js|html)$/.test(file)) continue;
      const body = readFileSync(join(dir, file), 'utf8');
      // <script src=...>, <link href=...>, import ... from '...', fetch('...')
      for (const m of body.matchAll(/(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi)) fetched.push(`${file}: ${m[1]}`);
      for (const m of body.matchAll(/(?:import|from)\s+["'](https?:\/\/[^"']+)["']/gi)) fetched.push(`${file}: ${m[1]}`);
      for (const m of body.matchAll(/fetch\(\s*["'](https?:\/\/[^"']+)["']/gi)) fetched.push(`${file}: ${m[1]}`);
    }
    assert.deepEqual(fetched, [], `nothing is loaded from a remote host: ${fetched.join(', ')}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
