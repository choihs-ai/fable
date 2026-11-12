// 진동. 지원하지 않는 기기(아이폰의 사파리 등)에서는 아무 일도 하지 않는다. 길이는 data/feel.js.

import { FEEL } from '../../data/feel.js';

export function createHaptics() {
  let enabled = true;
  const supported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  return {
    supported,
    setEnabled(value) {
      enabled = value === true;
    },
    /** @param {string} name FEEL.vibration 의 이름 */
    pulse(name) {
      if (!enabled || !supported || !Object.hasOwn(FEEL.vibration, name)) return false;
      try {
        return navigator.vibrate(FEEL.vibration[name]);
      } catch {
        return false;
      }
    },
  };
}
