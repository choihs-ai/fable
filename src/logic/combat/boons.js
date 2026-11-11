// 축복의 효과. 축복은 싸우는 규칙을 바꾼다: 공격이 맞았을 때, 적을 처치했을 때, 대시할 때, 맞았을 때 끼어든다.
// 수치는 data/boons.js. 여기서 내는 피해는 dealDamage 를 직접 쓴다(다시 축복을 부르지 않으므로 끝없이 되풀이되지 않는다).

import { BOONS } from '../../../data/boons.js';
import { EVENTS } from '../core/events.js';
import { rngOf } from '../core/state.js';
import { ticksOf } from '../core/time.js';
import { opponentsOf } from '../entities/actors.js';
import { ACTOR_KIND } from '../entities/defs.js';
import { lineOfSight } from '../world/los.js';
import { navOf } from '../world/nav.js';
import { dealDamage, heal, knockback } from './damage.js';
import { applyStatus } from './statuses.js';

export function hasBoon(state, id) {
  return state.run.boons.includes(id);
}

/** 느려졌거나 얼어붙었는가(얼음 계열 축복이 보는 "냉기" 상태). */
function isChilled(target) {
  return Boolean(target.statuses.slow || target.statuses.freeze || target.statuses.warp);
}

/** (x, y) 둘레의 적에게 피해를 준다(벽 너머는 맞지 않는다). */
function blast(state, bus, player, x, y, cfg, proc, exceptId = null) {
  const nav = navOf(state.world);
  for (const target of opponentsOf(state, player.faction)) {
    if (target.id === exceptId) continue;
    const dx = target.x - x;
    const dy = target.y - y;
    const reach = cfg.radius + target.radius;
    if (dx * dx + dy * dy > reach * reach || !lineOfSight(nav, x, y, target.x, target.y)) continue;
    dealDamage(state, bus, target, cfg.damage * player.power, { sourceId: player.id, fromX: x, fromY: y, proc });
    if (cfg.knockback) knockback(state, bus, target, x, y, cfg.knockback);
  }
  bus.emit(EVENTS.EXPLOSION, { x, y, radius: cfg.radius, faction: player.faction, proc });
}

/** 증기 폭발: 화상과 냉기가 한 적에게 겹치는 순간. */
function steam(state, bus, player, target) {
  const cfg = BOONS.steam;
  if (state.tick < state.run.boonState.steamAt) return;
  state.run.boonState.steamAt = state.tick + ticksOf(cfg.cooldown);
  blast(state, bus, player, target.x, target.y, cfg, 'steam');
}

function applyFire(state, bus, player, target) {
  if (target.dead) return;
  if (hasBoon(state, 'steam') && isChilled(target)) steam(state, bus, player, target);
  if (!target.dead) applyStatus(state, bus, target, 'burn', { sourceId: player.id });
}

function applyCold(state, bus, player, target, id, duration) {
  if (target.dead) return;
  if (hasBoon(state, 'steam') && target.statuses.burn) steam(state, bus, player, target);
  if (!target.dead) applyStatus(state, bus, target, id, { duration, sourceId: player.id });
}

/** 번개 한 줄기가 대상에게 닿는다. */
function lightning(state, bus, player, target, amount) {
  if (target.dead) return;
  let damage = amount;
  let stun = 0;
  if (hasBoon(state, 'superconduct') && isChilled(target)) {
    damage *= BOONS.superconduct.mul;
    stun = BOONS.superconduct.stun;
  }
  dealDamage(state, bus, target, damage, { sourceId: player.id, fromX: player.x, fromY: player.y, proc: 'bolt' });
  if (stun > 0 && !target.dead) applyStatus(state, bus, target, 'stun', { duration: stun, sourceId: player.id });
  if (hasBoon(state, 'plasma')) applyFire(state, bus, player, target);
}

/** 플레이어가 주는 피해의 배율. */
export function outgoingMul(state, player, target) {
  let mul = 1;
  if (hasBoon(state, 'desperado')) mul *= 1 + BOONS.desperado.max * (1 - player.hp / player.maxHp);
  if (hasBoon(state, 'shatter') && isChilled(target)) mul *= 1 + BOONS.shatter.bonus;
  if (hasBoon(state, 'giant_slayer') && (target.elite || target.kind === ACTOR_KIND.BOSS)) mul *= 1 + BOONS.giant_slayer.bonus;
  return mul;
}

/**
 * 플레이어의 공격이 맞은 뒤. 확률 굴림은 결과와 무관하게 같은 횟수만큼 굴린다.
 * @param {{ crit:boolean, melee:boolean }} info
 */
export function afterHit(state, bus, player, target, dealt, info) {
  const owned = state.run.boons;
  if (owned.length === 0) return;
  const rng = rngOf(state, 'combat');
  const boonState = state.run.boonState;

  if (owned.includes('ignite') && rng.chance(BOONS.ignite.chance)) applyFire(state, bus, player, target);
  if (owned.includes('frost_shot') && rng.chance(BOONS.frost_shot.chance)) applyCold(state, bus, player, target, 'slow');
  if (owned.includes('conduct') && info.crit && !target.dead) {
    applyStatus(state, bus, target, 'stun', { duration: BOONS.conduct.stun, sourceId: player.id });
  }
  if (owned.includes('battery') && info.melee) {
    player.kit.energy = Math.min(player.kit.maxEnergy, player.kit.energy + BOONS.battery.energy);
  }

  if (owned.includes('chain')) {
    const cfg = BOONS.chain;
    const nav = navOf(state.world);
    const count = cfg.targets + (owned.includes('plasma') ? BOONS.plasma.targets : 0);
    // 맞은 적에게서 가까운 순서로 튄다.
    const near = [];
    for (const other of opponentsOf(state, player.faction)) {
      if (other.id === target.id) continue;
      const dx = other.x - target.x;
      const dy = other.y - target.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > cfg.range * cfg.range || !lineOfSight(nav, target.x, target.y, other.x, other.y)) continue;
      near.push({ other, d2 });
    }
    near.sort((a, b) => a.d2 - b.d2 || a.other.id - b.other.id);
    if (near.length > 0) {
      const points = [{ x: target.x, y: target.y }];
      for (let i = 0; i < Math.min(count, near.length); i++) {
        points.push({ x: near[i].other.x, y: near[i].other.y });
        lightning(state, bus, player, near[i].other, dealt * cfg.ratio);
      }
      bus.emit(EVENTS.CHAIN_LIGHTNING, { points });
    }
  }

  if (owned.includes('overcharge')) {
    boonState.shots += 1;
    if (boonState.shots >= BOONS.overcharge.every) {
      boonState.shots = 0;
      const cfg = BOONS.overcharge;
      const nav = navOf(state.world);
      for (const other of opponentsOf(state, player.faction)) {
        const dx = other.x - target.x;
        const dy = other.y - target.y;
        const reach = cfg.radius + other.radius;
        if (dx * dx + dy * dy > reach * reach || !lineOfSight(nav, target.x, target.y, other.x, other.y)) continue;
        lightning(state, bus, player, other, cfg.damage * player.power);
      }
      bus.emit(EVENTS.EXPLOSION, { x: target.x, y: target.y, radius: cfg.radius, faction: player.faction, proc: 'bolt' });
    }
  }
}

/** 플레이어가 적을 처치한 뒤. victim 은 이미 죽은 행동체다. */
export function onKill(state, bus, player, victim) {
  const owned = state.run.boons;
  if (owned.includes('vampire')) heal(player, BOONS.vampire.heal);
  if (owned.includes('wildfire') && victim.diedWith.includes('burn')) {
    const cfg = BOONS.wildfire;
    const nav = navOf(state.world);
    for (const other of opponentsOf(state, player.faction)) {
      const dx = other.x - victim.x;
      const dy = other.y - victim.y;
      if (dx * dx + dy * dy > cfg.radius * cfg.radius || !lineOfSight(nav, victim.x, victim.y, other.x, other.y)) continue;
      applyFire(state, bus, player, other);
    }
  }
  if (owned.includes('blast_kill')) blast(state, bus, player, victim.x, victim.y, BOONS.blast_kill, 'blast', victim.id);
}

/** 대시가 끝난 자리에서. */
export function onDashEnd(state, bus, player) {
  if (!hasBoon(state, 'frost_nova')) return;
  const cfg = BOONS.frost_nova;
  const nav = navOf(state.world);
  for (const other of opponentsOf(state, player.faction)) {
    const dx = other.x - player.x;
    const dy = other.y - player.y;
    const reach = cfg.radius + other.radius;
    if (dx * dx + dy * dy > reach * reach || !lineOfSight(nav, player.x, player.y, other.x, other.y)) continue;
    applyCold(state, bus, player, other, 'freeze', cfg.freeze);
  }
  bus.emit(EVENTS.EXPLOSION, { x: player.x, y: player.y, radius: cfg.radius, faction: player.faction, proc: 'ice' });
}

/** 플레이어가 맞은 뒤. */
export function onHurt(state, bus, player) {
  if (!hasBoon(state, 'ice_armor') || player.dead) return;
  const cfg = BOONS.ice_armor;
  if (state.tick < state.run.boonState.iceArmorAt) return;
  state.run.boonState.iceArmorAt = state.tick + ticksOf(cfg.cooldown);
  for (const other of opponentsOf(state, player.faction)) {
    const dx = other.x - player.x;
    const dy = other.y - player.y;
    const reach = cfg.radius + other.radius;
    if (dx * dx + dy * dy > reach * reach) continue;
    applyCold(state, bus, player, other, 'freeze', cfg.freeze);
  }
  bus.emit(EVENTS.EXPLOSION, { x: player.x, y: player.y, radius: cfg.radius, faction: player.faction, proc: 'ice' });
}

/** 쓰러진 플레이어를 되살릴 수 있으면 되살린다(런마다 한 번). */
export function tryRevive(state, bus, player) {
  if (!hasBoon(state, 'second_wind') || state.run.boonState.revived) return false;
  const cfg = BOONS.second_wind;
  state.run.boonState.revived = true;
  player.dead = false;
  player.killerId = null;
  player.diedWith = [];
  player.hp = Math.max(1, Math.round((player.maxHp * cfg.hpPct) / 100));
  player.invulnUntil = state.tick + ticksOf(cfg.invuln);
  bus.emit(EVENTS.PLAYER_REVIVED, { hp: player.hp });
  return true;
}

/** 플레이어가 쏘는 탄에 붙는 것: 더 꿰뚫는 수, 갈라지는가, 벽에 튕기는 수. */
export function projectileMods(state) {
  const owned = state.run.boons;
  return {
    pierce: owned.includes('pierce') ? BOONS.pierce.extra : 0,
    split: owned.includes('split'),
    bounces: owned.includes('ricochet') ? BOONS.ricochet.bounces : 0,
  };
}
