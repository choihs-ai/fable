#!/usr/bin/env node
// 아이템·성장 검증. 다섯 가지를 확인하고 통계를 출력한다.
//
//   node scripts/verify-items.mjs                전체 (약 1분)
//   node scripts/verify-items.mjs --runs 100     진행 시뮬레이션 횟수 (기본 400)
//   node scripts/verify-items.mjs --duels 0      곡선 표의 실전 대조(일반 층 1:1 대결)를 끈다 (기본: 런 40개 × 일반 층)
//   node scripts/verify-items.mjs --boss-duels 0 보스 실전 대결을 끈다 (기본: 런 150개 × 보스 4종)
//   node scripts/verify-items.mjs --only curve   한 부분만: drops | ranges | sets | choices | curve
//
//   1. 드롭 확률 분포    — 등급·종류·부위·세트·옵션 수가 설정한 확률대로 나오는가
//   2. 옵션 범위 위반    — 생성된 모든 장비의 옵션 값이 등급·레벨별 범위 안인가
//   3. 세트 효과 중복    — 세트 효과가 단계마다 정확히 한 번만 들어가는가, 끼고 벗기를 되풀이해도 값이 틀어지지 않는가
//   4. 3택1 후보 부족    — 강화를 다 찍어 가는 동안에도 후보가 항상 서로 다른 셋이고 규칙에 맞는가
//   5. 전투력 곡선       — 층별 기대 플레이어 전투력과 적 강도. 급변 구간이 있으면 표시한다
// 위반이나 급변 구간이 하나라도 있으면 종료 코드 1.

import { performance } from 'node:perf_hooks';

import { CONSUMABLES } from '../data/consumables.js';
import { AFFIXES, BASES, DROPS, RARITIES, RARITY, SETS, SLOTS, STATS } from '../data/items.js';
import { SOULS, UNLOCKS } from '../data/meta.js';
import { FILLERS, LEVELING, UPGRADES } from '../data/upgrades.js';
import { ZONES } from '../data/zones.js';
import { equipItem, unequipItem } from '../src/logic/commands.js';
import { Rng } from '../src/logic/core/prng.js';
import { PHASE } from '../src/logic/core/state.js';
import { refreshPlayerStats } from '../src/logic/entities/stats.js';
import { createGame, enterFloor, setPhase } from '../src/logic/game.js';
import { rollChestLoot, rollConsumable, rollKillLoot } from '../src/logic/items/drops.js';
import { rollEquipment, rollEquipmentDrop } from '../src/logic/items/equipment.js';
import { gainXp, offerChoice, takeChoice } from '../src/logic/items/levelup.js';
import { soulsForRun } from '../src/logic/items/meta.js';
import { TOTAL_FLOORS } from '../src/logic/world/floors.js';
import { MODES, runDuel } from './lib/combat-sim.js';
import { checkChoice, checkItem, checkState, expectedEligible, expectedRange, expectedSheet } from './lib/item-checks.js';
import { effectiveHp, enemyStrength, playerDps, simulateRun } from './lib/progress-sim.js';

const problems = [];
const problem = (section, text) => {
  problems.push(`[${section}] ${text}`);
};
const pct = (x, digits = 1) => `${(x * 100).toFixed(digits)}%`;
const pad = (v, n) => String(v).padStart(n);

/** 관측 비율이 기대 확률에서 통계적으로 벗어났는가(표준편차의 4.5배 초과). */
function deviates(count, total, p) {
  const sigma = Math.sqrt(total * p * (1 - p));
  return sigma === 0 ? count !== total * p : Math.abs(count - total * p) > 4.5 * sigma + 1;
}

const ALL_UNLOCKED = { souls: 0, unlocked: Object.fromEntries(Object.keys(UNLOCKS).map((id) => [id, true])) };

// ── 1·2. 드롭 분포와 옵션 범위 ───────────────────────────────────────────────

function sectionDrops(checkRanges) {
  console.log('\n━━ 1. 드롭 확률 분포 ━━');
  const N = 120_000;
  let itemsChecked = 0;
  let rangeViolations = 0;
  const audit = (item) => {
    itemsChecked++;
    const found = checkItem({ ...item, uid: 1 });
    if (found.length > 0) {
      rangeViolations += found.length;
      if (rangeViolations <= 5) problem('옵션 범위', found[0]);
    }
  };

  console.log(`\n장비 등급 분포 (층마다 ${N.toLocaleString()}개, 관측 / 설정)`);
  console.log(`   층   ${RARITIES.map((r) => RARITY[r].name.padEnd(13)).join('')}세트(희귀↑)   부위 최소~최대`);
  const affixCounts = Object.fromEntries(RARITIES.map((r) => [r, {}]));
  for (const floor of [1, 5, 10, 15, 20, 25, 30]) {
    const rng = Rng.fromSeed(`verify:rarity:${floor}`);
    const counts = Object.fromEntries(RARITIES.map((r) => [r, 0]));
    const slots = Object.fromEntries(SLOTS.map((s) => [s, 0]));
    let rarePlus = 0;
    let sets = 0;
    for (let i = 0; i < N; i++) {
      const item = rollEquipmentDrop(rng, { floor, meta: null });
      counts[item.rarity]++;
      slots[item.slot]++;
      if (RARITIES.indexOf(item.rarity) >= 2) {
        rarePlus++;
        if (item.setId) sets++;
      }
      affixCounts[item.rarity][item.affixes.length] = (affixCounts[item.rarity][item.affixes.length] ?? 0) + 1;
      if (item.ilvl !== floor) problem('드롭', `${floor}층 장비의 아이템 레벨이 ${item.ilvl}`);
      audit(item);
    }
    // 설정 확률(이 파일에서 따로 계산).
    const weights = DROPS.rarityWeights.base.map((b, i) => Math.max(0, b + DROPS.rarityWeights.perFloor[i] * (floor - 1)));
    const sum = weights.reduce((a, b) => a + b, 0);
    const cells = RARITIES.map((r, i) => {
      const p = weights[i] / sum;
      if (deviates(counts[r], N, p)) problem('드롭', `${floor}층 ${RARITY[r].name} 관측 ${pct(counts[r] / N, 2)} / 설정 ${pct(p, 2)}`);
      return `${pct(counts[r] / N).padStart(5)}/${pct(p).padEnd(7)}`;
    });
    const setP = DROPS.setChance; // 메타 해금 없이도 세트 2종이 풀에 있다.
    if (deviates(sets, rarePlus, setP)) problem('드롭', `${floor}층 세트 비율 ${pct(sets / rarePlus, 2)} / 설정 ${pct(setP, 2)}`);
    const slotShares = SLOTS.map((s) => slots[s] / N);
    for (const s of SLOTS) if (deviates(slots[s], N, 1 / SLOTS.length)) problem('드롭', `${floor}층 부위 ${s} 비율 ${pct(slots[s] / N, 2)}`);
    console.log(`  ${pad(floor, 3)}   ${cells.join(' ')} ${pct(sets / rarePlus).padStart(5)}/${pct(setP)}   ${pct(Math.min(...slotShares))}~${pct(Math.max(...slotShares))}`);
  }

  console.log('\n등급별 무작위 옵션 수 (관측 비율, 범위 안에서 고르게 나와야 함)');
  for (const rarity of RARITIES) {
    const [lo, hi] = RARITY[rarity].affixes;
    const total = Object.values(affixCounts[rarity]).reduce((a, b) => a + b, 0);
    const cells = [];
    for (const [count, n] of Object.entries(affixCounts[rarity])) {
      if (Number(count) < lo || Number(count) > hi) problem('드롭', `${RARITY[rarity].name} 장비에 옵션 ${count}개`);
      else if (deviates(n, total, 1 / (hi - lo + 1))) problem('드롭', `${RARITY[rarity].name} 옵션 ${count}개 비율 ${pct(n / total, 2)}`);
      cells.push(`${count}개 ${pct(n / total)}`);
    }
    console.log(`  ${RARITY[rarity].name.padEnd(4)} (허용 ${lo}~${hi})  ${cells.join(', ')}  — 표본 ${total.toLocaleString()}`);
  }

  console.log(`\n적 처치 보상 (${N.toLocaleString()}회, 관측 / 설정)`);
  {
    const rng = Rng.fromSeed('verify:kill');
    const c = { gold: 0, equipment: 0, consumable: 0 };
    for (let i = 0; i < N; i++) {
      for (const loot of rollKillLoot(rng, { floor: 12, meta: null, relics: [], boss: false })) {
        c[loot.kind]++;
        if (loot.kind === 'equipment') audit(loot.item);
        if (loot.kind === 'gold' && (!Number.isInteger(loot.amount) || loot.amount < 1)) problem('드롭', `금화 ${loot.amount}`);
      }
    }
    const rule = DROPS.enemy;
    for (const [kind, p] of [['gold', rule.goldChance], ['equipment', rule.equipment], ['consumable', rule.consumable]]) {
      if (deviates(c[kind], N, p)) problem('드롭', `적 처치 ${kind} 관측 ${pct(c[kind] / N, 2)} / 설정 ${pct(p, 2)}`);
    }
    console.log(`  금화 ${pct(c.gold / N)}/${pct(rule.goldChance)}   장비 ${pct(c.equipment / N, 2)}/${pct(rule.equipment, 2)}   소비 아이템 ${pct(c.consumable / N, 2)}/${pct(rule.consumable, 2)}`);
  }

  console.log(`\n상자 내용물 (${N.toLocaleString()}개, 관측 / 설정)`);
  {
    const rng = Rng.fromSeed('verify:chest');
    const c = { equipment: 0, consumable: 0, relic: 0 };
    for (let i = 0; i < N; i++) {
      const loot = rollChestLoot(rng, { floor: 12, meta: null, relics: [] });
      c[loot.kind]++;
      if (loot.kind === 'equipment') audit(loot.item);
    }
    const rule = DROPS.chest;
    const sum = rule.equipment + rule.consumable + rule.relic;
    for (const kind of ['equipment', 'consumable', 'relic']) {
      if (deviates(c[kind], N, rule[kind] / sum)) problem('드롭', `상자 ${kind} 관측 ${pct(c[kind] / N, 2)} / 설정 ${pct(rule[kind] / sum, 2)}`);
    }
    console.log(`  장비 ${pct(c.equipment / N)}/${pct(rule.equipment / sum)}   소비 아이템 ${pct(c.consumable / N)}/${pct(rule.consumable / sum)}   유물 ${pct(c.relic / N, 2)}/${pct(rule.relic / sum, 2)}`);
  }

  console.log('\n보스 보상 (보스 4,000마리)');
  {
    const rng = Rng.fromSeed('verify:boss');
    let relics = 0;
    let equipment = 0;
    let lowRarity = 0;
    const M = 4000;
    for (let i = 0; i < M; i++) {
      for (const loot of rollKillLoot(rng, { floor: 15, meta: null, relics: [], boss: true })) {
        if (loot.kind === 'relic') relics++;
        if (loot.kind === 'equipment') {
          equipment++;
          audit(loot.item);
          if (RARITIES.indexOf(loot.item.rarity) < RARITIES.indexOf(DROPS.boss.minRarity)) lowRarity++;
        }
      }
    }
    if (equipment !== M * DROPS.boss.equipment) problem('드롭', `보스 장비 ${equipment}개 (기대 ${M * DROPS.boss.equipment})`);
    if (lowRarity > 0) problem('드롭', `보스 장비 가운데 ${lowRarity}개가 ${DROPS.boss.minRarity} 미만`);
    if (deviates(relics, M, DROPS.boss.relic)) problem('드롭', `보스 유물 ${pct(relics / M, 2)} / 설정 ${pct(DROPS.boss.relic, 2)}`);
    console.log(`  장비 ${equipment / M}개씩(희귀 미만 ${lowRarity}개)   유물 ${pct(relics / M)}/${pct(DROPS.boss.relic)}`);
  }

  console.log('\n소비 아이템 종류 (20층, 메타 전부 해금, 60,000개, 관측 / 설정)');
  {
    const rng = Rng.fromSeed('verify:consumable');
    const c = {};
    const M = 60_000;
    for (let i = 0; i < M; i++) {
      const id = rollConsumable(rng, 20, ALL_UNLOCKED);
      c[id] = (c[id] ?? 0) + 1;
    }
    const total = Object.values(CONSUMABLES).reduce((a, d) => a + d.weight, 0);
    const cells = Object.keys(CONSUMABLES).map((id) => {
      const p = CONSUMABLES[id].weight / total;
      if (deviates(c[id] ?? 0, M, p)) problem('드롭', `소비 아이템 ${id} 관측 ${pct((c[id] ?? 0) / M, 2)} / 설정 ${pct(p, 2)}`);
      return `${CONSUMABLES[id].name} ${pct((c[id] ?? 0) / M)}/${pct(p)}`;
    });
    console.log(`  ${cells.join('   ')}`);
    // 해금 전·낮은 층에서는 나오면 안 되는 것.
    const early = Rng.fromSeed('verify:consumable:early');
    for (let i = 0; i < 20_000; i++) {
      const id = rollConsumable(early, 1, null);
      if ((CONSUMABLES[id].minFloor ?? 1) > 1 || CONSUMABLES[id].unlock) problem('드롭', `1층·해금 전에 ${id} 가 나옴`);
    }
  }

  if (!checkRanges) return;
  console.log('\n━━ 2. 옵션 범위 위반 ━━');
  // 모든 (기본 종류 × 등급 × 레벨) 조합을 여러 번씩 직접 만들어 검사한다.
  const rng = Rng.fromSeed('verify:ranges');
  const reach = new Map(); // 조합별로 실제 나온 최소·최대
  for (const base of Object.keys(BASES)) {
    for (const rarity of RARITIES) {
      for (let ilvl = 1; ilvl <= TOTAL_FLOORS; ilvl++) {
        for (let k = 0; k < 40; k++) {
          const item = rollEquipment(rng, { ilvl, rarity, base });
          audit(item);
          // 표에 쓸 것: 무작위 옵션으로 실제 나온 값의 최소·최대(고유 옵션은 범위가 달라 따로다).
          for (const opt of item.affixes) {
            const key = `${opt.stat}|${rarity}|${ilvl}`;
            const r = reach.get(key) ?? [Infinity, -Infinity];
            reach.set(key, [Math.min(r[0], opt.value), Math.max(r[1], opt.value)]);
          }
        }
      }
    }
  }
  // 세트 장비도.
  for (const setId of Object.keys(SETS)) {
    for (const slot of SLOTS) {
      for (const rarity of ['rare', 'epic', 'legendary']) {
        for (let k = 0; k < 30; k++) audit(rollEquipment(rng, { ilvl: 1 + ((k * 7) % TOTAL_FLOORS), rarity, slot, setId }));
      }
    }
  }
  // 범위 자체의 성질: 레벨·등급이 오르면 범위가 내려가지 않는다.
  let rangeShape = 0;
  for (const def of [...AFFIXES, ...Object.values(BASES).flatMap((b) => b.implicit)]) {
    for (let ri = 0; ri < RARITIES.length; ri++) {
      for (let ilvl = 1; ilvl <= TOTAL_FLOORS; ilvl++) {
        const [lo, hi] = expectedRange(def, RARITIES[ri], ilvl);
        if (lo < 1 || hi < lo) rangeShape++;
        if (ilvl > 1) {
          const [plo, phi] = expectedRange(def, RARITIES[ri], ilvl - 1);
          if (lo < plo || hi < phi) rangeShape++;
        }
        if (ri > 0) {
          const [plo, phi] = expectedRange(def, RARITIES[ri - 1], ilvl);
          if (lo < plo || hi < phi) rangeShape++;
        }
      }
    }
  }
  if (rangeShape > 0) problem('옵션 범위', `범위가 레벨·등급을 따라 줄어드는 조합 ${rangeShape}개`);
  if (rangeViolations > 5) problem('옵션 범위', `… 외 ${rangeViolations - 5}건`);
  console.log(`  검사한 장비 ${itemsChecked.toLocaleString()}개: 범위·개수·중복·부위·세트 위반 ${rangeViolations}건, 범위 모양 이상 ${rangeShape}건`);

  console.log('\n  공격력 옵션의 범위 (등급 × 아이템 레벨), 괄호 안은 실제로 나온 최소~최대');
  const power = AFFIXES.find((a) => a.stat === 'power');
  console.log(`    레벨   ${RARITIES.map((r) => RARITY[r].name.padEnd(18)).join('')}`);
  for (const ilvl of [1, 10, 20, 30]) {
    const cells = RARITIES.map((r) => {
      const [lo, hi] = expectedRange(power, r, ilvl);
      const got = reach.get(`power|${r}|${ilvl}`);
      return `${lo}~${hi} (${got ? `${got[0]}~${got[1]}` : '-'})`.padEnd(18);
    });
    console.log(`    ${pad(ilvl, 3)}    ${cells.join('')}`);
  }
}

// ── 3. 세트 효과 ─────────────────────────────────────────────────────────────

function sectionSets() {
  console.log('\n━━ 3. 세트 효과 중복 적용 ━━');
  const game = createGame({ seed: 'verify:sets', meta: ALL_UNLOCKED });
  enterFloor(game, 1);
  setPhase(game, PHASE.PLAYING);
  const { state } = game;
  const rng = Rng.fromSeed('verify:sets');
  let uid = 100000;
  const make = (slot, setId) => ({ ...rollEquipment(rng, { ilvl: 10, rarity: 'epic', slot, setId }), uid: uid++ });
  const sheetWith = (equipped) => {
    for (const slot of SLOTS) state.inventory.equipped[slot] = equipped[slot] ?? null;
    return { ...refreshPlayerStats(state) };
  };

  // (가) 세트별로 0~5개를 꼈을 때: 세트 표시만 뗀 같은 장비와의 차이가 정확히 기대한 효과여야 한다.
  let checked = 0;
  console.log('  착용 수별 세트 효과 (세트 표시를 뗀 같은 장비와의 능력치 차이)');
  for (const setId of Object.keys(SETS)) {
    const cells = [];
    for (let pieces = 0; pieces <= SLOTS.length; pieces++) {
      const equipped = {};
      const plain = {};
      SLOTS.forEach((slot, i) => {
        const item = make(slot, i < pieces ? setId : null);
        equipped[slot] = item;
        plain[slot] = { ...item, setId: null };
      });
      const a = sheetWith(equipped);
      const b = sheetWith(plain);
      const expected = {};
      if (pieces >= 2) for (const [k, v] of Object.entries(SETS[setId].bonus[2])) expected[k] = (expected[k] ?? 0) + v;
      if (pieces >= 4) for (const [k, v] of Object.entries(SETS[setId].bonus[4])) expected[k] = (expected[k] ?? 0) + v;
      const diff = {};
      for (const key of Object.keys(STATS)) if (a[key] !== b[key]) diff[key] = a[key] - b[key];
      // 상한에 걸리면 차이가 줄 수 있으므로, 상한 없는 능력치만 엄밀히 비교한다.
      for (const key of new Set([...Object.keys(expected), ...Object.keys(diff)])) {
        const capped = STATS[key].cap !== undefined && a[key] === STATS[key].cap;
        if ((diff[key] ?? 0) !== (expected[key] ?? 0) && !capped) problem('세트', `${setId} ${pieces}개: ${key} 차이 ${diff[key] ?? 0} (기대 ${expected[key] ?? 0})`);
      }
      checked++;
      cells.push(`${pieces}개 ${Object.keys(diff).length === 0 ? '없음' : Object.entries(diff).map(([k, v]) => `${k}+${v}`).join(' ')}`);
    }
    console.log(`    ${SETS[setId].name}: ${cells.join(' | ')}`);
  }

  // (나) 두 세트를 섞어 꼈을 때(2+2, 2+3, 4+1 …)와, 끼고 벗기를 무작위로 되풀이할 때: 매번 독립 계산과 같아야 한다.
  const setIds = Object.keys(SETS);
  let ops = 0;
  let mismatches = 0;
  for (let round = 0; round < 300; round++) {
    state.inventory.bag = [];
    for (const slot of SLOTS) state.inventory.equipped[slot] = null;
    for (let i = 0; i < 12; i++) state.inventory.bag.push(make(rng.pick(SLOTS), rng.chance(0.75) ? rng.pick(setIds) : null));
    refreshPlayerStats(state);
    for (let step = 0; step < 60; step++) {
      const bag = state.inventory.bag;
      if (bag.length > 0 && rng.chance(0.7)) equipItem(game, rng.int(0, bag.length - 1));
      else unequipItem(game, rng.pick(SLOTS));
      ops++;
      const found = checkState(state);
      if (found.length > 0) {
        mismatches++;
        if (mismatches <= 3) problem('세트', `무작위 착용 ${round}-${step}: ${found[0]}`);
      }
      // 세트 효과가 몇 번 들어갔는지 직접 센다: 독립 계산의 세트 개수와, 로직 능력치에서 장비·유물 등을 뺀 나머지를 비교한 것이 위 checkState 이다.
    }
  }
  // (다) 같은 장비를 100번 끼고 벗어도 값이 그대로인가.
  state.inventory.bag = [];
  const fixed = {};
  SLOTS.forEach((slot, i) => {
    fixed[slot] = make(slot, i < 4 ? 'ember' : null);
  });
  const before = sheetWith(fixed);
  for (let i = 0; i < 100; i++) {
    unequipItem(game, 'weapon');
    equipItem(game, state.inventory.bag.length - 1);
    unequipItem(game, 'armor');
    equipItem(game, state.inventory.bag.length - 1);
  }
  const after = { ...state.run.sheet };
  const drift = Object.keys(STATS).filter((k) => before[k] !== after[k]);
  if (drift.length > 0) problem('세트', `100번 끼고 벗은 뒤 능력치가 달라짐: ${drift.join(', ')}`);
  const { setPieces } = expectedSheet(state);
  console.log(`  착용 수 조합 ${checked}가지, 무작위 착용·해제 ${ops.toLocaleString()}회: 독립 계산과 불일치 ${mismatches}건`);
  console.log(`  같은 장비를 100번 끼고 벗은 뒤 능력치 변화: ${drift.length === 0 ? '없음' : drift.join(', ')} (불씨 ${setPieces.ember}개 착용 상태)`);
}

// ── 4. 강화 3택1 ─────────────────────────────────────────────────────────────

function sectionChoices() {
  console.log('\n━━ 4. 강화 3택1 후보 부족 ━━');
  const RUNS = 3000;
  const totalRanks = Object.values(UPGRADES).reduce((a, d) => a + d.maxRank, 0);
  let offers = 0;
  let violations = 0;
  const firstFiller = []; // 채움 보상이 처음 섞인 선택 번호
  const shortage = { 2: 0, 1: 0, 0: 0 }; // 후보가 모자랐던 선택의 수(남은 강화 수별)
  const picked = {};
  const finalRanks = [];
  for (let n = 0; n < RUNS; n++) {
    const rng = Rng.fromSeed(`verify:choices:${n}`);
    const run = { level: 1, xp: 0, pendingChoices: 0, choice: null, upgrades: {}, boons: [] };
    let first = -1;
    for (let pick = 1; pick <= 75; pick++) {
      run.pendingChoices = 1;
      offerChoice(run, rng);
      offers++;
      const { options } = run.choice;
      const eligible = expectedEligible(run.upgrades).length;
      const found = checkChoice(options, run.upgrades);
      if (found.length > 0) {
        violations++;
        if (violations <= 5) problem('3택1', `시드 "verify:choices:${n}" ${pick}번째 선택: ${found[0]}`);
      }
      if (eligible < LEVELING.choices) {
        shortage[eligible]++;
        if (first === -1) first = pick;
      }
      // 강화가 하나라도 있으면 강화 가운데서 무작위로 고른다(끝까지 다 찍어 후보가 바닥나는 상황을 만들기 위해).
      const upgradeSlots = options.map((o, i) => (o.kind === 'upgrade' ? i : -1)).filter((i) => i >= 0);
      const index = upgradeSlots.length > 0 ? rng.pick(upgradeSlots) : rng.int(0, options.length - 1);
      const result = takeChoice(run, index);
      if (result.kind === 'upgrade') picked[result.id] = (picked[result.id] ?? 0) + 1;
    }
    firstFiller.push(first);
    finalRanks.push(Object.values(run.upgrades).reduce((a, b) => a + b, 0));
    // 강화를 우선해 75번 골랐으므로 남은 강화가 없어야 한다(배타 관계인 둘 중 하나만 빼고).
    const left = expectedEligible(run.upgrades);
    if (left.length > 0) problem('3택1', `시드 "verify:choices:${n}": 75번 고른 뒤에도 후보가 남음 (${left.join(', ')})`);
    if (finalRanks[finalRanks.length - 1] !== totalRanks - 1) problem('3택1', `시드 "verify:choices:${n}": 최종 ${finalRanks[finalRanks.length - 1]}단계 (기대 ${totalRanks - 1})`);
    for (const [id, rank] of Object.entries(run.upgrades)) if (rank > UPGRADES[id].maxRank) problem('3택1', `${id} 단계 ${rank}`);
    if (run.upgrades.glass_cannon && run.upgrades.juggernaut) problem('3택1', '배타 강화를 둘 다 가짐');
  }
  firstFiller.sort((a, b) => a - b);
  const avgRanks = finalRanks.reduce((a, b) => a + b, 0) / RUNS;
  console.log(`  ${RUNS.toLocaleString()}개 런 × 75번 선택 = 후보 제시 ${offers.toLocaleString()}회: 규칙 위반 ${violations}건`);
  console.log(`  강화 단계 총합 ${totalRanks} (배타 한 쌍 때문에 한 런에서 찍을 수 있는 최대는 ${totalRanks - 1}), 75번 고른 뒤 평균 ${avgRanks.toFixed(1)}단계`);
  console.log(`  후보가 모자라 채움 보상이 섞인 선택: 강화 2개 남음 ${shortage[2].toLocaleString()}회, 1개 남음 ${shortage[1].toLocaleString()}회, 0개 남음 ${shortage[0].toLocaleString()}회`);
  console.log(`  채움 보상이 처음 섞이는 시점: 가장 이른 런 ${firstFiller[0]}번째 선택, 중앙값 ${firstFiller[Math.floor(RUNS / 2)]}번째 (일반 플레이의 30층 평균 레벨업은 약 20번)`);

  // 한 번에 여러 레벨이 오를 때: 선택이 쌓였다가 하나씩 제시된다.
  const rng = Rng.fromSeed('verify:choices:burst');
  const run = { level: 1, xp: 0, pendingChoices: 0, choice: null, upgrades: {}, boons: [] };
  const gained = gainXp(run, 5000);
  let resolved = 0;
  while (offerChoice(run, rng)) {
    if (checkChoice(run.choice.options, run.upgrades).length > 0) problem('3택1', '한꺼번에 오른 레벨의 후보가 규칙에 어긋남');
    takeChoice(run, 0);
    resolved++;
  }
  if (resolved !== gained || run.pendingChoices !== 0) problem('3택1', `레벨 ${gained}개가 올랐는데 선택은 ${resolved}번`);
  console.log(`  경험치 5,000 을 한 번에 얻음: 레벨 ${gained}개 상승 → 선택 ${resolved}번이 차례로 제시됨`);

  // 시너지: 태그가 겹치는 강화를 가진 쪽이 더 자주 제시되는가.
  const offered = (owned) => {
    const r = Rng.fromSeed('verify:synergy');
    let hits = 0;
    for (let i = 0; i < 20_000; i++) {
      const state = { level: 1, xp: 0, pendingChoices: 1, choice: null, upgrades: { ...owned }, boons: [] };
      offerChoice(state, r);
      if (state.choice.options.some((o) => o.id === 'inferno' || o.id === 'brutality')) hits++;
    }
    return hits / 20_000;
  };
  const none = offered({});
  const withPrereq = offered({ precision: 1, ember_touch: 2 });
  if (none !== 0) problem('3택1', `선행 조건 없이 잔혹·업화가 제시됨 (${pct(none)})`);
  console.log(`  선행 조건: 잔혹·업화가 제시되는 비율 — 조건 없음 ${pct(none)}, 조건 충족 ${pct(withPrereq)}`);
  const fillers = Object.keys(FILLERS).length;
  if (fillers < LEVELING.choices) problem('3택1', `채움 보상이 ${fillers}종뿐 — 후보 ${LEVELING.choices}개를 채울 수 없음`);
}

// ── 5. 전투력 곡선 ───────────────────────────────────────────────────────────

function sectionCurve(runs, duelRuns, bossDuelRuns) {
  console.log('\n━━ 5. 층별 기대 전투력과 적 강도 ━━');
  const perFloor = Array.from({ length: TOTAL_FLOORS }, () => []);
  const duels = Array.from({ length: TOTAL_FLOORS }, () => ({ n: 0, wins: 0, hpLost: 0, sec: 0 }));
  const violations = [];
  let digestA = null;
  for (let n = 0; n < runs; n++) {
    const seed = `curve-${n}`;
    const result = simulateRun({
      seed,
      onFloor:
        n < Math.max(duelRuns, bossDuelRuns)
          ? (game, floor) => {
            // 실전 대조: 이 시점의 장비·강화로 그 층의 적 하나와 실제로 싸워 본다.
            const { state } = game;
            const zone = ZONES[Math.floor((floor - 1) / 5)];
            const strength = enemyStrength(floor);
            if (n >= (strength.boss ? bossDuelRuns : duelRuns)) return;
            const pickRng = Rng.fromSeed(`duel-pick:${seed}:${floor}`);
            const type = strength.boss ? zone.boss.id : zone.enemies[pickRng.weightedIndex(zone.enemies.map((e) => e.weight))].id;
            const r = runDuel({
              seed: `${seed}-f${floor}`, type, mode: MODES.FIGHT, floor,
              build: { inventory: state.inventory, run: state.run, meta: state.meta },
            });
            const d = duels[floor - 1];
            d.n++;
            if (r.outcome === 'enemyDead') {
              d.wins++;
              d.hpLost += 1 - r.playerHp;
              d.sec += r.ticks / 60;
            }
            for (const issue of r.issues) violations.push(`대결 "${seed}-f${floor}" (${type}): ${issue.code} ${issue.detail}`);
          }
          : null,
    });
    for (const v of result.violations) violations.push(`시드 "${seed}" ${v}`);
    result.floors.forEach((snap, i) => perFloor[i].push(snap));
    if (n === 0) digestA = JSON.stringify(result.state);
  }
  // 재현성: 첫 런을 다시 돌려 최종 상태가 같은지.
  const again = JSON.stringify(simulateRun({ seed: 'curve-0' }).state);
  if (again !== digestA) problem('곡선', '같은 시드의 진행 시뮬레이션 결과가 다름');
  // 메타를 전부 해금한 런에서도 불변식이 지켜지는가.
  for (let n = 0; n < Math.min(40, runs); n++) {
    for (const v of simulateRun({ seed: `curve-meta-${n}`, meta: ALL_UNLOCKED }).violations) violations.push(`시드 "curve-meta-${n}"(전부 해금) ${v}`);
  }
  for (const v of violations.slice(0, 8)) problem('곡선', v);
  if (violations.length > 8) problem('곡선', `… 외 ${violations.length - 8}건`);

  const rows = perFloor.map((list, i) => {
    const floor = i + 1;
    const avg = (fn) => list.reduce((a, s) => a + fn(s), 0) / list.length;
    const enemy = enemyStrength(floor);
    const dps = avg((s) => playerDps(s.sheet));
    const ehp = avg((s) => effectiveHp(s.maxHp, s.armor));
    const ttk = enemy.hp / dps;
    const ttd = ehp / enemy.dps;
    const rarity = RARITIES.map((r) => avg((s) => s.rarity.filter((x) => x === r).length));
    return {
      floor, boss: enemy.boss, level: avg((s) => s.level), relics: avg((s) => s.relics), gold: avg((s) => s.gold),
      power: avg((s) => s.sheet.power), crit: avg((s) => s.sheet.critChance), haste: avg((s) => s.sheet.haste),
      maxHp: avg((s) => s.maxHp), armor: avg((s) => s.armor), gear: rarity,
      dps, ehp, enemyHp: enemy.hp, enemyDps: enemy.dps, count: enemy.count, ttk, ttd, threat: ttk / ttd, load: (ttk / ttd) * enemy.count,
    };
  });

  console.log(`  진행 시뮬레이션 ${runs}회 평균 (전투 없이 모든 적 처치·전부 줍기·상점·제단, 레벨업 무작위 선택)`);
  console.log('  플DPS = 기술 초당 피해 × 공격력 × 치명타 기대값 ÷ (1 - 재사용 대기 감소)   유효체력 = 최대 체력 × (K + 방어력) ÷ K');
  console.log('  TTK = 적 체력 ÷ 플DPS (적 하나를 잡는 초)   TTD = 유효체력 ÷ 적 DPS (적 하나가 계속 때릴 때 쓰러지는 초)');
  console.log('  위협 = TTK ÷ TTD (적 하나를 잡는 동안 잃는 체력 비율, 회피 없음 가정)   부담 = 위협 × 적 수');
  console.log(`  실전 = 그 시점의 장비·강화로 그 층의 적 하나와 1:1 (자동 조작, 물약 없음; 일반 층 ${duelRuns}회, 보스 ${bossDuelRuns}회): 승률 / 이겼을 때 잃은 체력`);
  console.log('  급변 기준: 일반 층은 앞 층 대비 위협·TTK·TTD ±12%, 부담 ±25%. 보스는 앞 보스 대비 실전 승률 ±20%p(계산값은 참고).\n');
  console.log('   층   레벨 유물  금화  공격% 치확% 가속%  체력 방어 │ 플DPS 유효체력 │  적HP 적DPS 적수 │   TTK   TTD   위협   부담 │ 변화(위협)  │ 실전');
  const flags = [];
  let prevNormal = null;
  let prevBoss = null;
  for (const r of rows) {
    const prev = r.boss ? prevBoss : prevNormal;
    let change = '';
    if (prev) {
      const dThreat = r.threat / prev.threat - 1;
      const dTtk = r.ttk / prev.ttk - 1;
      const dTtd = r.ttd / prev.ttd - 1;
      const dLoad = r.load / prev.load - 1;
      change = r.boss ? '(계산 참고)' : `${dThreat >= 0 ? '+' : ''}${(dThreat * 100).toFixed(1)}%`;
      const bad = [];
      if (!r.boss && Math.abs(dThreat) > 0.12) bad.push(`위협 ${change}`);
      if (r.boss) {
        // 보스는 패턴마다 위험도가 달라 계산값이 잘 맞지 않는다 — 실전 승률로 본다.
        const now = duels[r.floor - 1];
        const before = duels[prev.floor - 1];
        if (now.n >= 30 && before.n >= 30) {
          const dWin = now.wins / now.n - before.wins / before.n;
          change = `승률 ${dWin >= 0 ? '+' : ''}${(dWin * 100).toFixed(0)}%p`;
          if (Math.abs(dWin) > 0.2) bad.push(`실전 승률 ${(dWin * 100).toFixed(0)}%p`);
        }
      }
      if (!r.boss && Math.abs(dTtk) > 0.12) bad.push(`TTK ${(dTtk * 100).toFixed(1)}%`);
      if (!r.boss && Math.abs(dTtd) > 0.12) bad.push(`TTD ${(dTtd * 100).toFixed(1)}%`);
      if (!r.boss && Math.abs(dLoad) > 0.25) bad.push(`부담 ${(dLoad * 100).toFixed(1)}%`);
      if (bad.length > 0) {
        flags.push(`${prev.floor}층 → ${r.floor}층: ${bad.join(', ')}`);
        change += ' ◀급변';
      }
    }
    const d = duels[r.floor - 1];
    const real = d.n > 0 ? `${pct(d.wins / d.n, 0).padStart(4)} / ${d.wins > 0 ? pct(d.hpLost / d.wins, 0).padStart(3) : '  -'}` : '';
    console.log(
      `  ${pad(r.floor, 3)}${r.boss ? 'B' : ' '} ${r.level.toFixed(1).padStart(5)} ${r.relics.toFixed(1).padStart(4)} ${r.gold.toFixed(0).padStart(5)} ${r.power.toFixed(0).padStart(6)} ${r.crit.toFixed(0).padStart(5)} ${r.haste.toFixed(0).padStart(5)} ${r.maxHp.toFixed(0).padStart(5)} ${r.armor.toFixed(1).padStart(4)} │ ` +
        `${r.dps.toFixed(1).padStart(5)} ${r.ehp.toFixed(0).padStart(7)} │ ${r.enemyHp.toFixed(0).padStart(5)} ${r.enemyDps.toFixed(1).padStart(5)} ${r.count.toFixed(1).padStart(4)} │ ` +
        `${r.ttk.toFixed(2).padStart(5)} ${r.ttd.toFixed(1).padStart(5)} ${r.threat.toFixed(3).padStart(6)} ${r.load.toFixed(2).padStart(6)} │ ${change.padEnd(11)} │ ${real}`,
    );
    if (r.boss) prevBoss = r;
    else prevNormal = r;
  }

  console.log('\n  착용 장비의 등급 구성(5부위 가운데 평균 개수)');
  console.log(`    층   ${RARITIES.map((r) => RARITY[r].name.padStart(5)).join(' ')}   빈칸`);
  for (const floor of [1, 5, 10, 15, 20, 25, 30]) {
    const r = rows[floor - 1];
    const empty = Math.max(0, SLOTS.length - r.gear.reduce((a, b) => a + b, 0));
    console.log(`    ${pad(floor, 2)}   ${r.gear.map((v) => v.toFixed(2).padStart(6)).join(' ')}   ${empty.toFixed(2)}`);
  }

  const first = rows[0];
  const last = rows[rows.length - 2];
  console.log(`\n  일반 층 요약: 위협 ${first.threat.toFixed(3)} → ${last.threat.toFixed(3)} (${(last.threat / first.threat).toFixed(2)}배), 부담 ${first.load.toFixed(2)} → ${last.load.toFixed(2)} (${(last.load / first.load).toFixed(2)}배)`);
  console.log(`  급변 구간: ${flags.length === 0 ? '없음' : ''}`);
  for (const flag of flags) {
    console.log(`    - ${flag}`);
    problem('곡선', `급변 ${flag}`);
  }
  console.log(`  진행 시뮬레이션 불변식 위반: ${violations.length}건 (층 진입·줍기·상점·제단 뒤마다 검사)`);

  console.log('\n  메타 진행 (영혼석)');
  const cases = [['5층에서 사망', 5, 30, 0], ['10층에서 사망', 10, 70, 1], ['20층에서 사망', 20, 170, 2], ['30층 클리어', 30, 300, 4]];
  for (const [label, floor, kills, bossKills] of cases) {
    console.log(`    ${label.padEnd(12)} 약 ${soulsForRun({ floor, kills, bossKills, victory: floor === 30 && bossKills === 4 })}개 (처치 ${kills}, 보스 ${bossKills})`);
  }
  const totalCost = Object.values(UNLOCKS).reduce((a, u) => a + u.cost, 0);
  console.log(`    해금 ${Object.keys(UNLOCKS).length}종 전체 비용 ${totalCost}개 — 층당 ${SOULS.perFloor}, 처치당 ${SOULS.perKill}, 보스당 ${SOULS.perBossKill}, 클리어 ${SOULS.victory}`);
}

// ── 진입점 ───────────────────────────────────────────────────────────────────

function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

const only = option('only', 'all');
const runs = Number(option('runs', '400'));
const duelRuns = Math.min(runs, Number(option('duels', '40')));
const bossDuelRuns = Math.min(runs, Number(option('boss-duels', '150')));
const started = performance.now();
const want = (name) => only === 'all' || only === name;

if (want('drops') || want('ranges')) sectionDrops(want('ranges'));
if (want('sets')) sectionSets();
if (want('choices')) sectionChoices();
if (want('curve')) sectionCurve(runs, duelRuns, bossDuelRuns);

console.log(`\n소요 ${((performance.now() - started) / 1000).toFixed(1)}초`);
console.log(`문제: ${problems.length}건`);
for (const p of problems.slice(0, 40)) console.log(`  - ${p}`);
if (problems.length > 40) console.log(`  … 외 ${problems.length - 40}건`);
process.exit(problems.length > 0 ? 1 : 0);
