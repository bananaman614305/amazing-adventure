import * as THREE from 'three';
import { buildWorld } from './world.js';
import { Player } from './player.js';
import { createNPCs, findNearestNPC } from './npcs.js';

const container = document.getElementById('game');
const overlay = document.getElementById('overlay');
const playButton = document.getElementById('play');
const crosshair = document.getElementById('crosshair');
const hint = document.getElementById('hint');
const dialogue = document.getElementById('dialogue');
const dialogueName = document.getElementById('dialogue-name');
const dialogueLine = document.getElementById('dialogue-line');

// --- Renderer -------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 200);

const { scene, colliders } = buildWorld(renderer);
const npcs = createNPCs(scene);

let activeNPC = null;

const player = new Player(camera, colliders, {
  onLock: () => {
    overlay.hidden = true;
    crosshair.hidden = false;
    hint.hidden = false;
  },
  onUnlock: () => {
    crosshair.hidden = true;
    hint.hidden = true;
    if (!dialogue.hidden) closeDialogue();
    overlay.hidden = false;
    playButton.textContent = 'Click to resume';
  }
});

// --- Start overlay --------------------------------------------------------
playButton.addEventListener('click', () => player.requestLock());
overlay.addEventListener('click', () => player.requestLock());

// --- Dialogue -------------------------------------------------------------
function openDialogue(npc) {
  activeNPC = npc;
  dialogueName.textContent = npc.name;
  dialogueLine.textContent = npc.lines[npc.lineIndex % npc.lines.length];
  dialogue.hidden = false;
  hint.hidden = true;
}

function advanceDialogue() {
  if (!activeNPC) return;
  activeNPC.lineIndex += 1;
  if (activeNPC.lineIndex >= activeNPC.lines.length) {
    activeNPC.lineIndex = 0;
    closeDialogue();
    return;
  }
  dialogueLine.textContent = activeNPC.lines[activeNPC.lineIndex];
}

function closeDialogue() {
  dialogue.hidden = true;
  hint.hidden = false;
  activeNPC = null;
}

document.addEventListener('keydown', (event) => {
  if (event.code === 'Escape' && activeNPC) {
    closeDialogue();
    return;
  }
  if (!player.enabled || event.repeat) return;

  if (event.code === 'KeyE' || event.code === 'Enter') {
    if (activeNPC) {
      advanceDialogue();
    } else if (nearestNPC) {
      openDialogue(nearestNPC);
    }
  }
});

// --- proximity hint -------------------------------------------------------
let nearestNPC = null;

function refreshHint() {
  if (dialogue.hidden === false) return;
  nearestNPC = findNearestNPC(npcs, player.position);
  if (nearestNPC) {
    hint.innerHTML = `<b>E</b> — talk to ${nearestNPC.name}`;
    hint.hidden = !player.enabled;
  } else {
    hint.hidden = true;
  }
}

// --- Loop -----------------------------------------------------------------
const clock = new THREE.Clock();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  player.update(dt);

  // NPCs bob their marker gently so they read as alive without animation work.
  for (const npc of npcs) {
    const near = npc === nearestNPC;
    npc.marker.rotation.y += dt * (near ? 2.2 : 0.6);
    npc.marker.position.y = 2.15 + Math.sin(performance.now() / 500 + npc.group.position.x) * 0.05;
    npc.marker.material.emissiveIntensity = near ? 1.8 : 0.9;
  }

  refreshHint();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

frame();

// Exposed for the browser smoke test: lets a test drive input and read state.
window.amazingAdventure = { player, npcs, renderer, scene, camera };
