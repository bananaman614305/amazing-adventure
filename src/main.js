import * as THREE from 'three';
import { buildWorld, applyPhase, KEY_SPOT, KEY_PICKUP_RANGE, floorHeightAt, TERRACE, STEP_HEIGHT, BENCH } from './world.js';
import { Player } from './player.js';
import { createNPCs, updateNPCs, setNPCRoutine, TALK_RANGE } from './npcs.js';
import {
  createInitialState,
  createSaveStore,
  questStatus,
  coins,
  pickUpKey,
  watchLanterns,
  journalEntries,
  inventoryItems,
  questCounts
} from './state.js';
import { startConversation, applyChoice } from './dialogue.js';
import { phaseAt, clockLabel, wrapClock, nextPhaseStart } from './daynight.js';
import { onTerrace } from './terrain.js';

// --- DOM ------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const container = $('game');
const overlay = $('overlay');
const playButton = $('play');
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
const toastStack = $('toast-stack');
const dialogueEl = $('dialogue');
const dialogueName = $('dialogue-name');
const dialogueRole = $('dialogue-role');
const dialogueLine = $('dialogue-line');
const dialogueChoices = $('dialogue-choices');

// --- World, player, state -------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 200);
const world = buildWorld(renderer);
const { scene, colliders, environment } = world;
const npcs = createNPCs(scene);

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
  applyPhase(environment, phase.id);
  setNPCRoutine(npcs, phase.id);
  clockPhase.textContent = phase.label;
  if (started && phase.id === 'dusk') toast('The lanterns are being lit.');
}

// --- Player --------------------------------------------------------------
const player = new Player(camera, colliders, {
  floorHeight: floorHeightAt,
  stepHeight: STEP_HEIGHT,
  onLock: () => {
    overlay.hidden = true;
    for (const el of [crosshair, hint, clockEl, tracker]) el.hidden = false;
    refreshHUD();
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

function refreshHUD() {
  clockTime.textContent = clockLabel(clockSeconds);
  coinCount.textContent = String(coins(state));

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
}

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
  activeNode = startConversation(state, npc.id);
  if (!activeNode) return;
  dialogueEl.hidden = false;
  hint.hidden = true;
  // Stand still while talking: no walking away mid-sentence.
  player.frozen = true;
  choiceIndex = 0;
  renderNode();
}

function renderNode() {
  if (!activeNode) return closeDialogue();
  dialogueName.textContent = activeNode.speaker || activeNPC?.name || '';
  dialogueRole.textContent = activeNPC?.role || '';
  dialogueLine.textContent = activeNode.text;
  dialogueChoices.innerHTML = '';
  choiceIndex = Math.max(0, Math.min(choiceIndex, (activeNode.choices?.length || 1) - 1));

  const choices = activeNode.choices?.length ? activeNode.choices : [{ label: 'Leave', end: true }];
  choices.forEach((choice, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice';
    button.dataset.index = String(index);
    button.innerHTML = `<span class="num">${index + 1}</span>${escapeHtml(choice.label)}`;
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
    button.setAttribute('aria-selected', String(index === choiceIndex));
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
  const result = applyChoice(state, npcId, choice);
  if (result.changed) {
    toast(result.message);
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
  dialogueEl.hidden = true;
  activeNode = null;
  activeNPC = null;
  player.frozen = false;
  hint.hidden = !player.enabled;
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
          if (result.changed) {
            environment.setKeyVisible(false);
            refreshHUD();
            autoSave();
          }
        }
      });
    }
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

  list.sort((a, b) => a.distance - b.distance);
  return list;
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
  if (nearestInteractable) {
    hint.innerHTML = `<b>E</b> — ${escapeHtml(nearestInteractable.label)}`;
    hint.hidden = !player.enabled;
    crosshair.classList.toggle('active', nearestInteractable.kind === 'npc');
  } else {
    hint.hidden = true;
    crosshair.classList.remove('active');
  }

  // The key only appears once Halden has asked for help with it.
  environment.setKeyVisible(questStatus(state, 'key') === 'started');
}

// --- Dusk watch (Pip's quest) --------------------------------------------
function checkDuskWatch() {
  const phase = phaseAt(clockSeconds);
  if (phase.id !== 'dusk') return;
  if (!onTerrace(player.position.x, player.position.z)) return;
  const result = watchLanterns(state, phase.id);
  if (result.changed) {
    toast(result.message);
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
    environment.setKeyVisible(questStatus(state, 'key') === 'started');
    refreshHUD();
    player.requestLock();
  });
}

playButton.addEventListener('click', (event) => {
  event.stopPropagation();
  if (!started && !savedGame) started = true;
  started = true;
  player.requestLock();
});
overlay.addEventListener('click', () => {
  started = true;
  player.requestLock();
});

// --- Input ---------------------------------------------------------------
document.addEventListener('keydown', (event) => {
  if (event.code === 'Escape') {
    if (!dialogueEl.hidden) {
      closeDialogue();
      event.preventDefault();
    }
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
  }
});

// --- Loop ----------------------------------------------------------------
const clock = new THREE.Clock();
let hudTimer = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  player.update(dt);

  clockSeconds = wrapClock(clockSeconds + dt);
  syncPhase();
  updateNPCs(npcs, dt, player.position);
  checkDuskWatch();

  for (const npc of npcs) {
    const near = nearestInteractable?.npc === npc;
    npc.marker.rotation.y += dt * (near ? 2.2 : 0.6);
    npc.marker.position.y = 2.15 + Math.sin(performance.now() / 500 + npc.group.position.x) * 0.05;
    npc.marker.material.emissiveIntensity = near ? 1.8 : 0.9;
    npc.marker.visible = true;
  }

  refreshHint();

  hudTimer += dt;
  if (hudTimer > 0.2) {
    hudTimer = 0;
    if (started) refreshHUD();
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

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
  player,
  npcs,
  renderer,
  scene,
  camera,
  environment,
  saves,
  getState: () => state,
  setState: (next) => {
    state = next;
    refreshHUD();
  },
  interactables: () => interactables(),
  getClock: () => ({ seconds: clockSeconds, phase: phaseAt(clockSeconds).id }),
  setClock: (seconds) => {
    clockSeconds = wrapClock(seconds);
    syncPhase(true);
    refreshHUD();
  },
  restOnBench,
  refreshHUD,
  isDialogueOpen: () => !dialogueEl.hidden,
  getDialogue: () => (activeNode ? { speaker: activeNode.speaker, text: activeNode.text, choices: activeNode.choices?.map((c) => c.label) ?? [] } : null),
  choose: (index) => choose(index),
  KEY_SPOT,
  TERRACE
};
