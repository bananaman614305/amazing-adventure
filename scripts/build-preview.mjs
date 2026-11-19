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
  // The preview itself is committed, so regenerating it always shows as a change in
  // dist/. Ignore that when judging whether the *sources* are clean; otherwise the
  // build could never be committed and then verified.
  const dirty = git('status --porcelain -- . ":(exclude)dist"');
  // Two digests, deliberately:
  //  - `sourceDigest` covers only the game files, so it stays the same no matter what
  //    else is in the working tree and can be recomputed later to detect drift
  //    between the committed preview and the sources it claims to be built from.
  //  - `digest` is the identity of the whole preview, used to name a deployment.
  const sourceDigest = buildDigest('.', files);
  const digest = sourceDigest;

  // GitHub Pages runs Jekyll by default, which drops files and directories whose
  // names start with an underscore and can rewrite content. The game has no source
  // files that need it and every byte should be served exactly as built, so opt out
  // with the standard marker. This is the only file added beyond the game itself
  // (plus the metadata below).
  writeFileSync(join(outDir, '.nojekyll'), '');

  const meta = {
    name: MANIFEST.name || 'amazing-adventure',
    version: MANIFEST.version || null,
    build: MANIFEST.build || null,
    entryPoint: MANIFEST.entryPoint || 'index.html',
    // `commit` names the commit whose *sources* this build came from. It cannot name
    // the commit that contains dist/ (a file cannot contain its own hash), so the
    // authoritative identity of the artefact is `sourceDigest`; the drift test
    // compares that, and it never goes stale.
    builtFromCommit: commit,
    workingTreeClean: !dirty,
    fileCount: files.length,
    sourceDigest,
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
