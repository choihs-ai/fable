// 가상 조이스틱과 버튼을 화면에 만들고, 포인터·키보드 이벤트를 조작 상태 기계(controls.js)에 넘긴다.
// 포인터 이벤트를 쓴다: 손가락마다 pointerId 가 달라 멀티터치를 구분할 수 있고, 마우스도 같은 길로 들어온다.
//
// 버튼: 공격(크게, 끌면 수동 조준), 대시(충전 표시), 스킬(재사용 대기 표시), 무기 교체, 상호작용(할 것이 있을 때만 보인다).

import { h } from '../dom.js';
import { createControls } from './controls.js';

const BUTTONS = [
  { name: 'attack', label: '공격' },
  { name: 'dash', label: '대시' },
  { name: 'skill', label: '스킬' },
  { name: 'swap', label: '교체' },
  { name: 'interact', label: '줍기' },
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
  const aimArrow = h('div', { class: 'aim-arrow' });
  const buttons = {};
  const cluster = h('div', { class: 'pad-buttons' });
  for (const { name, label } of BUTTONS) {
    const cool = h('div', { class: 'cool' });
    const text = h('span', { class: 'label', text: label });
    const pips = h('div', { class: 'pips' });
    const el = h('div', { class: `pad-button pad-${name}`, 'data-button': name }, cool, text, pips);
    buttons[name] = { el, cool, text, pips, last: -1, pipsShown: '' };
    cluster.append(el);
  }
  buttons.attack.el.append(aimArrow);
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
  const move = (e) => controls.pointerMove(e.pointerId, e.clientX, e.clientY);

  zone.addEventListener('pointerdown', (e) => {
    if (!enabled) return;
    e.preventDefault();
    if (controls.stickDown(e.pointerId, e.clientX, e.clientY)) capture(zone, e.pointerId);
  });
  zone.addEventListener('pointermove', move);
  for (const { name } of BUTTONS) {
    const { el } = buttons[name];
    el.addEventListener('pointerdown', (e) => {
      if (!enabled) return;
      e.preventDefault();
      if (controls.buttonDown(e.pointerId, name, e.clientX, e.clientY)) {
        capture(el, e.pointerId);
        el.classList.add('down');
      }
    });
    el.addEventListener('pointermove', move);
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
    if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
    controls.keyDown(e.code);
  };
  const onKeyUp = (e) => controls.keyUp(e.code);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  function reset() {
    controls.reset();
    for (const name of Object.keys(buttons)) buttons[name].el.classList.remove('down');
  }

  const EMPTY = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, attack: false, dash: false, skill: false, swap: false, interact: false };

  return {
    controls,
    /** 조작을 켜고 끈다. 끌 때는 쥐고 있던 것을 모두 놓는다. */
    setEnabled(value) {
      if (enabled === value) return;
      enabled = value;
      pad.classList.toggle('hidden', !value);
      reset();
    },
    get enabled() {
      return enabled;
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
        return { ...EMPTY };
      }
      return controls.take();
    },
    /**
     * 스틱·조준 그림과 버튼 표시를 갱신한다.
     * @param {object} view { cooling:{ name → 0~1 }, charges, maxCharges, interact: 글자|null, swap: 무기 이름|null, skill: 이름 }
     */
    draw(view) {
      const shape = controls.stickShape();
      zone.classList.toggle('active', shape !== null);
      if (shape) {
        const rect = zone.getBoundingClientRect();
        base.style.transform = `translate(${shape.originX - rect.left}px, ${shape.originY - rect.top}px)`;
        knob.style.transform = `translate(${shape.knobX - rect.left}px, ${shape.knobY - rect.top}px)`;
        base.style.setProperty('--reach', `${shape.reach}px`);
      }
      const aim = controls.aimShape();
      aimArrow.classList.toggle('on', aim !== null);
      if (aim) aimArrow.style.transform = `rotate(${Math.atan2(aim.y, aim.x)}rad)`;
      for (const name of Object.keys(buttons)) {
        const button = buttons[name];
        const pct = Math.round(((view.cooling && view.cooling[name]) ?? 0) * 20) * 5;
        if (pct !== button.last) {
          button.last = pct;
          button.cool.style.height = `${pct}%`;
          button.el.classList.toggle('cooling', pct > 0);
        }
      }
      // 대시 충전: 점으로.
      const pips = `${view.charges ?? 0}/${view.maxCharges ?? 0}`;
      if (pips !== buttons.dash.pipsShown) {
        buttons.dash.pipsShown = pips;
        buttons.dash.pips.replaceChildren(...Array.from({ length: view.maxCharges ?? 0 }, (_, i) => h('i', { class: i < (view.charges ?? 0) ? 'full' : '' })));
        buttons.dash.el.classList.toggle('empty', (view.charges ?? 0) === 0);
      }
      const interact = view.interact ?? null;
      buttons.interact.el.classList.toggle('hidden', interact === null);
      if (interact !== null && buttons.interact.text.textContent !== interact) buttons.interact.text.textContent = interact;
      buttons.swap.el.classList.toggle('disabled', !view.swap);
      if (view.skill && buttons.skill.text.textContent !== view.skill) buttons.skill.text.textContent = view.skill;
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      pad.remove();
    },
  };
}
