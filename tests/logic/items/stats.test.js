import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SETS, SLOTS, STATS } from '../../../data/items.js';
import { PLAYER } from '../../../data/player.js';
import { Rng } from '../../../src/logic/core/prng.js';
import { refreshPlayerStats } from '../../../src/logic/entities/stats.js';
import { rollEquipment } from '../../../src/logic/items/equipment.js';
import { activeSetBonuses, addStats, clampSheet, compareEquipment, computeSheet, emptySheet, itemStats, scoreOf, setCounts, sheetOf } from '../../../src/logic/items/stats.js';
import { expectedSheet } from '../../../scripts/lib/item-checks.js';
import { createArena, openRoom } from '../../helpers/arena.js';

const rng = Rng.fromSeed('stats-test');
let uid = 5000;
const piece = (slot, setId = null, rarity = 'rare') => ({ ...rollEquipment(rng, { ilvl: 8, rarity, slot, setId }), uid: uid++ });
/** 능력치가 정해진 가짜 장비. */
const fake = (slot, stats, setId = null) => ({
  kind: 'equipment', uid: uid++, base: 'x', slot, rarity: 'rare', ilvl: 1, setId,
  implicit: Object.entries(stats).map(([stat, value]) => ({ stat, value })), affixes: [],
});
const none = () => Object.fromEntries(SLOTS.map((s) => [s, null]));
const base = { relics: [], upgrades: {}, boons: [], buffs: [], meta: null, tick: 0 };

test('itemStats 와 addStats', () => {
  const item = fake('weapon', { power: 10, critChance: 4 });
  item.affixes.push({ stat: 'power', value: 5 });
  const sheet = itemStats(item);
  assert.equal(sheet.power, 15);
  assert.equal(sheet.critChance, 4);
  assert.equal(sheet.maxHp, 0);
  assert.deepEqual(Object.keys(sheet), Object.keys(STATS));
  assert.throws(() => addStats(emptySheet(), { luck: 3 }), RangeError);
  assert.equal(addStats(emptySheet(), { power: 4 }, 3).power, 12);
});

test('능력치는 장비·세트·유물·강화·영구 효과·물약 효과의 합이다', () => {
  const equipped = { ...none(), weapon: fake('weapon', { power: 10 }), armor: fake('armor', { maxHp: 20, armor: 2 }) };
  const sheet = computeSheet({
    ...base, equipped,
    relics: ['whetstone', 'soul_jar'],
    upgrades: { sharpness: 3, vitality: 1 },
    boons: [{ source: 't', stats: { power: 5, speed: -4 } }],
    buffs: [{ id: 'power_elixir', stats: { power: 30 }, until: 100 }, { id: 'old', stats: { power: 99 }, until: 0 }],
    meta: { unlocked: { might_1: true, vigor_1: true, satchel: true } },
    tick: 50,
  });
  // 장비 10 + 숫돌 10 + 날카로움 3×10 + 축복 5 + 물약 30 + 완력 I 4. 끝난 물약(until 0)은 빠진다.
  assert.equal(sheet.power, 10 + 10 + 30 + 5 + 30 + 4);
  assert.equal(sheet.maxHp, 20 + 15 + 10);
  assert.equal(sheet.armor, 2);
  assert.equal(sheet.speed, -4);
});

test('상한과 하한', () => {
  const sheet = clampSheet({ ...emptySheet(), haste: 80, critChance: 200, lifesteal: 99, speed: -90, armor: -5, power: 500 });
  assert.equal(sheet.haste, STATS.haste.cap);
  assert.equal(sheet.critChance, STATS.critChance.cap);
  assert.equal(sheet.lifesteal, STATS.lifesteal.cap);
  assert.equal(sheet.speed, STATS.speed.floor);
  assert.equal(sheet.armor, 0);
  assert.equal(sheet.power, 500, '공격력은 상한이 없다');
});

// ── 세트 ──

test('세트 효과: 2개에서 2세트, 4개에서 4세트가 더해지고, 3개·5개에서는 더 늘지 않는다', () => {
  for (const setId of Object.keys(SETS)) {
    let previous = null;
    for (let n = 0; n <= 5; n++) {
      const equipped = none();
      SLOTS.forEach((slot, i) => {
        equipped[slot] = fake(slot, {}, i < n ? setId : null);
      });
      const sheet = computeSheet({ ...base, equipped });
      const expected = emptySheet();
      if (n >= 2) addStats(expected, SETS[setId].bonus[2]);
      if (n >= 4) addStats(expected, SETS[setId].bonus[4]);
      assert.deepEqual(sheet, clampSheet(expected), `${setId} ${n}개`);
      assert.equal(activeSetBonuses(equipped).length, n >= 4 ? 2 : n >= 2 ? 1 : 0);
      if (n === 3 || n === 5) assert.deepEqual(sheet, previous, `${setId}: ${n}개는 ${n - 1}개와 같다`);
      previous = sheet;
    }
  }
});

test('세트 효과: 서로 다른 세트는 따로 세고, 한 세트의 효과는 한 번만 들어간다', () => {
  const equipped = {
    weapon: fake('weapon', {}, 'ember'), armor: fake('armor', {}, 'ember'),
    helm: fake('helm', {}, 'bulwark'), boots: fake('boots', {}, 'bulwark'), accessory: fake('accessory', {}, 'bulwark'),
  };
  assert.deepEqual(setCounts(equipped), { ember: 2, bulwark: 3 });
  const sheet = computeSheet({ ...base, equipped });
  assert.equal(sheet.burnChance, SETS.ember.bonus[2].burnChance);
  assert.equal(sheet.armor, SETS.bulwark.bonus[2].armor);
  assert.equal(sheet.maxHp, 0, '방벽 3개로는 4세트 효과가 없다');
  assert.deepEqual(activeSetBonuses(equipped).map((b) => `${b.setId}:${b.threshold}`), ['ember:2', 'bulwark:2']);
});

test('끼고 벗기를 되풀이해도 능력치가 쌓이지 않는다(항상 처음부터 다시 계산)', () => {
  const a = createArena(openRoom(10, 10), { player: { x: 5.5, y: 5.5 } });
  const inv = a.state.inventory;
  SLOTS.forEach((slot, i) => {
    inv.equipped[slot] = piece(slot, i < 4 ? 'ember' : null, 'epic');
  });
  const first = { ...refreshPlayerStats(a.state) };
  for (let i = 0; i < 50; i++) {
    const held = inv.equipped.weapon;
    inv.equipped.weapon = null;
    refreshPlayerStats(a.state);
    inv.equipped.weapon = held;
    refreshPlayerStats(a.state);
  }
  assert.deepEqual(a.state.run.sheet, first);
  assert.deepEqual(a.state.run.sheet, expectedSheet(a.state).sheet, '독립 계산과 같다');
});

// ── 플레이어에 반영 ──

test('refreshPlayerStats: 합산 능력치가 플레이어 수치로 옮겨진다', () => {
  const a = createArena(openRoom(10, 10), { player: { x: 5.5, y: 5.5 } });
  const { state, player } = a;
  assert.deepEqual([player.maxHp, player.power, player.critChance, player.critDamage, player.haste], [PLAYER.hp, 1, 0, 1.5, 0]);

  state.inventory.equipped.weapon = fake('weapon', { power: 50, critChance: 20, critDamage: 30, haste: 10, lifesteal: 4, burnChance: 12 });
  state.inventory.equipped.armor = fake('armor', { maxHp: 40, armor: 6, regen: 3 });
  state.inventory.equipped.boots = fake('boots', { speed: 10 });
  refreshPlayerStats(state);

  assert.equal(player.maxHp, 140);
  assert.equal(player.hp, 140, '최대 체력이 늘면 현재 체력도 그만큼 는다');
  assert.equal(player.armor, 6);
  assert.ok(Math.abs(player.power - 1.5) < 1e-12);
  assert.ok(Math.abs(player.speed - PLAYER.speed * 1.1) < 1e-12);
  assert.ok(Math.abs(player.critChance - 0.2) < 1e-12);
  assert.ok(Math.abs(player.critDamage - 1.8) < 1e-12);
  assert.ok(Math.abs(player.haste - 0.1) < 1e-12);
  assert.ok(Math.abs(player.lifesteal - 0.04) < 1e-12);
  assert.equal(player.regen, 3);
  assert.deepEqual(player.onHit, [{ id: 'burn', chance: 0.12 }]);
});

test('refreshPlayerStats: 최대 체력이 줄면 현재 체력이 잘리고, 최대 체력은 10 아래로 내려가지 않는다', () => {
  const a = createArena(openRoom(10, 10), { player: { x: 5.5, y: 5.5 } });
  const { state, player } = a;
  state.run.boons.push({ source: 't', stats: { maxHp: -30 } });
  refreshPlayerStats(state);
  assert.deepEqual([player.maxHp, player.hp], [70, 70]);
  player.hp = 20;
  state.run.boons.push({ source: 't', stats: { maxHp: 10 } });
  refreshPlayerStats(state);
  assert.deepEqual([player.maxHp, player.hp], [80, 30], '늘어난 10 만큼만 회복');
  state.run.boons.push({ source: 't', stats: { maxHp: -5000 } });
  refreshPlayerStats(state);
  assert.deepEqual([player.maxHp, player.hp], [10, 10]);
});

// ── 비교값 ──

test('compareEquipment: 교체했을 때 달라지는 능력치와 점수 차이', () => {
  const a = createArena(openRoom(10, 10), { player: { x: 5.5, y: 5.5 } });
  const { state } = a;
  state.inventory.equipped.weapon = fake('weapon', { power: 10, critChance: 5 });
  refreshPlayerStats(state);

  const better = fake('weapon', { power: 16, haste: 3 });
  const cmp = compareEquipment(state, better);
  assert.equal(cmp.slot, 'weapon');
  assert.equal(cmp.current, state.inventory.equipped.weapon);
  assert.deepEqual(cmp.delta, { power: 6, critChance: -5, haste: 3 });
  assert.equal(cmp.scoreDelta, scoreOf({ power: 6, critChance: -5, haste: 3 }));
  assert.deepEqual(sheetOf(state).power, 10, '비교는 상태를 바꾸지 않는다');

  const empty = compareEquipment(state, fake('helm', { maxHp: 12 }));
  assert.equal(empty.current, null);
  assert.deepEqual(empty.delta, { maxHp: 12 });
});

test('compareEquipment: 세트가 깨지거나 완성되는 변화까지 반영한다', () => {
  const a = createArena(openRoom(10, 10), { player: { x: 5.5, y: 5.5 } });
  const { state } = a;
  state.inventory.equipped.weapon = fake('weapon', { power: 10 }, 'ember');
  state.inventory.equipped.armor = fake('armor', { maxHp: 10 }, 'ember');
  refreshPlayerStats(state);
  // 능력치는 더 좋지만 세트가 아닌 무기로 바꾸면 2세트 효과(화상 15)를 잃는다.
  const cmp = compareEquipment(state, fake('weapon', { power: 14 }));
  assert.deepEqual(cmp.delta, { power: 4, burnChance: -15 });
  // 세 번째 세트 장비는 능력치만 더하고, 네 번째에서 4세트 효과가 붙는다.
  state.inventory.equipped.helm = fake('helm', {}, 'ember');
  refreshPlayerStats(state);
  const fourth = compareEquipment(state, fake('boots', { speed: 3 }, 'ember'));
  assert.deepEqual(fourth.delta, { power: 30, speed: 3, critDamage: 30 });
});

test('compareEquipment: 상한에 걸린 능력치는 실제로 늘어나는 만큼만 보여 준다', () => {
  const a = createArena(openRoom(10, 10), { player: { x: 5.5, y: 5.5 } });
  const { state } = a;
  state.run.boons.push({ source: 't', stats: { haste: 48 } });
  refreshPlayerStats(state);
  const cmp = compareEquipment(state, fake('weapon', { haste: 10 }));
  assert.deepEqual(cmp.delta, { haste: 2 });
});
