// 아이템·성장 검증 도구: 로직과 따로 구현한 계산기와 불변식 검사.
// scripts/verify-items.mjs 와 테스트가 함께 쓴다. 여기 계산은 data/ 만 보고 다시 구현한 것이다 —
// src/logic/items 의 함수를 부르지 않는다(로직이 틀렸을 때 같이 틀리지 않도록).

import { CONSUMABLES } from '../../data/consumables.js';
import { AFFIXES, BASES, INVENTORY, RARITIES, RARITY, SETS, SLOTS, STATS } from '../../data/items.js';
import { UNLOCKS } from '../../data/meta.js';
import { PLAYER } from '../../data/player.js';
import { RELICS } from '../../data/relics.js';
import { FILLERS, LEVELING, UPGRADES } from '../../data/upgrades.js';

/** 옵션 값의 허용 범위(독립 구현). */
export function expectedRange(option, rarity, ilvl) {
  const mul = RARITY[rarity].valueMul * (1 + option.growth * (ilvl - 1));
  const lo = Math.max(1, Math.round(option.min * mul));
  return [lo, Math.max(lo, Math.round(option.max * mul))];
}

/**
 * 장비 하나가 규칙을 지키는지 검사한다.
 * @returns {string[]} 위반 목록
 */
export function checkItem(item) {
  const out = [];
  const tag = `장비#${item.uid} ${item.rarity} ${item.base} Lv${item.ilvl}`;
  const base = BASES[item.base];
  if (item.kind !== 'equipment') return [`${tag}: kind 가 equipment 가 아님`];
  if (!base) return [`${tag}: 알 수 없는 기본 종류`];
  if (!RARITIES.includes(item.rarity)) return [`${tag}: 알 수 없는 등급`];
  if (!Number.isInteger(item.ilvl) || item.ilvl < 1) out.push(`${tag}: 잘못된 아이템 레벨`);
  if (base.slot !== item.slot || !SLOTS.includes(item.slot)) out.push(`${tag}: 부위 불일치(${item.slot})`);

  // 고유 옵션: 기본 종류의 정의와 개수·능력치·범위가 맞아야 한다.
  if (item.implicit.length !== base.implicit.length) out.push(`${tag}: 고유 옵션 수 ${item.implicit.length}`);
  base.implicit.forEach((def, i) => {
    const got = item.implicit[i];
    if (!got || got.stat !== def.stat) {
      out.push(`${tag}: 고유 옵션 ${i} 능력치 불일치`);
      return;
    }
    const [lo, hi] = expectedRange(def, item.rarity, item.ilvl);
    if (!Number.isInteger(got.value) || got.value < lo || got.value > hi) out.push(`${tag}: 고유 ${def.stat}=${got.value} 범위 [${lo},${hi}] 위반`);
  });

  // 무작위 옵션: 개수, 중복, 부위 허용, 범위.
  const [minCount, maxCount] = RARITY[item.rarity].affixes;
  if (item.affixes.length < minCount || item.affixes.length > maxCount) out.push(`${tag}: 옵션 수 ${item.affixes.length} (허용 ${minCount}~${maxCount})`);
  const seen = new Set();
  for (const got of item.affixes) {
    if (seen.has(got.stat)) out.push(`${tag}: 옵션 ${got.stat} 중복`);
    seen.add(got.stat);
    const def = AFFIXES.find((a) => a.stat === got.stat);
    if (!def) {
      out.push(`${tag}: 알 수 없는 옵션 ${got.stat}`);
      continue;
    }
    if (def.slots && !def.slots.includes(item.slot)) out.push(`${tag}: ${item.slot} 에 붙을 수 없는 옵션 ${got.stat}`);
    const [lo, hi] = expectedRange(def, item.rarity, item.ilvl);
    if (!Number.isInteger(got.value) || got.value < lo || got.value > hi) out.push(`${tag}: 옵션 ${got.stat}=${got.value} 범위 [${lo},${hi}] 위반`);
  }

  // 세트 장비: 희귀 이상이고, 그 세트의 해당 부위 기본 종류여야 한다.
  if (item.setId) {
    const set = SETS[item.setId];
    if (!set) out.push(`${tag}: 알 수 없는 세트 ${item.setId}`);
    else if (set.pieces[item.slot] !== item.base) out.push(`${tag}: 세트 ${item.setId} 의 ${item.slot} 은 ${set.pieces[item.slot]} 이어야 함`);
    if (RARITIES.indexOf(item.rarity) < RARITIES.indexOf('rare')) out.push(`${tag}: 희귀 미만인데 세트 장비`);
  }
  return out;
}

/** 능력치 합산(독립 구현). */
export function expectedSheet(state) {
  const sum = {};
  for (const key of Object.keys(STATS)) sum[key] = 0;
  const add = (stats, times = 1) => {
    for (const [key, value] of Object.entries(stats)) sum[key] += value * times;
  };
  const { inventory: inv, run, meta } = state;

  for (const [id, on] of Object.entries(meta.unlocked)) if (on && UNLOCKS[id].effect.stats) add(UNLOCKS[id].effect.stats);
  const setPieces = {};
  for (const slot of SLOTS) {
    const item = inv.equipped[slot];
    if (!item) continue;
    for (const opt of [...item.implicit, ...item.affixes]) sum[opt.stat] += opt.value;
    if (item.setId) setPieces[item.setId] = (setPieces[item.setId] ?? 0) + 1;
  }
  // 세트 효과: 2개 이상이면 2세트, 4개 이상이면 4세트 — 각각 딱 한 번.
  for (const [setId, pieces] of Object.entries(setPieces)) {
    if (pieces >= 2) add(SETS[setId].bonus[2]);
    if (pieces >= 4) add(SETS[setId].bonus[4]);
  }
  for (const id of inv.relics) if (RELICS[id].stats) add(RELICS[id].stats);
  for (const [id, rank] of Object.entries(run.upgrades)) add(UPGRADES[id].stats, rank);
  for (const boon of run.boons) add(boon.stats);
  for (const buff of run.buffs) if (buff.until > state.tick) add(buff.stats);

  for (const [key, info] of Object.entries(STATS)) {
    if (info.cap !== undefined) sum[key] = Math.min(sum[key], info.cap);
    if (info.floor !== undefined) sum[key] = Math.max(sum[key], info.floor);
  }
  return { sheet: sum, setPieces };
}

/** 지금 후보가 될 수 있는 강화(독립 구현). */
export function expectedEligible(owned) {
  return Object.keys(UPGRADES).filter((id) => {
    const def = UPGRADES[id];
    if ((owned[id] ?? 0) >= def.maxRank) return false;
    if (Object.entries(def.requires ?? {}).some(([req, rank]) => (owned[req] ?? 0) < rank)) return false;
    return !(def.excludes ?? []).some((other) => (owned[other] ?? 0) > 0);
  });
}

/**
 * 제시된 강화 후보가 규칙을 지키는지 검사한다.
 * @param {object[]} options 제시된 후보
 * @param {object} owned 후보를 뽑던 시점의 강화 단계
 */
export function checkChoice(options, owned) {
  const out = [];
  const eligible = expectedEligible(owned);
  if (options.length !== LEVELING.choices) out.push(`후보 수 ${options.length} (기대 ${LEVELING.choices})`);
  const keys = options.map((o) => `${o.kind}:${o.id}`);
  if (new Set(keys).size !== keys.length) out.push(`후보 중복: ${keys.join(', ')}`);
  const upgrades = options.filter((o) => o.kind === 'upgrade');
  const fillers = options.filter((o) => o.kind === 'filler');
  for (const o of upgrades) {
    if (!UPGRADES[o.id]) out.push(`알 수 없는 강화 ${o.id}`);
    else if (!eligible.includes(o.id)) out.push(`후보가 될 수 없는 강화가 제시됨: ${o.id} (단계 ${owned[o.id] ?? 0}/${UPGRADES[o.id].maxRank})`);
  }
  for (const o of fillers) if (!FILLERS[o.id]) out.push(`알 수 없는 채움 보상 ${o.id}`);
  // 강화 후보가 충분하면 채움 보상이 섞이면 안 되고, 모자라면 모자란 만큼만 채워야 한다.
  const expectedUpgrades = Math.min(LEVELING.choices, eligible.length);
  if (upgrades.length !== expectedUpgrades) out.push(`강화 후보 ${upgrades.length}개 (후보 가능 ${eligible.length}개 → 기대 ${expectedUpgrades}개)`);
  return out;
}

/**
 * 게임 상태의 아이템·성장 불변식을 검사한다.
 * @returns {string[]} 위반 목록
 */
export function checkState(state) {
  const out = [];
  const { inventory: inv, run, meta } = state;
  const player = state.entities.byId[state.playerId];

  // ── 인벤토리 ──
  if (inv.bag.length > inv.capacity) out.push(`가방 ${inv.bag.length}칸 사용 (한도 ${inv.capacity})`);
  let expectedCapacity = INVENTORY.capacity;
  for (const [id, on] of Object.entries(meta.unlocked)) if (on) expectedCapacity += UNLOCKS[id].effect.capacity ?? 0;
  if (inv.capacity !== expectedCapacity) out.push(`가방 한도 ${inv.capacity} (기대 ${expectedCapacity})`);
  if (!Number.isInteger(inv.gold) || inv.gold < 0) out.push(`금화 ${inv.gold}`);
  const uids = new Set();
  const items = [...inv.bag];
  for (const slot of SLOTS) {
    const item = inv.equipped[slot];
    if (!item) continue;
    if (item.slot !== slot) out.push(`${slot} 칸에 ${item.slot} 장비`);
    items.push(item);
  }
  for (const drop of state.drops) if (drop.loot.kind === 'equipment') items.push(drop.loot.item);
  for (const entry of state.shop?.stock ?? []) if (entry.kind === 'equipment' && !entry.sold) items.push(entry.item);
  for (const item of items) {
    if (!Number.isInteger(item.uid) || item.uid < 1) out.push(`장비 고유 번호 없음 (${item.base})`);
    else if (uids.has(item.uid)) out.push(`장비 고유 번호 중복 ${item.uid}`);
    uids.add(item.uid);
    out.push(...checkItem(item));
    if (item.setId && SETS[item.setId].unlock && !meta.unlocked[SETS[item.setId].unlock]) out.push(`해금하지 않은 세트 ${item.setId} 가 나옴`);
  }
  for (const [id, count] of Object.entries(inv.consumables)) {
    if (!CONSUMABLES[id]) out.push(`알 수 없는 소비 아이템 ${id}`);
    else if (CONSUMABLES[id].unlock && !meta.unlocked[CONSUMABLES[id].unlock]) out.push(`해금하지 않은 소비 아이템 ${id}`);
    if (!Number.isInteger(count) || count < 1 || count > INVENTORY.stackMax) out.push(`소비 아이템 ${id} ×${count}`);
  }
  if (new Set(inv.relics).size !== inv.relics.length) out.push(`유물 중복: ${inv.relics}`);
  for (const id of inv.relics) {
    if (!RELICS[id]) out.push(`알 수 없는 유물 ${id}`);
    else if (RELICS[id].unlock && !meta.unlocked[RELICS[id].unlock]) out.push(`해금하지 않은 유물 ${id}`);
  }

  // ── 레벨·강화 ──
  if (!Number.isInteger(run.level) || run.level < 1) out.push(`레벨 ${run.level}`);
  const n = run.level - 1;
  const need = LEVELING.xp.base + LEVELING.xp.linear * n + LEVELING.xp.quad * n * n;
  if (!Number.isInteger(run.xp) || run.xp < 0 || run.xp >= need) out.push(`경험치 ${run.xp} (다음 레벨까지 ${need})`);
  if (!Number.isInteger(run.pendingChoices) || run.pendingChoices < 0) out.push(`쌓인 선택 ${run.pendingChoices}`);
  let ranks = 0;
  for (const [id, rank] of Object.entries(run.upgrades)) {
    const def = UPGRADES[id];
    if (!def) {
      out.push(`알 수 없는 강화 ${id}`);
      continue;
    }
    ranks += rank;
    if (!Number.isInteger(rank) || rank < 1 || rank > def.maxRank) out.push(`강화 ${id} 단계 ${rank} (상한 ${def.maxRank})`);
    for (const [req, minRank] of Object.entries(def.requires ?? {})) {
      if ((run.upgrades[req] ?? 0) < minRank) out.push(`강화 ${id} 의 선행 조건 ${req}≥${minRank} 미충족`);
    }
    for (const other of def.excludes ?? []) if ((run.upgrades[other] ?? 0) > 0) out.push(`배타 강화 ${id}·${other} 를 함께 가짐`);
  }
  if (run.choice) out.push(...checkChoice(run.choice.options, run.upgrades).map((v) => `제시된 후보: ${v}`));

  // ── 능력치: 독립 계산과 같아야 한다 ──
  const { sheet } = expectedSheet(state);
  if (run.sheet) {
    for (const key of Object.keys(STATS)) {
      if (run.sheet[key] !== sheet[key]) out.push(`능력치 ${key}: 로직 ${run.sheet[key]}, 독립 계산 ${sheet[key]}`);
    }
  }
  if (player && !player.dead) {
    const near = (a, b) => Math.abs(a - b) < 1e-9;
    const maxHp = Math.max(10, PLAYER.hp + sheet.maxHp);
    if (player.maxHp !== maxHp) out.push(`최대 체력 ${player.maxHp} (기대 ${maxHp})`);
    if (!Number.isInteger(player.hp) || player.hp < 1 || player.hp > player.maxHp) out.push(`체력 ${player.hp}/${player.maxHp}`);
    if (player.armor !== PLAYER.armor + sheet.armor) out.push(`방어력 ${player.armor}`);
    if (!near(player.power, 1 + sheet.power / 100)) out.push(`공격 배율 ${player.power}`);
    if (!near(player.speed, PLAYER.speed * (1 + sheet.speed / 100))) out.push(`이동 속도 ${player.speed}`);
    if (!near(player.critChance, sheet.critChance / 100)) out.push(`치명타 확률 ${player.critChance}`);
    if (!near(player.critDamage, 1.5 + sheet.critDamage / 100)) out.push(`치명타 배율 ${player.critDamage}`);
    if (!near(player.haste, sheet.haste / 100)) out.push(`재사용 대기 감소 ${player.haste}`);
    if (!near(player.lifesteal, sheet.lifesteal / 100)) out.push(`흡혈 ${player.lifesteal}`);
    if (player.haste > 0.5 + 1e-9 || player.critChance > 0.75 + 1e-9) out.push('상한을 넘은 능력치');
  }
  return out;
}
