// 소비 아이템. effect 종류:
//   heal    최대 체력의 pct% 회복
//   cleanse 걸린 상태이상을 모두 푼다
//   buff    seconds 초 동안 stats 를 더한다(같은 물약을 다시 쓰면 시간만 갱신, 중첩 안 됨)
//   blast   자기 둘레 radius 칸에 피해(+상태이상)
// weight 는 드롭·상점에 나올 가중치, minFloor 는 등장하기 시작하는 층, unlock 은 필요한 메타 해금.

import { deepFreeze } from './freeze.js';

export const CONSUMABLES = deepFreeze({
  health_potion: { name: '체력 물약', price: 25, weight: 10, effect: { type: 'heal', pct: 35 } },
  greater_health_potion: { name: '상급 체력 물약', price: 60, weight: 5, minFloor: 8, effect: { type: 'heal', pct: 70 } },
  cleanse_tonic: { name: '정화 약', price: 20, weight: 4, effect: { type: 'cleanse' } },
  power_elixir: { name: '힘의 영약', price: 45, weight: 3, minFloor: 3, effect: { type: 'buff', seconds: 20, stats: { power: 30 } } },
  swift_elixir: { name: '신속의 영약', price: 40, weight: 3, minFloor: 3, effect: { type: 'buff', seconds: 20, stats: { speed: 20, haste: 15 } } },
  fire_bomb: {
    name: '화염병', price: 50, weight: 3, minFloor: 2, unlock: 'consumable_fire_bomb',
    effect: { type: 'blast', radius: 3, damage: 40, status: { id: 'burn' } },
  },
});
