// 축복. 방을 깨면 셋 가운데 하나를 고른다. 숫자를 올리기보다 싸우는 규칙을 바꾸는 것이 대부분이다.
//
//   family  'fire' | 'bolt' | 'ice' | null(무계열)
//   duo     [계열, 계열] — 합성 축복. 두 계열의 축복을 하나씩 가지고 있어야 후보에 나온다
//   weight  후보에 뽑힐 가중치
// 나머지 값은 그 축복의 수치이고, 효과는 src/logic/combat/boons.js 가 id 로 찾아 실행한다.
// 한 축복은 한 번만 가질 수 있다. 여섯 층 동안 고를 것이 남도록 넉넉히 둔다(지금 55종).

import { deepFreeze } from './freeze.js';

export const FAMILIES = deepFreeze({
  fire: { name: '불', color: 0xff7a3a },
  bolt: { name: '번개', color: 0xffe14a },
  ice: { name: '얼음', color: 0x7ad7ff },
});

/** 3택1 규칙. */
export const BOON_RULES = deepFreeze({
  choices: 3,
  /** 금화로 후보를 다시 뽑는 값: base + step × (이번 선택에서 이미 다시 뽑은 횟수). */
  reroll: { base: 15, step: 10 },
  /** 합성 축복이 후보가 될 수 있을 때 가중치에 곱한다(잘 나오도록). */
  duoWeightMul: 2,
  /** 고를 축복이 하나도 남지 않았을 때 대신 주는 금화. */
  emptyGold: 40,
});

export const BOONS = deepFreeze({
  // ── 불 ──
  ember_trail: {
    name: '불길 대시', family: 'fire', weight: 3, desc: '대시로 지나간 자리에 불길이 남는다.',
    every: 0.05, hazard: { radius: 0.9, damage: 5, delay: 0.15, duration: 2.4, interval: 0.4, status: { id: 'burn' } },
  },
  ignite: { name: '점화탄', family: 'fire', weight: 3, desc: '공격이 맞으면 화상을 건다.', chance: 0.4 },
  blast_kill: { name: '연쇄 폭발', family: 'fire', weight: 3, desc: '적을 처치하면 그 자리에서 폭발한다.', radius: 2.1, damage: 16, knockback: 8 },
  wildfire: { name: '번지는 불', family: 'fire', weight: 2, desc: '화상에 걸린 적이 죽으면 주변 적에게 화상이 번진다.', radius: 3.2 },
  scorch: { name: '그을음', family: 'fire', weight: 3, desc: '화상에 걸린 적에게 주는 피해가 는다.', bonus: 0.3 },
  fire_nova: { name: '불꽃 대시', family: 'fire', weight: 2, desc: '대시가 끝나는 자리에서 불이 터져 주변 적이 불탄다.', radius: 2.2, damage: 10 },
  cauterize: { name: '지짐', family: 'fire', weight: 2, desc: '화상에 걸린 적을 처치하면 체력을 되찾는다.', heal: 3 },
  ember_shot: { name: '불씨 폭발', family: 'fire', weight: 2, desc: '치명타가 작은 폭발을 일으킨다.', radius: 1.7, damage: 12, knockback: 4 },

  // ── 번개 ──
  chain: { name: '번개 연쇄', family: 'bolt', weight: 3, desc: '공격이 맞으면 가까운 적 둘에게 번개가 튄다.', targets: 2, range: 4.2, ratio: 0.5 },
  static_dash: { name: '정전기 대시', family: 'bolt', weight: 3, desc: '대시로 적을 통과하면 피해를 주고 기절시킨다.', damage: 12, stun: 0.6 },
  overcharge: { name: '과충전', family: 'bolt', weight: 2, desc: '여덟 번째 공격마다 맞은 적에게 벼락이 떨어진다.', every: 8, radius: 1.6, damage: 26 },
  conduct: { name: '전도', family: 'bolt', weight: 2, desc: '치명타 확률이 오르고, 치명타가 적을 기절시킨다.', critChance: 0.12, stun: 0.5 },
  storm_kill: { name: '뇌운', family: 'bolt', weight: 3, desc: '적을 처치하면 가까운 적 하나에게 벼락이 떨어진다.', range: 6, damage: 22 },
  volt_armor: { name: '반격 전류', family: 'bolt', weight: 2, desc: '맞으면 주변 적이 감전돼 다치고 잠깐 기절한다.', radius: 2.6, damage: 14, stun: 0.5 },
  keen_current: { name: '날 선 전류', family: 'bolt', weight: 2, desc: '치명타 피해가 크게 는다.', critDamage: 0.6 },
  quick_charge: { name: '급속 충전', family: 'bolt', weight: 2, desc: '최대 에너지가 늘고, 적을 처치하면 에너지를 얻는다.', maxEnergy: 40, energy: 4 },

  // ── 얼음 ──
  frost_shot: { name: '서리탄', family: 'ice', weight: 3, desc: '공격이 맞으면 적이 느려진다.', chance: 0.6 },
  frost_nova: { name: '빙결 대시', family: 'ice', weight: 3, desc: '대시가 끝나는 자리에서 주변 적이 얼어붙는다.', radius: 2.3, freeze: 1.2 },
  shatter: { name: '깨뜨리기', family: 'ice', weight: 2, desc: '느려지거나 얼어붙은 적에게 주는 피해가 크게 는다.', bonus: 0.45 },
  ice_armor: { name: '얼음 갑옷', family: 'ice', weight: 2, desc: '맞으면 주변 적이 얼어붙는다(6초마다).', radius: 2.6, freeze: 1.0, cooldown: 6 },
  deep_freeze: { name: '깊은 냉기', family: 'ice', weight: 3, desc: '느려진 적을 다시 맞히면 가끔 얼어붙는다.', chance: 0.22, freeze: 0.9 },
  ice_kill: { name: '산산조각', family: 'ice', weight: 2, desc: '느려지거나 얼어붙은 적을 처치하면 얼음 파편이 터져 주변을 느리게 한다.', radius: 2.2, damage: 12, slow: 2 },
  permafrost: { name: '영구 동토', family: 'ice', weight: 2, desc: '네가 건 느려짐과 빙결이 훨씬 오래 간다.', durationMul: 1.6 },
  brittle: { name: '얼음 균열', family: 'ice', weight: 2, desc: '얼어붙은 적을 맞히면 얼음이 깨지며 추가 피해를 준다.', damage: 14 },

  // ── 무계열 ──
  pierce: { name: '관통탄', family: null, weight: 3, desc: '탄이 적 둘을 더 꿰뚫는다.', extra: 2 },
  split: { name: '분열탄', family: null, weight: 3, desc: '탄이 맞으면 두 갈래로 갈라진다.', ratio: 0.5, range: 5 },
  ricochet: { name: '도탄', family: null, weight: 2, desc: '탄이 벽에 한 번 튕긴다.', bounces: 1 },
  desperado: { name: '궁지', family: null, weight: 3, desc: '체력이 낮을수록 주는 피해가 는다(최대 +80%).', max: 0.8 },
  afterimage: { name: '잔상', family: null, weight: 3, desc: '대시 직후의 첫 공격은 반드시 치명타다.', windowSec: 1.0 },
  vampire: { name: '흡혈', family: null, weight: 2, desc: '적을 처치하면 체력을 회복한다.', heal: 2 },
  third_dash: { name: '세 번째 숨', family: null, weight: 2, desc: '대시 충전이 하나 는다.', charges: 1 },
  momentum: { name: '가속', family: null, weight: 2, desc: '대시가 훨씬 빨리 충전된다.', rechargeMul: 0.6 },
  deflect: { name: '탄 가르기', family: null, weight: 2, desc: '대시로 지나친 적의 탄을 지우고 에너지를 얻는다.', energy: 3 },
  battery: { name: '전지', family: null, weight: 2, desc: '근접 공격이 맞으면 에너지를 얻는다.', energy: 2 },
  giant_slayer: { name: '거인 사냥꾼', family: null, weight: 2, desc: '정예와 보스에게 주는 피해가 는다.', bonus: 0.35 },
  second_wind: { name: '두 번째 바람', family: null, weight: 1, desc: '쓰러질 때 한 번 되살아난다.', hpPct: 40, invuln: 2 },
  glass_cannon: { name: '유리 대포', family: null, weight: 1, desc: '주는 피해가 크게 늘지만 최대 체력이 준다.', power: 0.4, hpMul: 0.75 },
  executioner: { name: '처형', family: null, weight: 3, desc: '체력이 얼마 남지 않은 적에게 주는 피해가 크게 는다.', below: 0.25, bonus: 0.6 },
  first_strike: { name: '선제', family: null, weight: 2, desc: '아직 다치지 않은 적에게 주는 피해가 는다.', bonus: 0.5 },
  duelist: { name: '결투', family: null, weight: 2, desc: '적이 하나만 남으면 주는 피해가 는다.', bonus: 0.4 },
  fury: { name: '광기', family: null, weight: 3, desc: '적을 처치하면 잠깐 주는 피해가 는다.', bonus: 0.25, duration: 3 },
  thorns: { name: '가시 갑옷', family: null, weight: 2, desc: '맞으면 주변 적을 다치게 하고 밀쳐 낸다.', radius: 2.4, damage: 18, knockback: 10 },
  reaper: { name: '수확', family: null, weight: 2, desc: '적을 처치하면 대시 충전을 하나 되찾는다.', charges: 1 },
  greed: { name: '탐욕', family: null, weight: 2, desc: '적을 처치할 때마다 금화를 얻는다.', gold: 2 },
  mender: { name: '상처 싸매기', family: null, weight: 2, desc: '방을 깰 때마다 체력을 되찾는다.', heal: 7 },
  keen_eye: { name: '예리함', family: null, weight: 3, desc: '치명타 확률이 오른다.', critChance: 0.1 },
  iron_skin: { name: '무쇠 살갗', family: null, weight: 3, desc: '최대 체력이 는다.', maxHp: 25 },
  fleet: { name: '날랜 발', family: null, weight: 2, desc: '더 빨리 움직인다.', speedMul: 1.12 },
  ghost_step: { name: '유령 걸음', family: null, weight: 2, desc: '대시의 무적 시간이 길어진다.', invuln: 0.2 },

  // ── 합성 ──
  steam: {
    name: '증기 폭발', family: null, duo: ['fire', 'ice'], weight: 2, desc: '화상과 냉기가 한 적에게 겹치면 폭발한다.',
    radius: 2.3, damage: 22, knockback: 9, cooldown: 0.5,
  },
  plasma: { name: '플라스마', family: null, duo: ['fire', 'bolt'], weight: 2, desc: '번개가 화상을 걸고, 둘 더 멀리 튄다.', targets: 2 },
  thunderfire: { name: '벼락불', family: null, duo: ['fire', 'bolt'], weight: 2, desc: '화상에 걸린 적이 번개를 맞으면 폭발한다.', radius: 1.9, damage: 14, knockback: 5 },
  static_frost: { name: '얼음 전류', family: null, duo: ['ice', 'bolt'], weight: 2, desc: '느려지거나 얼어붙은 적을 처치하면 번개가 셋에게 튄다.', targets: 3, range: 5, damage: 16 },
  backdraft: { name: '역류', family: null, duo: ['fire', 'ice'], weight: 2, desc: '불이나 얼음에 걸린 채 죽은 적마다 에너지와 체력을 조금 되찾는다.', energy: 5, heal: 1 },
  superconduct: { name: '초전도', family: null, duo: ['ice', 'bolt'], weight: 2, desc: '느려지거나 얼어붙은 적은 번개에 두 배로 다치고 기절한다.', mul: 2, stun: 0.5 },
});
