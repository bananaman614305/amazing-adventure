// Writes the release manifest to a JSON file, so a hosting step can consume it
// without parsing the game's source. Run with: node scripts/write-manifest.mjs [out]
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildManifest, verifyManifest } from '../src/manifest.js';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function walk(dir, out = [], skip = new Set(['node_modules', '.git'])) {
  for (const entry of readdirSync(dir)) {
    if (skip.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out, skip);
    else out.push(relative(ROOT, full));
  }
  return out;
}

const out = resolve(process.argv[2] || join(ROOT, 'release-manifest.json'));
const manifest = buildManifest();
const { ok, missing } = verifyManifest(manifest, walk(ROOT));

if (!ok) {
  console.error(`Refusing to write a manifest with missing files: ${missing.join(', ')}`);
  process.exit(1);
}

writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Wrote ${out}`);
console.log(`${manifest.name} v${manifest.version} (${manifest.channel}) entry ${manifest.entryPoint}`);
console.log(`${manifest.requiredFiles.length} required files, all present.`);
