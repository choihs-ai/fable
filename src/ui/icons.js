// 직접 그린 아이콘과 탈 초상(SVG). 글자·이모지 대신 쓴다.
// 모두 24×24 칸에 굵은 먹선으로 그린다: 선은 var(--ink), 면은 currentColor(부모의 color 로 정한다).

import { h } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';

/** SVG 요소를 만든다. */
function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const key of Object.keys(attrs)) el.setAttribute(key, String(attrs[key]));
  for (const child of children) el.append(child);
  return el;
}

/** 면(currentColor) + 먹선. */
const fill = (d) => s('path', { d, fill: 'currentColor', stroke: 'var(--ink)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
/** 선만: 먹선을 깔고 그 위에 색 선을 얹어 테두리가 있는 선처럼 보이게 한다. */
const line = (d, width = 3) => [
  s('path', { d, fill: 'none', stroke: 'var(--ink)', 'stroke-width': width + 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
  s('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': width, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
];

const SHAPES = {
  // 조작
  attack: () => [fill('M20.5 2.5 L21.5 3.5 L21 8 L11 18 L6 13 L16 3 Z'), ...line('M4.5 11.5 L12.5 19.5', 2.5), ...line('M7 17 L3.5 20.5', 3)],
  dash: () => [fill('M3 5 L10 12 L3 19 L7 19 L14 12 L7 5 Z'), fill('M11 5 L18 12 L11 19 L15 19 L22 12 L15 5 Z')],
  swap: () => [fill('M3 8 L14 8 L14 4.5 L21 9.5 L14 14 L14 11 L3 11 Z'), fill('M21 16 L10 16 L10 12.5 L3 17.5 L10 22 L10 19 L21 19 Z')],
  interact: () => [fill('M10 3 L14 3 L14 10 L18 10 L12 17 L6 10 L10 10 Z'), fill('M4 19 L20 19 L20 22 L4 22 Z')],
  pause: () => [fill('M6 4 L10 4 L10 20 L6 20 Z'), fill('M14 4 L18 4 L18 20 L14 20 Z')],
  // 재화·수치
  coin: () => [s('circle', { cx: 12, cy: 12, r: 8.5, fill: 'currentColor', stroke: 'var(--ink)', 'stroke-width': 2 }), s('path', { d: 'M12 7.5 V16.5', fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2.4, 'stroke-linecap': 'round' })],
  soul: () => [fill('M12 2 L19 12 L12 22 L5 12 Z'), s('path', { d: 'M12 6.5 L15.5 12 L12 17.5', fill: 'none', stroke: 'var(--ink)', 'stroke-width': 1.6, 'stroke-linejoin': 'round' })],
  heart: () => [fill('M12 21 L3.5 12.5 C0.5 9 3 3.5 7.5 4.5 C9.5 5 11 6.5 12 8 C13 6.5 14.5 5 16.5 4.5 C21 3.5 23.5 9 20.5 12.5 Z')],
  bolt: () => [fill('M14 2 L5 13.5 L10.5 13.5 L9 22 L19 9.5 L13 9.5 Z')],
  blade: () => [fill('M19 3 L21 5 L9 17 L7 15 Z'), ...line('M5 14 L10 19', 2.2), ...line('M6.5 17.5 L4 20', 2.6)],
  // 축복 계열
  fire: () => [fill('M12 2 C13 6 18 8 18 14 C18 18.5 15.5 22 12 22 C8.5 22 6 18.5 6 14 C6 11 8 9.5 9 7.5 C10 9 10.5 10 11 11 C11.5 8 11 5 12 2 Z')],
  ice: () => [...line('M12 2.5 V21.5', 2.4), ...line('M3.8 7.2 L20.2 16.8', 2.4), ...line('M20.2 7.2 L3.8 16.8', 2.4)],
  none: () => [fill('M12 2 L14.5 9.5 L22 12 L14.5 14.5 L12 22 L9.5 14.5 L2 12 L9.5 9.5 Z')],
  duo: () => [fill('M8 3 L10 9 L16 11 L10 13 L8 19 L6 13 L0.8 11 L6 9 Z'), fill('M17.5 12 L18.8 15.7 L22.5 17 L18.8 18.3 L17.5 22 L16.2 18.3 L12.5 17 L16.2 15.7 Z')],
  // 방·기타
  lock: () => [...line('M8 10 V7 C8 2.5 16 2.5 16 7 V10', 2.4), fill('M5 10 L19 10 L19 21 L5 21 Z')],
  skull: () => [fill('M12 2.5 C6 2.5 3.5 6.5 3.5 11 C3.5 14 5 15.5 6.5 16.5 L6.5 20.5 L17.5 20.5 L17.5 16.5 C19 15.5 20.5 14 20.5 11 C20.5 6.5 18 2.5 12 2.5 Z'), s('circle', { cx: 8.6, cy: 11, r: 2.2, fill: 'var(--ink)' }), s('circle', { cx: 15.4, cy: 11, r: 2.2, fill: 'var(--ink)' })],
  door: () => [fill('M5 21 L5 8 C5 2 19 2 19 8 L19 21 Z'), s('circle', { cx: 15, cy: 13.5, r: 1.4, fill: 'var(--ink)' })],
  check: () => [...line('M4.5 12.5 L10 18 L20 6.5', 3.2)],
  // 탈의 스킬
  'skill-knight': () => [fill('M5 9 C5 4 10 4 10 9 L10 20 L5 20 Z'), fill('M14 9 C14 4 19 4 19 9 L19 20 L14 20 Z')],
  'skill-mage': () => [fill('M6 3 L18 3 L18 6 L13.5 12 L18 18 L18 21 L6 21 L6 18 L10.5 12 L6 6 Z')],
  'skill-rogue': () => [fill('M12 21 L3 8 L6 6 Z'), fill('M12 21 L10.3 3 L13.7 3 Z'), fill('M12 21 L18 6 L21 8 Z')],
  'skill-brute': () => [fill('M7 3 L17 3 L17 12 L7 12 Z'), ...line('M2.5 17 L7 15 M21.5 17 L17 15 M12 15.5 V21', 2.4)],
};

/**
 * 아이콘 하나.
 * @param {string} name SHAPES 의 이름
 * @param {string} [cls] 덧붙일 클래스
 */
export function icon(name, cls = '') {
  const shape = SHAPES[name] ?? SHAPES.none;
  const svg = s('svg', { viewBox: '0 0 24 24', class: `icon icon-${name} ${cls}`.trim(), 'aria-hidden': 'true' }, ...shape());
  return svg;
}

/** 축복 계열의 아이콘 이름. */
export const familyIcon = (family, duo) => (duo ? 'duo' : family === 'fire' ? 'fire' : family === 'bolt' ? 'bolt' : family === 'ice' ? 'ice' : 'none');

/**
 * 탈의 생김새(3D 모델과 같은 색). head: 머리 색, hood: 덮개 색(없으면 null), eye: 눈 색, kind: 얼굴 종류.
 */
const MASKS = {
  knight: { head: '#d9e0ea', hood: null, eye: '#7af2ff', kind: 'visor', top: 'plume' },
  mage: { head: '#1c1430', hood: '#7a3fc0', eye: '#ffd84a', kind: 'glow', top: 'point' },
  rogue: { head: '#10141c', hood: '#1f8a80', eye: '#ff5a7a', kind: 'glow', top: null },
  brute: { head: '#e8b890', hood: null, eye: '#2a1410', kind: 'eyes', top: 'horns' },
};

/** 탈 초상: 큰 머리 하나(32×32). 모르는 탈이면 빈 탈. */
export function maskPortrait(form, cls = '') {
  const m = MASKS[form] ?? { head: '#cfc6b0', hood: null, eye: '#120b14', kind: 'eyes', top: null };
  const ink = { stroke: 'var(--ink)', 'stroke-width': 2, 'stroke-linejoin': 'round' };
  const parts = [];
  if (m.top === 'horns') {
    parts.push(s('path', { d: 'M8 10 L3 3 L11 7 Z', fill: '#2a2224', ...ink }), s('path', { d: 'M24 10 L29 3 L21 7 Z', fill: '#2a2224', ...ink }));
  }
  if (m.top === 'point') parts.push(s('path', { d: 'M16 0.8 L22 9 L10 9 Z', fill: m.hood, ...ink }));
  if (m.hood) parts.push(s('rect', { x: 3.5, y: 6, width: 25, height: 23, rx: 5, fill: m.hood, ...ink }));
  parts.push(s('rect', { x: m.hood ? 7 : 4.5, y: m.hood ? 11 : 7, width: m.hood ? 18 : 23, height: m.hood ? 15 : 21, rx: 4, fill: m.head, ...ink }));
  if (m.top === 'plume') parts.push(s('path', { d: 'M13 7.5 L16 1 L19 7.5 Z', fill: '#e8353a', ...ink }));
  if (m.kind === 'visor') {
    parts.push(s('rect', { x: 7, y: 15, width: 18, height: 5.5, rx: 1.5, fill: '#14101c' }));
    parts.push(s('rect', { x: 10, y: 16.2, width: 3.6, height: 3, fill: m.eye }), s('rect', { x: 18.4, y: 16.2, width: 3.6, height: 3, fill: m.eye }));
  } else if (m.kind === 'glow') {
    parts.push(s('rect', { x: 10.5, y: 16, width: 3.6, height: 5, rx: 1, fill: m.eye }), s('rect', { x: 17.9, y: 16, width: 3.6, height: 5, rx: 1, fill: m.eye }));
  } else {
    parts.push(s('rect', { x: 9, y: 14.5, width: 5, height: 6, rx: 1.5, fill: '#faf6ea', stroke: 'var(--ink)', 'stroke-width': 1.2 }), s('rect', { x: 18, y: 14.5, width: 5, height: 6, rx: 1.5, fill: '#faf6ea', stroke: 'var(--ink)', 'stroke-width': 1.2 }));
    parts.push(s('rect', { x: 10.8, y: 16.5, width: 2.2, height: 3, fill: m.eye }), s('rect', { x: 19.8, y: 16.5, width: 2.2, height: 3, fill: m.eye }));
  }
  return s('svg', { viewBox: '0 0 32 32', class: `mask ${cls}`.trim(), 'aria-hidden': 'true' }, ...parts);
}

/** 아이콘 + 글자를 한 줄로. */
export function withIcon(name, text, cls = '') {
  return h('span', { class: `with-icon ${cls}`.trim() }, icon(name), h('span', { text }));
}
