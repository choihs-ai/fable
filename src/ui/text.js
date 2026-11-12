// 화면에 보일 문구를 데이터에서 만든다(이름, 설명, 거절 사유).

import { BOONS, FAMILIES } from '../../data/boons.js';
import { CHARACTERS } from '../../data/characters.js';
import { UPGRADES } from '../../data/meta.js';
import { WEAPONS } from '../../data/weapons.js';

export function boonName(id) {
  return Object.hasOwn(BOONS, id) ? BOONS[id].name : id;
}

/** 축복의 계열 표시: "불", "번개 + 얼음"(합성), ""(무계열). */
export function boonFamily(id) {
  if (!Object.hasOwn(BOONS, id)) return '';
  const b = BOONS[id];
  if (b.duo) return `${FAMILIES[b.duo[0]].name} + ${FAMILIES[b.duo[1]].name} 합성`;
  return b.family ? FAMILIES[b.family].name : '';
}

/** 축복의 계열 색(CSS). */
export function boonColor(id) {
  if (!Object.hasOwn(BOONS, id)) return '#e8d8ff';
  const b = BOONS[id];
  const family = b.duo ? null : b.family;
  const hex = family ? FAMILIES[family].color : b.duo ? 0xffffff : 0xe8d8ff;
  return `#${hex.toString(16).padStart(6, '0')}`;
}

export function weaponName(id) {
  return id && Object.hasOwn(WEAPONS, id) ? WEAPONS[id].name : '없음';
}

/** "권총 · 원거리 · 에너지 2" */
export function weaponMeta(id) {
  if (!id || !Object.hasOwn(WEAPONS, id)) return '';
  const w = WEAPONS[id];
  return w.kind === 'melee' ? `근접 · 등급 ${w.tier}` : `원거리 · 에너지 ${w.energy} · 등급 ${w.tier}`;
}

export function characterName(id) {
  return Object.hasOwn(CHARACTERS, id) ? CHARACTERS[id].name : id;
}

export function upgradeText(id, level) {
  const u = UPGRADES[id];
  return `${u.name} ${level}/${u.cost.length} — ${u.desc}`;
}

const REASONS = {
  'not-playing': '지금은 안 된다',
  nothing: '가까이에 아무것도 없다',
  'no-weapon': '바꿀 무기가 없다',
  'owned-form': '이미 들고 있는 탈이다',
  'too-far': '조금 더 가까이',
  'no-choice': '고를 것이 없다',
  'bad-index': '고를 수 없다',
  'no-gold': '금화가 모자라다',
  'no-shop': '상점에서만 살 수 있다',
  sold: '이미 팔렸다',
  owned: '이미 가진 축복이다',
  'full-hp': '체력이 가득하다',
  'no-souls': '영혼석이 모자라다',
  maxed: '끝까지 올렸다',
  unknown: '모르는 항목이다',
  quota: '저장할 자리가 모자라다',
};

export function reasonText(reason) {
  return REASONS[reason] ?? '안 된다';
}

/** 방 종류의 이름(미니맵·알림). */
export const ROOM_NAMES = Object.freeze({
  start: '시작', combat: '전투', elite: '정예', reward: '보상', shop: '상점', boss: '보스', exit: '출구', bonus: '숨은 방',
});

/** 보상의 이름. */
export const REWARD_NAMES = Object.freeze({ boon: '축복', weapon: '무기', gold: '금화', health: '체력' });
