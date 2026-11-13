// 방 안의 전투: 웨이브 구성, 깊이에 따른 난이도, 정예, 방 보상.
// 깊이(depth) = 시작 방에서 그 방까지 건너는 방의 수.

import { deepFreeze } from './freeze.js';

export const ENCOUNTERS = deepFreeze({
  /** 플레이어가 방 안으로 이만큼(칸) 들어서면 문이 잠기고 전투가 시작된다. */
  enterDepth: 1.6,
  /** 적이 나타나기 전에 바닥에 예고가 보이는 시간(초). */
  spawnWarnSec: 0.9,
  /** 웨이브를 모두 잡은 뒤 다음 웨이브가 나타나기 시작할 때까지(초). */
  waveGapSec: 0.6,
  /** 적은 플레이어에게서 최소 이만큼(칸) 떨어진 자리에 나타난다(자리가 모자라면 가장 먼 자리). */
  spawnMinPlayerDist: 4.5,

  /** 웨이브 수: 깊이가 shallowDepth 이하면 shallow, 넘으면 deep 가운데 하나. */
  waves: { shallowDepth: 1, shallow: [2, 3], deep: [3, 3] },
  /** 웨이브 하나의 예산 = base + perDepth × 깊이(상한 max). 뒤 웨이브일수록 laterWaveBonus 씩 늘어난다. */
  budget: { base: 6, perDepth: 1.5, max: 16, laterWaveBonus: 1 },
  /** 웨이브 하나에 나오는 적 수의 상한. */
  maxPerWave: 7,

  /** 깊이에 따른 적의 체력·공격 배율: base + perDepth × 깊이(상한 max). */
  scaling: { hpBase: 1.7, hpPerDepth: 0.12, hpMax: 2.6, damageBase: 1.15, damagePerDepth: 0.05, damageMax: 1.55 },

  /**
   * 스테이지(층)가 깊어질수록: 적의 체력·공격 배율에 (1 + perStage × (층 − 1)) 을 곱하고, 웨이브 예산에 budgetPerStage × (층 − 1) 을 더한다.
   * 보스는 bossHp·bossDamage 를 쓴다. 다음 층에 들어설 때 최대 체력의 healPct % 를 회복한다.
   */
  stage: { hp: 0.34, damage: 0.22, budgetPerStage: 1.2, budgetMaxPerStage: 1.5, bossHp: 0.34, bossDamage: 0.18, healPct: 30 },

  /** 정예: 크고 단단하고 아프다. 정예방의 웨이브마다 정예가 perWave 마리 끼고, 나머지 예산은 budgetRatio 만큼만 쓴다. */
  elite: { hp: 2.6, damage: 1.3, radius: 1.25, speed: 1.1, perWave: 1, budgetRatio: 0.6, waves: [2, 2] },

  /** 보스: 깊이 배율과 별개로 곱한다. */
  boss: { hp: 4.2, damage: 1.1 },

  /** 전투방 보상의 가중치. 한 층에 축복 방이 minBoon 개, 무기 방이 minWeapon 개 이상 나오도록 맞춘다. */
  rewards: {
    weights: { boon: 3, weapon: 2, gold: 2, health: 2 },
    minBoon: 1,
    minWeapon: 1,
    /** 금화 방·체력 방이 주는 양(체력은 최대 체력의 비율 %). */
    gold: [35, 55],
    healthPct: 30,
    /** 어느 방이든 깨면 주는 금화와 에너지(최대치의 비율 %). */
    clearGold: [8, 14],
    clearEnergyPct: 25,
    /** 정예방: 축복 + 금화. 보스: 축복 + 금화. */
    eliteGold: [25, 35],
    bossGold: [80, 100],
    /** 숨은 방의 상자. */
    bonusGold: [50, 70],
  },

  /** 적을 잡으면 떨어지는 것: 금화(확률·양), 에너지 구슬(확률·양), 체력 구슬(확률·양). 확률 굴림은 결과와 무관하게 같은 횟수만큼 굴린다. */
  kill: {
    gold: { chance: 0.5, amount: [1, 3] },
    energy: { chance: 0.6, amount: 8 },
    health: { chance: 0.04, amount: 6 },
    eliteGold: [8, 12],
  },

  /** 줍기: 금화·에너지·체력은 이 거리(칸) 안에 들어오면 끌려와 주워진다. 무기·축복·상자·상인·포털은 상호작용 거리 안에서 버튼을 누른다. */
  pickupRadius: 1.6,
  interactRadius: 1.5,
});
