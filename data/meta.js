// 메타 진행: 런이 끝나면 영혼석을 얻고, 영혼석으로 영구 해금을 산다.

import { deepFreeze } from './freeze.js';

export const META_VERSION = 1;

/** 런이 끝날 때 얻는 영혼석. */
export const SOULS = deepFreeze({
  /** 도달한 층 하나당(1층 포함). */
  perFloor: 8,
  perKill: 1,
  perBossKill: 30,
  /** 최종보스를 잡고 끝냈을 때. */
  victory: 300,
});

/**
 * 영구 해금. requires 는 먼저 사야 하는 해금.
 *   stats      시작 능력치           gold  시작 금화          consumables  시작 소비 아이템
 *   capacity   가방 칸 추가          pool  아이템 풀 확장(SETS·RELICS·CONSUMABLES 의 unlock 과 같은 이름)
 */
export const UNLOCKS = deepFreeze({
  vigor_1: { name: '단련 I', cost: 40, effect: { stats: { maxHp: 10 } } },
  vigor_2: { name: '단련 II', cost: 110, requires: 'vigor_1', effect: { stats: { maxHp: 15 } } },
  vigor_3: { name: '단련 III', cost: 260, requires: 'vigor_2', effect: { stats: { maxHp: 20 } } },
  might_1: { name: '완력 I', cost: 50, effect: { stats: { power: 4 } } },
  might_2: { name: '완력 II', cost: 130, requires: 'might_1', effect: { stats: { power: 6 } } },
  might_3: { name: '완력 III', cost: 300, requires: 'might_2', effect: { stats: { power: 8 } } },
  purse_1: { name: '여비 I', cost: 30, effect: { gold: 40 } },
  purse_2: { name: '여비 II', cost: 90, requires: 'purse_1', effect: { gold: 80 } },
  provisions: { name: '비상 식량', cost: 60, effect: { consumables: { health_potion: 2 } } },
  satchel: { name: '큰 가방', cost: 120, effect: { capacity: 4 } },
  consumable_fire_bomb: { name: '화염병 제조법', cost: 80, effect: { pool: true } },
  relic_pack: { name: '유물 꾸러미', cost: 200, effect: { pool: true } },
  set_windrunner: { name: '질풍 세트 도안', cost: 240, effect: { pool: true } },
});
