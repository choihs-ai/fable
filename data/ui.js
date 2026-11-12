// 조작·ui 수치. 화면 좌표는 CSS 픽셀이다.

import { deepFreeze } from './freeze.js';

export const INPUT = deepFreeze({
  /**
   * 가상 조이스틱. 화면의 이동 영역 어디든 처음 닿은 곳이 중심이 된다(떠다니는 스틱).
   * radius: 감도 100% 에서 끝까지 민 것으로 보는 거리. 감도 s% 면 radius × 100 ÷ s 가 된다.
   * deadzone: 이 비율 안쪽의 움직임은 0 으로 본다(손 떨림).
   */
  stick: { radius: 60, deadzone: 0.14 },
  /**
   * 공격 버튼을 누른 채 끌면 수동 조준이 된다. 누른 자리에서 aimStart 넘게 끌어야 조준으로 본다(누르기만 하면 자동 조준).
   * 손을 떼면 다시 자동 조준.
   */
  aim: { aimStart: 18 },
  /**
   * 연속 터치 막기: 이 시간(ms) 안에 다시 손을 떼면(두 번 두드림) 브라우저의 기본 동작(확대·스크롤)을 막는다.
   * 버튼은 막은 대신 눌림을 직접 전달한다.
   */
  doubleTapMs: 300,
  /** 키보드(데스크톱 확인용). */
  keys: {
    up: ['KeyW', 'ArrowUp'],
    down: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    attack: ['KeyJ', 'Space'],
    dash: ['KeyK', 'ShiftLeft', 'ShiftRight'],
    skill: ['KeyL', 'KeyQ'],
    swap: ['KeyR', 'Tab'],
    interact: ['KeyE', 'KeyF'],
  },
});

/** 알림 문구가 떠 있는 시간(ms). */
export const UI = deepFreeze({ toastMs: 2600 });
