// 명중 처리: 피해를 주고, 흡혈과 상태이상을 적용한다. 기술·투사체·장판·돌진이 모두 이 함수를 쓴다.
//
// 피해 = 효과의 기본 피해 × 가해자의 공격 배율(power) × (치명타면 치명타 배율).
// 투사체·장판은 만들어질 때의 공격 배율을 spec.power 에 담아 온다(쏜 뒤에 가해자가 죽어도 같은 피해).
// 치명타·흡혈·공격 시 상태이상은 가해자가 살아 있을 때만 적용된다.

import { rngOf } from '../core/state.js';
import { getActor } from '../entities/actors.js';
import { dealDamage, heal } from './damage.js';
import { applyStatus } from './statuses.js';

/**
 * @param {object} target 맞는 행동체
 * @param {{ damage?:number, status?:object, lifesteal?:number, power?:number }} spec 효과 정의
 * @param {number|null} sourceId 가해자 id
 * @param {number} fromX 피해가 온 위치
 * @param {number} fromY
 * @returns {number} 준 피해
 */
export function applyHit(state, bus, target, spec, sourceId, fromX, fromY) {
  if (target.dead || target.invulnUntil > state.tick) return 0;
  const found = getActor(state, sourceId);
  const source = found && !found.dead ? found : null;

  let amount = spec.damage ?? 0;
  let crit = false;
  if (amount > 0) {
    amount *= spec.power ?? (source ? source.power : 1);
    // 치명타 확률이 있는 가해자만 난수를 쓴다.
    if (source && source.critChance > 0 && rngOf(state, 'combat').chance(source.critChance)) {
      amount *= source.critDamage;
      crit = true;
    }
  }
  const dealt = amount > 0 ? dealDamage(state, bus, target, amount, { sourceId, kind: 'hit', fromX, fromY, crit }) : 0;

  if (source && dealt > 0) {
    const rate = (spec.lifesteal ?? 0) + source.lifesteal;
    if (rate > 0) heal(source, dealt * rate);
  }
  if (spec.status && !target.dead) {
    const s = spec.status;
    // 확률이 있는 상태이상만 난수를 쓴다.
    if (s.chance === undefined || rngOf(state, 'combat').chance(s.chance)) {
      applyStatus(state, bus, target, s.id, { duration: s.duration, stacks: s.stacks, sourceId });
    }
  }
  if (source && source.onHit && dealt > 0) {
    for (const extra of source.onHit) {
      if (target.dead) break;
      if (rngOf(state, 'combat').chance(extra.chance)) applyStatus(state, bus, target, extra.id, { sourceId });
    }
  }
  return dealt;
}
