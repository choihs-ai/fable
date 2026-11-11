// 난이도 배율: 방의 깊이(시작 방에서 건너온 방의 수)에 따른 적의 체력·공격, 정예·보스 배율. 수치는 data/encounters.js.

import { ENCOUNTERS } from '../../../data/encounters.js';

/**
 * @param {number} depth 0 이상
 * @param {{ elite?:boolean, boss?:boolean }} [options]
 * @returns {{ hp:number, damage:number }}
 */
export function depthScaling(depth, { elite = false, boss = false } = {}) {
  const s = ENCOUNTERS.scaling;
  let hp = Math.min(s.hpMax, s.hpBase + s.hpPerDepth * depth);
  let damage = Math.min(s.damageMax, s.damageBase + s.damagePerDepth * depth);
  if (boss) {
    // 보스는 깊이와 무관하게 정해진 배율만 쓴다(어느 길로 왔든 같은 보스).
    hp = ENCOUNTERS.boss.hp;
    damage = ENCOUNTERS.boss.damage;
  } else if (elite) {
    hp *= ENCOUNTERS.elite.hp;
    damage *= ENCOUNTERS.elite.damage;
  }
  return { hp, damage };
}
