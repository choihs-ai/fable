// 맵 생성 수치. 구역별 값은 data/zones.js.

import { deepFreeze } from './freeze.js';

export const WORLD = deepFreeze({
  /** 구역 하나의 층 수. 전체 층 수 = 구역 수 × floorsPerZone. */
  floorsPerZone: 5,

  /** 한 층의 생성 재시도 상한. 넘으면 단순한 비상 레이아웃으로 대체한다(무한 재시도 방지). */
  maxAttempts: 8,

  /** 배치 거리. 모두 시작점에서의 걸음 수(상하좌우 이동) 기준이다. */
  placement: {
    /** 계단은 시작점에서 최소 이만큼 떨어진다. */
    stairsMinStartDist: 12,
    /** 계단 후보: 가장 먼 곳까지 거리의 이 비율 이상인 곳 중에서 고른다. */
    stairsFarRatio: 0.75,
    enemyMinStartDist: 8,
    itemMinStartDist: 4,
    /** 이벤트방의 모든 칸이 시작점에서 최소 이만큼 떨어진다. */
    eventMinStartDist: 6,
  },

  /** 일반 층에 이벤트방이 생길 확률(종류별로 따로 굴린다). */
  events: {
    shop: 0.35,
    altar: 0.3,
  },

  /** 이벤트방 내부 크기(정사각형, 홀수). 가운데 칸에 상인/제단이 놓인다. */
  eventRoomSize: 5,

  /** 방+복도(BSP) 생성기. */
  rooms: {
    /** 분할 조각의 최소 변 길이. */
    minLeaf: 9,
    /** 이보다 긴 변이 있으면 반드시 더 나눈다. */
    maxLeaf: 18,
    /** 더 나눌 수 있어도 여기서 멈출 확률. */
    stopChance: 0.3,
    /** 방 내부의 최소 변 길이. */
    roomMin: 4,
    /** 방 크기 하한: 조각에 들어갈 수 있는 최대 크기의 이 비율. */
    roomFillMin: 0.5,
    /** 순환로를 만드는 추가 복도 수 상한 = 방 개수 × 이 비율. */
    extraCorridorRatio: 0.25,
  },

  /** 동굴형(셀룰러 오토마타) 생성기. */
  cave: {
    /** 처음에 칸이 벽일 확률. */
    fillChance: 0.45,
    smoothSteps: 5,
    /** 주변 8칸 중 벽이 이 수 이상이면 벽이 된다(자신이 벽이면 하나 적어도 유지). */
    wallThreshold: 5,
    /** 본 동굴과 떨어진 공간이 이보다 작으면 메우고, 크면 굴을 파서 잇는다. */
    minRegionSize: 16,
    /** 바닥 비율이 이보다 낮으면 그 시도는 버린다. */
    minOpenRatio: 0.28,
    /** 이벤트방을 놓을 자리 후보를 몇 군데 살펴볼지. */
    eventCandidates: 24,
  },

  /** 보스층 전용 레이아웃. 범위는 [최소, 최대]이고 크기는 홀수만 쓴다. */
  boss: {
    mid: {
      arenaW: [15, 19],
      arenaH: [13, 17],
      chamfer: [0, 0],
      hallWidth: 3,
      hallLength: [4, 7],
      entry: { w: 7, h: 5 },
      /** 보스 뒤편의 계단 방과 거기로 가는 통로. */
      exit: { w: 5, h: 5, hallLength: 3 },
      throne: null,
      alcoves: false,
      margin: 3,
      pillars: ['none', 'corners', 'ring', 'columns'],
    },
    final: {
      arenaW: [21, 25],
      arenaH: [19, 23],
      /** 결투장 모서리를 깎는 칸 수. */
      chamfer: [4, 6],
      hallWidth: 5,
      hallLength: [9, 13],
      entry: { w: 7, h: 5 },
      exit: null,
      /** 결투장 위쪽의 옥좌 공간. */
      throne: { w: 7, h: 3 },
      /** 진입 회랑 양옆의 벽감. */
      alcoves: true,
      margin: 3,
      pillars: ['ring', 'columns'],
    },
  },
});
