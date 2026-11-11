// 장판: 바닥의 원형 지역.
//   'blast' — 예고 시간(delay) 뒤에 터지고, duration 이 있으면 interval 마다 다시 터진다.
//   'warp'  — 시간 왜곡. 터지지 않고, 있는 동안 안의 상대와 상대의 탄을 느리게 한다(탄은 logic/combat/projectiles.js).

import { EVENTS } from '../core/events.js';
import { ticksOf } from '../core/time.js';
import { opponentsOf } from '../entities/actors.js';
import { lineOfSight } from '../world/los.js';
import { navOf } from '../world/nav.js';
import { applyHit } from './hit.js';
import { applyStatus } from './statuses.js';

export function spawnHazard(state, bus, owner, effect, x, y) {
  const armAt = state.tick + ticksOf(effect.delay ?? 0);
  const lasts = ticksOf(effect.duration ?? 0);
  const hazard = {
    id: state.entities.nextId++,
    kind: 'blast',
    ownerId: owner.id,
    faction: owner.faction,
    x,
    y,
    radius: effect.radius,
    damage: effect.damage,
    /** 깔린 순간의 공격 배율. */
    power: owner.power,
    status: effect.status ? { ...effect.status } : null, // 데이터의 정의 객체를 상태에 그대로 넣지 않는다(저장·불러오기 뒤에도 같도록)
    /** 다음에 터지는 틱, 다시 터지는 간격(0 이면 한 번만), 사라지는 틱. */
    nextAt: armAt,
    interval: lasts > 0 ? ticksOf(effect.interval ?? 0.5) : 0,
    endAt: armAt + lasts,
    /** 시간 왜곡의 속도 배율(blast 는 1). */
    slow: 1,
    /** false 면 맞아도 축복을 부르지 않는다(축복이 깐 장판). */
    proc: effect.proc !== false,
  };
  state.hazards.push(hazard);
  bus.emit(EVENTS.HAZARD_SPAWNED, {
    id: hazard.id, kind: hazard.kind, ownerId: owner.id, faction: owner.faction, x, y, radius: hazard.radius, armTicks: armAt - state.tick, lastsTicks: lasts,
  });
  return hazard;
}

/** 시간 왜곡 장판을 깐다. */
export function spawnWarpField(state, bus, owner, x, y, { radius, duration, slow }) {
  const lasts = ticksOf(duration);
  const hazard = {
    id: state.entities.nextId++, kind: 'warp', ownerId: owner.id, faction: owner.faction, x, y, radius, damage: 0, power: 1, status: null,
    nextAt: state.tick, interval: 0, endAt: state.tick + lasts, slow, proc: false,
  };
  state.hazards.push(hazard);
  bus.emit(EVENTS.HAZARD_SPAWNED, { id: hazard.id, kind: hazard.kind, ownerId: owner.id, faction: owner.faction, x, y, radius, armTicks: 0, lastsTicks: lasts });
  return hazard;
}

export function updateHazards(state, bus) {
  if (state.hazards.length === 0) return;
  const nav = navOf(state.world);
  const alive = [];
  for (const hz of state.hazards) {
    if (hz.kind === 'warp') {
      if (state.tick >= hz.endAt) continue;
      for (const target of opponentsOf(state, hz.faction)) {
        const dx = target.x - hz.x;
        const dy = target.y - hz.y;
        if (dx * dx + dy * dy <= hz.radius * hz.radius) applyStatus(state, bus, target, 'warp', { sourceId: hz.ownerId });
      }
      alive.push(hz);
      continue;
    }
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
