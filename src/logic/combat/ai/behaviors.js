// 적 행동 방식. 전투 중(mode === 'combat')이고 다른 행동을 하고 있지 않을 때 매 틱 한 번 불린다.
// 각 함수는 이동 의도(actor.moveX/moveY/moveScale)를 정하고, 필요하면 기술을 시작한다.
//
// ctx: { state, bus, nav, actor, def, ai, target, dist, ux, uy(대상 쪽 단위 벡터), los, chasing, tick }

import { rngOf } from '../../core/state.js';
import { ticksOf } from '../../core/time.js';
import { circleFree } from '../../world/collide.js';
import { clearPath } from '../../world/los.js';
import { hasSummonRoom, isReady, startAbility } from '../abilities.js';
import { steerAway, steerToward } from './steer.js';

// ── 공통 도구 ────────────────────────────────────────────────────────────────

function face(ctx) {
  ctx.actor.facingX = ctx.ux;
  ctx.actor.facingY = ctx.uy;
}

/** 대상 쪽으로 간다. 길이 없으면 제자리에 서고 false. */
function approach(ctx) {
  const { actor, target } = ctx;
  const s = steerToward(ctx.nav, actor, ctx.ai.nav, target.x, target.y, ctx.tick);
  actor.moveX = s.x;
  actor.moveY = s.y;
  return s.reachable;
}

/** 대상에게서 멀어진다. 구석에 몰려 못 가면 false. */
function retreat(ctx) {
  const { actor, target } = ctx;
  const s = steerAway(ctx.nav, actor, target.x, target.y);
  actor.moveX = s.x;
  actor.moveY = s.y;
  return s.ok;
}

/** 대상을 보며 옆으로 움직인다. 막히면 방향을 바꾼다. */
function strafe(ctx, scale) {
  const { actor, ai } = ctx;
  if (ctx.tick >= ai.strafeFlipAt) {
    ai.strafeSign = -ai.strafeSign;
    ai.strafeFlipAt = ctx.tick + ticksOf(1.5);
  }
  const sx = -ctx.uy * ai.strafeSign;
  const sy = ctx.ux * ai.strafeSign;
  if (!circleFree(ctx.nav, actor.x + sx * 0.6, actor.y + sy * 0.6, actor.radius)) {
    ai.strafeSign = -ai.strafeSign;
    return;
  }
  actor.moveX = sx;
  actor.moveY = sy;
  actor.moveScale = scale;
}

/** 기술을 쓸 조건(재사용 대기·거리·시야·직선 길·소환 자리)이 맞는가. */
export function canUse(ctx, abilityId) {
  const { state, actor, target } = ctx;
  const ability = ctx.def.abilities[abilityId];
  if (!isReady(state, actor, abilityId)) return false;
  if (ability.range !== undefined && ctx.dist > ability.range) return false;
  if (ability.minRange !== undefined && ctx.dist < ability.minRange) return false;
  if (ability.needsLos !== false && !ctx.los) return false;
  if (ability.needsClearPath && !clearPath(ctx.nav, actor.x, actor.y, target.x, target.y, actor.radius)) return false;
  return hasSummonRoom(state, actor, ability);
}

/** 조건이 맞으면 대상을 겨눠 기술을 시작한다. */
function use(ctx, abilityId, aimX = ctx.ux, aimY = ctx.uy) {
  if (!canUse(ctx, abilityId)) return false;
  return startAbility(ctx.state, ctx.bus, ctx.actor, abilityId, aimX, aimY, ctx.target.x, ctx.target.y);
}

/** 근접 기술의 사거리 밖이거나 시야가 막혔으면 다가간다. */
function closeIn(ctx, abilityId) {
  if (ctx.dist > ctx.def.abilities[abilityId].range * 0.85 || ctx.chasing) approach(ctx);
}

// ── 행동 방식 ────────────────────────────────────────────────────────────────

/** 근접: 쫓아가서 때린다. */
function melee(ctx) {
  const p = ctx.def.aiParams;
  face(ctx);
  if (use(ctx, p.attack)) return;
  closeIn(ctx, p.attack);
}

/** 원거리: [min, max] 거리를 유지하며 쏜다. */
function ranged(ctx) {
  const p = ctx.def.aiParams;
  face(ctx);
  if (use(ctx, p.attack)) return;
  if (ctx.chasing || ctx.dist > p.max) approach(ctx);
  else if (ctx.dist < p.min) retreat(ctx);
  else strafe(ctx, 0.6);
}

/** 돌진: 직선 길이 트이면 예고 후 돌진하고, 붙으면 문다. */
function charger(ctx) {
  const p = ctx.def.aiParams;
  face(ctx);
  if (use(ctx, p.melee)) return;
  if (use(ctx, p.charge)) return;
  closeIn(ctx, p.melee);
}

/** 소환: 하수인을 부르고, 거리를 벌리며 쏜다. */
function summoner(ctx) {
  const p = ctx.def.aiParams;
  face(ctx);
  if (use(ctx, p.summon)) return;
  if (use(ctx, p.attack)) return;
  if (ctx.dist < p.flee && !ctx.chasing) retreat(ctx);
  else if (ctx.chasing || ctx.dist > p.keep + 2) approach(ctx);
  else strafe(ctx, 0.5);
}

/** 치고 빠지기 + 도주: 한 대 치면 물러났다가 다시 오고, 체력이 낮아지면 한 번 크게 달아난다. */
function skirmisher(ctx) {
  const { actor, ai, tick } = ctx;
  const p = ctx.def.aiParams;
  if (!ai.fled && actor.hp < actor.maxHp * p.fleeHp) {
    ai.fled = true;
    ai.retreatUntil = tick + ticksOf(p.fleeSec);
  }
  if (tick < ai.retreatUntil) {
    if (ctx.dist >= p.retreatDist) return; // 충분히 벌어졌으면 기다린다.
    if (retreat(ctx)) return;
    ai.retreatUntil = 0; // 구석에 몰렸으면 그만 달아나고 싸운다.
  }
  face(ctx);
  if (use(ctx, p.attack)) {
    const ability = ctx.def.abilities[p.attack];
    ai.retreatUntil = tick + ticksOf(ability.windup) + ticksOf(ability.recovery) + ticksOf(p.retreatSec);
    return;
  }
  closeIn(ctx, p.attack);
}

/** 자폭: 달려들어 터진다. */
function exploder(ctx) {
  face(ctx);
  if (use(ctx, ctx.def.aiParams.attack)) return;
  approach(ctx);
}

/** 방어/탱커: 몸을 천천히 돌리며 다가온다. 정면 방어는 피해 처리(damage.js)가 맡는다. */
function tank(ctx) {
  const { actor } = ctx;
  const p = ctx.def.aiParams;
  // 바라보는 방향을 대상 쪽으로 조금씩만 돌린다(뒤를 잡을 틈이 생긴다).
  let fx = actor.facingX + (ctx.ux - actor.facingX) * p.turnRate;
  let fy = actor.facingY + (ctx.uy - actor.facingY) * p.turnRate;
  let len = Math.sqrt(fx * fx + fy * fy);
  if (len < 1e-3) {
    // 정반대를 보고 있으면 옆으로 돌기 시작한다.
    fx = -actor.facingY;
    fy = actor.facingX;
    len = 1;
  }
  actor.facingX = fx / len;
  actor.facingY = fy / len;
  const facingTarget = actor.facingX * ctx.ux + actor.facingY * ctx.uy;
  if (use(ctx, p.slam, actor.facingX, actor.facingY)) return;
  if (facingTarget >= 0.7 && use(ctx, p.bash, actor.facingX, actor.facingY)) return;
  closeIn(ctx, p.bash);
}

/** 순간이동: 가까이 붙거나 시야가 막히거나 일정 시간이 지나면 자리를 옮기고, 그 사이에 쏜다. */
function teleporter(ctx) {
  const { ai, tick } = ctx;
  const p = ctx.def.aiParams;
  face(ctx);
  if ((ctx.dist < p.near || !ctx.los || tick >= ai.nextBlinkAt) && use(ctx, p.blink)) {
    ai.nextBlinkAt = tick + ticksOf(p.blinkEvery);
    return;
  }
  if (use(ctx, p.attack)) return;
  if (ctx.chasing) approach(ctx);
  else if (ctx.dist < p.near) retreat(ctx);
}

/** 매복: 덮치고, 물고, 덮치기가 다시 준비될 즈음 물러나 거리를 만든다. */
function ambusher(ctx) {
  const { state, actor, tick } = ctx;
  const p = ctx.def.aiParams;
  const leap = ctx.def.abilities[p.leap];
  face(ctx);
  if (use(ctx, p.leap)) return;
  if (use(ctx, p.bite)) return;
  const leapSoon = (actor.cooldowns[p.leap] ?? 0) - tick < ticksOf(0.8) && !isReady(state, actor, p.bite);
  if (leapSoon && ctx.los && ctx.dist < leap.minRange + 0.3 && retreat(ctx)) return;
  closeIn(ctx, p.bite);
}

/** 선회 강습: 대상 둘레를 돌다가 꿰뚫고 지나간다. */
function swooper(ctx) {
  const { actor, ai } = ctx;
  const p = ctx.def.aiParams;
  face(ctx);
  if (use(ctx, p.dive)) return;
  // 강습하기엔 너무 붙어 있으면 근접 공격을 한다(구석·복도에서 아무것도 못 하는 일이 없도록).
  if (use(ctx, p.melee)) return;
  // 멀리 있거나 시야가 막혔으면 먼저 궤도 근처까지 길을 따라 간다.
  if (ctx.chasing || ctx.dist > p.orbit + 1.5) {
    approach(ctx);
    return;
  }
  // 접선 방향 + 궤도 반지름으로 되돌리는 방향. 막히면 접선만, 그래도 막히면 반대로 돈다.
  const radial = Math.max(-1, Math.min(1, ctx.dist - p.orbit));
  for (const sign of [ai.orbitSign, -ai.orbitSign]) {
    for (const pull of [radial, 0]) {
      let mx = -ctx.uy * sign + ctx.ux * pull;
      let my = ctx.ux * sign + ctx.uy * pull;
      const len = Math.sqrt(mx * mx + my * my);
      mx /= len;
      my /= len;
      if (!circleFree(ctx.nav, actor.x + mx * 0.6, actor.y + my * 0.6, actor.radius)) continue;
      ai.orbitSign = sign;
      actor.moveX = mx;
      actor.moveY = my;
      return;
    }
  }
  // 돌 자리가 없다(복도·구석). 너무 붙어 있으면 물러나 강습 거리를 만들고, 물러날 곳도 없으면 붙어서 근접 공격을 노린다.
  const dive = ctx.def.abilities[p.dive];
  if (ctx.dist < dive.minRange + 0.3 && retreat(ctx)) return;
  if (ctx.dist > ctx.def.abilities[p.melee].range * 0.85) approach(ctx);
}

/** 보스: 현재 페이즈의 패턴 가운데 쓸 수 있는 것을 가중치로 고르고, 패턴 사이에는 페이즈의 이동 방식대로 움직인다. */
function boss(ctx) {
  const { state, actor, ai, def, tick } = ctx;
  const phase = def.phases[ai.phase];
  face(ctx);
  if (tick >= ai.nextPatternAt) {
    const usable = phase.patterns.filter(
      (pt) => ctx.dist >= (pt.minDist ?? 0) && ctx.dist <= (pt.maxDist ?? Infinity) && canUse(ctx, pt.ability),
    );
    if (usable.length > 0) {
      const pick = usable[rngOf(state, 'combat').weightedIndex(usable.map((pt) => pt.weight))];
      const ability = def.abilities[pick.ability];
      if (use(ctx, pick.ability)) {
        ai.nextPatternAt = tick + ticksOf(ability.windup) + ticksOf(ability.recovery) + ticksOf(phase.pauseSec);
        return;
      }
    }
  }
  actor.moveScale = phase.speedMul ?? 1;
  if (phase.move === 'keepAway') {
    if (ctx.chasing || ctx.dist > phase.band[1]) approach(ctx);
    else if (ctx.dist < phase.band[0]) retreat(ctx);
  } else if (ctx.dist > phase.keepDist || ctx.chasing) {
    approach(ctx);
  }
}

export const BEHAVIORS = Object.freeze({
  melee, ranged, charger, summoner, skirmisher, exploder, tank, teleporter, ambusher, swooper, boss,
});
