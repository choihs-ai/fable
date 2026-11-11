// 능력치 합산. 플레이어의 능력치는 항상 "처음부터 다시 더해서" 구한다(더했다 뺐다 하지 않는다).
// 그래서 장비를 몇 번을 꼈다 벗어도 값이 틀어지지 않고, 세트 효과가 두 번 들어갈 수 없다.
//
// 더하는 순서(결과는 순서와 무관하다): 메타 시작 보너스 → 착용 장비(고유+무작위 옵션) → 세트 효과
//   → 유물 → 강화(단계 × 능력치) → 영구 효과(제단의 축복·저주, 채움 보상) → 지속 중인 물약 효과.
// 마지막에 능력치별 상한·하한(data/items.js 의 STATS)을 적용한다.

import { SCORE_WEIGHTS, SETS, SLOTS, STATS } from '../../../data/items.js';
import { UNLOCKS } from '../../../data/meta.js';
import { RELICS } from '../../../data/relics.js';
import { UPGRADES } from '../../../data/upgrades.js';

const STAT_KEYS = Object.keys(STATS);

export function emptySheet() {
  const sheet = {};
  for (const key of STAT_KEYS) sheet[key] = 0;
  return sheet;
}

/** sheet 에 stats 를 times 번 더한다. 모르는 능력치는 예외. */
export function addStats(sheet, stats, times = 1) {
  for (const key of Object.keys(stats)) {
    if (!(key in STATS)) throw new RangeError(`알 수 없는 능력치 "${key}"`);
    sheet[key] += stats[key] * times;
  }
  return sheet;
}

/** 장비 하나의 능력치(고유 + 무작위 옵션). */
export function itemStats(item) {
  const sheet = emptySheet();
  for (const opt of item.implicit) sheet[opt.stat] += opt.value;
  for (const opt of item.affixes) sheet[opt.stat] += opt.value;
  return sheet;
}

/** 착용 중인 세트별 장비 수. 부위마다 하나씩만 낄 수 있으므로 한 세트는 최대 5개. */
export function setCounts(equipped) {
  const counts = {};
  for (const slot of SLOTS) {
    const item = equipped[slot];
    if (item && item.setId) counts[item.setId] = (counts[item.setId] ?? 0) + 1;
  }
  return counts;
}

/**
 * 지금 발동 중인 세트 효과 목록. 세트마다 단계(2, 4)별로 한 번씩만 들어간다.
 * @returns {{ setId:string, pieces:number, threshold:number, stats:object }[]}
 */
export function activeSetBonuses(equipped) {
  const out = [];
  const counts = setCounts(equipped);
  for (const setId of Object.keys(SETS)) {
    const pieces = counts[setId] ?? 0;
    for (const key of Object.keys(SETS[setId].bonus)) {
      const threshold = Number(key);
      if (pieces >= threshold) out.push({ setId, pieces, threshold, stats: SETS[setId].bonus[key] });
    }
  }
  return out;
}

/** 상한·하한을 적용한 최종 능력치. */
export function clampSheet(sheet) {
  const out = {};
  for (const key of STAT_KEYS) {
    let v = sheet[key];
    const info = STATS[key];
    if (info.cap !== undefined && v > info.cap) v = info.cap;
    if (info.floor !== undefined && v < info.floor) v = info.floor;
    out[key] = v;
  }
  return out;
}

/**
 * 능력치를 처음부터 합산한다.
 * @param {object} parts
 * @param {object} parts.equipped 부위 → 장비 또는 null
 * @param {string[]} parts.relics
 * @param {object} parts.upgrades 강화 id → 단계
 * @param {object[]} parts.boons 영구 효과 목록({ stats })
 * @param {object[]} parts.buffs 지속 효과 목록({ stats, until })
 * @param {object|null} parts.meta
 * @param {number} parts.tick 현재 틱(끝난 지속 효과를 거르는 데 쓴다)
 * @returns {object} 상한·하한을 적용한 능력치
 */
export function computeSheet({ equipped, relics, upgrades, boons, buffs, meta, tick }) {
  const sheet = emptySheet();
  if (meta) {
    for (const id of Object.keys(meta.unlocked)) {
      const effect = UNLOCKS[id] && meta.unlocked[id] ? UNLOCKS[id].effect : null;
      if (effect && effect.stats) addStats(sheet, effect.stats);
    }
  }
  for (const slot of SLOTS) {
    const item = equipped[slot];
    if (!item) continue;
    for (const opt of item.implicit) sheet[opt.stat] += opt.value;
    for (const opt of item.affixes) sheet[opt.stat] += opt.value;
  }
  for (const bonus of activeSetBonuses(equipped)) addStats(sheet, bonus.stats);
  for (const id of relics) {
    if (RELICS[id] && RELICS[id].stats) addStats(sheet, RELICS[id].stats);
  }
  for (const id of Object.keys(upgrades)) addStats(sheet, UPGRADES[id].stats, upgrades[id]);
  for (const boon of boons) addStats(sheet, boon.stats);
  for (const buff of buffs) {
    if (buff.until > tick) addStats(sheet, buff.stats);
  }
  return clampSheet(sheet);
}

/** 게임 상태에서 플레이어의 능력치를 합산한다. */
export function sheetOf(state, equippedOverride = null) {
  return computeSheet({
    equipped: equippedOverride ?? state.inventory.equipped,
    relics: state.inventory.relics,
    upgrades: state.run.upgrades,
    boons: state.run.boons,
    buffs: state.run.buffs,
    meta: state.meta,
    tick: state.tick,
  });
}

/** 능력치 묶음의 점수(SCORE_WEIGHTS 가중합). */
export function scoreOf(stats) {
  let score = 0;
  for (const key of Object.keys(stats)) score += stats[key] * (SCORE_WEIGHTS[key] ?? 0);
  return score;
}

/**
 * 비교값: 이 장비를 끼면 능력치가 어떻게 달라지는가. 세트 효과의 변화와 상한까지 반영한 실제 차이다.
 * @returns {{ slot:string, current:object|null, delta:object, scoreDelta:number }} delta 는 달라지는 능력치만 담는다
 */
export function compareEquipment(state, item) {
  const now = sheetOf(state);
  const swapped = { ...state.inventory.equipped, [item.slot]: item };
  const then = sheetOf(state, swapped);
  const delta = {};
  for (const key of STAT_KEYS) {
    if (then[key] !== now[key]) delta[key] = then[key] - now[key];
  }
  return { slot: item.slot, current: state.inventory.equipped[item.slot], delta, scoreDelta: scoreOf(then) - scoreOf(now) };
}
