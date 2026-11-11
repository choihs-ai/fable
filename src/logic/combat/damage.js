// 피해 처리. 모든 피해는 이 함수를 거친다.
//
// 순서: 무적이면 0 → (지속 피해가 아니면) 정면 방어 → 방어력(비율 감소) → 반올림, 최소 1 → 보스 페이즈 경계에서 멈춤 → 체력 차감.
// 체력과 피해는 정수다.

import { COMBAT } from '../../../data/combat.js';
import { EVENTS } from '../core/events.js';
import { ticksOf } from '../core/time.js';
import { defOf } from '../entities/defs.js';

/** 걸려 있는 상태이상을 모두 지운다(죽음·페이즈 전환·자리 복귀 때). */
export function cleanse(state, bus, actor, reason) {
  for (const id of Object.keys(actor.statuses)) {
    bus.emit(EVENTS.STATUS_ENDED, { targetId: actor.id, status: id, reason });
  }
  actor.statuses = {};
  actor.speedMul = 1;
  actor.disabled = false;
}

/** 준비 중이거나 경직 중인 행동을 끊는다. */
export function interrupt(state, bus, actor) {
  if (actor.action) {
    const { ability, phase } = actor.action;
    actor.action = null;
    if (phase === 'windup') bus.emit(EVENTS.ABILITY_INTERRUPTED, { actorId: actor.id, ability });
  }
  actor.dash = null;
}

function beginPhaseTransition(state, bus, target, def) {
  const ai = target.ai;
  const from = ai.phase;
  const ticks = ticksOf(def.transitionSec);
  ai.phase = from + 1;
  ai.transitionUntil = state.tick + ticks;
  ai.nextPatternAt = ai.transitionUntil;
  target.invulnUntil = Math.max(target.invulnUntil, ai.transitionUntil);
  interrupt(state, bus, target);
  cleanse(state, bus, target, 'cleansed');
  bus.emit(EVENTS.BOSS_PHASE_CHANGED, {
    id: target.id, type: target.type, from, to: ai.phase, phases: def.phases.length, ticks,
  });
}

/**
 * @param {object} target 맞는 행동체
 * @param {number} amount 기본 피해
 * @param {object} [options]
 * @param {number|null} [options.sourceId] 가해자 id
 * @param {'hit'|'dot'} [options.kind] dot(지속 피해)는 방어력·정면 방어를 무시한다
 * @param {number} [options.fromX] 피해가 온 위치(정면 방어 판정용)
 * @param {number} [options.fromY]
 * @param {boolean} [options.crit] 치명타였는가(이벤트에 실어 보낼 뿐, 피해량은 이미 반영돼 있어야 한다)
 * @returns {number} 실제로 깎인 체력
 */
export function dealDamage(state, bus, target, amount, { sourceId = null, kind = 'hit', fromX, fromY, crit = false } = {}) {
  if (target.dead || !(amount > 0)) return 0;
  if (target.invulnUntil > state.tick) return 0;
  const def = defOf(target);

  let dmg = amount;
  let blocked = false;
  if (kind !== 'dot') {
    if (def.block && !target.disabled && fromX !== undefined) {
      const dx = fromX - target.x;
      const dy = fromY - target.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 1e-6 && (dx * target.facingX + dy * target.facingY) / len >= def.block.cosHalf) {
        dmg *= 1 - def.block.factor;
        blocked = true;
      }
    }
    // 방어력은 피해를 비율로 줄인다: 받는 피해 = 피해 × K ÷ (K + 방어력). 아무리 높아도 피해가 0 이 되지는 않는다.
    if (target.armor > 0) dmg *= COMBAT.armorK / (COMBAT.armorK + target.armor);
  }
  dmg = Math.max(1, Math.round(dmg));

  // 보스: 현재 페이즈의 체력 경계 아래로는 한 번에 내려가지 않는다(페이즈를 건너뛰지 못한다).
  let transition = false;
  if (def.phases) {
    const phase = def.phases[target.ai.phase];
    if (phase.until > 0) {
      const floorHp = Math.ceil(target.maxHp * phase.until);
      if (target.hp - dmg <= floorHp) {
        dmg = target.hp - floorHp;
        transition = true;
      }
    }
  }

  // 남은 체력보다 많이 깎을 수는 없다(돌려주는 값과 이벤트의 피해량은 실제로 깎인 양이다).
  if (dmg > target.hp) dmg = target.hp;
  target.hp -= dmg;
  if (target.ai && sourceId !== null && sourceId === state.playerId) target.ai.provoked = true;

  if (target.hp <= 0) {
    target.hp = 0;
    target.dead = true;
    target.killerId = sourceId;
    target.moveX = 0;
    target.moveY = 0;
    interrupt(state, bus, target);
    cleanse(state, bus, target, 'removed');
  }
  bus.emit(EVENTS.DAMAGE_DEALT, { targetId: target.id, sourceId, amount: dmg, kind, hp: target.hp, blocked, crit });
  if (transition && !target.dead) beginPhaseTransition(state, bus, target, def);
  return dmg;
}

/** 체력을 회복한다(최대 체력까지). */
export function heal(actor, amount) {
  if (actor.dead || !(amount > 0)) return 0;
  const before = actor.hp;
  actor.hp = Math.min(actor.maxHp, actor.hp + Math.round(amount));
  return actor.hp - before;
}
