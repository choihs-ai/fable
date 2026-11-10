// 투사체. 직선으로 날아가다 벽에 닿거나, 상대 진영에 맞거나, 사거리를 다 날면 사라진다.

import { EVENTS } from '../core/events.js';
import { ticksOf } from '../core/time.js';
import { opponentsOf } from '../entities/actors.js';
import { isWall, navOf } from '../world/nav.js';
import { applyHit } from './hit.js';

export function spawnProjectile(state, bus, owner, effect, dirX, dirY) {
  const projectile = {
    id: state.entities.nextId++,
    ownerId: owner.id,
    faction: owner.faction,
    x: owner.x + dirX * owner.radius,
    y: owner.y + dirY * owner.radius,
    vx: dirX * effect.speed,
    vy: dirY * effect.speed,
    radius: effect.radius,
    damage: effect.damage,
    status: effect.status ?? null,
    expiresAt: state.tick + ticksOf(effect.range / effect.speed),
  };
  state.projectiles.push(projectile);
  bus.emit(EVENTS.PROJECTILE_FIRED, {
    id: projectile.id, ownerId: owner.id, x: projectile.x, y: projectile.y, vx: projectile.vx, vy: projectile.vy, radius: projectile.radius,
  });
  return projectile;
}

export function updateProjectiles(state, bus, dtSec) {
  if (state.projectiles.length === 0) return;
  const nav = navOf(state.world);
  const alive = [];
  for (const p of state.projectiles) {
    p.x += p.vx * dtSec;
    p.y += p.vy * dtSec;
    if (state.tick >= p.expiresAt || isWall(nav, Math.floor(p.x), Math.floor(p.y))) continue;
    let hit = false;
    for (const target of opponentsOf(state, p.faction)) {
      // 무적(회피 중)인 대상은 그냥 지나간다.
      if (target.invulnUntil > state.tick) continue;
      const dx = target.x - p.x;
      const dy = target.y - p.y;
      const reach = target.radius + p.radius;
      if (dx * dx + dy * dy > reach * reach) continue;
      applyHit(state, bus, target, p, p.ownerId, p.x - p.vx * dtSec, p.y - p.vy * dtSec);
      hit = true;
      break;
    }
    if (!hit) alive.push(p);
  }
  state.projectiles = alive;
}
