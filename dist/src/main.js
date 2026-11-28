import * as THREE from 'three';
import { buildWorld, applyPhase, KEY_SPOT, KEY_PICKUP_RANGE, floorHeightAt, surfaceHeightAt, TERRACE, STEP_HEIGHT, BENCH } from './world.js';
import { Player } from './player.js';
import { createNPCs, updateNPCs, setNPCRoutine, upgradeNPCs, upgradeCastCloth, upgradeCastSkin, upgradeCastAccent, upgradeCastBoot, upgradeCastPaper, upgradeCastSteel, upgradeCastWood, animateCast, TALK_RANGE } from './npcs.js';
import { welcome } from './onboard.js';
import {
  createInitialState,
  createSaveStore,
  questStatus,
  coins,
  pickUpKey,
  recoverLedger,
  watchLanterns,
  hasItem,
  nightLightUnlocked,
  wicksAtDawn,
  trimWicks,
  tallyUnlocked,
  walkTally,
  journalEntries,
  inventoryItems,
  questCounts
} from './state.js';
import { startConversation, applyChoice, JOB_BOARD_SPEAKER } from './dialogue.js';
import { reputationView, npcTier } from './factions.js';
import {
  GATE, isGateOpen, gateHint, areaAt, NOTICE_BOARD, noticeText, LEDGER_SPOT, JOB_BOARD,
  LANE_LIGHTING_POST, laneLightingStatus, laneLightingHint, laneLanternsShouldGlow,
  laneLanternsAtDawn, lightLaneLanterns, WICKS_SPOT, wicksActive, wicksHint
} from './areas.js';
import {
  chooseAmbientPair,
  buildExchange,
  canOverhear,
  noteExchange,
  AMBIENT_CHANCE
} from './ambient.js';
import { phaseAt, clockLabel, wrapClock, nextPhaseStart, nightFraction } from './daynight.js';
import { loadGlb } from './glb.js';
import { createAdaptiveResolution, MIN_RATIO } from './perf.js';
import { createQualityTier, QUALITY_LOW, QUALITY_FULL } from './quality.js';
import { applyAtmosphere, atmosphereAt } from './atmosphere.js';
import {
  configureRenderer, applyPhaseLook, buildEnvironmentMap, ambientRoomFor, shadowSettings
} from './graphics.js';
import { createRecovery, shouldPanicShed } from './resilience.js';
import { createSoundscape, readPreference, createStepClock, STEP_MIN_SPEED } from './audio.js';
import { WALK_SPEED_EXPORT } from './player.js';
import { buildEpilogue, storyComplete, storyProgress } from './epilogue.js';
import { describeState, questChanges, coinAnnouncement, interactableAnnouncement, areaAnnouncement } from './announce.js';
import { nearbyTargets, routeHint, describeTarget, compassBearing, distancePhrase, sentenceCase } from './compass.js';
import { buildGrid, findPath, pathLength, BOUNDS } from './pathfind.js';
import {
  stickVector, knobOffset, lookDelta, clampPitch, wantsTouchControls,
  interactLabel, STICK_RADIUS
} from './touch.js';
import { onTerrace } from './terrain.js';
import { VERSION, BUILD_NAME, RELEASE_CHANNEL, ENTRY_POINT } from './version.js';
import { buildManifest } from './manifest.js';

// --- DOM ------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const container = $('game');
const overlay = $('overlay');
const playButton = $('play');
const soundToggle = $('sound-toggle');
const endingSection = $('ending-section');
const endingText = $('ending-text');
const endingOpen = $('ending-open');
const epilogueEl = $('epilogue');
const epilogueTitle = $('epilogue-title');
const epilogueOpening = $('epilogue-opening');
const epilogueBranches = $('epilogue-branches');
const epilogueSidework = $('epilogue-sidework');
const epilogueClosers = $('epilogue-closers');
const epilogueClosing = $('epilogue-closing');
const epilogueClose = $('epilogue-close');
const srLive = $('sr-live');
const compassInput = $('compass-input');
const compassResults = $('compass-results');
const compassList = $('compass-list');
const touchDescribe = $('touch-describe');
const touchNearby = $('touch-nearby');
const touchTravel = $('touch-travel');
const compassOptions = $('compass-options');
const srAlert = $('sr-alert');

// --- Guided travel ---------------------------------------------------------
// Walking the player to a place, not just telling them where it is. The route is a
// real A* path around the world's colliders, and it is driven through the same
// movement and collision code a keyboard uses, so a guided walk cannot end up
// inside a wall that manual walking would have stopped at.
let guided = null;

/** Rebuild the navigation grid from the live collider list, gate included. */
function navigationGrid() {
  return buildGrid(player.colliders, { cell: 0.5 });
}

/**
 * Start walking to a named place. Returns a spoken summary, or a refusal. A refusal
 * matters: telling a blind player "cannot get there" is better than walking them
 * into a gate and leaving them confused.
 */
function startGuidedTravel(query) {
  const wanted = String(query || '').trim().toLowerCase();
  if (!wanted) return null;
  const match = compassTargets().find((target) =>
    target.label.toLowerCase().includes(wanted) || target.id.includes(wanted));
  if (!match) {
    announce(`There is nothing called ${query} that I know of.`, { urgent: true });
    return null;
  }
  const grid = navigationGrid();
  const path = findPath(grid, { x: player.position.x, z: player.position.z }, { x: match.x, z: match.z });
  if (!path || path.length < 2) {
    announce(`${match.label[0].toUpperCase()}${match.label.slice(1)} cannot be reached from here.`, { urgent: true });
    return { target: match, path: null };
  }
  guided = { target: match, path, index: 1, grid };
  const length = pathLength(path);
  // Spoken distances are phrases, never numerals -- these are read aloud.
  announce(sentenceCase(`${match.label} is ${distancePhrase(length)}. Walking there now; press G or any movement key to stop.`), { urgent: true });
  return { target: match, path, length };
}

/** Stop guided travel wherever the player has got to. */
function stopGuidedTravel({ announceIt = true } = {}) {
  if (!guided) return false;
  const name = guided.target.label;
  guided = null;
  player.setMoveInput(0, 0);
  if (announceIt) announce(`Stopped. ${name[0].toUpperCase()}${name.slice(1)} is still where it was.`);
  return true;
}

/**
 * Advance guided travel by one frame. Steering is expressed as movement intent in
 * the player's own frame so the existing acceleration, collision and step-height
 * code does all the work.
 */
function updateGuidedTravel() {
  if (!guided) return;
  const path = guided.path;
  // Skip waypoints already reached, so a path with dense corners does not stall.
  while (guided.index < path.length) {
    const waypoint = path[guided.index];
    const dx = waypoint.x - player.position.x;
    const dz = waypoint.z - player.position.z;
    if (Math.hypot(dx, dz) > 0.55) break;
    guided.index += 1;
  }
  if (guided.index >= path.length) {
    const name = guided.target.label;
    guided = null;
    player.setMoveInput(0, 0);
    announce(`You have arrived at ${name}.`, { urgent: true });
    cue('quest');
    return;
  }
  const waypoint = path[guided.index];
  // Turn to face the waypoint, then walk forward. Setting yaw keeps the camera,
  // and therefore the player's own sense of direction, consistent with travel.
  player.yaw = Math.atan2(-(waypoint.x - player.position.x), -(waypoint.z - player.position.z));
  player.setMoveInput(1, 0);
}

// --- The spoken compass ----------------------------------------------------
// The world's walkable places, as coordinates. Built fresh on each use so an NPC
// is reported where they actually are at this hour, not where they spawned.
function compassTargets() {
  const targets = [
    { id: 'fountain', label: 'the fountain', x: 0, z: 0 },
    { id: 'gate', label: 'the north gate', x: GATE.x, z: GATE.z },
    { id: 'bench', label: 'the bench', x: BENCH.x, z: BENCH.z },
    { id: 'ledger', label: 'the ledger spot', x: LEDGER_SPOT.x, z: LEDGER_SPOT.z },
    { id: 'jobboard', label: 'the job board', x: JOB_BOARD.x, z: JOB_BOARD.z },
    { id: 'noticeboard', label: 'the notice board', x: NOTICE_BOARD.x, z: NOTICE_BOARD.z },
    { id: 'key', label: 'the place the key was lost', x: KEY_SPOT.x, z: KEY_SPOT.z }
  ];
  for (const npc of npcs) {
    targets.push({
      id: npc.id,
      label: npc.name,
      x: npc.group.position.x,
      z: npc.group.position.z
    });
  }
  return targets;
}

/** Where the player is and which way they face, as the compass needs it. */
function compassOrigin() {
  return { from: { x: player.position.x, z: player.position.z }, yaw: player.yaw };
}

/** Speak the nearest things worth walking to. */
function announceNearby(count = 4) {
  const { from, yaw } = compassOrigin();
  const list = nearbyTargets(yaw, from, compassTargets(), count);
  if (!list.length) {
    announce('Nothing marked is close by.');
    return [];
  }
  announce(list.map((entry) => entry.phrase).join(' '));
  return list;
}

/** Speak the way to one named thing, which is what a stuck player actually needs. */
function announceRouteTo(query) {
  const { from, yaw } = compassOrigin();
  const wanted = String(query || '').trim().toLowerCase();
  if (!wanted) return null;
  const match = compassTargets().find((target) =>
    target.label.toLowerCase().includes(wanted) || target.id.includes(wanted));
  if (!match) {
    announce(`There is nothing called ${query} that I know of.`, { urgent: true });
    return null;
  }
  announce(routeHint(yaw, from, match) || `${match.label} is right where you are.`, { urgent: true });
  return match;
}

// --- Screen-reader announcements -----------------------------------------
// The game is first-person and drawn to a canvas, so nearly everything it
// communicates is invisible to assistive technology. These helpers put the same
// facts into live regions. `polite` for ordinary progress, `assertive` for things
// the player must not miss.
let lastAnnouncedArea = null;
let lastAnnouncedInteractable = null;

// Quiet announcements are queued rather than set immediately. Setting the region
// directly meant a "quest complete" could be replaced a frame later by a passing
// "you can talk to Mara", and the player would never hear the thing that mattered.
const politeQueue = [];
let politeBusy = false;

function announce(text, { urgent = false } = {}) {
  if (!text) return;
  if (urgent) {
    // Urgent beats the queue: clearing and re-setting lets a repeated message
    // re-announce instead of being treated as unchanged text.
    srAlert.textContent = '';
    requestAnimationFrame(() => { srAlert.textContent = text; });
    return;
  }
  // Do not queue the same sentence twice: a player who walks back and forth past
  // the same bench should not hear it repeated every time.
  if (politeQueue[politeQueue.length - 1] !== text) politeQueue.push(text);
  if (!politeBusy) drainPoliteQueue();
}

function drainPoliteQueue() {
  const next = politeQueue.shift();
  if (next === undefined) { politeBusy = false; return; }
  politeBusy = true;
  srLive.textContent = '';
  requestAnimationFrame(() => {
    srLive.textContent = next;
    // Give the reader time to speak it before the next one replaces it.
    setTimeout(drainPoliteQueue, 1200);
  });
}

function announceArea(areaId) {
  if (areaId === lastAnnouncedArea) return;
  lastAnnouncedArea = areaId;
  announce(areaAnnouncement(state, areaId));
}

function announceInteractable(interactable) {
  const label = interactable ? interactable.label : null;
  if (label === lastAnnouncedInteractable) return;
  lastAnnouncedInteractable = label;
  if (label) announce(interactableAnnouncement(interactable));
}

// Quest and coin changes are announced by diffing the state around a mutating
// action, because those are the only places progression actually happens.
function withAnnouncements(mutate) {
  const before = snapshotForAnnouncements();
  const result = mutate();
  const after = snapshotForAnnouncements();
  for (const change of questChanges(before, after)) {
    announce(change.text, { urgent: change.kind === 'done' });
  }
  const coins = coinAnnouncement(before, after);
  if (coins) announce(coins);
  return result;
}

/** Just the parts of state announcements care about, copied so they cannot change under us. */
function snapshotForAnnouncements() {
  return {
    quests: { ...state.quests },
    flags: { ...state.flags }
  };
}
const continueButton = $('continue');
const saveNote = $('save-note');
const crosshair = $('crosshair');
const hint = $('hint');
const clockEl = $('clock');
const clockTime = $('clock-time');
const clockPhase = $('clock-phase');
const coinCount = $('coin-count');
const tracker = $('quest-tracker');
const questList = $('quest-list');
const panel = $('panel');
const inventoryList = $('inventory-list');
const journalList = $('journal-list');
const standingList = $('standing-list');
const overheardEl = $('overheard');
const overheardLines = $('overheard-lines');
const toastStack = $('toast-stack');
const dialogueEl = $('dialogue');
const dialogueName = $('dialogue-name');
const dialogueRole = $('dialogue-role');
const dialogueLine = $('dialogue-line');
const dialogueChoices = $('dialogue-choices');
const dialogueClose = $('dialogue-close');
const touchRoot = $('touch');
const stickZone = $('stick-zone');
const stickBase = $('stick-base');
const stickKnob = $('stick-knob');
const lookZone = $('look-zone');
const touchInteract = $('touch-interact');
const touchJournal = $('touch-journal');
const touchPauseButton = $('touch-pause-button');
const touchPause = $('touch-pause');
const touchResume = $('touch-resume');
const touchSave = $('touch-save');
const contextLostEl = $('context-lost');
const contextLostMessage = $('context-lost-message');
const contextLostReload = $('context-lost-reload');

// --- World, player, state -------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
// Three's WebGLProgram does `getProgramInfoLog(...).trim()` before it checks
// the link status, but a null log is legal: the spec allows it for a program
// with no diagnostics, WebGL hands it back for programs created while the
// context is lost, and for stale programs after a context restore. Without
// this shim the `.trim()` on null throws
// `TypeError: Cannot read properties of null (reading 'trim')` and kills the
// render loop for good: without it, a phone that dropped its context under
// memory pressure showed the recovery sheet and then never recovered, even
// after the browser handed the context back. Return '' for null
// unconditionally: a program with no log is indistinguishable from one whose
// log is empty, and three treats an empty log as "nothing to print".
const gl = renderer.getContext();
const rawProgramInfoLog = gl.getProgramInfoLog.bind(gl);
gl.getProgramInfoLog = (program) => {
  const log = rawProgramInfoLog(program);
  return log === null ? '' : log;
};
const rawShaderInfoLog = gl.getShaderInfoLog.bind(gl);
gl.getShaderInfoLog = (shader) => {
  const log = rawShaderInfoLog(shader);
  return log === null ? '' : log;
};
const basePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(basePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);

// Resolution scales down automatically when frames are slow. That is what keeps
// the game playable on weak hardware, where it is fill-rate bound rather than
// draw-call bound (measured: shadows and materials barely matter, pixel count
// matters a lot). The setting is remembered so a choice sticks.
const RESOLUTION_KEY = 'amazing-adventure:resolution';
const resolution = createAdaptiveResolution({ start: basePixelRatio });
let adaptiveResolution = localStorage.getItem(RESOLUTION_KEY) !== 'fixed';
function applyResolution(ratio) {
  const next = Number(ratio.toFixed(2));
  if (renderer.getPixelRatio() === next) return;
  renderer.setPixelRatio(next);
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.dataset.pixelRatio = String(next);
}
applyResolution(resolution.ratio);
document.body.dataset.pixelRatio = String(resolution.ratio);
// Quality is the second lever, used only once resolution has reached its floor
// and frames are still badly slow. Measured on a Pixel 7 profile: resolution
// dominates (2.5 -> 10.5 fps from ratio 2 to 0.5), shadows and point lights are
// worth ~1.4x and ~1.3x on top. The choice is remembered like resolution's.
const QUALITY_KEY = 'amazing-adventure:quality';
const savedQuality = localStorage.getItem(QUALITY_KEY);
const quality = createQualityTier({ start: savedQuality === QUALITY_LOW ? QUALITY_LOW : QUALITY_FULL });
let adaptiveQuality = savedQuality !== 'fixed';
function applyQuality(tier) {
  if (environment.quality === tier) return;
  environment.setQuality(tier);
  document.body.dataset.quality = tier;
}
document.body.dataset.quality = quality.tier;

renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Film tone curve, explicit sRGB output and a per-phase exposure. Without this
// the scene renders linear-to-canvas: highlights clip to flat white and night
// is unreadably dark. See src/graphics.js for the reasoning and the tables.
configureRenderer(renderer, THREE);
// The canvas is where play happens and where focus returns after a conversation
// closes, so it has to be able to hold focus. It is not in the tab order (a keyboard
// user reaches the game through the Play button) but programmatic focus needs it
// to be focusable at all.
renderer.domElement.tabIndex = -1;
container.appendChild(renderer.domElement);

// --- Sound ---------------------------------------------------------------
// Synthesised, so there is nothing to download. Browsers refuse to start audio
// without a gesture, so start() is called from the play/tap handlers below.
const stepClock = createStepClock({ stride: 1.35, minSpeed: STEP_MIN_SPEED });
const sound = createSoundscape({
  AudioContextClass: window.AudioContext || window.webkitAudioContext,
  preference: readPreference((key) => localStorage.getItem(key)),
  persist: (key, value) => localStorage.setItem(key, value)
});
function cue(name) {
  // Never let a sound problem surface as a game error, but do report whether a
  // cue actually played so tests are not left asserting on nothing.
  try { return sound.play(name); } catch { return false; }
}
function syncSoundToggle() {
  const muted = !sound.enabled;
  soundToggle.textContent = muted ? '♪̸' : '♪';
  soundToggle.classList.toggle('muted', muted);
  soundToggle.setAttribute('aria-pressed', String(!muted));
  soundToggle.title = muted ? 'Sound off (M)' : 'Sound on (M)';
}
syncSoundToggle();
soundToggle.addEventListener('click', (event) => {
  event.stopPropagation();
  // The first press is also a valid gesture to open the audio context.
  sound.start();
  sound.toggle();
  syncSoundToggle();
  if (sound.enabled) cue('choose');
});

// --- Graphics context loss -----------------------------------------------
// Phones drop the WebGL context when the tab is backgrounded under memory
// pressure or the GPU process restarts. Three.js cannot recover on its own, so
// without this the canvas stays blank forever with no explanation.
const recovery = createRecovery();
let contextWatchdog = 0;

function showContextLost(show) {
  contextLostEl.hidden = !show;
  if (show && recovery.message()) contextLostMessage.textContent = recovery.message();
}

renderer.domElement.addEventListener('webglcontextlost', (event) => {
  // Preventing the default is what lets the browser hand the context back.
  event.preventDefault();
  if (!recovery.begin('webglcontextlost')) return;
  showContextLost(true);
  // Saving here is deliberate: the save data is plain JSON and the player
  // should never lose progress to a renderer fault.
  saveGame();
  clearTimeout(contextWatchdog);
  contextWatchdog = setTimeout(() => {
    if (!recovery.lost) return;
    contextLostMessage.textContent =
      'The graphics context could not be restored. Reload to carry on where you left off.';
  }, recovery.timeoutMs);
});

renderer.domElement.addEventListener('webglcontextrestored', () => {
  clearTimeout(contextWatchdog);
  recovery.restored();
  showContextLost(false);
  toast('Restored.');
});

// A reload is the only guaranteed way back once the context is gone, and the
// save made at the moment of loss is what makes that safe.
contextLostReload.addEventListener('click', () => {
  window.location.reload();
});

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 200);
const world = buildWorld(renderer);
const { scene, colliders, environment } = world;

// Procedural image-based lighting. A gradient room built from the current sky
// and ground colours is prefiltered into a PMREM and set as scene.environment,
// so every standard material picks up real ambient specular and a directional
// ambient tint. The sky colour is what the ambient light should agree with, so
// the map follows the phase.
//
// The build is deliberately NOT done on the phase-change path. PMREM prefiltering
// is real GPU work - on a weak phone it is tens of milliseconds, and on a
// software rasteriser far worse - and paying it synchronously in the frame that
// also repaints the sky is how a lighting upgrade becomes a stutter at every
// dusk. Instead the phase change records which map is wanted and the work is
// scheduled for the next idle moment; the scene renders immediately with the
// hemisphere light and picks the map up a frame or two later. Maps are cached
// per phase, so a full day/night cycle builds at most three and every later
// cycle reuses them.
const envMaps = new Map();
let pendingEnvPhase = null;
let envMapScheduled = false;
let envMapsBuilt = 0;
let resolveEnvMapReady;
const envMapReady = new Promise((resolve) => { resolveEnvMapReady = resolve; });

function environmentRoom(phaseId) {
  const look = environment.phaseLook?.(phaseId);
  if (!look) return null;
  return ambientRoomFor(look.zenith ?? look.sky, look.sky, look.hemiGround ?? 0x5d5340);
}

function buildPendingEnvironmentMap() {
  envMapScheduled = false;
  const phaseId = pendingEnvPhase;
  if (!phaseId) return null;
  pendingEnvPhase = null;
  let texture = envMaps.get(phaseId) || null;
  if (!texture) {
    const room = environmentRoom(phaseId);
    if (!room) return null;
    texture = buildEnvironmentMap(renderer, THREE, room);
    // A failed build is not cached: a later phase change on a recovered context
    // should be allowed to try again rather than be stuck without ambient.
    if (!texture) return null;
    envMaps.set(phaseId, texture);
    envMapsBuilt += 1;
  }
  // The current phase may have moved on while the build was queued; in that
  // case the lighting still wants the phase we just built for, so only swap in
  // the map when it matches what the sky is showing now.
  if (currentPhase === phaseId) {
    scene.environment = texture;
    applyPhaseLook(renderer, scene, phaseId);
  }
  resolveEnvMapReady?.(envMapsBuilt);
  return texture;
}

/** Queues the current phase's map for the next idle slot, at most once. */
function scheduleEnvironmentMap(phaseId) {
  pendingEnvPhase = phaseId;
  if (envMapScheduled) return;
  envMapScheduled = true;
  // requestIdleCallback is not available everywhere; a zero-delay timeout does
  // the same job of getting off the phase-change frame.
  //
  // The deadline is not optional. A plain requestIdleCallback waits for the
  // browser to report an idle period, and the continuous requestAnimationFrame
  // loop means that never happens: measured on this build, a bare callback was
  // still unfulfilled after 8 s and the environment map was never built in
  // play, so every metal, glass and water surface went unreflected. A 1 s
  // deadline guarantees the build a slot without pulling PMREM work into the
  // frame that repaints the sky.
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 0));
  idle(() => buildPendingEnvironmentMap(), { timeout: 1000 });
}

// The idle queue alone is not enough for the opening seconds of play: even a
// deadline can land a second in, and the first view of the plaza is the one a
// player judges. So once the first frame has been rendered -- the shaders are
// compiled and the cost of one more task is no longer on the critical path --
// the current phase's map is built on a zero-delay timeout if it is still
// missing. Both paths funnel through buildPendingEnvironmentMap, which caches
// per phase and clears pendingEnvPhase, so whichever runs first wins and the
// other is a no-op; nothing can build twice.
let firstFrameRendered = false;
function ensureFirstEnvironmentMap() {
  if (envMapsBuilt > 0) return;
  if (!pendingEnvPhase) pendingEnvPhase = currentPhase;
  setTimeout(() => {
    if (envMapsBuilt === 0) buildPendingEnvironmentMap();
  }, 0);
}
const npcs = createNPCs(scene);
// Upgrade the cast from procedural figures to the modelled rigs in the
// background, the same way the plaza props upgrade. Resolves to a count, so
// tests can tell the truth about which mode actually rendered.
//
// Round 67: the modelled coats are dressed with the neutral cloth maps right
// after the rigs swap in. It is chained onto `castReady` (not awaited earlier)
// because the cloth pass needs the modelled meshes to exist, and because
// awaiting `castReady` is already the documented settle point for tests and
// evidence scripts -- so a dress result is visible exactly where a caller
// expects the cast to be final. A failed cloth download leaves the coats flat
// painted, which is the same coat colour the cast shipped with before. Round 76
// chains the skin and hair pass after it on the same promise, for the same
// reason: a caller that awaited `castReady` sees the fully dressed cast.
const castReady = upgradeNPCs(npcs, { THREE, loadGlb })
  .then((summary) => {
    // Round 76: the faces and hair are dressed after the coats. The three passes
    // are independent downloads, but they are sequenced through one promise so
    // `await castReady` remains the single settle point tests and evidence rely
    // on. A failure in any one leaves that family flat and the others dressed.
    return upgradeCastCloth(npcs, { THREE })
      .then((cloth) => Object.assign(summary, { cloth }))
      .catch((error) => Object.assign(summary, { cloth: { dressed: 0, reason: String(error) } }))
      .then(() => upgradeCastSkin(npcs, { THREE }))
      .then((skin) => Object.assign(summary, { skin }))
      .catch((error) => Object.assign(summary, { skin: { dressed: 0, reason: String(error) } }))
      .then(() => upgradeCastAccent(npcs, { THREE }))
      .then((accent) => Object.assign(summary, { accent }))
      .catch((error) => Object.assign(summary, { accent: { dressed: 0, reason: String(error) } }))
      // Round 82: boots last, for the same settle-point reason.
      .then(() => upgradeCastBoot(npcs, { THREE }))
      .then((boot) => Object.assign(summary, { boot }))
      .catch((error) => Object.assign(summary, { boot: { dressed: 0, reason: String(error) } }))
      // Round 84: the cast's paper props (Oswin's apron, Wren's ledger pages),
      // after boots on the same chain so `await castReady` still sees the
      // fully dressed cast.
      .then(() => upgradeCastPaper(npcs, { THREE }))
      .then((paper) => Object.assign(summary, { paper }))
      .catch((error) => Object.assign(summary, { paper: { dressed: 0, reason: String(error) } }))
      // Round 110: the cast's armour (halden's helmet, nasal, pauldrons and
      // spear tip) picks up the lamp metal normal + roughness maps.
      .then(() => upgradeCastSteel(npcs, { THREE }))
      .then((steel) => Object.assign(summary, { steel }))
      .catch((error) => Object.assign(summary, { steel: { dressed: 0, reason: String(error) } }))
      // Round 111: the cast's carried timber (mara's pole, pip's hoop, halden's
      // spear shaft, wren's ledger board) picks up the crate plank maps.
      .then(() => upgradeCastWood(npcs, { THREE }))
      .then((wood) => Object.assign(summary, { wood }))
      .catch((error) => Object.assign(summary, { wood: { dressed: 0, reason: String(error) } }));
  })
  .catch((error) => {
    return { loaded: 0, total: npcs.length, mode: 'boxes', reason: String(error) };
  });

// Start the optional asset upgrade in the background. It is deliberately not
// awaited: the plaza is fully playable with the procedural stand-ins, and making
// the first frame wait on a network round trip would cost more than the upgrade
// is worth. `assetsReady` exists so tests can await the settle point instead of
// sleeping and hoping.
const assetsReady = environment.loadAssets().catch((error) => {
  // loadAssets is written not to reject; if it ever does, record it rather than
  // letting an unhandled rejection surface as a console error in the browser.
  return { fountain: 'stand-in', plazaFloor: 'flat', terrace: 'flat', fountainDetail: String(error) };
});

const saves = createSaveStore();
let state = createInitialState();
let started = false;

// --- Clock ---------------------------------------------------------------
let clockSeconds = 8; // start a little into the day
let currentPhase = null;

function syncPhase(force = false) {
  const phase = phaseAt(clockSeconds);
  if (phase.id === currentPhase && !force) return;
  currentPhase = phase.id;
  // Dawn puts the lane lanterns out: the round is walked again each night, so a
  // previous night's help cannot light tonight's lane for free. The wick
  // round's act is dusk-scoped the same way, so dawn clears its walk.
  const dawn = laneLanternsAtDawn(state, phase.id);
  const wicksDawn = wicksAtDawn(state, phase.id);
  applyPhase(environment, phase.id, laneLanternsShouldGlow(state, phase.id));
  // Exposure follows the same phase as the sky and sun, so the tone curve can
  // never disagree with the lighting it is exposing. The environment map is
  // queued rather than built here: see scheduleEnvironmentMap above.
  applyPhaseLook(renderer, scene, phase.id);
  scheduleEnvironmentMap(phase.id);
  // Install the curve value for this instant as well: applyPhase() wrote the
  // phase constant, and a harness that jumps the clock then reads the fog in
  // the same tick should see the blended value, not the constant.
  applyAtmosphere(environment, clockSeconds);
  // Round 93: the lit windows need the clock, not just the phase, because a
  // bedtime falls inside a phase. syncPhase() is what a harness's setClock()
  // runs, so refining here makes a forced clock paint the right village at once
  // rather than waiting for the next frame.
  if (environment.updateWindows) environment.updateWindows(nightFraction(clockSeconds));
  if (environment.paintWindowSpill) environment.paintWindowSpill(environment.phase, nightFraction(clockSeconds));
  if (environment.paintWindowBleed) environment.paintWindowBleed(environment.phase, nightFraction(clockSeconds));
  if (environment.paintRoomGlow) environment.paintRoomGlow(environment.phase, nightFraction(clockSeconds));
  if (environment.paintWetStreak) environment.paintWetStreak(environment.phase, nightFraction(clockSeconds));
  if (environment.paintLampHalo) environment.paintLampHalo(environment.phase, nightFraction(clockSeconds));
  if (environment.paintMoonHalo) environment.paintMoonHalo(environment.phase, nightFraction(clockSeconds));
  setNPCRoutine(npcs, phase.id);
  clockPhase.textContent = phase.label;
  // The drone shifts root and level with the time of day.
  sound.setPhase(phase.id);
  if (started && phase.id === 'dusk') {
    toast(laneLanternsShouldGlow(state, phase.id)
      ? 'Dusk. The lane lanterns are burning.'
      : 'Dusk. The plaza lamps are lit; the lane lanterns are still dark.');
  } else if (started && (dawn.reset || wicksDawn.reset)) {
    toast(dawn.reset ? dawn.message : 'Dawn. The plaza lanterns are out; the wick round is walked for tonight.');
  }
}

// --- Player --------------------------------------------------------------
const player = new Player(camera, colliders, {
  floorHeight: floorHeightAt,
  stepHeight: STEP_HEIGHT,
  onLock: () => {
    overlay.hidden = true;
    for (const el of [crosshair, hint, clockEl, tracker]) el.hidden = false;
    if (touchState.active) {
      // No pointer lock on a phone, so show the touch HUD instead of the
      // mouse crosshair and keyboard hint.
      crosshair.hidden = true;
      hint.hidden = true;
      touchRoot.hidden = false;
    }
    refreshHUD();
    refreshTouchInteract();
  },
  onUnlock: () => {
    crosshair.hidden = true;
    if (!dialogueEl.hidden) closeDialogue();
    overlay.hidden = false;
    playButton.textContent = started ? 'Click to resume' : 'Click to play';
    if (started) saveGame();
  }
});

// --- HUD -----------------------------------------------------------------
function toast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  toastStack.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function syncGate() {
  const open = isGateOpen(state);
  environment.setGateOpen(open);
  return open;
}

function refreshHUD() {
  clockTime.textContent = clockLabel(clockSeconds);
  coinCount.textContent = String(coins(state));
  // The gate is derived from quest state, so every HUD refresh re-applies it.
  // setGateOpen is idempotent, which keeps this safe to call often.
  syncGate();

  const entries = journalEntries(state);
  const counts = questCounts(state);
  if (entries.length === 0) {
    questList.innerHTML = '<p class="empty">No quests yet. Talk to the people in the plaza.</p>';
    tracker.hidden = !started;
  } else {
    questList.innerHTML = entries
      .map((entry) => `<div class="quest${entry.done ? ' done' : ''}">
        <div class="title">${entry.done ? '✓ ' : '· '}${escapeHtml(entry.title)}</div>
        <div class="text">${escapeHtml(entry.text)}</div>
      </div>`)
      .join('');
    tracker.hidden = !started;
  }
  questList.dataset.active = String(counts.active);
  questList.dataset.done = String(counts.done);

  inventoryList.innerHTML = inventoryItems(state).length
    ? inventoryItems(state)
        .map((item) => `<li><span class="item-name">${escapeHtml(item.name)}</span><br>${escapeHtml(item.description)}</li>`)
        .join('')
    : '<li class="muted">Nothing yet.</li>';
  journalList.innerHTML = entries.length
    ? entries
        .map((entry) => `<li><span class="journal-title${entry.done ? ' done' : ''}">${escapeHtml(entry.title)}</span><br>${escapeHtml(entry.text)}</li>`)
        .join('')
    : '<li class="muted">No quests started.</li>';

  standingList.innerHTML = reputationView(state)
    .map((faction) => `<li class="standing-row">
      <span class="standing-name">${escapeHtml(faction.name)}</span>
      <span class="standing-tier tier-${faction.tier}">${escapeHtml(faction.tierName)}${
        faction.score === 0 ? '' : ` ${faction.score > 0 ? '+' : ''}${faction.score}`
      }</span>
    </li>`)
    .join('');
  standingList.dataset.tiers = reputationView(state).map((f) => f.tier).join(',');

  // The compass panel. Derived from the same function the spoken compass uses, so
  // the written list and the spoken directions can never disagree.
  const { from, yaw } = compassOrigin();
  const headings = nearbyTargets(yaw, from, compassTargets(), 6);
  compassList.innerHTML = headings.length
    ? headings
        .map((entry) => `<li><span>${escapeHtml(entry.label)}</span><span class="compass-bearing">${
          escapeHtml(entry.relative)} · ${escapeHtml(entry.bearing)}</span></li>`)
        .join('')
    : '<li class="muted">Nothing marked nearby.</li>';
  if (compassOptions) {
    compassOptions.innerHTML = compassTargets()
      .map((target) => `<option value="${escapeHtml(target.label)}"></option>`)
      .join('');
  }

  // The ending. Shown only when every quest is finished, and read out once as an
  // overlay so a player who completes the story is actually told they finished it
  // rather than being left in silence.
  const progress = storyProgress(state);
  const epilogue = buildEpilogue(state);
  endingSection.hidden = !progress.complete;
  if (progress.complete) {
    endingText.textContent = `All ${progress.total} errands are done. There is nothing left that the plaza needs from you.`;
  }
  if (epilogue && !endingSeen) {
    endingSeen = true;
    showEpilogue(epilogue);
  }
}

// Set once per session so the ending does not reappear every HUD refresh, but a
// player can always reopen it from the journal with the button.
let endingSeen = false;

function showEpilogue(epilogue) {
  epilogueTitle.textContent = epilogue.title;
  epilogueOpening.textContent = epilogue.opening;
  const branchHtml = epilogue.branches
    .map((branch) => `<p class="epilogue-line">${escapeHtml(branch.text)}</p>`)
    .join('');
  // If the save has no record of the choices made, say so rather than presenting
  // a shorter ending as if it were the whole story.
  epilogueBranches.innerHTML = epilogue.branchesUnrecorded
    ? `${branchHtml}<p class="epilogue-line">Some of what you did here was not written down, and the record of it is gone.</p>`
    : branchHtml;
  // The late faction chores sit outside the main quest list, so they get their
  // own block. It stays empty (no heading, no blank space) for a player who
  // never took them, and never claims a chore that was only half-walked.
  epilogueSidework.innerHTML = (epilogue.sidework || [])
    .map((line) => `<p class="epilogue-line">${escapeHtml(line.text)}</p>`)
    .join('');
  epilogueSidework.hidden = epilogueSidework.innerHTML === '';
  epilogueClosers.innerHTML = epilogue.closers
    .map((closer) => `<p class="epilogue-standing"><strong>${escapeHtml(closer.name)}.</strong> ${escapeHtml(closer.text)}</p>`)
    .join('');
  epilogueClosing.textContent = epilogue.closing;
  epilogueEl.hidden = false;
  cue('quest');
}

function closeEpilogue() {
  epilogueEl.hidden = true;
}

// The "walk to" box is the written form of the same spoken command. Typing a place
// and pressing enter reports the route in the panel and out loud.
function runCompassQuery() {
  const query = compassInput.value.trim();
  if (!query) return;
  const { from, yaw } = compassOrigin();
  const wanted = query.toLowerCase();
  const match = compassTargets().find((target) =>
    target.label.toLowerCase().includes(wanted) || target.id.includes(wanted));
  if (!match) {
    compassResults.textContent = `Nothing called “${query}” is known.`;
    announce(`There is nothing called ${query} that I know of.`, { urgent: true });
    return;
  }
  const described = describeTarget(yaw, from, match);
  compassResults.textContent = described.phrase;
  announce(described.phrase, { urgent: true });
}

compassInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  event.stopPropagation();
  runCompassQuery();
});
compassInput.addEventListener('change', () => {
  compassResults.textContent = '';
});

endingOpen.addEventListener('click', () => {
  const epilogue = buildEpilogue(state);
  if (epilogue) showEpilogue(epilogue);
});
epilogueClose.addEventListener('click', closeEpilogue);

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

// --- Dialogue ------------------------------------------------------------
let activeNPC = null;
let activeNode = null;
// Which choice the keyboard is pointing at. E/Enter/click all go through
// choose(); W/S or arrow keys move the highlight.
let choiceIndex = 0;

function openDialogue(npc) {
  activeNPC = npc;
  // The work board is a notice, not a person: it reuses the dialogue UI but has
  // no memory, so it provides its own opening node.
  activeNode = npc.talk ? npc.talk(state) : startConversation(state, npc.id);
  if (!activeNode) return;
  dialogueEl.hidden = false;
  touchRoot.classList.add('dialogue-open');
  hint.hidden = true;
  // Stand still while talking: no walking away mid-sentence.
  player.frozen = true;
  choiceIndex = 0;
  renderNode();
  // Move focus into the dialog. The panel declares aria-modal, which tells assistive
  // tech that everything outside it is inert -- but that is only true if focus is
  // actually inside. It used to stay on <body>, so a screen reader user was told the
  // dialog existed and then left with no way to reach its choices. tabindex="-1"
  // makes the panel itself focusable without adding it to the tab order.
  dialogueEl.focus({ preventScroll: true });
  cue('talk');
}

function renderNode() {
  if (!activeNode) return closeDialogue();
  dialogueName.textContent = activeNode.speaker || activeNPC?.name || '';
  dialogueRole.textContent = activeNPC?.role || '';
  dialogueLine.textContent = activeNode.text;
  dialogueChoices.innerHTML = '';
  dialogueChoices.setAttribute('role', 'radiogroup');
  dialogueChoices.setAttribute('aria-label', 'Replies');
  choiceIndex = Math.max(0, Math.min(choiceIndex, (activeNode.choices?.length || 1) - 1));

  const choices = activeNode.choices?.length ? activeNode.choices : [{ label: 'Leave', end: true }];

  // Speak the line and the options. The dialogue panel is a role=dialog, so a
  // screen reader reads it on focus, but the options are rebuilt every node and
  // are not otherwise announced.
  const speaker = activeNode.speaker || activeNPC?.name || '';
  const options = choices.map((choice, index) => `${index + 1}. ${choice.label}`).join('. ');
  announce(`${speaker ? speaker + ': ' : ''}${activeNode.text} ${options}`, { urgent: true });

  choices.forEach((choice, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice';
    button.dataset.index = String(index);
    button.innerHTML = `<span class="num" aria-hidden="true">${index + 1}</span>${escapeHtml(choice.label)}`;
    // The visible digit is a key hint, not part of the sentence. Left in the
    // accessible name it ran straight into the label -- a screen reader said
    // "two-who are you" -- so it is hidden from assistive tech and spelled out
    // properly instead. "Choice 2 of 3" tells the reader where they are; the key
    // itself is covered by the footer hint and the aria-keyshortcuts attribute.
    button.setAttribute('aria-label', `Choice ${index + 1} of ${choices.length}: ${choice.label}`);
    button.setAttribute('aria-keyshortcuts', String(index + 1));
    // The options behave as a single-choice set: W/S move the highlight, E confirms.
    // role=radio with aria-checked is the pattern Chrome actually exposes in the
    // accessibility tree (verified against the CDP AX tree: aria-selected on a plain
    // button and aria-current are both dropped, while radio/checked survives). Without
    // it the keyboard highlight was invisible to a screen reader.
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(index === choiceIndex));
    // The pointer is normally locked, so this click is a convenience for
    // players who pause first; keyboard selection is the primary path.
    button.addEventListener('click', (event) => {
      event.preventDefault();
      choiceIndex = index;
      choose(index);
    });
    dialogueChoices.appendChild(button);
  });
  highlightChoice();
}

/** Marks the keyboard-selected choice and scrolls it into view. */
function highlightChoice() {
  const buttons = dialogueChoices.querySelectorAll('.choice');
  buttons.forEach((button, index) => {
    button.classList.toggle('selected', index === choiceIndex);
    // aria-selected is only valid on certain roles and was ignored on a plain
    // <button>: the AX tree exposed no state at all, so the keyboard highlight
    // was invisible to a screen reader. aria-current is honoured on any element.
    button.setAttribute('aria-checked', String(index === choiceIndex));
    if (index === choiceIndex) button.scrollIntoView({ block: 'nearest' });
  });
}

/** Moves the keyboard highlight by `delta`, wrapping at both ends. */
function moveChoice(delta) {
  const count = dialogueChoices.querySelectorAll('.choice').length;
  if (count === 0) return;
  choiceIndex = (choiceIndex + delta + count) % count;
  highlightChoice();
}

function choose(index) {
  if (!activeNode || !activeNPC) return;
  const choices = activeNode.choices?.length ? activeNode.choices : [{ label: 'Leave', end: true }];
  const choice = choices[index];
  if (!choice) return;

  const npcId = activeNPC.id;
  // Wrapping the mutation is what makes quest and coin changes audible. It is
  // the only place in the game where progression actually happens.
  const result = withAnnouncements(() => applyChoice(state, npcId, choice));
  // Odd jobs take a stretch of the day, and only this side owns the clock.
  if (result.advanceTime) {
    clockSeconds = nextPhaseStart(clockSeconds);
    syncPhase(true);
  }
  // Distinct sounds for the outcomes a player can tell apart: a refusal, a quest
  // finishing, a job done, and an ordinary acknowledgement.
  if (!result.changed && /nothing for you|will not|need \d+ coins|not deal/i.test(result.message || '')) {
    cue('refuse');
  } else if (result.changed && /Quest (started|complete)/.test(result.message || '')) {
    cue('quest');
  } else if (result.changed && /Reputation:/.test(result.message || '')) {
    cue('work');
  } else {
    cue('choose');
  }

  if (result.changed) {
    toast(result.message);
    // The toast carries real information and vanishes after three seconds; put
    // the same sentence into the live region so it is not lost.
    announce(result.message);
    refreshHUD();
    autoSave();
  }

  if (choice.end) return closeDialogue();
  const next = typeof choice.next === 'function' ? choice.next() : choice.next;
  if (!next) return closeDialogue();
  activeNode = next;
  choiceIndex = 0;
  renderNode();
}

function closeDialogue() {
  const hadFocus = dialogueEl.contains(document.activeElement);
  dialogueEl.hidden = true;
  touchRoot.classList.remove('dialogue-open');
  activeNode = null;
  activeNPC = null;
  player.frozen = false;
  hint.hidden = !player.enabled;
  // Hand focus back rather than leaving it on a hidden element, where keystrokes go
  // nowhere. The canvas is the game, so that is where it belongs.
  if (hadFocus) renderer.domElement?.focus?.({ preventScroll: true });
  else document.activeElement?.blur?.();
  cue('close');
}

// --- Interactables -------------------------------------------------------
// One list drives the hint, the crosshair and the E key: NPCs, the key pickup
// and the bench all answer to the same interaction.
function interactables() {
  const list = [];
  for (const npc of npcs) {
    const distance = Math.hypot(
      npc.group.position.x - player.position.x,
      npc.group.position.z - player.position.z
    );
    if (distance < TALK_RANGE) {
      list.push({
        kind: 'npc',
        npc,
        distance,
        label: `talk to ${npc.name}`,
        run: () => openDialogue(npc)
      });
    }
  }

  if (environment.ledgerGroup.visible) {
    const distance = Math.hypot(LEDGER_SPOT.x - player.position.x, LEDGER_SPOT.z - player.position.z);
    if (distance < LEDGER_SPOT.range) {
      list.push({
        kind: 'ledger',
        distance,
        label: 'take the toll ledger',
        run: () => {
          const result = recoverLedger(state);
          toast(result.message);
          if (result.changed) {
            refreshHUD();
            autoSave();
          }
        }
      });
    }
  }

  if (environment.keyGroup.visible) {
    const distance = Math.hypot(KEY_SPOT.x - player.position.x, KEY_SPOT.z - player.position.z);
    if (distance < KEY_PICKUP_RANGE) {
      list.push({
        kind: 'key',
        distance,
        label: 'pick up the brass key',
        run: () => {
          const result = pickUpKey(state);
          toast(result.message);
          if (result.changed) cue('pickup');
          if (result.changed) {
            environment.setKeyVisible(false);
            refreshHUD();
            autoSave();
          }
        }
      });
    }
  }

  // The north gate: report why it is shut, or just note that it is open.
  const gateDistance = Math.hypot(GATE.x - player.position.x, GATE.z - player.position.z);
  if (gateDistance < GATE.range) {
    list.push({
      kind: 'gate',
      distance: gateDistance,
      label: gateHint(state),
      run: () => {
        if (isGateOpen(state)) {
          toast('The north gate stands open. The market lane is beyond.');
        } else {
          toast('Locked. Halden keeps the brass key — and he tends to lose it.');
        }
      }
    });
  }

  // The notice board in the lane.
  const boardDistance = Math.hypot(NOTICE_BOARD.x - player.position.x, NOTICE_BOARD.z - player.position.z);
  if (boardDistance < NOTICE_BOARD.range) {
    list.push({
      kind: 'notice',
      distance: boardDistance,
      label: 'read the notice board',
      run: () => {
        toast(noticeText(state, npcTier(state, 'halden').id));
      }
    });
  }

  // The plaza work board: available at any standing, which is the point. A
  // player can earn goodwill here before they need it, instead of only after a
  // refusal makes it urgent.
  const boardJobDistance = Math.hypot(JOB_BOARD.x - player.position.x, JOB_BOARD.z - player.position.z);
  if (boardJobDistance < JOB_BOARD.range) {
    list.push({
      kind: 'jobboard',
      distance: boardJobDistance,
      label: 'read the work board',
      run: () => openDialogue({ ...JOB_BOARD_SPEAKER, role: 'Odd jobs, posted daily' })
    });
  }

  // Bench: rest to skip to the next phase.
  const benchDistance = Math.hypot(BENCH.x - player.position.x, BENCH.z - player.position.z);
  if (benchDistance < BENCH.range) {
    list.push({
      kind: 'bench',
      distance: benchDistance,
      label: 'rest until the next hour',
      run: () => restOnBench()
    });
  }

  // The lane's lamp post: the only place the bunting lanterns can be lit. The
  // post always answers when the player is in reach, even in daylight, so a
  // player who walks back at noon is told why there is nothing to do rather
  // than finding a post that has quietly gone inert.
  const lampDistance = Math.hypot(LANE_LIGHTING_POST.x - player.position.x, LANE_LIGHTING_POST.z - player.position.z);
  if (lampDistance < LANE_LIGHTING_POST.range) {
    list.push({
      kind: 'lanterns',
      distance: lampDistance,
      label: laneLightingHint(state, phaseAt(clockSeconds).id) || 'the lane lanterns',
      run: () => performLaneLighting()
    });
  }

  // The wick round's hotspot: the plaza lanterns, trimmed at dusk. It answers
  // at any hour so a player who walks up at noon is told why there is nothing
  // to trim rather than finding an inert lantern.
  const wicksDistance = Math.hypot(WICKS_SPOT.x - player.position.x, WICKS_SPOT.z - player.position.z);
  if (wicksDistance < WICKS_SPOT.range && wicksActive(state)) {
    list.push({
      kind: 'wicks',
      distance: wicksDistance,
      label: wicksHint(state, phaseAt(clockSeconds).id),
      run: () => performWicksTrim()
    });
  }

  list.sort((a, b) => a.distance - b.distance);
  return list;
}

/**
 * The lamp round, from the interaction to the screen. Kept beside the rest of
 * the world actions so the interactable and the exposed test hook run the same
 * code rather than two copies that can drift.
 */
function performLaneLighting() {
  const phase = phaseAt(clockSeconds).id;
  const result = lightLaneLanterns(state, phase);
  toast(result.message);
  if (result.changed) {
    // lightLaneLanterns() also walks Oswin's night order, because lighting the
    // lane is the round: a dawn reset or a refused attempt cannot finish it.
    // applyPhase is cheap and phase-scoped; calling it directly avoids replaying
    // syncPhase's dusk announcement on top of the lighting message.
    applyPhase(environment, phase, laneLanternsShouldGlow(state, phase));
    cue('pickup');
    announce(`${result.message} Traders will remember it.`);
    refreshHUD();
    autoSave();
  }
  return result;
}

/**
 * The wick round, from the interaction to the screen. Same shape as the lamp
 * round: the interactable and the exposed test hook run the same code.
 */
function performWicksTrim() {
  const phase = phaseAt(clockSeconds).id;
  const result = trimWicks(state, phase);
  toast(result.message);
  if (result.changed) {
    cue('pickup');
    announce(result.message);
    refreshHUD();
    autoSave();
  }
  return result;
}

/**
 * The lantern round and Oswin's night order, exposed for the browser checks so
 * they can prove the gate on the same code the player uses rather than a copy.
 */
function nightLightWork() {
  return {
    unlocked: nightLightUnlocked(state),
    status: questStatus(state, 'nightlight'),
    hasOrder: hasItem(state, 'night_order')
  };
}

function restOnBench() {
  clockSeconds = nextPhaseStart(clockSeconds);
  syncPhase(true);
  toast(`You rest a while. It is now ${clockLabel(clockSeconds)}.`);
  refreshHUD();
  autoSave();
}

let nearestInteractable = null;

function refreshHint() {
  if (!dialogueEl.hidden) return;
  const list = interactables();
  nearestInteractable = list[0] || null;
  announceInteractable(nearestInteractable);
  if (nearestInteractable) {
    hint.innerHTML = `<b>E</b> — ${escapeHtml(nearestInteractable.label)}`;
    hint.hidden = !player.enabled;
    crosshair.classList.toggle('active', nearestInteractable.kind === 'npc');
  } else {
    hint.hidden = true;
    crosshair.classList.remove('active');
  }

  syncPickups();
}

/**
 * World pickups follow quest state. This runs every frame rather than from
 * refreshHint, because refreshHint returns early while a dialogue is open — and
 * a dialogue is exactly what reveals the ledger.
 */
function syncPickups() {
  environment.setKeyVisible(questStatus(state, 'key') === 'started');
  environment.setLedgerVisible(questStatus(state, 'ledger') === 'booked');
}

// --- Dusk watch (Pip's quest) --------------------------------------------
function checkDuskWatch() {
  const phase = phaseAt(clockSeconds);
  if (phase.id !== 'dusk') return;
  if (!onTerrace(player.position.x, player.position.z)) return;
  const result = watchLanterns(state, phase.id);
  if (result.changed) {
    toast(result.message);
    // The toast carries real information and vanishes after three seconds; put
    // the same sentence into the live region so it is not lost.
    announce(result.message);
    refreshHUD();
    autoSave();
  }
}

// --- Saving --------------------------------------------------------------
/** Where the player is and what time it is, bundled with the quest state. */
function worldSnapshot() {
  return {
    x: player.position.x,
    z: player.position.z,
    yaw: player.yaw,
    clock: clockSeconds
  };
}

function saveGame() {
  if (!saves.available) return;
  saves.save(state, worldSnapshot());
  saveNote.textContent = 'Progress saved.';
}

let autoSaveTimer = 0;
function autoSave() {
  if (!saves.available) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(saveGame, 250);
}

// --- Start ---------------------------------------------------------------
const savedGame = saves.loadSave();

if (savedGame) {
  continueButton.hidden = false;
  saveNote.textContent = 'A saved game was found.';
  continueButton.addEventListener('click', (event) => {
    event.stopPropagation();
    state = savedGame.state;
    if (savedGame.world) {
      clockSeconds = savedGame.world.clock;
      player.placeAt(savedGame.world.x, savedGame.world.z, savedGame.world.yaw);
      syncPhase(true);
    }
    started = true;
    syncPickups();
    refreshHUD();
    beginTouchMode();
    player.requestLock();
  });
}

// Says what to do on arrival. The plaza drops you a few metres from anyone, so the
// interaction hint stays hidden at spawn and a first-time player was told nothing.
let welcomed = false;
function welcomeIfFresh() {
  if (welcomed) return null;
  welcomed = true;
  const nearestNpc = npcs
    .map((npc) => ({
      name: npc.name,
      distance: Math.hypot(npc.group.position.x - player.position.x, npc.group.position.z - player.position.z)
    }))
    .sort((a, b) => a.distance - b.distance)[0];
  const message = welcome({
    state,
    nearest: nearestNpc ? { name: nearestNpc.name } : null,
    device: touchState.active ? 'touch' : 'keyboard'
  });
  if (!message) return null;
  // Both lines go on screen: the controls are as much a part of the welcome as the
  // goal, and a player who cannot hear the live region would otherwise only ever see
  // where to go, never how to get there.
  toast(message.opening);
  toast(message.goal);
  announce(message.spoken, { urgent: false });
  return message;
}

playButton.addEventListener('click', (event) => {
  event.stopPropagation();
  started = true;
  // A real gesture, so this is where the audio context may legally open.
  sound.start();
  beginTouchMode();
  player.requestLock();
  welcomeIfFresh();
});
overlay.addEventListener('click', () => {
  // Any tap on the overlay is a request to start, so this path must set up
  // touch mode too -- otherwise a phone player who taps beside the button
  // gets an overlay that never goes away.
  started = true;
  sound.start();
  beginTouchMode();
  player.requestLock();
  welcomeIfFresh();
});

// --- Touch controls -------------------------------------------------------
// Pointer lock does not exist on a phone, so touch drives the same Player:
// the left thumb sets analog movement and a right-side drag turns the view.
// The maths lives in touch.js; this is the DOM plumbing.
const touchState = {
  active: false,
  stickId: null,
  lookId: null,
  originX: 0,
  originY: 0,
  lookX: 0,
  lookY: 0
};

function touchEnabled() {
  if (touchState.forceTouch) return true;
  return wantsTouchControls({
    maxTouchPoints: navigator.maxTouchPoints || 0,
    coarsePointer: window.matchMedia?.('(pointer: coarse)')?.matches || false
  });
}

function beginTouchMode() {
  if (!touchEnabled()) return false;
  touchState.active = true;
  player.setTouchMode(true);
  touchRoot.hidden = false;
  crosshair.hidden = true;
  // The interact hint is replaced by a thumb button on touch.
  hint.hidden = true;
  return true;
}

function showTouchPause(show) {
  touchPause.hidden = !show;
  if (show) {
    // The sheet covers the screen, so the controls underneath must not keep
    // receiving thumbs -- otherwise a player can walk while "paused".
    touchState.stickId = null;
    touchState.lookId = null;
    player.setMoveInput(0, 0);
    resetStick();
    // Close any conversation FIRST: closeDialogue() clears `frozen`, so setting
    // it before this call would leave the world running behind the pause sheet.
    if (!dialogueEl.hidden) closeDialogue();
    player.frozen = true;
    saveGame();
  } else if (!dialogueEl.hidden) {
    player.frozen = true;
  } else {
    player.frozen = false;
  }
}

/** Places the stick base where the thumb first touched, within the zone. */
function placeStick(clientX, clientY) {
  const rect = stickZone.getBoundingClientRect();
  const localX = Math.min(Math.max(clientX - rect.left, 64), rect.width - 24);
  const localY = Math.min(Math.max(clientY - rect.top, 64), rect.height - 24);
  stickBase.style.left = `${localX}px`;
  stickBase.style.top = `${localY}px`;
  stickBase.style.bottom = 'auto';
  stickBase.style.margin = '-56px 0 0 -56px';
  stickBase.classList.add('active');
  return { x: rect.left + localX, y: rect.top + localY };
}

function resetStick() {
  touchState.stickId = null;
  stickBase.classList.remove('active');
  stickKnob.style.transform = 'translate(0px, 0px)';
  player.setMoveInput(0, 0);
}

function touching(id, list) {
  for (const touch of list) if (touch.identifier === id) return touch;
  return null;
}

stickZone.addEventListener('pointerdown', (event) => {
  if (!player.enabled || player.frozen || !dialogueEl.hidden) return;
  if (touchState.stickId !== null) return;
  event.preventDefault();
  touchState.stickId = event.pointerId;
  const centre = placeStick(event.clientX, event.clientY);
  touchState.originX = centre.x;
  touchState.originY = centre.y;
  stickZone.setPointerCapture?.(event.pointerId);
});

stickZone.addEventListener('pointermove', (event) => {
  if (event.pointerId !== touchState.stickId) return;
  event.preventDefault();
  const dx = event.clientX - touchState.originX;
  const dy = event.clientY - touchState.originY;
  const vector = stickVector(dx, dy);
  player.setMoveInput(vector.forward, vector.strafe);
  const knob = knobOffset(dx, dy);
  stickKnob.style.transform = `translate(${knob.x}px, ${knob.y}px)`;
});

// Deliberately NOT listening for pointerleave: with pointer capture the thumb
// keeps controlling the stick even when it crosses the zone edge, and treating
// a leave as a release made the walk stutter mid-drag on real devices.
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  stickZone.addEventListener(type, (event) => {
    if (event.pointerId !== touchState.stickId) return;
    resetStick();
  });
}

lookZone.addEventListener('pointerdown', (event) => {
  if (!player.enabled || player.frozen || !dialogueEl.hidden) return;
  if (touchState.lookId !== null) return;
  event.preventDefault();
  touchState.lookId = event.pointerId;
  touchState.lookX = event.clientX;
  touchState.lookY = event.clientY;
  lookZone.setPointerCapture?.(event.pointerId);
});

lookZone.addEventListener('pointermove', (event) => {
  if (event.pointerId !== touchState.lookId) return;
  event.preventDefault();
  const dx = event.clientX - touchState.lookX;
  const dy = event.clientY - touchState.lookY;
  touchState.lookX = event.clientX;
  touchState.lookY = event.clientY;
  const delta = lookDelta(dx, dy);
  player.applyLook(delta.yaw, delta.pitch);
  player.pitch = clampPitch(player.pitch);
});

for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  lookZone.addEventListener(type, (event) => {
    if (event.pointerId !== touchState.lookId) return;
    touchState.lookId = null;
  });
}

// Touch events are the fallback only when Pointer Events are missing. On a
// browser that supports both (every current iOS and Android release does) the
// same finger would otherwise drive both handlers and the stick would jitter
// between two origins. Feature-detect rather than fire both.
const usesPointerEvents = typeof window.PointerEvent === 'function';
if (!usesPointerEvents) touchEventsFallback();
else {
  // Nothing to add: pointer events already cover mouse, touch and pen.
}

function touchEventsFallback() {
stickZone.addEventListener('touchstart', (event) => {
  if (!player.enabled || player.frozen || touchState.stickId !== null || !dialogueEl.hidden) return;
  const touch = event.changedTouches[0];
  if (!touch) return;
  event.preventDefault();
  touchState.stickId = `touch-${touch.identifier}`;
  const centre = placeStick(touch.clientX, touch.clientY);
  touchState.originX = centre.x;
  touchState.originY = centre.y;
}, { passive: false });

stickZone.addEventListener('touchmove', (event) => {
  if (touchState.stickId === null) return;
  const touch = event.changedTouches[0];
  if (!touch) return;
  event.preventDefault();
  const dx = touch.clientX - touchState.originX;
  const dy = touch.clientY - touchState.originY;
  const vector = stickVector(dx, dy);
  player.setMoveInput(vector.forward, vector.strafe);
  const knob = knobOffset(dx, dy);
  stickKnob.style.transform = `translate(${knob.x}px, ${knob.y}px)`;
}, { passive: false });

for (const type of ['touchend', 'touchcancel']) {
  stickZone.addEventListener(type, () => {
    if (String(touchState.stickId).startsWith('touch-')) resetStick();
  }, { passive: false });
}

// Same drag-to-look behaviour for browsers without Pointer Events.
lookZone.addEventListener('touchstart', (event) => {
  if (!player.enabled || player.frozen || !dialogueEl.hidden) return;
  const t = event.changedTouches[0];
  if (!t) return;
  touchState.lookId = `touch-${t.identifier}`;
  touchState.lookX = t.clientX;
  touchState.lookY = t.clientY;
}, { passive: true });

lookZone.addEventListener('touchmove', (event) => {
  if (touchState.lookId === null) return;
  const t = event.changedTouches[0];
  if (!t) return;
  event.preventDefault();
  const delta = lookDelta(t.clientX - touchState.lookX, t.clientY - touchState.lookY);
  touchState.lookX = t.clientX;
  touchState.lookY = t.clientY;
  player.applyLook(delta.yaw, delta.pitch);
  player.pitch = clampPitch(player.pitch);
}, { passive: false });

for (const type of ['touchend', 'touchcancel']) {
  lookZone.addEventListener(type, () => { touchState.lookId = null; }, { passive: true });
}
}

dialogueClose.addEventListener('click', (event) => {
  event.preventDefault();
  closeDialogue();
});

touchInteract.addEventListener('click', (event) => {
  event.preventDefault();
  if (!nearestInteractable) return;
  nearestInteractable.run();
  refreshHint();
  refreshTouchInteract();
});

// The phone equivalents of C, L and G. Without these the accessibility work of
// rounds 13-15 simply did not exist on a phone, which is where VoiceOver -- the
// most widely used screen reader -- actually runs.
touchDescribe.addEventListener('click', (event) => {
  event.preventDefault();
  if (!started) return;
  announce(describeState(state, areaAt(player.position.x, player.position.z) || 'outside', nearestInteractable), { urgent: true });
});

touchNearby.addEventListener('click', (event) => {
  event.preventDefault();
  if (!started) return;
  announceNearby();
});

touchTravel.addEventListener('click', (event) => {
  event.preventDefault();
  if (!started) return;
  if (guided) { stopGuidedTravel(); return; }
  const query = compassInput?.value?.trim();
  if (query) { startGuidedTravel(query); return; }
  const { from } = compassOrigin();
  const nearest = nearbyTargets(0, from, compassTargets(), 1)[0];
  if (nearest) startGuidedTravel(nearest.id);
});

touchJournal.addEventListener('click', (event) => {
  event.preventDefault();
  panel.hidden = !panel.hidden;
  refreshHUD();
});

touchPauseButton.addEventListener('click', (event) => {
  event.preventDefault();
  showTouchPause(true);
});
touchResume.addEventListener('click', (event) => {
  event.preventDefault();
  showTouchPause(false);
});
touchSave.addEventListener('click', (event) => {
  event.preventDefault();
  saveGame();
  toast('Progress saved.');
});

/** Keeps the thumb button label in sync with whatever is in reach. */
function refreshTouchInteract() {
  if (!touchState.active) return;
  const target = player.enabled ? nearestInteractable : null;
  const show = Boolean(target) && dialogueEl.hidden;
  touchInteract.hidden = !show;
  if (show) touchInteract.textContent = interactLabel(target.kind);
}

// --- Input ---------------------------------------------------------------
document.addEventListener('keydown', (event) => {
  // While the player is typing in the "walk to" box, every global hotkey must stay
  // out of the way: W/A/S/D moved the player, and M, J, C and L all fired mid-word
  // (typing "bench" arrived as "benh"). Escape still works, to leave the field.
  if (event.target instanceof HTMLInputElement) {
    if (event.code === 'Escape') event.target.blur();
    return;
  }
  if (event.code === 'Escape') {
    if (!touchPause.hidden) {
      showTouchPause(false);
      event.preventDefault();
      return;
    }
    if (!dialogueEl.hidden) {
      closeDialogue();
      event.preventDefault();
    }
    return;
  }
  if (event.code === 'KeyC') {
    // "Where am I?" A blind player cannot glance around, so this reports the same
    // facts a sighted player would take in at a glance: the area, the gate, the
    // nearest thing to use, and their money. Silent before the game starts, when
    // there is genuinely nowhere to be.
    if (!started) return;
    announce(describeState(state, areaAt(player.position.x, player.position.z) || 'outside', nearestInteractable), { urgent: true });
    event.preventDefault();
    return;
  }
  if (guided && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
    // The player grabbed the controls, so stop steering for them.
    stopGuidedTravel();
  }
  if (event.code === 'KeyG') {
    // Guided travel: walk me to whatever is most useful, or to a named place from
    // the journal box. Pressing it again while walking stops.
    if (!started) return;
    if (!dialogueEl.hidden) return;
    if (guided) { stopGuidedTravel(); event.preventDefault(); return; }
    const query = compassInput?.value?.trim();
    if (query) { startGuidedTravel(query); event.preventDefault(); return; }
    // No name given: head for the nearest thing worth walking to.
    const { from } = compassOrigin();
    const nearest = nearbyTargets(0, from, compassTargets(), 1)[0];
    if (nearest) startGuidedTravel(nearest.id);
    event.preventDefault();
    return;
  }
  if (event.code === 'KeyL') {
    // "What is near me?" The spoken equivalent of looking around.
    if (!started) return;
    if (!dialogueEl.hidden) return;
    announceNearby();
    event.preventDefault();
    return;
  }
  if (event.code === 'KeyM') {
    // Works mid-conversation too: if a sound is bothering you, you should not
    // have to leave the dialogue to silence it.
    sound.start();
    sound.toggle();
    syncSoundToggle();
    if (sound.enabled) cue('choose');
    event.preventDefault();
    return;
  }
  if (!player.enabled) return;

  if (!dialogueEl.hidden) {
    if (event.code === 'KeyE' || event.code === 'Enter') {
      // E confirms the highlighted choice, which starts on the natural next step.
      const index = choiceIndex;
      choiceIndex = 0;
      choose(index);
      event.preventDefault();
    } else if (event.code === 'KeyS' || event.code === 'ArrowDown') {
      moveChoice(1);
      event.preventDefault();
    } else if (event.code === 'KeyW' || event.code === 'ArrowUp') {
      moveChoice(-1);
      event.preventDefault();
    } else if (/^Digit[1-9]$/.test(event.code)) {
      choose(Number(event.code.slice(5)) - 1);
      event.preventDefault();
    }
    return;
  }

  if (event.code === 'KeyE' || event.code === 'Enter') {
    if (nearestInteractable) {
      nearestInteractable.run();
      refreshHint();
      event.preventDefault();
    }
    return;
  }

  if (event.code === 'KeyJ') {
    panel.hidden = !panel.hidden;
    refreshHUD();
    return;
  }

  // Manual escape hatch: P toggles adaptive resolution off/on. Worth having
  // because the automatic behaviour is invisible, and a player on a fast
  // machine may prefer a fixed, sharp image.
  if (event.code === 'KeyP') {
    const on = window.amazingAdventure.resolution.setAdaptive(!adaptiveResolution);
    toast(on ? 'Adaptive resolution on.' : 'Adaptive resolution off — fixed at native.');
    return;
  }
});

// --- Ambient conversations -----------------------------------------------
// Two nearby NPCs occasionally strike up an exchange. The player can walk over
// and overhear it. The exchange itself is pure data from ambient.js; this is
// only the timing and display.
const ambient = {
  lines: [],
  index: 0,
  timer: 0,
  speakerIds: [],
  cooldown: 4,
  nextPairCheck: 0
};

function ambientBusyIds() {
  return ambient.lines.length ? ambient.speakerIds : [];
}

function resetAmbient() {
  ambient.lines = [];
  ambient.index = 0;
  ambient.speakerIds = [];
  ambientElHide();
}

function ambientElHide() {
  overheardEl.hidden = true;
  overheardLines.innerHTML = '';
}

/** Starts an exchange between the pair ambient.js picks for this moment. */
function maybeStartAmbient(dt) {
  if (ambient.lines.length) return;
  if (ambient.cooldown > 0) {
    ambient.cooldown = Math.max(0, ambient.cooldown - dt);
    return;
  }
  ambient.nextPairCheck -= dt;
  if (ambient.nextPairCheck > 0) return;
  ambient.nextPairCheck = 1.2;

  if (activeNPC) return; // do not talk over the player's own conversation
  const snapshot = npcs.map((npc) => ({
    id: npc.id,
    name: npc.name,
    position: { x: npc.group.position.x, z: npc.group.position.z }
  }));
  const pair = chooseAmbientPair({
    npcs: snapshot,
    state,
    phase: currentPhase,
    playerPosition: player.position,
    busyIds: ambientBusyIds(),
    activeId: activeNPC?.id ?? null
  });
  if (!pair) return;

  // A little deliberate chance so conversations feel occasional, not scripted.
  ambient.nextPairCheck = 1.2;
  if (deterministicChance(`${pair.a.id}|${pair.b.id}|${Math.floor(clockSeconds)}`) > AMBIENT_CHANCE) return;

  const names = Object.fromEntries(npcs.map((npc) => [npc.id, npc.name]));
  ambient.lines = buildExchange({ state, phase: currentPhase, a: pair.a, b: pair.b, names });
  ambient.speakerIds = [pair.a.id, pair.b.id];
  ambient.index = 0;
  ambient.timer = 0;
  noteExchange(state, pair.a.id, pair.b.id);
  renderAmbient();
}

/** A stable pseudo-random 0..1 value, so the sim is reproducible from a save. */
function deterministicChance(seed) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
}

function advanceAmbient(dt) {
  if (!ambient.lines.length) return;
  ambient.timer += dt;

  // Re-check earshot every tick so walking away hides the text immediately and
  // walking back brings it in again, rather than waiting for the next line.
  const line = ambient.lines[ambient.index];
  const speaker = line ? npcs.find((npc) => npc.id === line.speakerId) : null;
  const inEarshot = !speaker || canOverhear(speaker.group.position, player.position);
  if (!inEarshot) {
    ambientElHide();
  } else if (overheardEl.hidden || !overheardLines.innerHTML) {
    renderAmbient();
  }

  if (ambient.timer < 2.4) return;
  ambient.timer = 0;
  ambient.index += 1;
  if (ambient.index >= ambient.lines.length) {
    resetAmbient();
    ambient.cooldown = 8;
    return;
  }
  renderAmbient();
}

function renderAmbient() {
  const line = ambient.lines[ambient.index];
  if (!line) return ambientElHide();
  const speaker = npcs.find((npc) => npc.id === line.speakerId);
  const position = speaker ? speaker.group.position : null;
  if (position && !canOverhear(position, player.position)) {
    // Out of earshot: keep the conversation running but hide the text.
    ambientElHide();
    return;
  }
  overheardEl.hidden = !player.enabled;
  overheardLines.innerHTML = ambient.lines
    .slice(0, ambient.index + 1)
    .map((entry, index) => `<div class="overheard-line${index === ambient.index ? ' speaking' : ''}"><b>${escapeHtml(entry.speakerName)}</b> — ${escapeHtml(entry.text)}</div>`)
    .join('');
}

// --- Loop ----------------------------------------------------------------
const clock = new THREE.Clock();
let hudTimer = 0;
// The area the player occupied on the previous frame, for the Gate Tally's
// crossing detection. Seeded to the starting area so the first frame cannot
// count as a walk.
let prevArea = 'plaza';

let lastFrameMs = 16;
function frame() {
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.05);
  updateGuidedTravel();
  player.update(dt);

  // Footsteps: distance-driven, so pushing into a wall is silent and half-speed
  // walking gives half the steps. Cadence rises with speed (walk vs run).
  if (started && sound.started) {
    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    const steps = stepClock.advance(speed, dt);
    if (steps > 0) {
      for (let i = 0; i < steps; i += 1) {
        sound.step({ speed, walkSpeed: WALK_SPEED_EXPORT, variant: i % 2 });
      }
    }
    // Reset the accumulator when the player stops, so the next step lands on a
    // fresh stride rather than mid-stride.
    if (speed < STEP_MIN_SPEED) stepClock.reset();
  }

  clockSeconds = wrapClock(clockSeconds + dt);
  syncPhase();
  // Fog follows a smooth curve over the whole cycle rather than the per-phase
  // constants applyPhase() installs, so the distance haze never steps at a
  // phase boundary. applyPhase() still sets the baseline (so a single forced
  // phase looks right immediately); this keeps it breathing between keyframes.
  applyAtmosphere(environment, clockSeconds);
  // Round 75: the fountain's ripples travel. One call, after the phase has
  // settled so a phase jump cannot leave the surface on the wrong tick.
  if (environment.updateWater) environment.updateWater(dt);
  // Round 85: the star field twinkles once per frame, next to the water it
  // shares the sky with.
  if (environment.updateStars) environment.updateStars(dt);
  // Round 88: the cloud layer drifts once per frame.
  if (environment.updateClouds) environment.updateClouds(dt);
  // Round 98: the near passer clouds drift with the same frame, and skip
  // themselves entirely when the layer is off (low tier, or night).
  if (environment.updatePassers) environment.updatePassers(dt);
  // Round 90: the meadow leans in the same wind field, once per frame (full
  // tier only -- setQuality switches the sway off on low).
  if (environment.updateMeadow) environment.updateMeadow(dt);
  // Round 91: the bunting and banner cloth flutter once per frame (full tier).
  if (environment.updateFlutter) environment.updateFlutter(dt);
  // Round 91: the night firefly field drifts and blinks once per frame.
  if (environment.updateFireflies) environment.updateFireflies(dt);
  // Round 92: the daytime bird flock orbits and flaps, and the chimney columns
  // climb. Both are instanced-quad passes and both stop on the low tier.
  if (environment.updateBirds) environment.updateBirds(dt);
  if (environment.updateSmoke) environment.updateSmoke(dt);
  // Round 93: the daytime butterflies and the drifting dust motes are per-frame
  // instanced passes; both stop on the low tier. The lit windows are not a
  // per-frame pass -- their schedule only moves when a bedtime passes, so the
  // call is cheap and the guard lives inside updateWindows.
  if (environment.updateButterflies) environment.updateButterflies(dt);
  if (environment.updateMotes) environment.updateMotes(dt);
  if (environment.updateWindows) environment.updateWindows(nightFraction(clockSeconds));
  if (environment.paintWindowSpill) environment.paintWindowSpill(environment.phase, nightFraction(clockSeconds));
  if (environment.paintWindowBleed) environment.paintWindowBleed(environment.phase, nightFraction(clockSeconds));
  if (environment.paintRoomGlow) environment.paintRoomGlow(environment.phase, nightFraction(clockSeconds));
  if (environment.paintWetStreak) environment.paintWetStreak(environment.phase, nightFraction(clockSeconds));
  if (environment.paintLampHalo) environment.paintLampHalo(environment.phase, nightFraction(clockSeconds));
  if (environment.paintMoonHalo) environment.paintMoonHalo(environment.phase, nightFraction(clockSeconds));
  if (environment.updateIvy) environment.updateIvy(dt);
  if (environment.updateSpray) environment.updateSpray(dt);
  if (environment.updateMist) environment.updateMist(dt);
  // Round 94: fountain ripples travel, night moths orbit the lantern heads, puddles
  // shimmer and roof shingles are static (paint only).
  if (environment.updateRipples) environment.updateRipples(dt);
  if (environment.updateMoths) environment.updateMoths(dt);
  if (environment.updatePuddles) environment.updatePuddles(dt);
  // Round 95: the wildflower and reed clumps sway in the same wind field. Both
  // are per-frame instanced passes and both stop on the low tier.
  if (environment.updateWildflowers) environment.updateWildflowers(dt);
  if (environment.updateReeds) environment.updateReeds(dt);
  updateNPCs(npcs, dt, player.position);
  checkDuskWatch();
  maybeStartAmbient(dt);
  advanceAmbient(dt);

  for (const npc of npcs) {
    const near = nearestInteractable?.npc === npc;
    npc.marker.rotation.y += dt * (near ? 2.2 : 0.6);
    npc.marker.position.y = 2.15 + Math.sin(performance.now() / 500 + npc.group.position.x) * 0.05;
    npc.marker.material.emissiveIntensity = near ? 1.8 : 0.9;
    npc.marker.visible = true;
  }

  syncPickups();
  refreshHint();
  refreshTouchInteract();

  // Track which area the player is in every frame, so area-gated UI and tests
  // see the change immediately rather than on the next throttled HUD refresh.
  const area = areaAt(player.position.x, player.position.z) || 'outside';
  if (document.body.dataset.area !== area) {
    document.body.dataset.area = area;
    // The market lane has its own low bed; everywhere else it fades out.
    sound.setArea(area);
    if (started) announceArea(area);
  }

  // The Gate Tally: the act is the walk. Stepping from the plaza through the
  // north gate into the lane while carrying Halden's tally is the count he
  // asked for, so the chore cannot be paid for by talk alone. Halden stands in
  // the plaza, so the outward crossing is the only one a player can make after
  // taking the tally; one crossing is enough.
  if (questStatus(state, 'tally') === 'started' && document.body.dataset.area === 'lane' && prevArea === 'plaza') {
    const walked = walkTally(state);
    if (walked.changed) {
      toast(walked.message);
      announce(walked.message);
      autoSave();
    }
  }
  prevArea = area;

  hudTimer += dt;
  if (hudTimer > 0.2) {
    hudTimer = 0;
    if (started) refreshHUD();
  }

  renderer.render(scene, camera);

  // The first rendered frame is the earliest safe moment to prefilter the
  // environment map: shaders are compiled, and this is where the "no idle slot
  // ever arrives" fallback starts (see ensureFirstEnvironmentMap).
  if (!firstFrameRendered) {
    firstFrameRendered = true;
    ensureFirstEnvironmentMap();
  }

  // Adapt resolution from the real frame time, not the clamped game delta. The
  // first few frames are dropped by the controller itself so shader compiles do
  // not count against the machine.
  lastFrameMs = rawDt * 1000;
  if (adaptiveResolution) {
    // If a frame is catastrophically long, shed resolution immediately instead
    // of waiting for the smoothed average to catch up.
    if (shouldPanicShed(lastFrameMs, resolution.ratio <= MIN_RATIO)) {
      // Go through the controller so its reported ratio stays truthful.
      applyResolution(resolution.force(MIN_RATIO));
    } else {
      applyResolution(resolution.sample(lastFrameMs));
    }
  }
  // Quality only gets a vote once resolution is spent. Feeding it the same
  // smoothed frame time keeps the two controllers in agreement about how slow
  // this machine is, and the tier's own hysteresis stops it flapping.
  if (adaptiveQuality) {
    const atFloor = resolution.ratio <= MIN_RATIO;
    applyQuality(quality.sample(atFloor ? resolution.smoothed : NaN));
  }

  requestAnimationFrame(frame);
}

// Set when the world was stopped because the tab or app went away, so coming back
// knows whose job it is to un-stop it.
let frozenByVisibility = false;

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (!started) return;
    if (touchState.active) {
      // Do not tear down an open conversation: a phone user checking a message
      // should find their dialogue where they left it. Just stop the world.
      player.setMoveInput(0, 0);
      frozenByVisibility = true;
      player.frozen = true;
    } else if (player.enabled) {
      document.exitPointerLock?.();
    }
    return;
  }

  // Coming back. This branch used to be missing entirely, so on a phone the app
  // froze the player on background and never unfroze them: the game was silently
  // stuck, with no pause sheet to resume from. Only undo a freeze we applied, and
  // leave the world stopped if a conversation or the pause sheet owns it.
  if (!frozenByVisibility) return;
  frozenByVisibility = false;
  if (!dialogueEl.hidden || !touchPause.hidden) return;
  player.frozen = false;
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncPhase(true);
refreshHUD();
frame();

// Exposed for the browser smoke test.
window.amazingAdventure = {
  version: VERSION,
  buildName: BUILD_NAME,
  releaseChannel: RELEASE_CHANNEL,
  entryPoint: ENTRY_POINT,
  // A dashboard can read this to learn how to serve the preview.
  manifest: buildManifest(),
  player,
  npcs,
  renderer,
  scene,
  camera,
  environment,
  // The paved surface under a point, which is not the same as the walking floor:
  // the plaza disc, the lane floor and the terrace stand at three different
  // heights. Round 105 places every ground overlay on it, so the browser suite
  // can recompute where a decal should have gone instead of pinning one height.
  surfaceHeightAt,
  // Lets a test (or a bug report) ask what actually shipped rather than guessing.
  assetState: () => environment.assetState,
  assetsReady: () => assetsReady,
  // Resolves once every environment map built so far has been applied. Tests
  // await this instead of guessing how many frames PMREM needs.
  environmentMapReady: () => envMapReady,
  environmentMapsBuilt: () => envMapsBuilt,
  // Builds the current phase's map synchronously, for checks that need the
  // final look in the same tick rather than after an idle callback.
  buildEnvironmentMapNow: () => {
    pendingEnvPhase = currentPhase;
    return buildPendingEnvironmentMap();
  },
  saves,
  getState: () => state,
  setState: (next) => {
    state = next;
    refreshHUD();
  },
  interactables: () => interactables(),
  getClock: () => ({ seconds: clockSeconds, phase: phaseAt(clockSeconds).id }),
  // The fog curve, as the game actually computed it this frame.
  atmosphere: () => atmosphereAt(clockSeconds),
  setClock: (seconds) => {
    clockSeconds = wrapClock(seconds);
    syncPhase(true);
    refreshHUD();
  },
  restOnBench,
  refreshHUD,
  ambient,
  isDialogueOpen: () => !dialogueEl.hidden,
  resetAmbient,
  renderAmbient,
  getDialogue: () => (activeNode ? { speaker: activeNode.speaker, text: activeNode.text, choices: activeNode.choices?.map((c) => c.label) ?? [] } : null),
  choose: (index) => choose(index),
  KEY_SPOT,
  TERRACE,
  areaAt: () => areaAt(player.position.x, player.position.z),
  describe: () => describeState(state, areaAt(player.position.x, player.position.z) || 'outside', nearestInteractable),
  compassTargets,
  announceNearby,
  announceRouteTo,
  startGuidedTravel,
  stopGuidedTravel,
  guidedState: () => (guided ? { target: guided.target.id, index: guided.index, total: guided.path.length } : null),
  navigationGrid,
  announce,
  // Exposed so tests can drive the same announcement path production uses,
  // rather than re-implementing the diff and testing the copy.
  withAnnouncements,
  srLiveText: () => srLive.textContent,
  srAlertText: () => srAlert.textContent,
  isGateOpen: () => isGateOpen(state),
  syncGate,
  syncPickups,
  LANE_LIGHTING_POST,
  laneLightingStatus: () => laneLightingStatus(state, phaseAt(clockSeconds).id),
  laneLanternsShouldGlow: () => laneLanternsShouldGlow(state, phaseAt(clockSeconds).id),
  performLaneLighting,
  nightLightWork,
  touch: {
    get active() { return touchState.active; },
    get rootHidden() { return touchRoot.hidden; },
    get moveInput() { return { ...player.moveInput }; },
    enter: beginTouchMode,
    pause: showTouchPause,
    interact: () => {
      if (!nearestInteractable) return false;
      nearestInteractable.run();
      refreshHint();
      refreshTouchInteract();
      return true;
    },
    get interactLabel() { return touchInteract.hidden ? null : touchInteract.textContent; },
    /** Recomputes what the thumb button offers right now.
     *  The frame loop calls this every tick; tests and touch handlers call it
     *  directly so the label never depends on frame timing. */
    refresh() {
      refreshHint();
      refreshTouchInteract();
      return touchInteract.hidden ? null : touchInteract.textContent;
    },
    forceTouch: (on) => { touchState.forceTouch = Boolean(on); }
  },
  audio: {
    get enabled() { return sound.enabled; },
    get started() { return sound.started; },
    get phase() { return sound.phase; },
    play: (name) => cue(name),
    step: (opts) => { try { return sound.step(opts); } catch { return false; } },
    get area() { return sound.area; },
    setArea: (area) => { try { return sound.setArea(area); } catch { return null; } },
    toggle: () => { const on = sound.toggle(); syncSoundToggle(); return on; },
    setEnabled: (on) => { const value = sound.setEnabled(on); syncSoundToggle(); return value; }
  },
  recovery: {
    get lost() { return recovery.lost; },
    get attempts() { return recovery.attempts; },
    begin: (reason) => recovery.begin(reason),
    restored: () => recovery.restored(),
    message: () => recovery.message()
  },
  resolution: {
    get ratio() { return resolution.ratio; },
    get changes() { return resolution.changes; },
    get adaptive() { return adaptiveResolution; },
    setAdaptive(on) {
      adaptiveResolution = Boolean(on);
      localStorage.setItem(RESOLUTION_KEY, adaptiveResolution ? 'auto' : 'fixed');
      // Turning adaptive off pins the image at native sharpness. That has to go
      // through the controller rather than straight to the renderer: otherwise the
      // controller keeps reporting whatever ratio it last chose, and `resolution.ratio`
      // silently disagrees with the pixels actually being drawn. Anyone reading the
      // reported value — the HUD, a test, a future bug report — would be misled.
      if (!adaptiveResolution) applyResolution(resolution.force(basePixelRatio));
      return adaptiveResolution;
    }
  },
  castReady,
  quality: {
    get tier() { return quality.tier; },
    get changes() { return quality.changes; },
    get adaptive() { return adaptiveQuality; },
    /** Forces a tier and pins it, so a manual choice is not undone by the loop. */
    set(tier) {
      adaptiveQuality = false;
      localStorage.setItem(QUALITY_KEY, 'fixed');
      applyQuality(quality.force(tier));
      return quality.tier;
    },
    /** Hands control back to the frame loop, keeping the current tier. */
    setAdaptive(on) {
      adaptiveQuality = Boolean(on);
      localStorage.setItem(QUALITY_KEY, adaptiveQuality ? quality.tier : 'fixed');
      return adaptiveQuality;
    }
  },
  basePixelRatio
};
