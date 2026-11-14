// The economy: money between rounds, the buy menu's prices and the rewards that
// make winning rounds pay. A loss streak softens the blow, as in the genre: the
// first loss pays $1,900, the second $2,400, then $2,900, capped.
import { WEAPONS, GRENADES, ARMOR_PRICE } from './weapons.js';

export const START_MONEY = 800;
export const KILL_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_REWARDS = [1900, 2400, 2900];
export const PLANT_REWARD = 300;

export const BUY_MENU = [
  { kind: 'weapon', id: 'smg', name: WEAPONS.smg.name, price: WEAPONS.smg.price, desc: 'Fast close-range spray, 28-round mag' },
  { kind: 'weapon', id: 'rifle', name: WEAPONS.rifle.name, price: WEAPONS.rifle.price, desc: 'Accurate all-rounder, 25-round mag' },
  { kind: 'weapon', id: 'sniper', name: WEAPONS.sniper.name, price: WEAPONS.sniper.price, desc: 'One-shot body damage, 5-round mag, scope on right click' },
  { kind: 'grenade', id: 'frag', name: GRENADES.frag.name, price: GRENADES.frag.price, desc: 'Timed explosive, heavy area damage' },
  { kind: 'grenade', id: 'smoke', name: GRENADES.smoke.name, price: GRENADES.smoke.price, desc: 'Blocks sight for 14 seconds' },
  { kind: 'armor', id: 'armor', name: 'Forge plate', price: ARMOR_PRICE, desc: 'Absorbs half of incoming damage' },
];

export function lossReward(streak) {
  return LOSS_REWARDS[Math.min(streak, LOSS_REWARDS.length - 1)];
}
