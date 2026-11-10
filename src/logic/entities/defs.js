// 행동체(actor)의 데이터 정의를 찾는다.

import { BOSSES } from '../../../data/bosses.js';
import { ENEMIES } from '../../../data/enemies.js';
import { PLAYER } from '../../../data/player.js';

export const ACTOR_KIND = Object.freeze({ PLAYER: 'player', ENEMY: 'enemy', BOSS: 'boss' });

/** 종류 id 로 적·보스 정의를 찾는다. 없으면 null. */
export function enemyDef(type) {
  if (Object.hasOwn(ENEMIES, type)) return ENEMIES[type];
  if (Object.hasOwn(BOSSES, type)) return BOSSES[type];
  return null;
}

export function isBossType(type) {
  return Object.hasOwn(BOSSES, type);
}

/** 행동체의 데이터 정의(플레이어·적·보스). */
export function defOf(actor) {
  if (actor.kind === ACTOR_KIND.PLAYER) return PLAYER;
  return actor.kind === ACTOR_KIND.BOSS ? BOSSES[actor.type] : ENEMIES[actor.type];
}

/** 대상의 상태이상 저항(지속시간 배율). 0 이면 면역. */
export function statusResistOf(def, statusId) {
  if (def.immune && def.immune.includes(statusId)) return 0;
  const resist = def.statusResist ? def.statusResist[statusId] : undefined;
  return resist === undefined ? 1 : resist;
}
