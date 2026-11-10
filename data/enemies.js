// 적 데이터. 구역 데이터(zones.js)의 적 id 는 모두 여기에 있어야 한다.
//
// ai 는 행동 방식(src/logic/combat/ai/behaviors.js). 방식마다 움직임과 판단이 다르다:
//   melee       쫓아가서 때린다
//   ranged      거리를 두고 쏜다. 가까우면 물러나고 옆으로 움직인다
//   charger     직선 길이 트이면 예고 후 돌진. 벽에 부딪히면 스스로 기절
//   summoner    멀리서 하수인을 부르고, 다가오면 달아난다
//   skirmisher  치고 빠진다. 체력이 낮아지면 한 번 크게 달아난다(도주)
//   exploder    달려들어 자폭한다
//   tank        천천히 다가온다. 정면 공격을 막고, 몸을 느리게 돌린다
//   teleporter  순간이동으로 자리를 바꿔 가며 쏜다
//   ambusher    아주 가까이 올 때까지 가만히 있다가 덮친다. 물고 나서 물러났다가 다시 덮친다
//   swooper     주위를 돌다가 꿰뚫고 지나간다. 돌 자리가 없어 붙어 버리면 근접 공격을 한다
//
// 공통 항목(생략하면 data/combat.js 의 기본값): aggroRadius, leashRadius, loseSight
// immune: 걸리지 않는 상태이상.  statusResist: 지속시간 배율(0 이면 면역).
// block: 정면(cosHalf 이내)에서 온 피해를 factor 만큼 줄인다.  onDeath: 죽을 때 일어나는 일(effects 형식).
// 기술 형식은 data/player.js 설명 참고.

import { deepFreeze } from './freeze.js';

const strike = (damage, extra = {}) => ({
  windup: 0.4, recovery: 0.3, cooldown: 1.2, range: 1.2,
  effects: [{ type: 'arc', range: 1.6, cosHalf: 0.5, damage, ...extra }],
});

export const ENEMIES = deepFreeze({
  // ── 지하 묘지 ──
  skeleton: {
    name: '해골 병사', ai: 'melee', hp: 36, speed: 2.8, radius: 0.35, immune: ['poison', 'bleed'],
    aiParams: { attack: 'strike' },
    abilities: { strike: strike(8) },
  },
  bat: {
    name: '박쥐', ai: 'swooper', hp: 18, speed: 4.2, radius: 0.25,
    aiParams: { dive: 'dive', melee: 'nip', orbit: 2.6 },
    abilities: {
      // 근접 기술의 사거리는 강습의 minRange 이상이어야 한다(그 사이 거리에서 아무것도 못 하는 구간이 없도록).
      nip: { windup: 0.25, recovery: 0.2, cooldown: 1.2, range: 1.25, effects: [{ type: 'arc', range: 1.5, cosHalf: 0.5, damage: 3 }] },
      dive: {
        windup: 0.25, recovery: 0.2, cooldown: 2.2, range: 3.8, minRange: 1.2, needsClearPath: true,
        effects: [{ type: 'dash', speed: 10, distance: 4.5, damage: 6 }],
      },
    },
  },
  zombie: {
    name: '좀비', ai: 'melee', hp: 60, speed: 1.7, radius: 0.38,
    aiParams: { attack: 'strike' },
    abilities: { strike: { ...strike(12, { status: { id: 'slow' } }), windup: 0.6, recovery: 0.4, cooldown: 1.6 } },
  },

  // ── 지하 수로 ──
  rat: {
    name: '시궁쥐', ai: 'skirmisher', hp: 20, speed: 4.4, radius: 0.25,
    aiParams: { attack: 'bite', retreatSec: 1.0, retreatDist: 4, fleeHp: 0.35, fleeSec: 3 },
    abilities: {
      bite: {
        windup: 0.2, recovery: 0.15, cooldown: 0.9, range: 1.0,
        effects: [{ type: 'arc', range: 1.4, cosHalf: 0.5, damage: 5, status: { id: 'bleed', chance: 0.3 } }],
      },
    },
  },
  slime: {
    name: '슬라임', ai: 'melee', hp: 40, speed: 2.0, radius: 0.4,
    aiParams: { attack: 'strike' },
    abilities: { strike: strike(6, { status: { id: 'poison' } }) },
    onDeath: [{ type: 'summon', enemy: 'slimelet', count: 2 }],
  },
  slimelet: {
    name: '작은 슬라임', ai: 'melee', hp: 12, speed: 2.8, radius: 0.25,
    aiParams: { attack: 'strike' },
    abilities: { strike: { ...strike(3, { status: { id: 'poison' } }), range: 1.0, cooldown: 1.0 } },
  },
  leech: {
    name: '거머리', ai: 'melee', hp: 28, speed: 3.0, radius: 0.28,
    aiParams: { attack: 'drain' },
    abilities: {
      drain: {
        windup: 0.3, recovery: 0.2, cooldown: 1.0, range: 1.0,
        effects: [{ type: 'arc', range: 1.4, cosHalf: 0.5, damage: 5, lifesteal: 1, status: { id: 'bleed' } }],
      },
    },
  },

  // ── 버섯 동굴 ──
  sporeling: {
    name: '포자 덩이', ai: 'exploder', hp: 16, speed: 3.6, radius: 0.3,
    aiParams: { attack: 'explode' },
    abilities: {
      explode: {
        windup: 0.6, cooldown: 0, range: 1.3, needsLos: false,
        effects: [{ type: 'circle', radius: 2.2, damage: 18, status: { id: 'poison', stacks: 2 } }, { type: 'die' }],
      },
    },
  },
  cave_spider: {
    name: '동굴 거미', ai: 'ambusher', hp: 30, speed: 3.2, radius: 0.3, aggroRadius: 4,
    aiParams: { leap: 'leap', bite: 'bite' },
    abilities: {
      leap: {
        windup: 0.3, recovery: 0.2, cooldown: 3.5, range: 4.5, minRange: 1.8, needsClearPath: true,
        effects: [{ type: 'dash', speed: 11, distance: 5, damage: 9, status: { id: 'poison' } }],
      },
      bite: {
        windup: 0.25, recovery: 0.2, cooldown: 1.0, range: 1.0,
        effects: [{ type: 'arc', range: 1.4, cosHalf: 0.5, damage: 5, status: { id: 'poison' } }],
      },
    },
  },
  fungal_brute: {
    name: '균사 거인', ai: 'charger', hp: 80, speed: 2.2, radius: 0.45, mass: 3,
    aiParams: { charge: 'charge', melee: 'smash' },
    abilities: {
      charge: {
        windup: 0.7, recovery: 0.5, cooldown: 5, range: 7, minRange: 2.5, needsClearPath: true,
        effects: [{ type: 'dash', speed: 10, distance: 8, damage: 16, stopOnWall: true, stunOnWall: 1.5 }],
      },
      smash: { ...strike(10), windup: 0.5, cooldown: 1.5, range: 1.3 },
    },
  },

  // ── 버려진 광산 ──
  kobold: {
    name: '코볼트 투석병', ai: 'ranged', hp: 26, speed: 3.2, radius: 0.3,
    aiParams: { attack: 'sling', min: 3, max: 6 },
    abilities: {
      sling: {
        windup: 0.4, recovery: 0.2, cooldown: 1.6, range: 7,
        effects: [{ type: 'projectile', speed: 9, radius: 0.15, range: 9, damage: 7 }],
      },
    },
  },
  miner_ghoul: {
    name: '광부 구울', ai: 'melee', hp: 55, speed: 3.0, radius: 0.35,
    aiParams: { attack: 'strike' },
    abilities: { strike: { ...strike(9, { status: { id: 'bleed' } }), cooldown: 1.1 } },
  },
  stone_golem: {
    name: '돌 골렘', ai: 'tank', hp: 130, speed: 1.6, radius: 0.48, mass: 4, armor: 3,
    immune: ['poison', 'bleed'], statusResist: { stun: 0.5 },
    block: { cosHalf: 0.3, factor: 0.7 },
    aiParams: { bash: 'bash', slam: 'slam', turnRate: 0.08 },
    abilities: {
      bash: { ...strike(12), windup: 0.5, cooldown: 1.8, range: 1.3 },
      slam: {
        windup: 0.9, recovery: 0.5, cooldown: 6, range: 1.8, needsLos: false,
        effects: [{ type: 'circle', radius: 2.4, damage: 14, status: { id: 'stun', duration: 1.0 } }],
      },
    },
  },

  // ── 용암 굴 ──
  fire_imp: {
    name: '불꽃 임프', ai: 'ranged', hp: 24, speed: 3.6, radius: 0.28, immune: ['burn'],
    aiParams: { attack: 'firebolt', min: 3.5, max: 6.5 },
    abilities: {
      firebolt: {
        windup: 0.45, recovery: 0.2, cooldown: 1.8, range: 7.5,
        effects: [{ type: 'projectile', speed: 10, radius: 0.18, range: 10, damage: 8, status: { id: 'burn' } }],
      },
    },
  },
  magma_hound: {
    name: '용암 사냥개', ai: 'charger', hp: 60, speed: 3.4, radius: 0.38, mass: 2, immune: ['burn'],
    aiParams: { charge: 'charge', melee: 'bite' },
    abilities: {
      charge: {
        windup: 0.5, recovery: 0.4, cooldown: 4, range: 6.5, minRange: 2.5, needsClearPath: true,
        effects: [{ type: 'dash', speed: 12, distance: 7, damage: 14, status: { id: 'burn' }, stopOnWall: true, stunOnWall: 1.0 }],
      },
      bite: { ...strike(8, { status: { id: 'burn', chance: 0.4 } }), windup: 0.3, cooldown: 1.1 },
    },
  },
  ash_wraith: {
    name: '잿빛 망령', ai: 'teleporter', hp: 34, speed: 2.6, radius: 0.3, immune: ['burn', 'bleed', 'poison'],
    aiParams: { blink: 'blink', attack: 'ember', near: 2.5, blinkEvery: 5 },
    abilities: {
      blink: { windup: 0.3, recovery: 0.2, cooldown: 4, needsLos: false, effects: [{ type: 'teleport', min: 4, max: 6.5 }] },
      ember: {
        windup: 0.45, recovery: 0.2, cooldown: 1.8, range: 8,
        effects: [{ type: 'projectile', speed: 9, radius: 0.18, range: 10, damage: 9, status: { id: 'burn' } }],
      },
    },
  },

  // ── 심연의 성채 ──
  dark_knight: {
    name: '암흑 기사', ai: 'tank', hp: 110, speed: 2.2, radius: 0.42, mass: 3, armor: 2,
    statusResist: { stun: 0.6 },
    block: { cosHalf: 0.4, factor: 0.6 },
    aiParams: { bash: 'bash', slam: 'slam', turnRate: 0.12 },
    abilities: {
      bash: { ...strike(14, { status: { id: 'stun', duration: 0.5, chance: 0.35 } }), windup: 0.45, cooldown: 1.6, range: 1.4 },
      slam: {
        windup: 0.8, recovery: 0.5, cooldown: 7, range: 1.8, needsLos: false,
        effects: [{ type: 'circle', radius: 2.2, damage: 16, status: { id: 'bleed', stacks: 2 } }],
      },
    },
  },
  cultist: {
    name: '광신도', ai: 'summoner', hp: 38, speed: 2.8, radius: 0.3,
    aiParams: { summon: 'raise', attack: 'bolt', keep: 6, flee: 3.5 },
    abilities: {
      raise: { windup: 0.8, recovery: 0.3, cooldown: 7, needsLos: false, effects: [{ type: 'summon', enemy: 'skeleton', count: 2, max: 3 }] },
      bolt: {
        windup: 0.5, recovery: 0.2, cooldown: 2.2, range: 8,
        effects: [{ type: 'projectile', speed: 9, radius: 0.18, range: 10, damage: 7 }],
      },
    },
  },
  gargoyle: {
    name: '가고일', ai: 'swooper', hp: 70, speed: 3.4, radius: 0.4, mass: 2, armor: 2, immune: ['bleed', 'poison'],
    aiParams: { dive: 'dive', melee: 'claw', orbit: 3.0 },
    abilities: {
      claw: { windup: 0.4, recovery: 0.3, cooldown: 1.5, range: 1.55, effects: [{ type: 'arc', range: 1.9, cosHalf: 0.5, damage: 8 }] },
      dive: {
        windup: 0.4, recovery: 0.3, cooldown: 3, range: 4.5, minRange: 1.5, needsClearPath: true,
        effects: [{ type: 'dash', speed: 11, distance: 6, damage: 13 }],
      },
    },
  },
  shade: {
    name: '그림자', ai: 'teleporter', hp: 40, speed: 3.0, radius: 0.3, immune: ['bleed', 'poison'],
    aiParams: { blink: 'blink', attack: 'chill', near: 2.5, blinkEvery: 4 },
    abilities: {
      blink: { windup: 0.25, recovery: 0.15, cooldown: 3.5, needsLos: false, effects: [{ type: 'teleport', min: 3.5, max: 6 }] },
      chill: {
        windup: 0.4, recovery: 0.2, cooldown: 1.6, range: 8,
        effects: [{ type: 'projectile', speed: 10, radius: 0.18, range: 10, damage: 8, status: { id: 'slow' } }],
      },
    },
  },
});
