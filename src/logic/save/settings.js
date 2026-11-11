// 사용자 설정: 기본값과 정리. 목록과 허용 범위는 data/settings.js 에 있다.

import { SETTINGS } from '../../../data/settings.js';
import { isInt, isObject } from './schema.js';

export function defaultSettings() {
  const settings = {};
  for (const key of Object.keys(SETTINGS)) settings[key] = SETTINGS[key].default;
  return settings;
}

function valid(rule, value) {
  if (rule.type === 'int') return isInt(value, rule.min, rule.max);
  if (rule.type === 'bool') return typeof value === 'boolean';
  if (rule.type === 'enum') return rule.values.includes(value);
  throw new RangeError(`settings: 알 수 없는 형식 "${rule.type}"`);
}

/**
 * 바깥에서 받은 설정을 정리한다: 형식에 맞는 항목만 받아들이고 나머지는 기본값으로 둔다. 모르는 항목은 버린다.
 * @param {*} raw
 * @returns {{ settings:object, repaired:string[] }} repaired: 기본값으로 되돌렸거나 버린 항목 이름
 */
export function normalizeSettings(raw) {
  const settings = defaultSettings();
  const repaired = [];
  if (!isObject(raw)) return { settings, repaired: ['*'] };
  for (const key of Object.keys(SETTINGS)) {
    if (!Object.hasOwn(raw, key)) repaired.push(key);
    else if (valid(SETTINGS[key], raw[key])) settings[key] = raw[key];
    else repaired.push(key);
  }
  for (const key of Object.keys(raw)) {
    if (!Object.hasOwn(SETTINGS, key)) repaired.push(key);
  }
  return { settings, repaired };
}

/**
 * 설정 하나를 바꾼 새 객체를 돌려준다. 값이 형식에 맞지 않으면 예외.
 */
export function withSetting(settings, key, value) {
  if (!Object.hasOwn(SETTINGS, key)) throw new RangeError(`withSetting: 알 수 없는 설정 "${key}"`);
  if (!valid(SETTINGS[key], value)) throw new RangeError(`withSetting: ${key} 에 넣을 수 없는 값 (${value})`);
  return { ...normalizeSettings(settings).settings, [key]: value };
}
