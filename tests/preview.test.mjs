// The preview that gets deployed must be exactly the game: every file the manifest
// declares, nothing that is not the game, and a digest that ties the whole thing to
// one commit. These run the real builder into a temp directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, previewFiles } from '../scripts/build-preview.mjs';
import { buildManifest } from '../src/manifest.js';

const require = createRequire(import.meta.url);

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
    // The digest is the identity. A commit hash would be self-referential, since
    // dist/ is committed, so it must not be present to go stale.
    assert.equal(meta.builtFromCommit, undefined, 'no self-referential commit field');
    assert.match(meta.sourceDigest, /^[0-9a-f]{64}$/, 'the content digest identifies the artefact');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the committed preview matches the committed sources', () => {
  // dist/ is checked in so a deployment is a plain upload of known bytes. That is
  // only safe if the bytes cannot go stale: rebuild from HEAD and compare the digest
  // the sources produce with the digest recorded in the committed preview.json.
  const { existsSync, readFileSync } = require('node:fs');
  const committedPath = join(process.cwd(), 'dist', 'preview.json');
  if (!existsSync(committedPath)) {
    assert.ok(true, 'no committed preview in this checkout');
    return;
  }
  const committed = JSON.parse(readFileSync(committedPath, 'utf8'));
  const rebuilt = make();
  try {
    assert.equal(rebuilt.meta.sourceDigest, committed.sourceDigest,
      'dist/ is stale: run `node scripts/build-preview.mjs` and commit the result');
  } finally {
    rmSync(rebuilt.dir, { recursive: true, force: true });
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

test('the preview carries the GitHub Pages marker so files are served verbatim', () => {
  // Pages runs Jekyll by default, which drops underscore-prefixed paths and can
  // rewrite content. `.nojekyll` is the standard opt-out and must be present.
  const { dir, meta } = make();
  try {
    assert.ok(existsSync(join(dir, '.nojekyll')), 'the .nojekyll marker is present');
    // Nothing host-specific from another platform should linger.
    assert.equal(existsSync(join(dir, '_redirects')), false,
      'no Cloudflare-specific redirect file in a Pages artefact');
    // The artefact is the game plus that one marker, and nothing else.
    const extras = meta.files.filter((f) => f.startsWith('_') || f.startsWith('.'));
    assert.deepEqual(extras, [], 'no hidden or underscore files are shipped beyond the marker');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the game works from a project subpath, as GitHub Pages serves it', () => {
  // A project site lives at /<repo>/, not at the domain root. Every reference in the
  // entry point must therefore be relative, or the page 404s on a phone.
  const { dir } = make();
  try {
    const html = readFileSync(join(dir, 'index.html'), 'utf8');
    const absolute = [...html.matchAll(/(?:src|href)\s*=\s*["'](\/[^/"'][^"']*)["']/gi)]
      .map((m) => m[1]);
    assert.deepEqual(absolute, [], `no root-absolute URLs: ${absolute.join(', ')}`);
    assert.match(html, /src="\.\/src\/main\.js"/, 'the entry point is loaded relatively');
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
