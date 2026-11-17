export const SAVE_KEY = 'amazing-adventure-round2';

export const ITEM_LABELS = {
  'brass-lantern': 'Brass Lantern',
  'herb-bundle': 'Herb Bundle',
  'fountain-token': 'Fountain Token',
  'coin-pouch': 'Coin Pouch'
};

export function createState() {
  return {
    version: 2,
    clockMinutes: 8 * 60 + 20,
    player: { x: 0, z: 13, yaw: 0 },
    inventory: [],
    pickedUp: [],
    quest: { status: 'dormant', stage: 'unknown', choice: null, outcome: null },
    memories: {},
    facts: { spokeToMara: false, lanternPicked: false }
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return createState();
    const saved = JSON.parse(raw);
    if (saved.version !== 2) return createState();
    const base = createState();
    return {
      ...base,
      ...saved,
      player: { ...base.player, ...saved.player },
      inventory: Array.isArray(saved.inventory) ? saved.inventory : [],
      pickedUp: Array.isArray(saved.pickedUp) ? saved.pickedUp : [],
      quest: { ...base.quest, ...saved.quest },
      memories: saved.memories && typeof saved.memories === 'object' ? saved.memories : {},
      facts: { ...base.facts, ...saved.facts }
    };
  } catch {
    return createState();
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    return false;
  }
  return true;
}

export function hasSave() {
  try {
    return Boolean(localStorage.getItem(SAVE_KEY));
  } catch {
    return false;
  }
}

export function addItem(state, id) {
  if (!ITEM_LABELS[id] || state.inventory.includes(id)) return false;
  state.inventory.push(id);
  return true;
}

export function removeItem(state, id) {
  const index = state.inventory.indexOf(id);
  if (index < 0) return false;
  state.inventory.splice(index, 1);
  return true;
}

export function markPicked(state, id) {
  if (state.pickedUp.includes(id)) return false;
  state.pickedUp.push(id);
  return true;
}

export function remember(state, npcId, patch) {
  state.memories[npcId] = { ...state.memories[npcId], ...patch };
}

export function formatClock(minutes) {
  const dayMinutes = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(dayMinutes / 60);
  const mins = dayMinutes % 60;
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(mins).padStart(2, '0')} ${period}`;
}
