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
  clearColor: 0x07080c,
  fovDeg: 38,
  near: 0.1,
  far: 140,

  /**
   * 고정 쿼터뷰 카메라. 플레이어 위·뒤(남쪽)에서 비스듬히 내려다본다. 화면 위쪽이 맵의 -y 방향이다.
   * followRate: 초당 따라붙는 비율(클수록 빠르다). 목표와 snapDistance 넘게 벌어지면(층 진입·순간이동) 곧바로 옮긴다.
   * portraitScale: 세로 화면에서는 좌우가 좁으므로 카메라를 이만큼 더 멀리 둔다.
   * lead: 조준·이동 방향으로 카메라를 조금 앞세운다(칸).
   */
  camera: { height: 10.5, back: 10, followRate: 7, snapDistance: 12, portraitScale: 1.55, lead: 1.1 },

  /** 벽. cut*: 플레이어 앞(카메라 쪽)을 가리는 벽을 낮춘다 — 플레이어 남쪽 cutDepth 줄, 좌우 cutHalfWidth 칸. 높이는 보간한다. */
  wall: { height: 1.6, cutHeight: 0.25, cutDepth: 3, cutHalfWidth: 3 },

  /** 문: 닫히면 창살이 솟고, 열리면 바닥으로 내려간다(초당 높이 비율). */
  door: { height: 1.3, speed: 6 },

  /** 방 공개: 가 보지 않은 방은 어둡고(hidden), 드러나면 밝기 1 로 FEEL.reveal.roomSec 동안 페이드한다. */
  fog: { hidden: 0, seen: 1 },

  /**
   * 그래픽 품질 3단계.
   * pixelRatio: devicePixelRatio 의 상한, scale: 그 위에 곱하는 해상도 배율, shadows: 그림자, lights: 방마다 켜는 횃불 빛의 수,
   * particles: 한 번에 살아 있을 수 있는 입자 수, damageNumbers: 피해 숫자 수, hitParticles: 타격 한 번에 튀는 입자 수, casings: 탄피 수,
   * props: 방의 소품을 얼마나 놓는가(비율).
   */
  quality: {
    low: { pixelRatio: 1, scale: 0.75, shadows: false, lights: 2, particles: 60, damageNumbers: 8, hitParticles: 3, casings: 8, props: 0.5 },
    medium: { pixelRatio: 1.5, scale: 1, shadows: false, lights: 4, particles: 180, damageNumbers: 16, hitParticles: 6, casings: 24, props: 1 },
    high: { pixelRatio: 2, scale: 1, shadows: true, lights: 6, particles: 360, damageNumbers: 24, hitParticles: 10, casings: 48, props: 1 },
  },

  /** 오브젝트 풀 크기(품질과 무관한 것). 넘치면 그 프레임에는 그리지 않거나 가장 오래된 것을 다시 쓴다. */
  pools: { actors: 96, projectiles: 160, rings: 64, drops: 64, lines: 32, corpses: 24 },

  /** 피해 숫자·입자의 수명(초). */
  damageNumberSec: 0.7,
  particleSec: 0.45,

  /** 툰 셰이딩의 명암 단계(0~255). 적을수록 만화 같다. */
  toonSteps: [55, 165, 255],

  /** 색. */
  colors: {
    playerShot: 0x9fe8ff,
    /** 적의 탄은 크고 따뜻한 색, 테두리는 짙게 — 어두운 바닥에서도 한눈에 읽힌다. */
    enemyShot: 0xff5a3a,
    enemyShotRim: 0xffe0a0,
    hazardWarn: 0xffc04a,
    hazardLive: 0xff4a3a,
    warp: 0x8a7cff,
    telegraph: 0xff6a4a,
    spawnWarn: 0xff3a3a,
    door: 0x9a7b4f,
    doorLocked: 0xd84a3a,
    secretWall: 0x5a5560,
    portal: 0x7fe0ff,
    shop: 0x7fd18b,
    gold: 0xffd34a,
    energy: 0x5ad0ff,
    health: 0xff5a6a,
    boon: { fire: 0xff7a3a, bolt: 0xffe14a, ice: 0x7ad7ff, none: 0xe8d8ff },
    reward: { boon: 0xe8d8ff, weapon: 0xd0d6e0, gold: 0xffd34a, health: 0xff5a6a },
    damage: '#ffffff',
    damageCrit: '#ffd34a',
    damagePlayer: '#ff5a5a',
    damageProc: '#9fe8ff',
    heal: '#7fe08a',
  },
  /**
   * 빛(하데스식 대비): 반구광은 낮게, 따뜻한 해(주광)와 뒤에서 오는 차가운 윤곽광으로 캐릭터를 바탕에서 띄운다.
   * rim 은 화면 안쪽(북쪽) 위에서 비추는 빛 — 머리·어깨 윗선이 밝게 끊긴다.
   */
  light: { hemi: 0.85, sun: 2.2, sunColor: 0xffe2c0, rim: 1.8, rimColor: 0x7ab8ff },
  /** 캐릭터·무기의 굵은 외곽선(세계 단위 굵기, 색). */
  outline: { width: 0.042, color: 0x120b14 },
  /** 벽의 윗면·옆면 밝기(정점 색). 윗면이 밝아야 벽 덩어리가 바닥과 구별된다. */
  wallShade: { top: 1.25, side: 0.5 },
});
