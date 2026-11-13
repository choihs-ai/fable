// 행동체(플레이어·적·보스)를 만들고 찾는다. 행동체는 state.entities.byId 에 든 평범한 객체다.

import { CHARACTERS } from '../../../data/characters.js';
import { COMBAT } from '../../../data/combat.js';
import { ENCOUNTERS } from '../../../data/encounters.js';
import { PLAYER } from '../../../data/player.js';
import { EVENTS } from '../core/events.js';
import { rngOf } from '../core/state.js';
import { circleFree } from '../world/collide.js';
import { lineOfSight } from '../world/los.js';
import { navOf } from '../world/nav.js';
import { ACTOR_KIND, enemyDef, isBossType } from './defs.js';
import { depthScaling } from './scaling.js';

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
    /** 주는 피해의 배율. 플레이어는 능력치에서, 적은 방의 깊이에서 정해진다. */
    power: 1,
    /** 치명타 확률(0~1)과 치명타 피해 배율, 흡혈(준 피해 대비 회복 비율), 재사용 대기 감소(0~0.5). */
    critChance: 0,
    critDamage: 1.5,
    lifesteal: 0,
    haste: 0,
    /** 10초당 체력 재생. */
    regen: 0,
    /** 공격이 맞을 때 걸 수 있는 상태이상: { id, chance } 목록 또는 null. */
    onHit: null,
    /** 이번 틱에 움직이려는 방향(길이 1 이하)과 속도 배율. 조작·AI 가 정하고 이동 단계가 읽는다. */
    moveX: 0,
    moveY: 0,
    moveScale: 1,
    /** 밀려나는 속도(넉백, 칸/초). 이동 단계가 더하고 줄여 나간다. */
    kbX: 0,
    kbY: 0,
    /** 정예인가(적만). */
    elite: false,
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
    /** 진행 중인 돌진 { dirX, dirY, speed, endAt, damage, knockback, status, hit, stopOnWall, stunOnWall, done, wall } 또는 null. */
    dash: null,
    /** 이 틱 전까지는 피해·상태이상을 받지 않는다. */
    invulnUntil: 0,
    dead: false,
    /** 죽는 순간 걸려 있던 상태이상 id 목록. */
    diedWith: [],
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

/**
 * 플레이어를 만든다. 이미 있으면 예외. 캐릭터(state.run.character)에 따라 체력·속도·시작 무기가 다르다.
 * 영구 강화·축복은 반영하지 않은 기본값이다 — 부른 쪽이 refreshPlayerStats 를 부른다.
 */
export function spawnPlayer(state, bus, x, y) {
  if (getPlayer(state)) throw new Error('spawnPlayer: 플레이어가 이미 있습니다');
  if (!Object.hasOwn(CHARACTERS, state.run.character)) throw new RangeError(`spawnPlayer: 알 수 없는 캐릭터 "${state.run.character}"`);
  const character = CHARACTERS[state.run.character];
  const actor = createActor(state, ACTOR_KIND.PLAYER, 'player', { ...PLAYER, hp: character.hp, speed: character.speed }, x, y);
  actor.critChance = PLAYER.critChance;
  actor.critDamage = PLAYER.critDamage;
  /** 플레이어만 가지는 것: 에너지, 대시 충전, 무기, 입력 버퍼, 스킬·축복의 진행 상태. */
  actor.kit = {
    /** 지금 쓰고 있는 탈, 무기 칸마다 딸린 탈(빈 칸은 null — 그 칸으로 바꿔도 탈은 그대로다). */
    character: state.run.character,
    forms: [state.run.character, null],
    /** 탈을 바꾸며 다 깎지 못한 체력·에너지(combat/player.js 의 wearForm). */
    hpDebt: 0,
    energyDebt: 0,
    energy: character.energy,
    maxEnergy: character.energy,
    /** 남은 대시 충전과 최대치, 다음 충전이 차는 틱(가득 차 있으면 0), 한 번 차는 데 걸리는 틱. */
    charges: PLAYER.dash.charges,
    maxCharges: PLAYER.dash.charges,
    chargeAt: 0,
    rechargeTicks: 1,
    /** 무기 두 칸(빈 칸은 null)과 지금 든 칸. */
    weapons: [character.weapons[0], character.weapons[1] ?? null],
    slot: 0,
    /** 기억해 둔 입력: { kind:'dash'|'skill', until } 또는 null. */
    buffer: null,
    /** 대시 중인가(대시가 끝난 틱을 알아채기 위한 값), 이 틱까지의 공격은 대시 공격, 이 틱까지의 첫 공격은 치명타. */
    dashing: false,
    dashAttackUntil: 0,
    critUntil: 0,
    /** 쌍수 사격이 끝나는 틱, 에너지 부족을 마지막으로 알린 틱, 불길 대시가 다음 불을 놓는 틱. */
    dualUntil: 0,
    emptyAt: 0,
    trailAt: 0,
  };
  state.playerId = actor.id;
  bus.emit(EVENTS.ENTITY_SPAWNED, { id: actor.id, kind: actor.kind, type: actor.type, x, y });
  return actor;
}

/**
 * 적 또는 보스를 만든다. 체력·공격은 지금 싸우는 방의 깊이(state.run.depth)에 맞춘다.
 * @param {object} [options]
 * @param {number|null} [options.summonerId] 소환한 행동체
 * @param {boolean} [options.alerted] true 면 곧바로 전투에 들어간다
 * @param {boolean} [options.elite] 정예(크고 단단하고 아프다)
 */
export function spawnEnemy(state, bus, type, x, y, options = {}) {
  const def = enemyDef(type);
  if (!def) throw new RangeError(`spawnEnemy: 알 수 없는 적 "${type}"`);
  const boss = isBossType(type);
  const elite = options.elite === true && !boss;
  const actor = createActor(state, boss ? ACTOR_KIND.BOSS : ACTOR_KIND.ENEMY, type, def, x, y);
  const scale = depthScaling(state.run.depth, { elite, boss, stage: state.run.floor });
  actor.maxHp = Math.max(1, Math.round(def.hp * scale.hp));
  actor.hp = actor.maxHp;
  actor.power = scale.damage;
  if (elite) {
    actor.elite = true;
    actor.radius = def.radius * ENCOUNTERS.elite.radius;
    actor.speed = def.speed * ENCOUNTERS.elite.speed;
    actor.mass = (def.mass ?? 1) * 2;
  }
  actor.summonerId = options.summonerId ?? null;
  actor.ai = {
    /** 'idle'(대기) | 'combat'(전투). 방 전투에서 나타난 적은 곧바로 전투에 들어간다. */
    mode: 'idle',
    /** 맞았거나 깨워져서 다음 판단 때 전투에 들어간다. */
    provoked: options.alerted === true,
    lastSeenAt: 0,
    chaseUntil: 0,
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
  bus.emit(EVENTS.ENTITY_SPAWNED, { id: actor.id, kind: actor.kind, type, x, y, summonerId: actor.summonerId, elite });
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
 * 층에 들어갈 때 호출한다: 이전 층의 적·투사체·장판·전리품을 지우고 플레이어를 시작점에 둔다.
 * 적은 방에 들어설 때 나타난다(logic/combat/encounter.js).
 */
export function populateFloor(state, bus, map) {
  const player = getPlayer(state);
  state.entities.byId = {};
  state.projectiles = [];
  state.hazards = [];
  state.drops = [];
  state.encounter = null;
  const sx = map.start.x + 0.5;
  const sy = map.start.y + 0.5;
  if (player && !player.dead) {
    player.x = sx;
    player.y = sy;
    player.action = null;
    player.dash = null;
    player.moveX = 0;
    player.moveY = 0;
    player.kbX = 0;
    player.kbY = 0;
    state.entities.byId[player.id] = player;
  } else {
    state.playerId = null;
    spawnPlayer(state, bus, sx, sy);
  }
}

/** 대기 중인 적이 플레이어를 알아채는 거리. */
export function aggroRadiusOf(def) {
  return def.aggroRadius ?? COMBAT.aggroRadius;
}
