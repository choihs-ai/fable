import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CONSUMABLES } from '../../../data/consumables.js';
import { INVENTORY, SLOTS } from '../../../data/items.js';
import { RELICS } from '../../../data/relics.js';
import { SHOP } from '../../../data/shop.js';
import { Rng } from '../../../src/logic/core/prng.js';
import { consumablePool, relicPool, rollChestLoot, rollKillLoot, rollRelic } from '../../../src/logic/items/drops.js';
import { buyPrice, rollEquipment, sellPrice } from '../../../src/logic/items/equipment.js';
import {
  addConsumable, addGold, addRelic, addToBag, bagHasRoom, createInventory, equipFromBag, removeFromBag, spendGold, takeConsumable, unequip,
} from '../../../src/logic/items/inventory.js';
import { buyFromShop, generateShop, sellFromBag, shopPrice } from '../../../src/logic/items/shop.js';

const rng = Rng.fromSeed('inventory-test');
let uid = 1;
const item = (slot = 'weapon', rarity = 'common') => ({ ...rollEquipment(rng, { ilvl: 3, rarity, slot }), uid: uid++ });

// ── 인벤토리 ──

test('새 인벤토리: 빈 가방, 부위마다 빈 착용 칸, 메타 시작 보너스', () => {
  const inv = createInventory();
  assert.equal(inv.capacity, INVENTORY.capacity);
  assert.deepEqual(inv.bag, []);
  assert.deepEqual(Object.keys(inv.equipped), [...SLOTS]);
  assert.ok(Object.values(inv.equipped).every((v) => v === null));
  assert.deepEqual([inv.gold, inv.relics, inv.consumables], [0, [], {}]);

  const boosted = createInventory({ gold: 120, capacity: 4, consumables: { health_potion: 2 } });
  assert.deepEqual([boosted.gold, boosted.capacity, boosted.consumables], [120, INVENTORY.capacity + 4, { health_potion: 2 }]);
});

test('가방: 칸 제한을 넘으면 들어가지 않는다', () => {
  const inv = createInventory();
  for (let i = 0; i < INVENTORY.capacity; i++) assert.equal(addToBag(inv, item()), true);
  assert.equal(bagHasRoom(inv), false);
  const extra = item();
  assert.equal(addToBag(inv, extra), false);
  assert.equal(inv.bag.length, INVENTORY.capacity);
  assert.ok(!inv.bag.includes(extra));
  assert.throws(() => addToBag(inv, { kind: 'relic' }), TypeError);
  assert.throws(() => addToBag(inv, null), TypeError);
});

test('착용: 빈 부위에 끼면 가방에서 빠지고, 낀 부위에 끼면 교체된 장비가 같은 칸으로 들어온다', () => {
  const inv = createInventory();
  const sword = item('weapon');
  const helm = item('helm');
  const sword2 = item('weapon');
  for (const it of [sword, helm, sword2]) addToBag(inv, it);

  assert.deepEqual(equipFromBag(inv, 0), { equipped: sword, replaced: null });
  assert.deepEqual(inv.bag, [helm, sword2]);
  assert.equal(inv.equipped.weapon, sword);

  assert.deepEqual(equipFromBag(inv, 1), { equipped: sword2, replaced: sword });
  assert.deepEqual(inv.bag, [helm, sword], '교체된 장비가 같은 칸에');
  assert.equal(inv.equipped.weapon, sword2);
  assert.throws(() => equipFromBag(inv, 5), RangeError);
  assert.throws(() => equipFromBag(inv, -1), RangeError);
  assert.throws(() => equipFromBag(inv, 0.5), RangeError);
});

test('착용: 가방이 꽉 차 있어도 교체는 된다(칸 수가 변하지 않는다)', () => {
  const inv = createInventory();
  inv.equipped.weapon = item('weapon');
  for (let i = 0; i < INVENTORY.capacity; i++) addToBag(inv, item('weapon'));
  const incoming = inv.bag[3];
  const outgoing = inv.equipped.weapon;
  equipFromBag(inv, 3);
  assert.equal(inv.bag.length, INVENTORY.capacity);
  assert.equal(inv.bag[3], outgoing);
  assert.equal(inv.equipped.weapon, incoming);
});

test('해제: 가방에 자리가 있을 때만 되고, 빈 부위는 해제할 것이 없다', () => {
  const inv = createInventory();
  const armor = item('armor');
  inv.equipped.armor = armor;
  assert.equal(unequip(inv, 'helm'), false);
  assert.equal(unequip(inv, 'armor'), true);
  assert.deepEqual([inv.equipped.armor, inv.bag], [null, [armor]]);

  inv.equipped.armor = item('armor');
  while (bagHasRoom(inv)) addToBag(inv, item());
  assert.equal(unequip(inv, 'armor'), false, '가방이 꽉 참');
  assert.ok(inv.equipped.armor);
  assert.throws(() => unequip(inv, 'cape'), RangeError);
});

test('버리기·팔기용 꺼내기', () => {
  const inv = createInventory();
  const a = item();
  const b = item();
  addToBag(inv, a);
  addToBag(inv, b);
  assert.equal(removeFromBag(inv, 0), a);
  assert.deepEqual(inv.bag, [b]);
  assert.throws(() => removeFromBag(inv, 1), RangeError);
});

test('소비 아이템: 종류별 최대 보유 수까지만 쌓이고, 다 쓰면 목록에서 사라진다', () => {
  const inv = createInventory();
  assert.equal(addConsumable(inv, 'health_potion', 3), 3);
  assert.equal(addConsumable(inv, 'health_potion', 4), INVENTORY.stackMax - 3, '넘치는 만큼은 들어가지 않는다');
  assert.equal(inv.consumables.health_potion, INVENTORY.stackMax);
  assert.equal(addConsumable(inv, 'health_potion'), 0);
  assert.equal(addConsumable(inv, 'cleanse_tonic'), 1, '다른 종류는 따로 센다');

  for (let i = 0; i < INVENTORY.stackMax; i++) assert.equal(takeConsumable(inv, 'health_potion'), true);
  assert.equal(takeConsumable(inv, 'health_potion'), false);
  assert.equal('health_potion' in inv.consumables, false);
  assert.throws(() => addConsumable(inv, 'elixir_of_life'), RangeError);
});

test('유물은 하나씩만, 금화는 음수가 되지 않는다', () => {
  const inv = createInventory();
  assert.equal(addRelic(inv, 'whetstone'), true);
  assert.equal(addRelic(inv, 'whetstone'), false);
  assert.deepEqual(inv.relics, ['whetstone']);
  assert.throws(() => addRelic(inv, 'holy_grail'), RangeError);

  addGold(inv, 50);
  assert.equal(spendGold(inv, 60), false);
  assert.equal(inv.gold, 50);
  assert.equal(spendGold(inv, 50), true);
  assert.equal(inv.gold, 0);
  for (const bad of [-1, 1.5, NaN, '5']) {
    assert.throws(() => addGold(inv, bad), RangeError);
    assert.throws(() => spendGold(inv, bad), RangeError);
  }
});

// ── 드롭 ──

test('소비 아이템·유물 풀: 층과 메타 해금에 따라 달라진다', () => {
  assert.ok(!consumablePool(1, null).includes('greater_health_potion'));
  assert.ok(consumablePool(8, null).includes('greater_health_potion'));
  assert.ok(!consumablePool(30, null).includes('fire_bomb'), '해금 전에는 화염병이 없다');
  assert.ok(consumablePool(30, { unlocked: { consumable_fire_bomb: true } }).includes('fire_bomb'));

  const basePool = relicPool(null, []);
  assert.ok(basePool.length >= 8 && !basePool.includes('phoenix_feather'));
  const full = relicPool({ unlocked: { relic_pack: true } }, []);
  assert.equal(full.length, Object.keys(RELICS).length);
  assert.ok(!relicPool(null, ['whetstone'], ['iron_heart']).some((id) => id === 'whetstone' || id === 'iron_heart'));
  assert.equal(rollRelic(Rng.fromSeed('r'), null, basePool), null, '다 가졌으면 null');
});

test('적 처치 보상: 일반 적은 0~3가지, 보스는 금화·희귀 이상 장비 둘·소비 아이템 둘을 반드시 준다', () => {
  const r = Rng.fromSeed('loot');
  let total = 0;
  for (let i = 0; i < 3000; i++) {
    const loot = rollKillLoot(r, { floor: 7, meta: null, relics: [], boss: false });
    assert.ok(loot.length <= 3);
    assert.equal(new Set(loot.map((l) => l.kind)).size, loot.length, '종류마다 최대 하나');
    total += loot.length;
  }
  assert.ok(total > 1500 && total < 3000);

  for (let i = 0; i < 200; i++) {
    const loot = rollKillLoot(r, { floor: 15, meta: null, relics: [], boss: true });
    const kinds = loot.map((l) => l.kind);
    assert.equal(kinds.filter((k) => k === 'gold').length, 1);
    assert.equal(kinds.filter((k) => k === 'equipment').length, 2);
    assert.equal(kinds.filter((k) => k === 'consumable').length, 2);
    for (const l of loot) if (l.kind === 'equipment') assert.ok(['rare', 'epic', 'legendary'].includes(l.item.rarity));
  }
});

test('금화는 층이 깊을수록 많이 나온다', () => {
  const sum = (floor) => {
    const r = Rng.fromSeed('gold');
    let total = 0;
    for (let i = 0; i < 4000; i++) for (const l of rollKillLoot(r, { floor, meta: null, relics: [], boss: false })) if (l.kind === 'gold') total += l.amount;
    return total;
  };
  assert.ok(sum(30) > sum(1) * 2);
});

test('상자: 얻을 유물이 더 없으면 유물 대신 장비가 나온다', () => {
  const r = Rng.fromSeed('chest');
  const owned = Object.keys(RELICS);
  for (let i = 0; i < 2000; i++) {
    const loot = rollChestLoot(r, { floor: 5, meta: { unlocked: { relic_pack: true } }, relics: owned });
    assert.notEqual(loot.kind, 'relic');
  }
});

// ── 상점 ──

test('상점: 품목 구성과 가격이 층을 따른다', () => {
  const early = generateShop(Rng.fromSeed('shop-a'), { floor: 2, meta: null, relics: [] });
  const equipment = early.stock.filter((e) => e.kind === 'equipment');
  const consumables = early.stock.filter((e) => e.kind === 'consumable');
  assert.equal(equipment.length, SHOP.equipment);
  assert.equal(consumables.length, 2, '2층에서 나올 수 있는 소비 아이템은 두 종류뿐이다');
  const later = generateShop(Rng.fromSeed('shop-b'), { floor: 4, meta: null, relics: [] });
  assert.equal(later.stock.filter((e) => e.kind === 'consumable').length, SHOP.consumables);
  assert.equal(new Set(consumables.map((e) => e.id)).size, consumables.length, '소비 아이템은 서로 다른 종류');
  assert.equal(early.stock.filter((e) => e.kind === 'relic').length, 0, `유물은 ${SHOP.relicFromFloor}층부터`);
  for (const e of equipment) {
    assert.equal(e.item.ilvl, 2);
    assert.equal(e.price, shopPrice(buyPrice(e.item), 2));
    assert.equal(e.sold, false);
  }
  for (const e of consumables) assert.equal(e.price, shopPrice(CONSUMABLES[e.id].price, 2));

  // 같은 물약도 깊은 층에서는 더 비싸다.
  assert.ok(shopPrice(25, 30) > shopPrice(25, 1) * 2);
  assert.equal(shopPrice(25, 1), 25);

  // 깊은 층: 유물이 진열되는 상점이 있고, 가진 유물은 진열되지 않는다.
  let withRelic = 0;
  for (let n = 0; n < 200; n++) {
    const shop = generateShop(Rng.fromSeed(`shop-${n}`), { floor: 20, meta: null, relics: ['whetstone'] });
    const relic = shop.stock.find((e) => e.kind === 'relic');
    if (relic) {
      withRelic++;
      assert.notEqual(relic.id, 'whetstone');
    }
  }
  assert.ok(withRelic > 60 && withRelic < 140, `유물이 진열된 상점 ${withRelic}/200`);
});

test('상점: 같은 난수 스트림이면 같은 품목이다', () => {
  const ctx = { floor: 9, meta: null, relics: [] };
  assert.deepEqual(generateShop(Rng.fromSeed('same'), ctx), generateShop(Rng.fromSeed('same'), ctx));
});

test('구매: 금화가 줄고 물건이 들어오고 품목이 팔림 처리된다', () => {
  const shop = generateShop(Rng.fromSeed('buy'), { floor: 10, meta: null, relics: [] });
  const inv = createInventory({ gold: 100000 });
  const before = inv.gold;
  const eq = shop.stock.findIndex((e) => e.kind === 'equipment');
  const result = buyFromShop(shop, inv, eq);
  assert.equal(result.ok, true);
  assert.equal(inv.gold, before - shop.stock[eq].price);
  assert.deepEqual(inv.bag, [shop.stock[eq].item]);
  assert.equal(shop.stock[eq].sold, true);
  assert.deepEqual(buyFromShop(shop, inv, eq), { ok: false, reason: 'sold-out' });
  assert.deepEqual(buyFromShop(shop, inv, 99), { ok: false, reason: 'no-such-item' });

  const potion = shop.stock.findIndex((e) => e.kind === 'consumable');
  assert.equal(buyFromShop(shop, inv, potion).ok, true);
  assert.equal(inv.consumables[shop.stock[potion].id], 1);
});

test('구매 실패: 금화 부족·가방 가득·묶음 가득·이미 가진 유물 — 어느 경우에도 금화는 나가지 않는다', () => {
  const make = () => generateShop(Rng.fromSeed('fail'), { floor: 20, meta: null, relics: [] });
  const find = (shop, kind) => shop.stock.findIndex((e) => e.kind === kind);

  const poor = createInventory({ gold: 1 });
  assert.deepEqual(buyFromShop(make(), poor, 0), { ok: false, reason: 'no-gold' });
  assert.equal(poor.gold, 1);

  const full = createInventory({ gold: 100000 });
  while (bagHasRoom(full)) addToBag(full, item());
  const shop = make();
  assert.deepEqual(buyFromShop(shop, full, find(shop, 'equipment')), { ok: false, reason: 'bag-full' });
  assert.equal(full.gold, 100000);
  assert.equal(shop.stock[find(shop, 'equipment')].sold, false);

  const stacked = createInventory({ gold: 100000 });
  const shop2 = make();
  const potion = find(shop2, 'consumable');
  addConsumable(stacked, shop2.stock[potion].id, INVENTORY.stackMax);
  assert.deepEqual(buyFromShop(shop2, stacked, potion), { ok: false, reason: 'stack-full' });
  assert.equal(stacked.gold, 100000);

  // 유물이 진열된 상점을 찾아, 그 유물을 이미 가진 상태로 사 본다.
  for (let n = 0; n < 50; n++) {
    const s = generateShop(Rng.fromSeed(`relic-shop-${n}`), { floor: 20, meta: null, relics: [] });
    const relic = find(s, 'relic');
    if (relic === -1) continue;
    const owner = createInventory({ gold: 100000 });
    addRelic(owner, s.stock[relic].id);
    assert.deepEqual(buyFromShop(s, owner, relic), { ok: false, reason: 'already-owned' });
    assert.equal(owner.gold, 100000);
    return;
  }
  assert.fail('유물이 진열된 상점을 찾지 못함');
});

test('판매: 가방에서 빠지고 판매가만큼 금화가 는다', () => {
  const inv = createInventory();
  const it = item('armor', 'epic');
  addToBag(inv, it);
  const result = sellFromBag(inv, 0);
  assert.deepEqual(result, { item: it, gold: sellPrice(it) });
  assert.deepEqual([inv.bag, inv.gold], [[], sellPrice(it)]);
  assert.throws(() => sellFromBag(inv, 0), RangeError);
});
