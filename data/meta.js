// 메타 진행(거점): 런이 끝나면 영혼석을 얻고, 영혼석으로 영구 강화를 사거나 캐릭터를 해금한다.

import { deepFreeze } from './freeze.js';

export const META_VERSION = 2;

/** 런이 끝날 때 얻는 영혼석. */
export const SOULS = deepFreeze({
  perRoom: 3,
  perElite: 4,
  perBoss: 25,
  /** 출구 포털까지 가서 끝냈을 때. */
  victory: 30,
});

/**
 * 영구 강화. cost[n] 은 n 단계에서 n+1 단계로 올리는 값이고, 효과는 단계 수만큼 곱해진다.
 *   maxHp, maxEnergy, gold(시작 금화)   더한다
 *   power(주는 피해)                    비율로 더한다
 *   dashRecharge                        대시 충전 시간을 이 비율만큼 줄인다
 *   freeRerolls                         축복 후보를 무료로 다시 뽑는 횟수(런마다)
 */
export const UPGRADES = deepFreeze({
  vigor: { name: '단련', desc: '최대 체력 +10', cost: [20, 45, 90], effect: { maxHp: 10 } },
  capacitor: { name: '축전', desc: '최대 에너지 +25', cost: [15, 35, 70], effect: { maxEnergy: 25 } },
  might: { name: '완력', desc: '주는 피해 +6%', cost: [25, 55, 110], effect: { power: 0.06 } },
  purse: { name: '여비', desc: '시작 금화 +30', cost: [15, 40], effect: { gold: 30 } },
  agility: { name: '순발력', desc: '대시 충전 10% 빠르게', cost: [30, 70], effect: { dashRecharge: 0.1 } },
  insight: { name: '안목', desc: '축복 무료 다시 뽑기 +1', cost: [25, 60], effect: { freeRerolls: 1 } },
});

/**
 * 메타 버전 1(방 단위 구조로 바꾸기 전)의 영구 해금과 그 값. 그 해금은 이제 없으므로
 * 마이그레이션(logic/save/migrate.js)이 산 만큼의 영혼석을 돌려준다.
 */
export const LEGACY_UNLOCK_COSTS = deepFreeze({
  vigor_1: 40, vigor_2: 110, vigor_3: 260, might_1: 50, might_2: 130, might_3: 300, purse_1: 30, purse_2: 90,
  provisions: 60, satchel: 120, consumable_fire_bomb: 80, relic_pack: 200, set_windrunner: 240,
});
