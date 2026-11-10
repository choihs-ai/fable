// 기술 실행기. 플레이어·적·보스가 같은 형식의 기술(data/player.js 설명 참고)을 같은 코드로 쓴다.
//
// 흐름: startAbility → (windup 동안 예고, 방향 고정) → 효과 발동 → (recovery 동안 경직) → 끝.
// 재사용 대기는 발동 시점부터 센다. 준비 중에 행동 불가가 되면 취소된다(재사용 대기는 그대로 돈다).

import { COMBAT } from '../../../data/combat.js';
import { EVENTS } from '../core/events.js';
import { rngOf } from '../core/state.js';
import { TICK_RATE, ticksOf } from '../core/time.js';
import { allActors, findFreeSpot, getPlayer, opponentsOf, spawnEnemy } from '../entities/actors.js';
import { defOf, enemyDef } from '../entities/defs.js';
import { circleFree } from '../world/collide.js';
import { lineOfSight } from '../world/los.js';
import { navOf } from '../world/nav.js';
import { spawnHazard } from './hazards.js';
import { applyHit } from './hit.js';
import { spawnProjectile } from './projectiles.js';
import { applyStatus } from './statuses.js';

export function abilityOf(actor, abilityId) {
  const ability = defOf(actor).abilities[abilityId];
  if (!ability) throw new RangeError(`"${actor.type}" 에게 기술 "${abilityId}" 가 없습니다`);
  return ability;
}

/** 재사용 대기(틱). 재사용 대기 감소(haste)를 반영하고, 0 보다 큰 대기는 최소 1틱이다. */
export function cooldownTicks(actor, seconds) {
  const base = ticksOf(seconds);
  return actor.haste > 0 && base > 0 ? Math.max(1, Math.round(base * (1 - actor.haste))) : base;
}

export function isReady(state, actor, abilityId) {
  return (actor.cooldowns[abilityId] ?? 0) <= state.tick;
}

/** 이 행동체가 소환해서 아직 살아 있는 하수인 수. */
export function minionCount(state, actor) {
  let n = 0;
  for (const other of allActors(state)) {
    if (!other.dead && other.summonerId === actor.id) n++;
  }
  return n;
}

/** 소환 기술이면 지금 더 부를 자리가 있는지 본다(소환이 아닌 기술은 항상 true). */
export function hasSummonRoom(state, actor, ability) {
  for (const effect of ability.effects) {
    if (effect.type === 'summon' && effect.max !== undefined && minionCount(state, actor) >= effect.max) return false;
  }
  return true;
}

// ── 효과 ─────────────────────────────────────────────────────────────────────

function summon(state, bus, actor, effect) {
  const minionDef = enemyDef(effect.enemy);
  let room = effect.count;
  if (effect.max !== undefined) room = Math.min(room, effect.max - minionCount(state, actor));
  const player = getPlayer(state);
  for (let i = 0; i < room; i++) {
    const spot = findFreeSpot(state, actor.x, actor.y, minionDef.radius, COMBAT.summonRadius);
    if (!spot) break;
    // 싸우는 중에 불려 나온 하수인은 곧바로 전투에 들어간다.
    spawnEnemy(state, bus, effect.enemy, spot.x, spot.y, { summonerId: actor.id, alerted: Boolean(player && !player.dead) });
  }
}

function teleport(state, bus, actor, effect, action) {
  const nav = navOf(state.world);
  const tx = action.targetX;
  const ty = action.targetY;
  const candidates = [];
  const reach = Math.ceil(effect.max);
  const cx = Math.floor(tx);
  const cy = Math.floor(ty);
  for (let y = cy - reach; y <= cy + reach; y++) {
    for (let x = cx - reach; x <= cx + reach; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const d2 = (px - tx) * (px - tx) + (py - ty) * (py - ty);
      if (d2 < effect.min * effect.min || d2 > effect.max * effect.max) continue;
      if (!circleFree(nav, px, py, actor.radius) || !lineOfSight(nav, px, py, tx, ty)) continue;
      candidates.push(y * nav.w + x);
    }
  }
  if (candidates.length === 0) return;
  const cell = rngOf(state, 'combat').pick(candidates);
  const fromX = actor.x;
  const fromY = actor.y;
  actor.x = (cell % nav.w) + 0.5;
  actor.y = Math.floor(cell / nav.w) + 0.5;
  if (actor.ai) actor.ai.nav.path = null;
  bus.emit(EVENTS.ENTITY_TELEPORTED, { id: actor.id, fromX, fromY, x: actor.x, y: actor.y });
}

/** 효과 목록을 실행한다. action 은 방향(dirX, dirY)과 목표 지점(targetX, targetY)을 담는다. */
export function runEffects(state, bus, actor, effects, action) {
  const nav = navOf(state.world);
  for (const effect of effects) {
    switch (effect.type) {
      case 'arc': {
        for (const target of opponentsOf(state, actor.faction)) {
          const dx = target.x - actor.x;
          const dy = target.y - actor.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > effect.range + target.radius) continue;
          // 겹쳐 있으면 방향과 무관하게 맞는다.
          if (d > 1e-6 && (dx * action.dirX + dy * action.dirY) / d < effect.cosHalf) continue;
          // 벽 너머로는 맞지 않는다.
          if (!lineOfSight(nav, actor.x, actor.y, target.x, target.y)) continue;
          applyHit(state, bus, target, effect, actor.id, actor.x, actor.y);
        }
        break;
      }
      case 'circle': {
        for (const target of opponentsOf(state, actor.faction)) {
          const dx = target.x - actor.x;
          const dy = target.y - actor.y;
          const reach = effect.radius + target.radius;
          if (dx * dx + dy * dy > reach * reach) continue;
          if (!lineOfSight(nav, actor.x, actor.y, target.x, target.y)) continue;
          applyHit(state, bus, target, effect, actor.id, actor.x, actor.y);
        }
        break;
      }
      case 'projectile': {
        for (const [c, s] of effect.spread ?? [[1, 0]]) {
          spawnProjectile(state, bus, actor, effect, action.dirX * c - action.dirY * s, action.dirX * s + action.dirY * c);
        }
        break;
      }
      case 'hazard': {
        for (const [ox, oy] of effect.offsets ?? [[0, 0]]) {
          spawnHazard(state, bus, actor, effect, action.targetX + ox, action.targetY + oy);
        }
        break;
      }
      case 'dash': {
        actor.dash = {
          dirX: action.dirX,
          dirY: action.dirY,
          speed: effect.speed,
          endAt: state.tick + Math.max(1, Math.ceil((effect.distance / effect.speed) * TICK_RATE)),
          damage: effect.damage ?? 0,
          status: effect.status ?? null,
          /** 이미 맞힌 대상 id(한 번의 돌진은 대상마다 한 번만 맞는다). */
          hit: [],
          stopOnWall: effect.stopOnWall === true,
          stunOnWall: effect.stunOnWall ?? 0,
          done: false,
          wall: false,
        };
        break;
      }
      case 'summon':
        summon(state, bus, actor, effect);
        break;
      case 'teleport':
        teleport(state, bus, actor, effect, action);
        break;
      case 'die':
        // 자폭: 앞선 효과를 낸 뒤 스스로 죽는다.
        actor.hp = 0;
        actor.dead = true;
        actor.killerId = actor.id;
        actor.dash = null;
        actor.statuses = {};
        break;
      default:
        throw new RangeError(`알 수 없는 효과 "${effect.type}"`);
    }
    if (actor.dead && effect.type !== 'die') break;
  }
}

function fire(state, bus, actor, ability, action) {
  bus.emit(EVENTS.ABILITY_USED, { actorId: actor.id, ability: action.ability });
  runEffects(state, bus, actor, ability.effects, action);
  const recovery = ticksOf(ability.recovery ?? 0);
  actor.action = recovery > 0 && !actor.dead ? { ...action, phase: 'recover', until: state.tick + recovery } : null;
}

/**
 * 기술을 쓰기 시작한다.
 * @param {number} aimX 조준 방향(정규화하지 않아도 된다. 0 이면 바라보는 방향)
 * @param {number} aimY
 * @param {number} targetX 목표 지점(장판·순간이동의 기준)
 * @param {number} targetY
 * @returns {boolean} 시작했으면 true
 */
export function startAbility(state, bus, actor, abilityId, aimX, aimY, targetX, targetY) {
  const ability = abilityOf(actor, abilityId);
  if (actor.dead || actor.disabled || actor.action || actor.dash || !isReady(state, actor, abilityId)) return false;
  const len = Math.sqrt(aimX * aimX + aimY * aimY);
  const dirX = len > 1e-6 ? aimX / len : actor.facingX;
  const dirY = len > 1e-6 ? aimY / len : actor.facingY;
  actor.facingX = dirX;
  actor.facingY = dirY;
  actor.moveX = 0;
  actor.moveY = 0;
  const windup = ticksOf(ability.windup ?? 0);
  actor.cooldowns[abilityId] = state.tick + windup + cooldownTicks(actor, ability.cooldown ?? 0);
  const action = { ability: abilityId, phase: 'windup', until: state.tick + windup, dirX, dirY, targetX, targetY };
  if (windup === 0) {
    fire(state, bus, actor, ability, action);
  } else {
    actor.action = action;
    bus.emit(EVENTS.ABILITY_WINDUP, {
      actorId: actor.id, ability: abilityId, ticks: windup, x: actor.x, y: actor.y, dirX, dirY, targetX, targetY,
    });
  }
  return true;
}

/** 행동 단계(매 틱): 준비가 끝난 기술을 발동하고, 경직이 끝난 행동을 지운다. */
export function updateActions(state, bus) {
  for (const actor of allActors(state)) {
    const action = actor.action;
    if (!action || actor.dead || state.tick < action.until) continue;
    if (action.phase === 'windup') fire(state, bus, actor, abilityOf(actor, action.ability), action);
    else actor.action = null;
  }
}

/** 돌진 단계(이동 뒤): 돌진 중 닿은 상대를 맞히고, 끝난 돌진을 정리한다. */
export function resolveDashes(state, bus) {
  for (const actor of allActors(state)) {
    const dash = actor.dash;
    if (!dash || actor.dead) continue;
    if (dash.damage > 0 || dash.status) {
      for (const target of opponentsOf(state, actor.faction)) {
        if (dash.hit.includes(target.id)) continue;
        const dx = target.x - actor.x;
        const dy = target.y - actor.y;
        const reach = actor.radius + target.radius + COMBAT.contactSlop;
        if (dx * dx + dy * dy > reach * reach) continue;
        dash.hit.push(target.id);
        applyHit(state, bus, target, dash, actor.id, actor.x, actor.y);
      }
    }
    if (dash.done) {
      actor.dash = null;
      if (dash.wall && dash.stunOnWall > 0) applyStatus(state, bus, actor, 'stun', { duration: dash.stunOnWall, sourceId: actor.id });
    }
  }
}
