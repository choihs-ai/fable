// 드롭 굴림: 적·보스·상자에서 무엇이 나오는가. 결과는 "전리품(loot)" 객체다.
//   { kind:'gold', amount } | { kind:'equipment', item } | { kind:'consumable', id } | { kind:'relic', id }

import { CONSUMABLES } from '../../../data/consumables.js';
import { DROPS } from '../../../data/items.js';
import { RELICS } from '../../../data/relics.js';
import { poolAllows, rollEquipmentDrop } from './equipment.js';

/** 그 층에서 나올 수 있는 소비 아이템 id 들. */
export function consumablePool(floor, meta) {
  return Object.keys(CONSUMABLES).filter((id) => (CONSUMABLES[id].minFloor ?? 1) <= floor && poolAllows(meta, CONSUMABLES[id]));
}

export function rollConsumable(rng, floor, meta) {
  const pool = consumablePool(floor, meta);
  return pool[rng.weightedIndex(pool.map((id) => CONSUMABLES[id].weight))];
}

/** 아직 얻을 수 있는 유물 id 들(가진 것과 exclude 는 빠진다). */
export function relicPool(meta, owned, exclude = []) {
  return Object.keys(RELICS).filter((id) => poolAllows(meta, RELICS[id]) && !owned.includes(id) && !exclude.includes(id));
}

/** 유물 하나를 고른다. 남은 유물이 없으면 null. */
export function rollRelic(rng, meta, owned, exclude = []) {
  const pool = relicPool(meta, owned, exclude);
  return pool.length > 0 ? rng.pick(pool) : null;
}

function goldAmount(rng, range, floor) {
  return Math.max(1, Math.round(rng.int(range[0], range[1]) * (1 + DROPS.goldPerFloor * (floor - 1))));
}

/**
 * 적 하나가 떨어뜨리는 것들.
 * @param {object} ctx { floor, meta, relics(가진 유물), boss(보스인가) }
 * @returns {object[]} 전리품 목록(없으면 빈 배열)
 */
export function rollKillLoot(rng, { floor, meta, relics, boss }) {
  const loot = [];
  if (boss) {
    const rule = DROPS.boss;
    loot.push({ kind: 'gold', amount: goldAmount(rng, rule.gold, floor) });
    for (let i = 0; i < rule.equipment; i++) {
      loot.push({ kind: 'equipment', item: rollEquipmentDrop(rng, { floor, meta, minRarity: rule.minRarity }) });
    }
    for (let i = 0; i < rule.consumable; i++) loot.push({ kind: 'consumable', id: rollConsumable(rng, floor, meta) });
    if (rng.chance(rule.relic)) {
      const id = rollRelic(rng, meta, relics);
      if (id) loot.push({ kind: 'relic', id });
    }
    return loot;
  }
  const rule = DROPS.enemy;
  // 세 가지를 각각 따로 굴린다. 확률을 조정해도 다른 굴림의 순서가 밀리지 않도록 항상 세 번 굴린다.
  const gold = rng.chance(rule.goldChance);
  const equipment = rng.chance(rule.equipment);
  const consumable = rng.chance(rule.consumable);
  if (gold) loot.push({ kind: 'gold', amount: goldAmount(rng, rule.gold, floor) });
  if (equipment) loot.push({ kind: 'equipment', item: rollEquipmentDrop(rng, { floor, meta }) });
  if (consumable) loot.push({ kind: 'consumable', id: rollConsumable(rng, floor, meta) });
  return loot;
}

/** 맵의 아이템 자리(상자) 하나에서 나오는 것. exclude 는 이 층에 이미 놓인 유물. */
export function rollChestLoot(rng, { floor, meta, relics, exclude = [] }) {
  const rule = DROPS.chest;
  const kind = ['equipment', 'consumable', 'relic'][rng.weightedIndex([rule.equipment, rule.consumable, rule.relic])];
  if (kind === 'relic') {
    const id = rollRelic(rng, meta, relics, exclude);
    if (id) return { kind: 'relic', id };
    // 얻을 유물이 더 없으면 장비로 대신한다.
    return { kind: 'equipment', item: rollEquipmentDrop(rng, { floor, meta, minRarity: 'uncommon' }) };
  }
  if (kind === 'consumable') return { kind: 'consumable', id: rollConsumable(rng, floor, meta) };
  return { kind: 'equipment', item: rollEquipmentDrop(rng, { floor, meta }) };
}
