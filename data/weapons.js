// 무기. 원거리(ranged)는 쏠 때마다 에너지를 쓰고, 근접(melee)은 에너지를 쓰지 않는다.
//
//   attack  기본 공격(기술 형식은 data/player.js 머리말)
//   dash    대시 공격 — 대시 직후에 나가는 강한 공격. 생략하면 attack 을 DASH_ATTACK 배율로 키운 것을 쓴다
//   energy  한 번 쏠 때 드는 에너지
//   tier    1 은 흔하고 3 은 드물다(상점 가격과 등장 가중치)
//   look    렌더가 그릴 모양
// 방향 회전값은 [cos, sin] 으로 미리 계산해 둔다(로직에서 삼각함수를 쓰지 않는다).

import { deepFreeze } from './freeze.js';

const R0 = [1, 0];
const R8 = [0.9903, 0.1392];
const R8N = [0.9903, -0.1392];
const R16 = [0.9613, 0.2756];
const R16N = [0.9613, -0.2756];
const R6 = [0.9945, 0.1045];
const R6N = [0.9945, -0.1045];

/** 쏠 때마다 흩어지는 방향(jitter): 이 가운데 하나를 난수로 고르고, jitter 값이 클수록 바깥쪽까지 쓴다. */
export const JITTER = deepFreeze([[1, 0], [0.9986, 0.0523], [0.9986, -0.0523], [0.9945, 0.1045], [0.9945, -0.1045], [0.9877, 0.1564], [0.9877, -0.1564]]);

/** 대시 공격을 따로 정하지 않은 무기에 쓰는 배율. */
export const DASH_ATTACK = deepFreeze({ damage: 1.7, knockback: 1.6, knockbackAdd: 3, arcRange: 0.6, pierce: 2, radius: 1.3 });

export const WEAPON_ORDER = Object.freeze([
  'sword', 'dagger', 'spear', 'greatsword', 'dual_blades', 'hammer',
  'pistol', 'staff', 'bow', 'smg', 'shotgun', 'sniper', 'laser', 'rocket',
]);

export const WEAPONS = deepFreeze({
  // ── 근접 ──
  sword: {
    name: '장검', kind: 'melee', energy: 0, tier: 1, look: 'sword', desc: '넓게 벤다.',
    attack: { cooldown: 0.36, effects: [{ type: 'arc', range: 1.9, cosHalf: 0.2, damage: 14, knockback: 7 }] },
  },
  dagger: {
    name: '단검', kind: 'melee', energy: 0, tier: 1, look: 'dagger', desc: '빠르게 찌른다.',
    attack: { cooldown: 0.2, effects: [{ type: 'arc', range: 1.5, cosHalf: 0.5, damage: 8, knockback: 3 }] },
  },
  spear: {
    name: '창', kind: 'melee', energy: 0, tier: 2, look: 'spear', desc: '길고 좁게 찌른다. 대시 공격은 꿰뚫는 돌진.',
    attack: { cooldown: 0.42, effects: [{ type: 'arc', range: 2.9, cosHalf: 0.92, damage: 17, knockback: 6 }] },
    dash: { cooldown: 0.42, effects: [{ type: 'dash', speed: 20, distance: 3.2, damage: 28, knockback: 12 }] },
  },
  greatsword: {
    name: '대검', kind: 'melee', energy: 0, tier: 2, look: 'greatsword', desc: '느리지만 반원을 쓸어 버리고 적의 탄을 지운다.',
    attack: {
      windup: 0.2, recovery: 0.18, cooldown: 0.9,
      effects: [{ type: 'arc', range: 2.5, cosHalf: 0, damage: 40, knockback: 16, clearsBullets: true }],
    },
  },
  dual_blades: {
    name: '쌍검', kind: 'melee', energy: 0, tier: 2, look: 'dual', desc: '아주 빠르다. 대시 공격은 회전 베기.',
    attack: { cooldown: 0.15, effects: [{ type: 'arc', range: 1.6, cosHalf: 0.3, damage: 7, knockback: 2 }] },
    dash: { cooldown: 0.3, effects: [{ type: 'circle', radius: 2.1, damage: 18, knockback: 9 }] },
  },
  hammer: {
    name: '전투망치', kind: 'melee', energy: 0, tier: 3, look: 'hammer', desc: '둘레를 내려찍어 기절시킨다.',
    attack: {
      windup: 0.28, recovery: 0.22, cooldown: 1.0,
      effects: [{ type: 'circle', radius: 2.3, damage: 36, knockback: 14, status: { id: 'stun', duration: 0.6 } }],
    },
  },

  // ── 원거리 ──
  pistol: {
    name: '권총', kind: 'ranged', energy: 2, tier: 1, look: 'pistol', desc: '믿을 만한 기본 총.',
    attack: { cooldown: 0.3, effects: [{ type: 'projectile', speed: 18, radius: 0.14, range: 11, damage: 9, knockback: 5 }] },
  },
  staff: {
    name: '지팡이', kind: 'ranged', energy: 2, tier: 1, look: 'staff', desc: '터지는 마력 구슬.',
    attack: {
      cooldown: 0.42,
      effects: [{ type: 'projectile', speed: 12, radius: 0.24, range: 10, damage: 11, knockback: 4, explode: { radius: 1.3, damage: 9 } }],
    },
  },
  bow: {
    name: '활', kind: 'ranged', energy: 3, tier: 1, look: 'bow', desc: '한 명을 꿰뚫는 화살.',
    attack: { cooldown: 0.55, effects: [{ type: 'projectile', speed: 22, radius: 0.14, range: 13, damage: 20, pierce: 1, knockback: 6 }] },
  },
  smg: {
    name: '기관총', kind: 'ranged', energy: 1, tier: 2, look: 'smg', desc: '쏟아붓는다. 조금 흩어진다.',
    attack: { cooldown: 0.09, effects: [{ type: 'projectile', speed: 19, radius: 0.11, range: 9, damage: 4, jitter: 0.7, knockback: 2 }] },
  },
  shotgun: {
    name: '샷건', kind: 'ranged', energy: 7, tier: 2, look: 'shotgun', desc: '가까울수록 강하다.',
    attack: {
      cooldown: 0.8,
      effects: [{ type: 'projectile', speed: 17, radius: 0.12, range: 5.5, damage: 7, knockback: 6, spread: [R0, R8, R8N, R16, R16N] }],
    },
  },
  sniper: {
    name: '저격총', kind: 'ranged', energy: 12, tier: 3, look: 'sniper', desc: '느리지만 줄지어 선 적을 꿰뚫는다.',
    attack: {
      recovery: 0.15, cooldown: 1.1,
      effects: [{ type: 'projectile', speed: 34, radius: 0.16, range: 17, damage: 46, pierce: 3, knockback: 14 }],
    },
  },
  laser: {
    name: '레이저', kind: 'ranged', energy: 1, tier: 3, look: 'laser', desc: '닿는 적을 모두 태우는 광선.',
    attack: { cooldown: 0.1, effects: [{ type: 'beam', range: 9, width: 0.28, damage: 4, knockback: 1 }] },
    dash: { cooldown: 0.3, effects: [{ type: 'beam', range: 11, width: 0.6, damage: 22, knockback: 8 }] },
  },
  rocket: {
    name: '로켓', kind: 'ranged', energy: 14, tier: 3, look: 'rocket', desc: '크게 터진다.',
    attack: {
      recovery: 0.12, cooldown: 1.2,
      effects: [{ type: 'projectile', speed: 11, radius: 0.22, range: 12, damage: 12, knockback: 6, explode: { radius: 2.3, damage: 32, knockback: 14 } }],
    },
    dash: {
      recovery: 0.12, cooldown: 1.2,
      effects: [{
        type: 'projectile', speed: 13, radius: 0.22, range: 12, damage: 12, knockback: 6, spread: [R0, R6, R6N],
        explode: { radius: 2.0, damage: 22, knockback: 12 },
      }],
    },
  },
});
