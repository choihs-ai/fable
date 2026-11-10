// 장판: 바닥의 원형 위험 지역. 예고 시간(delay) 뒤에 터지고, duration 이 있으면 interval 마다 다시 터진다.

import { EVENTS } from '../core/events.js';
import { ticksOf } from '../core/time.js';
import { opponentsOf } from '../entities/actors.js';
import { lineOfSight } from '../world/los.js';
import { navOf } from '../world/nav.js';
import { applyHit } from './hit.js';

export function spawnHazard(state, bus, owner, effect, x, y) {
  const armAt = state.tick + ticksOf(effect.delay ?? 0);
  const lasts = ticksOf(effect.duration ?? 0);
  const hazard = {
    id: state.entities.nextId++,
    ownerId: owner.id,
    faction: owner.faction,
    x,
    y,
    radius: effect.radius,
    damage: effect.damage,
    status: effect.status ?? null,
    /** 다음에 터지는 틱, 다시 터지는 간격(0 이면 한 번만), 사라지는 틱. */
    nextAt: armAt,
    interval: lasts > 0 ? ticksOf(effect.interval ?? 0.5) : 0,
    endAt: armAt + lasts,
  };
  state.hazards.push(hazard);
  bus.emit(EVENTS.HAZARD_SPAWNED, {
    id: hazard.id, ownerId: owner.id, x, y, radius: hazard.radius, armTicks: armAt - state.tick, lastsTicks: lasts,
  });
  return hazard;
}

export function updateHazards(state, bus) {
  if (state.hazards.length === 0) return;
  const nav = navOf(state.world);
  const alive = [];
  for (const hz of state.hazards) {
    if (state.tick >= hz.nextAt) {
      for (const target of opponentsOf(state, hz.faction)) {
        const dx = target.x - hz.x;
        const dy = target.y - hz.y;
        if (dx * dx + dy * dy > hz.radius * hz.radius) continue;
        // 벽 너머로는 맞지 않는다(장판 중심이 벽 안이면 아무도 맞지 않는다).
        if (!lineOfSight(nav, hz.x, hz.y, target.x, target.y)) continue;
        applyHit(state, bus, target, hz, hz.ownerId, hz.x, hz.y);
      }
      bus.emit(EVENTS.HAZARD_TRIGGERED, { id: hz.id, x: hz.x, y: hz.y, radius: hz.radius });
      if (hz.interval > 0 && hz.nextAt + hz.interval <= hz.endAt) hz.nextAt += hz.interval;
      else continue;
    }
    alive.push(hz);
  }
  state.hazards = alive;
}
