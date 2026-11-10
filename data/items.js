// 장비·능력치·드롭·인벤토리 수치.
//
// 능력치(stat)는 전부 정수다. '%' 단위는 퍼센트 포인트(예: power 12 = 피해 +12%).
// 장비 한 벌 = 기본 종류(base)의 고유 옵션(implicit) + 등급에 따른 무작위 옵션(affix) 몇 개.
// 옵션 값의 범위는 "기본 범위 × 등급 배율 × 아이템 레벨 배율"로 정해진다(affixRange 참고).

import { deepFreeze } from './freeze.js';

/** 능력치 목록. cap 은 합계 상한, floor 는 합계 하한. */
export const STATS = deepFreeze({
  maxHp: { name: '최대 체력', unit: '', floor: -90 },
  power: { name: '공격력', unit: '%', floor: -80 },
  /** 받는 피해를 비율로 줄인다(data/combat.js 의 armorK 참고). */
  armor: { name: '방어력', unit: '', floor: 0 },
  speed: { name: '이동 속도', unit: '%', floor: -50, cap: 60 },
  haste: { name: '재사용 대기 감소', unit: '%', floor: 0, cap: 50 },
  critChance: { name: '치명타 확률', unit: '%', floor: 0, cap: 75 },
  critDamage: { name: '치명타 피해', unit: '%', floor: 0 },
  lifesteal: { name: '흡혈', unit: '%', floor: 0, cap: 30 },
  /** 10초당 회복하는 체력. */
  regen: { name: '체력 재생', unit: '/10초', floor: 0 },
  goldFind: { name: '금화 획득', unit: '%', floor: 0 },
  xpGain: { name: '경험치 획득', unit: '%', floor: 0 },
  burnChance: { name: '공격 시 화상', unit: '%', floor: 0, cap: 60 },
  poisonChance: { name: '공격 시 중독', unit: '%', floor: 0, cap: 60 },
  slowChance: { name: '공격 시 둔화', unit: '%', floor: 0, cap: 60 },
});

export const SLOTS = Object.freeze(['weapon', 'armor', 'helm', 'boots', 'accessory']);
export const SLOT_NAMES = Object.freeze({ weapon: '무기', armor: '갑옷', helm: '투구', boots: '신발', accessory: '장신구' });

/** 등급 순서(낮은 것부터). */
export const RARITIES = Object.freeze(['common', 'uncommon', 'rare', 'epic', 'legendary']);

/**
 * 등급별 수치.
 *   affixes  무작위 옵션 개수 [최소, 최대]
 *   valueMul 옵션 값 배율(고유 옵션과 무작위 옵션 모두)
 *   price    기준 구매가(아이템 레벨 1)
 */
export const RARITY = deepFreeze({
  common: { name: '일반', affixes: [0, 1], valueMul: 1.0, price: 20 },
  uncommon: { name: '고급', affixes: [1, 2], valueMul: 1.15, price: 45 },
  rare: { name: '희귀', affixes: [2, 3], valueMul: 1.3, price: 100 },
  epic: { name: '영웅', affixes: [3, 4], valueMul: 1.5, price: 220 },
  legendary: { name: '전설', affixes: [4, 4], valueMul: 1.75, price: 500 },
});

/**
 * 장비 기본 종류. implicit 은 항상 붙는 고유 옵션: { stat, min, max, growth }.
 * growth 는 아이템 레벨 1당 늘어나는 비율(레벨 배율 = 1 + growth × (레벨 - 1)).
 */
export const BASES = deepFreeze({
  blade: { slot: 'weapon', name: '검', implicit: [{ stat: 'power', min: 8, max: 12, growth: 0.11 }] },
  wand: { slot: 'weapon', name: '지팡이', implicit: [{ stat: 'power', min: 5, max: 8, growth: 0.11 }, { stat: 'haste', min: 3, max: 5, growth: 0.02 }] },
  plate: { slot: 'armor', name: '판금 갑옷', implicit: [{ stat: 'maxHp', min: 10, max: 14, growth: 0.05 }, { stat: 'armor', min: 1, max: 2, growth: 0.02 }] },
  robe: { slot: 'armor', name: '로브', implicit: [{ stat: 'maxHp', min: 16, max: 22, growth: 0.05 }] },
  helm: { slot: 'helm', name: '투구', implicit: [{ stat: 'maxHp', min: 6, max: 10, growth: 0.05 }, { stat: 'armor', min: 1, max: 1, growth: 0.02 }] },
  hood: { slot: 'helm', name: '두건', implicit: [{ stat: 'maxHp', min: 4, max: 7, growth: 0.05 }, { stat: 'critChance', min: 2, max: 4, growth: 0.02 }] },
  greaves: { slot: 'boots', name: '각반', implicit: [{ stat: 'speed', min: 3, max: 5, growth: 0.01 }, { stat: 'armor', min: 1, max: 1, growth: 0.02 }] },
  sandals: { slot: 'boots', name: '샌들', implicit: [{ stat: 'speed', min: 5, max: 8, growth: 0.01 }] },
  ring: { slot: 'accessory', name: '반지', implicit: [{ stat: 'critChance', min: 3, max: 5, growth: 0.02 }] },
  amulet: { slot: 'accessory', name: '목걸이', implicit: [{ stat: 'power', min: 4, max: 6, growth: 0.11 }] },
});

/**
 * 무작위 옵션 풀. slots 가 없으면 모든 부위에 붙는다. weight 는 뽑힐 가중치.
 * 한 장비에 같은 능력치의 무작위 옵션이 두 번 붙지 않는다.
 */
export const AFFIXES = deepFreeze([
  { stat: 'power', min: 3, max: 6, growth: 0.11, slots: ['weapon', 'accessory'], weight: 10 },
  { stat: 'maxHp', min: 6, max: 12, growth: 0.05, slots: ['armor', 'helm', 'boots', 'accessory'], weight: 10 },
  { stat: 'armor', min: 1, max: 2, growth: 0.02, slots: ['armor', 'helm', 'boots'], weight: 8 },
  { stat: 'speed', min: 2, max: 4, growth: 0.01, slots: ['boots', 'accessory'], weight: 6 },
  { stat: 'haste', min: 2, max: 4, growth: 0.02, slots: ['weapon', 'helm', 'accessory'], weight: 6 },
  { stat: 'critChance', min: 2, max: 4, growth: 0.02, slots: ['weapon', 'helm', 'accessory'], weight: 8 },
  { stat: 'critDamage', min: 6, max: 12, growth: 0.04, slots: ['weapon', 'accessory'], weight: 6 },
  { stat: 'lifesteal', min: 1, max: 2, growth: 0.02, slots: ['weapon', 'accessory'], weight: 4 },
  { stat: 'regen', min: 1, max: 2, growth: 0.06, slots: ['armor', 'helm', 'accessory'], weight: 5 },
  { stat: 'goldFind', min: 5, max: 10, growth: 0.03, weight: 4 },
  { stat: 'xpGain', min: 3, max: 6, growth: 0.02, slots: ['helm', 'accessory'], weight: 4 },
  { stat: 'burnChance', min: 3, max: 6, growth: 0.02, slots: ['weapon'], weight: 3 },
  { stat: 'poisonChance', min: 3, max: 6, growth: 0.02, slots: ['weapon'], weight: 3 },
  { stat: 'slowChance', min: 3, max: 6, growth: 0.02, slots: ['weapon'], weight: 3 },
]);

/**
 * 세트. pieces 는 부위 → 그 부위의 세트 장비가 쓰는 기본 종류.
 * bonus[2] 는 2개 이상, bonus[4] 는 4개 이상 착용했을 때 붙는다(4개면 둘 다). 같은 세트 효과는 한 번만 적용된다.
 * unlock 이 있으면 그 메타 해금을 산 뒤에만 드롭된다.
 */
export const SETS = deepFreeze({
  ember: {
    name: '불씨',
    pieces: { weapon: 'wand', armor: 'robe', helm: 'hood', boots: 'sandals', accessory: 'amulet' },
    bonus: { 2: { burnChance: 15 }, 4: { power: 30, critDamage: 30 } },
  },
  bulwark: {
    name: '방벽',
    pieces: { weapon: 'blade', armor: 'plate', helm: 'helm', boots: 'greaves', accessory: 'ring' },
    bonus: { 2: { armor: 3 }, 4: { maxHp: 80, regen: 6 } },
  },
  windrunner: {
    name: '질풍',
    unlock: 'set_windrunner',
    pieces: { weapon: 'blade', armor: 'robe', helm: 'hood', boots: 'sandals', accessory: 'ring' },
    bonus: { 2: { speed: 10 }, 4: { haste: 15, critChance: 15 } },
  },
});

/** 드롭 규칙. 확률은 0~1. */
export const DROPS = deepFreeze({
  /** 등급 가중치 = base + perFloor × (층 - 1), 0 미만이면 0. 순서는 RARITIES 와 같다. */
  rarityWeights: { base: [620, 260, 95, 22, 3], perFloor: [-16, 2, 7, 5, 2] },
  /** 희귀 이상 장비가 세트 장비일 확률. */
  setChance: 0.25,
  /** 일반 적: 각각 따로 굴린다. 금화는 [최소, 최대] × (1 + goldPerFloor × (층 - 1)). */
  enemy: { equipment: 0.07, consumable: 0.06, goldChance: 0.6, gold: [1, 4] },
  /** 보스: 장비 개수(등급 하한 있음), 유물 확률. */
  boss: { equipment: 2, minRarity: 'rare', relic: 0.4, consumable: 2, gold: [40, 60] },
  /** 맵에 놓인 아이템 자리(상자): 셋 중 하나. */
  chest: { equipment: 0.64, consumable: 0.33, relic: 0.03 },
  goldPerFloor: 0.06,
  /** 소환·분열로 생긴 적은 아무것도 주지 않는다(무한 수급 방지). */
});

/** 가격. 구매가 = 등급 기준가 × (1 + perLevel × (레벨 - 1)), 판매가 = 구매가 × sellRatio (최소 1). */
export const PRICES = deepFreeze({ perLevel: 0.08, sellRatio: 0.2 });

/**
 * 장비 점수 가중치. 능력치 1당 점수이고, 비교값(어느 장비가 더 나은가)과 자동 정리에 쓴다.
 * 전투 공식이 아니라 "대략 얼마나 값진가"의 어림이다.
 */
export const SCORE_WEIGHTS = deepFreeze({
  maxHp: 1, power: 3, armor: 10, speed: 1.5, haste: 3, critChance: 3, critDamage: 1, lifesteal: 6, regen: 3,
  goldFind: 0.4, xpGain: 0.8, burnChance: 1.2, poisonChance: 1.2, slowChance: 1,
});

export const INVENTORY = deepFreeze({
  /** 가방 칸 수(장비). 착용 중인 장비는 칸을 차지하지 않는다. */
  capacity: 16,
  /** 소비 아이템 종류별 최대 보유 수. */
  stackMax: 5,
  /** 바닥의 아이템을 줍는 거리(칸). */
  pickupRange: 0.9,
  /** 상인·제단과 거래할 수 있는 거리(칸). */
  interactRange: 2.5,
});
