// 플레이어 공통 수치. 캐릭터별 값은 data/characters.js, 무기는 data/weapons.js, 축복은 data/boons.js.
//
// 기술(ability) 형식 — 무기·적·보스가 같은 형식을 쓴다:
//   windup    준비 시간(초). 이 동안 움직이지 못하고 방향이 고정된다(상대가 피할 틈). 0 이면 즉시 발동.
//   recovery  발동 후 경직(초).
//   cooldown  재사용 대기(초). 발동 시점부터 센다.
//   range / minRange   AI 가 이 거리 안(밖)에서만 쓴다.
//   needsLos  false 면 시야가 막혀도 쓴다(기본 true).  needsClearPath  몸이 지나갈 직선 길이 있어야 쓴다(돌진).
//   effects   발동 시 순서대로 일어나는 일(부채꼴·원·장판·광선은 벽 너머의 대상을 맞히지 못한다):
//     { type:'arc', range, cosHalf, damage, status?, lifesteal?, knockback?, clearsBullets? }   앞쪽 부채꼴 (cosHalf = 반각의 코사인)
//     { type:'circle', radius, damage, status?, knockback? }                                   자기 둘레 원
//     { type:'projectile', speed, radius, range, damage, status?, spread?, jitter?, pierce?, explode?, knockback? }
//         투사체. spread 는 조준 방향 기준 회전 [cos, sin] 목록, jitter 는 쏠 때마다 조금씩 흩어지는 정도(0~1),
//         pierce 는 더 꿰뚫는 대상 수, explode 는 맞거나 사라질 때의 폭발 { radius, damage, status?, knockback? }
//     { type:'beam', range, width, damage, status?, knockback? }                               벽에 닿을 때까지 곧게 뻗는 광선(닿는 대상을 모두 맞힌다)
//     { type:'hazard', offsets?, delay, duration?, interval?, radius, damage, status? }        목표 지점에 예고 후 터지는 장판
//     { type:'dash', speed, distance, damage?, status?, knockback?, stopOnWall?, stunOnWall? }  조준 방향 돌진
//     { type:'summon', enemy, count, max? }   { type:'teleport', min, max }   { type:'die' }
//   status 는 { id, duration?, stacks?, chance? }.  knockback 은 밀어내는 처음 속도(칸/초)이고 대상의 무게로 나눈다.

import { deepFreeze } from './freeze.js';

export const PLAYER = deepFreeze({
  radius: 0.3,
  mass: 1,
  armor: 0,
  critChance: 0.05,
  critDamage: 1.6,
  /** 조준 입력이 없을 때 이 거리 안에서 시야가 닿는 가장 가까운 적을 자동으로 겨눈다. */
  assistRange: 11,
  /**
   * 대시: 짧은 돌진. invuln 초 동안 피해·상태이상을 받지 않고 적과 탄을 통과한다.
   * 충전식이다 — charges 번까지 이어 쓸 수 있고, recharge 초마다 한 번씩 다시 찬다.
   * attackWindow: 대시가 끝난 뒤 이 시간 안에 한 공격은 "대시 공격"(무기마다 다른 강한 공격)이 된다.
   */
  dash: { speed: 14, duration: 0.17, invuln: 0.25, charges: 2, recharge: 1.2, attackWindow: 0.3 },
  /** 입력 버퍼: 지금 할 수 없는 대시·스킬 입력을 이 시간(초) 동안 기억했다가 가능해지면 실행한다. */
  inputBuffer: 0.15,
  /**
   * 개머리판 치기: 에너지가 모자라 원거리 무기를 쏠 수 없을 때 대신 나가는 약한 근접 공격(에너지를 쓰지 않는다).
   * 원거리 무기만 둘 들고 에너지가 떨어져도 잠긴 방에서 아무것도 못 하게 되지는 않는다.
   */
  bash: { cooldown: 0.45, effects: [{ type: 'arc', range: 1.4, cosHalf: 0.3, damage: 5, knockback: 7 }] },
  /** 에너지가 모자라 쏘지 못했다는 알림을 다시 내기까지(초). */
  emptyNoticeSec: 1,
  /**
   * 탈 교체: 교체 기술이 다시 나가기까지(초), 교체 기술이 나갈 때의 무적(초).
   * 교체 자체(탈과 무기가 함께 바뀜)는 언제나 된다.
   */
  swap: { cooldown: 7, invuln: 0.35 },
  /** 맞은 뒤 잠깐의 무적(초). 여러 탄을 한꺼번에 맞아 즉사하는 일을 막는다. */
  hurtInvuln: 0.45,
});
