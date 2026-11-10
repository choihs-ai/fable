// 플레이어 기준 스탯과 기술.
//
// 기술(ability) 형식 — 적·보스도 같은 형식을 쓴다:
//   windup    준비 시간(초). 이 동안 움직이지 못하고 방향이 고정된다(상대가 피할 틈). 0 이면 즉시 발동.
//   recovery  발동 후 경직(초).
//   cooldown  재사용 대기(초). 발동 시점부터 센다.
//   range / minRange   AI 가 이 거리 안(밖)에서만 쓴다.
//   needsLos  false 면 시야가 막혀도 쓴다(기본 true).  needsClearPath  몸이 지나갈 직선 길이 있어야 쓴다(돌진).
//   effects   발동 시 순서대로 일어나는 일(부채꼴·원·장판은 벽 너머의 대상을 맞히지 못한다):
//     { type:'arc', range, cosHalf, damage, status?, lifesteal? }        앞쪽 부채꼴 (cosHalf = 반각의 코사인)
//     { type:'circle', radius, damage, status? }                         자기 둘레 원
//     { type:'projectile', speed, radius, range, damage, status?, spread? }   투사체. spread 는 조준 방향 기준 회전 [cos, sin] 목록
//     { type:'hazard', offsets?, delay, duration?, interval?, radius, damage, status? }   목표 지점에 예고 후 터지는 장판
//     { type:'dash', speed, distance, damage?, status?, stopOnWall?, stunOnWall? }        조준 방향 돌진
//     { type:'summon', enemy, count, max? }   { type:'teleport', min, max }   { type:'die' }
//   status 는 { id, duration?, stacks?, chance? }.

import { deepFreeze } from './freeze.js';

export const PLAYER = deepFreeze({
  hp: 100,
  speed: 4.2,
  radius: 0.3,
  mass: 1,
  armor: 0,
  /** 조준 입력이 없을 때 이 거리 안에서 시야가 닿는 가장 가까운 적을 자동으로 겨눈다. */
  assistRange: 8,
  /** 회피: 짧은 돌진. invuln 초 동안 피해·상태이상을 받지 않고 적을 통과한다. */
  dodge: { speed: 13, duration: 0.18, invuln: 0.3, cooldown: 1.0 },
  attack: 'slash',
  skills: ['whirlwind', 'firebolt', 'frost_nova'],
  abilities: {
    slash: { cooldown: 0.4, effects: [{ type: 'arc', range: 1.5, cosHalf: 0.34, damage: 6 }] },
    whirlwind: { cooldown: 6, effects: [{ type: 'circle', radius: 2.0, damage: 12, status: { id: 'bleed' } }] },
    firebolt: { cooldown: 3.5, effects: [{ type: 'projectile', speed: 12, radius: 0.2, range: 9, damage: 10, status: { id: 'burn' } }] },
    frost_nova: { cooldown: 10, effects: [{ type: 'circle', radius: 2.8, damage: 4, status: { id: 'freeze' } }] },
  },
});
