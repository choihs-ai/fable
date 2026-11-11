// 메타 진행: 런과 런 사이에 남는 것(영혼석, 영구 해금, 기록).
// 메타 객체는 게임 상태(state.meta)에 들어 있고, 저장 단계에서 런과 따로 보관한다.

import { META_VERSION, SOULS, UNLOCKS } from '../../../data/meta.js';

export function createMeta() {
  return { version: META_VERSION, souls: 0, unlocked: {}, runs: 0, victories: 0, bestFloor: 0, totalKills: 0 };
}

/** 바깥에서 받은 메타를 검사해 깨끗한 사본을 만든다. 모르는 해금은 버린다. */
export function normalizeMeta(meta) {
  const clean = createMeta();
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return clean;
  for (const key of ['souls', 'runs', 'victories', 'bestFloor', 'totalKills']) {
    if (Number.isInteger(meta[key]) && meta[key] >= 0) clean[key] = meta[key];
  }
  // `UNLOCKS[id]` 로 확인하면 "constructor" 같은 물려받은 이름이 통과한다. 반드시 자기 키인지 본다.
  const unlocked = meta.unlocked !== null && typeof meta.unlocked === 'object' && !Array.isArray(meta.unlocked) ? meta.unlocked : {};
  for (const id of Object.keys(unlocked)) {
    if (Object.hasOwn(UNLOCKS, id) && unlocked[id] === true) clean.unlocked[id] = true;
  }
  return clean;
}

/**
 * 이 해금을 살 수 있는가.
 * @returns {{ ok:true } | { ok:false, reason:string }} reason: 'unknown' | 'owned' | 'locked' | 'no-souls'
 */
export function canUnlock(meta, id) {
  const def = Object.hasOwn(UNLOCKS, id) ? UNLOCKS[id] : null;
  if (!def) return { ok: false, reason: 'unknown' };
  if (meta.unlocked[id]) return { ok: false, reason: 'owned' };
  if (def.requires && !meta.unlocked[def.requires]) return { ok: false, reason: 'locked' };
  if (meta.souls < def.cost) return { ok: false, reason: 'no-souls' };
  return { ok: true };
}

/** 해금을 산다. */
export function purchaseUnlock(meta, id) {
  const check = canUnlock(meta, id);
  if (!check.ok) return check;
  meta.souls -= UNLOCKS[id].cost;
  meta.unlocked[id] = true;
  return { ok: true };
}

/** 해금에서 나오는 시작 보너스(능력치는 능력치 합산에서 따로 더한다). */
export function startBonuses(meta) {
  const start = { gold: 0, consumables: {}, capacity: 0 };
  for (const id of Object.keys(meta.unlocked)) {
    const effect = UNLOCKS[id].effect;
    if (effect.gold) start.gold += effect.gold;
    if (effect.capacity) start.capacity += effect.capacity;
    for (const item of Object.keys(effect.consumables ?? {})) {
      start.consumables[item] = (start.consumables[item] ?? 0) + effect.consumables[item];
    }
  }
  return start;
}

/**
 * 런 한 번의 결과로 얻는 영혼석.
 * @param {{ floor:number, kills:number, bossKills:number, victory:boolean }} summary
 */
export function soulsForRun({ floor, kills, bossKills, victory }) {
  return floor * SOULS.perFloor + kills * SOULS.perKill + bossKills * SOULS.perBossKill + (victory ? SOULS.victory : 0);
}

/** 런 결과를 메타에 반영한다. @returns {number} 얻은 영혼석 */
export function settleRun(meta, summary) {
  const souls = soulsForRun(summary);
  meta.souls += souls;
  meta.runs += 1;
  if (summary.victory) meta.victories += 1;
  meta.bestFloor = Math.max(meta.bestFloor, summary.floor);
  meta.totalKills += summary.kills;
  return souls;
}
