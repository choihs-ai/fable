// 적 AI 단계(매 틱). 어그로·리쉬 상태를 관리하고, 전투 중이면 행동 방식(behaviors.js)을 실행한다.
//
// 상태:
//   idle   — 자기 자리에서 대기. 플레이어가 aggroRadius 안에 있고 시야가 닿거나, 맞으면 combat 으로.
//   combat — 싸운다. 플레이어가 내 자리에서 leashRadius 넘게 멀어지거나, loseSight 초 동안 못 보면 return 으로.
//   return — 빠르게 자리로 돌아가며 체력을 회복한다. 도착하면 체력이 가득 차고 idle 로.
//            돌아가는 중에는 플레이어가 "자리 기준 leashRadius × reaggroLeashRatio" 안에 있을 때만 다시 싸운다.
// 보스는 리쉬가 없다.

import { COMBAT } from '../../../../data/combat.js';
import { EVENTS } from '../../core/events.js';
import { ticksOf } from '../../core/time.js';
import { aggroRulesOf, allActors, getPlayer } from '../../entities/actors.js';
import { ACTOR_KIND, defOf } from '../../entities/defs.js';
import { lineOfSight } from '../../world/los.js';
import { navOf } from '../../world/nav.js';
import { cleanse, heal } from '../damage.js';
import { BEHAVIORS } from './behaviors.js';
import { steerToward } from './steer.js';

function setMode(bus, actor, mode) {
  if (actor.ai.mode === mode) return;
  actor.ai.mode = mode;
  bus.emit(EVENTS.AGGRO_CHANGED, { id: actor.id, mode });
}

function enterCombat(state, bus, actor) {
  actor.ai.lastSeenAt = state.tick;
  actor.ai.provoked = false;
  setMode(bus, actor, 'combat');
}

function startReturn(state, bus, actor) {
  actor.ai.nav.path = null;
  actor.ai.returnStuckSince = 0;
  actor.ai.provoked = false;
  setMode(bus, actor, 'return');
}

function arriveHome(state, bus, actor) {
  actor.hp = actor.maxHp;
  cleanse(state, bus, actor, 'cleansed');
  actor.ai.provoked = false;
  actor.ai.fled = false;
  actor.ai.retreatUntil = 0;
  setMode(bus, actor, 'idle');
}

function seesTarget(nav, actor, target, radius) {
  const dx = target.x - actor.x;
  const dy = target.y - actor.y;
  return dx * dx + dy * dy <= radius * radius && lineOfSight(nav, actor.x, actor.y, target.x, target.y);
}

function think(state, bus, nav, actor, target) {
  const def = defOf(actor);
  const ai = actor.ai;
  const tick = state.tick;
  const rules = aggroRulesOf(def);
  actor.moveX = 0;
  actor.moveY = 0;
  actor.moveScale = 1;
  if (actor.disabled || actor.dash || ai.transitionUntil > tick) return;

  if (ai.mode === 'idle') {
    const checkEvery = ticksOf(COMBAT.aggroCheckSec);
    const noticed = target && (ai.provoked || ((tick + actor.id) % checkEvery === 0 && seesTarget(nav, actor, target, rules.aggroRadius)));
    if (!noticed) {
      // 다른 몸에 밀려 자리를 벗어났으면 걸어서 돌아온다.
      const hx = ai.homeX - actor.x;
      const hy = ai.homeY - actor.y;
      if (hx * hx + hy * hy > COMBAT.homeSlack * COMBAT.homeSlack && !actor.action) {
        const s = steerToward(nav, actor, ai.nav, ai.homeX, ai.homeY, tick);
        actor.moveX = s.x;
        actor.moveY = s.y;
      }
      return;
    }
    enterCombat(state, bus, actor);
  }

  if (ai.mode === 'return') {
    const hx = ai.homeX - actor.x;
    const hy = ai.homeY - actor.y;
    if (target && rules.leashRadius !== null) {
      const tx = target.x - ai.homeX;
      const ty = target.y - ai.homeY;
      const zone = rules.leashRadius * COMBAT.reaggroLeashRatio;
      const inZone = tx * tx + ty * ty <= zone * zone;
      if (inZone && (ai.provoked || seesTarget(nav, actor, target, rules.aggroRadius))) {
        enterCombat(state, bus, actor);
        return;
      }
    }
    ai.provoked = false;
    if (hx * hx + hy * hy < COMBAT.homeSlack * COMBAT.homeSlack) {
      arriveHome(state, bus, actor);
      return;
    }
    if (actor.action) return;
    const s = steerToward(nav, actor, ai.nav, ai.homeX, ai.homeY, tick);
    actor.moveX = s.x;
    actor.moveY = s.y;
    actor.moveScale = COMBAT.returnSpeedMul;
    if (tick % 6 === 0) heal(actor, Math.max(1, actor.maxHp * COMBAT.returnRegenPerSec * 0.1));
    if (s.reachable) {
      ai.returnStuckSince = 0;
    } else {
      // 돌아갈 길을 계속 못 찾으면 자리로 바로 옮긴다(영영 떠도는 것 방지).
      if (ai.returnStuckSince === 0) ai.returnStuckSince = tick;
      if (tick - ai.returnStuckSince > ticksOf(COMBAT.returnGiveUpSec)) {
        actor.x = ai.homeX;
        actor.y = ai.homeY;
        arriveHome(state, bus, actor);
      }
    }
    return;
  }

  // ── 전투 ──
  ai.provoked = false;
  if (!target) {
    startReturn(state, bus, actor);
    return;
  }
  const dx = target.x - actor.x;
  const dy = target.y - actor.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const los = lineOfSight(nav, actor.x, actor.y, target.x, target.y);
  if (los) ai.lastSeenAt = tick;
  // 시야가 끊기면 잠깐 동안은 다시 보여도 계속 다가간다(모퉁이·문턱에서 보였다 안 보였다 하며 제자리걸음하는 것 방지).
  else ai.chaseUntil = tick + ticksOf(COMBAT.chaseCommitSec);

  if (rules.leashRadius !== null) {
    // 리쉬는 "대상이 내 자리에서 얼마나 먼가"로 잰다. 다시 싸우는 조건(reaggroLeashRatio)과 같은 기준이라
    // 순간이동·돌진으로 내가 멀리 나가 있어도 복귀와 재전투 사이를 오락가락하지 않는다.
    const hx = target.x - ai.homeX;
    const hy = target.y - ai.homeY;
    if (hx * hx + hy * hy > rules.leashRadius * rules.leashRadius || tick - ai.lastSeenAt > ticksOf(rules.loseSight)) {
      // 준비 중이던 행동은 끝까지 하고 돌아간다.
      if (!actor.action) startReturn(state, bus, actor);
      return;
    }
  }
  if (actor.action) return;

  const behavior = actor.kind === ACTOR_KIND.BOSS ? BEHAVIORS.boss : BEHAVIORS[def.ai];
  behavior({
    state, bus, nav, actor, def, ai, target, dist, los, tick,
    /** 시야가 막혔거나 방금까지 막혀 있었다 — 자리 잡기보다 다가가기를 우선한다. */
    chasing: !los || tick < ai.chaseUntil,
    ux: dist > 1e-6 ? dx / dist : actor.facingX,
    uy: dist > 1e-6 ? dy / dist : actor.facingY,
  });
}

export function runAI(state, bus) {
  const nav = navOf(state.world);
  const player = getPlayer(state);
  const target = player && !player.dead ? player : null;
  for (const actor of allActors(state)) {
    if (actor.ai && !actor.dead) think(state, bus, nav, actor, target);
  }
}

/** 적을 깨워 다음 판단 때 전투에 들어가게 한다(대기 중일 때만 의미가 있다). */
export function alertEnemy(actor) {
  if (actor.ai) actor.ai.provoked = true;
}
