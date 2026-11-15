// 시간 왜곡 장판 만들기. 다른 전투 모듈을 import 하지 않는다(boons.js·hazards.js 가 함께 쓴다 — 순환을 만들지 않도록).

import { EVENTS } from '../core/events.js';
import { ticksOf } from '../core/time.js';

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

