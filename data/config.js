// 엔진 설정값. 밸런스 수치(적·아이템·전투 등)는 단계별로 data/ 아래 별도 파일로 추가한다.
// data/** 는 다른 계층을 import 하지 않는다(순수 값만).

import { deepFreeze } from './freeze.js';

export const LOOP = Object.freeze({
  /** 로직 틱 주파수(Hz). 로직은 항상 1/tickRate 초 단위로만 전진한다. */
  tickRate: 60,
  /** 한 프레임에 반영할 최대 경과 시간(ms). 탭 복귀 등으로 생긴 긴 공백을 잘라낸다. */
  maxFrameMs: 250,
});

export const RENDER = deepFreeze({
  clearColor: 0x0b0d12,
  fovDeg: 42,
  near: 0.1,
  far: 120,

  /**
   * 쿼터뷰 카메라. 플레이어 위·뒤(남쪽)에서 내려다본다. 화면 위쪽이 맵의 -y 방향이다.
   * followRate: 초당 따라붙는 비율(클수록 빠르다). 목표와 snapDistance 넘게 벌어지면(층 이동·순간이동) 곧바로 옮긴다.
   * portraitScale: 세로 화면에서는 좌우가 좁으므로 카메라를 이만큼 더 멀리 둔다.
   */
  camera: { height: 11.5, back: 7.5, followRate: 9, snapDistance: 10, portraitScale: 1.35 },

  /** 벽. cut*: 플레이어 앞(카메라 쪽)을 가리는 벽을 낮춘다 — 플레이어 남쪽 cutDepth 줄, 좌우 cutHalfWidth 칸. */
  wall: { height: 1.5, cutHeight: 0.3, cutDepth: 3, cutHalfWidth: 2 },

  /** 시야 안개의 밝기: 지금 보이는 곳 / 탐험했지만 지금은 안 보이는 곳 / 가 보지 않은 곳. */
  fog: { visible: 1, explored: 0.32, hidden: 0 },

  /**
   * 그래픽 품질 3단계.
   * pixelRatio: devicePixelRatio 의 상한, scale: 그 위에 곱하는 해상도 배율, shadows: 그림자,
   * particles: 한 번에 살아 있을 수 있는 입자 수, damageNumbers: 피해 숫자 수, hitParticles: 타격 한 번에 튀는 입자 수.
   */
  quality: {
    low: { pixelRatio: 1, scale: 0.7, shadows: false, particles: 48, damageNumbers: 8, hitParticles: 2 },
    medium: { pixelRatio: 1.5, scale: 1, shadows: false, particles: 160, damageNumbers: 16, hitParticles: 5 },
    high: { pixelRatio: 2, scale: 1, shadows: true, particles: 320, damageNumbers: 24, hitParticles: 8 },
  },

  /** 오브젝트 풀 크기(품질과 무관한 것). 넘치면 가장 오래된 것을 다시 쓴다. */
  pools: { projectiles: 48, rings: 40, drops: 64 },

  /** 피해 숫자·입자의 수명(초). */
  damageNumberSec: 0.75,
  particleSec: 0.5,

  /** 색. 적은 종류 이름에서 색상을 정한다(render/entities). */
  colors: {
    player: 0x6fc3ff,
    boss: 0xff5a4a,
    playerShot: 0x9fe0ff,
    enemyShot: 0xff8a5a,
    hazardWarn: 0xffc04a,
    hazardLive: 0xff4a3a,
    telegraph: 0xff9a6a,
    stairs: 0xf2e6a0,
    stairsLocked: 0x6a6455,
    shop: 0x7fd18b,
    altar: 0xc79bff,
    gold: 0xffd34a,
    consumable: 0xff6a7a,
    relic: 0xc79bff,
    rarity: { common: 0xb8bcc6, uncommon: 0x6fd08a, rare: 0x5aa8ff, epic: 0xc07aff, legendary: 0xffa53a },
    damage: '#ffffff',
    damageCrit: '#ffd34a',
    damagePlayer: '#ff6a6a',
    heal: '#7fe08a',
  },
});
