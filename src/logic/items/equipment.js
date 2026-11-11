// 장비 생성. 옵션 값의 범위는 optionRange 한 곳에서 정해지고, 생성기는 그 범위 안에서만 뽑는다.

import { AFFIXES, BASES, DROPS, PRICES, RARITIES, RARITY, SETS, SLOTS } from '../../../data/items.js';

/** 메타 해금을 반영해, 풀에 들어갈 수 있는 항목인가. */
export function poolAllows(meta, entry) {
  return !entry.unlock || Boolean(meta && meta.unlocked && meta.unlocked[entry.unlock]);
}

/**
 * 옵션 하나가 가질 수 있는 값의 범위(양끝 포함, 정수).
 * @param {{min:number,max:number,growth:number}} option 고유 옵션 또는 무작위 옵션 정의
 * @param {string} rarity
 * @param {number} ilvl 아이템 레벨(1 이상)
 * @returns {[number, number]}
 */
export function optionRange(option, rarity, ilvl) {
  const mul = RARITY[rarity].valueMul * (1 + option.growth * (ilvl - 1));
  const lo = Math.max(1, Math.round(option.min * mul));
  const hi = Math.max(lo, Math.round(option.max * mul));
  return [lo, hi];
}

/** 그 층의 등급 가중치(RARITIES 순서). minRarity 보다 낮은 등급은 0 이 된다. */
export function rarityWeights(floor, minRarity = null) {
  const { base, perFloor } = DROPS.rarityWeights;
  const from = minRarity ? RARITIES.indexOf(minRarity) : 0;
  return base.map((b, i) => (i < from ? 0 : Math.max(0, b + perFloor[i] * (floor - 1))));
}

export function rollRarity(rng, floor, minRarity = null) {
  return RARITIES[rng.weightedIndex(rarityWeights(floor, minRarity))];
}

/** 그 부위에 붙을 수 있는 무작위 옵션들. */
export function affixPool(slot) {
  return AFFIXES.filter((a) => !a.slots || a.slots.includes(slot));
}

/** 지금 드롭될 수 있는 세트 id 들. */
export function availableSets(meta) {
  return Object.keys(SETS).filter((id) => poolAllows(meta, SETS[id]));
}

/**
 * 장비 하나를 만든다.
 * @param {import('../core/prng.js').Rng} rng
 * @param {object} spec
 * @param {number} spec.ilvl 아이템 레벨
 * @param {string} spec.rarity
 * @param {string} [spec.slot] 생략하면 무작위 부위
 * @param {string|null} [spec.setId] 세트 장비로 만들 때
 * @param {string} [spec.base] 기본 종류를 지정할 때(부위와 맞아야 한다)
 */
export function rollEquipment(rng, { ilvl, rarity, slot, setId = null, base }) {
  if (!RARITY[rarity]) throw new RangeError(`rollEquipment: 알 수 없는 등급 "${rarity}"`);
  if (!Number.isInteger(ilvl) || ilvl < 1) throw new RangeError(`rollEquipment: 잘못된 아이템 레벨 ${ilvl}`);
  const theSlot = slot ?? (base ? BASES[base].slot : rng.pick(SLOTS));
  if (!SLOTS.includes(theSlot)) throw new RangeError(`rollEquipment: 알 수 없는 부위 "${theSlot}"`);
  let baseId = base;
  if (setId) {
    if (!SETS[setId]) throw new RangeError(`rollEquipment: 알 수 없는 세트 "${setId}"`);
    baseId = SETS[setId].pieces[theSlot];
  } else if (!baseId) {
    baseId = rng.pick(Object.keys(BASES).filter((id) => BASES[id].slot === theSlot));
  }
  const def = BASES[baseId];
  if (!def || def.slot !== theSlot) throw new RangeError(`rollEquipment: 기본 종류 "${baseId}" 는 ${theSlot} 이 아닙니다`);

  const implicit = def.implicit.map((opt) => {
    const [lo, hi] = optionRange(opt, rarity, ilvl);
    return { stat: opt.stat, value: rng.int(lo, hi) };
  });

  const [minAffixes, maxAffixes] = RARITY[rarity].affixes;
  const pool = affixPool(theSlot).slice();
  const count = Math.min(rng.int(minAffixes, maxAffixes), pool.length);
  const affixes = [];
  for (let i = 0; i < count; i++) {
    // 같은 능력치가 두 번 붙지 않도록 뽑은 것은 풀에서 뺀다.
    const pick = rng.weightedIndex(pool.map((a) => a.weight));
    const [opt] = pool.splice(pick, 1);
    const [lo, hi] = optionRange(opt, rarity, ilvl);
    affixes.push({ stat: opt.stat, value: rng.int(lo, hi) });
  }

  return { kind: 'equipment', uid: 0, base: baseId, slot: theSlot, rarity, ilvl, setId, implicit, affixes };
}

/**
 * 드롭용: 등급·부위·세트 여부까지 무작위로 정해 장비를 만든다.
 * @param {object} options
 * @param {number} options.floor 등급 가중치와 아이템 레벨을 정하는 층
 * @param {object|null} options.meta 메타 진행(세트 해금)
 * @param {string|null} [options.minRarity]
 * @param {number} [options.rarityFloor] 등급 가중치만 다른 층 것을 쓸 때(상점)
 */
export function rollEquipmentDrop(rng, { floor, meta, minRarity = null, rarityFloor = floor }) {
  const rarity = rollRarity(rng, rarityFloor, minRarity);
  const slot = rng.pick(SLOTS);
  let setId = null;
  if (RARITIES.indexOf(rarity) >= RARITIES.indexOf('rare')) {
    const sets = availableSets(meta);
    // 세트가 하나도 없어도 난수는 똑같이 소비한다(해금 여부로 뒤의 수열이 밀리지 않도록).
    const isSet = rng.chance(DROPS.setChance);
    if (isSet && sets.length > 0) setId = rng.pick(sets);
  }
  return rollEquipment(rng, { ilvl: floor, rarity, slot, setId });
}

/** 구매가(상점의 층 할증 전). */
/**
 * 장비의 사본. 상태 안에서 한 장비 객체를 두 곳이 함께 가리키면 안 된다 — 저장했다 불러오면 둘로 갈라져,
 * 저장한 게임과 저장하지 않은 게임이 달라질 수 있다.
 */
export function copyItem(item) {
  return { ...item, implicit: item.implicit.map((o) => ({ ...o })), affixes: item.affixes.map((o) => ({ ...o })) };
}

export function buyPrice(item) {
  return Math.max(1, Math.round(RARITY[item.rarity].price * (1 + PRICES.perLevel * (item.ilvl - 1)) * (item.setId ? 1.25 : 1)));
}

/** 판매가. */
export function sellPrice(item) {
  return Math.max(1, Math.round(buyPrice(item) * PRICES.sellRatio));
}
