// 캐릭터. 시작 무기 둘과 고유 스킬 하나가 다르다.
//
// skill.type:
//   'dual'  쌍수 사격 — duration 초 동안 공격하면 다른 손의 무기도 함께 나간다(에너지를 쓰지 않는다)
//   'warp'  시간 왜곡 — 겨눈 자리에 radius 칸의 장판을 duration 초 동안 깐다. 안의 적과 적의 탄은 slow 배로 느려진다

import { deepFreeze } from './freeze.js';

export const CHARACTER_ORDER = Object.freeze(['knight', 'mage']);

export const CHARACTERS = deepFreeze({
  knight: {
    name: '기사', desc: '튼튼하다. 장검과 권총으로 시작한다.',
    hp: 110, speed: 4.5, energy: 160, weapons: ['sword', 'pistol'],
    skill: { name: '쌍수 사격', desc: '5초 동안 두 무기를 한꺼번에 쓴다(에너지 소모 없음).', type: 'dual', duration: 5, cooldown: 16 },
    /** 처음부터 쓸 수 있다. */
    cost: 0,
  },
  mage: {
    name: '마법사', desc: '약하지만 에너지가 많다. 지팡이와 단검으로 시작한다.',
    hp: 85, speed: 4.7, energy: 230, weapons: ['staff', 'dagger'],
    skill: { name: '시간 왜곡', desc: '겨눈 자리에 5초 동안 장판을 깐다. 안의 적과 탄이 크게 느려진다.', type: 'warp', radius: 4.5, duration: 5, slow: 0.3, reach: 7, cooldown: 18 },
    /** 거점에서 영혼석으로 해금한다. */
    cost: 60,
  },
});
