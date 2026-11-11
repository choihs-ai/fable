// 축복 3택1: 가질 수 있는 축복을 추리고 후보를 뽑는다. 축복의 효과는 logic/combat/boons.js 에 있다.

import { BOONS, BOON_RULES } from '../../../data/boons.js';

/** 가진 축복들의 계열. */
export function familiesOf(owned) {
  const out = new Set();
  for (const id of owned) {
    if (Object.hasOwn(BOONS, id) && BOONS[id].family) out.add(BOONS[id].family);
  }
  return out;
}

/** 지금 얻을 수 있는 축복: 아직 없고, 합성 축복이면 두 계열을 모두 가지고 있어야 한다. */
export function eligibleBoons(owned) {
  const families = familiesOf(owned);
  const out = [];
  for (const id of Object.keys(BOONS)) {
    if (owned.includes(id)) continue;
    const def = BOONS[id];
    if (def.duo && !(families.has(def.duo[0]) && families.has(def.duo[1]))) continue;
    out.push(id);
  }
  return out;
}

/**
 * 후보를 뽑는다(겹치지 않게, 가중치로). 후보가 모자라면 있는 만큼만.
 * @param {import('../core/prng.js').Rng} rng
 * @param {string[]} owned 가진 축복
 * @param {string[]} [avoid] 되도록 피할 축복(다시 뽑기 직전의 후보)
 * @returns {string[]}
 */
export function rollBoonChoices(rng, owned, avoid = []) {
  let pool = eligibleBoons(owned);
  const fresh = pool.filter((id) => !avoid.includes(id));
  if (fresh.length >= BOON_RULES.choices) pool = fresh;
  const picked = [];
  while (picked.length < BOON_RULES.choices && pool.length > 0) {
    const weights = pool.map((id) => BOONS[id].weight * (BOONS[id].duo ? BOON_RULES.duoWeightMul : 1));
    const index = rng.weightedIndex(weights);
    picked.push(pool[index]);
    pool = pool.filter((_, i) => i !== index);
  }
  return picked;
}

/** 후보를 다시 뽑는 값(금화). */
export function rerollCost(rerolls) {
  return BOON_RULES.reroll.base + BOON_RULES.reroll.step * rerolls;
}
