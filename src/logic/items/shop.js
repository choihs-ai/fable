// 상점: 층에 따른 품목과 가격, 사고팔기. 인벤토리와 상점 객체만 고친다.

import { CONSUMABLES } from '../../../data/consumables.js';
import { RELICS } from '../../../data/relics.js';
import { SHOP } from '../../../data/shop.js';
import { consumablePool, rollRelic } from './drops.js';
import { buyPrice, copyItem, rollEquipmentDrop, sellPrice } from './equipment.js';
import { addConsumable, addRelic, addToBag, bagHasRoom, removeFromBag, spendGold } from './inventory.js';

/** 층 할증을 적용한 가격. */
export function shopPrice(base, floor) {
  return Math.max(1, Math.round(base * (1 + SHOP.pricePerFloor * (floor - 1))));
}

/**
 * 그 층 상점의 품목을 만든다.
 * @param {import('../core/prng.js').Rng} rng (런 시드, 층)으로 정해진 스트림 — 다시 만들어도 같은 품목이 나온다
 * @param {object} ctx { floor, meta, relics(가진 유물) }
 * @returns {{ floor:number, stock:object[] }} stock 항목: { kind, item|id, price, sold }
 */
export function generateShop(rng, { floor, meta, relics }) {
  const stock = [];
  for (let i = 0; i < SHOP.equipment; i++) {
    const item = rollEquipmentDrop(rng, { floor, meta, rarityFloor: floor + SHOP.rarityShift });
    stock.push({ kind: 'equipment', item, price: shopPrice(buyPrice(item), floor), sold: false });
  }
  // 소비 아이템은 서로 다른 종류로.
  const pool = consumablePool(floor, meta);
  const count = Math.min(SHOP.consumables, pool.length);
  for (let i = 0; i < count; i++) {
    const pick = rng.weightedIndex(pool.map((id) => CONSUMABLES[id].weight));
    const [id] = pool.splice(pick, 1);
    stock.push({ kind: 'consumable', id, price: shopPrice(CONSUMABLES[id].price, floor), sold: false });
  }
  // 유물 진열 여부는 층과 무관하게 항상 굴린다(품목 수열이 층 조건으로 밀리지 않도록).
  const showRelic = rng.chance(SHOP.relicChance);
  if (showRelic && floor >= SHOP.relicFromFloor) {
    const id = rollRelic(rng, meta, relics);
    if (id) stock.push({ kind: 'relic', id, price: shopPrice(RELICS[id].price, floor), sold: false });
  }
  return { floor, stock };
}

/**
 * 품목 하나를 산다.
 * @returns {{ ok:true, entry:object } | { ok:false, reason:string }}
 *   reason: 'no-such-item' | 'sold-out' | 'no-gold' | 'bag-full' | 'stack-full' | 'already-owned'
 */
export function buyFromShop(shop, inv, index) {
  const entry = shop.stock[index];
  if (!entry) return { ok: false, reason: 'no-such-item' };
  if (entry.sold) return { ok: false, reason: 'sold-out' };
  if (inv.gold < entry.price) return { ok: false, reason: 'no-gold' };
  // 받을 자리가 있는지 먼저 확인하고, 그다음에 돈을 낸다(돈만 나가는 일이 없도록).
  if (entry.kind === 'equipment') {
    if (!bagHasRoom(inv)) return { ok: false, reason: 'bag-full' };
    // 가방에는 사본을 넣는다. 품목 목록의 장비는 "팔린 물건"의 기록으로 남는다(같은 번호를 쓰지만 같은 객체는 아니다).
    addToBag(inv, copyItem(entry.item));
  } else if (entry.kind === 'consumable') {
    if (addConsumable(inv, entry.id, 1) !== 1) return { ok: false, reason: 'stack-full' };
  } else if (!addRelic(inv, entry.id)) {
    return { ok: false, reason: 'already-owned' };
  }
  spendGold(inv, entry.price);
  entry.sold = true;
  return { ok: true, entry };
}

/** 가방의 장비를 판다. @returns {{ item:object, gold:number }} */
export function sellFromBag(inv, index) {
  const item = removeFromBag(inv, index);
  const gold = sellPrice(item);
  inv.gold += gold;
  return { item, gold };
}
