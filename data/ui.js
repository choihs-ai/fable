// 조작·ui 수치. 화면 좌표는 CSS 픽셀이다.

import { deepFreeze } from './freeze.js';

export const INPUT = deepFreeze({
  /**
   * 가상 조이스틱. 화면의 이동 영역 어디든 처음 닿은 곳이 중심이 된다(떠다니는 스틱).
   * radius: 감도 100% 에서 끝까지 민 것으로 보는 거리. 감도 s% 면 radius × 100 ÷ s 가 된다.
   * deadzone: 이 비율 안쪽의 움직임은 0 으로 본다(손 떨림).
   */
  stick: { radius: 60, deadzone: 0.14 },
  /** 진동 길이(ms). 배열은 진동·쉼의 되풀이다. */
  vibration: { hurt: 28, kill: 10, levelUp: [18, 40, 18], death: 140, deny: 8 },
  /** 키보드(데스크톱 확인용). */
  keys: {
    up: ['KeyW', 'ArrowUp'],
    down: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    attack: ['KeyJ', 'Space'],
    skill0: ['Digit1', 'KeyU'],
    skill1: ['Digit2', 'KeyI'],
    skill2: ['Digit3', 'KeyO'],
    dodge: ['KeyK', 'ShiftLeft', 'ShiftRight'],
  },
});

/** 알림 문구가 떠 있는 시간(ms). */
export const UI = deepFreeze({ toastMs: 2600 });
