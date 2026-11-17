// Dialogue and quests are data. Each NPC exposes `talk(state, ctx)` which
// returns a node: { speaker, text, choices }. A choice can run an action
// (`do`) and then either jump to another node (`next`) or close the dialogue.
//
// Keeping this pure makes the story testable without a browser: see
// tests/dialogue.test.mjs, which walks every branch.

import {
  questStatus,
  hasItem,
  coins,
  memoryFor,
  startLanterns,
  buyOilWithCoins,
  buyOilWithPromise,
  deliverOil,
  startKey,
  pickUpKey,
  returnKey,
  startCheer,
  tellPipAboutLanterns,
  remember
} from './state.js';

const node = (speaker, text, choices = []) => ({ speaker, text, choices });

const say = (text) => ({ label: text, do: () => ({}) });
const end = (label) => ({ label, end: true });

// Closing out Oswin's ledger is offered anywhere he is owed money, so a player
// who changes their mind can still make good on the promise.
const settleDebtChoice = (state) => ({
  label: 'Settle the debt — 4 coins.',
  do: () => {
    if (coins(state) < 4) return { changed: false, message: 'Oswin taps the ledger. “Four coins. I can wait.”' };
    state.flags.coins = coins(state) - 4;
    state.perks.oswin_debt = false;
    return { changed: true, message: 'Debt settled with Oswin.', topic: 'settled' };
  }
});

// Every action returns { changed, message }; dialogue wrappers just remember the
// topic so NPCs can react next time you speak to them.

const mara = {
  id: 'mara',
  name: 'Mara the Keeper',
  talk(state, ctx) {
    const status = questStatus(state, 'lanterns');
    const mem = memoryFor(state, 'mara');

    if (status === 'oil_bought' && hasItem(state, 'lantern_oil')) {
      return node(
        'Mara the Keeper',
        mem.talks > 0 ? 'You came back. Good. Hand it over, then.' : 'That flask is Oswin’s, no mistake. You have the oil. Hand it over?',
        [
        {
          label: 'Here — the lantern oil.',
          do: () => ({ ...deliverOil(state), topic: 'delivered', opinion: 1 }),
          next: () => node('Mara the Keeper', 'Mara holds the flask up to the lamplight and smiles for the first time. “The plaza will be bright tonight. Take this — and my word.”')
        },
          { label: 'Not yet.', end: true }
        ]
      );
    }

    if (status === 'done') {
      return node(
        'Mara the Keeper',
        'The north lantern burns steady now. You did that.',
        [
          { label: 'Who keeps the lanterns usually?', next: () => node('Mara the Keeper', 'I do. Twenty years of trimming wicks. My hands know the work better than my eyes do.') },
          { label: 'Ask about Oswin.', next: () => node('Mara the Keeper', state.perks.oswin_debt ? 'Oswin tells me you owe him. Settle it when you can — he remembers every debt.' : 'Oswin is honest enough, for a trader. He just never lets a favour go.') },
          end('Leave')
        ]
      );
    }

    if (status === 'started') {
      return node(
        'Mara the Keeper',
        'Oswin sells the only good oil in the plaza. Go on — before the wick gives out.',
        [
          { label: 'Where is Oswin’s stall?', next: () => node('Mara the Keeper', 'East side, past the fountain. You cannot miss the red awning.') },
          end('Leave')
        ]
      );
    }

    return node(
      'Mara the Keeper',
      mem.talks > 0 ? 'Back again. The lanterns still need oil, if you are offering.' : 'You came on foot? Nobody walks the north road this late.',
      [
        {
          label: 'The lanterns look low. What is wrong?',
          do: () => ({ ...startLanterns(state), topic: 'lanterns', opinion: 1 }),
          next: () => node('Mara the Keeper', 'The north one has been guttering for three nights. One flask of good oil would hold it until the weather turns.', [
            { label: 'I will find some oil.', end: true },
            { label: 'Four nights of guttering and nobody noticed?', next: () => node('Mara the Keeper', 'I noticed. I have been carrying the whole plaza’s light on my own shoulders.') }
          ])
        },
        { label: 'Who are you?', next: () => node('Mara the Keeper', 'Mara. Keeper of this plaza: the lanterns, the fountain, and the peace between them.') },
        end('Leave')
      ]
    );
  }
};

const oswin = {
  id: 'oswin',
  name: 'Oswin the Trader',
  talk(state, ctx) {
    const status = questStatus(state, 'lanterns');
    const mem = memoryFor(state, 'oswin');

    if (status === 'started') {
      return node('Oswin the Trader', `Lantern oil? The good stuff. Four coins${state.perks.oswin_debt ? ', or another promise' : ' — or a promise I can call in later'}.`, [
        {
          label: `Pay 4 coins (you have ${coins(state)}).`,
          do: () => ({ ...buyOilWithCoins(state), topic: 'bought_oil', opinion: 1 })
        },
        {
          label: 'I will owe you one.',
          do: () => ({ ...buyOilWithPromise(state), topic: 'promised_oil', opinion: -1 })
        },
        { label: 'Never mind.', end: true }
      ]);
    }

    if (status === 'oil_bought') {
      return node('Oswin the Trader', 'The oil is yours to carry. You are paying for it one way or another.', [
        ...(state.perks.oswin_debt ? [settleDebtChoice(state)] : []),
        end('Leave')
      ]);
    }

    if (status === 'done') {
      return node(
        'Oswin the Trader',
        state.perks.oswin_debt
          ? 'There you are. My ledger still has your name in it. One favour, whenever I ask.'
          : 'Paid in full. Mara’s lanterns and my purse both thank you.',
        [
          ...(state.perks.oswin_debt ? [settleDebtChoice(state)] : []),
          { label: 'What do you sell?', next: () => node('Oswin the Trader', 'Oil, rope, old keys, other people’s stories. The stories sell best.') },
          end('Leave')
        ]
      );
    }

    return node(
      'Oswin the Trader',
      mem.talks > 0 ? 'Still browsing? Everything is for sale twice over.' : 'Stall is open. Everything worth having is worth haggling for.',
      [
        { label: 'Do you have lantern oil?', next: () => node('Oswin the Trader', 'Always. Bring Mara’s name and I will even be polite about the price.') },
        { label: 'Ask about Halden.', next: () => node('Oswin the Trader', 'The guard? Lost his gate key again, I hear. Careless man for someone who watches doors.') },
        end('Leave')
      ]
    );
  }
};

const pip = {
  id: 'pip',
  name: 'Pip',
  talk(state) {
    const status = questStatus(state, 'cheer');
    const mem = memoryFor(state, 'pip');

    if (status === 'watched') {
      return node('Pip', 'Well? Did you see it? Did you stand on the wall when they lit?', [
        {
          label: 'I did. The whole plaza went gold.',
          do: () => ({ ...tellPipAboutLanterns(state), topic: 'lanterns_seen', opinion: 2 }),
          next: () => node('Pip', 'I knew it. Nobody ever goes and looks. Here — take my ribbon. It is the only thing I have that is worth anything.')
        },
        { label: 'Not yet, but soon.', end: true }
      ]);
    }

    if (status === 'done') {
      return node('Pip', mem.opinion > 0 ? 'You still wear my ribbon? Good. It means you keep promises.' : 'The lanterns really do look like that, then. I knew it.', [
        { label: 'Who lights them?', next: () => node('Pip', 'Mara. Every evening, exact as a bell. She will not let anyone else touch the wicks.') },
        { label: 'Why not go up and look yourself?', next: () => node('Pip', 'The stairs to the north wall are not for children. Halden says so, and Halden is very serious.') },
        end('Leave')
      ]);
    }

    if (status === 'started') {
      return node('Pip', 'You have to be on the wall when the sky turns. Not before, not after.', [
        { label: 'Why the wall?', next: () => node('Pip', 'Because from the wall you see all four lanterns light at once. From down here you only see one.') },
        end('Leave')
      ]);
    }

    return node(
      'Pip',
      mem.talks > 0 ? 'Back again! You never come when there is anything to see.' : 'Have you seen the lanterns at dusk? That is the whole reason to live here.',
      [
        {
          label: 'What is so special about the lanterns?',
          do: () => ({ ...startCheer(state), topic: 'cheer', opinion: 1 }),
          next: () => node('Pip', 'They all light at once. If you stood on the north wall when the sky turns, you would see it properly. Will you?', [
            { label: 'I will go and look.', end: true },
            { label: 'That sounds like a lot of stairs.', next: () => node('Pip', 'It is only a few. Please?') }
          ])
        },
        { label: 'What do you do around here?', next: () => node('Pip', 'Run messages, mostly. And notice things nobody asks me about.') },
        end('Leave')
      ]
    );
  }
};

const halden = {
  id: 'halden',
  name: 'Halden the Guard',
  talk(state) {
    const status = questStatus(state, 'key');
    const mem = memoryFor(state, 'halden');

    if (status === 'found' && hasItem(state, 'brass_key')) {
      return node('Halden the Guard', 'That is my key. Where — never mind. Hand it here.', [
        {
          label: 'Here it is.',
          do: () => ({ ...returnKey(state), topic: 'key_returned', opinion: 2 }),
          next: () => node('Halden the Guard', 'You are a better finder than I am a keeper. If Oswin gives you trouble, tell him I said you are square with the watch.')
        },
        { label: 'What is it worth to you?', next: () => node('Halden the Guard', 'A guard’s goodwill. Which is worth more than it sounds.', [
          {
            label: 'Fine. Here.',
            do: () => ({ ...returnKey(state), topic: 'key_returned', opinion: 1 })
          },
          end('Walk away')
        ]) }
      ]);
    }

    if (status === 'done') {
      return node('Halden the Guard', 'Gate is locked proper again. Much obliged.', [
        { label: 'Who else has a key?', next: () => node('Halden the Guard', 'Mara, the captain, and me. That is the whole list, and it stays that way.') },
        end('Leave')
      ]);
    }

    if (status === 'started') {
      return node('Halden the Guard', 'Any luck? I dropped it this morning, on my rounds. South-east, by the crates.', [
        { label: 'Why not search yourself?', next: () => node('Halden the Guard', 'Because I am standing here guarding. That is the whole job.') },
        end('Leave')
      ]);
    }

    return node(
      'Halden the Guard',
      mem.talks > 0 ? 'Still here. Still guarding.' : 'Keep off the walls and we will get along fine.',
      [
        {
          label: 'You look like you lost something.',
          do: () => ({ ...startKey(state), topic: 'key_lost', opinion: 1 }),
          next: () => node('Halden the Guard', 'The brass gate key. Dropped it somewhere on my rounds this morning. Find it and I will owe you.', [
            { label: 'I will look.', end: true },
            { label: 'Have you checked by the crates?', next: () => node('Halden the Guard', 'South-east crates. That is the last place I remember having it.') }
          ])
        },
        { label: 'Tell me about the plaza.', next: () => node('Halden the Guard', 'Walls are for keeping the weather out. Mostly. The rest they keep out too.') },
        end('Leave')
      ]
    );
  }
};

// Sable is the plaza's mapmaker: a quieter character whose lines change with
// what the player knows, and who explains the north terrace for new players.
const sable = {
  id: 'sable',
  name: 'Sable the Cartographer',
  talk(state) {
    const mem = memoryFor(state, 'sable');
    const seenTerrace = state.flags.seen_terrace;
    const knowsKey = questStatus(state, 'key') !== 'none';
    const knowsLanterns = questStatus(state, 'lanterns') !== 'none';

    if (knowsKey || knowsLanterns) {
      const notes = [];
      if (knowsLanterns) notes.push('Mara’s lantern is the north one. You can see the whole ring from up on the terrace.');
      if (knowsKey) notes.push('Halden’s key will be in the grass. Small brass things always are.');
      return node(
        'Sable the Cartographer',
        `You have been busy. ${notes[0]}`,
        [
          ...(notes.length > 1 ? [{ label: 'What did you say about the key?', next: () => node('Sable the Cartographer', notes[1]) }] : []),
          { label: 'How do I get up on the terrace?', next: () => node('Sable the Cartographer', 'Ramp on the west end, past Mara’s house. Steep, but the view is worth the climb.') },
          { label: 'Show me what you are drawing.', next: () => node('Sable the Cartographer', 'The plaza, four times over. One for each hour the light changes. The dusk sheet is the one I keep redrawing.') },
          end('Leave')
        ]
      );
    }

    return node(
      'Sable the Cartographer',
      mem.talks > 0
        ? 'You again. Still no map of your own, I notice.'
        : 'Mind the ink. This is the fourth map of this plaza I have drawn, and the only one that is right.',
      [
        {
          label: 'Why four maps?',
          do: () => ({ topic: 'maps', opinion: 1 }),
          next: () => node('Sable the Cartographer', 'Because the plaza is not the same place at dawn, at noon, at dusk and at night. The lanterns redraw it every evening.', [
            { label: 'Where can I see all of it at once?', next: () => node('Sable the Cartographer', 'The north terrace. Climb the ramp on its west end and you will see all four lanterns together when they light.') },
            { label: 'Which hour do you like best?', next: () => node('Sable the Cartographer', 'Dusk. Always dusk. Everything goes gold for about a minute and then it is over.') }
          ])
        },
        { label: 'What do you know about the people here?', next: () => node('Sable the Cartographer', 'Mara keeps the light. Halden keeps the gate. Oswin keeps accounts of everyone. Pip keeps secrets badly.') },
        end('Leave')
      ]
    );
  }
};

export const DIALOGUE = { mara, oswin, pip, halden, sable };

/** Runs a choice's action, records NPC memory and returns { changed, message }. */
export function applyChoice(state, npcId, choice) {
  let result = { changed: false, message: '' };
  if (typeof choice?.do === 'function') {
    result = choice.do() || result;
  }
  remember(state, npcId, { topic: result.topic, opinionDelta: result.opinion || 0 });
  return result;
}

/** Starts talking to an NPC and returns the opening node, or null. */
export function startConversation(state, npcId) {
  const npc = DIALOGUE[npcId];
  if (!npc) return null;
  return npc.talk(state, {});
}