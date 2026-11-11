// 상태이상 규칙. 시간은 초, 피해는 정수.
//
// 중첩(stacking):
//   'intensity' — 다시 걸리면 중첩 수가 늘고(최대 maxStacks) 지속시간이 처음 길이로 갱신된다. 피해는 중첩 수에 비례.
//   'refresh'   — 중첩되지 않는다. 다시 걸리면 남은 시간과 새 지속시간 중 긴 쪽으로 갱신된다.
//   'none'      — 걸려 있는 동안에는 다시 걸리지 않는다(무시).
// 지속 피해: interval 초마다 damage × 중첩 수. 갱신돼도 피해 주기는 초기화되지 않는다(계속 갱신해서 피해를 미루는 일이 없도록).
//           지속 피해는 방어력·정면 방어를 무시한다.
// 면역:
//   - 대상의 statusResist[id] 가 0 이면 면역, 0~1 이면 지속시간에 곱한다(immune 목록은 0 과 같다).
//   - immunityAfter: 풀린 뒤 이 시간 동안은 같은 상태이상에 다시 걸리지 않는다(연속 기절·빙결 방지).
//   - 무적 상태(회피 중, 보스 페이즈 전환 중)에서는 어떤 상태이상도 걸리지 않는다.
// 상호작용: removes 에 적힌 상태이상은 이 상태이상이 걸릴 때 풀린다(화상 ↔ 빙결).
// 행동 불가(disables): 이동·행동을 못 하고, 준비 중이던 행동은 취소된다.

import { deepFreeze } from './freeze.js';

/** 상태이상을 처리하는 순서(결정적 순서를 위해 고정). */
export const STATUS_ORDER = Object.freeze(['poison', 'burn', 'bleed', 'slow', 'freeze', 'stun']);

export const STATUSES = deepFreeze({
  poison: { name: '독', stacking: 'intensity', maxStacks: 5, duration: 4, interval: 0.5, damage: 1 },
  burn: { name: '화상', stacking: 'refresh', maxStacks: 1, duration: 3, interval: 0.5, damage: 3, removes: ['freeze', 'slow'] },
  /** 출혈은 움직이는 동안 피해가 movingMultiplier 배가 된다. */
  bleed: { name: '출혈', stacking: 'intensity', maxStacks: 3, duration: 5, interval: 1, damage: 2, movingMultiplier: 2 },
  slow: { name: '둔화', stacking: 'refresh', maxStacks: 1, duration: 2.5, speedMul: 0.5 },
  freeze: { name: '빙결', stacking: 'none', maxStacks: 1, duration: 1.5, disables: true, immunityAfter: 4, removes: ['burn'] },
  stun: { name: '기절', stacking: 'none', maxStacks: 1, duration: 1, disables: true, immunityAfter: 3 },
});
