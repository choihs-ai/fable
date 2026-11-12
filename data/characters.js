// 탈(캐릭터). 쓰고 있는 탈에 따라 체력·속도·에너지·스킬이 달라진다.
// 판을 시작할 때 하나를 고르고(거점에서 영혼석으로 해금), 판 중에 다른 탈을 주워 둘까지 들고 바꿔 쓴다.
// 탈은 무기 칸에 하나씩 딸려 있다: 교체 버튼을 누르면 탈과 무기가 함께 바뀌고, 그 순간 새 탈의 "교체 기술"이 나간다
// (교체 자체는 언제나 되고, 교체 기술만 PLAYER.swap.cooldown 초마다 한 번).
//
// skill.type:
//   'dual'  쌍수 사격 — duration 초 동안 공격하면 다른 손의 무기도 함께 나간다(에너지를 쓰지 않는다)
//   'warp'  시간 왜곡 — 겨눈 자리에 radius 칸의 장판을 duration 초 동안 깐다. 안의 적과 적의 탄은 slow 배로 느려진다
//   'cast'  겨눈 방향으로 effects 를 실행한다(형식은 data/player.js 의 기술 효과와 같다)
// swap: 교체 기술. effects 를 겨눈 방향으로 실행하고, clearBullets 가 있으면 그 반경 안의 적 탄을 지운다.
// 각도는 [cos, sin] 으로 적는다(순수 로직은 삼각함수를 쓰지 않는다).

import { deepFreeze } from './freeze.js';

export const CHARACTER_ORDER = Object.freeze(['knight', 'mage', 'rogue', 'brute']);

const FAN7 = [[1, 0], [0.9848, 0.1736], [0.9848, -0.1736], [0.9397, 0.342], [0.9397, -0.342], [0.866, 0.5], [0.866, -0.5]];
const RING8 = [[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]];

export const CHARACTERS = deepFreeze({
  knight: {
    name: '기사', desc: '튼튼하다. 장검과 권총으로 시작한다.',
    hp: 110, speed: 4.5, energy: 160, weapons: ['sword', 'pistol'],
    skill: { name: '쌍수 사격', desc: '5초 동안 두 무기를 한꺼번에 쓴다(에너지 소모 없음).', type: 'dual', duration: 5, cooldown: 16 },
    swap: { name: '방패 밀치기', desc: '둘레의 적을 밀쳐 내고 잠깐 멈춰 세운다.', effects: [{ type: 'circle', radius: 2.6, damage: 14, knockback: 15, status: { id: 'stun', duration: 0.5 } }] },
    /** 처음부터 쓸 수 있다. */
    cost: 0,
  },
  mage: {
    name: '마법사', desc: '약하지만 에너지가 많다. 지팡이와 단검으로 시작한다.',
    hp: 95, speed: 4.7, energy: 230, weapons: ['staff', 'dagger'],
    skill: { name: '시간 왜곡', desc: '겨눈 자리에 5초 동안 장판을 깐다. 안의 적과 탄이 크게 느려진다.', type: 'warp', radius: 4.5, duration: 5, slow: 0.3, reach: 7, cooldown: 18 },
    swap: { name: '서리 고리', desc: '둘레의 적을 얼린다.', effects: [{ type: 'circle', radius: 3, damage: 10, knockback: 4, status: { id: 'freeze', duration: 1.4 } }] },
    /** 거점에서 영혼석으로 해금한다. */
    cost: 60,
  },
  rogue: {
    name: '도적', desc: '빠르고 무르다. 쌍검과 활로 시작한다.',
    hp: 88, speed: 5.3, energy: 150, weapons: ['dual_blades', 'bow'],
    skill: {
      name: '칼날 부채', desc: '겨눈 쪽으로 꿰뚫는 칼날 일곱 자루를 부채꼴로 던진다.', type: 'cast', cooldown: 9,
      effects: [{ type: 'projectile', speed: 19, radius: 0.16, range: 9, damage: 16, pierce: 2, knockback: 3, spread: FAN7 }],
    },
    swap: { name: '표창 흩뿌리기', desc: '사방으로 표창을 뿌린다.', effects: [{ type: 'projectile', speed: 16, radius: 0.16, range: 6, damage: 12, knockback: 4, spread: RING8 }] },
    cost: 90,
  },
  brute: {
    name: '투사', desc: '느리지만 가장 단단하다. 망치와 산탄총으로 시작한다.',
    hp: 135, speed: 4.15, energy: 110, weapons: ['hammer', 'shotgun'],
    skill: {
      name: '땅울림', desc: '땅을 내리쳐 둘레의 적을 크게 다치게 하고 기절시킨다.', type: 'cast', cooldown: 14,
      effects: [{ type: 'circle', radius: 3.4, damage: 40, knockback: 10, status: { id: 'stun', duration: 1.2 } }],
    },
    swap: { name: '포효', desc: '둘레의 적 탄을 지우고 적을 멀리 날려 보낸다.', clearBullets: 4.5, effects: [{ type: 'circle', radius: 3.2, damage: 6, knockback: 20 }] },
    cost: 120,
  },
});
