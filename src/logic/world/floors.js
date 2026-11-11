// 층 계획: 층 번호 → 구역. 그리고 방의 종류·보상 이름.

import { WORLD } from '../../../data/world.js';
import { ZONES } from '../../../data/zones.js';

/** 층의 종류. 지금은 "방 여러 개 + 보스 방" 한 가지다. */
export const FLOOR_KIND = Object.freeze({ STAGE: 'stage' });

export const ROOM_KIND = Object.freeze({
  START: 'start',
  COMBAT: 'combat',
  ELITE: 'elite',
  /** 싸우지 않고 보상만 받는 방. */
  REWARD: 'reward',
  SHOP: 'shop',
  BOSS: 'boss',
  /** 보스 방 뒤의 출구 포털. */
  EXIT: 'exit',
  /** 숨은 보너스 방(동굴 모양). */
  BONUS: 'bonus',
});

/** 방을 깨면 받는 것. 문 위에 아이콘으로 보인다. */
export const REWARD = Object.freeze({ WEAPON: 'weapon', BOON: 'boon', GOLD: 'gold', HEALTH: 'health' });

/** 적이 나오는 방인가. */
export function isFightRoom(kind) {
  return kind === ROOM_KIND.COMBAT || kind === ROOM_KIND.ELITE || kind === ROOM_KIND.BOSS;
}

/** 전체 층 수. */
export const TOTAL_FLOORS = WORLD.stages;

/**
 * @param {number} floor 1 부터 TOTAL_FLOORS 까지
 * @returns {{ floor: number, zoneIndex: number, zone: object, kind: string }}
 */
export function floorPlan(floor) {
  if (!Number.isInteger(floor) || floor < 1 || floor > TOTAL_FLOORS) {
    throw new RangeError(`floorPlan: 층은 1~${TOTAL_FLOORS} 사이의 정수여야 합니다 (받은 값: ${floor})`);
  }
  const zoneIndex = (floor - 1) % ZONES.length;
  return { floor, zoneIndex, zone: ZONES[zoneIndex], kind: FLOOR_KIND.STAGE };
}
