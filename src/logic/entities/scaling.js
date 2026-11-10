// 층별 난이도: 적의 체력·공격 배율. 곡선은 data/difficulty.js 에 있다.

import { DIFFICULTY } from '../../../data/difficulty.js';
import { WORLD } from '../../../data/world.js';

/**
 * @param {number} floor 1 이상
 * @param {boolean} [boss] 보스면 보스 배율을 더 곱한다
 * @returns {{ hp:number, damage:number }}
 */
export function floorScaling(floor, boss = false) {
  const per = WORLD.floorsPerZone;
  const zoneIndex = Math.min(DIFFICULTY.zones.length - 1, Math.floor((floor - 1) / per));
  const zone = DIFFICULTY.zones[zoneIndex];
  // 구역의 첫 층에서 0, 마지막 층에서 1.
  const t = per > 1 ? ((floor - 1) % per) / (per - 1) : 0;
  const hp = zone.hp[0] + (zone.hp[1] - zone.hp[0]) * t;
  const damage = zone.damage[0] + (zone.damage[1] - zone.damage[0]) * t;
  return boss ? { hp: hp * DIFFICULTY.boss.hp, damage: damage * DIFFICULTY.boss.damage } : { hp, damage };
}
