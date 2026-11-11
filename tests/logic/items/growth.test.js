import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DIFFICULTY } from '../../../data/difficulty.js';
import { STATS } from '../../../data/items.js';
import { SOULS, UNLOCKS } from '../../../data/meta.js';
import { ALTAR } from '../../../data/shop.js';
import { FILLERS, LEVELING, UPGRADES } from '../../../data/upgrades.js';
import { ZONES } from '../../../data/zones.js';
import { Rng } from '../../../src/logic/core/prng.js';
import { floorScaling } from '../../../src/logic/entities/scaling.js';
import { canAccept, generateAltar, hpCost } from '../../../src/logic/items/altar.js';
import { eligibleUpgrades, gainXp, offerChoice, rollChoices, takeChoice, upgradeWeight, xpForKill, xpToNext } from '../../../src/logic/items/levelup.js';
import { canUnlock, createMeta, normalizeMeta, purchaseUnlock, settleRun, soulsForRun, startBonuses } from '../../../src/logic/items/meta.js';
import { checkChoice } from '../../../scripts/lib/item-checks.js';

const newRun = () => ({ level: 1, xp: 0, pendingChoices: 0, choice: null, upgrades: {}, boons: [] });

// ── 레벨 ──

test('경험치 곡선: 레벨이 오를수록 더 많이 필요하다', () => {
  assert.equal(xpToNext(1), LEVELING.xp.base);
  for (let level = 2; level <= 60; level++) assert.ok(xpToNext(level) > xpToNext(level - 1), `레벨 ${level}`);
  assert.equal(xpForKill(40, false), 8);
  assert.equal(xpForKill(1, false), 1, '최소 1');
  assert.ok(xpForKill(400, true) > xpForKill(400, false));
});

test('gainXp: 넘친 경험치는 이월되고, 한 번에 여러 레벨이 오르면 선택이 그만큼 쌓인다', () => {
  const run = newRun();
  assert.equal(gainXp(run, xpToNext(1) - 1), 0);
  assert.deepEqual([run.level, run.xp], [1, xpToNext(1) - 1]);
  assert.equal(gainXp(run, 5), 1);
  assert.deepEqual([run.level, run.xp, run.pendingChoices], [2, 4, 1]);

  const burst = newRun();
  const need = xpToNext(1) + xpToNext(2) + xpToNext(3);
  assert.equal(gainXp(burst, need + 7), 3);
  assert.deepEqual([burst.level, burst.xp, burst.pendingChoices], [4, 7, 3]);
  for (const bad of [-1, 1.5, NaN]) assert.throws(() => gainXp(burst, bad), RangeError);
});

// ── 강화 3택1 ──

test('강화 데이터: 선행 조건·배타 관계가 실제 강화를 가리키고, 능력치가 유효하다', () => {
  for (const [id, def] of Object.entries(UPGRADES)) {
    assert.ok(def.maxRank >= 1 && def.weight > 0 && def.tags.length > 0, id);
    for (const stat of Object.keys(def.stats)) assert.ok(STATS[stat], `${id}: ${stat}`);
    for (const [req, rank] of Object.entries(def.requires ?? {})) assert.ok(UPGRADES[req] && rank <= UPGRADES[req].maxRank, `${id} requires ${req}`);
    for (const other of def.excludes ?? []) {
      assert.ok(UPGRADES[other], `${id} excludes ${other}`);
      assert.ok((UPGRADES[other].excludes ?? []).includes(id), `배타 관계는 양쪽에 적혀 있어야 한다: ${id} ↔ ${other}`);
    }
  }
  assert.ok(Object.keys(FILLERS).length >= LEVELING.choices, '채움 보상만으로도 후보 셋을 채울 수 있어야 한다');
  assert.ok(Object.values(FILLERS).some((f) => f.effect.type === 'stats'));
});

test('후보: 항상 서로 다른 셋이고, 후보가 될 수 있는 강화만 나온다', () => {
  const rng = Rng.fromSeed('choices');
  for (let i = 0; i < 2000; i++) {
    const options = rollChoices(rng, {});
    assert.deepEqual(checkChoice(options, {}), []);
    assert.ok(options.every((o) => o.kind === 'upgrade'), '처음에는 채움 보상이 섞이지 않는다');
  }
});

test('중복 규칙: 단계 상한에 이른 강화는 다시 나오지 않는다', () => {
  const owned = { sharpness: UPGRADES.sharpness.maxRank, vitality: UPGRADES.vitality.maxRank - 1 };
  assert.ok(!eligibleUpgrades(owned).includes('sharpness'));
  assert.ok(eligibleUpgrades(owned).includes('vitality'));
  const rng = Rng.fromSeed('max-rank');
  for (let i = 0; i < 1000; i++) assert.ok(!rollChoices(rng, owned).some((o) => o.id === 'sharpness'));
});

test('선행 조건과 배타 규칙', () => {
  assert.ok(!eligibleUpgrades({}).includes('brutality'));
  assert.ok(eligibleUpgrades({ precision: 1 }).includes('brutality'));
  assert.ok(!eligibleUpgrades({ ember_touch: 1 }).includes('inferno'));
  assert.ok(eligibleUpgrades({ ember_touch: 2 }).includes('inferno'));
  assert.ok(eligibleUpgrades({}).includes('glass_cannon') && eligibleUpgrades({}).includes('juggernaut'));
  assert.ok(!eligibleUpgrades({ glass_cannon: 1 }).includes('juggernaut'));
  assert.ok(!eligibleUpgrades({ juggernaut: 1 }).includes('glass_cannon'));
});

test('시너지: 가진 강화와 태그가 겹칠수록 가중치가 커지고 상한이 있다', () => {
  const base = upgradeWeight('brutality', {});
  assert.equal(base, UPGRADES.brutality.weight);
  // 잔혹(crit, offense)은 정밀(crit)·날카로움(offense)과 태그가 겹친다.
  assert.equal(upgradeWeight('brutality', { precision: 1 }), base * (1 + LEVELING.synergyBonus));
  assert.equal(upgradeWeight('brutality', { precision: 3, sharpness: 1 }), base * (1 + 2 * LEVELING.synergyBonus));
  assert.equal(upgradeWeight('brutality', { vitality: 2 }), base, '겹치는 태그가 없으면 그대로');
  assert.equal(upgradeWeight('brutality', { brutality: 2 }), base, '자기 자신은 세지 않는다');
  const many = { precision: 1, sharpness: 1, inferno: 1, glass_cannon: 1, ember_touch: 2 };
  assert.equal(upgradeWeight('brutality', many), base * LEVELING.synergyCap);

  // 실제로 더 자주 제시된다.
  const rate = (owned) => {
    const rng = Rng.fromSeed('synergy');
    let hits = 0;
    for (let i = 0; i < 6000; i++) if (rollChoices(rng, owned).some((o) => o.id === 'regeneration')) hits++;
    return hits / 6000;
  };
  assert.ok(rate({ vampirism: 1, vitality: 1 }) > rate({}) * 1.3);
});

test('후보 부족: 남은 강화가 2·1·0개면 채움 보상이 그만큼 채운다', () => {
  const maxed = {};
  for (const [id, def] of Object.entries(UPGRADES)) maxed[id] = def.maxRank;
  delete maxed.juggernaut; // 유리 대포와 배타

  const rng = Rng.fromSeed('shortage');
  const fillerIds = Object.keys(FILLERS);
  for (const left of [2, 1, 0]) {
    const owned = { ...maxed };
    const reopen = ['sharpness', 'vitality'].slice(0, left);
    for (const id of reopen) owned[id] = UPGRADES[id].maxRank - 1;
    assert.equal(eligibleUpgrades(owned).length, left);
    for (let i = 0; i < 200; i++) {
      const options = rollChoices(rng, owned);
      assert.deepEqual(checkChoice(options, owned), []);
      assert.equal(options.length, LEVELING.choices);
      assert.deepEqual(options.filter((o) => o.kind === 'upgrade').map((o) => o.id).sort(), [...reopen].sort());
      assert.deepEqual(options.filter((o) => o.kind === 'filler').map((o) => o.id), fillerIds.slice(0, LEVELING.choices - left));
    }
  }
});

test('offerChoice·takeChoice: 쌓인 선택이 하나씩 제시되고, 고르면 단계가 오른다', () => {
  const rng = Rng.fromSeed('offer');
  const run = newRun();
  assert.equal(offerChoice(run, rng), false, '쌓인 선택이 없으면 제시하지 않는다');
  run.pendingChoices = 2;
  assert.equal(offerChoice(run, rng), true);
  assert.equal(offerChoice(run, rng), false, '이미 제시된 후보가 있으면 새로 뽑지 않는다');
  assert.equal(run.pendingChoices, 1);

  const first = run.choice.options[1];
  const result = takeChoice(run, 1);
  assert.deepEqual(result, { kind: 'upgrade', id: first.id, rank: 1 });
  assert.equal(run.upgrades[first.id], 1);
  assert.equal(run.choice, null);
  assert.throws(() => takeChoice(run, 0), /후보가 없습니다/);

  offerChoice(run, rng);
  assert.throws(() => takeChoice(run, 3), RangeError);
  assert.ok(run.choice, '잘못된 번호로는 후보가 사라지지 않는다');
});

test('채움 보상: 능력치형은 영구 효과로 쌓이고, 회복·금화형은 효과를 돌려준다', () => {
  const run = newRun();
  run.choice = { options: Object.keys(FILLERS).map((id) => ({ kind: 'filler', id })) };
  const grit = Object.keys(FILLERS).indexOf('grit');
  const result = takeChoice(run, grit);
  assert.equal(result.kind, 'filler');
  assert.deepEqual(run.boons, [{ source: 'filler:grit', stats: FILLERS.grit.effect.stats }]);
  assert.deepEqual(run.upgrades, {});

  run.choice = { options: [{ kind: 'filler', id: 'feast' }] };
  assert.deepEqual(takeChoice(run, 0), { kind: 'filler', id: 'feast', effect: FILLERS.feast.effect });
  assert.equal(run.boons.length, 1);
});

// ── 제단 ──

test('제단: 크기별 제안 셋, 대가와 보상이 같은 크기에서 나온다', () => {
  const rng = Rng.fromSeed('altar');
  for (let i = 0; i < 300; i++) {
    const floor = 1 + (i % 30);
    const altar = generateAltar(rng, floor);
    assert.equal(altar.used, false);
    assert.deepEqual(altar.offers.map((o) => o.tier), ALTAR.tiers);
    for (const offer of altar.offers) {
      assert.ok(ALTAR.costs[offer.tier].some((c) => c.type === offer.cost.type), `${offer.tier} 대가 ${offer.cost.type}`);
      assert.ok(ALTAR.rewards[offer.tier].some((r) => r.type === offer.reward.type), `${offer.tier} 보상 ${offer.reward.type}`);
      if (offer.cost.type === 'gold') assert.equal(offer.cost.amount, offer.cost.base + offer.cost.perFloor * (floor - 1));
      if (offer.reward.type === 'gold') assert.ok(offer.reward.amount >= offer.reward.base);
    }
  }
  assert.deepEqual(generateAltar(Rng.fromSeed('same'), 7), generateAltar(Rng.fromSeed('same'), 7));
});

test('제단: 받을 수 있는지 판단', () => {
  const altar = {
    used: false,
    offers: [
      { tier: 'small', cost: { type: 'gold', amount: 50 }, reward: { type: 'heal' } },
      { tier: 'medium', cost: { type: 'hpPct', pct: 40 }, reward: { type: 'upgrade' } },
      { tier: 'large', cost: { type: 'maxHp', amount: 25 }, reward: { type: 'relic' } },
    ],
  };
  const player = { hp: 80, maxHp: 100, gold: 49 };
  assert.deepEqual(canAccept(altar, 0, player), { ok: false, reason: 'no-gold' });
  assert.deepEqual(canAccept(altar, 0, { ...player, gold: 50 }), { ok: true });
  assert.deepEqual(canAccept(altar, 1, player), { ok: true });
  assert.deepEqual(canAccept(altar, 1, { ...player, hp: 1 }), { ok: false, reason: 'too-weak' });
  assert.deepEqual(canAccept(altar, 2, { ...player, maxHp: 34 }), { ok: false, reason: 'too-weak' });
  assert.deepEqual(canAccept(altar, 2, { ...player, maxHp: 35 }), { ok: true });
  assert.deepEqual(canAccept(altar, 5, player), { ok: false, reason: 'no-such-offer' });
  assert.deepEqual(canAccept({ ...altar, used: true }, 1, player), { ok: false, reason: 'used' });
});

test('제단: 체력 대가로는 죽지 않는다', () => {
  assert.equal(hpCost(100, 40), 40);
  assert.equal(hpCost(3, 60), 2);
  assert.equal(hpCost(2, 60), 1);
  for (let hp = 2; hp <= 300; hp++) for (const pct of [20, 40, 60]) assert.ok(hp - hpCost(hp, pct) >= 1);
});

// ── 메타 ──

test('메타: 새 메타와 정리(모르는 해금·잘못된 값은 버린다)', () => {
  assert.deepEqual(createMeta(), { version: 1, souls: 0, unlocked: {}, runs: 0, victories: 0, bestFloor: 0, totalKills: 0 });
  const dirty = { souls: 120, runs: -3, bestFloor: 'x', unlocked: { vigor_1: true, cheat: true, might_1: 'yes' }, hacked: 1 };
  assert.deepEqual(normalizeMeta(dirty), { ...createMeta(), souls: 120, unlocked: { vigor_1: true } });
  assert.deepEqual(normalizeMeta(null), createMeta());
  const original = { souls: 5, unlocked: { vigor_1: true } };
  const copy = normalizeMeta(original);
  copy.unlocked.might_1 = true;
  assert.deepEqual(original.unlocked, { vigor_1: true }, '원본을 건드리지 않는다');
});

test('해금: 영혼석이 있어야 하고, 선행 해금을 먼저 사야 하고, 한 번만 살 수 있다', () => {
  const meta = createMeta();
  assert.deepEqual(canUnlock(meta, 'vigor_1'), { ok: false, reason: 'no-souls' });
  meta.souls = 1000;
  assert.deepEqual(canUnlock(meta, 'vigor_2'), { ok: false, reason: 'locked' });
  assert.deepEqual(canUnlock(meta, 'immortality'), { ok: false, reason: 'unknown' });
  assert.deepEqual(purchaseUnlock(meta, 'vigor_1'), { ok: true });
  assert.equal(meta.souls, 1000 - UNLOCKS.vigor_1.cost);
  assert.deepEqual(purchaseUnlock(meta, 'vigor_1'), { ok: false, reason: 'owned' });
  assert.equal(meta.souls, 1000 - UNLOCKS.vigor_1.cost, '실패하면 영혼석이 나가지 않는다');
  assert.deepEqual(purchaseUnlock(meta, 'vigor_2'), { ok: true });
});

test('해금 데이터: 선행 해금이 실제로 있고 비용이 오른다', () => {
  for (const [id, def] of Object.entries(UNLOCKS)) {
    assert.ok(Number.isInteger(def.cost) && def.cost > 0, id);
    if (def.requires) {
      assert.ok(UNLOCKS[def.requires], `${id} requires ${def.requires}`);
      assert.ok(def.cost > UNLOCKS[def.requires].cost, `${id}: 다음 단계가 더 비싸다`);
    }
    for (const stat of Object.keys(def.effect.stats ?? {})) assert.ok(STATS[stat]);
  }
});

test('시작 보너스: 산 해금의 금화·소비 아이템·가방 칸이 합쳐진다', () => {
  assert.deepEqual(startBonuses(createMeta()), { gold: 0, consumables: {}, capacity: 0 });
  const meta = { ...createMeta(), unlocked: { purse_1: true, purse_2: true, provisions: true, satchel: true, vigor_1: true } };
  assert.deepEqual(startBonuses(meta), { gold: 120, consumables: { health_potion: 2 }, capacity: 4 });
});

test('런 정산: 도달 층·처치·보스·클리어에 따라 영혼석을 얻고 기록이 갱신된다', () => {
  const summary = { floor: 12, kills: 80, bossKills: 1, victory: false };
  assert.equal(soulsForRun(summary), 12 * SOULS.perFloor + 80 * SOULS.perKill + SOULS.perBossKill);
  assert.equal(soulsForRun({ ...summary, victory: true }) - soulsForRun(summary), SOULS.victory);

  const meta = { ...createMeta(), souls: 10, bestFloor: 20, totalKills: 5 };
  const gained = settleRun(meta, summary);
  assert.deepEqual(meta, { version: 1, souls: 10 + gained, unlocked: {}, runs: 1, victories: 0, bestFloor: 20, totalKills: 85 });
  settleRun(meta, { floor: 30, kills: 300, bossKills: 4, victory: true });
  assert.deepEqual([meta.runs, meta.victories, meta.bestFloor], [2, 1, 30]);
});

// ── 난이도 곡선 ──

test('난이도: 구역 안에서는 직선으로 오르고, 1층은 배율 1(데이터의 기본 수치)이다', () => {
  assert.equal(DIFFICULTY.zones.length, ZONES.length);
  assert.deepEqual(floorScaling(1), { hp: 1, damage: 1 });
  for (let z = 0; z < ZONES.length; z++) {
    const first = floorScaling(z * 5 + 1);
    const mid = floorScaling(z * 5 + 3);
    const last = floorScaling(z * 5 + 5);
    assert.ok(Math.abs(mid.hp - (first.hp + last.hp) / 2) < 1e-9, `구역 ${z} 체력`);
    assert.ok(Math.abs(mid.damage - (first.damage + last.damage) / 2) < 1e-9, `구역 ${z} 공격`);
    assert.ok(last.hp > first.hp && last.damage > first.damage);
    assert.deepEqual([first.hp, last.hp], DIFFICULTY.zones[z].hp);
  }
});

test('난이도: 보스 배율은 보스에게만, 그 구역의 값으로 곱해진다', () => {
  for (let z = 0; z < ZONES.length; z++) {
    const floor = (z + 1) * 5;
    const normal = floorScaling(floor);
    const boss = floorScaling(floor, true);
    const mul = DIFFICULTY.zones[z].boss;
    assert.equal(Boolean(mul), Boolean(ZONES[z].boss), `구역 ${z}: 보스가 있는 구역에만 보스 배율`);
    if (mul) {
      assert.ok(Math.abs(boss.hp - normal.hp * mul.hp) < 1e-9 && Math.abs(boss.damage - normal.damage * mul.damage) < 1e-9);
    } else {
      assert.deepEqual(boss, normal);
    }
  }
});
