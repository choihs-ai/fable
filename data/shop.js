// 상점: 금화로 무기와 축복을 사고, 체력을 회복하고, 진열품을 다시 뽑는다.

import { deepFreeze } from './freeze.js';

export const SHOP = deepFreeze({
  /** 진열하는 무기·축복의 수. */
  weapons: 2,
  boons: 2,
  /** 값: 무기는 등급(tier)별, 축복과 회복은 고정. */
  price: { weapon: [0, 40, 60, 85], boon: 55, heal: 30 },
  /** 회복량(최대 체력의 비율 %). 한 상점에서 여러 번 살 수 있고 살 때마다 healStep 씩 비싸진다. */
  healPct: 35,
  healStep: 15,
  /** 진열품 다시 뽑기: base + step × (이 상점에서 이미 다시 뽑은 횟수). */
  reroll: { base: 20, step: 15 },
  /** 무기를 뽑을 때의 등급별 가중치. */
  tierWeights: [0, 5, 4, 2],
});
