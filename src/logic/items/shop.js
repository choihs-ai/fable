// 상점: 진열품을 뽑고 값을 매긴다. 사는 일(금화 차감, 무기·축복 지급)은 commands.js 가 한다.

import { SHOP } from '../../../data/shop.js';
import { WEAPONS, WEAPON_ORDER } from '../../../data/weapons.js';
import { eligibleBoons } from './boons.js';
import { BOONS } from '../../../data/boons.js';

/** 무기 하나를 등급 가중치로 뽑는다. exclude 에 든 것은 피한다(전부 겹치면 아무거나). */
export function rollWeapon(rng, exclude = []) {
  let pool = WEAPON_ORDER.filter((id) => !exclude.includes(id));
  if (pool.length === 0) pool = WEAPON_ORDER.slice();
  return pool[rng.weightedIndex(pool.map((id) => SHOP.tierWeights[WEAPONS[id].tier]))];
}

export function weaponPrice(id) {
  return SHOP.price.weapon[WEAPONS[id].tier];
}

/**
 * 진열품을 뽑는다.
 * @param {import('../core/prng.js').Rng} rng
 * @param {string[]} ownedBoons 가진 축복(진열하지 않는다)
 * @param {string[]} heldWeapons 든 무기(진열하지 않는다)
 * @returns {{ kind:string, weapon?:string, boon?:string, price:number, sold:boolean }[]}
 */
export function rollShopStock(rng, ownedBoons, heldWeapons) {
  const stock = [];
  const weapons = [];
  for (let i = 0; i < SHOP.weapons; i++) {
    const id = rollWeapon(rng, heldWeapons.concat(weapons));
    weapons.push(id);
    stock.push({ kind: 'weapon', weapon: id, price: weaponPrice(id), sold: false });
  }
  let pool = eligibleBoons(ownedBoons);
  for (let i = 0; i < SHOP.boons && pool.length > 0; i++) {
    const index = rng.weightedIndex(pool.map((id) => BOONS[id].weight));
    stock.push({ kind: 'boon', boon: pool[index], price: SHOP.price.boon, sold: false });
    pool = pool.filter((_, k) => k !== index);
  }
  stock.push({ kind: 'heal', price: SHOP.price.heal, sold: false });
  return stock;
}

export function shopRerollCost(rerolls) {
  return SHOP.reroll.base + SHOP.reroll.step * rerolls;
}

export function healPrice(heals) {
  return SHOP.price.heal + SHOP.healStep * heals;
}
