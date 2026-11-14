// The one place state lives: phase, round, score, timer, money and the agent list.
// Nothing else in the game keeps a copy of these numbers; modules read and write
// through this object so a round reset is one function call.
export const ROUND_TIME = 100;
export const FREEZE_TIME = 8;
export const MAX_ROUNDS = 9;
export const WIN_ROUNDS = 5;

export function createState() {
  return {
    phase: 'menu', // menu | freeze | live | roundEnd | matchEnd
    round: 1,
    score: { vanguard: 0, sentinel: 0 },
    lossStreak: { vanguard: 0, sentinel: 0 },
    timer: ROUND_TIME,
    freezeLeft: FREEZE_TIME,
    roundEndLeft: 0,
    winner: null,
    matchWinner: null,
    time: 0,
    agents: [],
    player: null,
    seenEnemies: new Set(),
    noise: [],
  };
}

export function resetRoundState(state) {
  state.phase = 'freeze';
  state.timer = ROUND_TIME;
  state.freezeLeft = FREEZE_TIME;
  state.roundEndLeft = 0;
  state.winner = null;
  state.seenEnemies.clear();
  state.noise.length = 0;
}
