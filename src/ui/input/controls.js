// 조작 상태 기계: 손가락(포인터)과 키의 눌림을 받아 "이번 프레임의 입력"을 만든다.
// DOM 을 모른다 — 포인터 번호와 좌표만 받는다. 그래서 멀티터치·취소·화면 이탈 같은 경우를 Node 에서 테스트할 수 있다.
//
// 규칙
//   - 조이스틱은 포인터 하나가 잡는다. 스틱을 잡은 손가락이 떼어지거나 취소되기 전에는 다른 손가락이 스틱이 될 수 없다.
//   - 버튼은 포인터마다 하나씩 잡는다. 여러 손가락이 서로 다른 버튼을 동시에 누를 수 있다.
//   - 공격은 누르고 있는 동안 계속. 공격 버튼을 누른 채 끌면 끈 방향으로 수동 조준(놓으면 자동 조준).
//   - 대시·스킬·무기 교체·상호작용은 누른 순간 한 번만 나간다(take() 가 가져가면 지워진다).
//   - 손가락이 화면 밖으로 나가도 스틱·조준은 유지된다. 떼거나 취소되면 놓인다.
//   - reset() 은 전부 놓는다(백그라운드 전환, 화면 회전, 메뉴 열기).

import { INPUT } from '../../../data/ui.js';

export const BUTTONS = Object.freeze(['attack', 'dash', 'skill', 'swap', 'interact']);
const ONCE = ['dash', 'skill', 'swap', 'interact'];

/**
 * @param {object} [options]
 * @param {number} [options.sensitivity] 감도(%)
 */
export function createControls({ sensitivity = 100 } = {}) {
  let sense = sensitivity;
  /** 스틱을 잡은 포인터와 그 중심·현재 위치. */
  let stick = null;
  /** 공격 버튼을 잡은 포인터의 누른 자리와 현재 위치. */
  let aim = null;
  /** 포인터 번호 → 누르고 있는 버튼 이름. */
  const held = new Map();
  const keys = new Set();
  /** 누른 순간 한 번만 나가는 것들. */
  const pending = new Set();

  const keyHeld = (name) => INPUT.keys[name].some((code) => keys.has(code));

  function stickVector() {
    if (!stick) return { x: 0, y: 0 };
    const reach = (INPUT.stick.radius * 100) / sense;
    const dx = stick.x - stick.originX;
    const dy = stick.y - stick.originY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (!(dist > 0)) return { x: 0, y: 0 };
    const amount = Math.min(1, dist / reach);
    if (amount < INPUT.stick.deadzone) return { x: 0, y: 0 };
    const scaled = (amount - INPUT.stick.deadzone) / (1 - INPUT.stick.deadzone);
    return { x: (dx / dist) * scaled, y: (dy / dist) * scaled };
  }

  /** 수동 조준 방향(단위 벡터). 충분히 끌지 않았으면 0(자동 조준). */
  function aimVector() {
    if (!aim) return { x: 0, y: 0 };
    const dx = aim.x - aim.originX;
    const dy = aim.y - aim.originY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (!(dist >= INPUT.aim.aimStart)) return { x: 0, y: 0 };
    return { x: dx / dist, y: dy / dist };
  }

  return {
    setSensitivity(value) {
      if (!(value > 0)) throw new RangeError(`setSensitivity: 잘못된 감도 ${value}`);
      sense = value;
    },
    /** 이동 영역에 손가락이 닿았다. 스틱이 이미 잡혀 있으면 무시한다. @returns {boolean} 스틱을 잡았는가 */
    stickDown(id, x, y) {
      if (stick || held.has(id)) return false;
      stick = { id, originX: x, originY: y, x, y };
      return true;
    },
    /** 버튼에 손가락이 닿았다. 공격 버튼이면 x, y 가 조준의 기준점이 된다. @returns {boolean} */
    buttonDown(id, name, x = 0, y = 0) {
      if (!BUTTONS.includes(name)) throw new RangeError(`buttonDown: 알 수 없는 버튼 "${name}"`);
      if ((stick && stick.id === id) || held.has(id)) return false;
      held.set(id, name);
      if (ONCE.includes(name)) pending.add(name);
      if (name === 'attack' && !aim && Number.isFinite(x) && Number.isFinite(y)) aim = { id, originX: x, originY: y, x, y };
      return true;
    },
    pointerMove(id, x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (stick && stick.id === id) {
        stick.x = x;
        stick.y = y;
      }
      if (aim && aim.id === id) {
        aim.x = x;
        aim.y = y;
      }
    },
    /** 손가락을 뗐다. 모르는 포인터면 아무 일도 없다. */
    pointerUp(id) {
      if (stick && stick.id === id) stick = null;
      if (aim && aim.id === id) aim = null;
      held.delete(id);
    },
    /** 시스템이 터치를 가져갔다(전화, 제스처, 캡처 해제). 뗀 것과 같다. */
    pointerCancel(id) {
      this.pointerUp(id);
    },
    keyDown(code) {
      if (keys.has(code)) return; // 자동 반복
      keys.add(code);
      for (const name of ONCE) {
        if (INPUT.keys[name].includes(code)) pending.add(name);
      }
    },
    keyUp(code) {
      keys.delete(code);
    },
    /** 전부 놓는다. 가져가지 않은 한 번짜리 입력도 버린다. */
    reset() {
      stick = null;
      aim = null;
      held.clear();
      keys.clear();
      pending.clear();
    },
    /**
     * 이번 프레임의 입력. 한 번짜리 입력은 가져가면 지워진다.
     * @returns {{ moveX:number, moveY:number, aimX:number, aimY:number, attack:boolean, dash:boolean, skill:boolean, swap:boolean, interact:boolean }}
     */
    take() {
      let { x, y } = stickVector();
      if (!stick) {
        x = (keyHeld('right') ? 1 : 0) - (keyHeld('left') ? 1 : 0);
        y = (keyHeld('down') ? 1 : 0) - (keyHeld('up') ? 1 : 0);
        if (x !== 0 && y !== 0) {
          x *= Math.SQRT1_2;
          y *= Math.SQRT1_2;
        }
      }
      let attack = keyHeld('attack');
      for (const name of held.values()) {
        if (name === 'attack') attack = true;
      }
      const a = aimVector();
      const out = {
        moveX: x, moveY: y, aimX: a.x, aimY: a.y, attack,
        dash: pending.has('dash'), skill: pending.has('skill'), swap: pending.has('swap'), interact: pending.has('interact'),
      };
      pending.clear();
      return out;
    },
    /** 화면에 그릴 스틱의 모양. 잡혀 있지 않으면 null. */
    stickShape() {
      if (!stick) return null;
      const reach = (INPUT.stick.radius * 100) / sense;
      const dx = stick.x - stick.originX;
      const dy = stick.y - stick.originY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const k = dist > reach ? reach / dist : 1;
      return { originX: stick.originX, originY: stick.originY, knobX: stick.originX + dx * k, knobY: stick.originY + dy * k, reach };
    },
    /** 수동 조준 중이면 그 방향, 아니면 null(화면 표시용). */
    aimShape() {
      const a = aimVector();
      return a.x === 0 && a.y === 0 ? null : a;
    },
    /** 지금 누르고 있는 것(화면 표시·테스트용). */
    held() {
      return { stick: stick ? stick.id : null, aim: aim ? aim.id : null, buttons: [...held.values()].sort(), pointers: held.size + (stick ? 1 : 0) };
    },
  };
}
