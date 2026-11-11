// 인벤토리: 가방(장비, 칸 제한), 착용 칸(부위마다 하나), 소비 아이템(종류별 묶음), 유물, 금화.
// 여기 함수들은 인벤토리 객체만 고친다. 능력치 반영·이벤트는 호출하는 쪽(logic/commands.js)이 한다.

import { CONSUMABLES } from '../../../data/consumables.js';
import { INVENTORY, SLOTS } from '../../../data/items.js';
import { RELICS } from '../../../data/relics.js';

/**
 * @param {{ gold?:number, consumables?:object, capacity?:number }} [start] 메타 시작 보너스
 */
export function createInventory(start = {}) {
  const equipped = {};
  for (const slot of SLOTS) equipped[slot] = null;
  const inv = {
    capacity: INVENTORY.capacity + (start.capacity ?? 0),
    /** 가방의 장비들. 길이는 capacity 를 넘지 않는다. */
    bag: [],
    equipped,
    /** 소비 아이템 id → 개수(1 이상인 것만 들어 있다). */
    consumables: {},
    /** 가진 유물 id 들(중복 없음, 얻은 순서). */
    relics: [],
    gold: start.gold ?? 0,
  };
  for (const id of Object.keys(start.consumables ?? {})) addConsumable(inv, id, start.consumables[id]);
  return inv;
}

export function bagHasRoom(inv) {
  return inv.bag.length < inv.capacity;
}

/** 가방에 넣는다. 꽉 찼으면 넣지 않고 false. */
export function addToBag(inv, item) {
  if (!item || item.kind !== 'equipment') throw new TypeError('addToBag: 장비가 아닙니다');
  if (!bagHasRoom(inv)) return false;
  inv.bag.push(item);
  return true;
}

function checkIndex(inv, index) {
  if (!Number.isInteger(index) || index < 0 || index >= inv.bag.length) throw new RangeError(`가방에 ${index}번 칸이 없습니다`);
}

/** 가방에서 꺼낸다(버리기·팔기). */
export function removeFromBag(inv, index) {
  checkIndex(inv, index);
  return inv.bag.splice(index, 1)[0];
}

/**
 * 가방의 장비를 착용한다. 그 부위에 끼고 있던 장비는 같은 가방 칸으로 들어간다(교체) — 칸이 모자랄 일이 없다.
 * @returns {{ equipped:object, replaced:object|null }}
 */
export function equipFromBag(inv, index) {
  checkIndex(inv, index);
  const item = inv.bag[index];
  const replaced = inv.equipped[item.slot];
  inv.equipped[item.slot] = item;
  if (replaced) inv.bag[index] = replaced;
  else inv.bag.splice(index, 1);
  return { equipped: item, replaced };
}

/** 착용을 해제해 가방에 넣는다. 가방이 꽉 찼거나 그 부위가 비어 있으면 false. */
export function unequip(inv, slot) {
  if (!SLOTS.includes(slot)) throw new RangeError(`알 수 없는 부위 "${slot}"`);
  const item = inv.equipped[slot];
  if (!item || !bagHasRoom(inv)) return false;
  inv.equipped[slot] = null;
  inv.bag.push(item);
  return true;
}

/** 소비 아이템을 넣는다. 종류별 최대 보유 수를 넘는 만큼은 들어가지 않는다. @returns {number} 실제로 들어간 수 */
export function addConsumable(inv, id, count = 1) {
  if (!Object.hasOwn(CONSUMABLES, id)) throw new RangeError(`알 수 없는 소비 아이템 "${id}"`);
  const have = inv.consumables[id] ?? 0;
  const added = Math.max(0, Math.min(count, INVENTORY.stackMax - have));
  if (added > 0) inv.consumables[id] = have + added;
  return added;
}

/** 소비 아이템 하나를 꺼낸다. 없으면 false. */
export function takeConsumable(inv, id) {
  const have = inv.consumables[id] ?? 0;
  if (have < 1) return false;
  if (have === 1) delete inv.consumables[id];
  else inv.consumables[id] = have - 1;
  return true;
}

/** 유물을 얻는다. 이미 가진 유물이면 false. */
export function addRelic(inv, id) {
  if (!Object.hasOwn(RELICS, id)) throw new RangeError(`알 수 없는 유물 "${id}"`);
  if (inv.relics.includes(id)) return false;
  inv.relics.push(id);
  return true;
}

export function addGold(inv, amount) {
  if (!Number.isInteger(amount) || amount < 0) throw new RangeError(`addGold: 잘못된 금액 ${amount}`);
  inv.gold += amount;
}

/** 금화를 쓴다. 모자라면 쓰지 않고 false. */
export function spendGold(inv, amount) {
  if (!Number.isInteger(amount) || amount < 0) throw new RangeError(`spendGold: 잘못된 금액 ${amount}`);
  if (inv.gold < amount) return false;
  inv.gold -= amount;
  return true;
}
