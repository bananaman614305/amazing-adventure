import * as THREE from 'three';
import { buildWorld } from './world.js';
import { Player } from './player.js';
import { createNPCs, findNearestNPC, syncNPCs } from './npcs.js';
import { createItems, findNearestItem, syncItems } from './items.js';
import {
  ITEM_LABELS,
  addItem,
  clearSave,
  formatClock,
  hasSave,
  loadState,
  markPicked,
  saveState
} from './state.js';
import {
  applyQuestChoice,
  beginConversation,
  buildConversation,
  questStatusText,
  recordPickup
} from './quest.js';

const container = document.getElementById('game');
const overlay = document.getElementById('overlay');
const playButton = document.getElementById('play');
const newGameButton = document.getElementById('new-game');
const crosshair = document.getElementById('crosshair');
const hint = document.getElementById('hint');
const dialogue = document.getElementById('dialogue');
const dialogueName = document.getElementById('dialogue-name');
const dialogueContext = document.getElementById('dialogue-context');
const dialogueLine = document.getElementById('dialogue-line');
const dialogueChoices = document.getElementById('dialogue-choices');
const dialogueFoot = document.getElementById('dialogue-foot');
const clockEl = document.getElementById('clock');
const questEl = document.getElementById('quest');
const inventoryEl = document.getElementById('inventory');
const memoryEl = document.getElementById('memory');
const eventEl = document.getElementById('event');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 200);
const state = loadState();
const { scene, colliders } = buildWorld(renderer);
const npcs = createNPCs(scene);
const items = createItems(scene);

applyQuestVisuals();

const player = new Player(camera, colliders, {
  onLock: () => {
    overlay.hidden = true;
    crosshair.hidden = Boolean(activeConversation);
    hint.hidden = Boolean(activeConversation);
  },
  onUnlock: () => {
    crosshair.hidden = true;
    hint.hidden = true;
    if (activeConversation) return;
    overlay.hidden = false;
    playButton.textContent = hasSave() ? 'Continue the story' : 'Click to play';
  }
});

player.position.x = state.player.x;
player.position.z = state.player.z;
player.yaw = state.player.yaw;
player.syncCamera();

let activeConversation = null;
let nearestTarget = null;
let eventTimer = null;

playButton.textContent = hasSave() ? 'Continue the story' : 'Click to play';
playButton.addEventListener('click', (event) => {
  event.stopPropagation();
  player.requestLock();
});
newGameButton.addEventListener('click', (event) => {
  event.stopPropagation();
  clearSave();
  location.reload();
});
overlay.addEventListener('click', () => player.requestLock());

function applyQuestVisuals() {
  const water = scene.getObjectByName('fountain-water');
  const pillar = scene.getObjectByName('fountain-pillar');
  if (!water || !pillar) return;

  if (state.quest.outcome === 'restored') {
    water.material.color.setHex(0x69d8c7);
    water.material.emissive.setHex(0x228e89);
    water.material.emissiveIntensity = 0.75;
    pillar.material.color.setHex(0xcbbd72);
  } else if (state.quest.outcome === 'sold') {
    water.material.color.setHex(0x2d5670);
    water.material.emissive.setHex(0x000000);
    water.material.emissiveIntensity = 0;
    pillar.material.color.setHex(0x756f66);
  }
}

function capturePlayer() {
  state.player.x = player.position.x;
  state.player.z = player.position.z;
  state.player.yaw = player.yaw;
}

function commit() {
  capturePlayer();
  saveState(state);
  updateHUD();
}

function showEvent(text) {
  eventEl.textContent = text;
  clearTimeout(eventTimer);
  eventTimer = setTimeout(() => {
    eventEl.textContent = '';
  }, 5000);
}

function updateHUD() {
  clockEl.textContent = formatClock(state.clockMinutes);
  questEl.textContent = questStatusText(state);
  inventoryEl.textContent = state.inventory.map((id) => ITEM_LABELS[id]).join(' · ') || 'empty';
  const known = npcs.filter((npc) => state.memories[npc.id]?.met).length;
  memoryEl.textContent = `${known}/${npcs.length} people know you`;
}

function renderConversation() {
  const conversation = activeConversation;
  if (!conversation) return;

  dialogueName.textContent = conversation.npc.name;
  dialogueContext.textContent = conversation.context;
  dialogueLine.textContent = conversation.lines[conversation.index];
  dialogueFoot.textContent = conversation.choices.length
    ? '1 / 2 or click — choose · Esc — close'
    : 'E / Enter — next · Esc — close';

  dialogueChoices.replaceChildren();
  for (const choice of conversation.choices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = choice.label;
    button.dataset.choice = choice.id;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      choose(choice.id);
    });
    dialogueChoices.appendChild(button);
  }
}

function openConversation(npc) {
  beginConversation(state, npc);
  const conversation = buildConversation(npc, state);
  activeConversation = { npc, ...conversation, index: 0 };
  dialogue.hidden = false;
  hint.hidden = true;
  crosshair.hidden = true;
  renderConversation();
  commit();
  showEvent(`${npc.name} now remembers you`);
}

function advanceConversation() {
  if (!activeConversation) return;
  if (activeConversation.index < activeConversation.lines.length - 1) {
    activeConversation.index += 1;
    renderConversation();
    return;
  }
  closeConversation();
}

function closeConversation() {
  activeConversation = null;
  dialogue.hidden = true;
  dialogueChoices.replaceChildren();
  crosshair.hidden = !player.enabled;
  hint.hidden = !player.enabled;
  if (!player.enabled) {
    overlay.hidden = false;
    playButton.textContent = 'Continue the story';
  }
}

function choose(choiceId) {
  if (!activeConversation) return;
  if (!applyQuestChoice(state, choiceId)) return;
  applyQuestVisuals();
  showEvent(choiceId === 'restore' ? 'The fountain is restored' : 'The lantern is sold');
  activeConversation.npc = npcs.find((npc) => npc.id === 'mara');
  const conversation = buildConversation(activeConversation.npc, state);
  activeConversation = { ...activeConversation, ...conversation, index: 0 };
  renderConversation();
  commit();
}

function pickUp(item) {
  if (!item) return;
  if (!markPicked(state, item.id)) return;
  addItem(state, item.id);
  recordPickup(state, item.id);
  item.group.visible = false;
  showEvent(`Picked up ${item.label}`);
  commit();
}

function distanceTo(position, target) {
  return Math.hypot(target.group.position.x - position.x, target.group.position.z - position.z);
}

function refreshTarget() {
  const npc = findNearestNPC(npcs, player.position);
  const item = findNearestItem(items, player.position, state);
  const npcDistance = npc ? distanceTo(player.position, npc) : Infinity;
  const itemDistance = item ? distanceTo(player.position, item) : Infinity;
  nearestTarget = itemDistance < npcDistance
    ? { type: 'item', target: item }
    : npc
      ? { type: 'npc', target: npc }
      : null;
}

function refreshHint() {
  if (activeConversation || !player.enabled) return;
  refreshTarget();
  if (!nearestTarget) {
    hint.hidden = true;
    return;
  }
  const verb = nearestTarget.type === 'item' ? 'pick up' : 'talk to';
  hint.innerHTML = `<b>E</b> — ${verb} ${nearestTarget.target.name || nearestTarget.target.label}`;
  hint.hidden = false;
}

document.addEventListener('keydown', (event) => {
  if (event.code === 'Escape' && activeConversation) {
    event.preventDefault();
    closeConversation();
    return;
  }

  if (activeConversation) {
    if (event.repeat) return;
    if (event.code === 'KeyE' || event.code === 'Enter') {
      advanceConversation();
      return;
    }
    const choiceId = event.code === 'Digit1' || event.code === 'Numpad1'
      ? 'restore'
      : event.code === 'Digit2' || event.code === 'Numpad2'
        ? 'sell'
        : null;
    if (choiceId && activeConversation.choices.some((choice) => choice.id === choiceId)) {
      choose(choiceId);
    }
    return;
  }

  if (!player.enabled || event.repeat) return;
  if (event.code === 'KeyE' || event.code === 'Enter') {
    if (!nearestTarget) return;
    if (nearestTarget.type === 'item') pickUp(nearestTarget.target);
    else openConversation(nearestTarget.target);
  }
});

const clock = new THREE.Clock();
let hudTimer = 0;
let saveTimer = 0;

function frame() {
  // Clamp the step so a stalled tab cannot teleport the player, but allow up to
  // 100ms so slow machines still move at the intended speed.
  const dt = Math.min(clock.getDelta(), 0.1);
  state.clockMinutes = (state.clockMinutes + dt * 0.5) % 1440;
  player.update(dt);
  syncNPCs(npcs, state, dt);
  syncItems(items, state, dt);

  for (const npc of npcs) {
    const near = nearestTarget?.type === 'npc' && nearestTarget.target === npc;
    npc.marker.rotation.y += dt * (near ? 2.2 : 0.6);
    npc.marker.position.y = 2.15 + Math.sin(state.clockMinutes / 12 + npc.group.position.x) * 0.05;
    npc.marker.material.emissiveIntensity = near ? 1.8 : 0.9;
  }

  refreshHint();
  hudTimer += dt;
  saveTimer += dt;
  if (hudTimer > 0.25) {
    hudTimer = 0;
    updateHUD();
  }
  if (saveTimer > 5) {
    saveTimer = 0;
    capturePlayer();
    saveState(state);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener('beforeunload', () => {
  capturePlayer();
  saveState(state);
});

updateHUD();
frame();

window.amazingAdventure = {
  player,
  npcs,
  items,
  renderer,
  scene,
  camera,
  state,
  getState: () => state,
  save: () => {
    capturePlayer();
    return saveState(state);
  },
  reset: () => {
    clearSave();
    location.reload();
  },
  pickUp,
  openConversation,
  choose,
  questStatusText
};
