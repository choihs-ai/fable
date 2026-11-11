// 플레이어 명령과 전투 연동(아이템이 실제 전투·진행에 반영되는가).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CONSUMABLES } from '../../data/consumables.js';
import { INVENTORY, SLOTS } from '../../data/items.js';
import { SOULS } from '../../data/meta.js';
import { RELICS } from '../../data/relics.js';
import { FILLERS } from '../../data/upgrades.js';
import { dealDamage } from '../../src/logic/combat/damage.js';
import { collectDrops, addDrop, rewardKill } from '../../src/logic/combat/loot.js';
import { applyStatus } from '../../src/logic/combat/statuses.js';
import {
  acceptAltar, buyItem, buyUnlock, chooseUpgrade, compareItem, discardItem, equipItem, sellItem, unequipItem, useConsumable,
} from '../../src/logic/commands.js';
import { EVENTS } from '../../src/logic/core/events.js';
import { Rng } from '../../src/logic/core/prng.js';
import { PHASE } from '../../src/logic/core/state.js';
import { allActors, getPlayer } from '../../src/logic/entities/actors.js';
import { refreshPlayerStats } from '../../src/logic/entities/stats.js';
import { createGame, endRun, enterFloor, setPhase, tick } from '../../src/logic/game.js';
import { rollEquipment, sellPrice } from '../../src/logic/items/equipment.js';
import { xpForKill, xpToNext } from '../../src/logic/items/levelup.js';
import { generateShop } from '../../src/logic/items/shop.js';
import { TOTAL_FLOORS } from '../../src/logic/world/floors.js';
import { checkState } from '../../scripts/lib/item-checks.js';
import { DT, createArena, openRoom, sec } from '../helpers/arena.js';

const rng = Rng.fromSeed('commands-test');
let uid = 9000;
const gear = (slot, stats, setId = null) => ({
  kind: 'equipment', uid: uid++, base: { weapon: 'blade', armor: 'plate', helm: 'helm', boots: 'greaves', accessory: 'ring' }[slot],
  slot, rarity: 'rare', ilvl: 1, setId, implicit: [], affixes: Object.entries(stats).map(([stat, value]) => ({ stat, value })),
});
const arena = (options = {}) => createArena(openRoom(24, 14), { player: { x: 6.5, y: 7.5 }, ...options });

// ── 장비 명령 ──

test('착용·해제·버리기: 능력치가 바로 반영되고 이벤트가 나간다', () => {
  const a = arena();
  const { game, state, player } = a;
  const sword = gear('weapon', { power: 20 });
  state.inventory.bag.push(sword, gear('armor', { maxHp: 30 }));

  assert.equal(equipItem(game, 0).ok, true);
  assert.equal(state.inventory.equipped.weapon, sword);
  assert.ok(Math.abs(player.power - 1.2) < 1e-12);
  assert.equal(equipItem(game, 0).ok, true);
  assert.equal(player.maxHp, 130);
  assert.deepEqual(state.inventory.bag, []);

  assert.deepEqual(unequipItem(game, 'weapon'), { ok: true });
  assert.equal(player.power, 1);
  assert.deepEqual(unequipItem(game, 'weapon'), { ok: false, reason: 'empty-slot' });
  assert.deepEqual(unequipItem(game, 'cape'), { ok: false, reason: 'no-such-slot' });

  const dropped = discardItem(game, 0);
  assert.equal(dropped.item, sword);
  assert.deepEqual(equipItem(game, 0), { ok: false, reason: 'no-such-item' });
  assert.deepEqual(discardItem(game, 3), { ok: false, reason: 'no-such-item' });
  assert.deepEqual(a.events(EVENTS.INVENTORY_CHANGED).map((e) => e.reason), ['equip', 'equip', 'unequip', 'discard']);
});

test('해제: 가방이 꽉 차면 안 된다', () => {
  const a = arena();
  const { game, state } = a;
  state.inventory.equipped.helm = gear('helm', { maxHp: 5 });
  while (state.inventory.bag.length < state.inventory.capacity) state.inventory.bag.push(gear('weapon', { power: 1 }));
  assert.deepEqual(unequipItem(game, 'helm'), { ok: false, reason: 'bag-full' });
});

test('비교값 명령', () => {
  const a = arena();
  const { game, state } = a;
  state.inventory.equipped.weapon = gear('weapon', { power: 10 });
  state.inventory.bag.push(gear('weapon', { power: 25 }));
  refreshPlayerStats(state);
  const cmp = compareItem(game, 0);
  assert.equal(cmp.ok, true);
  assert.deepEqual(cmp.delta, { power: 15 });
  assert.ok(cmp.scoreDelta > 0);
  assert.deepEqual(compareItem(game, 4), { ok: false, reason: 'no-such-item' });
});

test('죽었거나 런이 끝난 뒤에는 명령이 듣지 않는다', () => {
  const a = arena();
  a.state.inventory.bag.push(gear('weapon', { power: 5 }));
  dealDamage(a.state, a.bus, a.player, 9999);
  a.step(1);
  assert.equal(a.state.phase, PHASE.GAME_OVER);
  assert.deepEqual(equipItem(a.game, 0), { ok: false, reason: 'not-playing' });
  assert.deepEqual(useConsumable(a.game, 'health_potion'), { ok: false, reason: 'not-playing' });
  assert.deepEqual(chooseUpgrade(a.game, 0), { ok: false, reason: 'not-playing' });
});

// ── 전투에 반영 ──

test('공격력: 플레이어가 주는 피해가 배율만큼 는다(지속 피해는 그대로)', () => {
  const a = arena();
  const dummy = a.enemy('zombie', { x: 7.6, y: 7.5 });
  dummy.maxHp = dummy.hp = 100000;
  dummy.speed = 0;
  a.state.inventory.equipped.weapon = gear('weapon', { power: 50 });
  refreshPlayerStats(a.state);
  a.step(1, { attack: true });
  assert.equal(dummy.maxHp - dummy.hp, 9, '6 × 1.5');
  applyStatus(a.state, a.bus, dummy, 'burn', { sourceId: a.player.id });
  const before = dummy.hp;
  a.step(sec(0.5), { attack: false });
  assert.equal(before - dummy.hp, 3, '화상의 틱 피해는 공격력과 무관하다');
});

test('치명타: 확률 100% 면 항상 치명타 배율이 곱해지고 이벤트에 표시된다', () => {
  const a = arena();
  const dummy = a.enemy('zombie', { x: 7.6, y: 7.5 });
  dummy.maxHp = dummy.hp = 100000;
  dummy.speed = 0;
  a.state.run.boons.push({ source: 't', stats: { critDamage: 50 } });
  refreshPlayerStats(a.state);
  a.player.critChance = 1; // 상한(75%)을 넘겨 확정 치명타로 만든다.
  a.step(1, { attack: true });
  assert.equal(dummy.maxHp - dummy.hp, 12, '6 × (1.5 + 0.5)');
  const hit = a.events(EVENTS.DAMAGE_DEALT).find((e) => e.targetId === dummy.id);
  assert.equal(hit.crit, true);
});

test('치명타 확률이 0 이면 난수를 쓰지 않는다(아이템이 없는 전투의 수열이 그대로)', () => {
  const run = (crit) => {
    const a = arena({ seed: 'crit-rng' });
    const dummy = a.enemy('zombie', { x: 7.6, y: 7.5 });
    dummy.maxHp = dummy.hp = 100000;
    dummy.speed = 0;
    if (crit) {
      a.state.run.boons.push({ source: 't', stats: { critChance: 30 } });
      refreshPlayerStats(a.state);
    }
    a.step(sec(3), { attack: true });
    return JSON.stringify(a.state.rng.combat);
  };
  const initial = JSON.stringify(arena({ seed: 'crit-rng' }).state.rng.combat);
  assert.equal(run(false), initial, '치명타 확률 0: 전투 난수가 소비되지 않는다');
  assert.notEqual(run(true), initial);
});

test('흡혈·공격 시 상태이상·재사용 대기 감소가 적용된다', () => {
  const a = arena();
  const dummy = a.enemy('zombie', { x: 7.6, y: 7.5 });
  dummy.maxHp = dummy.hp = 100000;
  dummy.speed = 0;
  a.state.run.boons.push({ source: 't', stats: { lifesteal: 30, haste: 50 } });
  refreshPlayerStats(a.state);
  a.player.onHit = [{ id: 'poison', chance: 1 }];
  a.player.hp = 50;
  a.step(1, { attack: true });
  assert.equal(a.player.hp, 52, '피해 6 의 30% = 1.8 → 2 회복');
  assert.equal(dummy.statuses.poison.stacks, 1);
  // 기본공격 재사용 대기 0.4초 → 0.2초.
  a.step(sec(0.2), { attack: true });
  assert.equal(a.events(EVENTS.ABILITY_USED).filter((e) => e.ability === 'slash').length, 2);
});

test('체력 재생: 10초에 regen 만큼 회복하고 가득 차면 멈춘다', () => {
  const a = arena();
  a.state.run.boons.push({ source: 't', stats: { regen: 5 } });
  refreshPlayerStats(a.state);
  a.player.hp = 90;
  a.step(sec(10));
  assert.equal(a.player.hp, 95);
  a.player.hp = a.player.maxHp - 1;
  a.step(sec(20));
  assert.equal(a.player.hp, a.player.maxHp);
});

test('적의 공격 배율(층별 난이도)이 플레이어가 받는 피해에 곱해진다', () => {
  const a = arena();
  a.player.maxHp = a.player.hp = 10000;
  const skeleton = a.enemy('skeleton', { x: 7.6, y: 7.5 }, { alerted: true });
  skeleton.power = 3;
  a.step(sec(1));
  assert.equal(10000 - a.player.hp, 24, '해골의 타격 8 × 3');
});

// ── 처치 보상과 줍기 ──

test('처치 보상: 경험치를 얻고 레벨이 오르면 강화 후보가 제시된다', () => {
  const a = arena();
  const { state } = a;
  const enemy = a.enemy('zombie', { x: 12.5, y: 7.5 });
  enemy.maxHp = enemy.hp = 200;
  dealDamage(state, a.bus, enemy, 9999, { sourceId: a.player.id });
  a.step(1);

  const xp = xpForKill(200, false);
  assert.ok(xp >= xpToNext(1), '이 테스트는 한 번에 레벨이 올라야 한다');
  assert.equal(state.run.kills, 1);
  assert.equal(state.run.level, 2);
  assert.equal(a.events(EVENTS.XP_GAINED)[0].amount, xp);
  assert.deepEqual(a.events(EVENTS.LEVEL_UP).map((e) => e.level), [2]);
  assert.equal(state.run.choice.options.length, 3);
  assert.equal(a.events(EVENTS.UPGRADE_OFFERED).length, 1);
});

test('처치 보상: 소환된 적과 플레이어가 잡지 않은 적은 아무것도 주지 않는다', () => {
  const a = arena();
  const { state } = a;
  const minion = a.enemy('skeleton', { x: 12.5, y: 7.5 }, { summonerId: 999 });
  dealDamage(state, a.bus, minion, 9999, { sourceId: a.player.id });
  const exploder = a.enemy('sporeling', { x: 14.5, y: 7.5 });
  exploder.dead = true;
  exploder.hp = 0;
  exploder.killerId = exploder.id;
  a.step(1);
  assert.equal(state.run.kills, 0);
  assert.equal(state.run.xp, 0);
  assert.deepEqual(state.drops, []);
});

test('경험치·금화 획득 보너스', () => {
  const a = arena();
  const { state } = a;
  state.run.boons.push({ source: 't', stats: { xpGain: 50, goldFind: 100 } });
  refreshPlayerStats(state);
  const enemy = a.enemy('rat', { x: 12.5, y: 7.5 });
  enemy.dead = true;
  enemy.hp = 0;
  enemy.killerId = a.player.id;
  rewardKill(state, a.bus, enemy);
  assert.equal(a.events(EVENTS.XP_GAINED)[0].amount, Math.round(xpForKill(enemy.maxHp, false) * 1.5));

  state.drops = [];
  addDrop(state, a.bus, a.player.x, a.player.y, { kind: 'gold', amount: 10 });
  collectDrops(state, a.bus);
  assert.equal(state.inventory.gold, 20);
});

test('줍기: 가까이 가면 줍고, 멀면 줍지 않는다', () => {
  const a = arena();
  const { state, bus, player } = a;
  const sword = rollEquipment(rng, { ilvl: 2, rarity: 'rare', slot: 'weapon' });
  addDrop(state, bus, player.x + 3, player.y, { kind: 'equipment', item: sword });
  addDrop(state, bus, player.x + 3, player.y, { kind: 'consumable', id: 'health_potion' });
  addDrop(state, bus, player.x + 3, player.y, { kind: 'relic', id: 'whetstone' });
  assert.ok(sword.uid > 0, '바닥에 놓일 때 고유 번호가 붙는다');
  a.step(2);
  assert.equal(state.drops.length, 3);

  a.step(sec(1), { moveX: 1, moveY: 0 });
  assert.deepEqual(state.drops, []);
  assert.deepEqual(state.inventory.bag, [sword]);
  assert.deepEqual(state.inventory.consumables, { health_potion: 1 });
  assert.deepEqual(state.inventory.relics, ['whetstone']);
  assert.ok(Math.abs(player.power - 1.1) < 1e-12, '유물의 능력치가 바로 반영된다');
  assert.equal(a.events(EVENTS.DROP_COLLECTED).length, 3);
  assert.deepEqual(checkState(state), []);
});

test('줍기: 자리가 없으면 바닥에 남고, 이미 가진 유물은 금화로 바뀐다', () => {
  const a = arena();
  const { state, bus, player } = a;
  while (state.inventory.bag.length < state.inventory.capacity) state.inventory.bag.push(gear('weapon', { power: 1 }));
  state.inventory.consumables.health_potion = INVENTORY.stackMax;
  state.inventory.relics.push('whetstone');
  addDrop(state, bus, player.x, player.y, { kind: 'equipment', item: rollEquipment(rng, { ilvl: 2, rarity: 'common', slot: 'helm' }) });
  addDrop(state, bus, player.x, player.y, { kind: 'consumable', id: 'health_potion' });
  addDrop(state, bus, player.x, player.y, { kind: 'relic', id: 'whetstone' });
  a.step(1);
  assert.deepEqual(state.drops.map((d) => d.loot.kind), ['equipment', 'consumable']);
  assert.equal(state.inventory.gold, Math.round(RELICS.whetstone.price / 4));
  assert.equal(state.inventory.bag.length, state.inventory.capacity);
});

// ── 소비 아이템 ──

test('체력 물약: 회복하고 하나 줄어든다. 체력이 가득하거나 물약이 없으면 쓰지 않는다', () => {
  const a = arena();
  const { game, state, player } = a;
  state.inventory.consumables.health_potion = 2;
  assert.deepEqual(useConsumable(game, 'health_potion'), { ok: false, reason: 'full-hp' });
  player.hp = 30;
  assert.deepEqual(useConsumable(game, 'health_potion'), { ok: true });
  assert.equal(player.hp, 30 + Math.round((player.maxHp * CONSUMABLES.health_potion.effect.pct) / 100));
  assert.equal(state.inventory.consumables.health_potion, 1);
  player.hp = 1;
  useConsumable(game, 'health_potion');
  player.hp = 1;
  assert.deepEqual(useConsumable(game, 'health_potion'), { ok: false, reason: 'none-left' });
  assert.deepEqual(useConsumable(game, 'ambrosia'), { ok: false, reason: 'no-such-item' });
  assert.equal(a.events(EVENTS.CONSUMABLE_USED).length, 2);
});

test('정화 약: 걸린 상태이상을 모두 푼다', () => {
  const a = arena();
  a.state.inventory.consumables.cleanse_tonic = 1;
  assert.deepEqual(useConsumable(a.game, 'cleanse_tonic'), { ok: false, reason: 'nothing-to-cleanse' });
  applyStatus(a.state, a.bus, a.player, 'poison');
  applyStatus(a.state, a.bus, a.player, 'slow');
  assert.deepEqual(useConsumable(a.game, 'cleanse_tonic'), { ok: true });
  assert.deepEqual(a.player.statuses, {});
});

test('영약: 일정 시간 능력치가 오르고, 다시 마시면 시간만 갱신되며, 끝나면 돌아온다', () => {
  const a = arena();
  const { game, state, player } = a;
  state.inventory.consumables.power_elixir = 2;
  const { seconds, stats } = CONSUMABLES.power_elixir.effect;
  useConsumable(game, 'power_elixir');
  assert.ok(Math.abs(player.power - (1 + stats.power / 100)) < 1e-12);
  a.step(sec(5));
  useConsumable(game, 'power_elixir');
  assert.equal(state.run.buffs.length, 1, '중첩되지 않는다');
  assert.ok(Math.abs(player.power - (1 + stats.power / 100)) < 1e-12);
  a.step(sec(seconds) - 1);
  assert.ok(player.power > 1, '갱신된 시간이 아직 남았다');
  a.step(2);
  assert.equal(player.power, 1);
  assert.deepEqual(state.run.buffs, []);
  assert.deepEqual(checkState(state), []);
});

test('화염병: 둘레의 적에게 피해와 화상', () => {
  const a = arena({ meta: { unlocked: { consumable_fire_bomb: true } } });
  const near = a.enemy('zombie', { x: 8.5, y: 7.5 });
  const far = a.enemy('zombie', { x: 16.5, y: 7.5 });
  a.state.inventory.consumables.fire_bomb = 1;
  useConsumable(a.game, 'fire_bomb');
  assert.equal(near.maxHp - near.hp, CONSUMABLES.fire_bomb.effect.damage);
  assert.ok(near.statuses.burn);
  assert.equal(far.hp, far.maxHp);
});

// ── 상점·제단 ──

function withShop(a, floor = 6) {
  a.state.run.floor = floor;
  a.state.shop = { ...generateShop(Rng.fromSeed('cmd-shop'), { floor, meta: a.state.meta, relics: [] }), x: 10.5, y: 7.5 };
  for (const entry of a.state.shop.stock) if (entry.kind === 'equipment') entry.item.uid = uid++;
}

test('상점: 가까이 있어야 거래할 수 있다', () => {
  const a = arena();
  assert.deepEqual(buyItem(a.game, 0), { ok: false, reason: 'no-shop' });
  withShop(a);
  a.state.inventory.gold = 100000;
  assert.deepEqual(buyItem(a.game, 0), { ok: false, reason: 'too-far' });
  assert.deepEqual(sellItem(a.game, 0), { ok: false, reason: 'too-far' });
  a.player.x = 9.5;
  assert.equal(buyItem(a.game, 0).ok, true);
  assert.equal(a.state.inventory.bag.length, 1);
  assert.equal(a.events(EVENTS.SHOP_PURCHASE)[0].price, a.state.shop.stock[0].price);
});

test('상점: 사고팔면 금화와 가방이 맞게 바뀐다', () => {
  const a = arena();
  withShop(a);
  a.player.x = 10;
  const { state, game } = a;
  state.inventory.gold = 5000;
  const entry = state.shop.stock[1];
  assert.equal(buyItem(game, 1).ok, true);
  assert.equal(state.inventory.gold, 5000 - entry.price);
  const sold = sellItem(game, 0);
  assert.equal(sold.ok, true);
  assert.equal(sold.gold, sellPrice(entry.item));
  assert.ok(sold.gold < entry.price, '되팔면 손해');
  assert.equal(state.inventory.gold, 5000 - entry.price + sold.gold);
  assert.deepEqual(sellItem(game, 0), { ok: false, reason: 'no-such-item' });
  assert.deepEqual(buyItem(game, 1), { ok: false, reason: 'sold-out' });
  state.inventory.gold = 0;
  assert.deepEqual(buyItem(game, 0), { ok: false, reason: 'no-gold' });
  assert.deepEqual(checkState(state), []);
});

function withAltar(a, offers) {
  a.state.altar = { floor: 3, used: false, offers, x: 8.5, y: 7.5 };
}

test('제단: 대가를 치르고 보상을 받으며, 한 번만 쓸 수 있다', () => {
  const a = arena();
  const { game, state, player } = a;
  withAltar(a, [
    { tier: 'small', cost: { type: 'hpPct', pct: 20 }, reward: { type: 'stats', stats: { power: 5 } } },
    { tier: 'medium', cost: { type: 'gold', amount: 70 }, reward: { type: 'upgrade' } },
    { tier: 'large', cost: { type: 'maxHp', amount: 25 }, reward: { type: 'relic' } },
  ]);
  const result = acceptAltar(game, 0);
  assert.equal(result.ok, true);
  assert.equal(player.hp, 80);
  assert.ok(Math.abs(player.power - 1.05) < 1e-12);
  assert.equal(state.altar.used, true);
  assert.deepEqual(acceptAltar(game, 1), { ok: false, reason: 'used' });
  assert.equal(a.events(EVENTS.ALTAR_ACCEPTED).length, 1);
});

test('제단: 금화 대가와 강화 보상, 최대 체력 대가와 유물 보상', () => {
  const a = arena();
  withAltar(a, [
    { tier: 'small', cost: { type: 'curse', stats: { speed: -4 } }, reward: { type: 'heal' } },
    { tier: 'medium', cost: { type: 'gold', amount: 70 }, reward: { type: 'upgrade' } },
    { tier: 'large', cost: { type: 'maxHp', amount: 25 }, reward: { type: 'relic' } },
  ]);
  assert.deepEqual(acceptAltar(a.game, 1), { ok: false, reason: 'no-gold' });
  assert.equal(a.state.altar.used, false, '받지 못하면 제단은 그대로 남는다');
  a.state.inventory.gold = 100;
  assert.equal(acceptAltar(a.game, 1).ok, true);
  assert.equal(a.state.inventory.gold, 30);
  assert.equal(a.state.run.choice.options.length, 3, '강화 3택1 이 제시된다');
  assert.equal(a.state.run.level, 1, '레벨은 오르지 않는다');

  const b = arena();
  withAltar(b, a.state.altar.offers.map((o) => ({ ...o })));
  b.state.altar.used = false;
  const result = acceptAltar(b.game, 2);
  assert.equal(result.ok, true);
  assert.equal(b.player.maxHp, 75);
  assert.equal(b.state.inventory.relics.length, 1);
  assert.equal(result.reward.id, b.state.inventory.relics[0]);
  assert.deepEqual(checkState(b.state), []);

  const c = arena();
  withAltar(c, a.state.altar.offers.map((o) => ({ ...o })));
  c.state.altar.used = false;
  c.player.hp = 40;
  acceptAltar(c.game, 0);
  assert.equal(c.player.hp, c.player.maxHp, '저주를 받고 체력을 전부 회복');
  assert.ok(c.player.speed < 4.2);
});

test('제단: 멀리 있으면 쓸 수 없고, 체력 대가로 죽지 않는다', () => {
  const a = arena();
  withAltar(a, [{ tier: 'large', cost: { type: 'hpPct', pct: 60 }, reward: { type: 'heal' } }]);
  a.player.x = 20.5;
  assert.deepEqual(acceptAltar(a.game, 0), { ok: false, reason: 'too-far' });
  a.player.x = 8;
  a.player.hp = 1;
  assert.deepEqual(acceptAltar(a.game, 0), { ok: false, reason: 'too-weak' });
  a.player.hp = 2;
  assert.equal(acceptAltar(a.game, 0).ok, true);
  assert.equal(a.player.dead, false);
});

// ── 강화 선택 ──

test('강화 선택: 고르면 능력치에 반영되고, 쌓인 선택이 있으면 다음 후보가 바로 나온다', () => {
  const a = arena();
  const { game, state, player } = a;
  assert.deepEqual(chooseUpgrade(game, 0), { ok: false, reason: 'no-choice' });
  state.run.pendingChoices = 1;
  state.run.choice = { options: [{ kind: 'upgrade', id: 'vitality' }, { kind: 'upgrade', id: 'sharpness' }, { kind: 'upgrade', id: 'focus' }] };
  assert.deepEqual(chooseUpgrade(game, 7), { ok: false, reason: 'no-such-option' });
  const result = chooseUpgrade(game, 0);
  assert.deepEqual([result.ok, result.id, result.rank], [true, 'vitality', 1]);
  assert.equal(player.maxHp, 115);
  assert.equal(state.run.pendingChoices, 0);
  assert.equal(state.run.choice.options.length, 3, '쌓여 있던 선택의 후보');
  assert.deepEqual(a.events(EVENTS.UPGRADE_CHOSEN).map((e) => e.id), ['vitality']);
  chooseUpgrade(game, 0);
  assert.equal(state.run.choice, null);
  assert.deepEqual(checkState(state), []);
});

test('강화 선택: 채움 보상(회복·금화·능력치)', () => {
  const a = arena();
  const { game, state, player } = a;
  const offer = () => {
    state.run.choice = { options: Object.keys(FILLERS).map((id) => ({ kind: 'filler', id })) };
  };
  player.hp = 10;
  offer();
  chooseUpgrade(game, 0);
  assert.equal(player.hp, 10 + Math.round((player.maxHp * FILLERS.feast.effect.pct) / 100));
  offer();
  chooseUpgrade(game, 1);
  assert.equal(state.inventory.gold, FILLERS.windfall.effect.base + FILLERS.windfall.effect.perLevel * state.run.level);
  offer();
  chooseUpgrade(game, 2);
  assert.equal(player.maxHp, 100 + FILLERS.grit.effect.stats.maxHp);
});

// ── 층 진입 ──

test('층에 들어가면 상자 내용물이 놓이고, 이벤트방이 있으면 상점·제단이 생긴다', () => {
  let shops = 0;
  let altars = 0;
  for (let n = 0; n < 12; n++) {
    const game = createGame({ seed: `floor-loot-${n}` });
    enterFloor(game, 7);
    const { state } = game;
    const map = state.world;
    assert.equal(state.drops.length, map.spawns.filter((s) => s.kind === 'item').length);
    for (const room of map.eventRooms) {
      const place = room.kind === 'shop' ? state.shop : state.altar;
      assert.deepEqual([place.x, place.y], [room.feature.x + 0.5, room.feature.y + 0.5]);
    }
    assert.equal(Boolean(state.shop), map.eventRooms.some((r) => r.kind === 'shop'));
    assert.equal(Boolean(state.altar), map.eventRooms.some((r) => r.kind === 'altar'));
    if (state.shop) shops++;
    if (state.altar) altars++;
    assert.deepEqual(checkState(state), []);
  }
  assert.ok(shops > 0 && altars > 0, `상점 ${shops}, 제단 ${altars}`);
});

test('층의 상자·상점·제단은 (런 시드, 층)으로 정해진다 — 다시 들어와도, 그 사이 난수를 써도 같다', () => {
  const view = (state) => JSON.stringify({ drops: state.drops.map((d) => ({ ...d, id: 0, loot: { ...d.loot, item: d.loot.item ? { ...d.loot.item, uid: 0 } : undefined } })), shop: state.shop && state.shop.stock.map((e) => ({ ...e, item: e.item ? { ...e.item, uid: 0 } : undefined })), altar: state.altar });
  const a = createGame({ seed: 'floor-same' });
  enterFloor(a, 9);
  const first = view(a.state);
  const b = createGame({ seed: 'floor-same' });
  enterFloor(b, 3);
  for (let i = 0; i < 40; i++) rollEquipment(new Rng(b.state.rng.items), { ilvl: 1, rarity: 'common' });
  enterFloor(b, 9);
  assert.equal(view(b.state), first);
});

test('유물: 새 층에 들어갈 때 회복, 적을 잡을 때 회복·금화', () => {
  const game = createGame({ seed: 'relic-floor' });
  enterFloor(game, 1);
  const { state } = game;
  const player = getPlayer(state);
  state.inventory.relics.push('traveler_boots', 'soul_jar', 'midas_ring');
  player.hp = 40;
  enterFloor(game, 2);
  assert.equal(player.hp, 40 + Math.round((player.maxHp * RELICS.traveler_boots.onFloor.healPct) / 100));

  player.hp = 50;
  const enemy = allActors(state).find((x) => x.faction === 'enemy');
  enemy.dead = true;
  enemy.hp = 0;
  enemy.killerId = player.id;
  const gold = state.inventory.gold;
  rewardKill(state, game.bus, enemy);
  assert.equal(player.hp, 50 + RELICS.soul_jar.onKill.heal);
  assert.equal(state.inventory.gold, gold + RELICS.midas_ring.onKill.gold);
});

// ── 되살아남·런 종료·메타 ──

test('불사조의 깃털: 한 번 되살아나고, 두 번째에는 죽는다', () => {
  const a = arena({ meta: { unlocked: { relic_pack: true } } });
  a.state.inventory.relics.push('phoenix_feather');
  dealDamage(a.state, a.bus, a.player, 9999);
  a.step(1);
  assert.equal(a.player.dead, false);
  assert.equal(a.player.hp, Math.round((a.player.maxHp * RELICS.phoenix_feather.revive.hpPct) / 100));
  assert.equal(a.state.phase, PHASE.PLAYING);
  assert.equal(a.events(EVENTS.PLAYER_REVIVED).length, 1);
  assert.equal(dealDamage(a.state, a.bus, a.player, 9999), 0, '되살아난 직후에는 잠깐 무적');
  a.step(sec(2) + 1);
  dealDamage(a.state, a.bus, a.player, 9999);
  a.step(1);
  assert.equal(a.player.dead, true);
  assert.equal(a.state.phase, PHASE.GAME_OVER);
});

test('죽으면 런이 정산된다: 영혼석을 얻고 기록이 남고, 두 번 정산되지 않는다', () => {
  const a = arena();
  const { state } = a;
  state.run.floor = 7;
  state.run.kills = 23;
  state.run.bossKills = 1;
  dealDamage(state, a.bus, a.player, 9999);
  a.step(1);
  const expected = 7 * SOULS.perFloor + 23 * SOULS.perKill + SOULS.perBossKill;
  assert.equal(state.meta.souls, expected);
  assert.deepEqual([state.meta.runs, state.meta.bestFloor, state.meta.totalKills, state.meta.victories], [1, 7, 23, 0]);
  assert.deepEqual(a.events(EVENTS.RUN_ENDED).map((e) => [e.victory, e.souls, e.floor]), [[false, expected, 7]]);
  endRun(a.game, false);
  assert.equal(state.meta.souls, expected);
  assert.equal(a.events(EVENTS.RUN_ENDED).length, 1);
});

test('최종보스를 잡으면 승리로 끝난다', () => {
  const game = createGame({ seed: 'victory' });
  enterFloor(game, TOTAL_FLOORS);
  setPhase(game, PHASE.PLAYING);
  const { state } = game;
  const ended = [];
  game.bus.on(EVENTS.RUN_ENDED, (e) => ended.push(e));
  const boss = allActors(state).find((x) => x.kind === 'boss');
  const player = getPlayer(state);
  for (let i = 0; i < 4 && !boss.dead; i++) {
    dealDamage(state, game.bus, boss, 1e9, { sourceId: player.id });
    for (let t = 0; t < sec(2.1); t++) tick(game, DT);
  }
  assert.equal(state.phase, PHASE.VICTORY);
  assert.equal(ended.length, 1);
  assert.equal(ended[0].victory, true);
  assert.ok(ended[0].souls >= SOULS.victory + SOULS.perBossKill);
  assert.equal(state.meta.victories, 1);
  assert.ok(state.drops.length >= 3, '보스 전리품이 떨어진다');
});

test('중간보스를 잡는 것으로는 런이 끝나지 않는다', () => {
  const game = createGame({ seed: 'mid-boss' });
  enterFloor(game, 5);
  setPhase(game, PHASE.PLAYING);
  const boss = allActors(game.state).find((x) => x.kind === 'boss');
  for (let i = 0; i < 3 && !boss.dead; i++) {
    dealDamage(game.state, game.bus, boss, 1e9, { sourceId: game.state.playerId });
    for (let t = 0; t < sec(1.6); t++) tick(game, DT);
  }
  assert.equal(game.state.phase, PHASE.PLAYING);
  assert.equal(game.state.run.bossKills, 1);
});

test('메타: 영혼석으로 해금을 사면 다음 런의 시작 조건이 달라진다', () => {
  const first = createGame({ seed: 'meta-a' });
  first.state.meta.souls = 400;
  assert.deepEqual(buyUnlock(first, 'vigor_1'), { ok: true });
  assert.deepEqual(buyUnlock(first, 'purse_1'), { ok: true });
  assert.deepEqual(buyUnlock(first, 'provisions'), { ok: true });
  assert.deepEqual(buyUnlock(first, 'satchel'), { ok: true });
  assert.deepEqual(buyUnlock(first, 'vigor_3'), { ok: false, reason: 'locked' });
  assert.equal(first.state.inventory.gold, 0, '이번 런에는 적용되지 않는다');

  const next = createGame({ seed: 'meta-b', meta: first.state.meta });
  enterFloor(next, 1);
  const player = getPlayer(next.state);
  assert.equal(player.maxHp, 110);
  assert.equal(player.hp, 110);
  assert.equal(next.state.inventory.gold, 40);
  assert.deepEqual(next.state.inventory.consumables, { health_potion: 2 });
  assert.equal(next.state.inventory.capacity, INVENTORY.capacity + 4);
  assert.notEqual(next.state.meta, first.state.meta, '메타는 복사해서 쓴다');
  assert.deepEqual(checkState(next.state), []);
});

test('아이템이 얽힌 상태도 JSON 으로 왕복하면 그대로다', () => {
  const game = createGame({ seed: 'json-items', meta: { souls: 3, unlocked: { relic_pack: true } } });
  enterFloor(game, 12);
  setPhase(game, PHASE.PLAYING);
  const { state } = game;
  for (const slot of SLOTS) state.inventory.equipped[slot] = { ...rollEquipment(rng, { ilvl: 12, rarity: 'epic', slot }), uid: uid++ };
  state.inventory.relics.push('whetstone');
  state.inventory.consumables.power_elixir = 1;
  useConsumable(game, 'power_elixir');
  state.run.pendingChoices = 1;
  for (const e of allActors(state)) if (e.ai) e.ai.provoked = true;
  for (let t = 0; t < sec(3); t++) tick(game, DT);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
});

test('물려받은 이름("constructor"·"toString")을 아이템·해금 이름으로 받지 않는다(세이브에서 온 값 방어)', async () => {
  const { addConsumable, addRelic, createInventory } = await import('../../src/logic/items/inventory.js');
  const { canUnlock, normalizeMeta } = await import('../../src/logic/items/meta.js');
  // 3단계에서는 메타에 constructor 해금이 있으면 createGame 이 TypeError 로 죽었다.
  const meta = normalizeMeta({ souls: 5, unlocked: { constructor: true, toString: true, __proto__: true } });
  assert.deepEqual(meta.unlocked, {});
  assert.doesNotThrow(() => createGame({ seed: 'proto', meta: { unlocked: { constructor: true } } }));
  assert.equal(normalizeMeta({ unlocked: [true] }).unlocked[0], undefined);
  assert.deepEqual(normalizeMeta([1, 2]), normalizeMeta(null));
  assert.equal(canUnlock(meta, 'constructor').reason, 'unknown');

  const inv = createInventory();
  assert.throws(() => addRelic(inv, 'toString'), RangeError);
  assert.throws(() => addConsumable(inv, 'constructor', 1), RangeError);

  const game = createGame({ seed: 'proto-cmd' });
  enterFloor(game, 1);
  setPhase(game, PHASE.PLAYING);
  assert.deepEqual(useConsumable(game, 'constructor'), { ok: false, reason: 'no-such-item' });
  assert.deepEqual(buyUnlock(game, 'hasOwnProperty'), { ok: false, reason: 'unknown' });
});
