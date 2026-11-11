// 상태이상. 규칙은 data/statuses.js 머리말에 적혀 있다.

import { STATUSES, STATUS_ORDER } from '../../../data/statuses.js';
import { EVENTS } from '../core/events.js';
import { ticksOf } from '../core/time.js';
import { allActors } from '../entities/actors.js';
import { defOf, statusResistOf } from '../entities/defs.js';
import { dealDamage, interrupt } from './damage.js';

function endStatus(state, bus, target, id, reason) {
  delete target.statuses[id];
  const def = STATUSES[id];
  if (def.immunityAfter) target.immuneUntil[id] = state.tick + ticksOf(def.immunityAfter);
  bus.emit(EVENTS.STATUS_ENDED, { targetId: target.id, status: id, reason });
}

/**
 * 상태이상을 건다.
 * @param {object} [options]
 * @param {number} [options.duration] 지속시간(초). 생략하면 기본값
 * @param {number} [options.stacks] 더할 중첩 수(기본 1)
 * @param {number|null} [options.sourceId]
 * @returns {boolean} 새로 걸렸거나 갱신됐으면 true
 */
export function applyStatus(state, bus, target, id, { duration, stacks = 1, sourceId = null } = {}) {
  const def = STATUSES[id];
  if (!def) throw new RangeError(`applyStatus: 알 수 없는 상태이상 "${id}"`);
  if (target.dead || target.invulnUntil > state.tick) return false;
  const resist = statusResistOf(defOf(target), id);
  if (!(resist > 0)) return false;
  if ((target.immuneUntil[id] ?? 0) > state.tick) return false;
  const ticks = Math.round((duration ?? def.duration) * resist * ticksOf(1));
  if (ticks < 1) return false;

  const current = target.statuses[id];
  if (current) {
    if (def.stacking === 'none') return false;
    if (def.stacking === 'intensity') current.stacks = Math.min(def.maxStacks, current.stacks + stacks);
    current.until = Math.max(current.until, state.tick + ticks);
    current.sourceId = sourceId;
  } else {
    for (const other of def.removes ?? []) {
      if (target.statuses[other]) endStatus(state, bus, target, other, 'removed');
    }
    target.statuses[id] = {
      stacks: Math.min(def.maxStacks, Math.max(1, stacks)),
      until: state.tick + ticks,
      // 지속 피해는 건 시점부터 interval 뒤에 처음 들어간다.
      nextTick: def.interval ? state.tick + ticksOf(def.interval) : 0,
      sourceId,
    };
  }
  if (def.disables) {
    target.disabled = true;
    target.moveX = 0;
    target.moveY = 0;
    interrupt(state, bus, target);
  }
  bus.emit(EVENTS.STATUS_APPLIED, {
    targetId: target.id, status: id, stacks: target.statuses[id].stacks, ticks: target.statuses[id].until - state.tick,
  });
  return true;
}

/**
 * 상태이상 단계(매 틱): 지속 피해를 주고, 끝난 것을 지우고, speedMul·disabled 를 다시 계산한다.
 */
export function updateStatuses(state, bus) {
  for (const actor of allActors(state)) {
    if (actor.dead) continue;
    let speedMul = 1;
    let disabled = false;
    for (const id of STATUS_ORDER) {
      const status = actor.statuses[id];
      if (!status) continue;
      const def = STATUSES[id];
      if (def.damage && state.tick >= status.nextTick && status.nextTick <= status.until) {
        status.nextTick += ticksOf(def.interval);
        let amount = def.damage * status.stacks;
        if (def.movingMultiplier && actor.moved) amount *= def.movingMultiplier;
        dealDamage(state, bus, actor, amount, { sourceId: status.sourceId, kind: 'dot' });
        // 피해로 죽었거나(상태이상이 모두 지워짐) 보스 페이즈가 넘어가 정화됐으면 더 볼 것이 없다.
        if (actor.dead || !actor.statuses[id]) continue;
      }
      if (state.tick >= status.until) {
        endStatus(state, bus, actor, id, 'expired');
        continue;
      }
      if (def.speedMul !== undefined && def.speedMul < speedMul) speedMul = def.speedMul;
      if (def.disables) disabled = true;
    }
    if (actor.dead) continue;
    actor.speedMul = speedMul;
    actor.disabled = disabled;
  }
}
