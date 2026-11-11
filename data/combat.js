// 전투 공통 수치. 대상별 수치는 player.js / enemies.js / bosses.js, 상태이상은 statuses.js.

import { deepFreeze } from './freeze.js';

export const COMBAT = deepFreeze({
  /** 플레이어 시야 반경(칸). */
  visionRadius: 9,

  // ── 어그로·리쉬 ──
  /** 대기 중인 적이 플레이어를 살피는 주기(초). */
  aggroCheckSec: 0.1,
  /** 적 기본값: 이 거리 안에서 시야가 닿으면 전투 시작. */
  aggroRadius: 7,
  /** 적 기본값: 플레이어가 적의 자리에서 이보다 멀어지면 추격을 포기하고 돌아간다. */
  leashRadius: 14,
  /** 적 기본값: 이 시간(초) 동안 플레이어를 보지 못하면 돌아간다. */
  loseSight: 4,
  /** 시야가 끊긴 뒤 이 시간(초) 동안은 다시 보여도 계속 다가간다. */
  chaseCommitSec: 0.6,
  /** 돌아가는 동안의 이동 속도 배율과 초당 체력 회복(최대 체력 비율). */
  returnSpeedMul: 1.5,
  returnRegenPerSec: 0.25,
  /** 돌아가는 중에 다시 싸우려면 플레이어가 "자리에서 leashRadius × 이 비율" 안에 있어야 한다(경계에서 오락가락 방지). */
  reaggroLeashRatio: 0.8,
  /** 자리에서 이 거리(칸) 안이면 "자리에 있다"고 본다. 대기 중에 이보다 밀려나면 걸어서 돌아온다. */
  homeSlack: 0.5,
  /** 돌아갈 길을 이 시간(초) 넘게 찾지 못하면 자리로 바로 옮긴다. */
  returnGiveUpSec: 3,

  // ── 길찾기 ──
  /** 경로를 다시 계산하는 주기(초). */
  repathSec: 0.5,
  /** 경유점에 이만큼 가까워지면 다음 경유점으로 넘어간다(칸). */
  waypointReach: 0.3,
  /** A* 가 펼치는 노드 수 상한. 넘으면 길 없음으로 본다. */
  maxPathNodes: 4000,

  // ── 방어력 ──
  /** 받는 피해 = 피해 × armorK ÷ (armorK + 방어력). 방어력이 armorK 와 같으면 피해가 절반이 된다. */
  armorK: 30,

  // ── 기타 ──
  /**
   * 같은 편끼리 겹쳤을 때 미는 세기. 실제로 미는 양은 "겹친 깊이 × 이 값 × (중심 거리 ÷ 반지름 합)"이라
   * 깊이 겹칠수록 약해진다 — 좁은 복도에서 마주친 같은 편을 통과할 수 있다.
   * 플레이어와 적 사이는 겹친 만큼 전부 밀어낸다.
   */
  allySeparation: 0.3,
  /** 소환물이 나타나는 범위(칸). */
  summonRadius: 3,
  /** 돌진이 닿았다고 보는 여유 거리(칸). */
  contactSlop: 0.05,
  /** 보스가 죽으면 그 보스가 소환한 적도 함께 죽는다. */
  bossMinionsDieWithBoss: true,
});
