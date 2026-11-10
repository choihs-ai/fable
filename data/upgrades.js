// 레벨과 강화. 레벨이 오르면 강화 셋 가운데 하나를 고른다.
//
// 후보 규칙:
//   - 셋은 서로 다른 강화다.
//   - 중복: 같은 강화를 다시 고르면 단계(rank)가 오른다. maxRank 에 이른 강화는 후보에서 빠진다.
//   - 선행 조건(requires): 다른 강화를 일정 단계 이상 가지고 있어야 후보가 된다.
//   - 배타(excludes): 적힌 강화를 가지고 있으면 후보가 되지 않는다.
//   - 시너지: 가진 강화와 태그가 겹칠수록 뽑힐 가중치가 커진다(겹치는 강화 하나당 +synergyBonus, 최대 synergyCap 배).
//   - 후보가 셋보다 적으면 채움 보상(FILLERS)으로 채운다. 채움 보상은 단계 제한이 없어 후보가 바닥나지 않는다.

import { deepFreeze } from './freeze.js';

export const LEVELING = deepFreeze({
  /** 다음 레벨까지 필요한 경험치 = base + linear × (레벨 - 1) + quad × (레벨 - 1)² */
  xp: { base: 30, linear: 14, quad: 2 },
  /** 적이 주는 경험치 = 그 적의 최대 체력 × xpPerHp (최소 1). 보스는 bossMul 배. */
  xpPerHp: 0.2,
  bossMul: 1.5,
  choices: 3,
  synergyBonus: 0.5,
  synergyCap: 3,
});

/** stats 는 한 단계마다 더해지는 능력치. */
export const UPGRADES = deepFreeze({
  sharpness: { name: '날카로움', maxRank: 5, tags: ['offense'], weight: 10, stats: { power: 10 } },
  vitality: { name: '활력', maxRank: 5, tags: ['defense'], weight: 10, stats: { maxHp: 15 } },
  toughness: { name: '강인함', maxRank: 4, tags: ['defense'], weight: 7, stats: { armor: 1 } },
  swiftness: { name: '신속', maxRank: 3, tags: ['mobility'], weight: 6, stats: { speed: 5 } },
  focus: { name: '집중', maxRank: 4, tags: ['utility'], weight: 6, stats: { haste: 5 } },
  precision: { name: '정밀', maxRank: 5, tags: ['crit'], weight: 8, stats: { critChance: 5 } },
  brutality: { name: '잔혹', maxRank: 3, tags: ['crit', 'offense'], weight: 7, requires: { precision: 1 }, stats: { critDamage: 25 } },
  vampirism: { name: '흡혈', maxRank: 3, tags: ['sustain'], weight: 5, stats: { lifesteal: 2 } },
  regeneration: { name: '재생', maxRank: 3, tags: ['sustain', 'defense'], weight: 5, stats: { regen: 3 } },
  ember_touch: { name: '불씨의 손길', maxRank: 3, tags: ['fire'], weight: 5, stats: { burnChance: 10 } },
  inferno: { name: '업화', maxRank: 2, tags: ['fire', 'offense'], weight: 6, requires: { ember_touch: 2 }, stats: { power: 12, burnChance: 10 } },
  venom: { name: '맹독', maxRank: 3, tags: ['poison'], weight: 5, stats: { poisonChance: 10 } },
  frostbite: { name: '서리', maxRank: 3, tags: ['frost'], weight: 5, stats: { slowChance: 10 } },
  greed: { name: '탐욕', maxRank: 3, tags: ['utility'], weight: 4, stats: { goldFind: 20 } },
  scholar: { name: '학식', maxRank: 3, tags: ['utility'], weight: 4, stats: { xpGain: 10 } },
  glass_cannon: { name: '유리 대포', maxRank: 1, tags: ['offense'], weight: 3, excludes: ['juggernaut'], stats: { power: 30, maxHp: -20 } },
  juggernaut: { name: '거신', maxRank: 1, tags: ['defense'], weight: 3, excludes: ['glass_cannon'], stats: { maxHp: 45, speed: -5 } },
});

/**
 * 채움 보상. 후보가 모자랄 때만 나온다. 순서대로 채운다.
 *   heal   최대 체력의 pct% 회복     gold  금화 base + perLevel × 레벨     stats  능력치(단계 제한 없음)
 */
export const FILLERS = deepFreeze({
  feast: { name: '만찬', effect: { type: 'heal', pct: 30 } },
  windfall: { name: '횡재', effect: { type: 'gold', base: 30, perLevel: 5 } },
  grit: { name: '근성', effect: { type: 'stats', stats: { maxHp: 4 } } },
});
