// 가상 조이스틱과 버튼을 화면에 만들고, 포인터·키보드 이벤트를 조작 상태 기계(controls.js)에 넘긴다.
// 포인터 이벤트를 쓴다: 손가락마다 pointerId 가 달라 멀티터치를 구분할 수 있고, 마우스도 같은 길로 들어온다.

import { h } from '../dom.js';
import { createControls } from './controls.js';

const BUTTONS = [
  { name: 'attack', label: '공격' },
  { name: 'skill0', label: '회전' },
  { name: 'skill1', label: '화염' },
  { name: 'skill2', label: '서리' },
  { name: 'dodge', label: '회피' },
];

/**
 * @param {object} options
 * @param {HTMLElement} options.root 조작부를 붙일 곳
 * @param {number} options.sensitivity 감도(%)
 */
export function createTouchPad({ root, sensitivity }) {
  const controls = createControls({ sensitivity });
  let enabled = false;

  const base = h('div', { class: 'stick-base' });
  const knob = h('div', { class: 'stick-knob' });
  const zone = h('div', { class: 'pad-move' }, base, knob);
  const buttons = {};
  const cluster = h('div', { class: 'pad-buttons' });
  for (const { name, label } of BUTTONS) {
    const cool = h('div', { class: 'cool' });
    const el = h('div', { class: `pad-button pad-${name}`, 'data-button': name }, cool, h('span', { text: label }));
    buttons[name] = { el, cool, last: -1 };
    cluster.append(el);
  }
  const pad = h('div', { class: 'pad hidden' }, zone, cluster);
  root.append(pad);

  /** 포인터를 요소에 붙들어 둔다: 손가락이 요소·화면 밖으로 나가도 이동·뗌 이벤트가 계속 온다. */
  const capture = (el, id) => {
    try {
      el.setPointerCapture(id);
    } catch {
      // 이미 사라진 포인터. 무시한다.
    }
  };
  const release = (e) => controls.pointerUp(e.pointerId);
  const cancel = (e) => controls.pointerCancel(e.pointerId);

  zone.addEventListener('pointerdown', (e) => {
    if (!enabled) return;
    e.preventDefault();
    if (controls.stickDown(e.pointerId, e.clientX, e.clientY)) capture(zone, e.pointerId);
  });
  zone.addEventListener('pointermove', (e) => controls.pointerMove(e.pointerId, e.clientX, e.clientY));
  for (const { name } of BUTTONS) {
    const { el } = buttons[name];
    el.addEventListener('pointerdown', (e) => {
      if (!enabled) return;
      e.preventDefault();
      if (controls.buttonDown(e.pointerId, name)) {
        capture(el, e.pointerId);
        el.classList.add('down');
      }
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      el.addEventListener(type, (e) => {
        (type === 'pointerup' ? release : cancel)(e);
        if (!controls.held().buttons.includes(name)) el.classList.remove('down');
      });
    }
  }
  zone.addEventListener('pointerup', release);
  zone.addEventListener('pointercancel', cancel);
  zone.addEventListener('lostpointercapture', cancel);
  pad.addEventListener('contextmenu', (e) => e.preventDefault());

  const onKeyDown = (e) => {
    if (!enabled || e.repeat) return;
    controls.keyDown(e.code);
  };
  const onKeyUp = (e) => controls.keyUp(e.code);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  function reset() {
    controls.reset();
    for (const name of Object.keys(buttons)) buttons[name].el.classList.remove('down');
  }

  return {
    controls,
    /** 조작을 켜고 끈다. 끌 때는 쥐고 있던 것을 모두 놓는다. */
    setEnabled(value) {
      if (enabled === value) return;
      enabled = value;
      pad.classList.toggle('hidden', !value);
      reset();
    },
    reset,
    setSensitivity: (value) => controls.setSensitivity(value),
    setLeftHanded(value) {
      pad.classList.toggle('left-handed', value === true);
    },
    /** 이번 프레임의 입력을 가져간다. 꺼져 있으면 빈 입력. */
    take() {
      if (!enabled) {
        controls.reset();
        return { moveX: 0, moveY: 0, attack: false, skill: -1, dodge: false };
      }
      return controls.take();
    },
    /**
     * 스틱 그림과 재사용 대기 표시를 갱신한다.
     * @param {Record<string, number>} cooling 버튼 이름 → 남은 재사용 대기 비율(0~1)
     */
    draw(cooling) {
      const shape = controls.stickShape();
      zone.classList.toggle('active', shape !== null);
      if (shape) {
        const rect = zone.getBoundingClientRect();
        base.style.transform = `translate(${shape.originX - rect.left}px, ${shape.originY - rect.top}px)`;
        knob.style.transform = `translate(${shape.knobX - rect.left}px, ${shape.knobY - rect.top}px)`;
        base.style.setProperty('--reach', `${shape.reach}px`);
      }
      for (const name of Object.keys(buttons)) {
        const button = buttons[name];
        const pct = Math.round((cooling[name] ?? 0) * 20) * 5;
        if (pct !== button.last) {
          button.last = pct;
          button.cool.style.height = `${pct}%`;
          button.el.classList.toggle('cooling', pct > 0);
        }
      }
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      pad.remove();
    },
  };
}
