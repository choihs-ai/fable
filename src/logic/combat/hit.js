// 명중 처리: 피해를 주고, 흡혈과 상태이상을 적용한다. 기술·투사체·장판·돌진이 모두 이 함수를 쓴다.

import { rngOf } from '../core/state.js';
import { getActor } from '../entities/actors.js';
import { dealDamage, heal } from './damage.js';
import { applyStatus } from './statuses.js';

/**
 * @param {object} target 맞는 행동체
 * @param {{ damage?:number, status?:object, lifesteal?:number }} spec 효과 정의
 * @param {number|null} sourceId 가해자 id
 * @param {number} fromX 피해가 온 위치
 * @param {number} fromY
 * @returns {number} 준 피해
 */
export function applyHit(state, bus, target, spec, sourceId, fromX, fromY) {
  if (target.dead || target.invulnUntil > state.tick) return 0;
  const dealt = spec.damage ? dealDamage(state, bus, target, spec.damage, { sourceId, kind: 'hit', fromX, fromY }) : 0;
  if (spec.lifesteal && dealt > 0) {
    const source = getActor(state, sourceId);
    if (source) heal(source, dealt * spec.lifesteal);
  }
  if (spec.status && !target.dead) {
    const s = spec.status;
    // 확률이 있는 상태이상만 난수를 쓴다.
    if (s.chance === undefined || rngOf(state, 'combat').chance(s.chance)) {
      applyStatus(state, bus, target, s.id, { duration: s.duration, stacks: s.stacks, sourceId });
    }
  }
  return dealt;
}
