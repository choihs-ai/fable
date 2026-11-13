// 탈(캐릭터). 쓰고 있는 탈에 따라 체력·속도·에너지·스킬이 달라진다.
// 판을 시작할 때 하나를 고르고(거점에서 영혼석으로 해금), 판 중에 다른 탈을 주워 둘까지 들고 바꿔 쓴다.
// 탈은 무기 칸에 하나씩 딸려 있다: 교체 버튼을 누르면 탈과 무기가 함께 바뀌고, 그 순간 새 탈의 "교체 기술"이 나간다
// (교체 자체는 언제나 되고, 교체 기술만 PLAYER.swap.cooldown 초마다 한 번).
//
// skills: 탈마다 둘(스킬 버튼 둘). 재사용 대기는 스킬마다 따로 센다. glyph 는 버튼에 그릴 그림의 이름(src/ui/icons.js).
// skill.type:
//   'dual'   쌍수 사격 — duration 초 동안 공격하면 다른 손의 무기도 함께 나간다(에너지를 쓰지 않는다)
//   'warp'   시간 왜곡 — 겨눈 자리에 radius 칸의 장판을 duration 초 동안 깐다. 안의 적과 적의 탄은 slow 배로 느려진다
//   'cast'   effects 를 실행한다(형식은 data/player.js 의 기술 효과와 같다). 방향은 겨눈 쪽.
//            목표 지점(장판이 깔리는 곳): at 이 'self' 면 발밑, 아니면 겨눈 적의 자리(적이 없으면 겨눈 쪽으로 reach 칸 앞)
//   'heal'   최대 체력의 pct % 를 회복한다
//   'guard'  invuln 초 동안 무적. clearBullets 가 있으면 그 반경 안의 적 탄을 지우고, effects 가 있으면 함께 실행한다
// swap: 교체 기술. effects 를 겨눈 방향으로 실행하고, clearBullets 가 있으면 그 반경 안의 적 탄을 지운다.
// 각도는 [cos, sin] 으로 적는다(순수 로직은 삼각함수를 쓰지 않는다).

import { deepFreeze } from './freeze.js';

export const CHARACTER_ORDER = Object.freeze(['knight', 'mage', 'rogue', 'brute', 'gunner', 'shaman', 'jester', 'revenant']);

const FAN7 = [[1, 0], [0.9848, 0.1736], [0.9848, -0.1736], [0.9397, 0.342], [0.9397, -0.342], [0.866, 0.5], [0.866, -0.5]];
const RING8 = [[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]];
const RING12 = [
  [1, 0], [0.866, 0.5], [0.5, 0.866], [0, 1], [-0.5, 0.866], [-0.866, 0.5],
  [-1, 0], [-0.866, -0.5], [-0.5, -0.866], [0, -1], [0.5, -0.866], [0.866, -0.5],
];
/** 목표 지점 둘레의 다섯 자리(가운데 + 네 귀퉁이). */
const STAR5 = [[0, 0], [1.7, 0.6], [-1.7, 0.6], [0.9, -1.6], [-0.9, -1.6]];

export const CHARACTERS = deepFreeze({
  knight: {
    name: '기사', desc: '튼튼하다. 장검과 권총으로 시작한다.',
    hp: 110, speed: 4.5, energy: 160, weapons: ['sword', 'pistol'],
    skills: [
      { name: '쌍수 사격', desc: '5초 동안 두 무기를 한꺼번에 쓴다(에너지 소모 없음).', glyph: 'twin', type: 'dual', duration: 5, cooldown: 16 },
      {
        name: '수호', desc: '잠깐 무적이 되고 둘레의 탄을 지우며 적을 밀쳐 낸다.', glyph: 'shield', type: 'guard', cooldown: 13,
        invuln: 1.6, clearBullets: 3.5, effects: [{ type: 'circle', radius: 2.3, damage: 8, knockback: 12 }],
      },
    ],
    swap: { name: '방패 밀치기', desc: '둘레의 적을 밀쳐 내고 잠깐 멈춰 세운다.', effects: [{ type: 'circle', radius: 2.6, damage: 14, knockback: 15, status: { id: 'stun', duration: 0.5 } }] },
    /** 처음부터 쓸 수 있다. */
    cost: 0,
  },
  mage: {
    name: '마법사', desc: '약하지만 에너지가 많다. 지팡이와 단검으로 시작한다.',
    hp: 95, speed: 4.7, energy: 230, weapons: ['staff', 'dagger'],
    skills: [
      { name: '시간 왜곡', desc: '겨눈 자리에 5초 동안 장판을 깐다. 안의 적과 탄이 크게 느려진다.', glyph: 'hourglass', type: 'warp', radius: 4.5, duration: 5, slow: 0.3, reach: 7, cooldown: 18 },
      {
        name: '유성', desc: '겨눈 자리에 불덩이를 떨어뜨린다.', glyph: 'meteor', type: 'cast', cooldown: 12, reach: 5,
        effects: [{ type: 'hazard', delay: 0.7, radius: 2.5, damage: 48, status: { id: 'burn', duration: 3 } }],
      },
    ],
    swap: { name: '서리 고리', desc: '둘레의 적을 얼린다.', effects: [{ type: 'circle', radius: 3, damage: 10, knockback: 4, status: { id: 'freeze', duration: 1.4 } }] },
    /** 거점에서 영혼석으로 해금한다. */
    cost: 60,
  },
  rogue: {
    name: '도적', desc: '빠르고 무르다. 쌍검과 활로 시작한다.',
    hp: 88, speed: 5.3, energy: 150, weapons: ['dual_blades', 'bow'],
    skills: [
      {
        name: '칼날 부채', desc: '겨눈 쪽으로 꿰뚫는 칼날 일곱 자루를 부채꼴로 던진다.', glyph: 'fan', type: 'cast', cooldown: 9,
        effects: [{ type: 'projectile', speed: 19, radius: 0.16, range: 9, damage: 16, pierce: 2, knockback: 3, spread: FAN7 }],
      },
      {
        name: '독 안개', desc: '발밑에 4초 동안 독 안개를 피운다.', glyph: 'cloud', type: 'cast', cooldown: 11, at: 'self',
        effects: [{ type: 'hazard', delay: 0.2, duration: 4, interval: 0.5, radius: 2.7, damage: 5, status: { id: 'poison', duration: 3 } }],
      },
    ],
    swap: { name: '표창 흩뿌리기', desc: '사방으로 표창을 뿌린다.', effects: [{ type: 'projectile', speed: 16, radius: 0.16, range: 6, damage: 12, knockback: 4, spread: RING8 }] },
    cost: 90,
  },
  brute: {
    name: '투사', desc: '느리지만 가장 단단하다. 망치와 산탄총으로 시작한다.',
    hp: 135, speed: 4.15, energy: 110, weapons: ['hammer', 'shotgun'],
    skills: [
      {
        name: '땅울림', desc: '땅을 내리쳐 둘레의 적을 크게 다치게 하고 기절시킨다.', glyph: 'quake', type: 'cast', cooldown: 14,
        effects: [{ type: 'circle', radius: 3.4, damage: 40, knockback: 10, status: { id: 'stun', duration: 1.2 } }],
      },
      {
        name: '돌격', desc: '겨눈 쪽으로 들이받는다. 부딪힌 적은 멀리 날아간다.', glyph: 'charge', type: 'cast', cooldown: 9,
        effects: [{ type: 'dash', speed: 22, distance: 5.5, damage: 30, knockback: 17 }],
      },
    ],
    swap: { name: '포효', desc: '둘레의 적 탄을 지우고 적을 멀리 날려 보낸다.', clearBullets: 4.5, effects: [{ type: 'circle', radius: 3.2, damage: 6, knockback: 20 }] },
    cost: 120,
  },
  gunner: {
    name: '포수', desc: '멀리서 한 방. 석궁과 기관총으로 시작한다.',
    hp: 100, speed: 4.5, energy: 200, weapons: ['crossbow', 'smg'],
    skills: [
      {
        name: '관통탄', desc: '벽까지 뻗는 한 줄기. 줄지어 선 적을 모두 꿰뚫는다.', glyph: 'beam', type: 'cast', cooldown: 9,
        effects: [{ type: 'beam', range: 12, width: 0.5, damage: 50, knockback: 10 }],
      },
      {
        name: '화약통', desc: '발밑에 화약통을 놓는다. 잠시 뒤 크게 터진다.', glyph: 'bomb', type: 'cast', cooldown: 11, at: 'self',
        effects: [{ type: 'hazard', delay: 1.0, radius: 3.1, damage: 58 }],
      },
    ],
    swap: { name: '섬광탄', desc: '둘레의 적을 한참 기절시킨다.', effects: [{ type: 'circle', radius: 3.4, damage: 4, knockback: 3, status: { id: 'stun', duration: 1.1 } }] },
    cost: 110,
  },
  shaman: {
    name: '무당', desc: '스스로 낫는다. 서리 지팡이와 채찍으로 시작한다.',
    hp: 92, speed: 4.6, energy: 210, weapons: ['frost_staff', 'whip'],
    skills: [
      { name: '굿', desc: '체력을 채운다.', glyph: 'heal', type: 'heal', pct: 16, cooldown: 26 },
      {
        name: '혼불', desc: '사방으로 느린 불씨 열두 개를 띄운다. 닿으면 불이 붙는다.', glyph: 'wisp', type: 'cast', cooldown: 10,
        effects: [{ type: 'projectile', speed: 8, radius: 0.22, range: 6.5, damage: 13, knockback: 2, status: { id: 'burn', duration: 3 }, spread: RING12 }],
      },
    ],
    swap: { name: '부적', desc: '둘레의 적을 오래 느리게 한다.', effects: [{ type: 'circle', radius: 3.2, damage: 8, knockback: 3, status: { id: 'slow', duration: 3.5 } }] },
    cost: 130,
  },
  jester: {
    name: '광대', desc: '잘 구르고 잘 터뜨린다. 수리검과 권갑으로 시작한다.',
    hp: 96, speed: 5.0, energy: 170, weapons: ['shuriken', 'gauntlets'],
    skills: [
      {
        name: '폭죽', desc: '겨눈 자리 둘레 다섯 곳이 연달아 터진다.', glyph: 'firework', type: 'cast', cooldown: 9, reach: 4.5,
        effects: [{ type: 'hazard', delay: 0.45, radius: 1.5, damage: 24, offsets: STAR5 }],
      },
      {
        name: '재주넘기', desc: '겨눈 쪽으로 구른다. 구르는 동안 무적이고 지나간 적을 벤다.', glyph: 'tumble', type: 'guard', cooldown: 6,
        invuln: 0.5, effects: [{ type: 'dash', speed: 24, distance: 4.2, damage: 16, knockback: 5 }],
      },
    ],
    swap: { name: '깜짝 상자', desc: '사방으로 터지는 구슬을 뿌린다.', effects: [{ type: 'projectile', speed: 10, radius: 0.2, range: 3.6, damage: 6, knockback: 3, spread: RING8, explode: { radius: 1.3, damage: 9 } }] },
    cost: 150,
  },
  revenant: {
    name: '망자', desc: '때려서 버틴다. 낫과 권총으로 시작한다.',
    hp: 120, speed: 4.4, energy: 130, weapons: ['scythe', 'pistol'],
    skills: [
      {
        name: '혼 거두기', desc: '둘레를 베고, 준 피해의 절반만큼 체력을 되찾는다.', glyph: 'reap', type: 'cast', cooldown: 12,
        effects: [{ type: 'circle', radius: 3.1, damage: 24, knockback: 5, lifesteal: 0.5 }],
      },
      {
        name: '뼈 창', desc: '무엇이든 꿰뚫는 큰 창을 던진다.', glyph: 'spear', type: 'cast', cooldown: 8,
        effects: [{ type: 'projectile', speed: 24, radius: 0.3, range: 12, damage: 36, pierce: 9, knockback: 10 }],
      },
    ],
    swap: { name: '곡성', desc: '둘레의 적을 밀치고 피를 흘리게 한다.', effects: [{ type: 'circle', radius: 3, damage: 9, knockback: 8, status: { id: 'bleed', duration: 4 } }] },
    cost: 170,
  },
});
