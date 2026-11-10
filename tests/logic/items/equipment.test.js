import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AFFIXES, BASES, DROPS, RARITIES, RARITY, SETS, SLOTS, STATS } from '../../../data/items.js';
import { Rng } from '../../../src/logic/core/prng.js';
import {
  affixPool, availableSets, buyPrice, optionRange, rarityWeights, rollEquipment, rollEquipmentDrop, rollRarity, sellPrice,
} from '../../../src/logic/items/equipment.js';
import { checkItem } from '../../../scripts/lib/item-checks.js';

const UNLOCKED = { unlocked: { set_windrunner: true } };

test('장비 데이터: 등급 5단계, 부위 5개, 옵션과 능력치가 맞물린다', () => {
  assert.deepEqual(RARITIES, ['common', 'uncommon', 'rare', 'epic', 'legendary']);
  assert.equal(SLOTS.length, 5);
  let prev = null;
  for (const rarity of RARITIES) {
    const r = RARITY[rarity];
    assert.ok(r.affixes[0] <= r.affixes[1] && r.affixes[0] >= 0);
    if (prev) {
      assert.ok(r.valueMul > prev.valueMul && r.price > prev.price, `${rarity}: 배율·가격이 등급을 따라 오른다`);
      assert.ok(r.affixes[0] >= prev.affixes[0] && r.affixes[1] >= prev.affixes[1], `${rarity}: 옵션 수`);
    }
    prev = r;
  }
  for (const [id, base] of Object.entries(BASES)) {
    assert.ok(SLOTS.includes(base.slot), id);
    for (const opt of base.implicit) assert.ok(STATS[opt.stat] && opt.min >= 1 && opt.max >= opt.min && opt.growth >= 0, `${id}.${opt.stat}`);
  }
  for (const affix of AFFIXES) {
    assert.ok(STATS[affix.stat] && affix.min >= 1 && affix.max >= affix.min && affix.weight > 0, affix.stat);
    for (const slot of affix.slots ?? []) assert.ok(SLOTS.includes(slot));
  }
  assert.equal(new Set(AFFIXES.map((a) => a.stat)).size, AFFIXES.length, '옵션 풀에 같은 능력치가 두 번 없다');
  // 어느 부위든 가장 높은 등급의 옵션 수만큼은 서로 다른 옵션이 있어야 한다.
  const most = Math.max(...RARITIES.map((r) => RARITY[r].affixes[1]));
  for (const slot of SLOTS) {
    assert.ok(affixPool(slot).length >= most, `${slot}: 붙을 수 있는 옵션 ${affixPool(slot).length}개 < ${most}`);
    assert.ok(Object.values(BASES).some((b) => b.slot === slot), `${slot} 의 기본 종류`);
  }
});

test('세트 데이터: 부위마다 맞는 기본 종류가 있고 2·4세트 효과가 있다', () => {
  for (const [id, set] of Object.entries(SETS)) {
    assert.deepEqual(Object.keys(set.pieces).sort(), [...SLOTS].sort(), id);
    for (const [slot, base] of Object.entries(set.pieces)) assert.equal(BASES[base].slot, slot, `${id}.${slot}`);
    assert.deepEqual(Object.keys(set.bonus), ['2', '4'], id);
    for (const bonus of Object.values(set.bonus)) for (const stat of Object.keys(bonus)) assert.ok(STATS[stat], `${id}: ${stat}`);
  }
});

test('optionRange: 등급과 레벨이 오르면 범위가 오르고, 최소 1 이상이다', () => {
  const power = AFFIXES.find((a) => a.stat === 'power');
  assert.deepEqual(optionRange(power, 'common', 1), [3, 6]);
  assert.deepEqual(optionRange(power, 'legendary', 1), [5, 11]);
  const lifesteal = AFFIXES.find((a) => a.stat === 'lifesteal');
  assert.deepEqual(optionRange(lifesteal, 'common', 1), [1, 2]);
  for (const def of AFFIXES) {
    for (const rarity of RARITIES) {
      let prev = [0, 0];
      for (let ilvl = 1; ilvl <= 30; ilvl++) {
        const [lo, hi] = optionRange(def, rarity, ilvl);
        assert.ok(Number.isInteger(lo) && Number.isInteger(hi) && lo >= 1 && hi >= lo);
        assert.ok(lo >= prev[0] && hi >= prev[1], `${def.stat} ${rarity} Lv${ilvl}`);
        prev = [lo, hi];
      }
    }
  }
});

test('rollEquipment: 등급별 옵션 수·범위·중복 금지·부위 제한을 지킨다', () => {
  const rng = Rng.fromSeed('equip');
  const counts = Object.fromEntries(RARITIES.map((r) => [r, new Set()]));
  for (let i = 0; i < 4000; i++) {
    const rarity = RARITIES[i % RARITIES.length];
    const item = rollEquipment(rng, { ilvl: 1 + (i % 30), rarity });
    assert.deepEqual(checkItem({ ...item, uid: 1 }), [], JSON.stringify(item));
    counts[rarity].add(item.affixes.length);
  }
  for (const rarity of RARITIES) {
    const [lo, hi] = RARITY[rarity].affixes;
    const expected = [];
    for (let n = lo; n <= hi; n++) expected.push(n);
    assert.deepEqual([...counts[rarity]].sort(), expected, `${rarity}: 옵션 수가 범위 전체에 걸쳐 나온다`);
  }
});

test('rollEquipment: 부위·기본 종류·세트를 지정할 수 있고, 잘못된 지정은 거부한다', () => {
  const rng = Rng.fromSeed('equip-spec');
  assert.equal(rollEquipment(rng, { ilvl: 5, rarity: 'rare', slot: 'boots' }).slot, 'boots');
  assert.equal(rollEquipment(rng, { ilvl: 5, rarity: 'rare', base: 'wand' }).slot, 'weapon');
  const piece = rollEquipment(rng, { ilvl: 5, rarity: 'epic', slot: 'armor', setId: 'bulwark' });
  assert.deepEqual([piece.setId, piece.base], ['bulwark', SETS.bulwark.pieces.armor]);
  assert.throws(() => rollEquipment(rng, { ilvl: 5, rarity: 'mythic' }), RangeError);
  assert.throws(() => rollEquipment(rng, { ilvl: 0, rarity: 'rare' }), RangeError);
  assert.throws(() => rollEquipment(rng, { ilvl: 5, rarity: 'rare', slot: 'cape' }), RangeError);
  assert.throws(() => rollEquipment(rng, { ilvl: 5, rarity: 'rare', slot: 'boots', base: 'blade' }), RangeError);
  assert.throws(() => rollEquipment(rng, { ilvl: 5, rarity: 'rare', setId: 'nope' }), RangeError);
});

test('같은 난수 스트림이면 같은 장비가 나온다', () => {
  const a = rollEquipmentDrop(Rng.fromSeed('same'), { floor: 12, meta: null });
  const b = rollEquipmentDrop(Rng.fromSeed('same'), { floor: 12, meta: null });
  assert.deepEqual(a, b);
});

test('rarityWeights: 층이 깊을수록 높은 등급이 늘고, 하한 등급 아래는 0', () => {
  const early = rarityWeights(1);
  const late = rarityWeights(30);
  const share = (w, i) => w[i] / w.reduce((a, b) => a + b, 0);
  assert.deepEqual(early, DROPS.rarityWeights.base);
  assert.ok(share(late, 0) < share(early, 0));
  for (const i of [2, 3, 4]) assert.ok(share(late, i) > share(early, i), RARITIES[i]);
  assert.ok(rarityWeights(200).every((w) => w >= 0), '가중치는 음수가 되지 않는다');
  assert.deepEqual(rarityWeights(1, 'rare').slice(0, 2), [0, 0]);
  const rng = Rng.fromSeed('min-rarity');
  for (let i = 0; i < 500; i++) assert.ok(RARITIES.indexOf(rollRarity(rng, 1, 'epic')) >= 3);
});

test('세트 장비는 희귀 이상에서만 나오고, 해금하지 않은 세트는 나오지 않는다', () => {
  assert.deepEqual(availableSets(null), ['ember', 'bulwark']);
  assert.deepEqual(availableSets(UNLOCKED), ['ember', 'bulwark', 'windrunner']);
  const seen = { locked: new Set(), unlocked: new Set() };
  for (const [key, meta] of [['locked', null], ['unlocked', UNLOCKED]]) {
    const rng = Rng.fromSeed(`sets-${key}`);
    for (let i = 0; i < 6000; i++) {
      const item = rollEquipmentDrop(rng, { floor: 25, meta });
      if (!item.setId) continue;
      seen[key].add(item.setId);
      assert.ok(RARITIES.indexOf(item.rarity) >= 2, '희귀 미만의 세트 장비');
      assert.equal(item.base, SETS[item.setId].pieces[item.slot]);
    }
  }
  assert.deepEqual([...seen.locked].sort(), ['bulwark', 'ember']);
  assert.deepEqual([...seen.unlocked].sort(), ['bulwark', 'ember', 'windrunner']);
});

test('세트 해금 여부는 그 뒤의 난수 수열을 밀지 않는다', () => {
  // 해금 전후로 같은 스트림에서 뽑은 일반 장비(세트가 아닌 것)는 같아야 한다.
  const a = Rng.fromSeed('shift');
  const b = Rng.fromSeed('shift');
  let compared = 0;
  for (let i = 0; i < 300; i++) {
    const x = rollEquipmentDrop(a, { floor: 20, meta: null });
    const y = rollEquipmentDrop(b, { floor: 20, meta: UNLOCKED });
    if (x.setId || y.setId) break; // 세트가 갈리는 순간부터는 달라질 수 있다.
    assert.deepEqual(x, y);
    compared++;
  }
  assert.ok(compared > 3);
});

test('가격: 등급·레벨·세트에 따라 오르고, 판매가는 구매가의 일부다', () => {
  const rng = Rng.fromSeed('price');
  let prev = 0;
  for (const rarity of RARITIES) {
    const item = rollEquipment(rng, { ilvl: 10, rarity, slot: 'weapon' });
    assert.ok(buyPrice(item) > prev, rarity);
    prev = buyPrice(item);
    assert.ok(sellPrice(item) >= 1 && sellPrice(item) < buyPrice(item));
  }
  const low = rollEquipment(rng, { ilvl: 1, rarity: 'rare', slot: 'armor' });
  const high = rollEquipment(rng, { ilvl: 30, rarity: 'rare', slot: 'armor' });
  const set = rollEquipment(rng, { ilvl: 30, rarity: 'rare', slot: 'armor', setId: 'bulwark' });
  assert.ok(buyPrice(high) > buyPrice(low) * 2);
  assert.ok(buyPrice(set) > buyPrice(high));
  assert.equal(buyPrice(low), RARITY.rare.price);
});
