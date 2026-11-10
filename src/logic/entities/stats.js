// 능력치 반영: 아이템·강화·유물에서 합산한 능력치를 플레이어 행동체의 수치로 옮긴다.
// 장비·유물·강화·영구 효과·지속 효과가 바뀔 때마다 부른다(항상 처음부터 다시 계산한다).

import { PLAYER } from '../../../data/player.js';
import { sheetOf } from '../items/stats.js';
import { getPlayer } from './actors.js';

/** 합산 능력치에서 공격 시 상태이상 목록을 만든다. */
function onHitList(sheet) {
  const list = [];
  if (sheet.burnChance > 0) list.push({ id: 'burn', chance: sheet.burnChance / 100 });
  if (sheet.poisonChance > 0) list.push({ id: 'poison', chance: sheet.poisonChance / 100 });
  if (sheet.slowChance > 0) list.push({ id: 'slow', chance: sheet.slowChance / 100 });
  return list;
}

/**
 * @returns {object|null} 합산 능력치(state.run.sheet 에도 저장된다). 플레이어가 없으면 null
 */
export function refreshPlayerStats(state) {
  const player = getPlayer(state);
  if (!player || !state.inventory) return null;
  const sheet = sheetOf(state);
  state.run.sheet = sheet;

  const maxHp = Math.max(10, PLAYER.hp + sheet.maxHp);
  if (maxHp > player.maxHp && !player.dead) player.hp += maxHp - player.maxHp; // 늘어난 만큼 현재 체력도 는다.
  player.maxHp = maxHp;
  if (player.hp > maxHp) player.hp = maxHp;

  player.armor = PLAYER.armor + sheet.armor;
  player.speed = PLAYER.speed * (1 + sheet.speed / 100);
  player.power = 1 + sheet.power / 100;
  player.critChance = sheet.critChance / 100;
  player.critDamage = 1.5 + sheet.critDamage / 100;
  player.lifesteal = sheet.lifesteal / 100;
  player.haste = sheet.haste / 100;
  player.regen = sheet.regen;
  player.onHit = onHitList(sheet);
  return sheet;
}
