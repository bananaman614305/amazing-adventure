// The machine-readable release description. A dashboard "Play" tab can read
// this instead of hard-coding file lists, so the game stays the single source of
// truth for how it is served. Kept pure so a test can hold it to the real files.
import { VERSION, BUILD_NAME, RELEASE_CHANNEL, ENTRY_POINT } from './version.js';

/** Files that must be served for the game to run, relative to the repo root. */
export const REQUIRED_FILES = [
  'index.html',
  'src/version.js',
  'src/manifest.js',
  'src/main.js',
  'src/player.js',
  'src/touch.js',
  'src/perf.js',
  'src/resilience.js',
  'src/world.js',
  'src/areas.js',
  'src/terrain.js',
  'src/npcs.js',
  'src/dialogue.js',
  'src/state.js',
  'src/refusal.js',
  'src/repair.js',
  'src/audio.js',
  'src/epilogue.js',
  'src/announce.js',
  'src/compass.js',
  'src/pathfind.js',
  'src/factions.js',
  'src/ambient.js',
  'src/daynight.js',
  'src/onboard.js',
  'src/glb.js',
  'src/assets.js',
  'assets/fountain.glb',
  'assets/barrel.glb',
  'assets/stall.glb',
  'assets/textures/wood_albedo.png',
  'assets/textures/wood_normal.png',
  'assets/textures/wood_rough.png',
  'assets/textures/brick_albedo.png',
  'assets/textures/brick_normal.png',
  'assets/textures/brick_rough.png',
  'assets/textures/stone_albedo.png',
  'assets/textures/stone_normal.png',
  'assets/textures/stone_rough.png',
  'vendor/three.module.min.js',
  'vendor/THREE-LICENSE.txt'
];

/** Directories and files that are not needed to play. */
export const OMITTED_PREFIXES = [
  'tests/', 'scripts/', 'artifacts/', 'node_modules/', '.git/'
];

export function buildManifest() {
  return {
    name: 'Amazing Adventure',
    version: VERSION,
    build: BUILD_NAME,
    channel: RELEASE_CHANNEL,
    entryPoint: ENTRY_POINT,
    serveRoot: '.',
    buildStep: null,
    requiredFiles: REQUIRED_FILES,
    omittedPrefixes: OMITTED_PREFIXES,
    controls: {
      desktop: 'WASD walk, mouse look, Shift run, E interact, J journal, Esc pause, P adaptive resolution',
      touch: 'left thumb analog stick, right thumb look drag, on-screen Talk/Journal/Pause'
    },
    notes: [
      'Static files only. Serve the repository root over HTTP; ES modules need a directory index.',
      'No runtime dependency on node_modules and no network requests to third-party origins.',
      'Three.js r160 is vendored under vendor/ (MIT).'
    ]
  };
}

/**
 * Checks a manifest against a set of available paths.
 * Returns { ok, missing } so a release step can fail loudly rather than serving
 * a preview that 404s on a source file.
 */
export function verifyManifest(manifest, availablePaths) {
  const available = new Set(availablePaths);
  const missing = manifest.requiredFiles.filter((file) => !available.has(file));
  return { ok: missing.length === 0, missing };
}
