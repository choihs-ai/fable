import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BOONS } from '../../../data/boons.js';
import { SHOP } from '../../../data/shop.js';
import { WEAPONS, WEAPON_ORDER } from '../../../data/weapons.js';
import { Rng } from '../../../src/logic/core/prng.js';
import { healPrice, rollShopStock, rollWeapon, shopRerollCost, weaponPrice } from '../../../src/logic/items/shop.js';

test('무기 뽑기: 든 무기는 피하고, 등급이 높을수록 드물다. 모든 무기가 나올 수 있다', () => {
  const seen = {};
  for (let n = 0; n < 4000; n++) {
    const id = rollWeapon(Rng.fromSeed(`w-${n}`), ['sword']);
    assert.notEqual(id, 'sword');
    seen[id] = (seen[id] ?? 0) + 1;
  }
  for (const id of WEAPON_ORDER) if (id !== 'sword') assert.ok(seen[id] > 0, `${id} 가 나오지 않음`);
  const perTier = [0, 0, 0, 0];
  const counts = [0, 0, 0, 0];
  for (const id of WEAPON_ORDER) {
    if (id === 'sword') continue;
    perTier[WEAPONS[id].tier] += seen[id];
    counts[WEAPONS[id].tier] += 1;
  }
  assert.ok(perTier[1] / counts[1] > perTier[3] / counts[3] * 1.5, '1등급 무기 하나가 3등급 무기 하나보다 자주 나온다');
  // 전부 피해야 하면 아무거나 준다(멈추지 않는다).
  assert.ok(WEAPONS[rollWeapon(Rng.fromSeed('all'), WEAPON_ORDER.slice())]);
});

test('진열품: 무기는 서로 다르고 든 무기가 아니며, 축복은 가지지 않은 것이고, 회복이 하나 있다', () => {
  for (let n = 0; n < 200; n++) {
    const stock = rollShopStock(Rng.fromSeed(`stock-${n}`), ['chain'], ['sword', 'pistol']);
    const weapons = stock.filter((i) => i.kind === 'weapon').map((i) => i.weapon);
    const boons = stock.filter((i) => i.kind === 'boon').map((i) => i.boon);
    assert.equal(weapons.length, SHOP.weapons);
    assert.equal(new Set(weapons).size, weapons.length);
    assert.ok(weapons.every((id) => id !== 'sword' && id !== 'pistol'));
    assert.equal(boons.length, SHOP.boons);
    assert.equal(new Set(boons).size, boons.length);
    assert.ok(boons.every((id) => BOONS[id] && id !== 'chain' && !BOONS[id].duo));
    assert.equal(stock.filter((i) => i.kind === 'heal').length, 1);
    assert.ok(stock.every((i) => i.sold === false && Number.isInteger(i.price) && i.price > 0));
  }
});

test('값: 무기는 등급별, 다시 뽑기와 회복은 살 때마다 오른다', () => {
  for (const id of WEAPON_ORDER) assert.equal(weaponPrice(id), SHOP.price.weapon[WEAPONS[id].tier]);
  assert.ok(SHOP.price.weapon[1] < SHOP.price.weapon[2] && SHOP.price.weapon[2] < SHOP.price.weapon[3]);
  assert.equal(shopRerollCost(0), SHOP.reroll.base);
  assert.equal(shopRerollCost(3), SHOP.reroll.base + 3 * SHOP.reroll.step);
  assert.equal(healPrice(0), SHOP.price.heal);
  assert.equal(healPrice(2), SHOP.price.heal + 2 * SHOP.healStep);
});

test('가질 수 있는 축복이 남지 않았으면 축복 없이 진열한다', () => {
  const stock = rollShopStock(Rng.fromSeed('none'), Object.keys(BOONS), []);
  assert.equal(stock.filter((i) => i.kind === 'boon').length, 0);
  assert.equal(stock.filter((i) => i.kind === 'weapon').length, SHOP.weapons);
});
