// 헤드리스 전투 시뮬레이션 도구: 1:1 대결을 차리고, 플레이어를 자동 조작하고, 매 틱 불변식을 검사한다.
// scripts/sim-combat.mjs 와 테스트가 함께 쓴다. 로직 바깥의 도구이므로 상태를 직접 들여다봐도 된다.

import { BOSSES } from '../../data/bosses.js';
import { COMBAT } from '../../data/combat.js';
import { ENEMIES } from '../../data/enemies.js';
import { PLAYER } from '../../data/player.js';
import { STATUSES } from '../../data/statuses.js';
import { ZONES } from '../../data/zones.js';
import { WORLD } from '../../data/world.js';
import { EVENTS } from '../../src/logic/core/events.js';
import { Rng } from '../../src/logic/core/prng.js';
import { PHASE } from '../../src/logic/core/state.js';
import { TICK_RATE } from '../../src/logic/core/time.js';
import { alertEnemy } from '../../src/logic/combat/ai/brain.js';
import { createNavMemory, steerAway, steerToward } from '../../src/logic/combat/ai/steer.js';
import { setInput } from '../../src/logic/combat/player.js';
import { allActors, getPlayer, spawnEnemy, spawnPlayer } from '../../src/logic/entities/actors.js';
import { defOf, isBossType } from '../../src/logic/entities/defs.js';
import { resetVision } from '../../src/logic/entities/vision.js';
import { createGame, setPhase, tick } from '../../src/logic/game.js';
import { circleFree } from '../../src/logic/world/collide.js';
import { generateFloor } from '../../src/logic/world/generate.js';
import { bfsDistances } from '../../src/logic/world/grid.js';
import { lineOfSight } from '../../src/logic/world/los.js';
import { isWall, navOf } from '../../src/logic/world/nav.js';

export const DT = 1 / TICK_RATE;

/** 대결 방식. */
export const MODES = Object.freeze({
  /** 싸운다: 다가가 때리고, 기술을 쓰고, 예고된 공격을 절반쯤 피한다. */
  FIGHT: 'fight',
  /** 싸우되 체력을 400배로 늘린다 — 보스를 끝까지 잡아 모든 페이즈를 거치게 하려는 용도. */
  TANKY: 'tanky',
  /** 아무것도 하지 않는다 — 적이 가만히 있는 상대를 끝내 잡는지 본다. */
  PASSIVE: 'passive',
  /** 공격하지 않고 계단 쪽으로 달아난다 — 추격·리쉬·복귀를 본다. */
  KITE: 'kite',
  /** 공격하지 않고 적의 자리 근처를 이리저리 돌아다닌다 — 움직이는 상대를 쫓는 길찾기를 오래 본다. */
  WANDER: 'wander',
});

const LIMIT_SEC = { fight: 180, tanky: 600, passive: 180, kite: 120, wander: 60 };
const STUCK_WINDOW = 90;
const STALL_TICKS = 600;
const MAX_DISABLED_TICKS = 240;

/** 데이터만 보고 판단한 면역 여부(로직의 저항 계산 함수를 쓰지 않는다 — 그 함수가 틀려도 잡아내기 위해). */
function isImmune(def, statusId) {
  return Boolean(def.immune && def.immune.includes(statusId)) || (def.statusResist !== undefined && def.statusResist[statusId] === 0);
}

/** 스스로 죽는 기술(자폭)을 가진 종류인가. */
function selfDestructs(def) {
  return Object.values(def.abilities).some((a) => a.effects.some((e) => e.type === 'die'));
}

/** 이 종류가 싸울 층: 보스는 자기 구역의 보스층, 적은 자기가 나오는 구역의 일반 층. */
function floorFor(type, rng) {
  if (isBossType(type)) {
    const zone = ZONES.findIndex((z) => z.boss && z.boss.id === type);
    return (zone + 1) * WORLD.floorsPerZone;
  }
  let zone = ZONES.findIndex((z) => z.enemies.some((e) => e.id === type));
  if (zone === -1) zone = 1; // 소환·분열로만 나오는 종류
  return zone * WORLD.floorsPerZone + rng.int(1, WORLD.floorsPerZone - 1);
}

/**
 * 1:1 대결을 차린다.
 * @param {{ seed: string, type: string, mode: string }} options
 */
export function setupDuel({ seed, type, mode }) {
  const setupRng = Rng.fromSeed(`duel:${seed}`);
  const floor = floorFor(type, setupRng);
  const game = createGame({ seed });
  const { state, bus } = game;
  const map = generateFloor({ seed, floor });
  state.world = map;
  state.run.floor = floor;
  const nav = navOf(map);

  const player = spawnPlayer(state, bus, map.start.x + 0.5, map.start.y + 0.5);
  if (mode === MODES.TANKY) {
    // 층별 난이도로 강해진 보스도 끝까지 잡을 수 있을 만큼 넉넉히 늘린다.
    player.maxHp *= 400;
    player.hp = player.maxHp;
  }
  resetVision(state);

  let enemy;
  if (isBossType(type)) {
    const spawn = map.spawns.find((s) => s.kind === 'boss');
    enemy = spawnEnemy(state, bus, type, spawn.x + 0.5, spawn.y + 0.5);
  } else {
    // 시작점에서 5~9걸음 떨어진, 몸이 들어가는 칸 가운데 하나.
    const dist = bfsDistances(map.tiles, map.width, map.height, map.start.y * map.width + map.start.x);
    const radius = ENEMIES[type].radius;
    const cells = [];
    for (let i = 0; i < dist.length; i++) {
      if (dist[i] >= 5 && dist[i] <= 9 && circleFree(nav, (i % map.width) + 0.5, Math.floor(i / map.width) + 0.5, radius)) cells.push(i);
    }
    const cell = setupRng.pick(cells);
    enemy = spawnEnemy(state, bus, type, (cell % map.width) + 0.5, Math.floor(cell / map.width) + 0.5);
  }
  alertEnemy(enemy);
  setPhase(game, PHASE.PLAYING);
  return { game, map, nav, enemyId: enemy.id, type, mode, seed, floor, wanderCenter: { x: enemy.x, y: enemy.y } };
}

// ── 자동 조작 ────────────────────────────────────────────────────────────────

/** 기술이 닿을 수 있는 가장 먼 거리(대략). */
function reachOf(ability) {
  let reach = 0;
  for (const e of ability.effects) {
    if (e.type === 'arc') reach = Math.max(reach, e.range);
    else if (e.type === 'circle') reach = Math.max(reach, e.radius);
    else if (e.type === 'dash') reach = Math.max(reach, e.distance);
  }
  return reach;
}

export function createBot(mode, seed) {
  return { mode, rng: Rng.fromSeed(`bot:${seed}`), nav: createNavMemory(), decided: new Map(), strafe: 1, goal: null, goalUntil: 0 };
}

/** 이번 틱의 입력을 정해 state.input 에 넣는다. */
export function driveBot(duel, bot) {
  const { state } = duel.game;
  const { nav, map } = duel;
  const player = getPlayer(state);
  const input = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, attack: false, skill: -1, dodge: false };
  if (!player || player.dead || bot.mode === MODES.PASSIVE) {
    setInput(state, input);
    return;
  }
  const tick = state.tick;
  const enemies = allActors(state).filter((a) => !a.dead && a.faction !== player.faction);
  let target = null;
  let targetD = Infinity;
  for (const e of enemies) {
    const d = Math.sqrt((e.x - player.x) ** 2 + (e.y - player.y) ** 2);
    if (d < targetD) {
      target = e;
      targetD = d;
    }
  }
  const dodgeReady = (player.cooldowns.dodge ?? 0) <= tick && !player.dash;

  if (bot.mode === MODES.KITE) {
    // 계단(없으면 시작점)으로 달아난다. 도착하면 가만히 있는다.
    const goal = map.stairs ?? map.start;
    const s = steerToward(nav, player, bot.nav, goal.x + 0.5, goal.y + 0.5, tick);
    input.moveX = s.x;
    input.moveY = s.y;
    if (!s.reachable && target) {
      const away = steerAway(nav, player, target.x, target.y);
      input.moveX = away.x;
      input.moveY = away.y;
    }
    if (target && targetD < 1.5 && dodgeReady && bot.rng.chance(0.2)) input.dodge = true;
    setInput(state, input);
    return;
  }

  if (bot.mode === MODES.WANDER) {
    // 적의 자리에서 8칸 안의 빈 칸을 골라 걸어가고, 도착하거나 3초가 지나면 다른 칸을 고른다.
    const home = duel.wanderCenter;
    const reached = bot.goal && (bot.goal.x - player.x) ** 2 + (bot.goal.y - player.y) ** 2 < 0.5;
    if (!bot.goal || reached || tick >= bot.goalUntil) {
      for (let tries = 0; tries < 20; tries++) {
        const gx = Math.floor(home.x) + bot.rng.int(-8, 8) + 0.5;
        const gy = Math.floor(home.y) + bot.rng.int(-8, 8) + 0.5;
        if (!circleFree(nav, gx, gy, player.radius)) continue;
        bot.goal = { x: gx, y: gy };
        bot.goalUntil = tick + 180;
        break;
      }
    }
    if (bot.goal) {
      const s = steerToward(nav, player, bot.nav, bot.goal.x, bot.goal.y, tick);
      input.moveX = s.x;
      input.moveY = s.y;
      if (!s.reachable) bot.goal = null;
    }
    setInput(state, input);
    return;
  }

  // ── 싸우기 ──
  // 1) 터지기 직전인 장판 위에 있으면 벗어난다.
  for (const hz of state.hazards) {
    if (hz.faction === player.faction) continue;
    const dx = player.x - hz.x;
    const dy = player.y - hz.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > hz.radius + 0.4 || hz.nextAt - tick > 45) continue;
    // 오래 남는 장판(독 구름)은 상대와 붙어 싸우는 중이면 무시한다. 안 그러면 구름만 피해 다니다 끝난다.
    if (hz.interval > 0 && target && targetD < 2.2 + target.radius) continue;
    const away = d > 1e-3 ? { x: dx / d, y: dy / d } : { x: 1, y: 0 };
    input.moveX = away.x;
    input.moveY = away.y;
    if (dodgeReady && hz.nextAt - tick <= 10) input.dodge = true;
    setInput(state, input);
    return;
  }

  // 2) 곧 들어올 공격(준비 동작, 날아오는 투사체)을 절반쯤 피한다. 같은 공격에 대한 판단은 한 번만 한다.
  if (dodgeReady) {
    let threat = null;
    for (const e of enemies) {
      if (!e.action || e.action.phase !== 'windup' || e.action.until - tick > 8) continue;
      const reach = reachOf(defOf(e).abilities[e.action.ability]);
      const d = Math.sqrt((e.x - player.x) ** 2 + (e.y - player.y) ** 2);
      if (reach > 0 && d <= reach + 0.6) {
        threat = { key: `a${e.id}:${e.action.until}`, x: e.x, y: e.y };
        break;
      }
    }
    if (!threat) {
      for (const p of state.projectiles) {
        if (p.faction === player.faction) continue;
        const dx = player.x - p.x;
        const dy = player.y - p.y;
        if (dx * dx + dy * dy < 2.2 * 2.2 && dx * p.vx + dy * p.vy > 0) {
          threat = { key: `p${p.id}`, x: p.x, y: p.y };
          break;
        }
      }
    }
    if (threat) {
      if (!bot.decided.has(threat.key)) bot.decided.set(threat.key, bot.rng.chance(0.5));
      if (bot.decided.get(threat.key)) {
        // 위협 방향의 옆으로 구른다.
        const dx = player.x - threat.x;
        const dy = player.y - threat.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const sign = bot.rng.chance(0.5) ? 1 : -1;
        let mx = (-dy / d) * sign;
        let my = (dx / d) * sign;
        if (!circleFree(nav, player.x + mx * 1.2, player.y + my * 1.2, player.radius)) {
          mx = -mx;
          my = -my;
        }
        input.moveX = mx;
        input.moveY = my;
        input.dodge = true;
        setInput(state, input);
        return;
      }
    }
  }

  // 3) 다가가서 때린다.
  if (target) {
    const los = lineOfSight(nav, player.x, player.y, target.x, target.y);
    const melee = 1.1 + target.radius;
    if (targetD > melee || !los) {
      const s = steerToward(nav, player, bot.nav, target.x, target.y, tick);
      input.moveX = s.x;
      input.moveY = s.y;
    }
    if (los) {
      const ready = (id) => (player.cooldowns[id] ?? 0) <= tick;
      input.attack = targetD <= 1.5 + target.radius;
      if (targetD <= 1.8 + target.radius && ready('whirlwind')) input.skill = 0;
      else if (targetD >= 2 && targetD <= 8 && ready('firebolt')) input.skill = 1;
      else if (targetD <= 2.4 + target.radius && ready('frost_nova')) input.skill = 2;
    }
  }
  setInput(state, input);
}

// ── 불변식 검사 ──────────────────────────────────────────────────────────────

/** 대결 감시기: 이벤트를 듣고, 매 틱 상태를 검사해 문제를 모은다. */
export function createMonitor(duel) {
  const { game, nav } = duel;
  const { state, bus } = game;
  const issues = [];
  const seen = new Set();
  const report = (code, detail) => {
    const key = `${code}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({ code, detail, tick: state.tick });
  };

  const stats = { phaseEvents: [], teleports: 0, statusApplied: {}, damageToPlayer: 0, damageToEnemies: 0, windups: 0, maxActors: 0 };
  const modeChanges = new Map();
  bus.on(EVENTS.AGGRO_CHANGED, (e) => {
    const n = (modeChanges.get(e.id) ?? 0) + 1;
    modeChanges.set(e.id, n);
    // 전투↔복귀를 초당 여러 번 오가면 리쉬 규칙이 서로 물고 물리는 것이다.
    if (n > 12 + state.tick / 30) report('aggro-flapping', `#${e.id} 어그로 상태가 ${state.tick}틱 동안 ${n}번 바뀜`);
  });
  const track = new Map(); // id → { wx, wy, wSince, ax, ay, activeAt, disabledSince }
  const activity = (id) => {
    const t = track.get(id);
    if (t) t.activeAt = state.tick;
  };

  bus.on(EVENTS.BOSS_PHASE_CHANGED, (e) => {
    stats.phaseEvents.push({ from: e.from, to: e.to, tick: state.tick });
    if (e.to !== e.from + 1) report('phase-event-order', `${e.from}→${e.to}`);
  });
  bus.on(EVENTS.ENTITY_TELEPORTED, (e) => {
    stats.teleports++;
    activity(e.id);
    const actor = state.entities.byId[e.id];
    const def = actor ? defOf(actor) : null;
    const canTeleport = def && Object.values(def.abilities).some((a) => a.effects.some((x) => x.type === 'teleport'));
    if (!canTeleport) report('return-snap', `${actor?.type} 가 돌아갈 길을 못 찾아 자리로 옮겨짐`);
  });
  // 면역 시간 규칙: 풀린 상태이상은 immunityAfter 초가 지나기 전에는 같은 대상에게 다시 걸리면 안 된다.
  const endedAt = new Map();
  bus.on(EVENTS.STATUS_ENDED, (e) => endedAt.set(`${e.targetId}:${e.status}`, state.tick));
  bus.on(EVENTS.STATUS_APPLIED, (e) => {
    stats.statusApplied[e.status] = (stats.statusApplied[e.status] ?? 0) + 1;
    const window = STATUSES[e.status].immunityAfter;
    const last = endedAt.get(`${e.targetId}:${e.status}`);
    if (window && last !== undefined && state.tick - last < Math.round(window * TICK_RATE)) {
      report('immunity-window', `${e.status} 가 풀린 지 ${state.tick - last}틱 만에 다시 걸림 (#${e.targetId})`);
    }
    const target = state.entities.byId[e.targetId];
    if (target && isImmune(defOf(target), e.status)) report('status-on-immune', `${target.type} ← ${e.status}`);
    if (target && target.invulnUntil > state.tick) report('status-while-invulnerable', `${target.type} ← ${e.status}`);
    if (e.stacks > STATUSES[e.status].maxStacks || e.stacks < 1) report('status-stacks', `${e.status} ×${e.stacks}`);
  });
  bus.on(EVENTS.DAMAGE_DEALT, (e) => {
    if (!Number.isInteger(e.amount) || e.amount < 0) report('bad-damage', `${e.amount}`);
    if (e.targetId === state.playerId) stats.damageToPlayer += e.amount;
    else stats.damageToEnemies += e.amount;
  });
  bus.on(EVENTS.ABILITY_WINDUP, (e) => {
    stats.windups++;
    activity(e.actorId);
  });
  bus.on(EVENTS.ABILITY_USED, (e) => activity(e.actorId));

  function check() {
    const tick = state.tick;
    const actors = allActors(state);
    stats.maxActors = Math.max(stats.maxActors, actors.length);
    if (actors.length > 40) report('actor-explosion', `행동체 ${actors.length}`);
    if (state.projectiles.length > 300) report('projectile-leak', `투사체 ${state.projectiles.length}`);
    if (state.hazards.length > 150) report('hazard-leak', `장판 ${state.hazards.length}`);
    const player = getPlayer(state);

    for (const a of actors) {
      const where = `${a.type}#${a.id} @${a.x?.toFixed?.(2)},${a.y?.toFixed?.(2)}`;
      if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) {
        report('nan-position', where);
        continue;
      }
      if (a.dead) {
        if (a.id !== state.playerId) report('dead-not-removed', where);
        continue;
      }
      if (isWall(nav, Math.floor(a.x), Math.floor(a.y))) report('inside-wall', where);
      else if (!circleFree(nav, a.x, a.y, a.radius - 0.02)) report('overlapping-wall', where);
      if (!Number.isInteger(a.hp) || a.hp <= 0 || a.hp > a.maxHp) report('bad-hp', `${where} hp=${a.hp}/${a.maxHp}`);
      if (!Number.isFinite(a.facingX) || Math.abs(a.facingX * a.facingX + a.facingY * a.facingY - 1) > 1e-3) report('bad-facing', where);

      // 상태이상
      const def = defOf(a);
      for (const [id, s] of Object.entries(a.statuses)) {
        const sd = STATUSES[id];
        if (!sd) report('unknown-status', id);
        else {
          if (!Number.isInteger(s.stacks) || s.stacks < 1 || s.stacks > sd.maxStacks) report('status-stacks', `${where} ${id} ×${s.stacks}`);
          if (s.until <= tick) report('status-expired-lingering', `${where} ${id}`);
          if (sd.stacking !== 'intensity' && s.stacks !== 1) report('status-stacks', `${where} ${id} ×${s.stacks} (중첩 불가)`);
          if (isImmune(def, id)) report('status-on-immune', `${where} ${id}`);
          const longest = Math.round(sd.duration * TICK_RATE * 3);
          if (s.until - tick > longest) report('status-too-long', `${where} ${id} ${s.until - tick}틱`);
        }
      }
      if (a.statuses.burn && a.statuses.freeze) report('burn-with-freeze', where);

      let t = track.get(a.id);
      if (!t) {
        t = { wx: a.x, wy: a.y, wSince: tick, wFar: 0, ax: a.x, ay: a.y, activeAt: tick, disabledSince: -1 };
        track.set(a.id, t);
      }
      // 연속 행동 불가(기절·빙결 연쇄)
      if (a.disabled) {
        if (t.disabledSince < 0) t.disabledSince = tick;
        else if (tick - t.disabledSince > MAX_DISABLED_TICKS) report('stunlock', `${where} ${tick - t.disabledSince}틱 연속 행동 불가`);
        t.activeAt = tick;
      } else {
        t.disabledSince = -1;
      }

      if (!a.ai) continue;
      // 보스 페이즈와 체력의 일관성
      if (def.phases) {
        const phase = def.phases[a.ai.phase];
        if (!phase) report('bad-phase', `${where} phase=${a.ai.phase}`);
        else if (phase.until > 0 && a.hp <= Math.ceil(a.maxHp * phase.until)) report('phase-missed', `${where} hp=${a.hp} phase=${a.ai.phase}`);
        if (stats.phaseEvents.length !== a.ai.phase && a.id === duel.enemyId) report('phase-event-missing', `${where} 이벤트 ${stats.phaseEvents.length}회, 페이즈 ${a.ai.phase}`);
      }

      // 벽에 끼임: 움직이려 하는데 일정 시간 제자리
      // (오가며 움직이는 것은 끼인 것이 아니므로, 구간 시작점에서 가장 멀리 간 거리로 판단한다.)
      const wants = (a.moveX !== 0 || a.moveY !== 0) && !a.disabled && !a.action && !a.dash;
      if (!wants) {
        t.wx = a.x;
        t.wy = a.y;
        t.wSince = tick;
        t.wFar = 0;
      } else {
        t.wFar = Math.max(t.wFar, (a.x - t.wx) ** 2 + (a.y - t.wy) ** 2);
        if (tick - t.wSince >= STUCK_WINDOW) {
          if (t.wFar < 0.2 * 0.2) report('stuck', `${where} mode=${a.ai.mode} ${STUCK_WINDOW}틱 동안 ${Math.sqrt(t.wFar).toFixed(3)}칸`);
          t.wx = a.x;
          t.wy = a.y;
          t.wSince = tick;
          t.wFar = 0;
        }
      }

      // 멈춤: 전투 중인데 오랫동안 움직이지도 행동하지도 않음
      // (전투 중이 아닐 때 가만히 있는 것은 정상이므로 그 시간은 세지 않는다.)
      if ((a.x - t.ax) ** 2 + (a.y - t.ay) ** 2 > 0.3 * 0.3 || a.dash || a.action || a.ai.mode !== 'combat') {
        t.ax = a.x;
        t.ay = a.y;
        t.activeAt = tick;
      }
      if (a.ai.mode === 'combat' && player && !player.dead && tick - t.activeAt > STALL_TICKS) {
        report('stall', `${where} ${tick - t.activeAt}틱 동안 아무것도 하지 않음`);
        t.activeAt = tick;
      }
    }
  }

  return { issues, stats, check, report };
}

// ── 대결 실행 ────────────────────────────────────────────────────────────────

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * 대결 하나를 끝까지 돌린다.
 * @param {{ seed: string, type: string, mode: string, digest?: boolean }} options
 * @returns {{ outcome: string, ticks: number, issues: object[], playerHp: number, phases: number, stats: object, digest?: number }}
 *   outcome: 'enemyDead' | 'playerDead' | 'leashed' | 'timeout' | 'exception'
 */
export function runDuel(options) {
  let duel;
  let monitor;
  try {
    duel = setupDuel(options);
    monitor = createMonitor(duel);
  } catch (err) {
    return { outcome: 'exception', ticks: 0, issues: [{ code: 'exception', detail: `준비 중: ${err?.stack ?? err}`, tick: 0 }], playerHp: 0, phases: 0, stats: {} };
  }
  const { game } = duel;
  const { state } = game;
  const bot = createBot(options.mode, options.seed);
  const limit = LIMIT_SEC[options.mode] * TICK_RATE;
  const def = defOf(state.entities.byId[duel.enemyId]);
  let outcome = 'timeout';
  let everReturned = false;
  let bossDied = false;
  let bossPhaseAtDeath = -1;
  game.bus.on(EVENTS.ENTITY_DIED, (e) => {
    if (e.id === duel.enemyId) bossDied = true;
  });

  try {
    for (let i = 0; i < limit; i++) {
      const main = state.entities.byId[duel.enemyId];
      if (main) bossPhaseAtDeath = main.ai.phase;
      driveBot(duel, bot);
      tick(game, DT);
      monitor.check();

      const player = getPlayer(state);
      if (player.dead) {
        outcome = 'playerDead';
        if (state.phase !== PHASE.GAME_OVER) monitor.report('no-game-over', `플레이어가 죽었는데 페이즈가 ${state.phase}`);
        break;
      }
      const enemies = allActors(state).filter((a) => !a.dead && a.faction === 'enemy');
      if (enemies.length === 0) {
        outcome = 'enemyDead';
        break;
      }
      if (options.mode === MODES.KITE) {
        if (enemies.some((a) => a.ai.mode === 'return')) everReturned = true;
        if (everReturned && enemies.every((a) => a.ai.mode === 'idle')) {
          outcome = 'leashed';
          for (const a of enemies) {
            if (a.hp !== a.maxHp) monitor.report('leash-no-heal', `${a.type} 복귀 후 체력 ${a.hp}/${a.maxHp}`);
            const d2 = (a.x - a.ai.homeX) ** 2 + (a.y - a.ai.homeY) ** 2;
            if (d2 > 1) monitor.report('leash-not-home', `${a.type} 자리에서 ${Math.sqrt(d2).toFixed(2)}칸`);
          }
          break;
        }
      }
    }
  } catch (err) {
    outcome = 'exception';
    monitor.report('exception', String(err?.stack ?? err));
  }

  // 돌아다니는 상대는 느린 적이 끝내 못 잡을 수 있으므로 시간 초과가 문제가 아니다.
  if (outcome === 'timeout' && options.mode !== MODES.WANDER) monitor.report('timeout', `${LIMIT_SEC[options.mode]}초 안에 끝나지 않음`);
  if (options.mode === MODES.PASSIVE && outcome === 'enemyDead' && !selfDestructs(def)) {
    monitor.report('passive-enemy-died', '가만히 있는 플레이어를 상대로 적이 죽음');
  }
  if (def.phases && bossDied && bossPhaseAtDeath !== def.phases.length - 1) {
    monitor.report('phase-skipped', `마지막 페이즈(${def.phases.length - 1})가 아닌 ${bossPhaseAtDeath} 에서 죽음`);
  }

  const player = getPlayer(state);
  const result = {
    outcome,
    ticks: state.tick,
    issues: monitor.issues,
    playerHp: player ? player.hp / player.maxHp : 0,
    phases: monitor.stats.phaseEvents.length,
    stats: monitor.stats,
  };
  if (options.digest) result.digest = fnv1a(JSON.stringify(state));
  return result;
}

/** 시뮬레이션 대상 종류 전부(적 + 보스). */
export function allTypes() {
  return { enemies: Object.keys(ENEMIES), bosses: Object.keys(BOSSES) };
}

export { COMBAT, PLAYER };
