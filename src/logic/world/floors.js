// 층 계획: 층 번호 → 구역, 구역 안에서의 순번, 층 종류.

import { WORLD } from '../../../data/world.js';
import { ZONES } from '../../../data/zones.js';

export const FLOOR_KIND = Object.freeze({
  NORMAL: 'normal',
  MID_BOSS: 'midBoss',
  FINAL_BOSS: 'finalBoss',
});

/** 전체 층 수. */
export const TOTAL_FLOORS = ZONES.length * WORLD.floorsPerZone;

/**
 * @param {number} floor 1 부터 TOTAL_FLOORS 까지
 * @returns {{ floor: number, zoneIndex: number, zone: object, floorInZone: number, kind: string }}
 */
export function floorPlan(floor) {
  if (!Number.isInteger(floor) || floor < 1 || floor > TOTAL_FLOORS) {
    throw new RangeError(`floorPlan: 층은 1~${TOTAL_FLOORS} 사이의 정수여야 합니다 (받은 값: ${floor})`);
  }
  const zoneIndex = Math.floor((floor - 1) / WORLD.floorsPerZone);
  const zone = ZONES[zoneIndex];
  const floorInZone = ((floor - 1) % WORLD.floorsPerZone) + 1;
  let kind = FLOOR_KIND.NORMAL;
  if (floorInZone === WORLD.floorsPerZone && zone.boss) {
    kind = zone.boss.kind === 'final' ? FLOOR_KIND.FINAL_BOSS : FLOOR_KIND.MID_BOSS;
  }
  return { floor, zoneIndex, zone, floorInZone, kind };
}
