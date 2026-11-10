// 이벤트방: 상점과 제단.

import { deepFreeze } from './freeze.js';

/**
 * 상점. 품목은 (런 시드, 층)으로 정해져 다시 들어와도 같다.
 *   - 장비: equipment 개. 아이템 레벨은 그 층. 등급 가중치는 드롭보다 rarityShift 층만큼 앞선 것을 쓴다.
 *   - 소비 아이템: consumables 종. 그 층에 나올 수 있는 것 가운데 서로 다른 종류.
 *   - 유물: relicFromFloor 층부터 한 개(아직 없는 것 가운데).
 * 가격 = 기준가 × (1 + pricePerFloor × (층 - 1)). 장비는 여기에 아이템 레벨에 따른 가격이 이미 들어 있다.
 */
export const SHOP = deepFreeze({
  equipment: 4,
  consumables: 3,
  relicFromFloor: 3,
  rarityShift: 4,
  pricePerFloor: 0.04,
});

/**
 * 제단. 제안 셋(작음·보통·큼) 가운데 하나를 받거나 그냥 떠난다. 한 제단은 한 번만 쓸 수 있다.
 * 각 제안은 대가 하나와 보상 하나로 이루어지고, 같은 크기끼리 짝지어진다.
 * 대가(cost):
 *   hpPct   현재 체력의 pct% 를 잃는다(이것으로 죽지는 않는다. 체력이 1 이면 받을 수 없다)
 *   maxHp   최대 체력이 영구히 줄어든다
 *   gold    금화. 모자라면 받을 수 없다
 *   curse   영구 저주(능력치 감소)
 * 보상(reward):
 *   stats   영구 능력치        relic  유물 하나(가진 것 제외. 남은 유물이 없으면 금화)
 *   upgrade 강화 3택1 한 번    heal   체력 전부 회복      gold  금화
 */
export const ALTAR = deepFreeze({
  tiers: ['small', 'medium', 'large'],
  costs: {
    small: [
      { type: 'hpPct', pct: 20 },
      { type: 'gold', base: 30, perFloor: 4 },
      { type: 'curse', stats: { speed: -4 } },
    ],
    medium: [
      { type: 'hpPct', pct: 40 },
      { type: 'maxHp', amount: 12 },
      { type: 'gold', base: 70, perFloor: 8 },
      { type: 'curse', stats: { power: -6 } },
    ],
    large: [
      { type: 'hpPct', pct: 60 },
      { type: 'maxHp', amount: 25 },
      { type: 'gold', base: 140, perFloor: 14 },
      { type: 'curse', stats: { armor: -2, speed: -5 } },
    ],
  },
  rewards: {
    small: [
      { type: 'stats', stats: { maxHp: 12 } },
      { type: 'stats', stats: { power: 5 } },
      { type: 'gold', base: 50, perFloor: 6 },
      { type: 'heal' },
    ],
    medium: [
      { type: 'stats', stats: { power: 10 } },
      { type: 'stats', stats: { critChance: 6 } },
      { type: 'stats', stats: { maxHp: 28 } },
      { type: 'upgrade' },
    ],
    large: [
      { type: 'relic' },
      { type: 'stats', stats: { power: 18, critDamage: 20 } },
      { type: 'stats', stats: { maxHp: 50, armor: 1 } },
    ],
  },
});
