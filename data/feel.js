// 손맛 수치: 히트스톱, 카메라 흔들림, 넉백, 번쩍임, 총구 섬광·탄피, 처치 연출, 진동.
// 넉백만 로직(위치)에 영향을 주고, 나머지는 보여 주기만 한다(게임 결과는 같다).

import { deepFreeze } from './freeze.js';

export const FEEL = deepFreeze({
  /** 히트스톱: 맞히는 순간 게임을 잠깐 멈춘다(초). 겹치면 긴 쪽을 쓰고 max 를 넘지 않는다. */
  hitstop: { hit: 0.025, crit: 0.06, kill: 0.05, eliteKill: 0.1, bossKill: 0.35, hurt: 0.09, max: 0.4, minDamage: 6 },

  /** 카메라 흔들림: 세기(칸)를 더하고, 초당 decay 배로 줄어든다. frequency 는 떨리는 빠르기(Hz). */
  shake: { hit: 0.05, crit: 0.14, kill: 0.16, explosion: 0.32, hurt: 0.4, bossSlam: 0.5, bossKill: 0.8, fire: 0.035, max: 0.9, decay: 7, frequency: 31 },

  /**
   * 넉백(로직): 밀려나는 속도는 틱마다 decay 배가 되고 stop 아래로 내려가면 멈춘다.
   * 밀어내는 세기 ÷ 무게가 staggerAt 이상이면 준비 중이던 행동이 끊긴다.
   * hurt 는 플레이어가 맞았을 때 밀려나는 세기.
   */
  knockback: { decay: 0.82, stop: 0.4, staggerAt: 9, hurt: 6, max: 24 },

  /** 맞았을 때 하얗게 번쩍이는 시간(초). */
  flash: { hit: 0.09, hurt: 0.28 },

  /** 총구 섬광과 탄피. */
  muzzle: { sec: 0.06, size: 0.45 },
  casing: { speed: 2.6, up: 3.2, life: 0.7, gravity: 12 },

  /** 처치: 쓰러진 적이 맞은 방향으로 튕겨 나가며 사라진다. */
  corpse: { life: 0.6, speedMul: 0.5, minSpeed: 4, up: 4.5, gravity: 16, spin: 9 },

  /** 방이 드러나는 페이드(초), 벽을 낮추는 빠르기(초당 비율), 층에 들어갈 때의 화면 페이드(초). */
  reveal: { roomSec: 0.3, wallRate: 10, screenFadeSec: 0.35 },

  // 축복의 기운: 계열(불·번개·얼음)마다 몸 둘레를 도는 구슬, 축복 수에 따라 발밑의 고리.
  // perOrb 축복 몇 개마다 구슬 하나(올림), maxOrbs 계열마다 최대 구슬 수, radius·height 도는 반지름·높이(칸),
  // speed 초당 회전(라디안), bob 위아래 흔들림, ringsAt 발밑 고리가 하나씩 느는 축복 수, ringOpacity 고리의 진하기
  aura: {
    perOrb: 2, maxOrbs: 3, radius: 0.85, height: 0.85, speed: 2.4, bob: 0.08, size: 0.09,
    ringsAt: [4, 10, 18], ringOpacity: 0.32,
    colors: { fire: 0xff7a35, bolt: 0xffe14a, ice: 0x8ad8ff, none: 0xf1e4c8 },
  },

  /** 진동(밀리초, 또는 [진동, 쉼, 진동…]). */
  vibration: {
    hit: 8, crit: 16, kill: 18, hurt: [45], dash: 10, clear: [20, 40, 30], boon: 20, bossPhase: [60, 40, 60],
    death: [120, 60, 200], deny: [12, 30, 12], pickup: 8, door: 25, skill: 30,
  },
});
