import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CHARACTERS } from '../../../data/characters.js';
import { META_VERSION, SOULS, UPGRADES } from '../../../data/meta.js';
import {
  buyUpgrade, canBuyUpgrade, canUnlockCharacter, createMeta, metaBonuses, normalizeMeta, settleRun, soulsForRun, unlockCharacter, upgradeLevel,
} from '../../../src/logic/items/meta.js';

test('새 메타: 영혼석 0, 처음부터 쓸 수 있는 캐릭터만 해금돼 있다', () => {
  const meta = createMeta();
  assert.equal(meta.version, META_VERSION);
  assert.equal(meta.souls, 0);
  assert.deepEqual(meta.upgrades, {});
  assert.deepEqual(Object.keys(meta.characters), Object.keys(CHARACTERS).filter((id) => CHARACTERS[id].cost === 0));
  assert.deepEqual(metaBonuses(meta), { maxHp: 0, maxEnergy: 0, power: 0, gold: 0, dashRecharge: 0, freeRerolls: 0, startBoons: 0, dashCharges: 0, reviveHp: 0, shopDiscount: 0, roomHeal: 0 });
  assert.deepEqual(metaBonuses(null), metaBonuses(meta));
});

test('영구 강화 데이터: 값이 단계마다 오르고 효과가 있다', () => {
  for (const [id, def] of Object.entries(UPGRADES)) {
    assert.ok(def.name && def.desc, id);
    assert.ok(def.cost.length >= 1 && def.cost.every((c, i) => Number.isInteger(c) && c > 0 && (i === 0 || c > def.cost[i - 1])), `${id}: 값`);
    for (const key of Object.keys(def.effect)) assert.ok(key in metaBonuses(null), `${id}: 모르는 효과 ${key}`);
  }
});

test('강화 사기: 단계마다 값이 다르고, 끝까지 올리면 더 사지 못한다', () => {
  const meta = createMeta();
  meta.souls = UPGRADES.vigor.cost[0] - 1;
  assert.deepEqual(canBuyUpgrade(meta, 'vigor'), { ok: false, reason: 'no-souls' });
  meta.souls = 10000;
  let spent = 0;
  for (let level = 1; level <= UPGRADES.vigor.cost.length; level++) {
    const result = buyUpgrade(meta, 'vigor');
    assert.deepEqual(result, { ok: true, cost: UPGRADES.vigor.cost[level - 1], level });
    spent += result.cost;
  }
  assert.equal(meta.souls, 10000 - spent);
  assert.deepEqual(buyUpgrade(meta, 'vigor'), { ok: false, reason: 'maxed' });
  assert.equal(upgradeLevel(meta, 'vigor'), UPGRADES.vigor.cost.length);
  assert.equal(metaBonuses(meta).maxHp, UPGRADES.vigor.effect.maxHp * UPGRADES.vigor.cost.length);
  assert.deepEqual(canBuyUpgrade(meta, 'toString'), { ok: false, reason: 'unknown' });
});

test('캐릭터 해금', () => {
  const meta = createMeta();
  const paid = Object.keys(CHARACTERS).find((id) => CHARACTERS[id].cost > 0);
  assert.deepEqual(canUnlockCharacter(meta, paid), { ok: false, reason: 'no-souls' });
  meta.souls = CHARACTERS[paid].cost;
  assert.deepEqual(unlockCharacter(meta, paid), { ok: true, cost: CHARACTERS[paid].cost });
  assert.equal(meta.souls, 0);
  assert.deepEqual(unlockCharacter(meta, paid), { ok: false, reason: 'owned' });
  assert.deepEqual(unlockCharacter(meta, '__proto__'), { ok: false, reason: 'unknown' });
});

test('런 정산: 깬 방·정예·보스·승리마다 영혼석을 얻고 기록이 쌓인다', () => {
  const summary = { roomsCleared: 5, eliteKills: 2, bossKills: 1, kills: 40, victory: true };
  const expected = 5 * SOULS.perRoom + 2 * SOULS.perElite + SOULS.perBoss + SOULS.victory;
  assert.equal(soulsForRun(summary), expected);
  assert.equal(soulsForRun({ roomsCleared: 0, eliteKills: 0, bossKills: 0, kills: 0, victory: false }), 0);
  const meta = createMeta();
  assert.equal(settleRun(meta, summary), expected);
  settleRun(meta, { roomsCleared: 2, eliteKills: 0, bossKills: 0, kills: 9, victory: false });
  assert.deepEqual(
    { souls: meta.souls, runs: meta.runs, victories: meta.victories, bestRooms: meta.bestRooms, totalKills: meta.totalKills },
    { souls: expected + 2 * SOULS.perRoom, runs: 2, victories: 1, bestRooms: 5, totalKills: 49 },
  );
  // 한 판만 해도 가장 싼 강화 하나쯤은 살 수 있다(다시 하고 싶게).
  const cheapest = Math.min(...Object.values(UPGRADES).map((u) => u.cost[0]));
  assert.ok(soulsForRun({ roomsCleared: 5, eliteKills: 0, bossKills: 0, kills: 30, victory: false }) >= cheapest);
});

test('normalizeMeta: 모르는 강화·캐릭터와 잘못된 값은 버리고, 단계는 상한으로 자른다', () => {
  const clean = normalizeMeta({
    souls: 12, runs: -3, victories: 'x', bestRooms: 4.5, totalKills: 7,
    upgrades: { vigor: 99, might: 0, nope: 2, constructor: 1, purse: '2' },
    characters: { mage: true, knight: false, ghost: true, toString: true },
    extra: 1,
  });
  assert.deepEqual(clean, {
    version: META_VERSION, souls: 12, upgrades: { vigor: UPGRADES.vigor.cost.length }, characters: { knight: true, mage: true },
    runs: 0, victories: 0, bestRooms: 0, totalKills: 7,
  });
  for (const junk of [null, undefined, 5, 'x', [], { upgrades: [] }, { characters: 'a' }]) {
    assert.deepEqual(normalizeMeta(junk), createMeta());
  }
  // 받은 객체를 그대로 쓰지 않는다(사본).
  const source = createMeta();
  const copy = normalizeMeta(source);
  copy.upgrades.vigor = 1;
  assert.deepEqual(source.upgrades, {});
});
