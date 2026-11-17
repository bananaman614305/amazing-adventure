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
  returnKey,
  startCheer,
  tellPipAboutLanterns,
  startToll,
  collectToll,
  waiveToll,
  finishToll,
  startLedger,
  hearLedgerRumour,
  recoverLedger,
  returnLedger,
  ledgerUnlocked,
  LEDGER_REWARD,
  TOLL_COST,
  remember
} from './state.js';
import { npcTier, FACTIONS, NPC_FACTION } from './factions.js';

/**
 * A one-line greeting suffix that reflects how the NPC's faction currently
 * sees the player. Returns '' at neutral so ordinary lines stay unchanged.
 */
function standingGreeting(state, npcId) {
  const tier = npcTier(state, npcId).id;
  const faction = FACTIONS[NPC_FACTION[npcId]];
  if (!faction) return '';
  switch (tier) {
    case 'hostile':
      return ` Every ${faction.member} in this plaza has heard of you, and none of it is kind.`;
    case 'cold':
      return ` Word travels, and the ${faction.collective} have been careful around you since.`;
    case 'warm':
      return ` ${faction.name} are saying good things about you.`;
    case 'trusted':
      return ` You have done enough for the ${faction.collective} that nobody questions you now.`;
    default:
      return '';
  }
}

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
      mem.talks > 0
        ? `Back again. The lanterns still need oil, if you are offering.${standingGreeting(state, 'mara')}`
        : `You came on foot? Nobody walks the north road this late.${standingGreeting(state, 'mara')}`,
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
      mem.talks > 0
        ? `Still browsing? Everything is for sale twice over.${standingGreeting(state, 'oswin')}`
        : `Stall is open. Everything worth having is worth haggling for.${standingGreeting(state, 'oswin')}`,
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
      mem.talks > 0
        ? `Back again! You never come when there is anything to see.${standingGreeting(state, 'pip')}`
        : `Have you seen the lanterns at dusk? That is the whole reason to live here.${standingGreeting(state, 'pip')}`,
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
        tollChoice(state),
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
      mem.talks > 0
        ? `Still here. Still guarding.${standingGreeting(state, 'halden')}`
        : `Keep off the walls and we will get along fine.${standingGreeting(state, 'halden')}`,
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

// --- The Market Toll dialogue -------------------------------------------
// Halden offers the toll once he trusts you with the key. Both resolutions are
// on the table at once, and the player can only take one: that is the point.

function tollChoice(state) {
  const status = questStatus(state, 'toll');

  if (status === 'none') {
    return {
      label: 'Ask about the gate toll.',
      next: () => node(
        'Halden the Guard',
        'Oswin has not paid the gate toll in three weeks. Fetch the money, or talk me into letting it go. Your choice.',
        [
          {
            label: 'I will get your toll.',
            do: () => ({ ...startToll(state), topic: 'toll', opinion: 1 }),
            // Stay in the conversation and offer the decision straight away.
            next: () => tollOptionsNode(state)
          },
          {
            label: 'What if I argued for him instead?',
            do: () => ({ ...startToll(state), topic: 'toll', opinion: 0 }),
            next: () => tollOptionsNode(state)
          },
          end('Later')
        ]
      )
    };
  }

  if (status === 'started') {
    return { label: 'About Oswin’s toll.', next: () => tollOptionsNode(state) };
  }

  if (status === 'collected') {
    return {
      label: 'Hand over the toll money.',
      do: () => ({ ...finishToll(state), topic: 'toll_paid', opinion: 1 }),
      next: () => node('Halden the Guard', 'Counted and logged. The Watch remembers who squares up.')
    };
  }

  if (status === 'waived') {
    return {
      label: 'Tell Halden the toll is settled.',
      do: () => ({ ...finishToll(state), topic: 'toll_settled', opinion: 0 }),
      next: () => node('Halden the Guard', 'Waived and witnessed. You are collecting favours like a trader. Be careful whose.')
    };
  }

  return {
    label: 'About the toll.',
    next: () => node(
      'Halden the Guard',
      'The toll is settled. Do not expect me to forget which way you settled it.'
    )
  };
}

/** The actual decision: pay the Watch or side with the Market. */
function tollOptionsNode(state) {
  return node(
    'Halden the Guard',
    `The toll. ${TOLL_COST} coins, or a good reason why not.`,
    [
      {
        label: `Pay it myself (${TOLL_COST} coins).`,
        do: () => ({ ...collectToll(state) })
      },
      {
        label: 'Waive it. He has had a hard season.',
        do: () => {
          // The tier is read when the choice is taken, not when it was drawn.
          const result = waiveToll(state, npcTier(state, 'halden').id);
          return { ...result, topic: result.changed ? 'toll_waived' : 'toll_refused', opinion: result.changed ? 1 : 0 };
        },
        next: () => node('Halden the Guard', '...Fine. Put it on my conscience, not my ledger. Do not make me regret it.')
      },
      end('Not yet')
    ]
  );
}

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
        ? `You again. Still no map of your own, I notice.${standingGreeting(state, 'sable')}`
        : `Mind the ink. This is the fourth map of this plaza I have drawn, and the only one that is right.${standingGreeting(state, 'sable')}`,
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

// Wren keeps the toll ledger in the market lane. She is the faction gate: her
// quest is refused below Warm Market standing, which makes the reputation built
// in the plaza the thing that opens the lane's story.
const wren = {
  id: 'wren',
  name: 'Wren the Toll Clerk',
  talk(state) {
    const mem = memoryFor(state, 'wren');
    const tier = npcTier(state, 'wren').id;
    const status = questStatus(state, 'ledger');
    const greeting = standingGreeting(state, 'wren');
    const unlocked = ledgerUnlocked(state, tier);

    if (status === 'none') {
      if (!unlocked) {
        return node(
          'Wren the Toll Clerk',
          `Wren does not look up from her book. “Market business is for people the Market trusts. Come back when it does.”${greeting}`,
          [
            { label: 'What would earn that trust?', next: () => node('Wren the Toll Clerk', 'Dues paid. Promises kept. Oswin at his stall with his accounts in order. It is not complicated, it is just slow.') },
            end('Leave')
          ]
        );
      }
      return node(
        'Wren the Toll Clerk',
        mem.talks > 0
          ? `Wren marks her page. “Back again. Still nobody has owned up.”${greeting}`
          : `Wren runs a finger down a column of numbers. “My toll ledger is missing. A quarter of the lane’s takings, gone, and every trader here suddenly cannot remember their own name.”${greeting}`,
        [
          {
            label: 'I could look for it.',
            do: () => startLedger(state, tier),
            next: () => node('Wren the Toll Clerk', '“Then look. I want the ledger and I want the name of whoever took it.”')
          },
          { label: 'That sounds like your problem.', next: () => node('Wren the Toll Clerk', '“It is everybody’s problem. The toll is how the gate stays lit and the gate is how the lane stays open.”') },
          end('Leave')
        ]
      );
    }

    if (status === 'started') {
      return node(
        'Wren the Toll Clerk',
        '“The ledger is somewhere in this lane. Nobody here admits to anything, but nobody here is a good liar either.”',
        [
          {
            label: 'Any idea who took it?',
            do: () => hearLedgerRumour(state),
            next: () => node('Wren the Toll Clerk', 'Wren lowers her voice. “The quarter is in the ledgers by the barrels. Ask yourself who would want the page with the arrears on it. Then look behind a barrel.”')
          },
          end('Leave')
        ]
      );
    }

    if (status === 'booked') {
      return node(
        'Wren the Toll Clerk',
        '“Behind the barrels by the far wall. Go and look, and do not touch anything else.”',
        [ end('Leave') ]
      );
    }

    if (status === 'recovered') {
      return node(
        'Wren the Toll Clerk',
        'You set the toll ledger on the stall. Wren opens it and finds the page she has been looking for. “Now. Whose name do I write?”',
        [
          {
            label: `Name the trader honestly. (Watch +20, Market -10, ${LEDGER_REWARD} coins)`,
            do: () => returnLedger(state, 'name')
          },
          {
            label: 'Cover for the trader. (Market +20, Watch -10)',
            do: () => returnLedger(state, 'cover')
          },
          end('Not yet')
        ]
      );
    }

    return node(
      'Wren the Toll Clerk',
      status === 'done'
        ? 'Wren’s ledger is open at a fresh page, and she is writing in it. “Busy. The lane pays its toll now, one way or another.”'
        : '“Mind the ledger.”',
      [
        { label: 'How are the accounts?', next: () => node('Wren the Toll Clerk', '“Balanced. Do not tell anyone, they might expect it more often.”') },
        end('Leave')
      ]
    );
  }
};

export const DIALOGUE = { mara, oswin, pip, halden, sable, wren };

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