// 시간 단위 변환. 로직의 타이머는 전부 정수 틱으로 센다(실수 누적 오차 없음).

import { LOOP } from '../../../data/config.js';

/** 로직 틱 주파수(Hz). */
export const TICK_RATE = LOOP.tickRate;

/** 초 → 틱(반올림). 0 보다 큰 시간은 최소 1틱이 된다. */
export function ticksOf(seconds) {
  if (!(seconds > 0)) return 0;
  return Math.max(1, Math.round(seconds * TICK_RATE));
}
