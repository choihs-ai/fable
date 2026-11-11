// 투사체. 직선으로 날아가다 벽에 닿거나, 상대 진영에 맞거나, 사거리를 다 날면 사라진다.
// 꿰뚫기(pierce), 폭발(explode), 벽에 튕기기(bounces), 갈라지기(split)가 붙을 수 있다.

import { BOONS } from '../../../data/boons.js';
import { EVENTS } from '../core/events.js';
import { getActor, opponentsOf } from '../entities/actors.js';
import { lineOfSight } from '../world/los.js';
import { isWall, navOf } from '../world/nav.js';
import { hasBoon, projectileMods } from './boons.js';
import { applyHit } from './hit.js';

/** 갈라진 탄이 나가는 방향(맞은 탄의 진행 방향 기준 ±35도). */
const SPLIT_DIRS = [[0.8192, 0.5736], [0.8192, -0.5736]];

/**
 * @param {object} owner 쏜 행동체
 * @param {object} effect 투사체 효과 정의
 * @param {object} [options] { x, y } 나가는 자리(생략하면 쏜 행동체의 몸 가장자리), child 면 갈라진 탄
 */
export function spawnProjectile(state, bus, owner, effect, dirX, dirY, options = {}) {
  // 플레이어의 탄에는 축복이 붙는다. 갈라진 탄은 다시 갈라지지 않는다.
  const mods = owner.kit && !options.child ? projectileMods(state) : { pierce: 0, split: false, bounces: 0 };
  const projectile = {
    id: state.entities.nextId++,
    ownerId: owner.id,
    faction: owner.faction,
    x: options.x ?? owner.x + dirX * owner.radius,
    y: options.y ?? owner.y + dirY * owner.radius,
    vx: dirX * effect.speed,
    vy: dirY * effect.speed,
    radius: effect.radius,
    damage: effect.damage,
    /** 쏜 순간의 공격 배율. */
    power: owner.power,
    knockback: effect.knockback ?? 0,
    status: effect.status ? { ...effect.status } : null, // 데이터의 정의 객체를 상태에 그대로 넣지 않는다(저장·불러오기 뒤에도 같도록)
    /** 더 날아갈 수 있는 거리(칸). */
    left: effect.range,
    /** 더 꿰뚫을 수 있는 대상 수와 이미 맞힌 대상. */
    pierce: (effect.pierce ?? 0) + mods.pierce,
    hit: options.hit ? [...options.hit] : [],
    /** 폭발 { radius, damage, knockback, status } 또는 null. */
    explode: effect.explode
      ? { radius: effect.explode.radius, damage: effect.explode.damage, knockback: effect.explode.knockback ?? 0, status: effect.explode.status ? { ...effect.explode.status } : null }
      : null,
    bounces: mods.bounces,
    split: mods.split,
    /** false 면 맞아도 축복을 부르지 않는다(갈라진 탄). */
    proc: options.child !== true,
  };
  state.projectiles.push(projectile);
  bus.emit(EVENTS.PROJECTILE_FIRED, {
    id: projectile.id, ownerId: owner.id, faction: owner.faction, x: projectile.x, y: projectile.y, vx: projectile.vx, vy: projectile.vy, radius: projectile.radius,
  });
  return projectile;
}

/** 폭발: 둘레의 상대를 맞힌다(벽 너머는 맞지 않는다). 딸려 나온 피해이므로 축복을 부르지 않는다. */
function explode(state, bus, nav, p) {
  const e = p.explode;
  for (const target of opponentsOf(state, p.faction)) {
    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const reach = e.radius + target.radius;
    if (dx * dx + dy * dy > reach * reach || !lineOfSight(nav, p.x, p.y, target.x, target.y)) continue;
    applyHit(state, bus, target, { damage: e.damage, power: p.power, knockback: e.knockback, status: e.status, proc: false }, p.ownerId, p.x, p.y);
  }
  bus.emit(EVENTS.EXPLOSION, { x: p.x, y: p.y, radius: e.radius, faction: p.faction });
}

/**
 * 조건에 맞는 상대 진영의 탄을 지운다.
 * @param {string} faction 지우는 쪽의 진영(이 진영의 탄은 건드리지 않는다)
 * @param {(p:object) => boolean} test
 * @returns {number} 지운 수
 */
export function clearBullets(state, bus, faction, test, x, y) {
  let count = 0;
  state.projectiles = state.projectiles.filter((p) => {
    if (p.faction === faction || !test(p)) return true;
    count++;
    return false;
  });
  if (count > 0) bus.emit(EVENTS.BULLETS_CLEARED, { count, x, y });
  return count;
}

export function updateProjectiles(state, bus, dtSec) {
  if (state.projectiles.length === 0) return;
  const nav = navOf(state.world);
  // 시간 왜곡 장판 안에서는 상대의 탄이 느려진다.
  const warps = state.hazards.filter((hz) => hz.kind === 'warp');
  const list = state.projectiles;
  const alive = [];
  // 도는 동안 갈라진 탄이 state.projectiles 에 더해질 수 있으므로, 살아남은 것은 따로 모은다.
  state.projectiles = [];
  for (const p of list) {
    let scale = 1;
    for (const hz of warps) {
      if (hz.faction === p.faction) continue;
      const dx = p.x - hz.x;
      const dy = p.y - hz.y;
      if (dx * dx + dy * dy <= hz.radius * hz.radius && hz.slow < scale) scale = hz.slow;
    }
    const ox = p.x;
    const oy = p.y;
    const stepX = p.vx * dtSec * scale;
    const stepY = p.vy * dtSec * scale;
    p.x += stepX;
    p.y += stepY;
    p.left -= Math.sqrt(stepX * stepX + stepY * stepY);

    if (isWall(nav, Math.floor(p.x), Math.floor(p.y))) {
      if (p.bounces > 0) {
        // 벽에 튕긴다: 가로로만 움직였을 때 벽이면 가로 속도를, 세로로만 움직였을 때 벽이면 세로 속도를 뒤집는다.
        const hitX = isWall(nav, Math.floor(p.x), Math.floor(oy));
        const hitY = isWall(nav, Math.floor(ox), Math.floor(p.y));
        if (hitX || !hitY) p.vx = -p.vx;
        if (hitY || !hitX) p.vy = -p.vy;
        p.x = ox;
        p.y = oy;
        p.bounces -= 1;
        alive.push(p);
        continue;
      }
      // 터지는 자리는 벽 바로 앞이다.
      p.x = ox;
      p.y = oy;
      if (p.explode) explode(state, bus, nav, p);
      continue;
    }
    if (p.left <= 0) {
      if (p.explode) explode(state, bus, nav, p);
      continue;
    }

    let gone = false;
    for (const target of opponentsOf(state, p.faction)) {
      if (p.hit.includes(target.id)) continue;
      const dx = target.x - p.x;
      const dy = target.y - p.y;
      const reach = target.radius + p.radius;
      if (dx * dx + dy * dy > reach * reach) continue;
      if (target.invulnUntil > state.tick) {
        // 무적(대시 중)인 대상은 그냥 지나간다. 축복 "탄 가르기"가 있으면 대시 중인 플레이어가 탄을 지우고 에너지를 얻는다.
        if (target.kit && target.dash && hasBoon(state, 'deflect')) {
          target.kit.energy = Math.min(target.kit.maxEnergy, target.kit.energy + BOONS.deflect.energy);
          bus.emit(EVENTS.BULLETS_CLEARED, { count: 1, x: p.x, y: p.y });
          gone = true;
          break;
        }
        continue;
      }
      applyHit(state, bus, target, p, p.ownerId, ox, oy);
      p.hit.push(target.id);
      if (p.explode) explode(state, bus, nav, p);
      if (p.split) {
        // 두 갈래로 갈라진다. 갈라진 탄은 방금 맞힌 대상을 다시 맞히지 않는다.
        p.split = false;
        const owner = getActor(state, p.ownerId);
        if (owner && !owner.dead) {
          const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
          const ux = p.vx / speed;
          const uy = p.vy / speed;
          const child = { speed, radius: p.radius * 0.85, range: BOONS.split.range, damage: Math.max(1, Math.round(p.damage * BOONS.split.ratio)), knockback: p.knockback * 0.5 };
          for (const [c, s] of SPLIT_DIRS) {
            spawnProjectile(state, bus, owner, child, ux * c - uy * s, ux * s + uy * c, { x: p.x, y: p.y, child: true, hit: p.hit });
          }
        }
      }
      if (p.pierce > 0 && !p.explode) {
        p.pierce -= 1;
        continue;
      }
      gone = true;
      break;
    }
    if (!gone) alive.push(p);
  }
  // 이번 틱에 갈라져 나온 탄은 다음 틱부터 움직인다.
  state.projectiles = alive.concat(state.projectiles);
}
