// A complete playthrough, driven the way a player drives it: taking dialogue
// choices, picking things up, watching the wall at dusk, carrying marks back and
// forth. Every other test in this project sets quest state directly, so a quest
// chain could be impossible to finish and every suite would still pass. This is the
// check that the game can actually be completed, and that the ending can be reached.
//
// It is a script rather than a fuzz: the goal is to prove the authored chains
// connect, not to explore every branch.

import {
  createInitialState, questStatus, coins, hasItem,
  pickUpKey, returnKey, startCheer, watchLanterns, tellPipAboutLanterns,
  startToll, collectToll, waiveToll, finishToll,
  startLedger, hearLedgerRumour, recoverLedger, returnLedger,
  startArrears, deliverArrears, reissueArrearsMark, finishArrears,
  nightLightUnlocked, startNightLight, questCounts
} from '../src/state.js';
import { lightLaneLanterns, laneLanternsAtDawn } from '../src/areas.js';
import { startConversation, applyChoice } from '../src/dialogue.js';
import { buildEpilogue, storyComplete } from '../src/epilogue.js';
import { reputation, tierFor } from '../src/factions.js';

/** Take the first dialogue choice whose label matches, failing loudly if absent. */
function talk(state, npcId, matcher, log) {
  const node = startConversation(state, npcId);
  if (!node) throw new Error(`no conversation with ${npcId}`);
  const index = node.choices.findIndex((choice) => matcher.test(choice.label));
  if (index === -1) {
    throw new Error(`${npcId}: nothing matching ${matcher}; offered: ${node.choices.map((c) => c.label).join(' | ')}`);
  }
  const result = applyChoice(state, npcId, node.choices[index]);
  log(`${npcId}: ${result.message}`);
  return result;
}

/**
 * Play the whole game. Throws if any step is unavailable, so a broken chain fails
 * this script rather than silently leaving a quest unfinished.
 */
export function runPlaythrough({ log = () => {} } = {}) {
  const state = createInitialState();

  // --- 1. The Failing Lantern: buy oil, carry it back ----------------------
  talk(state, 'mara', /lanterns look low/i, log);
  talk(state, 'oswin', /lantern oil|Pay \d+ coins/i, log);
  talk(state, 'mara', /lantern oil|oil/i, log);
  require(state, 'lanterns', log);

  // --- 2. Halden's key: start it, pick it up, hand it back ------------------
  talk(state, 'halden', /lost something/i, log);
  const picked = pickUpKey(state);
  if (!picked.changed) throw new Error(`picking up the key failed: ${picked.message}`);
  log(`key: ${picked.message}`);
  const returned = returnKey(state);
  if (!returned.changed) throw new Error(`returning the key failed: ${returned.message}`);
  log(`key: ${returned.message}`);
  require(state, 'key', log);

  // --- 3. Pip's favour: watch the wall at dusk, then tell her ---------------
  talk(state, 'pip', /special about the lanterns/i, log);
  const watched = watchLanterns(state, 'dusk');
  log(`pip: ${watched.message}`);
  const told = tellPipAboutLanterns(state);
  if (!told.changed) throw new Error(`telling Pip failed: ${told.message}`);
  log(`pip: ${told.message}`);
  require(state, 'cheer', log);

  // --- 4. The market toll --------------------------------------------------
  // The toll has two resolutions and the player picks whichever they can afford:
  // pay it out of pocket, or have enough standing with the Watch to talk Halden
  // round. This run pays, because that path is available from the start -- but the
  // script checks which is actually open rather than assuming.
  const tollStarted = startToll(state);
  if (!tollStarted.changed) throw new Error(`starting the toll failed: ${tollStarted.message}`);
  log(`toll: ${tollStarted.message}`);
  const watchTier = watchTierNow(state);
  let tollStep = 'none';
  if (coins(state) >= 5) {
    const paid = collectToll(state);
    if (!paid.changed) throw new Error(`paying the toll failed: ${paid.message}`);
    tollStep = 'paid';
    log(`toll: ${paid.message}`);
  } else {
    const waived = waiveToll(state, watchTier);
    if (!waived.changed) {
      throw new Error(`cannot pay (${coins(state)} coins) and cannot waive at ${watchTier}: ${waived.message}`);
    }
    tollStep = 'waived';
    log(`toll: ${waived.message}`);
  }
  const tollDone = finishToll(state);
  if (!tollDone.changed) throw new Error(`finishing the toll failed: ${tollDone.message}`);
  log(`toll: ${tollDone.message} (${tollStep})`);
  require(state, 'toll', log);

  // --- 5. Wren's ledger: rumour, recovery, and a choice about the name -----
  const ledgerStarted = startLedger(state, tierFor(reputation(state, 'trade')).id);
  if (ledgerStarted.changed === false) throw new Error(`starting the ledger failed: ${ledgerStarted.message}`);
  log(`ledger: ${ledgerStarted.message}`);
  // Wren has to point you at the barrels before searching them means anything.
  const rumour = hearLedgerRumour(state);
  if (!rumour.changed) throw new Error(`hearing the rumour failed: ${rumour.message}`);
  log(`ledger: ${rumour.message}`);
  const recovered = recoverLedger(state);
  if (!recovered.changed) throw new Error(`recovering the ledger failed: ${recovered.message}`);
  log(`ledger: ${recovered.message}`);
  const ledgerReturned = returnLedger(state, 'name');
  if (!ledgerReturned.changed) throw new Error(`returning the ledger failed: ${ledgerReturned.message}`);
  log(`ledger: ${ledgerReturned.message}`);
  require(state, 'ledger', log);

  // --- 6. The lane's arrears: carry a pouch south, bring a mark back -------
  const arrearsStarted = startArrears(state);
  if (arrearsStarted.changed === false) throw new Error(`starting arrears failed: ${arrearsStarted.message}`);
  log(`arrears: ${arrearsStarted.message}`);
  const delivered = deliverArrears(state, 'pay');
  if (!delivered.changed) throw new Error(`delivering arrears failed: ${delivered.message}`);
  log(`arrears: ${delivered.message}`);
  const reissued = reissueArrearsMark(state);
  if (reissued.changed) log(`arrears: ${reissued.message}`);
  const arrearsDone = finishArrears(state);
  if (!arrearsDone.changed) throw new Error(`finishing arrears failed: ${arrearsDone.message}`);
  log(`arrears: ${arrearsDone.message}`);
  require(state, 'arrears', log);

  // --- 7. The Night Light: Oswin's paid round, gated on a lit lane ----------
  // Two nights: the first lighting unlocks his offer, the second walks it.
  const firstLight = lightLaneLanterns(state, 'dusk');
  if (!firstLight.changed) throw new Error(`first lane lighting failed: ${firstLight.message}`);
  log(`nightlight: ${firstLight.message}`);
  talk(state, 'oswin', /What kind of work/i, log);
  requireStep(state, 'nightlight', 'started', log);
  const dawn = laneLanternsAtDawn(state, 'day');
  if (!dawn.reset) throw new Error('dawn did not reset the lane');
  log('nightlight: dawn reset the lane');
  const secondLight = lightLaneLanterns(state, 'dusk');
  if (!secondLight.changed) throw new Error(`second lane lighting failed: ${secondLight.message}`);
  log(`nightlight: ${secondLight.message}`);
  talk(state, 'oswin', /night order/i, log);
  require(state, 'nightlight', log);

  return { state, counts: questCounts(state), ended: buildEpilogue(state) };
}

/** The player's current Watch standing, as the tier the game itself uses. */
function watchTierNow(state) {
  return tierFor(reputation(state, 'watch')).id;
}

function require(state, questId, log) {
  const status = questStatus(state, questId);
  if (status !== 'done') throw new Error(`${questId} ended as "${status}", not done`);
  log(`  ✓ ${questId} complete`);
}


function requireStep(state, questId, step, log) {
  const status = questStatus(state, questId);
  if (status !== step) throw new Error(`${questId} ended as "${status}", not ${step}`);
  log(`  ✓ ${questId} ${step}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const { state, counts, ended } = runPlaythrough({ log: (line) => console.log('  ' + line) });
    console.log(`\nquests: ${counts.done}/${counts.done + counts.active} done`);
    console.log(`coins: ${coins(state)} | items: ${state.inventory.length}`);
    console.log(`story complete: ${storyComplete(state)} | epilogue: ${ended ? ended.title : 'none'}`);
    if (ended) ended.branches.forEach((b) => console.log('  branch:', b.text.slice(0, 70)));
    process.exit(storyComplete(state) ? 0 : 1);
  } catch (error) {
    console.error('PLAYTHROUGH FAILED:', error.message);
    process.exit(1);
  }
}
