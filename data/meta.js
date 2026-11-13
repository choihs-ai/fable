// 메타 진행(거점): 런이 끝나면 영혼석을 얻고, 영혼석으로 영구 강화를 사거나 캐릭터를 해금한다.

import { deepFreeze } from './freeze.js';

export const META_VERSION = 3;

/**
 * 저주: 여섯 층을 모두 깨면 한 단계씩 열리는, 스스로 거는 어려움. 거점에서 단계를 고르고 판을 시작한다.
 * 단계마다 적의 체력·공격이 hp·damage 만큼 늘고(곱이 아니라 더해 간다), 그 판에서 얻는 영혼석이 souls 만큼 는다.
 * 고른 단계로 끝까지 깨면 다음 단계가 열린다(max 까지).
 */
export const CURSE = deepFreeze({ max: 5, hp: 0.15, damage: 0.1, souls: 0.3 });

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
 * kind: 'rule' = 싸우는 방식이 달라지는 것, 'stat' = 수치를 더하는 것(거점 화면에서 따로 묶어 보여 준다).
 *   maxHp, maxEnergy, gold(시작 금화)   더한다
 *   power(주는 피해)                    비율로 더한다
 *   dashRecharge                        대시 충전 시간을 이 비율만큼 줄인다
 *   freeRerolls                         축복 후보를 무료로 다시 뽑는 횟수(런마다)
 *   startBoons                          런을 시작할 때 축복 3택1 을 이 횟수만큼 먼저 연다(1 이상이면 한 번)
 *   dashCharges                         대시를 모아 두는 칸 수
 *   reviveHp                            쓰러질 때 런마다 한 번 되살아난다. 되살아날 때 체력은 최대 체력의 이 %
 *   shopDiscount                        상점 값을 이 %만큼 깎는다
 *   roomHeal                            방을 깰 때마다 최대 체력의 이 %를 회복한다
 */
export const UPGRADES = deepFreeze({
  gift: { name: '첫 선물', kind: 'rule', desc: '판을 시작하자마자 축복 3택1', cost: [45], effect: { startBoons: 1 } },
  breath: { name: '여분의 숨', kind: 'rule', desc: '대시를 한 번 더 모아 둔다', cost: [90], effect: { dashCharges: 1 } },
  oath: { name: '불사의 서약', kind: 'rule', desc: '쓰러져도 판마다 한 번 되살아난다(체력 25% → 50%)', cost: [70, 150], effect: { reviveHp: 25 } },
  haggle: { name: '단골', kind: 'rule', desc: '상점 값 -15% → -30%', cost: [30, 70], effect: { shopDiscount: 15 } },
  mend: { name: '응급 처치', kind: 'rule', desc: '방을 깰 때마다 체력 4% → 8% 회복', cost: [35, 90], effect: { roomHeal: 4 } },
  vigor: { name: '단련', kind: 'stat', desc: '최대 체력 +10', cost: [20, 45, 90], effect: { maxHp: 10 } },
  capacitor: { name: '축전', kind: 'stat', desc: '최대 에너지 +25', cost: [15, 35, 70], effect: { maxEnergy: 25 } },
  might: { name: '완력', kind: 'stat', desc: '주는 피해 +6%', cost: [25, 55, 110], effect: { power: 0.06 } },
  purse: { name: '여비', kind: 'stat', desc: '시작 금화 +30', cost: [15, 40], effect: { gold: 30 } },
  agility: { name: '순발력', kind: 'stat', desc: '대시 충전 10% 빠르게', cost: [30, 70], effect: { dashRecharge: 0.1 } },
  insight: { name: '안목', kind: 'stat', desc: '축복 무료 다시 뽑기 +1', cost: [25, 60], effect: { freeRerolls: 1 } },
});

/**
 * 메타 버전 1(방 단위 구조로 바꾸기 전)의 영구 해금과 그 값. 그 해금은 이제 없으므로
 * 마이그레이션(logic/save/migrate.js)이 산 만큼의 영혼석을 돌려준다.
 */
export const LEGACY_UNLOCK_COSTS = deepFreeze({
  vigor_1: 40, vigor_2: 110, vigor_3: 260, might_1: 50, might_2: 130, might_3: 300, purse_1: 30, purse_2: 90,
  provisions: 60, satchel: 120, consumable_fire_bomb: 80, relic_pack: 200, set_windrunner: 240,
});
