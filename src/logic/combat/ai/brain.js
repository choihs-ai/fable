// 적 AI 단계(매 틱). 대기 중인 적은 플레이어를 알아채면 전투에 들어가고, 전투 중이면 행동 방식(behaviors.js)을 실행한다.
//
// 상태:
//   idle   — 서서 기다린다. 플레이어가 aggroRadius 안에 있고 시야가 닿거나, 맞으면 combat 으로.
//   combat — 싸운다. 한번 싸우기 시작하면 끝까지 쫓는다(방 전투에서는 문이 잠겨 있어 달아날 곳도, 돌아갈 자리도 없다).
// 방 전투에서 나타난 적은 깨워진 채로(provoked) 만들어져 곧바로 전투에 들어간다.

import { COMBAT } from '../../../../data/combat.js';
import { EVENTS } from '../../core/events.js';
import { ticksOf } from '../../core/time.js';
import { aggroRadiusOf, allActors, getPlayer } from '../../entities/actors.js';
import { ACTOR_KIND, defOf } from '../../entities/defs.js';
import { lineOfSight } from '../../world/los.js';
import { navOf } from '../../world/nav.js';
import { BEHAVIORS } from './behaviors.js';

function setMode(bus, actor, mode) {
  if (actor.ai.mode === mode) return;
  actor.ai.mode = mode;
  bus.emit(EVENTS.AGGRO_CHANGED, { id: actor.id, mode });
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
  actor.moveX = 0;
  actor.moveY = 0;
  actor.moveScale = 1;
  if (actor.disabled || actor.dash || ai.transitionUntil > tick) return;
  if (!target) return;

  if (ai.mode === 'idle') {
    const checkEvery = ticksOf(COMBAT.aggroCheckSec);
    const noticed = ai.provoked || ((tick + actor.id) % checkEvery === 0 && seesTarget(nav, actor, target, aggroRadiusOf(def)));
    if (!noticed) return;
    ai.lastSeenAt = tick;
    setMode(bus, actor, 'combat');
  }
  ai.provoked = false;

  const dx = target.x - actor.x;
  const dy = target.y - actor.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const los = lineOfSight(nav, actor.x, actor.y, target.x, target.y);
  if (los) ai.lastSeenAt = tick;
  // 시야가 끊기면 잠깐 동안은 다시 보여도 계속 다가간다(모퉁이·엄폐물 뒤에서 보였다 안 보였다 하며 제자리걸음하는 것 방지).
  else ai.chaseUntil = tick + ticksOf(COMBAT.chaseCommitSec);
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
