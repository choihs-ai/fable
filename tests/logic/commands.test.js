// 명령: 상호작용(무기 줍기·상점·포털), 무기 교체, 축복 고르기·다시 뽑기, 상점, 거점의 영구 강화.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BOONS, BOON_RULES } from '../../data/boons.js';
import { CHARACTERS } from '../../data/characters.js';
import { UPGRADES } from '../../data/meta.js';
import { SHOP } from '../../data/shop.js';
import { WEAPONS } from '../../data/weapons.js';
import {
  boonRerollCost, buyMetaUpgrade, buyShopItem, chooseBoon, interact, interactTarget, rerollBoons, rerollShop, shopPrice, swapWeapons,
  unlockMetaCharacter, usePortal,
} from '../../src/logic/commands.js';
import { addDrop, offerBoons } from '../../src/logic/combat/loot.js';
import { EVENTS } from '../../src/logic/core/events.js';
import { PHASE } from '../../src/logic/core/state.js';
import { createGame, enterFloor, setPhase } from '../../src/logic/game.js';
import { ROOM_KIND } from '../../src/logic/world/floors.js';
import { validateRunState } from '../../src/logic/save/validate.js';
import { createStage } from '../helpers/stage.js';

const withShop = () => createStage({ seed: 'cmd-shop', need: (map) => map.rooms.some((r) => r.kind === ROOM_KIND.SHOP) });
function inShop() {
  const s = withShop();
  s.moveTo(s.room(ROOM_KIND.SHOP));
  s.step(2);
  return s;
}

test('무기 줍기: 빈 칸이 있으면 그 칸에 들고, 없으면 든 무기와 바꾸고 원래 무기는 그 자리에 놓는다', () => {
  const s = createStage({ seed: 'cmd-weapon' });
  const kit = s.player.kit;
  assert.equal(interact(s.game).reason, 'nothing');
  kit.weapons = ['sword', null];
  const drop = addDrop(s.state, s.bus, s.player.x + 0.5, s.player.y, { kind: 'weapon', weapon: 'bow' });
  assert.deepEqual(interactTarget(s.state), { type: 'weapon', dropId: drop.id, weapon: 'bow' });
  assert.deepEqual(interact(s.game), { ok: true, type: 'weapon', weapon: 'bow', dropped: null });
  assert.deepEqual(kit.weapons, ['sword', 'bow']);
  assert.equal(kit.slot, 1, '주운 무기를 든다');
  assert.equal(s.state.drops.length, 0);

  addDrop(s.state, s.bus, s.player.x, s.player.y + 0.5, { kind: 'weapon', weapon: 'hammer' });
  const result = interact(s.game);
  assert.equal(result.dropped, 'bow');
  assert.deepEqual(kit.weapons, ['sword', 'hammer']);
  assert.deepEqual(s.state.drops.map((d) => d.weapon), ['bow'], '바꾼 무기가 바닥에 놓인다');
  assert.deepEqual(s.events(EVENTS.WEAPON_PICKED).map((e) => e.weapon), ['bow', 'hammer']);
  // 다시 상호작용하면 도로 바뀐다.
  interact(s.game);
  assert.deepEqual(kit.weapons, ['sword', 'bow']);
  assert.deepEqual(validateRunState(s.state), []);
});

test('무기 줍기: 멀리 있는 무기는 줍지 못하고, 가장 가까운 것부터 줍는다', () => {
  const s = createStage({ seed: 'cmd-weapon-far' });
  addDrop(s.state, s.bus, s.player.x + 3, s.player.y, { kind: 'weapon', weapon: 'bow' });
  assert.equal(interactTarget(s.state), null);
  addDrop(s.state, s.bus, s.player.x + 1.2, s.player.y, { kind: 'weapon', weapon: 'spear' });
  addDrop(s.state, s.bus, s.player.x + 0.4, s.player.y, { kind: 'weapon', weapon: 'dagger' });
  assert.equal(interactTarget(s.state).weapon, 'dagger');
});

test('무기 교체 명령', () => {
  const s = createStage({ seed: 'cmd-swap' });
  assert.deepEqual(swapWeapons(s.game), { ok: true, slot: 1 });
  assert.deepEqual(swapWeapons(s.game), { ok: true, slot: 0 });
  s.player.kit.weapons = ['sword', null];
  assert.deepEqual(swapWeapons(s.game), { ok: false, reason: 'no-weapon' });
  s.player.dead = true;
  assert.deepEqual(swapWeapons(s.game), { ok: false, reason: 'not-playing' });
});

test('축복 3택1: 제시된 것 가운데 하나를 고르면 얻고, 선택이 닫힌다', () => {
  const s = createStage({ seed: 'cmd-boon' });
  assert.deepEqual(chooseBoon(s.game, 0), { ok: false, reason: 'no-choice' });
  assert.equal(offerBoons(s.state, s.bus), true);
  const { options } = s.state.run.choice;
  assert.equal(options.length, BOON_RULES.choices);
  assert.equal(new Set(options).size, 3);
  assert.deepEqual(chooseBoon(s.game, 3), { ok: false, reason: 'bad-index' });
  assert.deepEqual(chooseBoon(s.game, -1), { ok: false, reason: 'bad-index' });
  assert.deepEqual(chooseBoon(s.game, 1), { ok: true, boon: options[1] });
  assert.deepEqual(s.state.run.boons, [options[1]]);
  assert.equal(s.state.run.choice, null);
  assert.deepEqual(s.events(EVENTS.BOON_CHOSEN).map((e) => e.boon), [options[1]]);
  // 가진 축복은 다시 제시되지 않는다.
  for (let i = 0; i < 20; i++) {
    offerBoons(s.state, s.bus);
    assert.ok(!s.state.run.choice.options.includes(options[1]));
    s.state.run.choice = null;
  }
});

test('축복을 고르면 능력치가 곧바로 반영된다', () => {
  const s = createStage({ seed: 'cmd-boon-stats' });
  s.state.run.choice = { kind: 'boon', options: ['third_dash', 'glass_cannon', 'chain'], rerolls: 0 };
  const charges = s.player.kit.maxCharges;
  chooseBoon(s.game, 0);
  assert.equal(s.player.kit.maxCharges, charges + BOONS.third_dash.charges);
  s.state.run.choice = { kind: 'boon', options: ['glass_cannon'], rerolls: 0 };
  const maxHp = s.player.maxHp;
  chooseBoon(s.game, 0);
  assert.equal(s.player.maxHp, Math.round(maxHp * BOONS.glass_cannon.hpMul));
});

test('축복 다시 뽑기: 금화가 들고 뽑을 때마다 비싸진다. 무료 횟수가 있으면 먼저 쓴다', () => {
  const s = createStage({ seed: 'cmd-reroll' });
  assert.deepEqual(rerollBoons(s.game), { ok: false, reason: 'no-choice' });
  offerBoons(s.state, s.bus);
  const first = s.state.run.choice.options.slice();
  s.state.run.gold = 0;
  assert.deepEqual(rerollBoons(s.game), { ok: false, reason: 'no-gold' });
  s.state.run.gold = 100;
  assert.equal(boonRerollCost(s.state), BOON_RULES.reroll.base);
  const result = rerollBoons(s.game);
  assert.equal(result.ok, true);
  assert.equal(s.state.run.gold, 100 - BOON_RULES.reroll.base);
  assert.ok(result.options.every((id) => !first.includes(id)), '방금 본 후보는 피한다');
  assert.equal(boonRerollCost(s.state), BOON_RULES.reroll.base + BOON_RULES.reroll.step);

  s.state.run.freeRerolls = 1;
  assert.equal(boonRerollCost(s.state), 0);
  const gold = s.state.run.gold;
  rerollBoons(s.game);
  assert.equal(s.state.run.gold, gold);
  assert.equal(s.state.run.freeRerolls, 0);
  assert.equal(boonRerollCost(s.state), BOON_RULES.reroll.base + BOON_RULES.reroll.step, '무료 횟수는 값을 올리지 않는다');
});

test('상점: 진열품은 무기·축복·회복이고, 층에 들어갈 때 정해진다', () => {
  const s = withShop();
  const { stock } = s.state.shop;
  assert.equal(stock.filter((i) => i.kind === 'weapon').length, SHOP.weapons);
  assert.equal(stock.filter((i) => i.kind === 'boon').length, SHOP.boons);
  assert.equal(stock.filter((i) => i.kind === 'heal').length, 1);
  for (const item of stock) {
    assert.equal(item.sold, false);
    if (item.kind === 'weapon') {
      assert.equal(item.price, SHOP.price.weapon[WEAPONS[item.weapon].tier]);
      assert.ok(!s.player.kit.weapons.includes(item.weapon), '든 무기는 팔지 않는다');
    }
  }
  // 같은 시드면 같은 진열품.
  assert.deepEqual(withShop().state.shop.stock, stock);
});

test('상점: 상점 방에 있어야 살 수 있고, 금화가 모자라거나 이미 팔린 것은 사지 못한다', () => {
  const s = withShop();
  s.state.run.gold = 1000;
  assert.deepEqual(buyShopItem(s.game, 0), { ok: false, reason: 'no-shop' });
  assert.deepEqual(rerollShop(s.game), { ok: false, reason: 'no-shop' });
  s.moveTo(s.room(ROOM_KIND.SHOP));
  s.step(2);
  assert.deepEqual(buyShopItem(s.game, 99), { ok: false, reason: 'bad-index' });
  s.state.run.gold = 0;
  assert.deepEqual(buyShopItem(s.game, 0), { ok: false, reason: 'no-gold' });
  s.state.run.gold = 1000;
  const item = s.state.shop.stock[0];
  const result = buyShopItem(s.game, 0);
  assert.deepEqual(result, { ok: true, kind: 'weapon', price: item.price });
  assert.equal(s.state.run.gold, 1000 - item.price);
  assert.equal(item.sold, true);
  assert.deepEqual(buyShopItem(s.game, 0), { ok: false, reason: 'sold' });
  assert.deepEqual(s.events(EVENTS.SHOP_PURCHASE).map((e) => e.kind), ['weapon']);
});

test('상점: 무기를 사면 든 무기와 바뀌고, 축복을 사면 얻고, 회복은 여러 번 살 수 있되 점점 비싸진다', () => {
  const s = inShop();
  s.state.run.gold = 1000;
  const { stock } = s.state.shop;
  const weaponIndex = stock.findIndex((i) => i.kind === 'weapon');
  const held = s.player.kit.weapons[s.player.kit.slot];
  buyShopItem(s.game, weaponIndex);
  assert.equal(s.player.kit.weapons[s.player.kit.slot], stock[weaponIndex].weapon);
  assert.ok(s.state.drops.some((d) => d.kind === 'weapon' && d.weapon === held), '원래 무기는 바닥에');

  const boonIndex = stock.findIndex((i) => i.kind === 'boon');
  buyShopItem(s.game, boonIndex);
  assert.deepEqual(s.state.run.boons, [stock[boonIndex].boon]);

  const healIndex = stock.findIndex((i) => i.kind === 'heal');
  assert.deepEqual(buyShopItem(s.game, healIndex), { ok: false, reason: 'full-hp' });
  s.player.hp = 10;
  const p1 = shopPrice(s.state, stock[healIndex]);
  assert.equal(p1, SHOP.price.heal);
  buyShopItem(s.game, healIndex);
  assert.equal(s.player.hp, 10 + Math.round((s.player.maxHp * SHOP.healPct) / 100));
  assert.equal(stock[healIndex].sold, false);
  assert.equal(shopPrice(s.state, stock[healIndex]), SHOP.price.heal + SHOP.healStep);
  assert.equal(buyShopItem(s.game, healIndex).ok, true);
  assert.deepEqual(validateRunState(s.state), []);
});

test('상점: 이미 가진 축복은 사지 못한다', () => {
  const s = inShop();
  s.state.run.gold = 1000;
  const index = s.state.shop.stock.findIndex((i) => i.kind === 'boon');
  s.state.run.boons.push(s.state.shop.stock[index].boon);
  assert.deepEqual(buyShopItem(s.game, index), { ok: false, reason: 'owned' });
  assert.equal(s.state.run.gold, 1000);
});

test('상점: 진열품 다시 뽑기는 금화가 들고 뽑을 때마다 비싸진다', () => {
  const s = inShop();
  s.state.run.gold = SHOP.reroll.base - 1;
  assert.deepEqual(rerollShop(s.game), { ok: false, reason: 'no-gold' });
  s.state.run.gold = 500;
  const before = JSON.stringify(s.state.shop.stock);
  assert.deepEqual(rerollShop(s.game), { ok: true, cost: SHOP.reroll.base });
  assert.notEqual(JSON.stringify(s.state.shop.stock), before);
  assert.deepEqual(rerollShop(s.game), { ok: true, cost: SHOP.reroll.base + SHOP.reroll.step });
  assert.equal(s.state.run.gold, 500 - SHOP.reroll.base * 2 - SHOP.reroll.step);
  assert.ok(s.state.shop.stock.every((i) => i.sold === false));
});

test('포털: 출구 방의 포털 앞이 아니면 쓸 수 없다', () => {
  const s = createStage({ seed: 'cmd-portal' });
  assert.deepEqual(usePortal(s.game), { ok: false, reason: 'too-far' });
  setPhase(s.game, PHASE.GAME_OVER);
  assert.deepEqual(usePortal(s.game), { ok: false, reason: 'not-playing' });
  assert.equal(interactTarget(s.state), null);
});

test('거점: 영혼석으로 영구 강화를 사면 다음 런에 반영된다', () => {
  const game = createGame({ seed: 'meta-buy' });
  assert.deepEqual(buyMetaUpgrade(game, 'vigor'), { ok: false, reason: 'no-souls' });
  assert.deepEqual(buyMetaUpgrade(game, 'nope'), { ok: false, reason: 'unknown' });
  assert.deepEqual(buyMetaUpgrade(game, 'constructor'), { ok: false, reason: 'unknown' });
  assert.throws(() => buyMetaUpgrade(game, 5), TypeError);
  game.state.meta.souls = 1000;
  assert.deepEqual(buyMetaUpgrade(game, 'vigor'), { ok: true, cost: UPGRADES.vigor.cost[0], level: 1 });
  assert.deepEqual(buyMetaUpgrade(game, 'vigor'), { ok: true, cost: UPGRADES.vigor.cost[1], level: 2 });
  buyMetaUpgrade(game, 'purse');
  buyMetaUpgrade(game, 'capacitor');
  buyMetaUpgrade(game, 'might');
  buyMetaUpgrade(game, 'insight');
  for (let i = 0; i < 10; i++) buyMetaUpgrade(game, 'agility');
  assert.deepEqual(buyMetaUpgrade(game, 'agility'), { ok: false, reason: 'maxed' });
  assert.equal(game.state.meta.upgrades.agility, UPGRADES.agility.cost.length);

  const base = createGame({ seed: 'meta-next' });
  enterFloor(base, 1);
  const next = createGame({ seed: 'meta-next', meta: game.state.meta });
  enterFloor(next, 1);
  const a = base.state.entities.byId[base.state.playerId];
  const b = next.state.entities.byId[next.state.playerId];
  assert.equal(b.maxHp, a.maxHp + UPGRADES.vigor.effect.maxHp * 2);
  assert.equal(b.hp, b.maxHp);
  assert.equal(b.kit.maxEnergy, a.kit.maxEnergy + UPGRADES.capacitor.effect.maxEnergy);
  assert.equal(b.kit.energy, b.kit.maxEnergy);
  assert.ok(Math.abs(b.power - (a.power + UPGRADES.might.effect.power)) < 1e-9);
  assert.equal(next.state.run.gold, UPGRADES.purse.effect.gold);
  assert.equal(next.state.run.freeRerolls, UPGRADES.insight.effect.freeRerolls);
  assert.ok(b.kit.rechargeTicks < a.kit.rechargeTicks);
});

test('거점: 캐릭터를 해금하면 그 캐릭터로 시작할 수 있다', () => {
  const game = createGame({ seed: 'meta-char' });
  assert.deepEqual(unlockMetaCharacter(game, 'knight'), { ok: false, reason: 'owned' });
  assert.deepEqual(unlockMetaCharacter(game, 'mage'), { ok: false, reason: 'no-souls' });
  assert.deepEqual(unlockMetaCharacter(game, 'ghost'), { ok: false, reason: 'unknown' });
  game.state.meta.souls = CHARACTERS.mage.cost + 5;
  assert.deepEqual(unlockMetaCharacter(game, 'mage'), { ok: true, cost: CHARACTERS.mage.cost });
  assert.equal(game.state.meta.souls, 5);
  const next = createGame({ seed: 'meta-char-2', meta: game.state.meta, character: 'mage' });
  enterFloor(next, 1);
  const player = next.state.entities.byId[next.state.playerId];
  assert.equal(next.state.run.character, 'mage');
  assert.deepEqual(player.kit.weapons, CHARACTERS.mage.weapons);
  assert.equal(player.maxHp, CHARACTERS.mage.hp);
  assert.equal(player.kit.maxEnergy, CHARACTERS.mage.energy);
});
