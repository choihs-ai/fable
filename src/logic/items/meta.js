// 메타 진행: 런과 런 사이에 남는 것(영혼석, 영구 강화, 해금한 캐릭터, 기록).
// 메타 객체는 게임 상태(state.meta)에 들어 있고, 저장 단계에서 런과 따로 보관한다.

import { CHARACTERS } from '../../../data/characters.js';
import { META_VERSION, SOULS, UPGRADES } from '../../../data/meta.js';

export function createMeta() {
  const characters = {};
  for (const id of Object.keys(CHARACTERS)) if (CHARACTERS[id].cost === 0) characters[id] = true;
  return { version: META_VERSION, souls: 0, upgrades: {}, characters, runs: 0, victories: 0, bestRooms: 0, totalKills: 0 };
}

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** 바깥에서 받은 메타를 검사해 깨끗한 사본을 만든다. 모르는 강화·캐릭터와 범위를 벗어난 단계는 버린다. */
export function normalizeMeta(meta) {
  const clean = createMeta();
  if (!isRecord(meta)) return clean;
  for (const key of ['souls', 'runs', 'victories', 'bestRooms', 'totalKills']) {
    if (Number.isInteger(meta[key]) && meta[key] >= 0) clean[key] = meta[key];
  }
  // `UPGRADES[id]` 로 확인하면 "constructor" 같은 물려받은 이름이 통과한다. 반드시 자기 키인지 본다.
  const upgrades = isRecord(meta.upgrades) ? meta.upgrades : {};
  for (const id of Object.keys(upgrades)) {
    const level = upgrades[id];
    if (Object.hasOwn(UPGRADES, id) && Number.isInteger(level) && level >= 1) clean.upgrades[id] = Math.min(level, UPGRADES[id].cost.length);
  }
  const characters = isRecord(meta.characters) ? meta.characters : {};
  for (const id of Object.keys(characters)) {
    if (Object.hasOwn(CHARACTERS, id) && characters[id] === true) clean.characters[id] = true;
  }
  return clean;
}

export function upgradeLevel(meta, id) {
  return Object.hasOwn(meta.upgrades, id) ? meta.upgrades[id] : 0;
}

/**
 * 이 강화를 한 단계 올릴 수 있는가.
 * @returns {{ ok:true, cost:number } | { ok:false, reason:string }} reason: 'unknown' | 'maxed' | 'no-souls'
 */
export function canBuyUpgrade(meta, id) {
  if (!Object.hasOwn(UPGRADES, id)) return { ok: false, reason: 'unknown' };
  const level = upgradeLevel(meta, id);
  const costs = UPGRADES[id].cost;
  if (level >= costs.length) return { ok: false, reason: 'maxed' };
  if (meta.souls < costs[level]) return { ok: false, reason: 'no-souls' };
  return { ok: true, cost: costs[level] };
}

export function buyUpgrade(meta, id) {
  const check = canBuyUpgrade(meta, id);
  if (!check.ok) return check;
  meta.souls -= check.cost;
  meta.upgrades[id] = upgradeLevel(meta, id) + 1;
  return { ok: true, cost: check.cost, level: meta.upgrades[id] };
}

/**
 * 이 캐릭터를 해금할 수 있는가.
 * @returns {{ ok:true, cost:number } | { ok:false, reason:string }} reason: 'unknown' | 'owned' | 'no-souls'
 */
export function canUnlockCharacter(meta, id) {
  if (!Object.hasOwn(CHARACTERS, id)) return { ok: false, reason: 'unknown' };
  if (meta.characters[id] === true) return { ok: false, reason: 'owned' };
  if (meta.souls < CHARACTERS[id].cost) return { ok: false, reason: 'no-souls' };
  return { ok: true, cost: CHARACTERS[id].cost };
}

export function unlockCharacter(meta, id) {
  const check = canUnlockCharacter(meta, id);
  if (!check.ok) return check;
  meta.souls -= check.cost;
  meta.characters[id] = true;
  return { ok: true, cost: check.cost };
}

/** 영구 강화를 모두 합친 값. */
export function metaBonuses(meta) {
  const total = { maxHp: 0, maxEnergy: 0, power: 0, gold: 0, dashRecharge: 0, freeRerolls: 0 };
  if (!meta) return total;
  for (const id of Object.keys(meta.upgrades)) {
    if (!Object.hasOwn(UPGRADES, id)) continue;
    const effect = UPGRADES[id].effect;
    for (const key of Object.keys(effect)) total[key] += effect[key] * meta.upgrades[id];
  }
  return total;
}

/** 런 하나가 주는 영혼석. */
export function soulsForRun({ roomsCleared, eliteKills, bossKills, victory }) {
  return roomsCleared * SOULS.perRoom + eliteKills * SOULS.perElite + bossKills * SOULS.perBoss + (victory ? SOULS.victory : 0);
}

/**
 * 끝난 런을 메타에 정산한다.
 * @returns {number} 얻은 영혼석
 */
export function settleRun(meta, summary) {
  const souls = soulsForRun(summary);
  meta.souls += souls;
  meta.runs += 1;
  if (summary.victory) meta.victories += 1;
  if (summary.roomsCleared > meta.bestRooms) meta.bestRooms = summary.roomsCleared;
  meta.totalKills += summary.kills;
  return souls;
}
