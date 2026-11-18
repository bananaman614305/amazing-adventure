// Builds the static preview that gets deployed.
//
// The game has no build step at runtime: index.html loads ES modules straight from
// ./src. What the preview needs is therefore a *copy* of exactly the files the
// manifest declares, so the deployed thing can never include a test harness, an
// artifact or anything else that is not part of the game, and can never omit a src
// file that the manifest test would have caught in development.
//
// Output is deterministic: same commit in, same bytes out.
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { execSync } from 'node:child_process';
import { buildManifest } from '../src/manifest.js';

const OUT = 'dist';
const MANIFEST = buildManifest();

/** Every file the preview will contain, in a stable order. */
export function previewFiles() {
  return [...MANIFEST.requiredFiles].sort();
}

/** SHA-256 of the preview contents, so a deployment can be tied to exact bytes. */
export function buildDigest(root, files) {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(join(root, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function git(args, fallback = null) {
  try {
    return execSync(`git ${args}`, { encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
}

export function build({ outDir = OUT, quiet = false } = {}) {
  const files = previewFiles();
  const missing = files.filter((f) => {
    try {
      return !statSync(f).isFile();
    } catch {
      return true;
    }
  });
  if (missing.length) {
    throw new Error(`the manifest lists files that do not exist: ${missing.join(', ')}`);
  }

  rmSync(outDir, { recursive: true, force: true });
  for (const file of files) {
    const dest = join(outDir, file);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(file, dest);
  }

  const commit = git('rev-parse HEAD');
  const dirty = git('status --porcelain');
  const digest = buildDigest('.', files);

  // Cloudflare Pages serves a static directory; no SPA rewrite is needed because
  // the game is one page, but the host still deserves a fallback so a mistyped
  // path returns the game rather than a blank 404 on a phone.
  writeFileSync(join(outDir, '_redirects'), '/*  /index.html  200\n');

  const meta = {
    name: MANIFEST.name || 'amazing-adventure',
    version: MANIFEST.version || null,
    build: MANIFEST.build || null,
    entryPoint: MANIFEST.entryPoint || 'index.html',
    commit,
    workingTreeClean: !dirty,
    fileCount: files.length,
    digest,
    files
  };
  writeFileSync(join(outDir, 'preview.json'), `${JSON.stringify(meta, null, 2)}\n`);

  if (!quiet) {
    const bytes = files.reduce((sum, f) => sum + statSync(f).size, 0);
    console.log(`built ${outDir}: ${files.length} files, ${(bytes / 1024).toFixed(0)} KB`);
    console.log(`commit ${commit}${dirty ? ' (DIRTY TREE)' : ''}`);
    console.log(`digest ${digest}`);
  }
  return meta;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const meta = build();
  if (!meta.workingTreeClean) {
    console.error('refusing: the working tree is dirty, so the preview cannot be tied to a commit');
    process.exit(1);
  }
}
