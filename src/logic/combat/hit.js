// 명중 처리: 피해를 주고, 넉백·흡혈·상태이상·축복을 적용한다. 기술·투사체·장판·돌진이 모두 이 함수를 쓴다.
//
// 피해 = 효과의 기본 피해 × 가해자의 공격 배율(power) × (플레이어면 축복 배율) × (치명타면 치명타 배율).
// 투사체·장판은 만들어질 때의 공격 배율을 spec.power 에 담아 온다(쏜 뒤에 가해자가 죽어도 같은 피해).
// 치명타·흡혈·공격 시 상태이상·축복은 가해자가 살아 있을 때만 적용된다.

import { FEEL } from '../../../data/feel.js';
import { PLAYER } from '../../../data/player.js';
import { rngOf } from '../core/state.js';
import { ticksOf } from '../core/time.js';
import { getActor } from '../entities/actors.js';
import { afterHit, onHurt, outgoingMul } from './boons.js';
import { dealDamage, heal, knockback } from './damage.js';
import { applyStatus } from './statuses.js';

/**
 * @param {object} target 맞는 행동체
 * @param {{ damage?:number, status?:object, lifesteal?:number, power?:number, knockback?:number, proc?:boolean }} spec 효과 정의.
 *   proc 이 false 면 축복(번개 연쇄 등)을 부르지 않는다(폭발·갈라진 탄처럼 딸려 나온 피해)
 * @param {number|null} sourceId 가해자 id
 * @param {number} fromX 피해가 온 위치
 * @param {number} fromY
 * @param {boolean} [melee] 근접 공격인가
 * @returns {number} 준 피해
 */
export function applyHit(state, bus, target, spec, sourceId, fromX, fromY, melee = false) {
  if (target.dead || target.invulnUntil > state.tick) return 0;
  const found = getActor(state, sourceId);
  const source = found && !found.dead ? found : null;
  const player = source && source.kit ? source : null;
  const procs = player !== null && spec.proc !== false;

  let amount = spec.damage ?? 0;
  let crit = false;
  if (amount > 0) {
    amount *= spec.power ?? (source ? source.power : 1);
    if (player) amount *= outgoingMul(state, player, target);
    if (procs && player.kit.critUntil > state.tick) {
      // 축복 "잔상": 대시 직후의 첫 공격은 반드시 치명타.
      player.kit.critUntil = 0;
      amount *= player.critDamage;
      crit = true;
    } else if (source && source.critChance > 0 && rngOf(state, 'combat').chance(source.critChance)) {
      // 치명타 확률이 있는 가해자만 난수를 쓴다.
      amount *= source.critDamage;
      crit = true;
    }
  }
  const dealt = amount > 0 ? dealDamage(state, bus, target, amount, { sourceId, kind: 'hit', fromX, fromY, crit }) : 0;
  if (dealt > 0) {
    if (spec.knockback) knockback(state, bus, target, fromX, fromY, spec.knockback);
    // 플레이어는 맞으면 조금 밀려난다(맞았다는 것이 몸으로 느껴지게).
    else if (target.kit) knockback(state, bus, target, fromX, fromY, FEEL.knockback.hurt);
  }

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
  if (procs && dealt > 0) afterHit(state, bus, player, target, dealt, { crit, melee });
  if (target.kit && dealt > 0) {
    // 플레이어는 맞은 뒤 잠깐 무적이다(여러 탄을 한꺼번에 맞아 즉사하지 않도록). 이번 공격의 상태이상은 이미 걸린 뒤다.
    if (!target.dead) target.invulnUntil = Math.max(target.invulnUntil, state.tick + ticksOf(PLAYER.hurtInvuln));
    onHurt(state, bus, target);
  }
  return dealt;
}
