// 행동체(플레이어·적·보스)를 만들고 찾는다. 행동체는 state.entities.byId 에 든 평범한 객체다.

import { COMBAT } from '../../../data/combat.js';
import { PLAYER } from '../../../data/player.js';
import { EVENTS } from '../core/events.js';
import { rngOf } from '../core/state.js';
import { circleFree } from '../world/collide.js';
import { lineOfSight } from '../world/los.js';
import { navOf } from '../world/nav.js';
import { ACTOR_KIND, enemyDef, isBossType } from './defs.js';

function createActor(state, kind, type, def, x, y) {
  const id = state.entities.nextId++;
  const actor = {
    id,
    kind,
    type,
    faction: kind === ACTOR_KIND.PLAYER ? 'player' : 'enemy',
    x,
    y,
    radius: def.radius,
    mass: def.mass ?? 1,
    /** 바라보는 방향(단위 벡터). */
    facingX: 0,
    facingY: 1,
    hp: def.hp,
    maxHp: def.hp,
    armor: def.armor ?? 0,
    speed: def.speed,
    /** 이번 틱에 움직이려는 방향(길이 1 이하)과 속도 배율. 조작·AI 가 정하고 이동 단계가 읽는다. */
    moveX: 0,
    moveY: 0,
    moveScale: 1,
    /** 직전 이동 단계에서 실제로 움직였는가, 벽에 닿았는가. */
    moved: false,
    hitWall: false,
    /** 상태이상에서 나온 값(상태이상 단계가 매 틱 다시 계산한다). */
    speedMul: 1,
    disabled: false,
    /** 상태이상 id → { stacks, until, nextTick, sourceId }. */
    statuses: {},
    /** 상태이상 id → 이 틱까지는 다시 걸리지 않는다. */
    immuneUntil: {},
    /** 기술 id → 다시 쓸 수 있는 틱. */
    cooldowns: {},
    /** 진행 중인 행동 { ability, phase:'windup'|'recover', until, dirX, dirY, targetX, targetY } 또는 null. */
    action: null,
    /** 진행 중인 돌진 { dirX, dirY, speed, endAt, damage, status, hit, stopOnWall, stunOnWall, done, wall } 또는 null. */
    dash: null,
    /** 이 틱 전까지는 피해·상태이상을 받지 않는다. */
    invulnUntil: 0,
    dead: false,
    /** 죽음 처리(사망 효과·이벤트)가 끝났는가. */
    reaped: false,
    killerId: null,
    /** 이 행동체를 소환한 행동체의 id. */
    summonerId: null,
    ai: null,
  };
  state.entities.byId[id] = actor;
  return actor;
}

/** 살아 있든 죽었든 모든 행동체를 id 순서로 돌려준다(틱 도중 추가·삭제돼도 안전하도록 목록을 새로 만든다). */
export function allActors(state) {
  return Object.values(state.entities.byId);
}

export function getActor(state, id) {
  return id === null || id === undefined ? null : state.entities.byId[id] ?? null;
}

export function getPlayer(state) {
  return getActor(state, state.playerId);
}

/** actor 와 진영이 다른 살아 있는 행동체들. */
export function opponentsOf(state, faction) {
  const out = [];
  for (const other of Object.values(state.entities.byId)) {
    if (!other.dead && other.faction !== faction) out.push(other);
  }
  return out;
}

/** 플레이어를 만든다. 이미 있으면 예외. */
export function spawnPlayer(state, bus, x, y) {
  if (getPlayer(state)) throw new Error('spawnPlayer: 플레이어가 이미 있습니다');
  const actor = createActor(state, ACTOR_KIND.PLAYER, 'player', PLAYER, x, y);
  actor.cooldowns.dodge = 0;
  state.playerId = actor.id;
  bus.emit(EVENTS.ENTITY_SPAWNED, { id: actor.id, kind: actor.kind, type: actor.type, x, y });
  return actor;
}

/**
 * 적 또는 보스를 만든다.
 * @param {object} [options]
 * @param {number|null} [options.summonerId] 소환한 행동체
 * @param {boolean} [options.alerted] true 면 곧바로 전투에 들어간다
 */
export function spawnEnemy(state, bus, type, x, y, options = {}) {
  const def = enemyDef(type);
  if (!def) throw new RangeError(`spawnEnemy: 알 수 없는 적 "${type}"`);
  const boss = isBossType(type);
  const actor = createActor(state, boss ? ACTOR_KIND.BOSS : ACTOR_KIND.ENEMY, type, def, x, y);
  actor.summonerId = options.summonerId ?? null;
  actor.ai = {
    /** 'idle'(대기) | 'combat'(전투) | 'return'(자리로 복귀) */
    mode: 'idle',
    homeX: x,
    homeY: y,
    /** 맞았거나 깨워져서 다음 판단 때 전투에 들어간다. */
    provoked: options.alerted === true,
    lastSeenAt: 0,
    chaseUntil: 0,
    returnStuckSince: 0,
    /** 길찾기 기억. */
    nav: { path: null, idx: 0, goal: -1, repathAt: 0, failUntil: 0 },
    /** 보스: 현재 페이즈, 다음 패턴을 쓸 수 있는 틱, 전환이 끝나는 틱. */
    phase: 0,
    nextPatternAt: 0,
    transitionUntil: 0,
    /** 행동 방식별로 쓰는 값. */
    strafeSign: 1,
    strafeFlipAt: 0,
    orbitSign: 1,
    retreatUntil: 0,
    fled: false,
    nextBlinkAt: 0,
  };
  bus.emit(EVENTS.ENTITY_SPAWNED, { id: actor.id, kind: actor.kind, type, x, y, summonerId: actor.summonerId });
  return actor;
}

/**
 * (x, y) 근처에서 반지름 radius 인 몸이 설 수 있는 빈 자리를 고른다. 벽 너머는 고르지 않는다.
 * @returns {{x:number,y:number}|null}
 */
export function findFreeSpot(state, x, y, radius, maxDist) {
  const nav = navOf(state.world);
  const actors = allActors(state);
  const candidates = [];
  const reach = Math.ceil(maxDist);
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  for (let ty = cy - reach; ty <= cy + reach; ty++) {
    for (let tx = cx - reach; tx <= cx + reach; tx++) {
      const px = tx + 0.5;
      const py = ty + 0.5;
      const dx = px - x;
      const dy = py - y;
      if (dx * dx + dy * dy > maxDist * maxDist) continue;
      if (!circleFree(nav, px, py, radius) || !lineOfSight(nav, x, y, px, py)) continue;
      let occupied = false;
      for (const other of actors) {
        if (other.dead) continue;
        const ox = other.x - px;
        const oy = other.y - py;
        const min = other.radius + radius;
        if (ox * ox + oy * oy < min * min) {
          occupied = true;
          break;
        }
      }
      if (!occupied) candidates.push({ x: px, y: py });
    }
  }
  if (candidates.length === 0) return null;
  return rngOf(state, 'entities').pick(candidates);
}

/**
 * 층에 들어갈 때 호출한다: 이전 층의 적·투사체·장판을 지우고, 플레이어를 시작점에 두고, 맵의 배치대로 적·보스를 만든다.
 */
export function populateFloor(state, bus, map) {
  const player = getPlayer(state);
  state.entities.byId = {};
  state.projectiles = [];
  state.hazards = [];
  const sx = map.start.x + 0.5;
  const sy = map.start.y + 0.5;
  if (player && !player.dead) {
    player.x = sx;
    player.y = sy;
    player.action = null;
    player.dash = null;
    player.moveX = 0;
    player.moveY = 0;
    state.entities.byId[player.id] = player;
  } else {
    state.playerId = null;
    spawnPlayer(state, bus, sx, sy);
  }
  for (const spawn of map.spawns) {
    if (spawn.kind !== 'enemy' && spawn.kind !== 'boss') continue;
    spawnEnemy(state, bus, spawn.id, spawn.x + 0.5, spawn.y + 0.5);
  }
}

/** 기본 어그로·리쉬 수치를 채운 값. */
export function aggroRulesOf(def) {
  return {
    aggroRadius: def.aggroRadius ?? COMBAT.aggroRadius,
    // 보스는 리쉬가 없다(자리를 벗어나도, 시야를 잃어도 계속 쫓는다).
    leashRadius: def.phases ? null : def.leashRadius ?? COMBAT.leashRadius,
    loseSight: def.phases ? null : def.loseSight ?? COMBAT.loseSight,
  };
}
